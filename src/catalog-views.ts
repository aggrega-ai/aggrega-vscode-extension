// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import {
  CatalogFilter,
  CatalogRow,
  ENTITY_KINDS,
  FilterAction,
  SearchDoc,
  emptyFilter,
  filterRows,
  normalizeKinds,
  parseLimit,
  searchCatalog,
  splitValueList,
} from './catalog-search-run';
import { runCliJson } from './cli-json';
import { describeError } from './error-surfaces';
import { PluginListDoc, PluginNode, pluginNodes } from './plugins-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// CatalogDeps supplies the live state the plugins tree and the published-catalog
// search need: the anchored workspace root (the CLI runs there), the configured
// binary path, and the shared output channel for the product's own report.
export interface CatalogDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
}

// --- plugins tree -------------------------------------------------------

// PluginsTreeProvider renders the plugins the compiler can see as a two-group
// tree in the Aggrega activity-bar container.
//
// This module is the whole editor-coupled boundary of the surface: it maps an
// already-shaped row onto a tree item and delegates every decision to
// pluginNodes, which depends on no editor type and is therefore directly
// testable. Each expansion of the root re-runs the command, so a refresh is a
// change event.
class PluginsTreeProvider implements vscode.TreeDataProvider<PluginNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly deps: CatalogDeps) {}

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
        `${node.label} (${node.rows.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('extensions');
      return item;
    }
    const item = new vscode.TreeItem(node.row.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.row.description;
    item.tooltip = node.row.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.row.icon);
    return item;
  }

  async getChildren(node?: PluginNode): Promise<PluginNode[]> {
    if (node) {
      return node.kind === 'group'
        ? node.rows.map((row) => ({ kind: 'entry' as const, row }))
        : [];
    }
    return pluginNodes({
      getWorkspaceRoot: this.deps.getWorkspaceRoot,
      runPluginListJson: () =>
        runCliJson<PluginListDoc>(this.deps, ['plugin', 'list', '-o', 'json']),
      log: { appendLine: (text) => this.deps.output.appendLine(text) },
    });
  }
}

// --- published-catalog search ------------------------------------------

// searchPublished opens the filter list, runs the search the reader assembled,
// and offers the matches for selection; choosing one copies its reference to
// the clipboard so it can be pasted into an Aggregate.
//
// The filter is built in a list the reader returns to after each edit, rather
// than a fixed chain of prompts — see filterRows for why. Dismissing the list
// abandons the search; every facet editor returns to it.
async function searchPublished(deps: CatalogDeps): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    // Told before the filter is built, not after: asking a reader to assemble a
    // search and only then refusing to run it wastes the work. searchCatalog
    // checks this too and is the authoritative guard — this is the courtesy,
    // and it shows the same shared message, so one state is never worded twice.
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const filter = emptyFilter();

  for (;;) {
    const rows = filterRows(filter);
    const picked = await vscode.window.showQuickPick(
      rows.map((row) => ({
        label: row.label,
        description: row.description,
        detail: row.detail,
        action: row.action,
      })),
      {
        title: 'Aggrega: search published catalog',
        placeHolder: 'Narrow the search, then choose Search',
        ignoreFocusOut: true,
      },
    );
    if (!picked) { return; }
    if (picked.action === 'run') { break; }
    await editFacet(filter, picked.action);
  }

  const outcome = await searchCatalog(
    {
      getWorkspaceRoot: deps.getWorkspaceRoot,
      runSearchJson: (args) => runCliJson<SearchDoc>(deps, args),
      log: { appendLine: (text) => deps.output.appendLine(text) },
    },
    filter,
  );

  switch (outcome.kind) {
    case 'not-invoked':
    case 'no-matches':
      // A successful search that matched nothing, and a search never run
      // because nothing is anchored, are both plain answers rather than
      // failures — so neither is shown as an error.
      void vscode.window.showInformationMessage(outcome.message);
      return;
    case 'failed':
      // The index could not be read. The message is the product's own, which is
      // where the remediation lives, and the channel carries the full text.
      deps.output.show(true);
      void vscode.window.showErrorMessage(outcome.message);
      return;
    case 'matches':
      await offerMatches(outcome.rows);
      return;
  }
}

// editFacet opens the editor for one facet and writes the reader's answer back
// into the filter. A dismissed editor leaves the facet as it was, so backing out
// of one prompt never discards the rest of the filter.
//
// Kind is offered as a multi-select because its value set is closed and known.
// Labels, capability and plugin socket are typed, because their values are
// whatever a publisher declared and this surface contacts no registry to
// enumerate them — and the label selector's grammar belongs to the compiler, so
// it is passed through untouched for the product to accept or reject.
async function editFacet(filter: CatalogFilter, action: FilterAction): Promise<void> {
  switch (action) {
    case 'query': {
      const value = await vscode.window.showInputBox({
        title: 'Aggrega: query',
        prompt: 'Matched against each entity’s name and description. Leave empty to match any.',
        value: filter.query ?? '',
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; }
      filter.query = value.trim() || undefined;
      return;
    }
    case 'kinds': {
      const chosen = await vscode.window.showQuickPick(
        ENTITY_KINDS.map((kind) => ({ label: kind, picked: filter.kinds.includes(kind) })),
        {
          title: 'Aggrega: entity kinds',
          placeHolder: 'Select kinds to narrow to — selecting none matches any kind',
          canPickMany: true,
          ignoreFocusOut: true,
        },
      );
      if (chosen === undefined) { return; }
      filter.kinds = normalizeKinds(chosen.map((item) => item.label));
      return;
    }
    case 'selector': {
      const value = await vscode.window.showInputBox({
        title: 'Aggrega: label selector',
        prompt:
          'Selector over the entity’s catalog labels. Category is a label: component.aggrega.ai/category=compute',
        value: filter.selector ?? '',
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; }
      filter.selector = value.trim() || undefined;
      return;
    }
    case 'capabilities': {
      const value = await vscode.window.showInputBox({
        title: 'Aggrega: plugin capabilities',
        prompt: 'One or more capabilities, comma-separated. A plugin declaring any one is kept.',
        value: filter.capabilities.join(', '),
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; }
      filter.capabilities = splitValueList(value);
      return;
    }
    case 'pluginType': {
      const value = await vscode.window.showInputBox({
        title: 'Aggrega: plugin type',
        prompt: 'The socket a plugin is attached at, for example provider, governance, linter.',
        value: filter.pluginType ?? '',
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; }
      filter.pluginType = value.trim() || undefined;
      return;
    }
    case 'limit': {
      const value = await vscode.window.showInputBox({
        title: 'Aggrega: limit',
        prompt: 'How many results at most. Leave empty for no cap.',
        value: filter.limit === undefined ? '' : String(filter.limit),
        ignoreFocusOut: true,
        // Validating here keeps a typo from becoming a cap that silently hides
        // results. It is the one client-side check in this surface, and it is
        // about this box rather than about the catalog: the number never reaches
        // the compiler as anything but a count.
        validateInput: (text) => {
          const parsed = parseLimit(text);
          return 'error' in parsed ? parsed.error : undefined;
        },
      });
      if (value === undefined) { return; }
      const parsed = parseLimit(value);
      if ('error' in parsed) { return; }
      filter.limit = parsed.limit;
      return;
    }
    case 'run':
      return;
  }
}

// offerMatches presents the result for selection and copies the chosen
// entity's reference, which is what a reader pastes into an Aggregate.
async function offerMatches(rows: CatalogRow[]): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    rows.map((row) => ({
      label: row.label,
      description: row.description,
      detail: row.detail,
      uri: row.uri,
    })),
    {
      placeHolder: `${rows.length} match(es) — select to copy the reference`,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!pick) { return; }
  await vscode.env.clipboard.writeText(pick.uri);
  void vscode.window.showInformationMessage(`Aggrega: copied ${pick.uri}`);
}

// activateCatalogViews registers the plugins tree, its refresh command, and the
// published-catalog search command. View and command ids mirror package.json.
export function activateCatalogViews(context: vscode.ExtensionContext, deps: CatalogDeps): void {
  const plugins = new PluginsTreeProvider(deps);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aggrega.plugins', plugins),
    vscode.commands.registerCommand('aggrega.plugins.refresh', () => plugins.refresh()),
    vscode.commands.registerCommand('aggrega.catalog.searchPublished', () => {
      void searchPublished(deps).then(undefined, (err) => {
        // Forensic catch: a rejection from the filter list or the clipboard
        // would otherwise vanish with no trace of why the search stopped.
        deps.output.appendLine(`search failed: ${describeError(err)}`);
      });
    }),
  );
}
