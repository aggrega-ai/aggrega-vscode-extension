// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import * as vscode from 'vscode';
import { GraphRedactor, createGraphRedactor } from './graph-payload';
import { makeGraphMessageHandler } from './graph-messages';
import { describeError } from './error-surfaces';
import { reportGraphFailure } from './graph-failure';
import { RendersOnReady } from './readiness';
import { CancellationSignal } from './cancellation';
import { withCancellableProgress } from './progress';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// GraphDeps supplies the live state the graph view needs without importing
// extension.ts (which would form an import cycle): the anchored workspace root
// (source-file clicks resolve against it), the editor's selected Release, the
// irGraph request (daemon-backed), and the shared output channel.
export interface GraphDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  // selectedRelease is the editor's one selected Release, workspace-relative,
  // or null when none is selected. The view graphs that Release rather than
  // prompting for one of its own: a prompt here would be a second answer to
  // "which Release are we talking about", so the graph could draw one Release
  // while validation reported on another.
  selectedRelease(): string | null;
  // requireSelectedRelease reports that nothing is selected, and offers the
  // reader the way to select one. Supplied rather than spelled out here so
  // every surface that needs a selection says the same thing.
  requireSelectedRelease(): void;
  // requestIrGraph returns the serialized IRGraph object (the daemon's
  // irGraph result `graph` field) for the given workspace-relative Release.
  //
  // The signal is how a reader stops the compile the drawing needs. It is
  // supplied only for a render the reader asked for; a quiet refresh passes
  // none, because there is no indicator to press cancel on.
  requestIrGraph(release: string, signal?: CancellationSignal): Promise<unknown>;
  // requestAttachCandidates reports which Features declare an applicability
  // that this label set satisfies.
  //
  // THE SUBJECT IS THE LABEL SET, not a node name and not a graph node, and
  // that is what makes the question answerable from a canvas. The labels a
  // drawn graph carries are the finalised ones the build itself evaluates
  // applicability against, so passing them asks the strongest form of the
  // question — while naming a node instead would have the graph rebuilt in
  // order to look labels back up that the canvas is already displaying.
  requestAttachCandidates(labels: Record<string, string>): Promise<unknown>;
  // showsSensitiveValues reports whether the reader has asked to see the values
  // a Feature declares sensitive. Read on each render rather than captured, so
  // changing the setting takes effect on the next render of an open panel.
  showsSensitiveValues(): boolean;
  // reportDaemonError routes a failed request's error envelope to the per-code
  // surfaces the extension already has for it — a diagnostic on the document
  // the envelope names, or the toast that offers the remediating command — and
  // reports whether it recognised the envelope.
  //
  // A refusal reaching this view is about an authored document, and the
  // envelope carries which one plus, where the fault is attributable to a
  // single key, that key's span. Without this the payload would reach the
  // reader as one line of log text and the position it carries would be
  // discarded. fallbackPath is the document to attach a diagnostic to when the
  // envelope names no artifact of its own.
  reportDaemonError(err: unknown, fallbackPath: string): boolean;
  output: vscode.OutputChannel;
}

// GraphView is the handle the extension holds to re-render the open panel on
// events the panel cannot see for itself — the language server reporting that
// it has recompiled.
export interface GraphView {
  refresh(): void;
}

// activateGraphView registers the topology-graph command. A single panel is
// reused across invocations so re-running the command refreshes the existing
// view rather than stacking panels.
export function activateGraphView(context: vscode.ExtensionContext, deps: GraphDeps): GraphView {
  let panel: vscode.WebviewPanel | null = null;
  // Built once per activation, against this installation's own files, and used
  // on every render.
  const redact = createGraphRedactor(context.extensionUri.fsPath);
  // The Release the open panel is showing. Held so a refresh re-renders the
  // same one without asking the user again, and cleared with the panel so a
  // refresh after a close does nothing.
  let shownRelease: string | null = null;

  context.subscriptions.push(
    vscode.commands.registerCommand('aggrega.graph.show', async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }

      const release = deps.selectedRelease();
      if (!release) {
        deps.requireSelectedRelease();
        return;
      }

      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          'aggrega.graph',
          'Aggrega Graph',
          vscode.ViewColumn.Active,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
              vscode.Uri.joinPath(context.extensionUri, 'media'),
              vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'elkjs', 'lib'),
            ],
          },
        );
        panel.onDidDispose(() => { panel = null; shownRelease = null; }, null, context.subscriptions);
        // The handler is registered once, with the panel, and the panel
        // outlives the anchor — so it reads the root through the getter on each
        // message rather than closing over the one bound above, which belongs
        // to this single invocation. Every other read in this file goes through
        // the getter for the same reason.
        panel.webview.onDidReceiveMessage(
          makeGraphMessageHandler(deps.getWorkspaceRoot, {
            openSource: (workspaceRoot, sourceFile) => { void openSource(workspaceRoot, sourceFile); },
            reportNoWorkspace: () => {
              void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
            },
            requestAttachCandidates: (nodeId, labels, requestId) => {
              // The panel that asked is the panel answered. There is one, it is
              // reused, and it is cleared when it closes — so a request whose
              // panel is already gone has nowhere to report and is dropped.
              if (!panel) { return; }
              void postAttachCandidates(panel, deps, nodeId, labels, requestId);
            },
          }),
          null,
          context.subscriptions,
        );
        panel.webview.html = graphHtml(panel.webview, context.extensionUri);
      } else {
        panel.reveal(vscode.ViewColumn.Active);
      }

      panel.title = `Aggrega Graph — ${release}`;
      shownRelease = release;
      await renderGraph(panel, deps, redact, release);
    }),
  );

  // refresh re-renders the Release the panel is already showing. It does
  // nothing when no panel is open or none has been chosen yet: the graph is
  // a view the user opens deliberately, so nothing here opens one on its own
  // or asks the language server for a graph nobody is looking at.
  const refresh = (): void => {
    if (!panel || !shownRelease) { return; }
    // Quiet: the panel keeps showing the graph it has until the new one
    // replaces it, rather than flashing a layout notice on every recompile.
    void renderGraph(panel, deps, redact, shownRelease, { quiet: true });
  };

  // A panel left open across a restart is showing a topology drawn by a server
  // that has since been replaced, and the recompile notice that ordinarily
  // re-renders it need never arrive — nothing has been edited. Re-rendering
  // when the compiler becomes answerable again is what closes that gap; a panel
  // that is not open is unaffected, because refresh has nothing to draw.
  deps.onReady(refresh);

  return { refresh };
}

// renderGraph requests the IR graph and posts it to the webview, surfacing any
// request failure both in the panel and the output channel. A quiet render
// skips the "laying out" notice, for a re-render the user did not ask for.
//
// The graph is redacted HERE, before it is posted, and this is the whole reason
// the redaction sits at this line rather than at the places the panel draws.
// Withholding at each drawing site has to be re-established every time a drawing
// site is added, and nothing fails when it is forgotten: the value is present,
// so new code that renders it works perfectly and discloses a credential.
// Withholding as the payload crosses is one guarantee that holds however the far
// side is later written.
async function renderGraph(
  panel: vscode.WebviewPanel,
  deps: GraphDeps,
  redact: GraphRedactor,
  release: string,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  if (!opts.quiet) {
    void panel.webview.postMessage({ type: 'loading', release });
  }
  try {
    // A render the reader asked for is watched and can be stopped, on the same
    // presentation every other operation that compiles a Release uses. A quiet
    // refresh is not: it happens on recompile rather than on a press, the panel
    // goes on showing the graph it has, and an indicator for it would put a
    // notification in front of a reader for something already on screen.
    const answer = opts.quiet
      ? await deps.requestIrGraph(release)
      : await withCancellableProgress(
        `Aggrega: building the topology of ${release}`,
        (signal) => deps.requestIrGraph(release, signal),
      );
    const graph = redact(answer, deps.showsSensitiveValues());
    void panel.webview.postMessage({ type: 'render', release, graph });
  } catch (err) {
    // A redaction that cannot be performed lands here with the request
    // failures, and is reported the same way. Nothing is posted, which is the
    // safe direction: with no way to tell a value that may be shown from one
    // that may not, showing none of them is the only honest answer.
    //
    // Which surfaces hear about the failure, in which order, and in whose
    // words is decided in reportGraphFailure — over sinks, so those decisions
    // are assertable without an editor. This binds each sink to the panel and
    // the channel this render belongs to.
    reportGraphFailure(err, release, {
      reportDaemonError: (thrown, fallbackPath) => deps.reportDaemonError(thrown, fallbackPath),
      logLine: (line) => { deps.output.appendLine(line); },
      notifyPanel: (message) => {
        void panel.webview.postMessage({ type: 'error', release, message });
      },
    });
  }
}

// postAttachCandidates asks what may attach to one node and posts the answer
// back to the panel, tagged with the node it was asked about so the panel can
// tell an answer about the selected node from one that arrived late.
//
// # A refusal is reported into the panel, and NOT onto a document
//
// The extension routes a daemon refusal to a diagnostic on the document the
// refusal names, which is right for a failure that is ABOUT an authored
// document — a graph that would not compile is about the Release. This request
// is not of that kind. It names no document and builds no graph: its subject is
// a label set, so nothing it can be refused for is attributable to a file, and
// nothing it returns carries one. Publishing a diagnostic anyway would need a
// document chosen here rather than named by the refusal, and the reader would
// be sent to a file that is not at fault.
//
// So the answer and the refusal go to the same place the question was asked —
// the panel the reader is looking at — with the detail on the output channel
// where the rest of this view's failures are recorded. Both surfaces, because a
// reader watching the panel has to be told the list is not coming, and a
// message worth acting on is worth keeping after the panel closes.
// The request id is echoed back untouched, on the answer and on the refusal
// alike. Two requests may be in flight at once and may complete in either
// order, so a refusal that is not echoed would be as capable of overwriting a
// fresh answer as a stale answer is.
async function postAttachCandidates(
  panel: vscode.WebviewPanel,
  deps: GraphDeps,
  nodeId: string,
  labels: Record<string, string>,
  requestId: number,
): Promise<void> {
  try {
    const result = await deps.requestAttachCandidates(labels);
    void panel.webview.postMessage({ type: 'attachCandidates', nodeId, requestId, result });
  } catch (err) {
    // describeError is the extension's one home for rendering a thrown value as
    // a line for a reader, so a transport refusal and a language server that is
    // not running are worded here by the same rule they are worded everywhere.
    const message = describeError(err);
    deps.output.appendLine(`attachCandidates failed for ${nodeId}: ${message}`);
    void panel.webview.postMessage({ type: 'attachCandidatesError', nodeId, requestId, message });
  }
}

// openSource opens the node's authoring file. The IR carries workspace-relative
// paths, so the click resolves against the anchored root.
async function openSource(workspaceRoot: string, sourceFile: string): Promise<void> {
  const abs = path.isAbsolute(sourceFile) ? sourceFile : path.join(workspaceRoot, sourceFile);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    void vscode.window.showWarningMessage(`Aggrega: cannot open ${sourceFile}.`);
  }
}

// graphHtml builds the webview document: a strict CSP allowing only the
// nonce'd inline bootstrap plus the five local scripts (elk bundle + the
// layout model + the attachment projection + the candidate projection + the
// graph renderer), served through webview-scoped URIs.
function graphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const elkUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', 'elkjs', 'lib', 'elk.bundled.js'),
  );
  const modelUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'graph-model.js'),
  );
  const attachmentsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'attachments-model.js'),
  );
  const candidatesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'candidates-model.js'),
  );
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph.css'));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Aggrega Graph</title>
</head>
<body>
  <div id="status" class="status">Select a Release to render its topology.</div>
  <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
  <!-- The layout has to size every box around the text it will hold, and it
       runs before any of the graph is in the document. This text element is in
       the document from the start, parked off to the side of the viewport, so
       there is somewhere to measure a string before there is a graph to draw.
       It is moved out of sight rather than hidden: an element the browser does
       not lay out reports no text advance at all. -->
  <svg id="measure" class="measure" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <text id="measure-text"></text>
  </svg>
  <aside id="legend" class="legend hidden"></aside>
  <aside id="panel" class="panel hidden">
    <header class="panel-head">
      <span id="panel-title" class="panel-title"></span>
      <button id="panel-close" class="panel-close" title="Close">✕</button>
    </header>
    <div id="panel-body" class="panel-body"></div>
  </aside>
  <script nonce="${nonce}" src="${elkUri}"></script>
  <script nonce="${nonce}" src="${modelUri}"></script>
  <script nonce="${nonce}" src="${attachmentsUri}"></script>
  <script nonce="${nonce}" src="${candidatesUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

// makeNonce returns a random token for the CSP script allowlist. Math.random is
// sufficient for a per-render CSP nonce — it is not a security boundary on its
// own; the CSP source restriction and local-only resource roots are.
function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
