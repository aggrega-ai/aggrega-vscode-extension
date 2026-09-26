// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  ADD_FOLDER_DIALOG,
  CHOOSE_PROJECT_FOLDER_COMMAND,
  FolderAddingEditor,
  PROJECT_FOLDER_STATE_KEY,
  WindowKind,
  buildProjectFolderItems,
  isSavedProjectFolderValid,
  openOtherFolderDetail,
  pickAndAddFolder,
  projectFolderInForce,
  projectFolderOffers,
  readSavedProjectFolder,
  rememberProjectFolderChoice,
} from '../../src/project-folder';
import { STATE_KEY } from '../../src/anchor-picker';
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

  it('offers every open folder and, last, the way to reach one that is not open', () => {
    const offers = projectFolderOffers(OPEN_FOLDERS, ON_WORKSPACE_FILE);
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
    const offers = projectFolderOffers([{ uri: { fsPath: FIRST } }], ON_WORKSPACE_FILE);
    assert.deepStrictEqual(offers.map((o) => o.kind), ['open', 'other']);
  });

  it('still offers the way out where the window has no folder at all', () => {
    const offers = projectFolderOffers([], ON_WORKSPACE_FILE);
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

// The last entry's second line, written out rather than composed from the
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

describe('what the last entry says taking it costs', () => {
  for (const [name, windowKind, expected] of COSTS) {
    it(`says exactly what it costs in a window ${name}`, () => {
      assert.strictEqual(openOtherFolderDetail(windowKind), expected);
    });
  }

  it('carries that line on the last entry, with its label unchanged, for none, one and two folders', () => {
    const windows: Array<[readonly FolderLike[], string]> = [
      [[], 'Open a folder…'],
      [[{ uri: { fsPath: FIRST } }], 'Open another folder…'],
      [OPEN_FOLDERS, 'Open another folder…'],
    ];
    for (const [folders, label] of windows) {
      for (const [name, windowKind, expected] of COSTS) {
        const last = projectFolderOffers(folders, windowKind).at(-1);
        assert.ok(last?.kind === 'other', `the last entry is not the way to add a folder (${name})`);
        assert.strictEqual(
          last.detail, expected,
          `with ${folders.length} open in a window ${name}, the last entry's second line is not the one `
          + 'its reader must be shown',
        );
        assert.strictEqual(last.label, label, 'what the entry costs moved its label');
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

describe('the last entry asks for a folder and adds it to the window', () => {
  it('asks the editor\'s dialog for one folder and for nothing but a folder', () => {
    assert.deepStrictEqual(
      { ...ADD_FOLDER_DIALOG },
      {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Add this folder',
        title: 'Aggrega: select a folder to add to this window',
      },
      'the dialog is asked for something other than exactly one folder, or under other words',
    );
  });

  it('adds the folder the reader picked, once, and tells them nothing', async () => {
    const picked = { fsPath: THIRD };
    const editor = new FakeEditor([picked], OPEN_FOLDERS);
    assert.strictEqual(await pickAndAddFolder(editor), 'added');
    assert.deepStrictEqual(editor.added, [picked], 'the add is not made exactly once, with the pick');
    // 🔴 THE VERY VALUE THE DIALOG ANSWERED WITH, not a location rebuilt from its
    // path: a rebuilt one keeps the path and loses where that path lives.
    assert.strictEqual(editor.added[0], picked, 'the folder is rebuilt rather than handed on');
    assert.deepStrictEqual(editor.informed, [], 'an add that succeeded is announced');
    assert.deepStrictEqual(editor.errors, [], 'an add that succeeded is reported as a refusal');
    // 🔴 AND IT DOES NOT CHOOSE: the sequence asks for no act beyond the three
    // an add needs, so nothing here records the folder as the one to work from.
    assert.deepStrictEqual(editor.acts, ['pickFolder', 'openFolders', 'addFolder']);
  });

  for (const [name, answer] of [['with no answer', undefined], ['with an empty answer', []]] as const) {
    it(`changes nothing and says nothing where the dialog is closed ${name}`, async () => {
      const editor = new FakeEditor(answer, OPEN_FOLDERS);
      assert.strictEqual(await pickAndAddFolder(editor), 'cancelled');
      // 🔴 THE CONTROL: the dialog WAS asked for, so the absences below are the
      // sequence stopping at a cancel rather than never having started.
      assert.deepStrictEqual(editor.acts, ['pickFolder'], 'the dialog was not asked for, or more followed a cancel');
      assert.deepStrictEqual(editor.added, [], 'a cancelled dialog added a folder');
      assert.deepStrictEqual(editor.informed, [], 'a cancelled dialog told the reader something');
      assert.deepStrictEqual(editor.errors, [], 'a cancelled dialog reported a refusal');
    });
  }

  it('adds nothing where the folder picked is already open, and says so once, by its full path', async () => {
    const editor = new FakeEditor([{ fsPath: SECOND }], OPEN_FOLDERS);
    assert.strictEqual(await pickAndAddFolder(editor), 'already-open');
    assert.deepStrictEqual(editor.added, [], 'a folder the window already has was handed to the editor');
    assert.deepStrictEqual(
      editor.informed,
      [`Aggrega: ${SECOND} is already open in this window.`],
      'the reader is not told, once and by the folder\'s full path, that it is already open',
    );
    assert.deepStrictEqual(editor.errors, [], 'a folder already open is reported as a refusal');

    // 🔴 THE CONTROL: the same pick in a window that does not have it open IS
    // added, so the reading above is about the folder being open rather than a
    // sequence that refuses everything.
    const elsewhere = new FakeEditor([{ fsPath: SECOND }], [{ uri: { fsPath: FIRST } }]);
    assert.strictEqual(await pickAndAddFolder(elsewhere), 'added');
    assert.deepStrictEqual(elsewhere.informed, []);
  });

  it('tells a refusal as an error naming the folder, and nothing else', async () => {
    const picked = { fsPath: THIRD };
    const editor = new FakeEditor([picked], OPEN_FOLDERS, false);
    assert.strictEqual(await pickAndAddFolder(editor), 'declined');
    assert.deepStrictEqual(editor.added, [picked], 'the add was not attempted exactly once');
    assert.deepStrictEqual(
      editor.errors,
      [`Aggrega: the editor declined to add ${THIRD} to this workspace.`],
      'the refusal is not told once, as an error naming the folder\'s full path',
    );
    assert.deepStrictEqual(editor.informed, [], 'a refusal is told as information as well');
  });
});

// The half that needs the editor — which of its calls each act is — is read off
// the source, because the module holding it imports the editor and the editor
// does not start here.
describe('the last entry is wired to the editor and to nothing else', () => {
  const EXTENSION = 'src/extension.ts';
  const ADD_BRANCH = 'if (choice.offer.kind === \'other\')';
  const WIDEN_BRANCH = 'if (choice.offer.kind === \'widen\')';
  const NAMED_COMMAND = /\b[A-Z][A-Z_]*_COMMAND\b/;

  it('hands the sequence the editor\'s acts, and runs no command by name', () => {
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
      `the last entry runs a command by name, which nothing checks until a reader presses:\n${branch}`,
    );
    assert.ok(
      !NAMED_COMMAND.test(branch),
      `the last entry names a command, which nothing checks until a reader presses:\n${branch}`,
    );

    const calls = callSites('pickAndAddFolder');
    assert.deepStrictEqual(calls.map((site) => site.module), ['extension.ts'], 'the sequence is run from elsewhere too');
    const [acts] = calls[0].args;
    for (const act of [
      'pickFolder: () => vscode.window.showOpenDialog(ADD_FOLDER_DIALOG)',
      'openFolders: () => vscode.workspace.workspaceFolders ?? []',
      'addFolder: (folder) => appendFolderToWindow(folder)',
      'showInformation: (message) => void vscode.window.showInformationMessage(message)',
      'showError: (message) => void vscode.window.showErrorMessage(message)',
    ]) {
      assert.ok(acts.includes(act), `the sequence is not handed ${act}; it was handed:\n${acts}`);
    }
  });

  it('reads what adding would cost at one site, before the choice is drawn', () => {
    assert.deepStrictEqual(
      tokenModules('vscode.env.remoteName'), [['extension.ts', 1]],
      'whether the window is remote is read somewhere other than once',
    );
    assert.deepStrictEqual(
      tokenModules('vscode.workspace.workspaceFile'), [['extension.ts', 1]],
      'whether the window is on a workspace file is read somewhere other than once',
    );
    const handler = functionBody(EXTENSION, 'function registerChooseProjectFolderCommand(');
    assert.ok(
      handler.includes('registerCommand(CHOOSE_PROJECT_FOLDER_COMMAND'),
      `the scanned body is not the Project folder command's:\n${handler}`,
    );
    const drawn = handler.indexOf('showQuickPick(');
    assert.ok(drawn > 0, `the handler draws no choice:\n${handler}`);
    for (const fact of ['vscode.env.remoteName', 'vscode.workspace.workspaceFile']) {
      const at = handler.indexOf(fact);
      assert.ok(
        at >= 0 && at < drawn,
        `${fact} is not read inside the Project folder command before the choice is drawn`,
      );
    }
  });

  it('adds a folder through one call, and tells a refusal in one sentence wherever a folder is added', () => {
    assert.deepStrictEqual(
      callSites('appendFolderToWindow').map((site) => [site.module, site.args]),
      [
        ['extension.ts', ['folder']],
        ['get-started.ts', ['vscode.Uri.file(choice.directory)']],
      ],
      'a folder is added by some route other than the two that add one',
    );
    assert.deepStrictEqual(
      callSites('folderDeclinedMessage').map((site) => [site.module, site.args]),
      [
        ['get-started.ts', ['choice.directory']],
        ['project-folder.ts', ['folderPath']],
      ],
      'a refusal to add a folder is told by some route other than the one sentence',
    );
    assert.deepStrictEqual(
      tokenModules('declined to add'), [['project-folder.ts', 1]],
      'the refusal\'s sentence is written a second time, and the two can come to say different things',
    );
  });
});
