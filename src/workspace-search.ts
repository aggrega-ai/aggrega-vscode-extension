// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { ANCHOR_CANDIDATE_GLOB } from './workspace';

// candidateFilesUnder looks inside ONE open folder for files that might anchor
// an Aggrega workspace, and answers with their absolute paths.
//
// 🔴 THE SEARCH IS BASED ON THE FOLDER RATHER THAN ON THE WINDOW, AND THAT IS
// WHAT MAKES A FOLDER'S REACH COMPUTABLE. The editor's file search spans every
// folder the window has open unless it is given a base to search relative to;
// given one, it returns only what lies inside that folder. Without the base
// there would be no way to ask what one folder holds, and the only remaining
// route would be a rule about paths standing beside discovery and free to
// disagree with it.
//
// It narrows and decides nothing. Every path it answers with is confirmed
// through the discovery rule by the caller, so a pattern wider than what
// actually anchors can only produce a candidate the confirmation drops.
export async function candidateFilesUnder(
  folder: vscode.WorkspaceFolder,
): Promise<string[]> {
  const hits = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, ANCHOR_CANDIDATE_GLOB),
  );
  return hits.map((uri) => uri.fsPath);
}

// candidateFilesAcrossWindow looks through every folder the window has open.
//
// It is the same search asked at the window's scope, composed from the
// per-folder one above rather than issued as a second call with no base — so
// the two populations cannot be computed by two different patterns. A surface
// offering folders across the whole window wants this; one asking what a chosen
// folder reaches wants the other.
export async function candidateFilesAcrossWindow(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<string[]> {
  const found: string[] = [];
  for (const folder of folders) {
    found.push(...await candidateFilesUnder(folder));
  }
  return found;
}
