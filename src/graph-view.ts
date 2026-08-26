// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import * as vscode from 'vscode';
import { makeGraphMessageHandler } from './graph-messages';
import { resolveRelease } from './release-pick';
import { NO_ANCHORED_WORKSPACE_MESSAGE, toWorkspaceRelative } from './workspace';

// GraphDeps supplies the live state the graph view needs without importing
// extension.ts (which would form an import cycle): the anchored workspace root
// (source-file clicks resolve against it), the Release enumeration and the
// irGraph request (both daemon-backed), and the shared output channel.
export interface GraphDeps {
  getWorkspaceRoot(): string | null;
  listReleases(): Promise<string[]>;
  // requestIrGraph returns the serialized IRGraph object (the daemon's
  // irGraph result `graph` field) for the given workspace-relative Release.
  requestIrGraph(release: string): Promise<unknown>;
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

      const picked = await resolveRelease(deps.listReleases, {
        placeHolder: 'Aggrega: choose a Release to graph',
      });
      if (!picked) { return; }
      // The Release enumeration reports absolute paths and the irGraph request
      // takes a workspace-relative one. Convert here, at the point the value
      // enters this surface, so every later use — the request, the panel title,
      // the log lines — carries the one form the daemon accepts.
      const release = toWorkspaceRelative(root, picked);

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
      await renderGraph(panel, deps, release);
    }),
  );

  return {
    // refresh re-renders the Release the panel is already showing. It does
    // nothing when no panel is open or none has been chosen yet: the graph is
    // a view the user opens deliberately, so nothing here opens one on its own
    // or asks the language server for a graph nobody is looking at.
    refresh: (): void => {
      if (!panel || !shownRelease) { return; }
      // Quiet: the panel keeps showing the graph it has until the new one
      // replaces it, rather than flashing a layout notice on every recompile.
      void renderGraph(panel, deps, shownRelease, { quiet: true });
    },
  };
}

// renderGraph requests the IR graph and posts it to the webview, surfacing any
// request failure both in the panel and the output channel. A quiet render
// skips the "laying out" notice, for a re-render the user did not ask for.
async function renderGraph(
  panel: vscode.WebviewPanel,
  deps: GraphDeps,
  release: string,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  if (!opts.quiet) {
    void panel.webview.postMessage({ type: 'loading', release });
  }
  try {
    const graph = await deps.requestIrGraph(release);
    void panel.webview.postMessage({ type: 'render', release, graph });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.output.appendLine(`irGraph failed for ${release}: ${message}`);
    void panel.webview.postMessage({ type: 'error', release, message });
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
// nonce'd inline bootstrap plus the three local scripts (elk bundle + the
// layout model + the graph renderer), served through webview-scoped URIs.
function graphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const elkUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', 'elkjs', 'lib', 'elk.bundled.js'),
  );
  const modelUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'graph-model.js'),
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
  <script nonce="${nonce}" src="${elkUri}"></script>
  <script nonce="${nonce}" src="${modelUri}"></script>
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
