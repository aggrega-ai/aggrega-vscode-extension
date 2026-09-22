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
// This module holds no editor type, so every sentence, every action and the
// decision about whether to interrupt at all are assertable with no extension
// host running. What needs the editor — raising the dialogue and acting on the
// answer — stays where the editor is.

// WORKSPACE_ABOVE_HEADLINE is the one sentence that names the state, and it is
// the one line both surfaces open with.
//
// It is also the mark's whole accessible name, which is why it is a complete
// sentence rather than a label: a reader meeting the mark by keyboard is told
// this and nothing else, and "warning" would tell them there is something to
// know without telling them what it is.
export const WORKSPACE_ABOVE_HEADLINE =
  'Aggrega is working from a folder above the one you opened.';

// workspaceAboveAccount is what the reader is told, as its paragraphs, or null
// where the workspace does not sit above the folder at all.
//
// Each sentence does a job and none of them is decoration. The first names the
// folder they opened and the root, so the two are distinguishable. The second
// says where settings and catalog locations are read from, which is the cause of
// the surprises. It also warns that Releases from anywhere beneath the root can
// appear, including ones outside this window, which is the surprise that
// otherwise reads as a fault. The last is the one reassurance in it, and it says
// where a build's output lands.
//
// 🔴 THE LAST SENTENCE HAS TWO FORMS BECAUSE THE BUILD HAS TWO BEHAVIOURS, and
// telling the reader WHICH CASE THEY ARE IN is what makes the sentence true
// rather than merely careful. A build request carries where inside the workspace
// it writes, taken from the folder the reader works FROM; with no folder chosen
// there is no such folder, the request carries nothing, and the build writes
// where a build run at the workspace root writes. A single sentence covering
// both would be a statement the reader has to work out how to apply to
// themselves, on a surface they cannot dismiss without reading.
//
// 🔴 IT NAMES NO DISTANCE. The walk that finds the workspace climbs to the
// nearest marked ancestor, which may be several directories up, so any phrasing
// counting the levels would be false for every reader deeper than the count —
// and false in precisely the deep tree this is most worth saying in. The reader
// acts on the PATH; a number changes nothing they would do differently and is
// one more fact to keep true as the walk changes.
//
// The folder the reader works from is the folder the workspace was reached from
// whenever they have chosen one at all — choosing scopes the search to that
// folder — so the two sentences that name it name one directory rather than
// risking two.
export function workspaceAboveAccount(
  anchoredRoot: string | null,
  openedFolder: string | null,
  chosenFolder: string | null,
): string[] | null {
  if (!workspaceSitsAboveFolder(anchoredRoot, openedFolder)) { return null; }
  const destination = chosenFolder === null
    ? `Builds write into ${anchoredRoot}, the ${SELECTOR_ROW_LABELS.workspace}, because you `
      + 'have not chosen a folder to work from. This is outside the folder opened in the editor.'
    : `Builds still write into ${chosenFolder}, where you can see them.`;
  return [
    `You opened ${openedFolder}. The ${SELECTOR_ROW_LABELS.workspace} it belongs to is `
    + `${anchoredRoot}, outside this window.`,
    `Settings and catalog locations are read from ${anchoredRoot}, and `
    + `${SELECTOR_ROW_LABELS.release}s anywhere beneath it can appear here, including ones you `
    + 'cannot open from this window.',
    destination,
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
// with and read as a rendering fault; the emphasis the account asks for on its
// opening sentence is carried by the dialogue's own message slot, which the
// editor draws heavier and larger than the detail beneath it. The warning
// pictograph is the editor's too — a warning dialogue draws one — so writing one
// would put a second triangle beside the first.
//
// The opening action names the destination AND what pressing costs. Opening a
// folder takes the window down and stands it back up, with this extension, the
// language server and everything unsaved in the window going with it, so a name
// giving only the destination would be accurate and would still surprise every
// reader who pressed it. That is the same reason the row's own offer carries its
// consequence, and the two say it the same way.
export function workspaceAboveNotice(
  anchoredRoot: string | null,
  openedFolder: string | null,
  chosenFolder: string | null,
): WorkspaceAboveNotice | null {
  const account = workspaceAboveAccount(anchoredRoot, openedFolder, chosenFolder);
  if (account === null) { return null; }
  return {
    message: WORKSPACE_ABOVE_HEADLINE,
    detail: account.join('\n\n'),
    actions: [
      { title: `Open ${anchoredRoot}. The window reloads.`, choice: 'open' },
      { title: 'Continue here', isCloseAffordance: true, choice: 'continue' },
      { title: 'Don\'t show again for this folder', choice: 'silence' },
    ],
  };
}

// WORKSPACE_ABOVE_TOLD_STATE_KEY is the editor-local entry recording which
// folders the interruption has already been raised for, against the workspace it
// was raised about.
//
// 🔴 IT IS KEYED BY FOLDER INSIDE THE ENTRY, AND THAT IS WHAT MAKES IT A
// PER-FOLDER FACT. The store the editor gives an extension is scoped to the
// window rather than to a folder, so a window with several folders open shares
// one entry — and a single value there would mean telling a reader about one
// folder silenced the account for every other folder they went on to work from.
//
// The workspace is recorded beside the folder rather than the folder alone,
// because the account is about a PAIR. A folder whose workspace has moved — a
// marker written closer to it, or the one above it removed — is a different fact
// from the one the reader was told, and a record that could not tell the two
// apart would leave them with an account that had quietly stopped being true.
export const WORKSPACE_ABOVE_TOLD_STATE_KEY = 'aggrega.workspaceAboveTold';

// WORKSPACE_ABOVE_SILENCED_STATE_KEY is the editor-local entry listing the
// folders the reader has asked not to be interrupted about again.
//
// It is a second entry rather than a value inside the first, and the difference
// is which fact each records. The first is something this extension did; this is
// something the reader SAID, and a reader's answer outlives every workspace that
// folder may come to resolve to. Folding them together would either make the
// reader's answer expire when a marker moved, or make this extension's own
// bookkeeping read as a decision they never took.
export const WORKSPACE_ABOVE_SILENCED_STATE_KEY = 'aggrega.workspaceAboveSilenced';

// readFoldersTold reports which folders have been interrupted about, against the
// workspace each was interrupted about.
//
// Anything that is not the recorded shape reads as nothing recorded. A window
// carrying state written by an older version of this extension is the ordinary
// way that happens, and the honest reading of an entry this version cannot
// understand is that the reader has not been told.
export function readFoldersTold(state: WorkspaceStateLike): Record<string, string> {
  const raw = state.get<unknown>(WORKSPACE_ABOVE_TOLD_STATE_KEY);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
  const told: Record<string, string> = {};
  for (const [folder, root] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof root === 'string' && root.length > 0) { told[folder] = root; }
  }
  return told;
}

// readFoldersSilenced reports which folders the reader has asked not to be
// interrupted about. A value that is not a list of paths reads as none, for the
// reason the reading above states.
export function readFoldersSilenced(state: WorkspaceStateLike): string[] {
  const raw = state.get<unknown>(WORKSPACE_ABOVE_SILENCED_STATE_KEY);
  if (!Array.isArray(raw)) { return []; }
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

// workspaceAboveNoticeDue reports whether the reader should be interrupted now.
//
// Three things have to hold and each rules out a different way of being wrong:
// the workspace has to sit above the folder at all, the reader must not have
// asked to be left alone about that folder, and they must not already have been
// told about this workspace for it. The condition itself is read from the one
// comparison of those two paths rather than made again here.
export function workspaceAboveNoticeDue(
  state: WorkspaceStateLike,
  anchoredRoot: string | null,
  openedFolder: string | null,
): boolean {
  if (!workspaceSitsAboveFolder(anchoredRoot, openedFolder)) { return false; }
  const folder = openedFolder as string;
  if (readFoldersSilenced(state).includes(folder)) { return false; }
  return readFoldersTold(state)[folder] !== anchoredRoot;
}

// recordFolderTold records that the interruption has been raised for one folder,
// against the workspace it was raised about.
//
// It is written BEFORE the dialogue is put in front of anyone rather than after
// they answer it. A dialogue stands until it is dismissed, and re-evaluating the
// open folders is something the editor asks for whenever they change — so a
// record written on the answer would let a second dialogue be raised behind the
// first, and a reader would dismiss the same account twice.
export async function recordFolderTold(
  state: WorkspaceStateLike,
  openedFolder: string,
  anchoredRoot: string,
): Promise<void> {
  await state.update(WORKSPACE_ABOVE_TOLD_STATE_KEY, {
    ...readFoldersTold(state),
    [openedFolder]: anchoredRoot,
  });
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
