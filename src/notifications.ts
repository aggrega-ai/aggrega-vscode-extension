// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { DAEMON_READING_WORDS, stoppedRespondingMessage } from './daemon-status';

// notifyStoppedResponding surfaces the bounded-crash-recovery
// stop-state notification. The user recovers through the command that starts
// the language server again, named by the title the caller read from the
// manifest; stoppedRespondingMessage composes the words.
export function notifyStoppedResponding(restartTitle: string | null): void {
  vscode.window.showErrorMessage(stoppedRespondingMessage(restartTitle));
}

// notifyDaemonStartupFailed surfaces a one-shot error when the
// daemon exits during or right after spawn (workspace-config-missing,
// binary-not-found, etc.).
//
// The words for the failure are the welcome page's own for the same state, so
// a reader told here that the server failed to start finds the page saying so
// in the same words.
export function notifyDaemonStartupFailed(reason: string): void {
  vscode.window.showErrorMessage(
    `Aggrega language server ${DAEMON_READING_WORDS.failedToStart}: ${reason}`,
  );
}
