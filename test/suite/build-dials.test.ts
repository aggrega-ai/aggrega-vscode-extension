// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  AUTO_PULL_DIAL,
  BUILD_DIALS,
  BuildPreviewRequestParams,
  buildParams,
  buildPreviewParams,
  dialsTurnedOn,
} from '../../src/build-dials';
import { outputDirFor, releaseParamFor } from '../../src/workspace';

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

// NOWHERE is the destination argument for a build that names none: the editor
// could not say where the reader is standing, so the request says nothing and
// the compiler writes where a build run at the workspace root writes. Spelled
// as a named constant rather than as a bare null at each call so what the value
// MEANS is readable at the call site.
const NOWHERE = null;

// The fixture the destination clauses are read against: a workspace root with
// the authoring documents in a subdirectory, which is the shape this whole
// parameter exists for. Built with the host's own separator so the readings are
// about the rule rather than about a platform.
const ROOT = path.join(path.sep === '\\' ? 'C:\\' : '/', 'tmp', 'fixture', 'R');
const DOCS = path.join(ROOT, 'docs');
const RELEASE_UNDER_DOCS = path.join(DOCS, 'release-bare.yaml');

// RULED_DOCS_DESTINATION is the value a window opened on the subdirectory sends,
// WRITTEN OUT LITERALLY for the reason the parameter literals above are: a
// comparison against the conversion's own output agrees with itself whatever the
// conversion does.
const RULED_DOCS_DESTINATION = 'docs';
// RULED_ROOT_DESTINATION is what a window opened on the root itself sends. It is
// the empty string, and that is a location rather than a gap — the root IS where
// that reader is standing, and the compiler reads an empty destination as the
// place a build run at the root writes. It is carried rather than dropped so the
// request states the reader's location in both cases.
const RULED_ROOT_DESTINATION = '';
// RULED_RELEASE_FROM_DOCS is the Release parameter for a document under the
// subdirectory, with the root ABOVE it. Written out literally for the same
// reason, and it is the case the whole chain exists for: a request composed only
// where root and opened folder coincide proves nothing about it.
const RULED_RELEASE_FROM_DOCS = path.join('docs', 'release-bare.yaml');

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

  it('words each adjustment for reading, never in a flag or parameter spelling', () => {
    // 🔴 THE CORRESPONDENCE IS INTENDED; WHAT IS GUARDED IS THE SPELLING. The
    // same operation is reachable from a terminal, so the label is the command
    // line's name for it, worded for reading rather than typed: a reader who
    // has met it there must be able to recognise it here. What no
    // reader-visible word may carry is the form one types or sends — a reader
    // of this panel has authored no flags, so a dashed spelling, or the
    // parameter a request composes, is a word they have nowhere to look up.
    // The words themselves are the reader's own: both reconduct to a control
    // the panel already carries, whose own explanation says it pulls remote
    // dependencies into the workspace.
    assert.deepStrictEqual(
      BUILD_DIALS.map((dial) => dial.label),
      ['Auto pull'],
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
      buildParams(RELEASE, RULED_ON, NOWHERE), RULED_PARAMS_ON,
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
      buildParams(RELEASE, [], NOWHERE), RULED_PARAMS_OFF,
      'a build with nothing adjusted sends something other than the ruled parameters',
    );
    // The default is OFF because the command line's own default is off. That
    // parity is the ground rather than a convenience: the two surfaces perform
    // one operation, so a reader who has learnt what a plain build does in a
    // terminal must not meet a different build here.
    assert.strictEqual(
      buildParams(RELEASE, [], NOWHERE)[AUTO_PULL_DIAL], false,
      'a build nobody adjusted resolves dependencies, which is not what a plain build does',
    );
  });

  it('carries the release under the key the request takes, at both values', () => {
    // The key set is the same whichever way the adjustment is set, so a reader
    // turning one on does not change the SHAPE of the request — only a value in
    // it. A shape that moved would be two request shapes for one operation.
    for (const on of [[], RULED_ON]) {
      assert.deepStrictEqual(
        Object.keys(buildParams(RELEASE, on, NOWHERE)).sort(),
        ['autoPull', 'release'],
        'a build request carries a different set of keys depending on what was adjusted',
      );
    }
  });
});

describe('where a build request says it writes', () => {
  it('names the folder the reader works from, relative to the workspace root', () => {
    // 🔴 THE CASE THE PARAMETER EXISTS FOR IS THE ONE WHERE THE ROOT IS ABOVE
    // THE FOLDER, so that is what is driven. A reading taken where the two
    // coincide would pass on a conversion that does nothing at all.
    assert.strictEqual(
      outputDirFor(ROOT, DOCS), RULED_DOCS_DESTINATION,
      'the folder the reader works from is not named the way the request takes it',
    );
    // And the whole composed request, as an equality over every key rather than
    // a presence check on the new one. A presence check is satisfied by a
    // request that also carries things it should not, and it was measured
    // passing a real planted defect on this surface.
    assert.deepStrictEqual(
      buildParams(RELEASE, [], outputDirFor(ROOT, DOCS)),
      { release: RELEASE, autoPull: false, outputDir: RULED_DOCS_DESTINATION },
      'a build from a window opened on the subdirectory sends something other than the ruled request',
    );
  });

  it('names the root as the empty destination when that is where the reader is', () => {
    // 🔴 EMPTY IS A LOCATION, NOT A GAP, AND IT IS SENT RATHER THAN DROPPED.
    // The root is where that reader is standing, and the compiler reads an empty
    // destination as the place a build run at the root writes — so the value is
    // carried, and the request states the reader's location in this case exactly
    // as it does in the one above.
    assert.strictEqual(
      outputDirFor(ROOT, ROOT), RULED_ROOT_DESTINATION,
      'a window opened on the root itself produces something other than the ruled destination',
    );
    assert.deepStrictEqual(
      buildParams(RELEASE, [], outputDirFor(ROOT, ROOT)),
      { release: RELEASE, autoPull: false, outputDir: RULED_ROOT_DESTINATION },
      'a build from a window opened on the root sends something other than the ruled request',
    );
    // 🔴 AND THE KEY IS PRESENT, asserted separately because the equality above
    // cannot tell an empty value from an absent one: deepStrictEqual on plain
    // objects compares own keys, and an absent key against a key holding the
    // empty string is exactly the difference at stake. The two facts this
    // distinguishes are "the reader is standing at the root" and "the editor
    // cannot tell where they are standing", and they go to the compiler as the
    // same destination but are not the same statement.
    assert.ok(
      'outputDir' in buildParams(RELEASE, [], outputDirFor(ROOT, ROOT)),
      'a reader standing at the root sends no destination at all, which is the state '
      + 'reserved for the editor not knowing where they are',
    );
  });

  it('says nothing at all where nothing can be said', () => {
    // 🔴 THE OMISSION IS THE RULED ANSWER FOR "NOBODY CHOSE", not a fallback.
    // A window with several folders open and none chosen has no folder the
    // reader is standing in; a request naming one of them would report a choice
    // nobody made. Each null argument below is a state the editor is really in.
    assert.strictEqual(
      outputDirFor(ROOT, null), NOWHERE,
      'a window where nothing is chosen produced a destination anyway',
    );
    assert.strictEqual(
      outputDirFor(null, DOCS), NOWHERE,
      'a destination was produced against no workspace root to name it relative to',
    );
    // The same answer covers the case where the two facts do not relate: the
    // folder in force outlives the language server while the root is read from
    // the running server, so between a switch and the server standing back up
    // they can name places with no containment between them. A value that climbs
    // out would be refused on arrival, and a refusal for something the reader
    // never authored is worse than the default they would otherwise have got.
    assert.strictEqual(
      outputDirFor(DOCS, ROOT), NOWHERE,
      'a destination climbing out of the workspace root was composed rather than withheld',
    );
    assert.strictEqual(
      outputDirFor(ROOT, path.join(path.dirname(ROOT), 'R-elsewhere')), NOWHERE,
      'a sibling whose name merely extends the root was accepted, which a prefix test would do',
    );
    // A negative control on all five: the same reading over a folder that IS
    // inside the root returns a value, so the nulls above measure the rule
    // rather than a function that can only ever answer null.
    assert.strictEqual(
      outputDirFor(ROOT, DOCS), RULED_DOCS_DESTINATION,
      'the destination rule answers null for everything, so the withholdings above mean nothing',
    );
    // And the composed request drops the key rather than carrying it empty or
    // undefined, so what travels is a request that never mentions a destination.
    assert.deepStrictEqual(
      Object.keys(buildParams(RELEASE, [], outputDirFor(ROOT, null))).sort(),
      ['autoPull', 'release'],
      'a build that can name no destination still carries the destination key',
    );
  });

  it('🔴 composes the Release against the root too, with the root ABOVE the opened folder', () => {
    // The Release parameter and the destination are relative to the SAME root,
    // and this is the scenario that separates a working chain from one that only
    // looks like it works: with the root above the opened folder, a Release path
    // taken from the editor is neither already-relative nor relative to the
    // right place. A build that works only where the two coincide proves nothing
    // about the case this whole chain exists for.
    assert.strictEqual(
      releaseParamFor(ROOT, RELEASE_UNDER_DOCS), RULED_RELEASE_FROM_DOCS,
      'a Release under the opened folder is not named relative to the workspace root above it',
    );
    assert.deepStrictEqual(
      buildParams(
        releaseParamFor(ROOT, RELEASE_UNDER_DOCS) ?? '',
        [],
        outputDirFor(ROOT, DOCS),
      ),
      {
        release: RULED_RELEASE_FROM_DOCS,
        autoPull: false,
        outputDir: RULED_DOCS_DESTINATION,
      },
      'the composed request names the Release or the destination against something other '
      + 'than the workspace root',
    );
    // 🔴 NEITHER VALUE IS ABSOLUTE, asserted directly, because an absolute one
    // is what the compiler refuses outright — and the editor holds the absolute
    // form, so this is the conversion failing rather than a value being odd.
    const composed = buildParams(
      releaseParamFor(ROOT, RELEASE_UNDER_DOCS) ?? '',
      [],
      outputDirFor(ROOT, DOCS),
    );
    assert.ok(
      !path.isAbsolute(composed.release),
      'the composed request carries an absolute Release path, which the compiler refuses',
    );
    assert.ok(
      composed.outputDir !== undefined && !path.isAbsolute(composed.outputDir),
      'the composed request carries an absolute destination, which the compiler refuses',
    );
    // A negative control on the two absence readings: the values they were taken
    // over are the absolute forms the editor actually holds, and those ARE
    // absolute — so the readings above measure the conversion rather than a test
    // that can only ever see a relative path.
    assert.ok(
      path.isAbsolute(RELEASE_UNDER_DOCS) && path.isAbsolute(DOCS),
      'the fixture paths are not absolute, so the conversion above converted nothing',
    );
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
      Object.keys(buildParams(RELEASE, RULED_ON, NOWHERE)).length > RULED_PREVIEW_KEYS.length,
      'the key reading cannot see a second key where one exists, so its count above means nothing',
    );
  });

  it('🔴 CANNOT BE ANNOTATED WITH A DESTINATION, and that is a compile error rather than a runtime one', () => {
    // A preview writes nothing, so it has no destination to name. The guarantee
    // is the declared type, and it is asserted where a type guarantee can be:
    // the directive below FAILS THE COMPILE IF THE LINE COMPILES, so this
    // assertion is checked rather than merely written down. That is the needle
    // the claim needs — remove the surplus key and the compiler reports the
    // directive as unused, which is how the reading is known to fire.
    const previewWithDestination: BuildPreviewRequestParams = {
      release: RELEASE,
      // @ts-expect-error a preview request writes nothing, so it names no destination
      outputDir: RULED_DOCS_DESTINATION,
    };
    // The composed value is read so the declaration is not dead code, and what
    // is read is the one key a preview may carry.
    assert.strictEqual(
      previewWithDestination.release, RELEASE,
      'the annotated preview does not carry the Release it was written with',
    );
    // And the composition itself, which is the shape the extension actually
    // sends, still carries that key and no other.
    assert.deepStrictEqual(
      Object.keys(buildPreviewParams(RELEASE)), RULED_PREVIEW_KEYS,
      'the preview composition grew a key',
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
      buildParams(RELEASE, dialsTurnedOn(['somethingWithdrawn']), NOWHERE), RULED_PARAMS_OFF,
      'a withdrawn value reached the request through the narrowing',
    );
    assert.deepStrictEqual(
      buildParams(RELEASE, dialsTurnedOn([...RULED_ON, 'somethingWithdrawn']), NOWHERE),
      RULED_PARAMS_ON,
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
