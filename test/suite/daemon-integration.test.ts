// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { Daemon, DaemonState } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';
import { ensureAggregaBinary, fixtureWorkspaceRoot } from '../helpers/build-aggrega';

// Integration tests that exercise the Daemon class against a real
// aggrega serve subprocess. The binary is built on demand from the
// aggrega-cli submodule and cached under out/test-fixtures/.

describe('Daemon integration (real aggrega serve)', function () {
  // Build the binary once; if `go build` is slow on a cold cache,
  // the higher timeout absorbs it.
  this.timeout(120_000);

  let binaryPath: string;
  let workspaceRoot: string;

  before(function () {
    try {
      binaryPath = ensureAggregaBinary();
    } catch (err) {
      // Skip the whole suite when the aggrega-cli source tree or the
      // go toolchain is unavailable in this environment. CI without
      // the submodule checked out should not fail on these tests.
      // eslint-disable-next-line no-console
      console.warn(`Skipping daemon integration suite: ${(err as Error).message}`);
      this.skip();
    }
    workspaceRoot = fixtureWorkspaceRoot();
  });

  function buildDaemon(): Daemon {
    return new Daemon(
      settingsFromObject({
        binaryPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );
  }

  it('start spawns the subprocess and negotiates UTF-8 via initialize', async function () {
    const daemon = buildDaemon();
    try {
      await daemon.start(workspaceRoot);
      assert.strictEqual(daemon.getState(), DaemonState.Running);
      assert.strictEqual(daemon.getServerEncoding(), 'utf-8');
    } finally {
      await daemon.stop();
    }
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
  });

  it('stop transitions the daemon cleanly to Stopped', async function () {
    const daemon = buildDaemon();
    await daemon.start(workspaceRoot);
    await daemon.stop();
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    // A second stop is a no-op.
    await daemon.stop();
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
  });

  it('restart yields a working subprocess after the cycle', async function () {
    const daemon = buildDaemon();
    try {
      await daemon.start(workspaceRoot);
      await daemon.restart();
      assert.strictEqual(daemon.getState(), DaemonState.Running);
      assert.strictEqual(daemon.getServerEncoding(), 'utf-8');
    } finally {
      await daemon.stop();
    }
  });

  it('rejects requests after stop', async function () {
    const daemon = buildDaemon();
    await daemon.start(workspaceRoot);
    await daemon.stop();
    await assert.rejects(
      () => daemon.request('aggrega/validate', { file: '/nonexistent.yaml', content: '' }),
      /daemon is Stopped/,
    );
  });

  it('buildPreview is reachable through the client and refuses a workspace with no lockfile', async function () {
    // The assertion is about reach, not about rendering: the fixture holds no
    // Release, so the answer is the refusal a workspace with no lockfile earns,
    // and what it proves is that the request left this client, was routed by the
    // server, and came back as that server's own envelope.
    //
    // The discriminating half is the second check. A method the server does not
    // route answers with the method-not-found code, which is also an error — so
    // asserting only that the call rejects would pass just as well with the
    // method absent, which is the shape this test exists to catch.
    const daemon = buildDaemon();
    try {
      await daemon.start(workspaceRoot);
      let rejected: unknown;
      try {
        await daemon.request('aggrega/buildPreview', { release: 'release.yaml' });
        assert.fail('the preview answered a workspace with no Release instead of refusing');
      } catch (err) {
        rejected = err;
      }
      const envelope = rejected as { code?: number; message?: string };
      assert.notStrictEqual(
        envelope.code, -32601,
        'the server does not route aggrega/buildPreview; the editor has no preview to offer',
      );
      assert.strictEqual(
        envelope.code, 1003,
        `expected the lockfile-absent code, got ${envelope.code}: ${envelope.message}`,
      );
      assert.ok(
        (envelope.message ?? '').includes('aggrega pull'),
        `the refusal does not name the command that generates a lockfile: ${envelope.message}`,
      );
    } finally {
      await daemon.stop();
    }
  });

  it('initialize selects UTF-16 when the client offers only UTF-16', async function () {
    // Verify the wire-level negotiation by sending the request
    // directly with a UTF-16-only capability set, bypassing
    // Daemon's hardcoded ['utf-8', 'utf-16'] handshake.
    const { spawn } = await import('child_process');
    const proc = spawn(binaryPath, ['serve'], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const req = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'aggrega/initialize',
        params: { capabilities: { general: { positionEncodings: ['utf-16'] } } },
      });
      const payload = Buffer.from(req, 'utf8');
      const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'ascii');
      proc.stdin.write(Buffer.concat([header, payload]));

      const response = await readSingleResponse(proc);
      assert.strictEqual(response.result?.capabilities?.positionEncoding, 'utf-16');
    } finally {
      proc.kill('SIGTERM');
    }
  });
});

interface ParsedResponse {
  result?: { capabilities?: { positionEncoding?: string } };
  error?: { code: number; message: string };
}

function readSingleResponse(proc: NodeJS.EventEmitter & { stdout: NodeJS.ReadableStream }): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) { return; }
      const header = buf.subarray(0, headerEnd).toString('ascii');
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) {
        cleanup();
        reject(new Error(`malformed header: ${header}`));
        return;
      }
      const length = parseInt(m[1], 10);
      const bodyStart = headerEnd + 4;
      if (buf.byteLength < bodyStart + length) { return; }
      const body = buf.subarray(bodyStart, bodyStart + length).toString('utf8');
      cleanup();
      try {
        resolve(JSON.parse(body) as ParsedResponse);
      } catch (err) {
        reject(err as Error);
      }
    };
    const cleanup = () => {
      proc.stdout.removeListener('data', onData);
    };
    proc.stdout.on('data', onData);
    setTimeout(() => {
      cleanup();
      reject(new Error('initialize response timeout'));
    }, 10_000);
  });
}
