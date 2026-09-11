// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import {
  CatalogIndexDoc,
  WorkspaceCatalogNode,
  workspaceCatalogNodes,
} from './workspace-catalog-run';
import {
  catalogEntityName,
  catalogEntityPath,
  catalogLintArgs,
  catalogRowContext,
  catalogValidateArgs,
} from './catalog-entity-operations';
import { CancellationSignal } from './cancellation';
import { CliOperationDeps, reportOutcome, runWatchableCli } from './cli-operation';
import {
  PUBLICATION_SUBJECT,
  PublishEntityParams,
  PublishEntityResult,
  publicationOpeningLine,
  runPublishEntity,
} from './publication-request';
import { outcomeOf } from './operation-outcome';
import { openDocument } from './open-document';
import { withCancellableProgress } from './progress';
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
// language server is running, the index request itself, the resolution request
// one row asks for, and the shared output channel that carries failure detail.
//
// The two transports both appear here because the operations on this panel are
// split across them, and which one an operation takes is a property of the
// compiler rather than a choice this surface makes: the inspection and the
// publication are answered by the language server, while the two per-entity
// checks stay command-line backed — the correctness check because the request
// channel answers correctness in a different shape, and the conventions check
// because of where its answer would land, each stated at its own registration
// below. A reader pressing an entry is not told which, and does not need to be.
export interface WorkspaceCatalogDeps extends RendersOnReady, CliOperationDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  isLanguageServerRunning(): boolean;
  requestCatalogIndex(): Promise<CatalogIndexDoc>;
  // entityDefinition asks the language server what one entity resolves to,
  // addressed by the name it resolves under.
  entityDefinition(name: string, signal?: CancellationSignal): Promise<unknown>;
  // publishEntity publishes one entity this panel lists. It is the only
  // operation here that reaches past this machine, which is why its answer names
  // the registry it addressed and whether anything landed, and why it takes the
  // reader's stop: the signal reaches the compiler as the cancellation of the
  // request this call was sent as, and the publication is abandoned rather than
  // only waited on.
  publishEntity(
    params: PublishEntityParams,
    signal?: CancellationSignal,
  ): Promise<PublishEntityResult>;
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
    // Only a row naming an entity carries the value the row operations are
    // bound to, and which value it carries decides which of them appear. The
    // kind headings and the message rows above name no entity — a heading names
    // a kind and a message says why there is nothing to name — so both return
    // before this line and the operations do not appear on them at all.
    const context = catalogRowContext(node);
    if (context !== null) {
      item.contextValue = context;
    }
    // A row with nothing to open carries neither affordance rather than one
    // that cannot do anything: a click that silently does nothing teaches the
    // reader that rows in this panel are unreliable, which costs the rows that
    // do work. The row still names the entity and says where it came from, so
    // what is absent is the action and not the information.
    //
    // resourceUri is withheld on the same condition and not merely the command.
    // It is what the editor's own file actions — reveal, copy path — act on, so
    // leaving it set would hand a reader a path to a file that is not there.
    if (node.row.openPath !== null) {
      // The path is already resolved against the workspace root by the shaping
      // layer, so the click carries a location rather than a lookup.
      const uri = vscode.Uri.file(node.row.openPath);
      item.resourceUri = uri;
      item.command = {
        command: 'vscode.open',
        title: OPEN_COMMAND_TITLE,
        arguments: [uri],
      };
    }
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

// onPath and onName invoke a row-scoped operation against the subject the
// pressed row supplies.
//
// The subject is read through the one extractor for it rather than off anything
// the row displays, and a row that supplies none produces nothing: the handler
// returns having invoked nothing. The manifest already keeps each entry off the
// rows that cannot supply its subject, so these are the second of two guards
// rather than the only one — and they are the ones that hold if a later binding
// is written more loosely than the ones here.
//
// There are two because the operations on this panel take two different
// subjects. A path-taking operation is unavailable on a row the workspace holds
// no document for, while an identity-taking one is answerable on every entity
// row, so folding them into one extractor would have to pick one of those two
// rules and would apply it to operations the other governs.
async function onPath(
  node: WorkspaceCatalogNode | undefined,
  act: (entityPath: string) => Promise<void>,
): Promise<void> {
  const entityPath = node ? catalogEntityPath(node) : null;
  if (!entityPath) {
    return;
  }
  await act(entityPath);
}

async function onName(
  node: WorkspaceCatalogNode | undefined,
  act: (name: string) => Promise<void>,
): Promise<void> {
  const name = node ? catalogEntityName(node) : null;
  if (!name) {
    return;
  }
  await act(name);
}

// activateWorkspaceCatalogView registers the workspace-catalog tree, its refresh
// command, and the operations that act on one entity it lists. View and command
// ids mirror package.json.
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

    // The inspection is the one operation here every entity row offers, because
    // it is the only one addressed by identity: an entity resolves under its
    // name whether or not this workspace holds the document that declares it.
    // It reads and changes nothing, which is why it is also the entry given the
    // inline slot — the row affordance a reader reaches without opening a menu.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.inspect',
      (node?: WorkspaceCatalogNode) => onName(node, async (name) => {
        try {
          const result = await withCancellableProgress(
            `Aggrega: inspecting ${name}`,
            (signal) => deps.entityDefinition(name, signal),
          );
          await openDocument(JSON.stringify(result, null, 2), 'json');
        } catch (err) {
          await reportOutcome(deps, 'The inspection', outcomeOf(err), true);
        }
      }),
    ),

    // The two checks answer "what is wrong with this entity", and each has a
    // pathless form addressing the whole catalog. Bound to a row they address
    // that row, so the path is always given: the wider question is a different
    // one, and it is already offered where it belongs.
    //
    // Both are invoked as commands, for different reasons.
    //
    // The correctness check below is the only operation on this surface the
    // compiler answers in a different SHAPE rather than not at all. Checking one
    // entity on its own reads that entity from disk and checks it as the kind it
    // declares — which for a Recipe means compiling it against a generated minimal
    // deployment, so an author sees its output before it is wired into any
    // Aggregate. The request channel answers correctness over a document's own
    // bytes and, where one is named, over a Release's resolved closure. Those are
    // two scopes of one question, and a row names an entity rather than a buffer
    // or a Release — so there is nothing here to send the entity to yet.
    //
    // 🔴 THE CONVENTIONS CHECK BELOW STAYS A COMMAND FOR A REASON THAT IS NOT THE
    // STOP, AND THE DISTINCTION MATTERS BECAUSE THE STOP USED TO BE THE REASON.
    // The request channel answers this question for one named entity and honours a
    // stop that reaches the work, so neither of those is what keeps this row on a
    // command. What does is where the answer would land: the conventions findings
    // published into the Problems panel are replaced WHOLESALE by the catalog-wide
    // form of this check, so a per-entity answer published into the same place
    // would erase every other document's findings — and one published nowhere
    // would be a reader pressing a row and seeing less than the panel already
    // shows. That is a question about what a reader should see, not about what the
    // compiler can do, so it is left as it is rather than answered here.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.validate',
      (node?: WorkspaceCatalogNode) => onPath(node, (entityPath) =>
        runWatchableCli(
          deps,
          `Aggrega: checking ${entityPath}`,
          'The check',
          catalogValidateArgs(entityPath),
          `checked ${entityPath}.`,
        )),
    ),

    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.lint',
      (node?: WorkspaceCatalogNode) => onPath(node, (entityPath) =>
        runWatchableCli(
          deps,
          `Aggrega: checking the publishing conventions for ${entityPath}`,
          'The conventions check',
          catalogLintArgs(entityPath),
          `checked the publishing conventions for ${entityPath}.`,
        )),
    ),

    // Publishing confirms first, and the confirmation names what the change
    // reaches. It is the one operation on this panel that changes something
    // outside this machine, and a row carries no heading to say so ahead of the
    // press — so what separates it from the checks beside it is put in front of
    // the reader before anything happens rather than explained afterwards.
    //
    // 🔴 THE CONFIRMATION IS WHOLLY THIS SURFACE'S OWN, AND IT IS ASKED BECAUSE
    // THE OPERATION REACHES PAST THIS MACHINE RATHER THAN TO SATISFY ANYTHING ON
    // THE OTHER SIDE. The compiler publishes what it is asked and prompts for
    // nothing, so declining here is what keeps the request from being sent, and
    // there is no invocation for an answer to be carried into.
    //
    // It is watched and it can be stopped. The publication bundles the entity and
    // pushes it to a registry, so there is a wait worth showing; and the request's
    // own context is observed at the point before the bytes become visible to
    // anyone else, so a reader who started one and changed their mind ends the
    // publication rather than only ending the wait — which matters most on exactly
    // this operation, whose bytes cannot be recalled from anyone who has already
    // fetched them.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.push',
      (node?: WorkspaceCatalogNode) => onPath(node, async (entityPath) => {
        const consented = await vscode.window.showWarningMessage(
          `Publish ${entityPath} to a registry?`,
          {
            modal: true,
            detail: 'The entity is bundled and pushed under its own declared version, and anyone '
              + 'pulling that version from that registry resolves what is published here. The '
              + 'checks beside this entry change nothing outside this machine; this one does.',
          },
          'Publish',
        );
        if (consented !== 'Publish') { return; }

        const out = deps.output;
        out.show(true);
        out.appendLine(publicationOpeningLine(entityPath));

        const report = await withCancellableProgress(
          `Aggrega: publishing ${entityPath}`,
          (signal) => runPublishEntity(deps, entityPath, signal),
        );
        for (const line of report.lines) {
          out.appendLine(line);
        }
        await reportOutcome(deps, PUBLICATION_SUBJECT, report.outcome, true);
      }),
    ),
  );
}
