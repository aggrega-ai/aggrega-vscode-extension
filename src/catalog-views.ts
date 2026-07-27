// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'child_process';
import * as vscode from 'vscode';

// CatalogDeps supplies the live state the plugins tree and the published-catalog
// search need: the anchored workspace root (the CLI runs there), the configured
// binary path, and the shared output channel for failure detail.
export interface CatalogDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
}

// --- CLI JSON shapes (mirror the aggrega serializers) -------------------

// PluginEntry mirrors one entry of `aggrega plugin list --json`.
interface PluginEntry {
  uri: string;
  type?: string;
  version?: string;
  commit?: string;
  capabilities?: string[];
  inputKinds?: string[];
  boundary?: string;
  exports?: string[];
  origin?: string;
  readiness?: string;
  error?: string;
}

interface PluginListDoc {
  embedded: PluginEntry[];
  configured: PluginEntry[];
}

// IndexRecord mirrors one record of `aggrega search -o json`.
interface IndexRecord {
  uri: string;
  name: string;
  version: string;
  kind?: string;
  description?: string;
  category?: string;
}

interface SearchDoc {
  updated?: Record<string, string>;
  records?: IndexRecord[];
}

// --- plugins tree -------------------------------------------------------

type PluginNode =
  | { kind: 'group'; label: string; entries: PluginEntry[] }
  | { kind: 'entry'; entry: PluginEntry }
  | { kind: 'message'; label: string };

// PluginsTreeProvider renders `aggrega plugin list --json` as a two-group tree
// (embedded / configured) in the Aggrega activity-bar container. Each expansion
// of the root re-runs the CLI, so a refresh is a change event.
class PluginsTreeProvider implements vscode.TreeDataProvider<PluginNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: CatalogDeps) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(node: PluginNode): vscode.TreeItem {
    if (node.kind === 'message') {
      return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${node.entries.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('extensions');
      return item;
    }
    const e = node.entry;
    const item = new vscode.TreeItem(shortUri(e.uri), vscode.TreeItemCollapsibleState.None);
    item.description = [e.type, e.version].filter(Boolean).join(' ');
    item.tooltip = pluginTooltip(e);
    item.iconPath = new vscode.ThemeIcon(e.error ? 'warning' : 'plug');
    return item;
  }

  async getChildren(node?: PluginNode): Promise<PluginNode[]> {
    if (node) {
      return node.kind === 'group' ? node.entries.map((entry) => ({ kind: 'entry', entry })) : [];
    }
    const root = this.deps.getWorkspaceRoot();
    if (!root) {
      return [{ kind: 'message', label: 'No anchored workspace.' }];
    }
    let doc: PluginListDoc;
    try {
      doc = await runCliJson<PluginListDoc>(this.deps, ['plugin', 'list', '--json']);
    } catch (err) {
      this.deps.output.appendLine(`plugin list failed: ${describe(err)}`);
      return [{ kind: 'message', label: 'plugin list failed — see the Aggrega output channel.' }];
    }
    return [
      { kind: 'group', label: 'Embedded', entries: doc.embedded ?? [] },
      { kind: 'group', label: 'Configured', entries: doc.configured ?? [] },
    ];
  }
}

// --- published-catalog search ------------------------------------------

// searchPublished prompts for a query, runs `aggrega search <q> -o json`, and
// offers the matches as a quick-pick; choosing one copies its URI to the
// clipboard so it can be pasted into an Aggregate.
async function searchPublished(deps: CatalogDeps): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage('Aggrega: no anchored workspace. Open a folder first.');
    return;
  }
  const query = await vscode.window.showInputBox({
    title: 'Aggrega: search published catalog',
    prompt: 'Search the configured registries for catalog entities',
    ignoreFocusOut: true,
  });
  if (!query) { return; }

  let doc: SearchDoc;
  try {
    doc = await runCliJson<SearchDoc>(deps, ['search', query, '-o', 'json']);
  } catch (err) {
    deps.output.appendLine(`search failed: ${describe(err)}`);
    void vscode.window.showErrorMessage('Aggrega: search failed — see the Aggrega output channel.');
    return;
  }

  const records = doc.records ?? [];
  if (records.length === 0) {
    void vscode.window.showInformationMessage(`Aggrega: no catalog matches for "${query}".`);
    return;
  }
  const items = records.map((r) => ({
    label: r.name || shortUri(r.uri),
    description: [r.kind, r.version].filter(Boolean).join(' '),
    detail: r.description ? `${r.uri} — ${r.description}` : r.uri,
    uri: r.uri,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${records.length} match(es) — select to copy the reference`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) { return; }
  await vscode.env.clipboard.writeText(pick.uri);
  void vscode.window.showInformationMessage(`Aggrega: copied ${pick.uri}`);
}

// --- shared CLI capture -------------------------------------------------

// runCliJson runs the binary with the given args in the anchored workspace root
// and parses stdout as JSON. It captures (rather than streams) because these
// surfaces consume the structured result; failures carry stderr to the caller.
function runCliJson<T>(deps: CatalogDeps, args: string[]): Promise<T> {
  const root = deps.getWorkspaceRoot();
  const bin = deps.getBinaryPath();
  return new Promise<T>((resolve, reject) => {
    execFile(bin, args, { cwd: root ?? undefined, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (parseErr) {
        reject(new Error(`could not parse ${args.join(' ')} output: ${(parseErr as Error).message}`));
      }
    });
  });
}

// activateCatalogViews registers the plugins tree, its refresh command, and the
// published-catalog search command. View and command ids mirror package.json.
export function activateCatalogViews(context: vscode.ExtensionContext, deps: CatalogDeps): void {
  const plugins = new PluginsTreeProvider(deps);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.plugins', plugins),
    vscode.commands.registerCommand('aggrega.plugins.refresh', () => plugins.refresh()),
    vscode.commands.registerCommand('aggrega.catalog.searchPublished', () => { void searchPublished(deps); }),
  );
}

function shortUri(uri: string): string {
  // Show the trailing path segment (entity name) while keeping the full URI in
  // the tooltip/detail.
  const noScheme = uri.replace(/^[a-z]+:\/\//i, '');
  const parts = noScheme.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : uri;
}

function pluginTooltip(e: PluginEntry): string {
  const lines = [e.uri];
  if (e.type) { lines.push(`type: ${e.type}`); }
  if (e.version) { lines.push(`version: ${e.version}`); }
  if (e.readiness) { lines.push(`readiness: ${e.readiness}`); }
  if (e.origin) { lines.push(`origin: ${e.origin}`); }
  if (e.capabilities && e.capabilities.length) { lines.push(`capabilities: ${e.capabilities.join(', ')}`); }
  if (e.inputKinds && e.inputKinds.length) { lines.push(`inputKinds: ${e.inputKinds.join(', ')}`); }
  if (e.error) { lines.push(`error: ${e.error}`); }
  return lines.join('\n');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
