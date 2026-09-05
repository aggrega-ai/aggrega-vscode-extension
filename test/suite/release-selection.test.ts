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

interface Harness {
  selection: ReleaseSelection;
  activeReleaseCalls: number;
  listReleasesCalls: number;
  pickCalls: Array<{ candidates: string[]; placeHolder: string }>;
  infos: string[];
  errors: string[];
  logs: string[];
  changes: number;
  // pickAnswer is the absolute path the prompt returns, or undefined for a
  // dismissal.
  pickAnswer: string | undefined;
  activeReleaseAnswer: () => Promise<ActiveReleaseResponse>;
}

function harness(options?: {
  root?: string | null;
  candidates?: string[];
  activeRelease?: () => Promise<ActiveReleaseResponse>;
}): Harness {
  const h: Partial<Harness> = {
    activeReleaseCalls: 0,
    listReleasesCalls: 0,
    pickCalls: [],
    infos: [],
    errors: [],
    logs: [],
    changes: 0,
    pickAnswer: undefined,
  };
  const deps: ReleaseSelectionDeps = {
    getWorkspaceRoot: () => (options?.root === undefined ? ROOT : options.root),
    requestActiveRelease: () => {
      h.activeReleaseCalls! += 1;
      return (options?.activeRelease ?? (() => Promise.resolve({ release: '' })))();
    },
    listReleases: () => {
      h.listReleasesCalls! += 1;
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
    const h = harness();
    const deps: ReleaseSelectionDeps = {
      getWorkspaceRoot: () => ROOT,
      requestActiveRelease: () => Promise.resolve({ release: '' }),
      listReleases: () => Promise.reject(new Error('the Aggrega daemon is not running')),
      pickRelease: () => Promise.resolve(undefined),
      reportInfo: (m) => { h.infos.push(m); },
      reportError: (m) => { h.errors.push(m); },
      logLine: (l) => { h.logs.push(l); },
    };
    const selection = createReleaseSelection(deps);

    const chosen = await selection.choose();

    assert.strictEqual(chosen, null);
    assert.strictEqual(h.errors.length, 1);
    assert.ok(h.errors[0].includes('language server is not running'));
    assert.strictEqual(h.infos.length, 0, 'a server that is down is not an empty workspace');
  });

  it('announces every change, so a display cannot fall behind the value being sent', async () => {
    const first = path.join(ROOT, 'first.yaml');
    const h = harness({
      candidates: [first, path.join(ROOT, 'second.yaml')],
      activeRelease: () => Promise.resolve({ release: first }),
    });

    await h.selection.adoptDefault();
    assert.strictEqual(h.changes, 1);

    h.pickAnswer = path.join(ROOT, 'second.yaml');
    await h.selection.choose();
    assert.strictEqual(h.changes, 2);

    h.selection.forget();
    assert.strictEqual(h.changes, 3);
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

describe('how the selection is described', () => {
  it('names the file and points at how to change it', () => {
    const described = describeSelection({
      kind: 'selected',
      release: 'envs/prod.yaml',
      absolute: path.join(ROOT, 'envs', 'prod.yaml'),
    });
    assert.strictEqual(described.label, 'prod.yaml');
    assert.ok(described.detail.includes(path.join(ROOT, 'envs', 'prod.yaml')));
  });

  it('carries the reason through when there is one, and reads sensibly when there is not', () => {
    const withReason = describeSelection({ kind: 'none', reason: 'workspace contains 0 Release file(s)' });
    assert.ok(withReason.detail.includes('workspace contains 0 Release file(s)'));

    const without = describeSelection({ kind: 'none', reason: '' });
    assert.ok(without.detail.includes('no Release is selected'));
    assert.ok(!without.detail.includes('undefined'));
  });

  it('says what it does not know rather than guessing', () => {
    const described = describeSelection({ kind: 'unknown' });
    assert.strictEqual(described.label, 'Release: unavailable');
    assert.ok(described.detail.includes('not running'));
  });
});
