// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { catalogValidateArgs } from '../../src/catalog-entity-operations';
import {
  catalogIndexParams, entityDefinitionParams, inReleaseTerms, releaseFlag,
} from '../../src/release-terms';
import {
  lspCompletionToCompletion, lspDefinitionToResolve, lspHoverToHover, lspImplementationToFindImplementations,
  lspReferencesToFindReferences,
} from '../../src/translator';
import { buildValidateParams } from '../../src/validate-request';
import { callArguments } from '../helpers/anchoring-census';

const RELEASE = 'envs/prod.yaml';

describe('the one composition of a request answered in a Release\'s terms', () => {
  it('names the selected Release under release', () => {
    assert.deepStrictEqual(inReleaseTerms({ name: 'core/datastore/mariadb' }, RELEASE), { name: 'core/datastore/mariadb', release: RELEASE });
  });

  it('carries no release key at all where none is selected', () => {
    const composed = inReleaseTerms({ name: 'core/datastore/mariadb' }, null);
    assert.deepStrictEqual(composed, { name: 'core/datastore/mariadb' });
    assert.ok(!Object.prototype.hasOwnProperty.call(composed, 'release'), 'an absent key, not one holding undefined');
  });

  it('never sends the Release empty: an empty selection is read as none', () => {
    const composed = inReleaseTerms({ name: 'core/datastore/mariadb' }, '');
    assert.ok(!Object.prototype.hasOwnProperty.call(composed, 'release'), JSON.stringify(composed));
  });

  it('leaves the parameters it was given as they were', () => {
    const given = { name: 'core/datastore/mariadb' };
    inReleaseTerms(given, RELEASE);
    assert.deepStrictEqual(given, { name: 'core/datastore/mariadb' });
  });

  it('names it as the command line takes it, reading the same decision', () => {
    assert.deepStrictEqual(releaseFlag(RELEASE), ['--release', RELEASE]);
    assert.deepStrictEqual(releaseFlag(null), []);
    assert.deepStrictEqual(releaseFlag(''), []);
  });
});

// Every request the language server answers in a Release's terms, by its method,
// with the parameters the editor composes for it: each is held to the one
// composition applied to the same request composed with no Release, so a request
// that composed its own — or none — fails here by name.
const uri = 'file:///workspace/aggregate.yaml';
const content = 'spec:\n  components:\n    db:\n      type: core/datastore/mariadb\n';
const pos = { line: 3, character: 14 };
const REQUESTS: Record<string, (selected: string | null) => object> = {
  'aggrega/catalogIndex': (r) => catalogIndexParams(r),
  'aggrega/entityDefinition': (r) => entityDefinitionParams('core/datastore/mariadb', r),
  'aggrega/hover': (r) => lspHoverToHover(uri, pos, content, 'utf-8', r),
  'aggrega/completion': (r) => lspCompletionToCompletion(uri, pos, content, 'utf-8', r, '/'),
  'aggrega/resolve': (r) => lspDefinitionToResolve(uri, pos, content, 'utf-8', r),
  'aggrega/findReferences': (r) => lspReferencesToFindReferences(uri, pos, content, 'utf-8', r),
  'aggrega/findImplementations': (r) => lspImplementationToFindImplementations(uri, pos, content, 'utf-8', r),
  'aggrega/validate': (r) => buildValidateParams('/workspace/aggregate.yaml', content, r),
};

describe('every request answered in a Release\'s terms', () => {
  for (const [method, compose] of Object.entries(REQUESTS)) {
    it(`${method} names the selected Release, and only where one is selected`, () => {
      const without = compose(null);
      assert.ok(!Object.prototype.hasOwnProperty.call(without, 'release'), `${method} with none selected: ${JSON.stringify(without)}`);
      assert.deepStrictEqual(compose(RELEASE), { ...without, release: RELEASE }, `${method} with ${RELEASE} selected`);
      assert.deepStrictEqual(compose(''), without, `${method} with an empty selection`);
    });
  }

  it('the Catalog row\'s correctness check names it as the command line takes it', () => {
    const without = catalogValidateArgs('components/sized-volume.yaml', null);
    assert.deepStrictEqual(without, ['validate', 'components/sized-volume.yaml']);
    assert.deepStrictEqual(catalogValidateArgs('components/sized-volume.yaml', RELEASE), [...without, '--release', RELEASE]);
    assert.deepStrictEqual(catalogValidateArgs('components/sized-volume.yaml', ''), without);
  });
});

// The composers above are reached from the editor's own call sites with the
// selection itself, which a headless run cannot drive — the modules holding those
// sites import the editor — so the source is read: each call of a composer hands
// it the selection, never a value of its own. An equality, not a presence: a
// reading that stopped finding the calls returns nothing, which is not the shape
// recorded here.
describe('the editor hands each composition the selected Release', () => {
  const EXTENSION = 'src/extension.ts';
  const lastArguments = (file: string, callee: string): string[] => callArguments(file, callee).map((args) => args[args.length - 1]);

  it('for the cursor features', () => {
    for (const translator of ['lspDefinitionToResolve', 'lspReferencesToFindReferences', 'lspImplementationToFindImplementations', 'lspHoverToHover']) {
      assert.deepStrictEqual(lastArguments(EXTENSION, translator), ['selectedRelease()'], translator);
    }
    assert.deepStrictEqual(callArguments(EXTENSION, 'lspCompletionToCompletion').map((args) => args[4]), ['selectedRelease()']);
  });

  it('for the entity listing and an inspection by name', () => {
    assert.deepStrictEqual(callArguments(EXTENSION, 'catalogIndexParams'), [['selectedRelease()']]);
    assert.deepStrictEqual(callArguments(EXTENSION, 'entityDefinitionParams'), [['name', 'selectedRelease()']]);
  });

  it('for the Catalog row\'s correctness check', () => {
    assert.deepStrictEqual(callArguments('src/workspace-catalog-view.ts', 'catalogValidateArgs'), [['entityPath', 'deps.selectedRelease()']]);
  });
});
