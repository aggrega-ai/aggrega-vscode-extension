// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  findAllAnchoredFolders,
  rememberedWorkspaceReached,
  workspaceRootOf,
  workspacesReachedFrom,
  workspacesReachedFromAll,
} from '../../src/workspace';
import { buildPickerItems, classifyActivation } from '../../src/anchor-picker';
import { workspaceRow } from '../../src/selector-rows';
import { soleCandidateNote } from '../../src/selector-levels';
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

  // 🔴 THE LAYOUT THE NARROWING IS DRIVEN AGAINST, NAMED IN FULL SO IT CAN BE
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

// 🔴 THE COST OF THE WIDENING, DRIVEN RATHER THAN ASSERTED. Reaching more
// workspaces means a reader may now have to choose where they did not before,
// and that cost is shown by feeding both populations — what the walk alone
// reaches, and what the folder reaches once the search is part of the answer —
// from ONE named layout, so the before and the after are the same window.
//
// 🔴 IT ARRIVES AS AN OFFER AND NOT AS AN INTERRUPTION, WHICH IS THE WHOLE
// DISTINCTION THIS BLOCK EXISTS TO PIN. A window that attaches silently has
// already recorded the workspace it attached to, so when the second candidate
// turns up a moment later that record is still valid and the reader is OFFERED
// the choice — the chooser lists both — rather than being stopped and asked for
// a decision they did not ask to make. Anything here asserting a prompt for that window would be
// asserting the opposite of what the reader meets.
//
// The one window that genuinely IS asked is the second case below: a folder
// with no marker of its own reaches nothing at all today, so it has nothing
// recorded, and two candidates with nothing remembered is a real question.
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
  // first shadows nothing and the second is a workspace of its own.
  it('attaches with no prompt, then OFFERS the second workspace instead of asking for it', async () => {
    await write('repo/aggregate.yaml');
    await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');
    const sub = path.join(repo, 'sub');
    const open = [folder(repo)];

    const climbed = await findAllAnchoredFolders(open);
    const reached = await workspacesReachedFromAll(open, searchUnder);

    // BEFORE: one workspace, so the language server attaches silently and the
    // reader is asked nothing.
    const before = classifyActivation(climbed, null);
    assert.strictEqual(
      before.kind, 'single',
      'this window does not attach silently on the walk alone, so it is not the window this '
      + 'case is about',
    );
    if (before.kind !== 'single') { return; }

    // The silent attach records the workspace this window works in, and it
    // arrives here as an INPUT rather than as something this case asserts was
    // written. Where the record comes from belongs to the path that attaches;
    // what is shown here is what the wider population does once that record
    // exists.
    const remembered = before.target.anchorPath;
    assert.strictEqual(
      remembered, reached[0].anchorPath,
      'the workspace the silent attach settled on is not the first of the ones now reachable, so '
      + 'the offer below would be resting on something other than that attach being remembered',
    );

    // AFTER: two workspaces, with the attached one still among them — so the
    // reader is OFFERED the second rather than stopped and asked to choose.
    const after = classifyActivation(reached, remembered);
    assert.strictEqual(
      after.kind, 'multiSaved',
      'the wider population interrupts the reader for a choice instead of offering it, which '
      + 'takes a decision from someone who never asked to make one',
    );

    // 🔴 THE COST AS A NUMBER: one workspace becomes two. The two assertions
    // are equalities rather than a reading of the text below, because the text
    // is the consequence and this is the thing that changed.
    assert.strictEqual(
      climbed.length, 1,
      'the walk alone does not reach exactly one workspace here, so there is no single-candidate '
      + 'window to show the cost arriving at',
    );
    assert.strictEqual(
      reached.length, 2,
      'the folder does not reach exactly two workspaces, so no second candidate is offered',
    );

    // 🔴 THE COST AS THE READER MEETS IT IS THE CHOOSER. The row's hover says
    // nothing about how many workspaces there are, so it reads the same before
    // and after — both directions are asserted, because a row that changed with
    // the count would be carrying a sentence it does not carry.
    const root = workspaceRootOf(climbed[0]);
    const narrow = workspaceRow(root, repo, climbed.length);
    const wide = workspaceRow(root, repo, reached.length);
    assert.strictEqual(
      narrow.tooltip, wide.tooltip,
      'the row\'s hover changes with how many workspaces are reachable, so it is saying how many '
      + `there are:\n${narrow.tooltip}\n---\n${wide.tooltip}`,
    );
    assert.ok(
      !narrow.tooltip.includes(soleCandidateNote('workspace')),
      `the row says only one workspace is available: ${narrow.tooltip}`,
    );

    // 🔴 AND THE CHOOSER NAMES BOTH, BY PATH. A count a reader cannot expand
    // into two named places is a number with nothing behind it, and the path is
    // what tells two workspaces apart when their trailing names do not.
    assert.deepStrictEqual(
      buildPickerItems(climbed).map((item) => item.description),
      [repo],
      'the chooser offers something other than the one workspace the walk reaches',
    );
    assert.deepStrictEqual(
      buildPickerItems(reached).map((item) => item.description),
      [repo, sub],
      'the chooser does not list both workspaces by path, so the offer names nothing the reader '
      + 'can act on',
    );
  });

  // The other half of the same change, and the one that is a plain improvement:
  // a folder carrying no marker of its own but holding two below it reaches
  // NOTHING on the walk, which is the dead end this work removes.
  //
  // 🔴 THIS IS THE WINDOW THAT IS GENUINELY ASKED, and it is asked for a reason
  // the window above does not share: reaching nothing means nothing was
  // attached, so nothing was recorded, so two candidates arrive with no earlier
  // answer to honour. A question is the right outcome here and the wrong one
  // there, and what separates them is whether anything was already settled.
  //
  // LAYOUT, NAMED SO IT CAN BE RE-DRIVEN BY HAND: a window whose single open
  // folder is <tmp>/repo, which carries NO marker of its own, holding
  // <tmp>/repo/one/aggregate.yaml and <tmp>/repo/two/aggregate.yaml below it.
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
});

// 🔴 A REMEMBERED WORKSPACE IS JUDGED WITH NO SEARCH, AND THE JUDGEMENT IS HELD TO
// THE REACH IT STANDS IN FOR. The window asks whether the workspace it last worked
// in is still reached before the editor's search has answered, by putting the
// reach's two questions to the remembered marker itself. That is a second
// derivation of one population, so every case below computes both — the reach,
// with the search, and the judgement, without it — and holds them to one answer.
describe('a remembered workspace, judged before any search', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-reach-'));
    tmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // judged answers with the folder the judgement carries for `marker`, and the
  // folder the reach lists it under, or null for either that does not reach it.
  async function judged(marker: string, open: readonly string[]): Promise<{ direct: string | null; reach: string | null }> {
    const folders = open.map(folder);
    const direct = await rememberedWorkspaceReached(marker, folders);
    const reach = (await workspacesReachedFromAll(folders, searchUnder)).find((entry) => entry.anchorPath === marker);
    return { direct: direct?.folder.uri.fsPath ?? null, reach: reach?.folder.uri.fsPath ?? null };
  }

  // LAYOUT: open folder <tmp>/repo carrying <tmp>/repo/aggregate.yaml, with
  // <tmp>/repo/sub/release.yaml below it — a heuristic marker, so it shadows
  // nothing and sub is a workspace of its own.
  it('reaches a workspace chosen BELOW the folder, which the walk up never finds', async () => {
    await write('repo/aggregate.yaml');
    const marker = await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');

    assert.ok(
      !(await findAllAnchoredFolders([folder(repo)])).some((entry) => entry.anchorPath === marker),
      'the walk up finds the workspace below, so this case does not show the look inside being asked',
    );
    assert.deepStrictEqual(await judged(marker, [repo]), { direct: repo, reach: repo });
  });

  // LAYOUT: open folder <tmp>/repo holding nothing of its own; a workspace marker
  // at <tmp>/repo/sub/.aggrega-config.yaml.
  it('reaches a workspace below a folder that is no workspace itself', async () => {
    const marker = await write('repo/sub/.aggrega-config.yaml', WORKSPACE_CONFIG);
    const repo = path.join(tmp, 'repo');
    assert.deepStrictEqual(await judged(marker, [repo]), { direct: repo, reach: repo });
  });

  // LAYOUT: open folder <tmp>/repo/docs; the marker at <tmp>/repo/.aggrega-config.yaml.
  it('reaches a workspace ABOVE the folder by the walk', async () => {
    const marker = await write('repo/.aggrega-config.yaml', WORKSPACE_CONFIG);
    const docs = await makeDir('repo/docs');
    assert.deepStrictEqual(await judged(marker, [docs]), { direct: docs, reach: docs });
  });

  // LAYOUT: as the first case, with <tmp>/repo/sub/release.yaml then deleted.
  it('does not reach a remembered workspace whose marker has been deleted', async () => {
    await write('repo/aggregate.yaml');
    const marker = await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');
    assert.deepStrictEqual(await judged(marker, [repo]), { direct: repo, reach: repo }, 'the marker is not reached before it is deleted, so its deletion shows nothing');
    await fs.rm(marker);
    assert.deepStrictEqual(await judged(marker, [repo]), { direct: null, reach: null });
  });

  // LAYOUT: open folder <tmp>/repo carrying a workspace configuration, which wins
  // across directories, and <tmp>/repo/sub/release.yaml below it — the marker below
  // confirms to the root above, so it is no workspace of its own.
  it('does not reach a remembered marker a workspace configuration further up now claims', async () => {
    await write('repo/.aggrega-config.yaml', WORKSPACE_CONFIG);
    const marker = await write('repo/sub/release.yaml');
    const repo = path.join(tmp, 'repo');
    assert.deepStrictEqual(await judged(marker, [repo]), { direct: null, reach: null });
  });

  // LAYOUT: <tmp>/alpha/aggregate.yaml and <tmp>/beta/sub/release.yaml; the window
  // has alpha open, and then both.
  it('does not reach a workspace inside a folder the window does not have open', async () => {
    await write('alpha/aggregate.yaml');
    const marker = await write('beta/sub/release.yaml');
    const alpha = path.join(tmp, 'alpha');
    const beta = path.join(tmp, 'beta');
    assert.deepStrictEqual(await judged(marker, [alpha]), { direct: null, reach: null });
    assert.deepStrictEqual(await judged(marker, [alpha, beta]), { direct: beta, reach: beta });
  });

  // 🔴 EVERY MARKER OF ONE LAYOUT, FROM EVERY CHOICE OF OPEN FOLDERS. The cases
  // above name the shapes; this holds the two derivations to one answer across
  // all of them at once, so a shape added to one derivation alone shows here.
  //
  // LAYOUT: <tmp>/w/.aggrega-config.yaml (workspace); <tmp>/w/svc/release.yaml
  // (shadowed by it); <tmp>/x/aggregate.yaml; <tmp>/x/inner/.aggrega/active-release;
  // <tmp>/x/inner/deep/manifest.yml; <tmp>/y/.aggrega-config.yaml (workspace);
  // <tmp>/y/a/.aggrega-config.yaml (workspace); <tmp>/z/docs, holding nothing.
  it('answers as the reach does for every marker and every choice of open folders', async () => {
    const markers = [
      await write('w/.aggrega-config.yaml', WORKSPACE_CONFIG),
      await write('w/svc/release.yaml'),
      await write('x/aggregate.yaml'),
      path.dirname(await write('x/inner/.aggrega/active-release', 'release.yaml\n')),
      await write('x/inner/deep/manifest.yml'),
      await write('y/.aggrega-config.yaml', WORKSPACE_CONFIG),
      await write('y/a/.aggrega-config.yaml', WORKSPACE_CONFIG),
    ];
    await makeDir('z/docs');
    const choices = [['w'], ['w/svc'], ['x'], ['x/inner'], ['y'], ['y/a'], ['z/docs'], ['x', 'y'], ['y', 'x'], ['z/docs', 'w/svc']];
    let reachedSomewhere = 0;
    for (const choice of choices) {
      const open = choice.map((rel) => path.join(tmp, rel));
      for (const marker of markers) {
        const answer = await judged(marker, open);
        assert.deepStrictEqual(answer.direct, answer.reach, `${path.relative(tmp, marker)} judged from ${JSON.stringify(choice)}`);
        if (answer.reach !== null) { reachedSomewhere += 1; }
      }
    }
    // The control on the sweep: a sweep in which nothing was ever reached would
    // agree with itself by answering null everywhere.
    assert.ok(reachedSomewhere > 0, 'no marker was reached from any choice, so the agreement above compared nothing');
  });
});
