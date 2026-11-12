// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import {
  ANY_VALUE_LABEL,
  CatalogFilter,
  ENTITY_KINDS,
  FilterAction,
  FilterListDeps,
  FilterRow,
  IndexRecord,
  KeptFilter,
  NOTHING_SET_LABEL,
  NO_REGISTRIES_MESSAGE,
  RESET_ROW_LABEL,
  RUN_ROW_LABEL,
  RegistrySearchParams,
  STALE_LINE,
  SearchDoc,
  SearchOutcome,
  chooseFilter,
  describeFilter,
  emptyFilter,
  filterRows,
  freshnessReport,
  noMatchesMessage,
  normalizeKinds,
  notSearched,
  parseLimit,
  rowForRecord,
  searchCatalog,
  searchParams,
  splitValueList,
} from '../../src/catalog-search-run';
import { PANEL_ACTIONS } from '../../src/operation-groups';
import { EMPTY_LABEL } from '../../src/registries-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from '../../src/workspace';

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

interface Harness {
  search(filter: CatalogFilter): Promise<SearchOutcome>;
  log: FakeLog;
  sent(): RegistrySearchParams[];
}

// 🔴 A FIXTURE HERE CARRIES ONLY THE MEMBERS THE TEST UNDER IT IS ABOUT. The
// published answer carries every one of them, so each fixture below is narrower
// than anything the compiler sends — deliberately, because a whole answer
// restated per test hides which member the test is actually about. The widening
// happens here and at `partialDoc` below, in one place each, so no fixture
// carries a cast of its own.
function harness(
  root: string | null,
  answer: () => Promise<Partial<SearchDoc>>,
): Harness {
  const log = new FakeLog();
  const seen: RegistrySearchParams[] = [];
  return {
    log,
    sent: () => seen,
    search: (filter) =>
      searchCatalog(
        {
          getWorkspaceRoot: () => root,
          runSearch: (params) => {
            seen.push(params);
            return answer() as Promise<SearchDoc>;
          },
          log,
        },
        filter,
      ),
  };
}

// A workspace configuring at least one registry, so an answer under test is
// classified on its records rather than on the no-registry branch. Written out
// per answer where it matters, because the branch order is itself asserted.
const CONFIGURED = { registriesConfigured: true } as const;

// partialDoc widens a fixture to the published answer, for the readers that take
// one directly rather than through the harness above.
function partialDoc(doc: Partial<SearchDoc>): SearchDoc {
  return doc as SearchDoc;
}

const RECORD: IndexRecord = {
  uri: 'oci://hub.aggrega.ai/component/core/service:1.2.0',
  name: 'service',
  version: '1.2.0',
  kind: 'component',
  description: 'A long-running workload',
};

// --- the request ---------------------------------------------------------

describe('catalog-search-run: the request', () => {
  it('an untouched filter carries NO KEY AT ALL', () => {
    // Every facet the reader left alone must be OMITTED. Expanding an unset
    // facet into every value would freeze today's default into this extension.
    // Asserted as the whole object rather than key by key, so a field added
    // later has to be argued for here.
    assert.deepStrictEqual(searchParams(emptyFilter()), {});
    assert.deepStrictEqual(Object.keys(searchParams(emptyFilter())), []);
  });

  it('the free-text query travels as its own field', () => {
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), query: 'postgres' }), {
      query: 'postgres',
    });
  });

  it('a whitespace-only query contributes no field', () => {
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), query: '   ' }), {});
  });

  it('the query is trimmed rather than sent with the reader’s spacing', () => {
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), query: '  postgres ' }), {
      query: 'postgres',
    });
  });

  it('kinds travel as a list, never as one comma-joined literal', () => {
    const params = searchParams({ ...emptyFilter(), kinds: ['component', 'feature'] });
    assert.deepStrictEqual(params, { kinds: ['component', 'feature'] });
    assert.ok(
      !params.kinds!.some((k) => k.includes(',')),
      'a comma-joined value would be matched as one literal',
    );
  });

  it('capabilities travel as a list too', () => {
    assert.deepStrictEqual(
      searchParams({ ...emptyFilter(), capabilities: ['helm', 'parse:hcl'] }),
      { capabilities: ['helm', 'parse:hcl'] },
    );
  });

  it('a repeatable facet is COPIED, so a later edit cannot mutate a sent request', () => {
    const filter = { ...emptyFilter(), kinds: ['component'] };
    const params = searchParams(filter);
    filter.kinds.push('feature');
    assert.deepStrictEqual(params.kinds, ['component']);
  });

  it('the label selector is passed through untouched', () => {
    // Its grammar belongs to the compiler. Nothing here parses or rewrites it,
    // so an expression the compiler rejects is rejected by the compiler.
    const selector = 'component.aggrega.ai/category in (compute,data),!deprecated';
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), selector }), { selector });
  });

  it('the plugin socket is a single-valued field', () => {
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), pluginType: 'provider' }), {
      pluginType: 'provider',
    });
  });

  it('an unset cap contributes no field', () => {
    assert.ok(!('limit' in searchParams(emptyFilter())));
  });

  it('a cap of zero is sent, because zero is the compiler’s own "no cap"', () => {
    // An omitted field and an explicit zero reach the same reading in the
    // compiler, so this is not a correctness fix — it is that a reader who typed
    // a value has the value they typed sent.
    assert.deepStrictEqual(searchParams({ ...emptyFilter(), limit: 0 }), { limit: 0 });
  });

  it('every facet together, in one request', () => {
    assert.deepStrictEqual(
      searchParams({
        query: 'db',
        kinds: ['component'],
        capabilities: ['helm'],
        selector: 'a=b',
        pluginType: 'provider',
        limit: 25,
      }),
      {
        query: 'db',
        kinds: ['component'],
        capabilities: ['helm'],
        selector: 'a=b',
        pluginType: 'provider',
        limit: 25,
      },
    );
  });

  it('the request declares no transport or format concern', () => {
    // The answer is structured because it is a request. Nothing asks for a
    // format, names a verb, or carries a flag — a field doing any of those would
    // be this surface composing a command line again.
    const params = searchParams({
      query: 'db',
      kinds: ['component'],
      capabilities: ['helm'],
      selector: 'a=b',
      pluginType: 'provider',
      limit: 25,
    });
    assert.deepStrictEqual(Object.keys(params).sort(), [
      'capabilities', 'kinds', 'limit', 'pluginType', 'query', 'selector',
    ]);
  });
});

// --- reader input --------------------------------------------------------

describe('catalog-search-run: reader input', () => {
  it('a comma list becomes separate values, trimmed', () => {
    assert.deepStrictEqual(splitValueList(' helm , parse:hcl '), ['helm', 'parse:hcl']);
  });

  it('empty segments are dropped rather than becoming values matching nothing', () => {
    assert.deepStrictEqual(splitValueList('helm,,  ,'), ['helm']);
    assert.deepStrictEqual(splitValueList(''), []);
  });

  it('an empty cap box means no cap', () => {
    assert.deepStrictEqual(parseLimit(''), { limit: undefined });
    assert.deepStrictEqual(parseLimit('  '), { limit: undefined });
  });

  it('a whole number is a cap', () => {
    assert.deepStrictEqual(parseLimit('50'), { limit: 50 });
    assert.deepStrictEqual(parseLimit('0'), { limit: 0 });
  });

  it('anything else is rejected rather than coerced', () => {
    // Coercing a typo into a cap would silently hide results.
    for (const bad of ['5o', '-1', '1.5', 'all', '1e3']) {
      assert.ok('error' in parseLimit(bad), `${bad} should be rejected`);
    }
  });
});

// --- the filter list ----------------------------------------------------

describe('catalog-search-run: the filter list', () => {
  it('🔴 THE ROWS READ IN ONE ORDER, THE RESET JUST ABOVE SEARCH', () => {
    // The whole list, by equality, so a row added, dropped or moved is a diff
    // here. The reset sits penultimate and Search stays last, so the row a
    // reader reaches for to run the filter is where it always is.
    assert.deepStrictEqual(filterRows(emptyFilter()).map((r) => [r.action, r.label]), [
      ['query', 'Query'],
      ['kinds', 'Kind'],
      ['selector', 'Label selector'],
      ['capabilities', 'Capability'],
      ['pluginType', 'Plugin type'],
      ['limit', 'Limit'],
      ['reset', 'Reset search filter'],
      ['run', 'Search'],
    ]);
    assert.strictEqual(RESET_ROW_LABEL, 'Reset search filter');
  });

  it('the reset row keeps its place whatever is set', () => {
    // Were it drawn only when something is set, Search would move up a row
    // between one opening of the list and the next.
    const set = filterRows({ ...emptyFilter(), query: 'db', kinds: ['component'], limit: 5 });
    assert.deepStrictEqual(
      set.map((r) => r.label),
      filterRows(emptyFilter()).map((r) => r.label),
    );
  });

  it('an untouched filter shows every facet as narrowing nothing', () => {
    const rows = filterRows(emptyFilter());
    const facets = rows.filter((r) => r.action !== 'run' && r.action !== 'reset' && r.action !== 'limit');
    assert.ok(facets.length > 0);
    for (const row of facets) {
      assert.strictEqual(row.description, ANY_VALUE_LABEL, row.label);
    }
  });

  it('the cap reads as no cap rather than as a value', () => {
    const cap = filterRows(emptyFilter()).find((r) => r.action === 'limit');
    assert.strictEqual(cap?.description, 'no cap');
  });

  it('every facet the request can carry is reachable from the list', () => {
    // A facet with no row is a field no reader can set.
    const actions = new Set(filterRows(emptyFilter()).map((r) => r.action));
    for (const action of ['query', 'kinds', 'selector', 'capabilities', 'pluginType', 'limit']) {
      assert.ok(actions.has(action as never), `${action} is unreachable`);
    }
  });

  it('the list ends with the row that runs the search', () => {
    const rows = filterRows(emptyFilter());
    assert.strictEqual(rows[rows.length - 1].action, 'run');
    assert.strictEqual(rows[rows.length - 1].label, RUN_ROW_LABEL);
  });

  it('each facet is labelled with the name the product’s own flag carries', () => {
    // One concept, one name. A friendlier synonym here would leave a reader who
    // set a facet in the editor unable to find it on the command line.
    const byAction = new Map(filterRows(emptyFilter()).map((r) => [r.action, r.label]));
    assert.strictEqual(byAction.get('query'), 'Query');
    assert.strictEqual(byAction.get('kinds'), 'Kind');
    assert.strictEqual(byAction.get('selector'), 'Label selector');
    assert.strictEqual(byAction.get('capabilities'), 'Capability');
    assert.strictEqual(byAction.get('pluginType'), 'Plugin type');
    assert.strictEqual(byAction.get('limit'), 'Limit');
  });

  it('no facet label introduces a word the command line does not use', () => {
    // Each label reduces to the flag it sets: --kind, --selector, --capability,
    // --plugin-type, --limit, and the positional query.
    const labels = filterRows(emptyFilter())
      .filter((r) => r.action !== 'run' && r.action !== 'reset')
      .map((r) => r.label.toLowerCase());
    for (const label of labels) {
      const flagWord = label.split(' ').pop()!;
      assert.ok(
        ['query', 'kind', 'selector', 'capability', 'type', 'limit'].includes(flagWord),
        `"${label}" names no flag`,
      );
    }
  });

  it('a set facet shows its own value back', () => {
    const rows = filterRows({ ...emptyFilter(), kinds: ['component', 'feature'] });
    assert.strictEqual(rows.find((r) => r.action === 'kinds')?.description, 'component, feature');
  });

  it('the run row summarises the whole filter, so it is readable before running', () => {
    const rows = filterRows({ ...emptyFilter(), query: 'db', kinds: ['component'] });
    const run = rows.find((r) => r.action === 'run');
    assert.ok(run?.description.includes('"db"'), run?.description);
    assert.ok(run?.description.includes('component'), run?.description);
  });

  it('with nothing set, the reset row stays and says so', () => {
    const reset = filterRows(emptyFilter()).find((r) => r.action === 'reset');
    assert.deepStrictEqual(reset, {
      action: 'reset',
      label: 'Reset search filter',
      description: 'nothing is set',
      detail: 'Clear every facet above without searching',
    });
    assert.strictEqual(NOTHING_SET_LABEL, 'nothing is set');
  });

  it('the reset row names what it clears, by the labels of the rows it clears', () => {
    const reset = (filter: CatalogFilter): string | undefined =>
      filterRows(filter).find((r) => r.action === 'reset')?.description;
    assert.strictEqual(reset({ ...emptyFilter(), query: 'db', kinds: ['component'] }), 'clears Query, Kind');
    assert.strictEqual(
      reset({
        query: 'db',
        kinds: ['component'],
        capabilities: ['helm'],
        selector: 'a=b',
        pluginType: 'provider',
        limit: 25,
      }),
      'clears Query, Kind, Label selector, Capability, Plugin type, Limit',
    );
  });

  it('a cap of zero is something the reset clears, because the request carries it', () => {
    // Zero reads as a value on the Limit row and is sent, so it is set.
    assert.strictEqual(
      filterRows({ ...emptyFilter(), limit: 0 }).find((r) => r.action === 'reset')?.description,
      'clears Limit',
    );
  });

  it('a typed value reading "any" is still named as set, because the request carries it', () => {
    // The row cannot tell this from an unset facet; the request can, and what
    // the reset clears is what the next search would otherwise send.
    assert.strictEqual(
      filterRows({ ...emptyFilter(), pluginType: 'any' }).find((r) => r.action === 'reset')?.description,
      'clears Plugin type',
    );
  });
});

// --- the kept filter -----------------------------------------------------

// scriptedList drives the filter list with the reader's choices written out in
// advance: each opening of the list takes the next action, and running out of
// actions dismisses it. A facet editor writes the answer given for that facet.
// It records every list it was shown, so what a search OPENS with is read from
// the first list that search drew.
function scriptedList(
  actions: (FilterAction | undefined)[],
  answers: Partial<CatalogFilter> = {},
): { deps: FilterListDeps; shown: FilterRow[][]; edited: string[] } {
  const shown: FilterRow[][] = [];
  const edited: string[] = [];
  const queue = [...actions];
  return {
    shown,
    edited,
    deps: {
      pick: async (rows) => {
        shown.push(rows);
        return queue.shift();
      },
      editFacet: async (filter, action) => {
        edited.push(action);
        Object.assign(filter, { [action]: answers[action] });
      },
    },
  };
}

// readings is a list as a reader reads it: each row's label and what it shows.
function readings(rows: FilterRow[]): string[] {
  return rows.map((r) => `${r.label}: ${r.description}`);
}

// UNTOUCHED is the list an untouched filter draws, written out rather than
// produced by filterRows, so a defect in the rows cannot sit on both sides.
const UNTOUCHED = [
  'Query: any',
  'Kind: any',
  'Label selector: any',
  'Capability: any',
  'Plugin type: any',
  'Limit: no cap',
  'Reset search filter: nothing is set',
  'Search: the whole published catalog',
];

describe('catalog-search-run: the kept filter', () => {
  it('🔴 THE NEXT SEARCH OPENS WITH THE FILTER THE LAST ONE RAN', async () => {
    const kept: KeptFilter = { filter: emptyFilter() };
    const first = scriptedList(['kinds', 'query', 'run'], { kinds: ['component'], query: 'db' });
    const searched = await chooseFilter(kept, first.deps);
    assert.deepStrictEqual(searched, { kinds: ['component'], capabilities: [], query: 'db' });

    const next = scriptedList([]);
    await chooseFilter(kept, next.deps);
    assert.deepStrictEqual(readings(next.shown[0]), [
      'Query: db',
      'Kind: component',
      'Label selector: any',
      'Capability: any',
      'Plugin type: any',
      'Limit: no cap',
      'Reset search filter: clears Query, Kind',
      'Search: "db", kind component',
    ]);
  });

  it('a search that matched nothing leaves the filter kept', async () => {
    // The outcome of the search is no reason to forget the filter: a reader who
    // matched nothing is exactly the one who wants to adjust one facet.
    const kept: KeptFilter = { filter: emptyFilter() };
    const filter = await chooseFilter(kept, scriptedList(['query', 'run'], { query: 'postgres' }).deps);
    assert.ok(filter);
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [] }));
    assert.strictEqual((await h.search(filter)).kind, 'no-matches');

    const next = scriptedList([]);
    await chooseFilter(kept, next.deps);
    assert.strictEqual(next.shown[0][0].description, 'postgres');
  });

  it('a list dismissed after an edit leaves the edit kept', async () => {
    const kept: KeptFilter = { filter: emptyFilter() };
    const dismissed = await chooseFilter(kept, scriptedList(['limit'], { limit: 5 }).deps);
    assert.strictEqual(dismissed, undefined, 'a dismissed list runs no search');

    const next = scriptedList([]);
    await chooseFilter(kept, next.deps);
    assert.strictEqual(next.shown[0].find((r) => r.action === 'limit')?.description, '5');
  });

  it('a fresh holder opens on an untouched filter', async () => {
    const next = scriptedList([]);
    await chooseFilter({ filter: emptyFilter() }, next.deps);
    assert.deepStrictEqual(readings(next.shown[0]), UNTOUCHED);
  });

  it('🔴 THE RESET RETURNS EVERY FACET TO AN UNTOUCHED FILTER AND RETURNS TO THE LIST', async () => {
    const kept: KeptFilter = {
      filter: {
        query: 'db',
        kinds: ['component'],
        capabilities: ['helm'],
        selector: 'a=b',
        pluginType: 'provider',
        limit: 25,
      },
    };
    const list = scriptedList(['reset']);
    const result = await chooseFilter(kept, list.deps);
    // The value an untouched filter holds, by equality and written out as well,
    // so a reset leaving one facet behind is a diff on either line.
    assert.deepStrictEqual(kept.filter, emptyFilter());
    assert.deepStrictEqual(kept.filter, { kinds: [], capabilities: [] });
    // Back to the list, reading every facet as narrowing nothing, with no search
    // run and no facet editor opened.
    assert.strictEqual(list.shown.length, 2, 'the reset returns to the list');
    assert.deepStrictEqual(readings(list.shown[1]), UNTOUCHED);
    assert.strictEqual(result, undefined, 'the reset runs no search');
    assert.deepStrictEqual(list.edited, []);
  });

  it('the reset is kept too: the next search opens on the cleared filter', async () => {
    const kept: KeptFilter = { filter: { ...emptyFilter(), query: 'db' } };
    await chooseFilter(kept, scriptedList(['reset']).deps);
    const next = scriptedList([]);
    await chooseFilter(kept, next.deps);
    assert.deepStrictEqual(readings(next.shown[0]), UNTOUCHED);
  });

  it('what a search runs on is a copy, so a later edit cannot change a search already asked for', async () => {
    const kept: KeptFilter = { filter: { ...emptyFilter(), kinds: ['component'] } };
    const searched = await chooseFilter(kept, scriptedList(['run']).deps);
    kept.filter.kinds.push('feature');
    kept.filter.query = 'later';
    assert.deepStrictEqual(searched, { kinds: ['component'], capabilities: [] });
  });

  it('a facet editor is opened for the facet its row names, and for nothing else', async () => {
    const list = scriptedList(['selector', 'pluginType', 'run'], { selector: 'a=b', pluginType: 'provider' });
    await chooseFilter({ filter: emptyFilter() }, list.deps);
    assert.deepStrictEqual(list.edited, ['selector', 'pluginType']);
  });
});

// --- filter description -------------------------------------------------

describe('catalog-search-run: filter description', () => {
  it('an untouched filter names the whole catalog', () => {
    assert.strictEqual(describeFilter(emptyFilter()), 'the whole published catalog');
  });

  it('a repeatable facet reads as an alternation, matching how the product combines it', () => {
    assert.strictEqual(
      describeFilter({ ...emptyFilter(), kinds: ['component', 'feature'] }),
      'kind component or feature',
    );
  });

  it('facets combine into one phrase', () => {
    assert.strictEqual(
      describeFilter({ ...emptyFilter(), query: 'db', selector: 'a=b', pluginType: 'provider' }),
      '"db", labels a=b, plugin type provider',
    );
  });

  it('the cap is not described as a filter, because it narrows no facet', () => {
    assert.strictEqual(describeFilter({ ...emptyFilter(), limit: 5 }), 'the whole published catalog');
  });
});

// --- kinds ---------------------------------------------------------------

describe('catalog-search-run: kinds', () => {
  it('the offered set is the one the product documents', () => {
    assert.deepStrictEqual([...ENTITY_KINDS], [
      'component', 'feature', 'recipe', 'featurerecipe', 'workload', 'plugin',
    ]);
  });

  it('a chosen set reads back in the offered order, whatever order it was ticked', () => {
    // One filter must not describe itself two ways.
    assert.deepStrictEqual(
      normalizeKinds(['workload', 'component', 'recipe']),
      ['component', 'recipe', 'workload'],
    );
    assert.deepStrictEqual(normalizeKinds([]), []);
  });

  it('a kind outside the offered set is kept, not silently dropped', () => {
    // Discarding it would narrow the search without saying so.
    assert.deepStrictEqual(
      normalizeKinds(['mystery', 'component']),
      ['component', 'mystery'],
    );
  });

  it('each offered kind survives into the request as itself', () => {
    for (const kind of ENTITY_KINDS) {
      assert.deepStrictEqual(
        searchParams({ ...emptyFilter(), kinds: [kind] }),
        { kinds: [kind] },
      );
    }
  });
});

// --- rows ----------------------------------------------------------------

describe('catalog-search-run: rows', () => {
  it('a record renders its name, kind, version and description', () => {
    assert.deepStrictEqual(rowForRecord(RECORD), {
      label: 'service',
      description: 'component 1.2.0',
      detail: 'oci://hub.aggrega.ai/component/core/service:1.2.0 — A long-running workload',
      uri: 'oci://hub.aggrega.ai/component/core/service:1.2.0',
    });
  });

  it('a record with no name falls back to the URI trailing segment', () => {
    assert.strictEqual(rowForRecord({ ...RECORD, name: '' }).label, 'service:1.2.0');
  });

  it('a record with no description shows the URI alone', () => {
    assert.strictEqual(
      rowForRecord({ ...RECORD, description: undefined }).detail,
      'oci://hub.aggrega.ai/component/core/service:1.2.0',
    );
  });

  it('the reference carried is the one selecting the row yields', () => {
    assert.strictEqual(rowForRecord(RECORD).uri, RECORD.uri);
  });
});

// --- outcomes ------------------------------------------------------------

describe('catalog-search-run: outcomes', () => {
  it('nothing anchored means nothing is ever asked', async () => {
    const h = harness(null, () => Promise.resolve({}));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(h.sent(), []);
    assert.deepStrictEqual(outcome, {
      kind: 'not-invoked',
      message: NO_ANCHORED_WORKSPACE_MESSAGE,
    });
  });

  it('a match set becomes rows', async () => {
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [RECORD] }));
    const outcome = await h.search(emptyFilter());
    assert.strictEqual(outcome.kind, 'matches');
    assert.strictEqual(outcome.kind === 'matches' && outcome.rows.length, 1);
  });

  it('zero matches is a SUCCESSFUL answer, distinct from a failure', async () => {
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [] }));
    const outcome = await h.search({ ...emptyFilter(), query: 'postgres' });
    assert.strictEqual(outcome.kind, 'no-matches');
    assert.ok(outcome.kind === 'no-matches' && outcome.message.includes('"postgres"'));
  });

  it('an absent records key reads the same as an empty one', async () => {
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED }));
    assert.strictEqual((await h.search(emptyFilter())).kind, 'no-matches');
  });

  it('a zero-match message names the filter, so an empty result is attributable', async () => {
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [] }));
    const outcome = await h.search({ ...emptyFilter(), kinds: ['workload'] });
    assert.strictEqual(
      outcome.kind === 'no-matches' ? outcome.message : '',
      'Aggrega: no catalog matches for kind workload.',
    );
  });

  it('🔴 AN EMPTY ANSWER NAMES THE REGISTRY IT DID NOT SEARCH, WHY, AND HOW TO BUILD ITS INDEX', async () => {
    // "No matches" alone reads as "it does not exist", when a registry that may
    // publish it was never consulted. Read whole: the registries searched, then
    // the one that was not, why, and the build that would let it be searched.
    const h = harness('/w', () => Promise.resolve({
      ...CONFIGURED,
      records: [],
      indexes: [{ host: '127.0.0.1:34457', lastUpdated: '2026-10-03T16:20:12Z' }],
      missingIndexHosts: ['registry.invalid'],
    }));
    const outcome = await h.search({ ...emptyFilter(), query: 'no-entity-is-called-this' });
    assert.deepStrictEqual(outcome, {
      kind: 'no-matches',
      message: 'Aggrega: no catalog matches for "no-entity-is-called-this" in 127.0.0.1:34457; '
        + 'registry.invalid has no local index and was not searched — build its index with '
        + '“Update index” in the Registries panel.',
    });
  });

  it('an empty answer names every registry it did not search, in one sentence', () => {
    const doc = partialDoc({
      indexes: [{ host: 'a.example.test' }, { host: 'b.example.test' }],
      missingIndexHosts: ['c.example.test', 'd.example.test', 'e.example.test'],
      stale: true,
    });
    // The staleness verdict is the channel's to report, on its own line with its
    // own repair; the empty answer is about what was and was not searched.
    assert.strictEqual(
      noMatchesMessage(doc, { ...emptyFilter(), kinds: ['plugin'] }),
      'Aggrega: no catalog matches for kind plugin in a.example.test and b.example.test; '
      + 'c.example.test, d.example.test and e.example.test have no local index and were not searched '
      + '— build their indexes with “Update index” in the Registries panel.',
    );
  });

  it('an empty answer over every configured registry says only that nothing matched', () => {
    const doc = partialDoc({
      indexes: [{ host: 'a.example.test', lastUpdated: '2026-10-03T16:20:12Z' }],
      missingIndexHosts: [],
      stale: true,
    });
    assert.strictEqual(
      noMatchesMessage(doc, { ...emptyFilter(), query: 'postgres' }),
      'Aggrega: no catalog matches for "postgres".',
    );
  });

  it('an unreadable snapshot is a FAILURE carrying the compiler’s own remediation', async () => {
    // The compiler names what to build. That text reaches the reader instead of
    // a re-worded wrapper, so the hint is the compiler's own.
    const message =
      "aggrega search: no local index found for any configured registry; run 'aggrega registry update'";
    const h = harness('/w', () => Promise.reject(new Error(message)));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'failed', message });
    assert.deepStrictEqual(h.log.lines, [message]);
  });

  it('an unreadable snapshot never renders as "nothing matched"', async () => {
    // One means the catalog lacks something; the other means it was never
    // consulted. Collapsing them would tell a reader a falsehood.
    const h = harness('/w', () => Promise.reject(new Error('no local index')));
    const outcome = await h.search(emptyFilter());
    assert.notStrictEqual(outcome.kind, 'no-matches');
  });

  it('🔴 A LANGUAGE-SERVER REFUSAL CARRIES THE COMPILER’S TEXT, NOT "[object Object]"', async () => {
    // The transport rejects with the raw error member — an envelope object, not
    // an error — so a reading of its own here would render the whole diagnostic
    // as [object Object] and lose the remediation. The equality is on the WHOLE
    // message, because a substring check passes on a wrapper that dropped it.
    const h = harness('/w', () => Promise.reject({
      code: -32602,
      message: 'search: no local index has been built for hub.aggrega.ai',
    }));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: 'search: no local index has been built for hub.aggrega.ai',
    });
    assert.deepStrictEqual(h.log.lines, [
      'search: no local index has been built for hub.aggrega.ai',
    ]);
  });

  it('a non-Error rejection still reaches the reader', async () => {
    const h = harness('/w', () => Promise.reject('plain string'));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'failed', message: 'plain string' });
  });

  it('🔴 NO REGISTRY CONFIGURED IS ITS OWN ANSWER, NOT A FAILURE AND NOT "NOTHING MATCHED"', async () => {
    // Such an answer also carries no records, so classifying on the record count
    // alone would tell a reader the catalog holds nothing matching when the truth
    // is that nothing was searched.
    const h = harness('/w', () => Promise.resolve({ registriesConfigured: false, records: [] }));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'no-registries', message: NO_REGISTRIES_MESSAGE });
  });

  it('the no-registry answer wins over a filter that also matched nothing', async () => {
    // Branch ORDER, asserted directly: a narrowed filter must not turn this into
    // a report about the filter.
    const h = harness('/w', () => Promise.resolve({ registriesConfigured: false }));
    const outcome = await h.search({ ...emptyFilter(), query: 'postgres' });
    assert.strictEqual(outcome.kind, 'no-registries');
  });

  it('the no-registry message opens with the compiler’s own sentence for that state', async () => {
    // 🔴 THE WHOLE SENTENCE, NOT A SUBSTRING OF IT. A containment check passes on
    // any wrapper that kept the phrase and re-worded everything around it, which
    // is exactly the re-wording this surface must not do.
    assert.strictEqual(
      NO_REGISTRIES_MESSAGE,
      'Aggrega: No registries configured. Add one with “Add registry” in the Registries '
      + 'panel, then build its index with “Update index”.',
    );
    // And the opening clause is the constant the registries view shows for the
    // same fact, so the two surfaces cannot come to word one state differently.
    // Pinned as a literal as well, from outside the implementation: an
    // expectation that only read the constant would sit on both sides of the
    // comparison and could not see a change to it.
    assert.strictEqual(EMPTY_LABEL, 'No registries configured.');
    assert.ok(NO_REGISTRIES_MESSAGE.startsWith(`Aggrega: ${EMPTY_LABEL} `), NO_REGISTRIES_MESSAGE);
  });

  it('the remediation sentences send the reader to rows the Registries panel draws, by their words', () => {
    // 🔴 A SENTENCE NAMING A CONTROL IS ONLY AS GOOD AS THE CONTROL'S OWN WORDS.
    // Each quoted name is a label the Registries panel's head carries, read from
    // the one description that draws those rows — so a sentence cannot send a
    // reader looking for a name the panel does not show. Pinned literally too, so
    // a change to a label is a diff here rather than a sentence that followed it
    // unread.
    assert.strictEqual(
      STALE_LINE,
      'One or more indexes are stale — refresh them with “Update index” in the Registries panel.',
    );
    const missing = notSearched(['registry.invalid']);
    assert.strictEqual(
      missing,
      'registry.invalid has no local index and was not searched — build its index with “Update index” '
      + 'in the Registries panel',
    );
    const drawn = PANEL_ACTIONS.registries.map((action) => action.label);
    for (const sentence of [NO_REGISTRIES_MESSAGE, STALE_LINE, missing]) {
      const quoted = Array.from(sentence.matchAll(/“([^”]+)”/g)).map((m) => m[1]);
      assert.ok(quoted.length > 0, `the census found no quoted name in "${sentence}", so it measures nothing`);
      for (const name of quoted) {
        assert.ok(drawn.includes(name), `"${sentence}" names “${name}”, which no Registries panel row reads`);
      }
    }
  });

  it('an answer that does not mention the registry set is NOT read as "none configured"', async () => {
    // Only an explicit false says so. Reading a missing field as a fact would
    // report something the compiler never sent.
    const h = harness('/w', () => Promise.resolve({ records: [RECORD] }));
    assert.strictEqual((await h.search(emptyFilter())).kind, 'matches');
  });

  it('the filter reaches the compiler as the request, asserted literally', async () => {
    // The expectation is written out rather than produced by searchParams: an
    // expectation derived from the implementation sits on both sides of the
    // comparison and cannot see a defect planted in it.
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [] }));
    const filter: CatalogFilter = { ...emptyFilter(), kinds: ['plugin'], capabilities: ['helm'] };
    await h.search(filter);
    assert.deepStrictEqual(h.sent(), [{ kinds: ['plugin'], capabilities: ['helm'] }]);
  });

  it('exactly one request is sent per search', async () => {
    const h = harness('/w', () => Promise.resolve({ ...CONFIGURED, records: [RECORD] }));
    await h.search(emptyFilter());
    assert.strictEqual(h.sent().length, 1);
  });
});

// --- freshness -----------------------------------------------------------

describe('catalog-search-run: freshness', () => {
  it('a consulted snapshot names its host and its timestamp', () => {
    assert.deepStrictEqual(
      freshnessReport(partialDoc({ indexes: [{ host: 'hub.aggrega.ai', lastUpdated: '2026-08-26T10:00:00Z' }] })),
      ['Index for hub.aggrega.ai last updated 2026-08-26T10:00:00Z'],
    );
  });

  it('a snapshot carrying no timestamp says so rather than showing a blank', () => {
    // "not recorded" and a date are different facts, and an absent timestamp
    // must not read as the epoch.
    assert.deepStrictEqual(
      freshnessReport(partialDoc({ indexes: [{ host: 'hub.aggrega.ai' }] })),
      ['Index for hub.aggrega.ai last updated (timestamp unavailable)'],
    );
  });

  it('a configured registry with no snapshot is named as not searched, with the build on its own line', () => {
    // 🔴 THE REPAIR IS ON THE LINE IT APPLIES TO, AND IT IS A BUILD. A repair on a
    // line of its own reads as advice about whichever line it follows, and
    // "refresh" suits an index that exists, while this one has to be built.
    assert.deepStrictEqual(
      freshnessReport(partialDoc({
        missingIndexHosts: ['registry.invalid'],
        indexes: [{ host: '127.0.0.1:34457', lastUpdated: '2026-10-03T16:20:12Z' }],
      })),
      [
        'registry.invalid has no local index and was not searched — build its index with '
        + '“Update index” in the Registries panel.',
        'Index for 127.0.0.1:34457 last updated 2026-10-03T16:20:12Z',
      ],
    );
  });

  it('the compiler’s staleness verdict is REPORTED, never re-derived from a timestamp', () => {
    // Judging a snapshot old is the compiler's call. A rule of its own here
    // would be free to disagree with it.
    const fresh = freshnessReport(partialDoc({
      indexes: [{ host: 'h', lastUpdated: '1999-01-01T00:00:00Z' }],
      stale: false,
    }));
    assert.deepStrictEqual(fresh, ['Index for h last updated 1999-01-01T00:00:00Z']);

    const stale = freshnessReport(partialDoc({
      indexes: [{ host: 'h', lastUpdated: '2026-09-08T00:00:00Z' }],
      stale: true,
    }));
    assert.deepStrictEqual(stale, [
      'Index for h last updated 2026-09-08T00:00:00Z',
      'One or more indexes are stale — refresh them with “Update index” in the Registries panel.',
    ]);
  });

  it('a missing index and a stale one each carry their own repair, worded apart', () => {
    const lines = freshnessReport(partialDoc({
      missingIndexHosts: ['a.example.test', 'b.example.test'],
      indexes: [{ host: 'h', lastUpdated: '2026-09-08T00:00:00Z' }],
      stale: true,
    }));
    assert.deepStrictEqual(lines, [
      'a.example.test has no local index and was not searched — build its index with '
      + '“Update index” in the Registries panel.',
      'b.example.test has no local index and was not searched — build its index with '
      + '“Update index” in the Registries panel.',
      'Index for h last updated 2026-09-08T00:00:00Z',
      'One or more indexes are stale — refresh them with “Update index” in the Registries panel.',
    ]);
  });

  it('a healthy answer produces no repair at all', () => {
    const lines = freshnessReport(partialDoc({
      indexes: [{ host: 'h', lastUpdated: '2026-09-08T00:00:00Z' }],
      stale: false,
      missingIndexHosts: [],
    }));
    assert.deepStrictEqual(lines, ['Index for h last updated 2026-09-08T00:00:00Z']);
  });

  it('an answer carrying no provenance produces no lines', () => {
    assert.deepStrictEqual(freshnessReport(partialDoc({})), []);
  });

  it('the freshness reaches the channel even when nothing matched', async () => {
    // The reader looking at an empty result is exactly the reader who needs to
    // know how old the snapshot was.
    const h = harness('/w', () => Promise.resolve({
      ...CONFIGURED,
      records: [],
      indexes: [{ host: 'hub.aggrega.ai', lastUpdated: '2026-08-26T10:00:00Z' }],
    }));
    const outcome = await h.search(emptyFilter());
    assert.strictEqual(outcome.kind, 'no-matches');
    assert.deepStrictEqual(h.log.lines, [
      'Index for hub.aggrega.ai last updated 2026-08-26T10:00:00Z',
    ]);
  });

  it('a host with no timestamp is still reported, where the command line drops it', () => {
    // The structured answer names every consulted host and omits only the
    // timestamp, so a snapshot with no date is visible rather than absent.
    const hosts = freshnessReport(partialDoc({
      indexes: [
        { host: 'dated.example.test', lastUpdated: '2026-08-26T10:00:00Z' },
        { host: 'undated.example.test' },
      ],
    }));
    assert.strictEqual(hosts.length, 2);
    assert.ok(hosts[1].includes('undated.example.test'), hosts[1]);
  });
});
