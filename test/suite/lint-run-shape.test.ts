// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import {
  CATALOG_WIDE,
  LintAnswer,
  countUnlocatable,
  findingsByFile,
  lintPublication,
  reportLines,
  summaryLine,
  unlocatableNote,
} from '../../src/lint-run';
import { SeverityToken, editorCodeForShape, shapeForDaemonDiagnostic } from '../../src/diagnostics-shape';

// WORKSPACE_ROOT is the root the answer's relative paths are resolved against.
const WORKSPACE_ROOT = '/ws';

// The answer and the command line's report below were captured over one scratch
// workspace, whose root differs from run to run. It is written as WORKSPACE_ROOT
// where the document is named on a line of its own, and left out where the
// rule's message quotes the document's path, on both sides alike, so each side
// is compared as it was measured.

// MEASURED_MESSAGE is a conventions rule's own text, captured from a real run.
// It is carried through byte for byte on both surfaces, so it is the literal both
// renderings below are written against.
const MEASURED_MESSAGE =
  'Component at "/catalog/component/core/ai-tool/search/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="ai-tool"; standard-catalog convention requires the label to match the first directory segment under core/';

const MEASURED_RELATIVE_FILE = 'catalog/component/core/ai-tool/search/1.0.0/component.yaml';

// MEASURED_HREF is where the answer says the condition the finding's rule names
// is explained, captured with the finding.
const MEASURED_HREF = 'https://aggrega.ai/docs/language-reference/errors/sentinels/#every-condition-by-short-code';

// MEASURED_ANSWER is the aggrega/lint answer, captured verbatim from a live
// language server over a workspace whose one catalog entity carries a planted
// category mismatch. It is the contract this module is written against, and
// every field below was read off the wire rather than off the Go struct: the file
// spelled RELATIVE to the workspace root, the "warning" severity spelling, the
// rule identity arriving as `code`, the short code of the condition that rule
// names arriving as `shortCode` with the address explaining it as
// `codeDescription`, the compiler's own layer name in `source`, and line/column
// 1/1 standing for a finding the rule located to a document and no further.
const MEASURED_ANSWER: LintAnswer = {
  checked: 1,
  findings: 1,
  errors: 0,
  warnings: 1,
  infos: 0,
  files: [
    {
      file: MEASURED_RELATIVE_FILE,
      diagnostics: [
        {
          line: 1,
          column: 1,
          severity: 'warning',
          message: MEASURED_MESSAGE,
          code: 'category-matches-directory',
          shortCode: 'E0281',
          codeDescription: { href: MEASURED_HREF },
          source: 'aggrega-lint',
        },
      ],
    },
  ],
  halted: false,
};

// COMMAND_LINE_REPORT is what `aggrega lint` writes to its error stream for this
// same finding, captured verbatim from a run over the same workspace: the
// absolute document path on its own line, then the finding's severity, the short
// code of the condition its rule names, the rule identity and the message.
//
// 🔴 IT IS A LITERAL READ OFF THE COMPILER, NOT A VALUE THIS MODULE COMPUTES.
// The parity claim below is only worth anything because the two sides were
// measured independently: one from the command line's stderr, the other from the
// language server's answer. A value derived from the implementation would agree
// with it whatever the implementation did.
const COMMAND_LINE_REPORT = [
  `/ws/${MEASURED_RELATIVE_FILE}:`,
  `warn: E0281 category-matches-directory: ${MEASURED_MESSAGE}`,
];

describe('the conventions findings on their way to the Problems panel', () => {
  // The request surface writes "warning"; the unknown-severity fallback is
  // 'error', so a spelling this conversion did not accept would render every
  // advisory conventions finding as an Error squiggle.
  it('maps the answer\'s "warning" spelling to the warning tier', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.strictEqual(shape.severity, 'warning');
  });

  it('carries the rule identity and the compiler\'s own layer name', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.strictEqual(shape.code, 'category-matches-directory');
    assert.strictEqual(shape.source, 'aggrega-lint');
  });

  // The document-validation layer's diagnostics carry source 'aggrega'. A shared
  // source would merge the two in the Problems panel, so they must differ.
  it('files conventions findings under a layer distinct from the validation layer\'s', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.notStrictEqual(shape.source, 'aggrega');
  });

  it('carries the rule\'s message through unchanged', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.strictEqual(shape.message, MEASURED_MESSAGE);
  });

  // The entry's tag is what the editor shows beside the message: the short code a
  // reader quotes, opening where that code is explained. The rule identity stays
  // on the entry for whatever matches on it.
  it('tags the entry with the short code of the condition the rule names, opening where it is explained', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.deepStrictEqual(editorCodeForShape(shape), { value: 'E0281', target: MEASURED_HREF });
    assert.strictEqual(shape.code, 'category-matches-directory');
  });

  // The measured common case: the rule located its finding to a document and no
  // further, which the answer states as the head of the file. That converts to
  // the document origin — the editor's own encoding for a file-scoped problem.
  it('draws a document-scoped finding at the document origin', () => {
    const shape = shapeForDaemonDiagnostic(MEASURED_ANSWER.files![0].diagnostics![0]);
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
    assert.strictEqual(shape.endLine, 0);
    assert.strictEqual(shape.endChar, 0);
  });

  it('converts a supplied 1-based line and column to a 0-based position', () => {
    const shape = shapeForDaemonDiagnostic({
      line: 7, column: 3, severity: 'warning', message: 'x', code: 'name-shape', source: 'aggrega-lint',
    });
    assert.strictEqual(shape.startLine, 6);
    assert.strictEqual(shape.startChar, 2);
    assert.strictEqual(shape.endLine, 6);
    assert.strictEqual(shape.endChar, 2);
  });

  // The span the retired path could not carry at all: its finding shape had no
  // end position, so every located finding was drawn as a point.
  it('spans the whole token when the answer carries an end position', () => {
    const shape = shapeForDaemonDiagnostic({
      line: 7, column: 3, end_line: 7, end_column: 11,
      severity: 'warning', message: 'x', code: 'name-shape', source: 'aggrega-lint',
    });
    assert.strictEqual(shape.startLine, 6);
    assert.strictEqual(shape.startChar, 2);
    assert.strictEqual(shape.endLine, 6);
    assert.strictEqual(shape.endChar, 10);
  });

  // The accessibility convention the language-server path already guards: state
  // is conveyed by a semantic severity token and by the message text, never by
  // color alone. It binds this surface identically.
  it('gives every severity spelling a semantic token, so state is never color-alone', () => {
    const validTokens: SeverityToken[] = ['error', 'warning', 'information'];
    for (const severity of ['error', 'warn', 'warning', 'info', 'information', 'gibberish', '']) {
      const shape = shapeForDaemonDiagnostic({
        line: 1, column: 1, severity, message: 'a finding', code: 'r', source: 'aggrega-lint',
      });
      assert.ok(
        validTokens.includes(shape.severity),
        `severity ${JSON.stringify(severity)} produced non-semantic token ${JSON.stringify(shape.severity)}`,
      );
      assert.strictEqual(shape.message, 'a finding');
    }
  });

  // The answer's counts reach beyond the only spelling a non-halting run emits,
  // so both other tiers must land on their own token rather than the fallback.
  it('maps the error and info tiers the counts imply', () => {
    const at = (severity: string): SeverityToken => shapeForDaemonDiagnostic({
      line: 1, column: 1, severity, message: '', code: 'r', source: 'aggrega-lint',
    }).severity;
    assert.strictEqual(at('error'), 'error');
    assert.strictEqual(at('info'), 'information');
  });
});


// The published answer carries every count and the halt verdict on every run.
// The fixtures below carry only the members the test under them is about, so
// each stays a statement of one fact rather than a whole answer restated; the
// cast is what lets a fixture be that narrow.
function partialAnswer(a: Partial<LintAnswer>): LintAnswer {
  return a as LintAnswer;
}

describe('findingsByFile', () => {
  // 🔴 THE ANSWER SPELLS A CONTAINED DOCUMENT RELATIVE TO THE WORKSPACE ROOT.
  // A key used unresolved would build a file URI against the extension host's
  // working directory, so every finding would land on a document that does not
  // exist and none would be navigable.
  it('resolves the answer\'s relative document path against the workspace root', () => {
    const byFile = findingsByFile(MEASURED_ANSWER, WORKSPACE_ROOT);
    assert.deepStrictEqual([...byFile.keys()], [`/ws/${MEASURED_RELATIVE_FILE}`]);
  });

  // A catalog directory need not sit under the workspace root, and the answer
  // spells a document outside it absolutely. Resolution must leave that alone.
  it('leaves an absolute document path outside the workspace root unchanged', () => {
    const answer = partialAnswer({
      files: [{
        file: '/elsewhere/catalog/component.yaml',
        diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'x', source: 'aggrega-lint' }],
      }],
    });
    assert.deepStrictEqual([...findingsByFile(answer, WORKSPACE_ROOT).keys()], ['/elsewhere/catalog/component.yaml']);
  });

  it('preserves the compiler\'s order within a document', () => {
    const answer = partialAnswer({
      files: [
        {
          file: 'x.yaml',
          diagnostics: [
            { line: 1, column: 1, severity: 'warning', message: 'first', source: 'aggrega-lint' },
            { line: 1, column: 1, severity: 'warning', message: 'second', source: 'aggrega-lint' },
          ],
        },
        {
          file: 'y.yaml',
          diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'other', source: 'aggrega-lint' }],
        },
      ],
    });
    const byFile = findingsByFile(answer, WORKSPACE_ROOT);
    assert.deepStrictEqual([...byFile.keys()], ['/ws/x.yaml', '/ws/y.yaml']);
    assert.deepStrictEqual(byFile.get('/ws/x.yaml')!.map((s) => s.message), ['first', 'second']);
  });

  it('publishes nothing for an answer carrying no findings', () => {
    assert.strictEqual(findingsByFile(partialAnswer({ checked: 127, findings: 0, files: [] }), WORKSPACE_ROOT).size, 0);
  });

  it('tolerates an answer missing the files key', () => {
    assert.strictEqual(findingsByFile(partialAnswer({}), WORKSPACE_ROOT).size, 0);
    assert.strictEqual(countUnlocatable(partialAnswer({})), 0);
  });

  // The answer groups a finding whose rule named no document under the empty
  // path, which is how it says "this one locates nothing" rather than dropping it.
  it('drops the group that names no document and counts its entries instead', () => {
    const answer = partialAnswer({
      files: [
        { file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'nowhere', source: 'aggrega-lint' }] },
        { file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'somewhere', source: 'aggrega-lint' }] },
      ],
    });
    assert.deepStrictEqual([...findingsByFile(answer, WORKSPACE_ROOT).keys()], ['/ws/x.yaml']);
    assert.strictEqual(countUnlocatable(answer), 1);
  });
});

describe('reportLines — each finding as the command line prints it, composed from the answer', () => {
  // 🔴 THE PARITY ASSERTION. The two sides were measured independently: the
  // expectation is the command line's own stderr, captured verbatim, and the
  // actual is composed from the language server's answer. An equality, not a
  // containment — a containment passes while any one of several lines survives —
  // against the command line's lines exactly as captured.
  it('reproduces what the command line prints for the same finding', () => {
    assert.deepStrictEqual(reportLines(MEASURED_ANSWER, WORKSPACE_ROOT), COMMAND_LINE_REPORT);
  });

  // The message is the part a reader acts on, so it is compared on its own as
  // well: the surrounding frame could change without the rule's own text moving,
  // and it is the text that must never be re-worded.
  it('carries the rule\'s own text into the log byte for byte', () => {
    const line = reportLines(MEASURED_ANSWER, WORKSPACE_ROOT)[1];
    assert.ok(line.endsWith(MEASURED_MESSAGE), `the rule's text was altered on its way to the log: ${line}`);
    assert.strictEqual(
      line.slice(line.length - MEASURED_MESSAGE.length),
      COMMAND_LINE_REPORT[1].slice(COMMAND_LINE_REPORT[1].length - MEASURED_MESSAGE.length),
      'the two surfaces must not word one finding differently',
    );
  });

  it('names the document by a path a reader can open', () => {
    assert.strictEqual(reportLines(MEASURED_ANSWER, WORKSPACE_ROOT)[0], `/ws/${MEASURED_RELATIVE_FILE}:`);
  });

  // The findings below are ones the measured answer does not carry. Each expected
  // row is the one the command line writes for such a finding: its tier's word
  // and a colon, each identifier it carries and a colon closing them, then the
  // message.
  it('opens a finding at the information tier with the command line\'s word for it', () => {
    const answer = partialAnswer({
      files: [{ file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'info', message: 'an observation', code: 'name-shape', shortCode: 'E0278', source: 'aggrega-lint' }] }],
    });
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), ['/ws/x.yaml:', 'info: E0278 name-shape: an observation']);
  });

  // A rule no condition names carries no short code — a rule from a linter the
  // workspace attaches, reporting from a rule set of its own.
  it('names a rule no condition names by its identity alone', () => {
    const answer = partialAnswer({
      files: [{ file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'its own sentence', code: 'rule-of-another-linter', source: 'aggrega-lint' }] }],
    });
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), ['/ws/x.yaml:', 'warn: rule-of-another-linter: its own sentence']);
  });

  // The two findings below were reported by a linter the workspace attaches, and
  // each side was captured from a live run over one entity: the answer's entry
  // from the language server, the row from the command line's error stream.
  //
  // No identifier is stood in for an absent one, and with none there is nothing
  // for a colon to close: the row is the tier's word, a colon and the message.
  it('writes a finding that names no rule with no identifier', () => {
    const answer = partialAnswer({
      files: [{ file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'probe: no identifier at all', source: 'aggrega-lint' }] }],
    });
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), ['/ws/x.yaml:', 'warn: probe: no identifier at all']);
  });

  // A finding naming no rule but reported under a code of its own is named by
  // that code, in the answer's `code` and on the command line's row alike. No
  // condition is named, so no short code precedes it.
  it('names a finding that names no rule by the code of its own it carries', () => {
    const answer = partialAnswer({
      files: [{ file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'probe: a code of its own and no rule', code: 'code-of-another-linter', source: 'aggrega-lint' }] }],
    });
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), ['/ws/x.yaml:', 'warn: code-of-another-linter: probe: a code of its own and no rule']);
  });

  // The command line raises a halting finding rather than writing a row for it,
  // so a tier it has no row for has no word of the command line's to carry: it is
  // written as the answer spells it.
  it('writes a tier the command line has no row for as the answer spells it', () => {
    const answer = partialAnswer({
      files: [{
        file: 'x.yaml',
        diagnostics: [
          { line: 1, column: 1, severity: 'error', message: 'halting', code: 'category-matches-directory', shortCode: 'E0281', source: 'aggrega-lint' },
          { line: 1, column: 1, severity: 'gibberish', message: 'unknown', code: 'r', source: 'aggrega-lint' },
        ],
      }],
    });
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), [
      '/ws/x.yaml:',
      'error: E0281 category-matches-directory: halting',
      'gibberish: r: unknown',
    ]);
  });

  it('writes nothing for an answer with no findings', () => {
    assert.deepStrictEqual(reportLines(partialAnswer({ checked: 127, findings: 0, files: [] }), WORKSPACE_ROOT), []);
  });
});

// --- the heading each pass is opened with ---------------------------------

// MEASURED_PER_RELEASE is the aggrega/lint answer a live language server gave a
// whole-catalog check in a workspace whose Releases read catalog directories of
// their own — four Release files, two of them reading the same directories —
// with its counts and empty finding lists as sent.
const MEASURED_PER_RELEASE: LintAnswer = {
  checked: 34, findings: 0, errors: 0, warnings: 0, infos: 0, files: [], halted: false,
  passes: [
    { releases: ['release-compose.yaml', 'release-unmapped.yaml'], catalogDirs: ['catalog-compose', 'catalog'], checked: 8, findings: 0, errors: 0, warnings: 0, infos: 0, files: [] },
    { releases: ['release-helm-bitnami.yaml'], catalogDirs: ['catalog-helm-bitnami', 'catalog'], checked: 8, findings: 0, errors: 0, warnings: 0, infos: 0, files: [] },
    { releases: ['release-helm-chart.yaml'], catalogDirs: ['catalog-helm-chart', 'catalog'], checked: 9, findings: 0, errors: 0, warnings: 0, infos: 0, files: [] },
    { releases: ['release-helm-synth.yaml'], catalogDirs: ['catalog-helm-synth', 'catalog'], checked: 9, findings: 0, errors: 0, warnings: 0, infos: 0, files: [] },
  ],
};

// COMMAND_LINE_PER_RELEASE is what `aggrega lint` prints over the same
// workspace, captured verbatim: each pass opened by the line naming its
// Releases and the directories they read, closed by its count, the passes
// parted by an empty line.
//
// 🔴 A LITERAL READ OFF THE COMMAND LINE, FOR THE SAME REASON THE REPORT ABOVE IS:
// the heading is the compiler's wording, composed on this side because it cannot
// be called across the language boundary, and only a capture taken independently
// of this module can say the two still agree.
const COMMAND_LINE_PER_RELEASE = [
  'Releases release-compose.yaml, release-unmapped.yaml read catalog-compose, catalog',
  'conventions checked: 8 entities, 0 advisory finding(s)',
  '',
  'Release release-helm-bitnami.yaml reads catalog-helm-bitnami, catalog',
  'conventions checked: 8 entities, 0 advisory finding(s)',
  '',
  'Release release-helm-chart.yaml reads catalog-helm-chart, catalog',
  'conventions checked: 9 entities, 0 advisory finding(s)',
  '',
  'Release release-helm-synth.yaml reads catalog-helm-synth, catalog',
  'conventions checked: 9 entities, 0 advisory finding(s)',
];

// The command line's line for a pass whose Releases read no catalog directory,
// captured verbatim from a workspace naming two of its Release files under
// `workspace.releases` and not the other two.
const COMMAND_LINE_READ_NOTHING =
  'Releases release-helm-bitnami.yaml, release-helm-chart.yaml read no catalog directory, so there is nothing to check for them';

describe('the line each pass of a whole-catalog check is opened with', () => {
  // The per-pass count is the one line of the command line's report the channel
  // does not repeat: the counts are what the run's closing sentence states, for
  // each pass, so they are set aside here by name rather than matched loosely.
  it('reproduces the command line\'s heading for each pass, and parts the passes as it does', () => {
    assert.deepStrictEqual(
      reportLines(MEASURED_PER_RELEASE, WORKSPACE_ROOT),
      COMMAND_LINE_PER_RELEASE.filter((l) => !l.startsWith('conventions checked: ')),
    );
  });

  it('says a pass read nothing in the command line\'s own words', () => {
    assert.deepStrictEqual(
      reportLines(partialAnswer({
        passes: [{ releases: ['release-helm-bitnami.yaml', 'release-helm-chart.yaml'], catalogDirs: [], checked: 0, findings: 0, errors: 0, warnings: 0, infos: 0, files: [] }],
      }), WORKSPACE_ROOT),
      [COMMAND_LINE_READ_NOTHING],
    );
  });

  it('states each pass\'s own count in the closing sentence, for its own Releases', () => {
    assert.strictEqual(
      summaryLine(MEASURED_PER_RELEASE, WORKSPACE_ROOT),
      'Aggrega lint: no findings across 8 entities checked for Releases release-compose.yaml, release-unmapped.yaml; '
        + 'no findings across 8 entities checked for Release release-helm-bitnami.yaml; '
        + 'no findings across 9 entities checked for Release release-helm-chart.yaml; '
        + 'no findings across 9 entities checked for Release release-helm-synth.yaml.',
    );
  });
});

// 🔴 EVERY SENTENCE BELOW IS A LITERAL THE WHOLE-CATALOG ARM ALREADY PRODUCED,
// CARRIED THROUGH UNCHANGED. The subject clause is what was added, and it is
// reached only by an answer that names an entity — so an answer that names none
// reads exactly as it did, and a sentence here changing is the signal that the
// whole-catalog arm moved.
describe('summaryLine', () => {
  it('reports the finding count and the corpus the run covered', () => {
    assert.strictEqual(
      summaryLine(partialAnswer({ checked: 127, findings: 1, files: MEASURED_ANSWER.files }), WORKSPACE_ROOT),
      'Aggrega lint: 1 finding(s) across 127 entities checked — see the Problems panel.',
    );
  });

  // 🔴 NO FINDINGS OVER 127 ENTITIES AND NO FINDINGS OVER NONE ARE DIFFERENT
  // ANSWERS, so a clean run states its corpus rather than staying silent.
  it('states a clean run over a named corpus', () => {
    assert.strictEqual(
      summaryLine(partialAnswer({ checked: 127, findings: 0, files: [] }), WORKSPACE_ROOT),
      'Aggrega lint: no findings across 127 entities checked.',
    );
  });

  it('distinguishes a clean run over nothing from a clean run over a catalog', () => {
    assert.notStrictEqual(
      summaryLine(partialAnswer({ checked: 0, findings: 0, files: [] }), WORKSPACE_ROOT),
      summaryLine(partialAnswer({ checked: 127, findings: 0, files: [] }), WORKSPACE_ROOT),
    );
    assert.strictEqual(
      summaryLine(partialAnswer({ checked: 0, findings: 0, files: [] }), WORKSPACE_ROOT),
      'Aggrega lint: no findings across 0 entities checked.',
    );
  });

  // A count the compiler never sent is never shown.
  it('omits the corpus clause when the answer carried no count', () => {
    assert.strictEqual(summaryLine(partialAnswer({ findings: 0 }), WORKSPACE_ROOT), 'Aggrega lint: no findings.');
  });

  it('omits every count when the answer carried none', () => {
    assert.strictEqual(summaryLine(partialAnswer({}), WORKSPACE_ROOT), 'Aggrega lint: run complete.');
  });

  // 🔴 THE FIELD THE ANSWER HAS ALWAYS CARRIED AND NOTHING READ. A run about one
  // entity and a whole-catalog run over a one-entity catalog report the same
  // count, so the count cannot tell them apart; the echoed subject can, and it is
  // what a reader who pressed a row needs back.
  it('names the entity an answer says it was about', () => {
    assert.strictEqual(
      summaryLine(
        partialAnswer({ entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 1, files: [] }),
        WORKSPACE_ROOT,
      ),
      `Aggrega lint: 1 finding(s) in /ws/${MEASURED_RELATIVE_FILE} — see the Problems panel.`,
    );
  });

  it('tells a one-entity run apart from a whole-catalog run over one entity', () => {
    // The discriminator is the field's presence, never the count: both answers
    // below report one entity checked and no findings.
    assert.notStrictEqual(
      summaryLine(partialAnswer({ entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 0 }), WORKSPACE_ROOT),
      summaryLine(partialAnswer({ checked: 1, findings: 0 }), WORKSPACE_ROOT),
    );
  });

  // The count is the compiler's own and includes findings that named no
  // document; those cannot be published against any file, so the panel shows
  // fewer than the sentence states. Excluding them would mean recounting a number
  // the compiler owns, so the difference is explained instead.
  it('explains a count the Problems panel cannot match', () => {
    assert.strictEqual(
      summaryLine(
        partialAnswer({
          checked: 127,
          findings: 2,
          files: [
            { file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'located', source: 'aggrega-lint' }] },
            { file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'nowhere', source: 'aggrega-lint' }] },
          ],
        }),
        WORKSPACE_ROOT,
      ),
      'Aggrega lint: 2 finding(s) across 127 entities checked — see the Problems panel.'
      + ' 1 finding(s) named no entity file, so they appear only in the Aggrega output channel.',
    );
  });

  it('says nothing about unlocatable findings when there are none', () => {
    assert.strictEqual(unlocatableNote(MEASURED_ANSWER), '');
  });
});

// --- what one answer replaces --------------------------------------------

describe('lintPublication', () => {
  const ENTITY = { kind: 'entity' as const, entityPath: MEASURED_RELATIVE_FILE };

  it('replaces everything for a whole-catalog run, which is every document it covered', () => {
    const publication = lintPublication(CATALOG_WIDE, MEASURED_ANSWER, WORKSPACE_ROOT);
    assert.strictEqual(publication.clearAll, true);
    assert.deepStrictEqual(publication.clear, []);
    assert.deepStrictEqual([...publication.set.keys()], [`/ws/${MEASURED_RELATIVE_FILE}`]);
  });

  it('drops only the entity it was about, so the rest of the panel stands', () => {
    const publication = lintPublication(
      ENTITY,
      partialAnswer({ entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 0, files: [] }),
      WORKSPACE_ROOT,
    );
    assert.strictEqual(publication.clearAll, false);
    assert.deepStrictEqual(publication.clear, [`/ws/${MEASURED_RELATIVE_FILE}`]);
    assert.strictEqual(publication.set.size, 0);
  });

  // 🔴 THE UNION, NOT THE SUBJECT ALONE. Findings are grouped by their own
  // location, so an answer about one entity may name another document — and a
  // group arriving empty says that document is now clean, which only a drop
  // expresses.
  it('drops the union of its subject and every document the answer names', () => {
    const publication = lintPublication(
      ENTITY,
      partialAnswer({
        entity: MEASURED_RELATIVE_FILE,
        checked: 1,
        findings: 0,
        files: [{ file: 'elsewhere.yaml', diagnostics: [] }],
      }),
      WORKSPACE_ROOT,
    );
    assert.deepStrictEqual(
      publication.clear,
      [`/ws/${MEASURED_RELATIVE_FILE}`, '/ws/elsewhere.yaml'],
    );
  });

  it('names a document once when the subject is also the document the answer carries', () => {
    const publication = lintPublication(ENTITY, MEASURED_ANSWER, WORKSPACE_ROOT);
    assert.deepStrictEqual(publication.clear, [`/ws/${MEASURED_RELATIVE_FILE}`]);
    assert.deepStrictEqual([...publication.set.keys()], [`/ws/${MEASURED_RELATIVE_FILE}`]);
  });

  it('drops nothing for a group that names no document, having nothing to drop it from', () => {
    const publication = lintPublication(
      ENTITY,
      partialAnswer({ entity: MEASURED_RELATIVE_FILE, files: [{ file: '', diagnostics: [] }] }),
      WORKSPACE_ROOT,
    );
    assert.deepStrictEqual(publication.clear, [`/ws/${MEASURED_RELATIVE_FILE}`]);
  });
});
