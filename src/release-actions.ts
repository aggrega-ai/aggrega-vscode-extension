// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  ACTIVE_RELEASE_MARKER_BASENAME,
  AGGREGA_DIR,
  CONFIG_FILENAME,
  activeReleaseMarkerPath,
} from './workspace';

// CONFIG_TEMPLATE is what openAuthoringReleaseConfig writes when no
// .aggrega-config.yaml exists at the workspace root. The cursor is
// positioned on the empty value line so the user types the Release
// path immediately without navigating.
const CONFIG_TEMPLATE = `build:
  authoring_release:
`;

// openAuthoringReleaseConfig opens the workspace-root
// .aggrega-config.yaml. When the file does not exist, creates it
// from CONFIG_TEMPLATE and positions the cursor on the empty value
// line; when it exists, navigates the cursor to the
// build.authoring_release key if present, else opens the file and
// leaves the cursor at the document start.
//
// workspaceRoot is the absolute path the daemon used as its anchor;
// the helper writes the config there. Filesystem write failures
// surface as error toasts rather than crashing.
export async function openAuthoringReleaseConfig(workspaceRoot: string): Promise<void> {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
  let created = false;
  try {
    await fs.access(configPath);
  } catch {
    // File absent — create from template.
    try {
      await fs.writeFile(configPath, CONFIG_TEMPLATE, { flag: 'wx' });
      created = true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Aggrega: could not create ${CONFIG_FILENAME}: ${reason}`,
      );
      return;
    }
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(configPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Aggrega: could not open ${CONFIG_FILENAME}: ${reason}`,
    );
    return;
  }
  const editor = await vscode.window.showTextDocument(doc);

  // When the file was freshly created from the template, position
  // the cursor at the end of the empty authoring_release value line
  // (line 2 of the template, after "authoring_release:" + space).
  // When the file pre-existed, leave the cursor wherever VS Code
  // restored it. A more elaborate "navigate to the existing
  // authoring_release key" lookup is deferred — the user's `Ctrl+F`
  // finds it instantly and the file is short.
  if (created) {
    const text = editor.document.getText();
    const idx = text.indexOf('authoring_release:');
    if (idx !== -1) {
      // Move cursor to the end of the "authoring_release:" line.
      const pos = editor.document.positionAt(idx + 'authoring_release:'.length);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    }
  }
}

// createActiveReleaseMarker writes the Release the editor currently has
// selected into the workspace's active-release marker, making it this
// workspace's default: what a fresh editor session starts on, and what the
// command line picks up when it is not told otherwise.
//
// Selecting a Release and persisting one are different acts, and this is the
// second. The selection already travels on every request, so writing the marker
// changes nothing about the session in progress — which is why nothing is
// restarted here. It records the choice for the next one.
//
// selectedRelease is the workspace-relative path the editor is acting on. This
// function prompts for nothing and detects nothing: the editor already holds
// the reader's answer, and a prompt here would be a second way to choose a
// Release. A caller with no selection gets an informational message instead.
//
// Filesystem write failures (read-only mount, permission denied, .aggrega/
// existing as a file rather than a directory) surface as error toasts. The
// function is idempotent: re-invoking it overwrites the marker.
export async function createActiveReleaseMarker(
  workspaceRoot: string,
  selectedRelease: string | null,
): Promise<void> {
  if (!selectedRelease) {
    void vscode.window.showInformationMessage(
      'Aggrega: no Release is selected, so there is none to set as this workspace default. Select one first.',
    );
    return;
  }

  const markerDir = path.join(workspaceRoot, AGGREGA_DIR);
  const markerPath = activeReleaseMarkerPath(workspaceRoot);
  try {
    await fs.mkdir(markerDir, { recursive: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Aggrega: could not create ${AGGREGA_DIR}/: ${reason}`,
    );
    return;
  }
  try {
    await fs.writeFile(markerPath, selectedRelease + '\n');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Aggrega: could not write ${AGGREGA_DIR}/${ACTIVE_RELEASE_MARKER_BASENAME}: ${reason}`,
    );
    return;
  }
  void vscode.window.showInformationMessage(
    `Aggrega: ${selectedRelease} is now this workspace's default Release.`,
  );
}
