// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { checkDaemonVersion, SpawnFn, VersionCheckResult } from '../../src/version-check';

function fakeSpawn(payload: object): SpawnFn {
  return async () => JSON.stringify(payload);
}

function rejectingSpawn(message: string): SpawnFn {
  return async () => {
    throw new Error(message);
  };
}

describe('checkDaemonVersion', () => {
  it('parses the daemon JSON shape end-to-end and reports match', async () => {
    const result: VersionCheckResult = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=1.0.0 <2.0.0',
      spawn: fakeSpawn({ version: 'v1.5.0', commit: 'abc12345', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'match');
    if (result.kind === 'match') {
      assert.strictEqual(result.version, 'v1.5.0');
    }
  });

  it('accepts a v-less version string', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=0.1.0',
      spawn: fakeSpawn({ version: '0.1.2', commit: 'abc12345', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'match');
    if (result.kind === 'match') {
      assert.strictEqual(result.version, '0.1.2');
    }
  });

  it('accepts a dev build-metadata form, comparing its base version', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=0.1.0',
      spawn: fakeSpawn({ version: '0.1.2-dev+abc123f', commit: 'abc123f', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'match');
    if (result.kind === 'match') {
      assert.strictEqual(result.version, '0.1.2-dev+abc123f');
    }
  });

  it('skips check when version is (devel)', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=1.0.0',
      spawn: fakeSpawn({ version: '(devel)', commit: '', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'skipped');
    if (result.kind === 'skipped') {
      assert.match(result.reason, /unreleased/);
    }
  });

  it('skips check when version is (unknown)', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=1.0.0',
      spawn: fakeSpawn({ version: '(unknown)', commit: '', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'skipped');
    if (result.kind === 'skipped') {
      assert.match(result.reason, /unreleased/);
    }
  });

  it('skips check when compatibilityRange is absent', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: undefined,
      spawn: fakeSpawn({ version: '1.0.0', commit: '', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'skipped');
    if (result.kind === 'skipped') {
      assert.match(result.reason, /aggregaCompatibility/);
    }
  });

  it('returns mismatch when version is below the declared range', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=1.0.0',
      spawn: fakeSpawn({ version: '0.0.1', commit: '', goVersion: 'go1.26', platform: 'linux/amd64' }),
    });
    assert.strictEqual(result.kind, 'mismatch');
    if (result.kind === 'mismatch') {
      assert.strictEqual(result.version, '0.0.1');
      assert.strictEqual(result.range, '>=1.0.0');
    }
  });

  it('returns error on spawn failure', async () => {
    const result = await checkDaemonVersion({
      binaryPath: '/no/such/binary',
      compatibilityRange: '>=1.0.0',
      spawn: rejectingSpawn('ENOENT: no such file or directory'),
    });
    assert.strictEqual(result.kind, 'error');
    if (result.kind === 'error') {
      assert.match(result.err.message, /ENOENT/);
    }
  });

  it('returns error on malformed JSON', async () => {
    const result = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=1.0.0',
      spawn: async () => 'not json at all',
    });
    assert.strictEqual(result.kind, 'error');
  });
});
