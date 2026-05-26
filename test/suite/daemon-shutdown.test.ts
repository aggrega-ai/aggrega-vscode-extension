// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { Daemon, DaemonState } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';
import { ensureAggregaBinary, fixtureWorkspaceRoot } from '../helpers/build-aggrega';

// Cooperative-shutdown integration tests for the new stop() phase
// ordering. Two scenarios:
//
//   1. Cooperative path against real aggrega serve — daemon honors
//      aggrega/shutdown and exits within its own drain budget.
//   2. Falls-through path against a Node stub that ignores the
//      notification — the cooperative wait expires and the existing
//      SIGTERM → SIGKILL escalation runs.

describe('Daemon cooperative shutdown', function () {
  this.timeout(120_000);

  let binaryPath: string;
  let workspaceRoot: string;

  before(function () {
    try {
      binaryPath = ensureAggregaBinary();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping daemon shutdown suite: ${(err as Error).message}`);
      this.skip();
    }
    workspaceRoot = fixtureWorkspaceRoot();
  });

  it('cooperative path: real daemon honors aggrega/shutdown and exits cleanly', async function () {
    const daemon = new Daemon(
      settingsFromObject({
        binaryPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );
    await daemon.start(workspaceRoot);
    assert.strictEqual(daemon.getState(), DaemonState.Running);
    const start = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - start;
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    // Cooperative path should complete well under the 5s worst-case
    // window (3s cooperative grace + 2s SIGTERM). Real daemon
    // typically exits within ~100-500ms of receiving the notification.
    // Generous bound: < 3 seconds → cooperative path won, SIGTERM
    // didn't fire.
    assert.ok(elapsed < 3000, `cooperative stop took ${elapsed}ms; expected < 3000ms`);
  });

  it('falls-through path: non-cooperative subprocess escalates to SIGTERM', async function () {
    // Cross-platform stub: a Node child that reads stdin (consuming
    // the cooperative shutdown notification) but never writes a
    // response and never exits. The cooperative wait must expire
    // (3s) and SIGTERM then fires.
    const stubArgs = [
      '-e',
      "process.stdin.on('data', () => {}); setInterval(() => {}, 60000);",
    ];
    const { spawn } = await import('child_process');
    const stub = spawn(process.execPath, stubArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    // Construct the daemon via the test-only __forTesting factory:
    // the factory installs the stub as the subprocess, transitions
    // state to Running through the normal setState path (firing
    // stateChange listeners), and wires stdout/stderr/exit handlers
    // identically to the production spawn path. Avoids the
    // private-field injection that the prior iteration used.
    const daemon = Daemon.__forTesting(
      settingsFromObject({
        binaryPath: process.execPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
      stub,
    );

    try {
      assert.strictEqual(daemon.getState(), DaemonState.Running);

      const start = Date.now();
      await daemon.stop();
      const elapsed = Date.now() - start;

      // The cooperative wait (3s) must expire before SIGTERM fires.
      // Total elapsed: 3s cooperative + sub-second SIGTERM grace
      // (the stub responds to SIGTERM by exiting immediately on
      // POSIX). Bound: 2.8s ≤ elapsed ≤ 6s.
      assert.ok(
        elapsed >= 2800,
        `falls-through path exited too quickly (${elapsed}ms); cooperative wait should have expired`,
      );
      assert.ok(
        elapsed < 6000,
        `falls-through path exceeded grace window (${elapsed}ms); SIGTERM/SIGKILL escalation should have fired`,
      );
    } finally {
      if (stub.exitCode === null && stub.signalCode === null) {
        stub.kill('SIGKILL');
      }
    }
  });
});
