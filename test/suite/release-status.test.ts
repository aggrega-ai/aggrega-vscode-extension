// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { activateReleaseStatus, DisposableLike, ReleaseStatusDeps } from '../../src/release-status';

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

// flush lets the indicator's pending query settle. refresh() resolves the
// daemon query asynchronously, so every assertion runs after a microtask turn.
async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

interface Harness {
  item: FakeStatusBarItem;
  deps: ReleaseStatusDeps;
  subscriptions: DisposableLike[];
  markerChanged: () => void;
  queryCalls: number;
}

// harness builds the indicator's dependency set over a fake status-bar item and
// a caller-supplied answer for the daemon query.
function harness(
  root: string | null,
  answer: () => Promise<string>,
): Harness {
  const item = new FakeStatusBarItem();
  const subscriptions: DisposableLike[] = [];
  let markerChanged: () => void = () => { /* replaced on registration */ };
  const h: Harness = {
    item,
    subscriptions,
    markerChanged: () => markerChanged(),
    queryCalls: 0,
    deps: {
      getWorkspaceRoot: () => root,
      requestActiveRelease: () => {
        h.queryCalls++;
        return answer();
      },
      createStatusBarItem: () => item,
      watchActiveReleaseMarker: (onChange) => {
        markerChanged = onChange;
        return { dispose: () => undefined };
      },
    },
  };
  return h;
}

// writeMarker plants a real .aggrega/active-release marker naming target. The
// tests below use it as the trap: an indicator that reads the marker rather
// than asking the daemon displays this value instead of the daemon's.
async function writeMarker(root: string, target: string): Promise<void> {
  await fs.mkdir(path.join(root, '.aggrega'), { recursive: true });
  await fs.writeFile(path.join(root, '.aggrega', 'active-release'), target + '\n');
}

describe('active-Release status indicator', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-release-status-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('renders the Release the daemon resolved', async () => {
    const resolved = path.join(root, 'envs', 'prod.yaml');
    const h = harness(root, () => Promise.resolve(resolved));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.item.text, '$(rocket) prod.yaml');
    assert.ok(
      h.item.tooltip.includes(resolved),
      `tooltip should name the resolved Release; got ${h.item.tooltip}`,
    );
    assert.strictEqual(h.item.shown, 1);
    assert.strictEqual(
      h.item.command,
      'aggrega.workspace.createActiveReleaseMarker',
      'the click action must stay the existing switch flow',
    );
  });

  // The defect the daemon query exists to close. A marker on disk names one
  // Release while the daemon resolved another (a configured authoring Release
  // outranks the marker). The indicator must show the daemon's answer.
  it('shows the daemon answer, not the marker file, when the two disagree', async () => {
    await writeMarker(root, 'marked.yaml');
    const resolved = path.join(root, 'configured.yaml');
    const h = harness(root, () => Promise.resolve(resolved));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.item.text, '$(rocket) configured.yaml');
    assert.ok(
      !h.item.text.includes('marked.yaml') && !h.item.tooltip.includes('marked.yaml'),
      `the indicator read the marker file; text=${h.item.text} tooltip=${h.item.tooltip}`,
    );
  });

  // The deletion proof. With the daemon down there is no answer to render, and
  // the marker read is gone rather than kept as a fallback — so a marker
  // sitting on disk must NOT be displayed. Before the marker read was removed
  // this is exactly the case that displayed a locally-derived guess.
  it('shows the answer as unknown when the daemon is not running, even with a marker on disk', async () => {
    await writeMarker(root, 'marked.yaml');
    const h = harness(root, () => Promise.reject(new Error('the Aggrega daemon is not running')));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.item.text, '$(rocket) Release: unavailable');
    assert.ok(
      !h.item.text.includes('marked.yaml') && !h.item.tooltip.includes('marked.yaml'),
      `the indicator fell back to the marker file; text=${h.item.text} tooltip=${h.item.tooltip}`,
    );
    assert.strictEqual(h.item.shown, 1, 'the indicator stays visible and states what it does not know');
  });

  it('reports that no Release resolved when the daemon answers with an empty path', async () => {
    await writeMarker(root, 'marked.yaml');
    const h = harness(root, () => Promise.resolve(''));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.item.text, '$(rocket) Release: none');
    assert.ok(!h.item.tooltip.includes('marked.yaml'));
    assert.strictEqual(h.item.shown, 1);
  });

  it('hides itself when no workspace is anchored', async () => {
    const h = harness(null, () => Promise.resolve('/never/asked.yaml'));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.item.hidden, 1);
    assert.strictEqual(h.item.shown, 0);
    assert.strictEqual(h.queryCalls, 0, 'no anchor means no daemon query');
  });

  // A marker edit is a hint, not a value: the indicator re-asks the daemon
  // rather than reading the file it just saw change.
  it('re-asks the daemon on a marker change rather than reading the marker', async () => {
    let answer = path.join(root, 'first.yaml');
    const h = harness(root, () => Promise.resolve(answer));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();
    assert.strictEqual(h.item.text, '$(rocket) first.yaml');
    assert.strictEqual(h.queryCalls, 1);

    await writeMarker(root, 'unrelated.yaml');
    answer = path.join(root, 'second.yaml');
    h.markerChanged();
    await flush();

    assert.strictEqual(h.queryCalls, 2, 'the marker watcher must trigger a fresh daemon query');
    assert.strictEqual(h.item.text, '$(rocket) second.yaml');
  });

  it('registers the item and the marker watcher for disposal', async () => {
    const h = harness(root, () => Promise.resolve(''));

    activateReleaseStatus({ subscriptions: h.subscriptions }, h.deps);
    await flush();

    assert.strictEqual(h.subscriptions.length, 2);
  });
});
