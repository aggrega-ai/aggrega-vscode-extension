// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Daemon, DaemonState, RespawnNarration, ShutdownNarration } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';
import { PublishDiagnosticsParams } from '../../src/types';

// How the client supervises a language server that ends without being asked to,
// read back as the sequence a reader's output channel and the lifecycle would
// show, and compared by equality against the sequence the supervision states.
//
// THE SERVERS ARE REAL PROCESSES, scripted per start. The client launches
// `<binary> serve` in the workspace root, so with the binary set to this Node
// and a script named `serve` placed in that root, every process the client
// starts is that script. It reads, from a plan beside it, what the process
// started in that position does — answer, die as it starts, die on receiving
// the handshake, answer late, answer and die a moment later, answer and start a
// message it dies before finishing, answer and file a finding in the same
// write, or hold its answer until a file named `answer` appears beside it — and
// claims its position by creating a file holding its process id, so the
// positions follow the order of the starts and every process started can be
// found again. Every request after the handshake is answered with the position
// that answered it.
// Real processes are the point: what is supervised is the operating system's
// report of how a process ended, arriving when it arrives.

const STAND_IN = String.raw`
const fs = require('fs');
const path = require('path');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'));
let index = 0;
for (;; index++) {
  let claimed;
  try { claimed = fs.openSync(path.join(__dirname, 'spawn-' + index), 'wx'); }
  catch (e) { if (e.code !== 'EEXIST') { throw e; } continue; }
  fs.writeSync(claimed, String(process.pid));
  fs.closeSync(claimed);
  break;
}
const [kind, ms] = String(plan[Math.min(index, plan.length - 1)]).split(':');
if (kind === 'die-at-start') { process.exit(1); }
const die = () => process.kill(process.pid, 'SIGTERM');
const frame = (body) => {
  const p = Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.concat([Buffer.from('Content-Length: ' + p.length + '\r\n\r\n', 'ascii'), p]);
};
const send = (body) => { process.stdout.write(frame(body)); };
// HALF_FRAME is the start of a message longer than anything sent after it: a
// header naming far more bytes than follow it.
const HALF_FRAME = Buffer.from('Content-Length: 4096\r\n\r\n{"jsonrpc":"2.0","method":"aggrega/publishDiagnostics","params":{"file":"', 'ascii');
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) { return; }
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, end).toString('ascii'))[1]);
    if (buf.length < end + 4 + len) { return; }
    const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString('utf8'));
    buf = buf.subarray(end + 4 + len);
    if (msg.method === 'aggrega/shutdown') { process.exit(0); }
    if (msg.method !== 'aggrega/initialize') {
      if (msg.id !== undefined) { send({ jsonrpc: '2.0', id: msg.id, result: { answeredBy: index } }); }
      continue;
    }
    if (kind === 'die-on-init') { die(); return; }
    const answered = { jsonrpc: '2.0', id: msg.id, result: { capabilities: { positionEncoding: 'utf-8' } } };
    const answer = () => send(answered);
    if (kind === 'slow') { setTimeout(answer, Number(ms)); continue; }
    if (kind === 'held') {
      const held = setInterval(() => {
        if (fs.existsSync(path.join(__dirname, 'answer'))) { clearInterval(held); answer(); }
      }, 10);
      continue;
    }
    if (kind === 'half-frame') {
      process.stdout.write(Buffer.concat([frame(answered), HALF_FRAME]));
      setTimeout(die, Number(ms));
      continue;
    }
    if (kind === 'files') {
      process.stdout.write(Buffer.concat([frame(answered), frame({ jsonrpc: '2.0', method: 'aggrega/publishDiagnostics', params: {
        file: path.join(__dirname, 'filed.yaml'),
        diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'said by server ' + index, source: 'aggrega-build' }],
      } })]));
      continue;
    }
    answer();
    if (kind === 'die-after') { setTimeout(die, Number(ms)); }
  }
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 60000);
`;

const WINDOW_SECONDS = 180;

// Scripted is one client over one workspace of scripted servers, what it
// reported, in order, and the findings it filed, each as the file relative to the
// workspace and what was said of it.
interface Scripted {
  daemon: Daemon;
  root: string;
  seen: string[];
  filed: string[];
  starts(): number;
}

const roots: string[] = [];
const clients: Daemon[] = [];

// workspace makes a workspace root holding the scripted server and its plan.
function workspace(plan: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-respawn-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'serve'), STAND_IN);
  fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
  return root;
}

// startedIn reads the process id of every server started in a workspace, in the
// order of their positions.
function startedIn(root: string): number[] {
  return fs.readdirSync(root)
    .filter(n => n.startsWith('spawn-'))
    .sort((a, b) => Number(a.slice('spawn-'.length)) - Number(b.slice('spawn-'.length)))
    .map(n => Number(fs.readFileSync(path.join(root, n), 'utf8')))
    .filter(pid => pid > 0);
}

// running reports whether a process is still there to be signalled.
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scripted(plan: string[], respawnAttempts: number): Scripted {
  const root = workspace(plan);
  const seen: string[] = [];
  const daemon = new Daemon(
    settingsFromObject({ binaryPath: process.execPath, respawnAttempts, respawnWindowSeconds: WINDOW_SECONDS }),
    msg => seen.push(`log: ${msg}`),
  );
  return observed(daemon, root, seen);
}

// observed keeps what a client reports of its lifecycle, and the findings it files.
function observed(daemon: Daemon, root: string, seen: string[]): Scripted {
  clients.push(daemon);
  daemon.on('stateChange', (next: DaemonState, prev: DaemonState) => seen.push(`state: ${prev} -> ${next}`));
  daemon.on('unexpectedExit', (code: number | null, signal: string | null) => seen.push(`unexpectedExit: code=${code} signal=${signal}`));
  daemon.on('stoppedResponding', () => seen.push('stoppedResponding'));
  const filed: string[] = [];
  daemon.on('notification:aggrega/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    filed.push(`${path.relative(root, params.file)}: ${(params.diagnostics ?? []).map(d => d.message).join(', ')}`);
  });
  const starts = () => fs.readdirSync(root).filter(n => n.startsWith('spawn-')).length;
  return { daemon, root, seen, filed, starts };
}

// SlowToEnd stands in for a server that does not end when the client tells it to
// — not on SIGTERM, not on SIGKILL — so a client tearing it down stops waiting for
// it, and what it reports afterwards comes from a server the client has let go of.
// No real process can be made to outlive SIGKILL on demand, so it is attached
// through the client's test seam, and a case reports its end, or an error, at the
// moment the case names.
class SlowToEnd extends EventEmitter {
  readonly stdin = { write: (): boolean => true };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly told: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.told.push(signal);
    return true;
  }

  // endedLate reports the end the last signal brought about, after the client
  // stopped waiting for it.
  endedLate(): void {
    this.signalCode = 'SIGKILL';
    this.emit('exit', null, 'SIGKILL');
  }
}

// runningSlowToEnd makes a client already running a server slow to end, in a
// workspace whose scripted servers follow `plan`.
function runningSlowToEnd(plan: string[], respawnAttempts: number): { s: Scripted; slow: SlowToEnd } {
  const root = workspace(plan);
  const slow = new SlowToEnd();
  const daemon = Daemon.__forTesting(
    settingsFromObject({ binaryPath: process.execPath, respawnAttempts, respawnWindowSeconds: WINDOW_SECONDS }),
    slow as unknown as ChildProcessWithoutNullStreams,
  );
  // The seam attaches a server without starting one, so the client names no
  // workspace; it is named as a start names it, since the next server is started
  // in the workspace root.
  (daemon as unknown as { workspaceRoot: string }).workspaceRoot = root;
  return { s: observed(daemon, root, []), slow };
}

// restartPastOneSlowToEnd restarts a client over a server slow to end — the
// restart stops waiting once SIGKILL has gone unanswered and starts a scripted
// server whose answer to the handshake is held — and, while that handshake is
// open, has the replaced server report what `late` makes it report. Then it lets
// the new server answer, asks it something, stops the client, and reads back what
// happened.
async function restartPastOneSlowToEnd(late: (replaced: SlowToEnd) => void): Promise<Record<string, unknown>> {
  // Nothing is started again by itself here, so an end taken for the running
  // server's starts no process the case would then have to account for.
  const { s, slow } = runningSlowToEnd(['held'], 0);
  let restart: string | undefined;
  s.daemon.restart().then(() => { restart = 'resolved'; }, (err: Error) => { restart = `rejected: ${err.message}`; });
  await until(s, 'the server started in place of the slow one claiming its position', () => s.starts() === 1);
  const whenReported = s.daemon.getState();
  late(slow);
  fs.writeFileSync(path.join(s.root, 'answer'), '');
  await until(s, 'the restart settling', () => restart !== undefined);
  const answer = await s.daemon.request<unknown>('aggrega/validate', {}).catch((err: Error) => `refused: ${err.message}`);
  const holdsAServer = s.daemon.getLaunchedBinaryPath() !== null;
  const seen = [...s.seen];
  await s.daemon.stop();
  return {
    told: slow.told,
    whenReported,
    restart,
    seen,
    answer,
    holdsAServer,
    runningAfterTheStop: startedIn(s.root).filter(running).length,
  };
}

// RESTARTED_PAST_ONE_SLOW_TO_END is what restartPastOneSlowToEnd reads back of a
// client that hands nothing a replaced server reports to the server running now.
const RESTARTED_PAST_ONE_SLOW_TO_END = {
  told: ['SIGTERM', 'SIGKILL'],
  whenReported: DaemonState.Starting,
  restart: 'resolved',
  seen: ['state: Running -> Restarting', 'state: Restarting -> Starting', 'state: Starting -> Running'],
  answer: { answeredBy: 0 },
  holdsAServer: true,
  runningAfterTheStop: 0,
};

// until waits for `done` to hold of what the client reported, and fails naming
// the sequence it had reached; the suite timeout is the outer bound.
async function until(s: Scripted, what: string, done: () => boolean, boundMs = 10_000): Promise<void> {
  const end = Date.now() + boundMs;
  while (!done()) {
    if (Date.now() > end) {
      assert.fail(`${what} did not happen within ${boundMs} ms; the client reported:\n${s.seen.join('\n')}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// settle waits a stated while in which nothing further is expected, so an
// equality over the sequence also says that nothing came after it.
const settle = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));

// The lines each end and each restart writes, composed from the one home of
// those words.
const endedBySigterm = [
  `log: ${RespawnNarration.ended(null, 'SIGTERM')}`,
  'unexpectedExit: code=null signal=SIGTERM',
];
const endedWithCode1 = [
  `log: ${RespawnNarration.ended(1, null)}`,
  'unexpectedExit: code=1 signal=null',
];
function restartOf(made: number, limit: number): string[] {
  return [`log: ${RespawnNarration.restarting(made, limit, WINDOW_SECONDS)}`];
}
function handshakeFailed(reason: string): string[] {
  return [
    `log: initialize failed: ${reason}; falling back to UTF-16`,
    'state: Starting -> Stopping',
    'state: Stopping -> Stopped',
    `log: ${RespawnNarration.restartFailed(reason)}`,
  ];
}
const started = ['state: Stopped -> Starting', 'state: Starting -> Running'];
const fromRunning = ['state: Running -> Stopped', 'state: Stopped -> Starting'];

describe('Daemon supervision of a server that ends unasked', function () {
  this.timeout(30_000);

  afterEach(async () => {
    while (clients.length > 0) {
      await clients.pop()!.stop();
    }
    // A server no client holds any longer — one a client let go of while it still
    // ran — is ended here, so no case leaves a process behind it.
    for (const root of roots) {
      for (const pid of startedIn(root).filter(running)) {
        process.kill(pid, 'SIGKILL');
      }
    }
    while (roots.length > 0) {
      fs.rmSync(roots.pop()!, { recursive: true, force: true });
    }
  });

  it('starts a server again when the one started in place of a crashed one dies during its handshake', async () => {
    const s = scripted(['die-after:100', 'die-on-init', 'ok'], 5);
    await s.daemon.start(s.root);
    await until(s, 'the third server running', () => s.starts() === 3 && s.daemon.getState() === DaemonState.Running);
    await settle();

    assert.deepStrictEqual(s.seen, [
      ...started,
      ...endedBySigterm,
      ...restartOf(1, 5),
      ...fromRunning,
      ...endedBySigterm,
      ...handshakeFailed('daemon exited (code=null, signal=SIGTERM)'),
      ...restartOf(2, 5),
      'state: Stopped -> Starting',
      'state: Starting -> Running',
    ]);
    assert.strictEqual(s.starts(), 3);
    assert.strictEqual(s.daemon.lastStartFailed(), false);
  });

  it('reads the server started in place of one that ended mid-message from that server\'s first byte', async () => {
    // The first server's last message stops after its header and a few bytes of
    // the body the header promises. Read on from there, the respawned server's
    // answer to the handshake would be taken for the rest of that body, and the
    // start would wait out the handshake's own bound, far beyond this one.
    const s = scripted(['half-frame:100', 'files'], 5);
    await s.daemon.start(s.root);
    await until(s, 'the respawned server running with its finding filed', () => (
      s.starts() === 2 && s.daemon.getState() === DaemonState.Running && s.filed.length > 0
    ));
    await settle();

    assert.deepStrictEqual(
      { seen: s.seen, filed: s.filed },
      {
        seen: [...started, ...endedBySigterm, ...restartOf(1, 5), ...fromRunning, 'state: Starting -> Running'],
        filed: ['filed.yaml: said by server 1'],
      },
    );
  });

  it('gives exactly as many restarts as the respawn setting states, then raises stopped-responding once', async () => {
    const s = scripted(['die-after:100'], 3);
    await s.daemon.start(s.root);
    await until(s, 'the stopped-responding event', () => s.seen.includes('stoppedResponding'));
    await settle();

    assert.deepStrictEqual(s.seen, [
      ...started,
      ...endedBySigterm, ...restartOf(1, 3), ...fromRunning, 'state: Starting -> Running',
      ...endedBySigterm, ...restartOf(2, 3), ...fromRunning, 'state: Starting -> Running',
      ...endedBySigterm, ...restartOf(3, 3), ...fromRunning, 'state: Starting -> Running',
      ...endedBySigterm,
      `log: ${RespawnNarration.boundSpent(3, WINDOW_SECONDS)}`,
      'state: Running -> Stopped',
      'stoppedResponding',
    ]);
    assert.strictEqual(s.starts(), 4, 'the first start and three restarts');
    assert.strictEqual(s.daemon.getState(), DaemonState.Stopped);
    // The last attempt to start succeeded: this server ran and then stopped.
    assert.strictEqual(s.daemon.lastStartFailed(), false);
  });

  it('stops at the bound, and says so once, under a server that dies every time it starts', async () => {
    const s = scripted(['die-after:100', 'die-at-start'], 2);
    await s.daemon.start(s.root);
    await until(s, 'the stopped-responding event', () => s.seen.includes('stoppedResponding'));
    // A run of restarts that looped would go on starting servers here.
    await settle(1000);

    assert.deepStrictEqual(s.seen, [
      ...started,
      ...endedBySigterm, ...restartOf(1, 2), ...fromRunning,
      ...endedWithCode1, ...handshakeFailed('daemon exited (code=1, signal=null)'),
      ...restartOf(2, 2), 'state: Stopped -> Starting',
      ...endedWithCode1, ...handshakeFailed('daemon exited (code=1, signal=null)'),
      `log: ${RespawnNarration.boundSpent(2, WINDOW_SECONDS)}`,
      'stoppedResponding',
    ]);
    assert.strictEqual(s.starts(), 3, 'the first start and two restarts, and nothing after the bound');
    assert.strictEqual(s.daemon.getState(), DaemonState.Stopped);
    assert.strictEqual(s.daemon.lastStartFailed(), true, 'the last attempt to start failed');
  });

  it('counts no restart the reader asked for, and starts the count again from it', async () => {
    // The first server crashes and uses the one restart the bound allows. The
    // reader then restarts the server; if that restart were counted, or did not
    // start the count again, the crash after it would find the bound spent.
    const s = scripted(['die-after:100', 'ok', 'die-after:100', 'die-after:100'], 1);
    await s.daemon.start(s.root);
    await until(s, 'the second server running', () => s.starts() === 2 && s.daemon.getState() === DaemonState.Running);
    await s.daemon.restart();
    await until(s, 'the stopped-responding event', () => s.seen.includes('stoppedResponding'));
    await settle();

    assert.deepStrictEqual(s.seen, [
      ...started,
      ...endedBySigterm, ...restartOf(1, 1), ...fromRunning, 'state: Starting -> Running',
      'state: Running -> Restarting',
      `log: ${ShutdownNarration.osTermination}`,
      'state: Restarting -> Starting',
      'state: Starting -> Running',
      ...endedBySigterm, ...restartOf(1, 1), ...fromRunning, 'state: Starting -> Running',
      ...endedBySigterm,
      `log: ${RespawnNarration.boundSpent(1, WINDOW_SECONDS)}`,
      'state: Running -> Stopped',
      'stoppedResponding',
    ]);
    assert.strictEqual(s.starts(), 4);
  });

  it('treats a stop the reader asks for during a restarted server\'s handshake as no failure and no crash', async () => {
    const s = scripted(['die-after:100', 'slow:5000'], 5);
    await s.daemon.start(s.root);
    await until(s, 'the restarted server in its handshake', () => s.starts() === 2 && s.daemon.getState() === DaemonState.Starting);
    await s.daemon.stop();
    await settle();

    assert.deepStrictEqual(s.seen, [
      ...started,
      ...endedBySigterm, ...restartOf(1, 5), ...fromRunning,
      'state: Starting -> Stopping',
      `log: ${ShutdownNarration.cooperativeRequest}`,
      `log: ${ShutdownNarration.cooperativeExit}`,
      'state: Stopping -> Stopped',
    ]);
    assert.strictEqual(s.daemon.lastStartFailed(), false, 'an attempt a stop abandoned did not fail');
    assert.strictEqual(s.starts(), 2);
  });

  // A restart stops waiting for the server it replaces a moment after SIGKILL,
  // whether or not that server's end has been reported, and starts the next one at
  // once. Read as the running server's, an end reported after that fails the
  // handshake under way and drops the client's hold on the new process, which is
  // left running with nothing to stop it; an error reported then fails the same
  // handshake.
  it('brings up the server that replaces one slow to end, whatever that one then reports of its end', async () => {
    const reading = await restartPastOneSlowToEnd(replaced => replaced.endedLate());
    assert.deepStrictEqual(reading, RESTARTED_PAST_ONE_SLOW_TO_END);
  });

  it('brings up the server that replaces one slow to end, whatever error that one then raises', async () => {
    const reading = await restartPastOneSlowToEnd(replaced => replaced.emit('error', new Error('raised by the server replaced')));
    assert.deepStrictEqual(reading, RESTARTED_PAST_ONE_SLOW_TO_END);
  });

  it('starts nothing, and reports nothing, for an end reported after a stop stopped waiting for it', async () => {
    // A stop walks the whole ladder against a server that answers none of it, and
    // returns a moment after SIGKILL. An end reported after that, read as the
    // running server's, would be a crash of a client the reader stopped, and the
    // client would start a server by itself.
    const { s, slow } = runningSlowToEnd(['ok'], 1);
    await s.daemon.stop();
    slow.endedLate();
    await settle();

    assert.deepStrictEqual(
      { told: slow.told, seen: s.seen, starts: s.starts() },
      { told: ['SIGTERM', 'SIGKILL'], seen: ['state: Running -> Stopping', 'state: Stopping -> Stopped'], starts: 0 },
    );
  });
});
