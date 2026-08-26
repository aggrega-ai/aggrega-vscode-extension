// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  ANY_VALUE_LABEL,
  CatalogFilter,
  ENTITY_KINDS,
  IndexRecord,
  RUN_ROW_LABEL,
  SearchDoc,
  SearchOutcome,
  describeFilter,
  emptyFilter,
  filterRows,
  normalizeKinds,
  parseLimit,
  rowForRecord,
  searchArgs,
  searchCatalog,
  splitValueList,
} from '../../src/catalog-search-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from '../../src/workspace';

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

interface Harness {
  search(filter: CatalogFilter): Promise<SearchOutcome>;
  log: FakeLog;
  args(): string[][];
}

function harness(
  root: string | null,
  answer: () => Promise<{ doc: SearchDoc; stderr: string }>,
): Harness {
  const log = new FakeLog();
  const seen: string[][] = [];
  return {
    log,
    args: () => seen,
    search: (filter) =>
      searchCatalog(
        {
          getWorkspaceRoot: () => root,
          runSearchJson: (args) => {
            seen.push(args);
            return answer();
          },
          log,
        },
        filter,
      ),
  };
}

const RECORD: IndexRecord = {
  uri: 'oci://hub.aggrega.ai/component/core/service:1.2.0',
  name: 'service',
  version: '1.2.0',
  kind: 'component',
  description: 'A long-running workload',
};

// --- argv ----------------------------------------------------------------

describe('catalog-search-run: argv', () => {
  it('an untouched filter passes no facet flag at all', () => {
    // Every facet the reader left alone must be OMITTED. Expanding an unset
    // facet into every value would freeze today's default into this extension.
    assert.deepStrictEqual(searchArgs(emptyFilter()), ['search', '-o', 'json']);
  });

  it('the free-text query is the positional, straight after the verb', () => {
    assert.deepStrictEqual(
      searchArgs({ ...emptyFilter(), query: 'postgres' }),
      ['search', 'postgres', '-o', 'json'],
    );
  });

  it('a whitespace-only query contributes no positional', () => {
    assert.deepStrictEqual(searchArgs({ ...emptyFilter(), query: '   ' }), ['search', '-o', 'json']);
  });

  it('kinds are repeated flag occurrences, never comma-joined', () => {
    const args = searchArgs({ ...emptyFilter(), kinds: ['component', 'feature'] });
    assert.deepStrictEqual(args, [
      'search', '--kind', 'component', '--kind', 'feature', '-o', 'json',
    ]);
    assert.ok(!args.some((a) => a.includes(',')), 'a comma-joined value would match one literal');
  });

  it('capabilities are repeated flag occurrences too', () => {
    assert.deepStrictEqual(
      searchArgs({ ...emptyFilter(), capabilities: ['helm', 'parse:hcl'] }),
      ['search', '--capability', 'helm', '--capability', 'parse:hcl', '-o', 'json'],
    );
  });

  it('the label selector is passed through untouched', () => {
    // Its grammar belongs to the compiler. Nothing here parses or rewrites it,
    // so an expression the product rejects is rejected by the product.
    const selector = 'component.aggrega.ai/category in (compute,data),!deprecated';
    assert.deepStrictEqual(
      searchArgs({ ...emptyFilter(), selector }),
      ['search', '-l', selector, '-o', 'json'],
    );
  });

  it('the plugin socket is a single-valued flag', () => {
    assert.deepStrictEqual(
      searchArgs({ ...emptyFilter(), pluginType: 'provider' }),
      ['search', '--plugin-type', 'provider', '-o', 'json'],
    );
  });

  it('an unset cap contributes no flag', () => {
    assert.ok(!searchArgs(emptyFilter()).includes('--limit'));
  });

  it('a cap of zero is passed, because zero is the product’s own "no cap"', () => {
    assert.deepStrictEqual(
      searchArgs({ ...emptyFilter(), limit: 0 }),
      ['search', '--limit', '0', '-o', 'json'],
    );
  });

  it('every facet together, in one command line', () => {
    assert.deepStrictEqual(
      searchArgs({
        query: 'db',
        kinds: ['component'],
        capabilities: ['helm'],
        selector: 'a=b',
        pluginType: 'provider',
        limit: 25,
      }),
      [
        'search', 'db',
        '--kind', 'component',
        '--capability', 'helm',
        '-l', 'a=b',
        '--plugin-type', 'provider',
        '--limit', '25',
        '-o', 'json',
      ],
    );
  });

  it('the structured format is always requested', () => {
    // The whole surface reads structured output; nothing parses a human table.
    const args = searchArgs({ ...emptyFilter(), query: 'x' });
    assert.deepStrictEqual(args.slice(-2), ['-o', 'json']);
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

  it('every facet the argv builder supports is reachable from the list', () => {
    // A facet with no row is a flag no reader can set.
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

  it('each offered kind survives into its own flag occurrence', () => {
    for (const kind of ENTITY_KINDS) {
      assert.deepStrictEqual(
        searchArgs({ ...emptyFilter(), kinds: [kind] }),
        ['search', '--kind', kind, '-o', 'json'],
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
  it('nothing anchored means the command is never invoked', async () => {
    const h = harness(null, () => Promise.resolve({ doc: {}, stderr: '' }));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(h.args(), []);
    assert.deepStrictEqual(outcome, {
      kind: 'not-invoked',
      message: NO_ANCHORED_WORKSPACE_MESSAGE,
    });
  });

  it('a match set becomes rows', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: { records: [RECORD] }, stderr: '' }));
    const outcome = await h.search(emptyFilter());
    assert.strictEqual(outcome.kind, 'matches');
    assert.strictEqual(outcome.kind === 'matches' && outcome.rows.length, 1);
  });

  it('zero matches is a SUCCESSFUL answer, distinct from a failure', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: { records: [] }, stderr: '' }));
    const outcome = await h.search({ ...emptyFilter(), query: 'postgres' });
    assert.strictEqual(outcome.kind, 'no-matches');
    assert.ok(outcome.kind === 'no-matches' && outcome.message.includes('"postgres"'));
  });

  it('an absent records key reads the same as an empty one', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: {}, stderr: '' }));
    assert.strictEqual((await h.search(emptyFilter())).kind, 'no-matches');
  });

  it('a zero-match message names the filter, so an empty result is attributable', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: { records: [] }, stderr: '' }));
    const outcome = await h.search({ ...emptyFilter(), kinds: ['workload'] });
    assert.strictEqual(
      outcome.kind === 'no-matches' ? outcome.message : '',
      'Aggrega: no catalog matches for kind workload.',
    );
  });

  it('an unreadable index is a FAILURE carrying the product’s own remediation', async () => {
    // The product names the step to run. That text reaches the reader instead
    // of a re-worded wrapper, so the hint is the product's own.
    const message =
      "aggrega search: no local index found for any configured registry; run 'aggrega registry update'";
    const h = harness('/w', () => Promise.reject(new Error(message)));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'failed', message });
    assert.deepStrictEqual(h.log.lines, [message]);
  });

  it('an unreadable index never renders as "nothing matched"', async () => {
    // One means the catalog lacks something; the other means it was never
    // consulted. Collapsing them would tell a reader a falsehood.
    const h = harness('/w', () => Promise.reject(new Error('no local index')));
    const outcome = await h.search(emptyFilter());
    assert.notStrictEqual(outcome.kind, 'no-matches');
  });

  it('a configuration answered in prose reaches the reader as prose', async () => {
    // With no registry configured the command answers in a sentence and exits
    // zero, so the runner rejects with that sentence. It is surfaced as the
    // product wrote it.
    const h = harness('/w', () => Promise.reject(new Error('No registries configured.')));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'failed', message: 'No registries configured.' });
  });

  it('a non-Error rejection still reaches the reader', async () => {
    const h = harness('/w', () => Promise.reject('plain string'));
    const outcome = await h.search(emptyFilter());
    assert.deepStrictEqual(outcome, { kind: 'failed', message: 'plain string' });
  });

  it('the freshness report on stderr is logged verbatim', async () => {
    // It is how a reader tells an entity missing from the catalog from one
    // missing only from a stale local index.
    const freshness = 'registry hub.aggrega.ai: index updated 2026-08-26T10:00:00Z';
    const h = harness('/w', () =>
      Promise.resolve({ doc: { records: [RECORD] }, stderr: `${freshness}\n` }));
    await h.search(emptyFilter());
    assert.deepStrictEqual(h.log.lines, [freshness]);
  });

  it('a silent stderr adds no log line', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: { records: [RECORD] }, stderr: '' }));
    await h.search(emptyFilter());
    assert.deepStrictEqual(h.log.lines, []);
  });

  it('the filter reaches the command as the argv the builder produced', async () => {
    const h = harness('/w', () => Promise.resolve({ doc: { records: [] }, stderr: '' }));
    const filter: CatalogFilter = { ...emptyFilter(), kinds: ['plugin'], capabilities: ['helm'] };
    await h.search(filter);
    assert.deepStrictEqual(h.args(), [searchArgs(filter)]);
  });
});
