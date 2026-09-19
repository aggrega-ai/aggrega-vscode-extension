// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { SelectionState, describeSelection } from './release-selection';
import { CREATE_WORKSPACE_COMMAND, DRAFT_RELEASE_COMMAND } from './get-started-steps';
import { SELECT_RELEASE_COMMAND } from './release-status';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// SELECTOR_ROW_KEYS names the three rows in display order, and THE ORDER IS THE
// TEACHING.
//
// Three things nest — the folder the editor is working in, the Aggrega
// workspace reached from it, and the Release chosen inside that — and the
// arrangement is what shows a reader they nest. Explaining it in a sentence
// instead was the alternative and it is the wrong repair: the surface a reader
// meets first already carries more prose than anyone reads, so a fourth
// paragraph about containment would be read by nobody who needed it.
export const SELECTOR_ROW_KEYS = ['project', 'workspace', 'release'] as const;

export type SelectorRowKey = (typeof SELECTOR_ROW_KEYS)[number];

// SELECTOR_ROW_LABELS is the one home of the three words a reader is taught, so
// a row and any sentence written about that row cannot come to call one level
// two different things.
//
// THE MIDDLE ONE CARRIES THE PRODUCT NAME, and that is the point rather than
// verbosity. "Workspace" on its own already names the set of folders a window
// has open, so a row labelled with the bare word names two different things at
// once — which is the confusion these rows exist to remove rather than one to
// inherit.
export const SELECTOR_ROW_LABELS: Record<SelectorRowKey, string> = {
  project: 'Project folder',
  workspace: 'Aggrega workspace',
  release: 'Release',
};

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

// SelectorCandidates is how many candidates each level has, for the levels
// where that is a fact the surface already holds.
//
// 🔴 THE RELEASE LEVEL IS DELIBERATELY ABSENT, and a field for it must not be
// added until something produces one. The offerable Releases are gathered
// inside the two flows that restore and choose a selection, and the set is not
// kept afterwards — so a field here would be a state nothing can fill, which a
// reader of this interface would reasonably believe otherwise about.
//
// THE COUNTS ARRIVE AS FACTS ALREADY READ, never discovered here. The rows are
// composed synchronously, so a count this module went looking for would be a
// count that has not arrived at the moment it is wanted; and this module holds
// no editor type, so the folders a window has open are not reachable from here
// in any case.
export interface SelectorCandidates {
  // projectFolders is how many folders the editor currently has open.
  projectFolders: number;
  // aggregaWorkspaces is how many of those folders Aggrega resolved a workspace
  // root for. It is not a count of folders that CONTAIN one: the rule climbs,
  // so the root that answers for a folder may sit above it, and one root can
  // answer for two open folders at once.
  aggregaWorkspaces: number;
}

// soleCandidateNote is the sentence a level adds when it holds exactly one
// candidate.
//
// A chooser holding a single entry reads as broken — a reader presses it,
// meets a list of one, and cannot tell whether that is the answer or a failure
// to look. So the row says there is only one before they press, and it says it
// in the level's own name, from the one place those names are written.
function soleCandidateNote(key: SelectorRowKey): string {
  return `Only one ${SELECTOR_ROW_LABELS[key]} is available, so there are no others to choose between.`;
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

// SWITCH_ANCHOR_COMMAND is the command the Aggrega workspace row runs when
// clicked.
export const SWITCH_ANCHOR_COMMAND = 'aggrega.workspace.switchAnchor';

// projectFolderRow renders the folder the editor is working in.
//
// It is the outermost of the three levels and the only one that is the
// editor's rather than Aggrega's, which is why it carries no create control.
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
  if (openedFolder === null) {
    return {
      ...base,
      value: 'none open',
      tooltip:
        `Aggrega: no ${SELECTOR_ROW_LABELS.project} is open.\nClick to open one.`,
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
  if (openedFolder === null) {
    return {
      ...base,
      value: 'none anchored',
      tooltip: NO_ANCHORED_WORKSPACE_MESSAGE,
    };
  }
  if (anchoredRoot === null) {
    return {
      ...base,
      value: 'not reported',
      tooltip:
        `Aggrega: the language server has not reported which folder it anchored to, so no Release can be offered.\nThe open folder is ${openedFolder}.\nRestart the language server to try again.`,
    };
  }
  const differs = path.resolve(anchoredRoot) !== path.resolve(openedFolder);
  const opened = differs ? `\nThe open folder is ${openedFolder}.` : '';
  const sole = candidates === 1 ? `\n${soleCandidateNote('workspace')}` : '';
  return {
    ...base,
    value: path.basename(anchoredRoot),
    // The closing sentence promises a CHOICE, not a change, and the distinction
    // is what makes it true in every case. A click opens what the editor can
    // work in together with the way to make another folder available — so the
    // sentence holds with one folder as much as with several. Promising to
    // switch would be a promise this row cannot keep for the reader who has
    // exactly one, and a row that advertises an action and then declines it is
    // worse than one that says nothing.
    tooltip:
      `${SELECTOR_ROW_LABELS.workspace}: ${anchoredRoot}\nThe Releases on offer are the ones inside this folder.${opened}${sole}\nClick to choose which folder the editor works in.`,
  };
}

// releaseRow renders the Release the editor is acting on.
//
// The wording is not written here: it comes from the one function that
// describes the selection, so this row and the status-bar indicator cannot say
// different things about one state. The command is the indicator's own, so
// there is one way to choose a Release however the reader reaches it.
//
// It takes no candidate count, and the absence is the honest shape rather than
// an omission: nothing holds the set of offerable Releases between one choice
// and the next, so there is no count to report and none is invented.
export function releaseRow(state: SelectionState): SelectorRow {
  const described = describeSelection(state);
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
    releaseRow(state),
  ];
}
