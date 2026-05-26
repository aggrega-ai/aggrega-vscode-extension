// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';

// CacheMissDecision is the user's response to the cache-miss
// notification: Revalidate triggers a fresh validate+retry, Dismiss
// abandons the original request.
export type CacheMissDecision = 'revalidate' | 'dismiss';

// promptCacheMiss surfaces the Mode A cache-miss notification and
// returns the user's decision. Used when aggrega.server.autoRevalidate
// is false (the default).
export async function promptCacheMiss(file: string): Promise<CacheMissDecision> {
  const choice = await vscode.window.showInformationMessage(
    `Aggrega has no cached state for ${file}. Revalidate?`,
    'Revalidate',
  );
  return choice === 'Revalidate' ? 'revalidate' : 'dismiss';
}

// notifyStoppedResponding surfaces the bounded-crash-recovery
// stop-state notification. The user recovers via the Aggrega:
// Restart language server command.
export function notifyStoppedResponding(): void {
  vscode.window.showErrorMessage(
    'Aggrega language server has stopped responding. Run "Aggrega: Restart language server" to recover.',
  );
}

// notifyDaemonStartupFailed surfaces a one-shot error when the
// daemon exits during or right after spawn (workspace-config-missing,
// binary-not-found, etc.).
export function notifyDaemonStartupFailed(reason: string): void {
  vscode.window.showErrorMessage(`Aggrega language server failed to start: ${reason}`);
}
