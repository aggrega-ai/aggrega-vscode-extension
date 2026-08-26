// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { shortUri } from './uri-display';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// --- wire shapes (mirror `aggrega search -o json`) ------------------------

// IndexRecord is one record of the structured search result. Only uri, name and
// version are dependable; the rest is optional so a record missing a field is
// rendered as it arrived.
export interface IndexRecord {
  uri: string;
  name: string;
  version: string;
  kind?: string;
  description?: string;
  category?: string;
}

// SearchDoc is the top level of the structured result. records absent and
// records empty mean the same thing — nothing matched — and both are a
// successful answer.
export interface SearchDoc {
  updated?: Record<string, string>;
  records?: IndexRecord[];
}

// --- the filter ----------------------------------------------------------

// ENTITY_KINDS is the kind set offered for selection.
//
// It is a deliberate near-duplicate of the set `aggrega search --kind`
// documents, and it is here because a closed set can be offered as a choice
// while an open one cannot: a reader picking from a list does not have to know
// how a kind is spelled. The cost is that a kind added to the product later
// would not appear here until this list is extended; nothing breaks in the
// meantime, because an unselected kind simply contributes no flag.
export const ENTITY_KINDS = [
  'component',
  'feature',
  'recipe',
  'featurerecipe',
  'workload',
  'plugin',
] as const;

// CatalogFilter is the search as the reader has built it so far.
//
// Every field is optional or empty-by-default, and an unset field means NO
// FILTER on that facet rather than a filter over everything. That distinction is
// the whole reason the state is modelled rather than assembled inline: an unset
// facet must contribute no flag at all, so which records the product considers
// stays the product's default and never becomes a set this extension enumerated.
export interface CatalogFilter {
  // query is the free-text substring matched against name and description. The
  // product's positional argument is optional, so a filter with no query is a
  // legitimate search — one narrowed by facets alone.
  query?: string;
  // kinds and capabilities are repeatable facets. Each value becomes its own
  // flag occurrence, never a joined list, because the product's flags are
  // repeatable and a joined value would be matched as one literal.
  kinds: string[];
  capabilities: string[];
  // selector is a label selector, passed through untouched. Its grammar belongs
  // to the compiler: nothing here parses or validates it, so an expression the
  // product rejects is rejected by the product, with the product's own message.
  selector?: string;
  pluginType?: string;
  // limit caps the result count. It is unset by default and contributes no flag
  // when unset — a cap the reader did not ask for would silently make the count
  // this surface reports a claim about the catalog that is not true.
  limit?: number;
}

// emptyFilter is the starting state: nothing narrowed.
export function emptyFilter(): CatalogFilter {
  return { kinds: [], capabilities: [] };
}

// normalizeKinds puts a chosen kind set into the offered order.
//
// The order carries no meaning to the product — the kind facet is an OR — so
// this is about what the reader reads back: the filter summary must not depend
// on the order the boxes happened to be ticked in, or one filter would describe
// itself two ways. Anything not in the offered set is kept, at the end, rather
// than dropped: silently discarding a value would narrow a search without
// saying so.
export function normalizeKinds(kinds: string[]): string[] {
  const offered = ENTITY_KINDS.filter((kind) => kinds.includes(kind)) as string[];
  const extra = kinds.filter((kind) => !offered.includes(kind));
  return [...offered, ...extra];
}

// searchArgs builds the command line for a filter.
//
// The positional query goes directly after the verb, and every facet the reader
// left unset is OMITTED rather than expanded into a value: passing every kind
// when no kind was chosen would freeze today's default into this extension, and
// the two would part company the moment the product's default moved.
export function searchArgs(filter: CatalogFilter): string[] {
  const args = ['search'];
  const query = filter.query?.trim();
  if (query) {
    args.push(query);
  }
  for (const kind of filter.kinds) {
    args.push('--kind', kind);
  }
  for (const capability of filter.capabilities) {
    args.push('--capability', capability);
  }
  const selector = filter.selector?.trim();
  if (selector) {
    args.push('-l', selector);
  }
  const pluginType = filter.pluginType?.trim();
  if (pluginType) {
    args.push('--plugin-type', pluginType);
  }
  if (filter.limit !== undefined) {
    args.push('--limit', String(filter.limit));
  }
  args.push('-o', 'json');
  return args;
}

// ANY_VALUE_LABEL is how an unset facet reads in the filter list. It says the
// facet narrows nothing, which is what an unset facet does — as opposed to
// reading as a blank, which a reader could take for a value that failed to load.
export const ANY_VALUE_LABEL = 'any';

// describeFilter renders the filter as one short phrase, for the message a
// reader sees when a search returned nothing. Naming what was searched is what
// makes an empty result attributable to the filter rather than to the catalog.
export function describeFilter(filter: CatalogFilter): string {
  const parts: string[] = [];
  const query = filter.query?.trim();
  if (query) { parts.push(`"${query}"`); }
  if (filter.kinds.length) { parts.push(`kind ${filter.kinds.join(' or ')}`); }
  if (filter.capabilities.length) {
    parts.push(`capability ${filter.capabilities.join(' or ')}`);
  }
  const selector = filter.selector?.trim();
  if (selector) { parts.push(`labels ${selector}`); }
  const pluginType = filter.pluginType?.trim();
  if (pluginType) { parts.push(`plugin type ${pluginType}`); }
  if (parts.length === 0) {
    return 'the whole published catalog';
  }
  return parts.join(', ');
}

// splitValueList reads a reader-typed comma list into separate values.
//
// It exists because an open-ended facet cannot be offered as a choice — a
// capability is any string the publisher declared, and this surface contacts no
// registry to enumerate them — so it is typed. Values are trimmed and empties
// dropped, so a trailing comma or a stray space does not become a filter value
// that matches nothing.
export function splitValueList(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

// parseLimit reads a reader-typed result cap.
//
// An empty box means no cap, which is the product's own meaning for an omitted
// flag, so it returns undefined and the flag is left off entirely. Anything that
// is not a non-negative whole number is rejected rather than coerced: silently
// turning a typo into a cap would quietly hide results.
export function parseLimit(text: string): { limit?: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { limit: undefined };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { error: 'Enter a whole number, or leave the box empty for no cap.' };
  }
  return { limit: Number(trimmed) };
}

// --- rows ----------------------------------------------------------------

// CatalogRow is one record rendered for selection, with every string already
// decided, so the list is assertable without an extension host.
export interface CatalogRow {
  label: string;
  description: string;
  detail: string;
  // uri is what selecting the row yields, so it is carried rather than
  // re-derived from the displayed strings.
  uri: string;
}

// rowForRecord shapes one record. The name is the label where the index carried
// one, and the URI's trailing segment stands in where it did not.
export function rowForRecord(record: IndexRecord): CatalogRow {
  return {
    label: record.name || shortUri(record.uri),
    description: [record.kind, record.version].filter(Boolean).join(' '),
    detail: record.description ? `${record.uri} — ${record.description}` : record.uri,
    uri: record.uri,
  };
}

// --- outcomes ------------------------------------------------------------

// SearchOutcome is what one search produced. The four cases are distinct types
// rather than a message plus a flag, because three of them are easy to collapse
// and must not be:
//
//   - matches is a result to choose from;
//   - no-matches is a SUCCESSFUL answer: the index was read and nothing in it
//     fit the filter;
//   - failed is the opposite: the index could not be read at all — not built
//     yet, or no registry configured — so nothing is known about what matches.
//     Rendering it like no-matches would tell a reader the catalog lacks
//     something when the truth is that it was never consulted;
//   - not-invoked is the command never having run, because nothing is anchored.
export type SearchOutcome =
  | { kind: 'matches'; rows: CatalogRow[] }
  | { kind: 'no-matches'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'not-invoked'; message: string };

// CatalogSearchLog is the reader-visible channel the run appends to.
export interface CatalogSearchLog {
  appendLine(text: string): void;
}

// CatalogSearchRunDeps supplies the run's surfaces: the anchored root that
// decides whether the command can be invoked, the structured invocation, and
// the log carrying the product's own report.
export interface CatalogSearchRunDeps {
  getWorkspaceRoot(): string | null;
  // runSearchJson invokes the structured search with the given arguments. It
  // resolves the parsed document together with whatever the product wrote to
  // stderr, and rejects with the product's own message when the index could not
  // be read.
  runSearchJson(args: string[]): Promise<{ doc: SearchDoc; stderr: string }>;
  log: CatalogSearchLog;
}

// searchCatalog runs one search and classifies what came back.
//
// A successful run writes a freshness line to stderr naming each registry
// searched and when its index was last updated. It is appended to the log
// verbatim: it is how a reader knows whether an absent entity is missing from
// the catalog or merely missing from a stale local index, and the product has
// already worded it.
//
// A failure carries the product's own message, which is where the remediation
// lives — the command names the step to run when no index has been built. That
// text reaches the reader instead of a re-worded wrapper, so the hint a reader
// needs is the product's own rather than a second rendering of it.
export async function searchCatalog(
  deps: CatalogSearchRunDeps,
  filter: CatalogFilter,
): Promise<SearchOutcome> {
  if (!deps.getWorkspaceRoot()) {
    return { kind: 'not-invoked', message: NO_ANCHORED_WORKSPACE_MESSAGE };
  }
  let result: { doc: SearchDoc; stderr: string };
  try {
    result = await deps.runSearchJson(searchArgs(filter));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.appendLine(message);
    return { kind: 'failed', message };
  }

  const report = result.stderr.trim();
  if (report) {
    deps.log.appendLine(report);
  }

  const records = result.doc.records ?? [];
  if (records.length === 0) {
    return {
      kind: 'no-matches',
      message: `Aggrega: no catalog matches for ${describeFilter(filter)}.`,
    };
  }
  return { kind: 'matches', rows: records.map(rowForRecord) };
}

// --- the filter list -----------------------------------------------------

// FilterAction is what selecting a row in the filter list does: edit one facet,
// or run the search as it now stands.
export type FilterAction =
  | 'query'
  | 'kinds'
  | 'capabilities'
  | 'selector'
  | 'pluginType'
  | 'limit'
  | 'run';

// FilterRow is one row of the filter list, with its strings already decided so
// the affordance a reader sees is assertable without an extension host.
export interface FilterRow {
  action: FilterAction;
  label: string;
  // description shows the facet's CURRENT value, so the whole filter is
  // readable at a glance before it is run and a reader never has to remember
  // what they set two steps ago.
  description: string;
  detail: string;
}

// RUN_ROW_LABEL is the row that runs the search.
export const RUN_ROW_LABEL = 'Search';

// filterRows renders the filter as a list of editable facets plus the row that
// runs it.
//
// Each row's label is the name the product's own flag carries — Query, Kind,
// Label selector, Capability, Plugin type, Limit — rather than a friendlier
// synonym. A second name for one facet would leave a reader who set it here
// unable to find it on the command line, which is the whole cost of naming one
// concept twice.
//
// The shape is one list rather than a fixed sequence of prompts on purpose. A
// chain of prompts forces every facet to be answered in an order the reader did
// not choose, offers no way back to one already passed, and loses the whole
// filter on a single dismissal. A list lets a reader set only the facets they
// care about, in any order, revisit one, and read the complete filter before
// running it — and it makes "narrows nothing" a visible value rather than an
// absence a reader has to infer.
export function filterRows(filter: CatalogFilter): FilterRow[] {
  const query = filter.query?.trim();
  const selector = filter.selector?.trim();
  const pluginType = filter.pluginType?.trim();
  return [
    {
      action: 'query',
      label: 'Query',
      description: query || ANY_VALUE_LABEL,
      detail: 'Match this text against each entity’s name and description',
    },
    {
      action: 'kinds',
      label: 'Kind',
      description: filter.kinds.length ? filter.kinds.join(', ') : ANY_VALUE_LABEL,
      detail: 'Limit the result to one or more entity kinds',
    },
    {
      action: 'selector',
      label: 'Label selector',
      description: selector || ANY_VALUE_LABEL,
      detail: 'Select on the entity’s catalog labels, category included',
    },
    {
      action: 'capabilities',
      label: 'Capability',
      description: filter.capabilities.length
        ? filter.capabilities.join(', ')
        : ANY_VALUE_LABEL,
      detail: 'Keep plugins declaring any one of these capabilities',
    },
    {
      action: 'pluginType',
      label: 'Plugin type',
      description: pluginType || ANY_VALUE_LABEL,
      detail: 'Keep plugins attached at this socket',
    },
    {
      action: 'limit',
      label: 'Limit',
      description: filter.limit === undefined ? 'no cap' : String(filter.limit),
      detail: 'Cap how many results come back',
    },
    {
      action: 'run',
      label: RUN_ROW_LABEL,
      description: describeFilter(filter),
      detail: 'Search the configured registries with the filter above',
    },
  ];
}
