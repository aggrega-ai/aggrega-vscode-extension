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
  toastDedup: Map<number, true>;
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
    toastDedup: new Map(),
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
    toastDedup: fixture.toastDedup,
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

  it('1002 publishes an Error diagnostic at uri 1:1', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_RELEASE_NOT_RESOLVED, message: 'release.yaml missing' },
      f.ctx,
    );
    assert.strictEqual(handled, true);
    assert.strictEqual(f.publishCalls.length, 1);
    assert.strictEqual(f.publishCalls[0].uri, f.uri);
    assert.strictEqual(f.publishCalls[0].shapes.length, 1);
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.severity, 'error');
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
    assert.ok(shape.message.startsWith('Release not resolved: '));
    assert.ok(shape.message.includes('release.yaml missing'));
    assert.strictEqual(f.toastCalls.length, 0);
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
    // Envelope from a pre-WI-29 daemon — no data field.
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
    assert.strictEqual(f.toastDedup.has(ERR_LOCKFILE_ABSENT), true);
  });

  it('1003 second call is suppressed by session dedup, still logs', () => {
    const f = makeContext();
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'still no lockfile' }, f.ctx);
    assert.strictEqual(f.toastCalls.length, 1);
    const suppressedLog = f.logLines.find(l => l.includes('toast suppressed'));
    assert.ok(suppressedLog, 'expected a log entry naming the suppression');
  });

  it('1003 toast click opens terminal and sends the lockfile-generate command', async () => {
    const f = makeContext({ toastResponse: 'Generate Lockfile' });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: 'no lockfile' }, f.ctx);
    // Promise.resolve schedules microtasks; drain.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.terminalsCreated.length, 1);
    const created = f.terminalsCreated[0];
    assert.strictEqual(created.options.name, 'Aggrega Lockfile');
    assert.strictEqual(created.options.cwd, '/workspace');
    assert.strictEqual(created.terminal.shown, true);
    assert.deepStrictEqual(created.terminal.sentText, ['aggrega pull']);
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
    const dedup = new Map<number, true>();
    dedup.set(ERR_LOCKFILE_ABSENT, true);
    dedup.set(ERR_SHUTTING_DOWN, true);
    resetSessionDedup(dedup);
    assert.strictEqual(dedup.size, 0);
  });
});
