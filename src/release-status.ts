// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as vscode from 'vscode';
import {
  SELECT_RELEASE_COMMAND,
  SelectionState,
  describeSelection,
} from './release-selection';

// DisposableLike is the dispose contract the indicator registers against —
// the status-bar item joins the extension's disposable registry through it.
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
// uses: the disposable registry its item joins.
export interface ReleaseStatusContext {
  subscriptions: DisposableLike[];
}

// ReleaseStatusDeps supplies the anchored workspace root, the editor's current
// Release selection, and the status-bar surface the indicator drives.
export interface ReleaseStatusDeps {
  getWorkspaceRoot(): string | null;
  // selectionState reports the editor's one selected Release. The indicator
  // renders this and derives nothing of its own: the selection is what travels
  // on every request, so displaying anything else — a configuration key, the
  // marker file on disk, a fresh reading of the workspace — would name a
  // Release the compiler is not being asked about. That an input to the
  // workspace's default reading names a different Release whenever a
  // higher-precedence input won is exactly why reading one here is wrong, and
  // that reasoning survives the selection moving into this client unchanged.
  selectionState(): SelectionState;
  // offerableReleases reports how many Releases the last enumeration could
  // name, or null where none has produced an answer.
  //
  // The indicator takes it for the same reason the panel row does: with nothing
  // selected, an explanation that says to choose one is the wrong sentence in a
  // workspace that offers none, and the reader cannot tell the two apart from
  // the indicator alone. Both surfaces read one description, so telling them
  // apart on one of them and not the other would be the two saying different
  // things about one state.
  offerableReleases(): number | null;
  // createStatusBarItem builds the item the indicator drives.
  createStatusBarItem(): StatusBarItemLike;
  // onSelectionChange registers a listener fired whenever the selection
  // changes, so the indicator re-renders without polling.
  onSelectionChange(listener: () => void): void;
}

// ReleaseStatus is the handle the extension holds to re-render the indicator on
// events the selection itself does not announce — the workspace anchor
// changing, and the language server stopping.
export interface ReleaseStatus {
  refresh(): void;
  hide(): void;
}

// activateReleaseStatus creates the status-bar item that shows which Release
// the editor has selected and, on click, runs the command that selects a
// different one.
//
// The indicator displays the selection every request carries, so what the
// operator reads is the Release the compiler is being asked about. It has three
// states: the selected Release, no Release selected for this workspace, and —
// when the language server is not answering — unknown.
export function activateReleaseStatus(
  context: ReleaseStatusContext,
  deps: ReleaseStatusDeps,
): ReleaseStatus {
  const item = deps.createStatusBarItem();
  // The command is read from the module that owns the choice it opens, so this
  // indicator and every other surface offering the same choice cannot come to
  // run two different commands. It makes the indicator both where the current
  // answer is displayed and where a different one is chosen.
  item.command = SELECT_RELEASE_COMMAND;
  context.subscriptions.push(item);

  const refresh = (): void => {
    if (!deps.getWorkspaceRoot()) {
      item.hide();
      return;
    }
    const { label, detail } = describeSelection(
      deps.selectionState(),
      deps.offerableReleases(),
    );
    item.text = `$(rocket) ${label}`;
    item.tooltip = detail;
    item.show();
  };

  deps.onSelectionChange(refresh);

  refresh();
  return { refresh, hide: () => item.hide() };
}
