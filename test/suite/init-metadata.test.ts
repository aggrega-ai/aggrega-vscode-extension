// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { extractServerInitMetadata } from '../../src/init-metadata';

describe('extractServerInitMetadata', () => {
  it('captures workspaceMarker when present', () => {
    const got = extractServerInitMetadata({
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
      workspaceMarker: 'aggregate-glob',
    });
    assert.deepStrictEqual(got, {
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
      workspaceMarker: 'aggregate-glob',
    });
  });

  it('tolerates missing workspaceMarker from older daemons', () => {
    const got = extractServerInitMetadata({
      workspaceRoot: '/abs/workspace',
      configSource: 'defaults',
    });
    assert.deepStrictEqual(got, {
      workspaceRoot: '/abs/workspace',
      configSource: 'defaults',
    });
    assert.strictEqual(got?.workspaceMarker, undefined);
  });

  it('drops empty workspaceMarker (omitempty wire convention)', () => {
    const got = extractServerInitMetadata({
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
      workspaceMarker: '',
    });
    assert.strictEqual(got?.workspaceMarker, undefined);
  });

  it('returns null when workspaceRoot is missing', () => {
    const got = extractServerInitMetadata({ configSource: 'workspace' });
    assert.strictEqual(got, null);
  });

  it('returns null when configSource is missing', () => {
    const got = extractServerInitMetadata({ workspaceRoot: '/abs/workspace' });
    assert.strictEqual(got, null);
  });

  it('returns null on non-object input', () => {
    assert.strictEqual(extractServerInitMetadata(null), null);
    assert.strictEqual(extractServerInitMetadata('not an object'), null);
    assert.strictEqual(extractServerInitMetadata(42), null);
  });
});
