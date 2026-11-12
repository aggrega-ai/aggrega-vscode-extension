// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { CatalogIndexDoc } from './workspace-catalog-run';
import { panelActionItem, panelMessageItem } from './panel-action-item';
import { CatalogPanelNode, catalogPanelNodes } from './panel-actions';
import {
  catalogEntityName,
  catalogEntityPath,
  catalogRowContext,
  catalogValidateArgs,
} from './catalog-entity-operations';
import { CancellationSignal } from './cancellation';
import { readAfterValidations } from './document-validations';
import { CliOperationDeps, reportOutcome, runWatchableCli } from './cli-operation';
import {
  PUBLICATION_SUBJECT,
  PublishEntityParams,
  PublishEntityResult,
  publicationOpeningLine,
  runPublishEntity,
} from './publication-request';
import { inspectEntity } from './inspection';
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
// language server is running, the index request itself, the request naming the
// kinds and what each row operation accepts a document of each for, the
// resolution request one row asks for, and the shared output channel that
// carries failure detail.
//
// The two transports both appear here because the operations on this panel are
// split across them, and which one an operation takes is a property of the
// compiler rather than a choice this surface makes: the inspection, the
// publication and the conventions check are answered by the language server,
// while the correctness check stays command-line backed, because the request
// channel answers correctness in a different shape. The reason is stated at that
// one registration below. A reader pressing an entry is not told which transport
// it takes, and does not need to be.
export interface WorkspaceCatalogDeps extends RendersOnReady, CliOperationDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  isLanguageServerRunning(): boolean;
  // requestCatalogIndex asks for the entities the selected Release's terms hold,
  // or the workspace's own where none is selected.
  requestCatalogIndex(): Promise<CatalogIndexDoc>;
  // validationsAnswered sends at once every open document's validation still
  // waiting out a pause in typing, and settles once every validation sent so far
  // has been answered or refused. A press of the refresh waits on it, so the list
  // it reads names every open document as the editor held it at the press.
  validationsAnswered(): Promise<void>;
  // selectedRelease is the Release the row's correctness check is run in the
  // terms of, read when the check is pressed, or null where none is selected.
  selectedRelease(): string | null;
  // entityKinds asks the language server which kinds an author writes a document
  // of, and what each row operation accepts a document of each kind for. It is
  // read beside the index on every read of the list.
  entityKinds(): Promise<unknown>;
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
  // lintEntity checks one entity's publishing conventions and republishes what
  // it found. It is handed in as a whole run rather than as a request, because
  // the findings land in a collection this panel does not own: the check answers
  // one question whichever surface asked it, and a second collection here would
  // be a second layer in the Problems panel for one set of rules.
  lintEntity(entityPath: string): Promise<void>;
  output: vscode.OutputChannel;
}

// WorkspaceCatalogTreeProvider renders the open workspace's entities, grouped
// by kind, in the Aggrega activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// catalogPanelNodes, which depends on no editor type and is therefore directly
// testable. The root opens with the search of the published catalog, and then
// lists the workspace's entities.
//
// Each expansion of the root re-asks the server, so a refresh is a change
// event. That costs nothing over the network: the index is derived from the
// workspace the server already reads, and reaches no registry.
class WorkspaceCatalogTreeProvider implements vscode.TreeDataProvider<CatalogPanelNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: WorkspaceCatalogDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: CatalogPanelNode): vscode.TreeItem {
    if (node.kind === 'action') {
      return panelActionItem(node.row);
    }
    if (node.kind === 'message') {
      return panelMessageItem(node);
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
    // bound to, and the value names which of them appear. The search at the
    // head, the kind headings and the message rows above name no entity — the
    // search acts on the published catalog, a heading names a kind and a message
    // says why there is nothing to name — so all three return before this line
    // and the operations do not appear on them at all.
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

  async getChildren(node?: CatalogPanelNode): Promise<CatalogPanelNode[]> {
    if (node) {
      return node.kind === 'group'
        ? node.rows.map((row) => ({ kind: 'entry' as const, row }))
        : [];
    }
    return catalogPanelNodes({
      getWorkspaceRoot: this.deps.getWorkspaceRoot,
      isLanguageServerRunning: this.deps.isLanguageServerRunning,
      requestCatalogIndex: this.deps.requestCatalogIndex,
      entityKinds: this.deps.entityKinds,
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
// rows that do not offer it, so these are the second of two guards rather than
// the only one — and they are the ones that hold if a later binding is written
// more loosely than the ones here.
//
// There are two because the operations on this panel take two different
// subjects. A path-taking operation has nothing to act on where the workspace
// holds no document, while an identity-taking one has a name on every entity
// row, so folding them into one extractor would have to pick one of those two
// rules and would apply it to operations the other governs.
async function onPath(
  node: CatalogPanelNode | undefined,
  act: (entityPath: string) => Promise<void>,
): Promise<void> {
  const entityPath = node && node.kind !== 'action' ? catalogEntityPath(node) : null;
  if (!entityPath) {
    return;
  }
  await act(entityPath);
}

async function onName(
  node: CatalogPanelNode | undefined,
  act: (name: string) => Promise<void>,
): Promise<void> {
  const name = node && node.kind !== 'action' ? catalogEntityName(node) : null;
  if (!name) {
    return;
  }
  await act(name);
}

// WorkspaceCatalogView is what the rest of the extension holds of the Catalog
// panel: the one way to have it read its list again. It reads at once, without
// the wait a reader's press of the refresh takes for the open documents'
// validations, so each of its callers keeps its own timing.
export interface WorkspaceCatalogView {
  refresh(): void;
}

// activateWorkspaceCatalogView registers the workspace-catalog tree, its refresh
// command, and the operations that act on one entity it lists. View and command
// ids mirror package.json.
export function activateWorkspaceCatalogView(
  context: vscode.ExtensionContext,
  deps: WorkspaceCatalogDeps,
): WorkspaceCatalogView {
  const catalog = new WorkspaceCatalogTreeProvider(deps);
  // The tree is registered before the workspace root is resolved and before the
  // server can answer, so its first render honestly reports one of those two
  // states. Re-asking when the compiler becomes answerable is what supersedes
  // that row without the reader doing anything, and a document created, changed
  // or deleted on disk, or closed in the editor, has it re-asked through the view
  // returned below — as does a move of the selected Release, since the list is
  // what that Release's terms hold. The refresh command is not the way to obtain
  // correct data the first time.
  //
  // What the panel does not follow on its own is a change still in an unsaved
  // buffer: typing asks for no read of the list, so the change shows only once
  // something reads it again, and the press is how a reader asks for that. A
  // press reads the list for every open document as the editor holds it at the
  // moment of the press, however soon after a keystroke or an undo it comes —
  // every validation still waiting out a pause in typing is sent at once, and the
  // list is asked for only once every validation sent so far has been answered,
  // because the language server learns a buffer's text from its validation alone.
  deps.onReady(() => catalog.refresh());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.workspaceCatalog', catalog),
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.refresh',
      () => readAfterValidations(deps.validationsAnswered, () => catalog.refresh()),
    ),

    // The inspection is the one operation here addressed by identity: an entity
    // resolves under its name whether or not this workspace holds the document
    // that declares it, so it is offered on a row with no document too, wherever
    // the compiler resolves a name to an entity of the row's kind. It reads and
    // changes nothing, which is why it is also the entry given the inline slot —
    // the row affordance a reader reaches without opening a menu. It is the same
    // inspection the Commands panel runs, ending the same way.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.inspect',
      (node?: CatalogPanelNode) => onName(node, (name) => inspectEntity(deps, name)),
    ),

    // The two checks answer "what is wrong with this entity", and each has a
    // pathless form addressing the whole catalog. Bound to a row they address
    // that row, so the path is always given: the wider question is a different
    // one, and it is already offered where it belongs.
    //
    // 🔴 THE CORRECTNESS CHECK BELOW IS THE ONE OPERATION ON THIS SURFACE THE
    // COMPILER ANSWERS IN A DIFFERENT SHAPE RATHER THAN NOT AT ALL, WHICH IS WHY
    // IT ALONE IS STILL INVOKED AS A COMMAND. Checking one entity on its own
    // reads that entity from disk and checks it as the kind it declares — which
    // for a Recipe means compiling it against a generated minimal harness, so
    // an author sees its output before it is wired into any Aggregate. The
    // request channel answers correctness over a document's own bytes and, where
    // one is named, over a Release's resolved closure. Those are two scopes of one
    // question, and a row names an entity rather than a buffer or a Release — so
    // there is nothing here to send the entity to yet.
    //
    // The command still names the selected Release, read as the row is pressed,
    // so the entity is checked in the terms of the Release whose list the row was
    // drawn from: what it refers to resolves through that Release's catalog
    // directories rather than the workspace's own.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.validate',
      (node?: CatalogPanelNode) => onPath(node, (entityPath) =>
        runWatchableCli(
          deps,
          `Aggrega: checking ${entityPath}`,
          'The check',
          catalogValidateArgs(entityPath, deps.selectedRelease()),
          `checked ${entityPath}.`,
        )),
    ),

    // The conventions check is a request, and it publishes into the same
    // collection the whole-catalog form of this check writes to.
    //
    // 🔴 WHAT MAKES PUBLISHING INTO A SHARED COLLECTION SAFE IS THAT A PUBLISH
    // CARRIES THE SUBJECT IT WAS ABOUT. A publish that replaced the collection
    // wholesale would let an answer about one entity erase every other document's
    // findings — a cost invisible until a reader loses a result they were reading.
    // A run drops what its own subject and answer supersede, so a row press
    // refreshes its own entity and the rest stand. Giving the row a collection of
    // its own is the other way to reach that and is worse: two conventions layers
    // in one Problems panel is a thing a reader has to learn in order to read what
    // one set of rules produced.
    //
    // The run itself is not composed here. It is handed in whole, because the
    // collection belongs to the surface that created it and this panel is one of
    // two places the same check is asked from.
    vscode.commands.registerCommand(
      'aggrega.workspaceCatalog.lint',
      (node?: CatalogPanelNode) => onPath(node, (entityPath) =>
        deps.lintEntity(entityPath)),
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
      (node?: CatalogPanelNode) => onPath(node, async (entityPath) => {
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
  return { refresh: () => catalog.refresh() };
}
