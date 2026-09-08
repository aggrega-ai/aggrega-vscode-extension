// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import {
  AUTO_PULL_DIAL,
  BUILD_DIALS,
  buildParams,
  buildPreviewParams,
  dialsTurnedOn,
} from '../../src/build-dials';

// The composition holds no editor type, so what each request carries is read
// back exactly. What no test in this repository can reach is what the language
// server then DOES with it: that a build actually resolves dependencies when the
// parameter is on is the compiler's own behaviour, asserted on the compiler's
// side. What is provable here is that a reader's adjustment reaches the request
// and that the preview's never does, which is the half that regresses silently.

const RELEASE = 'releases/prod.yaml';

// RULED_ON is the adjustment set with the one adjustment turned on, and
// RULED_PARAMS is what a build then carries — both WRITTEN OUT LITERALLY rather
// than derived from the module under test.
//
// 🔴 THE INDEPENDENCE IS THE POINT AND IT IS EASY TO LOSE. A comparison whose
// expected side reads the same constants the implementation reads agrees with
// itself whatever those constants say: a parameter renamed on both sides at once
// composes a request the compiler does not read, and such a comparison passes.
// Measured on this surface, so the literals below are the deliberate decision
// recorded in this file rather than a consequence nobody reviewed.
const RULED_ON = ['autoPull'];
const RULED_PARAMS_ON = { release: RELEASE, autoPull: true };
const RULED_PARAMS_OFF = { release: RELEASE, autoPull: false };

// RULED_PREVIEW_KEYS is every key a preview request may carry. One entry, and
// the count is the assertion — see the clause that uses it.
const RULED_PREVIEW_KEYS = ['release'];

describe('the adjustments a build offers', () => {
  it('offers exactly one, and it is the dependency fill', () => {
    // 🔴 ONE, ASSERTED AS A COUNT RATHER THAN AS A MEMBERSHIP. The panel is a
    // caret opening a short list, and a second adjustment is a decision
    // somebody has to take rather than something that arrives — so an
    // adjustment gained is a failure here and a diff in this file, which is
    // what keeps the surface from growing unreviewed.
    assert.strictEqual(
      BUILD_DIALS.length, RULED_ON.length,
      'the build offers a number of adjustments other than the one ruled',
    );
    assert.deepStrictEqual(
      BUILD_DIALS.map((dial) => dial.id), RULED_ON,
      'the build offers a different adjustment, or offers them in a different order',
    );
  });

  it('names each adjustment by what it DOES, never by a command-line spelling', () => {
    // 🔴 A READER OF THIS PANEL HAS AUTHORED NO FLAGS. A flag's name is a word
    // they have nowhere to look up, and an adjustment named after a parameter
    // teaches the parameter rather than the effect. The words are the reader's
    // own — both reconduct to a control the panel already carries, whose own
    // explanation says it pulls remote dependencies into the workspace.
    assert.deepStrictEqual(
      BUILD_DIALS.map((dial) => dial.label),
      ['Pull dependencies first'],
      'an adjustment reads differently from the words ruled for it',
    );
    assert.deepStrictEqual(
      BUILD_DIALS.map((dial) => dial.detail),
      [
        "Resolve the Release's dependencies into the lockfile before rendering, "
        + 'then build against them',
      ],
      'an adjustment explains itself differently from the words ruled for it',
    );
    // And no reader-visible word carries a flag's spelling, in any of the three
    // forms one could arrive in: the flag itself, the leading dashes of any
    // flag, or the parameter the request composes.
    for (const dial of BUILD_DIALS) {
      for (const word of [dial.label, dial.detail]) {
        assert.ok(!word.includes('--'), `${dial.id} shows a command-line flag: ${word}`);
        assert.ok(!word.includes('auto-pull'), `${dial.id} shows a flag's name: ${word}`);
        assert.ok(
          !word.includes(AUTO_PULL_DIAL),
          `${dial.id} shows the parameter its request composes: ${word}`,
        );
      }
    }
    // A negative control on those three absences: the words being read are not
    // empty, so a zero above measures the words rather than a search over
    // nothing.
    assert.ok(
      BUILD_DIALS.every((dial) => dial.label.length > 0 && dial.detail.length > 0),
      'an adjustment reads nothing at all, so the absences above prove nothing',
    );
  });
});

describe('what a build request carries', () => {
  it('carries the adjustment ON when the reader turned it on', () => {
    // 🔴 THE ASSERTION IS THE WHOLE PARAMETER SET, NOT THE PRESENCE OF ONE KEY.
    // A presence check is satisfied by a request that also carries three things
    // it should not, and it was measured passing a real planted defect on this
    // surface. An equality over the whole object cannot: a key gained, a key
    // lost, a value wrong, or a spelling changed all fail it.
    assert.deepStrictEqual(
      buildParams(RELEASE, RULED_ON), RULED_PARAMS_ON,
      'a build with the adjustment turned on sends something other than the ruled parameters',
    );
  });

  it('carries the adjustment OFF when the reader touched nothing', () => {
    // 🔴 EXPLICITLY OFF RATHER THAN ABSENT, AND THAT IS A DECISION. The compiler
    // reads an absent parameter and an explicit off identically, so stating it
    // costs nothing — and what it buys is that a reader's setting is visible in
    // the request itself. Carried only when on, "the reader left it alone" and
    // "this client does not know about the parameter" would be the same bytes,
    // and those are different facts.
    assert.deepStrictEqual(
      buildParams(RELEASE, []), RULED_PARAMS_OFF,
      'a build with nothing adjusted sends something other than the ruled parameters',
    );
    // The default is OFF because the command line's own default is off. That
    // parity is the ground rather than a convenience: the two surfaces perform
    // one operation, so a reader who has learnt what a plain build does in a
    // terminal must not meet a different build here.
    assert.strictEqual(
      buildParams(RELEASE, [])[AUTO_PULL_DIAL], false,
      'a build nobody adjusted resolves dependencies, which is not what a plain build does',
    );
  });

  it('carries the release under the key the request takes, at both values', () => {
    // The key set is the same whichever way the adjustment is set, so a reader
    // turning one on does not change the SHAPE of the request — only a value in
    // it. A shape that moved would be two request shapes for one operation.
    for (const on of [[], RULED_ON]) {
      assert.deepStrictEqual(
        Object.keys(buildParams(RELEASE, on)).sort(),
        ['autoPull', 'release'],
        'a build request carries a different set of keys depending on what was adjusted',
      );
    }
  });
});

describe('what a preview request carries', () => {
  it('🔴 CARRIES THE RELEASE AND NOTHING ELSE, asserted as an exact key set', () => {
    // 🔴 THIS IS THE FAILURE MOST LIKELY TO SHIP UNNOTICED, AND WHY THE
    // ASSERTION TAKES THIS SHAPE. Resolving dependencies writes the lockfile;
    // this request reports what a build would write and writes none of it. The
    // two cannot both be honoured, so the compiler refuses the pairing — and a
    // build adjustment leaking in here would put that refusal in front of a
    // reader for a combination they never authored and cannot see.
    //
    // An exact key-set equality is what catches it. A check that the adjustment
    // is ABSENT would pass a request carrying some other surplus key, and a
    // check that the release is PRESENT would pass a request carrying both. The
    // equality admits neither.
    assert.deepStrictEqual(
      Object.keys(buildPreviewParams(RELEASE)),
      RULED_PREVIEW_KEYS,
      'a preview request carries a key other than the release, or is missing it',
    );
    assert.deepStrictEqual(
      buildPreviewParams(RELEASE), { release: RELEASE },
      'a preview request sends something other than the release it was given',
    );
    // A negative control on the instrument: the same reading over the BUILD's
    // parameters returns more than one key, so the single-key result above
    // measures the preview rather than a reading that can only ever see one.
    assert.ok(
      Object.keys(buildParams(RELEASE, RULED_ON)).length > RULED_PREVIEW_KEYS.length,
      'the key reading cannot see a second key where one exists, so its count above means nothing',
    );
  });

  it('has no channel an adjustment could arrive through at all', () => {
    // The strongest form of the guarantee above, and it is not an assertion
    // about a value: the composition takes one argument, so there is no
    // parameter for an adjustment to be passed in. A leak would have to be a
    // key written into the composition by hand — which the declared return type
    // refuses, so it is a compile error rather than something a reviewer has to
    // notice.
    assert.strictEqual(
      buildPreviewParams.length, 1,
      'the preview composition takes a second argument, so an adjustment now has a way in',
    );
  });
});

describe('an adjustment set recorded by a drawing that has since moved on', () => {
  it('narrows to the adjustments the build actually offers', () => {
    // The recorded set arrives from a document the panel drew, and a document
    // drawn by an earlier version of this extension — or one whose adjustment
    // has since been withdrawn — would otherwise carry a value into a request
    // the compiler no longer reads.
    assert.deepStrictEqual(
      dialsTurnedOn(['somethingWithdrawn']), [],
      'a value the build does not offer survived into the set a request is composed from',
    );
    assert.deepStrictEqual(
      dialsTurnedOn([...RULED_ON, 'somethingWithdrawn']), RULED_ON,
      'a recorded set holding one offered value and one withdrawn one did not narrow to the offered one',
    );
    // Anything at all can arrive on a message from a document, so nothing about
    // the recorded set is trusted — not even that its entries are strings.
    assert.deepStrictEqual(
      dialsTurnedOn([null, 7, {}, undefined]), [],
      'a recorded set holding no string at all produced an adjustment',
    );
    // And the composition of what survives is what a request then carries, so
    // the narrowing is not a cosmetic filter on a set nothing reads.
    assert.deepStrictEqual(
      buildParams(RELEASE, dialsTurnedOn(['somethingWithdrawn'])), RULED_PARAMS_OFF,
      'a withdrawn value reached the request through the narrowing',
    );
    assert.deepStrictEqual(
      buildParams(RELEASE, dialsTurnedOn([...RULED_ON, 'somethingWithdrawn'])), RULED_PARAMS_ON,
      'an offered value was lost by the narrowing',
    );
  });

  it('resolves duplicates and order against the declared set', () => {
    // One recorded set has one composition, whatever order or repetition it
    // arrived in — so a document that recorded the same adjustment twice cannot
    // produce a set a comparison elsewhere would read as different.
    assert.deepStrictEqual(
      dialsTurnedOn([...RULED_ON, ...RULED_ON]), RULED_ON,
      'a repeated value produced a set holding it twice',
    );
    assert.deepStrictEqual(
      dialsTurnedOn([...RULED_ON].reverse()), RULED_ON,
      'the recorded order decides the composed order rather than the declared set doing so',
    );
  });
});
