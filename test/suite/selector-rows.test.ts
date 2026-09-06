// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'path';

import { SELECT_RELEASE_COMMAND } from '../../src/release-status';
import {
  SWITCH_ANCHOR_COMMAND,
  releaseRow,
  selectorRows,
  workspaceRow,
} from '../../src/selector-rows';

const ANCHORED = path.join(path.sep, 'ws', 'project');
const OPENED_INSIDE = path.join(ANCHORED, 'examples', 'one');

describe('the two rows that name what the editor is acting on', () => {
  it('reads Workspace then Release, on two rows, each with a value and a way to change it', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, {
      kind: 'selected',
      release: path.join('examples', 'one', 'release.yaml'),
      absolute: path.join(OPENED_INSIDE, 'release.yaml'),
    });

    assert.strictEqual(rows.length, 2, 'one row cannot show two values and two affordances');
    assert.deepStrictEqual(rows.map(r => r.label), ['Workspace', 'Release']);
    assert.deepStrictEqual(rows.map(r => r.key), ['workspace', 'release']);
    for (const row of rows) {
      assert.ok(row.value.length > 0, `${row.label} shows no current value`);
      assert.ok(row.command.length > 0, `${row.label} offers no way to change it`);
      assert.ok(row.tooltip.length > 0, `${row.label} explains nothing`);
    }
  });

  it('sends each row to the one command that changes that value', () => {
    const rows = selectorRows(ANCHORED, OPENED_INSIDE, { kind: 'unknown' });
    assert.strictEqual(rows[0].command, SWITCH_ANCHOR_COMMAND);
    assert.strictEqual(
      rows[1].command, SELECT_RELEASE_COMMAND,
      'the row and the status-bar indicator run one command, so there is one way to choose',
    );
  });
});

describe('the workspace row', () => {
  it('shows the anchored folder, which is what the Release list is computed against', () => {
    const row = workspaceRow(ANCHORED, OPENED_INSIDE);
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
    const differing = workspaceRow(ANCHORED, OPENED_INSIDE);
    assert.ok(differing.tooltip.includes(OPENED_INSIDE));

    const same = workspaceRow(ANCHORED, ANCHORED);
    assert.ok(!same.tooltip.includes('The open folder is'));
  });

  it('does not present the opened folder as the anchored one when none was reported', () => {
    // Falling back to the opened folder here is the defect these rows exist to
    // remove, and it would show only in the case hardest to notice.
    const row = workspaceRow(null, OPENED_INSIDE);
    assert.strictEqual(row.value, 'not reported');
    assert.ok(!row.value.includes('one'), 'the opened folder is not the anchored folder');
    assert.ok(row.tooltip.includes('has not reported which folder it anchored to'));
    assert.ok(row.tooltip.includes(OPENED_INSIDE), 'the reader is still told what is open');
  });

  it('reports nothing anchored as its own state', () => {
    const row = workspaceRow(null, null);
    assert.strictEqual(row.value, 'none anchored');
    assert.ok(row.tooltip.includes('no anchored workspace'));
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
