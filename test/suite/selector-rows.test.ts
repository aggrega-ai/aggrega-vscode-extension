// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'path';

import { CREATE_WORKSPACE_COMMAND, DRAFT_RELEASE_COMMAND } from '../../src/get-started-steps';
import { SELECT_RELEASE_COMMAND } from '../../src/release-status';
import {
  PROJECT_FOLDER_COMMAND,
  SELECTOR_ROW_KEYS,
  SELECTOR_ROW_LABELS,
  SWITCH_ANCHOR_COMMAND,
  SelectorCandidates,
  createControlKey,
  projectFolderRow,
  releaseRow,
  selectorRows,
  workspaceRow,
} from '../../src/selector-rows';

const ANCHORED = path.join(path.sep, 'ws', 'project');
const OPENED_INSIDE = path.join(ANCHORED, 'examples', 'one');

// Several of everything, so a row that says there is only one is saying it
// because it was told so rather than because that is the default.
const SEVERAL: SelectorCandidates = { projectFolders: 3, aggregaWorkspaces: 2 };
const ONE_OF_EACH: SelectorCandidates = { projectFolders: 1, aggregaWorkspaces: 1 };

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
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);

    assert.deepStrictEqual(
      rows.map(r => r.label),
      ['Project folder', 'Aggrega workspace', 'Release'],
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
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[1].label, 'Aggrega workspace');
    assert.notStrictEqual(
      rows[1].label, 'Workspace',
      'the middle row names two different things at once without the product name',
    );
  });

  it('draws every name from the one place they are written', () => {
    // A row and any sentence written about that row read the same constant, so
    // one level cannot come to be called two things on one surface.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
    for (const row of rows) {
      assert.strictEqual(row.label, SELECTOR_ROW_LABELS[row.key]);
    }
  });

  it('gives each row a value of its own and never a neighbour\'s', () => {
    // The three paths nest, so a row reading the wrong level still produces a
    // plausible-looking answer — which is exactly why each is checked against
    // the fact it is supposed to be reporting rather than against emptiness.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
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
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, { kind: 'unknown' }, SEVERAL);
    assert.strictEqual(
      rows[0].command, PROJECT_FOLDER_COMMAND,
      'which folders the window has open is the editor\'s to change, not a command of ours',
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
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[1].create?.command, CREATE_WORKSPACE_COMMAND);
    assert.strictEqual(rows[2].create?.command, DRAFT_RELEASE_COMMAND);
  });

  it('offers none on the project-folder row, because there is nothing there to create', () => {
    // Bringing a project folder into being is not an Aggrega act. A control
    // there would be one that promises a creation and performs none.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
    assert.strictEqual(rows[0].create, null);
    assert.strictEqual(
      projectFolderRow(null, 0).create, null,
      'the project row grows a create control once nothing is open',
    );
  });

  it('names the level it creates, because the control draws no word of its own', () => {
    // A reader meeting it by keyboard is told only what it is called, so the
    // same bare word on two rows would announce nothing that tells them apart.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
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

describe('a level holding exactly one candidate', () => {
  it('says there are no others, so a chooser of one does not read as broken', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, ONE_OF_EACH);
    assert.ok(
      rows[0].tooltip.includes('Only one Project folder is available'),
      'the project row does not say it is the only one',
    );
    assert.ok(
      rows[1].tooltip.includes('Only one Aggrega workspace is available'),
      'the workspace row does not say it is the only one',
    );
    for (const row of rows.slice(0, 2)) {
      assert.ok(
        row.tooltip.includes('no others to choose between'),
        `the ${row.key} row leaves the reader to press and find out`,
      );
    }
  });

  it('says nothing of the sort where there is more than one', () => {
    // The sentence is a claim about the world, so it has to be absent whenever
    // it would be false — which is the half a test of the sole case never sees.
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, SEVERAL);
    for (const row of rows) {
      assert.ok(
        !row.tooltip.includes('no others to choose between'),
        `the ${row.key} row claims to be the only one while others exist`,
      );
    }
  });

  it('says nothing of the sort for the Release, because no count of them is held', () => {
    // Nothing keeps the set of offerable Releases between one choice and the
    // next, so there is no count to report — and a row that reported one anyway
    // would be reporting a state nothing can produce.
    for (const candidates of [ONE_OF_EACH, SEVERAL]) {
      const rows = selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, candidates);
      assert.ok(
        !rows[2].tooltip.includes('no others to choose between'),
        'the Release row claims to know how many Releases there are',
      );
    }
    assert.strictEqual(
      releaseRow(SELECTED).tooltip,
      selectorRows(ANCHORED, OPENED_INSIDE, SELECTED, ONE_OF_EACH)[2].tooltip,
      'the Release row reads a candidate count from somewhere',
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
  });
});

describe('the Aggrega workspace row', () => {
  it('shows the anchored folder, which is what the Release list is computed against', () => {
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.strictEqual(row.value, 'project');
    assert.ok(row.tooltip.includes(ANCHORED));
    assert.ok(
      row.tooltip.includes('inside this folder'),
      'the row exists to explain why the candidate set is what it is',
    );
  });

  it('names the opened folder as well when the two differ, and not when they agree', () => {
    // The two coincide whenever the opened folder is itself the anchor. The row
    // earns its place when they do not, so that is when the difference is
    // spelled out.
    const differing = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.ok(differing.tooltip.includes(OPENED_INSIDE));

    const same = workspaceRow(ANCHORED, ANCHORED, 2);
    assert.ok(!same.tooltip.includes('The open folder is'));
  });

  it('does not present the opened folder as the anchored one when none was reported', () => {
    // Falling back to the opened folder here is the defect these rows exist to
    // remove, and it would show only in the case hardest to notice.
    const row = workspaceRow(null, OPENED_INSIDE, 2);
    assert.strictEqual(row.value, 'not reported');
    assert.ok(!row.value.includes('one'), 'the opened folder is not the anchored folder');
    assert.ok(row.tooltip.includes('has not reported which folder it anchored to'));
    assert.ok(row.tooltip.includes(OPENED_INSIDE), 'the reader is still told what is open');
  });

  it('reports nothing anchored as its own state', () => {
    const row = workspaceRow(null, null, 0);
    assert.strictEqual(row.value, 'none anchored');
    assert.ok(row.tooltip.includes('no anchored workspace'));
  });

  it('promises a choice rather than a change, so the promise holds with one folder', () => {
    // A click opens what is available together with the way to make another
    // folder available, which "switch" would misdescribe for the reader who has
    // exactly one — and a row that advertises an action and then declines it is
    // the defect this closes.
    const row = workspaceRow(ANCHORED, OPENED_INSIDE, 2);
    assert.ok(
      row.tooltip.includes('Click to choose which folder the editor works in.'),
      'the row does not say what clicking it does',
    );
    assert.ok(
      !/click to switch/i.test(row.tooltip),
      'a promise to switch cannot be kept for a reader with one folder',
    );
  });
});

describe('the Release row', () => {
  it('shows the path, which tells two same-named Releases apart', () => {
    const row = releaseRow({
      kind: 'selected',
      release: path.join('examples', 'one', 'release.yaml'),
      absolute: path.join(OPENED_INSIDE, 'release.yaml'),
    });
    assert.strictEqual(row.value, path.join('examples', 'one', 'release.yaml'));
  });

  it('separates no Release selected from no answer obtained', () => {
    const none = releaseRow({ kind: 'none', reason: 'workspace contains 0 Release file(s)' });
    const unknown = releaseRow({ kind: 'unknown' });
    assert.notStrictEqual(
      none.value, unknown.value,
      'only one of those two is something a reader can act on',
    );
    assert.ok(none.tooltip.includes('workspace contains 0 Release file(s)'));
    assert.ok(unknown.tooltip.includes('not running'));
  });
});
