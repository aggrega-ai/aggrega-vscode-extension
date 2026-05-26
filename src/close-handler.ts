// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as vscode from 'vscode';
import { InvalidateParams } from './types';

// CloseHandlerDeps carries the surfaces applyDocumentClose writes
// into. Injecting them (rather than reaching into module-level
// singletons or vscode runtime) keeps the handler testable: tests
// pass fakes for each field.
export interface CloseHandlerDeps {
  diagnosticCollection: vscode.DiagnosticCollection | null;
  daemonRequest:
    | ((method: string, params: InvalidateParams) => Promise<unknown>)
    | null;
  logLine: (line: string) => void;
  describeError: (err: unknown) => string;
}

// applyDocumentClose runs the close-handler logic for a single
// closed document URI. Two steps:
//
//   1. Synchronously clear the per-URI diagnostic-collection entry
//      so squiggles disappear immediately on close.
//   2. Fire-and-forget aggrega/invalidate with granularity: "file"
//      so the daemon's per-file parse + diagnostic caches drop for
//      this URI without dropping the workspace-level cache.
//
// The two operations are independent (no correctness coupling); the
// local clear precedes the daemon call so UX latency is bounded by
// VS Code's own dispatch and a daemon-call failure leaves the local
// state already clean.
//
// The daemon call is fire-and-forget: its response carries no data
// the extension needs, and a missed invalidate is harmless (the
// daemon's cache stays slightly populated; the next aggrega/validate
// refreshes the entry via mtime-on-access eviction). The .catch
// logs the failure for observability; there is no retry or
// user-visible error surface.
export function applyDocumentClose(
  uri: vscode.Uri,
  fsPath: string,
  deps: CloseHandlerDeps,
): void {
  deps.diagnosticCollection?.delete(uri);
  if (!deps.daemonRequest) {
    return;
  }
  deps.daemonRequest('aggrega/invalidate', {
    file: fsPath,
    granularity: 'file',
  }).catch(err => {
    deps.logLine(`invalidate (didClose) failed: ${deps.describeError(err)}`);
  });
}
