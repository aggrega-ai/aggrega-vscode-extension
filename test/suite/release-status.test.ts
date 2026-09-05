// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  SELECT_RELEASE_COMMAND,
  activateReleaseStatus,
  DisposableLike,
  ReleaseStatusDeps,
} from '../../src/release-status';
import { SelectionState } from '../../src/release-selection';

// FakeStatusBarItem records everything the indicator writes, so a test reads
// back exactly the text an operator would have seen.
class FakeStatusBarItem {
  text = '';
  tooltip = '';
  command = '';
  shown = 0;
  hidden = 0;
  disposed = 0;
  show(): void { this.shown++; }
  hide(): void { this.hidden++; }
  dispose(): void { this.disposed++; }
}

interface Harness {
  item: FakeStatusBarItem;
  deps: ReleaseStatusDeps;
  subscriptions: DisposableLike[];
  setState: (next: SelectionState) => void;
  stateReads: number;
}

// harness builds the indicator's dependency set over a fake status-bar item and
// a caller-controlled selection state.
function harness(root: string | null, initial: SelectionState): Harness {
  const item = new FakeStatusBarItem();
  const subscriptions: DisposableLike[] = [];
  let state = initial;
  let announce: () => void = () => { /* replaced on registration */ };
  const h: Harness = {
    item,
    subscriptions,
    stateReads: 0,
    setState: (next: SelectionState) => { state = next; announce(); },
    deps: {
      getWorkspaceRoot: () => root,
      selectionState: () => { h.stateReads++; return state; },
      createStatusBarItem: () => item,
      onSelectionChange: (listener) => { announce = listener; },
    },
  };
  return h;
}

// writeMarker plants a real .aggrega/active-release marker naming target. The
// tests below use it as the trap: an indicator that reads the marker rather
// than the selection displays this value instead of the one being sent.
async function writeMarker(root: string, target: string): Promise<void> {
  await fs.mkdir(path.join(root, '.aggrega'), { recursive: true });
  await fs.writeFile(path.join(root, '.aggrega', 'active-release'), target + '\n');
}

describe('selected-Release status indicator', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-release-status-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('renders the selected Release and clicks through to the select command', () => {
    const absolute = path.join(root, 'envs', 'prod.yaml');
    const h = harness(root, { kind: 'selected', release: 'envs/prod.yaml', absolute });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.item.text, '$(rocket) prod.yaml');
    assert.ok(
      h.item.tooltip.includes(absolute),
      `tooltip should name the selected Release; got ${h.item.tooltip}`,
    );
    assert.strictEqual(h.item.shown, 1);
    assert.strictEqual(
      h.item.command,
      SELECT_RELEASE_COMMAND,
      'clicking the indicator must be the way to select a different Release',
    );
  });

  // The defect the selection exists to close, in its new form. A marker on disk
  // names one Release while the editor is acting on another. The indicator must
  // show what is actually being sent.
  it('shows the selection, not the marker file, when the two disagree', async () => {
    await writeMarker(root, 'marked.yaml');
    const absolute = path.join(root, 'configured.yaml');
    const h = harness(root, { kind: 'selected', release: 'configured.yaml', absolute });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.item.text, '$(rocket) configured.yaml');
    assert.ok(
      !h.item.text.includes('marked.yaml') && !h.item.tooltip.includes('marked.yaml'),
      `the indicator read the marker file; text=${h.item.text} tooltip=${h.item.tooltip}`,
    );
  });

  // With the language server down there is nothing to report, and the marker
  // read is gone rather than kept as a fallback — so a marker sitting on disk
  // must NOT be displayed.
  it('shows the answer as unknown when nothing is selected yet, even with a marker on disk', async () => {
    await writeMarker(root, 'marked.yaml');
    const h = harness(root, { kind: 'unknown' });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.item.text, '$(rocket) Release: unavailable');
    assert.ok(
      !h.item.text.includes('marked.yaml') && !h.item.tooltip.includes('marked.yaml'),
      `the indicator fell back to the marker file; text=${h.item.text} tooltip=${h.item.tooltip}`,
    );
    assert.strictEqual(h.item.shown, 1, 'the indicator stays visible and states what it does not know');
  });

  it('reports that no Release is selected, and carries the reason it was given', async () => {
    await writeMarker(root, 'marked.yaml');
    const h = harness(root, {
      kind: 'none',
      reason: 'no authoring_release configured; workspace contains 0 Release file(s)',
    });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.item.text, '$(rocket) Release: none');
    assert.ok(
      h.item.tooltip.includes('workspace contains 0 Release file(s)'),
      `the tooltip dropped the account it was given; got ${h.item.tooltip}`,
    );
    assert.ok(!h.item.tooltip.includes('marked.yaml'));
    assert.strictEqual(h.item.shown, 1);
  });

  it('hides itself when no workspace is anchored', () => {
    const h = harness(null, { kind: 'selected', release: 'a.yaml', absolute: '/never/asked.yaml' });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.item.hidden, 1);
    assert.strictEqual(h.item.shown, 0);
    assert.strictEqual(h.stateReads, 0, 'no anchor means nothing to render');
  });

  // The no-restart proof at this surface: the selection changes and the
  // indicator follows it within the same session, driven by the change
  // announcement alone.
  it('re-renders when the selection changes, with no restart and no re-query', () => {
    const h = harness(root, {
      kind: 'selected',
      release: 'first.yaml',
      absolute: path.join(root, 'first.yaml'),
    });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    assert.strictEqual(h.item.text, '$(rocket) first.yaml');

    h.setState({
      kind: 'selected',
      release: 'second.yaml',
      absolute: path.join(root, 'second.yaml'),
    });

    assert.strictEqual(h.item.text, '$(rocket) second.yaml');
  });

  it('registers the item for disposal', () => {
    const h = harness(root, { kind: 'unknown' });

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);

    assert.strictEqual(h.subscriptions.length, 1);
  });
});
