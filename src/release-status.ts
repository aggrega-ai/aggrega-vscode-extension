// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import type * as vscode from 'vscode';

// DisposableLike is the dispose contract the indicator registers against —
// the status-bar item and the marker watcher both join the extension's
// disposable registry through it.
export interface DisposableLike {
  dispose(): unknown;
}

// StatusBarItemLike is the slice of the editor's status-bar item the indicator
// drives. Injecting the surfaces it writes into (rather than reaching for the
// editor runtime) is what makes the indicator's display states directly
// testable: a test passes a recorder and reads back exactly the text an
// operator would have seen.
export interface StatusBarItemLike extends DisposableLike {
  text: string;
  // tooltip and command mirror the editor item's own field types so a real
  // item satisfies this interface unchanged. The indicator only ever writes a
  // plain string into either.
  tooltip: vscode.StatusBarItem['tooltip'];
  command: vscode.StatusBarItem['command'];
  show(): void;
  hide(): void;
}

// ReleaseStatusContext is the slice of the extension context the indicator
// uses: the disposable registry its item and watcher join.
export interface ReleaseStatusContext {
  subscriptions: DisposableLike[];
}

// ReleaseStatusDeps supplies the anchored workspace root, the query that
// answers which Release is active, and the two editor surfaces the indicator
// drives.
export interface ReleaseStatusDeps {
  getWorkspaceRoot(): string | null;
  // requestActiveRelease asks the language server which Release it resolved
  // for this workspace. The server is the single source for that answer,
  // because it is what runs the resolution: an input to that resolution names
  // a different Release whenever a higher-precedence input won, so reading one
  // here would report a Release the compiler is not using.
  //
  // Resolves to the absolute path of the active Release, or to the empty
  // string when the workspace has none. Rejects when the language server is
  // not running — the indicator then shows that the answer is unknown rather
  // than deriving one of its own.
  requestActiveRelease(): Promise<string>;
  // createStatusBarItem builds the item the indicator drives.
  createStatusBarItem(): StatusBarItemLike;
  // watchActiveReleaseMarker registers onChange against edits to the
  // workspace's active-release marker and returns the watcher's disposable.
  // The indicator never reads the marker: an edit to it is a hint that the
  // resolved Release may be about to change, so the callback re-asks the
  // language server rather than reading the file.
  watchActiveReleaseMarker(onChange: () => void): DisposableLike;
}

// ReleaseStatus is the handle the extension holds to refresh the indicator on
// events the marker watcher cannot see on its own — language-server
// (re)start and workspace-anchor changes.
export interface ReleaseStatus {
  refresh(): void;
  hide(): void;
}

// activateReleaseStatus creates the status-bar item that shows which Release
// the workspace resolved and, on click, runs the existing switch flow (choose
// a Release → write the marker → restart the server).
//
// The indicator displays the server's own answer, so what the operator reads
// is the Release the compiler will act on. It has three states: the resolved
// Release, no Release resolved for this workspace, and — when the server is
// not answering — unknown.
export function activateReleaseStatus(
  context: ReleaseStatusContext,
  deps: ReleaseStatusDeps,
): ReleaseStatus {
  const item = deps.createStatusBarItem();
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
    void deps.requestActiveRelease().then(
      (active) => {
        if (active) {
          item.text = `$(rocket) ${path.basename(active)}`;
          item.tooltip = `Aggrega active Release: ${active}\nClick to switch`;
        } else {
          item.text = '$(rocket) Release: none';
          item.tooltip =
            'Aggrega: no active Release resolved for this workspace. Click to pin one.';
        }
        item.show();
      },
      () => {
        item.text = '$(rocket) Release: unavailable';
        item.tooltip =
          'Aggrega: the language server is not running, so which Release is active is unknown.';
        item.show();
      },
    );
  };

  context.subscriptions.push(deps.watchActiveReleaseMarker(refresh));

  refresh();
  return { refresh, hide: () => item.hide() };
}
