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
import { refusalCondition } from './error-text';
import { operationLabel } from './operation-groups';

// LOCKFILE_PULL_ACTION is the action the missing-lockfile notice offers, and it
// is the Commands panel's own Pull, named as that panel names it. Pressing it runs
// that operation rather than a command of its own: the configured binary, behind
// the progress indicator a reader can stop, ending in its own sentence. A command
// typed into a terminal instead would run whatever `aggrega` that terminal's path
// finds, which need not be the compiler the extension is working with.
export const LOCKFILE_PULL_ACTION = operationLabel('pull');

// WhoAsked says whether the reader asked for the work a refusal answers.
//
// 'reader' is a request they made — a build, a preview, a graph they opened — and
// the refusal of one is always put in front of them: it is the answer to what they
// pressed, and holding it back would leave them refused with no way past it.
// 'nobody' is work the extension did on its own — a graph redrawn after a save, a
// document validated as it is edited — and a notice about it that the reader has
// just been shown is held back for as long as the notification settings say.
//
// 🔴 THE CALLER STATES IT, BECAUSE THE CALLER IS THE ONE PLACE THAT KNOWS. A
// refusal carries the same code and the same payload whoever started the work, so
// nothing in it says whether a press started the work, and reading that off the
// refusal's words would be a guess that changes meaning when the compiler rewords a
// sentence.
export type WhoAsked = 'reader' | 'nobody';

// DaemonErrorRouting is what routing a refusal did, for the caller deciding what is
// left for it to say.
//
//   'unrecognised' — the code is not one routed here, so the caller surfaces it.
//   'surfaced'     — it was put on a surface other than a notification: a
//                    diagnostic, or a line on the output channel. The caller still
//                    owes the reader its own ending.
//   'notified'     — a notification carrying the refusal is in front of the reader,
//                    so the caller raises no second one for the same fault.
export type DaemonErrorRouting = 'unrecognised' | 'surfaced' | 'notified';

// ToastDebounceMode picks how a notice the reader has just been shown is held
// back when it comes round again for work nobody asked for. `session` shows it
// once until the language server restarts. `time` shows it again once
// toastThrottleSeconds have passed since the previous one closed — pressed,
// dismissed, or put away by the editor.
export type ToastDebounceMode = 'time' | 'session';

// DaemonErrorContext carries the surfaces the per-code dispatcher
// writes into. Injecting the surfaces (rather than reaching into
// module-level singletons or vscode runtime) keeps the dispatcher
// testable: tests pass fakes for every field.
export interface DaemonErrorContext {
  uri: vscode.Uri;
  // whoAsked is whether the reader asked for the work this refusal answers. It
  // decides whether a notice may be held back, whether it is raised as an error
  // or as information, and whether the channel line is written here or by the
  // operation that ends — see surfaceLockfileNotice.
  whoAsked: WhoAsked;
  publishShape: (uri: vscode.Uri, shapes: ConvertedShape[]) => void;
  logLine: (line: string) => void;
  // notify raises a notification of the given kind carrying the given actions,
  // and settles with the action pressed, or undefined when it closed without one.
  notify: (kind: 'error' | 'info', message: string, ...items: string[]) => Thenable<string | undefined>;
  // pull runs the Commands panel's Pull for the named Release. Given null it acts
  // on the selected Release, exactly as that panel's own button does.
  pull: (release: string | null) => void;
  // selectedRelease is the FALLBACK for "which Release is the missing lockfile
  // about". The lockfile-absent envelope normally names the Release itself, and
  // that answer wins — see surfaceLockfileNotice. This is consulted only when the
  // envelope carries no Release. It returns the editor's one selected Release,
  // workspace-relative, or null when none is selected. It prompts for nothing: the
  // editor already holds the reader's answer, and asking again here would be a
  // second way to choose a Release.
  selectedRelease: () => string | null;
  // toastDebounce records, per code, when a notice was last shown. In `session`
  // mode the value is true once one has been shown, until resetSessionDedup runs
  // on a restart of the language server. In `time` mode it is the wall-clock time
  // the previous notice closed at; one is shown again once
  // (now() - previous) > toastThrottleSeconds*1000.
  toastDebounce: Map<number, true | number>;
  // toastDebounceMode picks between the two readings described above.
  toastDebounceMode: ToastDebounceMode;
  // toastThrottleSeconds is the window for the time-based reading. Consulted only
  // when toastDebounceMode === 'time'.
  toastThrottleSeconds: number;
  // now returns the current wall-clock millisecond timestamp. A
  // test seam: production passes () => Date.now(); tests pass a
  // controlled clock.
  now: () => number;
}

// handleDaemonError routes a daemon-emitted error envelope to the
// surface appropriate for its code:
//
//   1003 (lockfile-absent)        → the missing-lockfile notice, offering Pull
//   1004 (entity-not-resolvable)  → Error diagnostic at uri:1:1
//   1005 (daemon-shutting-down)   → output channel log; no UI
//
// It is the one place a refusal's code decides its surface, and it reports what it
// did so the caller knows what is left to say — see DaemonErrorRouting. Which
// refusals are an entry on a document is decided by refusalEntry, which the
// filing of a build's, a preview's or a graph's refusal reads as well.
//
// The diagnostic carries the compiler's words and nothing ahead of them. The
// name of the code is how the transport classifies the refusal, not something a
// reader can act on, and the same code reaches here for causes it does not name —
// a catalog directory that could not be read among them.
export function handleDaemonError(err: JsonRpcError, ctx: DaemonErrorContext): DaemonErrorRouting {
  const entry = refusalEntry(err);
  if (entry) {
    ctx.publishShape(ctx.uri, [entry]);
    return 'surfaced';
  }
  switch (err.code) {
    case ERR_LOCKFILE_ABSENT:
      return surfaceLockfileNotice(ctx, err.message, err.data?.release);
    case ERR_SHUTTING_DOWN:
      ctx.logLine(`[shutting down] ${err.message}`);
      return 'surfaced';
    default:
      return 'unrecognised';
  }
}

// refusalEntry is the entry a refusal is filed as on the document it is about,
// or undefined for a refusal whose surface is not an entry on a document. A
// refusal of entity-not-resolvable is the one that is.
//
// It decides the entry and nothing about where it is kept: a refusal of a
// document's own request is kept beside that document's validation findings,
// and one of a build, a preview or a graph is kept apart from them, so a
// document's close and its next validation do not take it away.
export function refusalEntry(err: JsonRpcError): ConvertedShape | undefined {
  if (err.code !== ERR_ENTITY_NOT_RESOLVABLE) {
    return undefined;
  }
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
  return {
    startLine: line,
    startChar: character,
    endLine: hasEnd ? daemonEndLine - 1 : line,
    endChar: hasEnd ? daemonEndColumn - 1 : character,
    severity: 'error',
    message: err.message,
    // The entry carries the document-validation layer's name whoever asked, so
    // what a reader sees on it is the same for a refused build as for a refused
    // validation. Named through the shared constant rather than spelled out
    // again, so the layer has one name across every producer.
    source: DIAGNOSTIC_SOURCE_FALLBACK,
    // The condition the refusal names, read from its data's fields, so the short
    // code the Problems panel shows beside the entry is the one the compiler
    // identified the refusal by rather than one read off its message. A refusal
    // naming no condition adds neither key, and its entry is what it was before
    // the fields existed.
    ...refusalCondition(err),
  };
}

// refusalDocument names the document a refusal is about: the first artifact
// the envelope names, or fallbackPath — the subject of the request refused —
// where it names none, and the empty string where neither names anything.
//
// It is read off the envelope's own artifact fields and never off its code. Each
// of those fields names one artifact and only that artifact, so the first one
// present IS the document the failure is about; branching on the code to decide
// would re-derive, from a second source, something the payload already states.
// The value is as the envelope wrote it, relative to the workspace root or
// absolute.
export function refusalDocument(err: JsonRpcError, fallbackPath: string): string {
  // Truthiness rather than ?? on purpose: an empty path names no document, so
  // it must fall through to the next candidate instead of resolving to the
  // workspace root itself.
  return err.data?.file || err.data?.lockfile || fallbackPath;
}

// lockfileNotice composes the one notice a missing lockfile is answered with:
// which Release has none, then the compiler's sentence exactly as it wrote it.
//
// That sentence already says what to run, and the notice's Pull runs it, so
// nothing is added beside it — no command of the extension's own, no transport
// code in front of it, and no account of whether a notice was held back before.
// Where no Release can be named, the notice says "the Release" rather than
// inventing one.
export function lockfileNotice(release: string | null, message: string): string {
  return `Aggrega: ${release || 'the Release'} has no lockfile. ${message}`;
}

// surfaceLockfileNotice answers a lockfile-absent refusal. named is the Release the
// envelope named, or undefined when it omitted one.
//
// Which Release has exactly one authoritative answer: the one the daemon named in
// the envelope, which is the Release the refused request asked about. That value is
// used verbatim, never rewritten, and it is settled here, once, so the Release the
// notice names is the one its Pull pulls. The editor's selected Release is
// consulted only when the envelope carries no Release; it is a fallback for a
// missing answer, not a second way of computing the same one. Preferring the
// envelope removes a way to be silently wrong: a workspace may hold several
// Releases, and pulling another one would succeed while the refusal stood.
//
// 🔴 A REFUSAL THE READER ASKED FOR IS NEVER HELD BACK, AND IT IS RAISED AS AN
// ERROR. It is the answer to what they pressed, so it is the one notification for
// the fault — the caller raises none of its own beside it — and the editor keeps an
// error that carries an action on screen until the reader acts on it or puts it
// away, where an informational notice leaves on its own after a few seconds. The
// channel line for it is the caller's, written as that operation ends.
//
// A refusal nobody asked for raises the same notice, informational, and it is held
// back while the reader has just been shown it (shouldShowNotice). Either way the
// channel carries the compiler's sentence and nothing about whether a notice was
// shown: which notices were held back is this module's own bookkeeping, and it
// tells a reader nothing about their workspace.
function surfaceLockfileNotice(
  ctx: DaemonErrorContext,
  message: string,
  named: string | undefined,
): DaemonErrorRouting {
  // Truthiness rather than ?? on purpose: an empty Release names nothing, so it
  // falls through to the selection rather than being carried as the Release.
  const release = named || ctx.selectedRelease();
  const notice = lockfileNotice(release, message);
  if (ctx.whoAsked === 'reader') {
    noticeShown(ctx);
    offerPull(ctx, ctx.notify('error', notice, LOCKFILE_PULL_ACTION), release);
    return 'notified';
  }
  ctx.logLine(message);
  if (!shouldShowNotice(ctx, ERR_LOCKFILE_ABSENT)) {
    return 'surfaced';
  }
  noticeShown(ctx);
  offerPull(ctx, ctx.notify('info', notice, LOCKFILE_PULL_ACTION), release);
  return 'notified';
}

// noticeShown records that the missing-lockfile notice is on screen, before it has
// closed, so a refusal nobody asked for arriving while it is still up is held back
// rather than drawn on top of it. In `time` mode the record moves to the moment the
// notice closes (offerPull), which is where the window starts.
//
// A notice the reader asked for is recorded too. It is shown whatever the record
// says, but once the reader has been told, repeating it for a redraw nobody asked
// for tells them nothing new.
function noticeShown(ctx: DaemonErrorContext): void {
  if (ctx.toastDebounceMode === 'session') {
    ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, true);
  } else {
    ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, ctx.now());
  }
}

// offerPull waits for the notice to close and runs the Pull where it was pressed,
// for the Release the notice named — null where it could name none, which the Pull
// answers as the Commands panel's own button does.
function offerPull(
  ctx: DaemonErrorContext,
  shown: Thenable<string | undefined>,
  release: string | null,
): void {
  void shown.then((choice) => {
    // The window starts when the notice closes, however it closed: an action
    // pressed, the close button, or the editor putting it away.
    if (ctx.toastDebounceMode === 'time') {
      ctx.toastDebounce.set(ERR_LOCKFILE_ABSENT, ctx.now());
    }
    if (choice === LOCKFILE_PULL_ACTION) {
      ctx.pull(release);
    }
  });
}

// shouldShowNotice applies the notification settings to a notice for work nobody
// asked for. Returns true when it should be shown; false while the reader has just
// been shown it.
function shouldShowNotice(ctx: DaemonErrorContext, code: number): boolean {
  const previous = ctx.toastDebounce.get(code);
  if (previous === undefined) {
    return true;
  }
  if (ctx.toastDebounceMode === 'session') {
    // previous === true → hold it back; no other value is meaningful in
    // session mode (noticeShown only writes `true` there).
    return false;
  }
  // time mode: previous is the wall-clock time the prior notice closed at.
  // previous === true would only appear if the reader switched modes while the
  // server ran; it is read as expired, so the next notice is shown and records
  // the time afresh.
  if (previous === true) {
    return true;
  }
  return ctx.now() - previous > ctx.toastThrottleSeconds * 1000;
}

// resetSessionDedup clears the per-code notice records. Called by extension.ts
// whenever the daemon starts or restarts so the reader is shown each notice again
// after a fix.
export function resetSessionDedup(dedup: Map<number, true | number>): void {
  dedup.clear();
}

// isJsonRpcError, describeError and refusalCondition are declared in error-text,
// which imports nothing at runtime so the language-server client can reach them
// too, and are offered here as well because this is where every surface
// reporting a refusal already imports from.
export { describeError, isJsonRpcError, refusalCondition } from './error-text';
