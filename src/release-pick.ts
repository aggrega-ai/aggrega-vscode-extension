// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';

// ResolveReleaseOptions tunes the quick-pick prompt for the multi-Release case.
export interface ResolveReleaseOptions {
  placeHolder?: string;
}

// resolveRelease is the single source for "which Release does this action act
// on": the sole candidate when there is exactly one, a quick-pick when there
// are several. It surfaces the standard messages for a not-running daemon
// (listReleases throws) and an empty workspace, and returns undefined in every
// case where the caller should not proceed (no daemon, no Release, or the user
// dismissed the pick). Every Release-scoped surface — the operation commands,
// the graph view, the lockfile-generation button — routes through here so the
// resolution rule and its wording never diverge.
export async function resolveRelease(
  listReleases: () => Promise<string[]>,
  options?: ResolveReleaseOptions,
): Promise<string | undefined> {
  let releases: string[];
  try {
    releases = await listReleases();
  } catch {
    void vscode.window.showErrorMessage(
      'Aggrega: cannot list Releases — the language server is not running. Start it and try again.',
    );
    return undefined;
  }
  if (releases.length === 0) {
    void vscode.window.showInformationMessage('Aggrega: no Release found in this workspace.');
    return undefined;
  }
  if (releases.length === 1) {
    return releases[0];
  }
  return vscode.window.showQuickPick(releases, {
    placeHolder: options?.placeHolder ?? 'Aggrega: choose a Release',
  });
}
