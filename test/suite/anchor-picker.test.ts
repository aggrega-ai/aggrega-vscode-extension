// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  STATE_KEY,
  WIDEN_ANCHOR_OFFER_DETAIL,
  WorkspaceStateLike,
  anchorOffers,
  anchorSwitchMessage,
  buildPickerItems,
  classifyActivation,
  isSavedAnchorValid,
  readSavedAnchor,
  rememberAnchorChoice,
  activeFolderLabel,
  widenAnchorOfferLabel,
} from '../../src/anchor-picker';
import { findAllAnchoredFolders, AnchoredFolder, FolderLike } from '../../src/workspace';
import { workspaceRow } from '../../src/selector-rows';

// fakeFolder produces a structural WorkspaceFolder-shape value from
// just a fsPath. Sufficient for every helper this suite exercises.
function fakeFolder(fsPath: string): FolderLike {
  return { uri: { fsPath } };
}

function fakeAnchor(folderPath: string, anchorPath: string): AnchoredFolder {
  return { folder: fakeFolder(folderPath), anchorPath };
}

// fakeWorkspaceState implements the structural slice of
// vscode.ExtensionContext.workspaceState the anchor-picker module
// consumes. Map-backed; round-trips strings; supports undefined-as-
// delete to mirror the vscode contract.
class FakeWorkspaceState implements WorkspaceStateLike {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, value);
  }

  snapshot(): Map<string, unknown> {
    return new Map(this.store);
  }

  restoreFrom(snapshot: Map<string, unknown>): void {
    this.store = new Map(snapshot);
  }
}

describe('findAllAnchoredFolders', () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-multi-'));
  });
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns one entry per anchored folder, preserves input order', async () => {
    const a = path.join(tmpRoot, 'a');
    const b = path.join(tmpRoot, 'b');
    const c = path.join(tmpRoot, 'c');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.mkdir(c);
    await fs.writeFile(path.join(a, '.aggrega-config.yaml'), 'workspace: {}\n');
    await fs.writeFile(path.join(c, 'aggregate.yaml'), '');
    // b is intentionally unanchored

    const result = await findAllAnchoredFolders([fakeFolder(a), fakeFolder(b), fakeFolder(c)]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].folder.uri.fsPath, a);
    assert.strictEqual(result[0].anchorPath, path.join(a, '.aggrega-config.yaml'));
    assert.strictEqual(result[1].folder.uri.fsPath, c);
    assert.strictEqual(result[1].anchorPath, path.join(c, 'aggregate.yaml'));
  });

  it('returns empty array when no folder is anchored', async () => {
    const a = path.join(tmpRoot, 'a');
    const b = path.join(tmpRoot, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    const result = await findAllAnchoredFolders([fakeFolder(a), fakeFolder(b)]);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when input folder list is empty', async () => {
    const result = await findAllAnchoredFolders([]);
    assert.deepStrictEqual(result, []);
  });
});

describe('classifyActivation', () => {
  it('zero anchored → none', () => {
    const decision = classifyActivation([], null);
    assert.strictEqual(decision.kind, 'none');
  });

  it('exactly one anchored → single', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const decision = classifyActivation([a], null);
    assert.strictEqual(decision.kind, 'single');
    if (decision.kind === 'single') {
      assert.strictEqual(decision.target.anchorPath, '/ws/a/.aggrega-config.yaml');
    }
  });

  it('multiple anchored + no saved → multiPrompt', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const decision = classifyActivation([a, b], null);
    assert.strictEqual(decision.kind, 'multiPrompt');
    if (decision.kind === 'multiPrompt') {
      assert.strictEqual(decision.anchored.length, 2);
    }
  });

  it('multiple anchored + valid saved → multiSaved with matching target', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const decision = classifyActivation([a, b], '/ws/b/aggregate.yaml');
    assert.strictEqual(decision.kind, 'multiSaved');
    if (decision.kind === 'multiSaved') {
      assert.strictEqual(decision.target.anchorPath, '/ws/b/aggregate.yaml');
    }
  });

  it('multiple anchored + stale saved (no match) → multiPrompt', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const decision = classifyActivation([a, b], '/ws/gone/.aggrega-config.yaml');
    assert.strictEqual(decision.kind, 'multiPrompt');
  });
});

describe('isSavedAnchorValid', () => {
  it('returns true when savedPath matches an anchored folder', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(isSavedAnchorValid('/ws/a/.aggrega-config.yaml', [a]), true);
  });

  it('returns false when savedPath has no match in anchored', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(isSavedAnchorValid('/ws/gone/.aggrega-config.yaml', [a]), false);
  });

  it('returns false when savedPath is null', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(isSavedAnchorValid(null, [a]), false);
  });

  it('returns false when anchored list is empty', () => {
    assert.strictEqual(isSavedAnchorValid('/ws/a/.aggrega-config.yaml', []), false);
  });
});

describe('readSavedAnchor', () => {
  it('returns the stored string when present', () => {
    const state = new FakeWorkspaceState();
    void state.update(STATE_KEY, '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(readSavedAnchor(state), '/ws/a/.aggrega-config.yaml');
  });

  it('returns null when the key is absent', () => {
    const state = new FakeWorkspaceState();
    assert.strictEqual(readSavedAnchor(state), null);
  });

  it('returns null when the value is an empty string', () => {
    const state = new FakeWorkspaceState();
    void state.update(STATE_KEY, '');
    assert.strictEqual(readSavedAnchor(state), null);
  });

  it('returns null when the value is not a string', () => {
    const state = new FakeWorkspaceState();
    void state.update(STATE_KEY, 42);
    assert.strictEqual(readSavedAnchor(state), null);
  });
});

describe('buildPickerItems', () => {
  it('label = folder basename, detail = marker basename, description = folder path', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/bar', '/ws/bar/release.yaml');
    const items = buildPickerItems([a, b]);
    assert.deepStrictEqual(items.map(i => ({
      label: i.label,
      description: i.description,
      detail: i.detail,
    })), [
      { label: 'foo', description: '/ws/foo', detail: '.aggrega-config.yaml' },
      { label: 'bar', description: '/ws/bar', detail: 'release.yaml' },
    ]);
  });

  it('disambiguates colliding basenames with parent-basename', () => {
    const a = fakeAnchor('/projects/foo/web', '/projects/foo/web/.aggrega-config.yaml');
    const b = fakeAnchor('/projects/bar/web', '/projects/bar/web/aggregate.yaml');
    const items = buildPickerItems([a, b]);
    assert.strictEqual(items[0].label, 'web (foo)');
    assert.strictEqual(items[1].label, 'web (bar)');
  });

  it('does not disambiguate non-colliding labels even when others collide', () => {
    const a = fakeAnchor('/projects/foo/web', '/projects/foo/web/.aggrega-config.yaml');
    const b = fakeAnchor('/projects/bar/web', '/projects/bar/web/aggregate.yaml');
    const c = fakeAnchor('/projects/lone', '/projects/lone/.aggrega-config.yaml');
    const items = buildPickerItems([a, b, c]);
    assert.strictEqual(items[0].label, 'web (foo)');
    assert.strictEqual(items[1].label, 'web (bar)');
    assert.strictEqual(items[2].label, 'lone');
  });
});

describe('what the workspace row offers when clicked', () => {
  it('offers the sole attached folder rather than declining to show a choice', () => {
    // The defect this replaces was a row whose tooltip promised an action and
    // whose handler then refused it for exactly this case. One candidate is
    // still a choice the reader asked to see.
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const offers = anchorOffers([a]);
    assert.ok(
      offers.some(o => o.kind === 'anchored'),
      'the attached folder is not offered, so the reader cannot see where they are',
    );
    assert.strictEqual(offers.filter(o => o.kind === 'anchored').length, 1);
  });

  it('offers the route to widening alongside what is attached, in one list', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const offers = anchorOffers([a]);
    const widen = offers.filter(o => o.kind === 'widen');
    assert.strictEqual(widen.length, 1, 'exactly one way to reach the widening');
    assert.strictEqual(widen[0].detail, WIDEN_ANCHOR_OFFER_DETAIL);
    assert.strictEqual(
      offers[offers.length - 1].kind, 'widen',
      'the widening comes after what is already available, which is what a reader reads first',
    );
  });

  it('still offers the widening when nothing is attached, because the workspace may still hold one', () => {
    // Attached folders and the folders in the workspace Aggrega would recognise
    // are different populations. Nothing attached says nothing about the second,
    // so this is the case that must not become a dead end.
    const offers = anchorOffers([]);
    assert.deepStrictEqual(offers.map(o => o.kind), ['widen']);
  });

  it('says "another" only when there is already one to be another of', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    assert.ok(!widenAnchorOfferLabel(0).includes('another'));
    assert.ok(widenAnchorOfferLabel(1).includes('another'));
    assert.strictEqual(
      anchorOffers([a]).find(o => o.kind === 'widen')?.label,
      widenAnchorOfferLabel(1),
      'the composed offer and the label rule are one answer',
    );
  });

  it('shapes the attached entries through the one home for that shaping', () => {
    // Not a second rendering of a folder: the activation prompt and this offer
    // must disambiguate colliding basenames identically, so the offer composes
    // buildPickerItems rather than repeating it.
    const a = fakeAnchor('/projects/foo/web', '/projects/foo/web/.aggrega-config.yaml');
    const b = fakeAnchor('/projects/bar/web', '/projects/bar/web/aggregate.yaml');
    const offers = anchorOffers([a, b]);
    const shaped = buildPickerItems([a, b]);
    assert.deepStrictEqual(
      offers.filter(o => o.kind === 'anchored').map(o => ({
        label: o.label, description: o.description, detail: o.detail,
      })),
      shaped.map(i => ({ label: i.label, description: i.description, detail: i.detail })),
    );
  });

  it('carries the folder to attach to on the entry that names it', () => {
    // The caller dispatches on kind and then attaches; an entry that named no
    // folder would make the widening indistinguishable from a folder choice.
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const offer = anchorOffers([a]).find(o => o.kind === 'anchored');
    assert.ok(offer && offer.kind === 'anchored');
    assert.strictEqual(offer.anchored.anchorPath, '/ws/foo/.aggrega-config.yaml');
  });

  it('hands back the attached folder under the identity the no-op guard compares on', () => {
    // The expensive behaviour this protects: attaching stops the running
    // language server and restarts it at the chosen root. Choosing the folder
    // already attached must therefore reach the guard that returns early, and
    // that guard compares folder paths — so the offer has to carry the SAME
    // path the active folder is held under. A composition that re-resolved or
    // normalised the path would leave the comparison failing silently, and the
    // only symptom would be a restart every time a reader confirmed where they
    // already were.
    //
    // The comparison is restated here deliberately rather than shared: what is
    // under test is that the offer preserves the identity the guard needs, so
    // reading the guard's own expression from the same place would make the
    // assertion vacuous.
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/bar', '/ws/bar/release.yaml');
    const anchored = [a, b];
    // Attachment selects its target from this same list, which is what makes
    // the active folder one of the entries rather than a copy of one.
    const active = anchored[0];

    const offered = anchorOffers(anchored)
      .filter(o => o.kind === 'anchored')
      .map(o => (o.kind === 'anchored' ? o.anchored : null)!);

    const targetRoot = offered[0].folder.uri.fsPath;
    assert.strictEqual(
      active.folder.uri.fsPath === targetRoot, true,
      'choosing the attached folder would restart the language server for nothing',
    );
    assert.strictEqual(
      active.folder.uri.fsPath === offered[1].folder.uri.fsPath, false,
      'choosing a different folder must NOT be mistaken for a no-op',
    );
  });

  it('names no internal population in anything the reader reads', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    for (const offers of [anchorOffers([]), anchorOffers([a])]) {
      for (const o of offers) {
        for (const text of [o.label, o.detail]) {
          assert.ok(
            !/anchored/i.test(text),
            `"${text}" describes a variable rather than the reader's situation`,
          );
        }
      }
    }
  });
});

describe('activeFolderLabel', () => {
  it('renders Aggrega · <basename> for unique-basename multi-anchor', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/bar', '/ws/bar/release.yaml');
    assert.strictEqual(activeFolderLabel(b, [a, b]), 'Aggrega · bar');
  });

  it('renders Aggrega · <basename> (<parent>) on basename collision', () => {
    const a = fakeAnchor('/projects/foo/web', '/projects/foo/web/.aggrega-config.yaml');
    const b = fakeAnchor('/projects/bar/web', '/projects/bar/web/aggregate.yaml');
    assert.strictEqual(activeFolderLabel(a, [a, b]), 'Aggrega · web (foo)');
    assert.strictEqual(activeFolderLabel(b, [a, b]), 'Aggrega · web (bar)');
  });
});

describe('stale-saved-anchor handling', () => {
  it('classifyActivation treats stale saved as multiPrompt when 2+ anchored remain', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    // saved points to a removed third folder
    const decision = classifyActivation([a, b], '/ws/removed/.aggrega-config.yaml');
    assert.strictEqual(decision.kind, 'multiPrompt');
  });

  it('classifyActivation collapses to single when stale saved exists but only one anchored remains', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const decision = classifyActivation([a], '/ws/removed/.aggrega-config.yaml');
    assert.strictEqual(decision.kind, 'single');
    if (decision.kind === 'single') {
      assert.strictEqual(decision.target.anchorPath, '/ws/a/.aggrega-config.yaml');
    }
  });

  it('classifyActivation collapses to none when stale saved exists and zero anchored remain', () => {
    const decision = classifyActivation([], '/ws/removed/.aggrega-config.yaml');
    assert.strictEqual(decision.kind, 'none');
  });
});

describe('cross-session persistence', () => {
  // Simulates close + reopen by serialising the workspaceState's
  // entries and restoring them into a fresh instance, then re-running
  // the activation classification.
  it('saved choice survives session restart', async () => {
    const session1State = new FakeWorkspaceState();
    await session1State.update(STATE_KEY, '/ws/b/aggregate.yaml');
    const snapshot = session1State.snapshot();

    // Session two: fresh state restored from snapshot.
    const session2State = new FakeWorkspaceState();
    session2State.restoreFrom(snapshot);

    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const saved = readSavedAnchor(session2State);
    assert.strictEqual(saved, '/ws/b/aggregate.yaml');

    const decision = classifyActivation([a, b], saved);
    assert.strictEqual(decision.kind, 'multiSaved');
    if (decision.kind === 'multiSaved') {
      assert.strictEqual(decision.target.anchorPath, '/ws/b/aggregate.yaml');
    }
  });

  it('stale saved choice is detected after session restart', async () => {
    const session1State = new FakeWorkspaceState();
    await session1State.update(STATE_KEY, '/ws/removed/.aggrega-config.yaml');
    const snapshot = session1State.snapshot();

    const session2State = new FakeWorkspaceState();
    session2State.restoreFrom(snapshot);

    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const saved = readSavedAnchor(session2State);
    assert.strictEqual(isSavedAnchorValid(saved, [a, b]), false);

    const decision = classifyActivation([a, b], saved);
    assert.strictEqual(decision.kind, 'multiPrompt');
  });
});

describe('folder-add/remove activation cascade', () => {
  it('add: zero anchored → one anchored after add → single', () => {
    const before = classifyActivation([], null);
    assert.strictEqual(before.kind, 'none');

    const added = fakeAnchor('/ws/new', '/ws/new/.aggrega-config.yaml');
    const after = classifyActivation([added], null);
    assert.strictEqual(after.kind, 'single');
  });

  it('add: one anchored (with saved) → two anchored → multiSaved (silent)', () => {
    const a = fakeAnchor('/ws/a', '/ws/a/.aggrega-config.yaml');
    const before = classifyActivation([a], '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(before.kind, 'single');

    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const after = classifyActivation([a, b], '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(after.kind, 'multiSaved');
    if (after.kind === 'multiSaved') {
      assert.strictEqual(after.target.folder.uri.fsPath, '/ws/a');
    }
  });

  it('remove: two anchored → one remaining (saved was the removed one) → single attaches to survivor', () => {
    // Pre-removal anchors were [a, b]; saved pointed to a; a got
    // removed. Driver code clears the saved value when it's stale,
    // so classification runs with savedPath=null against the
    // surviving [b] list.
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const after = classifyActivation([b], null);
    assert.strictEqual(after.kind, 'single');
    if (after.kind === 'single') {
      assert.strictEqual(after.target.folder.uri.fsPath, '/ws/b');
    }
  });

  it('remove: two anchored → one remaining (saved was the kept one) → single attaches to survivor', () => {
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    // saved was b; a got removed. Saved is still valid because b
    // remains, but with only one anchor the classification collapses
    // to single regardless of saved.
    const after = classifyActivation([b], '/ws/b/aggregate.yaml');
    assert.strictEqual(after.kind, 'single');
  });

  it('remove: three anchored → two remain (saved was removed) → multiPrompt', () => {
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const c = fakeAnchor('/ws/c', '/ws/c/release.yaml');
    // saved was a; cleared because stale.
    const after = classifyActivation([b, c], null);
    assert.strictEqual(after.kind, 'multiPrompt');
  });

  it('remove: three anchored → two remain (saved was kept) → multiSaved', () => {
    const b = fakeAnchor('/ws/b', '/ws/b/aggregate.yaml');
    const c = fakeAnchor('/ws/c', '/ws/c/release.yaml');
    // saved was b; b remains.
    const after = classifyActivation([b, c], '/ws/b/aggregate.yaml');
    assert.strictEqual(after.kind, 'multiSaved');
  });
});

describe('rememberAnchorChoice', () => {
  it('records the choice so reading it back answers with it', async () => {
    const state = new FakeWorkspaceState();
    await rememberAnchorChoice(state, '/ws/b/aggregate.yaml');
    assert.strictEqual(readSavedAnchor(state), '/ws/b/aggregate.yaml');
  });

  it('answers with the path it replaced, so a move that fails can be put back', async () => {
    const state = new FakeWorkspaceState();
    await rememberAnchorChoice(state, '/ws/a/.aggrega-config.yaml');

    const previous = await rememberAnchorChoice(state, '/ws/b/aggregate.yaml');
    assert.strictEqual(previous, '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(readSavedAnchor(state), '/ws/b/aggregate.yaml');

    // Putting it back restores exactly what was there, which is what the
    // declined-add path relies on.
    await rememberAnchorChoice(state, previous);
    assert.strictEqual(readSavedAnchor(state), '/ws/a/.aggrega-config.yaml');
  });

  it('forgets the choice when handed null, and reports nothing remembered', async () => {
    const state = new FakeWorkspaceState();
    await rememberAnchorChoice(state, '/ws/a/.aggrega-config.yaml');

    const previous = await rememberAnchorChoice(state, null);
    assert.strictEqual(previous, '/ws/a/.aggrega-config.yaml');
    assert.strictEqual(readSavedAnchor(state), null);
    assert.strictEqual(state.get(STATE_KEY), undefined);
  });
});

// The whole route a reader takes to change which folder the editor works in,
// driven end to end over REAL directories and the real modules that decide it.
//
// 🔴 IT IS WRITTEN AS THE READER'S SEQUENCE RATHER THAN AS ASSERTIONS ABOUT
// classifyActivation, and that is what makes it a regression test rather than a
// restatement of the classifier. The failure this covers was not in the
// classifier: every step of it was individually right, and the folder the reader
// named simply never reached the input the classifier reads. Only a reading that
// runs the steps IN ORDER can see that, which is why each step below carries the
// surfaces forward instead of asserting one function in isolation.
describe('changing which folder the editor works in', () => {
  let tmpRoot: string;
  let a: string;
  let b: string;

  // A reading of every surface that names a workspace, taken together, so a
  // surface that agrees with the others cannot be told apart from one that is
  // merely not being looked at.
  // The count is the caller's own reading of how many folders are anchored at
  // that moment, rather than a number fixed here: the row says whether there is
  // anything else to choose between, and a constant would make it say the same
  // thing before and after the second folder appears.
  function surfaces(attachedRoot: string | null, openedFolder: string, anchored: number) {
    const row = workspaceRow(attachedRoot, openedFolder, anchored);
    return { attachedRoot, rowValue: row.value, rowTooltip: row.tooltip };
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-switch-'));
    a = path.join(tmpRoot, 'first');
    b = path.join(tmpRoot, 'second');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.writeFile(path.join(a, '.aggrega-config.yaml'), 'workspace: {}\n');
    await fs.writeFile(path.join(b, '.aggrega-config.yaml'), 'workspace: {}\n');
  });
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('a folder the reader NAMES becomes the one every surface reports', async () => {
    const state = new FakeWorkspaceState();

    // The reader is working in the first folder: it is the only anchored one, so
    // attaching records it the way the activation path does.
    const only = await findAllAnchoredFolders([fakeFolder(a)]);
    const first = classifyActivation(only, readSavedAnchor(state));
    assert.strictEqual(first.kind, 'single');
    await rememberAnchorChoice(state, first.target.anchorPath);

    const before = surfaces(first.target.folder.uri.fsPath, a, only.length);
    assert.strictEqual(before.attachedRoot, a);
    assert.strictEqual(before.rowValue, path.basename(a));
    assert.ok(before.rowTooltip.includes(a));

    // The reader names the second folder. Recording that answer is the step the
    // choose-workspace control performs before anything re-attaches.
    const chosen = await findAllAnchoredFolders([fakeFolder(b)]);
    await rememberAnchorChoice(state, chosen[0].anchorPath);

    // The editor then re-evaluates the open folders, both of which are anchored.
    const both = await findAllAnchoredFolders([fakeFolder(a), fakeFolder(b)]);
    const after = classifyActivation(both, readSavedAnchor(state));
    assert.strictEqual(after.kind, 'multiSaved');
    assert.strictEqual(after.target.folder.uri.fsPath, b);

    // Every surface that names a workspace now names the second folder, and the
    // first is named by none of them.
    const now = surfaces(after.target.folder.uri.fsPath, a, both.length);
    assert.strictEqual(now.attachedRoot, b);
    assert.strictEqual(now.rowValue, path.basename(b));
    assert.ok(now.rowTooltip.includes(b));
    assert.ok(!now.rowTooltip.startsWith(`Aggrega workspace: ${a}`));
    assert.strictEqual(activeFolderLabel(after.target, both), `Aggrega · ${path.basename(b)}`);
    assert.strictEqual(readSavedAnchor(state), chosen[0].anchorPath);
  });

  it('switching back is not one-way', async () => {
    const state = new FakeWorkspaceState();
    const both = await findAllAnchoredFolders([fakeFolder(a), fakeFolder(b)]);

    await rememberAnchorChoice(state, both[1].anchorPath);
    const there = classifyActivation(both, readSavedAnchor(state));
    assert.strictEqual(there.kind, 'multiSaved');
    if (there.kind !== 'multiSaved') { return; }
    assert.strictEqual(there.target.folder.uri.fsPath, b);

    await rememberAnchorChoice(state, both[0].anchorPath);
    const back = classifyActivation(both, readSavedAnchor(state));
    assert.strictEqual(back.kind, 'multiSaved');
    assert.strictEqual(back.target.folder.uri.fsPath, a);
    assert.strictEqual(activeFolderLabel(back.target, both), `Aggrega · ${path.basename(a)}`);
  });

  it('a folder merely ADDED to the window leaves the reader where they were', async () => {
    // 🔴 THE OTHER HALF OF THE RULE, AND IT IS NOT THE SAME CLAIM. A reader who
    // named a folder said which one they want; a reader who added one to their
    // editor window said nothing about anchoring, and moving the language server
    // under them would be a new failure wearing this fix's clothes. So the
    // remembered choice winning is CORRECT here and wrong above, and the
    // difference is whether anything recorded an answer.
    const state = new FakeWorkspaceState();

    const only = await findAllAnchoredFolders([fakeFolder(a)]);
    const first = classifyActivation(only, readSavedAnchor(state));
    assert.strictEqual(first.kind, 'single');
    if (first.kind !== 'single') { return; }
    await rememberAnchorChoice(state, first.target.anchorPath);

    // The second folder appears in the window. Nothing records a choice.
    const both = await findAllAnchoredFolders([fakeFolder(a), fakeFolder(b)]);
    const after = classifyActivation(both, readSavedAnchor(state));

    assert.strictEqual(after.kind, 'multiSaved');
    assert.strictEqual(after.target.folder.uri.fsPath, a);
    assert.strictEqual(
      workspaceRow(after.target.folder.uri.fsPath, a, both.length).value,
      path.basename(a),
    );
  });

  it('the reader is told the language server is restarting, and where', () => {
    const message = anchorSwitchMessage('/ws/second');
    // The folder is named in full: two folders open together can share a
    // basename, and this sentence is read without the picker beside it.
    assert.ok(message.includes('/ws/second'), message);
    // And the restart is stated rather than left to be inferred.
    assert.ok(/restart/i.test(message), message);
  });
});
