// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { RecordsActiveRelease, recordActiveRelease } from './active-release-marker';
import type { ConfigurationWriter } from './config-change-watch';
import { ServerListing, configurationOpening } from './configuration-leading-out';
import { describeError } from './error-text';
import { CONFIG_FILENAME } from './workspace';

// CONFIG_TEMPLATE is what openAuthoringReleaseConfig writes when the
// folder it was given carries no .aggrega-config.yaml yet. The cursor
// is positioned on the empty value line so the user types the Release
// path immediately without navigating.
//
// It is deliberately minimal, and it deliberately carries no top-level
// `workspace:` key. That key is what marks a directory as the root of a
// workspace, and this file is written at the root the workspace is
// already anchored at — the command refuses until one is — so it needs
// no marker of its own to be read there. Making a directory a workspace
// root is a separate act with its own template, which lives in
// workspace.ts beside the discovery that recognises it.
const CONFIG_TEMPLATE = `build:
  authoring_release:
`;

// openAuthoringReleaseConfig opens the .aggrega-config.yaml of the
// folder it is given. When the file does not exist, creates it
// from CONFIG_TEMPLATE and positions the cursor on the empty value
// line; when it exists, navigates the cursor to the
// build.authoring_release key if present, else opens the file and
// leaves the cursor at the document start.
//
// workspaceRoot is the absolute path of the Aggrega workspace root, and
// the helper writes the config there — the same directory the marker
// sits in and the same one the language server is anchored at, so the
// key written here is the key that server reads. Filesystem write
// failures surface as error toasts rather than crashing.
//
// Creating the file goes through writeConfiguration, which restarts the
// running language server once it exists. The server read no such file when
// it started, so without the restart it would never read this one, and a
// change made to it afterwards would go unannounced as well — a file the
// server did not read is not a file anything watches on its behalf.
//
// Whether the restarted server read the file is not said here, because this
// operation ends by opening the file rather than in a sentence, and a
// notification raised only to say it would be a second one for one act. What
// the reader came to write is the value they type next, and saving that is a
// change the running server has not read, which the watch reports with the
// restart beside it.
//
// A file found already there is opened only where the running language server
// has not named it as a link leading out of the workspace; where it has, the
// file is left unopened and an error says why. That judgement is the server's,
// read through serverListing, and configurationOpening says when it is asked.
export async function openAuthoringReleaseConfig(
  workspaceRoot: string,
  writeConfiguration: ConfigurationWriter,
  serverListing: ServerListing,
): Promise<void> {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
  let created = false;
  try {
    await fs.access(configPath);
  } catch {
    // File absent — create from template.
    try {
      await writeConfiguration(
        () => fs.writeFile(configPath, CONFIG_TEMPLATE, { flag: 'wx' }),
        () => configPath,
      );
      created = true;
    } catch (err) {
      const reason = describeError(err);
      void vscode.window.showErrorMessage(
        `Aggrega: could not create ${CONFIG_FILENAME}: ${reason}`,
      );
      return;
    }
  }

  const opening = await configurationOpening(serverListing, configPath, created ? 'created' : 'found');
  if (!opening.open) {
    void vscode.window.showErrorMessage(opening.message);
    return;
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(configPath);
  } catch (err) {
    const reason = describeError(err);
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

// createActiveReleaseMarker records the Release the editor currently has
// selected in the workspace's active-release marker, making it this workspace's
// default: what a fresh editor session starts on, and what the command line
// picks up when it is not told otherwise.
//
// Selecting a Release and persisting one are different acts, and this is the
// second. The selection already travels on every request, so recording it
// changes nothing about the session in progress — which is why nothing is
// restarted here. It records the choice for the next one.
//
// The marker is written by the language server, through record, and never by
// this extension; recordActiveRelease says why and decides the ending, which is
// shown here as an error where the write failed and as information otherwise.
// Re-invoking it records the selection again.
export async function createActiveReleaseMarker(
  selectedRelease: string | null,
  record: RecordsActiveRelease,
): Promise<void> {
  const ending = await recordActiveRelease(record, selectedRelease);
  if (ending.failed) {
    void vscode.window.showErrorMessage(ending.message);
    return;
  }
  void vscode.window.showInformationMessage(ending.message);
}
