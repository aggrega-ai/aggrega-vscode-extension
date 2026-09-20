// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  findAllAnchoredFolders,
  workspaceRootOf,
  workspacesReachedFrom,
  workspacesReachedFromAll,
} from '../../src/workspace';
import { classifyActivation } from '../../src/anchor-picker';
import { folder, searchUnder } from '../helpers/folder-search';

// Every layout below is built on disk and named in full, so each case can be
// re-driven by hand in a real window by making the same directories.
let tmp: string;

async function write(relative: string, content = ''): Promise<string> {
  const full = path.join(tmp, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return full;
}

async function makeDir(relative: string): Promise<string> {
  const full = path.join(tmp, relative);
  await fs.mkdir(full, { recursive: true });
  return full;
}

// WORKSPACE_CONFIG is the marker that wins across directories; a heuristic
// marker does not. The difference decides whether a marker below another one is
// a second workspace or the same one, so both forms are used deliberately below
// and never interchangeably.
const WORKSPACE_CONFIG = 'workspace: {}\n';

function rootsOf(found: readonly { anchorPath: string }[]): string[] {
  return found.map((entry) => workspaceRootOf(entry));
}

describe('what one folder reaches', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-reach-'));
    // Resolved because the temporary directory is a symlink on some platforms,
    // and the walk is lexical: an unresolved base would make the expectations
    // below compare a resolved answer against an unresolved path.
    tmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // 🔴 THE CASE EVERY OTHER READING OF THE NARROWING BROKE. A reader opens a
  // subfolder of their repository; the marker is at the repository root. There
  // is nothing under the folder they opened, so no search inside it can find
  // anything — the workspace is reached by walking UP, and it sits ABOVE the
  // folder that reached it.
  //
  // LAYOUT: open folder <tmp>/repo/docs; marker <tmp>/repo/.aggrega-config.yaml;
  // nothing at all under <tmp>/repo/docs.
  it('reaches the workspace ABOVE it, which is what containment would have deleted', async () => {
    await write('repo/.aggrega-config.yaml', WORKSPACE_CONFIG);
    const docs = await makeDir('repo/docs');

    const reached = await workspacesReachedFrom(folder(docs), searchUnder);

    assert.deepStrictEqual(
      rootsOf(reached),
      [path.join(tmp, 'repo')],
      'the reader who opened a subfolder of their repository has lost their workspace',
    );
    // 🔴 STATED AS A PATH RELATION, so the rejected reading is pinned as refused
    // rather than merely unimplemented. The root is an ANCESTOR of the folder
    // that reached it, so a rule admitting only what sits at or under the folder
    // returns nothing here.
    const root = rootsOf(reached)[0];
    assert.ok(
      docs.startsWith(root + path.sep),
      `the reached workspace ${root} is not above the folder ${docs} that reached it, so this `
      + 'case is no longer the one it was written for',
    );
    assert.strictEqual(
      [root].filter((r) => r === docs || r.startsWith(docs + path.sep)).length, 0,
      'an at-or-under narrowing would have kept this workspace, so the case proves nothing',
    );
  });

  // LAYOUT: open folder <tmp>/repo; heuristic marker <tmp>/repo/aggregate.yaml;
  // second heuristic marker <tmp>/repo/sub/release.yaml. The first is a
  // heuristic, so it does NOT shadow the second.
  it('reaches a workspace BELOW it as well, which the walk alone never sees', async () => {
    await write('repo/aggregate.yaml');
    await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');

    const climbedOnly = await findAllAnchoredFolders([folder(repo)]);
    const reached = await workspacesReachedFrom(folder(repo), searchUnder);

    // Both readings, as the clause asks: what this window reports today, and
    // what it reports once the search is part of the answer.
    assert.deepStrictEqual(
      rootsOf(climbedOnly),
      [repo],
      'the walk alone already reports more than one, so this layout does not show the widening',
    );
    assert.deepStrictEqual(
      rootsOf(reached),
      [repo, path.join(repo, 'sub')],
      'the workspace below the open folder is not reached',
    );
  });

  // 🔴 THE SHADOWED CASE, AND IT IS WHY THE KEY IS THE ROOT. An explicit
  // workspace configuration wins across directories, so the marker in the
  // subdirectory confirms to the root ABOVE it — two hits, found in two
  // different directories, naming one workspace.
  //
  // LAYOUT: open folder <tmp>/repo; <tmp>/repo/.aggrega-config.yaml carrying a
  // workspace block; <tmp>/repo/sub/release.yaml.
  it('reports ONE workspace where a configuration higher up shadows a marker below', async () => {
    await write('repo/.aggrega-config.yaml', WORKSPACE_CONFIG);
    await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');

    const reached = await workspacesReachedFrom(folder(repo), searchUnder);

    assert.deepStrictEqual(
      rootsOf(reached),
      [repo],
      'the shadowed marker is reported as a second workspace, so a reader is asked to choose '
      + 'between two entries that name one place',
    );
    // 🔴 THE NEEDLE ON THE KEY. Both directories exist and both confirm; keying
    // on the directory a marker was found in would report two. This asserts the
    // two directories are genuinely different, so the single entry above is the
    // de-duplication working rather than there having been nothing to
    // de-duplicate.
    const { findAggregaWorkspaceAnchor } = await import('../../src/workspace');
    const fromRepo = await findAggregaWorkspaceAnchor(repo);
    const fromSub = await findAggregaWorkspaceAnchor(path.join(repo, 'sub'));
    assert.notStrictEqual(
      repo, path.join(repo, 'sub'),
      'the two directories are the same, so nothing was de-duplicated',
    );
    assert.strictEqual(
      fromRepo, fromSub,
      'the two directories confirm to different markers, so this is not the shadowed case',
    );
  });

  it('answers with nothing for a folder that reaches no workspace at all', async () => {
    const bare = await makeDir('bare/inner');
    assert.deepStrictEqual(await workspacesReachedFrom(folder(bare), searchUnder), []);
  });
});

describe('the population a window reaches, and what one choice narrows it to', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-reach-'));
    tmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // 🔴 THE LAYOUT CLAUSE 17 IS DRIVEN AGAINST, NAMED IN FULL SO IT CAN BE
  // RE-DRIVEN BY HAND:
  //
  //   <tmp>/alpha/aggregate.yaml          — heuristic, so it shadows nothing
  //   <tmp>/alpha/nested/release.yaml     — a second workspace inside alpha
  //   <tmp>/beta/aggregate.yaml           — a third, beside alpha
  //
  // Both <tmp>/alpha and <tmp>/beta are open in the window.
  async function threeWorkspaceLayout(): Promise<{
    alpha: string; alphaNested: string; beta: string;
  }> {
    await write('alpha/aggregate.yaml');
    await write('alpha/nested/release.yaml');
    await write('beta/aggregate.yaml');
    return {
      alpha: path.join(tmp, 'alpha'),
      alphaNested: path.join(tmp, 'alpha', 'nested'),
      beta: path.join(tmp, 'beta'),
    };
  }

  it('offers everything the window reaches when no folder has been chosen', async () => {
    const { alpha, alphaNested, beta } = await threeWorkspaceLayout();

    const all = await workspacesReachedFromAll(
      [folder(alpha), folder(beta)],
      searchUnder,
    );

    assert.deepStrictEqual(
      rootsOf(all),
      [alpha, alphaNested, beta],
      'the window does not reach the three workspaces this layout holds',
    );
  });

  // 🔴 TWO DIFFERENT PROJECT FOLDERS, TWO DIFFERENT REDUCED SETS, BOTH WRITTEN
  // OUT BY PATH. A reduction that was the same whichever folder was chosen would
  // be a constant rather than the choice's effect, and that is the thing this
  // clause exists to refuse.
  it('reduces to what the CHOSEN folder reaches, and differently for each choice', async () => {
    const { alpha, alphaNested, beta } = await threeWorkspaceLayout();

    const choosingAlpha = await workspacesReachedFromAll([folder(alpha)], searchUnder);
    const choosingBeta = await workspacesReachedFromAll([folder(beta)], searchUnder);

    assert.deepStrictEqual(
      rootsOf(choosingAlpha),
      [alpha, alphaNested],
      'choosing alpha does not reduce the offer to what alpha reaches',
    );
    assert.deepStrictEqual(
      rootsOf(choosingBeta),
      [beta],
      'choosing beta does not reduce the offer to what beta reaches',
    );
    assert.notDeepStrictEqual(
      rootsOf(choosingAlpha),
      rootsOf(choosingBeta),
      'both choices reduce to the same set, so the reduction is a constant rather than the '
      + 'effect of the choice',
    );
  });

  // The narrowed list and the whole list are ONE RULE READ AT TWO SCOPES, which
  // is the property that means no second predicate decides which workspaces
  // belong to a folder. Driven by composing the reduced sets and comparing them
  // against the whole one.
  it('makes the whole offer the union of each folder\'s own reach', async () => {
    const { alpha, beta } = await threeWorkspaceLayout();

    const all = await workspacesReachedFromAll([folder(alpha), folder(beta)], searchUnder);
    const perFolder = [
      ...await workspacesReachedFrom(folder(alpha), searchUnder),
      ...await workspacesReachedFrom(folder(beta), searchUnder),
    ];

    assert.deepStrictEqual(
      rootsOf(all),
      rootsOf(perFolder),
      'the window-wide offer is not the union of what each folder reaches, so something other '
      + 'than the reach rule is deciding which workspaces belong to the window',
    );
  });

  it('counts a workspace two open folders both reach exactly once', async () => {
    // LAYOUT: <tmp>/repo/.aggrega-config.yaml, with <tmp>/repo/a and
    // <tmp>/repo/b both open. Both climb to the same root.
    await write('repo/.aggrega-config.yaml', WORKSPACE_CONFIG);
    const a = await makeDir('repo/a');
    const b = await makeDir('repo/b');

    const all = await workspacesReachedFromAll([folder(a), folder(b)], searchUnder);

    assert.deepStrictEqual(rootsOf(all), [path.join(tmp, 'repo')]);
  });
});

// 🔴 THE COST THE RULING ACCEPTED, DRIVEN AT THE CLASSIFIER RATHER THAN
// ASSERTED. The widening is a change to how many candidates a window has, and
// the classifier is what turns that number into an attachment or a prompt — so
// feeding it both populations from ONE named layout is what shows the cost
// arriving.
describe('the cost of the widening, shown on one window', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-reach-'));
    tmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // LAYOUT, NAMED SO IT CAN BE RE-DRIVEN BY HAND: a window whose single open
  // folder is <tmp>/repo, carrying <tmp>/repo/aggregate.yaml at its root and
  // <tmp>/repo/sub/release.yaml below it. Both are heuristic markers, so the
  // first shadows nothing.
  it('attaches with no prompt on the walk alone, and asks on the fuller population', async () => {
    await write('repo/aggregate.yaml');
    await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');
    const open = [folder(repo)];

    const climbed = await findAllAnchoredFolders(open);
    const reached = await workspacesReachedFromAll(open, searchUnder);

    // BEFORE: one candidate, so the language server attaches silently and the
    // reader is asked nothing.
    const before = classifyActivation(climbed, null);
    assert.strictEqual(
      before.kind, 'single',
      'this window does not attach silently on the walk alone, so it is not the window the '
      + 'clause is about',
    );

    // AFTER: two candidates and nothing remembered, so the choice is surfaced.
    const after = classifyActivation(reached, null);
    assert.strictEqual(
      after.kind, 'multiPrompt',
      'the widened population does not reach the prompt, so the accepted cost is not shown',
    );
    assert.deepStrictEqual(
      rootsOf(after.kind === 'multiPrompt' ? after.anchored : []),
      [repo, path.join(repo, 'sub')],
      'the prompt offers something other than the two workspaces this layout holds',
    );
  });

  // The other half of the same change, and the one that is a plain improvement:
  // a folder carrying no marker of its own but holding two below it reaches
  // NOTHING on the walk, which is the dead end this work removes.
  it('turns a window that reached nothing into one with a choice to make', async () => {
    await write('repo/one/aggregate.yaml');
    await write('repo/two/aggregate.yaml');
    const repo = path.join(tmp, 'repo');
    const open = [folder(repo)];

    const climbed = await findAllAnchoredFolders(open);
    const reached = await workspacesReachedFromAll(open, searchUnder);

    assert.strictEqual(
      classifyActivation(climbed, null).kind, 'none',
      'the walk alone already finds something here, so this is not the dead end',
    );
    assert.strictEqual(classifyActivation(reached, null).kind, 'multiPrompt');
    assert.deepStrictEqual(
      rootsOf(reached),
      [path.join(repo, 'one'), path.join(repo, 'two')],
    );
  });

  // 🔴 AND THE READER WHO REMEMBERS A CHOICE IS NOT ASKED AGAIN, which is what
  // keeps the widening from putting a question in front of everyone who already
  // answered one. Recorded here beside the cost so the two are read together.
  it('does not ask again where the remembered workspace is still among them', async () => {
    await write('repo/aggregate.yaml');
    await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');

    const reached = await workspacesReachedFromAll([folder(repo)], searchUnder);
    const remembered = reached[0].anchorPath;

    assert.strictEqual(classifyActivation(reached, remembered).kind, 'multiSaved');
  });
});
