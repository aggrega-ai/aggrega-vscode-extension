// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { readEntityKinds } from '../../src/entity-kinds';
import { entityKindMenuOptions } from '../../src/operation-menus';

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
// answer is composed — so a reader that took the wide half would compose a menu
// that looked almost right, which is exactly the defect worth refusing.
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
    { kind: 'aggregate', documentKind: 'Aggregate' },
    { kind: 'component', documentKind: 'Component' },
    { kind: 'feature-recipe', documentKind: 'FeatureRecipe' },
  ],
};

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

  it('offers the word a reader reads and composes the token the request takes', () => {
    const options = entityKindMenuOptions(readEntityKinds(ANSWERED));
    assert.deepStrictEqual(
      options.map((option) => option.label), NARROW_WORDS,
      'the drafting menu reads something other than the value each document carries',
    );
    assert.deepStrictEqual(
      options.map((option) => option.value), NARROW_TOKENS,
      'the drafting menu composes something other than the token the request takes',
    );
    // The value is the token rather than the choice's position in the offer,
    // which is the one difference from a menu offering the workspace's own
    // entities: two entities may share a name so only a position identifies one,
    // while a kind's token is the compiler's own identity for it.
    assert.ok(
      options.every((option) => !/^[0-9]+$/.test(option.value)),
      'a choice composes its position in the offer rather than the kind\'s own token',
    );
    // No second line is composed. The word a reader reads names the kind
    // completely, and drawing the token beside it would show two spellings of
    // one thing with nothing to say why they differ.
    assert.deepStrictEqual(
      options.map((option) => option.detail), ['', '', ''],
      'a choice composes a second line, which is a wording invented on this side',
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
