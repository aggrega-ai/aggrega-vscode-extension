// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { RespawnTracker } from '../../src/daemon';

describe('RespawnTracker', () => {
  it('permits respawn while attempts stay below the limit', () => {
    const t = new RespawnTracker(3, 60_000);
    assert.strictEqual(t.shouldRespawn(0), true);
    t.recordAttempt(1);
    assert.strictEqual(t.shouldRespawn(2), true);
    t.recordAttempt(3);
    assert.strictEqual(t.shouldRespawn(4), true);
  });

  it('blocks respawn once the limit is reached inside the window', () => {
    const t = new RespawnTracker(2, 60_000);
    t.recordAttempt(1);
    t.recordAttempt(2);
    assert.strictEqual(t.shouldRespawn(3), false);
    assert.strictEqual(t.attemptCount(3), 2);
  });

  it('prunes attempts outside the sliding window', () => {
    const t = new RespawnTracker(2, 1_000);
    t.recordAttempt(0);
    t.recordAttempt(500);
    assert.strictEqual(t.shouldRespawn(600), false);
    // Both attempts now lie outside the 1s window relative to 2000.
    assert.strictEqual(t.attemptCount(2000), 0);
    assert.strictEqual(t.shouldRespawn(2000), true);
  });

  it('reset clears the counter unconditionally', () => {
    const t = new RespawnTracker(1, 60_000);
    t.recordAttempt(1);
    assert.strictEqual(t.shouldRespawn(2), false);
    t.reset();
    assert.strictEqual(t.shouldRespawn(3), true);
    assert.strictEqual(t.attemptCount(3), 0);
  });
});
