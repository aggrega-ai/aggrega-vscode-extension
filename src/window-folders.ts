// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';

// appendFolderToWindow adds one folder to the window, after the folders it
// already has open, and answers whether the editor took it.
//
// 🔴 IT IS THE ONE PLACE A FOLDER IS ADDED TO THE WINDOW, and it adds through
// the editor's typed call rather than by running one of the editor's commands by
// name. A command's name is a string nothing checks, so a wrong one fails only
// when a reader presses, and fails silently where the press is not watched. This
// call is checked when the extension is built.
//
// The position is read as the call is made rather than handed in. The editor
// refuses a position past the end of the folders it has, so a count taken
// earlier — before a dialog the reader took their time over — could turn an
// ordinary add into a refusal.
//
// The answer is the editor's own, and it is true once the editor has accepted
// the request rather than once the folder is in. Adding a second folder to a
// window holding one turns the window into a workspace of several folders, which
// the editor does by stopping and restarting every extension, this one included,
// or by reloading the window where the window is remote — so nothing that runs
// after the call can rely on still running.
export function appendFolderToWindow(location: vscode.Uri): boolean {
  return vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders?.length ?? 0,
    null,
    { uri: location },
  );
}
