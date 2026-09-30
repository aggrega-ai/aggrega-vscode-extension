// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  CHOOSE_ANCHOR_ACTION,
  CHOOSE_ANCHOR_INVITATION,
  CHOOSE_ANCHOR_PLACEHOLDER,
  STATE_KEY,
  WorkspaceStateLike,
  anchorOffers,
  anchorSwitchMessage,
  anchorsAvailableSentence,
  buildPickerItems,
  classifyActivation,
  isSavedAnchorValid,
  readSavedAnchor,
  rememberAnchorChoice,
  activeWorkspaceLabel,
  widenAnchorOfferDetail,
  widenAnchorOfferLabel,
} from '../../src/anchor-picker';
import { WindowKind } from '../../src/window-kind';
import {
  AnchoredFolder,
  CONFIG_FILENAME,
  FolderLike,
  NO_ANCHORED_WORKSPACE_CONTROL_REASON,
  NO_ANCHORED_WORKSPACE_MESSAGE,
  NO_ANCHORED_WORKSPACE_ROW_TOOLTIP,
  NO_ANCHORED_WORKSPACE_TREE_LABEL,
  findAggregaWorkspaceAnchor,
  findAllAnchoredFolders,
  workspaceRootOf,
} from '../../src/workspace';
import { workspaceRow } from '../../src/selector-rows';
import { SELECTOR_ROW_LABELS, soleCandidateNote } from '../../src/selector-levels';

// fakeFolder produces a structural WorkspaceFolder-shape value from
// just a fsPath. Sufficient for every helper this suite exercises.
function fakeFolder(fsPath: string): FolderLike {
  return { uri: { fsPath } };
}

function fakeAnchor(folderPath: string, anchorPath: string): AnchoredFolder {
  return { folder: fakeFolder(folderPath), anchorPath };
}

// The window the row's offers are drawn for where the case is not about what
// adding costs: one already on a workspace file, so the last entry's second line
// names no cost at all.
const ON_WORKSPACE_FILE: WindowKind = { onWorkspaceFile: true, remote: false };

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

// The last entry's second line, written out rather than composed from the
// constant the source reads: a composed expectation moves with whatever it is
// checking and cannot fail.
const LOOKS_AND_ADDS = 'Looks through the folders you have open for one Aggrega recognises, and adds it.';
const LOOKS_AND_ADDS_AND_RELOAD =
  'Looks through the folders you have open for one Aggrega recognises, and adds it. The window reloads.';
const LOOKS_AND_ADDS_AND_RESTART =
  'Looks through the folders you have open for one Aggrega recognises, and adds it. Extensions restart.';

// The four windows, each with the line its reader must be shown. Taking the
// entry ends in the add the Project folder row's add entry makes, so it costs
// what that entry costs: a window on a workspace file takes a folder in place,
// remote or not; a window on one folder becomes a workspace to take it, which
// reloads a remote window and restarts a local one's extensions.
const WIDEN_COSTS: Array<[string, WindowKind, string]> = [
  ['on a workspace file, remote', { onWorkspaceFile: true, remote: true }, LOOKS_AND_ADDS],
  ['on a workspace file, local', { onWorkspaceFile: true, remote: false }, LOOKS_AND_ADDS],
  ['on a folder, remote', { onWorkspaceFile: false, remote: true }, LOOKS_AND_ADDS_AND_RELOAD],
  ['on a folder, local', { onWorkspaceFile: false, remote: false }, LOOKS_AND_ADDS_AND_RESTART],
];

describe('what the workspace row offers when clicked', () => {
  it('offers the sole attached folder rather than declining to show a choice', () => {
    // A handler declining here would refuse the action the row's tooltip
    // promises, for exactly this case. One candidate is still a choice the
    // reader asked to see.
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const offers = anchorOffers([a], ON_WORKSPACE_FILE);
    assert.ok(
      offers.some(o => o.kind === 'anchored'),
      'the attached folder is not offered, so the reader cannot see where they are',
    );
    assert.strictEqual(offers.filter(o => o.kind === 'anchored').length, 1);
  });

  it('offers the route to widening alongside what is attached, in one list', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const offers = anchorOffers([a], ON_WORKSPACE_FILE);
    const widen = offers.filter(o => o.kind === 'widen');
    assert.strictEqual(widen.length, 1, 'exactly one way to reach the widening');
    assert.strictEqual(widen[0].detail, LOOKS_AND_ADDS);
    assert.strictEqual(
      offers[offers.length - 1].kind, 'widen',
      'the widening comes after what is already available, which is what a reader reads first',
    );
  });

  it('still offers the widening when nothing is attached, because the workspace may still hold one', () => {
    // Attached folders and the folders in the workspace Aggrega would recognise
    // are different populations. Nothing attached says nothing about the second,
    // so this is the case that must not become a dead end.
    const offers = anchorOffers([], ON_WORKSPACE_FILE);
    assert.deepStrictEqual(offers.map(o => o.kind), ['widen']);
  });

  it('says "another" only when there is already one to be another of', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    assert.ok(!widenAnchorOfferLabel(0).includes('another'));
    assert.ok(widenAnchorOfferLabel(1).includes('another'));
    assert.strictEqual(
      anchorOffers([a], ON_WORKSPACE_FILE).find(o => o.kind === 'widen')?.label,
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
    const offers = anchorOffers([a, b], ON_WORKSPACE_FILE);
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
    const offer = anchorOffers([a], ON_WORKSPACE_FILE).find(o => o.kind === 'anchored');
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

    const offered = anchorOffers(anchored, ON_WORKSPACE_FILE)
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
    for (const offers of [anchorOffers([], ON_WORKSPACE_FILE), anchorOffers([a], ON_WORKSPACE_FILE)]) {
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

describe('what the workspace row\'s last entry says taking it costs', () => {
  for (const [name, windowKind, expected] of WIDEN_COSTS) {
    it(`says exactly what the add it ends in costs in a window ${name}`, () => {
      assert.strictEqual(widenAnchorOfferDetail(windowKind), expected);
    });
  }

  it('carries that line on the entry the row draws, with nothing attached and with one attached', () => {
    // 🔴 THE COMPOSED ENTRY, not only the line: the row draws what the offers
    // hand it, so a line that is right on its own and missing from the entry
    // would still leave the reader unwarned.
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    for (const attached of [[], [a]]) {
      for (const [name, windowKind, expected] of WIDEN_COSTS) {
        const last = anchorOffers(attached, windowKind).at(-1);
        assert.ok(last?.kind === 'widen', `the last entry is not the one that adds a folder (${name})`);
        assert.strictEqual(
          last.label,
          attached.length === 0 ? 'Choose a folder Aggrega recognises…' : 'Choose another folder Aggrega recognises…',
          'the entry\'s label moved with the kind of window, which it must not',
        );
        assert.strictEqual(
          last.detail, expected,
          `with ${attached.length} attached in a window ${name}, the last entry's second line is not the one `
          + 'its reader must be shown',
        );
      }
    }
  });
});

describe('activeWorkspaceLabel', () => {
  it('renders Aggrega · <basename> for unique-basename multi-anchor', () => {
    const a = fakeAnchor('/ws/foo', '/ws/foo/.aggrega-config.yaml');
    const b = fakeAnchor('/ws/bar', '/ws/bar/release.yaml');
    assert.strictEqual(activeWorkspaceLabel(b, [a, b]), 'Aggrega · bar');
  });

  it('renders Aggrega · <basename> (<parent>) on basename collision', () => {
    const a = fakeAnchor('/projects/foo/web', '/projects/foo/web/.aggrega-config.yaml');
    const b = fakeAnchor('/projects/bar/web', '/projects/bar/web/aggregate.yaml');
    assert.strictEqual(activeWorkspaceLabel(a, [a, b]), 'Aggrega · web (foo)');
    assert.strictEqual(activeWorkspaceLabel(b, [a, b]), 'Aggrega · web (bar)');
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
    assert.strictEqual(activeWorkspaceLabel(after.target, both), `Aggrega · ${path.basename(b)}`);
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
    assert.strictEqual(activeWorkspaceLabel(back.target, both), `Aggrega · ${path.basename(a)}`);
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

// One Aggrega workspace reached from two open folders at once.
//
// 🔴 THE QUESTION THIS COVERS IS THE ONE THE SURFACE MUST NOT ASK. Discovery
// climbs, so a marker one level up answers for every open folder beneath it —
// and "which folder contains this workspace" then has two true answers. The
// failure is not that the wrong one is picked; it is that the population is
// counted as two, so a reader is asked to choose between two entries that are
// the same workspace, told there are two where there is one, and denied the
// sentence saying theirs is the only one.
//
// It is driven over REAL directories through the real modules, in the order the
// activation path runs them, because each of those three symptoms surfaces at a
// different step and asserting any one function alone would miss the others.
describe('one Aggrega workspace reached from two open folders', () => {
  let tmpRoot: string;
  let root: string;
  let underA: string;
  let underB: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-shared-'));
    // The marker sits ABOVE both open folders, which is what makes one
    // workspace answer for both of them.
    root = path.join(tmpRoot, 'repo');
    underA = path.join(root, 'services');
    underB = path.join(root, 'apps');
    await fs.mkdir(root);
    await fs.mkdir(underA);
    await fs.mkdir(underB);
    await fs.writeFile(path.join(root, '.aggrega-config.yaml'), 'workspace: {}\n');
  });
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('is one candidate, not two, and is selected silently', async () => {
    const reached = await findAllAnchoredFolders([fakeFolder(underA), fakeFolder(underB)]);

    assert.strictEqual(
      reached.length, 1,
      'two open folders under one marker are reported as two workspaces to choose between',
    );
    assert.strictEqual(reached[0].anchorPath, path.join(root, '.aggrega-config.yaml'));

    // A level with exactly one candidate is taken without asking. With the
    // population counted per folder this reads as multiPrompt, and the reader
    // meets a concept they have no second thing to apply it to.
    const decision = classifyActivation(reached, null);
    assert.strictEqual(
      decision.kind, 'single',
      'the reader is asked to choose between two entries that are one workspace',
    );
  });

  it('the panel reports one unambiguous answer', async () => {
    const reached = await findAllAnchoredFolders([fakeFolder(underA), fakeFolder(underB)]);
    // What the language server reports having anchored to: it climbs from
    // whichever folder it was started at and settles on the same root.
    const anchoredRoot = workspaceRootOf(reached[0]);
    assert.strictEqual(anchoredRoot, root);

    const row = workspaceRow(anchoredRoot, underA, reached.length);
    assert.strictEqual(row.value, path.basename(root));
    // The row's hover says nothing about how many workspaces there are — the
    // chooser lists them — so a single candidate draws no sentence of its own.
    assert.ok(
      !row.tooltip.includes(soleCandidateNote('workspace')),
      `the row says only one workspace is available: ${row.tooltip}`,
    );
  });

  it('the entry a reader reads names the workspace, never the folder it is reached through', async () => {
    const reached = await findAllAnchoredFolders([fakeFolder(underA), fakeFolder(underB)]);
    const [item] = buildPickerItems(reached);

    assert.strictEqual(item.label, path.basename(root));
    assert.strictEqual(item.description, root);
    // The folder is still carried, because starting a server needs one — it is
    // only the text that must not name it.
    assert.strictEqual(item.anchored.folder.uri.fsPath, underA);
    assert.notStrictEqual(
      item.label, path.basename(underA),
      'the entry names an arbitrary one of the folders that reach the workspace',
    );
    assert.strictEqual(
      activeWorkspaceLabel(reached[0], reached), `Aggrega · ${path.basename(root)}`,
    );
  });

  it('the folder kept is the first in the window, so the answer does not move on its own', async () => {
    const forwards = await findAllAnchoredFolders([fakeFolder(underA), fakeFolder(underB)]);
    const backwards = await findAllAnchoredFolders([fakeFolder(underB), fakeFolder(underA)]);
    assert.strictEqual(forwards[0].folder.uri.fsPath, underA);
    assert.strictEqual(backwards[0].folder.uri.fsPath, underB);
    // Whichever it is, the workspace is the same — which is why choosing the
    // folder arbitrarily is safe and choosing it unstably would not be.
    assert.strictEqual(workspaceRootOf(forwards[0]), workspaceRootOf(backwards[0]));
  });

  it('a second workspace is still a second candidate', async () => {
    // The de-duplication must collapse one workspace seen twice and nothing
    // else. Without this the same assertion passes on a function that returned
    // at most one entry however many workspaces there were.
    const other = path.join(tmpRoot, 'elsewhere');
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, 'aggregate.yaml'), '');

    const reached = await findAllAnchoredFolders([
      fakeFolder(underA), fakeFolder(underB), fakeFolder(other),
    ]);
    assert.strictEqual(reached.length, 2);
    assert.deepStrictEqual(
      reached.map(r => workspaceRootOf(r)).sort(), [other, root].sort(),
    );
    assert.strictEqual(classifyActivation(reached, null).kind, 'multiPrompt');
  });

  it('a choice remembered under one folder survives the other being added', async () => {
    // The entry is keyed on the marker, so the remembered path still matches
    // after de-duplication however the window's folder list changed.
    const state = new FakeWorkspaceState();
    const one = await findAllAnchoredFolders([fakeFolder(underA)]);
    await rememberAnchorChoice(state, one[0].anchorPath);

    const both = await findAllAnchoredFolders([fakeFolder(underA), fakeFolder(underB)]);
    assert.ok(isSavedAnchorValid(readSavedAnchor(state), both));
  });
});

// 🔴 THE TWO CANDIDATE SEARCHES RUN IN OPPOSITE DIRECTIONS AND NEITHER
// SUBSUMES THE OTHER, WHICH IS WHY NEITHER CAN SIMPLY REPLACE THE OTHER.
//
// Activation CLIMBS from each open folder. The welcome page's chooser DESCENDS,
// globbing inside the folders the window has open and confirming each hit
// through the same discovery rule. The case below is one the climb answers and
// no descending search can: an open folder that holds nothing at all, sitting
// under a marker one level up. A descending search rooted there has no file to
// match, whatever its pattern — so scoping the Aggrega workspace level to a
// descending search would stop recognising this reader's workspace.
//
// Pinned here because it is the measurement a later reconciliation of the two
// searches has to answer to, and a reconciliation argued without it looks
// obviously right.
describe('climbing and descending find different populations', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-direction-'));
  });
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('a bare folder under a marker is anchored, and holds nothing to descend onto', async () => {
    const root = path.join(tmpRoot, 'repo');
    const bare = path.join(root, 'docs');
    await fs.mkdir(root);
    await fs.mkdir(bare);
    await fs.writeFile(path.join(root, '.aggrega-config.yaml'), 'workspace: {}\n');

    assert.strictEqual(
      await findAggregaWorkspaceAnchor(bare),
      path.join(root, '.aggrega-config.yaml'),
      'the climb does not reach the marker above the open folder',
    );
    // An empty directory matches no pattern, so this settles the second half
    // without needing a glob engine: a descending search rooted here returns
    // nothing whatever it is looking for.
    assert.deepStrictEqual(
      await fs.readdir(bare), [],
      'the folder holds a file, so this no longer measures what it claims to',
    );
  });
});

// The four renderings of "this project holds no Aggrega workspace".
//
// They are one state told to a reader four ways — as a notification, as a tree
// row, as the reason a control cannot run, and as a selector row's hover — and
// the whole reason they live in one module is that a surface growing a fifth
// should find the wording rather than invent it. What is asserted here is that
// each names the level the reader is taught rather than the mechanism the code
// is named after, and that the four are genuinely four renderings rather than
// four sentences that happen to be near each other.
describe('the no-Aggrega-workspace state, in the words the reader is taught', () => {
  const renderings: ReadonlyArray<readonly [string, string]> = [
    ['notification', NO_ANCHORED_WORKSPACE_MESSAGE],
    ['tree row', NO_ANCHORED_WORKSPACE_TREE_LABEL],
    ['control reason', NO_ANCHORED_WORKSPACE_CONTROL_REASON],
    ['selector row hover', NO_ANCHORED_WORKSPACE_ROW_TOOLTIP],
  ];

  it('names the level, never the mechanism the code is named after', () => {
    for (const [surface, text] of renderings) {
      assert.ok(
        text.includes(SELECTOR_ROW_LABELS.workspace),
        `the ${surface} does not name the level it is about: ${text}`,
      );
      assert.ok(
        !/anchor/i.test(text),
        `the ${surface} names the climb rather than the reader's situation: ${text}`,
      );
    }
  });

  it('is four renderings and not four sentences', () => {
    const texts = renderings.map(([, text]) => text);
    assert.strictEqual(
      new Set(texts).size, texts.length,
      'two surfaces render this state identically, so one of them is not shaped for where it is read',
    );
    // The notification and the hover carry the same two parts; the difference
    // between them is where the second sits, which is what makes them two
    // renderings rather than one duplicated.
    assert.ok(NO_ANCHORED_WORKSPACE_MESSAGE.includes(CONFIG_FILENAME));
    assert.ok(NO_ANCHORED_WORKSPACE_ROW_TOOLTIP.includes(CONFIG_FILENAME));
    assert.ok(
      NO_ANCHORED_WORKSPACE_ROW_TOOLTIP.includes('\n'),
      'the hover is read as a block and carries no line of its own',
    );
    assert.ok(
      !NO_ANCHORED_WORKSPACE_MESSAGE.includes('\n'),
      'the notification is read as a sentence and has been broken across lines',
    );
  });

  it('is what the row shows, read rather than written again beside it', () => {
    assert.strictEqual(
      workspaceRow(null, null, 0).tooltip,
      NO_ANCHORED_WORKSPACE_ROW_TOOLTIP,
      'the row writes its own rendering of this state, which is how one state came to be '
      + 'described in two vocabularies',
    );
  });
});

// The two facts the activation module holds that no runnable path here can
// reach, read out of its source.
//
// 🔴 THIS IS A WEAKER INSTRUMENT THAN THE SUITES ABOVE AND IT IS USED BECAUSE
// THE ALTERNATIVE IS NOTHING. Both claims live in the module that builds the
// editor's surfaces, which cannot be loaded without an extension host; there is
// no argument to pass and no value to read back. What a reading of the source
// can still catch is the change that silently undoes either — an assignment
// removed, or a dependency rewired to the other fact — and that is the whole of
// what these two assert. Neither claims the behaviour was exercised.
describe('what the activation module holds about the folder in use', () => {
  const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

  async function activationSource(): Promise<string> {
    return fs.readFile(path.join(EXTENSION_ROOT, 'src/extension.ts'), 'utf8');
  }

  it('drops the folder in use when the language server is taken down deliberately', async () => {
    const source = await activationSource();
    const opens = source.indexOf('async function stopDaemon(');
    assert.notStrictEqual(opens, -1, 'the teardown is not where this reading expects it');
    const closes = source.indexOf('\n}\n', opens);
    assert.notStrictEqual(closes, -1, 'the teardown has no closing brace at column 0');
    const body = source.slice(opens, closes);

    assert.ok(
      /workspaceRootForCommands = null/.test(body),
      'the folder is retained through a deliberate teardown, so every surface goes on '
      + 'naming a folder the editor is no longer working in',
    );
    // And exactly two assignments in the whole module: the one that records the
    // folder and the one that drops it. A third would be a second author of a
    // fact that has one.
    assert.strictEqual(
      (source.match(/\bworkspaceRootForCommands = /g) ?? []).length, 2,
      'the folder in use is written from somewhere other than the attach and the teardown',
    );
  });

  it('decides the lifecycle reading on what is reachable, not on what is in use', async () => {
    const source = await activationSource();
    const wiring = /isWorkspaceAnchored: \(\) => ([^,\n]+)/.exec(source);
    assert.ok(wiring, 'the lifecycle indicator no longer declares this fact where this reading looks');
    // The indicator's two not-running readings are "nothing here to attach to"
    // and "something is and the server is not attached". Reading the folder in
    // use answers the second question and prints the first, which is what this
    // pins: a window reaching several workspaces with none chosen, and one
    // whose server was stopped, are both told there are none.
    assert.ok(
      wiring[1].includes('currentAnchored'),
      `the lifecycle reading is taken from ${wiring[1].trim()}, which is not the population it reports on`,
    );
    assert.ok(
      !wiring[1].includes('workspaceRootForCommands'),
      'the lifecycle reading is taken from the folder in use, so a stopped server reads as no workspace',
    );
  });
});

// The one offer, read by the three surfaces that make it.
describe('the offer to change which Aggrega workspace the editor works in', () => {
  it('names the level rather than a folder', () => {
    for (const text of [
      CHOOSE_ANCHOR_ACTION,
      CHOOSE_ANCHOR_INVITATION,
      CHOOSE_ANCHOR_PLACEHOLDER,
    ]) {
      assert.ok(
        text.includes(SELECTOR_ROW_LABELS.workspace),
        `"${text}" does not name the level the reader is choosing`,
      );
      assert.ok(
        !/which folder/i.test(text),
        `"${text}" asks which folder, which is the question this level does not ask`,
      );
    }
  });

  it('is the same offer the row closes with, read rather than restated', () => {
    const row = workspaceRow('/ws/repo', '/ws/repo', 1);
    assert.ok(
      row.tooltip.endsWith(CHOOSE_ANCHOR_INVITATION),
      `the row writes its own offer: ${row.tooltip}`,
    );
  });

  it('counts Aggrega workspaces, in the level\'s own words', () => {
    const sentence = anchorsAvailableSentence(2);
    assert.ok(sentence.includes('2'), sentence);
    assert.ok(sentence.includes(`${SELECTOR_ROW_LABELS.workspace}s`), sentence);
    assert.ok(
      !/folders/i.test(sentence),
      `"${sentence}" reports a number of folders beside a list of workspaces`,
    );
  });
});
