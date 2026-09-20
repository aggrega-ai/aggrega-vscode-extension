// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import {
  SELECT_RELEASE_COMMAND,
  SelectionState,
  describeSelection,
} from './release-selection';
import {
  SELECTOR_ROW_LABELS,
  SelectorRowKey,
  soleCandidateNote,
} from './selector-levels';
import { CREATE_WORKSPACE_COMMAND, DRAFT_RELEASE_COMMAND } from './get-started-steps';
import { CHOOSE_ANCHOR_INVITATION, SWITCH_ANCHOR_COMMAND } from './anchor-picker';
import { NO_ANCHORED_WORKSPACE_ROW_TOOLTIP } from './workspace';

// SelectorCreate is a row's SECOND control: the one that makes a new value for
// that level, standing beside the one that chooses among the values there are.
//
// 🔴 IT IS A CONTROL OF ITS OWN AND NEVER A MARK DRAWN INSIDE THE OTHER. A
// press anywhere on the choosing control chooses, so a create affordance
// painted inside it would run the wrong thing — and that is worse than having
// none at all, because a reader cannot see that the target they aimed at is not
// the one they hit.
export interface SelectorCreate {
  command: string;
  // label is the control's whole accessible name. The control draws no word of
  // its own, so a reader meeting it by keyboard is told only what it is called
  // — which means the name has to say which level it creates. "Create" alone
  // would be the same announcement on every row that has one.
  label: string;
}

// createControlKey derives the focus key of a row's create control from the
// row's own key, so the two cannot disagree and no second identifier for one
// control is recorded anywhere.
export function createControlKey(key: SelectorRowKey): string {
  return `${key}:create`;
}

// SelectorRow is one of the three rows that name what the editor is acting on.
//
// Each carries a field name, the current value, the longer explanation, and the
// command that changes it — so a row both reports the current answer and is
// where a different one is chosen. They are three rows rather than one because
// each has a value and an affordance of its own, and one row cannot show three
// pairs at a width a person can read; a row that truncates any of them makes
// the reader click to find out what is selected, which is the opposite of what
// an indicator is for.
export interface SelectorRow {
  key: SelectorRowKey;
  label: string;
  value: string;
  tooltip: string;
  command: string;
  icon: string;
  // create is the row's second control, or null where the level has nothing to
  // create. Bringing a project folder into being is not an Aggrega act, so that
  // row has none: a control there would promise a creation this extension does
  // not perform.
  create: SelectorCreate | null;
}

// SelectorCandidates is how many candidates each level has.
//
// 🔴 THE COUNTS ARRIVE AS FACTS ALREADY READ, never discovered here. The rows
// are composed synchronously, so a count this module went looking for would be
// a count that has not arrived at the moment it is wanted; and this module
// holds no editor type, so the folders a window has open are not reachable from
// here in any case.
//
// What each count is FOR is telling two empty readings apart. A level with
// nothing to choose and a level with something unchosen look identical to a
// reader who is only shown that nothing is set, and they are not: one of them
// is waiting on a decision and the other cannot be answered at this level at
// all.
export interface SelectorCandidates {
  // projectFolders is how many folders the editor currently has open.
  projectFolders: number;
  // aggregaWorkspaces is how many DISTINCT Aggrega workspaces those folders
  // reach. It is not a count of folders that CONTAIN one, and it is not a count
  // of folders at all: the rule climbs, so the root that answers for a folder
  // may sit above it, and one root answers for every open folder beneath it.
  // Counting the folders instead would report two where there is one workspace
  // and suppress the sentence saying a level holds only one candidate at
  // exactly the moment it is most wanted.
  aggregaWorkspaces: number;
  // releases is how many Releases the last enumeration could name in a request,
  // or null where no enumeration has produced an answer.
  //
  // 🔴 NULL IS "NOT READ", NEVER "NONE". The offerable set is read when a
  // connection resolves the selection and again whenever the reader opens the
  // chooser, and nothing watches the folder in between — so this is the count
  // as at the last reading rather than as of now, and a Release written since
  // is found by opening the chooser, which is the act that reads again.
  //
  // It counts what can be CHOSEN rather than what the language server reported:
  // a candidate this editor cannot name relative to the anchored folder is one
  // the chooser will not offer, so counting it would promise a choice that is
  // not there.
  releases: number | null;
}

// PROJECT_FOLDER_COMMAND changes which folder the editor is working in.
//
// IT IS THE EDITOR'S OWN COMMAND RATHER THAN ONE OF THIS EXTENSION'S. Which
// folders a window has open is the editor's to decide, so a command here would
// be a second door onto a room that already has one, and the two would come to
// differ the first time either changed.
//
// What it puts in front of a reader is the editor's business and differs
// between platforms — a system dialogue on some, a list inside the window on
// others. What it CHANGES is the same either way, and it is the only thing that
// reaches a folder the window does not already have open.
export const PROJECT_FOLDER_COMMAND = 'workbench.action.openFolder';

// projectFolderRow renders the folder the editor is working in.
//
// It is the outermost of the three levels and the only one that is the
// editor's rather than Aggrega's, which is why it carries no create control.
//
// 🔴 IT HAS NO "NONE SELECTED" READING, AND THE ABSENCE IS THE TRUTH RATHER
// THAN AN OMISSION. Nothing at this level is chosen by the reader — the value
// is the folder Aggrega settled on — so there is no decision they can be
// waiting to make and none is invented for them. What it has instead are two
// empty readings they act on differently: no folder open at all, whose way out
// is opening one, and folders open with Aggrega working in none of them, which
// opening another folder does not by itself resolve. Telling those apart is
// what the count is passed in for; without it the row says "none open" in a
// window that plainly has folders open, which is the plainest falsehood on this
// panel.
export function projectFolderRow(
  openedFolder: string | null,
  candidates: number,
): SelectorRow {
  const base = {
    key: 'project' as const,
    label: SELECTOR_ROW_LABELS.project,
    command: PROJECT_FOLDER_COMMAND,
    icon: 'folder-opened',
    create: null,
  };
  if (candidates === 0) {
    // The way out is the very thing this row's own control does, so saying so
    // is the exit rather than an instruction to hunt for one elsewhere.
    return {
      ...base,
      value: 'none open',
      tooltip:
        `Aggrega: no ${SELECTOR_ROW_LABELS.project} is open.\nClick to open one.`,
    };
  }
  if (openedFolder === null) {
    const open = candidates === 1
      ? `One ${SELECTOR_ROW_LABELS.project} is open in this window.`
      : `${candidates} ${SELECTOR_ROW_LABELS.project}s are open in this window.`;
    // Why none of them is in use is deliberately not asserted here. More than
    // one state reaches this reading — nothing open carries a workspace, and
    // several do with none of them chosen — and the row below is where that
    // difference is reported.
    return {
      ...base,
      value: 'none in use',
      tooltip:
        `Aggrega: no ${SELECTOR_ROW_LABELS.project} is in use.\n${open}\nClick to open a different one.`,
    };
  }
  const sole = candidates === 1 ? `\n${soleCandidateNote('project')}` : '';
  return {
    ...base,
    value: path.basename(openedFolder),
    tooltip:
      `${SELECTOR_ROW_LABELS.project}: ${openedFolder}${sole}\nClick to open a different one.`,
  };
}

// workspaceRow renders the Aggrega workspace the editor is acting in.
//
// It shows the folder THE LANGUAGE SERVER ANCHORED TO, not the folder that was
// opened, and the difference is the whole reason the row exists. The Release
// list is a property of the anchored folder: the server enumerates over it and
// resolves every request against it. Showing the opened folder would name a
// folder the list is not computed against, and would mislead about exactly the
// thing this row is here to explain. The two coincide whenever the opened
// folder is itself the anchor; the row earns its place when they do not, which
// is why the opened folder is named in the explanation whenever it differs.
//
// 🔴 ITS TWO EMPTY READINGS ARE NOT ONE STATE. A project holding no Aggrega
// workspace and a project holding several with none of them in use are as far
// apart as a surface can put two absences: the first cannot be resolved by
// choosing at all, and a reading that invited a choice there would send a
// reader to a list that must come back empty. So the first carries the two ways
// OUT of it — bring a folder that holds one into the window, or make one — and
// only the second says to choose.
export function workspaceRow(
  anchoredRoot: string | null,
  openedFolder: string | null,
  candidates: number,
): SelectorRow {
  const base = {
    key: 'workspace' as const,
    label: SELECTOR_ROW_LABELS.workspace,
    command: SWITCH_ANCHOR_COMMAND,
    icon: 'root-folder',
    create: {
      command: CREATE_WORKSPACE_COMMAND,
      // The name says WHAT is created and never WHERE. Writing "here" was tried
      // and removed: a control's name is read on its own, with none of the row
      // around it, so a word placing the creation reads as a promise about the
      // folder — and the command settles that for itself rather than taking it
      // from this row.
      label: `Create an ${SELECTOR_ROW_LABELS.workspace}`,
    },
  };
  if (anchoredRoot === null) {
    if (candidates === 0) {
      return {
        ...base,
        value: 'none available',
        // Read from the one home of this state's wording rather than written
        // here. The same absence reaches a reader as a notification, as a tree
        // row and as the reason a control cannot run, and a rendering invented
        // beside the surface that draws it is how one state came to be
        // described in two vocabularies.
        tooltip: NO_ANCHORED_WORKSPACE_ROW_TOOLTIP,
      };
    }
    const sole = candidates === 1 ? `\n${soleCandidateNote('workspace')}` : '';
    // The last folder is named rather than called the current one, because
    // that is what it is: the value is retained after the language server
    // stops, so calling it the open folder here would state something that has
    // stopped being true at exactly the moment the reader is trying to work out
    // what went wrong.
    const last = openedFolder === null
      ? ''
      : `\nThe last folder Aggrega worked in is ${openedFolder}.`;
    return {
      ...base,
      value: 'none selected',
      tooltip:
        `Aggrega: no ${SELECTOR_ROW_LABELS.workspace} is selected, and the language server has not reported one it anchored to.${sole}${last}\nClick to choose one.`,
    };
  }
  const differs = openedFolder !== null
    && path.resolve(anchoredRoot) !== path.resolve(openedFolder);
  const opened = differs ? `\nThe open folder is ${openedFolder}.` : '';
  const sole = candidates === 1 ? `\n${soleCandidateNote('workspace')}` : '';
  return {
    ...base,
    value: path.basename(anchoredRoot),
    // The closing sentence promises a CHOICE, not a change, and the distinction
    // is what makes it true in every case. A click opens what the editor can
    // work in together with the way to make another workspace available — so
    // the sentence holds with one as much as with several. Promising to switch
    // would be a promise this row cannot keep for the reader who has exactly
    // one, and a row that advertises an action and then declines it is worse
    // than one that says nothing. It is read from the choice's own module
    // because the status bar and the chooser make the same offer.
    tooltip:
      `${SELECTOR_ROW_LABELS.workspace}: ${anchoredRoot}\nThe Releases on offer are the ones inside this folder.${opened}${sole}\n${CHOOSE_ANCHOR_INVITATION}`,
  };
}

// releaseRow renders the Release the editor is acting on.
//
// The wording is not written here: it comes from the one function that
// describes the selection, so this row and the status-bar indicator cannot say
// different things about one state. The command is the indicator's own, so
// there is one way to choose a Release however the reader reaches it.
//
// It takes what is on offer for the same reason the two rows above take a
// count: "no Release is selected" and "there is no Release to select" are
// different states and a reader acts on them differently. The count may be
// null, which is a third statement again — nobody has looked — and it is
// passed through as it stands rather than read as either of the other two.
export function releaseRow(state: SelectionState, releases: number | null): SelectorRow {
  const described = describeSelection(state, releases);
  return {
    key: 'release',
    label: SELECTOR_ROW_LABELS.release,
    value: described.value,
    tooltip: described.detail,
    command: SELECT_RELEASE_COMMAND,
    icon: 'rocket',
    create: {
      command: DRAFT_RELEASE_COMMAND,
      // Named for what it creates rather than where, for the reason the
      // Aggrega workspace row's own create control states: the drafting this
      // opens produces a document to be placed, so a name that placed it would
      // be describing something the flow has not done yet.
      label: `Create a ${SELECTOR_ROW_LABELS.release}`,
    },
  };
}

// selectorRows builds all three rows in display order.
export function selectorRows(
  anchoredRoot: string | null,
  openedFolder: string | null,
  state: SelectionState,
  candidates: SelectorCandidates,
): SelectorRow[] {
  return [
    projectFolderRow(openedFolder, candidates.projectFolders),
    workspaceRow(anchoredRoot, openedFolder, candidates.aggregaWorkspaces),
    releaseRow(state, candidates.releases),
  ];
}
