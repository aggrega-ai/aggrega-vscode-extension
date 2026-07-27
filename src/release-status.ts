// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import * as vscode from 'vscode';

import { readActiveReleaseMarker } from './release-actions';

// ReleaseStatusDeps supplies the anchored workspace root; the indicator reads
// the active-release marker under it.
export interface ReleaseStatusDeps {
  getWorkspaceRoot(): string | null;
}

// ReleaseStatus is the handle the extension holds to refresh the indicator on
// events the marker watcher cannot see on its own — daemon (re)start and
// workspace-anchor changes.
export interface ReleaseStatus {
  refresh(): void;
  hide(): void;
}

// activateReleaseStatus creates the status-bar item that shows the workspace's
// active Release and, on click, runs the existing switch flow (choose a Release
// → write the marker → restart the daemon). It reads the marker the switch flow
// writes, so the indicator and the switch share one source of truth; a file
// watcher keeps it live when the marker changes outside the click path.
export function activateReleaseStatus(
  context: vscode.ExtensionContext,
  deps: ReleaseStatusDeps,
): ReleaseStatus {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  // Reuse the existing marker-writing command as the click action, so the
  // indicator adds no second switch path.
  item.command = 'aggrega.workspace.createActiveReleaseMarker';
  context.subscriptions.push(item);

  const refresh = (): void => {
    const root = deps.getWorkspaceRoot();
    if (!root) {
      item.hide();
      return;
    }
    void readActiveReleaseMarker(root).then((active) => {
      if (active) {
        item.text = `$(rocket) ${path.basename(active)}`;
        item.tooltip = `Aggrega active Release: ${active}\nClick to switch`;
      } else {
        item.text = '$(rocket) Release: default';
        item.tooltip =
          'Aggrega: no active-release marker set — the daemon auto-resolves the Release. Click to pin one.';
      }
      item.show();
    });
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/.aggrega/active-release');
  watcher.onDidChange(refresh);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(watcher);

  refresh();
  return { refresh, hide: () => item.hide() };
}
