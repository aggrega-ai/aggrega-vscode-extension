// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Daemon, DaemonState, RespawnNarration, ShutdownNarration } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';

// How the client supervises a language server that ends without being asked to,
// read back as the sequence a reader's output channel and the lifecycle would
// show, and compared by equality against the sequence the supervision states.
//
// THE SERVERS ARE REAL PROCESSES, scripted per start. The client launches
// `<binary> serve` in the workspace root, so with the binary set to this Node
// and a script named `serve` placed in that root, every process the client
// starts is that script. It reads, from a plan beside it, what the process
// started in that position does — answer, die as it starts, die on receiving
// the handshake, answer late, or answer and die a moment later — and claims its
// position by creating a file, so the positions follow the order of the starts.
// Real processes are the point: what is supervised is the operating system's
// report of how a process ended, arriving when it arrives.

const STAND_IN = String.raw`
const fs = require('fs');
const path = require('path');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'));
let index = 0;
for (;; index++) {
  try { fs.closeSync(fs.openSync(path.join(__dirname, 'spawn-' + index), 'wx')); break; }
  catch (e) { if (e.code !== 'EEXIST') { throw e; } }
}
const [kind, ms] = String(plan[Math.min(index, plan.length - 1)]).split(':');
if (kind === 'die-at-start') { process.exit(1); }
const die = () => process.kill(process.pid, 'SIGTERM');
const send = (body) => {
  const p = Buffer.from(JSON.stringify(body), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from('Content-Length: ' + p.length + '\r\n\r\n', 'ascii'), p]));
};
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
    if (msg.method !== 'aggrega/initialize') { continue; }
    if (kind === 'die-on-init') { die(); return; }
    const answer = () => send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { positionEncoding: 'utf-8' } } });
    if (kind === 'slow') { setTimeout(answer, Number(ms)); continue; }
    answer();
    if (kind === 'die-after') { setTimeout(die, Number(ms)); }
  }
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 60000);
`;

const WINDOW_SECONDS = 180;

// Scripted is one client over one workspace of scripted servers, and what it
// reported, in order.
interface Scripted {
  daemon: Daemon;
  root: string;
  seen: string[];
  starts(): number;
}

const roots: string[] = [];
const clients: Daemon[] = [];

function scripted(plan: string[], respawnAttempts: number): Scripted {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-respawn-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'serve'), STAND_IN);
  fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
  const seen: string[] = [];
  const daemon = new Daemon(
    settingsFromObject({ binaryPath: process.execPath, respawnAttempts, respawnWindowSeconds: WINDOW_SECONDS }),
    msg => seen.push(`log: ${msg}`),
  );
  clients.push(daemon);
  daemon.on('stateChange', (next: DaemonState, prev: DaemonState) => seen.push(`state: ${prev} -> ${next}`));
  daemon.on('unexpectedExit', (code: number | null, signal: string | null) => seen.push(`unexpectedExit: code=${code} signal=${signal}`));
  daemon.on('stoppedResponding', () => seen.push('stoppedResponding'));
  const starts = () => fs.readdirSync(root).filter(n => n.startsWith('spawn-')).length;
  return { daemon, root, seen, starts };
}

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
});
