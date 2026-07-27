// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as vscode from 'vscode';
import {
  ERR_ENTITY_NOT_RESOLVABLE,
  ERR_LOCKFILE_ABSENT,
  ERR_RELEASE_NOT_RESOLVED,
  ERR_SHUTTING_DOWN,
  JsonRpcError,
} from './types';
import { ConvertedShape } from './diagnostics-shape';

// LOCKFILE_GENERATE_COMMAND is the shell command the 1003 toast's
// button runs in the integrated terminal. The user sees the command
// execute so any output / errors are visible inline.
//
// aggrega pull is the canonical lockfile-generation entry point —
// its short description reads "Resolve catalog and source
// dependencies into the cache and write the per-Release lockfile."
// An earlier draft of this extension referenced a non-existent
// `aggrega lockfile generate` subcommand; this constant carries
// the correct command name now that the daemon-side trigger ships.
const LOCKFILE_GENERATE_COMMAND = 'aggrega pull';

// LOCKFILE_GENERATE_TOOLTIP is the operator-facing clarification
// of what the "Generate Lockfile" button actually invokes. VS Code's
// showInformationMessage API does not support per-button tooltips,
// so this text is incorporated into the toast's main message body
// rather than attached to the button.
const LOCKFILE_GENERATE_TOOLTIP =
  'The Generate Lockfile button runs `aggrega pull --release <release>` — pulls catalog dependencies into the cache and writes the per-Release lockfile.';

// LOCKFILE_TOAST_BUTTON is the label of the actionable button on
// the 1003 toast. The handler matches against this literal.
const LOCKFILE_TOAST_BUTTON = 'Generate Lockfile';

// ToastDebounceMode picks how repeated toasts for the same error
// code are throttled. `session` is the previous default — one toast
// per code per daemon session; cleared on daemon restart. `time` is
// the current default — the throttle resets when the toast's
// showInformationMessage Promise resolves (action click, X click, or
// VS Code auto-dismiss) and re-fires after toastThrottleSeconds.
export type ToastDebounceMode = 'time' | 'session';

// DaemonErrorContext carries the surfaces the per-code dispatcher
// writes into. Injecting the surfaces (rather than reaching into
// module-level singletons or vscode runtime) keeps the dispatcher
// testable: tests pass fakes for every field.
export interface DaemonErrorContext {
  uri: vscode.Uri;
  workspaceRoot: string;
  publishShape: (uri: vscode.Uri, shapes: ConvertedShape[]) => void;
  logLine: (line: string) => void;
  toastInfo: (message: string, ...items: string[]) => Thenable<string | undefined>;
  createTerminal: (options: vscode.TerminalOptions) => vscode.Terminal;
  // executeCommand routes button-action selections from the
  // release-not-resolved toast to the registered command. Production
  // passes vscode.commands.executeCommand; tests pass a recorder.
  executeCommand: (command: string) => Thenable<unknown>;
  // scanCandidateReleases returns whether the workspace root
  // contains at least one Release-shaped file (used to decide
  // whether the release-not-resolved toast offers the "Use marker
  // file…" action). Computed on demand at toast-time so the
  // button set matches the workspace state at the moment of
  // emission. Production scans the filesystem; tests return a
  // fixed boolean.
  scanCandidateReleases: () => Thenable<boolean>;
  // resolveRelease returns the Release the lockfile-generation command should
  // target — `aggrega pull` requires a --release argument, so the bare command
  // fails. Production wires the shared release resolver (sole candidate, or a
  // quick-pick); tests return a fixed value. Undefined means do not proceed
  // (no daemon, no Release, or the user dismissed the pick).
  resolveRelease: () => Thenable<string | undefined>;
  // toastDebounce tracks per-code throttle state. In `session` mode
  // the boolean records whether a toast already surfaced this
  // daemon session (and stays true until resetSessionDedup runs
  // on daemon restart). In `time` mode the number records the
  // wall-clock timestamp the previous toast's Promise resolved at;
  // a fresh toast fires when (now() - prev) > throttleSeconds*1000.
  toastDebounce: Map<number, true | number>;
  // toastDebounceMode picks between the session- and time-based
  // throttle semantics described above.
  toastDebounceMode: ToastDebounceMode;
  // toastThrottleSeconds is the window for the time-based throttle.
  // Consulted only when toastDebounceMode === 'time'.
  toastThrottleSeconds: number;
  // now returns the current wall-clock millisecond timestamp. A
  // test seam: production passes () => Date.now(); tests pass a
  // controlled clock.
  now: () => number;
}

// Command IDs the release-not-resolved toast dispatches to. The
// command implementations live in release-actions.ts; extension.ts
// registers them at activation.
const SET_CONFIG_COMMAND = 'aggrega.workspace.openAuthoringReleaseConfig';
const USE_MARKER_COMMAND = 'aggrega.workspace.createActiveReleaseMarker';

// Toast button labels for the release-not-resolved surface. The
// handler matches against these literals. The labels are short and
// contextual — the toast's surrounding "Aggrega: <message>" body
// supplies the framing. The Command Palette entries in package.json
// carry longer, self-documenting titles ("Aggrega: Set
// authoring_release in .aggrega-config.yaml…" / "Aggrega: Create
// .aggrega/active-release marker…") because palette titles stand
// alone without surrounding context. Toast-label ↔ palette-title
// divergence is intentional, not drift.
const SET_CONFIG_BUTTON = 'Set authoring_release in config…';
const USE_MARKER_BUTTON = 'Use marker file…';

// handleDaemonError routes a daemon-emitted error envelope to the
// surface appropriate for its code:
//
//   1002 (release-not-resolved)   → OutputChannel auto-log of the
//                                    cascade trace + non-modal toast
//                                    with 1 or 2 action buttons
//   1003 (lockfile-absent)        → toast with Generate Lockfile button
//   1004 (entity-not-resolvable)  → Error diagnostic at uri:1:1
//   1005 (daemon-shutting-down)   → output channel log; no UI
//
// Returns true when the code was recognized and handled, false
// otherwise (so the caller can fall through to its existing generic
// logging path).
export function handleDaemonError(err: JsonRpcError, ctx: DaemonErrorContext): boolean {
  switch (err.code) {
    case ERR_RELEASE_NOT_RESOLVED:
      surfaceReleaseNotResolvedToast(ctx, err);
      return true;
    case ERR_LOCKFILE_ABSENT:
      surfaceLockfileToast(ctx, err.message);
      return true;
    case ERR_ENTITY_NOT_RESOLVABLE:
      surfaceDiagnostic(ctx, err, `Entity not resolvable: ${err.message}`);
      return true;
    case ERR_SHUTTING_DOWN:
      ctx.logLine(`[shutting down] ${err.message}`);
      return true;
    default:
      return false;
  }
}

function surfaceDiagnostic(ctx: DaemonErrorContext, err: JsonRpcError, message: string): void {
  // Read err.data when present; the daemon's 1004 emission sites
  // populate {file, line, column} with 1-based positions, and
  // optionally {end_line, end_column} for a token-spanning range.
  // Missing or zero start values produce a file:1:1 fallback (start
  // of file); missing or zero end values fall back to a point-style
  // range. The 1-based-to-0-based conversion mirrors
  // diagnostics-shape.ts.
  const daemonLine = err.data?.line ?? 0;
  const daemonColumn = err.data?.column ?? 0;
  const line = daemonLine > 0 ? daemonLine - 1 : 0;
  const character = daemonColumn > 0 ? daemonColumn - 1 : 0;
  const daemonEndLine = err.data?.end_line ?? 0;
  const daemonEndColumn = err.data?.end_column ?? 0;
  const hasEnd = daemonEndLine > 0 && daemonEndColumn > 0;
  const shape: ConvertedShape = {
    startLine: line,
    startChar: character,
    endLine: hasEnd ? daemonEndLine - 1 : line,
    endChar: hasEnd ? daemonEndColumn - 1 : character,
    severity: 'error',
    message,
    source: 'aggrega',
  };
  ctx.publishShape(ctx.uri, [shape]);
}

function surfaceLockfileToast(ctx: DaemonErrorContext, message: string): void {
  if (!shouldFireToast(ctx, ERR_LOCKFILE_ABSENT)) {
    const reason = ctx.toastDebounceMode === 'session'
      ? 'already shown this session'
      : `throttled; next surface allowed after ${ctx.toastThrottleSeconds}s`;
    ctx.logLine(`[lockfile absent] ${message} (toast suppressed; ${reason})`);
    return;
  }
  // Seed debounce immediately so a second emission arriving before
  // the toast Promise resolves is correctly suppressed. Without this
  // seed there is an overlap window between emission and dismissal
  // where the debounce map is unset and shouldFireToast would let a
  // second toast fire on top of the first. The time-mode value is
  // updated to the actual dismissal timestamp when the Promise
  // resolves below; the seed just establishes "a toast is in flight
  // since now()" so the throttle check during the in-flight window
  // returns false (now() - seed < throttleSeconds * 1000).
  if (ctx.toastDebounceMode === 'session') {
    ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, true);
  } else {
    ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, ctx.now());
  }
  ctx.logLine(`[lockfile absent] ${message}`);
  void ctx.toastInfo(
    `Aggrega: lockfile missing. ${message}. ${LOCKFILE_GENERATE_TOOLTIP}`,
    LOCKFILE_TOAST_BUTTON,
  ).then(choice => {
    // The throttle window starts when the toast's Promise resolves —
    // whether the user clicked an action, clicked the X, or VS Code
    // auto-dismissed on timeout. Same surface either way; no need to
    // distinguish termination cause.
    if (ctx.toastDebounceMode === 'time') {
      ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, ctx.now());
    }
    if (choice !== LOCKFILE_TOAST_BUTTON) {
      return;
    }
    void generateLockfile(ctx);
  });
}

// generateLockfile resolves the target Release and runs `aggrega pull
// --release <path>` in a terminal. The bare command cannot succeed — the CLI
// marks --release required, so the Release must be supplied; only the workspace
// root is otherwise in scope here. The path is double-quoted so a root-relative
// path with spaces survives the shell.
async function generateLockfile(ctx: DaemonErrorContext): Promise<void> {
  const release = await ctx.resolveRelease();
  if (!release) {
    return;
  }
  const terminal = ctx.createTerminal({
    name: 'Aggrega Lockfile',
    cwd: ctx.workspaceRoot,
  });
  terminal.show();
  terminal.sendText(`${LOCKFILE_GENERATE_COMMAND} --release "${release}"`, true);
}

// shouldFireToast applies the debounce policy for the supplied
// error code. Returns true when the caller should fire a fresh
// toast; false when the throttle is active.
function shouldFireToast(ctx: DaemonErrorContext, code: number): boolean {
  const previous = ctx.toastDebounce.get(code);
  if (previous === undefined) {
    return true;
  }
  if (ctx.toastDebounceMode === 'session') {
    // previous === true → suppress; no other value is meaningful in
    // session mode (the helper only writes `true` there).
    return false;
  }
  // time mode: previous is the wall-clock timestamp of the prior
  // toast's resolution. previous === true would only appear if the
  // operator flipped modes mid-session; treat as expired so the
  // next toast fires and re-establishes the timestamp.
  if (previous === true) {
    return true;
  }
  return ctx.now() - previous > ctx.toastThrottleSeconds * 1000;
}

// resetSessionDedup clears the per-code debounce state. Called by
// extension.ts whenever the daemon starts or restarts so the
// operator gets a fresh chance to see each toast after a fix.
export function resetSessionDedup(dedup: Map<number, true | number>): void {
  dedup.clear();
}

// surfaceReleaseNotResolvedToast handles the 1002
// (release-not-resolved) emission shape. Auto-logs the multi-line
// cascade trace from err.data.cascade_attempt to the OutputChannel
// on every receipt (unconditional — no debounce on the log) and
// fires a non-modal toast with action buttons subject to the same
// per-code throttle logic the other surfaces use.
//
// Button set:
//   - Always: "Set authoring_release in config…" (opens / creates
//     the workspace .aggrega-config.yaml).
//   - When ctx.hasCandidateReleases is true: "Use marker file…"
//     (quick-pick of candidate Releases; writes .aggrega/active-
//     release on selection). Omitted entirely when zero candidates
//     exist — dead-end UI avoidance.
//
// On selection, dispatches to the registered VS Code command via
// ctx.executeCommand. The command implementations live in
// release-actions.ts.
function surfaceReleaseNotResolvedToast(ctx: DaemonErrorContext, err: JsonRpcError): void {
  // OutputChannel auto-log fires on EVERY receipt regardless of
  // toast debounce state. The trace is the diagnostic record
  // operators consult when the toast is dismissed or throttled.
  ctx.logLine(`[release not resolved] ${err.message}`);
  const trace = err.data?.cascade_attempt;
  if (trace) {
    for (const line of trace.split('\n')) {
      ctx.logLine(line);
    }
  }

  if (!shouldFireToast(ctx, ERR_RELEASE_NOT_RESOLVED)) {
    const reason = ctx.toastDebounceMode === 'session'
      ? 'already shown this session'
      : `throttled; next surface allowed after ${ctx.toastThrottleSeconds}s`;
    ctx.logLine(`[release not resolved] (toast suppressed; ${reason})`);
    return;
  }
  // Seed debounce immediately so a second emission arriving before
  // the toast Promise resolves is correctly suppressed. See
  // surfaceLockfileToast for the matching seed pattern and rationale.
  if (ctx.toastDebounceMode === 'session') {
    ctx.toastDebounce.set(ERR_RELEASE_NOT_RESOLVED, true);
  } else {
    ctx.toastDebounce.set(ERR_RELEASE_NOT_RESOLVED, ctx.now());
  }

  // Scan for candidate Releases before showing the toast so the
  // button set matches workspace state at emission time. The "Use
  // marker file…" button is omitted entirely when zero candidates
  // exist (dead-end UI avoidance).
  void Promise.resolve(ctx.scanCandidateReleases()).then(hasCandidates => {
    const buttons: string[] = [SET_CONFIG_BUTTON];
    if (hasCandidates) {
      buttons.push(USE_MARKER_BUTTON);
    }
    return ctx.toastInfo(`Aggrega: ${err.message}`, ...buttons);
  }).then(choice => {
    if (ctx.toastDebounceMode === 'time') {
      ctx.toastDebounce.set(ERR_RELEASE_NOT_RESOLVED, ctx.now());
    }
    if (choice === SET_CONFIG_BUTTON) {
      void ctx.executeCommand(SET_CONFIG_COMMAND);
      return;
    }
    if (choice === USE_MARKER_BUTTON) {
      void ctx.executeCommand(USE_MARKER_COMMAND);
      return;
    }
    // Dismissal or X-click — nothing to do; the trace is already
    // logged.
  }).then(undefined, err => {
    // Forensic catch: a rejection from scanCandidateReleases,
    // toastInfo, or executeCommand would otherwise vanish silently.
    // The trace was already logged before the throttle check, so
    // the operator at least sees the 1002 message; this catch adds
    // a record of why the toast / dispatch didn't proceed.
    const reason = err instanceof Error ? err.message : String(err);
    ctx.logLine(`[release not resolved] (toast pipeline error: ${reason})`);
  });
}
