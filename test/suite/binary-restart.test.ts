// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { scheduleBinaryRestart, TimerLike } from '../../src/binary-restart';

// fakeTimer is a minimal manual-advance clock so the schedule tests
// stay deterministic. `advance(ms)` fires every scheduled callback
// whose due time falls within the window, in due-time order.
class FakeTimer implements TimerLike {
  private currentTime = 0;
  private nextHandle = 1;
  private queue: Array<{ id: number; due: number; fn: () => void }> = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.nextHandle++;
    this.queue.push({ id, due: this.currentTime + ms, fn: handler });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.queue = this.queue.filter(q => q.id !== id);
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;
    while (true) {
      this.queue.sort((a, b) => a.due - b.due);
      const next = this.queue[0];
      if (!next || next.due > target) {
        this.currentTime = target;
        return;
      }
      this.queue.shift();
      this.currentTime = next.due;
      next.fn();
    }
  }
}

describe('scheduleBinaryRestart', () => {
  it('schedules restartFn after the grace expires', () => {
    const timer = new FakeTimer();
    let restartCalls = 0;
    let completeCalls = 0;
    scheduleBinaryRestart({
      graceSeconds: 3,
      timer,
      restartFn: () => { restartCalls++; },
      onTick: () => undefined,
      onCancel: () => undefined,
      onComplete: () => { completeCalls++; },
    });
    timer.advance(3000);
    assert.strictEqual(restartCalls, 1);
    assert.strictEqual(completeCalls, 1);
  });

  it('cancel before grace expires prevents restart', () => {
    const timer = new FakeTimer();
    let restartCalls = 0;
    let cancelCalls = 0;
    const handle = scheduleBinaryRestart({
      graceSeconds: 5,
      timer,
      restartFn: () => { restartCalls++; },
      onTick: () => undefined,
      onCancel: () => { cancelCalls++; },
      onComplete: () => undefined,
    });
    timer.advance(2000);
    handle.cancel();
    timer.advance(10000);
    assert.strictEqual(restartCalls, 0);
    assert.strictEqual(cancelCalls, 1);
  });

  it('restartNow invokes restartFn immediately and clears timer', () => {
    const timer = new FakeTimer();
    let restartCalls = 0;
    let completeCalls = 0;
    const handle = scheduleBinaryRestart({
      graceSeconds: 10,
      timer,
      restartFn: () => { restartCalls++; },
      onTick: () => undefined,
      onCancel: () => undefined,
      onComplete: () => { completeCalls++; },
    });
    handle.restartNow();
    assert.strictEqual(restartCalls, 1);
    assert.strictEqual(completeCalls, 1);
    timer.advance(20000);
    assert.strictEqual(restartCalls, 1, 'restartFn should not fire a second time after restartNow');
  });

  it('onTick fires every second of the countdown with decrementing remaining', () => {
    const timer = new FakeTimer();
    const tickHistory: number[] = [];
    scheduleBinaryRestart({
      graceSeconds: 3,
      timer,
      restartFn: () => undefined,
      onTick: (remaining) => { tickHistory.push(remaining); },
      onCancel: () => undefined,
      onComplete: () => undefined,
    });
    timer.advance(3000);
    assert.deepStrictEqual(tickHistory, [2, 1, 0]);
  });
});
