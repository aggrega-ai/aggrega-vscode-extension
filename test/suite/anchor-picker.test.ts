// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  STATE_KEY,
  WorkspaceStateLike,
  buildPickerItems,
  classifyActivation,
  isSavedAnchorValid,
  readSavedAnchor,
  activeFolderLabel,
} from '../../src/anchor-picker';
import { findAllAnchoredFolders, AnchoredFolder, FolderLike } from '../../src/workspace';

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
