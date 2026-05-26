// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// debounce returns a function that defers invocation of fn until
// the wait window elapses without a fresh call. The most recent
// arguments win when several calls collapse into one firing.
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
