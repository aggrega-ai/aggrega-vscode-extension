// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { SelectionState, describeSelection } from './release-selection';
import { SELECT_RELEASE_COMMAND } from './release-status';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// SELECTOR_ROW_KEYS names the two rows in display order. The order is the
// reading order a person needs: which folder the editor is acting in decides
// which Releases exist, so it is answered before which Release is chosen.
export const SELECTOR_ROW_KEYS = ['workspace', 'release'] as const;

export type SelectorRowKey = (typeof SELECTOR_ROW_KEYS)[number];

// SelectorRow is one of the two rows that name what the editor is acting on.
//
// Each carries a field name, the current value, the longer explanation, and the
// command that changes it — so a row both reports the current answer and is
// where a different one is chosen. They are two rows rather than one because
// each has a value and an affordance of its own, and one row cannot show both
// pairs at a width a person can read; a row that truncates either makes the
// reader click to find out what is selected, which is the opposite of what an
// indicator is for.
export interface SelectorRow {
  key: SelectorRowKey;
  label: string;
  value: string;
  tooltip: string;
  command: string;
  icon: string;
}

// SWITCH_ANCHOR_COMMAND is the command the workspace row runs when clicked.
export const SWITCH_ANCHOR_COMMAND = 'aggrega.workspace.switchAnchor';

// workspaceRow renders the folder the editor is acting in.
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
): SelectorRow {
  const base = {
    key: 'workspace' as const,
    label: 'Workspace',
    command: SWITCH_ANCHOR_COMMAND,
    icon: 'root-folder',
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
  return {
    ...base,
    value: path.basename(anchoredRoot),
    // The closing sentence promises a CHOICE, not a change, and the distinction
    // is what makes it true in every case. A click opens what the editor can
    // work in together with the way to make another folder available — so the
    // sentence holds with one folder as much as with several, which is why this
    // function needs no count of them. Promising to switch would be a promise
    // this row cannot keep for the reader who has exactly one, and a row that
    // advertises an action and then declines it is worse than one that says
    // nothing.
    tooltip:
      `Aggrega workspace: ${anchoredRoot}\nThe Releases on offer are the ones inside this folder.${opened}\nClick to choose which folder the editor works in.`,
  };
}

// releaseRow renders the Release the editor is acting on.
//
// The wording is not written here: it comes from the one function that
// describes the selection, so this row and the status-bar indicator cannot say
// different things about one state. The command is the indicator's own, so
// there is one way to choose a Release however the reader reaches it.
export function releaseRow(state: SelectionState): SelectorRow {
  const described = describeSelection(state);
  return {
    key: 'release',
    label: 'Release',
    value: described.value,
    tooltip: described.detail,
    command: SELECT_RELEASE_COMMAND,
    icon: 'rocket',
  };
}

// selectorRows builds both rows in display order.
export function selectorRows(
  anchoredRoot: string | null,
  openedFolder: string | null,
  state: SelectionState,
): SelectorRow[] {
  return [workspaceRow(anchoredRoot, openedFolder), releaseRow(state)];
}
