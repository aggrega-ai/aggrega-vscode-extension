// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { describeError } from './error-text';
import * as l10n from './l10n';

// This module says what is wrong when the compiler could not be started — the
// language server, or a command the extension runs — in the words a reader acts
// on. It is the one home for those words: the notification raised when the
// language server fails to start, the warning an operation answers with while it
// is not running, the channel line for a failed start and the row a list panel
// draws when its command could not run all compose them from here.
//
// It reaches no editor type and imports nothing that reaches the language-server
// client, which composes these words for the channel itself.

// BINARY_PATH_SETTING is the setting naming the compiler the extension runs, as
// a reader finds it on the settings screen and types it into a settings file.
export const BINARY_PATH_SETTING = 'aggrega.server.binaryPath';

// OPEN_BINARY_PATH_SETTING_ACTION is the button that takes a reader to that
// setting, wherever a failure to start the compiler is reported with one.
export const OPEN_BINARY_PATH_SETTING_ACTION = l10n.t('Open binary path setting');

// DOWNLOAD_COMPILER_ACTION is the button that downloads a compiler from a
// published release. The welcome page's compiler step carries the same words, so
// a reader told here that nothing was found meets the same offer there.
export const DOWNLOAD_COMPILER_ACTION = l10n.t('Download the compiler');

// CHOOSE_ANOTHER_FILE_ACTION is the button that points the setting at a compiler
// file the reader picks.
export const CHOOSE_ANOTHER_FILE_ACTION = l10n.t('Choose another file');

// StartFailure is a failed attempt to start the compiler: what the attempt
// failed with, and the path it tried to start. The path is kept beside the
// failure rather than read from the settings when the failure is reported,
// because the setting can have moved since the attempt was made.
export interface StartFailure {
  reason: unknown;
  binaryPath: string;
}

// StartFailureCause is why the compiler could not be started, in the cases a
// reader is told apart: the path names nothing, the path names something that
// cannot be run, or anything else.
export type StartFailureCause = 'notFound' | 'notExecutable' | 'other';

// isStartFailure reports whether a thrown value is the runtime's report that a
// program could not be started at all, as opposed to one that started and then
// failed or exited.
//
// 🔴 IT READS THE FIELDS THE RUNTIME ATTACHES, NEVER THE MESSAGE. A failure to
// start carries the system call that failed — the start of the program — and a
// code naming the condition as a string; a program that started and exited
// carries its exit status as a number instead. Reading the message for the same
// distinction would stop working the day the runtime worded it differently.
export function isStartFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') { return false; }
  const fields = err as { code?: unknown; syscall?: unknown };
  return typeof fields.code === 'string'
    && typeof fields.syscall === 'string'
    && (fields.syscall === 'spawn' || fields.syscall.startsWith('spawn '));
}

// startFailureCause reads why the compiler could not be started from the code
// the runtime attached to the failure. Anything that is not a failure to start —
// a program that exited, a handshake that went unanswered — is 'other'.
export function startFailureCause(err: unknown): StartFailureCause {
  if (!isStartFailure(err)) { return 'other'; }
  switch ((err as { code: string }).code) {
    case 'ENOENT':
      return 'notFound';
    case 'EACCES':
      return 'notExecutable';
    default:
      return 'other';
  }
}

// startFailureWords says what is wrong, in one clause: that nothing is at the
// path, that what is there cannot be run, or — for every other failure — the
// runtime's own text, which is all there is to say about it.
export function startFailureWords(failure: StartFailure): string {
  switch (startFailureCause(failure.reason)) {
    case 'notFound':
      return l10n.t('the compiler at {0} was not found', failure.binaryPath);
    case 'notExecutable':
      return l10n.t('{0} is not an executable file', failure.binaryPath);
    case 'other':
      return describeError(failure.reason);
  }
}

// startFailureReason is what is wrong followed by what to do about it, and it
// names the setting in both cases. Where the path is the fault, the remedy is to
// point the setting at the compiler. Where the cause is something else, the
// runtime's text comes first and the sentence after it says which compiler was
// run and which setting names it, so a reader can tell whether it is the one
// they meant.
export function startFailureReason(failure: StartFailure): string {
  const words = startFailureWords(failure);
  if (startFailureCause(failure.reason) === 'other') {
    return l10n.t('{0}. {1} names the compiler it runs, {2}.', withoutClosingStop(words), BINARY_PATH_SETTING, failure.binaryPath);
  }
  return l10n.t('{0}. Set {1} to the aggrega binary.', words, BINARY_PATH_SETTING);
}

// startFailureActions is what a notification of a failure to start offers, in
// the order it offers it.
//
// 🔴 ONLY A PATH NAMING NOTHING IS OFFERED A DOWNLOAD. There is then no compiler
// to replace, so getting one and choosing another file are both ways forward. A
// path naming a file that cannot be run names a file the reader put there, and
// a download offered beside it would read as an offer to replace it, which the
// extension never does — so that failure, like every other, offers the setting
// alone.
export function startFailureActions(failure: StartFailure): string[] {
  if (startFailureCause(failure.reason) === 'notFound') {
    return [DOWNLOAD_COMPILER_ACTION, CHOOSE_ANOTHER_FILE_ACTION, OPEN_BINARY_PATH_SETTING_ACTION];
  }
  return [OPEN_BINARY_PATH_SETTING_ACTION];
}

// withoutClosingStop drops the one full stop a runtime's text may already end
// in, so the sentence after it does not follow two.
function withoutClosingStop(text: string): string {
  return text.endsWith('.') ? text.slice(0, -1) : text;
}
