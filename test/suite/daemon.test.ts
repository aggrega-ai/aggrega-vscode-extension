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

describe('Daemon notification routing', () => {
  // Imports the JSON-RPC notification dispatch path: messages
  // without an id field route to listeners registered via
  // daemon.on('notification:<method>', cb). Pins the wire-shape
  // detection so the at-startup aggrega/publishDiagnostics flow
  // reaches its subscriber correctly.
  it('routes a method-keyed event for a no-id message', async () => {
    const { Daemon } = await import('../../src/daemon');
    const { settingsFromObject } = await import('../../src/settings');
    const daemon = new Daemon(settingsFromObject({}));

    const received: Array<unknown> = [];
    daemon.on('notification:aggrega/publishDiagnostics', (params: unknown) => {
      received.push(params);
    });

    // Feed a Content-Length-framed notification through the
    // private handleStdoutChunk entry. The test inspects the
    // EventEmitter's listener side effect.
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'aggrega/publishDiagnostics',
      params: { file: '/workspace/release.lock', diagnostics: [] },
    });
    const message = Buffer.from(
      `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      'utf8',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (daemon as any).handleStdoutChunk(message);

    assert.strictEqual(received.length, 1, 'expected one notification dispatch');
    assert.deepStrictEqual(received[0], {
      file: '/workspace/release.lock',
      diagnostics: [],
    });
  });

  it('still dispatches responses (id present) via the existing pending-id path', async () => {
    const { Daemon } = await import('../../src/daemon');
    const { settingsFromObject } = await import('../../src/settings');
    const daemon = new Daemon(settingsFromObject({}));

    let notifFired = false;
    daemon.on('notification:aggrega/publishDiagnostics', () => {
      notifFired = true;
    });

    // Feed a response (id present). The id won't match any
    // pending request — the log fires but the notification
    // listener should NOT trigger.
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 999,
      method: 'aggrega/publishDiagnostics',
      result: {},
    });
    const message = Buffer.from(
      `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      'utf8',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (daemon as any).handleStdoutChunk(message);

    assert.strictEqual(notifFired, false, 'a response (id present) must NOT route as a notification');
  });
});

describe('Daemon spawn-error handling', function () {
  // terminateSubprocess walks its SIGTERM grace window when the proc handle
  // exists but the OS process never started, so allow well over that budget.
  this.timeout(15_000);

  it('surfaces a missing-binary spawn failure as a caught rejection, not an uncaught crash', async () => {
    const { Daemon, DaemonState } = await import('../../src/daemon');
    const { settingsFromObject } = await import('../../src/settings');

    // A binaryPath that cannot resolve to an executable. spawn() does not
    // throw synchronously for this — the child emits an async 'error' (ENOENT).
    // Without the daemon's 'error' listener that event would re-throw as an
    // uncaught exception and crash the runner; with it, start() must reject
    // and the daemon must settle back to Stopped. This test completing at all
    // (no process crash) is itself the assertion that the event is handled.
    const daemon = new Daemon(
      settingsFromObject({
        binaryPath: '/nonexistent/aggrega-binary-that-does-not-exist',
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );

    await assert.rejects(() => daemon.start('/tmp'));
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
  });
});
