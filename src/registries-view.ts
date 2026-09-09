// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { CliOperationDeps, reportOutcome, runWatchableCli } from './cli-operation';
import {
  CONFIG_WRITE_DESTINATIONS,
  ConfigWriteDestination,
} from './config-write-scope';
import {
  CREDENTIAL_REMOVAL_SUBJECT,
  REGISTRATION_DESTINATION_PROMPT,
  REGISTRATION_SUBJECT,
  REGISTRY_REMOVAL_SUBJECT,
  REMOVAL_DESTINATION_PROMPT,
  RegistryConfigureDeps,
  removalConsentDetail,
  runLogout,
  runRegistryAdd,
  runRegistryRemove,
} from './registry-configure';
import {
  REGISTRY_ROW_CONTEXT,
  RegistryListDoc,
  RegistryNode,
  registryNodes,
  registrySubject,
  registryUpdateAllArgs,
  registryUpdateOneArgs,
} from './registries-run';
import { RendersOnReady } from './readiness';

// RegistriesDeps supplies the live state the registries tree needs: the
// anchored workspace root (it is what selects the configuration the reader is
// actually working against), the requests that enumerate and change the
// registries, and the shared output channel that carries failure detail.
//
// The binary path arrives through CliOperationDeps and is still needed, for one
// operation rather than for the row operations generally: the index refresh is
// the one registry operation that reaches the registries themselves, and it is
// run as a command because that run can be stopped.
export interface RegistriesDeps
  extends RendersOnReady, CliOperationDeps, RegistryConfigureDeps {
  getWorkspaceRoot(): string | null;
  runRegistryList(): Promise<RegistryListDoc>;
  output: vscode.OutputChannel;
}

// askWriteDestination asks which configuration file a write should land in, or
// reports null when the reader chose nothing.
//
// The choices arrive in the order the one home for them offers, so the global
// file is the highlighted entry a reader takes by pressing nothing — which is how
// "the default is unchanged" is expressed to somebody who does not want to
// choose. A dismissed prompt invokes nothing, exactly as the prompt asking for a
// host does: dismissing is not an answer, and reading it as the default would
// perform a write the reader backed out of.
async function askWriteDestination(prompt: string): Promise<ConfigWriteDestination | null> {
  const chosen = await vscode.window.showQuickPick(
    CONFIG_WRITE_DESTINATIONS.map((destination) => ({
      label: destination.label,
      destination: destination.value,
    })),
    { placeHolder: prompt },
  );
  return chosen ? chosen.destination : null;
}

// RegistriesTreeProvider renders the configured registries in the Aggrega
// activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// registryNodes, which depends on no editor type and is therefore directly
// testable.
//
// Each expansion of the root asks again, so a refresh is a change event. That
// costs nothing over the network: the enumeration reads the resolved
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
      runRegistryList: () => this.deps.runRegistryList(),
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
    // host is asked for. Dismissing either prompt invokes nothing.
    //
    // The destination is asked for because the compiler accepts either file for
    // this operation and defaults to the global one. Asking is what makes that
    // default a choice the reader made rather than one this surface took on their
    // behalf, and the ending then names the file the write actually landed in.
    //
    // No progress indicator and no cancel button, and that follows from what the
    // operation is rather than from its being quick. The shared operation behind
    // the request is reached with no cancellation, so a stop here could only stop
    // this side waiting — and reporting that as a stop would tell a reader the
    // compiler stopped when it did not.
    vscode.commands.registerCommand('aggrega.registries.add', async () => {
      const host = await vscode.window.showInputBox({
        title: 'Aggrega: add a registry',
        prompt: 'Host of the registry to register, such as registry.example.com',
        ignoreFocusOut: true,
      });
      if (!host) { return; }
      const destination = await askWriteDestination(REGISTRATION_DESTINATION_PROMPT);
      if (!destination) { return; }
      const outcome = await runRegistryAdd(deps, host, destination);
      // The listing is re-read whatever the ending was. A registration that was
      // refused may still have changed what the workspace resolves, because the
      // work is the compiler's and it is not this surface's to say how far it
      // got.
      registries.refresh();
      await reportOutcome(deps, REGISTRATION_SUBJECT, outcome, true);
    }),

    // The index build is the one registry operation that reaches the network,
    // so it is the one that is watched and can be stopped.
    //
    // Both forms of it below — every configured registry, and one named registry
    // — are invoked as commands for that stop, and it is the same operation
    // narrowed. The refresh walks each host's repositories and writes what it
    // finds, and it is reached with no cancellation, so a reader who started a
    // walk over every registry can end it here and could not over the language
    // server.
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
    // each confirmation names what the change reaches. That is not guessable from
    // the entry's label, so it is put in front of the reader before anything
    // happens rather than explained afterwards.
    //
    // 🔴 THE REMOVAL ASKS WHICH FILE BEFORE IT ASKS FOR CONSENT, and the order is
    // load-bearing rather than incidental. The confirmation states which projects
    // the removal affects, and that sentence is only true of one of the two
    // files — so consent taken before the destination is known would be consent
    // to something else. The ending then names the file the compiler actually
    // wrote, which is the same fact measured instead of predicted.
    vscode.commands.registerCommand(
      'aggrega.registries.remove',
      (node?: RegistryNode) => runOnRow(node, async (host) => {
        const destination = await askWriteDestination(REMOVAL_DESTINATION_PROMPT);
        if (!destination) { return; }
        const consented = await vscode.window.showWarningMessage(
          `Remove the registry ${host} and its trust policy?`,
          { modal: true, detail: removalConsentDetail(destination) },
          'Remove',
        );
        if (consented !== 'Remove') { return; }
        const outcome = await runRegistryRemove(deps, host, destination);
        registries.refresh();
        await reportOutcome(deps, REGISTRY_REMOVAL_SUBJECT, outcome, true);
      }),
    ),

    // The credential removal is offered no choice of destination, and the absence
    // is the compiler's rather than this surface's: the credential store is
    // shared by every project on the machine and has no project-scoped form to
    // resolve to, so there is nothing to choose between. What the reader is told
    // instead is how far the store reaches, before they consent.
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
        const outcome = await runLogout(deps, host);
        registries.refresh();
        await reportOutcome(deps, CREDENTIAL_REMOVAL_SUBJECT, outcome, true);
      }),
    ),
  );
}
