// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  SpawnFn,
  VersionCheckResult,
  checkDaemonVersion,
  readDaemonVersion,
} from '../../src/version-check';

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

// The reading is what a surface SHOWING the running version consumes, and it is
// separate from the verdict above. These assertions are about that separation as
// much as about the reading itself.
describe('readDaemonVersion', () => {
  it('reports what a released build printed, verbatim', async () => {
    const reading = await readDaemonVersion({
      binaryPath: 'aggrega',
      spawn: fakeSpawn({ version: '0.6.1-1122-g7a7dd003-dirty', commit: '7a7dd003', goVersion: 'go1.26.0', platform: 'linux/amd64' }),
    });
    assert.strictEqual(reading.kind, 'reported');
    if (reading.kind === 'reported') {
      // Verbatim, with no coercion to a comparable form: a version a reader
      // reads off this surface is one they can quote back, and a build's own
      // qualifiers are part of what identifies it.
      assert.strictEqual(reading.version, '0.6.1-1122-g7a7dd003-dirty');
    }
  });

  // 🔴 THIS IS THE ONE THAT MATTERS, AND IT IS THE CASE A CONTRIBUTOR IS IN.
  // A development build prints a version that is not comparable against any
  // range, so the compatibility verdict has nothing to report about it — and a
  // display served by that verdict would be blank for exactly the people running
  // the compiler from source.
  it('reports a development build rather than discarding it', async () => {
    const reading = await readDaemonVersion({
      binaryPath: 'aggrega',
      spawn: fakeSpawn({ version: '(devel)', commit: '0395a635', goVersion: 'go1.26.0', platform: 'linux/amd64' }),
    });
    assert.strictEqual(reading.kind, 'reported');
    if (reading.kind === 'reported') {
      assert.strictEqual(reading.version, '(devel)');
    }
  });

  // 🔴 THE TWO ANSWERS TO ONE PAYLOAD, ASSERTED TOGETHER. Read apart, each looks
  // correct: the verdict is right to skip a version it cannot compare, and the
  // reading is right to report it. What is only visible with both in one place
  // is that the verdict's answer carries NO VERSION AT ALL — so this pair is
  // what refuses a later "simplification" that wires the display back onto the
  // verdict, which would compile, pass every assertion written against a
  // released build, and show nothing to a contributor.
  it('answers where the compatibility verdict cannot, for one and the same payload', async () => {
    const payload = { version: '(devel)', commit: '0395a635', goVersion: 'go1.26.0', platform: 'linux/amd64' };
    const verdict = await checkDaemonVersion({
      binaryPath: 'aggrega',
      compatibilityRange: '>=0.1.0',
      spawn: fakeSpawn(payload),
    });
    const reading = await readDaemonVersion({ binaryPath: 'aggrega', spawn: fakeSpawn(payload) });
    assert.strictEqual(verdict.kind, 'skipped');
    assert.ok(
      !('version' in verdict),
      'the compatibility verdict now carries a version on the arm a development build reaches, '
      + 'which is the shape that made a display wired to it look correct — read the reading below '
      + 'before deciding the two can be one',
    );
    assert.deepStrictEqual(reading, { kind: 'reported', version: '(devel)' });
  });

  it('is unreadable when the binary cannot be run', async () => {
    const reading = await readDaemonVersion({
      binaryPath: '/no/such/binary',
      spawn: rejectingSpawn('ENOENT: no such file or directory'),
    });
    assert.strictEqual(reading.kind, 'unreadable');
    if (reading.kind === 'unreadable') {
      assert.match(reading.err.message, /ENOENT/);
    }
  });

  it('is unreadable when the answer is not the shape it claims', async () => {
    assert.strictEqual(
      (await readDaemonVersion({ binaryPath: 'aggrega', spawn: async () => 'not json at all' })).kind,
      'unreadable',
    );
    assert.strictEqual(
      (await readDaemonVersion({ binaryPath: 'aggrega', spawn: fakeSpawn({ commit: 'abc' }) })).kind,
      'unreadable',
      'an answer with no version field reads as unreadable rather than as an empty version, so a '
      + 'surface showing it cannot draw a blank where a version belongs',
    );
  });
});
