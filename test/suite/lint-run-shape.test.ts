// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  LINT_DIAGNOSTIC_SOURCE,
  LintDocument,
  countUnlocatable,
  findingsByFile,
  shapeForLintFinding,
  summaryLine,
} from '../../src/lint-run';
import { SeverityToken } from '../../src/diagnostics-shape';

// MEASURED_DOCUMENT is the linter's structured output, captured verbatim from a
// real run over a catalog copy with a planted category mismatch. It is the
// contract this mapping is written against: an absolute location.file, no
// line/column, and the "warn" severity spelling.
const MEASURED_DOCUMENT: LintDocument = {
  findings: [
    {
      severity: 'warn',
      message:
        'Component at "/catalog/component/core/ai-tool/search/1.0.0/component.yaml" declares component.aggrega.ai/category="datastore" but its path derives category="ai-tool"; standard-catalog convention requires the label to match the first directory segment under core/',
      ruleId: 'category-matches-directory',
      location: { file: '/catalog/component/core/ai-tool/search/1.0.0/component.yaml' },
    },
  ],
  summary: { entitiesChecked: 127, findings: 1, errors: 0, warnings: 1, infos: 0 },
};

describe('shapeForLintFinding', () => {
  // The two spellings the compiler uses for the middle tier: the language
  // server writes "warning", the linter writes "warn". The unknown-severity
  // fallback is 'error', so a spelling this mapping does not accept renders
  // every advisory conventions finding as an Error squiggle.
  it('maps the linter\'s "warn" spelling to the warning tier', () => {
    const shape = shapeForLintFinding(MEASURED_DOCUMENT.findings![0]);
    assert.strictEqual(shape.severity, 'warning');
  });

  it('carries the rule id and names the linter as the source', () => {
    const shape = shapeForLintFinding(MEASURED_DOCUMENT.findings![0]);
    assert.strictEqual(shape.ruleId, 'category-matches-directory');
    assert.strictEqual(shape.source, LINT_DIAGNOSTIC_SOURCE);
  });

  // The language server's diagnostics carry source 'aggrega'. A shared source
  // would merge the two in the Problems panel, so they must differ.
  it('uses a source distinct from the language server\'s', () => {
    assert.notStrictEqual(LINT_DIAGNOSTIC_SOURCE, 'aggrega');
  });

  it('carries the linter message through unchanged', () => {
    const finding = MEASURED_DOCUMENT.findings![0];
    const shape = shapeForLintFinding(finding);
    assert.strictEqual(shape.message, finding.message);
  });

  // The measured common case: both rules provoked located their finding to a
  // file and no further. Nothing may fabricate a position from that.
  it('fabricates no position when the linter located only the file', () => {
    const shape = shapeForLintFinding(MEASURED_DOCUMENT.findings![0]);
    assert.strictEqual(shape.located, false, 'a file-only finding must not claim a located position');
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
    assert.strictEqual(shape.endLine, 0);
    assert.strictEqual(shape.endChar, 0);
  });

  it('converts a supplied 1-based line and column to a 0-based position', () => {
    const shape = shapeForLintFinding({
      severity: 'warn',
      message: 'x',
      ruleId: 'name-shape',
      location: { file: '/c/component.yaml', line: 7, column: 3 },
    });
    assert.strictEqual(shape.located, true);
    assert.strictEqual(shape.startLine, 6);
    assert.strictEqual(shape.startChar, 2);
    assert.strictEqual(shape.endLine, 6);
    assert.strictEqual(shape.endChar, 2);
  });

  it('starts at column 0 when a line arrives without a column', () => {
    const shape = shapeForLintFinding({
      severity: 'warn',
      message: 'x',
      ruleId: 'name-shape',
      location: { file: '/c/component.yaml', line: 4 },
    });
    assert.strictEqual(shape.located, true);
    assert.strictEqual(shape.startLine, 3);
    assert.strictEqual(shape.startChar, 0);
  });

  it('clamps a non-positive line to the document start and reports it unlocated', () => {
    const shape = shapeForLintFinding({
      severity: 'warn',
      message: 'x',
      ruleId: 'name-shape',
      location: { file: '/c/component.yaml', line: 0, column: 0 },
    });
    assert.strictEqual(shape.located, false);
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  // The accessibility convention the language-server path already guards:
  // state is conveyed by a semantic severity token and by the message text,
  // never by color alone. It binds this surface identically.
  it('gives every severity spelling a semantic token, so state is never color-alone', () => {
    const validTokens: SeverityToken[] = ['error', 'warning', 'information'];
    for (const severity of ['error', 'warn', 'warning', 'info', 'information', 'gibberish', '']) {
      const shape = shapeForLintFinding({
        severity,
        message: 'a finding',
        ruleId: 'r',
        location: { file: '/c/component.yaml' },
      });
      assert.ok(
        validTokens.includes(shape.severity),
        `severity ${JSON.stringify(severity)} produced non-semantic token ${JSON.stringify(shape.severity)}`,
      );
      assert.strictEqual(shape.message, 'a finding');
    }
  });

  // The summary carries errors/warnings/infos counters, so the enum reaches
  // beyond the only spelling a non-halting run emits. Both other tiers must
  // land on their own token rather than the unknown fallback.
  it('maps the error and info tiers the summary counters imply', () => {
    const at = (severity: string): SeverityToken =>
      shapeForLintFinding({ severity, message: '', ruleId: 'r', location: { file: '/c.yaml' } }).severity;
    assert.strictEqual(at('error'), 'error');
    assert.strictEqual(at('info'), 'information');
  });
});

describe('findingsByFile', () => {
  // location.file is absolute. Reusing the IR graph's workspace-relative
  // handling here would produce a wrong URI, so the key must be the path
  // exactly as the linter reported it.
  it('keys findings by the absolute path the linter reported, unchanged', () => {
    const byFile = findingsByFile(MEASURED_DOCUMENT);
    assert.deepStrictEqual(
      [...byFile.keys()],
      ['/catalog/component/core/ai-tool/search/1.0.0/component.yaml'],
    );
  });

  it('groups several findings on one file, preserving the linter order', () => {
    const doc: LintDocument = {
      findings: [
        { severity: 'warn', message: 'first', ruleId: 'a', location: { file: '/x.yaml' } },
        { severity: 'warn', message: 'other', ruleId: 'b', location: { file: '/y.yaml' } },
        { severity: 'warn', message: 'second', ruleId: 'c', location: { file: '/x.yaml' } },
      ],
    };
    const byFile = findingsByFile(doc);
    assert.deepStrictEqual([...byFile.keys()], ['/x.yaml', '/y.yaml']);
    assert.deepStrictEqual(byFile.get('/x.yaml')!.map((s) => s.message), ['first', 'second']);
  });

  it('publishes nothing for a document with no findings', () => {
    assert.strictEqual(findingsByFile({ findings: [], summary: { entitiesChecked: 127 } }).size, 0);
  });

  it('tolerates a document missing the findings key', () => {
    assert.strictEqual(findingsByFile({}).size, 0);
    assert.strictEqual(countUnlocatable({}), 0);
  });

  it('drops a finding that names no file and counts it instead', () => {
    const doc: LintDocument = {
      findings: [
        { severity: 'warn', message: 'nowhere', ruleId: 'a', location: { file: '' } },
        { severity: 'warn', message: 'somewhere', ruleId: 'b', location: { file: '/x.yaml' } },
      ],
    };
    assert.deepStrictEqual([...findingsByFile(doc).keys()], ['/x.yaml']);
    assert.strictEqual(countUnlocatable(doc), 1);
  });
});

describe('summaryLine', () => {
  it('reports the finding count and the linter\'s entity count', () => {
    assert.strictEqual(
      summaryLine(MEASURED_DOCUMENT),
      'Aggrega lint: 1 finding(s) across 127 entities checked — see the Problems panel.',
    );
  });

  it('states a clean run rather than staying silent', () => {
    assert.strictEqual(
      summaryLine({ findings: [], summary: { entitiesChecked: 127 } }),
      'Aggrega lint: no findings across 127 entities checked.',
    );
  });

  // A count the linter never sent is never shown.
  it('omits the entity clause when the linter reported no count', () => {
    assert.strictEqual(summaryLine({ findings: [] }), 'Aggrega lint: no findings.');
  });
});
