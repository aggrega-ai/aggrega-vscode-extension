// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import {
  CatalogFilter,
  CatalogRow,
  ENTITY_KINDS,
  FacetAction,
  KeptFilter,
  RegistrySearchParams,
  SearchDoc,
  chooseFilter,
  emptyFilter,
  normalizeKinds,
  parseLimit,
  searchCatalog,
  splitValueList,
} from './catalog-search-run';
import { describeError } from './error-surfaces';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// CatalogDeps supplies the live state the published-catalog search needs: the
// anchored workspace root that decides whether the search can be asked for, the
// request that carries it to the compiler, and the shared output channel that
// records what was searched.
//
// It needs no readiness signal. A search is asked for when a reader asks for it
// and checks the anchored root then, rather than rendering something now that a
// later signal would have to supersede.
export interface CatalogDeps {
  getWorkspaceRoot(): string | null;
  runSearch(params: RegistrySearchParams): Promise<SearchDoc>;
  output: vscode.OutputChannel;
}

// --- published-catalog search ------------------------------------------

// searchPublished opens the filter list on the kept filter, runs the search the
// reader assembled, and offers the matches for selection; choosing one copies
// its reference to the clipboard so it can be pasted into an Aggregate.
//
// The filter is built in a list the reader returns to after each edit, rather
// than a fixed chain of prompts — see filterRows for why — and chooseFilter
// decides what each row does. Dismissing the list abandons the search and keeps
// the filter as it stands; every facet editor returns to it.
async function searchPublished(deps: CatalogDeps, kept: KeptFilter): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    // Told before the filter is built, not after: asking a reader to assemble a
    // search and only then refusing to run it wastes the work. searchCatalog
    // checks this too and is the authoritative guard — this is the courtesy,
    // and it shows the same shared message, so one state is never worded twice.
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const filter = await chooseFilter(kept, {
    pick: async (rows) => {
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
      return picked?.action;
    },
    editFacet,
  });
  if (!filter) { return; }

  const outcome = await searchCatalog(
    {
      getWorkspaceRoot: deps.getWorkspaceRoot,
      runSearch: deps.runSearch,
      log: { appendLine: (text) => deps.output.appendLine(text) },
    },
    filter,
  );

  switch (outcome.kind) {
    case 'not-invoked':
    case 'no-matches':
    case 'no-registries':
      // A successful search that matched nothing, a workspace that configures no
      // registry to search, and a search never asked for because nothing is
      // anchored are all plain answers rather than failures — so none is shown
      // as an error. The one that names something to do says so in its own
      // message rather than by being dressed as a fault.
      void vscode.window.showInformationMessage(outcome.message);
      return;
    case 'failed':
      // The snapshot could not be read. The message is the compiler's own, which
      // is where the remediation lives, and the channel carries the full text.
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
async function editFacet(filter: CatalogFilter, action: FacetAction): Promise<void> {
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

// activateCatalogViews registers the published-catalog search command. Command
// ids mirror package.json.
//
// The filter each search opens with is held here, for as long as the extension
// runs in this window, and nowhere else: it is in no setting and no stored
// state, so it never changes what another surface or another window searches
// for, and a window that is reloaded opens its first search on an empty filter.
export function activateCatalogViews(context: vscode.ExtensionContext, deps: CatalogDeps): void {
  const kept: KeptFilter = { filter: emptyFilter() };
  context.subscriptions.push(
    vscode.commands.registerCommand('aggrega.catalog.searchPublished', () => {
      void searchPublished(deps, kept).then(undefined, (err) => {
        // Forensic catch: a rejection from the filter list or the clipboard
        // would otherwise vanish with no trace of why the search stopped.
        deps.output.appendLine(`search failed: ${describeError(err)}`);
      });
    }),
  );
}
