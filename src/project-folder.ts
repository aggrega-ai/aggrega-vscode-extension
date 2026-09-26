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
// 🔴 IT CHOOSES AMONG THE FOLDERS THE WINDOW HAS, AND BRINGING ANOTHER ONE IN
// IS A DIFFERENT ACT THAT IT OFFERS LAST. Adding a folder changes which folders
// the window HAS; choosing says which of the folders it has is the one Aggrega
// works from. Both are reached from here, because a reader whose folder is not
// open yet needs the first and a reader with two open needs the second — and
// the add stops at the add, so the choice stays the reader's.
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
// answer is the folders open now together with how to add another.
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

// WindowKind is what the editor says about a window that decides what adding a
// folder to it costs.
//
// Both are facts the editor reports rather than conclusions drawn here; what
// they cost is concluded in one place below, so the reading and the conclusion
// cannot drift apart unseen.
export interface WindowKind {
  // onWorkspaceFile is whether the window is open on a workspace file, saved or
  // untitled, rather than on a single folder or on nothing at all.
  onWorkspaceFile: boolean;
  // remote is whether the window works on another machine through a remote
  // connection, a container or another host.
  remote: boolean;
}

// openOtherFolderDetail is the offer's second line for this kind of window: what
// taking it does, and what it costs where it costs something.
//
// 🔴 THE COST IS THE EDITOR'S, AND THIS MIRRORS HOW THE EDITOR DECIDES IT. A
// window open on a workspace file takes another folder in place. A window open
// on one folder, or on none, is turned into a workspace to take it, and entering
// a workspace stops every extension and starts them again — which, in a remote
// window, the editor does by reloading the window. A second line promising only
// the reach would be accurate and would still surprise every reader whose window
// reloaded under them.
//
// Where there is no cost the line names none, rather than reassuring the reader
// that nothing restarts: that would be one more sentence that could stop being
// true.
export function openOtherFolderDetail(windowKind: WindowKind): string {
  if (windowKind.onWorkspaceFile) { return OPEN_OTHER_FOLDER_DETAIL; }
  const cost = windowKind.remote ? 'The window reloads.' : 'Extensions restart.';
  return `${OPEN_OTHER_FOLDER_DETAIL} ${cost}`;
}

// openOtherFolderLabel is that offer's label, graded on whether the window has
// any folder open: "another" is true only when there is already one to be
// another of.
export function openOtherFolderLabel(openCount: number): string {
  return openCount === 0
    ? 'Open a folder…'
    : 'Open another folder…';
}

// projectFolderOffers composes what the Project folder row opens: every folder
// this window has open, then the route to adding one it does not.
//
// A SOLE OPEN FOLDER IS STILL OFFERED RATHER THAN THE OFFER BEING DECLINED,
// for the reason the level beneath it offers its sole candidate: a reader who
// clicked to choose and was shown nothing cannot tell that the control ran.
//
// The kind of window is handed in rather than looked up, because it is the
// editor's to report and this module holds no editor: the caller reads it at
// the moment the choice is drawn, which is the moment the second line has to be
// true of.
export function projectFolderOffers<F extends FolderLike>(
  folders: readonly F[],
  windowKind: WindowKind,
): ProjectFolderOffer<F>[] {
  const offers: ProjectFolderOffer<F>[] = buildProjectFolderItems(folders).map(
    (item) => ({ kind: 'open' as const, ...item }),
  );
  offers.push({
    kind: 'other',
    label: openOtherFolderLabel(folders.length),
    description: '',
    detail: openOtherFolderDetail(windowKind),
  });
  return offers;
}

// ADD_FOLDER_DIALOG is how the editor's folder dialog is asked for when the
// reader takes that last offer: one folder, and nothing but a folder.
//
// It is written here rather than where the dialog is raised so that what the
// reader is asked — and that it asks for exactly one folder — is readable with no
// editor running. Its shape is the editor's own options for an open dialog.
export const ADD_FOLDER_DIALOG = {
  canSelectFiles: false,
  canSelectFolders: true,
  canSelectMany: false,
  openLabel: 'Add this folder',
  title: 'Aggrega: select a folder to add to this window',
} as const;

// folderAlreadyOpenMessage is what a reader is told when the folder they picked
// to add is one the window already has open.
//
// It is said rather than passed over, because the reader asked for something
// and nothing visible happens; and it names the full path for the reason every
// message about a folder here does — a message is read with none of the
// chooser's side-by-side context around it.
export function folderAlreadyOpenMessage(folderPath: string): string {
  return `Aggrega: ${folderPath} is already open in this window.`;
}

// folderDeclinedMessage is what a reader is told when the editor refuses to add
// a folder to the window.
//
// 🔴 IT IS THE ONE SENTENCE FOR THAT REFUSAL WHEREVER A FOLDER IS ADDED. Two
// routes add one — the last entry of the Project folder row's chooser, and the
// step that adds a folder Aggrega recognises, reached from the welcome page and
// from the Aggrega workspace row's chooser — and a reader meeting the same
// refusal through either must be told the same thing.
export function folderDeclinedMessage(folderPath: string): string {
  return `Aggrega: the editor declined to add ${folderPath} to this workspace.`;
}

// FolderAddingEditor is what adding a folder to the window needs the editor for.
//
// A location is any value carrying the file-system path it stands for, and the
// editor's own location type is one. The folder the reader picked travels back to
// the editor as the very value the dialog answered with, never rebuilt from its
// path, because a location rebuilt from a path keeps the path and loses whatever
// else the editor's value said about where that path lives.
export interface FolderAddingEditor<L extends { fsPath: string }> {
  // pickFolder puts the folder dialog in front of the reader, and answers with
  // what they picked, or with nothing where they closed it.
  pickFolder(): Thenable<readonly L[] | undefined>;
  // openFolders reports the folders the window has open as it is asked.
  openFolders(): readonly FolderLike[];
  // addFolder appends the folder after the ones the window has open, and
  // answers whether the editor took it.
  addFolder(folder: L): boolean;
  // showInformation tells the reader something that changed nothing.
  showInformation(message: string): void;
  // showError tells the reader the editor refused what they asked for.
  showError(message: string): void;
}

// FolderAddingOutcome is what taking the offer came to.
export type FolderAddingOutcome = 'cancelled' | 'already-open' | 'added' | 'declined';

// pickAndAddFolder asks the reader for a folder and adds it to the window, and
// reports what that came to.
//
// 🔴 IT ADDS AND DOES NOT CHOOSE. The folder picked joins the list this row
// offers, and which of the listed folders Aggrega works from stays the reader's
// answer to give — choosing on their behalf would make a decision they never
// made, which is the thing the Project folder level exists not to do.
//
// A folder already open is told apart BEFORE the editor is asked. The editor
// refuses a second copy of a folder it has, and answers that refusal exactly as
// it answers every other, so a reader who picked a folder they already have
// would otherwise be told the editor declined — true, and no help at all.
//
// A dialog closed without a pick changes nothing and says nothing: the reader
// took the offer back, and there is nothing to report to them.
export async function pickAndAddFolder<L extends { fsPath: string }>(
  editor: FolderAddingEditor<L>,
): Promise<FolderAddingOutcome> {
  const picked = (await editor.pickFolder())?.[0];
  if (picked === undefined) { return 'cancelled'; }
  const folderPath = picked.fsPath;
  if (editor.openFolders().some((f) => f.uri.fsPath === folderPath)) {
    editor.showInformation(folderAlreadyOpenMessage(folderPath));
    return 'already-open';
  }
  if (!editor.addFolder(picked)) {
    editor.showError(folderDeclinedMessage(folderPath));
    return 'declined';
  }
  return 'added';
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
