// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { applyDocumentClose } from '../../src/close-handler';
import { InvalidateParams } from '../../src/types';

interface FakeUri {
  fsPath: string;
  toString(): string;
}

interface Fixture {
  uri: FakeUri;
  deletedUris: FakeUri[];
  daemonCalls: Array<{ method: string; params: InvalidateParams }>;
  daemonError: Error | null;
  logLines: string[];
}

function makeFixture(initial?: Partial<Fixture>): Fixture & {
  deps: Parameters<typeof applyDocumentClose>[2];
} {
  const fixture: Fixture = {
    uri: { fsPath: '/workspace/a.yaml', toString: () => 'file:///workspace/a.yaml' },
    deletedUris: [],
    daemonCalls: [],
    daemonError: null,
    logLines: [],
    ...initial,
  };
  const diagnosticCollection = {
    delete: (uri: FakeUri) => { fixture.deletedUris.push(uri); },
  };
  const deps: Parameters<typeof applyDocumentClose>[2] = {
    diagnosticCollection: diagnosticCollection as any,
    daemonRequest: (method: string, params: InvalidateParams) => {
      fixture.daemonCalls.push({ method, params });
      if (fixture.daemonError) {
        return Promise.reject(fixture.daemonError);
      }
      return Promise.resolve({ invalidated: true });
    },
    logLine: (line: string) => { fixture.logLines.push(line); },
    describeError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  };
  return Object.assign(fixture, { deps });
}

describe('applyDocumentClose', () => {
  it('clears the diagnostic collection entry for the closed URI', () => {
    const f = makeFixture();
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    assert.strictEqual(f.deletedUris.length, 1);
    assert.strictEqual(f.deletedUris[0], f.uri);
  });

  it('invokes the daemon with aggrega/invalidate + granularity:file', () => {
    const f = makeFixture();
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    assert.strictEqual(f.daemonCalls.length, 1);
    assert.strictEqual(f.daemonCalls[0].method, 'aggrega/invalidate');
    assert.deepStrictEqual(f.daemonCalls[0].params, {
      file: '/workspace/a.yaml',
      granularity: 'file',
    });
  });

  it('clears the diagnostic entry BEFORE issuing the daemon call', () => {
    const order: string[] = [];
    const f = makeFixture();
    f.deps.diagnosticCollection = {
      delete: () => { order.push('delete'); },
    } as any;
    const originalDaemon = f.deps.daemonRequest!;
    f.deps.daemonRequest = (method, params) => {
      order.push('daemon');
      return originalDaemon(method, params);
    };
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    assert.deepStrictEqual(order, ['delete', 'daemon']);
  });

  it('does not call the daemon when daemonRequest is null (daemon not running)', () => {
    const f = makeFixture();
    f.deps.daemonRequest = null;
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    // Local clear still fired.
    assert.strictEqual(f.deletedUris.length, 1);
    assert.strictEqual(f.daemonCalls.length, 0);
  });

  it('handles a null diagnostic collection (extension activated without one)', () => {
    const f = makeFixture();
    f.deps.diagnosticCollection = null;
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    assert.strictEqual(f.daemonCalls.length, 1);
  });

  it('logs daemon-call failures without throwing', async () => {
    const f = makeFixture({ daemonError: new Error('daemon shutting down') });
    applyDocumentClose(f.uri as any, f.uri.fsPath, f.deps);
    // The daemon call is fire-and-forget; the .catch fires on the
    // promise microtask queue. Drain.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(f.daemonCalls.length, 1);
    assert.ok(
      f.logLines.some(l => l.includes('invalidate (didClose) failed') && l.includes('daemon shutting down')),
      `expected a log line naming the failure; got ${JSON.stringify(f.logLines)}`,
    );
  });

  it('touches exactly the four documented surfaces on failure', async () => {
    // applyDocumentClose's contract is that it touches only the
    // four deps fields: diagnosticCollection (delete), daemonRequest
    // (one call), logLine (one call on failure), and describeError
    // (one call on failure to format the error). Verifies by spy-
    // counting on each surface — does NOT count fixture keys, which
    // would tautologically pass regardless of what the function
    // does.
    const calls = {
      diagnosticDelete: 0,
      daemonRequest: 0,
      logLine: 0,
      describeError: 0,
    };
    const uri = { fsPath: '/workspace/a.yaml', toString: () => 'file:///workspace/a.yaml' };
    const deps: Parameters<typeof applyDocumentClose>[2] = {
      diagnosticCollection: {
        delete: () => { calls.diagnosticDelete++; },
      } as any,
      daemonRequest: () => {
        calls.daemonRequest++;
        return Promise.reject(new Error('boom'));
      },
      logLine: () => { calls.logLine++; },
      describeError: () => { calls.describeError++; return 'boom'; },
    };

    applyDocumentClose(uri as any, uri.fsPath, deps);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(calls.diagnosticDelete, 1, 'diagnosticCollection.delete should fire exactly once');
    assert.strictEqual(calls.daemonRequest, 1, 'daemonRequest should fire exactly once');
    assert.strictEqual(calls.logLine, 1, 'logLine should fire exactly once (on failure)');
    assert.strictEqual(calls.describeError, 1, 'describeError should fire exactly once (on failure)');
  });
});
