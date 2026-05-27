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
  'The Generate Lockfile button runs `aggrega pull` — pulls catalog dependencies into the cache and writes the per-Release lockfile.';

// LOCKFILE_TOAST_BUTTON is the label of the actionable button on
// the 1003 toast. The handler matches against this literal.
const LOCKFILE_TOAST_BUTTON = 'Generate Lockfile';

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
  // toastDedup tracks which error codes already surfaced a toast in
  // this daemon session. Session-based per-code debounce avoids
  // toast spam on repeated errors of the same kind while the user
  // is mid-fix. The caller (extension.ts) owns the Map and clears
  // it on daemon start/restart via resetSessionDedup.
  toastDedup: Map<number, true>;
}

// handleDaemonError routes a daemon-emitted error envelope to the
// surface appropriate for its code:
//
//   1002 (release-not-resolved)   → Error diagnostic at uri:1:1
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
      surfaceDiagnostic(ctx, err, `Release not resolved: ${err.message}`);
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
  // populate {file, line, column} with 1-based positions. Missing
  // or zero values produce a file:1:1 fallback (start of file).
  // The 1-based-to-0-based conversion mirrors diagnostics-shape.ts.
  const daemonLine = err.data?.line ?? 0;
  const daemonColumn = err.data?.column ?? 0;
  const line = daemonLine > 0 ? daemonLine - 1 : 0;
  const character = daemonColumn > 0 ? daemonColumn - 1 : 0;
  const shape: ConvertedShape = {
    startLine: line,
    startChar: character,
    endLine: line,
    endChar: character,
    severity: 'error',
    message,
    source: 'aggrega',
  };
  ctx.publishShape(ctx.uri, [shape]);
}

function surfaceLockfileToast(ctx: DaemonErrorContext, message: string): void {
  if (ctx.toastDedup.has(ERR_LOCKFILE_ABSENT)) {
    // Already shown once this daemon session; log for traceability
    // and skip the toast to avoid spamming the user.
    //
    // Known UX edge case: a user who dismisses the first toast
    // without clicking the action button gets no further visible
    // reminder until daemon restart. The output-channel log still
    // records every emission, but the user has to look. Time-based
    // re-firing or button-vs-dismissal differentiation are
    // documented alternatives.
    ctx.logLine(`[lockfile absent] ${message} (toast suppressed; already shown this session)`);
    return;
  }
  ctx.toastDedup.set(ERR_LOCKFILE_ABSENT, true);
  ctx.logLine(`[lockfile absent] ${message}`);
  void ctx.toastInfo(
    `Aggrega: lockfile missing. ${message}. ${LOCKFILE_GENERATE_TOOLTIP}`,
    LOCKFILE_TOAST_BUTTON,
  ).then(choice => {
    if (choice !== LOCKFILE_TOAST_BUTTON) {
      return;
    }
    const terminal = ctx.createTerminal({
      name: 'Aggrega Lockfile',
      cwd: ctx.workspaceRoot,
    });
    terminal.show();
    terminal.sendText(LOCKFILE_GENERATE_COMMAND, true);
  });
}

// resetSessionDedup clears the per-code debounce state. Called by
// extension.ts whenever the daemon starts or restarts so the
// operator gets a fresh chance to see each toast after a fix.
export function resetSessionDedup(dedup: Map<number, true>): void {
  dedup.clear();
}
