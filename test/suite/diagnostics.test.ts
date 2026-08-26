// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  DIAGNOSTIC_SOURCE_FALLBACK,
  SeverityToken,
  groupDiagnosticsBySource,
  severityTokenFromString,
  shapeForDaemonDiagnostic,
  sourceForDaemonDiagnostic,
} from '../../src/diagnostics-shape';

describe('shapeForDaemonDiagnostic', () => {
  it('maps 1-based daemon line/column to 0-based VS Code position', () => {
    const shape = shapeForDaemonDiagnostic({ line: 5, column: 12, severity: 'error', message: 'boom' });
    assert.strictEqual(shape.startLine, 4);
    assert.strictEqual(shape.startChar, 11);
    assert.strictEqual(shape.endLine, 4);
    assert.strictEqual(shape.endChar, 11);
  });

  it('produces a point-style zero-length range', () => {
    const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity: 'error', message: '' });
    assert.strictEqual(shape.startLine, shape.endLine);
    assert.strictEqual(shape.startChar, shape.endChar);
  });

  it('spans a wide range when end_line/end_column are present', () => {
    const shape = shapeForDaemonDiagnostic({
      line: 8,
      column: 9,
      end_line: 8,
      end_column: 18,
      severity: 'error',
      message: 'selector violation',
    });
    assert.strictEqual(shape.startLine, 7);
    assert.strictEqual(shape.startChar, 8);
    assert.strictEqual(shape.endLine, 7);
    assert.strictEqual(shape.endChar, 17);
    assert.notDeepStrictEqual(
      [shape.startLine, shape.startChar],
      [shape.endLine, shape.endChar],
      'expected a non-empty range',
    );
  });

  it('falls back to point-style when only the start is present', () => {
    const shape = shapeForDaemonDiagnostic({ line: 5, column: 12, severity: 'error', message: 'x' });
    assert.strictEqual(shape.endLine, shape.startLine);
    assert.strictEqual(shape.endChar, shape.startChar);
  });

  it('clamps line and column at 0 for non-positive inputs', () => {
    const shape = shapeForDaemonDiagnostic({ line: 0, column: 0, severity: 'error', message: '' });
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('preserves the message verbatim', () => {
    const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity: 'error', message: 'multi\nline message' });
    assert.strictEqual(shape.message, 'multi\nline message');
  });

  it('carries the layer the daemon named, not a source of its own', () => {
    const shape = shapeForDaemonDiagnostic({
      line: 1,
      column: 1,
      severity: 'error',
      message: '',
      source: 'aggrega-build',
    });
    assert.strictEqual(shape.source, 'aggrega-build');
  });

  it('falls back to the document-validation layer when the wire names none', () => {
    const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity: 'error', message: '' });
    assert.strictEqual(shape.source, DIAGNOSTIC_SOURCE_FALLBACK);
  });
});

describe('sourceForDaemonDiagnostic', () => {
  const base = { line: 1, column: 1, severity: 'error', message: 'x' };

  it('returns the wire value verbatim, whatever it is', () => {
    // Deliberately a layer name this build does not know: the extension groups
    // by the daemon's answer, so a layer named later needs no client change.
    assert.strictEqual(sourceForDaemonDiagnostic({ ...base, source: 'aggrega' }), 'aggrega');
    assert.strictEqual(sourceForDaemonDiagnostic({ ...base, source: 'aggrega-build' }), 'aggrega-build');
    assert.strictEqual(sourceForDaemonDiagnostic({ ...base, source: 'a-layer-added-later' }), 'a-layer-added-later');
  });

  it('applies the fallback for an absent and for an empty source', () => {
    assert.strictEqual(sourceForDaemonDiagnostic(base), DIAGNOSTIC_SOURCE_FALLBACK);
    assert.strictEqual(sourceForDaemonDiagnostic({ ...base, source: '' }), DIAGNOSTIC_SOURCE_FALLBACK);
  });
});

describe('groupDiagnosticsBySource', () => {
  const at = (line: number, source?: string) => ({
    line,
    column: 1,
    severity: 'warning',
    message: `finding ${line}`,
    ...(source === undefined ? {} : { source }),
  });

  it('splits two layers into two groups', () => {
    const grouped = groupDiagnosticsBySource([
      at(1, 'aggrega'),
      at(2, 'aggrega-build'),
      at(3, 'aggrega'),
    ]);
    assert.deepStrictEqual([...grouped.keys()], ['aggrega', 'aggrega-build']);
    assert.deepStrictEqual(grouped.get('aggrega')!.map(d => d.line), [1, 3]);
    assert.deepStrictEqual(grouped.get('aggrega-build')!.map(d => d.line), [2]);
  });

  it('files a source-less diagnostic under the fallback alongside its layer', () => {
    const grouped = groupDiagnosticsBySource([at(1), at(2, 'aggrega-build')]);
    assert.deepStrictEqual(
      [...grouped.keys()],
      [DIAGNOSTIC_SOURCE_FALLBACK, 'aggrega-build'],
    );
    assert.deepStrictEqual(
      grouped.get(DIAGNOSTIC_SOURCE_FALLBACK)!.map(d => d.line),
      [1],
    );
  });

  it('groups in first-appearance order and keeps each group in wire order', () => {
    const grouped = groupDiagnosticsBySource([
      at(10, 'aggrega-build'),
      at(11, 'aggrega'),
      at(12, 'aggrega-build'),
    ]);
    assert.deepStrictEqual([...grouped.keys()], ['aggrega-build', 'aggrega']);
    assert.deepStrictEqual(grouped.get('aggrega-build')!.map(d => d.line), [10, 12]);
  });

  it('produces no groups for an empty list, so every layer is clearable', () => {
    // A publish carrying nothing must mention no layer: the caller clears the
    // URI in every layer it knows, which is what makes a finding that stopped
    // firing disappear instead of lingering.
    assert.strictEqual(groupDiagnosticsBySource([]).size, 0);
  });

  it('is a partition — every input lands in exactly one group', () => {
    const input = [at(1), at(2, 'aggrega'), at(3, 'aggrega-build'), at(4, ''), at(5, 'other')];
    const grouped = groupDiagnosticsBySource(input);
    const total = [...grouped.values()].reduce((n, g) => n + g.length, 0);
    assert.strictEqual(total, input.length);
    const lines = [...grouped.values()].flat().map(d => d.line).sort((a, b) => a - b);
    assert.deepStrictEqual(lines, [1, 2, 3, 4, 5]);
  });
});

describe('severityTokenFromString', () => {
  it('maps "error" to error', () => {
    assert.strictEqual(severityTokenFromString('error'), 'error');
  });

  it('maps "warning" to warning', () => {
    assert.strictEqual(severityTokenFromString('warning'), 'warning');
  });

  it('maps "info" and "information" to information', () => {
    assert.strictEqual(severityTokenFromString('info'), 'information');
    assert.strictEqual(severityTokenFromString('information'), 'information');
  });

  it('defaults unknown severities to error', () => {
    assert.strictEqual(severityTokenFromString('gibberish'), 'error');
    assert.strictEqual(severityTokenFromString(''), 'error');
  });
});

// Accessibility regression guard. State is conveyed by a semantic severity
// token (which VS Code renders as an icon plus a text label in the Problems
// panel, independent of color) and by the message text — never by color alone.
// These assertions fail if a future change drops the severity classification or
// routes an unmapped severity to no token, which would leave a diagnostic
// distinguishable only by color.
describe('diagnostic accessibility invariants', () => {
  const validTokens: SeverityToken[] = ['error', 'warning', 'information'];

  it('every converted diagnostic carries a non-empty semantic severity token', () => {
    const inputs = ['error', 'warning', 'info', 'information', 'gibberish', ''];
    for (const severity of inputs) {
      const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity, message: 'x' });
      assert.ok(
        validTokens.includes(shape.severity),
        `severity ${JSON.stringify(severity)} produced non-semantic token ${JSON.stringify(shape.severity)}`,
      );
    }
  });

  it('carries the message text so state is never color-alone', () => {
    const shape = shapeForDaemonDiagnostic({
      line: 3,
      column: 4,
      severity: 'warning',
      message: 'deprecated component',
    });
    assert.strictEqual(shape.severity, 'warning');
    assert.strictEqual(shape.message, 'deprecated component');
  });
});
