// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { debounce } from '../../src/debounce';

describe('debounce', () => {
  it('fires once after the trailing edge', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => calls.push(n), 30);
    fn(1);
    fn(2);
    fn(3);
    await delay(80);
    assert.deepStrictEqual(calls, [3]);
  });

  it('separates calls across windows', async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => calls.push(n), 20);
    fn(1);
    await delay(60);
    fn(2);
    await delay(60);
    assert.deepStrictEqual(calls, [1, 2]);
  });

  it('passes the most-recent arguments', async () => {
    let captured: [string, number] | null = null;
    const fn = debounce((s: string, n: number) => { captured = [s, n]; }, 20);
    fn('a', 1);
    fn('b', 2);
    await delay(60);
    assert.deepStrictEqual(captured, ['b', 2]);
  });

  it('rereads the delay from a getter on every call', async () => {
    const calls: number[] = [];
    let currentWait = 200;
    const fn = debounce((n: number) => calls.push(n), () => currentWait);

    fn(1);
    // First call uses 200 ms; nothing fires after 60 ms.
    await delay(60);
    assert.deepStrictEqual(calls, []);
    // Wait long enough for the first call to fire.
    await delay(220);
    assert.deepStrictEqual(calls, [1]);

    // Switch the getter to a short delay; the next call fires quickly.
    currentWait = 20;
    fn(2);
    await delay(60);
    assert.deepStrictEqual(calls, [1, 2]);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
