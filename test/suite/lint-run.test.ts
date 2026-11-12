// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CATALOG_WIDE,
  LINT_SUBJECT,
  LintAnswer,
  LintPublication,
  LintSubject,
  applyLintPublication,
  entityLintSubject,
  runLint,
} from '../../src/lint-run';
import { ConvertedShape } from '../../src/diagnostics-shape';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from '../../src/workspace';
import {
  EXTENSION_ROOT,
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';

// FakeSink is a model of the Problems panel: it holds what is currently on
// screen and carries each publication onto it, so a test reads back exactly the
// entries an author would have seen — including the replacement semantics, which
// are only visible across two runs.
//
// It applies the publication through the same applier the editor-coupled publish
// uses, which is deliberate: the decision under test is what a publication SAYS,
// and re-implementing the application here would test a second applier nothing
// ships. What keeps that from blinding the assertions is that every expectation
// below is a literal, so a defect planted in the decision moves the actual and
// leaves the expected where it was.
class FakeSink {
  published: Map<string, ConvertedShape[]> = new Map();
  replaceCalls = 0;
  replace(publication: LintPublication): void {
    this.replaceCalls++;
    applyLintPublication(
      {
        clearAll: () => this.published.clear(),
        clearFile: (file) => { this.published.delete(file); },
        setFile: (file, shapes) => { this.published.set(file, shapes); },
      },
      publication,
    );
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
  subjects: LintSubject[];
}

// harness builds the run's dependency set over recorders and a caller-supplied
// answer for the request. Every signal and every subject handed to the request
// is kept, so what reached the compiler is a measurement rather than an
// inference.
function harness(root: string | null, answer: () => Promise<LintAnswer>): Harness {
  const sink = new FakeSink();
  const log = new FakeLog();
  const h: Harness = {
    sink,
    log,
    notices: [],
    invocations: 0,
    signals: [],
    subjects: [],
    deps: {
      getWorkspaceRoot: () => root,
      lint: (subject, signal) => {
        h.invocations++;
        h.subjects.push(subject);
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

// The short code of the condition the category rule names, and where the answer
// says it is explained, as a live language server sends them beside the rule's
// identity.
const CATEGORY_SHORT_CODE = 'E0281';
const CATEGORY_HREF = 'https://aggrega.ai/docs/language-reference/errors/sentinels/#every-condition-by-short-code';

// An answer of the shape a live language server gives: one advisory finding
// located to a document and no further, grouped under the document's
// workspace-relative path, carrying the rule's identity, the short code of the
// condition it names and the address explaining it, with the compiler's own
// counts beside it.
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
          shortCode: CATEGORY_SHORT_CODE,
          codeDescription: { href: CATEGORY_HREF },
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

// --- a second entity, for the per-entity cases ----------------------------

const OTHER_MESSAGE =
  'Component at "/ws/catalog/component/core/compute/worker/1.0.0/component.yaml" declares metadata.name="worker" but its path derives name="core/compute/worker"; standard-catalog convention requires the name to mirror the directory';
const OTHER_RELATIVE = 'catalog/component/core/compute/worker/1.0.0/component.yaml';
const OTHER_ABSOLUTE = `/ws/${OTHER_RELATIVE}`;

// A whole-catalog answer carrying one finding in each of two documents. It is
// what the panel holds before a row is pressed, and it is the state the
// per-entity cases below are measured against.
const TWO_ENTITIES: LintAnswer = {
  checked: 127,
  findings: 2,
  errors: 0,
  warnings: 2,
  infos: 0,
  files: [
    {
      file: CATEGORY_RELATIVE,
      diagnostics: [{
        line: 1, column: 1, severity: 'warning', message: CATEGORY_MESSAGE,
        code: 'category-matches-directory', shortCode: CATEGORY_SHORT_CODE, codeDescription: { href: CATEGORY_HREF },
        source: 'aggrega-lint',
      }],
    },
    {
      file: OTHER_RELATIVE,
      diagnostics: [{
        line: 1, column: 1, severity: 'warning', message: OTHER_MESSAGE,
        code: 'name-mirrors-directory', source: 'aggrega-lint',
      }],
    },
  ],
  halted: false,
};

// 🔴 THE ANSWER A RE-CHECK OF A NOW-FIXED ENTITY GIVES, AND IT IS THE CASE A
// NAIVE IMPLEMENTATION FAILS. It names no document at all, so an implementation
// that only SETS leaves the stale entry standing and a reader sees a fixed entity
// still flagged. Only dropping the subject first removes it.
const ENTITY_NOW_CLEAN: LintAnswer = {
  entity: CATEGORY_RELATIVE,
  checked: 1,
  findings: 0,
  errors: 0,
  warnings: 0,
  infos: 0,
  files: [],
  halted: false,
};

// The same entity re-checked and still failing, with the rule's text changed so
// the entry on screen after the second run is distinguishable from the first's.
const ENTITY_STILL_FAILING: LintAnswer = {
  entity: CATEGORY_RELATIVE,
  checked: 1,
  findings: 1,
  errors: 0,
  warnings: 1,
  infos: 0,
  files: [{
    file: CATEGORY_RELATIVE,
    diagnostics: [{
      line: 4, column: 3, severity: 'warning', message: 'a second reading of the same entity',
      code: 'category-matches-directory', shortCode: CATEGORY_SHORT_CODE, codeDescription: { href: CATEGORY_HREF },
      source: 'aggrega-lint',
    }],
  }],
  halted: false,
};

describe('runLint', () => {
  it('publishes one navigable entry per finding, keyed by the entity document', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps, CATALOG_WIDE);

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

    await runLint(h.deps, CATALOG_WIDE);

    assert.strictEqual(h.sink.published.size, 1);
    assert.deepStrictEqual(
      h.notices.map((n) => n.tier),
      ['info'],
      'a findings-bearing run is not an error',
    );
  });

  // The reader-visible log carries each finding as the row the command line
  // prints for it, composed from the answer. An equality on the whole log, not a
  // containment: a containment passes while any one of several lines survives.
  it('writes the compiler\'s report into the log', async () => {
    const h = harness('/ws', () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps, CATALOG_WIDE);

    assert.deepStrictEqual(h.log.lines, [
      `${CATEGORY_ABSOLUTE}:`,
      `warn: E0281 category-matches-directory: ${CATEGORY_MESSAGE}`,
    ]);
    assert.strictEqual(h.log.shown, 0, 'a successful run does not steal focus from the Problems panel');
  });

  it('reports a clean run rather than leaving the reader with nothing', async () => {
    const h = harness('/ws', () => Promise.resolve(CLEAN));

    await runLint(h.deps, CATALOG_WIDE);

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

    await runLint(h.deps, CATALOG_WIDE);
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);

    answer = {
      checked: 127,
      findings: 1,
      errors: 0,
      warnings: 1,
      infos: 0,
      files: [{
        file: 'other.yaml',
        diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'a different entity', code: 'name-shape', source: 'aggrega-lint' }],
      }],
      halted: false,
    };
    await runLint(h.deps, CATALOG_WIDE);

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

    await runLint(h.deps, CATALOG_WIDE);
    assert.strictEqual(h.sink.published.size, 1);

    answer = CLEAN;
    await runLint(h.deps, CATALOG_WIDE);

    assert.strictEqual(h.sink.published.size, 0, 'a fixed finding must disappear');
  });

  // A run that cannot execute surfaces the compiler's own message. The wording
  // here is the compiler's, captured from a real failing run: no configured
  // catalog directory to scan.
  it('surfaces the compiler\'s own message when the check could not run', async () => {
    const productMessage =
      'OPS_ERROR: whole-catalog conventions check needs catalog directories to scan; pass --catalog or set `workspace.catalog_dirs` in .aggrega-config.yaml (or check a specific Release with --release)';
    const h = harness('/ws', () => Promise.reject(new Error(productMessage)));

    await runLint(h.deps, CATALOG_WIDE);

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

    await runLint(h.deps, CATALOG_WIDE);
    assert.strictEqual(h.sink.published.size, 1);

    fail = true;
    await runLint(h.deps, CATALOG_WIDE);

    assert.strictEqual(h.sink.replaceCalls, 1, 'a failed run must not republish');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);
  });

  it('does not ask for the check when no workspace is anchored', async () => {
    const h = harness(null, () => Promise.resolve(ONE_FINDING));

    await runLint(h.deps, CATALOG_WIDE);

    assert.strictEqual(h.invocations, 0, 'no anchor means nothing is asked');
    assert.strictEqual(h.sink.replaceCalls, 0);
    assert.deepStrictEqual(h.notices, [{ message: NO_ANCHORED_WORKSPACE_MESSAGE, tier: 'info' }]);
  });

  it('names a finding that located no document in the log rather than losing it', async () => {
    const h = harness('/ws', () =>
      Promise.resolve({
        checked: 3,
        findings: 1,
        errors: 0,
        warnings: 1,
        infos: 0,
        files: [{ file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'no entity', code: 'a', source: 'aggrega-lint' }] }],
        halted: false,
      }),
    );

    await runLint(h.deps, CATALOG_WIDE);

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

    await runLint(h.deps, CATALOG_WIDE, signal);

    assert.deepStrictEqual(h.signals, [signal], 'the reader\'s signal did not reach the request');
  });

  it('is reported as stopped rather than as a failure', async () => {
    const h = harness('/ws', () => Promise.reject(new OperationCancelled(LINT_SUBJECT)));

    await runLint(h.deps, CATALOG_WIDE, {
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

    await runLint(h.deps, CATALOG_WIDE);
    assert.strictEqual(h.sink.published.size, 1);

    stop = true;
    await runLint(h.deps, CATALOG_WIDE);

    assert.strictEqual(h.sink.replaceCalls, 1, 'a stopped run must not republish');
    assert.deepStrictEqual([...h.sink.published.keys()], [CATEGORY_ABSOLUTE]);
  });
});

// --- a check about one entity ---------------------------------------------

// 🔴 EVERY EXPECTATION IN THIS BLOCK IS A LITERAL. The sink applies the same
// publication the editor-coupled publish applies, so an expectation DERIVED from
// the run would move with a defect planted in the decision and the comparison
// would go green over a broken one. Written out, the expected panel contents are
// fixed independently of whatever the decision produces.
describe('a conventions check about one entity', () => {
  // afterRowPress drives the sequence a reader actually performs: the
  // whole-catalog check, then the row press on the first of the two entities it
  // reported. It returns the harness with the panel model in its final state.
  async function afterRowPress(second: LintAnswer): Promise<Harness> {
    let answer: LintAnswer = TWO_ENTITIES;
    const h = harness('/ws', () => Promise.resolve(answer));

    await runLint(h.deps, CATALOG_WIDE);
    assert.deepStrictEqual(
      onScreen(h),
      [CATEGORY_ABSOLUTE, OTHER_ABSOLUTE],
      'the whole-catalog run did not put both entities on screen, so the press below proves nothing',
    );

    answer = second;
    await runLint(h.deps, entityLintSubject(CATEGORY_RELATIVE));
    return h;
  }

  // onScreen reads the documents the panel holds, in a fixed order.
  //
  // Sorted, because the model's own order is the order entries were inserted and
  // a document that is dropped and set again therefore moves to the end — an
  // artifact of the recorder, not something a reader can observe: the editor
  // orders the Problems panel itself. Sorting is what keeps these equalities
  // about WHICH documents are on screen, which is the claim.
  function onScreen(h: Harness): string[] {
    return [...h.sink.published.keys()].sort();
  }

  it('sends the row\'s own path unconverted, which is the spelling the request takes', async () => {
    const h = await afterRowPress(ENTITY_STILL_FAILING);
    assert.deepStrictEqual(
      h.subjects,
      [{ kind: 'catalog' }, { kind: 'entity', entityPath: CATEGORY_RELATIVE }],
    );
  });

  // 🔴 THE CASE A NAIVE IMPLEMENTATION FAILS.
  it('removes the entity\'s stale findings when it comes back clean', async () => {
    const h = await afterRowPress(ENTITY_NOW_CLEAN);
    assert.strictEqual(
      h.sink.published.has(CATEGORY_ABSOLUTE),
      false,
      'a fixed entity is still flagged: the answer named no document, so only clearing the '
      + 'subject can remove what the previous run published',
    );
  });

  // Its companion. The same press, read from the other side.
  it('leaves every other entity\'s findings standing through that press', async () => {
    const h = await afterRowPress(ENTITY_NOW_CLEAN);
    assert.deepStrictEqual(onScreen(h), [OTHER_ABSOLUTE]);
    assert.deepStrictEqual(
      h.sink.published.get(OTHER_ABSOLUTE)!.map((s) => s.message),
      [OTHER_MESSAGE],
      'the other entity\'s finding was replaced by a run that never looked at it',
    );
  });

  it('replaces its own entity\'s findings when it comes back with a new one', async () => {
    const h = await afterRowPress(ENTITY_STILL_FAILING);
    assert.deepStrictEqual(onScreen(h), [CATEGORY_ABSOLUTE, OTHER_ABSOLUTE]);
    assert.deepStrictEqual(
      h.sink.published.get(CATEGORY_ABSOLUTE)!.map((s) => s.message),
      ['a second reading of the same entity'],
      'the first run\'s finding survived beside the second\'s',
    );
    assert.deepStrictEqual(
      h.sink.published.get(OTHER_ABSOLUTE)!.map((s) => s.message),
      [OTHER_MESSAGE],
    );
  });

  // The repair the move owes: a count with no subject reads identically to a
  // whole-catalog run over a one-entity catalog, which is exactly the confusion a
  // reader who pressed a row would hit.
  it('names the entity in the ending rather than reporting a bare count', async () => {
    const h = await afterRowPress(ENTITY_STILL_FAILING);
    assert.deepStrictEqual(
      h.notices[1],
      {
        message: `Aggrega lint: 1 finding(s) in ${CATEGORY_ABSOLUTE} — see the Problems panel.`,
        tier: 'info',
      },
    );
  });

  it('names the entity on a clean re-check too, so "no findings" says what was checked', async () => {
    const h = await afterRowPress(ENTITY_NOW_CLEAN);
    assert.deepStrictEqual(
      h.notices[1],
      { message: `Aggrega lint: no findings in ${CATEGORY_ABSOLUTE}.`, tier: 'info' },
    );
  });

  // Findings are advisory on every mode this surface asks for, so a press that
  // finds something is a run that succeeded. A red notice here would teach a
  // reader that a convention violation blocks them, which it does not.
  it('ends a findings-bearing run in an information notice, never an error one', async () => {
    const h = await afterRowPress(ENTITY_STILL_FAILING);
    assert.deepStrictEqual(h.notices.map((n) => n.tier), ['info', 'info']);
  });

  // The count the compiler owns can exceed what the panel shows, and the channel
  // does not open on a press, so it cannot carry the explanation.
  it('explains a finding the panel cannot show, where the reader is now looking', async () => {
    const h = await afterRowPress({
      entity: CATEGORY_RELATIVE,
      checked: 1,
      findings: 2,
      errors: 0,
      warnings: 2,
      infos: 0,
      halted: false,
      files: [
        {
          file: CATEGORY_RELATIVE,
          diagnostics: [{
            line: 1, column: 1, severity: 'warning', message: 'located', source: 'aggrega-lint',
          }],
        },
        {
          file: '',
          diagnostics: [{
            line: 1, column: 1, severity: 'warning', message: 'nowhere', source: 'aggrega-lint',
          }],
        },
      ],
    });
    assert.deepStrictEqual(
      h.notices[1],
      {
        message: `Aggrega lint: 2 finding(s) in ${CATEGORY_ABSOLUTE} — see the Problems panel.`
          + ' 1 finding(s) named no entity file, so they appear only in the Aggrega output channel.',
        tier: 'info',
      },
      'a reader is told two findings and shown one, with nothing saying where the other went',
    );
  });
});

// --- a whole-catalog check run once for each Release ------------------------

// The finding the per-Release fixtures carry: one conventions rule's own text,
// as a live language server reported it for a document in a catalog directory
// every Release of the workspace reads.
const SHARED_RELATIVE = 'catalog/component/core/devtool/adminer/1.0.0/component.yaml';
const SHARED_ABSOLUTE = `/ws/${SHARED_RELATIVE}`;
const SHARED_MESSAGE =
  'Component at "/ws/catalog/component/core/devtool/adminer/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="devtool"; standard-catalog convention requires the label to match the first directory segment under core/';
const SHARED_FINDING = {
  line: 1, column: 1, severity: 'warning', message: SHARED_MESSAGE,
  code: 'category-matches-directory', shortCode: CATEGORY_SHORT_CODE, codeDescription: { href: CATEGORY_HREF },
  source: 'aggrega-lint',
};

// The row the command line prints for the shared finding.
const SHARED_ROW = `warn: E0281 category-matches-directory: ${SHARED_MESSAGE}`;

// PER_RELEASE is an answer of the shape a live language server gives a
// whole-catalog check in a workspace whose Releases read catalog directories of
// their own, assembled from two measured answers so one fixture holds every case
// the reading has to get right: a pass run for two Releases that read the same
// directories, a pass whose two Releases read no directory at all, and one
// finding in a directory two passes read, reported by each.
//
// 🔴 ITS TOP-LEVEL FILES ARE WHAT THE COMPILER SENDS BESIDE THE PASSES: every
// pass's findings regrouped by document, so the shared finding is there twice
// under one document with nothing saying which pass found it. A reading that
// took them instead of the passes would show the finding twice, unlabelled, and
// name no Release anywhere — which is the failure every expectation below would
// catch.
const PER_RELEASE: LintAnswer = {
  checked: 17,
  findings: 2,
  errors: 0,
  warnings: 2,
  infos: 0,
  files: [{ file: SHARED_RELATIVE, diagnostics: [SHARED_FINDING, SHARED_FINDING] }],
  halted: false,
  passes: [
    {
      releases: ['release-compose.yaml', 'release-unmapped.yaml'],
      catalogDirs: ['catalog-compose', 'catalog'],
      checked: 8, findings: 1, errors: 0, warnings: 1, infos: 0,
      files: [{ file: SHARED_RELATIVE, diagnostics: [SHARED_FINDING] }],
    },
    {
      releases: ['release-helm-bitnami.yaml', 'release-helm-chart.yaml'],
      catalogDirs: [],
      checked: 0, findings: 0, errors: 0, warnings: 0, infos: 0,
      files: [],
    },
    {
      releases: ['release-helm-synth.yaml'],
      catalogDirs: ['catalog-helm-synth', 'catalog'],
      checked: 9, findings: 1, errors: 0, warnings: 1, infos: 0,
      files: [{ file: SHARED_RELATIVE, diagnostics: [SHARED_FINDING] }],
    },
  ],
};

// sharedEntry is the Problems panel entry the shared finding becomes, carrying
// the message it is shown with.
function sharedEntry(message: string): ConvertedShape {
  return {
    startLine: 0, startChar: 0, endLine: 0, endChar: 0,
    severity: 'warning', message, source: 'aggrega-lint', code: 'category-matches-directory',
    shortCode: CATEGORY_SHORT_CODE, codeHref: CATEGORY_HREF,
  };
}

// 🔴 EVERY EXPECTATION IN THIS BLOCK IS THE WHOLE OF WHAT A READER IS SHOWN, BY
// EQUALITY: every line the channel gains, the one notification, and every entry
// the Problems panel holds. A containment would pass while a pass's heading went
// missing, or while a finding was shown once too often.
describe('a whole-catalog check reported once for each Release', () => {
  it('names each pass in the channel, with the directories it read and its own findings under it', async () => {
    const h = harness('/ws', () => Promise.resolve(PER_RELEASE));

    await runLint(h.deps, CATALOG_WIDE);

    assert.deepStrictEqual(h.log.lines, [
      'Releases release-compose.yaml, release-unmapped.yaml read catalog-compose, catalog',
      `${SHARED_ABSOLUTE}:`,
      SHARED_ROW,
      '',
      'Releases release-helm-bitnami.yaml, release-helm-chart.yaml read no catalog directory, so there is nothing to check for them',
      '',
      'Release release-helm-synth.yaml reads catalog-helm-synth, catalog',
      `${SHARED_ABSOLUTE}:`,
      SHARED_ROW,
    ]);
    assert.strictEqual(h.log.shown, 0, 'a successful run does not steal focus from the Problems panel');
  });

  it('ends in a sentence stating what each pass checked and found, for its own Releases', async () => {
    const h = harness('/ws', () => Promise.resolve(PER_RELEASE));

    await runLint(h.deps, CATALOG_WIDE);

    assert.deepStrictEqual(h.notices, [{
      message: 'Aggrega lint: 1 finding(s) across 8 entities checked for Releases release-compose.yaml, release-unmapped.yaml; '
        + 'Releases release-helm-bitnami.yaml, release-helm-chart.yaml read no catalog directory, so there is nothing to check for them; '
        + '1 finding(s) across 9 entities checked for Release release-helm-synth.yaml — see the Problems panel.',
      tier: 'info',
    }]);
  });

  // A finding more than one pass reported is one entry per pass, each naming
  // that pass's Releases, and nothing is merged.
  it('enters a finding once for each pass that reported it, each entry naming that pass\'s Releases', async () => {
    const h = harness('/ws', () => Promise.resolve(PER_RELEASE));

    await runLint(h.deps, CATALOG_WIDE);

    assert.deepStrictEqual([...h.sink.published], [[SHARED_ABSOLUTE, [
      sharedEntry(`${SHARED_MESSAGE} (found for Releases release-compose.yaml, release-unmapped.yaml)`),
      sharedEntry(`${SHARED_MESSAGE} (found for Release release-helm-synth.yaml)`),
    ]]]);
  });

  // A finding that names no document reaches the channel under its pass and the
  // explanation in the sentence, counted once for each pass that reported it.
  it('counts a finding naming no document once for each pass that reported it', async () => {
    const nowhere = { line: 1, column: 1, severity: 'warning', message: 'nowhere', code: 'a', source: 'aggrega-lint' };
    const h = harness('/ws', () => Promise.resolve({
      ...PER_RELEASE,
      files: [{ file: '', diagnostics: [nowhere, nowhere] }],
      passes: [
        { ...PER_RELEASE.passes![0], files: [{ file: '', diagnostics: [nowhere] }] },
        { ...PER_RELEASE.passes![2], files: [{ file: '', diagnostics: [nowhere] }] },
      ],
    }));

    await runLint(h.deps, CATALOG_WIDE);

    const note = '2 finding(s) named no entity file, so they appear only in the Aggrega output channel.';
    assert.deepStrictEqual(h.log.lines, [
      'Releases release-compose.yaml, release-unmapped.yaml read catalog-compose, catalog',
      '(no entity file):',
      'warn: a: nowhere',
      '',
      'Release release-helm-synth.yaml reads catalog-helm-synth, catalog',
      '(no entity file):',
      'warn: a: nowhere',
      note,
    ]);
    assert.deepStrictEqual(h.notices, [{
      message: 'Aggrega lint: 1 finding(s) across 8 entities checked for Releases release-compose.yaml, release-unmapped.yaml; '
        + `1 finding(s) across 9 entities checked for Release release-helm-synth.yaml — see the Problems panel. ${note}`,
      tier: 'info',
    }]);
    assert.deepStrictEqual([...h.sink.published], []);
  });

  // 🔴 THE PRESENCE OF THE PASSES SELECTS THE READING, NOT HOW MANY THERE ARE. One
  // pass is what a workspace sends whose Releases all read the same directories,
  // and it still names them.
  it('reads a single pass per Release as well, naming its Releases', async () => {
    const h = harness('/ws', () => Promise.resolve({ ...PER_RELEASE, passes: [PER_RELEASE.passes![2]] }));

    await runLint(h.deps, CATALOG_WIDE);

    assert.deepStrictEqual(h.log.lines, [
      'Release release-helm-synth.yaml reads catalog-helm-synth, catalog',
      `${SHARED_ABSOLUTE}:`,
      SHARED_ROW,
    ]);
    assert.deepStrictEqual(h.notices, [{
      message: 'Aggrega lint: 1 finding(s) across 9 entities checked for Release release-helm-synth.yaml — see the Problems panel.',
      tier: 'info',
    }]);
    assert.deepStrictEqual([...h.sink.published], [[SHARED_ABSOLUTE, [
      sharedEntry(`${SHARED_MESSAGE} (found for Release release-helm-synth.yaml)`),
    ]]]);
  });
});

// 🔴 AN ANSWER CARRYING NO PASSES READS AS ONE CATALOG: its findings under their
// documents with no pass heading, one sentence over the whole run, and entries
// naming no Release — the same, byte for byte, whichever spelling of "no passes"
// the published answer carries. Each arm below is one of those spellings.
describe('a whole-catalog check over the workspace\'s own catalog', () => {
  const ONE_PASS: LintAnswer = {
    checked: 7, findings: 1, errors: 0, warnings: 1, infos: 0, halted: false,
    files: [{ file: SHARED_RELATIVE, diagnostics: [SHARED_FINDING] }],
  };
  const spellings: Array<[string, LintAnswer]> = [
    ['with no passes key', ONE_PASS],
    ['with the passes null', { ...ONE_PASS, passes: null }],
    ['with the passes empty', { ...ONE_PASS, passes: [] }],
  ];
  for (const [name, answer] of spellings) {
    it(`reads an answer ${name} as one catalog, naming no Release`, async () => {
      const h = harness('/ws', () => Promise.resolve(answer));

      await runLint(h.deps, CATALOG_WIDE);

      assert.deepStrictEqual(h.log.lines, [
        `${SHARED_ABSOLUTE}:`,
        SHARED_ROW,
      ]);
      assert.deepStrictEqual(h.notices, [{
        message: 'Aggrega lint: 1 finding(s) across 7 entities checked — see the Problems panel.',
        tier: 'info',
      }]);
      assert.deepStrictEqual([...h.sink.published], [[SHARED_ABSOLUTE, [sharedEntry(SHARED_MESSAGE)]]]);
    });
  }
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
    //
    // operation-groups is on the list because the blank-subject refusal has its one
    // home there: it neither starts a process nor imports an editor type, and its
    // own imports reach neither, so admitting it costs the property this reading
    // exists to protect nothing at all.
    // 🔴 THE VALUE LIST, WHICH IS WHAT THE CLAIM IS ABOUT. The wire shapes come
    // from the published contract rather than being restated here, and they come
    // as declarations alone — erased before anything runs, so the module reaches
    // no code through them. Asserted separately below, because a reading that
    // folded the two together would let a later change from one kind to the other
    // pass unnoticed.
    //
    // No module gathering a statement of the wire shapes of this surface's own is
    // on the list, because there is no such statement to gather: the shapes come
    // from the published contract, which is a narrowing of what this module
    // reaches rather than a widening.
    assert.deepStrictEqual(
      valueImports('src/lint-run.ts'),
      [
        './cancellation',
        './diagnostics-shape',
        './operation-groups',
        './operation-outcome',
        './workspace',
        'node:path',
      ],
    );
    assert.deepStrictEqual(typeOnlyImports('src/lint-run.ts'), [WIRE_CONTRACT]);
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
    //
    // 🔴 TWO SHAPES, BECAUSE THE BRACKET READING ALONE IS BLIND TO HALF THE
    // COMPOSITIONS THERE ARE. A verb sent through the shared subject guard never
    // appears as a literal array, so a composition made that way is invisible to
    // that reading — which is the shape a per-entity command line for this check
    // takes.
    //
    // The guard reading is a NAMED SET rather than a zero, and the distinction is
    // the whole point: the guard returns an argument-list shape whichever
    // transport asks for it, so the verb appearing there says a subject was
    // refused-or-trimmed, not that a command line exists. What would make it one is
    // a launch helper reading it, and the census above is what says none does.
    // Naming the one module that may reach it is what makes a SECOND appearance
    // fail — and an equality against a non-empty literal is its own control, since
    // a pattern that stopped matching yields an empty list.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const matching = (pattern: RegExp): string[] => fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => pattern.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();

    assert.deepStrictEqual(matching(/\[\s*'lint'\s*,/), []);
    assert.deepStrictEqual(matching(/withSubject\(\s*'lint'\s*,/), ['lint-run.ts']);

    // The positive control for the bracket sweep: the pattern shape still finds a
    // composition that legitimately remains, so the absence above is an absence.
    assert.notDeepStrictEqual(
      matching(/\[\s*'plugin'\s*,/),
      [],
      'the argument-list pattern no longer matches a composition that provably exists, so the '
      + 'absence above would pass vacuously',
    );
  });

  it('gives both subjects of the check one collection to publish into', () => {
    // The row press and the whole-catalog entry answer one question, so they
    // write into one layer of the Problems panel. Two collections would be two
    // layers for one set of rules, which is a thing a reader has to learn in
    // order to read what is already there — and it is invisible from either
    // run's own output, so it is read off the module that creates them.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/lint.ts'), 'utf8');
    const created = (source.match(/createDiagnosticCollection\s*\(/g) ?? []).length;
    assert.strictEqual(created, 1, 'the conventions check creates more than one collection');
    // And both entries are driven from one dependency set, so neither can be
    // given a sink of its own without this reading changing.
    assert.strictEqual((source.match(/sink:/g) ?? []).length, 1);
  });
});
