// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { debounce, debounceEach } from '../../src/debounce';

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

// debounceEach, driven by a clock that moves only when the test moves it. Each
// call is a subject and a value; the subject is what the windows are kept by.
describe('debounceEach', () => {
  interface Call { subject: string; value: number }

  class FakeClock {
    now = 0;
    private nextId = 1;
    private queue: Array<{ id: number; due: number; fn: () => void }> = [];

    setTimeout(fn: () => void, ms: number): unknown {
      const id = this.nextId++;
      this.queue.push({ id, due: this.now + ms, fn });
      return id;
    }

    clearTimeout(handle: unknown): void {
      this.queue = this.queue.filter((q) => q.id !== handle);
    }

    advance(ms: number): void {
      const target = this.now + ms;
      for (;;) {
        this.queue.sort((a, b) => a.due - b.due);
        const next = this.queue[0];
        if (!next || next.due > target) { this.now = target; return; }
        this.queue.shift();
        this.now = next.due;
        next.fn();
      }
    }
  }

  const setUp = (wait: number | (() => number)) => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const each = debounceEach(
      (c: Call) => { fired.push(`${clock.now} ${c.subject}=${c.value}`); },
      (c: Call) => c.subject,
      wait,
      clock,
    );
    return { clock, fired, each };
  };

  it('keeps a window per subject, so a call about one never replaces a call waiting for another', () => {
    const { clock, fired, each } = setUp(300);
    each.call({ subject: 'a', value: 1 });
    clock.advance(100);
    each.call({ subject: 'b', value: 1 });
    clock.advance(100);
    each.call({ subject: 'a', value: 2 });
    clock.advance(1000);
    assert.deepStrictEqual(fired, ['400 b=1', '500 a=2']);
  });

  it('flushes every waiting subject at once with its latest call, and leaves none waiting', () => {
    const { clock, fired, each } = setUp(300);
    each.call({ subject: 'a', value: 1 });
    each.call({ subject: 'b', value: 1 });
    each.call({ subject: 'a', value: 2 });
    clock.advance(50);
    each.flush();
    clock.advance(1000);
    each.flush();
    assert.deepStrictEqual(fired, ['50 a=2', '50 b=1']);
  });

  it('rereads the window from a getter on every call', () => {
    let wait = 200;
    const { clock, fired, each } = setUp(() => wait);
    each.call({ subject: 'a', value: 1 });
    wait = 20;
    each.call({ subject: 'b', value: 1 });
    clock.advance(1000);
    assert.deepStrictEqual(fired, ['20 b=1', '200 a=1']);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
