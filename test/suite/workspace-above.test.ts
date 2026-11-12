// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WorkspaceStateLike } from '../../src/anchor-picker';
import {
  FoldersTold,
  WORKSPACE_ABOVE_HEADLINE,
  WORKSPACE_ABOVE_SILENCED_STATE_KEY,
  WorkspaceAboveEditor,
  WorkspaceAboveNotice,
  readFoldersSilenced,
  silenceFolder,
  tellWorkspaceAboveIfDue,
  workspaceAboveNotice,
  workspaceAboveNoticeDue,
  workspacePathsAccount,
} from '../../src/workspace-above';
import { SELECTOR_ROW_LABELS } from '../../src/selector-levels';
import { compareWorkspaceWithFolder } from '../../src/workspace';
import { selectorRows, workspaceRow } from '../../src/selector-rows';
import { operationsBodyHtml } from '../../src/operations-render';
import { commandsPanelOperations, OperationId } from '../../src/operation-groups';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import { callSites, tokenModules } from '../helpers/open-folder-census';
import { EXTENSION_ROOT } from '../helpers/launch-census';

// 🔴 THE FIXTURE PUTS THE WORKSPACE THREE DIRECTORIES ABOVE THE FOLDER, and that
// is not a detail of the arrangement. The walk that finds an Aggrega workspace
// climbs to the nearest marked ancestor, which may be any distance up, so a
// fixture one level deep would let a sentence counting the levels pass while
// being false for every reader deeper than one — in precisely the deep tree
// where the account matters most. Everything read below is read against this.
const ROOT = path.join(path.sep, 'work', 'repo');
const DEEP = path.join(ROOT, 'services', 'api', 'docs');
const SIBLING = path.join(ROOT, 'tools');
const CANDIDATES = { projectFolders: 2, aggregaWorkspaces: 1, releases: null };

// The other places a workspace can sit against a folder opened at ROOT: a
// directory beside it, and one beside it whose name merely extends the folder's
// — the case a comparison of the two paths as text would read as beneath it.
const BESIDE = path.join(path.sep, 'work', 'other');
const NAME_EXTENDED = `${ROOT}-tools`;
// A workspace beneath ROOT spelled with a step that climbs out and back in, so
// what is judged is where the path lands rather than how it is written.
const CLIMBING_BACK_IN = `${ROOT}${path.sep}services${path.sep}..${path.sep}tools`;

// The operator's text, written out rather than composed from the constants the
// source reads. A composed expectation moves with whatever it is checking and
// cannot fail, and this text was settled word by word.
const HEADLINE = 'Aggrega is using a workspace from outside the folder you opened.';
// The warning sign the row's hover opens the headline with, as its two code
// points: the sign, and the invisible selector asking for it as a pictograph.
const WARNING_SIGN = '\u26A0\uFE0F';
const WORKSPACE_LINE = `Aggrega workspace: ${ROOT}`;
const PROJECT_LINE = `Project folder: ${DEEP}`;
const OPEN_LABEL = 'Open workspace (reloads the window)';
const CONTINUE_LABEL = 'Continue here';
const SILENCE_LABEL = 'Don\'t show again for this folder';

// Map-backed, mirroring the editor's own contract that an undefined value
// deletes. It stands for the editor's store for a window's folder, which
// outlives every window opened on it — so one instance handed to several
// windows in turn is exactly the arrangement a relaunch produces. It is a double
// of the editor rather than a mechanism of this extension, and the suites that
// need one each keep their own.
class Memory implements WorkspaceStateLike {
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

  keys(): string[] {
    return [...this.store.keys()];
  }
}

// answering stands for the editor with a reader in front of it who presses the
// action carrying `title` — or, given null, closes the dialogue without
// pressing anything, which is what the editor's own dismissal hands back.
//
// The press is found by its LABEL, the way a reader finds it, so these cases
// drive the text the reader reads through to what the press does.
function answering(title: string | null): {
  editor: WorkspaceAboveEditor;
  raised: WorkspaceAboveNotice[];
  opened: () => number;
} {
  const raised: WorkspaceAboveNotice[] = [];
  let opened = 0;
  const editor: WorkspaceAboveEditor = {
    raise: async (notice) => {
      raised.push(notice);
      if (title === null) { return undefined; }
      const pressed = notice.actions.find((action) => action.title === title);
      assert.ok(pressed, `the dialogue offers no action labelled "${title}"`);
      return pressed;
    },
    openWorkspace: async () => { opened += 1; },
  };
  return { editor, raised, opened: () => opened };
}

// The handler's own header, written once, so a reading scoped to it is scoped by
// the real declaration rather than by a guess — and fails loudly if it moves.
const HANDLER =
  'async function tellWorkspaceSitsAbove(context: vscode.ExtensionContext): Promise<void>';

// everythingSaid is the headline and both of the account's lines, which is every
// sentence either surface is given — so a sweep over it reads all of them.
function everythingSaid(anchoredRoot: string, openedFolder: string): string {
  const account = workspacePathsAccount(anchoredRoot, openedFolder);
  const lines = account === null ? [] : [account.workspace, account.project];
  return [WORKSPACE_ABOVE_HEADLINE, ...lines].join('\n');
}

// 🔴 EACH PLACEMENT IS READ BY EQUALITY OVER BOTH ANSWERS AT ONCE. The two
// answers are what the surfaces turn on, and a reading of one of them alone
// would pass a comparison that had quietly started answering the other question
// — which is exactly how a workspace inside the folder came to be called
// outside it.
describe('the condition has one home and every surface reads it from there', () => {
  it('reads the folder itself as neither different nor outside', () => {
    assert.deepStrictEqual(compareWorkspaceWithFolder(ROOT, ROOT), { differs: false, outside: false });
    // And it compares where the paths land rather than the strings, so a folder
    // spelled with a step that goes nowhere is the same folder.
    const spelledLonger = `${ROOT}${path.sep}.`;
    assert.notStrictEqual(spelledLonger, ROOT, 'the two spellings are the same text');
    assert.deepStrictEqual(compareWorkspaceWithFolder(ROOT, spelledLonger), { differs: false, outside: false });
  });

  it('reads a workspace beneath the folder as different and not outside it', () => {
    assert.deepStrictEqual(compareWorkspaceWithFolder(DEEP, ROOT), { differs: true, outside: false });
    // Judged on where the path lands: a step out and back in is still beneath.
    assert.deepStrictEqual(
      compareWorkspaceWithFolder(CLIMBING_BACK_IN, ROOT), { differs: true, outside: false },
    );
  });

  it('reads a workspace above the folder as different and outside it', () => {
    assert.deepStrictEqual(compareWorkspaceWithFolder(ROOT, DEEP), { differs: true, outside: true });
  });

  it('reads a workspace beside the folder as different and outside it', () => {
    assert.deepStrictEqual(compareWorkspaceWithFolder(BESIDE, ROOT), { differs: true, outside: true });
  });

  it('reads a workspace whose name merely extends the folder\'s as beside it, not beneath it', () => {
    // 🔴 THE CASE A TEXT PREFIX GETS WRONG. The workspace's path starts with the
    // folder's, and it is still not inside it.
    assert.ok(NAME_EXTENDED.startsWith(ROOT), 'the fixture no longer extends the folder\'s name');
    assert.deepStrictEqual(compareWorkspaceWithFolder(NAME_EXTENDED, ROOT), { differs: true, outside: true });
  });

  it('answers neither where either path is absent', () => {
    // Both absences, which are the same answer for different reasons: with no
    // workspace in force there is nothing to place, and with no folder reached
    // there is nothing to place a workspace against.
    assert.deepStrictEqual(compareWorkspaceWithFolder(null, DEEP), { differs: false, outside: false });
    assert.deepStrictEqual(compareWorkspaceWithFolder(ROOT, null), { differs: false, outside: false });
    assert.deepStrictEqual(compareWorkspaceWithFolder(null, null), { differs: false, outside: false });
  });

  it('is read from that one function by every surface that turns on it', () => {
    // 🔴 AN EQUALITY OVER THE WHOLE SOURCE TREE RATHER THAN A PRESENCE. What
    // this refuses is a second comparison of the same two paths written beside
    // one of the surfaces: it would agree with this one on the day it was
    // written and would be the thing that drifted the first time either side
    // learned about a symbolic link or a filesystem that ignores case. The
    // symptom would be the row marking a state nobody was told about, or a
    // reader interrupted about a row that says nothing is wrong.
    //
    // An equality is its own control: a reading whose extraction stopped working
    // returns an empty list, and an empty list is not the recorded shape.
    //
    // The row reads it once for both answers; the account, the interruption and
    // the decision to raise it read it once each.
    assert.deepStrictEqual(
      callSites('compareWorkspaceWithFolder').map((site) => [site.module, site.args]),
      [
        ['selector-rows.ts', ['anchoredRoot', 'openedFolder']],
        ['workspace-above.ts', ['anchoredRoot', 'openedFolder']],
        ['workspace-above.ts', ['anchoredRoot', 'openedFolder']],
        ['workspace-above.ts', ['anchoredRoot', 'openedFolder']],
      ],
      'a surface that turns on where the workspace sits against the folder reads something other '
      + 'than the one comparison of those two paths',
    );
  });
});

describe('what the reader is told', () => {
  it('is the two paths, each on a line of its own behind its label', () => {
    assert.deepStrictEqual(
      workspacePathsAccount(ROOT, DEEP),
      { workspace: WORKSPACE_LINE, project: PROJECT_LINE },
    );
  });

  it('is the two paths for a workspace beneath the folder too, where both are still true', () => {
    // The row's hover names the folder wherever the two differ; whether the
    // headline goes above it is asked separately, of whether the workspace sits
    // outside the folder.
    assert.deepStrictEqual(
      workspacePathsAccount(DEEP, ROOT),
      { workspace: `Aggrega workspace: ${DEEP}`, project: `Project folder: ${ROOT}` },
    );
  });

  it('says nothing at all where the workspace is the folder, or either is absent', () => {
    assert.strictEqual(workspacePathsAccount(ROOT, ROOT), null);
    assert.strictEqual(workspacePathsAccount(null, DEEP), null);
    assert.strictEqual(workspacePathsAccount(ROOT, null), null);
  });

  it('carries nothing beyond the headline and the two paths', () => {
    // The account is the paths because the paths are what a reader acts on.
    // Each phrase below would begin a sentence the account does not carry; the
    // sweep reads the headline and both lines together, which is everything
    // either surface is given.
    const said = everythingSaid(ROOT, DEEP);
    for (const absent of ['You opened', 'Settings and catalog', 'Builds', 'Releases', 'catalog']) {
      assert.ok(!said.includes(absent), `the account carries "${absent}":\n${said}`);
    }
    // 🔴 THE CONTROL ON THAT SWEEP. One label certainly IS present, so a sweep
    // that had stopped reading the text would fail here rather than report
    // clean absences.
    assert.ok(said.includes('Aggrega workspace: '), 'the sweep sees none of the text it is reading');
  });

  it('states no distance, in a tree three directories deep', () => {
    // 🔴 THE READING THAT WOULD HAVE PASSED ON A ONE-LEVEL FIXTURE. The account
    // is composed against a folder three directories below its workspace, and
    // what is asserted is that nothing in it counts anything: a reader acts on
    // the PATH, and a number is one more fact to keep true as the walk changes.
    assert.strictEqual(
      path.relative(ROOT, DEEP).split(path.sep).length, 3,
      'the fixture no longer puts the workspace three directories above the folder, so a sentence '
      + 'counting levels could pass here while being false for a deeper reader',
    );
    const said = everythingSaid(ROOT, DEEP);
    for (const counting of [
      'one level', 'two levels', 'three levels', 'levels above', 'directories above',
      'one directory', 'directly above', 'immediately above', 'parent of',
    ]) {
      assert.ok(
        !said.toLowerCase().includes(counting),
        `the account names a distance (${counting}), which is false for any reader at another `
        + `depth:\n${said}`,
      );
    }
    // 🔴 THE CONTROL ON THAT SWEEP, and without it the absences above are a
    // claim about the probe.
    assert.ok(
      said.toLowerCase().includes('outside the folder you opened'),
      'the sweep sees none of the text it is reading, so its absences mean nothing',
    );
  });

  it('names both levels from the one place the levels are named', () => {
    // The account and the rows must not come to call one level two different
    // things. This is the reading that fails if either moves.
    const account = workspacePathsAccount(ROOT, DEEP);
    const workspace = account?.workspace ?? '';
    const project = account?.project ?? '';
    assert.ok(workspace.startsWith(`${SELECTOR_ROW_LABELS.workspace}: `), workspace);
    assert.ok(project.startsWith(`${SELECTOR_ROW_LABELS.project}: `), project);
  });
});

describe('the interruption, and what it offers', () => {
  it('is the operator\'s text, verbatim, as the dialogue receives it', () => {
    const notice = workspaceAboveNotice(ROOT, DEEP);
    assert.ok(notice !== null, 'the interruption is not composed at all');
    // The headline is the message, which the dialogue draws heavier than what
    // lies beneath it, and the two lines are the detail — so the dialogue shows
    // the headline, a gap, and then the two lines.
    assert.strictEqual(notice.message, HEADLINE);
    assert.strictEqual(notice.detail, `${WORKSPACE_LINE}\n${PROJECT_LINE}`);
    assert.strictEqual(
      notice.message, WORKSPACE_ABOVE_HEADLINE,
      'the dialogue opens with something other than the line the mark is named by',
    );
  });

  it('carries the account as plain text, with no markup and no pictograph', () => {
    // 🔴 THE DIALOGUE RENDERS PLAIN TEXT AND THE EDITOR DRAWS ITS OWN WARNING
    // PICTOGRAPH. An emphasis marker would reach the reader as the two
    // characters it is written with and read as a rendering fault; a pictograph
    // written here would stand beside the editor's.
    const notice = workspaceAboveNotice(ROOT, DEEP);
    assert.ok(notice !== null);
    const everything = [notice.message, notice.detail, ...notice.actions.map((a) => a.title)];
    for (const text of everything) {
      assert.ok(!text.includes('**'), `an emphasis marker reaches the reader verbatim: ${text}`);
      assert.ok(!/[⚠️]/.test(text), `a pictograph reaches the dialogue: ${text}`);
    }
    // 🔴 THE CONTROL ON BOTH SWEEPS. They are absence readings over a probe, so
    // without a case that certainly trips them a broken probe reports the text
    // clean whatever it holds.
    assert.ok('**bold**'.includes('**'), 'the emphasis probe matches nothing, so its zeros mean nothing');
    assert.ok(/[⚠️]/.test('⚠️'), 'the pictograph probe matches nothing');
  });

  it('offers three actions: open with its cost, continue, and stop asking', () => {
    const notice = workspaceAboveNotice(ROOT, DEEP);
    assert.ok(notice !== null);
    assert.deepStrictEqual(
      notice.actions.map((a) => [a.title, a.choice, a.isCloseAffordance ?? false]),
      [
        [OPEN_LABEL, 'open', false],
        [CONTINUE_LABEL, 'continue', true],
        [SILENCE_LABEL, 'silence', false],
      ],
      'the dialogue offers something other than the three actions, or one of them no longer says '
      + 'what pressing it costs',
    );
  });

  it('puts no path in any action, so the buttons stay as narrow as their words', () => {
    // The dialogue lays its buttons out itself; their width is the one thing an
    // extension controls, and it is set by the labels. The workspace's path is
    // on the line directly above the buttons.
    const notice = workspaceAboveNotice(ROOT, DEEP);
    assert.ok(notice !== null);
    for (const action of notice.actions) {
      assert.ok(
        !action.title.includes(ROOT) && !action.title.includes(DEEP),
        `an action repeats a path the dialogue already shows: ${action.title}`,
      );
    }
    assert.ok(notice.detail.includes(ROOT), 'the control: the detail certainly carries the path');
  });

  it('puts the dismissing press on the action that changes nothing', () => {
    // 🔴 THE EDITOR ADDS A CANCEL OF ITS OWN TO A DIALOGUE THAT DECLARES NO
    // CLOSE AFFORDANCE, and a reader who took it would have taken an action this
    // side never named. Declaring it puts the keyboard dismissal, the close
    // control and the middle action on ONE action — so none of those paths can
    // silence a folder the reader never asked to silence.
    const notice = workspaceAboveNotice(ROOT, DEEP);
    const closing = (notice?.actions ?? []).filter((a) => a.isCloseAffordance === true);
    assert.strictEqual(closing.length, 1, 'the dialogue declares no single close affordance');
    assert.strictEqual(
      closing[0].choice, 'continue',
      'dismissing the dialogue does something other than leaving everything as it was',
    );
  });

  it('composes nothing where the workspace does not sit outside the folder', () => {
    assert.strictEqual(workspaceAboveNotice(ROOT, ROOT), null);
    assert.strictEqual(workspaceAboveNotice(null, DEEP), null);
  });

  it('composes nothing for a workspace beneath the folder, and the dialogue for one beside it', () => {
    // 🔴 THE HEADLINE WOULD BE FALSE FOR A WORKSPACE INSIDE THE FOLDER, and the
    // interruption opens with it. One beside the folder is outside it, and is
    // the control on the absence.
    assert.strictEqual(workspaceAboveNotice(DEEP, ROOT), null);
    assert.strictEqual(workspaceAboveNotice(CLIMBING_BACK_IN, ROOT), null);
    assert.strictEqual(workspaceAboveNotice(NAME_EXTENDED, ROOT)?.message, HEADLINE);
  });
});

// 🔴 ONCE PER FOLDER PER WINDOW, AND ONLY WHAT THE READER SAID OUTLIVES THE
// WINDOW. A window is a fresh record of what it has told the reader; the store
// is the editor's store for the folder, which every window opened on it shares.
// So "a new window" below is a new record beside the SAME store — which is what
// a reload or a relaunch hands the extension, and what the readings further
// down pin the handler to.
describe('the interruption lives no longer than the window', () => {
  it('raises again in a new window after "Continue here", and not after "Don\'t show again"', async () => {
    const store = new Memory();

    // The first window: raised with no press, answered "Continue here".
    const first = answering(CONTINUE_LABEL);
    const windowOne = new FoldersTold();
    assert.strictEqual(
      await tellWorkspaceAboveIfDue(store, windowOne, first.editor, ROOT, DEEP), 'continue',
    );
    assert.strictEqual(first.raised.length, 1, 'the dialogue is not raised in the first window');
    assert.deepStrictEqual(store.keys(), [], '"Continue here" wrote something that outlives the window');

    // The same window again — the editor re-evaluates the folders whenever they
    // change — does not raise it a second time.
    const again = answering(CONTINUE_LABEL);
    assert.strictEqual(await tellWorkspaceAboveIfDue(store, windowOne, again.editor, ROOT, DEEP), null);
    assert.strictEqual(again.raised.length, 0, 'one window raises the same account twice');

    // 🔴 A NEW WINDOW RAISES IT AGAIN. This is the reading a persisted "already
    // raised" record fails: it makes "Continue here" do what "Don't show again"
    // does, and the dialogue never returns though the reader never asked.
    const second = answering(SILENCE_LABEL);
    const windowTwo = new FoldersTold();
    assert.strictEqual(
      await tellWorkspaceAboveIfDue(store, windowTwo, second.editor, ROOT, DEEP), 'silence',
    );
    assert.strictEqual(
      second.raised.length, 1,
      'a new window on the folder is not told, though the reader only ever pressed "Continue here"',
    );
    assert.deepStrictEqual(store.get<unknown>(WORKSPACE_ABOVE_SILENCED_STATE_KEY), [DEEP]);

    // And after "Don't show again for this folder", a new window stays quiet.
    const third = answering(CONTINUE_LABEL);
    assert.strictEqual(
      await tellWorkspaceAboveIfDue(store, new FoldersTold(), third.editor, ROOT, DEEP), null,
    );
    assert.strictEqual(
      third.raised.length, 0,
      'a folder the reader asked not to be told about is told about again in a new window',
    );
  });

  it('reads the editor\'s own dismissal as "Continue here"', async () => {
    // A dialogue closed without pressing anything — the keyboard, or its close
    // control — hands back no action. It must mean the action that changes
    // nothing: it writes nothing, opens nothing, and a new window tells again.
    const store = new Memory();
    const dismissed = answering(null);
    assert.strictEqual(
      await tellWorkspaceAboveIfDue(store, new FoldersTold(), dismissed.editor, ROOT, DEEP),
      'continue',
    );
    assert.strictEqual(dismissed.opened(), 0, 'a dismissal opened the workspace');
    assert.deepStrictEqual(store.keys(), [], 'a dismissal silenced the folder');
    const next = answering(CONTINUE_LABEL);
    await tellWorkspaceAboveIfDue(store, new FoldersTold(), next.editor, ROOT, DEEP);
    assert.strictEqual(next.raised.length, 1, 'a dismissal kept a new window from telling the reader');
  });

  it('opens the workspace on "Open workspace", and records nothing that outlives the window', async () => {
    const store = new Memory();
    const opening = answering(OPEN_LABEL);
    assert.strictEqual(
      await tellWorkspaceAboveIfDue(store, new FoldersTold(), opening.editor, ROOT, DEEP), 'open',
    );
    assert.strictEqual(opening.opened(), 1, 'the press to open the workspace opened nothing');
    assert.deepStrictEqual(store.keys(), []);
  });

  it('opens nothing and silences nothing on the other two presses', async () => {
    for (const title of [CONTINUE_LABEL, SILENCE_LABEL]) {
      const pressed = answering(title);
      await tellWorkspaceAboveIfDue(new Memory(), new FoldersTold(), pressed.editor, ROOT, DEEP);
      assert.strictEqual(pressed.opened(), 0, `"${title}" opened the workspace`);
    }
  });

  it('records the folder as told BEFORE the dialogue goes up', async () => {
    // A dialogue stands until it is dismissed, and the editor re-evaluates the
    // open folders whenever they change — so a record written on the answer
    // would let a second dialogue be raised behind the first.
    const told = new FoldersTold();
    let toldWhenRaised: boolean | null = null;
    const editor: WorkspaceAboveEditor = {
      raise: async () => {
        toldWhenRaised = told.has(DEEP, ROOT);
        return undefined;
      },
      openWorkspace: async () => undefined,
    };
    await tellWorkspaceAboveIfDue(new Memory(), told, editor, ROOT, DEEP);
    assert.strictEqual(
      toldWhenRaised, true,
      'the folder is recorded after the dialogue is answered rather than before it is raised',
    );
  });

  it('is due again for the same folder when the workspace it resolves to has moved', () => {
    // The account is about a PAIR. A folder whose workspace has moved — a marker
    // written closer to it, or the one above it removed — is a different fact
    // from the one the reader was told.
    const store = new Memory();
    const told = new FoldersTold();
    told.record(DEEP, ROOT);
    assert.strictEqual(workspaceAboveNoticeDue(store, told, ROOT, DEEP), false);
    assert.strictEqual(
      workspaceAboveNoticeDue(store, told, path.join(ROOT, 'services'), DEEP), true,
      'a reader whose workspace has moved is never told about the one now in force',
    );
  });

  it('is never due where the workspace does not sit outside the folder', () => {
    const store = new Memory();
    const told = new FoldersTold();
    assert.strictEqual(workspaceAboveNoticeDue(store, told, ROOT, ROOT), false);
    assert.strictEqual(workspaceAboveNoticeDue(store, told, null, DEEP), false);
    assert.strictEqual(workspaceAboveNoticeDue(store, told, ROOT, null), false);
  });

  it('is never due for a workspace beneath the folder, and raises nothing for one', async () => {
    // Read beside a workspace beside the folder, which IS due: the control on
    // the absence, in the same store and record.
    const store = new Memory();
    const told = new FoldersTold();
    assert.strictEqual(workspaceAboveNoticeDue(store, told, DEEP, ROOT), false);
    const below = answering(CONTINUE_LABEL);
    assert.strictEqual(await tellWorkspaceAboveIfDue(store, told, below.editor, DEEP, ROOT), null);
    assert.strictEqual(below.raised.length, 0, 'a workspace inside the folder interrupted the reader');
    assert.strictEqual(workspaceAboveNoticeDue(store, told, BESIDE, ROOT), true);
  });
});

describe('the reader\'s answer is kept per folder', () => {
  it('silences one folder and leaves every other folder still warning', async () => {
    // 🔴 THE MULTI-FOLDER WINDOW, WHICH IS THE WHOLE REASON THE ENTRY IS KEYED
    // BY FOLDER. The editor's store is scoped to the window's folder or
    // workspace, so a design that recorded one answer for it would have a reader
    // who silenced one folder hear nothing about the next one they worked from.
    const store = new Memory();
    await silenceFolder(store, DEEP);
    assert.strictEqual(workspaceAboveNoticeDue(store, new FoldersTold(), ROOT, DEEP), false);
    assert.strictEqual(
      workspaceAboveNoticeDue(store, new FoldersTold(), ROOT, SIBLING), true,
      'silencing one folder silenced another, so a reader is left uninformed about a folder they '
      + 'never answered for',
    );
    // 🔴 THE KEY IS SHOWN RATHER THAN DESCRIBED: one entry, holding a list of
    // folders.
    assert.deepStrictEqual(store.keys(), ['aggrega.workspaceAboveSilenced']);
    assert.deepStrictEqual(store.get<unknown>(WORKSPACE_ABOVE_SILENCED_STATE_KEY), [DEEP]);
    assert.deepStrictEqual(readFoldersSilenced(store), [DEEP]);
  });

  it('outlives the window, and outlives the workspace moving', async () => {
    // What a reader SAID outlives every workspace that folder may come to
    // resolve to.
    const store = new Memory();
    await silenceFolder(store, DEEP);
    assert.strictEqual(
      workspaceAboveNoticeDue(store, new FoldersTold(), path.join(ROOT, 'services'), DEEP), false,
      'a reader who asked not to be told about a folder is told about it anyway once its '
      + 'workspace moves',
    );
  });

  it('records a folder once however often it is silenced', async () => {
    const store = new Memory();
    await silenceFolder(store, DEEP);
    await silenceFolder(store, DEEP);
    assert.deepStrictEqual(readFoldersSilenced(store), [DEEP]);
  });

  it('reads state it cannot understand as nothing recorded', () => {
    // A window carrying an entry written by an older version of this extension
    // is the ordinary way this happens, and the honest reading of one this
    // version cannot understand is that the reader has not asked.
    const store = new Memory();
    void store.update(WORKSPACE_ABOVE_SILENCED_STATE_KEY, { not: 'a list' });
    assert.deepStrictEqual(readFoldersSilenced(store), []);
    assert.strictEqual(workspaceAboveNoticeDue(store, new FoldersTold(), ROOT, DEEP), true);
  });
});

// The cases above drive the sequence against a record and a store handed in.
// What makes them the window's behaviour is WHICH record and WHICH store the
// handler hands in, and the handler imports the editor, so that half is read
// off the source. Each reading is an equality or names its own control.
describe('which record the window keeps, and which store the reader\'s answer goes to', () => {
  it('makes the told record handed nothing, so it cannot be handed a store', () => {
    assert.strictEqual(
      FoldersTold.length, 0,
      'the record of what the window has told takes an argument, which is how a store that '
      + 'outlives the window would reach it',
    );
  });

  it('keeps no record of what was told under any key of the editor\'s store', () => {
    // A persisted "already told" entry is the defect this whole arrangement
    // exists to refuse, so its key must not exist anywhere in the source.
    assert.deepStrictEqual(
      tokenModules('workspaceAboveTold'), [],
      'a key recording what the window told is written somewhere, so a folder can stay silent '
      + 'across windows though the reader never asked',
    );
    // 🔴 THE CONTROL: the one key that IS kept is certainly found.
    assert.deepStrictEqual(tokenModules('workspaceAboveSilenced'), [['workspace-above.ts', 1]]);
  });

  it('makes exactly one told record, at module scope, where the extension host holds it', () => {
    // 🔴 MODULE SCOPE IS THE LIFETIME. Made inside a function a folder change
    // reaches, the record would be emptied whenever the reader opened another
    // folder, and one window would raise the same account twice.
    assert.deepStrictEqual(
      tokenModules('new FoldersTold('), [['extension.ts', 1]],
      'the told record is made somewhere other than once, in the module holding the editor',
    );
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'extension.ts'), 'utf8');
    assert.deepStrictEqual(
      source.split('\n').filter((line) => line.includes('new FoldersTold(')),
      ['const foldersTold = new FoldersTold();'],
      'the told record is not a module-level constant, so its lifetime is shorter than the window',
    );
  });

  it('hands the window\'s store for the reader\'s answer and that one record for what was told', () => {
    const calls = callArguments('src/extension.ts', 'tellWorkspaceAboveIfDue');
    assert.strictEqual(calls.length, 1, `the interruption is raised from ${calls.length} sites`);
    const [silenced, told, , root, opened] = calls[0];
    assert.deepStrictEqual(
      [silenced, told, root, opened],
      ['context.workspaceState', 'foldersTold', 'anchoredWorkspaceRoot()', 'openedProjectFolder'],
      'the handler hands the interruption some other store, record or pair of paths',
    );
  });

  it('keeps the editor calls in the handler and composes the folder through the one decision', () => {
    const body = functionBody('src/extension.ts', HANDLER);
    // 🔴 THE NEEDLE ON THE BLOCK, first, because everything below is a claim
    // about this text. A scan running past the function would swallow the rest
    // of the module and pass whatever was written; one stopping short would fail
    // every reading.
    assert.ok(
      body.trimStart().startsWith('await tellWorkspaceAboveIfDue('),
      `the scanned body does not begin where the handler does; it was:\n${body}`,
    );
    assert.ok(
      body.replace(/\s+/g, ' ').trim().endsWith('anchoredWorkspaceRoot(), openedProjectFolder, );'),
      `the scanned body does not end where the handler does; it was:\n${body}`,
    );
    assert.ok(
      body.includes('{ modal: true, detail: notice.detail }'),
      'the dialogue is raised in some shape other than a modal carrying the detail',
    );
    assert.ok(
      body.includes('openWorkspaceRootInvocation('),
      'the handler derives a folder of its own rather than composing through the one decision, so '
      + 'a workspace that went away between the dialogue and the press has two answers',
    );
    assert.ok(body.includes('vscode.Uri.file('), 'the handler hands the editor no file location');
  });

  it('silences a folder on one press and at no other site', () => {
    // An equality over every call in the tree rather than a search for one: a
    // second call is exactly the change that would silence a folder for a reader
    // who pressed something else.
    assert.deepStrictEqual(
      callSites('silenceFolder').map((site) => [site.module, site.args]),
      [['workspace-above.ts', ['silenced', 'folder']]],
      'a folder is silenced somewhere other than the press that asks for it',
    );
  });

  it('acts on what a press MEANS rather than on the sentence it is labelled with', () => {
    // A label is text a reader reads and the operator may revise; a comparison
    // against one is a second spelling of it that nothing warns about when the
    // first moves.
    const sequence = functionBody(
      'src/workspace-above.ts', 'export async function tellWorkspaceAboveIfDue(',
    );
    assert.ok(sequence.includes('answer?.choice'), `the sequence matches on something else:\n${sequence}`);
    for (const body of [sequence, functionBody('src/extension.ts', HANDLER)]) {
      assert.ok(
        !body.includes(CONTINUE_LABEL) && !body.includes('Don\'t show again') && !body.includes('Open workspace'),
        `a press is compared against a sentence:\n${body}`,
      );
    }
  });
});

describe('dismissing the pop-up cannot dismiss the truth', () => {
  it('keeps the suppression out of every module that draws a row', () => {
    // 🔴 THIS IS THE READING THAT REFUSES THE ONE CHANGE THE TWO SURFACES EXIST
    // TO PREVENT. A mark that disappeared when the reader dismissed the
    // interruption would leave a window whose workspace is somewhere else saying
    // nothing at all — correct in every other respect and silent about the one
    // fact it was built to carry. Nothing in the editor refuses that: the row
    // takes what it is handed, so the only way to hold it is to keep what the
    // reader silenced, and what the window has told, out of reach of the modules
    // that compose a row.
    //
    // An equality over the whole source tree rather than a presence, so a third
    // module reading either record fails this whatever it is called. It is its
    // own control: an extraction that stopped working returns an empty list, and
    // an empty list is not the recorded shape.
    const drawing = (m: string): boolean => m === 'selector-rows.ts' || m === 'operations-render.ts';
    for (const reader of [
      'readFoldersSilenced', 'silenceFolder', 'workspaceAboveNoticeDue', 'tellWorkspaceAboveIfDue',
    ]) {
      const modules = [...new Set(callSites(reader).map((site) => site.module))].sort();
      assert.deepStrictEqual(
        modules.filter(drawing), [],
        `${reader} is read where a row is composed, so a reader who dismissed the interruption `
        + 'can be made to lose the mark that carries the same fact',
      );
      assert.notStrictEqual(
        modules.length, 0,
        `the census sees no module reading ${reader}, so its absences mean nothing`,
      );
    }
    const holding = tokenModules('FoldersTold').map(([file]) => file);
    assert.deepStrictEqual(holding.filter(drawing), [], 'a module drawing a row holds the told record');
    assert.notStrictEqual(holding.length, 0, 'the census sees no module holding the told record');
  });

  it('composes the mark from the condition alone, with no store to consult', () => {
    // The row is handed paths and a count and nothing else, which is what makes
    // the reading above structural rather than a habit: there is no suppression
    // in scope for it to read even if someone wanted it to.
    //
    // Read off the declared parameter list rather than off the function's
    // arity, because a trailing parameter given a default does not count
    // towards the arity — which is exactly the shape a quietly added fourth
    // parameter would take.
    const declared = /^function\s+workspaceRow\s*\(([^)]*)\)/.exec(workspaceRow.toString());
    assert.ok(declared, `the row's declaration is not where it is read from:\n${workspaceRow.toString()}`);
    assert.deepStrictEqual(
      declared[1].split(',').map((p) => p.trim()).filter((p) => p !== ''),
      ['anchoredRoot', 'openedFolder', 'candidates'],
      'the row that carries the mark takes a parameter it did not, which is how a suppression '
      + 'would reach it',
    );
  });
});

describe('the mark on the row', () => {
  it('stands while the condition holds and is absent when it does not', () => {
    assert.strictEqual(workspaceRow(ROOT, DEEP, 1).warning, WORKSPACE_ABOVE_HEADLINE);
    assert.strictEqual(workspaceRow(ROOT, ROOT, 1).warning, null);
    assert.strictEqual(workspaceRow(null, DEEP, 1).warning, null);
    assert.strictEqual(workspaceRow(null, null, 0).warning, null);
  });

  it('is absent for a workspace beneath the folder, whose row still offers to open it', () => {
    // 🔴 THE MARK IS NAMED BY A SENTENCE SAYING THE WORKSPACE IS FROM OUTSIDE
    // THE FOLDER, which a workspace inside it would make false. The offer is true
    // on either side of the folder and stays; the mark on a workspace beside the
    // folder is the control on the absence.
    const below = workspaceRow(DEEP, ROOT, 1);
    assert.deepStrictEqual(
      [below.warning, below.offer?.label ?? null],
      [null, 'Open the Aggrega workspace as the Project folder. The window reloads.'],
    );
    assert.strictEqual(workspaceRow(BESIDE, ROOT, 1).warning, HEADLINE);
  });

  it('is the only row that can carry one', () => {
    const rows = selectorRows(ROOT, DEEP, DEEP, { kind: 'unknown' }, CANDIDATES);
    assert.deepStrictEqual(
      rows.filter((row) => row.warning !== null).map((row) => row.key),
      ['workspace'],
      'a row other than the one naming the Aggrega workspace carries the mark',
    );
  });

  it('carries the interruption\'s headline and folder on its hover, and names the workspace once', () => {
    // 🔴 DISMISSING THE POP-UP MUST NOT DISMISS THE TRUTH. The mark is what
    // carries the fact once the interruption is gone, so the hover holds the
    // headline and the folder the interruption names, read from the same text.
    // The workspace's line is the one the hover already opens with — the two
    // surfaces name the workspace in the same words — so the hover carries it
    // once, first, and never adds it a second time.
    const row = workspaceRow(ROOT, DEEP, 1);
    const notice = workspaceAboveNotice(ROOT, DEEP);
    const account = workspacePathsAccount(ROOT, DEEP);
    assert.ok(notice !== null && account !== null);
    const hover = row.tooltip.split('\n');
    assert.ok(row.tooltip.includes(notice.message), row.tooltip);
    assert.ok(hover.includes(account.project), `the hover drops "${account.project}":\n${row.tooltip}`);
    assert.strictEqual(
      hover[0], account.workspace,
      `the hover opens with something other than the line the interruption names the workspace by:\n${row.tooltip}`,
    );
    assert.strictEqual(
      hover.filter((line) => line === account.workspace).length, 1,
      `the hover names the workspace a second time:\n${row.tooltip}`,
    );
    // 🔴 THE CONTROL ON THAT COUNT, and the reason the two surfaces are read
    // together: the interruption carries the workspace's line as well, so an
    // account that had stopped composing it would fail here rather than pass the
    // count above.
    assert.deepStrictEqual(notice.detail.split('\n'), [account.workspace, account.project]);
  });

  it('is the hover, as the row receives it, with and without the mark', () => {
    // Written out in full, so a line added, dropped or moved on either reading
    // fails here. Each part stands apart behind a blank line.
    assert.strictEqual(
      workspaceRow(ROOT, DEEP, 1).tooltip,
      `Aggrega workspace: ${ROOT}\n`
      + '\n'
      + `${WARNING_SIGN} ${HEADLINE}\n`
      + '\n'
      + `${PROJECT_LINE}\n`
      + '\n'
      + 'Click to choose which Aggrega workspace the editor works in.',
    );
    assert.strictEqual(
      workspaceRow(ROOT, ROOT, 1).tooltip,
      `Aggrega workspace: ${ROOT}\n`
      + '\n'
      + 'Click to choose which Aggrega workspace the editor works in.',
    );
    // A workspace beneath the folder: the folder is named, as it is wherever the
    // two differ, and nothing says the workspace is from outside it.
    assert.strictEqual(
      workspaceRow(DEEP, ROOT, 1).tooltip,
      `Aggrega workspace: ${DEEP}\n`
      + '\n'
      + `Project folder: ${ROOT}\n`
      + '\n'
      + 'Click to choose which Aggrega workspace the editor works in.',
    );
  });

  it('carries no markup, and the warning sign only where it leads the headline', () => {
    // The hover is an escaped title attribute in the panel's own document: plain
    // text, with no markdown and no styling at all. An emphasis marker reaches
    // the reader as the two characters it is written with; the sign travels as
    // the character itself.
    const row = workspaceRow(ROOT, DEEP, 1);
    assert.ok(!row.tooltip.includes('**'), `an emphasis marker reaches the hover: ${row.tooltip}`);
    assert.deepStrictEqual(
      row.tooltip.split('\n').filter((line) => /[⚠️]/.test(line)),
      [`${WARNING_SIGN} ${HEADLINE}`],
      `the sign is somewhere other than once, at the start of the headline, or not there at all:\n${row.tooltip}`,
    );
    // 🔴 AND NOT IN THE MARK'S NAME. The mark is itself drawn as the warning
    // glyph, and its name is what a reader meeting it by keyboard is told in the
    // glyph's place, so the name is the bare headline.
    assert.strictEqual(row.warning, HEADLINE);
    assert.ok(!/[⚠️]/.test(row.warning ?? ''), `a pictograph reaches the mark's name: ${row.warning}`);
    // Nor on the hover where the workspace is the folder: there is no headline
    // for it to lead.
    const quiet = workspaceRow(ROOT, ROOT, 1).tooltip;
    assert.ok(!/[⚠️]/.test(quiet), `the sign reaches a hover with nothing to warn about: ${quiet}`);
  });
});

describe('the mark is drawn as a mark and not as part of the value', () => {
  const unavailable: Partial<Record<OperationId, string | null>> = {};
  for (const op of commandsPanelOperations()) { unavailable[op.id] = null; }
  const document = (anchored: string, opened: string): string => operationsBodyHtml({
    layout: 'buttons',
    selectors: selectorRows(anchored, opened, opened, { kind: 'unknown' }, CANDIDATES),
    unavailable,
    collapsed: [],
    focused: null,
    dials: [],
  });

  it('draws the mark beside the value, leaving the value itself untouched', () => {
    const values = (html: string): string[] =>
      Array.from(html.matchAll(/<span class="selector-value">([^<]*)<\/span>/g)).map((m) => m[1]);
    // The two documents are the same window with the marker in a different
    // place, so the row that reports the workspace names one folder in both and
    // the rows around it legitimately do not — which is why the reading is
    // scoped to the row the mark lands on, found by its key rather than by a
    // position that another row appearing above it would move.
    const at = selectorRows(ROOT, DEEP, DEEP, { kind: 'unknown' }, CANDIDATES)
      .findIndex((row) => row.key === 'workspace');
    assert.notStrictEqual(at, -1, 'there is no workspace row to read');
    const marked = values(document(ROOT, DEEP));
    const plain = values(document(ROOT, ROOT));
    // 🔴 THE VALUE IS THE SAME TEXT EITHER WAY. A pictograph written into it
    // would be drawn where the value is drawn and read as the first character of
    // the folder's name, which is the one thing this clause refuses.
    assert.strictEqual(
      marked[at], plain[at],
      'the mark changed what the row reports as its value, so a reader looking for the folder '
      + 'name finds a pictograph in front of it',
    );
    assert.strictEqual(marked[at], path.basename(ROOT), 'the row stopped naming the workspace');
    for (const value of [...marked, ...plain]) {
      assert.ok(!/[⚠️]/.test(value), `a pictograph is drawn inside the value: ${value}`);
    }
  });

  it('draws it once, inside the choosing control, after the value', () => {
    const marked = document(ROOT, DEEP);
    const rowsOf = (html: string): string[] =>
      Array.from(html.matchAll(/<div class="selector-row">([\s\S]*?)<\/div>/g)).map((m) => m[1]);
    const chunks = rowsOf(marked);
    const carrying = chunks.filter((chunk) => chunk.includes('selector-warning'));
    assert.strictEqual(
      carrying.length, 1,
      'the mark is drawn on more than one row, or on none, so it no longer reports one row\'s own '
      + 'state',
    );
    const chunk = carrying[0];
    assert.ok(
      chunk.indexOf('selector-value') < chunk.indexOf('selector-warning'),
      `the mark is drawn ahead of the value, which moves the value as it comes and goes:\n${chunk}`,
    );
    assert.ok(
      chunk.indexOf('selector-warning') < chunk.indexOf('</button>'),
      `the mark is drawn outside the control it reports on:\n${chunk}`,
    );
    // It draws no word of its own, so what a reader meeting it by keyboard is
    // told is its name — which is the account's headline rather than a word for
    // the shape of the glyph.
    assert.ok(
      chunk.includes(`aria-label="${WORKSPACE_ABOVE_HEADLINE}"`),
      `the mark announces nothing to a reader who cannot see it:\n${chunk}`,
    );
  });

  it('is absent from every row when the workspace IS the folder', () => {
    // 🔴 THE CONTROL ON THE READING ABOVE. Without it, a document that had
    // stopped drawing the mark at all would pass the absence and fail nothing.
    assert.ok(document(ROOT, DEEP).includes('selector-warning'), 'the marked document draws none');
    assert.ok(
      !document(ROOT, ROOT).includes('selector-warning'),
      'a row is marked in a window whose workspace is the folder it has open',
    );
  });

  it('is absent from every row when the workspace is inside the folder', () => {
    // The same control as above: the document for a workspace above the folder
    // draws the mark, so an absence here is the row's and not the reading's.
    assert.ok(document(ROOT, DEEP).includes('selector-warning'), 'the marked document draws none');
    assert.ok(
      !document(DEEP, ROOT).includes('selector-warning'),
      'a row is marked in a window whose workspace is inside the folder it has open',
    );
  });
});
