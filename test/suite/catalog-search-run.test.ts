// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  ANY_VALUE_LABEL,
  CatalogFilter,
  ENTITY_KINDS,
  IndexRecord,
  NO_REGISTRIES_MESSAGE,
  REFRESH_REMEDIATION,
  RUN_ROW_LABEL,
  RegistrySearchParams,
  SearchDoc,
  SearchOutcome,
  describeFilter,
  emptyFilter,
  filterRows,
  freshnessReport,
  normalizeKinds,
  parseLimit,
  rowForRecord,
  searchCatalog,
  searchParams,
  splitValueList,
} from '../../src/catalog-search-run';
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

function harness(
  root: string | null,
  answer: () => Promise<SearchDoc>,
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
            return answer();
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
  it('an untouched filter shows every facet as narrowing nothing', () => {
    const rows = filterRows(emptyFilter());
    const facets = rows.filter((r) => r.action !== 'run' && r.action !== 'limit');
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
      .filter((r) => r.action !== 'run')
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
      message: 'code=-32602 search: no local index has been built for hub.aggrega.ai',
    });
    assert.deepStrictEqual(h.log.lines, [
      'code=-32602 search: no local index has been built for hub.aggrega.ai',
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
      + 'panel, then build its index with “Update the searchable index”.',
    );
    // And the opening clause is the constant the registries view shows for the
    // same fact, so the two surfaces cannot come to word one state differently.
    // Pinned as a literal as well, from outside the implementation: an
    // expectation that only read the constant would sit on both sides of the
    // comparison and could not see a change to it.
    assert.strictEqual(EMPTY_LABEL, 'No registries configured.');
    assert.ok(NO_REGISTRIES_MESSAGE.startsWith(`Aggrega: ${EMPTY_LABEL} `), NO_REGISTRIES_MESSAGE);
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
      freshnessReport({ indexes: [{ host: 'hub.aggrega.ai', lastUpdated: '2026-08-26T10:00:00Z' }] }),
      ['Index for hub.aggrega.ai last updated 2026-08-26T10:00:00Z'],
    );
  });

  it('a snapshot carrying no timestamp says so rather than showing a blank', () => {
    // "not recorded" and a date are different facts, and an absent timestamp
    // must not read as the epoch.
    assert.deepStrictEqual(
      freshnessReport({ indexes: [{ host: 'hub.aggrega.ai' }] }),
      ['Index for hub.aggrega.ai last updated (timestamp unavailable)'],
    );
  });

  it('a configured registry with no snapshot is named, with the editor’s own repair', () => {
    assert.deepStrictEqual(
      freshnessReport({ missingIndexHosts: ['other.example.test'] }),
      [
        'registry other.example.test: no local index has been built.',
        REFRESH_REMEDIATION,
      ],
    );
  });

  it('the compiler’s staleness verdict is REPORTED, never re-derived from a timestamp', () => {
    // Judging a snapshot old is the compiler's call. A rule of its own here
    // would be free to disagree with it.
    const fresh = freshnessReport({
      indexes: [{ host: 'h', lastUpdated: '1999-01-01T00:00:00Z' }],
      stale: false,
    });
    assert.deepStrictEqual(fresh, ['Index for h last updated 1999-01-01T00:00:00Z']);

    const stale = freshnessReport({
      indexes: [{ host: 'h', lastUpdated: '2026-09-08T00:00:00Z' }],
      stale: true,
    });
    assert.deepStrictEqual(stale, [
      'Index for h last updated 2026-09-08T00:00:00Z',
      'One or more indexes are stale.',
      REFRESH_REMEDIATION,
    ]);
  });

  it('the repair is named ONCE however many registries need it', () => {
    const lines = freshnessReport({
      missingIndexHosts: ['a.example.test', 'b.example.test'],
      stale: true,
    });
    assert.strictEqual(
      lines.filter((l) => l === REFRESH_REMEDIATION).length,
      1,
      lines.join(' | '),
    );
  });

  it('a healthy answer produces no repair line at all', () => {
    const lines = freshnessReport({
      indexes: [{ host: 'h', lastUpdated: '2026-09-08T00:00:00Z' }],
      stale: false,
      missingIndexHosts: [],
    });
    assert.ok(!lines.includes(REFRESH_REMEDIATION), lines.join(' | '));
  });

  it('an answer carrying no provenance produces no lines', () => {
    assert.deepStrictEqual(freshnessReport({}), []);
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
    const hosts = freshnessReport({
      indexes: [
        { host: 'dated.example.test', lastUpdated: '2026-08-26T10:00:00Z' },
        { host: 'undated.example.test' },
      ],
    });
    assert.strictEqual(hosts.length, 2);
    assert.ok(hosts[1].includes('undated.example.test'), hosts[1]);
  });
});
