// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { reportOutcome } from './cli-operation';
import {
  CONFIG_WRITE_DESTINATIONS,
  ConfigWriteDestination,
} from './config-write-scope';
import {
  INDEX_BUILD_SUBJECT,
  RegistryIndexDeps,
  indexBuildOpeningLine,
  runIndexBuild,
} from './registry-index-request';
import {
  CREDENTIAL_REMOVAL_SUBJECT,
  IDENTITY_PLACEHOLDER,
  IDENTITY_PROMPT_FIRST,
  IDENTITY_PROMPT_NEXT,
  KEY_DIALOG_BUTTON,
  REGISTRATION_DESTINATION_PROMPT,
  REGISTRATION_SUBJECT,
  REGISTRY_ADD_COMMAND,
  REGISTRY_REMOVAL_SUBJECT,
  REMOVAL_DESTINATION_PROMPT,
  RegistryConfigureDeps,
  TRUST_BY_HAND_CHOICES,
  TRUST_BY_HAND_PLACEHOLDER,
  TrustByHand,
  identityPromptTitle,
  keyDialogTitle,
  pinsAnything,
  removalConsentDetail,
  runLogout,
  runRegistryAdd,
  runRegistryAddWithTrust,
  runRegistryRemove,
  trustByHandTitle,
} from './registry-configure';
import {
  REGISTRY_ROW_CONTEXT,
  RegistryListDoc,
  registrySubject,
} from './registries-run';
import { panelActionItem } from './panel-action-item';
import { RegistriesPanelNode, registriesPanelNodes } from './panel-actions';
import { RendersOnReady } from './readiness';
import { withCancellableProgress } from './progress';

// RegistriesDeps supplies the live state the registries tree needs: the
// anchored workspace root (it is what selects the configuration the reader is
// actually working against), the requests that enumerate, change and re-index
// the registries, and the shared output channel that carries the detail.
//
// 🔴 IT DECLARES NO BINARY PATH, AND THE ABSENCE IS THE POINT RATHER THAN AN
// OVERSIGHT. Every operation on this surface is a request on the language
// server, the index build included, so there is no process for this surface to
// start and nothing for a path to be used by. A declared getter would be a
// capability this surface does not reach, and the next entry written here would
// have one to hand.
export interface RegistriesDeps
  extends RendersOnReady, RegistryConfigureDeps, RegistryIndexDeps {
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

// askTrustByHand asks the reader for a trust policy to pin by hand, or reports
// null when they dismissed a prompt.
//
// It asks for exactly what the command line takes where a registry advertises no
// policy: keyless identities, as many as the reader types, and a public-key file.
// It asks first which of the two the reader wants, so a reader who wants one is
// not walked through the other. The identities are asked for one at a time and
// each is kept exactly as typed; an empty answer ends the list. Dismissing any
// prompt pins nothing at all, rather than whatever was typed before it: backing
// out is not an answer.
async function askTrustByHand(host: string): Promise<TrustByHand | null> {
  const chosen = await vscode.window.showQuickPick(
    TRUST_BY_HAND_CHOICES.map((choice) => ({
      label: choice.label,
      description: choice.description,
      choice,
    })),
    { title: trustByHandTitle(host), placeHolder: TRUST_BY_HAND_PLACEHOLDER, ignoreFocusOut: true },
  );
  if (!chosen) { return null; }
  const identities: string[] = [];
  if (chosen.choice.identities) {
    for (;;) {
      const typed = await vscode.window.showInputBox({
        title: identityPromptTitle(host),
        prompt: identities.length === 0 ? IDENTITY_PROMPT_FIRST : IDENTITY_PROMPT_NEXT,
        placeHolder: IDENTITY_PLACEHOLDER,
        ignoreFocusOut: true,
      });
      if (typed === undefined) { return null; }
      if (typed === '') { break; }
      identities.push(typed);
    }
  }
  let keyPath: string | null = null;
  if (chosen.choice.key) {
    const picked = await vscode.window.showOpenDialog({
      title: keyDialogTitle(host),
      openLabel: KEY_DIALOG_BUTTON,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
    });
    if (!picked || picked.length === 0) { return null; }
    keyPath = picked[0].fsPath;
  }
  return { identities, keyPath };
}

// RegistriesTreeProvider renders the configured registries in the Aggrega
// activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// registriesPanelNodes, which depends on no editor type and is therefore
// directly testable. The root opens with the operations acting on the whole set
// — adding a registry and updating every registry's index — and then lists the
// registries.
//
// Each expansion of the root asks again, so a refresh is a change event. That
// costs nothing over the network: the enumeration reads the resolved
// configuration and never contacts a registry.
class RegistriesTreeProvider implements vscode.TreeDataProvider<RegistriesPanelNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: RegistriesDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: RegistriesPanelNode): vscode.TreeItem {
    if (node.kind === 'action') {
      return panelActionItem(node.row);
    }
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
    // bound to. The operations at the head and the message rows above name
    // none, so they are left without it and the operations do not appear on
    // them at all.
    item.contextValue = REGISTRY_ROW_CONTEXT;
    return item;
  }

  async getChildren(node?: RegistriesPanelNode): Promise<RegistriesPanelNode[]> {
    // Every node is a leaf: the listing is flat, in the order the product
    // emitted, so there is nothing to expand.
    if (node) {
      return [];
    }
    return registriesPanelNodes({
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
  node: RegistriesPanelNode | undefined,
  act: (host: string) => Promise<void>,
): Promise<void> {
  const host = node && node.kind !== 'action' ? registrySubject(node) : null;
  if (!host) {
    return;
  }
  await act(host);
}

// buildIndex runs an index build at the scope the reader pressed and reports how
// it ended.
//
// It is one function for both entries because they are one operation: the scope
// travels as a request field and nothing else about the run differs, so a second
// function would be a second place for the presentation to drift. The channel is
// revealed before the request goes out, so the run's account and its ending are in
// front of a reader who pressed a button that reaches out to a registry.
//
// registry is absent for every configured registry and a host for one row.
async function buildIndex(deps: RegistriesDeps, registry?: string): Promise<void> {
  const out = deps.output;
  out.show(true);
  out.appendLine(indexBuildOpeningLine(registry));

  const title = registry
    ? `Aggrega: updating the searchable index for ${registry}`
    : 'Aggrega: updating the searchable index';
  const report = await withCancellableProgress(
    title,
    (signal) => runIndexBuild(deps, registry, signal),
  );
  for (const line of report.lines) {
    out.appendLine(line);
  }
  await reportOutcome(deps, INDEX_BUILD_SUBJECT, report.outcome, true);
}

// activateRegistriesView registers the registries tree and the operations that
// act on it: the ones acting on the whole set, drawn at the head of its list,
// and the row-scoped ones on a registry row. View and command ids mirror
// package.json.
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
    //
    // 🔴 WHERE THE REGISTRY ADVERTISES NO TRUST POLICY, THE READER IS ASKED FOR ONE
    // TO PIN BY HAND — AFTER THE ENDING, NEVER BEFORE THE REQUEST. That is the one
    // case in which the command line takes identities or a key, and the same case
    // met offline, where a registry other than the official hub is refused for want
    // of one. The ending is put in front of the reader first, so the question
    // follows the sentence saying why it is asked; it is not waited on, because a
    // refusal's notification stays until the reader answers it. What the reader
    // supplies is sent as a second registration of the same host at the same
    // destination, whose own ending follows; declining sends nothing more, so what
    // stands is what the command line leaves when given neither.
    vscode.commands.registerCommand(REGISTRY_ADD_COMMAND, async () => {
      const host = await vscode.window.showInputBox({
        title: 'Aggrega: add a registry',
        prompt: 'Host of the registry to register, such as hub.aggrega.ai',
        ignoreFocusOut: true,
      });
      if (!host) { return; }
      const destination = await askWriteDestination(REGISTRATION_DESTINATION_PROMPT);
      if (!destination) { return; }
      const first = await runRegistryAdd(deps, host, destination);
      // The listing is re-read whatever the ending was. A registration that was
      // refused may still have changed what the workspace resolves, because the
      // work is the compiler's and it is not this surface's to say how far it
      // got.
      registries.refresh();
      const reported = reportOutcome(deps, REGISTRATION_SUBJECT, first.outcome, true);
      if (!first.asksForTrust) {
        await reported;
        return;
      }
      const byHand = await askTrustByHand(first.host);
      if (!pinsAnything(byHand)) {
        await reported;
        return;
      }
      const second = await runRegistryAddWithTrust(deps, host, destination, byHand);
      registries.refresh();
      await Promise.all([reported, reportOutcome(deps, REGISTRATION_SUBJECT, second, true)]);
    }),

    // The index build is the one registry operation that reaches the network,
    // and it is the one that is watched and can be stopped. Both entries below
    // are the same operation narrowed by its scope parameter — every configured
    // registry, and one named registry — so they differ by that one value and
    // share every word after it.
    //
    // The stop reaches the walk: the request's own context is observed ahead of
    // each registry's walk and of its write, and carried into every network call,
    // so a reader who started a walk over every registry can end it. What a stop
    // leaves behind is a partial index rather than none, because each registry's
    // records are written only once its own walk finishes, and the registry being
    // walked keeps the index it had. A walk that ends with some registries not
    // indexed names them and how many were, rather than reporting all-or-nothing.
    vscode.commands.registerCommand('aggrega.registries.update', () => buildIndex(deps)),

    vscode.commands.registerCommand(
      'aggrega.registries.updateOne',
      (node?: RegistriesPanelNode) => runOnRow(node, (host) => buildIndex(deps, host)),
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
      (node?: RegistriesPanelNode) => runOnRow(node, async (host) => {
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
      (node?: RegistriesPanelNode) => runOnRow(node, async (host) => {
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
