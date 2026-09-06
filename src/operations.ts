// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as vscode from 'vscode';
import {
  DEPRECATION_SEVERITIES,
  EntitySubject,
  OperationId,
  OperationsLayout,
  OperationsNode,
  ReleaseScopedVerb,
  cacheArgs,
  catalogUploadArgs,
  commandIdFor,
  deprecateArgs,
  importArgs,
  inspectableSubjects,
  operationsTopLevel,
  operationsUnder,
  publishableSubjects,
  releaseScopedArgs,
  signArgs,
} from './operation-groups';
import { SelectionState } from './release-selection';
import { RendersOnReady } from './readiness';
import { SelectorRow, selectorRows } from './selector-rows';
import { BuildPreviewResponse, BuildResponse, ScaffoldEntityResponse } from './types';
import { CatalogIndexDoc } from './workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// OperationDeps supplies the live extension state the operation surface reads
// without importing extension.ts (which would form an import cycle): the
// anchored workspace root that scopes every CLI invocation, the configured
// binary path, the shared output channel, and the serve-backed validate of the
// active document. The root and binary path are read through getters so the
// surface always sees the current value — the root is set only once the daemon
// attaches, after this surface is registered.
export interface OperationDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  // getAnchoredWorkspaceRoot reports the folder the language server anchored
  // to, or null when it has reported none. It is a different fact from
  // getWorkspaceRoot above — that one is the folder the editor opened — and the
  // workspace row shows this one, because it is what the Release list is
  // computed against.
  getAnchoredWorkspaceRoot(): string | null;
  // selectionState reports the editor's one selected Release, for the row that
  // displays it. The row renders this and derives nothing of its own.
  selectionState(): SelectionState;
  // onSelectionChange registers a listener fired whenever the selection
  // changes, so the row re-renders without polling.
  onSelectionChange(listener: () => void): void;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
  validateActiveDocument(): Promise<void>;
  // selectedRelease is the editor's one selected Release, workspace-relative,
  // or null when none is selected. Build, preview build and pull each act on a
  // Release, and they act on this one: prompting per operation would let a
  // build and a graph describe two different Releases in the same session.
  selectedRelease(): string | null;
  // requireSelectedRelease reports that nothing is selected, and offers the
  // reader the way to select one. Supplied rather than spelled out here so
  // every surface that needs a selection says the same thing.
  requireSelectedRelease(): void;
  // runLint runs the conventions linter and publishes its findings as
  // navigable diagnostics. It is supplied rather than spawned here because the
  // findings land in the linter's own diagnostic collection, which the
  // extension owns; this surface only invokes it.
  runLint(): Promise<void>;
  // build compiles a Release and writes the artifacts it renders. It is
  // supplied rather than spawned here for the same reason previewBuild is: it
  // is language-server-backed, so the findings that carry a document position
  // travel on the server's diagnostic channel and land in the Problems panel,
  // which a subprocess streaming its output to a channel cannot do. The release
  // is workspace-relative, which is the form the server's request parameters
  // take.
  build(release: string): Promise<BuildResponse>;
  // previewBuild renders a Release the way a build does and reports what a
  // build would emit, without emitting any of it. It is supplied rather than
  // spawned here because it is language-server-backed: the findings that carry
  // a document position travel on the server's diagnostic channel and land in
  // the Problems panel, which a subprocess streaming its output to a channel
  // cannot do. The release is workspace-relative, which is the form the
  // server's request parameters take.
  previewBuild(release: string): Promise<BuildPreviewResponse>;
  // reportDaemonError routes a failed request's error envelope to the per-code
  // surfaces the extension already has for it — a diagnostic on the document
  // the envelope names, or the toast that offers the remediating command — and
  // reports whether it recognised the envelope.
  //
  // A preview refusal is about an authored document, and the envelope carries
  // which one plus, where the fault is attributable to a single key, that key's
  // span. Without this the payload would reach the reader as one line of log
  // text and the position it carries would be discarded. fallbackPath is the
  // document to attach a diagnostic to when the envelope names no artifact of
  // its own.
  reportDaemonError(err: unknown, fallbackPath: string): boolean;
  // requestCatalogIndex asks the language server for the workspace's entity
  // index. It is the source the entity pickers offer from: the server reports
  // the index it derives from the workspace it reads, so a picker and the
  // compiler cannot come to disagree about what the workspace contains. A picker
  // walking the workspace itself would offer a set the compiler is not using,
  // with nothing to report the disagreement.
  requestCatalogIndex(): Promise<CatalogIndexDoc>;
  // scaffoldEntity asks the language server to draft a starter document for an
  // entity kind. It writes nothing: the answer is text, and where it goes is
  // this surface's decision, which is why it lands in an unsaved buffer.
  scaffoldEntity(kind: string, name: string): Promise<ScaffoldEntityResponse>;
  // entityDefinition asks the language server what an entity resolves to. The
  // answer is a structured document rather than readable output, so this surface
  // opens it rather than streaming it to a channel.
  entityDefinition(name: string): Promise<unknown>;
  // effectiveConfiguration asks the language server for the configuration it
  // resolved and the layer each setting came from.
  effectiveConfiguration(): Promise<unknown>;
  // layout reports which of the two panel shapes to draw. It is read through a
  // getter so the surface always sees the current value, and re-read on every
  // render rather than captured, which is what lets the setting change take
  // effect without a restart.
  layout(): OperationsLayout;
  // onLayoutChange registers a listener fired when the shape setting changes, so
  // the open panel re-renders in the other shape with nothing to restart.
  onLayoutChange(listener: () => void): void;
}

// OperationsRow is what the tree holds: the two selector rows that name what
// the editor is acting on, then the grouped operations that act on it.
//
// A selector row is kept as its own variant rather than folded into the node
// model, because the two rows are a different kind of thing from an operation:
// they report what the editor is acting on, and every operation below them acts
// on it. They sit above the groups in both shapes for that reason.
type OperationsRow = SelectorRow | OperationsNode;

function isSelectorRow(row: OperationsRow): row is SelectorRow {
  return 'key' in row;
}

// SEPARATOR_LABEL draws the divider ahead of the publish group. It is a row of
// its own because a tree has no other way to put space between two groups, and
// the separation is load-bearing: the operations below it change what every
// consumer of a catalog resolves, while everything above writes to this machine.
const SEPARATOR_LABEL = '───────────';

// OperationsTreeProvider backs the Operations view in the Aggrega activity-bar
// container: the two selector rows first, then the operation groups in one of
// two shapes.
//
// The shape and the selector rows both change under the panel, so the provider
// emits change events. The facts the rows render — the anchored folder and the
// selected Release — and the shape are all read through the getters their owners
// already expose rather than copied here, so nothing on the panel can come to
// disagree with the value a request actually carries.
class OperationsTreeProvider implements vscode.TreeDataProvider<OperationsRow> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: OperationDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(row: OperationsRow): vscode.TreeItem {
    if (isSelectorRow(row)) {
      const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
      item.description = row.value;
      item.tooltip = row.tooltip;
      item.iconPath = new vscode.ThemeIcon(row.icon);
      item.command = { command: row.command, title: row.label };
      item.contextValue = `aggrega.selector.${row.key}`;
      return item;
    }
    switch (row.kind) {
      case 'separator': {
        const item = new vscode.TreeItem(SEPARATOR_LABEL, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'aggrega.separator';
        return item;
      }
      case 'heading': {
        const item = new vscode.TreeItem(row.group.heading, vscode.TreeItemCollapsibleState.None);
        item.contextValue = `aggrega.group.${row.group.id}`;
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          row.group.heading,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.contextValue = `aggrega.group.${row.group.id}`;
        return item;
      }
      case 'operation': {
        const item = new vscode.TreeItem(row.op.label, vscode.TreeItemCollapsibleState.None);
        item.tooltip = row.op.detail;
        item.iconPath = new vscode.ThemeIcon(row.op.icon);
        item.command = { command: commandIdFor(row.op), title: row.op.label };
        item.contextValue = `aggrega.op.${row.op.id}`;
        return item;
      }
    }
  }

  getChildren(row?: OperationsRow): OperationsRow[] {
    if (row === undefined) {
      return [
        ...selectorRows(
          this.deps.getAnchoredWorkspaceRoot(),
          this.deps.getWorkspaceRoot(),
          this.deps.selectionState(),
        ),
        // Read on every render rather than captured, so changing the setting
        // redraws the open panel in the other shape with nothing to restart.
        ...operationsTopLevel(this.deps.layout()),
      ];
    }
    if (!isSelectorRow(row) && row.kind === 'group') {
      return operationsUnder(row.group);
    }
    return [];
  }
}

// OperationsView is the handle the extension holds to re-render the selector
// rows on the one event neither the selection nor the readiness signal
// announces: the anchored folder changing while the server stays as it was.
export interface OperationsView {
  refresh(): void;
}

// activateOperations registers the Operations view and one command per
// operation. The view id and command ids mirror the package.json contributions.
export function activateOperations(
  context: vscode.ExtensionContext,
  deps: OperationDeps,
): OperationsView {
  const provider = new OperationsTreeProvider(deps);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.operations', provider),
  );
  // The rows take the readiness signal as a dependency like every other
  // surface: the anchored folder is reported by the language server, so it is
  // not known when this view is registered and drawn.
  deps.onReady(() => provider.refresh());
  deps.onSelectionChange(() => provider.refresh());
  deps.onLayoutChange(() => provider.refresh());

  const reg = (id: OperationId, handler: () => void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`aggrega.op.${id}`, handler));
  };

  reg('validate', () => { void deps.validateActiveDocument(); });
  reg('lint', () => { void deps.runLint(); });
  reg('build', () => { void runBuild(deps); });
  reg('preview', () => { void runPreview(deps); });
  // The topology graph contributes its own command, so nothing is registered for
  // it here: the group entry points at that command rather than at a second one
  // wrapping it.
  reg('pull', () => { runReleaseScoped(deps, 'pull'); });
  reg('acquire', () => { runReleaseScoped(deps, 'acquire'); });
  reg('scaffold', () => { void runScaffold(deps); });
  reg('import', () => { void runImport(deps); });
  reg('inspect', () => { void runInspect(deps); });
  reg('push', () => { void runCatalogUpload(deps); });
  reg('sign', () => { void runSign(deps); });
  reg('deprecate', () => { void runDeprecate(deps); });
  reg('configShow', () => { void runConfigShow(deps); });
  reg('cache', () => { void runCache(deps); });

  return { refresh: () => provider.refresh() };
}

// runReleaseScoped runs a CLI-backed command that requires a --release
// argument: it invokes `aggrega <verb> --release <path>` on the selected
// Release. Running the bare verb would fail — the CLI marks --release required
// on both verbs routed through here.
//
// The path is workspace-relative and the subprocess runs in the workspace root,
// so it resolves there.
//
// Both verbs read the one selected Release rather than prompting for their own:
// prompting per operation would let a pull and an acquisition act on two
// different Releases in the same session.
function runReleaseScoped(deps: OperationDeps, verb: ReleaseScopedVerb): void {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }
  runCli(deps, releaseScopedArgs(verb, release));
}

// runBuild compiles a Release and writes the artifacts it renders.
//
// It is language-server-backed, like the preview beside it and for the same
// reason: the findings the render raises carry a document position, and the
// language server publishes them on its diagnostic channel, so they reach the
// Problems panel where a reader can navigate to each one. A subprocess streaming
// its output to this channel discards that position, which would leave one of
// the two operations able to put a finding in front of a reader and the other
// not.
//
// What lands where is the same split the preview uses: the positioned findings
// arrive on the server's own channel and are published by the extension's
// diagnostic path, so nothing here handles them; the advisories that carry no
// position ride back on the answer and are written to this channel, which is the
// only surface that can show them.
async function runBuild(deps: OperationDeps): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }

  const out = deps.output;
  out.show(true);
  out.appendLine(`\nBuild of ${release}.`);

  let result: BuildResponse;
  try {
    result = await deps.build(release);
  } catch (err) {
    // The envelope is routed BEFORE the log line rather than instead of it. A
    // refusal is about an authored document and carries which one, so routing it
    // puts the fault on that document where the reader can act on it. The log
    // line still fires either way: a reader watching this channel has to be told
    // the build did not complete, and a value that is not an envelope at all has
    // nowhere else to surface.
    deps.reportDaemonError(err, release);
    // The message is the compiler's own text, unchanged. Where it named a
    // remediation, that remediation is what the reader needs.
    const message = err instanceof Error ? err.message : String(err);
    out.appendLine(`The build did not complete: ${message}`);
    return;
  }

  for (const notice of result.notices ?? []) {
    out.appendLine(notice.class ? `  ${notice.class}: ${notice.text}` : `  ${notice.text}`);
  }
  for (const file of result.files) {
    out.appendLine(`  ${file}`);
  }
  // The closing line is the command line's own summary of a completed build,
  // in the same words: the two surfaces perform one operation, so a reader who
  // has seen one report should not have to work out that the other is the same.
  out.appendLine(
    `Build completed: ${result.files.length} files written to ${result.outputDirectory}/`,
  );
}

// runPreview renders a Release the way a build does and reports what a build
// would emit, without emitting any of it.
//
// It is language-server-backed, like the Build operation beside it and for the
// same reason: the findings the render raises carry a document position, and the
// language server publishes them on its diagnostic channel, so they reach the
// Problems panel where a reader can navigate to each one. A subprocess streaming
// its output to this channel discards that position.
//
// What separates it from Build is only what happens to the render: this one
// reports the artifacts and writes none of them.
//
// What lands where: the positioned findings arrive on the server's own channel
// and are published by the extension's diagnostic path, so nothing here handles
// them. The advisories that carry no position ride back on the answer and are
// written to this channel, which is the only surface that can show them.
async function runPreview(deps: OperationDeps): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }

  const out = deps.output;
  out.show(true);
  out.appendLine(`\nPreview of a build of ${release}. Nothing is written to disk.`);

  let result: BuildPreviewResponse;
  try {
    result = await deps.previewBuild(release);
  } catch (err) {
    // The envelope is routed BEFORE the log line rather than instead of it. A
    // refusal is about an authored document and carries which one, so routing it
    // puts the fault on that document where the reader can act on it. The log
    // line still fires either way: a reader watching this channel has to be told
    // the preview did not complete, and a value that is not an envelope at all
    // has nowhere else to surface.
    deps.reportDaemonError(err, release);
    // The message is the compiler's own text, unchanged. Where it named a
    // remediation, that remediation is what the reader needs.
    const message = err instanceof Error ? err.message : String(err);
    out.appendLine(`The preview did not complete: ${message}`);
    return;
  }

  for (const notice of result.notices ?? []) {
    out.appendLine(notice.class ? `  ${notice.class}: ${notice.text}` : `  ${notice.text}`);
  }
  for (const file of result.files) {
    out.appendLine(`  ${file}`);
  }
  // The count is followed by where the files go, because the names above are
  // names and not paths: each one is relative to the output directory the build
  // is given, so a reader comparing this list against a build's output finds the
  // same names one level down rather than at the workspace root.
  out.appendLine(
    result.files.length === 1
      ? 'A build of this Release writes 1 file, under the output directory it is given.'
      : `A build of this Release writes ${result.files.length} files, under the output directory it is given.`,
  );
}

// runCli spawns `aggrega <args>` in the anchored workspace root and streams its
// output to the shared channel. It is the single path for every CLI-backed
// operation, so a new operation is a thin entry rather than a bespoke spawn.
// The compiler owns the work; this surface only invokes it and surfaces its
// output verbatim — including its own errors, which are more useful to the
// author than a re-worded wrapper message.
function runCli(deps: OperationDeps, args: string[]): void {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const bin = deps.getBinaryPath();
  const out = deps.output;
  out.show(true);
  out.appendLine(`\n$ ${bin} ${args.join(' ')}   (cwd: ${root})`);

  let child;
  try {
    child = spawn(bin, args, { cwd: root });
  } catch (err) {
    out.appendLine(`[failed to launch ${bin}: ${(err as Error).message}]`);
    return;
  }
  child.on('error', err => out.appendLine(`[failed to launch ${bin}: ${err.message}]`));
  child.stdout?.on('data', (d: Buffer) => out.append(d.toString()));
  child.stderr?.on('data', (d: Buffer) => out.append(d.toString()));
  child.on('close', code => out.appendLine(`\n[${args[0]} exited with code ${code ?? 'unknown'}]`));
}

// runImport prompts for the source to import, then runs the import operation.
// The source is passed verbatim as a positional argument; the compiler
// validates and reports on it.
async function runImport(deps: OperationDeps): Promise<void> {
  const source = await vscode.window.showInputBox({
    title: 'Aggrega: import source',
    prompt: 'Path or reference of the source to import',
    ignoreFocusOut: true,
  });
  if (!source) { return; }
  runCli(deps, importArgs(source));
}

// runCache offers the cache subcommands as a quick-pick, then runs the chosen
// one. The subcommand set mirrors the CLI's cache command group.
async function runCache(deps: OperationDeps): Promise<void> {
  const picks: Array<vscode.QuickPickItem & { arg: string }> = [
    { label: 'status', description: 'Show cache size and contents', arg: 'status' },
    { label: 'prune', description: 'Remove stale cache entries', arg: 'prune' },
    { label: 'clear', description: 'Empty the cache', arg: 'clear' },
  ];
  const choice = await vscode.window.showQuickPick(picks, {
    placeHolder: 'Aggrega: choose a cache operation',
  });
  if (!choice) { return; }
  runCli(deps, cacheArgs(choice.arg));
}

// --- the subjects an operation is given ----------------------------------

// NO_ENTITY_TO_OFFER is what a reader is told when the workspace holds no entity
// the chosen operation can name. It says the workspace declares none rather than
// showing an empty picker, because an empty list of choices reads as a surface
// that failed to load.
const NO_ENTITY_TO_OFFER = 'Aggrega: this workspace declares no entity to offer here.';

// pickEntity offers the workspace's own entities and returns the chosen one.
//
// The offer comes from the language server's index rather than from a walk of
// this extension's own: the server reports the index it derives from the
// workspace it reads, so the picker and the compiler cannot disagree about what
// the workspace contains. A failed request surfaces the server's own message,
// which is where the remediation is already named.
async function pickEntity(
  deps: OperationDeps,
  subjectsFor: (entities: CatalogIndexDoc['entities']) => EntitySubject[],
  placeHolder: string,
): Promise<EntitySubject | null> {
  let doc: CatalogIndexDoc;
  try {
    doc = await deps.requestCatalogIndex();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.output.appendLine(`\nThe workspace entity index could not be read: ${message}`);
    void vscode.window.showInformationMessage(message);
    return null;
  }
  const subjects = subjectsFor(doc.entities);
  if (subjects.length === 0) {
    void vscode.window.showInformationMessage(NO_ENTITY_TO_OFFER);
    return null;
  }
  const choice = await vscode.window.showQuickPick(subjects, { placeHolder });
  return choice ?? null;
}

// runCatalogUpload publishes one catalog entity the workspace holds.
//
// The entity is chosen before the command is built, because the command takes
// the entity's path and an invocation carrying none cannot succeed. That was
// this panel's own long-standing defect: the entry ran the bare verb, so
// pressing it could only ever produce a usage error.
async function runCatalogUpload(deps: OperationDeps): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const subject = await pickEntity(
    deps,
    publishableSubjects,
    'Aggrega: choose the entity to publish',
  );
  if (!subject) { return; }
  runCli(deps, catalogUploadArgs(subject.file));
}

// runSign attaches a signature to one already-published artifact.
//
// The subject is asked for rather than offered from the workspace index, and the
// distinction is what makes the entry work at all: the index describes what is
// authored here, while this command amends what is already in a registry. It
// carries neither the version an artifact was published under nor the registry
// it went to, so a reference built from it would be a guess — and a guess that
// fails outright for an entity nobody has published.
async function runSign(deps: OperationDeps): Promise<void> {
  const reference = await vscode.window.showInputBox({
    title: 'Aggrega: sign a published artifact',
    prompt: 'Reference of the already-published artifact to sign',
    ignoreFocusOut: true,
  });
  if (!reference) { return; }
  runCli(deps, signArgs(reference));
}

// runDeprecate attaches a signed deprecation marker to one already-published
// artifact.
//
// The severity and the reason are collected here and passed as flags. The
// command asks for them itself at an interactive terminal, and this surface runs
// it as a subprocess with no terminal to be asked at — so an invocation carrying
// only the reference would refuse every time, whatever the reader intended. The
// reference is asked for rather than offered, for the same reason the signature
// above asks for one.
async function runDeprecate(deps: OperationDeps): Promise<void> {
  const reference = await vscode.window.showInputBox({
    title: 'Aggrega: deprecate a published artifact',
    prompt: 'Reference of the already-published artifact to deprecate',
    ignoreFocusOut: true,
  });
  if (!reference) { return; }

  const severity = await vscode.window.showQuickPick(
    DEPRECATION_SEVERITIES.map((s) => ({ label: s.value, description: s.detail })),
    { placeHolder: 'Aggrega: how severe is this deprecation?' },
  );
  if (!severity) { return; }

  const reason = await vscode.window.showInputBox({
    title: 'Aggrega: deprecation reason',
    prompt: 'Why it is deprecated, and what to use instead',
    ignoreFocusOut: true,
  });
  if (!reason) { return; }

  runCli(deps, deprecateArgs(reference, severity.label, reason));
}

// --- the language-server-backed entries ----------------------------------

// openDocument puts text in front of the reader in an unsaved buffer.
//
// Nothing is written to disk: the buffer is where the author reads, edits or
// discards it, and the moment a new document reaches disk stays with them. It is
// also what keeps these entries from ending in silence — every one of them ends
// in a document the reader can see.
async function openDocument(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: false });
}

// reportDaemonFailure surfaces a failed request through the channels the
// extension already has for one, then logs it. The compiler's own message is
// carried through unchanged: where it named a remediation, that remediation is
// what the reader needs, and a re-worded wrapper would discard it.
function reportDaemonFailure(deps: OperationDeps, err: unknown, what: string): void {
  const message = err instanceof Error ? err.message : String(err);
  deps.output.appendLine(`\n${what} did not complete: ${message}`);
  void vscode.window.showInformationMessage(message);
}

// runScaffold drafts a starter document for an entity kind and opens it.
//
// The kind is asked for as text rather than offered as a list, because the set
// of kinds belongs to the compiler: a list held here would be a second statement
// of it, agreeing until the day a kind was added. A kind the compiler does not
// answer to comes back refused, with the compiler's own corrective text naming
// the whole valid set — which is the answer a list would have been standing in
// for.
async function runScaffold(deps: OperationDeps): Promise<void> {
  const kind = await vscode.window.showInputBox({
    title: 'Aggrega: draft an entity',
    prompt: 'Entity kind to draft — for example component, aggregate, release or recipe',
    ignoreFocusOut: true,
  });
  if (!kind) { return; }

  // The name is optional: the compiler fills a placeholder where none is given,
  // so an empty answer still produces a document rather than a refusal.
  const name = await vscode.window.showInputBox({
    title: 'Aggrega: draft an entity',
    prompt: 'Name for the new entity — leave empty for a placeholder',
    ignoreFocusOut: true,
  });
  if (name === undefined) { return; }

  try {
    const result = await deps.scaffoldEntity(kind, name);
    await openDocument(result.skeleton, 'yaml');
  } catch (err) {
    reportDaemonFailure(deps, err, 'The draft');
  }
}

// runInspect reports what one entity in the workspace resolves to.
//
// The entity is offered from the workspace's own index, which is the set the
// compiler will resolve against, and it is addressed by identity rather than by
// path — an entity the workspace holds no file for is still answerable, so it is
// still offered.
async function runInspect(deps: OperationDeps): Promise<void> {
  const subject = await pickEntity(
    deps,
    inspectableSubjects,
    'Aggrega: choose the entity to inspect',
  );
  if (!subject) { return; }

  try {
    const result = await deps.entityDefinition(subject.name);
    await openDocument(JSON.stringify(result, null, 2), 'json');
  } catch (err) {
    reportDaemonFailure(deps, err, 'The inspection');
  }
}

// runConfigShow reports the configuration the language server resolved, and the
// layer each setting came from. It takes no subject: the configuration is a
// property of the workspace the server already anchored to.
async function runConfigShow(deps: OperationDeps): Promise<void> {
  try {
    const result = await deps.effectiveConfiguration();
    await openDocument(JSON.stringify(result, null, 2), 'json');
  } catch (err) {
    reportDaemonFailure(deps, err, 'The configuration report');
  }
}
