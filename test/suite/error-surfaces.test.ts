// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { ConvertedShape } from '../../src/diagnostics-shape';
import { handleDaemonError, resetSessionDedup } from '../../src/error-surfaces';
import {
  ERR_ENTITY_NOT_RESOLVABLE,
  ERR_FILE_NOT_VALIDATED,
  ERR_LOCKFILE_ABSENT,
  ERR_RELEASE_NOT_RESOLVED,
  ERR_SHUTTING_DOWN,
} from '../../src/types';

interface FakeUri {
  toString(): string;
}

interface FakeTerminal {
  shown: boolean;
  sentText: string[];
  show: () => void;
  sendText: (text: string, addNewline?: boolean) => void;
}

interface ContextFixture {
  uri: FakeUri;
  publishCalls: Array<{ uri: FakeUri; shapes: ConvertedShape[] }>;
  logLines: string[];
  toastCalls: Array<{ message: string; items: string[] }>;
  toastResponse: string | undefined;
  terminalsCreated: Array<{ options: { name: string; cwd: string }; terminal: FakeTerminal }>;
  commandsExecuted: string[];
  hasCandidateReleases: boolean;
  lockfileRelease: string | undefined;
  // resolveReleaseCalls counts consultations of the interactive resolver. The
  // lockfile-absent handler must not consult it when the error envelope already
  // names the Release, so the count is the assertion that the envelope wins
  // rather than merely agreeing.
  resolveReleaseCalls: number;
  toastDebounce: Map<number, true | number>;
  toastDebounceMode: 'time' | 'session';
  toastThrottleSeconds: number;
  currentTime: number;
}

function makeContext(initial?: Partial<ContextFixture>): ContextFixture & {
  ctx: Parameters<typeof handleDaemonError>[1];
} {
  const fixture: ContextFixture = {
    uri: { toString: () => 'file:///workspace/a.yaml' },
    publishCalls: [],
    logLines: [],
    toastCalls: [],
    toastResponse: undefined,
    terminalsCreated: [],
    commandsExecuted: [],
    hasCandidateReleases: false,
    lockfileRelease: 'release.yaml',
    resolveReleaseCalls: 0,
    toastDebounce: new Map(),
    toastDebounceMode: 'session',
    toastThrottleSeconds: 300,
    currentTime: 0,
    ...initial,
  };
  const ctx = {
    uri: fixture.uri as any,
    workspaceRoot: '/workspace',
    publishShape: (uri: any, shapes: ConvertedShape[]) => {
      fixture.publishCalls.push({ uri, shapes });
    },
    logLine: (line: string) => { fixture.logLines.push(line); },
    toastInfo: (message: string, ...items: string[]) => {
      fixture.toastCalls.push({ message, items });
      return Promise.resolve(fixture.toastResponse);
    },
    createTerminal: (options: any) => {
      const terminal: FakeTerminal = {
        shown: false,
        sentText: [],
        show: () => { terminal.shown = true; },
        sendText: (text: string) => { terminal.sentText.push(text); },
      };
      fixture.terminalsCreated.push({ options, terminal });
      return terminal as any;
    },
    executeCommand: (command: string) => {
      fixture.commandsExecuted.push(command);
      return Promise.resolve(undefined);
    },
    scanCandidateReleases: () => Promise.resolve(fixture.hasCandidateReleases),
    resolveRelease: () => {
      fixture.resolveReleaseCalls += 1;
      return Promise.resolve(fixture.lockfileRelease);
    },
    toastDebounce: fixture.toastDebounce,
    toastDebounceMode: fixture.toastDebounceMode,
    toastThrottleSeconds: fixture.toastThrottleSeconds,
    now: () => fixture.currentTime,
  };
  return Object.assign(fixture, { ctx });
}

describe('handleDaemonError', () => {
  it('returns false for unknown codes', () => {
    const f = makeContext();
    const handled = handleDaemonError({ code: 9999, message: 'unknown' }, f.ctx);
    assert.strictEqual(handled, false);
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.toastCalls.length, 0);
  });

  it('returns false for 1001 (cache-miss path is owned by extension.ts)', () => {
    const f = makeContext();
    const handled = handleDaemonError({ code: ERR_FILE_NOT_VALIDATED, message: 'cold' }, f.ctx);
    assert.strictEqual(handled, false);
  });

  it('1002 logs the cascade trace to OutputChannel and fires a toast', async () => {
    const f = makeContext({ hasCandidateReleases: false });
    const handled = handleDaemonError(
      {
        code: ERR_RELEASE_NOT_RESOLVED,
        message: 'release not resolved; no authoring_release configured',
        data: {
          cascade_attempt: 'Aggrega: release-not-resolved cascade trace\n  step 1: not configured\n  step 2: zero Release files',
        },
      },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    // Drain microtasks so the toast promise + dispatch settles.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // OutputChannel auto-log fires every receipt — short summary
    // plus each line of the cascade_attempt trace.
    assert.ok(
      f.logLines.some(l => l.includes('[release not resolved]') && l.includes('no authoring_release configured')),
      `expected summary log line; got ${JSON.stringify(f.logLines)}`,
    );
    assert.ok(
      f.logLines.some(l => l.includes('step 1: not configured')),
      `expected cascade trace line; got ${JSON.stringify(f.logLines)}`,
    );
    assert.ok(
      f.logLines.some(l => l.includes('step 2: zero Release files')),
      `expected cascade trace line; got ${JSON.stringify(f.logLines)}`,
    );
    // No Problems-panel diagnostic — 1002 is now a toast surface.
    assert.strictEqual(f.publishCalls.length, 0);
    // One toast with one button (no candidate Releases).
    assert.strictEqual(f.toastCalls.length, 1);
    assert.deepStrictEqual(f.toastCalls[0].items, ['Set authoring_release in config…']);
    assert.ok(f.toastCalls[0].message.includes('release not resolved'));
  });

  it('1002 toast offers both buttons when candidate Releases exist', async () => {
    const f = makeContext({ hasCandidateReleases: true });
    handleDaemonError(
      {
        code: ERR_RELEASE_NOT_RESOLVED,
        message: 'release not resolved; 3 candidates with no marker',
        data: { cascade_attempt: 'trace line\n' },
      },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(f.toastCalls.length, 1);
    assert.deepStrictEqual(f.toastCalls[0].items, [
      'Set authoring_release in config…',
      'Use marker file…',
    ]);
  });

  it('1002 toast click on "Set authoring_release in config…" dispatches the matching command', async () => {
    const f = makeContext({
      hasCandidateReleases: false,
      toastResponse: 'Set authoring_release in config…',
    });
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'release not resolved' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepStrictEqual(f.commandsExecuted, ['aggrega.workspace.openAuthoringReleaseConfig']);
  });

  it('1002 toast click on "Use marker file…" dispatches the matching command', async () => {
    const f = makeContext({
      hasCandidateReleases: true,
      toastResponse: 'Use marker file…',
    });
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'release not resolved' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepStrictEqual(f.commandsExecuted, ['aggrega.workspace.createActiveReleaseMarker']);
  });

  it('1002 toast dismissal does not dispatch any command', async () => {
    const f = makeContext({
      hasCandidateReleases: true,
      toastResponse: undefined,
    });
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'release not resolved' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepStrictEqual(f.commandsExecuted, []);
  });

  it('1002 second emission is suppressed by debounce; still auto-logs', async () => {
    const f = makeContext({ hasCandidateReleases: false });
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'first' },
      f.ctx,
    );
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'second' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Toast fires once (session-mode debounce).
    assert.strictEqual(f.toastCalls.length, 1);
    // OutputChannel auto-log fires both times (unconditional).
    assert.ok(
      f.logLines.filter(l => l.includes('[release not resolved]')).length >= 2,
      `expected at least 2 log lines, got: ${JSON.stringify(f.logLines)}`,
    );
  });

  it('1002 time-mode debounce: second emission during in-flight toast is suppressed (overlap window)', async () => {
    // Pins the seed-at-emission fix. Without seeding the time-mode
    // debounce synchronously on the first emission, a second
    // emission arriving BEFORE the first toast's Promise resolves
    // would find debounce[1002] === undefined, pass shouldFireToast,
    // and fire a second toast on top of the first. The seed sets
    // debounce[1002] = now() at emission so the in-flight window
    // is protected; the seed is updated to the dismissal timestamp
    // when the Promise resolves.
    const f = makeContext({
      hasCandidateReleases: false,
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });

    // First emission — kicks off the async toast chain. We
    // INTENTIONALLY do NOT drain microtasks before the second
    // emission, simulating two daemon emissions arriving in
    // rapid succession (before the user has dismissed anything).
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'first' },
      f.ctx,
    );
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'second' },
      f.ctx,
    );

    // Now drain microtasks; both toast chains complete (or the
    // second is suppressed before reaching toastInfo).
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Only ONE toast must have surfaced — the second emission
    // hit the seeded debounce and was suppressed.
    assert.strictEqual(f.toastCalls.length, 1,
      'overlapping emission must not fire a second toast; got toast count ' + f.toastCalls.length);
  });

  it('1002 time-mode debounce: throttle starts when toast resolves; re-fires after window expires', async () => {
    const f = makeContext({
      hasCandidateReleases: false,
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });

    // First emission fires the toast.
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'first' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 1, 'first emission should fire toast');

    // Second emission within the throttle window — suppressed.
    f.currentTime = 1_000_000 + 30 * 1000;
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'second' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 1, 'within throttle should suppress');

    // Past expiry — toast re-fires.
    f.currentTime = 1_000_000 + 90 * 1000;
    handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'third' },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 2, 'past throttle expiry should re-fire');
  });

  it('1004 publishes an Error diagnostic with the unresolvable-entity message', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'oci://hub/foo not found' },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(f.publishCalls.length, 1);
    const shape = f.publishCalls[0].shapes[0];
    assert.ok(shape.message.includes('oci://hub/foo not found'));
    assert.strictEqual(f.toastCalls.length, 0);
  });

  it('1004 with full data positions the diagnostic at the daemon-reported line/column (1-based → 0-based)', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'release.yaml load failed',
        data: { file: '/workspace/release.yaml', line: 12, column: 7 },
      },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(f.publishCalls.length, 1);
    const shape = f.publishCalls[0].shapes[0];
    // 1-based daemon → 0-based VS Code.
    assert.strictEqual(shape.startLine, 11);
    assert.strictEqual(shape.startChar, 6);
    assert.strictEqual(shape.endLine, 11);
    assert.strictEqual(shape.endChar, 6);
  });

  it('1004 with end_line/end_column spans a wide range', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'aggregate.yaml extends unresolved',
        data: { file: '/workspace/aggregate.yaml', line: 7, column: 16, end_line: 7, end_column: 40 },
      },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 6);
    assert.strictEqual(shape.startChar, 15);
    assert.strictEqual(shape.endLine, 6);
    assert.strictEqual(shape.endChar, 39);
  });

  it('1004 with file-only data falls back to file:1:1 (start of file)', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'release.yaml load failed',
        data: { file: '/workspace/release.yaml' },
      },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('1004 with no data field at all falls back to file:1:1', () => {
    const f = makeContext();
    // Envelope shape from a daemon predating the structured data
    // field — backward-compat path. No data field at all.
    const handled = handleDaemonError(
      { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'release.yaml load failed' },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('1003 shows a toast with Generate Lockfile button on first call', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(f.toastCalls.length, 1);
    assert.deepStrictEqual(f.toastCalls[0].items, ['Generate Lockfile']);
    assert.ok(f.toastCalls[0].message.includes('lockfile missing'));
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.toastDebounce.has(ERR_LOCKFILE_ABSENT), true);
  });

  it('1003 second call is suppressed by session dedup, still logs', () => {
    const f = makeContext();
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'still no lockfile' }, f.ctx);
    assert.strictEqual(f.toastCalls.length, 1);
    const suppressedLog = f.logLines.find(l => l.includes('toast suppressed'));
    assert.ok(suppressedLog, 'expected a log entry naming the suppression');
  });

  it('1003 toast click targets the Release the envelope names, without consulting the resolver', async () => {
    // The resolver is deliberately primed with a DIFFERENT Release: a workspace
    // may hold several, and acting on any but the one the diagnostic came from
    // pulls successfully while the diagnostic persists.
    const f = makeContext({ toastResponse: 'Generate Lockfile', lockfileRelease: 'envs/staging.yaml' });
    handleDaemonError(
      {
        code: ERR_LOCKFILE_ABSENT,
        message: 'no lockfile',
        data: { file: '/workspace/envs/prod.lock', release: 'envs/prod.yaml' },
      },
      f.ctx,
    );
    // Promise.resolve (toast) then the action handler schedule microtasks; drain.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 1);
    const created = f.terminalsCreated[0];
    assert.strictEqual(created.options.name, 'Aggrega Lockfile');
    assert.strictEqual(created.options.cwd, '/workspace');
    assert.strictEqual(created.terminal.shown, true);
    // aggrega pull requires --release; the bare command would exit 1.
    assert.deepStrictEqual(created.terminal.sentText, ['aggrega pull --release "envs/prod.yaml"']);
    assert.strictEqual(f.resolveReleaseCalls, 0, 'the envelope named the Release; nothing to resolve');
  });

  it('1003 toast click falls back to the resolver when the envelope names no Release', async () => {
    const f = makeContext({ toastResponse: 'Generate Lockfile', lockfileRelease: 'envs/prod.yaml' });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 1);
    const created = f.terminalsCreated[0];
    assert.strictEqual(created.options.cwd, '/workspace');
    assert.deepStrictEqual(created.terminal.sentText, ['aggrega pull --release "envs/prod.yaml"']);
    assert.strictEqual(f.resolveReleaseCalls, 1);
  });

  it('1003 toast click falls back to the resolver when the envelope carries an empty Release', async () => {
    // An empty path is never a usable target — emitting --release "" would send a
    // command that cannot succeed.
    const f = makeContext({ toastResponse: 'Generate Lockfile', lockfileRelease: 'envs/prod.yaml' });
    handleDaemonError(
      { code: ERR_LOCKFILE_ABSENT, message: 'no lockfile', data: { release: '' } },
      f.ctx,
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 1);
    assert.deepStrictEqual(
      f.terminalsCreated[0].terminal.sentText,
      ['aggrega pull --release "envs/prod.yaml"'],
    );
    assert.strictEqual(f.resolveReleaseCalls, 1);
  });

  it('1003 toast click with no resolvable Release opens no terminal', async () => {
    const f = makeContext({ toastResponse: 'Generate Lockfile', lockfileRelease: undefined });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 0);
  });

  it('1003 toast dismissal does not open a terminal', async () => {
    const f = makeContext({ toastResponse: undefined });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 0);
  });

  it('1005 logs to the output channel and produces no UI', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_SHUTTING_DOWN, message: 'daemon shutting down' },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.toastCalls.length, 0);
    assert.ok(f.logLines.some(l => l.includes('[shutting down]')));
  });

  it('resetSessionDedup clears the dedup map', () => {
    const dedup = new Map<number, true | number>();
    dedup.set(ERR_LOCKFILE_ABSENT, true);
    dedup.set(ERR_SHUTTING_DOWN, true);
    resetSessionDedup(dedup);
    assert.strictEqual(dedup.size, 0);
  });

  it('time mode: fires first toast, suppresses within throttle, re-fires after expiry', async () => {
    const f = makeContext({
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    // First emission fires the toast.
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 1, 'first emission should fire toast');

    // Second emission immediately after Promise resolution — within
    // the 60s window — is suppressed.
    f.currentTime = 1_000_000 + 30 * 1000;
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'still no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 1, 'within throttle should suppress');

    // After the throttle expires, the toast re-fires.
    f.currentTime = 1_000_000 + 90 * 1000;
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'still no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 2, 'past throttle expiry should re-fire');
  });

  it('time mode: each error code throttled independently', async () => {
    const f = makeContext({
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    // Fire 1003, then fire 1004 immediately — different codes, both
    // surface. (1004 routes via the diagnostic path, not the toast
    // path, so this assertion checks the model rather than the
    // specific 1004 wire — by populating the debounce map for 1003
    // and confirming a separate code isn't affected.)
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.toastCalls.length, 1);
    // The 1003 entry is now in the debounce map; another 1003 within
    // 60s would suppress. A different code's emission is unaffected
    // because the map keys by code.
    assert.strictEqual(f.toastDebounce.has(ERR_LOCKFILE_ABSENT), true);
    assert.strictEqual(f.toastDebounce.has(ERR_RELEASE_NOT_RESOLVED), false);
  });

  it('time mode: throttle window starts on Promise resolution, not on toast emission', async () => {
    const f = makeContext({
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    // The Promise has not yet resolved at this microtask boundary.
    // Advance the clock and resolve.
    f.currentTime = 1_000_000 + 10 * 1000;
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    // The recorded timestamp should reflect the time AT resolution,
    // not the time at emission. Within the throttle window from
    // resolution time, a second emission suppresses.
    const recorded = f.toastDebounce.get(ERR_LOCKFILE_ABSENT);
    assert.strictEqual(recorded, 1_000_000 + 10 * 1000);
  });
});
