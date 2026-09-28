// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CacheMissDeps, recoverFromCacheMiss } from '../../src/cache-miss';

// What the editor does with a language request the language server refused as
// "file not validated", driven with no editor and no server. Every request the
// recovery sends is recorded in order and read back by equality, beside what it
// answered and what it reported.
//
// The record is complete by construction: the recovery reaches nothing but what
// it is handed, which the last case below holds it to. So a gate standing between
// the refusal and the validation — a question put to the reader that nobody
// answers — shows here as a record with no validation in it and an answer of
// nothing.

// COMPILED_MODULE is the recovery as the suite loads it, which is what decides
// what it can reach when it runs.
const COMPILED_MODULE = path.resolve(__dirname, '../../src/cache-miss.js');

const HOVER = { contents: { kind: 'markdown', value: '**core/datastore/postgres** 16.2.0' } };
const REFUSED_AGAIN = { code: 1001, message: 'file not validated: aggregate.yaml' };

interface Recording<T> {
  deps: CacheMissDeps<T>;
  calls: string[];
  failures: unknown[];
}

// recording builds the surroundings of one recovery. validate answers as a
// validation does unless it is given something to throw; retry answers with what
// it is given, or throws it where it is an error.
function recording<T>(opts: { validateThrows?: unknown; retry: { answer: T } | { throws: unknown } }): Recording<T> {
  const calls: string[] = [];
  const failures: unknown[] = [];
  const deps: CacheMissDeps<T> = {
    validate: async () => {
      calls.push('validate');
      if (opts.validateThrows !== undefined) { throw opts.validateThrows; }
      return { diagnostics: [] };
    },
    retry: async () => {
      calls.push('retry');
      if ('throws' in opts.retry) { throw opts.retry.throws; }
      return opts.retry.answer;
    },
    failed: (err) => { failures.push(err); },
  };
  return { deps, calls, failures };
}

describe('recovering from a request refused as not validated', () => {
  it('validates the document once and sends the refused request again once, asking nothing, and answers with the second answer', async () => {
    const r = recording({ retry: { answer: HOVER } });
    const answer = await recoverFromCacheMiss(r.deps);
    assert.deepStrictEqual(r.calls, ['validate', 'retry']);
    assert.deepStrictEqual(answer, HOVER);
    assert.deepStrictEqual(r.failures, []);
  });

  it('reports a validation that fails and does not send the refused request again', async () => {
    const stopped = new Error('the Aggrega language server is not running');
    const r = recording({ validateThrows: stopped, retry: { answer: HOVER } });
    const answer = await recoverFromCacheMiss(r.deps);
    assert.deepStrictEqual(r.calls, ['validate']);
    assert.strictEqual(answer, null);
    assert.deepStrictEqual(r.failures, [stopped]);
  });

  it('reports a retry that is refused again and does not retry it a second time', async () => {
    const r = recording<typeof HOVER>({ retry: { throws: REFUSED_AGAIN } });
    const answer = await recoverFromCacheMiss(r.deps);
    assert.deepStrictEqual(r.calls, ['validate', 'retry']);
    assert.strictEqual(answer, null);
    assert.deepStrictEqual(r.failures, [REFUSED_AGAIN]);
  });

  it('answers with nothing where the retried request answers with nothing, and reports nothing', async () => {
    const r = recording<typeof HOVER | null>({ retry: { answer: null } });
    const answer = await recoverFromCacheMiss(r.deps);
    assert.deepStrictEqual(r.calls, ['validate', 'retry']);
    assert.strictEqual(answer, null);
    assert.deepStrictEqual(r.failures, []);
  });

  // A question needs the editor's notification surface, and the only way this
  // module could reach it is by loading a module. It loads none, so it can put no
  // question to anybody.
  it('loads no module, so nothing it does can reach the editor', () => {
    const source = fs.readFileSync(COMPILED_MODULE, 'utf8');
    const loaded = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    assert.deepStrictEqual(loaded, []);
  });
});
