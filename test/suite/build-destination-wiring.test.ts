// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { blockAfter, sourceOf } from '../helpers/graph-refresh-census';

// Where a build writes is composed from two ambient facts — the workspace root
// the language server answered with, and the folder the reader works from — and
// the module that holds both imports the editor, so the composition cannot be
// driven from here. What the composition PRODUCES for a given pair is read back
// exactly in the build-dials specs; what this file reads is that the production
// is wired in at all, and which fact each side of it takes.
//
// 🔴 WITHOUT THIS THE OTHER SPECS PASS ON A FEATURE NOTHING INVOKES. A request
// composer that is never called still composes correctly when a test calls it,
// and every gate agrees the code is present — which is the exact shape of a
// capability that ships dead.
//
// 🔴 AND WHICH FOLDER IS READ IS THE OTHER HALF, because the two candidates
// differ in a state the reader can reach: with several folders open and none
// chosen, the folder the anchoring settled on has a value and the folder the
// reader chose does not. Reading the first would name a folder nobody picked;
// the second names nothing, and naming nothing is what makes the compiler write
// where a build run at the workspace root writes.

const EXTENSION = 'src/extension.ts';

// The two composition sites, named by the function that holds each.
const BUILD_REQUEST = 'async function requestBuild(';
const PREVIEW_REQUEST = 'async function requestBuildPreview(';

// THE CHOSEN folder and THE ANCHORING'S folder, as they are spelled where the
// wiring is read. They are written out rather than imported because the modules
// that declare them import the editor.
const CHOSEN_FOLDER = 'chosenProjectFolder';
const ANCHORING_FOLDER = 'openedProjectFolder';
const ANCHORED_ROOT = 'anchoredWorkspaceRoot()';
const DESTINATION_RULE = 'outputDirFor(';

describe('what tells a build request where to write', () => {
  it('composes the destination from the chosen folder and the root the server answered with', () => {
    const source = sourceOf(EXTENSION);
    const block = blockAfter(source, BUILD_REQUEST);
    assert.ok(
      block !== null,
      `${BUILD_REQUEST} was not found in ${EXTENSION}, so every reading below is about a `
      + 'block that does not exist',
    );
    // The needle on the extraction itself. A brace match that stopped short
    // would report a clean absence for every claim made over it, so the block is
    // required to reach the request it ends with before anything is concluded
    // from what it contains.
    assert.ok(
      block.includes("'aggrega/build'"),
      'the extracted block does not reach the request it ends with, so the brace match is '
      + 'wrong and nothing measured over it means anything',
    );
    assert.ok(
      block.includes(DESTINATION_RULE),
      'a build request no longer composes a destination at all, so the folder the reader '
      + 'works from reaches the compiler nowhere and every build writes at the workspace root',
    );
    assert.ok(
      block.includes(CHOSEN_FOLDER),
      'the destination is no longer derived from the folder the reader CHOSE',
    );
    assert.ok(
      block.includes(ANCHORED_ROOT),
      'the destination is no longer taken relative to the root the language server answered '
      + 'with, so it may be relative to a different place than the Release path in the same request',
    );
    // 🔴 AND THE OTHER CANDIDATE IS ABSENT. This is the half that would fail
    // silently: reading the anchoring's own folder produces a correct-looking
    // value in every window with one folder open, and names a folder nobody
    // chose in the one window where the two differ.
    assert.ok(
      !block.includes(ANCHORING_FOLDER),
      'the destination is derived from the folder the anchoring settled on rather than the '
      + 'one the reader chose, which names an unchosen folder wherever the two differ',
    );
    // A negative control on that absence: the token IS present in this module,
    // so the reading above measures the block rather than a search over a name
    // that occurs nowhere.
    assert.ok(
      source.includes(ANCHORING_FOLDER),
      `${ANCHORING_FOLDER} occurs nowhere in ${EXTENSION}, so its absence from the block `
      + 'above proves nothing',
    );
  });

  it('composes no destination for a preview, which writes nothing to have one', () => {
    const source = sourceOf(EXTENSION);
    const block = blockAfter(source, PREVIEW_REQUEST);
    assert.ok(
      block !== null,
      `${PREVIEW_REQUEST} was not found in ${EXTENSION}, so the reading below is about a `
      + 'block that does not exist',
    );
    assert.ok(
      block.includes("'aggrega/buildPreview'"),
      'the extracted block does not reach the request it ends with, so the brace match is '
      + 'wrong and nothing measured over it means anything',
    );
    // A preview reports what a build would write and writes none of it, so it
    // has no destination to name. The declared parameter type already refuses
    // the key; this is the wiring saying the same thing, so a destination cannot
    // arrive here by being computed and then discarded.
    assert.ok(
      !block.includes(DESTINATION_RULE),
      'a preview request composes a destination, and a request that writes nothing has '
      + 'nowhere to write it',
    );
    // The negative control the absence needs: the same reading over the BUILD's
    // block finds the rule, so a clean absence here is about the preview rather
    // than about a pattern that never matches.
    const buildBlock = blockAfter(source, BUILD_REQUEST);
    assert.ok(
      buildBlock !== null && buildBlock.includes(DESTINATION_RULE),
      'the destination rule is found in neither block, so its absence from the preview '
      + 'measures nothing',
    );
  });
});
