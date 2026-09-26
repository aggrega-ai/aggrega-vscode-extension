// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'path';

import {
  ReleaseSelection,
  ReleaseSelectionDeps,
  createReleaseSelection,
  describeSelection,
} from '../../src/release-selection';
import { ActiveReleaseResponse } from '../../src/types';

const ROOT = path.join(path.sep, 'workspace');
// OPENED is a folder INSIDE the anchored root, which is the ordinary shape when
// a person opens one project inside a larger tree. The two roots differ, and
// every test below that cares which one is used says which.
const OPENED = path.join(ROOT, 'examples', 'one');

interface Harness {
  selection: ReleaseSelection;
  activeReleaseCalls: number;
  listReleasesCalls: number;
  pickCalls: Array<{ candidates: string[]; placeHolder: string }>;
  infos: string[];
  errors: string[];
  logs: string[];
  changes: number;
  // stored is the editor-local remembered selection, or null. Reading it back
  // is how a test asserts what survives a session.
  stored: string | null;
  // pickAnswer is the absolute path the prompt returns, or undefined for a
  // dismissal.
  pickAnswer: string | undefined;
  activeReleaseAnswer: () => Promise<ActiveReleaseResponse>;
}

function harness(options?: {
  root?: string | null;
  // daemonRoot is the folder the language server reported having anchored to.
  // Defaults to ROOT; pass null for the state where it reported none.
  daemonRoot?: string | null;
  candidates?: string[];
  remembered?: string | null;
  activeRelease?: () => Promise<ActiveReleaseResponse>;
  listReleases?: () => Promise<string[]>;
}): Harness {
  const h: Partial<Harness> = {
    activeReleaseCalls: 0,
    listReleasesCalls: 0,
    pickCalls: [],
    infos: [],
    errors: [],
    logs: [],
    changes: 0,
    stored: options?.remembered ?? null,
    pickAnswer: undefined,
  };
  const deps: ReleaseSelectionDeps = {
    getWorkspaceRoot: () => (options?.root === undefined ? OPENED : options.root),
    getDaemonWorkspaceRoot: () =>
      (options?.daemonRoot === undefined ? ROOT : options.daemonRoot),
    store: {
      read: () => h.stored ?? null,
      write: (release) => { h.stored = release; },
    },
    requestActiveRelease: () => {
      h.activeReleaseCalls! += 1;
      return (options?.activeRelease ?? (() => Promise.resolve({ release: '' })))();
    },
    listReleases: () => {
      h.listReleasesCalls! += 1;
      if (options?.listReleases) { return options.listReleases(); }
      return Promise.resolve(options?.candidates ?? []);
    },
    pickRelease: (candidates, placeHolder) => {
      h.pickCalls!.push({ candidates, placeHolder });
      return Promise.resolve(h.pickAnswer);
    },
    reportInfo: (m) => { h.infos!.push(m); },
    reportError: (m) => { h.errors!.push(m); },
    logLine: (l) => { h.logs!.push(l); },
  };
  const selection = createReleaseSelection(deps);
  selection.onChange(() => { h.changes! += 1; });
  h.selection = selection;
  return h as Harness;
}

describe('the editor\'s one selected Release', () => {
  it('holds nothing before a connection is established', () => {
    const h = harness();
    assert.strictEqual(h.selection.current(), null);
    assert.deepStrictEqual(h.selection.state(), { kind: 'unknown' });
    assert.strictEqual(h.activeReleaseCalls, 0, 'building the selection must contact nothing');
  });

  it('adopts the workspace default as workspace-relative, which is the form a request takes', async () => {
    const absolute = path.join(ROOT, 'envs', 'prod.yaml');
    const h = harness({ activeRelease: () => Promise.resolve({ release: absolute }) });

    await h.selection.adoptDefault();

    // The server answers with an absolute path and every request parameter
    // takes a workspace-relative one; an absolute value is refused on the wire.
    assert.strictEqual(h.selection.current(), path.join('envs', 'prod.yaml'));
    assert.ok(!path.isAbsolute(h.selection.current()!), 'an absolute selection would be refused');
  });

  it('records the account it was given when the workspace offers no Release', async () => {
    const h = harness({
      activeRelease: () => Promise.resolve({
        release: '',
        reason: 'no authoring_release configured; workspace contains 0 Release file(s)',
        trace: 'Aggrega: cascade trace\n  step 1: not configured\n  step 2: not present',
      }),
    });

    await h.selection.adoptDefault();

    assert.deepStrictEqual(h.selection.state(), {
      kind: 'none',
      reason: 'no authoring_release configured; workspace contains 0 Release file(s)',
    });
    assert.strictEqual(h.selection.current(), null);
    // The multi-line account is written through verbatim, line by line, and
    // never parsed: it is prose for a person, whose wording follows the
    // workspace reading itself.
    assert.deepStrictEqual(h.logs, [
      'Aggrega: cascade trace',
      '  step 1: not configured',
      '  step 2: not present',
    ]);
  });

  it('reports the answer as unknown, not as none, when the server is not answering', async () => {
    const h = harness({ activeRelease: () => Promise.reject(new Error('not running')) });

    await h.selection.adoptDefault();

    assert.deepStrictEqual(
      h.selection.state(),
      { kind: 'unknown' },
      '"no Release in this workspace" is a different fact from "no answer was obtained"',
    );
  });

  it('replaces the adopted default with an explicit choice, contacting no restart path', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const second = path.join(ROOT, 'second.yaml');
    const h = harness({
      candidates: [first, second],
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.adoptDefault();
    assert.strictEqual(h.selection.current(), 'first.yaml');

    h.pickAnswer = second;
    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, 'second.yaml');
    assert.strictEqual(h.selection.current(), 'second.yaml');
    // The default was read once, when the connection was established. Choosing
    // did not re-read it: the selection lives here, so there is nothing to
    // re-ask and nothing to restart.
    assert.strictEqual(h.activeReleaseCalls, 1);
  });

  it('offers a sole candidate rather than taking it silently', async () => {
    const only = path.join(ROOT, 'only.yaml');
    const h = harness({ candidates: [only] });
    h.pickAnswer = only;

    await h.selection.choose();

    assert.strictEqual(
      h.pickCalls.length, 1,
      'the reader asked to choose; answering by choosing for them hides that the command ran',
    );
  });

  it('leaves the selection alone when the prompt is dismissed', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first, path.join(ROOT, 'second.yaml')],
      activeRelease: () => Promise.resolve({ release: first }),
    });
    await h.selection.adoptDefault();

    h.pickAnswer = undefined;
    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(h.selection.current(), 'first.yaml', 'a dismissal must not clear the selection');
  });

  it('says so, and selects nothing, when the workspace holds no Release', async () => {
    const h = harness({ candidates: [] });

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(h.pickCalls.length, 0, 'an empty prompt is a dead end');
    assert.deepStrictEqual(h.infos, ['Aggrega: no Release found in this workspace.']);
  });

  it('reports a language server that cannot list Releases as an error, not as an empty workspace', async () => {
    const h = harness({
      listReleases: () => Promise.reject(new Error('the Aggrega daemon is not running')),
    });

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(h.errors.length, 1);
    assert.ok(h.errors[0].includes('language server is not running'));
    assert.strictEqual(h.infos.length, 0, 'a server that is down is not an empty workspace');
  });

  it('announces every change, so a display cannot fall behind the value being sent', async () => {
    // The counts are exact, so this is a guard against announcing too often as
    // much as too seldom — and TWO facts are now observable rather than one.
    // Adopting the default moves the selection. Choosing moves two: opening the
    // chooser reads what the workspace offers, which nothing had read, and then
    // the selection lands. Forgetting drops both together in one.
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first, path.join(ROOT, 'second.yaml')],
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.adoptDefault();
    assert.strictEqual(h.changes, 1);

    h.pickAnswer = path.join(ROOT, 'second.yaml');
    await h.selection.choose();
    assert.strictEqual(h.changes, 3);

    h.selection.forget();
    assert.strictEqual(h.changes, 4);
  });

  it('announces nothing for a walk that found what it already knew', async () => {
    // The count is announced when it MOVES, not whenever it is read. A second
    // chooser over an unchanged workspace would otherwise redraw every surface
    // for a fact that did not change.
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({ candidates: [first, path.join(ROOT, 'second.yaml')] });
    h.pickAnswer = first;
    await h.selection.choose();
    const settled = h.changes;

    h.pickAnswer = undefined;
    await h.selection.choose();

    assert.strictEqual(
      h.changes, settled,
      'the same answer was announced again, so every surface redrew for nothing',
    );
  });

  it('drops the selection with the connection it was resolved against', async () => {
    const h = harness({
      activeRelease: () => Promise.resolve({ release: path.join(ROOT, 'prod.yaml') }),
    });
    await h.selection.adoptDefault();
    assert.strictEqual(h.selection.current(), 'prod.yaml');

    h.selection.forget();

    assert.strictEqual(
      h.selection.current(), null,
      'a server attaching to a different root must not inherit the previous answer',
    );
  });
});

describe('which folder a Release is named relative to', () => {
  // The anchored folder and the opened folder are two different folders
  // whenever the anchor sits above what was opened, which is the ordinary shape
  // for one project inside a larger tree. The server enumerates its candidates
  // over the anchored folder and resolves every request against that same
  // folder, so naming a Release relative to anything else produces a value it
  // refuses for a document it has just offered.
  it('names a candidate relative to the anchored folder, not the folder that was opened', async () => {
    const absolute = path.join(ROOT, 'envs', 'prod.yaml');
    const h = harness({ candidates: [absolute] });
    h.pickAnswer = absolute;

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, path.join('envs', 'prod.yaml'));
    assert.ok(
      !chosen!.startsWith('..'),
      'a value naming the opened folder would climb out of the anchored folder and be refused',
    );
  });

  it('names a candidate that sits beside the opened folder without climbing', async () => {
    // The candidate the operator met: a sibling of what they opened, offered by
    // a server anchored above both. Against the opened folder this is a
    // climbing path; against the anchored folder it is an ordinary one.
    const sibling = path.join(ROOT, 'examples', 'two', 'release-compose.yaml');
    const h = harness({ candidates: [sibling] });
    h.pickAnswer = sibling;

    const chosen = await h.selection.choose();

    assert.strictEqual(
      chosen,
      path.join('examples', 'two', 'release-compose.yaml'),
    );
    assert.strictEqual(
      path.relative(OPENED, sibling),
      path.join('..', 'two', 'release-compose.yaml'),
      'the opened folder is genuinely the wrong root here, which is what this pins',
    );
  });

  it('names what it cannot offer, with a count and where it sits', async () => {
    // A planted candidate outside the anchored folder. Nothing the server
    // enumerates lands here, so this is the bound being shown to refuse rather
    // than a state met in ordinary use.
    const inside = path.join(ROOT, 'inside.yaml');
    const planted = path.join(path.sep, 'elsewhere', 'planted-release.yaml');
    const h = harness({ candidates: [inside, planted] });
    h.pickAnswer = inside;

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, 'inside.yaml');
    assert.deepStrictEqual(
      h.pickCalls[0].candidates, [inside],
      'a Release the request would be refused for is not offered',
    );
    assert.strictEqual(h.infos.length, 1);
    assert.ok(h.infos[0].includes('1 Release'), 'the count is what makes the drop actionable');
    assert.ok(h.infos[0].includes(ROOT), 'the reader is told which folder it sits outside');
    assert.deepStrictEqual(
      h.logs, [`[not offered] ${planted}`],
      'and where the file is, so it can be found',
    );
  });

  it('does not say the workspace is empty when it dropped everything it was given', async () => {
    const planted = path.join(path.sep, 'elsewhere', 'planted-release.yaml');
    const h = harness({ candidates: [planted] });

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(h.pickCalls.length, 0);
    assert.ok(
      !h.infos.some(m => m.includes('no Release found in this workspace')),
      '"there are none" and "there are some I cannot offer you" are different facts',
    );
    assert.ok(h.infos[0].includes('1 Release'));
  });

  it('offers nothing, and says why, when the server has reported no anchored folder', async () => {
    const inside = path.join(ROOT, 'inside.yaml');
    const h = harness({ daemonRoot: null, candidates: [inside] });

    const chosen = await h.selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(
      h.pickCalls.length, 0,
      'with no anchored folder reported there is no folder to name a Release relative to',
    );
    assert.ok(h.infos[0].includes('has not reported which folder it anchored to'));
    assert.deepStrictEqual(h.logs, [`[not offered] ${inside}`]);
  });

  it('takes no default it could not name in a request', async () => {
    const h = harness({
      daemonRoot: null,
      activeRelease: () => Promise.resolve({ release: path.join(ROOT, 'prod.yaml') }),
    });

    await h.selection.adoptDefault();

    assert.strictEqual(
      h.selection.current(), null,
      'reporting it as selected would put a refused value on every request',
    );
    const state = h.selection.state();
    assert.strictEqual(state.kind, 'none');
    assert.ok(
      state.kind === 'none' && state.reason.includes('has not reported which folder it anchored to'),
    );
  });
});

describe('the selection this editor window remembers', () => {
  it('remembers an explicit choice, and nothing else', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first],
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.adoptDefault();
    assert.strictEqual(
      h.stored, null,
      'a default is re-resolved each connection; remembering it would freeze it',
    );

    h.pickAnswer = first;
    await h.selection.choose();
    assert.strictEqual(h.stored, 'first.yaml');
  });

  it('restores a remembered selection the workspace still offers', async () => {
    const second = path.join(ROOT, 'second.yaml');
    const h = harness({
      candidates: [path.join(ROOT, 'first.yaml'), second],
      remembered: 'second.yaml',
      activeRelease: () => Promise.resolve({ release: path.join(ROOT, 'first.yaml') }),
    });

    await h.selection.restore();

    assert.strictEqual(h.selection.current(), 'second.yaml');
    assert.strictEqual(
      h.activeReleaseCalls, 0,
      'the remembered choice outranks the default, so the default is not asked for',
    );
    assert.deepStrictEqual(h.infos, [], 'a restore that worked is not news');
  });

  it('drops a remembered selection the workspace no longer offers, and says it did', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first],
      remembered: 'deleted.yaml',
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.restore();

    assert.strictEqual(h.stored, null, 'a value proven stale is not kept');
    assert.strictEqual(h.infos.length, 1);
    assert.ok(h.infos[0].includes('deleted.yaml'));
    assert.ok(h.infos[0].includes('no longer offered'));
    assert.strictEqual(
      h.selection.current(), 'first.yaml',
      'and the workspace default takes over, which is where a reader who never chose would start',
    );
  });

  it('keeps a remembered selection it could not verify, rather than losing it to a restart', async () => {
    const h = harness({
      remembered: 'chosen.yaml',
      listReleases: () => Promise.reject(new Error('the Aggrega daemon is not running')),
    });

    await h.selection.restore();

    assert.strictEqual(
      h.stored, 'chosen.yaml',
      'a server that is not answering says nothing about whether the Release is still there',
    );
    assert.deepStrictEqual(h.selection.state(), { kind: 'unknown' });
    assert.strictEqual(
      h.selection.current(), null,
      'and an unverified value must not become the selection',
    );
  });

  it('resolves the workspace default when nothing was remembered', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first],
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.restore();

    assert.strictEqual(h.selection.current(), 'first.yaml');
    assert.strictEqual(h.activeReleaseCalls, 1);
  });

  it('leaves the remembered choice in place when a connection ends', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({ candidates: [first] });
    h.pickAnswer = first;
    await h.selection.choose();
    assert.strictEqual(h.stored, 'first.yaml');

    h.selection.forget();

    assert.strictEqual(
      h.stored, 'first.yaml',
      'the next connection re-verifies it; a connection ending is not evidence against it',
    );
  });
});

describe('what the workspace has on offer', () => {
  it('holds nothing before anything has been enumerated', () => {
    const h = harness({ candidates: [path.join(ROOT, 'a.yaml')] });
    assert.strictEqual(
      h.selection.offerableCount(), null,
      'a count is reported that no request was made for',
    );
    assert.strictEqual(h.listReleasesCalls, 0, 'building the selection must contact nothing');
  });

  it('reads the workspace on a connection that has nothing remembered', async () => {
    // 🔴 This is the path nothing enumerated before, and it is the ordinary
    // one: a reader who has chosen nothing in this window. Without it the
    // surfaces would have no way to tell a workspace offering no Release from
    // one they simply have not looked at, on the very first thing they see.
    const h = harness({
      remembered: null,
      candidates: [path.join(ROOT, 'a.yaml'), path.join(ROOT, 'b.yaml')],
    });

    await h.selection.restore();

    assert.strictEqual(h.selection.offerableCount(), 2);
    assert.strictEqual(
      h.listReleasesCalls, 1,
      'the workspace was enumerated more than once for one connection',
    );
  });

  it('counts what can be chosen rather than what was reported', async () => {
    // A candidate outside the anchored folder cannot be named in a request, so
    // the chooser will not offer it. Counting it would promise a choice that
    // is not there.
    const inside = path.join(ROOT, 'inside.yaml');
    const outside = path.join(path.sep, 'elsewhere', 'outside.yaml');
    const h = harness({ remembered: null, candidates: [inside, outside] });

    await h.selection.restore();

    assert.strictEqual(h.selection.offerableCount(), 1);
  });

  it('reports a workspace that offers nothing as none, distinctly from not having looked', async () => {
    const h = harness({ remembered: null, candidates: [] });

    await h.selection.restore();

    assert.strictEqual(h.selection.offerableCount(), 0);
  });

  it('records nothing at all when the anchored folder was never reported', async () => {
    // Nothing could be converted, so this walk established no count. A zero
    // would say the workspace offers nothing, when what happened is that the
    // editor had no folder to name anything relative to.
    const h = harness({
      remembered: null,
      daemonRoot: null,
      candidates: [path.join(ROOT, 'a.yaml')],
    });

    await h.selection.restore();

    assert.strictEqual(h.selection.offerableCount(), null);
  });

  it('records nothing when the language server cannot be asked', async () => {
    const h = harness({
      remembered: null,
      listReleases: () => Promise.reject(new Error('the Aggrega daemon is not running')),
    });

    await h.selection.restore();

    assert.strictEqual(h.selection.offerableCount(), null);
  });

  it('drops what was on offer with the connection it was read against', async () => {
    // The next connection may resolve a different folder entirely, so a count
    // carried across one would describe a workspace the reader has left.
    const h = harness({ remembered: null, candidates: [path.join(ROOT, 'a.yaml')] });
    await h.selection.restore();
    assert.strictEqual(h.selection.offerableCount(), 1);

    h.selection.forget();

    assert.strictEqual(h.selection.offerableCount(), null);
  });

  it('tells the surfaces when a dismissed chooser changed nothing but the count', async () => {
    // Opening the chooser enumerates. A reader who then dismisses it has
    // changed no selection, so nothing else would announce — and the answer
    // the surfaces were missing is exactly the one that walk produced.
    const h = harness({ candidates: [path.join(ROOT, 'a.yaml'), path.join(ROOT, 'b.yaml')] });
    const before = h.changes;
    h.pickAnswer = undefined;

    await h.selection.choose();

    assert.strictEqual(h.selection.offerableCount(), 2);
    assert.ok(
      h.changes > before,
      'the count moved and no surface was told, so the rows go on drawing the old one',
    );
  });
});

describe('how the selection is described', () => {
  it('names the file and points at how to change it', () => {
    const described = describeSelection({
      kind: 'selected',
      release: 'envs/prod.yaml',
      absolute: path.join(ROOT, 'envs', 'prod.yaml'),
    }, 2);
    assert.strictEqual(described.label, 'prod.yaml');
    assert.ok(described.detail.includes(path.join(ROOT, 'envs', 'prod.yaml')));
  });

  it('carries the reason through when there is one, and reads sensibly when there is not', () => {
    const withReason = describeSelection(
      { kind: 'none', reason: 'workspace contains 0 Release file(s)' }, 2,
    );
    assert.ok(withReason.detail.includes('workspace contains 0 Release file(s)'));

    const without = describeSelection({ kind: 'none', reason: '' }, 2);
    assert.ok(without.detail.includes('no Release is selected'));
    assert.ok(!without.detail.includes('undefined'));
  });

  it('says what it does not know rather than guessing', () => {
    const described = describeSelection({ kind: 'unknown' }, null);
    assert.strictEqual(described.label, 'Release: unavailable');
    assert.ok(described.detail.includes('not running'));
  });

  it('renders a compact form that names the field and a row form that does not', () => {
    const described = describeSelection({
      kind: 'selected',
      release: path.join('envs', 'prod.yaml'),
      absolute: path.join(ROOT, 'envs', 'prod.yaml'),
    }, 2);
    // A surface with one line and no room to name what it shows carries the
    // word itself; a surface that already names the field beside it does not,
    // and has room for the path that tells two same-named files apart.
    assert.strictEqual(described.label, 'prod.yaml');
    assert.strictEqual(described.value, path.join('envs', 'prod.yaml'));

    for (const state of [
      { kind: 'none' as const, reason: '' },
      { kind: 'unknown' as const },
    ]) {
      for (const offerable of [null, 0, 1, 3]) {
        const d = describeSelection(state, offerable);
        assert.ok(d.value.length > 0, 'every state renders a row value');
        assert.ok(
          !d.value.startsWith('Release:'),
          'the row already carries the field name, so repeating it would read twice',
        );
      }
    }
  });

  it('reads nothing-to-select differently from nothing-selected, and carries the way out', () => {
    // 🔴 The two are different states and a reader acts on them differently:
    // one is a decision they have not made, the other is a decision that
    // cannot be made at this level at all. Telling them to choose in the
    // second sends them to a list that must come back empty.
    const empty = describeSelection({ kind: 'none', reason: '' }, 0);
    const selectable = describeSelection({ kind: 'none', reason: '' }, 2);

    assert.notStrictEqual(empty.value, selectable.value, 'the two empty states draw one value');
    assert.notStrictEqual(empty.label, selectable.label);
    assert.notStrictEqual(empty.detail, selectable.detail);

    assert.ok(
      !/click to select/i.test(empty.detail),
      `nothing to select, and the reader is told to select; got ${empty.detail}`,
    );
    assert.ok(
      empty.detail.includes('create a Release'),
      `the empty state names no way out of itself; got ${empty.detail}`,
    );
    assert.ok(
      empty.detail.includes('different Aggrega workspace'),
      'the other way out is the level above, which has to be named to be taken',
    );
    assert.ok(
      /click to select/i.test(selectable.detail),
      'with Releases on offer, choosing is exactly the thing to say',
    );
  });

  it('keeps the account it was given in the state that offers nothing', () => {
    // The server's own sentence is the only text that says WHICH of several
    // reasons applied, so the reading that most needs it must not drop it.
    const empty = describeSelection(
      { kind: 'none', reason: 'workspace contains 0 Release file(s)' }, 0,
    );
    assert.ok(empty.detail.includes('workspace contains 0 Release file(s)'));
  });

  it('separates a count nobody has read from a count of none', () => {
    const unread = describeSelection({ kind: 'none', reason: '' }, null);
    const empty = describeSelection({ kind: 'none', reason: '' }, 0);

    assert.notStrictEqual(
      unread.detail, empty.detail,
      'a workspace nobody has enumerated reads as one that offers nothing',
    );
    assert.ok(unread.detail.includes('has not been read'));
    assert.ok(
      !unread.detail.includes('is available'),
      'the unread state claims to know what is available',
    );
  });

  it('says nothing about how many Releases there are to choose between', () => {
    // The explanation hangs off both the Release row and the status-bar
    // indicator, and it is kept to what the reader acts on: the chooser a click
    // opens lists what there is. Both readings that offer a choice are read at a
    // count of one, which is where a sole-candidate sentence would appear.
    const selected = describeSelection({
      kind: 'selected',
      release: 'envs/prod.yaml',
      absolute: path.join(ROOT, 'envs', 'prod.yaml'),
    }, 1);
    const unchosen = describeSelection({ kind: 'none', reason: '' }, 1);
    for (const detail of [selected.detail, unchosen.detail]) {
      assert.ok(
        !detail.includes('Only one') && !detail.includes('no others to choose between'),
        `the description says how many Releases there are:\n${detail}`,
      );
    }
    // The control on that sweep: one phrase each reading certainly carries.
    assert.ok(selected.detail.includes('Click to choose') && unchosen.detail.includes('Click to select'));
  });

  it('closes a selection with the offer to choose a different one, set apart by a blank line', () => {
    const described = describeSelection({
      kind: 'selected',
      release: 'envs/prod.yaml',
      absolute: path.join(ROOT, 'envs', 'prod.yaml'),
    }, 3);
    assert.strictEqual(
      described.detail,
      `Aggrega selected Release: ${path.join(ROOT, 'envs', 'prod.yaml')}\n\n`
      + 'Click to choose a different Release.',
    );
  });
});
