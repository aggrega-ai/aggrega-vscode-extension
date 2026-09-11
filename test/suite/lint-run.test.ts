// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LINT_SUBJECT,
  LintAnswer,
  runLint,
} from '../../src/lint-run';
import { ConvertedShape } from '../../src/diagnostics-shape';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from '../../src/workspace';
import {
  EXTENSION_ROOT,
  assertCensusInstrumentFires,
  launchFacilityCount,
} from '../helpers/launch-census';

// FakeSink records what each run published, so a test reads back exactly the
// findings an author would have seen in the Problems panel — including the
// replacement semantics, which are only visible across two runs.
class FakeSink {
  published: Map<string, ConvertedShape[]> = new Map();
  replaceCalls = 0;
  replace(byFile: Map<string, ConvertedShape[]>): void {
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
  deps: Parameters<typeof runLint>[0];
  sink: FakeSink;
  log: FakeLog;
  notices: Array<{ message: string; tier: 'info' | 'error' }>;
  invocations: number;
  signals: Array<CancellationSignal | undefined>;
}

// harness builds the run's dependency set over recorders and a caller-supplied
// answer for the request. Every signal handed to the request is kept, so what
// reached the compiler is a measurement rather than an inference.
function harness(root: string | null, answer: () => Promise<LintAnswer>): Harness {
  const sink = new FakeSink();
  const log = new FakeLog();
  const h: Harness = {
    sink,
    log,
    notices: [],
    invocations: 0,
    signals: [],
    deps: {
      getWorkspaceRoot: () => root,
      lint: (signal) => {
        h.invocations++;
        h.signals.push(signal);
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
  'Component at "/ws/catalog/component/core/ai-tool/search/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="ai-tool"; standard-catalog convention requires the label to match the first directory segment under core/';
const CATEGORY_RELATIVE = 'catalog/component/core/ai-tool/search/1.0.0/component.yaml';
const CATEGORY_ABSOLUTE = `/ws/${CATEGORY_RELATIVE}`;

// An answer captured from a live language server: one advisory finding located to
// a document and no further, grouped under the document's workspace-relative path,
// with the compiler's own counts beside it.
const ONE_FINDING: LintAnswer = {
  checked: 127,
  findings: 1,
  errors: 0,
  warnings: 1,
  infos: 0,
  files: [
    {
      file: CATEGORY_RELATIVE,
      diagnostics: [
        {
          line: 1,
          column: 1,
          severity: 'warning',
          message: CATEGORY_MESSAGE,
          code: 'category-matches-directory',
          source: 'aggrega-lint',
        },
      ],
    },
  ],
  halted: false,
};

const CLEAN: LintAnswer = {
  checked: 127, findings: 0, errors: 0, warnings: 0, infos: 0, files: [], halted: false,
};

describe('runLint', () => {
  it('publishes one navigable entry per finding, keyed by the entity document', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.invocations, 1, 'the check must actually be asked for');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);
    const shapes = h.sink.published.get(CATEGORY_ABSOLUTE)!;
    assert.strictEqual(shapes.length, 1);
    assert.strictEqual(shapes[0].message, CATEGORY_MESSAGE, 'the message must be carried through unchanged');
    assert.strictEqual(shapes[0].code, 'category-matches-directory');
    assert.strictEqual(shapes[0].severity, 'warning');
    assert.strictEqual(shapes[0].source, 'aggrega-lint', 'the layer the compiler stamped must survive');
  });

  // Conventions findings are advisory: an answer carrying them is a successful
  // answer. This is the case a verdict-driven reading would have dropped.
  it('publishes findings without reporting the run as a failure', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.sink.published.size, 1);
    assert.deepStrictEqual(
      h.notices.map((n) => n.tier),
      ['info'],
      'a findings-bearing run is not an error',
    );
  });

  // The reader-visible log carries the compiler's own report format, composed
  // from the answer. An equality on the whole log, not a containment: a
  // containment passes while any one of several lines survives.
  it('writes the compiler\'s report into the log', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.deepStrictEqual(h.log.lines, [
      `${CATEGORY_ABSOLUTE}:`,
      `[warning] category-matches-directory: ${CATEGORY_MESSAGE}`,
    ]);
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
    assert.deepStrictEqual(h.log.lines, [], 'a clean run has no findings to report');
  });

  // The replace-not-accumulate acceptance. Only a second run makes it visible:
  // the first run's finding must be gone, not merely joined by the second's.
  it('replaces the previous run\'s findings rather than accumulating them', async () => {
    let answer = ONE_FINDING;
    const h = harness('/ws', () => Promise.resolve(answer));

    await runLint(h.deps);
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);

    answer = {
      checked: 127,
      findings: 1,
      files: [{
        file: 'other.yaml',
        diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'a different entity', code: 'name-shape', source: 'aggrega-lint' }],
      }],
    };
    await runLint(h.deps);

    assert.strictEqual(h.invocations, 2);
    assert.strictEqual(h.sink.replaceCalls, 2);
    assert.deepStrictEqual(
      [...h.sink.published.keys()],
      ['/ws/other.yaml'],
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
  // here is the compiler's, captured from a real failing run: no configured
  // catalog directory to scan.
  it('surfaces the compiler\'s own message when the check could not run', async () => {
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
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);
  });

  it('does not ask for the check when no workspace is anchored', async () => {
    const h = harness(null, () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps);

    assert.strictEqual(h.invocations, 0, 'no anchor means nothing is asked');
    assert.strictEqual(h.sink.replaceCalls, 0);
    assert.deepStrictEqual(h.notices, [{ message: NO_ANCHORED_WORKSPACE_MESSAGE, tier: 'info' }]);
  });

  it('names a finding that located no document in the log rather than losing it', async () => {
    const h = harness('/ws', () =>
      Promise.resolve({
        checked: 3,
        findings: 1,
        files: [{ file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'no entity', code: 'a', source: 'aggrega-lint' }] }],
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

// --- the stop ------------------------------------------------------------

describe('a reader\'s stop', () => {
  // The signal is what reaches the compiler. A run that took one and did not pass
  // it on would stop this side's wait and leave the walk running, which is the
  // failure this assertion exists to catch — and it is invisible from the
  // reported outcome, since the reader is told "stopped" either way.
  it('reaches the request rather than stopping only this side\'s wait', async () => {
    const signal: CancellationSignal = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    };
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps, signal);

    assert.deepStrictEqual(h.signals, [signal], 'the reader\'s signal did not reach the request');
  });

  it('is reported as stopped rather than as a failure', async () => {
    const h = harness('/ws', () => Promise.reject(new OperationCancelled(LINT_SUBJECT)));

    await runLint(h.deps, {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    });

    const expected = terminalLine(LINT_SUBJECT, { kind: 'cancelled' });
    assert.deepStrictEqual(h.notices, [{ message: expected, tier: 'info' }]);
    assert.deepStrictEqual(h.log.lines, [expected]);
    assert.strictEqual(h.log.shown, 0, 'a stopped run is not a failure and must not reveal the log');
  });

  // A stopped run learned nothing, so it must not erase a result the author has
  // not yet acted on — the same rule a failed run follows.
  it('leaves the previous findings in place', async () => {
    let stop = false;
    const h = harness('/ws', () =>
      stop ? Promise.reject(new OperationCancelled(LINT_SUBJECT)) : Promise.resolve(ONE_FINDING),
    );

    await runLint(h.deps);
    assert.strictEqual(h.sink.published.size, 1);

    stop = true;
    await runLint(h.deps);

    assert.strictEqual(h.sink.replaceCalls, 1, 'a stopped run must not republish');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);
  });
});

// --- one execution path --------------------------------------------------

describe('the conventions check reaches the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES A ZERO MEAN ANYTHING.
    // A pattern that has stopped matching reports every module clean, so a census
    // without a control cannot tell an absence from a dead instrument.
    assertCensusInstrumentFires((value, message) => assert.ok(value, message));
  });

  it('gives neither module of the check a way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/lint-run.ts'), 0);
    assert.strictEqual(launchFacilityCount('src/lint.ts'), 0);
  });

  it('gives the module that decides the run no way to reach a process or an editor', () => {
    // Read as the WHOLE import list, so a module added to it has to be looked at —
    // including one that could start a process and one that would carry the editor
    // in, which is what keeps the run's decisions readable without a host.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/lint-run.ts'), 'utf8');
    const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      imported.sort(),
      [
        './cancellation',
        './diagnostics-shape',
        './operation-outcome',
        './types',
        './workspace',
        'node:path',
      ],
    );
  });

  it('asks for the check from exactly one place', () => {
    // One question with two senders is two execution paths. The method name is the
    // compiler's identifier, read from the surface that sends it rather than
    // restated as a constant this side owns.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const senders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /'aggrega\/lint'/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(
      senders,
      ['extension.ts'],
      `aggrega/lint is sent from ${senders.length} place(s)`,
    );
  });

  it('composes no command line for the check anywhere in the source tree', () => {
    // 🔴 THE OLD PATTERN, SWEPT FOR RATHER THAN ASSUMED GONE. A retired argument
    // list left standing with no caller is a launch waiting to be reached, and it
    // would be invisible to every assertion above: the request would still be sent
    // from one place, and neither module would hold a launch facility.
    //
    // A tree-wide COUNT rather than a check of the module that composed it, because
    // a call left behind elsewhere would not compile while the composition itself
    // would read as though it were still the path.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const composers = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\[\s*'lint'\s*,/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(composers, []);
    // The positive control for this sweep: the pattern shape still finds an
    // argument list that legitimately remains, so the absence above is an absence.
    const remaining = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\[\s*'plugin'\s*,/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.notDeepStrictEqual(
      remaining,
      [],
      'the argument-list pattern no longer matches a composition that provably exists, so the '
      + 'absence above would pass vacuously',
    );
  });
});
