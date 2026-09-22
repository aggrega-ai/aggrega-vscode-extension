// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import { WorkspaceStateLike } from '../../src/anchor-picker';
import {
  WORKSPACE_ABOVE_HEADLINE,
  WORKSPACE_ABOVE_SILENCED_STATE_KEY,
  WORKSPACE_ABOVE_TOLD_STATE_KEY,
  readFoldersSilenced,
  readFoldersTold,
  recordFolderTold,
  silenceFolder,
  workspaceAboveAccount,
  workspaceAboveNotice,
  workspaceAboveNoticeDue,
} from '../../src/workspace-above';
import { SELECTOR_ROW_LABELS } from '../../src/selector-levels';
import { workspaceSitsAboveFolder } from '../../src/workspace';
import { selectorRows, workspaceRow } from '../../src/selector-rows';
import { operationsBodyHtml } from '../../src/operations-render';
import { allOperations, OperationId } from '../../src/operation-groups';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import { callSites } from '../helpers/open-folder-census';

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

// Map-backed, mirroring the editor's own contract that an undefined value
// deletes. It is a double of the editor rather than a mechanism of this
// extension, and the suites that need one each keep their own — a shared double
// would make one suite's convenience another suite's constraint.
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
}

// The handler's own header, written once, so a reading scoped to it is scoped by
// the real declaration rather than by a guess — and fails loudly if it moves.
const HANDLER =
  'async function tellWorkspaceSitsAbove(context: vscode.ExtensionContext): Promise<void>';

describe('the condition has one home and every surface reads it from there', () => {
  it('answers true only where a workspace and a folder are both in hand and differ', () => {
    assert.strictEqual(workspaceSitsAboveFolder(ROOT, DEEP), true);
    assert.strictEqual(workspaceSitsAboveFolder(ROOT, ROOT), false);
    // Both absences, which are the same answer for different reasons: nothing
    // sits above anything with no workspace in force, and there is nothing for a
    // workspace to sit above with no folder reached.
    assert.strictEqual(workspaceSitsAboveFolder(null, DEEP), false);
    assert.strictEqual(workspaceSitsAboveFolder(ROOT, null), false);
    assert.strictEqual(workspaceSitsAboveFolder(null, null), false);
    // And it compares resolved paths rather than the strings, so a folder
    // spelled with a step that goes nowhere is the same folder.
    const spelledLonger = `${ROOT}${path.sep}.`;
    assert.notStrictEqual(spelledLonger, ROOT, 'the two spellings are the same text');
    assert.strictEqual(workspaceSitsAboveFolder(ROOT, spelledLonger), false);
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
    assert.deepStrictEqual(
      callSites('workspaceSitsAboveFolder').map((site) => [site.module, site.args]),
      [
        ['selector-rows.ts', ['anchoredRoot', 'openedFolder']],
        ['workspace-above.ts', ['anchoredRoot', 'openedFolder']],
        ['workspace-above.ts', ['anchoredRoot', 'openedFolder']],
      ],
      'a surface that turns on the workspace sitting above the folder reads something other than '
      + 'the one comparison of those two paths',
    );
  });
});

describe('what the reader is told', () => {
  // The expectations below are written out rather than composed from the
  // constants the source reads. A composed expectation moves with whatever it is
  // checking and cannot fail, and this text is the part of the surface that was
  // settled word by word.
  const OPENING = `You opened ${DEEP}. The Aggrega workspace it belongs to is ${ROOT}, `
    + 'outside this window.';
  const CAUSE = `Settings and catalog locations are read from ${ROOT}, and Releases anywhere `
    + 'beneath it can appear here, including ones you cannot open from this window.';

  it('names the state, the cause, and where a build writes — with a folder chosen', () => {
    assert.deepStrictEqual(
      workspaceAboveAccount(ROOT, DEEP, DEEP),
      [OPENING, CAUSE, `Builds still write into ${DEEP}, where you can see them.`],
    );
  });

  it('says where a build ACTUALLY writes when the reader has chosen no folder', () => {
    // 🔴 THE SENTENCE THE OTHER BRANCH WOULD MAKE FALSE. A build request carries
    // where inside the workspace it writes, taken from the folder the reader
    // works from; with none chosen the request carries nothing and the build
    // writes where a build run at the workspace root writes. Telling that reader
    // the artifacts land in the folder they opened would be a falsehood in a
    // dialogue they cannot dismiss without reading.
    assert.deepStrictEqual(
      workspaceAboveAccount(ROOT, DEEP, null),
      [
        OPENING,
        CAUSE,
        `Builds write into ${ROOT}, the Aggrega workspace, because you have not chosen a folder `
        + 'to work from. This is outside the folder opened in the editor.',
      ],
    );
  });

  it('says nothing at all where the workspace is the folder, or either is absent', () => {
    assert.strictEqual(workspaceAboveAccount(ROOT, ROOT, ROOT), null);
    assert.strictEqual(workspaceAboveAccount(null, DEEP, DEEP), null);
    assert.strictEqual(workspaceAboveAccount(ROOT, null, null), null);
  });

  it('states no distance, in a tree three directories deep', () => {
    // 🔴 THE READING THAT WOULD HAVE PASSED ON A ONE-LEVEL FIXTURE. The account
    // is composed against a folder three directories below its workspace, and
    // what is asserted is that no sentence in it counts anything: a reader acts
    // on the PATH, and a number is one more fact to keep true as the walk
    // changes.
    assert.strictEqual(
      path.relative(ROOT, DEEP).split(path.sep).length, 3,
      'the fixture no longer puts the workspace three directories above the folder, so a sentence '
      + 'counting levels could pass here while being false for a deeper reader',
    );
    const said = [WORKSPACE_ABOVE_HEADLINE, ...(workspaceAboveAccount(ROOT, DEEP, DEEP) ?? [])]
      .join('\n');
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
    // claim about the probe. One phrase certainly IS present, so a sweep that
    // had stopped reading the text would fail here rather than report nine
    // clean absences.
    assert.ok(
      said.toLowerCase().includes('above the one you opened'),
      'the sweep sees none of the text it is reading, so its absences mean nothing',
    );
  });

  it('names each level from the one place the levels are named', () => {
    // The account and the rows must not come to call one level two different
    // things. This is the reading that fails if either moves.
    const said = (workspaceAboveAccount(ROOT, DEEP, null) ?? []).join('\n');
    assert.ok(said.includes(SELECTOR_ROW_LABELS.workspace), said);
    assert.ok(said.includes(`${SELECTOR_ROW_LABELS.release}s`), said);
  });
});

describe('the interruption, and what it offers', () => {
  it('carries the account as plain text, with no markup and no pictograph', () => {
    // 🔴 THE DIALOGUE RENDERS PLAIN TEXT AND THE EDITOR DRAWS ITS OWN WARNING
    // PICTOGRAPH. An emphasis marker would reach the reader as the two
    // characters it is written with and read as a rendering fault; a pictograph
    // written here would stand beside the editor's. What the account asks for on
    // its opening sentence is carried by the dialogue's message slot, which the
    // editor draws heavier and larger than the detail beneath it — which is why
    // the headline is the message and the rest is the detail.
    const notice = workspaceAboveNotice(ROOT, DEEP, DEEP);
    assert.ok(notice !== null, 'the interruption is not composed at all');
    assert.strictEqual(notice.message, WORKSPACE_ABOVE_HEADLINE);
    assert.strictEqual(
      notice.detail,
      (workspaceAboveAccount(ROOT, DEEP, DEEP) ?? []).join('\n\n'),
      'the dialogue says something other than the account, so the surface a reader dismisses and '
      + 'the surface they go back to can come to differ',
    );
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
    const notice = workspaceAboveNotice(ROOT, DEEP, DEEP);
    assert.ok(notice !== null);
    assert.deepStrictEqual(
      notice.actions.map((a) => [a.title, a.choice, a.isCloseAffordance ?? false]),
      [
        [`Open ${ROOT}. The window reloads.`, 'open', false],
        ['Continue here', 'continue', true],
        ['Don\'t show again for this folder', 'silence', false],
      ],
      'the dialogue offers something other than the three actions, or one of them no longer says '
      + 'what pressing it costs',
    );
  });

  it('puts the dismissing press on the action that changes nothing', () => {
    // ⚠️ THE EDITOR ADDS A CANCEL OF ITS OWN TO A DIALOGUE THAT DECLARES NO
    // CLOSE AFFORDANCE, and a reader who took it would have taken an action this
    // side never named. Declaring it puts the keyboard dismissal, the close
    // control and the middle action on ONE action — so none of those paths can
    // silence a folder the reader never asked to silence.
    const notice = workspaceAboveNotice(ROOT, DEEP, DEEP);
    const closing = (notice?.actions ?? []).filter((a) => a.isCloseAffordance === true);
    assert.strictEqual(closing.length, 1, 'the dialogue declares no single close affordance');
    assert.strictEqual(
      closing[0].choice, 'continue',
      'dismissing the dialogue does something other than leaving everything as it was',
    );
  });

  it('composes nothing where the workspace does not sit above the folder', () => {
    assert.strictEqual(workspaceAboveNotice(ROOT, ROOT, ROOT), null);
    assert.strictEqual(workspaceAboveNotice(null, DEEP, DEEP), null);
  });
});

describe('the interruption is raised once per folder, and the reader can stop it', () => {
  it('is due the first time and not the second, keyed on the folder and its workspace', () => {
    const state = new Memory();
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, DEEP), true);
    return recordFolderTold(state, DEEP, ROOT).then(() => {
      assert.strictEqual(
        workspaceAboveNoticeDue(state, ROOT, DEEP), false,
        'the reader is interrupted a second time about a folder they have already been told about',
      );
      // 🔴 THE KEY IS SHOWN RATHER THAN DESCRIBED, and the entry is a map from
      // folder to workspace rather than a single value. The store the editor
      // gives an extension is scoped to the window, so a single value there
      // would mean telling a reader about one folder silenced the account for
      // every other folder they went on to work from.
      assert.deepStrictEqual(
        state.get<unknown>(WORKSPACE_ABOVE_TOLD_STATE_KEY),
        { [DEEP]: ROOT },
      );
      assert.deepStrictEqual(readFoldersTold(state), { [DEEP]: ROOT });
    });
  });

  it('is due again for the same folder when the workspace it resolves to has moved', async () => {
    // The account is about a PAIR. A folder whose workspace has moved — a marker
    // written closer to it, or the one above it removed — is a different fact
    // from the one the reader was told, so the record cannot be about the folder
    // alone without leaving them holding an account that quietly stopped being
    // true.
    const state = new Memory();
    await recordFolderTold(state, DEEP, ROOT);
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, DEEP), false);
    assert.strictEqual(
      workspaceAboveNoticeDue(state, path.join(ROOT, 'services'), DEEP), true,
      'a reader whose workspace has moved is never told about the one now in force',
    );
  });

  it('silences one folder and leaves every other folder still warning', async () => {
    // 🔴 THE MULTI-FOLDER WINDOW, WHICH IS THE WHOLE REASON THE ENTRY IS KEYED
    // BY FOLDER. The editor's store is scoped to the window, so a design that
    // recorded one answer for the window would have a reader who silenced one
    // folder hear nothing about the next one they worked from.
    const state = new Memory();
    await silenceFolder(state, DEEP);
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, DEEP), false);
    assert.strictEqual(
      workspaceAboveNoticeDue(state, ROOT, SIBLING), true,
      'silencing one folder silenced another, so a reader is left uninformed about a folder they '
      + 'never answered for',
    );
    assert.deepStrictEqual(state.get<unknown>(WORKSPACE_ABOVE_SILENCED_STATE_KEY), [DEEP]);
    assert.deepStrictEqual(readFoldersSilenced(state), [DEEP]);
  });

  it('survives a window standing back up, and outlives the workspace moving', async () => {
    // What a reader SAID outlives every workspace that folder may come to
    // resolve to; what this extension DID does not. Reading the two from one
    // store is what the two entries exist to keep apart.
    const state = new Memory();
    await silenceFolder(state, DEEP);
    assert.strictEqual(
      workspaceAboveNoticeDue(state, path.join(ROOT, 'services'), DEEP), false,
      'a reader who asked not to be told about a folder is told about it anyway once its '
      + 'workspace moves',
    );
  });

  it('records a folder once however often it is silenced', async () => {
    const state = new Memory();
    await silenceFolder(state, DEEP);
    await silenceFolder(state, DEEP);
    assert.deepStrictEqual(readFoldersSilenced(state), [DEEP]);
  });

  it('reads state it cannot understand as nothing recorded', () => {
    // A window carrying an entry written by an older version of this extension
    // is the ordinary way this happens, and the honest reading of one this
    // version cannot understand is that the reader has not been told.
    const state = new Memory();
    void state.update(WORKSPACE_ABOVE_TOLD_STATE_KEY, 'a string, not a map');
    void state.update(WORKSPACE_ABOVE_SILENCED_STATE_KEY, { not: 'a list' });
    assert.deepStrictEqual(readFoldersTold(state), {});
    assert.deepStrictEqual(readFoldersSilenced(state), []);
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, DEEP), true);
  });

  it('is never due where the workspace does not sit above the folder', () => {
    const state = new Memory();
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, ROOT), false);
    assert.strictEqual(workspaceAboveNoticeDue(state, null, DEEP), false);
    assert.strictEqual(workspaceAboveNoticeDue(state, ROOT, null), false);
  });
});

// The three actions reach the editor from one handler, which imports the editor
// and so cannot be called here. What IS reachable is its source, and reading it
// is what keeps "pressing this does that" a measured claim rather than an
// unwitnessed one. The half that can be driven — what each press MEANS, and what
// the store holds afterwards — is driven above.
describe('what each press does, read off the handler that performs it', () => {
  it('records the folder BEFORE the dialogue goes up, so one account is dismissed once', () => {
    const body = functionBody('src/extension.ts', HANDLER);
    // 🔴 THE NEEDLE ON THE BLOCK, first, because everything below is a claim
    // about this text. A scan running past the function would swallow the rest
    // of the module and pass whatever was written; one stopping short would fail
    // every reading. These name statements the real body opens and closes with.
    assert.ok(
      body.includes('const root = anchoredWorkspaceRoot();'),
      `the scanned body does not begin where the handler does; it was:\n${body}`,
    );
    assert.ok(
      body.trim().endsWith('await vscode.commands.executeCommand(opening.command, vscode.Uri.file(opening.location));'),
      `the scanned body does not end where the handler does; it was:\n${body}`,
    );

    const told = body.indexOf('await recordFolderTold(');
    const raised = body.indexOf('vscode.window.showWarningMessage(');
    assert.notStrictEqual(told, -1, 'the folder is never recorded, so the dialogue returns forever');
    assert.notStrictEqual(raised, -1, 'no dialogue is raised at all');
    assert.ok(
      told < raised,
      'the folder is recorded after the dialogue is answered rather than before it is raised — a '
      + 'dialogue stands until it is dismissed, and re-evaluating the open folders would raise a '
      + 'second one behind the first',
    );
  });

  it('opens the folder through the one decision the row\'s own offer composes through', () => {
    const body = functionBody('src/extension.ts', HANDLER);
    assert.ok(
      body.includes('openWorkspaceRootInvocation('),
      'the handler derives a folder of its own rather than composing through the one decision, so '
      + 'a workspace that went away between the dialogue and the press has two answers',
    );
    assert.ok(
      body.includes('vscode.Uri.file('),
      'the handler hands the editor no file location',
    );
  });

  it('silences a folder on one press and on no other', () => {
    // An equality over every call in the module rather than a search for one:
    // a total cannot say which press a call sits under, and a second call is
    // exactly the change that would silence a folder for a reader who pressed
    // something else.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'silenceFolder'),
      [['context.workspaceState', 'opened']],
      'a folder is silenced somewhere other than the press that asks for it',
    );
  });

  it('acts on what a press MEANS rather than on the sentence it is labelled with', () => {
    // A label is text a reader reads and the operator may revise; a comparison
    // against one is a second spelling of it that nothing warns about when the
    // first moves.
    const body = functionBody('src/extension.ts', HANDLER);
    assert.ok(body.includes('answer?.choice'), `the handler matches on something else:\n${body}`);
    assert.ok(
      !body.includes('Continue here') && !body.includes('Don\'t show again'),
      `the handler compares a press against a sentence:\n${body}`,
    );
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
    // reader silenced out of reach of the modules that compose a row.
    //
    // An equality over the whole source tree rather than a presence, so a third
    // module reading the suppression fails this whatever it is called. It is its
    // own control: an extraction that stopped working returns an empty list, and
    // an empty list is not the recorded shape.
    for (const reader of ['readFoldersSilenced', 'readFoldersTold', 'silenceFolder']) {
      const modules = [...new Set(callSites(reader).map((site) => site.module))].sort();
      assert.deepStrictEqual(
        modules.filter((m) => m === 'selector-rows.ts' || m === 'operations-render.ts'),
        [],
        `${reader} is read where a row is composed, so a reader who dismissed the interruption `
        + 'can be made to lose the mark that carries the same fact',
      );
      assert.notStrictEqual(
        modules.length, 0,
        `the census sees no module reading ${reader}, so its absences mean nothing`,
      );
    }
  });

  it('composes the mark from the condition alone, with no store to consult', () => {
    // The row is handed paths and a count and nothing else, which is what makes
    // the reading above structural rather than a habit: there is no suppression
    // in scope for it to read even if someone wanted it to.
    assert.strictEqual(
      workspaceRow.length, 3,
      'the row that carries the mark takes a parameter it did not, which is how a suppression '
      + 'would reach it',
    );
  });
});

describe('the mark on the row', () => {
  it('stands while the condition holds and is absent when it does not', () => {
    assert.strictEqual(workspaceRow(ROOT, DEEP, 1, DEEP).warning, WORKSPACE_ABOVE_HEADLINE);
    assert.strictEqual(workspaceRow(ROOT, ROOT, 1, ROOT).warning, null);
    assert.strictEqual(workspaceRow(null, DEEP, 1, DEEP).warning, null);
    assert.strictEqual(workspaceRow(null, null, 0, null).warning, null);
  });

  it('is the only row that can carry one', () => {
    const rows = selectorRows(ROOT, DEEP, DEEP, { kind: 'unknown' }, CANDIDATES);
    assert.deepStrictEqual(
      rows.filter((row) => row.warning !== null).map((row) => row.key),
      ['workspace'],
      'a row other than the one naming the Aggrega workspace carries the mark',
    );
  });

  it('carries the same account on its hover as the interruption carried', () => {
    // 🔴 DISMISSING THE POP-UP MUST NOT DISMISS THE TRUTH. The mark is what
    // carries the fact once the interruption is gone, so the hover has to hold
    // the account rather than a shorter version of it.
    const row = workspaceRow(ROOT, DEEP, 1, DEEP);
    const notice = workspaceAboveNotice(ROOT, DEEP, DEEP);
    assert.ok(notice !== null);
    assert.ok(row.tooltip.includes(notice.message), row.tooltip);
    for (const paragraph of notice.detail.split('\n\n')) {
      assert.ok(row.tooltip.includes(paragraph), `the hover drops "${paragraph}":\n${row.tooltip}`);
    }
  });

  it('says where a build writes in the branch the reader is actually in', () => {
    const chosen = workspaceRow(ROOT, DEEP, 1, DEEP).tooltip;
    const unchosen = workspaceRow(ROOT, DEEP, 1, null).tooltip;
    assert.ok(chosen.includes(`Builds still write into ${DEEP}, where you can see them.`), chosen);
    assert.ok(unchosen.includes(`Builds write into ${ROOT}, the Aggrega workspace,`), unchosen);
    assert.ok(
      !unchosen.includes('Builds still write into'),
      `the row promises a reader with no folder chosen that builds land where they can see them:\n${unchosen}`,
    );
  });

  it('carries no markup and no pictograph, because the hover is plain escaped text', () => {
    // The hover is an escaped title attribute in the panel's own document: plain
    // text, with no markdown and no styling at all. An emphasis marker reaches
    // the reader as the two characters it is written with.
    const row = workspaceRow(ROOT, DEEP, 1, DEEP);
    for (const text of [row.tooltip, row.warning ?? '']) {
      assert.ok(!text.includes('**'), `an emphasis marker reaches the hover: ${text}`);
      assert.ok(!/[⚠️]/.test(text), `a pictograph reaches the hover: ${text}`);
    }
  });
});

describe('the mark is drawn as a mark and not as part of the value', () => {
  const unavailable: Partial<Record<OperationId, string | null>> = {};
  for (const op of allOperations()) { unavailable[op.id] = null; }
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
    // told is its name — which is the whole account's opening sentence rather
    // than a word for the shape of the glyph.
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
});
