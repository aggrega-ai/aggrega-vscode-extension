// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { runCliJson } from './cli-json';
import { RegistryListDoc, RegistryNode, registryNodes } from './registries-run';
import { RendersOnReady } from './readiness';

// RegistriesDeps supplies the live state the registries tree needs: the
// anchored workspace root (the command runs there, and it is what selects the
// configuration the reader is actually working against), the configured binary
// path, and the shared output channel that carries failure detail.
export interface RegistriesDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
}

// RegistriesTreeProvider renders the configured registries in the Aggrega
// activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// registryNodes, which depends on no editor type and is therefore directly
// testable.
//
// Each expansion of the root re-runs the command, so a refresh is a change
// event. That costs nothing over the network: the command reads the resolved
// configuration and never contacts a registry.
class RegistriesTreeProvider implements vscode.TreeDataProvider<RegistryNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: RegistriesDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: RegistryNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.detail) {
        item.tooltip = node.detail;
      }
      return item;
    }
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.row.description;
    item.tooltip = node.row.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.row.icon);
    return item;
  }

  async getChildren(node?: RegistryNode): Promise<RegistryNode[]> {
    // Every node is a leaf: the listing is flat, in the order the product
    // emitted, so there is nothing to expand.
    if (node) {
      return [];
    }
    return registryNodes({
      getWorkspaceRoot: this.deps.getWorkspaceRoot,
      runRegistryListJson: () =>
        runCliJson<RegistryListDoc>(this.deps, ['registry', 'list', '-o', 'json']),
      log: { appendLine: (text) => this.deps.output.appendLine(text) },
    });
  }
}

// activateRegistriesView registers the registries tree and its refresh command.
// View and command ids mirror package.json.
export function activateRegistriesView(
  context: vscode.ExtensionContext,
  deps: RegistriesDeps,
): void {
  const registries = new RegistriesTreeProvider(deps);
  // The tree is registered before the workspace root is known, so its first
  // render reports honestly that there is no anchored workspace. Re-asking when
  // the compiler becomes answerable is what supersedes that row without the
  // reader doing anything; the refresh command stays an override a reader may
  // press, rather than the way to obtain correct data the first time.
  deps.onReady(() => registries.refresh());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.registries', registries),
    vscode.commands.registerCommand('aggrega.registries.refresh', () => registries.refresh()),
  );
}
