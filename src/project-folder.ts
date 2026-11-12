// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { FolderLike } from './workspace';
import { WorkspaceStateLike, rememberAnchorChoice } from './anchor-picker';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { distinguishingLabel } from './uri-display';
import {
  WINDOW_RELOADS,
  WindowKind,
  addingMakesNewWorkspace,
  withAddingCost,
} from './window-kind';

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
// 🔴 IT CHOOSES AMONG THE FOLDERS THE WINDOW HAS, AND REACHING ANOTHER ONE IS A
// DIFFERENT ACT THAT IT OFFERS LAST, IN TWO FORMS. Opening a folder or adding
// one changes which folders the window HAS; choosing says which of the folders
// it has is the one Aggrega works from. All three are reached from here,
// because a reader whose folder is not open yet needs one of the first two and
// a reader with two open needs the third. Opening records no choice: the window
// it leaves is on another folder, with that folder's own answers. Adding does,
// because the reader picked the folder here, where the question asked is which
// folder to work from.
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

// ProjectFolderOffer is one entry in what the Project folder row opens: a folder
// this window already has open, or one of the two ways to reach a folder it
// does not.
//
// THEY ARE ONE LIST RATHER THAN TWO STEPS, for the reason the Aggrega workspace
// row's own offer states: a reader clicking the row is asking which folder the
// editor works from and whether they can change it, and the honest answer is the
// folders open now together with how to reach another.
//
// 🔴 THE TWO WAYS TO REACH ANOTHER ARE TWO ENTRIES BECAUSE THEY ARE TWO ACTS.
// Reopening puts the window on the folder picked alone; adding puts that folder
// beside the ones the window has. A reader who meant one and is given the other
// loses either the folders they had open or the window on one folder they
// wanted, so neither is offered under the other's name.
export type ProjectFolderOffer<F extends FolderLike = FolderLike> =
  | ({ kind: 'open' } & ProjectFolderItem<F>)
  | { kind: 'reopen'; label: string; description: string; detail: string }
  | { kind: 'add'; label: string; description: string; detail: string };

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

// OPEN_FOLDER_ENTRY_LABEL and ADD_FOLDER_ENTRY_LABEL name the two entries that
// reach a folder this window does not have open.
//
// Neither says "workspace". The panel calls its middle row the Aggrega
// workspace because that word on its own already names the folders a window
// has open, so an entry offering to add to "the workspace" would read as either;
// "this window" is the phrase the entries' second lines, the folder dialogs and
// the messages below use for the folders open. They are not graded on how many
// folders are open, because neither promises "another".
export const OPEN_FOLDER_ENTRY_LABEL = 'Open folder…';
export const ADD_FOLDER_ENTRY_LABEL = 'Add folder to this window…';

// openFolderDetail is the open entry's second line: what taking it does to the
// folders the window has, and what it costs.
//
// It is graded on whether the window has any folder open, because "in place of
// what this window has open" is true only where there is something to replace.
// The cost is the same in every window: opening a folder in the window it was
// asked from takes that window down and stands it back up on the folder, local
// or remote.
export function openFolderDetail(openCount: number): string {
  return openCount === 0
    ? `Opens the folder you pick in this window. ${WINDOW_RELOADS}`
    : `Opens the folder you pick in place of what this window has open. ${WINDOW_RELOADS}`;
}

// ADD_FOLDER_DETAIL explains, on the add entry's second line, what taking it
// does — that it reaches past the folders this window has, which is the one
// thing choosing among them cannot do.
export const ADD_FOLDER_DETAIL =
  'Reaches a folder this window does not have open yet.';

// addFolderDetail is the add entry's second line for this kind of window: what
// taking it does, and what it costs where it costs something.
//
// The cost is not written here. It is the add's, and the Aggrega workspace row's
// last entry ends in the same add, so both lines take it from the one grading
// every entry ending in an add is composed through.
export function addFolderDetail(windowKind: WindowKind): string {
  return withAddingCost(ADD_FOLDER_DETAIL, windowKind);
}

// projectFolderOffers composes what the Project folder row opens: every folder
// this window has open, then the entry that opens a folder in place of them,
// then the entry that adds one beside them.
//
// A SOLE OPEN FOLDER IS STILL OFFERED RATHER THAN THE OFFER BEING DECLINED,
// for the reason the level beneath it offers its sole candidate: a reader who
// clicked to choose and was shown nothing cannot tell that the control ran.
//
// The kind of window is handed in rather than looked up, because it is the
// editor's to report and this module holds no editor: the caller reads it at
// the moment the choice is drawn, which is the moment the second lines have to
// be true of.
export function projectFolderOffers<F extends FolderLike>(
  folders: readonly F[],
  windowKind: WindowKind,
): ProjectFolderOffer<F>[] {
  const offers: ProjectFolderOffer<F>[] = buildProjectFolderItems(folders).map(
    (item) => ({ kind: 'open' as const, ...item }),
  );
  offers.push(
    {
      kind: 'reopen',
      label: OPEN_FOLDER_ENTRY_LABEL,
      description: '',
      detail: openFolderDetail(folders.length),
    },
    {
      kind: 'add',
      label: ADD_FOLDER_ENTRY_LABEL,
      description: '',
      detail: addFolderDetail(windowKind),
    },
  );
  return offers;
}

// OPEN_FOLDER_DIALOG and ADD_FOLDER_DIALOG are how the editor's folder dialog is
// asked for when the reader takes one of the two entries: one folder, and
// nothing but a folder.
//
// Each button names its act in one word, so a dialog raised by one entry cannot
// be read as the other's: a reader who asked to open a folder and is offered to
// add one has been handed the other act.
//
// They are written here rather than where the dialog is raised so that what the
// reader is asked — and that it asks for exactly one folder — is readable with no
// editor running. Their shape is the editor's own options for an open dialog.
export const OPEN_FOLDER_DIALOG = {
  canSelectFiles: false,
  canSelectFolders: true,
  canSelectMany: false,
  openLabel: 'Open',
  title: 'Aggrega: select a folder to open in this window',
} as const;

export const ADD_FOLDER_DIALOG = {
  canSelectFiles: false,
  canSelectFolders: true,
  canSelectMany: false,
  openLabel: 'Add',
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
// routes add one — the add entry of the Project folder row's chooser, and the
// step that adds a folder Aggrega recognises, reached from the welcome page and
// from the Aggrega workspace row's chooser — and a reader meeting the same
// refusal through either must be told the same thing.
export function folderDeclinedMessage(folderPath: string): string {
  return `Aggrega: the editor declined to add ${folderPath} to this workspace.`;
}

// folderNotOpenedMessage is what a reader is told when the editor refuses to
// open the folder they picked in this window.
//
// It is said because nothing else would say it. The editor answers a refusal to
// open a named folder by rejecting, and the panel's press guard discards what
// the command it ran rejects with, so an untold refusal is a dialog that closes
// on a window left exactly as it was. It names the full path for the reason
// every message about a folder here does.
export function folderNotOpenedMessage(folderPath: string): string {
  return `Aggrega: the editor could not open ${folderPath}.`;
}

// FolderOpeningEditor is what opening a folder in the window needs the editor
// for. A location is what FolderAddingEditor below says it is, and it travels
// back to the editor unrebuilt for the same reason.
export interface FolderOpeningEditor<L extends { fsPath: string }> {
  // pickFolder puts the folder dialog in front of the reader, and answers with
  // what they picked, or with nothing where they closed it.
  pickFolder(): Thenable<readonly L[] | undefined>;
  // openFolder puts the window on that folder alone, in place of whatever it
  // has open, and rejects where the editor refuses.
  openFolder(folder: L): Thenable<unknown>;
  // showError tells the reader the editor refused what they asked for.
  showError(message: string): void;
}

// FolderOpeningOutcome is what taking the open entry came to.
export type FolderOpeningOutcome = 'cancelled' | 'opened' | 'failed';

// pickAndOpenFolder asks the reader for a folder and opens it in this window in
// place of what the window has open, and reports what that came to.
//
// 🔴 IT RECORDS NOTHING. The window it leaves the reader in is a window on
// another folder, with that folder's own remembered answers; a choice written
// here would be written into the memory of the window being left.
//
// A refusal is caught here and told, because a rejection that left this
// function would reach the panel's press guard, which discards it. A dialog
// closed without a pick changes nothing and says nothing.
export async function pickAndOpenFolder<L extends { fsPath: string }>(
  editor: FolderOpeningEditor<L>,
): Promise<FolderOpeningOutcome> {
  const picked = (await editor.pickFolder())?.[0];
  if (picked === undefined) { return 'cancelled'; }
  try {
    await editor.openFolder(picked);
  } catch {
    editor.showError(folderNotOpenedMessage(picked.fsPath));
    return 'failed';
  }
  return 'opened';
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

// NamedAnswer is the one answer a reader gives by naming a folder that is then
// added to the window: the Project folder they picked through this row's add
// entry, or the Aggrega workspace they picked through the step that adds a folder
// Aggrega recognises. It is held as the path that level's own memory records —
// the folder's path for the first, the path of the file marking the workspace
// for the second.
export interface NamedAnswer {
  level: 'project' | 'workspace';
  path: string;
}

// AnswerStores are the two memories an answer can be kept in.
export interface AnswerStores {
  // memory is this window's own, the one each level's choice is remembered in.
  // The editor scopes it to the workspace the window is on.
  memory: WorkspaceStateLike;
  // global is the editor's own, shared by every window and kept when a window
  // enters a new workspace.
  global: WorkspaceStateLike;
}

// AddingWindow is what an add needs to know about the window it is made in: the
// two memories an answer can be kept in, and the kind of window, which decides
// between them.
export interface AddingWindow extends AnswerStores {
  windowKind: WindowKind;
}

// CARRIED_ANSWER_STATE_KEY is the one entry, in the editor's global store, that
// carries an answer from the window a reader gave it in to the window an add of
// theirs creates.
//
// 🔴 IT EXISTS BECAUSE THE EDITOR CARRIES NOTHING ACROSS THAT CHANGE. A window
// open on one folder, or on none, takes another by becoming a new workspace, and
// the editor opens that workspace's memory empty rather than copying the old one
// across. An answer written into the window's own memory before the add stays
// with the window being left, and the window the reader comes back to asks them
// again for what they have just chosen.
//
// 🔴 IT IS ONE ENTRY AND NOT A LIST, AND NOTHING EXPIRES IT. A later add
// overwrites it, the window holding exactly its folders takes it and deletes it,
// and a refused add deletes it. One left behind by a window that went down
// before its add took effect is at most one, and the next add overwrites it; a
// window opened later on exactly those folders takes the answer the reader gave
// for them. So there is nothing to prune and no time to keep.
export const CARRIED_ANSWER_STATE_KEY = 'aggrega.answerForAddedWorkspace';

// CarriedAnswer is what that entry holds: the folders the window the add creates
// will have open, by path, and the answer to hand that window.
//
// The folders are what make the entry that window's and no other's. The store is
// shared by every window, so a window that started or reloaded between the write
// and the add taking effect would otherwise take another window's answer.
export interface CarriedAnswer {
  folders: string[];
  answer: NamedAnswer;
}

// readCarriedAnswer reads the entry, or null where it is absent or not the shape
// written below. An entry of any other shape is no window's answer, and it is
// left for the next write to replace.
function readCarriedAnswer(global: WorkspaceStateLike): CarriedAnswer | null {
  const stored = global.get<unknown>(CARRIED_ANSWER_STATE_KEY);
  if (typeof stored !== 'object' || stored === null) { return null; }
  const { folders, answer } = stored as { folders?: unknown; answer?: unknown };
  if (!Array.isArray(folders)) { return null; }
  if (!folders.every((f) => typeof f === 'string' && f.length > 0)) { return null; }
  if (typeof answer !== 'object' || answer === null) { return null; }
  const { level, path } = answer as { level?: unknown; path?: unknown };
  if (level !== 'project' && level !== 'workspace') { return null; }
  if (typeof path !== 'string' || path.length === 0) { return null; }
  return { folders: [...folders], answer: { level, path } };
}

// forgetCarriedAnswer deletes the entry.
async function forgetCarriedAnswer(global: WorkspaceStateLike): Promise<void> {
  await global.update(CARRIED_ANSWER_STATE_KEY, undefined);
}

// rememberAnswer writes an answer into a window's memory through the one writer
// its level already has, and answers with the path it replaced. Going through
// those writers is what keeps each level's key spelled in one place.
function rememberAnswer(
  memory: WorkspaceStateLike,
  level: NamedAnswer['level'],
  path: string | null,
): Promise<string | null> {
  return level === 'project'
    ? rememberProjectFolderChoice(memory, path)
    : rememberAnchorChoice(memory, path);
}

// sameFolders reports whether two lists name the same folders by path, in any
// order. Order is not part of what an add decides: the editor appends, and what
// the window holds is the set.
function sameFolders(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((p) => right.has(p));
}

// adoptCarriedAnswer takes the carried answer into this window's memory where it
// was carried for this window, and answers with what it took, or null.
//
// 🔴 IT HAS TO RUN BEFORE THE OPEN FOLDERS ARE FIRST EVALUATED. The evaluation
// reads each level's answer from the window's memory, so an answer taken in
// afterwards arrives after the decision that needed it, and the window asks the
// reader for what they already said.
//
// The entry is this window's where it names exactly the folders the window has
// open, by path and in any order. Any other entry belongs to another window, or
// to one still to come, and is left as it is. The answer is written first and the
// entry deleted second, so a window that goes down between the two finds it again
// rather than losing it.
export async function adoptCarriedAnswer(
  stores: AnswerStores,
  folders: readonly FolderLike[],
): Promise<NamedAnswer | null> {
  const carried = readCarriedAnswer(stores.global);
  if (carried === null) { return null; }
  if (!sameFolders(carried.folders, folders.map((f) => f.uri.fsPath))) { return null; }
  await rememberAnswer(stores.memory, carried.answer.level, carried.answer.path);
  await forgetCarriedAnswer(stores.global);
  return carried.answer;
}

// recordAnswerBeforeAdd records the answer a naming act gave where the window the
// reader is in after the add will read it, and answers with how to take it back
// if the editor refuses the add.
//
// Where the add happens in place, that is this window's own memory, and taking it
// back puts the previous answer there again. Where the add makes a new workspace,
// it is the carried answer, naming the folders the new workspace will hold, and
// this window's memory is not written. That memory stays with the window being
// left; an answer written there would be found the next time that window is open
// on its one folder, naming a folder it does not have or a workspace it does not
// reach, and be dropped with a notice saying so. Taking it back deletes the entry.
async function recordAnswerBeforeAdd(
  adding: AddingWindow,
  answer: NamedAnswer,
  foldersAfterAdd: readonly string[],
): Promise<() => Promise<void>> {
  if (addingMakesNewWorkspace(adding.windowKind)) {
    const carried: CarriedAnswer = { folders: [...foldersAfterAdd], answer: { ...answer } };
    await adding.global.update(CARRIED_ANSWER_STATE_KEY, carried);
    return () => forgetCarriedAnswer(adding.global);
  }
  const previous = await rememberAnswer(adding.memory, answer.level, answer.path);
  return async () => { await rememberAnswer(adding.memory, answer.level, previous); };
}

// FolderAppendingEditor is the part of the editor that adding a folder the reader
// has already named needs.
export type FolderAppendingEditor<L extends { fsPath: string }> =
  Pick<FolderAddingEditor<L>, 'addFolder' | 'showError'>;

// AnsweredAddOutcome is what adding a folder the reader named came to.
export type AnsweredAddOutcome = 'added-in-place' | 'added-to-new-workspace' | 'declined';

// addFolderWithAnswer adds a folder the reader has named, with the answer the
// naming gave recorded where the window they are in afterwards reads it, and
// reports what that came to. The folders the window has open are handed in as
// they were read, and the folder is appended after them.
//
// 🔴 THE ANSWER IS RECORDED BEFORE THE ADD, AND THE ORDER IS FORCED FROM BOTH
// SIDES. Where the add happens in place, the folders are re-evaluated on the
// editor's own folder-change event rather than under this function's control,
// so an answer recorded afterwards arrives after the decision that needed it.
// Where the add makes a new workspace, the editor takes this window down to make
// it, so nothing after the add can rely on running at all.
//
// It is the one sequence both routes that add a folder go through — this row's
// add entry, and the step that adds a folder Aggrega recognises — so the two
// cannot come to record in different places, and a refusal is told in the one
// sentence either route uses. Where the editor refuses, what was recorded is
// taken back, so no window is left remembering a folder it never reached.
export async function addFolderWithAnswer<L extends { fsPath: string }>(
  editor: FolderAppendingEditor<L>,
  adding: AddingWindow,
  open: readonly FolderLike[],
  folder: L,
  answer: NamedAnswer,
): Promise<AnsweredAddOutcome> {
  const foldersAfterAdd = [...open.map((f) => f.uri.fsPath), folder.fsPath];
  const takeBack = await recordAnswerBeforeAdd(adding, answer, foldersAfterAdd);
  if (!editor.addFolder(folder)) {
    await takeBack();
    editor.showError(folderDeclinedMessage(folder.fsPath));
    return 'declined';
  }
  return addingMakesNewWorkspace(adding.windowKind) ? 'added-to-new-workspace' : 'added-in-place';
}

// FolderAddingOutcome is what taking the add entry came to.
export type FolderAddingOutcome = 'cancelled' | 'already-open' | AnsweredAddOutcome;

// pickAndAddFolder asks the reader for a folder, adds it to the window as the
// folder to work from, and reports what that came to.
//
// 🔴 THE FOLDER ADDED BECOMES THE PROJECT FOLDER. The reader picked it here, in
// answer to which folder the editor works from, so the window they are in after
// the add names it and works from it rather than asking them again. Where the
// add happens in place the answer is this window's to keep, and the reader is
// told the folder the editor now works from, as choosing a listed folder tells
// them. Where the add makes a new workspace the answer is carried into it, and
// nothing is said: the window goes down, and the one that comes back names the
// folder on the row.
//
// A folder already open is told apart BEFORE the editor is asked. The editor
// refuses a second copy of a folder it has, and answers that refusal exactly as
// it answers every other, so a reader who picked a folder they already have
// would otherwise be told the editor declined — true, and no help at all. It
// records nothing and changes nothing.
//
// A dialog closed without a pick changes nothing and says nothing: the reader
// took the offer back, and there is nothing to report to them.
export async function pickAndAddFolder<L extends { fsPath: string }>(
  editor: FolderAddingEditor<L>,
  adding: AddingWindow,
): Promise<FolderAddingOutcome> {
  const picked = (await editor.pickFolder())?.[0];
  if (picked === undefined) { return 'cancelled'; }
  const folderPath = picked.fsPath;
  const open = editor.openFolders();
  if (open.some((f) => f.uri.fsPath === folderPath)) {
    editor.showInformation(folderAlreadyOpenMessage(folderPath));
    return 'already-open';
  }
  const outcome = await addFolderWithAnswer(
    editor, adding, open, picked, { level: 'project', path: folderPath },
  );
  if (outcome === 'added-in-place') {
    editor.showInformation(projectFolderSwitchMessage(folderPath));
  }
  return outcome;
}

// CHOOSE_PROJECT_FOLDER_INVITATION is the offer to change which folder the
// editor works from, as the closing line of a hover.
//
// It names the level from the one place the three levels are named, so the row
// and the chooser cannot come to call it two different things.
export const CHOOSE_PROJECT_FOLDER_INVITATION =
  `Click to choose which ${SELECTOR_ROW_LABELS.project} the editor works from.`;

// SOLE_PROJECT_FOLDER_INVITATION is the closing line of the same hover where the
// window has only one folder open.
//
// There the hover has just said there are no others to choose between, so an
// invitation to choose would contradict the line above it. What a press does
// offer there is the chooser's last two entries — opening a folder in place of
// this one, and adding one beside it — so that is what the line names, in the
// words those entries use.
export const SOLE_PROJECT_FOLDER_INVITATION =
  'Click to open a folder or add one to this window.';

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
