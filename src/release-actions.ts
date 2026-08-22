// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { CONFIG_FILENAME } from './workspace';

// MARKER_DIR_BASENAME + MARKER_FILE_BASENAME together name the
// .aggrega/active-release marker file the daemon consults when it
// picks the active Release.
const MARKER_DIR_BASENAME = '.aggrega';
const MARKER_FILE_BASENAME = 'active-release';

// activeReleaseMarkerPath is the workspace-root-relative-to-absolute path of the
// active-release marker. Single source for the marker location, so the directory
// and file basenames are composed in exactly one place.
export function activeReleaseMarkerPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, MARKER_DIR_BASENAME, MARKER_FILE_BASENAME);
}

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

// createActiveReleaseMarker opens a quick-pick over the supplied Release
// candidates for the user to choose one, and writes the chosen
// workspace-relative path into .aggrega/active-release. After writing, invokes
// aggrega.server.restart so the daemon re-runs the cascade.
//
// candidates is the daemon's content-kind Release set (absolute paths), fetched
// by the caller — this function does no Release detection of its own. On zero
// candidates the user sees an informational message and the function returns
// without writing. Filesystem write failures (read-only mount, permission
// denied, .aggrega/ existing as a file rather than directory) surface as error
// toasts. The function is idempotent: re-invoking it after a successful write
// overwrites the marker with the new selection.
export async function createActiveReleaseMarker(workspaceRoot: string, candidates: string[]): Promise<void> {
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      'Aggrega: no Release candidates found in this workspace.',
    );
    return;
  }

  const items = candidates.map(p => ({
    label: path.basename(p),
    description: path.relative(workspaceRoot, p),
    detail: p,
    absolutePath: p,
  }));
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Aggrega: choose which Release the daemon should anchor to',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) {
    return;
  }

  const markerDir = path.join(workspaceRoot, MARKER_DIR_BASENAME);
  const markerPath = activeReleaseMarkerPath(workspaceRoot);
  try {
    await fs.mkdir(markerDir, { recursive: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Aggrega: could not create ${MARKER_DIR_BASENAME}/: ${reason}`,
    );
    return;
  }
  const relativeTarget = path.relative(workspaceRoot, choice.absolutePath);
  try {
    await fs.writeFile(markerPath, relativeTarget + '\n');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Aggrega: could not write ${MARKER_DIR_BASENAME}/${MARKER_FILE_BASENAME}: ${reason}`,
    );
    return;
  }
  void vscode.window.showInformationMessage(
    `Aggrega: marker written; restarting daemon to pick up ${relativeTarget}.`,
  );
  void vscode.commands.executeCommand('aggrega.server.restart');
}
