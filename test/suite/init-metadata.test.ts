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

  it('captures the version the running server reports about itself', () => {
    const got = extractServerInitMetadata({
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
      workspaceMarker: 'config',
      version: '0.7.4-11-g20ddd35e',
    });
    assert.deepStrictEqual(got, {
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
      workspaceMarker: 'config',
      version: '0.7.4-11-g20ddd35e',
    });
  });

  it('leaves the version undefined where the answer carries none', () => {
    const got = extractServerInitMetadata({
      workspaceRoot: '/abs/workspace',
      configSource: 'workspace',
    });
    assert.ok(got !== null, 'an answer without a version was read as no answer at all');
    assert.strictEqual(got.version, undefined);
  });

  it('drops an empty or non-string version, which names no build', () => {
    for (const version of ['', 7, null, { build: '0.7.4' }]) {
      const got = extractServerInitMetadata({
        workspaceRoot: '/abs/workspace',
        configSource: 'workspace',
        version,
      });
      assert.ok(got !== null, `an answer whose version is ${JSON.stringify(version)} was read as no answer at all`);
      assert.strictEqual(got.version, undefined, `the version ${JSON.stringify(version)} was kept as a build`);
    }
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
