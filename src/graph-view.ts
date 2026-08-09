// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import * as vscode from 'vscode';
import { resolveRelease } from './release-pick';
import { toWorkspaceRelative } from './workspace';

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

// activateGraphView registers the topology-graph command. A single panel is
// reused across invocations so re-running the command refreshes the existing
// view rather than stacking panels.
export function activateGraphView(context: vscode.ExtensionContext, deps: GraphDeps): void {
  let panel: vscode.WebviewPanel | null = null;

  context.subscriptions.push(
    vscode.commands.registerCommand('aggrega.graph.show', async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage(
          'Aggrega: no anchored workspace. Open a folder containing a Release file first.',
        );
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
        panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
        panel.webview.onDidReceiveMessage(
          (msg: { type: string; sourceFile?: string }) => {
            if (msg.type === 'openSource' && msg.sourceFile) {
              void openSource(root, msg.sourceFile);
            }
          },
          null,
          context.subscriptions,
        );
        panel.webview.html = graphHtml(panel.webview, context.extensionUri);
      } else {
        panel.reveal(vscode.ViewColumn.Active);
      }

      panel.title = `Aggrega Graph — ${release}`;
      await renderGraph(panel, deps, release);
    }),
  );
}

// renderGraph requests the IR graph and posts it to the webview, surfacing any
// request failure both in the panel and the output channel.
async function renderGraph(panel: vscode.WebviewPanel, deps: GraphDeps, release: string): Promise<void> {
  void panel.webview.postMessage({ type: 'loading', release });
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
// nonce'd inline bootstrap plus the two local scripts (elk bundle + the graph
// renderer), served through webview-scoped URIs.
function graphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const elkUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', 'elkjs', 'lib', 'elk.bundled.js'),
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
