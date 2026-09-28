// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { describeError } from './error-surfaces';
import { panelActionLabel } from './operation-groups';
import { EMPTY_LABEL } from './registries-run';
import { shortUri } from './uri-display';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// The compiler owns the search and this module owns what the answer means to a
// reader. Nothing here searches, ranks or filters: the request names the facets
// the reader set, and every sentence below is composed from fields the answer
// carried or from the compiler's own text.
//
// 🔴 NOTHING HERE CAN BE STOPPED, AND THE ABSENCE OF A STOP IS THE DECISION. A
// search reads an offline snapshot under the workspace's own cache directory and
// contacts no registry, but the shared operation behind the request takes no
// cancellation: nothing is passed to it that could carry one, and the request
// handler checks for a stopped caller only after its operation has already
// returned, at which point all it can do is withhold the reply. So a stop
// offered here could only ever stop the editor waiting, never the work — and
// presenting that as a stop would break the rule that stopping means the
// compiler stopped. No signal is accepted anywhere in this module.
//
// Silence is not the alternative. Every ending produces a sentence, and the
// freshness of what was searched reaches the channel whether or not anything
// matched.

// --- wire shapes (mirror the aggrega/search request and answer) -----------

// RegistrySearchParams is what this client sends to search the published
// catalog.
//
// Every field narrows and every one is optional: an absent field imposes no
// constraint, so a request with none asks for everything the snapshot holds.
// A facet the reader left unset is OMITTED rather than expanded into a value —
// sending every kind when no kind was chosen would freeze today's default into
// this extension, and the two would part company the moment the compiler's
// default moved.
//
// The operation also accepts a single-registry narrowing and an
// include-retracted override, and this client offers neither, so neither is
// declared here: a declared field is a field a later call site will fill.
export type RegistrySearchParams = Pick<
  wire.SearchParams,
  'query' | 'kinds' | 'selector' | 'capabilities' | 'pluginType' | 'limit'
>;

// IndexRecord is one record of the search answer. Only uri, name and version are
// dependable; the rest is optional so a record missing a field is rendered as it
// arrived.
//
// The answer also carries, per record, the versions a resolution would refuse.
// That is not declared here: presenting screened-out versions is a decision
// about what this list shows, and a declared field is a field a later call site
// will read.
export type IndexRecord = Pick<
  wire.RegistrySearchRecord,
  'uri' | 'name' | 'version' | 'kind' | 'description' | 'category'
>;

// SearchIndex is one searched registry's freshness. lastUpdated is absent rather
// than zero when the snapshot carries no timestamp, so "not recorded" is
// distinguishable from a date.
export type SearchIndex = wire.RegistrySearchIndex;

// SearchDoc is the answer one search produced.
//
// The provenance travels with the result rather than beside it, which is what
// makes a thin result attributable. A search is answered from an offline
// snapshot, so a reader acting on it needs to know which registries were
// consulted, how old each snapshot is, which configured registries could not be
// consulted at all, and whether the compiler judges any of them stale.
//
// registriesConfigured is read off the answer and never inferred. A workspace
// that configures no registry is a different answer from a search that matched
// nothing, and deriving one from the other would report a fact the compiler did
// not send.
export type SearchDoc = wire.SearchResult;

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

// searchParams composes the request for a filter.
//
// A facet the reader left unset contributes no key at all, so which records the
// compiler considers stays the compiler's default and never becomes a set this
// extension enumerated. A trimmed-to-empty text facet counts as unset: a box
// holding only spaces is a box nobody filled in.
//
// An explicitly typed limit is sent even when it is zero, because zero is a
// value the compiler already reads as no cap and this surface is not a second
// answer to what a limit means.
export function searchParams(filter: CatalogFilter): RegistrySearchParams {
  const params: RegistrySearchParams = {};
  const query = filter.query?.trim();
  if (query) {
    params.query = query;
  }
  if (filter.kinds.length > 0) {
    params.kinds = [...filter.kinds];
  }
  const selector = filter.selector?.trim();
  if (selector) {
    params.selector = selector;
  }
  if (filter.capabilities.length > 0) {
    params.capabilities = [...filter.capabilities];
  }
  const pluginType = filter.pluginType?.trim();
  if (pluginType) {
    params.pluginType = pluginType;
  }
  if (filter.limit !== undefined) {
    params.limit = filter.limit;
  }
  return params;
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

// NO_REGISTRIES_MESSAGE is what a reader is told when the configuration names no
// registry at all.
//
// It opens with the compiler's own sentence for that state, which the registries
// view already shows for the same fact — a DELIBERATE reuse, so the two surfaces
// cannot come to word one state differently, and it is imported rather than
// retyped so there is nothing to keep in step. What is added is the consequence
// for a search and the two affordances this reader actually has — the first two
// rows of the Registries panel — named in the words those rows carry, which are
// read from the one place that draws them; the compiler words its own
// remediation as a command line, which is not where the reader of this message
// is.
export const NO_REGISTRIES_MESSAGE =
  `Aggrega: ${EMPTY_LABEL} Add one with “${panelActionLabel('registryAdd')}” in the `
  + `Registries panel, then build its index with “${panelActionLabel('registryIndex')}”.`;

// REFRESH_REMEDIATION names the editor's own way to fix a missing or stale
// snapshot. The compiler names a command line for the same repair; this reader
// is in an editor, and the Registries panel's row is the thing they can press,
// named in the words it carries.
export const REFRESH_REMEDIATION =
  `Refresh with “${panelActionLabel('registryIndex')}” in the Registries panel.`;

// SearchOutcome is what one search produced. The five cases are distinct types
// rather than a message plus a flag, because four of them are easy to collapse
// and must not be:
//
//   - matches is a result to choose from;
//   - no-matches is a SUCCESSFUL answer: the snapshot was read and nothing in it
//     fit the filter;
//   - no-registries is the configuration naming no registry, so there was no
//     snapshot to consult. It is told apart from no-matches because one means
//     "nothing published fits" and the other means "nothing was searched", and
//     from failed because nothing went wrong;
//   - failed is the snapshot not being readable at all, so nothing is known
//     about what matches. Rendering it like no-matches would tell a reader the
//     catalog lacks something when the truth is that it was never consulted;
//   - not-invoked is the search never having run, because nothing is anchored.
export type SearchOutcome =
  | { kind: 'matches'; rows: CatalogRow[] }
  | { kind: 'no-matches'; message: string }
  | { kind: 'no-registries'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'not-invoked'; message: string };

// freshnessReport renders what was searched and how current it was, one line per
// fact, for the channel.
//
// It is how a reader tells an entity missing from the published catalog from one
// missing only out of a stale local snapshot, and it is composed from the
// answer's own fields rather than from a rendering of them: the hosts consulted,
// the timestamp each snapshot carries, the configured hosts that had no snapshot
// to consult, and the compiler's own staleness verdict — which is read as a
// value and never re-derived here, because judging a snapshot old is the
// compiler's call and a second rule would be free to disagree.
//
// The remediation is appended once rather than per host, so a reader with
// several unbuilt registries is told what to do once.
export function freshnessReport(doc: SearchDoc): string[] {
  const lines: string[] = [];
  const missing = doc.missingIndexHosts ?? [];
  for (const host of missing) {
    lines.push(`registry ${host}: no local index has been built.`);
  }
  for (const index of doc.indexes ?? []) {
    lines.push(
      index.lastUpdated
        ? `Index for ${index.host} last updated ${index.lastUpdated}`
        : `Index for ${index.host} last updated (timestamp unavailable)`,
    );
  }
  const stale = doc.stale === true;
  if (stale) {
    lines.push('One or more indexes are stale.');
  }
  if (missing.length > 0 || stale) {
    lines.push(REFRESH_REMEDIATION);
  }
  return lines;
}

// CatalogSearchLog is the reader-visible channel the run appends to.
export interface CatalogSearchLog {
  appendLine(text: string): void;
}

// CatalogSearchRunDeps supplies the run's surfaces: the anchored root that
// decides whether the search can be asked for at all, the request itself, and
// the log carrying what was searched.
//
// It is declared this narrowly so the surface that owns the command passes its
// own richer dependency set here unchanged, and so a test drives the whole
// decision with a fake answer and no transport at all. It takes no cancellation,
// for the reason stated at the head of this module.
export interface CatalogSearchRunDeps {
  getWorkspaceRoot(): string | null;
  // runSearch asks the compiler for the search. It resolves the answer, and
  // rejects with the compiler's own refusal when the snapshot could not be read.
  runSearch(params: RegistrySearchParams): Promise<SearchDoc>;
  log: CatalogSearchLog;
}

// searchCatalog runs one search and classifies what came back.
//
// The freshness of what was searched reaches the channel before the result is
// classified, so it is there whether anything matched or not — the order matters
// because a reader looking at an empty result is exactly the reader who needs to
// know how old the snapshot was.
//
// The three empty answers are separated by reading the answer rather than by
// inferring from the record count: a configuration naming no registry says so in
// its own field, and it is checked FIRST, because such an answer also carries no
// records and would otherwise be reported as a catalog that holds nothing
// matching.
//
// A refusal is classified through the extension's one home for that, so the
// compiler's own diagnostic travels intact — including the one naming what to
// build when no snapshot exists.
export async function searchCatalog(
  deps: CatalogSearchRunDeps,
  filter: CatalogFilter,
): Promise<SearchOutcome> {
  if (!deps.getWorkspaceRoot()) {
    return { kind: 'not-invoked', message: NO_ANCHORED_WORKSPACE_MESSAGE };
  }
  let doc: SearchDoc;
  try {
    doc = await deps.runSearch(searchParams(filter));
  } catch (err) {
    const message = describeError(err);
    deps.log.appendLine(message);
    return { kind: 'failed', message };
  }

  for (const line of freshnessReport(doc)) {
    deps.log.appendLine(line);
  }

  if (doc.registriesConfigured === false) {
    return { kind: 'no-registries', message: NO_REGISTRIES_MESSAGE };
  }

  const records = doc.records ?? [];
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
