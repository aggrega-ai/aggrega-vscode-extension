// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import {
  CatalogIndexDoc,
  WorkspaceCatalogNode,
  workspaceCatalogNodes,
} from './workspace-catalog-run';
import { RendersOnReady } from './readiness';

// KIND_GROUP_ICON is the theme-icon id on a kind heading. The heading also
// carries the kind's name and its count in the label, so no fact lives only in
// an icon.
const KIND_GROUP_ICON = 'symbol-class';

// OPEN_COMMAND_TITLE names the action a row performs when it is clicked. The
// editor requires a title on a command binding; a tree row renders none, so
// this reaches a reader only through the editor's own command surfaces.
const OPEN_COMMAND_TITLE = 'Open the entity file';

// WorkspaceCatalogDeps supplies the live state the workspace-catalog tree
// needs: the anchored root the reported paths resolve against, whether the
// language server is running, the request itself, and the shared output channel
// that carries failure detail.
export interface WorkspaceCatalogDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  isLanguageServerRunning(): boolean;
  requestCatalogIndex(): Promise<CatalogIndexDoc>;
  output: vscode.OutputChannel;
}

// WorkspaceCatalogTreeProvider renders the open workspace's entities, grouped
// by kind, in the Aggrega activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// workspaceCatalogNodes, which depends on no editor type and is therefore
// directly testable.
//
// Each expansion of the root re-asks the server, so a refresh is a change
// event. That costs nothing over the network: the index is derived from the
// workspace the server already reads, and reaches no registry.
class WorkspaceCatalogTreeProvider implements vscode.TreeDataProvider<WorkspaceCatalogNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: WorkspaceCatalogDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: WorkspaceCatalogNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.detail) {
        item.tooltip = node.detail;
      }
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${node.rows.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(KIND_GROUP_ICON);
      return item;
    }
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.row.description;
    item.tooltip = node.row.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.row.icon);
    // The path is already resolved against the workspace root by the shaping
    // layer, so the click carries a location rather than a lookup. resourceUri
    // is set alongside the command so the editor's own file actions — reveal,
    // copy path — apply to the row the reader is pointing at.
    const uri = vscode.Uri.file(node.row.openPath);
    item.resourceUri = uri;
    item.command = {
      command: 'vscode.open',
      title: OPEN_COMMAND_TITLE,
      arguments: [uri],
    };
    return item;
  }

  async getChildren(node?: WorkspaceCatalogNode): Promise<WorkspaceCatalogNode[]> {
    if (node) {
      return node.kind === 'group'
        ? node.rows.map((row) => ({ kind: 'entry' as const, row }))
        : [];
    }
    return workspaceCatalogNodes({
      getWorkspaceRoot: this.deps.getWorkspaceRoot,
      isLanguageServerRunning: this.deps.isLanguageServerRunning,
      requestCatalogIndex: this.deps.requestCatalogIndex,
      log: { appendLine: (text) => this.deps.output.appendLine(text) },
    });
  }
}

// activateWorkspaceCatalogView registers the workspace-catalog tree and its
// refresh command. View and command ids mirror package.json.
export function activateWorkspaceCatalogView(
  context: vscode.ExtensionContext,
  deps: WorkspaceCatalogDeps,
): void {
  const catalog = new WorkspaceCatalogTreeProvider(deps);
  // The tree is registered before the workspace root is resolved and before the
  // server can answer, so its first render honestly reports one of those two
  // states. Re-asking when the compiler becomes answerable is what supersedes
  // that row without the reader doing anything; the refresh command stays an
  // override a reader may press, rather than the way to obtain correct data the
  // first time.
  deps.onReady(() => catalog.refresh());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.workspaceCatalog', catalog),
    vscode.commands.registerCommand('aggrega.workspaceCatalog.refresh', () => catalog.refresh()),
  );
}
