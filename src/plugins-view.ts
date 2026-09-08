// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { CliOperationDeps, reportOutcome, runCli, runWatchableCli } from './cli-operation';
import { runCliJson } from './cli-json';
import {
  PluginRemovalDeps,
  REMOVAL_SUBJECT,
  runPluginRemoval,
} from './plugin-removal';
import {
  ATTACHABLE_PLUGIN_TYPES,
  GEN_CATALOG_SCOPES,
  GOVERNANCE_ROLES,
  GenCatalogSelection,
  PLUGIN_TYPE_GOVERNANCE,
  PLUGIN_TYPE_PROVIDER,
  PluginListDoc,
  PluginNode,
  PluginRemovalSubject,
  genCatalogScope,
  pluginAddArgs,
  pluginGenCatalogArgs,
  pluginNodes,
  pluginRemovalConfigTarget,
  pluginRemovalSubject,
  pluginRowContext,
} from './plugins-run';
import { menuAnswer } from './operation-menus';
import { RendersOnReady } from './readiness';

// PluginsDeps supplies the live state this panel needs: the anchored workspace
// root the commands run in, the configured binary path, the shared output channel
// that carries the compiler's own report, and the way to ask the language server
// to remove a configured plugin.
//
// The invocation surface stays, because the operations that remain command-backed
// need it — so this is that surface plus the readiness signal plus the one request
// this panel sends, rather than a fourth declaration of the same members.
export type PluginsDeps = RendersOnReady & CliOperationDeps & PluginRemovalDeps;

// PluginsTreeProvider renders the plugins the compiler can see as a two-group
// tree in the Aggrega activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps
// already-shaped nodes onto tree items and delegates every decision to
// plugins-run, which depends on no editor type and is therefore directly
// testable. Each expansion of the root re-runs the command, so a refresh is a
// change event.
class PluginsTreeProvider implements vscode.TreeDataProvider<PluginNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: PluginsDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: PluginNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.detail) {
        item.tooltip = node.detail;
      }
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${node.entries.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('extensions');
      return item;
    }
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.row.description;
    item.tooltip = node.row.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.row.icon);
    // Which value a plugin row carries is decided in one place, and the group
    // headings and message rows above are already past. So a row that names no
    // addressable configuration entry carries the value the removal is not bound
    // to, and the removal does not appear on it at all.
    item.contextValue = pluginRowContext(node) ?? undefined;
    return item;
  }

  async getChildren(node?: PluginNode): Promise<PluginNode[]> {
    if (node) {
      // A group's plugins are shaped with the group they belong to, so expanding
      // one hands the tree the nodes the model built rather than nodes assembled
      // here from rows whose group would already have been dropped.
      return node.kind === 'group' ? node.entries : [];
    }
    return pluginNodes({
      getWorkspaceRoot: this.deps.getWorkspaceRoot,
      runPluginListJson: () =>
        runCliJson<PluginListDoc>(this.deps, ['plugin', 'list', '-o', 'json']),
      log: { appendLine: (text) => this.deps.output.appendLine(text) },
    });
  }
}

// runOnRow invokes a row-scoped operation against the plugin the pressed row
// names.
//
// The subject is read through the one extractor rather than off the row's
// display strings, and a row that names no addressable plugin produces nothing:
// the handler returns having invoked nothing. The manifest already keeps these
// entries off the group headings, the message rows and the command palette, so
// this is the second of two guards rather than the only one — and it is the one
// that holds if a later binding is written more loosely than the ones here.
async function runOnRow(
  node: PluginNode | undefined,
  act: (subject: PluginRemovalSubject) => Promise<void>,
): Promise<void> {
  const subject = node ? pluginRemovalSubject(node) : null;
  if (!subject) {
    return;
  }
  await act(subject);
}

// askForAttachment collects the answers an attachment needs, in the order the
// command declares them, and reports null where the reader backed out.
//
// The type-conditional answer is asked immediately after the type that requires
// it, because it is decided by that type; the search term is asked last, since it
// is the answer the registry search consumes. Dismissing any one of them invokes
// nothing at all.
//
// chosenType is the answer a reader already gave on the panel, where the type is
// offered as a menu beside the control. Where it is given, the first question is
// not asked again — asking it twice would make the menu a step rather than an
// answer. Where it is absent the question is asked here, which is the path the
// command index takes: a command invoked from there carries no answer, and it has
// to work.
async function askForAttachment(chosenType?: string): Promise<
  { type: string; query: string; capability?: string; role?: string } | null
> {
  const type = chosenType ?? await vscode.window.showQuickPick([...ATTACHABLE_PLUGIN_TYPES], {
    title: 'Aggrega: add a plugin',
    placeHolder: 'Which type of plugin to add',
    ignoreFocusOut: true,
  });
  if (!type) { return null; }

  let capability: string | undefined;
  let role: string | undefined;
  if (type === PLUGIN_TYPE_PROVIDER) {
    capability = await vscode.window.showInputBox({
      title: 'Aggrega: add a provider plugin',
      prompt: 'The capability this binding serves, such as helm or terraform.',
      ignoreFocusOut: true,
    });
    if (!capability) { return null; }
  } else if (type === PLUGIN_TYPE_GOVERNANCE) {
    role = await vscode.window.showQuickPick([...GOVERNANCE_ROLES], {
      title: 'Aggrega: add a governance plugin',
      placeHolder: 'The role this attachment is bound at',
      ignoreFocusOut: true,
    });
    if (!role) { return null; }
  }

  const query = await vscode.window.showInputBox({
    title: 'Aggrega: add a plugin',
    prompt: 'Name to search the configured registry for. It must resolve to exactly one '
      + "plugin of that type. The attachment is written to this project's workspace "
      + 'configuration.',
    ignoreFocusOut: true,
  });
  if (!query) { return null; }

  return { type, query, capability, role };
}

// askForGeneration collects the selection and the two paths a catalog-generation
// run needs, and reports null where the reader backed out.
//
// Each path is chosen from the editor's own file dialog rather than typed. A
// mistyped path here would be reported by the compiler as a missing file, which
// is a correct answer to a question the reader should not have been asked in the
// first place. What the overlay dialog selects follows the selection: generating
// for every embedded guest merges a directory of overlays, one per guest, while
// generating for a single artifact merges one overlay file.
// chosenScope is the answer a reader already gave on the panel, where the scope
// is offered as a menu beside the control; absent, the question is asked here,
// which is the path a command invoked from the command index takes.
async function askForGeneration(chosenScope?: GenCatalogSelection['kind']): Promise<
  { selection: GenCatalogSelection; outputDir: string; overlayPath: string } | null
> {
  // The labels and the selection each one composes are paired in the one set
  // that declares them, so the words a reader chooses between and the selection
  // built from that choice cannot part company.
  const scope = chosenScope ?? await vscode.window.showQuickPick(
    GEN_CATALOG_SCOPES.map((entry) => ({ label: entry.label, value: entry.value })),
    {
      title: 'Aggrega: generate Plugin entities',
      placeHolder: 'Which plugins to generate an entity for',
      ignoreFocusOut: true,
    },
  ).then((picked) => picked?.value);
  if (!scope) { return null; }

  let selection: GenCatalogSelection;
  if (scope === 'embedded') {
    selection = { kind: 'embedded' };
  } else {
    const artifact = await vscode.window.showOpenDialog({
      title: 'Aggrega: the plugin artifact to generate from',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Plugin artifact': ['wasm'] },
      openLabel: 'Generate from this',
    });
    if (!artifact?.length) { return null; }
    selection = { kind: 'artifact', artifactPath: artifact[0].fsPath };
  }

  const forEmbedded = selection.kind === 'embedded';
  const overlay = await vscode.window.showOpenDialog({
    title: forEmbedded
      ? 'Aggrega: the directory holding the authored overlays'
      : 'Aggrega: the authored overlay for this plugin',
    canSelectFiles: !forEmbedded,
    canSelectFolders: forEmbedded,
    canSelectMany: false,
    openLabel: 'Merge this overlay',
  });
  if (!overlay?.length) { return null; }

  const output = await vscode.window.showOpenDialog({
    title: 'Aggrega: the directory to write the entities under',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Write here',
  });
  if (!output?.length) { return null; }

  return {
    selection,
    outputDir: output[0].fsPath,
    overlayPath: overlay[0].fsPath,
  };
}

// activatePluginsView registers the plugins tree and the operations that act on
// it: the panel-scoped ones in its title bar, the row-scoped one on a plugin row.
// View and command ids mirror package.json.
export function activatePluginsView(
  context: vscode.ExtensionContext,
  deps: PluginsDeps,
): void {
  const plugins = new PluginsTreeProvider(deps);
  // The tree is registered before the workspace root is known, so its first
  // render reports honestly that there is no anchored workspace. Re-asking when
  // the compiler becomes answerable is what supersedes that row without the
  // reader doing anything; the refresh command stays an override a reader may
  // press, rather than the way to obtain correct data the first time.
  deps.onReady(() => plugins.refresh());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.plugins', plugins),
    vscode.commands.registerCommand('aggrega.plugins.refresh', () => plugins.refresh()),

    // Adding a plugin takes a subject the panel cannot supply: it names a plugin
    // that is not attached yet, so the answers are asked for. It is also the one
    // operation here that reaches the network — it searches the configured
    // registry — so it is the one that is watched and can be stopped.
    //
    // The type may arrive already answered, from the menu the panel offers
    // beside the control. It is checked against the set that control offers
    // before it is used, and anything else is discarded rather than passed on:
    // an answer the surface never offered is not an answer, and falling back to
    // asking is what the reader gets instead of a refusal about a value they
    // never chose.
    vscode.commands.registerCommand('aggrega.plugins.add', async (chosen?: unknown) => {
      const attachment = await askForAttachment(menuAnswer('pluginAdd', chosen) ?? undefined);
      if (!attachment) { return; }
      await runWatchableCli(
        deps,
        `Aggrega: searching the registry for a ${attachment.type} plugin`,
        'The attachment',
        pluginAddArgs(attachment),
        `added the ${attachment.type} plugin matching ${attachment.query}.`,
      );
      plugins.refresh();
    }),

    // Generating catalog entities reads the selected plugins and writes a file
    // per plugin, so it confirms first and names the directory it writes under.
    // A generated entity's path is derived from the plugin rather than chosen, so
    // a reader cannot tell from the directory alone what is about to be replaced
    // inside it.
    vscode.commands.registerCommand('aggrega.plugins.genCatalog', async (chosen?: unknown) => {
      const named = menuAnswer('pluginEntities', chosen);
      const request = await askForGeneration(genCatalogScope(named ?? '')?.value);
      if (!request) { return; }
      const consented = await vscode.window.showWarningMessage(
        `Write Plugin entities under ${request.outputDir}?`,
        {
          modal: true,
          detail: 'Each entity is written at a path derived from its plugin’s type, name '
            + 'and version, so an entity already there for that same plugin and version is '
            + 'replaced. Nothing else under the directory is touched.',
        },
        'Write',
      );
      if (consented !== 'Write') { return; }
      await runCli(
        deps,
        'The generation',
        pluginGenCatalogArgs(request.selection, request.outputDir, request.overlayPath),
        { detail: `wrote the entities under ${request.outputDir}.` },
      );
      // A generated Plugin entity can change what a configured attachment
      // resolves to, because the listing resolves an attachment through the
      // entities the workspace can see. So the listing is re-read rather than
      // assumed unchanged.
      plugins.refresh();
    }),

    // Removing a plugin confirms first, and the confirmation names which
    // configuration file the removal writes — that depends on the plugin's type
    // and is not guessable from the row, so it is put in front of the reader
    // before anything happens rather than explained afterwards.
    //
    // The confirmation predicts that file from the type, because it is asked
    // before anything runs and there is no answer to read yet. The ending names
    // the file the compiler actually wrote, which is the same fact measured
    // instead of predicted.
    //
    // No progress indicator and no cancel button, and that follows from what the
    // operation is rather than from its being quick. The shared operation behind
    // the request accepts no cancellation, so a stop here could only stop this
    // side waiting — and reporting that as a stop would tell a reader the compiler
    // stopped when it did not. What the reader gets instead is the confirmation
    // beforehand, which is the affordance a destructive operation owes, and an
    // ending they cannot miss.
    vscode.commands.registerCommand(
      'aggrega.plugins.remove',
      (node?: PluginNode) => runOnRow(node, async (subject) => {
        const consented = await vscode.window.showWarningMessage(
          `Remove the ${subject.type} plugin ${subject.reference}?`,
          {
            modal: true,
            detail: `The entry is removed from ${pluginRemovalConfigTarget(subject.type)}, so `
              + 'this plugin no longer participates in a build reading it. The removal operates '
              + 'on the configuration text alone, so nothing else on this machine is removed.',
          },
          'Remove',
        );
        if (consented !== 'Remove') { return; }
        const outcome = await runPluginRemoval(deps, subject.type, subject.reference);
        // The listing is re-read whatever the ending was. A removal that was
        // refused may still have changed what the workspace resolves, because the
        // work is the compiler's and it is not this surface's to say how far it
        // got.
        plugins.refresh();
        await reportOutcome(deps, REMOVAL_SUBJECT, outcome, true);
      }),
    ),
  );
}
