// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  LintDocument,
  LintFindingShape,
  LintRunDeps,
  runLint,
} from '../../src/lint-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from '../../src/workspace';

// FakeSink records what each run published, so a test reads back exactly the
// findings an author would have seen in the Problems panel — including the
// replacement semantics, which are only visible across two runs.
class FakeSink {
  published: Map<string, LintFindingShape[]> = new Map();
  replaceCalls = 0;
  replace(byFile: Map<string, LintFindingShape[]>): void {
    this.replaceCalls++;
    this.published = byFile;
  }
}

class FakeLog {
  lines: string[] = [];
  shown = 0;
  appendLine(text: string): void { this.lines.push(text); }
  show(): void { this.shown++; }
}

interface Harness {
  deps: LintRunDeps;
  sink: FakeSink;
  log: FakeLog;
  notices: Array<{ message: string; tier: 'info' | 'error' }>;
  invocations: number;
}

// harness builds the run's dependency set over recorders and a caller-supplied
// answer for the linter invocation.
function harness(
  root: string | null,
  answer: () => Promise<{ doc: LintDocument; stderr: string }>,
): Harness {
  const sink = new FakeSink();
  const log = new FakeLog();
  const h: Harness = {
    sink,
    log,
    notices: [],
    invocations: 0,
    deps: {
      getWorkspaceRoot: () => root,
      runLintJson: () => {
        h.invocations++;
        return answer();
      },
      sink,
      log,
      notify: (message, tier) => { h.notices.push({ message, tier }); },
    },
  };
  return h;
}

const CATEGORY_MESSAGE =
  'Component at "/catalog/component/core/ai-tool/search/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="ai-tool"; standard-catalog convention requires the label to match the first directory segment under core/';
const CATEGORY_FILE = '/catalog/component/core/ai-tool/search/1.0.0/component.yaml';

// A document captured from a real run: exit 0, one advisory finding, an
// absolute file with no line, and the human report the product wrote to stderr
// alongside the machine document.
const ONE_FINDING: { doc: LintDocument; stderr: string } = {
  doc: {
    findings: [
      {
        severity: 'warn',
        message: CATEGORY_MESSAGE,
        ruleId: 'category-matches-directory',
        location: { file: CATEGORY_FILE },
      },
    ],
    summary: { entitiesChecked: 127, findings: 1, errors: 0, warnings: 1, infos: 0 },
  },
  stderr: `${CATEGORY_FILE}:\n[warn] category-matches-directory: ${CATEGORY_MESSAGE}`,
};

const CLEAN: { doc: LintDocument; stderr: string } = {
  doc: { findings: [], summary: { entitiesChecked: 127, findings: 0, errors: 0, warnings: 0, infos: 0 } },
  stderr: '',
};

describe('runLint', () => {
  it('publishes one navigable entry per finding, keyed by the entity file', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.invocations, 1, 'the linter must actually be invoked');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_FILE]);
    const shapes = h.sink.published.get(CATEGORY_FILE)!;
    assert.strictEqual(shapes.length, 1);
    assert.strictEqual(shapes[0].message, CATEGORY_MESSAGE, 'the message must be carried through unchanged');
    assert.strictEqual(shapes[0].ruleId, 'category-matches-directory');
    assert.strictEqual(shapes[0].severity, 'warning');
    assert.strictEqual(shapes[0].located, false, 'no position may be invented for a file-only finding');
  });

  // The exit status is 0 whether or not there are findings, so a run that found
  // something must still publish it. This is the case an exit-code gate would
  // have silently dropped.
  it('publishes findings even though the linter exited successfully', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.sink.published.size, 1);
    assert.deepStrictEqual(
      h.notices.map((n) => n.tier),
      ['info'],
      'a findings-bearing run is not an error',
    );
  });

  // A successful run writes its human report to stderr alongside the machine
  // document. That text is the product's own rendering and reaches the log
  // verbatim.
  it('appends the product\'s own report to the log verbatim', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.ok(
      h.log.lines.some((l) => l.includes('[warn] category-matches-directory:') && l.includes(CATEGORY_MESSAGE)),
      `the product report did not reach the log; got ${JSON.stringify(h.log.lines)}`,
    );
    assert.strictEqual(h.log.shown, 0, 'a successful run does not steal focus from the Problems panel');
  });

  it('reports a clean run rather than leaving the reader with nothing', async () => {
    const h = harness('/ws', () => Promise.resolve(CLEAN));

    await runLint(h.deps);

    assert.strictEqual(h.sink.replaceCalls, 1);
    assert.strictEqual(h.sink.published.size, 0);
    assert.deepStrictEqual(h.notices, [
      { message: 'Aggrega lint: no findings across 127 entities checked.', tier: 'info' },
    ]);
  });

  // The replace-not-accumulate acceptance. Only a second run makes it visible:
  // the first run's finding must be gone, not merely joined by the second's.
  it('replaces the previous run\'s findings rather than accumulating them', async () => {
    let answer = ONE_FINDING;
    const h = harness('/ws', () => Promise.resolve(answer));

    await runLint(h.deps);
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_FILE]);

    answer = {
      doc: {
        findings: [
          { severity: 'warn', message: 'a different entity', ruleId: 'name-shape', location: { file: '/other.yaml' } },
        ],
        summary: { entitiesChecked: 127, findings: 1 },
      },
      stderr: '',
    };
    await runLint(h.deps);

    assert.strictEqual(h.invocations, 2);
    assert.strictEqual(h.sink.replaceCalls, 2);
    assert.deepStrictEqual(
      [...h.sink.published.keys()],
      ['/other.yaml'],
      'the first run\'s finding survived into the second run',
    );
  });

  it('clears the previous findings when a later run comes back clean', async () => {
    let answer = ONE_FINDING;
    const h = harness('/ws', () => Promise.resolve(answer));

    await runLint(h.deps);
    assert.strictEqual(h.sink.published.size, 1);

    answer = CLEAN;
    await runLint(h.deps);

    assert.strictEqual(h.sink.published.size, 0, 'a fixed finding must disappear');
  });

  // A run that cannot execute surfaces the compiler's own message. The wording
  // here is the product's, captured from a real failing run: no anchored
  // catalog directory to scan.
  it('surfaces the product\'s own message when the linter could not run', async () => {
    const productMessage =
      'OPS_ERROR: whole-catalog conventions check needs catalog directories to scan; pass --catalog or set `workspace.catalog_dirs` in .aggrega-config.yaml (or check a specific Release with --release)';
    const h = harness('/ws', () => Promise.reject(new Error(productMessage)));

    await runLint(h.deps);

    assert.deepStrictEqual(h.notices, [{ message: productMessage, tier: 'error' }]);
    assert.ok(h.log.lines.includes(productMessage));
    assert.strictEqual(h.log.shown, 1, 'a failure reveals the log');
  });

  // A failed run learned nothing, so it must not erase a result the author has
  // not yet acted on.
  it('leaves the previous findings in place when a later run cannot execute', async () => {
    let fail = false;
    const h = harness('/ws', () =>
      fail ? Promise.reject(new Error('OPS_ERROR: could not run')) : Promise.resolve(ONE_FINDING),
    );

    await runLint(h.deps);
    assert.strictEqual(h.sink.published.size, 1);

    fail = true;
    await runLint(h.deps);

    assert.strictEqual(h.sink.replaceCalls, 1, 'a failed run must not republish');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_FILE]);
  });

  it('does not invoke the linter when no workspace is anchored', async () => {
    const h = harness(null, () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.invocations, 0, 'no anchor means no invocation');
    assert.strictEqual(h.sink.replaceCalls, 0);
    assert.deepStrictEqual(h.notices, [{ message: NO_ANCHORED_WORKSPACE_MESSAGE, tier: 'info' }]);
  });

  it('names a finding that located no file in the log rather than losing it', async () => {
    const h = harness('/ws', () =>
      Promise.resolve({
        doc: {
          findings: [{ severity: 'warn', message: 'no entity', ruleId: 'a', location: { file: '' } }],
          summary: { entitiesChecked: 3, findings: 1 },
        },
        stderr: '',
      }),
    );

    await runLint(h.deps);

    assert.strictEqual(h.sink.published.size, 0);
    assert.ok(
      h.log.lines.some((l) => l.includes('named no entity file')),
      `the dropped finding was not named; got ${JSON.stringify(h.log.lines)}`,
    );
  });
});
