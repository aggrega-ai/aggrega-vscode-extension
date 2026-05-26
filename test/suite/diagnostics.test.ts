// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { shapeForDaemonDiagnostic, severityTokenFromString } from '../../src/diagnostics-shape';

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

  it('clamps line and column at 0 for non-positive inputs', () => {
    const shape = shapeForDaemonDiagnostic({ line: 0, column: 0, severity: 'error', message: '' });
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('preserves the message verbatim', () => {
    const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity: 'error', message: 'multi\nline message' });
    assert.strictEqual(shape.message, 'multi\nline message');
  });

  it('sets source to aggrega', () => {
    const shape = shapeForDaemonDiagnostic({ line: 1, column: 1, severity: 'error', message: '' });
    assert.strictEqual(shape.source, 'aggrega');
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
