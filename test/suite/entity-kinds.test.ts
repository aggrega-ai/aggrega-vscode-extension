// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import { acceptanceFor, readEntityKinds } from '../../src/entity-kinds';

// The reader holds no editor type, so what the drafting control offers is read
// back here with no extension host. What no test in this repository can reach is
// the request itself: whether the language server answers this shape at all is
// walked by hand at the editor, against a running compiler.
//
// 🔴 EVERY EXPECTATION BELOW IS WRITTEN OUT IN THIS FILE. Nothing is derived
// from the reader, from the answer it is given, or from any set the product
// holds — a comparison whose two sides come from one place agrees with itself
// whatever that place says. The answers below are composed here for that reason.

// ANSWERED is one answer of the shape the language server sends back for a
// schema request that named no kind: the whole vocabulary at two widths.
//
// The wide half deliberately holds tokens the narrow half does not, because that
// difference is the whole subject of this file. It also deliberately holds every
// token the narrow half does, in the same spelling, because that is how the
// answer is composed — so a reader that took the wide half would compose an
// offer that looked almost right, which is exactly the defect worth refusing.
const ANSWERED = {
  kinds: [
    'aggregate',
    'component',
    'feature-recipe',
    'aggrega-config',
    'aggrega-lock',
    'ir-graph',
    'plugin-manifest',
  ],
  entityKinds: [
    {
      kind: 'aggregate',
      documentKind: 'Aggregate',
      acceptedBy: { singleEntityValidation: false, publication: true, inspectionByName: true },
    },
    {
      kind: 'component',
      documentKind: 'Component',
      acceptedBy: { singleEntityValidation: true, publication: true, inspectionByName: true },
    },
    {
      kind: 'feature-recipe',
      documentKind: 'FeatureRecipe',
      acceptedBy: { singleEntityValidation: true, publication: false, inspectionByName: false },
    },
  ],
};

// NOTHING_ACCEPTED is the acceptance an entry is read as carrying wherever the
// answer does not say true for a member, written out rather than taken from the
// reader.
const NOTHING_ACCEPTED = { singleEntityValidation: false, publication: false, inspectionByName: false };

// NARROW_TOKENS and NARROW_WORDS are the two registers of the answer above,
// written out rather than mapped off it.
const NARROW_TOKENS = ['aggregate', 'component', 'feature-recipe'];
const NARROW_WORDS = ['Aggregate', 'Component', 'FeatureRecipe'];

// WIDE_ONLY is what the wide half carries that the narrow half does not: a
// generated document, a lockfile, a workspace configuration and a plugin
// contract. None is a document an author writes a file of.
const WIDE_ONLY = ['aggrega-config', 'aggrega-lock', 'ir-graph', 'plugin-manifest'];

describe('the kinds an author may draft', () => {
  it('reads the narrow half of the answer and never the wide one', () => {
    // 🔴 THE CLAUSE THIS WHOLE SURFACE EXISTS FOR. The wide half is every token
    // the compiler answers for, contracts and generated documents included, so a
    // choice built from it would offer a reader a document no authoring schema
    // accepts — and there would be nowhere to put it.
    assert.deepStrictEqual(
      readEntityKinds(ANSWERED).map((kind) => kind.kind),
      NARROW_TOKENS,
      'the drafting offer is not the narrow half of the answer, in the order it arrived',
    );
    for (const token of WIDE_ONLY) {
      assert.ok(
        !readEntityKinds(ANSWERED).some((kind) => kind.kind === token),
        `${token} is offered as something to draft, and no authoring schema accepts it`,
      );
    }
    // A negative control on those absences: the wide half really does carry
    // every one of them, so the zeros above measure the reader rather than an
    // answer that never held the tokens.
    for (const token of WIDE_ONLY) {
      assert.ok(
        ANSWERED.kinds.includes(token),
        `the answer these absences are read from never carried ${token}`,
      );
    }
    // And it really is WIDER, so this is a narrowing rather than two lists that
    // happen to match.
    assert.ok(
      ANSWERED.kinds.length > ANSWERED.entityKinds.length,
      'the answer\'s two halves are the same width, so nothing above measures a narrowing',
    );
  });

  it('refuses an answer carrying only the wide half rather than falling back to it', () => {
    // The half a caller wants is the caller's to state, so an answer missing the
    // narrow half yields nothing at all. Falling back to the wide half would be
    // the same defect as reading it in the first place, reached by a path nobody
    // chose.
    assert.deepStrictEqual(
      readEntityKinds({ kinds: ANSWERED.kinds }), [],
      'an answer carrying no narrow half was answered from the wide one',
    );
    // Nor is the wide half narrowed here by pattern: a kind whose content is
    // written inside another kind's document is identifiable and not
    // addressable, and nothing in the answer separates the two — so a pattern
    // applied on this side would offer a document there is nowhere to put.
    assert.deepStrictEqual(
      readEntityKinds({ kinds: ['component', 'aggregate'] }), [],
      'the wide half was narrowed on this side rather than being left alone',
    );
  });

  it('carries both registers apart, deriving neither from the other', () => {
    // 🔴 A KIND OF MORE THAN ONE WORD DOES NOT SURVIVE THE ROUND TRIP, which is
    // why both registers travel. The value a reader reads is what their document
    // will carry; the value a choice composes is the token the request takes.
    const kinds = readEntityKinds(ANSWERED);
    assert.deepStrictEqual(
      kinds.map((kind) => kind.documentKind), NARROW_WORDS,
      'a kind reads differently from the value its own document carries',
    );
    // The self-check that makes the comparison above a second comparison: at
    // least one kind's two registers differ by more than case, so a reader that
    // derived either from the other would fail here rather than agreeing.
    const differ = kinds.filter((kind) => kind.kind !== kind.documentKind.toLowerCase());
    assert.deepStrictEqual(
      differ.map((kind) => kind.kind), ['feature-recipe'],
      'no kind in this answer has two registers that differ, so nothing here would catch one derived from the other',
    );
  });

  it('drops an entry carrying only one of the two registers, and reads no answer it cannot', () => {
    // Every field is checked rather than trusted, because the answer comes from
    // another process. An entry with one register is dropped rather than
    // half-read: a choice that could be read but not sent, or sent but not read,
    // is worse than one that is absent.
    assert.deepStrictEqual(
      readEntityKinds({
        entityKinds: [
          { kind: 'component' },
          { documentKind: 'Aggregate' },
          { kind: '', documentKind: 'Release' },
          { kind: 'release', documentKind: '' },
          'recipe',
          null,
          { kind: 'manifest', documentKind: 'Manifest' },
        ],
      }).map((kind) => kind.kind),
      ['manifest'],
      'an entry missing a register, or not an entry at all, reached the offer',
    );
    for (const answer of [null, undefined, 'component', 42, [], {}, { entityKinds: 'component' }]) {
      assert.deepStrictEqual(
        readEntityKinds(answer), [],
        `${JSON.stringify(answer)} was read as an answer carrying kinds`,
      );
    }
  });
});

describe('what the compiler accepts a document of each kind for', () => {
  it('reads each member as the answer states it, member by member', () => {
    // Each entry above states a different combination, and one of them states
    // true for validation and false for publication, so a reader that read one
    // member for another fails here rather than agreeing.
    assert.deepStrictEqual(
      readEntityKinds(ANSWERED).map((kind) => kind.acceptedBy),
      [
        { singleEntityValidation: false, publication: true, inspectionByName: true },
        { singleEntityValidation: true, publication: true, inspectionByName: true },
        { singleEntityValidation: true, publication: false, inspectionByName: false },
      ],
      'what an operation accepts was read differently from what the answer states',
    );
  });

  it('reads a member as accepting only where the answer carries the boolean true', () => {
    // 🔴 THE DIRECTION A MISREADING MAY FALL IN. A member absent, of another type,
    // or carried by an acceptance that is not an object, reads as not accepting:
    // an operation withheld is a control the reader can see is missing, and one
    // offered wrongly is a press the compiler refuses.
    const read = readEntityKinds({
      entityKinds: [
        { kind: 'a', documentKind: 'A' },
        { kind: 'b', documentKind: 'B', acceptedBy: null },
        { kind: 'c', documentKind: 'C', acceptedBy: 'everything' },
        { kind: 'd', documentKind: 'D', acceptedBy: [true, true, true] },
        { kind: 'e', documentKind: 'E', acceptedBy: {} },
        {
          kind: 'f',
          documentKind: 'F',
          acceptedBy: { singleEntityValidation: 'true', publication: 1, inspectionByName: {} },
        },
        { kind: 'g', documentKind: 'G', acceptedBy: { publication: true } },
      ],
    });
    assert.deepStrictEqual(
      read.map((kind) => kind.kind), ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      'an entry whose acceptance could not be read was dropped, and drafting would lose a kind the answer names',
    );
    assert.deepStrictEqual(
      read.slice(0, 6).map((kind) => kind.acceptedBy),
      [NOTHING_ACCEPTED, NOTHING_ACCEPTED, NOTHING_ACCEPTED, NOTHING_ACCEPTED, NOTHING_ACCEPTED, NOTHING_ACCEPTED],
      'an acceptance not stated as the boolean true was read as accepting',
    );
    // The negative control: the one member stated as true beside two absent ones
    // is read as accepting, so the falses above measure the reading and not a
    // reader that accepts nothing whatever it is told.
    assert.deepStrictEqual(
      read[6].acceptedBy,
      { singleEntityValidation: false, publication: true, inspectionByName: false },
      'a member the answer states as true was not read as accepting',
    );
  });

  it('looks a row\'s kind up by the value its document carries, and finds nothing for a kind the answer lacks', () => {
    const kinds = readEntityKinds(ANSWERED);
    assert.deepStrictEqual(
      acceptanceFor(kinds, 'FeatureRecipe'),
      { singleEntityValidation: true, publication: false, inspectionByName: false },
      'a kind of more than one word was not found by the value its document carries',
    );
    assert.strictEqual(
      acceptanceFor(kinds, 'featurerecipe'), null,
      'a kind was found by a spelling no document carries, so a register was derived',
    );
    assert.strictEqual(
      acceptanceFor(kinds, 'Manifest'), null,
      'a kind the answer holds no entry for was given an acceptance invented here',
    );
    assert.strictEqual(acceptanceFor([], 'Component'), null);
  });
});
