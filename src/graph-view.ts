// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { GraphRedactor, createGraphRedactor } from './graph-payload';
import { makeGraphMessageHandler } from './graph-messages';
import {
  AttachCandidatesRequest,
  AttachmentContainerRequest,
  AttachmentSite,
  attachCandidatesRequest,
  attachFailureLine,
  attachRefusal,
  attachmentContainerRequest,
  attachmentEntryLines,
  attachmentSites,
  composeInsertionText,
  insertionPositionInDocument,
  nameAttachment,
  readAttachmentContainer,
  readInsertion,
  refusesEntryShape,
} from './attachment-edit';
import { describeError } from './error-surfaces';
import { reportGraphFailure } from './graph-failure';
import { RendersOnReady } from './readiness';
import { CancellationSignal } from './cancellation';
import { withCancellableProgress } from './progress';
import { NO_ANCHORED_WORKSPACE_MESSAGE, fromWorkspaceRelative } from './workspace';

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
  // that one drawn node's labels satisfy.
  //
  // THE SUBJECT IS A GRAPH NODE AND THE RELEASE ITS GRAPH WAS BUILT FROM, the
  // same coordinate the container question below is asked with. The labels
  // matched are the node's finalised set on that Release's compiled graph,
  // which is what the build evaluates applicability against, and the Features
  // matched include those the catalog directories that Release builds against
  // hold. A label set sent on its own would be matched against the workspace's
  // own directories instead, which a Release given directories of its own does
  // not build against.
  requestAttachCandidates(request: AttachCandidatesRequest): Promise<unknown>;
  // requestAttachmentContainer reports which document an attachment for one
  // drawn node belongs in, and the structural path to the container inside it.
  //
  // THE SUBJECT IS A GRAPH NODE AND THE RELEASE ITS GRAPH WAS BUILT FROM, which
  // is what the canvas holds and is why the question is answerable from one.
  // The whole request is composed where its answer is read, and is passed on the
  // wire exactly as composed — this side supplies a coordinate and nothing
  // structural, because how an Aggregate nests its components is the compiler's
  // knowledge and a second copy of it here would be free to disagree.
  requestAttachmentContainer(request: AttachmentContainerRequest): Promise<unknown>;
  // requestInsertionPoint reports where a new entry under the named container
  // belongs in one authored document.
  //
  // It is the compiler's answer and it is read-only: it reports a position and
  // writes nothing. Composing the entry's text and applying it belongs on this
  // side, because this side owns the buffer, the undo history and whatever the
  // reader has typed and not yet saved.
  requestInsertionPoint(file: string, container: string[]): Promise<unknown>;
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
// events the panel cannot see for itself — a file it was drawn from changing on
// disk.
export interface GraphView {
  refresh(): void;
  // shownRelease is the Release the open panel is showing, which is the Release
  // refresh redraws, or null where no panel is open and refresh draws nothing.
  // A panel keeps the Release it was shown with when the selection moves, so
  // this can name a Release other than the selected one.
  shownRelease(): string | null;
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
  // What the drawn graph knows about each node's authoring, rebuilt on every
  // render. It holds names and a path per node and no authored value at all, so
  // keeping it costs nothing the redaction removed.
  //
  // It is kept HERE, on the side that received the compiled graph, rather than
  // asked of the view when an edit is requested. A document path arriving back
  // from the view would be a path the extension writes to on the view's word,
  // and the view is a separate context; this way every edit lands in a document
  // the compiler itself named.
  let shownSites = new Map<string, AttachmentSite>();
  // How a completed render hands back what it read. The render is a free
  // function so it can be reasoned about without this closure; this is the one
  // thing it has to put back.
  const keepSites = (sites: Map<string, AttachmentSite>): void => { shownSites = sites; };

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
        panel.onDidDispose(() => {
          panel = null;
          shownRelease = null;
          shownSites = new Map();
        }, null, context.subscriptions);
        // The panel keeps its context while the editor is not showing it, so it
        // goes on receiving graphs and drawing them — and a drawing has to be
        // sized against the area it will be read in. That area is not something
        // the panel can measure for itself while it is off screen, and it is
        // not something it can infer from what it measures: a panel nobody is
        // looking at reports a size like any other. So the one side that knows
        // says so, on every change, and the panel does not have to guess.
        panel.onDidChangeViewState(() => {
          if (!panel) { return; }
          void panel.webview.postMessage({ type: 'visibility', visible: panel.visible });
        }, null, context.subscriptions);
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
            requestAttachCandidates: (nodeId, requestId) => {
              // The panel that asked is the panel answered. There is one, it is
              // reused, and it is cleared when it closes — so a request whose
              // panel is already gone has nowhere to report and is dropped.
              if (!panel) { return; }
              // Asked about the Release this panel's graph was drawn from, for
              // the reason the commit below is: the node id belongs to that
              // graph, and the selection may since have moved.
              if (!shownRelease) {
                void panel.webview.postMessage({
                  type: 'attachCandidatesError', nodeId, requestId,
                  message: 'this panel is not showing a Release yet.',
                });
                return;
              }
              void postAttachCandidates(panel, deps, nodeId, shownRelease, requestId);
            },
            attachFeature: (nodeId, featureName) => {
              if (!panel) { return; }
              // The site is looked up in this render's own table rather than
              // taken from the message, so a node the current graph does not
              // hold has nowhere to attach anything and says so.
              const site = shownSites.get(nodeId);
              if (!site) {
                void postAttachOutcome(panel, nodeId,
                  `${nodeId} is not on the graph this panel drew.`, false);
                return;
              }
              // The Release asked about is the one this panel's graph was drawn
              // from, not whatever is selected now: the node ids and the
              // attachments the click was made against came from that render,
              // and asking about a different Release would answer about a
              // different graph.
              if (!shownRelease) {
                void postAttachOutcome(panel, nodeId,
                  'This panel is not showing a Release yet.', false);
                return;
              }
              void attachFeature(panel, deps, site, featureName, shownRelease);
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
      await renderGraph(panel, deps, redact, release, keepSites);
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
    void renderGraph(panel, deps, redact, shownRelease, keepSites, { quiet: true });
  };

  // A panel left open across a restart is showing a topology drawn by a server
  // that has since been replaced, and the recompile notice that ordinarily
  // re-renders it need never arrive — nothing has been edited. Re-rendering
  // when the compiler becomes answerable again is what closes that gap; a panel
  // that is not open is unaffected, because refresh has nothing to draw.
  deps.onReady(refresh);

  // Read from the same two values refresh is guarded by, so the answer and what
  // a refresh would do cannot come apart.
  const releaseOnPanel = (): string | null => (panel && shownRelease ? shownRelease : null);

  return { refresh, shownRelease: releaseOnPanel };
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
  keepSites: (sites: Map<string, AttachmentSite>) => void,
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
    // Read from the answer rather than from the redacted payload, and only once
    // the redaction has succeeded: what this keeps is a path and a set of names
    // per node, none of which the redaction touches, and a render that posts
    // nothing must leave no sites behind for an edit to act on.
    keepSites(attachmentSites(answer));
    // Whether the reader asked for this drawing is one fact read at two moments
    // rather than two answers. Here it decides whether a notice was shown; in
    // the panel it decides whether the drawing is framed afresh or left where
    // the reader put it, because a redraw nobody asked for must not move what
    // they are reading and one they pressed for is how they get the whole
    // topology back.
    void panel.webview.postMessage({ type: 'render', release, graph, asked: !opts.quiet });
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
// builds that same Release's graph again to read the node's labels, so a
// document it could be refused over is one the drawing already reported through
// the render's own path; publishing the refusal a second time from here would
// report one fault twice, and a refusal naming no document — an id the rebuilt
// graph no longer carries, a lockfile gone since the drawing — has no document
// to be put on at all.
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
  release: string,
  requestId: number,
): Promise<void> {
  try {
    const result = await deps.requestAttachCandidates(attachCandidatesRequest(nodeId, release));
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

// attachFeature commits the Feature the reader chose onto the node they
// selected, by editing the Aggregate that declares it.
//
// # THE COMPILER SAYS WHERE; THIS SIDE WRITES
//
// The requests that follow are read-only and report places. Everything that
// touches the document happens here, through the editor's own edit machinery,
// and that routing is the requirement rather than a convenience: an edit
// applied through the document model joins the undo history, lands on the
// buffer the reader is looking at rather than on the last bytes written to
// disk, and leaves every comment and every formatting choice around it as its
// author wrote them. Writing the file directly would contest all three with the
// editor that owns them.
//
// # NOTHING IS SAVED HERE, AND NOTHING IS RE-VALIDATED HERE EITHER
//
// The edit lands in the buffer, which is a document change like any other: the
// language server is told and it validates, so the attachment is reported on
// like anything else the reader types. Saving on the reader's behalf would take
// a decision that is theirs, and re-validating from here would be a second
// trigger for something the ordinary edit path already does.
//
// 🔴 SO THE PANEL DOES NOT REDRAW UNTIL THE READER SAVES, and that follows from
// the line above rather than being a separate rule. A graph is built from the
// documents as they stand on disk, so an attachment sitting unsaved in a buffer
// is not yet part of any graph the compiler would build — redrawing on it would
// show a topology no build produces. The save is what puts it there, and the
// drawing follows the save.
//
// # TWO QUESTIONS, AND NEITHER ANSWER IS COMPOSED HERE
//
// The first asks which document the attachment belongs in and the path to the
// container inside it, addressed by the node id the drawn graph carries and the
// Release that graph was built from. The second asks where in that document
// such an entry goes. The first answer is handed to the second exactly as it
// arrived, segment for segment — which is what makes a component authored
// inside a subsystem commit by the same path as one authored at the top level,
// with neither depending on this side knowing how an Aggregate spells its
// nesting.
async function attachFeature(
  panel: vscode.WebviewPanel,
  deps: GraphDeps,
  site: AttachmentSite,
  featureName: string,
  release: string,
): Promise<void> {
  const named = nameAttachment(site, featureName);
  if ('refusal' in named) {
    void postAttachOutcome(panel, site.nodeId, named.refusal, false);
    return;
  }

  const root = deps.getWorkspaceRoot();
  if (root === null) {
    void postAttachOutcome(panel, site.nodeId, NO_ANCHORED_WORKSPACE_MESSAGE, false);
    return;
  }

  try {
    const located = readAttachmentContainer(
      await deps.requestAttachmentContainer(attachmentContainerRequest(site, release)),
    );
    if (located === null) {
      void postAttachOutcome(panel, site.nodeId, attachRefusal(
        'the compiler\'s answer about which document this belongs in is in a shape this cannot '
        + 'apply.'), false);
      return;
    }

    // The document and the container path both come from that answer, and both
    // are passed on untouched. Reading either one back into parts is the guess
    // this request exists to remove.
    // A node whose attachment container is the document root names no path, and
    // an empty path reaches the wire as null.
    const answer = await deps.requestInsertionPoint(located.file, located.container ?? []);
    const insertion = readInsertion(answer);
    if (insertion === null) {
      void postAttachOutcome(panel, site.nodeId, attachRefusal(
        'the compiler\'s answer about where in that document this belongs is in a shape this '
        + 'cannot apply.'), false);
      return;
    }
    const shapeRefusal = refusesEntryShape(insertion);
    if (shapeRefusal) {
      void postAttachOutcome(panel, site.nodeId, attachRefusal(shapeRefusal), false);
      return;
    }
    // The answer names the document workspace-relative, as every other
    // per-document answer does.
    const uri = vscode.Uri.file(fromWorkspaceRelative(root, insertion.file));
    const doc = await vscode.workspace.openTextDocument(uri);

    // The units the reported offset is measured in are read off the answer,
    // which states them. An encoding this side cannot convert from refuses
    // rather than falls back: a position applied in the wrong units lands on
    // the wrong column of the right line, which is an edit nobody asked for
    // rather than an error anybody sees.
    const at = insertionPositionInDocument(doc.getText(), insertion);
    if (at === null) {
      void postAttachOutcome(panel, site.nodeId, attachRefusal(
        `the position is reported in ${insertion.positionEncoding || 'unstated'} units, which `
        + 'this cannot convert from.'), false);
      return;
    }

    const text = composeInsertionText(
      insertion,
      attachmentEntryLines(named.instanceName, featureName, insertion.indentStep),
    );

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(at.line, at.character), text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void postAttachOutcome(panel, site.nodeId, 'The editor did not apply the edit.', false);
      return;
    }

    // Shown so the change is in front of the reader rather than in a file they
    // have to go and find. It is the same document the edit landed in.
    await vscode.window.showTextDocument(doc, { preview: false });

    // Whether the nesting step was measured from this document or stood in for
    // by a default is reported rather than smoothed over. A document with no
    // nesting of its own supplies nothing to match, and a reader whose file
    // uses a different width is owed the reason the new lines do not match it.
    const note = insertion.indentStepMeasured
      ? ''
      : ' The document exhibits no nesting to measure, so a default indentation was used.';
    deps.output.appendLine(
      `attached ${featureName} to ${site.nodeId} as ${named.instanceName} in ${insertion.file}`,
    );
    void postAttachOutcome(panel, site.nodeId,
      `Attached ${featureName} to ${site.nodeId} as ${named.instanceName}.${note}`, true);
  } catch (err) {
    deps.output.appendLine(
      `attaching ${featureName} to ${site.nodeId} failed: ${describeError(err)}`,
    );
    void postAttachOutcome(panel, site.nodeId, attachFailureLine(err), false);
  }
}

// postAttachOutcome tells the panel what became of the reader's click.
//
// It is reported into the panel the click came from rather than onto the
// document, for the reason a candidate refusal is: what failed is a request
// about a place in a file, and nothing it can be refused for is a fault of the
// file the reader would be sent to.
function postAttachOutcome(
  panel: vscode.WebviewPanel,
  nodeId: string,
  message: string,
  attached: boolean,
): Thenable<boolean> {
  return panel.webview.postMessage({ type: 'attachOutcome', nodeId, message, attached });
}

// openSource opens the node's authoring file. The IR carries workspace-relative
// paths, so the click resolves against the anchored root.
async function openSource(workspaceRoot: string, sourceFile: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(fromWorkspaceRelative(workspaceRoot, sourceFile)),
    );
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
