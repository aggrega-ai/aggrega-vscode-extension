// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

import { CancellationSignal, OperationCancelled, isCancellation } from '../../src/cancellation';
import { Daemon, frameMessage } from '../../src/daemon';
import { CliChild, runCliProcess } from '../../src/cli-run';
import { DEFAULT_SETTINGS } from '../../src/settings';

// These assertions exist because the cheap wrong implementation passes every
// other test in this suite: an operation that stops waiting for its answer
// looks stopped from the editor and leaves the compiler working. What is
// asserted here is therefore not that the promise settled — it is what reached
// the compiler, and whether the process is still alive afterwards.

// controllableSignal is a cancellation source a test drives. It is the same
// shape the editor's own token has, which is what the production callers pass.
function controllableSignal(): { signal: CancellationSignal; cancel: () => void } {
  const listeners: Array<(e: unknown) => unknown> = [];
  let cancelled = false;
  const signal: CancellationSignal = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(listener) {
      listeners.push(listener);
      return {
        dispose() {
          const at = listeners.indexOf(listener);
          if (at >= 0) { listeners.splice(at, 1); }
        },
      };
    },
  };
  return {
    signal,
    cancel: () => {
      cancelled = true;
      for (const listener of [...listeners]) { listener(undefined); }
    },
  };
}

// --- the language-server transport ---------------------------------------

// stubProcess stands in for the spawned language server. It records every byte
// written to stdin, which is what makes "the compiler was told" a readable fact
// rather than an inference from the promise.
function stubProcess(): {
  proc: { stdout: EventEmitter; stderr: EventEmitter; stdin: { write(b: Buffer): boolean } } & EventEmitter;
  written: Buffer[];
} {
  const written: Buffer[] = [];
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: {
      write(chunk: Buffer): boolean {
        written.push(Buffer.from(chunk));
        return true;
      },
    },
  });
  return { proc: proc as never, written };
}

// framesFrom decodes what was written back into the messages the daemon would
// have read. Decoding rather than searching the raw bytes is deliberate: a
// substring match over a concatenated buffer reports a hit for a method name
// that appears anywhere, including inside a parameter, so it can report a
// notification that was never sent.
function framesFrom(written: Buffer[]): Array<Record<string, unknown>> {
  const all = Buffer.concat(written);
  const messages: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (offset < all.byteLength) {
    const headerEnd = all.indexOf('\r\n\r\n', offset);
    if (headerEnd < 0) { break; }
    const header = all.subarray(offset, headerEnd).toString('ascii');
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) { break; }
    const length = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    messages.push(JSON.parse(all.subarray(bodyStart, bodyStart + length).toString('utf8')));
    offset = bodyStart + length;
  }
  return messages;
}

function runningDaemon(): { daemon: Daemon; written: Buffer[] } {
  const { proc, written } = stubProcess();
  const daemon = Daemon.__forTesting(DEFAULT_SETTINGS, proc as never);
  return { daemon, written };
}

describe('stopping a language-server request tells the compiler to stop', () => {
  it('sends $/cancelRequest naming the id the request was sent under', async () => {
    const { daemon, written } = runningDaemon();
    const { signal, cancel } = controllableSignal();

    const pending = daemon.request('aggrega/build', { release: 'release.yaml' }, signal);
    const sentFrames = framesFrom(written);
    assert.strictEqual(sentFrames.length, 1, 'the request itself should have been written');
    const requestId = sentFrames[0].id;
    assert.strictEqual(typeof requestId, 'number');

    cancel();

    await assert.rejects(pending, (err: unknown) => isCancellation(err));

    // THE assertion of this work item. A cancel that only abandoned the promise
    // would leave exactly one frame on the wire and pass every other test here.
    const frames = framesFrom(written);
    assert.strictEqual(frames.length, 2, 'a cancel notification should follow the request');
    assert.strictEqual(frames[1].method, '$/cancelRequest');
    assert.strictEqual(frames[1].jsonrpc, '2.0');
    assert.strictEqual(
      (frames[1].params as { id: unknown }).id,
      requestId,
      'the notification must name the id the request was sent under, or the daemon cancels nothing',
    );
    // A notification carries no id of its own; one here would make the daemon
    // answer it as a request.
    assert.strictEqual('id' in frames[1], false);
  });

  it('ends the request, because a cancelled request receives no response frame', async () => {
    // The daemon drops the response for a request it cancelled, so nothing will
    // arrive to settle this promise later. Settling here is the only settlement
    // there is — a client that merely sent the notification would hang.
    const { daemon } = runningDaemon();
    const { signal, cancel } = controllableSignal();
    const pending = daemon.request('aggrega/build', {}, signal);
    cancel();
    const err = await pending.then(() => null, (e: unknown) => e);
    assert.ok(err instanceof OperationCancelled);
    assert.match((err as OperationCancelled).message, /stopped at your request/);
  });

  it('says the operation was stopped, never that it failed', async () => {
    const { daemon } = runningDaemon();
    const { signal, cancel } = controllableSignal();
    const pending = daemon.request('aggrega/build', {}, signal);
    cancel();
    const err = await pending.then(() => null, (e: unknown) => e);
    assert.doesNotMatch((err as Error).message, /fail|error|wrong/i);
  });

  it('sends nothing at all when the reader stopped before the request went out', async () => {
    const { daemon, written } = runningDaemon();
    const { signal, cancel } = controllableSignal();
    cancel();
    await assert.rejects(daemon.request('aggrega/build', {}, signal), isCancellation);
    assert.deepStrictEqual(framesFrom(written), [], 'nothing was in flight, so nothing is cancelled');
  });

  it('does not cancel a request the daemon has already answered', async () => {
    const { daemon, written } = runningDaemon();
    const { signal, cancel } = controllableSignal();
    const pending = daemon.request<{ ok: boolean }>('aggrega/build', {}, signal);
    const id = framesFrom(written)[0].id;

    // The answer arrives first, exactly as it would on the wire.
    const response = frameMessage({ jsonrpc: '2.0', id, result: { ok: true } });
    (daemon as unknown as { handleStdoutChunk(c: Buffer): void }).handleStdoutChunk(response);
    assert.deepStrictEqual(await pending, { ok: true });

    cancel();
    assert.strictEqual(
      framesFrom(written).length,
      1,
      'cancelling a settled request would tell the daemon to cancel an id it no longer holds',
    );
  });

  it('frames every message through one encoder', () => {
    // The framing existed in as many copies as there were senders. This reads
    // back the bytes of each of the three messages that leave the client and
    // requires them to share the one encoding.
    const request = frameMessage({ jsonrpc: '2.0', id: 1, method: 'aggrega/build', params: {} });
    const shutdown = frameMessage({ jsonrpc: '2.0', method: 'aggrega/shutdown' });
    const cancelNote = frameMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } });
    for (const framed of [request, shutdown, cancelNote]) {
      const text = framed.toString('utf8');
      const [header, body] = text.split('\r\n\r\n');
      assert.strictEqual(header, `Content-Length: ${Buffer.byteLength(body, 'utf8')}`);
    }
  });
});

// --- the subprocess transport --------------------------------------------

describe('stopping a subprocess operation terminates the child', () => {
  it('terminates a REAL child process, and the process is gone afterwards', async () => {
    // A stub can record that kill was called; only a real process can show that
    // the compiler actually stopped. The child sleeps far longer than the test,
    // so an assertion that it has exited cannot pass by the child finishing on
    // its own.
    const child = spawn('/bin/sh', ['-c', 'sleep 120']);
    await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
    const pid = child.pid!;
    assert.ok(pid > 0);
    // Signal 0 tests for existence without delivering anything.
    assert.doesNotThrow(() => process.kill(pid, 0), 'the child should be running before the stop');

    const { signal, cancel } = controllableSignal();
    const pending = runCliProcess(
      { spawn: () => child as unknown as CliChild, append: () => undefined, appendLine: () => undefined },
      'The run',
      signal,
    );
    cancel();
    await assert.rejects(pending, isCancellation);

    // Wait for the exit the termination causes. The bound is a liveness
    // ceiling, not a performance budget: it separates "the child died" from
    // "the child is still running", and it sits below the runner's own timeout
    // so a child that survives fails on the assertion below — which names the
    // defect — rather than on the harness, which would not.
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(true); return; }
        child.once('exit', () => resolve(true));
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200)),
    ]);
    assert.strictEqual(exited, true, 'the child must have exited');
    assert.notStrictEqual(
      child.signalCode ?? child.exitCode,
      null,
      'the child must carry the signal or status it ended with',
    );
    assert.throws(
      () => process.kill(pid, 0),
      'the process must be gone — a stop that leaves it running is the defect this asserts against',
    );
  });

  it('asks politely first, then insists', async () => {
    const signals: Array<string | undefined> = [];
    let alive = true;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill(sig?: string) { signals.push(sig); return true; },
      get exitCode() { return alive ? null : 0; },
      get signalCode() { return null; },
    });
    const { signal, cancel } = controllableSignal();
    const pending = runCliProcess(
      { spawn: () => child as unknown as CliChild, append: () => undefined, appendLine: () => undefined },
      'The run',
      signal,
      20,
    );
    cancel();
    await assert.rejects(pending, isCancellation);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepStrictEqual(
      signals,
      ['SIGTERM', 'SIGKILL'],
      'a wedged child must reach the insistent second signal; settling must not retract it',
    );
    alive = false;
  });

  it('leaves a child that stops on the polite signal alone', async () => {
    const signals: Array<string | undefined> = [];
    let exitCode: number | null = null;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill(sig?: string) {
        signals.push(sig);
        exitCode = 143;
        setTimeout(() => child.emit('close', 143), 0);
        return true;
      },
      get exitCode() { return exitCode; },
      get signalCode() { return null; },
    });
    const { signal, cancel } = controllableSignal();
    const pending = runCliProcess(
      { spawn: () => child as unknown as CliChild, append: () => undefined, appendLine: () => undefined },
      'The run',
      signal,
      20,
    );
    cancel();
    await assert.rejects(pending, isCancellation);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepStrictEqual(signals, ['SIGTERM']);
  });

  it('spawns nothing when the reader stopped before the run started', async () => {
    let spawned = 0;
    const { signal, cancel } = controllableSignal();
    cancel();
    await assert.rejects(
      runCliProcess(
        {
          spawn: () => { spawned += 1; throw new Error('should not be reached'); },
          append: () => undefined,
          appendLine: () => undefined,
        },
        'The run',
        signal,
      ),
      isCancellation,
    );
    assert.strictEqual(spawned, 0);
  });

  it('reports the exit status of a run nobody stopped', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill() { return true; },
      exitCode: null,
      signalCode: null,
    });
    const pending = runCliProcess(
      { spawn: () => child as unknown as CliChild, append: () => undefined, appendLine: () => undefined },
      'The run',
    );
    setTimeout(() => child.emit('close', 3), 0);
    assert.strictEqual(await pending, 3);
  });
});
