// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
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

      // The stub ignores both aggrega/shutdown notifications, so both
      // cooperative graces (drain ~3s, then abort ~2.5s) must expire
      // before SIGTERM fires; the stub then exits immediately on SIGTERM
      // (POSIX). Total elapsed ≈ 3 + 2.5 + sub-second SIGTERM grace.
      // Bound: 5s ≤ elapsed < 8s.
      assert.ok(
        elapsed >= 5000,
        `falls-through path exited too quickly (${elapsed}ms); both cooperative graces should have expired`,
      );
      assert.ok(
        elapsed < 8000,
        `falls-through path exceeded grace window (${elapsed}ms); SIGTERM/SIGKILL escalation should have fired`,
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
    try {
      binaryPath = ensureAggregaBinary();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping under-load shutdown suite: ${(err as Error).message}`);
      this.skip();
    }
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
      'apiVersion: aggrega.ai/v1alpha1',
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
    'apiVersion: aggrega.ai/v1alpha1\n' +
    'kind: Aggregate\n' +
    'metadata:\n' +
    '  name: small\n' +
    'spec:\n' +
    '  components: []\n';

  it('drain-cleanly: 10 fast in-flight requests under load, daemon exits within drain budget', async function () {
    const daemon = new Daemon(
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

    const start = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - start;

    await Promise.all(requests);
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);

    // Drain-cleanly: fast handlers finish quickly. Under drain-then-abort
    // the first shutdown carries no drain-timer floor, so the daemon exits
    // as soon as the pool drains — well within the drain grace and with no
    // SIGTERM escalation. The 3000ms bound is the drain grace; a clean
    // drain returns comfortably under it.
    assert.ok(
      elapsed < 3000,
      `drain-cleanly took ${elapsed}ms; expected < 3000ms (within the drain grace, no escalation)`,
    );
  });

  it('drain-bound: slow in-flight requests under load, daemon exits within drain budget + handler-completion grace', async function () {
    const daemon = new Daemon(
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

    const start = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - start;

    await Promise.all(requests);
    assert.strictEqual(daemon.getState(), DaemonState.Stopped);

    // Drain-bound: heavier in-flight work still drains to completion
    // under the first shutdown. stop() returns bounded by the cooperative
    // force ladder — drain grace (~3s), then abort grace (~2.5s), then
    // SIGTERM/SIGKILL — never hanging on the full handler queue. Upper
    // bound (8000ms) is that worst-case ladder plus margin; the small
    // lower bound proves real drain work occurred rather than an instant
    // exit.
    assert.ok(
      elapsed >= 200,
      `drain-bound completed implausibly fast (${elapsed}ms); expected the heavy load to take real drain time`,
    );
    assert.ok(
      elapsed < 8000,
      `drain-bound took ${elapsed}ms; expected < 8000ms (bounded by the cooperative force ladder, no deadlock)`,
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
        'apiVersion: aggrega.ai/v1alpha1',
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
        'apiVersion: aggrega.ai/v1alpha1',
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
        'apiVersion: aggrega.ai/v1alpha1',
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
      'apiVersion: aggrega.ai/v1alpha1',
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
  // completion, and returns the wall-clock time. Used to decide whether
  // the fixture is heavy enough on this machine to exercise mid-pipeline
  // cancellation (the run must exceed the drain budget, else cancellation
  // is untestable here and the cancellation assertion would be vacuous).
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
    // This is the inverse of the previously-expected cut-short bound.
    const ws = scaffoldTier4Workspace(40000);

    // Calibrate: the drain-to-completion property is only observable when
    // one uncancelled Tier-4 run takes meaningfully longer than the old
    // cut-short budget. On hardware fast enough to finish near-instantly,
    // "drained, not cut short" is indistinguishable — skip rather than
    // assert vacuously.
    const baseline = await measureTier4Runtime(ws.root, ws.aggregateFile, ws.aggregateContent);
    if (baseline <= 2500) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping tier-4 shutdown case: single Tier-4 run took ${baseline}ms (<=2500ms); fixture too fast on this machine to distinguish drain-to-completion`,
      );
      this.skip();
      return;
    }

    const daemon = new Daemon(
      settingsFromObject({ binaryPath, respawnAttempts: 3, respawnWindowSeconds: 60 }),
    );
    await daemon.start(ws.root);
    assert.strictEqual(daemon.getState(), DaemonState.Running);

    // Fire one Tier-4 validate (~baseline ms, > 2500ms), then request
    // shutdown. The first shutdown drains, so the daemon lets the validate
    // finish and exits when it does — stop() lands near baseline, NOT cut
    // short to the old sub-budget bound. The abort (second shutdown) and
    // SIGTERM/SIGKILL force still cap the worst case, so stop() never
    // hangs beyond the cooperative ladder.
    const pending = daemon
      .request('aggrega/validate', { file: ws.aggregateFile, content: ws.aggregateContent })
      .catch((err: unknown) => err);

    const start = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - start;
    await pending;

    assert.strictEqual(daemon.getState(), DaemonState.Stopped);
    // Drained, not cut short: the in-flight validate ran past the old
    // cut-short budget rather than being aborted under it.
    assert.ok(
      elapsed > 2500,
      `tier-4 shutdown took ${elapsed}ms; expected > 2500ms — the first shutdown must drain the in-flight validate to completion, not cut it short`,
    );
    // Bounded by the cooperative force ladder plus a margin.
    assert.ok(
      elapsed < baseline + 8000,
      `tier-4 shutdown took ${elapsed}ms; expected < ${baseline + 8000}ms — bounded by the cooperative force ladder`,
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
// sequence of stdin writes and force signals is observable — coverage the
// real-daemon timing tests above cannot provide.
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
