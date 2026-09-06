// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { SelectionState } from './release-selection';
import { RendersOnReady } from './readiness';
import { SelectorRow, selectorRows } from './selector-rows';
import { BuildPreviewResponse, BuildResponse } from './types';
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
}

// OperationId enumerates the compiler operations the surface exposes. Each
// value is the suffix of its contributed command id (`aggrega.op.<id>`) and the
// stable key its tree item carries.
type OperationId = 'validate' | 'build' | 'preview' | 'lint' | 'pull' | 'push' | 'import' | 'cache';

interface OperationDef {
  id: OperationId;
  label: string;
  detail: string;
  // icon is a VS Code ThemeIcon (codicon) id, so the surface inherits the
  // editor theme rather than shipping bitmap assets.
  icon: string;
}

// OPERATIONS is the ordered operation surface. Order is the display order in
// the Operations view; it is fixed so the tree is stable across sessions.
const OPERATIONS: OperationDef[] = [
  { id: 'validate', label: 'Validate active file', detail: 'Validate the active YAML file via the language server', icon: 'check' },
  { id: 'build', label: 'Build', detail: 'Compile a Release and write its rendered artifacts; findings land in the Problems panel', icon: 'package' },
  { id: 'preview', label: 'Preview build', detail: 'Render what a build would emit without writing it; findings land in the Problems panel', icon: 'eye' },
  { id: 'lint', label: 'Lint', detail: 'Check publishing conventions across the catalog; findings land in the Problems panel', icon: 'search' },
  { id: 'pull', label: 'Pull', detail: 'Pull remote dependencies into the workspace', icon: 'cloud-download' },
  { id: 'push', label: 'Push', detail: 'Publish artifacts to a configured registry', icon: 'cloud-upload' },
  { id: 'import', label: 'Import…', detail: 'Import a foreign source into Aggrega', icon: 'arrow-into' },
  { id: 'cache', label: 'Cache…', detail: 'Inspect or maintain the local cache', icon: 'database' },
];

// OperationsRow is what the tree holds: the two selector rows that name what
// the editor is acting on, then the operations that act on it.
type OperationsRow = SelectorRow | OperationDef;

function isSelectorRow(row: OperationsRow): row is SelectorRow {
  return 'key' in row;
}

// OperationsTreeProvider backs the Operations view in the Aggrega activity-bar
// container: the two selector rows first, then one leaf per operation, each
// carrying the command that runs it on click.
//
// The operations are fixed but the selector rows are not, so the provider emits
// change events. The two facts they render — the anchored folder and the
// selected Release — are read through the getters their owners already expose
// rather than copied here, so a row cannot come to disagree with the value a
// request actually carries.
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
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = row.detail;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    item.command = { command: `aggrega.op.${row.id}`, title: row.label };
    item.contextValue = `aggrega.op.${row.id}`;
    return item;
  }

  getChildren(): OperationsRow[] {
    return [
      ...selectorRows(
        this.deps.getAnchoredWorkspaceRoot(),
        this.deps.getWorkspaceRoot(),
        this.deps.selectionState(),
      ),
      ...OPERATIONS,
    ];
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

  const reg = (id: OperationId, handler: () => void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`aggrega.op.${id}`, handler));
  };

  reg('validate', () => { void deps.validateActiveDocument(); });
  reg('build', () => { void runBuild(deps); });
  reg('preview', () => { void runPreview(deps); });
  reg('lint', () => { void deps.runLint(); });
  reg('pull', () => { runReleaseScoped(deps, 'pull'); });
  reg('push', () => runCli(deps, ['push']));
  reg('import', () => { void runImport(deps); });
  reg('cache', () => { void runCache(deps); });

  return { refresh: () => provider.refresh() };
}

// runReleaseScoped runs a CLI-backed command that requires a --release
// argument: it invokes `aggrega <verb> --release <path>` on the selected
// Release. Running the bare verb would fail — the CLI marks --release required.
//
// The path is workspace-relative and the subprocess runs in the workspace root,
// so it resolves there.
//
// The verb is typed as the set this surface actually routes through it rather
// than as a string, so a verb that has moved to the language server cannot be
// passed here by a caller that has not noticed.
function runReleaseScoped(deps: OperationDeps, verb: 'pull'): void {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }
  runCli(deps, [verb, '--release', release]);
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
  runCli(deps, ['import', source]);
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
  runCli(deps, ['cache', choice.arg]);
}
