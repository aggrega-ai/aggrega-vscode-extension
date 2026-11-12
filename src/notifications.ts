// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import {
  DaemonStanding,
  RESTART_COMMAND,
  notRunningWarning,
  startFailedMessage,
  stoppedRespondingMessage,
} from './daemon-status';
import { SHOW_OUTPUT_ACTION } from './operation-outcome';
import { binaryPathSettingPress } from './settings';
import { DOWNLOAD_COMPILER_COMMAND, LOCATE_COMPILER_COMMAND } from './get-started-steps';
import {
  CHOOSE_ANOTHER_FILE_ACTION,
  DOWNLOAD_COMPILER_ACTION,
  OPEN_BINARY_PATH_SETTING_ACTION,
  StartFailure,
  startFailureActions,
} from './start-failure';

// notifyStoppedResponding surfaces the bounded-crash-recovery
// stop-state notification. The user recovers through the command that starts
// the language server again, named by the title the caller read from the
// manifest; stoppedRespondingMessage composes the words.
export function notifyStoppedResponding(restartTitle: string | null): void {
  vscode.window.showErrorMessage(stoppedRespondingMessage(restartTitle));
}

// notifyDaemonStartupFailed surfaces a one-shot error when the language server
// could not be started — the compiler not found or not runnable at the path the
// setting names, or a server that ended or went unanswered before it was up.
//
// The words for the failure are the welcome page's own for the same state, so
// a reader told here that the server failed to start finds the page saying so
// in the same words; startFailedMessage says what is wrong after them. It offers
// the setting naming the compiler, which is what to change when the path is the
// fault, and the output, which carries the server's own account when it is not.
//
// Where the path names nothing it also offers to download a compiler and to
// choose another file, each through the command the welcome page's compiler step
// runs for the same act, so the two surfaces cannot come to do it differently.
export function notifyDaemonStartupFailed(failure: StartFailure, showOutput: () => void): void {
  void vscode.window.showErrorMessage(
    startFailedMessage(failure),
    ...startFailureActions(failure),
    SHOW_OUTPUT_ACTION,
  ).then((choice) => {
    if (choice === OPEN_BINARY_PATH_SETTING_ACTION) {
      openBinaryPathSetting();
    } else if (choice === DOWNLOAD_COMPILER_ACTION) {
      void vscode.commands.executeCommand(DOWNLOAD_COMPILER_COMMAND);
    } else if (choice === CHOOSE_ANOTHER_FILE_ACTION) {
      void vscode.commands.executeCommand(LOCATE_COMPILER_COMMAND);
    } else if (choice === SHOW_OUTPUT_ACTION) {
      showOutput();
    }
  });
}

// warnNotRunning answers an operation that asks the language server a question
// while none is running. notRunningWarning composes the sentence and the
// buttons; each button, pressed, does what it says.
export function warnNotRunning(
  lastFailure: StartFailure | null,
  standing: DaemonStanding,
  showOutput: () => void,
): void {
  const warning = notRunningWarning(lastFailure, standing);
  void vscode.window.showWarningMessage(warning.message, ...warning.actions).then((choice) => {
    if (choice === SHOW_OUTPUT_ACTION) {
      showOutput();
    } else if (choice === OPEN_BINARY_PATH_SETTING_ACTION) {
      openBinaryPathSetting();
    } else if (choice === warning.start) {
      void vscode.commands.executeCommand(RESTART_COMMAND);
    }
  });
}

// openBinaryPathSetting opens the settings screen on the setting naming the
// compiler, by the one composition of that act.
function openBinaryPathSetting(): void {
  const press = binaryPathSettingPress();
  void vscode.commands.executeCommand(press.command, ...(press.arguments ?? []));
}
