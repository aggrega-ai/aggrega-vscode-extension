// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type { TimerLike } from './binary-restart';

// debounce returns a function that defers invocation of fn until
// the wait window elapses without a fresh call. The most recent
// arguments win when several calls collapse into one firing.
//
// It keeps ONE window for whatever calls it, so it suits one subject: a
// call about a second subject inside the window replaces the first
// subject's call, which is then never made. Where each subject must wait
// out a window of its own, debounceEach below is the form to use.
//
// The wait window accepts either a fixed number of milliseconds or a
// getter that is consulted on every call — pass a getter when the
// debounce delay must remain reactive to a setting change without
// re-creating the wrapper.
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number | (() => number),
): (...args: A) => void {
  const getWait = typeof wait === 'function' ? wait : () => wait;
  let timer: NodeJS.Timeout | null = null;
  return (...args: A) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, getWait());
  };
}

// KeyedDebounce is what debounceEach returns.
export interface KeyedDebounce<T> {
  // call defers fn(subject) until the subject's own window elapses without a
  // fresh call for the same subject; the most recent call for a subject wins.
  call(subject: T): void;
  // flush makes at once every call still waiting out its window, each with the
  // subject its latest call named, and leaves none waiting.
  flush(): void;
}

// debounceEach is debounce kept per subject: key names the subject a call is
// about, and each subject waits out a window of its own, so a call about one
// subject never cancels or replaces a call still waiting for another. The wait
// window is read as debounce reads it, on every call. The timers are passed in,
// so a test drives every sequence of calls with a clock it moves itself.
export function debounceEach<T>(
  fn: (subject: T) => void,
  key: (subject: T) => string,
  wait: number | (() => number),
  timer: Pick<TimerLike, 'setTimeout' | 'clearTimeout'>,
): KeyedDebounce<T> {
  const getWait = typeof wait === 'function' ? wait : () => wait;
  const waiting = new Map<string, { subject: T; handle: unknown }>();
  const fire = (k: string): void => {
    const entry = waiting.get(k);
    if (entry === undefined) { return; }
    waiting.delete(k);
    fn(entry.subject);
  };
  return {
    call: (subject: T): void => {
      const k = key(subject);
      const earlier = waiting.get(k);
      if (earlier !== undefined) { timer.clearTimeout(earlier.handle); }
      waiting.set(k, { subject, handle: timer.setTimeout(() => fire(k), getWait()) });
    },
    flush: (): void => {
      for (const [k, entry] of [...waiting]) {
        timer.clearTimeout(entry.handle);
        fire(k);
      }
    },
  };
}
