// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { CliOperationDeps, runCli, runWatchableCli } from './cli-operation';
import { runCliJson } from './cli-json';
import {
  REGISTRY_ROW_CONTEXT,
  RegistryListDoc,
  RegistryNode,
  registryAddArgs,
  registryLogoutArgs,
  registryNodes,
  registryRemoveArgs,
  registrySubject,
  registryUpdateAllArgs,
  registryUpdateOneArgs,
} from './registries-run';
import { RendersOnReady } from './readiness';

// RegistriesDeps supplies the live state the registries tree needs: the
// anchored workspace root (the command runs there, and it is what selects the
// configuration the reader is actually working against), the configured binary
// path, and the shared output channel that carries failure detail.
export interface RegistriesDeps extends RendersOnReady, CliOperationDeps {
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
    // Only a row naming a registry carries the value the row operations are
    // bound to. The message rows above name none, so they are left without it
    // and the operations do not appear on them at all.
    item.contextValue = REGISTRY_ROW_CONTEXT;
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

// runOnRow invokes a row-scoped operation against the registry the pressed row
// names.
//
// The subject is read through the one extractor rather than off the row's
// label, and a row that names no registry produces nothing: the handler returns
// having invoked nothing. The manifest already keeps these entries off the
// message rows and out of the command palette, so this is the second of two
// guards rather than the only one — and it is the one that holds if a later
// binding is written more loosely than the ones here.
async function runOnRow(
  node: RegistryNode | undefined,
  act: (host: string) => Promise<void>,
): Promise<void> {
  const host = node ? registrySubject(node) : null;
  if (!host) {
    return;
  }
  await act(host);
}

// activateRegistriesView registers the registries tree and the operations that
// act on it: the panel-scoped ones in its title bar, the row-scoped ones on a
// registry row. View and command ids mirror package.json.
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

    // Registering a registry is the one operation here that takes a subject the
    // panel cannot supply: it names a registry that does not exist yet, so the
    // host is asked for. Dismissing the prompt invokes nothing.
    vscode.commands.registerCommand('aggrega.registries.add', async () => {
      const host = await vscode.window.showInputBox({
        title: 'Aggrega: add a registry',
        prompt: 'Host of the registry to register, such as registry.example.com',
        ignoreFocusOut: true,
      });
      if (!host) { return; }
      await runCli(deps, 'The registration', registryAddArgs(host), {
        detail: `added ${host}.`,
      });
      registries.refresh();
    }),

    // The index build is the one registry operation that reaches the network,
    // so it is the one that is watched and can be stopped.
    vscode.commands.registerCommand('aggrega.registries.update', async () => {
      await runWatchableCli(
        deps,
        'Aggrega: updating the searchable index',
        'The index build',
        registryUpdateAllArgs(),
        'refreshed the searchable index of every configured registry.',
      );
    }),

    vscode.commands.registerCommand(
      'aggrega.registries.updateOne',
      (node?: RegistryNode) => runOnRow(node, (host) =>
        runWatchableCli(
          deps,
          `Aggrega: updating the searchable index for ${host}`,
          'The index build',
          registryUpdateOneArgs(host),
          `refreshed the searchable index for ${host}.`,
        )),
    ),

    // Removing a registry and removing its credential both confirm first, and
    // each confirmation names what the change reaches. A registry entry is
    // written to the config shared across every workspace, so dropping one
    // changes what every project on this machine resolves through — that is not
    // guessable from the entry's label, so it is put in front of the reader
    // before anything happens rather than explained afterwards.
    vscode.commands.registerCommand(
      'aggrega.registries.remove',
      (node?: RegistryNode) => runOnRow(node, async (host) => {
        const consented = await vscode.window.showWarningMessage(
          `Remove the registry ${host} and its trust policy?`,
          {
            modal: true,
            detail: 'The entry is removed from the config shared across every workspace on this '
              + 'machine, so every project resolving through it is affected. Which registry is '
              + 'the default is left unchanged.',
          },
          'Remove',
        );
        if (consented !== 'Remove') { return; }
        await runCli(deps, 'The removal', registryRemoveArgs(host), {
          detail: `dropped ${host}.`,
        });
        registries.refresh();
      }),
    ),

    vscode.commands.registerCommand(
      'aggrega.registries.logout',
      (node?: RegistryNode) => runOnRow(node, async (host) => {
        const consented = await vscode.window.showWarningMessage(
          `Remove the stored credential for ${host}?`,
          {
            modal: true,
            detail: 'The credential is deleted from the shared credential store, which every '
              + 'command reading it uses. The registry entry itself is left in place.',
          },
          'Remove',
        );
        if (consented !== 'Remove') { return; }
        await runCli(deps, 'The credential removal', registryLogoutArgs(host), {
          detail: `removed the stored credential for ${host}.`,
        });
        registries.refresh();
      }),
    ),
  );
}
