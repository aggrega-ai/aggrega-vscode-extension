// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as path from 'path';

import { SWITCH_ANCHOR_COMMAND } from '../../src/anchor-picker';
import { CREATE_WORKSPACE_COMMAND, DRAFT_RELEASE_COMMAND } from '../../src/get-started-steps';
import { SELECT_RELEASE_COMMAND } from '../../src/release-selection';
import { SELECTOR_ROW_DRAWN_LABELS, SELECTOR_ROW_KEYS, SELECTOR_ROW_LABELS } from '../../src/selector-levels';
import {
  CHOOSE_PROJECT_FOLDER_COMMAND,
  CHOOSE_PROJECT_FOLDER_INVITATION,
  SOLE_PROJECT_FOLDER_INVITATION,
} from '../../src/project-folder';
import {
  OPEN_WORKSPACE_ROOT_COMMAND,
  SelectorCandidates,
  createControlKey,
  offerControlKey,
  projectFolderRow,
  releaseRow,
  rowCommands,
  selectorRows,
  workspaceRow,
} from '../../src/selector-rows';

const ANCHORED = path.join(path.sep, 'ws', 'project');
const OPENED_INSIDE = path.join(ANCHORED, 'examples', 'one');

// Several of everything, so a row that says there is only one is saying it
// because it was told so rather than because that is the default.
const SEVERAL: SelectorCandidates = { projectFolders: 3, aggregaWorkspaces: 2, releases: 4 };
const ONE_OF_EACH: SelectorCandidates = { projectFolders: 1, aggregaWorkspaces: 1, releases: 1 };
// NOTHING_AVAILABLE is the other end: every level enumerated, every level
// empty. It is the state clause after clause in this file distinguishes from a
// level that simply has not been chosen.
const NOTHING_AVAILABLE: SelectorCandidates = {
  projectFolders: 0, aggregaWorkspaces: 0, releases: 0,
};

const SELECTED = {
  kind: 'selected' as const,
  release: path.join('examples', 'one', 'release.yaml'),
  absolute: path.join(OPENED_INSIDE, 'release.yaml'),
};

describe('the three rows that name what the editor is acting on', () => {
  it('reads Project folder, then Aggrega workspace, then Release', () => {
    // The order is the teaching: three things nest, and the arrangement is what
    // shows a reader that they do. A row out of place teaches the wrong
    // containment, which is worse than teaching none.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);

    assert.deepStrictEqual(
      rows.map(r => r.label),
      ['Project folder', 'Agg. worksp.', 'Release'],
    );
    assert.deepStrictEqual(rows.map(r => r.key), ['project', 'workspace', 'release']);
    assert.deepStrictEqual(
      rows.map(r => r.key), [...SELECTOR_ROW_KEYS],
      'the rows are built in an order the declared one does not describe',
    );
  });

  it('keeps the product name on the middle row, which is the ambiguity being fixed', () => {
    // "Workspace" alone already names the set of folders a window has open, so
    // the bare word would have this row naming two different things at once.
    // The row draws the name shortened, so its value has room, and keeps the
    // product in it.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[1].label, 'Agg. worksp.');
    assert.notStrictEqual(
      rows[1].label, 'Workspace',
      'the middle row names two different things at once without the product name',
    );
  });

  it('names the middle row in full on its hover in every reading, whatever its label draws', () => {
    // The shortened label is the row's drawing and nothing else: the hover is
    // where the level is named, so each reading opens with, or carries, the
    // whole name. One reading per branch of the row: anchored with the folder
    // inside the workspace, anchored at the folder, nothing anchored with
    // workspaces to choose from, and none available.
    const hovers = [
      workspaceRow(ANCHORED, OPENED_INSIDE, 2),
      workspaceRow(ANCHORED, ANCHORED, 1),
      workspaceRow(null, OPENED_INSIDE, 2),
      workspaceRow(null, null, 0),
    ].map((row) => row.tooltip);
    assert.deepStrictEqual(
      hovers.map((t) => t.includes('Aggrega workspace')),
      [true, true, true, true],
      `a reading of the workspace row's hover does not name the level in full:\n${hovers.join('\n---\n')}`,
    );
    assert.deepStrictEqual(
      hovers.slice(0, 2).map((t) => t.split('\n')[0]),
      [`Aggrega workspace: ${ANCHORED}`, `Aggrega workspace: ${ANCHORED}`],
    );
    assert.deepStrictEqual(
      hovers.map((t) => t.includes('Agg. worksp.')),
      [false, false, false, false],
      'a hover names the level by the label\'s shortened form',
    );
  });

  it('draws every name from the one place they are written', () => {
    // A row's label is read from the one place the drawn labels are written, and
    // every one of them but the shortened middle one IS its level's name, read
    // from the one place the names are written; so one level cannot come to be
    // called two things on one surface.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    for (const row of rows) {
      assert.strictEqual(row.label, SELECTOR_ROW_DRAWN_LABELS[row.key]);
    }
    assert.deepStrictEqual(
      SELECTOR_ROW_KEYS.filter((key) => SELECTOR_ROW_DRAWN_LABELS[key] !== SELECTOR_ROW_LABELS[key]),
      ['workspace'],
    );
  });

  it('gives each row a value of its own and never a neighbour\'s', () => {
    // The three paths nest, so a row reading the wrong level still produces a
    // plausible-looking answer — which is exactly why each is checked against
    // the fact it is supposed to be reporting rather than against emptiness.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[0].value, 'one', 'the project row does not name the open folder');
    assert.strictEqual(rows[1].value, 'project', 'the workspace row does not name the anchored folder');
    assert.strictEqual(rows[2].value, SELECTED.release, 'the Release row does not name the Release');
    assert.strictEqual(
      new Set(rows.map(r => r.value)).size, 3,
      'two rows report the same value, so one of them is reading the wrong level',
    );
    for (const row of rows) {
      assert.ok(row.value.length > 0, `${row.label} shows no current value`);
      assert.ok(row.command.length > 0, `${row.label} offers no way to change it`);
      assert.ok(row.tooltip.length > 0, `${row.label} explains nothing`);
    }
  });

  it('sends each row to the one command that changes that level', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, { kind: 'unknown' }, SEVERAL);
    assert.strictEqual(
      rows[0].command, CHOOSE_PROJECT_FOLDER_COMMAND,
      'the outer row does not open the choice that scopes the level beneath it',
    );
    assert.strictEqual(rows[1].command, SWITCH_ANCHOR_COMMAND);
    assert.strictEqual(
      rows[2].command, SELECT_RELEASE_COMMAND,
      'the row and the status-bar indicator run one command, so there is one way to choose',
    );
  });
});

describe('the control that creates a new one of a level', () => {
  it('offers one on the two levels that can be created, and names the command that exists', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[1].create?.command, CREATE_WORKSPACE_COMMAND);
    assert.strictEqual(rows[2].create?.command, DRAFT_RELEASE_COMMAND);
  });

  it('offers none on the project-folder row, because there is nothing there to create', () => {
    // Bringing a project folder into being is not an Aggrega act. A control
    // there would be one that promises a creation and performs none.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[0].create, null);
    assert.strictEqual(
      projectFolderRow(null, 0).create, null,
      'the project row grows a create control once nothing is open',
    );
  });

  it('announces itself by the exact words a keyboard reader is given', () => {
    // 🔴 The label is the control's WHOLE accessible name — it draws no word of
    // its own — so this is the only channel a reader who never sees the glyph
    // has. The expectation is written out rather than composed from the same
    // constants the source reads, because a composed one moves with whatever it
    // is checking and cannot fail.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[1].create?.label, 'Create an Aggrega workspace');
    assert.strictEqual(rows[2].create?.label, 'Create a Release');
  });

  it('promises no place, because neither command keeps one', () => {
    // Writing "here" was tried and removed. One command writes into the first
    // folder the window has open with no prompt, and the other opens an
    // untitled draft and writes nothing anywhere — so a word placing the
    // creation is a promise read on its own, with none of the row around it,
    // that neither flow honours.
    for (const candidates of [SEVERAL, ONE_OF_EACH, NOTHING_AVAILABLE]) {
      for (const row of selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, candidates)) {
        if (row.create === null) { continue; }
        assert.ok(
          !/\bhere\b/i.test(row.create.label),
          `the ${row.key} create control promises a place: ${row.create.label}`,
        );
      }
    }
  });

  it('names the level it creates, because the control draws no word of its own', () => {
    // A reader meeting it by keyboard is told only what it is called, so the
    // same bare word on two rows would announce nothing that tells them apart.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    const named = rows.filter(r => r.create !== null);
    assert.strictEqual(named.length, 2, 'the wrong number of levels offers a creation');
    for (const row of named) {
      assert.ok(
        row.create !== null && row.create.label.includes(SELECTOR_ROW_LABELS[row.key]),
        `the ${row.key} create control does not say which level it creates`,
      );
    }
    assert.strictEqual(
      new Set(named.map(r => r.create?.label)).size, 2,
      'two create controls announce themselves identically',
    );
  });

  it('derives its focus key from the row\'s own, so the two cannot disagree', () => {
    for (const key of SELECTOR_ROW_KEYS) {
      assert.notStrictEqual(
        createControlKey(key), key as string,
        'the create control and the choosing control share one focus key',
      );
    }
    assert.strictEqual(
      new Set(SELECTOR_ROW_KEYS.map(createControlKey)).size, SELECTOR_ROW_KEYS.length,
      'two create controls derive the same focus key',
    );
  });
});

describe('the offer to open the Aggrega workspace', () => {
  it('is there when the workspace sits above the folder the editor opened', () => {
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.notStrictEqual(
      row.offer, null,
      'the workspace the row names is not the folder the window has open, and nothing offers to '
      + 'open it — which is the whole state this control exists for',
    );
    assert.strictEqual(row.offer?.command, OPEN_WORKSPACE_ROOT_COMMAND);
  });

  it('is there when the workspace sits inside the folder the editor opened', () => {
    // What the offer's name says — the workspace opened as the folder, at the
    // cost of a reload — is as true for a workspace inside the folder as for one
    // above it.
    assert.strictEqual(
      workspaceRow(OPENED_INSIDE, ANCHORED, 2).offer?.command, OPEN_WORKSPACE_ROOT_COMMAND,
    );
  });

  it('is absent when the folder the editor opened IS the workspace', () => {
    // Nothing to open: pressing would cost a reader everything a window reload
    // costs and leave them exactly where they already are. The absence is the
    // truth rather than an omission.
    assert.strictEqual(workspaceRow(ANCHORED, ANCHORED, 2).offer, null);
  });

  it('is absent while no workspace has been reported at all', () => {
    // Both empty readings, because they are different states and neither has a
    // folder to name. A row offering to open nothing would be a control whose
    // press could only fail.
    assert.strictEqual(workspaceRow(null, OPENED_INSIDE, 2).offer, null);
    assert.strictEqual(workspaceRow(null, null, 0).offer, null);
  });

  it('is absent while the window has no folder open to differ from', () => {
    assert.strictEqual(workspaceRow(ANCHORED, null, 2).offer, null);
  });

  it('reads the same comparison the explanation reads, resolved rather than compared as text', () => {
    // The hover names the open folder on exactly the occasions the offer is
    // drawn, because both come from one comparison. A second comparison written
    // beside the first would agree until the day one of them was changed.
    const differing = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.ok(differing.tooltip.includes(`Project folder: ${OPENED_INSIDE}`), differing.tooltip);
    assert.notStrictEqual(differing.offer, null);
    // And the mark stands where the workspace sits outside the folder, from the
    // same comparison's other answer. It is read here beside the other two
    // because a mark that appeared without the explanation is the drift a second
    // comparison would produce.
    assert.notStrictEqual(differing.warning, null);

    // A workspace inside the folder is a different directory and not outside
    // it: the folder is named and the offer drawn, and there is no mark.
    const inside = workspaceRow(OPENED_INSIDE, ANCHORED, 2);
    assert.deepStrictEqual(
      [inside.tooltip.includes(`Project folder: ${ANCHORED}`), inside.offer?.command ?? null, inside.warning],
      [true, OPEN_WORKSPACE_ROOT_COMMAND, null],
      inside.tooltip,
    );

    const same = workspaceRow(ANCHORED, ANCHORED, 2);
    assert.ok(!same.tooltip.includes('Project folder: '), same.tooltip);
    assert.strictEqual(same.offer, null);
    assert.strictEqual(same.warning, null);

    // And the comparison is over resolved paths rather than over the strings, so
    // a folder spelled with a step that goes nowhere is the same folder.
    const spelledLonger = `${ANCHORED}${path.sep}.`;
    assert.notStrictEqual(spelledLonger, ANCHORED, 'the two spellings are the same text');
    assert.strictEqual(
      workspaceRow(ANCHORED, spelledLonger, 2).offer, null,
      'a folder spelled differently and resolving to the same place is offered as somewhere else '
      + 'to go, so a press would reload the window to where it already is',
    );
  });

  it('says what pressing costs and not only where it goes', () => {
    // 🔴 The label is the control's WHOLE accessible name — it draws no word of
    // its own — and this control is the one thing on the panel that reaches past
    // the window. A name giving only the destination would be accurate and would
    // still surprise every reader who pressed it. The expectation is written out
    // rather than composed from the constants the source reads, because a
    // composed one moves with whatever it is checking and cannot fail.
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.strictEqual(
      row.offer?.label,
      'Open the Aggrega workspace as the Project folder. The window reloads.',
    );
    assert.ok(
      /reload/i.test(row.offer?.label ?? ''),
      `the offer names a destination and no consequence: ${row.offer?.label}`,
    );
  });

  it('takes a place of the reader\'s own, apart from the row\'s and the create control\'s', () => {
    for (const key of SELECTOR_ROW_KEYS) {
      assert.notStrictEqual(offerControlKey(key), key as string);
      assert.notStrictEqual(offerControlKey(key), createControlKey(key));
    }
    assert.strictEqual(
      new Set(SELECTOR_ROW_KEYS.map(offerControlKey)).size, SELECTOR_ROW_KEYS.length,
      'two offers derive the same focus key',
    );
  });

  it('is the only row that has one, whichever way the window is arranged', () => {
    for (const opened of [OPENED_INSIDE, ANCHORED]) {
      for (const row of selectorRows(ANCHORED, opened, opened, SELECTED, SEVERAL)) {
        if (row.key === 'workspace') { continue; }
        assert.strictEqual(
          row.offer, null,
          `the ${row.key} row carries an offer; only the Aggrega workspace has a folder of its `
          + 'own that the window may not already be open on',
        );
      }
    }
  });

  it('is enumerated among the row\'s commands, so a press on it is admitted', () => {
    // The panel admits a press by asking the rows what they offer. A control
    // drawn but not enumerated would be pressed and refused.
    assert.ok(
      rowCommands(workspaceRow(ANCHORED, OPENED_INSIDE, 2)).includes(OPEN_WORKSPACE_ROOT_COMMAND),
    );
    assert.ok(
      !rowCommands(workspaceRow(ANCHORED, ANCHORED, 2)).includes(OPEN_WORKSPACE_ROOT_COMMAND),
      'the panel goes on admitting the offer after the row has stopped drawing it',
    );
  });

  it('enumerates every control a row draws and nothing beside them', () => {
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.deepStrictEqual(
      rowCommands(row),
      [row.command, row.create?.command, row.offer?.command],
      'the enumeration and the controls have come apart, so one of them is the only thing some '
      + 'surface consults',
    );
    assert.deepStrictEqual(
      rowCommands(projectFolderRow(OPENED_INSIDE, 3)),
      [CHOOSE_PROJECT_FOLDER_COMMAND],
      'a row with one control enumerates something beside it',
    );
  });
});

describe('a level holding exactly one candidate', () => {
  it('says there are no others on the Project folder row, so a chooser of one does not read as broken', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, ONE_OF_EACH);
    assert.ok(
      rows[0].tooltip.includes('Only one Project folder is available'),
      'the project row does not say it is the only one',
    );
    assert.ok(
      rows[0].tooltip.includes('no others to choose between'),
      'the project row leaves the reader to press and find out',
    );
  });

  it('closes the sole Project folder\'s hover on what a press offers there, and never on a choice between folders', () => {
    // Having said there are no others to choose between, a hover that then
    // invited a choice between folders would contradict itself; what a press
    // offers with one folder open is opening a folder or adding one. With
    // several open, the choice is real and the invitation stays.
    const sole = projectFolderRow(OPENED_INSIDE, 1).tooltip.split('\n');
    const several = projectFolderRow(OPENED_INSIDE, 3).tooltip.split('\n');
    assert.deepStrictEqual(
      [sole[sole.length - 1], several[several.length - 1]],
      [SOLE_PROJECT_FOLDER_INVITATION, CHOOSE_PROJECT_FOLDER_INVITATION],
    );
    assert.strictEqual(SOLE_PROJECT_FOLDER_INVITATION, 'Click to open a folder or add one to this window.');
    assert.deepStrictEqual(
      sole.filter((line) => line === CHOOSE_PROJECT_FOLDER_INVITATION),
      [],
      'the sole folder\'s hover still invites a choice between folders',
    );
  });

  it('says nothing of the sort on the Aggrega workspace and Release rows, whatever the count', () => {
    // Those two hovers are kept to what the reader acts on, and the chooser a
    // click opens lists what there is. Every reading of both rows that offers a
    // choice is swept at a count of one — with the workspace above the folder
    // and at it, and with nothing anchored — because each is a reading a
    // sole-candidate sentence could be written into.
    const tooltips = [
      ...selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, ONE_OF_EACH).slice(1),
      ...selectorRows(ANCHORED, ANCHORED, ANCHORED, SELECTED, ONE_OF_EACH).slice(1),
      workspaceRow(null, OPENED_INSIDE, 1),
      releaseRow({ kind: 'none', reason: '' }, 1),
    ].map((row) => row.tooltip);
    for (const tooltip of tooltips) {
      assert.ok(
        !tooltip.includes('no others to choose between') && !tooltip.includes('Only one'),
        `a row other than the Project folder row says it holds the only candidate:\n${tooltip}`,
      );
    }
    // 🔴 THE CONTROL ON THAT SWEEP: the probe certainly fires on the one row that
    // does carry the sentence, so the absences above are about the rows.
    assert.ok(
      selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, ONE_OF_EACH)[0].tooltip
        .includes('no others to choose between'),
      'the probe matches nothing, so its absences mean nothing',
    );
  });

  it('says nothing of the sort where there is more than one', () => {
    // The sentence is a claim about the world, so it has to be absent whenever
    // it would be false — which is the half a test of the sole case never sees.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED, SEVERAL);
    for (const row of rows) {
      assert.ok(
        !row.tooltip.includes('no others to choose between'),
        `the ${row.key} row claims to be the only one while others exist`,
      );
    }
  });

  it('says nothing of the sort for a Release level nobody has read', () => {
    // Null is not one and it is not none: nobody looked. A row that drew the
    // sole-candidate sentence from an unread level would be inventing the
    // answer it is there to report.
    const rows = selectorRows(
      ANCHORED, OPENED_INSIDE, OPENED_INSIDE, SELECTED,
      { projectFolders: 1, aggregaWorkspaces: 1, releases: null },
    );
    assert.ok(
      !rows[2].tooltip.includes('no others to choose between'),
      'the Release row claims to know how many Releases there are',
    );
  });
});

describe('the project folder row', () => {
  it('shows the folder the editor is working in, and the whole path on the hover', () => {
    const row = projectFolderRow(OPENED_INSIDE, 3);
    assert.strictEqual(row.value, 'one');
    assert.ok(row.tooltip.includes(OPENED_INSIDE));
    assert.ok(row.tooltip.includes('Project folder'));
  });

  it('reports nothing open as its own state', () => {
    const row = projectFolderRow(null, 0);
    assert.strictEqual(row.value, 'none open');
    assert.ok(row.tooltip.includes('no Project folder is open'));
    // The way out of this one is the row's own control, so saying to press it
    // is the exit rather than an instruction to go hunting.
    assert.ok(row.tooltip.includes('Click to open one.'));
  });

  it('does not say nothing is open in a window that has folders open', () => {
    // 🔴 The plainest falsehood this panel could carry, and the one the count
    // is passed in to remove: the value is the reader's own choice, so it is
    // absent until they make one — while the window plainly has folders open.
    // The two states are as far apart as this row can put two absences: one
    // cannot be resolved by choosing at all, the other is waiting on a choice.
    const none = projectFolderRow(null, 0);
    const someOpen = projectFolderRow(null, 3);

    assert.notStrictEqual(
      someOpen.value, none.value,
      'a window with folders open reads exactly like one with none',
    );
    assert.strictEqual(someOpen.value, 'none selected');
    assert.ok(
      !someOpen.tooltip.includes('no Project folder is open'),
      `three folders are open and the row says none is; got ${someOpen.tooltip}`,
    );
    assert.ok(someOpen.tooltip.includes('3 Project folders are open in this window.'));
  });

  it('counts in the singular where there is one to count', () => {
    const one = projectFolderRow(null, 1);
    assert.ok(one.tooltip.includes('One Project folder is open in this window.'));
    assert.ok(!one.tooltip.includes('1 Project folders'));
  });

  it('asserts no cause for none being in use, because more than one state reaches it', () => {
    // A window whose folders carry no Aggrega workspace reaches this reading,
    // and so does one carrying several with none of them chosen. Naming either
    // cause here would be right half the time.
    const row = projectFolderRow(null, 2);
    assert.ok(!row.tooltip.includes('Aggrega workspace'));
  });
});

describe('the Aggrega workspace row', () => {
  it('shows the anchored folder, which is what the Release list is computed against', () => {
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.strictEqual(row.value, 'project');
    // The value is the folder's last name, so the hover is where its full path
    // is given — on its first line, ahead of anything else it says.
    assert.ok(
      row.tooltip.startsWith(`Aggrega workspace: ${ANCHORED}\n`),
      `the hover does not open by naming the anchored folder in full:\n${row.tooltip}`,
    );
  });

  it('names the opened folder as well when the two differ, and not when they agree', () => {
    // The two coincide whenever the opened folder is itself the anchor. The row
    // earns its place when they do not, so that is when the difference is
    // spelled out.
    const differing = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.ok(differing.tooltip.includes(OPENED_INSIDE));

    const same = workspaceRow(ANCHORED, ANCHORED, 2);
    assert.ok(!same.tooltip.includes('Project folder: '), same.tooltip);
  });

  it('does not present the opened folder as the anchored one when none was reported', () => {
    // Falling back to the opened folder here is the defect these rows exist to
    // remove, and it would show only in the case hardest to notice.
    const row = workspaceRow(null, OPENED_INSIDE, 2);
    assert.strictEqual(row.value, 'none selected');
    assert.notStrictEqual(
      row.value, path.basename(OPENED_INSIDE),
      'the opened folder is not the anchored folder',
    );
    assert.ok(row.tooltip.includes('has not reported one it anchored to'));
    assert.ok(row.tooltip.includes(OPENED_INSIDE), 'the reader is still told what Aggrega last worked in');
    assert.ok(
      row.tooltip.includes('The last folder Aggrega worked in is'),
      'a folder retained after the language server stopped is presented as the current one',
    );
  });

  it('tells nothing available apart from nothing selected, and carries the two exits', () => {
    // 🔴 A project holding no Aggrega workspace and a project holding several
    // with none in use are as far apart as two absences get: the first cannot
    // be resolved by choosing at all, so a reading that invited a choice there
    // would send the reader to a list that must come back empty.
    const empty = workspaceRow(null, null, 0);
    const unchosen = workspaceRow(null, null, 2);

    assert.strictEqual(empty.value, 'none available');
    assert.strictEqual(unchosen.value, 'none selected');
    assert.notStrictEqual(empty.tooltip, unchosen.tooltip);

    assert.ok(
      !/click to choose/i.test(empty.tooltip),
      `there is nothing to choose and the row says to choose; got ${empty.tooltip}`,
    );
    assert.ok(
      empty.tooltip.includes('Open a Project folder holding'),
      'the first way out of an empty project is not named',
    );
    assert.ok(
      empty.tooltip.includes('create an Aggrega workspace'),
      'the second way out of an empty project is not named',
    );
    assert.ok(
      /click to choose/i.test(unchosen.tooltip),
      'with workspaces available, choosing is exactly the thing to say',
    );
    // The closing line stands apart behind a blank line, on this reading as on
    // the anchored one.
    assert.ok(
      unchosen.tooltip.endsWith('\n\nClick to choose one.'),
      `the closing line is not set apart: ${JSON.stringify(unchosen.tooltip)}`,
    );
  });

  it('names what makes a folder one, so the reader can act on the first exit', () => {
    // "Open a different Project folder" is unusable without saying which
    // folders would qualify, and the name of the file that decides it is the
    // one the discovery rule actually looks for.
    const empty = workspaceRow(null, null, 0);
    assert.ok(empty.tooltip.includes('.aggrega-config.yaml'));
  });

  it('promises a choice rather than a change, so the promise holds with one folder', () => {
    // A click opens what is available together with the way to make another
    // workspace available, which "switch" would misdescribe for the reader who
    // has exactly one — and a row that advertises an action and then declines
    // it is the defect this closes.
    //
    // The expected sentence is written out rather than read from the module
    // that now owns it. Reading it would make both sides of the comparison one
    // value, and the assertion could then no longer fail however the wording
    // moved; that the row READS it rather than restating it is asserted in the
    // anchor-picker suite, against that module.
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.ok(
      row.tooltip.includes('Click to choose which Aggrega workspace the editor works in.'),
      `the row does not say what clicking it does: ${row.tooltip}`,
    );
    assert.ok(
      !/click to switch/i.test(row.tooltip),
      'a promise to switch cannot be kept for a reader with one workspace',
    );
    // And it does not ask which FOLDER holds the workspace, which is the
    // question with more than one true answer.
    assert.ok(
      !/which folder the editor works in/i.test(row.tooltip),
      `the row asks a question this level does not ask: ${row.tooltip}`,
    );
  });
});

describe('the Release row', () => {
  it('shows the path, which tells two same-named Releases apart', () => {
    const row = releaseRow({
      kind: 'selected',
      release: path.join('examples', 'one', 'release.yaml'),
      absolute: path.join(OPENED_INSIDE, 'release.yaml'),
    }, 2);
    assert.strictEqual(row.value, path.join('examples', 'one', 'release.yaml'));
  });

  it('closes a selection with the offer to choose a different one, set apart by a blank line', () => {
    // Written out in full, so a line added, dropped or moved fails here. The
    // count is one on purpose: that is the count at which a sole-candidate
    // sentence would appear if one were still written into this hover.
    assert.strictEqual(
      releaseRow(SELECTED, 1).tooltip,
      `Aggrega selected Release: ${SELECTED.absolute}\n\nClick to choose a different Release.`,
    );
  });

  it('separates no Release selected from no answer obtained', () => {
    const none = releaseRow({ kind: 'none', reason: 'workspace contains 0 Release file(s)' }, 2);
    const unknown = releaseRow({ kind: 'unknown' }, null);
    assert.notStrictEqual(
      none.value, unknown.value,
      'only one of those two is something a reader can act on',
    );
    assert.ok(none.tooltip.includes('workspace contains 0 Release file(s)'));
    assert.ok(unknown.tooltip.includes('not running'));
  });

  it('separates nothing selected from nothing to select, and carries the two exits', () => {
    const empty = releaseRow({ kind: 'none', reason: '' }, 0);
    const selectable = releaseRow({ kind: 'none', reason: '' }, 2);

    assert.strictEqual(empty.value, 'none available');
    assert.strictEqual(selectable.value, 'none selected');
    assert.notStrictEqual(empty.tooltip, selectable.tooltip);

    assert.ok(
      !/click to select/i.test(empty.tooltip),
      `there is nothing to select and the row says to select one; got ${empty.tooltip}`,
    );
    assert.ok(
      empty.tooltip.includes('different Aggrega workspace'),
      'the exit through the level above is not named',
    );
    assert.ok(
      empty.tooltip.includes('create a Release'),
      'the exit through creating one is not named',
    );
  });

  it('says the count has not been read rather than reading it as none', () => {
    const unread = releaseRow({ kind: 'none', reason: '' }, null);
    const empty = releaseRow({ kind: 'none', reason: '' }, 0);

    assert.notStrictEqual(
      unread.tooltip, empty.tooltip,
      'a workspace nobody has enumerated reads as one that offers nothing',
    );
    assert.ok(unread.tooltip.includes('has not been read'));
  });

  it('reports the server being down without consulting a count at all', () => {
    // The count survives a failure that leaves the selection unknown, and with
    // the server silent what a reader can act on is the server. Four readings
    // of the count must produce one sentence.
    const drawn = new Set(
      [null, 0, 1, 5].map((releases) => releaseRow({ kind: 'unknown' }, releases).tooltip),
    );
    assert.strictEqual(drawn.size, 1, 'the unknown state changes with a count it should not read');
  });
});
