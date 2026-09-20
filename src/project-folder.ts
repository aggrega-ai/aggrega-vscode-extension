// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { FolderLike } from './workspace';
import { WorkspaceStateLike } from './anchor-picker';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { distinguishingLabel } from './uri-display';

// PROJECT_FOLDER_STATE_KEY is the editor-local entry the chosen Project folder
// is remembered under. Editor-local means per editor window, the same way the
// Aggrega workspace and the Release are remembered: the choice survives closing
// the window and nothing about it is written into the workspace.
export const PROJECT_FOLDER_STATE_KEY = 'aggrega.selectedProjectFolder';

// CHOOSE_PROJECT_FOLDER_COMMAND is the one command that changes which of the
// open folders the editor is working from.
//
// It lives beside the choice it opens, with the read and the write of that
// choice, for the reason the two levels beneath it keep theirs together: the row
// that offers it and any other surface that comes to offer it must not each
// carry their own spelling of the identifier.
//
// 🔴 IT IS THIS EXTENSION'S OWN COMMAND AND THE EDITOR'S OPEN-FOLDER COMMAND IS
// NOT A SUBSTITUTE FOR IT. They answer different questions: the editor's changes
// which folders the window HAS, and this one chooses which of the folders it has
// is the one Aggrega works from. Both are offered, because a reader whose folder
// is not open yet needs the first and a reader with two open needs the second.
export const CHOOSE_PROJECT_FOLDER_COMMAND = 'aggrega.project.selectFolder';

// readSavedProjectFolder returns the remembered Project folder path, or null.
// A non-string value, or an absent key, reads as null.
export function readSavedProjectFolder(state: WorkspaceStateLike): string | null {
  const v = state.get<unknown>(PROJECT_FOLDER_STATE_KEY);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// rememberProjectFolderChoice records which open folder this window works from,
// and answers with the path it replaced.
//
// It is the one home of that write, beside the read above, because a remembered
// choice outranks everything else when the folders are re-evaluated: a surface
// through which a reader NAMES a folder has to record the answer here, or the
// re-evaluation reinstates the folder they were trying to leave.
//
// Returning the previous path lets a caller that could not finish the move put
// it back. A null path forgets the choice, spelled that way so callers state an
// intention rather than a storage detail.
export async function rememberProjectFolderChoice(
  state: WorkspaceStateLike,
  folderPath: string | null,
): Promise<string | null> {
  const previous = readSavedProjectFolder(state);
  await state.update(PROJECT_FOLDER_STATE_KEY, folderPath ?? undefined);
  return previous;
}

// projectFolderInForce reports which open folder the editor is working from.
//
// 🔴 IT IS NEVER DERIVED FROM THE LEVEL BENEATH IT, WHICH IS THE WHOLE REASON
// THIS FUNCTION EXISTS. An Aggrega workspace can be reached from two open
// folders at once, so "which folder does this workspace belong to" has more than
// one true answer and the question is not asked. What is asked instead is what
// the reader chose, and only where they have not chosen does anything else
// answer.
//
// The order is: the remembered choice while it is still a folder this window
// has open; then the sole open folder, which is selected silently so a reader
// with one project never meets the concept at all; then nothing. Nothing is the
// honest answer for a window with several folders and no choice recorded — the
// row says so and offers the choice, rather than naming one of them as though
// the reader had picked it.
//
// A remembered path naming a folder the window no longer has open is not
// honoured and is not treated as a choice; whether it is also forgotten is the
// caller's to decide, because only the caller knows whether the reader should be
// told.
export function projectFolderInForce<F extends FolderLike>(
  saved: string | null,
  folders: readonly F[],
): F | null {
  if (saved !== null) {
    const remembered = folders.find((f) => f.uri.fsPath === saved);
    if (remembered !== undefined) { return remembered; }
  }
  if (folders.length === 1) { return folders[0]; }
  return null;
}

// isSavedProjectFolderValid reports whether the remembered path still names a
// folder this window has open. A window whose folders changed can be left
// remembering one that has gone, and that is told apart from never having
// chosen — the two look identical to a reader who is only shown that nothing is
// selected.
export function isSavedProjectFolderValid<F extends FolderLike>(
  saved: string | null,
  folders: readonly F[],
): boolean {
  if (saved === null) { return false; }
  return folders.some((f) => f.uri.fsPath === saved);
}

// ProjectFolderItem is one entry in the chooser: an open folder, named the way
// a reader will recognise it.
export interface ProjectFolderItem<F extends FolderLike = FolderLike> {
  label: string;
  description: string;
  folder: F;
}

// ProjectFolderOffer is one entry in what the Project folder row opens: either a
// folder this window already has open, or the way to bring another one in.
//
// THE TWO ARE ONE LIST RATHER THAN TWO STEPS, for the reason the Aggrega
// workspace row's own offer states: a reader clicking the row is asking which
// folder the editor works from and whether they can change it, and the honest
// answer is the folders open now together with how to open another.
export type ProjectFolderOffer<F extends FolderLike = FolderLike> =
  | ({ kind: 'open' } & ProjectFolderItem<F>)
  | { kind: 'other'; label: string; description: string; detail: string };

// buildProjectFolderItems renders each open folder into the two-piece display
// the chooser draws.
//
// The label is read through the one rule that names a location among its
// siblings, so a folder named here and the same folder named in the chooser one
// level down are named identically.
export function buildProjectFolderItems<F extends FolderLike>(
  folders: readonly F[],
): ProjectFolderItem<F>[] {
  const paths = folders.map((f) => f.uri.fsPath);
  return folders.map((folder) => ({
    label: distinguishingLabel(folder.uri.fsPath, paths),
    description: folder.uri.fsPath,
    folder,
  }));
}

// OPEN_OTHER_FOLDER_DETAIL explains, on the offer's second line, what taking it
// does — that it reaches past the folders this window has, which is the one
// thing choosing among them cannot do.
export const OPEN_OTHER_FOLDER_DETAIL =
  'Reaches a folder this window does not have open yet.';

// openOtherFolderLabel is that offer's label, graded on whether the window has
// any folder open: "another" is true only when there is already one to be
// another of.
export function openOtherFolderLabel(openCount: number): string {
  return openCount === 0
    ? 'Open a folder…'
    : 'Open another folder…';
}

// projectFolderOffers composes what the Project folder row opens: every folder
// this window has open, then the route to opening one it does not.
//
// A SOLE OPEN FOLDER IS STILL OFFERED RATHER THAN THE OFFER BEING DECLINED,
// for the reason the level beneath it offers its sole candidate: a reader who
// clicked to choose and was shown nothing cannot tell that the control ran.
export function projectFolderOffers<F extends FolderLike>(
  folders: readonly F[],
): ProjectFolderOffer<F>[] {
  const offers: ProjectFolderOffer<F>[] = buildProjectFolderItems(folders).map(
    (item) => ({ kind: 'open' as const, ...item }),
  );
  offers.push({
    kind: 'other',
    label: openOtherFolderLabel(folders.length),
    description: '',
    detail: OPEN_OTHER_FOLDER_DETAIL,
  });
  return offers;
}

// CHOOSE_PROJECT_FOLDER_INVITATION is the offer to change which folder the
// editor works from, as the closing line of a hover.
//
// It names the level from the one place the three levels are named, so the row
// and the chooser cannot come to call it two different things.
export const CHOOSE_PROJECT_FOLDER_INVITATION =
  `Click to choose which ${SELECTOR_ROW_LABELS.project} the editor works from.`;

// CHOOSE_PROJECT_FOLDER_PLACEHOLDER is the same offer as the chooser's own
// placeholder. A placeholder is read inside the control it belongs to, so it
// drops the instruction to click and takes the product prefix every quick-pick
// in this extension carries.
export const CHOOSE_PROJECT_FOLDER_PLACEHOLDER =
  `Aggrega: choose which ${SELECTOR_ROW_LABELS.project} the editor works from`;

// projectFolderSwitchMessage is what a reader is told when the folder the editor
// works from has changed.
//
// The change is announced rather than merely performed, because it moves what
// the level beneath it offers: the Aggrega workspaces on offer become the ones
// the new folder reaches, and a reader who is not told cannot tell a list
// computed for one folder from a list computed for another.
//
// It names the full path rather than a basename, because two open folders can
// share a basename — the collision the chooser itself disambiguates — and a
// message is read with none of the chooser's side-by-side context around it.
export function projectFolderSwitchMessage(folderPath: string): string {
  return `Aggrega: now working from ${folderPath}.`;
}
