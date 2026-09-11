// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Daemon, DaemonState } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';
import { CHECKED_DOCUMENT, ValidateResponse } from '../../src/types';
import { buildValidateParams } from '../../src/validate-request';
import {
  brokenManifestWorkspaceRoot,
  fixtureWorkspaceRoot,
  requireAggregaBinary,
} from '../helpers/build-aggrega';

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
    binaryPath = requireAggregaBinary(this, 'daemon integration suite');
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

  it('build is reachable through the client and refuses a workspace with no lockfile', async function () {
    // The reach half of the Build operation, asserted the same way the preview
    // beside it is: the fixture holds no Release, so the answer is the refusal a
    // workspace with no lockfile earns, and what it proves is that the request
    // left this client, was routed by the server, and came back as that server's
    // own envelope.
    //
    // The discriminating half is the method-not-found check. That code is also
    // an error, so asserting only that the call rejects would pass just as well
    // with the method absent — which is exactly the state this operation was in
    // while it ran as a subprocess.
    //
    // It also pins the refusal being reached BEFORE anything is written: a
    // workspace with no lockfile is refused by the same gate sequence the
    // command line runs, so the editor's Build cannot produce an output tree
    // from a Release the command line would not build.
    const daemon = buildDaemon();
    try {
      await daemon.start(workspaceRoot);
      let rejected: unknown;
      try {
        await daemon.request('aggrega/build', { release: 'release.yaml' });
        assert.fail('the build answered a workspace with no Release instead of refusing');
      } catch (err) {
        rejected = err;
      }
      const envelope = rejected as { code?: number; message?: string };
      assert.notStrictEqual(
        envelope.code, -32601,
        'the server does not route aggrega/build; the editor has no build to offer',
      );
      assert.strictEqual(
        envelope.code, 1003,
        `expected the lockfile-absent code, got ${envelope.code}: ${envelope.message}`,
      );
      assert.ok(
        (envelope.message ?? '').includes('aggrega pull'),
        `the refusal does not name the command that generates a lockfile: ${envelope.message}`,
      );
      assert.ok(
        !fs.existsSync(path.join(workspaceRoot, 'dist')),
        'the refused build created an output directory; the write sits downstream of every gate',
      );
    } finally {
      await daemon.stop();
    }
  });

  // The semantic half of validation only runs when the request names a Release,
  // and the two answers are told apart by the checked key rather than by the
  // diagnostic list: a clean document validated without a Release comes back
  // with an empty list, which is identical on the wire to a clean full verdict.
  //
  // Both halves below are driven through the extension's OWN request builder,
  // so what is proved is that this client sends a request that draws the full
  // answer — not merely that the server is capable of producing one.
  it('sends the selected Release on validate, and the answer is the full one', async function () {
    const workspace = brokenManifestWorkspaceRoot();
    const file = path.join(workspace, 'aggregate.yaml');
    const content = fs.readFileSync(file, 'utf8');
    const daemon = buildDaemon();
    try {
      await daemon.start(workspace);

      // With a Release selected, the client's builder carries it.
      const withSelection = buildValidateParams(file, content, 'release.yaml');
      assert.strictEqual(
        withSelection.release, 'release.yaml',
        'the client did not put the selection on the request',
      );
      const full = await daemon.request<ValidateResponse>('aggrega/validate', withSelection);

      // The discriminating assertion. An empty diagnostic list looks identical
      // either way, so the ABSENCE of checked is what proves a Release was
      // actually validated against.
      assert.strictEqual(
        full.checked, undefined,
        `checked is present as ${JSON.stringify(full.checked)}; the answer covers the document alone, `
        + 'so the selected Release did not reach the server',
      );
      // The fault this workspace exists to provoke is reachable only with a
      // Release resolved: the Release names a Manifest that is not there.
      const messages = (full.diagnostics ?? []).map(d => d.message).join('\n');
      assert.ok(
        messages.includes('absent-manifest.yaml'),
        `the Release-scoped finding is missing from the full answer: ${messages || '(no diagnostics)'}`,
      );

      // With nothing selected the field is omitted, and the answer says so.
      const documentOnly = buildValidateParams(file, content, null);
      assert.ok(
        !('release' in documentOnly),
        'an empty Release must be omitted rather than sent, it names no coordinate',
      );
      const narrow = await daemon.request<ValidateResponse>('aggrega/validate', documentOnly);
      assert.strictEqual(
        narrow.checked, CHECKED_DOCUMENT,
        'the document-only answer must say what it covered',
      );
      assert.ok(
        !(narrow.diagnostics ?? []).some(d => d.message.includes('absent-manifest.yaml')),
        'the document-only answer reported a Release-scoped finding; the two answers are not distinct',
      );
    } finally {
      await daemon.stop();
    }
  });

  // A selection is a coordinate inside the workspace. The server refuses an
  // absolute one, so a client that passed the Release enumeration's own output
  // through unconverted would be refused on every request.
  it('refuses an absolute Release, which is why the selection is held workspace-relative', async function () {
    const workspace = brokenManifestWorkspaceRoot();
    const file = path.join(workspace, 'aggregate.yaml');
    const daemon = buildDaemon();
    try {
      await daemon.start(workspace);
      const absolute = path.join(workspace, 'release.yaml');
      await assert.rejects(
        () => daemon.request<ValidateResponse>(
          'aggrega/validate',
          buildValidateParams(file, fs.readFileSync(file, 'utf8'), absolute),
        ),
        (err: { code?: number; message?: string }) => {
          assert.strictEqual(err.code, -32602, `expected an invalid-params refusal, got ${err.code}`);
          assert.ok(
            (err.message ?? '').includes('relative to the workspace root'),
            `the refusal does not state the contract: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await daemon.stop();
    }
  });

  // The condition the editor used to carry a dedicated remediation toast for.
  // Nothing emits it now, and the account it used to pin travels on the ordinary
  // active-Release answer instead.
  it('answers an unresolved workspace rather than refusing it, and says why', async function () {
    const daemon = buildDaemon();
    try {
      await daemon.start(fixtureWorkspaceRoot());
      const answer = await daemon.request<{ release: string; reason?: string; trace?: string }>(
        'aggrega/activeRelease', {},
      );
      assert.strictEqual(answer.release, '', 'the empty fixture should offer no Release');
      assert.ok(
        (answer.reason ?? '').length > 0,
        'an unresolved workspace must carry the account of why on its answer',
      );
      assert.ok(
        (answer.trace ?? '').length > 0,
        'the per-step account must travel with it, for the log',
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
