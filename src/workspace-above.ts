// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { WorkspaceStateLike } from './anchor-picker';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { workspaceSitsAboveFolder } from './workspace';

// The reader is told, out loud, when the Aggrega workspace in force sits above
// the folder their window is open on.
//
// 🔴 THE ACCOUNT REACHES THEM ON TWO SURFACES AND THE DIFFERENCE BETWEEN THEM IS
// THE WHOLE DESIGN. The first is an interruption they have to dismiss, because
// everything surprising downstream follows from the workspace being somewhere
// else — settings they did not write are in force, catalog locations resolve
// from a tree they cannot see, and Releases appear that they cannot open — and a
// reader who never learns the root is elsewhere attributes every one of those to
// a fault in the product. The second is a mark that stays on the row naming the
// workspace for as long as the condition holds. An interruption is a one-time
// event and the condition is permanent, so DISMISSING THE POP-UP MUST NOT
// DISMISS THE TRUTH: the mark is what carries the fact after the interruption is
// gone.
//
// Both are composed here, from one text, so the account a reader dismisses and
// the account they go back to cannot come to say different things.
//
// This module holds no editor type, so every sentence, every action, the
// decision about whether to interrupt at all and the sequence that acts on the
// reader's answer are drivable with no extension host running. What needs the
// editor — putting the dialogue up, and opening a folder — is handed in by the
// module where the editor is.

// WORKSPACE_ABOVE_HEADLINE is the one sentence that names the state, and it is
// the line both surfaces open with.
//
// It is also the mark's whole accessible name, which is why it is a complete
// sentence rather than a label: a reader meeting the mark by keyboard is told
// this and nothing else, and "warning" would tell them there is something to
// know without telling them what it is.
export const WORKSPACE_ABOVE_HEADLINE =
  'Aggrega is using a workspace from outside the folder you opened.';

// workspaceAboveAccount is what the reader is told beneath the headline, as its
// lines, or null where the workspace does not sit above the folder at all.
//
// 🔴 IT IS THE TWO PATHS AND NOTHING ELSE. The reader acts on the paths — the
// workspace they are being worked from, and the folder they opened — so each is
// given on a line of its own, behind a label, in full. A full path rather than a
// folder's last name, because this is read with none of the window around it and
// two folders sharing a last name is the ordinary case rather than the odd one.
//
// The first label is the bare word, and that is safe here in a way it is not on
// the row: the headline immediately above it has just said whose workspace it
// is. The second is the level's own name, read from the one place the levels
// are named, so the account and the row above it cannot call one level two
// different things.
//
// 🔴 IT NAMES NO DISTANCE. The walk that finds the workspace climbs to the
// nearest marked ancestor, which may be several directories up, so any phrasing
// counting the levels would be false for every reader deeper than the count —
// and false in precisely the deep tree this is most worth saying in. A number
// changes nothing the reader would do differently and is one more fact to keep
// true as the walk changes.
export function workspaceAboveAccount(
  anchoredRoot: string | null,
  openedFolder: string | null,
): string[] | null {
  if (!workspaceSitsAboveFolder(anchoredRoot, openedFolder)) { return null; }
  return [
    `Workspace: ${anchoredRoot}`,
    `${SELECTOR_ROW_LABELS.project}: ${openedFolder}`,
  ];
}

// WorkspaceAboveChoice is what a press on one of the dialogue's actions means.
//
// The actions carry their meaning rather than their wording, so the side that
// acts on a press never matches on a sentence. A label is text a reader reads
// and may be revised; a comparison against one is a second spelling of it that
// nothing warns about when the first moves.
export type WorkspaceAboveChoice = 'open' | 'continue' | 'silence';

// WorkspaceAboveAction is one of the dialogue's actions, in the shape the editor
// takes plus the meaning above.
//
// The close affordance is declared rather than left to the editor, which
// otherwise adds a cancel of its own. Declaring it puts the dismissing press and
// the press that changes nothing on one action, so a reader who dismisses with
// the keyboard and a reader who presses the middle action reach the same place —
// and neither of them silences anything they did not ask to silence.
export interface WorkspaceAboveAction {
  title: string;
  isCloseAffordance?: boolean;
  choice: WorkspaceAboveChoice;
}

// WorkspaceAboveNotice is the whole dialogue: what it says, and what it offers.
export interface WorkspaceAboveNotice {
  message: string;
  detail: string;
  actions: WorkspaceAboveAction[];
}

// workspaceAboveNotice composes the interruption, or answers with null where
// there is nothing to interrupt anyone about.
//
// 🔴 IT CARRIES NO MARKUP AND NO ICON, and both absences are the content
// arriving rather than being dropped. The dialogue renders plain text, so an
// emphasis marker would reach the reader as the two characters it is written
// with and read as a rendering fault; the weight the headline asks for is
// carried by the dialogue's own message slot, which the editor draws heavier
// than the detail beneath it. The warning pictograph is the editor's too — a
// warning dialogue draws one — so writing one would put a second triangle beside
// the first.
//
// The opening action says what pressing costs as well as where it goes. Opening
// a folder takes the window down and stands it back up, with this extension, the
// language server and everything unsaved in the window going with it, so a name
// giving only the destination would be accurate and would still surprise every
// reader who pressed it.
//
// 🔴 NO ACTION CARRIES A PATH. The dialogue lays its buttons out itself, and what
// an extension controls is how wide they are — which is set by their labels. The
// workspace's path is on the line directly above the buttons, so repeating it in
// a label would widen the whole dialogue to say something already said.
export function workspaceAboveNotice(
  anchoredRoot: string | null,
  openedFolder: string | null,
): WorkspaceAboveNotice | null {
  const account = workspaceAboveAccount(anchoredRoot, openedFolder);
  if (account === null) { return null; }
  return {
    message: WORKSPACE_ABOVE_HEADLINE,
    detail: account.join('\n'),
    actions: [
      { title: 'Open workspace (reloads the window)', choice: 'open' },
      { title: 'Continue here', isCloseAffordance: true, choice: 'continue' },
      { title: 'Don\'t show again for this folder', choice: 'silence' },
    ],
  };
}

// FoldersTold records which folders this window has interrupted the reader
// about, against the workspace each was interrupted about.
//
// 🔴 IT LIVES NO LONGER THAN THE WINDOW, AND THAT IS ITS WHOLE CONTRACT. It is
// held in memory and is handed no store — its constructor takes nothing — so
// nothing it records can outlast the extension host it was made in, which a
// reload and a relaunch both replace. A new window on the same folder is told
// again, unless the reader asked not to be. Kept beside the reader's own answer
// in the editor's store instead, it would make "Continue here" do what "Don't
// show again for this folder" does, so a reader who asked for nothing would
// never be told again; and a raise they never saw — a dialogue the editor held
// back while starting, a window closed before it drew — would spend the
// interruption for good rather than for one window.
//
// Keyed by folder, because a window with several folders open is told about
// each one it works from. And the workspace is recorded beside the folder,
// because the account is about a PAIR: a folder whose workspace has moved — a
// marker written closer to it, or the one above it removed — is a different fact
// from the one the reader was told, and a record that could not tell the two
// apart would leave them holding an account that had quietly stopped being true.
export class FoldersTold {
  private readonly byFolder = new Map<string, string>();

  // has reports whether this window has told the reader about the folder,
  // against this workspace.
  has(openedFolder: string, anchoredRoot: string): boolean {
    return this.byFolder.get(openedFolder) === anchoredRoot;
  }

  // record notes that the reader has been told about the folder, against this
  // workspace.
  record(openedFolder: string, anchoredRoot: string): void {
    this.byFolder.set(openedFolder, anchoredRoot);
  }
}

// WORKSPACE_ABOVE_SILENCED_STATE_KEY is the editor-local entry listing the
// folders the reader has asked not to be interrupted about again.
//
// 🔴 IT IS THE ONLY PART OF THIS THAT OUTLIVES A WINDOW, because it is the only
// part the reader SAID. What this extension did — raise the dialogue — is held
// for the window's life and no longer; what the reader answered is kept, and it
// outlives every workspace that folder may come to resolve to.
//
// 🔴 IT IS KEYED BY FOLDER INSIDE THE ENTRY, AND THAT IS WHAT MAKES IT A
// PER-FOLDER ANSWER. The store the editor gives an extension is scoped to the
// window's folder or workspace rather than to a folder inside it, so a window
// with several folders open shares one entry — and a single value there would
// mean silencing one folder silenced every other folder the reader went on to
// work from.
export const WORKSPACE_ABOVE_SILENCED_STATE_KEY = 'aggrega.workspaceAboveSilenced';

// readFoldersSilenced reports which folders the reader has asked not to be
// interrupted about.
//
// A value that is not a list of paths reads as none. A window carrying state
// written by an older version of this extension is the ordinary way that
// happens, and the honest reading of an entry this version cannot understand is
// that the reader has not asked.
export function readFoldersSilenced(state: WorkspaceStateLike): string[] {
  const raw = state.get<unknown>(WORKSPACE_ABOVE_SILENCED_STATE_KEY);
  if (!Array.isArray(raw)) { return []; }
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

// workspaceAboveNoticeDue reports whether the reader should be interrupted now.
//
// Three things have to hold and each rules out a different way of being wrong:
// the workspace has to sit above the folder at all, the reader must not have
// asked to be left alone about that folder, and this window must not already
// have told them about this workspace for it. The condition itself is read from
// the one comparison of those two paths rather than made again here.
export function workspaceAboveNoticeDue(
  silenced: WorkspaceStateLike,
  told: FoldersTold,
  anchoredRoot: string | null,
  openedFolder: string | null,
): boolean {
  if (!workspaceSitsAboveFolder(anchoredRoot, openedFolder)) { return false; }
  const folder = openedFolder as string;
  if (readFoldersSilenced(silenced).includes(folder)) { return false; }
  return !told.has(folder, anchoredRoot as string);
}

// silenceFolder records that the reader has asked not to be interrupted about
// one folder again.
//
// It leaves the mark on the row untouched, and that is the whole distinction the
// two surfaces exist for: what the reader declined is the interruption, not the
// fact. The row goes on reporting it for as long as it holds.
export async function silenceFolder(
  state: WorkspaceStateLike,
  openedFolder: string,
): Promise<void> {
  const silenced = readFoldersSilenced(state);
  if (silenced.includes(openedFolder)) { return; }
  await state.update(WORKSPACE_ABOVE_SILENCED_STATE_KEY, [...silenced, openedFolder]);
}

// WorkspaceAboveEditor is the two things the interruption needs the editor for:
// putting the dialogue in front of the reader, and opening the workspace as the
// window's folder when they ask for it.
//
// raise answers with the action pressed, or with nothing where the dialogue was
// closed without one.
export interface WorkspaceAboveEditor {
  raise(notice: WorkspaceAboveNotice): Thenable<WorkspaceAboveAction | undefined>;
  openWorkspace(): Thenable<void>;
}

// tellWorkspaceAboveIfDue interrupts the reader where they are due to be told,
// acts on their answer, and reports what the answer meant — or null where
// nothing was raised.
//
// The folder is recorded as told BEFORE the dialogue is put in front of anyone
// rather than after they answer it. A dialogue stands until it is dismissed, and
// re-evaluating the open folders is something the editor asks for whenever they
// change — so a record written on the answer would let a second dialogue be
// raised behind the first, and a reader would dismiss the same account twice.
// The record lives for the window only, so a raise the reader never saw costs
// them this window's interruption and not the next one's.
//
// 🔴 A DIALOGUE CLOSED WITH NO ACTION MEANS "CONTINUE HERE". That is the action
// the dialogue declares as its close affordance, so the keyboard, the close
// control and the middle action all reach the same place — and none of them
// writes anything, so a new window tells the reader again. Only the press that
// asks for silence is kept.
export async function tellWorkspaceAboveIfDue(
  silenced: WorkspaceStateLike,
  told: FoldersTold,
  editor: WorkspaceAboveEditor,
  anchoredRoot: string | null,
  openedFolder: string | null,
): Promise<WorkspaceAboveChoice | null> {
  if (!workspaceAboveNoticeDue(silenced, told, anchoredRoot, openedFolder)) { return null; }
  const notice = workspaceAboveNotice(anchoredRoot, openedFolder);
  if (notice === null) { return null; }
  const folder = openedFolder as string;
  told.record(folder, anchoredRoot as string);
  const answer = await editor.raise(notice);
  const choice = answer?.choice ?? 'continue';
  if (choice === 'silence') { await silenceFolder(silenced, folder); }
  if (choice === 'open') { await editor.openWorkspace(); }
  return choice;
}
