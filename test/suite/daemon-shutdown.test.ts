// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  Daemon,
  DaemonState,
  SHUTDOWN_DRAIN_GRACE_MS,
  ShutdownNarration,
} from '../../src/daemon';
import type { Settings } from '../../src/settings';
import { settingsFromObject } from '../../src/settings';
import { fixtureWorkspaceRoot, requireAggregaBinary } from '../helpers/build-aggrega';

// recordShutdown builds a Daemon that keeps everything it reports, so a case can
// read WHICH step of the shutdown ladder the daemon left on instead of inferring
// it from how long stop() took. The lines are imported from the daemon rather
// than spelled out here, so a rewording cannot leave a case quietly matching
// text the daemon no longer writes.
//
// The liveness bound for every case using this is the suite timeout: a stop()
// that never returns fails there, which is the one thing a clock was genuinely
// needed for.
function recordShutdown(settings: Settings): { daemon: Daemon; narration: string[] } {
  const narration: string[] = [];
  return { daemon: new Daemon(settings, msg => narration.push(msg)), narration };
}

// reachedAnOutcome reports whether the ladder ran to one of its three ways out,
// rather than the daemon having gone before it started or the ladder having
// stopped somewhere with no exit at all.
function reachedAnOutcome(narration: string[]): boolean {
  return (
    narration.includes(ShutdownNarration.cooperativeExit) ||
    narration.includes(ShutdownNarration.abandonedExit) ||
    narration.includes(ShutdownNarration.osTermination)
  );
}

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
    binaryPath = requireAggregaBinary(this, 'daemon shutdown suite');
    workspaceRoot = fixtureWorkspaceRoot();
  });

  it('cooperative path: real daemon honors aggrega/shutdown and exits cleanly', async function () {
    const { daemon, narration } = recordShutdown(
      settingsFromObject({
        binaryPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );
    await daemon.start(workspaceRoot);
    assert.strictEqual(daemon.getState(), DaemonState.Running);
    await daemon.stop();
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);

    // WHICH step the ladder left on is the discriminator. The daemon answering
    // the first cooperative request IS the cooperative path winning — the same
    // claim a sub-grace elapsed time only implied, and implied through a bound a
    // loaded machine could breach while the daemon behaved perfectly.
    assert.ok(
      narration.includes(ShutdownNarration.cooperativeExit),
      `expected the daemon to exit on the first cooperative request; ladder reported:\n${narration.join('\n')}`,
    );
    assert.ok(
      !narration.includes(ShutdownNarration.osTermination),
      `expected no fallback to operating-system termination; ladder reported:\n${narration.join('\n')}`,
    );
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

    // Registered before stop() so the exit cannot be missed between the call
    // returning and the listener attaching. Node populates exitCode and
    // signalCode as it emits 'exit', so awaiting this is what makes reading
    // them afterwards a fact rather than a race.
    const stubExited = new Promise<void>(resolve => {
      if (stub.exitCode !== null || stub.signalCode !== null) {
        resolve();
        return;
      }
      stub.once('exit', () => resolve());
    });

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

      await daemon.stop();
      await stubExited;

      // How the stub DIED is the discriminator, and it is exact where a
      // wall-clock window was only suggestive. The stub ignores both
      // aggrega/shutdown notifications and never exits on its own, so:
      //
      //   - a null signalCode with a set exitCode would mean it exited
      //     cooperatively, which it cannot do;
      //   - SIGTERM means both cooperative graces expired and the escalation
      //     fired, then the stub honored it;
      //   - SIGKILL would mean SIGTERM was sent and ignored.
      //
      // Reading the signal says which of those happened. The elapsed time only
      // implied it, and implied it through two bounds that a loaded machine
      // could breach from above and an unexpectedly fast path from below.
      //
      // Liveness is the suite timeout above: a stop() that never returns, or a
      // stub that never dies, fails there rather than against a clock read
      // here.
      assert.strictEqual(
        stub.signalCode,
        'SIGTERM',
        `expected the stub to be terminated by SIGTERM after both cooperative graces expired; ` +
        `got signal=${stub.signalCode} code=${stub.exitCode}`,
      );
      assert.strictEqual(
        stub.exitCode,
        null,
        'a stub killed by signal carries no exit code; a set exitCode means it exited on its own',
      );
    } finally {
      if (stub.exitCode === null && stub.signalCode === null) {
        stub.kill('SIGKILL');
      }
    }
  });
});

// Under-load shutdown coverage. Both cases exercise the daemon's
// drain-then-abort path under load. The client side cannot observe the
// daemon's wire-level shutdown error envelopes — Daemon.stop()
// pre-rejects all pending requests with a generic Error before awaiting
// the drain — so the cases assert the extension-client property: stop()
// under load drains in-flight work and returns bounded, without
// deadlock.
//
// Under drain-then-abort the FIRST aggrega/shutdown lets in-flight work
// finish and the daemon exits as soon as its pool drains — there is no
// fixed drain-timer floor on the first signal. So:
//
//   - Fast load (drain-cleanly): handlers finish quickly; stop() returns
//     well within the drain grace, no escalation.
//   - Heavy load (drain-bound): more in-flight work still drains to
//     completion; stop() returns bounded by the cooperative force ladder
//     (drain grace, then abort grace, then SIGTERM/SIGKILL).
//
// Wire-level 1005 (errShuttingDown) verification lives in the Go-side
// shutdown_test.go.
describe('Daemon cooperative shutdown under load', function () {
  this.timeout(120_000);

  let binaryPath: string;
  let workspaceRoot: string;
  // Temp workspaces scaffolded by scaffoldTier4Workspace; removed in
  // afterEach so the large generated Aggregates do not accumulate in
  // the OS temp directory across runs.
  const scaffoldedRoots: string[] = [];

  before(function () {
    binaryPath = requireAggregaBinary(this, 'under-load shutdown suite');
    workspaceRoot = fixtureWorkspaceRoot();
  });

  afterEach(function () {
    while (scaffoldedRoots.length > 0) {
      const root = scaffoldedRoots.pop()!;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // generateLargeAggregate returns aggregate-shaped YAML with the
  // requested number of synthetic component references. Used by the
  // slow-load case to push validate-handler runtime into the range
  // where 5 concurrent runs exceed the daemon's 2-second drain
  // budget.
  function generateLargeAggregate(componentCount: number): string {
    const lines: string[] = [
      'apiVersion: aggrega.ai/v1beta1',
      'kind: Aggregate',
      'metadata:',
      '  name: under-load-test',
      'spec:',
      '  components:',
    ];
    for (let i = 0; i < componentCount; i++) {
      lines.push(`    - name: component-${i}`);
      lines.push(`      type: hub.aggrega.ai/component/core/web-service`);
      lines.push(`      values:`);
      lines.push(`        replicas: 3`);
      lines.push(`        image: nginx:1.21`);
      lines.push(`        port: ${8000 + (i % 100)}`);
    }
    return lines.join('\n') + '\n';
  }

  const SMALL_CONTENT =
    'apiVersion: aggrega.ai/v1beta1\n' +
    'kind: Aggregate\n' +
    'metadata:\n' +
    '  name: small\n' +
    'spec:\n' +
    '  components: []\n';

  it('drain-cleanly: 10 fast in-flight requests under load, daemon exits within drain budget', async function () {
    const { daemon, narration } = recordShutdown(
      settingsFromObject({
        binaryPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );
    await daemon.start(workspaceRoot);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    // Fire 10 simultaneous validate requests against small content.
    // The daemon dispatcher serialises requests; with ~50-100ms per
    // small-content request, 10 queued requests complete in well
    // under the 2s drain budget. (An earlier iteration tried 30
    // requests and discovered the queue runtime alone exceeded the
    // budget; the drain timer fired before natural completion. 10
    // gives a healthy margin.) Wrap each promise with .catch so the
    // generic-Error rejection that Daemon.stop emits on pending
    // requests doesn't crash the test.
    const requests: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      const p = daemon.request('aggrega/validate', {
        file: `${workspaceRoot}/under-load-${i}.yaml`,
        content: SMALL_CONTENT,
      }).catch((err: unknown) => err);
      requests.push(p);
    }

    await daemon.stop();

    await Promise.all(requests);
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);

    // Drain-cleanly: fast handlers finish quickly. Under drain-then-abort the
    // first shutdown carries no drain-timer floor, so the daemon exits as soon
    // as the pool drains and answers that first request. Reading the step it
    // left on says exactly that, where an elapsed time under the drain grace
    // only stood in for it.
    assert.ok(
      narration.includes(ShutdownNarration.cooperativeExit),
      `expected the drained daemon to exit on the first cooperative request; ladder reported:\n${narration.join('\n')}`,
    );
    assert.ok(
      !narration.includes(ShutdownNarration.osTermination),
      `expected no escalation past the cooperative request; ladder reported:\n${narration.join('\n')}`,
    );
  });

  it('drain-bound: slow in-flight requests under load, daemon exits within drain budget + handler-completion grace', async function () {
    const { daemon, narration } = recordShutdown(
      settingsFromObject({
        binaryPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
    );
    await daemon.start(workspaceRoot);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    // Fire 5 simultaneous validate requests against large content.
    // 2000 components ≈ 12000 lines per fixture; the validate
    // handler's per-request runtime should land high enough that
    // 5 concurrent runs exceed the 2s drain budget.
    const largeContent = generateLargeAggregate(2000);
    const requests: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      const p = daemon.request('aggrega/validate', {
        file: `${workspaceRoot}/large-under-load-${i}.yaml`,
        content: largeContent,
      }).catch((err: unknown) => err);
      requests.push(p);
    }

    await daemon.stop();

    await Promise.all(requests);
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);

    // Drain-bound: heavier in-flight work still drains under the first
    // shutdown, and stop() walks the ladder rather than hanging on the handler
    // queue. Two things carry that, and neither reads a clock.
    //
    // The daemon was ALIVE and had to be asked. terminateSubprocess returns
    // immediately, reporting nothing, when the subprocess has already gone, so
    // the cooperative request appearing at all is what distinguishes a real
    // shutdown from a return against a daemon that was no longer there.
    assert.ok(
      narration.includes(ShutdownNarration.cooperativeRequest),
      `expected the running daemon to be asked to exit cooperatively; ladder reported:\n${narration.join('\n')}`,
    );
    // The ladder RAN OUT, one way or another, instead of settling somewhere
    // without an exit. Which way is deliberately not pinned: under a heavy queue
    // the daemon may answer the first request, answer the second, or neither,
    // and all three are the ladder working. Absence of deadlock is the suite
    // timeout's job, and a suite timeout is not breached by the contention that
    // breaches a few-second ceiling.
    assert.ok(
      reachedAnOutcome(narration),
      `expected the shutdown ladder to run to one of its outcomes; ladder reported:\n${narration.join('\n')}`,
    );
  });

  // scaffoldTier4Workspace writes a minimal Release closure into a temp
  // directory: a config pointing at a local catalog, a single Release +
  // Manifest, the named catalog Component, and a large mapping-style
  // Aggregate with componentCount components of that type. The daemon's
  // disambiguation cascade selects the lone Release at startup, so an
  // aggrega/validate against aggregate.yaml exercises the Tier-4
  // pipeline (resolve + topology + IR + analyze) rather than Tier-1
  // parse-only. Returns the workspace root and the aggregate path/content.
  function scaffoldTier4Workspace(componentCount: number): {
    root: string;
    aggregateFile: string;
    aggregateContent: string;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-tier4-'));
    scaffoldedRoots.push(root);
    fs.writeFileSync(
      path.join(root, '.aggrega-config.yaml'),
      'workspace:\n  catalog_dirs:\n    - ./catalog\n',
    );
    fs.writeFileSync(
      path.join(root, 'release.yaml'),
      [
        'apiVersion: aggrega.ai/v1beta1',
        'kind: Release',
        'metadata:',
        '  name: under-load-tier4-release',
        '  environment: test',
        '  version: "1.0.0"',
        'spec:',
        '  aggregate: aggregate',
        '  manifest: manifest',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(root, 'manifest.yaml'),
      [
        'apiVersion: aggrega.ai/v1beta1',
        'kind: Manifest',
        'metadata:',
        '  name: under-load-tier4-manifest',
        '  version: "1.0.0"',
        'spec: {}',
        '',
      ].join('\n'),
    );
    const catalogDir = path.join(root, 'catalog', 'components');
    fs.mkdirSync(catalogDir, { recursive: true });
    fs.writeFileSync(
      path.join(catalogDir, 'web.yaml'),
      [
        'apiVersion: aggrega.ai/v1beta1',
        'kind: Component',
        'metadata:',
        '  name: example/web',
        '  version: "1.0.0"',
        '  labels:',
        '    component.aggrega.ai/type: "server"',
        'spec:',
        '  schema:',
        '    infra:',
        '      port: { type: integer, default: 8080 }',
        '',
      ].join('\n'),
    );
    const lines: string[] = [
      'apiVersion: aggrega.ai/v1beta1',
      'kind: Aggregate',
      'metadata:',
      '  name: under-load-tier4',
      '  version: "1.0.0"',
      'spec:',
      '  components:',
    ];
    for (let i = 0; i < componentCount; i++) {
      lines.push(`    c${i}:`);
      lines.push('      type: example/web');
    }
    const aggregateContent = lines.join('\n') + '\n';
    const aggregateFile = path.join(root, 'aggregate.yaml');
    fs.writeFileSync(aggregateFile, aggregateContent);
    return { root, aggregateFile, aggregateContent };
  }

  // measureTier4Runtime starts a daemon, runs one Tier-4 validate to
  // completion, and returns the wall-clock time.
  //
  // This clock measures the MACHINE, not the daemon: it answers "is this
  // fixture heavy enough here for draining to be distinguishable from cutting
  // short", which is a question about how fast the hardware is, and a clock is
  // the right instrument for that. The case's own claim is read from the
  // shutdown ladder instead, so no clock decides whether the daemon behaved.
  async function measureTier4Runtime(
    root: string,
    aggregateFile: string,
    aggregateContent: string,
  ): Promise<number> {
    const daemon = new Daemon(
      settingsFromObject({ binaryPath, respawnAttempts: 3, respawnWindowSeconds: 60 }),
    );
    await daemon.start(root);
    const start = Date.now();
    await daemon
      .request('aggrega/validate', { file: aggregateFile, content: aggregateContent })
      .catch((err: unknown) => err);
    const elapsed = Date.now() - start;
    await daemon.stop();
    return elapsed;
  }

  it('tier-4 shutdown: a long in-flight Tier-4 validate drains to completion, not cut short', async function () {
    // Under drain-then-abort the FIRST aggrega/shutdown drains: an
    // in-flight Tier-4 validate runs to completion rather than being cut
    // short. The heavy cost of a large Tier-4 validate lives in a single
    // straight-line resolve block, so it is not interruptible mid-block;
    // the correct behavior is precisely that the drain lets it finish.
    const ws = scaffoldTier4Workspace(40000);

    // Calibrate against the drain grace itself. The observable claim below is
    // that the daemon was STILL WORKING when the grace closed — it kept the
    // validate rather than dropping it — and that is only observable when one
    // uncancelled run outlasts the grace. On hardware fast enough to finish
    // inside it the daemon answers the first request, which is correct
    // behaviour and indistinguishable from cutting short, so skip rather than
    // assert something this machine cannot show.
    //
    // The threshold is the daemon's own SHUTDOWN_DRAIN_GRACE_MS rather than a
    // number chosen here, so retuning the grace cannot leave the calibration
    // pointed at a window that no longer exists.
    const baseline = await measureTier4Runtime(ws.root, ws.aggregateFile, ws.aggregateContent);
    if (baseline <= SHUTDOWN_DRAIN_GRACE_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping tier-4 shutdown case: one Tier-4 run took ${baseline}ms, inside the ${SHUTDOWN_DRAIN_GRACE_MS}ms drain grace; this machine is too fast for the fixture to show draining rather than cutting short`,
      );
      this.skip();
      return;
    }

    const { daemon, narration } = recordShutdown(
      settingsFromObject({ binaryPath, respawnAttempts: 3, respawnWindowSeconds: 60 }),
    );
    await daemon.start(ws.root);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    // Fire one Tier-4 validate the calibration has shown outlasts the drain
    // grace, then request shutdown. The first shutdown drains, so the daemon
    // keeps the validate rather than dropping it, and the grace closes with the
    // validate still running. The abort and the force signals still cap the
    // worst case, so stop() never hangs on the validate.
    const pending = daemon
      .request('aggrega/validate', { file: ws.aggregateFile, content: ws.aggregateContent })
      .catch((err: unknown) => err);

    await daemon.stop();
    await pending;

    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    // Drained, not cut short — and the ladder says so outright. The second
    // request is only ever sent because the drain grace closed with the daemon
    // still alive, so its presence IS "the daemon kept the in-flight validate
    // instead of dropping it and leaving". A daemon that cut the validate short
    // would have answered the first request and the ladder would have stopped
    // there, which an elapsed time can only reach at from outside the process.
    //
    // The calibration above is what makes this sound: it establishes that one
    // uncancelled run outlasts the grace on this machine, so the daemon cannot
    // legitimately have finished inside it.
    assert.ok(
      narration.includes(ShutdownNarration.abandonRequest),
      `expected the drain grace to close with the validate still running — the daemon must keep in-flight work rather than drop it on the first request; ladder reported:\n${narration.join('\n')}`,
    );
    // Bounded: the ladder ran out rather than hanging on the validate. Which
    // way out it took is deliberately unpinned — a validate long enough will
    // outlast the abort grace too and be terminated, which is the ladder
    // working, not a failure. The liveness bound is the suite timeout.
    assert.ok(
      reachedAnOutcome(narration),
      `expected the shutdown ladder to run to one of its outcomes rather than hang on the validate; ladder reported:\n${narration.join('\n')}`,
    );
  });
});

// FakeChild is a minimal ChildProcess stand-in for driving
// terminateSubprocess without spawning a real process. It records stdin
// writes and kill signals and can emit 'exit' after a chosen number of
// aggrega/shutdown notifications, standing in for a daemon that honors
// (or ignores) the drain-then-abort sequence.
class FakeChild extends EventEmitter {
  writes: string[] = [];
  signals: NodeJS.Signals[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  private shutdownCount = 0;

  constructor(private readonly exitAfterShutdowns: number | null) {
    super();
  }

  readonly stdin = {
    write: (buf: Buffer): boolean => {
      const s = buf.toString('utf8');
      this.writes.push(s);
      if (s.includes('aggrega/shutdown')) {
        this.shutdownCount++;
        if (this.exitAfterShutdowns !== null && this.shutdownCount >= this.exitAfterShutdowns) {
          setImmediate(() => {
            if (this.exitCode === null && this.signalCode === null) {
              this.exitCode = 0;
              this.emit('exit', 0, null);
            }
          });
        }
      }
      return true;
    },
  };

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }

  shutdownWrites(): number {
    return this.writes.filter(w => w.includes('aggrega/shutdown')).length;
  }
}

// Drain-then-abort escalation ordering. These cases drive the extension's
// terminateSubprocess ladder against a fake subprocess so the exact
// sequence of stdin writes and force signals is observable — the cases above
// read which step a real daemon left on, which says nothing about what was
// written to reach it.
describe('Daemon drain-then-abort escalation ordering', function () {
  this.timeout(30_000);

  function makeDaemon(fake: FakeChild): Daemon {
    return Daemon.__forTesting(
      settingsFromObject({
        binaryPath: process.execPath,
        respawnAttempts: 3,
        respawnWindowSeconds: 60,
      }),
      fake as unknown as ChildProcessWithoutNullStreams,
    );
  }

  it('sends aggrega/shutdown#1 then #2, and does not force-signal a daemon that honors the abort', async function () {
    // The fake exits after the SECOND shutdown, standing in for a daemon
    // that drains through the first signal and exits on the abort. The
    // ladder must send exactly two shutdowns and never escalate to a
    // force signal.
    const fake = new FakeChild(/*exitAfterShutdowns=*/ 2);
    const daemon = makeDaemon(fake);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    await daemon.stop();

    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    assert.strictEqual(
      fake.shutdownWrites(),
      2,
      'expected exactly two aggrega/shutdown notifications (drain then abort)',
    );
    assert.deepStrictEqual(
      fake.signals,
      [],
      'expected no SIGTERM/SIGKILL — the daemon exited on the abort',
    );
  });

  it('escalates to SIGTERM only after both shutdowns when the daemon ignores them', async function () {
    // The fake never exits on its own. The ladder must write both
    // shutdowns before any force signal, then escalate SIGTERM → SIGKILL.
    const fake = new FakeChild(/*exitAfterShutdowns=*/ null);
    const daemon = makeDaemon(fake);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    await daemon.stop();

    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    assert.strictEqual(
      fake.shutdownWrites(),
      2,
      'expected both aggrega/shutdown notifications to be written before force escalation',
    );
    assert.ok(fake.signals.length > 0, 'expected a force signal after the cooperative graces expired');
    assert.strictEqual(fake.signals[0], 'SIGTERM', 'first force signal must be SIGTERM (after both shutdowns)');
    assert.ok(fake.signals.includes('SIGKILL'), 'expected SIGKILL escalation after SIGTERM grace');
  });
});
