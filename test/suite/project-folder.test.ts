// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  CHOOSE_PROJECT_FOLDER_COMMAND,
  PROJECT_FOLDER_STATE_KEY,
  buildProjectFolderItems,
  isSavedProjectFolderValid,
  projectFolderInForce,
  projectFolderOffers,
  readSavedProjectFolder,
  rememberProjectFolderChoice,
} from '../../src/project-folder';
import { STATE_KEY } from '../../src/anchor-picker';
import { SELECTED_RELEASE_STATE_KEY } from '../../src/release-selection';
import { WorkspaceStateLike } from '../../src/anchor-picker';
import { projectFolderRow } from '../../src/selector-rows';
import { OPEN_ANOTHER_FOLDER_COMMAND } from '../../src/selector-rows';

// A window's editor-local memory, with a close-and-reopen it can be driven
// through: the entries are serialised out of one instance and restored into a
// fresh one, which is what a reopened window does.
class Memory implements WorkspaceStateLike {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) { this.store.delete(key); return; }
    this.store.set(key, value);
  }

  snapshot(): Map<string, unknown> {
    return new Map(this.store);
  }

  restoreFrom(snapshot: Map<string, unknown>): void {
    this.store = new Map(snapshot);
  }
}

// 🔴 THE LAYOUT EVERY CASE BELOW IS DRIVEN AGAINST, NAMED IN FULL: two folders
// open in one window, each reaching an Aggrega workspace of its own.
const FIRST = path.join(path.sep, 'work', 'alpha');
const SECOND = path.join(path.sep, 'work', 'beta');
const OPEN_FOLDERS = [{ uri: { fsPath: FIRST } }, { uri: { fsPath: SECOND } }];

describe('the Project folder is chosen rather than derived', () => {
  it('names no folder at all until the reader chooses, where more than one is open', () => {
    // 🔴 THE HEART OF IT. Two folders are open and the extension has settled on
    // a workspace; the outer level still reports nothing, because nothing has
    // been CHOSEN. A value derived from the level beneath would name one of
    // these two here, and the reader would be told they had made a decision they
    // never made.
    assert.strictEqual(projectFolderInForce(null, OPEN_FOLDERS), null);
    assert.strictEqual(
      projectFolderRow(null, OPEN_FOLDERS.length).value, 'none selected',
    );
  });

  it('takes the sole open folder silently, so one project never meets the concept', () => {
    const only = [{ uri: { fsPath: FIRST } }];
    assert.strictEqual(projectFolderInForce(null, only)?.uri.fsPath, FIRST);
    // And the row says it is the only one, so a chooser of one does not read as
    // broken when the reader presses it anyway.
    assert.ok(
      projectFolderRow(FIRST, 1).tooltip.includes('no others to choose between'),
    );
  });

  // 🔴 THE CLAUSE'S OWN CASE: with two folders open, choose the SECOND; the row
  // reports the second at once, and still reports it after the window has been
  // closed and reopened — rather than whichever the anchoring would have
  // settled on.
  it('reports the chosen folder at once, and again after a reopen', async () => {
    const window1 = new Memory();

    // BEFORE THE CHOICE. The row is read from whatever is in force rather than
    // from a literal, so this reading is about the value the panel would draw.
    const before = projectFolderInForce(readSavedProjectFolder(window1), OPEN_FOLDERS);
    assert.strictEqual(
      projectFolderRow(before?.uri.fsPath ?? null, 2).value, 'none selected',
      'the row already names a folder before anything was chosen',
    );
    assert.strictEqual(before, null);

    // THE CHOICE: the second, which is deliberately not the first — a value
    // derived from input order would pass this while choosing nothing.
    const previous = await rememberProjectFolderChoice(window1, SECOND);
    assert.strictEqual(previous, null, 'something was remembered before the first choice');

    // AFTER THE CHOICE, IN THE SAME WINDOW.
    const after = projectFolderInForce(readSavedProjectFolder(window1), OPEN_FOLDERS);
    assert.strictEqual(after?.uri.fsPath, SECOND);
    assert.strictEqual(
      projectFolderRow(after?.uri.fsPath ?? null, 2).value, path.basename(SECOND),
    );

    // AFTER THE WINDOW IS CLOSED AND REOPENED: the entries are carried across
    // into a fresh memory, which is what a reopened window restores from.
    const window2 = new Memory();
    window2.restoreFrom(window1.snapshot());

    const restored = projectFolderInForce(readSavedProjectFolder(window2), OPEN_FOLDERS);
    assert.strictEqual(
      restored?.uri.fsPath, SECOND,
      'the choice did not survive the reopen, so the outer level is remembered by nothing',
    );
    assert.strictEqual(
      projectFolderRow(restored?.uri.fsPath ?? null, 2).value, path.basename(SECOND),
    );
    // 🔴 AND IT IS NOT THE ONE THE ANCHORING WOULD HAVE PICKED. Input order is
    // what every derivation on this side falls back to, so naming the first
    // folder is the exact shape of the defect being removed.
    assert.notStrictEqual(
      restored?.uri.fsPath, FIRST,
      'the reopened window names the first open folder, which is what a derived value does',
    );
  });

  it('forgets a remembered folder the window no longer has open, and says nothing is chosen', () => {
    const gone = path.join(path.sep, 'work', 'removed');
    assert.strictEqual(isSavedProjectFolderValid(gone, OPEN_FOLDERS), false);
    assert.strictEqual(
      projectFolderInForce(gone, OPEN_FOLDERS), null,
      'a folder the window no longer has open is still honoured as the choice',
    );
    // And the valid case, so the reading above is not a function that refuses
    // everything.
    assert.strictEqual(isSavedProjectFolderValid(SECOND, OPEN_FOLDERS), true);
  });

  it('falls back to the sole candidate when the remembered one has gone', () => {
    const only = [{ uri: { fsPath: FIRST } }];
    assert.strictEqual(
      projectFolderInForce(path.join(path.sep, 'work', 'removed'), only)?.uri.fsPath,
      FIRST,
    );
  });

  it('reads a stored value defensively, treating anything but a path as no choice', async () => {
    const memory = new Memory();
    for (const bad of [undefined, '', 42, null, { path: FIRST }]) {
      await memory.update(PROJECT_FOLDER_STATE_KEY, bad);
      assert.strictEqual(
        readSavedProjectFolder(memory), null,
        `a stored ${JSON.stringify(bad) ?? 'undefined'} was read as a choice`,
      );
    }
    // The control: a real path does read as a choice, so the readings above are
    // not a function that answers null for everything.
    await memory.update(PROJECT_FOLDER_STATE_KEY, SECOND);
    assert.strictEqual(readSavedProjectFolder(memory), SECOND);
  });
});

describe('the three levels each have their own editor-local memory', () => {
  it('keeps three distinct keys, so no level can overwrite another', () => {
    // 🔴 THE OUTER LEVEL HAD NO KEY AT ALL, WHICH IS WHY IT COULD NOT BE
    // REMEMBERED. Three levels are chosen and three are remembered, and the keys
    // are asserted DISTINCT rather than merely present: two levels sharing one
    // entry would make each choice erase the other, and both would still read
    // back as though they had been stored.
    const keys = [PROJECT_FOLDER_STATE_KEY, STATE_KEY, SELECTED_RELEASE_STATE_KEY];
    assert.strictEqual(new Set(keys).size, 3, 'two levels are remembered under one key');
    for (const key of keys) {
      assert.ok(key.startsWith('aggrega.'), `${key} is not namespaced to this extension`);
    }
  });

  it('writes and clears the outer level without touching the other two', async () => {
    const memory = new Memory();
    await memory.update(STATE_KEY, '/work/alpha/.aggrega-config.yaml');
    await memory.update(SELECTED_RELEASE_STATE_KEY, 'releases/prod.yaml');

    await rememberProjectFolderChoice(memory, SECOND);
    assert.strictEqual(memory.get(STATE_KEY), '/work/alpha/.aggrega-config.yaml');
    assert.strictEqual(memory.get(SELECTED_RELEASE_STATE_KEY), 'releases/prod.yaml');

    const previous = await rememberProjectFolderChoice(memory, null);
    assert.strictEqual(previous, SECOND, 'clearing did not report what it replaced');
    assert.strictEqual(readSavedProjectFolder(memory), null);
    assert.strictEqual(
      memory.get(STATE_KEY), '/work/alpha/.aggrega-config.yaml',
      'clearing the outer level reached into another level\'s memory',
    );
  });
});

describe('what the Project folder row opens', () => {
  it('runs a command of ours, because choosing among open folders is not an editor act', () => {
    assert.strictEqual(projectFolderRow(FIRST, 2).command, CHOOSE_PROJECT_FOLDER_COMMAND);
    assert.notStrictEqual(
      projectFolderRow(FIRST, 2).command, OPEN_ANOTHER_FOLDER_COMMAND,
      'the row opens a folder instead of choosing among the ones already open',
    );
  });

  it('offers every open folder and, last, the way to reach one that is not open', () => {
    const offers = projectFolderOffers(OPEN_FOLDERS);
    assert.deepStrictEqual(
      offers.map((o) => o.kind),
      ['open', 'open', 'other'],
      'the way to open another folder is not the last entry, or is missing entirely',
    );
    assert.deepStrictEqual(
      offers.filter((o) => o.kind === 'open').map((o) => o.description),
      [FIRST, SECOND],
    );
  });

  it('offers the sole folder rather than declining to show a choice of one', () => {
    // A reader who clicked to choose and was shown nothing cannot tell that the
    // control ran, which is the same reason the level beneath offers its sole
    // candidate.
    const offers = projectFolderOffers([{ uri: { fsPath: FIRST } }]);
    assert.deepStrictEqual(offers.map((o) => o.kind), ['open', 'other']);
  });

  it('still offers the way out where the window has no folder at all', () => {
    const offers = projectFolderOffers([]);
    assert.deepStrictEqual(offers.map((o) => o.kind), ['other']);
    assert.ok(
      !offers[0].label.includes('another'),
      'a window with nothing open is offered "another" folder, which implies one it does not have',
    );
  });

  it('tells two folders sharing a name apart by the folder above them', () => {
    const colliding = [
      { uri: { fsPath: path.join(path.sep, 'work', 'alpha', 'web') } },
      { uri: { fsPath: path.join(path.sep, 'work', 'beta', 'web') } },
    ];
    assert.deepStrictEqual(
      buildProjectFolderItems(colliding).map((i) => i.label),
      ['web (alpha)', 'web (beta)'],
    );
    // And it does NOT add the parent where there is nothing to tell apart, so
    // the disambiguation is a response to the collision rather than a constant.
    assert.deepStrictEqual(
      buildProjectFolderItems(OPEN_FOLDERS).map((i) => i.label),
      ['alpha', 'beta'],
    );
  });
});
