// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import {
  assignmentsTo,
  callArguments,
  functionBody,
  nulledIn,
} from '../helpers/anchoring-census';

// 🔴 THESE ARE SOURCE READINGS BECAUSE THE SITES THEY MEASURE CANNOT BE DRIVEN
// HERE. The module holding the activation sequence imports the editor, which
// does not start in a headless run, so no spec can call it — and a spec that
// called the pure helpers instead would pass while the sequence around them was
// wrong. What IS reachable is the source, and reading it keeps the ordering a
// measured claim rather than an unwitnessed one.
//
// Each reading is an EQUALITY against a recorded shape, which is its own
// control: an extraction that stopped working returns an empty list or throws,
// and neither is the recorded shape.

// The two functions the sequence turns on, named once so a reading scoped to
// either is scoped by its real header rather than by a guess.
const REACTIVATE = 'async function reactivate(context: vscode.ExtensionContext): Promise<void>';
const COMPLETE = 'async function completeReachableWorkspaces(';

describe('activation does not wait on the editor\'s file search', () => {
  it('awaits the walk and hands the fuller population to a step it does not await', () => {
    const body = functionBody('src/extension.ts', REACTIVATE);

    // 🔴 THE NEEDLE ON THE BLOCK, first, because everything below is a claim
    // about this text. A scan that ran past the function would swallow the rest
    // of the module and pass whatever was written; one that stopped short would
    // fail. These name statements the real body opens and closes with.
    assert.ok(
      body.includes('const generation = (folderEvaluation += 1);'),
      `the scanned body does not begin where the function does; it was:\n${body}`,
    );
    assert.ok(
      body.trim().endsWith('void tellWorkspaceSitsAbove(context);'),
      `the scanned body does not end where the function does; it was:\n${body}`,
    );

    // The walk is awaited: where the language server goes is settled before
    // anything returns.
    assert.ok(
      body.includes('const anchored = await findAllAnchoredFolders(scope);'),
      'the walk is no longer what settles the immediate answer',
    );

    // 🔴 AND SO IS THE REMEMBERED WORKSPACE, ASKED OF ITS OWN MARKER WITH NO SEARCH
    // HANDED TO IT. A remembered choice is judged against everything the folder
    // reaches, the look inside included; were that judgement handed the editor's
    // search, a start would wait on the glob this clause refuses, by another route.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'rememberedWorkspaceReached'),
      [['savedAnchor', 'scope']],
      'the remembered workspace is judged with something other than its marker and the folders in '
      + 'scope — a search among them would make every start wait on it',
    );
    assert.ok(
      body.includes('await rememberedWorkspaceReached(savedAnchor, scope)'),
      `the remembered workspace is not judged in the activation sequence; the body was:\n${body}`,
    );
    // The judgement is what decides the drop, so a choice made below the folder
    // is not dropped and said to be dropped on every start.
    assert.ok(
      body.includes('if (savedAnchor !== null && remembered === null) {'),
      `the remembered choice is dropped on something other than that judgement; the body was:\n${body}`,
    );

    // 🔴 AND THE SEARCH IS NOT AWAITED. This is the whole clause: a start that
    // waited on a glob across everything the window holds would pay for a
    // candidate list only a panel reads, in a window where the answer is
    // usually one.
    assert.ok(
      body.includes('void completeReachableWorkspaces('),
      'the fuller population is not completed at all',
    );
    assert.ok(
      !body.includes('await completeReachableWorkspaces('),
      'activation now waits on the editor\'s file search, so every start pays for a candidate '
      + 'list before the language server is allowed to begin',
    );
  });

  it('issues the per-folder search only from the step that runs after attachment', () => {
    // The search reaches the discovery rule through exactly one call, and that
    // call is inside the step that runs afterwards. A second one on the
    // attaching path would be the delay this clause refuses, arriving by another
    // route.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'workspacesReachedFromAll'),
      [['scope', 'candidateFilesUnder']],
      'the reach is computed somewhere other than the step that runs after attachment, or with '
      + 'something other than the per-folder search',
    );

    const body = functionBody('src/extension.ts', COMPLETE);
    assert.ok(
      body.includes('await workspacesReachedFromAll(scope, candidateFilesUnder)'),
      `the completing step computes no reach; its body was:\n${body}`,
    );
  });

  it('refreshes the surfaces that report a count once the fuller population arrives', () => {
    const body = functionBody('src/extension.ts', COMPLETE);
    // The panel is what reports how many candidates the middle level has, so it
    // is the surface that has to catch up. The other two are refreshed with it
    // for the reason the attaching path refreshes all three: two of the four
    // activation branches build no client, so nothing else would fire.
    for (const surface of ['operationsView?.refresh()', 'daemonStatusBar?.refresh()', 'refreshGetStarted?.()']) {
      assert.ok(
        body.includes(surface),
        `${surface} is not reached when the fuller population arrives, so that surface goes on `
        + `reporting the walk's count`,
      );
    }
  });

  it('drops a late answer that is no longer about the window it was asked for', () => {
    const body = functionBody('src/extension.ts', COMPLETE);
    // The search outlives the evaluation that started it. Without this the
    // window would be told about the folders it used to have.
    assert.ok(
      body.includes('if (generation !== folderEvaluation) { return; }'),
      `a late answer is applied over a newer one; the body was:\n${body}`,
    );
  });

  it('republishes nothing where the fuller population names the same workspaces', () => {
    const body = functionBody('src/extension.ts', COMPLETE);
    assert.ok(
      body.includes('if (sameWorkspaces(reached, currentAnchored)) { return; }'),
      `the ordinary window, which reaches one workspace by both routes, redraws every surface `
      + `to report a number none of them has changed; the body was:\n${body}`,
    );
  });
});

describe('attaching returns early only where nothing would change', () => {
  it('compares the opened folder and the workspace, through the one guard, and nothing else', () => {
    const body = functionBody('src/extension.ts', 'async function ensureDaemonAt(');
    // The needle on the block: the scanned body is the function's own.
    assert.ok(
      body.includes('const anchoring = windowAnchoring(target);'),
      `the scanned body does not begin where the function does; it was:\n${body}`,
    );
    // 🔴 ONE CALL, WITH THE TWO ATTACHMENTS. isAttachedTo is where both halves of the
    // comparison are, and they are driven there; this is what says the early return
    // is that comparison rather than one written beside it.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'isAttachedTo'),
      [['activeAnchored', 'target']],
      'the guard against attaching again is not the one comparison of the attachment in use and '
      + 'the one asked for',
    );
    assert.ok(
      body.includes('if (daemon && isAttachedTo(activeAnchored, target)) {'),
      `attaching does not return early on that comparison; the body was:\n${body}`,
    );
    // And no half of it is made again here: a comparison of the folder or the
    // marker in use written beside the guard is how one half would come to be
    // judged twice and the other not at all.
    for (const half of ['activeAnchored?.folder', 'activeAnchored?.anchorPath', 'activeAnchored.folder', 'activeAnchored.anchorPath']) {
      assert.ok(!body.includes(half), `${half} is compared beside the guard; the body was:\n${body}`);
    }
  });
});

describe('the outer level is a decision and never an outcome', () => {
  it('is written exactly once, from the folder in force and from nothing else', () => {
    // 🔴 THE DERIVATION BEING REFUSED, READ AS AN EQUALITY OVER EVERY WRITE. An
    // absence reading over the word "anchoring" was tried here first and was
    // shown to be decoration: a second assignment taking openedProjectFolder —
    // the module-level value the anchoring had already been written to — carries
    // the derivation in without ever naming it, and the absence stayed green.
    // Every right-hand side is recorded instead, so a second write is a second
    // entry whatever it is spelled.
    assert.deepStrictEqual(
      assignmentsTo('src/extension.ts', 'chosenProjectFolder'),
      ['inForce?.uri.fsPath ?? null'],
      'the outer level is written from something other than the reader\'s own choice, or is '
      + 'written more than once — either way it has become a consequence of the level beneath it',
    );

    // The control on the extraction, because the equality above is a list: a
    // reading that had stopped working would return an empty one, and so would a
    // value that was never assigned. The two facts of the anchoring are
    // certainly assigned, so their presence says the instrument fires.
    assert.deepStrictEqual(
      assignmentsTo('src/extension.ts', 'openedProjectFolder'),
      ['anchoring.openedFolder', 'null'],
      'the census reads no assignment to a value that certainly has them, so its findings about '
      + 'the outer level mean nothing',
    );
  });

  it('survives the language server going down, because a choice is not a connection', () => {
    // 🔴 THE WHOLE SET IS RECORDED RATHER THAN THE ABSENCE ALONE, for the reason
    // the handshake census records its own: filtering would accept a value
    // quietly joining or leaving, and the claim is about what is dropped as one
    // thing and what is not dropped at all.
    const dropped = nulledIn('src/extension.ts', 'async function stopDaemon(');
    // The record of a start that failed is among them: a teardown the extension
    // chose leaves nothing it ran to have failed.
    assert.deepStrictEqual(
      dropped,
      ['activeAnchored', 'daemon', 'droppedStartFailure', 'openedProjectFolder', 'workspaceRootForCommands'],
      'the set of values dropped with the language server has moved',
    );
    assert.ok(
      !dropped.includes('chosenProjectFolder'),
      'the reader\'s chosen folder is thrown away when a language server stops, so an answer '
      + 'they gave is discarded by something that has nothing to do with it',
    );
  });
});
