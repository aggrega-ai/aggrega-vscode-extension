// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { CancellationSignal } from './cancellation';

// This module is the extension's one progress-and-cancel presentation.
//
// A reader pressing cancel must not have to know which transport an operation
// happens to use. The two differ entirely underneath — over the language server
// stopping is a notification naming the request's id, over a subprocess it is
// terminating the child — and neither difference reaches the surface: both
// arrive here, both draw the same indicator, and both offer the same button. An
// operation moved from one transport to the other therefore changes nothing a
// reader sees, which is what keeps that move from being a surface change.

// withCancellableProgress runs work behind a progress indicator carrying a
// cancel button, and hands the work the reader's signal.
//
// The indicator sits with the notifications rather than in the status bar,
// because the button has to be reachable: a status-bar indicator can show that
// something is happening but gives a reader nothing to press.
//
// Nothing is caught here. Whatever the work settles with — its answer, the
// stopped-by-the-reader rejection, or the compiler's own failure — reaches the
// caller unchanged, because the caller is what knows how to word the ending.
export function withCancellableProgress<T>(
  title: string,
  work: (signal: CancellationSignal) => Promise<T>,
): Promise<T> {
  return Promise.resolve(
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      (_progress, token) => work(token),
    ),
  );
}
