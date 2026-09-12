// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
import { SeverityToken, shapeForDaemonDiagnostic } from '../../src/diagnostics-shape';

// WORKSPACE_ROOT is the root the answer's relative paths are resolved against.
const WORKSPACE_ROOT = '/ws';

// MEASURED_MESSAGE is a conventions rule's own text, captured from a real run.
// It is carried through byte for byte on both surfaces, so it is the literal both
// renderings below are written against.
const MEASURED_MESSAGE =
  'Component at "/catalog/component/core/ai-tool/search/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="ai-tool"; standard-catalog convention requires the label to match the first directory segment under core/';

const MEASURED_RELATIVE_FILE = 'catalog/component/core/ai-tool/search/1.0.0/component.yaml';

// MEASURED_ANSWER is the aggrega/lint answer, captured verbatim from a live
// language server over a fixture catalog with a planted category mismatch. It is
// the contract this module is written against, and every field below was read off
// the wire rather than off the Go struct: the file spelled RELATIVE to the
// workspace root, the "warning" severity spelling, the rule identity arriving as
// `code`, the compiler's own layer name in `source`, and line/column 1/1 standing
// for a finding the rule located to a document and no further.
const MEASURED_ANSWER: LintAnswer = {
  checked: 127,
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
          source: 'aggrega-lint',
        },
      ],
    },
  ],
  halted: false,
};

// COMMAND_LINE_REPORT is what `aggrega lint` prints for this same finding,
// captured verbatim from a real run: the absolute document path on its own line,
// then severity, rule identity and message.
//
// 🔴 IT IS A LITERAL READ OFF THE COMPILER, NOT A VALUE THIS MODULE COMPUTES.
// The parity claim below is only worth anything because the two sides were
// measured independently: one from the command line's stderr, the other from the
// language server's answer. A value derived from the implementation would agree
// with it whatever the implementation did.
const COMMAND_LINE_REPORT = [
  `/ws/${MEASURED_RELATIVE_FILE}:`,
  `[warn] category-matches-directory: ${MEASURED_MESSAGE}`,
];

// The command line and the request surface spell the middle severity tier
// differently — the compiler's own vocabulary on each of its two wires. Nothing
// in the extension re-words it; the parity assertion names the substitution
// explicitly so the one difference is asserted rather than glossed over.
const REPORT_WITH_REQUEST_SURFACE_SEVERITY = COMMAND_LINE_REPORT.map((l) =>
  l.replace('[warn] ', '[warning] '),
);

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
    const answer: LintAnswer = {
      files: [{
        file: '/elsewhere/catalog/component.yaml',
        diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'x', source: 'aggrega-lint' }],
      }],
    };
    assert.deepStrictEqual([...findingsByFile(answer, WORKSPACE_ROOT).keys()], ['/elsewhere/catalog/component.yaml']);
  });

  it('preserves the compiler\'s order within a document', () => {
    const answer: LintAnswer = {
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
    };
    const byFile = findingsByFile(answer, WORKSPACE_ROOT);
    assert.deepStrictEqual([...byFile.keys()], ['/ws/x.yaml', '/ws/y.yaml']);
    assert.deepStrictEqual(byFile.get('/ws/x.yaml')!.map((s) => s.message), ['first', 'second']);
  });

  it('publishes nothing for an answer carrying no findings', () => {
    assert.strictEqual(findingsByFile({ checked: 127, findings: 0, files: [] }, WORKSPACE_ROOT).size, 0);
  });

  it('tolerates an answer missing the files key', () => {
    assert.strictEqual(findingsByFile({}, WORKSPACE_ROOT).size, 0);
    assert.strictEqual(countUnlocatable({}), 0);
  });

  // The answer groups a finding whose rule named no document under the empty
  // path, which is how it says "this one locates nothing" rather than dropping it.
  it('drops the group that names no document and counts its entries instead', () => {
    const answer: LintAnswer = {
      files: [
        { file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'nowhere', source: 'aggrega-lint' }] },
        { file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'somewhere', source: 'aggrega-lint' }] },
      ],
    };
    assert.deepStrictEqual([...findingsByFile(answer, WORKSPACE_ROOT).keys()], ['/ws/x.yaml']);
    assert.strictEqual(countUnlocatable(answer), 1);
  });
});

describe('reportLines — the compiler\'s own report format, composed from the answer', () => {
  // 🔴 THE PARITY ASSERTION. The two sides were measured independently: the
  // expectation is the command line's own stderr, captured verbatim, and the
  // actual is composed from the language server's answer. An equality, not a
  // containment — a containment passes while any one of several lines survives.
  it('reproduces what the command line prints for the same finding', () => {
    assert.deepStrictEqual(
      reportLines(MEASURED_ANSWER, WORKSPACE_ROOT),
      REPORT_WITH_REQUEST_SURFACE_SEVERITY,
    );
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

  it('renders a finding whose producer assigned no rule identity without an empty one', () => {
    const answer: LintAnswer = {
      files: [{ file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'no rule', source: 'aggrega-lint' }] }],
    };
    assert.deepStrictEqual(reportLines(answer, WORKSPACE_ROOT), ['/ws/x.yaml:', '[warning] no rule']);
  });

  it('writes nothing for an answer with no findings', () => {
    assert.deepStrictEqual(reportLines({ checked: 127, findings: 0, files: [] }, WORKSPACE_ROOT), []);
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
      summaryLine(MEASURED_ANSWER, WORKSPACE_ROOT),
      'Aggrega lint: 1 finding(s) across 127 entities checked — see the Problems panel.',
    );
  });

  // 🔴 NO FINDINGS OVER 127 ENTITIES AND NO FINDINGS OVER NONE ARE DIFFERENT
  // ANSWERS, so a clean run states its corpus rather than staying silent.
  it('states a clean run over a named corpus', () => {
    assert.strictEqual(
      summaryLine({ checked: 127, findings: 0, files: [] }, WORKSPACE_ROOT),
      'Aggrega lint: no findings across 127 entities checked.',
    );
  });

  it('distinguishes a clean run over nothing from a clean run over a catalog', () => {
    assert.notStrictEqual(
      summaryLine({ checked: 0, findings: 0, files: [] }, WORKSPACE_ROOT),
      summaryLine({ checked: 127, findings: 0, files: [] }, WORKSPACE_ROOT),
    );
    assert.strictEqual(
      summaryLine({ checked: 0, findings: 0, files: [] }, WORKSPACE_ROOT),
      'Aggrega lint: no findings across 0 entities checked.',
    );
  });

  // A count the compiler never sent is never shown.
  it('omits the corpus clause when the answer carried no count', () => {
    assert.strictEqual(summaryLine({ findings: 0 }, WORKSPACE_ROOT), 'Aggrega lint: no findings.');
  });

  it('omits every count when the answer carried none', () => {
    assert.strictEqual(summaryLine({}, WORKSPACE_ROOT), 'Aggrega lint: run complete.');
  });

  // 🔴 THE FIELD THE ANSWER HAS ALWAYS CARRIED AND NOTHING READ. A run about one
  // entity and a whole-catalog run over a one-entity catalog report the same
  // count, so the count cannot tell them apart; the echoed subject can, and it is
  // what a reader who pressed a row needs back.
  it('names the entity an answer says it was about', () => {
    assert.strictEqual(
      summaryLine(
        { entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 1, files: [] },
        WORKSPACE_ROOT,
      ),
      `Aggrega lint: 1 finding(s) in /ws/${MEASURED_RELATIVE_FILE} — see the Problems panel.`,
    );
  });

  it('tells a one-entity run apart from a whole-catalog run over one entity', () => {
    // The discriminator is the field's presence, never the count: both answers
    // below report one entity checked and no findings.
    assert.notStrictEqual(
      summaryLine({ entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 0 }, WORKSPACE_ROOT),
      summaryLine({ checked: 1, findings: 0 }, WORKSPACE_ROOT),
    );
  });

  // The count is the compiler's own and includes findings that named no
  // document; those cannot be published against any file, so the panel shows
  // fewer than the sentence states. Excluding them would mean recounting a number
  // the compiler owns, so the difference is explained instead.
  it('explains a count the Problems panel cannot match', () => {
    assert.strictEqual(
      summaryLine(
        {
          checked: 127,
          findings: 2,
          files: [
            { file: 'x.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'located', source: 'aggrega-lint' }] },
            { file: '', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'nowhere', source: 'aggrega-lint' }] },
          ],
        },
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
      { entity: MEASURED_RELATIVE_FILE, checked: 1, findings: 0, files: [] },
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
      {
        entity: MEASURED_RELATIVE_FILE,
        checked: 1,
        findings: 0,
        files: [{ file: 'elsewhere.yaml', diagnostics: [] }],
      },
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
      { entity: MEASURED_RELATIVE_FILE, files: [{ file: '', diagnostics: [] }] },
      WORKSPACE_ROOT,
    );
    assert.deepStrictEqual(publication.clear, [`/ws/${MEASURED_RELATIVE_FILE}`]);
  });
});
