// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Daemon, DaemonState } from '../../src/daemon';
import { ServerTurnover, ServerWordHolder, beginsANewServer, createServerTurnover } from '../../src/server-turnover';
import { settingsFromObject } from '../../src/settings';
import { PublishDiagnosticsParams } from '../../src/types';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import { EXTENSION_ROOT } from '../helpers/launch-census';

// What a new language server does to the findings the stopped one filed, read back
// from the problem list a client holds once the new server answers.
//
// THE SERVERS ARE REAL PROCESSES, scripted per start, through the production client
// and the production turnover. The client launches `<binary> serve` in the
// workspace root, so with the binary set to this Node and a script named `serve`
// placed in that root, every process the client starts is that script. Each reads,
// from a plan beside it, which files the process started in that position files a
// finding on and whether it dies a moment after answering, and claims its position
// by creating a file. A process files its findings in the SAME WRITE as its answer
// to the handshake — the read in which a client is most likely to file a new
// server's word before it reads Running.
//
// A process can also hand its output to a process of its own that outlives it, and
// that one files a finding only once the next server has claimed its position — so
// the finding reaches the client after the process whose output carries it has
// ended, which the operating system allows: a process's exit is reported whatever
// anything else still holding its output goes on to write.
//
// The two lines handing the client's events to the turnover and to the problem
// list are the extension's wiring, written again here because the module holding
// them imports the editor and cannot start in this run. That they are the
// extension's own is read from its source, in the last group below.

const STAND_IN = String.raw`
const fs = require('fs');
const path = require('path');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'));
let index = 0;
for (;; index++) {
  try { fs.closeSync(fs.openSync(path.join(__dirname, 'spawn-' + index), 'wx')); break; }
  catch (e) { if (e.code !== 'EEXIST') { throw e; } }
}
const step = plan[Math.min(index, plan.length - 1)];
const frame = (body) => {
  const p = Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.concat([Buffer.from('Content-Length: ' + p.length + '\r\n\r\n', 'ascii'), p]);
};
const finding = (file, message) => frame({ jsonrpc: '2.0', method: 'aggrega/publishDiagnostics', params: {
  file: path.join(__dirname, file),
  diagnostics: [{ line: 1, column: 1, severity: 'warning', message, source: 'aggrega-build' }],
} });
// LATE is the process this one hands its output to: it waits for the marker the
// next server creates, writes the frame it was given to the output it holds, and
// ends — or ends with nothing written once its bound is spent.
const LATE = [
  "const fs = require('fs');",
  'const [marker, frame] = process.argv.slice(1);',
  'const end = Date.now() + 10000;',
  'const wait = () => {',
  "  if (fs.existsSync(marker)) { fs.writeSync(1, Buffer.from(frame, 'base64')); process.exit(0); }",
  '  if (Date.now() > end) { process.exit(1); }',
  '  setTimeout(wait, 10);',
  '};',
  'wait();',
].join('\n');
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
    const out = [frame({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { positionEncoding: 'utf-8' } } })];
    for (const file of step.files) {
      out.push(finding(file, 'said by server ' + index));
    }
    process.stdout.write(Buffer.concat(out));
    if (step.lateFile !== undefined) {
      const late = finding(step.lateFile, 'said by server ' + index + ' after it ended').toString('base64');
      require('child_process').spawn(process.execPath, ['-e', LATE, path.join(__dirname, 'spawn-' + (index + 1)), late], {
        stdio: ['ignore', 'inherit', 'ignore'],
      }).unref();
    }
    if (step.dieAfterMs !== undefined) { setTimeout(() => process.kill(process.pid, 'SIGTERM'), step.dieAfterMs); }
  }
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 60000);
`;

// Step is what the process started in one position does: the files, relative to
// the workspace root, it files a finding on with its handshake answer, how long
// after answering it dies, where it does, and the file the process it hands its
// output to files a finding on once the next server has claimed its position,
// where there is one.
interface Step { files: string[]; dieAfterMs?: number; lateFile?: string }

// ProblemList stands in for one editor diagnostic collection: the findings filed
// per file, replaced whole by each publication naming that file, and emptied by a
// clear — the two things the extension's collections do here.
class ProblemList implements ServerWordHolder {
  readonly entries = new Map<string, string[]>();

  file(params: PublishDiagnosticsParams): void {
    const said = (params.diagnostics ?? []).map((d) => d.message);
    if (said.length === 0) {
      this.entries.delete(params.file);
    } else {
      this.entries.set(params.file, said);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  // reading is what the list holds, relative to root and in a stable order.
  reading(root: string): string[] {
    return [...this.entries].map(([file, said]) => `${path.relative(root, file)}: ${said.join(', ')}`).sort();
  }
}

const roots: string[] = [];
const clients: Daemon[] = [];

function workspace(plan: Step[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-turnover-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'serve'), STAND_IN);
  fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
  return root;
}

function starts(root: string): number {
  return fs.readdirSync(root).filter((n) => n.startsWith('spawn-')).length;
}

// client builds one production client and hands its lifecycle positions to the
// turnover and its pushed findings to the problem list, as the extension does.
function client(turnover: ServerTurnover, problems: ProblemList): Daemon {
  const daemon = new Daemon(settingsFromObject({ binaryPath: process.execPath, respawnAttempts: 5, respawnWindowSeconds: 180 }));
  clients.push(daemon);
  daemon.on('stateChange', (next: DaemonState) => turnover.moved(next));
  daemon.on('notification:aggrega/publishDiagnostics', (params: PublishDiagnosticsParams) => problems.file(params));
  return daemon;
}

// turnoverOver builds the production turnover over the holders given, counting the
// validations it asks for.
function turnoverOver(holders: ServerWordHolder[]): { turnover: ServerTurnover; validations: () => number } {
  let validations = 0;
  const turnover = createServerTurnover({ holders: () => holders, revalidate: () => { validations += 1; } });
  return { turnover, validations: () => validations };
}

// outputClosed reports, for the process the client runs at the moment it is
// called, whether everything that process's output carried has reached the client.
// A process reports closed only once its output has ended, so by then every byte
// it carried has been handed to the client's reader. The process is the client's
// own and no event of the client's says when its output ends, so it is read from
// the client.
function outputClosed(daemon: Daemon): () => boolean {
  const proc = (daemon as unknown as { proc: ChildProcess | null }).proc;
  assert.ok(proc, 'the client runs no process');
  let closed = false;
  proc.once('close', () => { closed = true; });
  return () => closed;
}

async function until(what: string, done: () => boolean, boundMs = 10_000): Promise<void> {
  const end = Date.now() + boundMs;
  while (!done()) {
    if (Date.now() > end) { assert.fail(`${what} did not happen within ${boundMs} ms`); }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// settle waits a stated while in which nothing further is expected, so a reading
// taken after it also says nothing arrived late.
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a new language server starts the problem list from what it says', function () {
  this.timeout(30_000);

  afterEach(async () => {
    while (clients.length > 0) { await clients.pop()!.stop(); }
    while (roots.length > 0) { fs.rmSync(roots.pop()!, { recursive: true, force: true }); }
  });

  describe('the decision', () => {
    it('begins a new server at Starting and at no other position', () => {
      const reading = Object.values(DaemonState).map((state) => `${state}: ${beginsANewServer(state)}`);
      assert.deepStrictEqual(reading, [
        'Stopped: false',
        'Starting: true',
        'Running: false',
        'Restarting: false',
        'Stopping: false',
      ]);
    });

    it('empties every holder it is handed as a new server begins, and none at any other move', () => {
      const layer = new ProblemList();
      const conventions = new ProblemList();
      const { turnover } = turnoverOver([layer, conventions]);
      const fill = () => {
        layer.file({ file: '/ws/a.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'm', source: 'aggrega' }] });
        conventions.file({ file: '/ws/b.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'm', source: 'aggrega-lint' }] });
      };
      const kept: string[] = [];
      for (const state of Object.values(DaemonState)) {
        fill();
        turnover.moved(state);
        kept.push(`${state}: ${layer.entries.size + conventions.entries.size}`);
      }
      assert.deepStrictEqual(kept, ['Stopped: 2', 'Starting: 0', 'Running: 2', 'Restarting: 2', 'Stopping: 2']);
    });

    it('reads the holders at the moment of the clear, so a holder made during the stopped server\'s life is emptied too', () => {
      const holders: ProblemList[] = [];
      const turnover = createServerTurnover({ holders: () => holders, revalidate: () => undefined });
      const late = new ProblemList();
      holders.push(late);
      late.file({ file: '/ws/a.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'm', source: 'aggrega-build' }] });
      turnover.moved(DaemonState.Starting);
      assert.strictEqual(late.entries.size, 0);
    });

    it('validates the open documents each time the compiler becomes answerable, and clears nothing then', () => {
      const layer = new ProblemList();
      const { turnover, validations } = turnoverOver([layer]);
      layer.file({ file: '/ws/a.yaml', diagnostics: [{ line: 1, column: 1, severity: 'warning', message: 'm', source: 'aggrega' }] });
      turnover.answerable();
      turnover.answerable();
      assert.deepStrictEqual([validations(), layer.entries.size], [2, 1]);
    });
  });

  describe('over real server processes', () => {
    it('leaves none of a crashed server\'s findings once the server started in its place answers', async () => {
      const root = workspace([{ files: ['crashed.yaml'], dieAfterMs: 300 }, { files: ['respawned.yaml'] }]);
      const problems = new ProblemList();
      const { turnover } = turnoverOver([problems]);
      const daemon = client(turnover, problems);
      await daemon.start(root);
      await until('the first server\'s finding filed', () => problems.entries.size > 0);
      const before = problems.reading(root);
      await until('the respawned server running', () => starts(root) === 2 && daemon.getState() === DaemonState.Running);
      await settle();

      assert.deepStrictEqual(
        { before, after: problems.reading(root) },
        { before: ['crashed.yaml: said by server 0'], after: ['respawned.yaml: said by server 1'] },
      );
    });

    it('files nothing a crashed server\'s output carries after it ended, once the server started in its place runs', async () => {
      const root = workspace([{ files: ['crashed.yaml'], dieAfterMs: 100, lateFile: 'late.yaml' }, { files: ['respawned.yaml'] }]);
      const problems = new ProblemList();
      const { turnover } = turnoverOver([problems]);
      const daemon = client(turnover, problems);
      await daemon.start(root);
      const crashedOutputClosed = outputClosed(daemon);
      await until('the first server\'s finding filed', () => problems.entries.size > 0);
      const before = problems.reading(root);
      await until('the respawned server running with its finding filed', () => (
        starts(root) === 2 && daemon.getState() === DaemonState.Running
        && problems.reading(root).includes('respawned.yaml: said by server 1')
      ));
      // The late finding is written only once the respawned server exists, and the
      // crashed server's output closes only once it has been written, so after this
      // the client has been handed every byte that output carried.
      await until('the crashed server\'s output closed', crashedOutputClosed);

      assert.deepStrictEqual(
        { before, after: problems.reading(root) },
        { before: ['crashed.yaml: said by server 0'], after: ['respawned.yaml: said by server 1'] },
      );
    });

    it('leaves none of the previous workspace\'s findings after a move to another workspace', async () => {
      const left = workspace([{ files: ['left.yaml'] }]);
      const reached = workspace([{ files: ['reached.yaml'] }]);
      const problems = new ProblemList();
      const { turnover } = turnoverOver([problems]);
      // As a move does: the client at the workspace left is stopped, and a new one
      // is made and started at the workspace reached, over the same problem list.
      const first = client(turnover, problems);
      await first.start(left);
      await until('the first workspace\'s finding filed', () => problems.entries.size > 0);
      const before = [...problems.entries.keys()].map((f) => path.relative(os.tmpdir(), f));
      await first.stop();
      const second = client(turnover, problems);
      await second.start(reached);
      await settle();

      assert.deepStrictEqual(
        { before, after: [...problems.entries.keys()].map((f) => path.relative(os.tmpdir(), f)) },
        { before: [path.join(path.basename(left), 'left.yaml')], after: [path.join(path.basename(reached), 'reached.yaml')] },
      );
    });

    it('leaves none of the replaced server\'s findings after a restart', async () => {
      const root = workspace([{ files: ['replaced.yaml'] }, { files: ['restarted.yaml'] }]);
      const problems = new ProblemList();
      const { turnover } = turnoverOver([problems]);
      const daemon = client(turnover, problems);
      await daemon.start(root);
      await until('the first server\'s finding filed', () => problems.entries.size > 0);
      await daemon.restart();
      await settle();

      assert.deepStrictEqual(problems.reading(root), ['restarted.yaml: said by server 1']);
    });
  });

  describe('the extension hands the turnover what these cases hand it', () => {
    const EXTENSION = 'src/extension.ts';

    it('subscribes to the lifecycle once, and that one listener hands every position to the turnover', () => {
      const subscriptions = callArguments(EXTENSION, 'daemon.on').map((args) => args[0]);
      assert.deepStrictEqual(subscriptions, [
        "'stoppedResponding'",
        "'stateChange'",
        "'notification:aggrega/publishDiagnostics'",
      ]);
      const listener = callArguments(EXTENSION, 'daemon.on').find((args) => args[0] === "'stateChange'")![1];
      assert.ok(listener.startsWith('(next) =>'), `the lifecycle listener reads ${listener.slice(0, 40)}`);
      assert.ok(listener.includes('if (serverTurnover) { serverTurnover.moved(next); }'), 'the lifecycle listener does not hand its position to the turnover');
      assert.deepStrictEqual(callArguments(EXTENSION, 'serverTurnover.moved'), [['next']]);
    });

    it('hands the pushed findings to the problem list and nothing else', () => {
      const pushed = callArguments(EXTENSION, 'daemon.on').find((args) => args[0] === "'notification:aggrega/publishDiagnostics'")![1];
      assert.deepStrictEqual(callArguments(EXTENSION, 'publishDiagnostics').filter((args) => pushed.includes(`publishDiagnostics(${args.join(', ')})`)), [
        ['diagnosticCollections', 'uri', 'params.diagnostics ?? []'],
      ]);
    });

    it('builds the turnover over every layer and the conventions collection, and validates on every rising edge', () => {
      assert.deepStrictEqual(callArguments(EXTENSION, 'createServerTurnover'), [[
        '{ holders: () => [...(diagnosticCollections ? everyLayer(diagnosticCollections) : []), runner], revalidate: revalidateOpenDocuments, }',
      ]]);
      assert.deepStrictEqual(callArguments(EXTENSION, 'ready.onReady'), [
        ['() => { void configurationWatch.reload(); }'],
        ['() => { turnover.answerable(); }'],
      ]);
    });

    it('sweeps the open documents from one place, the sweep the turnover asks for', () => {
      const source = fs.readFileSync(path.join(EXTENSION_ROOT, EXTENSION), 'utf8');
      const sweeps = [...source.matchAll(/workspace\.textDocuments/g)].length;
      assert.deepStrictEqual(
        { sweeps, inTheOneHome: functionBody(EXTENSION, 'function revalidateOpenDocuments(').includes('vscode.workspace.textDocuments') },
        { sweeps: 1, inTheOneHome: true },
      );
    });
  });
});
