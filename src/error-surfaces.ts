// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as vscode from 'vscode';
import {
  ERR_ENTITY_NOT_RESOLVABLE,
  ERR_LOCKFILE_ABSENT,
  ERR_SHUTTING_DOWN,
  JsonRpcError,
} from './types';
import { ConvertedShape, DIAGNOSTIC_SOURCE_FALLBACK } from './diagnostics-shape';

// LOCKFILE_GENERATE_COMMAND is the shell command the 1003 toast's
// button runs in the integrated terminal, with the required --release
// argument appended by generateLockfile. The user sees the command
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
  // selectedRelease is the FALLBACK for "which Release should the
  // lockfile-generation command target". The lockfile-absent envelope normally
  // names the Release itself, and that answer wins — see generateLockfile. This
  // is consulted only when the envelope carries no Release. It returns the
  // editor's one selected Release, workspace-relative, or null when none is
  // selected, in which case there is nothing to act on and the command does not
  // run. It prompts for nothing: the editor already holds the reader's answer,
  // and asking again here would be a second way to choose a Release.
  selectedRelease: () => string | null;
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

// handleDaemonError routes a daemon-emitted error envelope to the
// surface appropriate for its code:
//
//   1003 (lockfile-absent)        → toast with Generate Lockfile button
//   1004 (entity-not-resolvable)  → Error diagnostic at uri:1:1
//   1005 (daemon-shutting-down)   → output channel log; no UI
//
// Returns true when the code was recognized and handled, false
// otherwise (so the caller can fall through to its existing generic
// logging path).
export function handleDaemonError(err: JsonRpcError, ctx: DaemonErrorContext): boolean {
  switch (err.code) {
    case ERR_LOCKFILE_ABSENT:
      surfaceLockfileToast(ctx, err.message, err.data?.release);
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
    // These surfaces report on the authored documents, so they belong to the
    // document-validation layer. Named through the shared constant rather than
    // spelled out again, so the layer has one name across every producer.
    source: DIAGNOSTIC_SOURCE_FALLBACK,
  };
  ctx.publishShape(ctx.uri, [shape]);
}

// surfaceLockfileToast fires the lockfile-absent toast. release is the Release
// the envelope named, carried through to the action handler so the button acts on
// the Release the diagnostic is about rather than on a separately-resolved one.
// Undefined when the envelope omitted it.
function surfaceLockfileToast(
  ctx: DaemonErrorContext,
  message: string,
  release: string | undefined,
): void {
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
    generateLockfile(ctx, release);
  });
}

// generateLockfile runs `aggrega pull --release <path>` in a terminal. The bare
// command cannot succeed — the CLI marks --release required — so the Release must
// be supplied.
//
// Which Release has exactly one authoritative answer: the one the daemon named in
// the error envelope, which is the Release the failing request asked about. That
// value is used verbatim, never rewritten. The editor's selected Release is
// consulted only when the envelope carries no Release; it is a fallback for a
// missing answer, not a second way of computing the same one, so do not collapse
// the two.
//
// Preferring the envelope also removes a way to be silently wrong: a workspace may
// hold several Releases, and falling back could act on a different one than the
// diagnostic came from — pulling successfully while the diagnostic that raised the
// toast persists.
//
// The path is double-quoted so a value with spaces survives the shell. The
// terminal runs in the workspace root, so a workspace-relative value resolves
// there and an absolute one is already complete.
function generateLockfile(
  ctx: DaemonErrorContext,
  release: string | undefined,
): void {
  // Truthiness rather than ?? on purpose: an empty Release is never a usable
  // target, so it falls through to the selection instead of emitting
  // --release "".
  const target = release || ctx.selectedRelease();
  if (!target) {
    return;
  }
  const terminal = ctx.createTerminal({
    name: 'Aggrega Lockfile',
    cwd: ctx.workspaceRoot,
  });
  terminal.show();
  terminal.sendText(`${LOCKFILE_GENERATE_COMMAND} --release "${target}"`, true);
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

// isJsonRpcError narrows a thrown value to the daemon's error shape. A numeric
// code is the discriminator: the language-server transport always carries one,
// and nothing else the extension throws does.
export function isJsonRpcError(v: unknown): v is JsonRpcError {
  return !!v && typeof v === 'object' && typeof (v as JsonRpcError).code === 'number';
}

// describeError renders any thrown value as one line for a reader.
//
// It is the single home for that conversion across the extension, so a failure
// reaching the reader through the language server and one reaching it through a
// CLI subprocess are worded by the same rule. The daemon branch is the only
// special case, and it is additive: a value carrying no numeric code — every
// CLI failure — falls through to the plain reading, so a caller that will never
// see a transport error loses nothing by going through here.
//
// The message is the thrown value's own text, never a re-wording of it: where
// the failure came from the compiler, that text is the compiler's, and the
// remediation it already names is what the reader needs.
export function describeError(err: unknown): string {
  if (isJsonRpcError(err)) {
    return `code=${err.code} ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
