// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  ADD_FOLDER_DIALOG,
  AddingWindow,
  CARRIED_ANSWER_STATE_KEY,
  CHOOSE_PROJECT_FOLDER_COMMAND,
  FolderAddingEditor,
  FolderOpeningEditor,
  OPEN_FOLDER_DIALOG,
  PROJECT_FOLDER_STATE_KEY,
  WindowKind,
  addFolderDetail,
  addFolderWithAnswer,
  adoptCarriedAnswer,
  buildProjectFolderItems,
  isSavedProjectFolderValid,
  openFolderDetail,
  pickAndAddFolder,
  pickAndOpenFolder,
  projectFolderInForce,
  projectFolderOffers,
  readSavedProjectFolder,
  rememberProjectFolderChoice,
} from '../../src/project-folder';
import { STATE_KEY, readSavedAnchor } from '../../src/anchor-picker';
import { SELECTED_RELEASE_STATE_KEY } from '../../src/release-selection';
import { WorkspaceStateLike } from '../../src/anchor-picker';
import { FolderLike } from '../../src/workspace';
import { projectFolderRow } from '../../src/selector-rows';
import { functionBody } from '../helpers/anchoring-census';
import { callSites, tokenModules } from '../helpers/open-folder-census';

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
// A folder neither of those two, for the cases that add one.
const THIRD = path.join(path.sep, 'work', 'gamma');
// The window the offers are drawn for where the case is not about what adding
// costs: one already on a workspace file, so the offer's second line names no
// cost at all.
const ON_WORKSPACE_FILE: WindowKind = { onWorkspaceFile: true, remote: false };
// A window on one folder or on none, which an add turns into a new workspace. It
// is the remote kind because that is the dev-container window the add was walked
// in; what decides where an answer goes is the workspace file, not the remote.
const MAKES_NEW_WORKSPACE: WindowKind = { onWorkspaceFile: false, remote: true };

// A window an add is made in: its own memory, the editor's global store, and its
// kind. The two memories are separate fakes so a case can read which one an
// answer went into; a second window is made by handing it the SAME global store
// and a fresh memory, which is what the editor gives a new workspace.
interface FakeAddingWindow extends AddingWindow {
  memory: Memory;
  global: Memory;
}

function addingIn(windowKind: WindowKind, global = new Memory()): FakeAddingWindow {
  return { memory: new Memory(), global, windowKind };
}

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
    assert.strictEqual(
      projectFolderRow(FIRST, 2).command, CHOOSE_PROJECT_FOLDER_COMMAND,
      'the row runs something other than the chooser among the folders already open',
    );
  });

  it('offers every open folder and, last, the entry that opens one and the entry that adds one', () => {
    const offers = projectFolderOffers(OPEN_FOLDERS, ON_WORKSPACE_FILE);
    // 🔴 TWO ENTRIES, IN THIS ORDER, BECAUSE THEY ARE TWO ACTS: opening puts the
    // window on the folder picked alone, and adding puts it beside the ones open.
    assert.deepStrictEqual(
      offers.map((o) => o.kind),
      ['open', 'open', 'reopen', 'add'],
      'the entry that opens a folder and the entry that adds one are not the last two, in that order',
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
    const offers = projectFolderOffers([{ uri: { fsPath: FIRST } }], ON_WORKSPACE_FILE);
    assert.deepStrictEqual(offers.map((o) => o.kind), ['open', 'reopen', 'add']);
  });

  it('still offers both ways out where the window has no folder at all', () => {
    const offers = projectFolderOffers([], ON_WORKSPACE_FILE);
    assert.deepStrictEqual(offers.map((o) => o.kind), ['reopen', 'add']);
    assert.ok(
      offers[0].kind === 'reopen' && !offers[0].detail.includes('in place of'),
      'a window with nothing open is told the folder opens "in place of" what it has, which is nothing',
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

// The add entry's second line, written out rather than composed from the
// constant the source reads: a composed expectation moves with whatever it is
// checking and cannot fail.
const REACH = 'Reaches a folder this window does not have open yet.';
const REACH_AND_RELOAD = 'Reaches a folder this window does not have open yet. The window reloads.';
const REACH_AND_RESTART = 'Reaches a folder this window does not have open yet. Extensions restart.';

// The four windows, each with the line its reader must be shown. A window on a
// workspace file takes a folder in place, remote or not; a window on one folder
// or on none becomes a workspace to take it, which reloads a remote window and
// restarts a local one's extensions.
const COSTS: Array<[string, WindowKind, string]> = [
  ['on a workspace file, remote', { onWorkspaceFile: true, remote: true }, REACH],
  ['on a workspace file, local', { onWorkspaceFile: true, remote: false }, REACH],
  ['on a folder or on nothing, remote', { onWorkspaceFile: false, remote: true }, REACH_AND_RELOAD],
  ['on a folder or on nothing, local', { onWorkspaceFile: false, remote: false }, REACH_AND_RESTART],
];

// The open entry's second line, written out for the same reason. Opening a
// folder in the window it was asked from reloads that window whatever kind it
// is, so the line moves with how many folders are open and with nothing else.
const OPEN_IN_EMPTY = 'Opens the folder you pick in this window. The window reloads.';
const OPEN_IN_PLACE = 'Opens the folder you pick in place of what this window has open. The window reloads.';

describe('what the two last entries say taking them costs', () => {
  for (const [name, windowKind, expected] of COSTS) {
    it(`says exactly what adding costs in a window ${name}`, () => {
      assert.strictEqual(addFolderDetail(windowKind), expected);
    });
  }

  it('says what opening does to the folders open, and that the window reloads', () => {
    assert.strictEqual(openFolderDetail(0), OPEN_IN_EMPTY);
    assert.strictEqual(openFolderDetail(1), OPEN_IN_PLACE);
    assert.strictEqual(openFolderDetail(2), OPEN_IN_PLACE);
  });

  it('carries each line on its own entry, under labels that never change, for none, one and two folders', () => {
    const windows: Array<[readonly FolderLike[], string]> = [
      [[], OPEN_IN_EMPTY],
      [[{ uri: { fsPath: FIRST } }], OPEN_IN_PLACE],
      [OPEN_FOLDERS, OPEN_IN_PLACE],
    ];
    for (const [folders, opening] of windows) {
      for (const [name, windowKind, adding] of COSTS) {
        const offers = projectFolderOffers(folders, windowKind);
        const open = offers.at(-2);
        const add = offers.at(-1);
        assert.ok(open?.kind === 'reopen', `the second-to-last entry is not the one that opens a folder (${name})`);
        assert.ok(add?.kind === 'add', `the last entry is not the one that adds a folder (${name})`);
        assert.strictEqual(open.label, 'Open folder…', 'the entry that opens a folder is labelled otherwise');
        assert.strictEqual(add.label, 'Add folder to this window…', 'the entry that adds a folder is labelled otherwise');
        assert.strictEqual(
          open.detail, opening,
          `with ${folders.length} open in a window ${name}, the open entry's second line is not the one `
          + 'its reader must be shown',
        );
        assert.strictEqual(
          add.detail, adding,
          `with ${folders.length} open in a window ${name}, the add entry's second line is not the one `
          + 'its reader must be shown',
        );
      }
    }
  });
});

// A location as the editor's dialog answers with one: anything carrying the
// path it stands for.
interface PickedLocation { fsPath: string }

// An editor that answers the dialog with what it is handed, takes or refuses an
// add as it is told, and records every act the sequence asks of it in the order
// asked — so "nothing happened" is read off a record rather than assumed.
class FakeEditor implements FolderAddingEditor<PickedLocation> {
  readonly acts: string[] = [];
  readonly added: PickedLocation[] = [];
  readonly informed: string[] = [];
  readonly errors: string[] = [];

  constructor(
    private readonly answer: readonly PickedLocation[] | undefined,
    private readonly open: readonly FolderLike[],
    private readonly takes = true,
  ) {}

  pickFolder(): Thenable<readonly PickedLocation[] | undefined> {
    this.acts.push('pickFolder');
    return Promise.resolve(this.answer);
  }

  openFolders(): readonly FolderLike[] {
    this.acts.push('openFolders');
    return this.open;
  }

  addFolder(folder: PickedLocation): boolean {
    this.acts.push('addFolder');
    this.added.push(folder);
    return this.takes;
  }

  showInformation(message: string): void {
    this.acts.push('showInformation');
    this.informed.push(message);
  }

  showError(message: string): void {
    this.acts.push('showError');
    this.errors.push(message);
  }
}

describe('the add entry asks for a folder and adds it to the window', () => {
  it('asks the editor\'s dialog for one folder and for nothing but a folder', () => {
    assert.deepStrictEqual(
      { ...ADD_FOLDER_DIALOG },
      {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Add',
        title: 'Aggrega: select a folder to add to this window',
      },
      'the dialog is asked for something other than exactly one folder, or under other words',
    );
  });

  it('adds the folder picked in place, once, makes it the Project folder and says so', async () => {
    // A window already on a workspace file keeps its memory across the add, so
    // the answer is that window's own to keep.
    const picked = { fsPath: THIRD };
    const editor = new FakeEditor([picked], OPEN_FOLDERS);
    const adding = addingIn(ON_WORKSPACE_FILE);
    assert.strictEqual(await pickAndAddFolder(editor, adding), 'added-in-place');
    assert.deepStrictEqual(editor.added, [picked], 'the add is not made exactly once, with the pick');
    // 🔴 THE VERY VALUE THE DIALOG ANSWERED WITH, not a location rebuilt from its
    // path: a rebuilt one keeps the path and loses where that path lives.
    assert.strictEqual(editor.added[0], picked, 'the folder is rebuilt rather than handed on');
    assert.strictEqual(
      readSavedProjectFolder(adding.memory), THIRD,
      'the folder added in place is not remembered as the one the editor works from',
    );
    assert.strictEqual(
      adding.global.get(CARRIED_ANSWER_STATE_KEY), undefined,
      'an add that keeps the window\'s memory carried its answer through the global store as well',
    );
    assert.deepStrictEqual(
      editor.informed,
      [`Aggrega: now working from ${THIRD}.`],
      'the reader is not told, once and by the folder\'s full path, which folder the editor now works from',
    );
    assert.deepStrictEqual(editor.errors, [], 'an add that succeeded is reported as a refusal');
    assert.deepStrictEqual(editor.acts, ['pickFolder', 'openFolders', 'addFolder', 'showInformation']);
  });

  it('adds the folder picked into a new workspace, once, carries it across and tells nothing', async () => {
    // 🔴 THE WINDOW WALKED: one folder open, not on a workspace file. The add
    // makes a new workspace, whose memory the editor opens empty, so the answer is
    // carried through the global store and this window's memory is left alone.
    const picked = { fsPath: THIRD };
    const editor = new FakeEditor([picked], [{ uri: { fsPath: FIRST } }]);
    const adding = addingIn(MAKES_NEW_WORKSPACE);
    assert.strictEqual(await pickAndAddFolder(editor, adding), 'added-to-new-workspace');
    assert.deepStrictEqual(editor.added, [picked], 'the add is not made exactly once, with the pick');
    assert.strictEqual(editor.added[0], picked, 'the folder is rebuilt rather than handed on');
    assert.deepStrictEqual(
      adding.global.get(CARRIED_ANSWER_STATE_KEY),
      { folders: [FIRST, THIRD], answer: { level: 'project', path: THIRD } },
      'the answer is not carried under the exact folders the new workspace will hold',
    );
    assert.deepStrictEqual(
      adding.memory.snapshot(), new Map(),
      'the answer was written into the memory of the window being left',
    );
    assert.deepStrictEqual(editor.informed, [], 'an add that takes the window down announced a switch first');
    assert.deepStrictEqual(editor.errors, [], 'an add that succeeded is reported as a refusal');
    assert.deepStrictEqual(editor.acts, ['pickFolder', 'openFolders', 'addFolder']);
  });

  for (const [name, answer] of [['with no answer', undefined], ['with an empty answer', []]] as const) {
    for (const windowKind of [ON_WORKSPACE_FILE, MAKES_NEW_WORKSPACE]) {
      it(`changes, records and says nothing where the dialog is closed ${name} (${windowKind.onWorkspaceFile ? 'in place' : 'new workspace'})`, async () => {
        const editor = new FakeEditor(answer, OPEN_FOLDERS);
        const adding = addingIn(windowKind);
        assert.strictEqual(await pickAndAddFolder(editor, adding), 'cancelled');
        // 🔴 THE CONTROL: the dialog WAS asked for, so the absences below are the
        // sequence stopping at a cancel rather than never having started.
        assert.deepStrictEqual(editor.acts, ['pickFolder'], 'the dialog was not asked for, or more followed a cancel');
        assert.deepStrictEqual(editor.added, [], 'a cancelled dialog added a folder');
        assert.deepStrictEqual(editor.informed, [], 'a cancelled dialog told the reader something');
        assert.deepStrictEqual(editor.errors, [], 'a cancelled dialog reported a refusal');
        assert.deepStrictEqual(adding.memory.snapshot(), new Map(), 'a cancelled dialog recorded an answer');
        assert.deepStrictEqual(adding.global.snapshot(), new Map(), 'a cancelled dialog carried an answer');
      });
    }
  }

  it('adds and records nothing where the folder picked is already open, and says so once, by its full path', async () => {
    const editor = new FakeEditor([{ fsPath: SECOND }], OPEN_FOLDERS);
    const adding = addingIn(MAKES_NEW_WORKSPACE);
    assert.strictEqual(await pickAndAddFolder(editor, adding), 'already-open');
    assert.deepStrictEqual(editor.added, [], 'a folder the window already has was handed to the editor');
    assert.deepStrictEqual(
      editor.informed,
      [`Aggrega: ${SECOND} is already open in this window.`],
      'the reader is not told, once and by the folder\'s full path, that it is already open',
    );
    assert.deepStrictEqual(editor.errors, [], 'a folder already open is reported as a refusal');
    assert.deepStrictEqual(adding.memory.snapshot(), new Map(), 'a folder already open was recorded');
    assert.deepStrictEqual(adding.global.snapshot(), new Map(), 'a folder already open was carried');

    // 🔴 THE CONTROL: the same pick in a window that does not have it open IS
    // added, so the reading above is about the folder being open rather than a
    // sequence that refuses everything.
    const elsewhere = new FakeEditor([{ fsPath: SECOND }], [{ uri: { fsPath: FIRST } }]);
    assert.strictEqual(await pickAndAddFolder(elsewhere, addingIn(MAKES_NEW_WORKSPACE)), 'added-to-new-workspace');
    assert.deepStrictEqual(elsewhere.informed, []);
  });

  it('tells a refusal in place as an error naming the folder, and puts the previous answer back', async () => {
    const picked = { fsPath: THIRD };
    const editor = new FakeEditor([picked], OPEN_FOLDERS, false);
    const adding = addingIn(ON_WORKSPACE_FILE);
    await rememberProjectFolderChoice(adding.memory, SECOND);
    assert.strictEqual(await pickAndAddFolder(editor, adding), 'declined');
    assert.deepStrictEqual(editor.added, [picked], 'the add was not attempted exactly once');
    assert.deepStrictEqual(
      editor.errors,
      [`Aggrega: the editor declined to add ${THIRD} to this workspace.`],
      'the refusal is not told once, as an error naming the folder\'s full path',
    );
    assert.deepStrictEqual(editor.informed, [], 'a refusal is told as information as well');
    assert.strictEqual(
      readSavedProjectFolder(adding.memory), SECOND,
      'a refused add left the window remembering a folder it never reached',
    );
    assert.strictEqual(adding.global.get(CARRIED_ANSWER_STATE_KEY), undefined);
  });
});

// 🔴 THE ANSWER'S OWN FIVE CASES, one fault per case: the carried answer is
// taken by the window it was written for and by no other, a later add replaces
// it, a refused add deletes it, and a window with none behaves as it always did.
// A new window is modelled as the editor makes one: a FRESH memory, and the SAME
// global store the window that wrote it had.
describe('the answer an add gives reaches the window the reader comes back to', () => {
  const MARKER = path.join(path.sep, 'work', 'gamma', '.aggrega-config.yaml');
  const one = [{ uri: { fsPath: FIRST } }];
  const afterAdd = [{ uri: { fsPath: FIRST } }, { uri: { fsPath: THIRD } }];

  it('is taken by the window holding exactly its folders, which then works from it, and is gone', async () => {
    const left = addingIn(MAKES_NEW_WORKSPACE);
    await pickAndAddFolder(new FakeEditor([{ fsPath: THIRD }], one), left);

    const next = addingIn(MAKES_NEW_WORKSPACE, left.global);
    const taken = await adoptCarriedAnswer(next, afterAdd);
    assert.deepStrictEqual(taken, { level: 'project', path: THIRD }, 'the window the add made took nothing');
    assert.strictEqual(
      readSavedProjectFolder(next.memory), THIRD,
      'the answer was not written into the memory of the window the add made',
    );
    // 🔴 WHAT THE ROW READS: the folder added is the one the editor works from
    // there, rather than "none selected" among two open folders.
    assert.strictEqual(projectFolderInForce(readSavedProjectFolder(next.memory), afterAdd)?.uri.fsPath, THIRD);
    assert.strictEqual(
      left.global.get(CARRIED_ANSWER_STATE_KEY), undefined,
      'the answer was taken and left in the global store, so another window could take it again',
    );
    // Through its own level's writer and nothing else.
    assert.strictEqual(next.memory.get(STATE_KEY), undefined, 'the Project folder answer reached another level');
  });

  it('carries the Aggrega workspace the welcome page\'s step named, the same way', async () => {
    const left = addingIn(MAKES_NEW_WORKSPACE);
    const editor = new FakeEditor(undefined, one);
    assert.strictEqual(
      await addFolderWithAnswer(editor, left, one, { fsPath: THIRD }, { level: 'workspace', path: MARKER }),
      'added-to-new-workspace',
    );
    assert.deepStrictEqual(left.memory.snapshot(), new Map(), 'the answer was written into the window being left');

    const next = addingIn(MAKES_NEW_WORKSPACE, left.global);
    assert.deepStrictEqual(await adoptCarriedAnswer(next, afterAdd), { level: 'workspace', path: MARKER });
    assert.strictEqual(readSavedAnchor(next.memory), MARKER, 'the Aggrega workspace named was not taken in');
    assert.strictEqual(next.memory.get(PROJECT_FOLDER_STATE_KEY), undefined, 'the answer reached another level');
    assert.strictEqual(left.global.get(CARRIED_ANSWER_STATE_KEY), undefined);
  });

  it('matches the folders as a set, whatever order the window lists them in', async () => {
    const left = addingIn(MAKES_NEW_WORKSPACE);
    await pickAndAddFolder(new FakeEditor([{ fsPath: THIRD }], one), left);
    const next = addingIn(MAKES_NEW_WORKSPACE, left.global);
    assert.deepStrictEqual(await adoptCarriedAnswer(next, [...afterAdd].reverse()), { level: 'project', path: THIRD });
  });

  it('is left untouched, and applies nothing, in a window holding other folders', async () => {
    const left = addingIn(MAKES_NEW_WORKSPACE);
    await pickAndAddFolder(new FakeEditor([{ fsPath: THIRD }], one), left);
    const written = left.global.get(CARRIED_ANSWER_STATE_KEY);
    assert.ok(written !== undefined, 'nothing was carried, so the readings below are about nothing');

    // The window being left, reopened on its one folder; a window holding one
    // folder more; and one holding a different second folder.
    for (const folders of [one, [...afterAdd, { uri: { fsPath: SECOND } }], [{ uri: { fsPath: FIRST } }, { uri: { fsPath: SECOND } }]]) {
      const other = addingIn(MAKES_NEW_WORKSPACE, left.global);
      assert.strictEqual(
        await adoptCarriedAnswer(other, folders), null,
        `a window holding ${folders.map((f) => f.uri.fsPath).join(', ')} took an answer carried for another`,
      );
      assert.deepStrictEqual(other.memory.snapshot(), new Map(), 'a window the answer was not for had it applied');
      assert.deepStrictEqual(
        left.global.get(CARRIED_ANSWER_STATE_KEY), written,
        'a window the answer was not for moved or deleted it',
      );
    }
  });

  it('is replaced by a later add, so only the last one is taken', async () => {
    const global = new Memory();
    await pickAndAddFolder(new FakeEditor([{ fsPath: THIRD }], one), addingIn(MAKES_NEW_WORKSPACE, global));
    await pickAndAddFolder(
      new FakeEditor([{ fsPath: SECOND }], one), addingIn(MAKES_NEW_WORKSPACE, global),
    );
    assert.deepStrictEqual(
      global.get(CARRIED_ANSWER_STATE_KEY),
      { folders: [FIRST, SECOND], answer: { level: 'project', path: SECOND } },
      'the second add did not replace what the first carried',
    );
    assert.strictEqual(
      await adoptCarriedAnswer(addingIn(MAKES_NEW_WORKSPACE, global), afterAdd), null,
      'the first add\'s answer survived the second',
    );
    const next = addingIn(MAKES_NEW_WORKSPACE, global);
    assert.deepStrictEqual(
      await adoptCarriedAnswer(next, [{ uri: { fsPath: FIRST } }, { uri: { fsPath: SECOND } }]),
      { level: 'project', path: SECOND },
    );
  });

  it('is deleted when the editor refuses the add, by either route', async () => {
    // An answer an earlier add left behind is present first, so the deletion is
    // shown to remove the entry rather than to put an earlier one back.
    const earlier = { folders: [SECOND, THIRD], answer: { level: 'project', path: THIRD } };

    const byRow = addingIn(MAKES_NEW_WORKSPACE);
    await byRow.global.update(CARRIED_ANSWER_STATE_KEY, earlier);
    const rowEditor = new FakeEditor([{ fsPath: THIRD }], one, false);
    assert.strictEqual(await pickAndAddFolder(rowEditor, byRow), 'declined');
    assert.strictEqual(byRow.global.get(CARRIED_ANSWER_STATE_KEY), undefined, 'a refused add from the row left an answer carried');
    assert.deepStrictEqual(byRow.memory.snapshot(), new Map());
    assert.deepStrictEqual(rowEditor.errors, [`Aggrega: the editor declined to add ${THIRD} to this workspace.`]);

    const byStep = addingIn(MAKES_NEW_WORKSPACE);
    await byStep.global.update(CARRIED_ANSWER_STATE_KEY, earlier);
    const stepEditor = new FakeEditor(undefined, one, false);
    assert.strictEqual(
      await addFolderWithAnswer(stepEditor, byStep, one, { fsPath: THIRD }, { level: 'workspace', path: MARKER }),
      'declined',
    );
    assert.strictEqual(byStep.global.get(CARRIED_ANSWER_STATE_KEY), undefined, 'a refused add from the step left an answer carried');
    assert.deepStrictEqual(byStep.memory.snapshot(), new Map());
    assert.deepStrictEqual(stepEditor.errors, [`Aggrega: the editor declined to add ${THIRD} to this workspace.`]);
  });

  it('records in place in the window\'s own memory, and puts the previous answer back on a refusal, by the step too', async () => {
    const earlierMarker = path.join(path.sep, 'work', 'alpha', '.aggrega-config.yaml');
    const taken = addingIn(ON_WORKSPACE_FILE);
    assert.strictEqual(
      await addFolderWithAnswer(new FakeEditor(undefined, OPEN_FOLDERS), taken, OPEN_FOLDERS, { fsPath: THIRD }, { level: 'workspace', path: MARKER }),
      'added-in-place',
    );
    assert.strictEqual(readSavedAnchor(taken.memory), MARKER, 'the workspace named in place is not remembered');
    assert.deepStrictEqual(taken.global.snapshot(), new Map(), 'an add in place carried its answer as well');

    const refused = addingIn(ON_WORKSPACE_FILE);
    await refused.memory.update(STATE_KEY, earlierMarker);
    assert.strictEqual(
      await addFolderWithAnswer(new FakeEditor(undefined, OPEN_FOLDERS, false), refused, OPEN_FOLDERS, { fsPath: THIRD }, { level: 'workspace', path: MARKER }),
      'declined',
    );
    assert.strictEqual(readSavedAnchor(refused.memory), earlierMarker, 'a refused add in place did not put the previous answer back');
    assert.deepStrictEqual(refused.global.snapshot(), new Map());
  });

  it('changes nothing in a window where nothing was carried, or where what is there is not an answer', async () => {
    const stores = addingIn(MAKES_NEW_WORKSPACE);
    await stores.memory.update(PROJECT_FOLDER_STATE_KEY, FIRST);
    await stores.memory.update(STATE_KEY, '/work/alpha/.aggrega-config.yaml');
    await stores.memory.update(SELECTED_RELEASE_STATE_KEY, 'releases/prod.yaml');
    const before = stores.memory.snapshot();

    assert.strictEqual(await adoptCarriedAnswer(stores, one), null, 'a window with nothing carried took something');
    assert.deepStrictEqual(stores.memory.snapshot(), before, 'a window with nothing carried had its memory changed');
    assert.deepStrictEqual(stores.global.snapshot(), new Map(), 'a window with nothing carried wrote the global store');

    for (const malformed of ['/work/alpha', { folders: FIRST, answer: { level: 'project', path: THIRD } },
      { folders: [FIRST], answer: { level: 'release', path: THIRD } }, { folders: [FIRST], answer: { level: 'project', path: '' } }]) {
      await stores.global.update(CARRIED_ANSWER_STATE_KEY, malformed);
      assert.strictEqual(
        await adoptCarriedAnswer(stores, one), null,
        `${JSON.stringify(malformed)} was taken as an answer`,
      );
      assert.deepStrictEqual(stores.memory.snapshot(), before);
      assert.deepStrictEqual(stores.global.get(CARRIED_ANSWER_STATE_KEY), malformed, 'an entry that is no answer was moved');
    }
  });
});

// An editor for the open entry: it answers the dialog with what it is handed,
// takes or rejects the open as it is told, and records every act in order.
class FakeOpener implements FolderOpeningEditor<PickedLocation> {
  readonly acts: string[] = [];
  readonly opened: PickedLocation[] = [];
  readonly errors: string[] = [];

  constructor(
    private readonly answer: readonly PickedLocation[] | undefined,
    private readonly takes = true,
  ) {}

  pickFolder(): Thenable<readonly PickedLocation[] | undefined> {
    this.acts.push('pickFolder');
    return Promise.resolve(this.answer);
  }

  openFolder(folder: PickedLocation): Thenable<unknown> {
    this.acts.push('openFolder');
    this.opened.push(folder);
    return this.takes ? Promise.resolve(undefined) : Promise.reject(new Error('refused'));
  }

  showError(message: string): void {
    this.acts.push('showError');
    this.errors.push(message);
  }
}

describe('the open entry asks for a folder and opens it in this window', () => {
  it('asks the editor\'s dialog for one folder, under the word Open', () => {
    assert.deepStrictEqual(
      { ...OPEN_FOLDER_DIALOG },
      {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Open',
        title: 'Aggrega: select a folder to open in this window',
      },
      'the dialog is asked for something other than exactly one folder, or under other words',
    );
  });

  it('opens the folder the reader picked, once, and tells them nothing', async () => {
    const picked = { fsPath: THIRD };
    const editor = new FakeOpener([picked]);
    assert.strictEqual(await pickAndOpenFolder(editor), 'opened');
    assert.deepStrictEqual(editor.opened, [picked], 'the open is not made exactly once, with the pick');
    // 🔴 THE VERY VALUE THE DIALOG ANSWERED WITH, for the reason the add states.
    assert.strictEqual(editor.opened[0], picked, 'the folder is rebuilt rather than handed on');
    assert.deepStrictEqual(editor.errors, [], 'an open the editor took is reported as a refusal');
    // 🔴 AND IT RECORDS NOTHING: two acts and no third, so nothing here writes
    // into the memory of the window being left.
    assert.deepStrictEqual(editor.acts, ['pickFolder', 'openFolder']);
  });

  for (const [name, answer] of [['with no answer', undefined], ['with an empty answer', []]] as const) {
    it(`changes nothing and says nothing where the dialog is closed ${name}`, async () => {
      const editor = new FakeOpener(answer);
      assert.strictEqual(await pickAndOpenFolder(editor), 'cancelled');
      // 🔴 THE CONTROL: the dialog WAS asked for, so the absences below are the
      // sequence stopping at a cancel rather than never having started.
      assert.deepStrictEqual(editor.acts, ['pickFolder'], 'the dialog was not asked for, or more followed a cancel');
      assert.deepStrictEqual(editor.opened, [], 'a cancelled dialog opened a folder');
      assert.deepStrictEqual(editor.errors, [], 'a cancelled dialog reported a refusal');
    });
  }

  it('catches a refusal and tells it as an error naming the folder, rather than letting it escape', async () => {
    const picked = { fsPath: THIRD };
    const editor = new FakeOpener([picked], false);
    // 🔴 THE SEQUENCE RESOLVES. A rejection that left it would reach the panel's
    // press guard, which discards it, and the reader would be told nothing.
    assert.strictEqual(await pickAndOpenFolder(editor), 'failed');
    assert.deepStrictEqual(editor.opened, [picked], 'the open was not attempted exactly once');
    assert.deepStrictEqual(
      editor.errors,
      [`Aggrega: the editor could not open ${THIRD}.`],
      'the refusal is not told once, as an error naming the folder\'s full path',
    );
    assert.deepStrictEqual(editor.acts, ['pickFolder', 'openFolder', 'showError']);
  });
});

// The half that needs the editor — which of its calls each act is — is read off
// the source, because the module holding it imports the editor and the editor
// does not start here.
// codeOf drops the lines of a scanned body that are wholly a comment, so a reading
// of where a call sits is about the code and not about the prose beside it.
function codeOf(body: string): string {
  return body.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
}

describe('the two last entries are wired to the editor and to nothing else', () => {
  const EXTENSION = 'src/extension.ts';
  const OPEN_BRANCH = 'if (choice.offer.kind === \'reopen\')';
  const ADD_BRANCH = 'if (choice.offer.kind === \'add\')';
  const WIDEN_BRANCH = 'if (choice.offer.kind === \'widen\')';
  const NAMED_COMMAND = /\b[A-Z][A-Z_]*_COMMAND\b/;

  it('hands the open sequence the editor\'s acts, and names no command in the branch', () => {
    const branch = functionBody(EXTENSION, OPEN_BRANCH);
    // 🔴 THE NEEDLE ON THE BLOCK, first, for the reason the add's reading below
    // states.
    assert.ok(branch.includes('await pickAndOpenFolder('), `the branch runs no sequence at all:\n${branch}`);
    assert.ok(branch.trim().endsWith('return;'), `the scanned branch does not end where it does:\n${branch}`);

    // 🔴 THE CONTROL ON THE ABSENCES BELOW is the Aggrega workspace chooser's own
    // last entry, which does run a command by name.
    const widen = functionBody(EXTENSION, WIDEN_BRANCH);
    assert.ok(widen.includes('executeCommand('), 'the reading cannot see a command run where one is');
    assert.ok(NAMED_COMMAND.test(widen), 'the reading cannot see a command named where one is');

    // The named-folder command is run by name, because no typed call opens a
    // folder — but at the one site in the window-folders module, never written
    // into the branch, so the branch cannot come to name a second command.
    assert.ok(
      !branch.includes('executeCommand('),
      `the open entry runs a command in the branch rather than at the one site that opens a folder:\n${branch}`,
    );
    assert.ok(
      !NAMED_COMMAND.test(branch),
      `the open entry names a command in the branch rather than at the one site that opens a folder:\n${branch}`,
    );

    const calls = callSites('pickAndOpenFolder');
    assert.deepStrictEqual(calls.map((site) => site.module), ['extension.ts'], 'the sequence is run from elsewhere too');
    const [acts] = calls[0].args;
    for (const act of [
      'pickFolder: () => vscode.window.showOpenDialog(OPEN_FOLDER_DIALOG)',
      'openFolder: (folder) => openFolderInWindow(folder)',
      'showError: (message) => void vscode.window.showErrorMessage(message)',
    ]) {
      assert.ok(acts.includes(act), `the sequence is not handed ${act}; it was handed:\n${acts}`);
    }
    assert.deepStrictEqual(
      callSites('openFolderInWindow').map((site) => [site.module, site.args]),
      [['extension.ts', ['folder']]],
      'a folder is opened in the window by some route other than the open entry',
    );
  });

  it('hands the add sequence the editor\'s acts, and runs no command by name', () => {
    const branch = functionBody(EXTENSION, ADD_BRANCH);
    // 🔴 THE NEEDLE ON THE BLOCK, first: a scan running past the branch would
    // swallow the rest of the handler and pass whatever was written; one
    // stopping short would fail every reading.
    assert.ok(branch.includes('await pickAndAddFolder('), `the branch runs no sequence at all:\n${branch}`);
    assert.ok(branch.trim().endsWith('return;'), `the scanned branch does not end where it does:\n${branch}`);

    // 🔴 THE CONTROL ON THE ABSENCES BELOW: the Aggrega workspace chooser's own
    // last entry DOES run a command by name, so both readings are shown able to
    // find one where one is written.
    const widen = functionBody(EXTENSION, WIDEN_BRANCH);
    assert.ok(widen.includes('executeCommand('), 'the reading cannot see a command run where one is');
    assert.ok(NAMED_COMMAND.test(widen), 'the reading cannot see a command named where one is');

    assert.ok(
      !branch.includes('executeCommand('),
      `the add entry runs a command by name, which nothing checks until a reader presses:\n${branch}`,
    );
    assert.ok(
      !NAMED_COMMAND.test(branch),
      `the add entry names a command, which nothing checks until a reader presses:\n${branch}`,
    );

    const calls = callSites('pickAndAddFolder');
    assert.deepStrictEqual(calls.map((site) => site.module), ['extension.ts'], 'the sequence is run from elsewhere too');
    const [acts, adding] = calls[0].args;
    for (const act of [
      'pickFolder: () => vscode.window.showOpenDialog(ADD_FOLDER_DIALOG)',
      'openFolders: () => vscode.workspace.workspaceFolders ?? []',
      'addFolder: (folder) => appendFolderToWindow(folder)',
      'showInformation: (message) => void vscode.window.showInformationMessage(message)',
      'showError: (message) => void vscode.window.showErrorMessage(message)',
    ]) {
      assert.ok(acts.includes(act), `the sequence is not handed ${act}; it was handed:\n${acts}`);
    }
    // 🔴 THE SAME READING OF THE WINDOW THE ENTRY'S SECOND LINE WAS DRAWN FROM,
    // so where the answer goes is where the line said the add would take the
    // window.
    assert.strictEqual(
      adding, '{ ...answerStores(context), windowKind }',
      'the add is not handed the window\'s two memories and the kind of window read as the choice was drawn',
    );
  });

  it('reads what adding would do at one site, and reads it before the choice is drawn', () => {
    assert.deepStrictEqual(
      tokenModules('vscode.env.remoteName'), [['extension.ts', 1]],
      'whether the window is remote is read somewhere other than once',
    );
    assert.deepStrictEqual(
      tokenModules('vscode.workspace.workspaceFile'), [['extension.ts', 1]],
      'whether the window is on a workspace file is read somewhere other than once',
    );
    // The one site is the reader both routes call.
    const reader = functionBody(EXTENSION, 'function readWindowKind(');
    for (const fact of ['vscode.env.remoteName', 'vscode.workspace.workspaceFile']) {
      assert.ok(reader.includes(fact), `${fact} is not read in the one reader of the window's kind:\n${reader}`);
    }
    // 🔴 BY NAME, BOTH CALLERS: the Project folder command, as its choice is drawn,
    // and the welcome page's step, as it adds.
    assert.deepStrictEqual(
      callSites('readWindowKind').map((site) => [site.module, site.args]),
      [['extension.ts', []], ['extension.ts', []]],
      'the window\'s kind is read by some route other than the two that add a folder',
    );
    const handler = functionBody(EXTENSION, 'function registerChooseProjectFolderCommand(');
    assert.ok(
      handler.includes('registerCommand(CHOOSE_PROJECT_FOLDER_COMMAND'),
      `the scanned body is not the Project folder command's:\n${handler}`,
    );
    const drawn = handler.indexOf('showQuickPick(');
    assert.ok(drawn > 0, `the handler draws no choice:\n${handler}`);
    const read = handler.indexOf('readWindowKind()');
    assert.ok(read >= 0 && read < drawn, 'the window\'s kind is not read inside the Project folder command before the choice is drawn');
    const activation = functionBody(EXTENSION, 'export async function activate(');
    assert.ok(
      /addingWindow: \(\) => \(\{ \.\.\.answerStores\(context\), windowKind: readWindowKind\(\) \}\)/.test(activation),
      'the welcome page\'s step is not handed the window\'s kind read as it adds',
    );
  });

  it('adds a folder through one call and one sequence, and tells a refusal in one sentence', () => {
    assert.deepStrictEqual(
      callSites('appendFolderToWindow').map((site) => [site.module, site.args]),
      [
        ['extension.ts', ['folder']],
        ['get-started.ts', ['folder']],
      ],
      'a folder is added by some route other than the two that add one',
    );
    // 🔴 BOTH ROUTES RECORD THROUGH THE ONE SEQUENCE, so neither can come to
    // write its answer somewhere the other does not.
    assert.deepStrictEqual(
      callSites('addFolderWithAnswer').map((site) => site.module),
      ['get-started.ts', 'project-folder.ts'],
      'a folder the reader named is added by some route other than the one sequence',
    );
    assert.deepStrictEqual(
      callSites('folderDeclinedMessage').map((site) => [site.module, site.args]),
      [['project-folder.ts', ['folder.fsPath']]],
      'a refusal to add a folder is told by some route other than the one sentence',
    );
    assert.deepStrictEqual(
      tokenModules('declined to add'), [['project-folder.ts', 1]],
      'the refusal\'s sentence is written a second time, and the two can come to say different things',
    );
  });

  it('adds the welcome page\'s folder through that sequence, and records in place only where it is open already', () => {
    const GET_STARTED = 'src/get-started.ts';
    const body = codeOf(functionBody(GET_STARTED, 'async function chooseWorkspace('));
    const openBranch = functionBody(GET_STARTED, 'if (opened.has(choice.directory))');
    // 🔴 THE NEEDLE ON THE BRANCH: it is the one that records into this window's
    // memory and re-attaches, so a reading that has stopped finding it proves
    // nothing about the add below it.
    assert.ok(openBranch.includes('await deps.rememberAnchorChoice(choice.anchorPath);'), `the open branch records nothing:\n${openBranch}`);
    assert.ok(openBranch.includes('await deps.reanchor();'), `the open branch does not re-attach:\n${openBranch}`);
    assert.strictEqual(
      body.split('rememberAnchorChoice(').length - 1, 1,
      `the step writes the window's memory outside the branch where the folder is already open:\n${body}`,
    );
    const [call] = callSites('addFolderWithAnswer').filter((site) => site.module === 'get-started.ts');
    const [acts, ...rest] = call.args;
    assert.deepStrictEqual(
      rest,
      [
        'deps.addingWindow()',
        'vscode.workspace.workspaceFolders ?? []',
        'vscode.Uri.file(choice.directory)',
        '{ level: \'workspace\', path: choice.anchorPath }',
      ],
      'the step does not add the folder chosen, with the workspace chosen as its answer, in the window as it is',
    );
    for (const act of [
      'addFolder: (folder) => appendFolderToWindow(folder)',
      'showError: (message) => void vscode.window.showErrorMessage(message)',
    ]) {
      assert.ok(acts.includes(act), `the step's add is not handed ${act}; it was handed:\n${acts}`);
    }
    assert.ok(body.indexOf('opened.has(choice.directory)') < body.indexOf('addFolderWithAnswer('));
  });

  it('takes a carried answer in first, before anything that can evaluate the open folders', () => {
    // Comment lines are dropped, so a word in the prose explaining the order is
    // not read as the code it explains.
    const body = codeOf(functionBody(EXTENSION, 'export async function activate('));
    const adopt = body.indexOf('await adoptCarriedAnswer(');
    assert.ok(adopt >= 0, `activation takes no carried answer in:\n${body}`);
    // 🔴 THE NEEDLE: the last act of activation IS the first evaluation, so the
    // readings below are measured against the thing they are about.
    assert.ok(
      body.trim().endsWith('await reactivate(context);'),
      'activation does not end by evaluating the open folders, so the order below is about nothing',
    );
    for (const later of ['reactivate(', 'onDidChangeWorkspaceFolders', 'register', 'activateOperations(', 'activateGetStarted(']) {
      const at = body.indexOf(later);
      assert.ok(at > adopt, `${later} appears before the carried answer is taken in, so it can evaluate without it`);
    }
    assert.deepStrictEqual(
      callSites('adoptCarriedAnswer').map((site) => [site.module, site.args]),
      [['extension.ts', ['answerStores(context)', 'vscode.workspace.workspaceFolders ?? []']]],
      'a carried answer is taken in by some route other than the one activation takes, or against other folders',
    );
  });

  it('keeps the carried answer under one key, in one module, reached through one naming of the stores', () => {
    assert.deepStrictEqual(
      tokenModules('CARRIED_ANSWER_STATE_KEY'), [['project-folder.ts', 4]],
      'the carried answer\'s key is named outside its declaration, its read, its write and its deletion',
    );
    // Counted as a token rather than as call sites: two of the three are spread
    // into an object, and the call census deliberately reads nothing preceded by
    // a dot.
    assert.deepStrictEqual(
      tokenModules('answerStores(context)'), [['extension.ts', 3]],
      'the two memories are named for an answer somewhere other than activation and the two routes that add',
    );
    // The global store is reached by the configuration panel for its own
    // presentation and, for answers, only where the two memories are named.
    assert.deepStrictEqual(
      tokenModules('globalState'), [['config-view.ts', 2], ['extension.ts', 1]],
      'the editor\'s global store is reached from somewhere new',
    );
    assert.ok(functionBody(EXTENSION, 'function answerStores(').includes('global: context.globalState'));
  });
});
