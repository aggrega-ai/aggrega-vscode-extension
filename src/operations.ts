// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { resolveRelease } from './release-pick';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// OperationDeps supplies the live extension state the operation surface reads
// without importing extension.ts (which would form an import cycle): the
// anchored workspace root that scopes every CLI invocation, the configured
// binary path, the shared output channel, and the serve-backed validate of the
// active document. The root and binary path are read through getters so the
// surface always sees the current value — the root is set only once the daemon
// attaches, after this surface is registered.
export interface OperationDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
  validateActiveDocument(): Promise<void>;
  // listReleases returns the workspace's Release candidates (daemon-backed).
  // build and pull require a --release argument, so the operation resolves one
  // before invoking the CLI.
  listReleases(): Promise<string[]>;
  // runLint runs the conventions linter and publishes its findings as
  // navigable diagnostics. It is supplied rather than spawned here because the
  // findings land in the linter's own diagnostic collection, which the
  // extension owns; this surface only invokes it.
  runLint(): Promise<void>;
}

// OperationId enumerates the compiler operations the surface exposes. Each
// value is the suffix of its contributed command id (`aggrega.op.<id>`) and the
// stable key its tree item carries.
type OperationId = 'validate' | 'build' | 'lint' | 'pull' | 'push' | 'import' | 'cache';

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
  { id: 'build', label: 'Build', detail: 'Compile the workspace to rendered artifacts', icon: 'package' },
  { id: 'lint', label: 'Lint', detail: 'Check publishing conventions across the catalog; findings land in the Problems panel', icon: 'search' },
  { id: 'pull', label: 'Pull', detail: 'Pull remote dependencies into the workspace', icon: 'cloud-download' },
  { id: 'push', label: 'Push', detail: 'Publish artifacts to a configured registry', icon: 'cloud-upload' },
  { id: 'import', label: 'Import…', detail: 'Import a foreign source into Aggrega', icon: 'arrow-into' },
  { id: 'cache', label: 'Cache…', detail: 'Inspect or maintain the local cache', icon: 'database' },
];

// OperationsTreeProvider backs the Operations view in the Aggrega activity-bar
// container: one leaf per operation, each carrying the command that runs it on
// click. The surface is static, so no change events are emitted.
class OperationsTreeProvider implements vscode.TreeDataProvider<OperationDef> {
  getTreeItem(op: OperationDef): vscode.TreeItem {
    const item = new vscode.TreeItem(op.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = op.detail;
    item.iconPath = new vscode.ThemeIcon(op.icon);
    item.command = { command: `aggrega.op.${op.id}`, title: op.label };
    item.contextValue = `aggrega.op.${op.id}`;
    return item;
  }

  getChildren(): OperationDef[] {
    return OPERATIONS;
  }
}

// activateOperations registers the Operations view and one command per
// operation. The view id and command ids mirror the package.json contributions.
export function activateOperations(context: vscode.ExtensionContext, deps: OperationDeps): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.operations', new OperationsTreeProvider()),
  );

  const reg = (id: OperationId, handler: () => void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`aggrega.op.${id}`, handler));
  };

  reg('validate', () => { void deps.validateActiveDocument(); });
  reg('build', () => { void runReleaseScoped(deps, 'build'); });
  reg('lint', () => { void deps.runLint(); });
  reg('pull', () => { void runReleaseScoped(deps, 'pull'); });
  reg('push', () => runCli(deps, ['push']));
  reg('import', () => { void runImport(deps); });
  reg('cache', () => { void runCache(deps); });
}

// runReleaseScoped runs a command that requires a --release argument (build,
// pull). It resolves the Release first — the sole candidate when there is one,
// a quick-pick otherwise — then invokes `aggrega <verb> --release <path>`.
// Running the bare verb would fail: the CLI marks --release required.
async function runReleaseScoped(deps: OperationDeps, verb: 'build' | 'pull'): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = await resolveRelease(deps.listReleases, {
    placeHolder: `Aggrega: choose a Release to ${verb}`,
  });
  if (!release) { return; }
  runCli(deps, [verb, '--release', release]);
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
