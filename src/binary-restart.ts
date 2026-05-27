// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// Pure helper for scheduling a daemon restart after a configurable
// grace window. Extracted from extension.ts so the timer logic is
// unit-testable with fake timers — the integration test covers the
// activation-side wiring at the vscode-test tier.

// TimerLike abstracts the setTimeout/clearTimeout pair so tests can
// substitute fake timers. Production passes `setTimeout` /
// `clearTimeout` from the Node runtime.
export interface TimerLike {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

// RestartScheduleDeps carries the surfaces scheduleBinaryRestart
// reaches into. graceSeconds is the configured window; restartFn
// performs the actual restart; onTick fires once per remaining
// second so the caller can update a status-bar countdown; onCancel
// and onComplete fire on the corresponding terminal states.
export interface RestartScheduleDeps {
  graceSeconds: number;
  timer: TimerLike;
  restartFn: () => void;
  onTick: (remainingSeconds: number) => void;
  onCancel: () => void;
  onComplete: () => void;
}

// RestartHandle is what scheduleBinaryRestart returns. cancel()
// aborts the pending restart; restartNow() fires the restart
// immediately (also aborting any pending tick timer).
export interface RestartHandle {
  cancel(): void;
  restartNow(): void;
}

// scheduleBinaryRestart kicks off a countdown of graceSeconds.
// Every second, onTick fires with the remaining count. When the
// countdown expires, restartFn fires and onComplete fires.
// cancel() before expiry stops the timer and fires onCancel.
// restartNow() before expiry stops the timer, fires restartFn, and
// fires onComplete (treated identically to the natural expiry from
// the caller's perspective).
export function scheduleBinaryRestart(deps: RestartScheduleDeps): RestartHandle {
  let remaining = deps.graceSeconds;
  let tickHandle: unknown = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    if (tickHandle !== null) {
      deps.timer.clearTimeout(tickHandle);
      tickHandle = null;
    }
  };

  const tick = () => {
    if (done) return;
    remaining -= 1;
    deps.onTick(remaining);
    if (remaining <= 0) {
      finish();
      deps.restartFn();
      deps.onComplete();
      return;
    }
    tickHandle = deps.timer.setTimeout(tick, 1000);
  };

  // First tick fires after one second; the caller already knows the
  // initial remaining count when they call scheduleBinaryRestart.
  tickHandle = deps.timer.setTimeout(tick, 1000);

  return {
    cancel(): void {
      if (done) return;
      finish();
      deps.onCancel();
    },
    restartNow(): void {
      if (done) return;
      finish();
      deps.restartFn();
      deps.onComplete();
    },
  };
}
