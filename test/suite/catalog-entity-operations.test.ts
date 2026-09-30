// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  CatalogRowOperation,
  catalogEntityName,
  catalogEntityPath,
  catalogRowContext,
  catalogRowOperations,
  catalogValidateArgs,
} from '../../src/catalog-entity-operations';
import { EntityKind, EntityKindAcceptance } from '../../src/entity-kinds';
import { entityLintSubject, lintRequestParams } from '../../src/lint-run';
import { publishEntityRequest } from '../../src/publication-request';
import {
  CatalogIndexEntity,
  ENTITY_ORIGIN_CATALOG,
  ENTITY_ORIGIN_WORKSPACE,
  WorkspaceCatalogNode,
  nodesForDocument,
  rowForEntity,
  workspaceCatalogNodes,
} from '../../src/workspace-catalog-run';

const WORKSPACE_ROOT = '/ws';

// EVERYTHING is an acceptance stating true for every operation, as the
// compiler's answer states it for a kind every row operation takes.
const EVERYTHING: EntityKindAcceptance = { singleEntityValidation: true, publication: true, inspectionByName: true };

// kindsAccepting is an answer's entries holding the one kind the rows below
// declare, accepting what it is given — or an answer holding no entry for that
// kind, where it is given null.
function kindsAccepting(acceptance: EntityKindAcceptance | null): EntityKind[] {
  return acceptance === null ? [] : [{ kind: 'component', documentKind: 'Component', acceptedBy: acceptance }];
}

function entity(over: Partial<CatalogIndexEntity> = {}): CatalogIndexEntity {
  return {
    kind: 'Component',
    name: 'core/compute/api-server',
    apiVersion: 'aggrega.ai/v1alpha1',
    description: '',
    labels: {},
    file: 'catalog/components/api-server.yaml',
    origin: ENTITY_ORIGIN_WORKSPACE,
    ...over,
  };
}

function entryNode(
  over: Partial<CatalogIndexEntity> = {},
  acceptance: EntityKindAcceptance | null = EVERYTHING,
): WorkspaceCatalogNode {
  return { kind: 'entry', row: rowForEntity(WORKSPACE_ROOT, entity(over), kindsAccepting(acceptance)) };
}

// NO_DOCUMENT is a row for an entity resolved from a configured catalog
// directory, which the workspace holds no document for.
const NO_DOCUMENT: Partial<CatalogIndexEntity> = { origin: ENTITY_ORIGIN_CATALOG, file: '' };

// OFFERING is the offering rule written out case by case: for each combination of
// what the compiler accepts a document of the row's kind for, with and without a
// document in the workspace, the operations the row offers, in order. It is
// written here rather than computed, so it is a second statement of the rule and
// not the rule read back to itself. `v`, `p` and `i` are single-entity validation,
// publication and inspection by name.
const OFFERING: { v: boolean; p: boolean; i: boolean; document: boolean; offers: CatalogRowOperation[] }[] = [
  { v: false, p: false, i: false, document: true, offers: ['lint'] },
  { v: true, p: false, i: false, document: true, offers: ['validate', 'lint'] },
  { v: false, p: true, i: false, document: true, offers: ['lint', 'push'] },
  { v: false, p: false, i: true, document: true, offers: ['inspect', 'lint'] },
  { v: true, p: true, i: false, document: true, offers: ['validate', 'lint', 'push'] },
  { v: true, p: false, i: true, document: true, offers: ['inspect', 'validate', 'lint'] },
  { v: false, p: true, i: true, document: true, offers: ['inspect', 'lint', 'push'] },
  { v: true, p: true, i: true, document: true, offers: ['inspect', 'validate', 'lint', 'push'] },
  { v: false, p: false, i: false, document: false, offers: [] },
  { v: true, p: false, i: false, document: false, offers: [] },
  { v: false, p: true, i: false, document: false, offers: [] },
  { v: false, p: false, i: true, document: false, offers: ['inspect'] },
  { v: true, p: true, i: false, document: false, offers: [] },
  { v: true, p: false, i: true, document: false, offers: ['inspect'] },
  { v: false, p: true, i: true, document: false, offers: ['inspect'] },
  { v: true, p: true, i: true, document: false, offers: ['inspect'] },
];

// everyMessageNode collects the message rows this panel can actually render, by
// driving the run into each state that produces one rather than by writing the
// nodes out by hand.
//
// That is the difference between proving the extractors reject the message SHAPE
// and proving they reject every message a reader can actually be shown: a
// hand-written literal is a node this suite invented, and a state the run
// reaches but the literal does not model would carry an operation with nothing
// to invoke it on.
async function everyMessageNode(): Promise<WorkspaceCatalogNode[]> {
  const log = { appendLine: () => { /* the run's channel is not under test */ } };
  const entityKinds = (): Promise<unknown> => Promise.resolve({ entityKinds: [] });
  const noWorkspace = await workspaceCatalogNodes({
    getWorkspaceRoot: () => null,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    entityKinds,
    log,
  });
  const serverStopped = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => false,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    entityKinds,
    log,
  });
  const failed = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.reject(new Error('the server declined')),
    entityKinds,
    log,
  });
  const empty = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    entityKinds,
    log,
  });
  return [...noWorkspace, ...serverStopped, ...failed, ...empty]
    .filter((node) => node.kind === 'message');
}

describe('which operations a row of the workspace catalog offers', () => {
  it('offers each operation exactly where the rule written out above says, for every combination', () => {
    for (const c of OFFERING) {
      const node = entryNode(c.document ? {} : NO_DOCUMENT, {
        singleEntityValidation: c.v, publication: c.p, inspectionByName: c.i,
      });
      assert.deepStrictEqual(
        catalogRowOperations(node), c.offers,
        `validation ${c.v}, publication ${c.p}, inspection ${c.i}, ${c.document ? 'with' : 'without'} a document`,
      );
    }
    // The table covers every combination of the three members, on both kinds of
    // row, so a case the rule decides differently cannot be one it skipped.
    const covered = new Set(OFFERING.map((c) => `${c.v}${c.p}${c.i}${c.document}`));
    assert.strictEqual(covered.size, 16, 'the table leaves a combination of what is accepted, and of a document, undecided');
  });

  it('offers only the conventions check on a row whose kind the compiler\'s answer holds no entry for', () => {
    // A kind the answer does not name accepts nothing, so every operation whose
    // offering depends on the kind is withheld; the conventions check depends on
    // no kind and stays on a row with a document.
    assert.deepStrictEqual(catalogRowOperations(entryNode({}, null)), ['lint']);
    assert.deepStrictEqual(catalogRowOperations(entryNode(NO_DOCUMENT, null)), []);
    // The negative control: the same row, its kind in the answer, offers more.
    assert.deepStrictEqual(catalogRowOperations(entryNode({})), ['inspect', 'validate', 'lint', 'push']);
  });

  it('matches the kind by the value its document carries, and never by a spelling derived from it', () => {
    // The index reports the kind as the document wrote it, and the answer's entry
    // carries that value as its document register. A row of a kind whose entry
    // differs only by case is a kind the answer does not hold.
    const node: WorkspaceCatalogNode = {
      kind: 'entry',
      row: rowForEntity(WORKSPACE_ROOT, entity({ kind: 'FeatureRecipe' }), [
        { kind: 'featurerecipe', documentKind: 'featurerecipe', acceptedBy: EVERYTHING },
      ]),
    };
    assert.deepStrictEqual(catalogRowOperations(node), ['lint']);
  });

  it('carries the operations offered in the value the row is bound by, and no value where it offers none', () => {
    assert.strictEqual(catalogRowContext(entryNode()), 'aggrega.catalogEntity:inspect:validate:lint:push');
    assert.strictEqual(
      catalogRowContext(entryNode({}, { singleEntityValidation: false, publication: true, inspectionByName: true })),
      'aggrega.catalogEntity:inspect:lint:push',
    );
    assert.strictEqual(catalogRowContext(entryNode(NO_DOCUMENT)), 'aggrega.catalogEntity:inspect');
    assert.strictEqual(
      catalogRowContext(entryNode(NO_DOCUMENT, { singleEntityValidation: true, publication: true, inspectionByName: false })),
      null,
      'a row offering nothing carries a value, so it opens an empty menu',
    );
  });

  it('reads an origin it has no reading for as carrying no document', () => {
    // An origin this build does not recognise resolves against nothing on this
    // side, so it falls on the withholding side rather than being assumed to
    // behave like a workspace document.
    const node = entryNode({ origin: 'something-else', file: 'catalog/x.yaml' });
    assert.deepStrictEqual(catalogRowOperations(node), ['inspect']);
  });

  it('gives a kind heading no operation at all', () => {
    // A heading names a kind, not an entity, so every extractor must decline
    // it: an operation bound to a heading could only be invoked with no
    // subject.
    const groups = nodesForDocument(WORKSPACE_ROOT, { entities: [entity()] }, kindsAccepting(EVERYTHING));
    const heading = groups.find((node) => node.kind === 'group');
    assert.ok(heading, 'the grouping produced no kind heading to check');
    assert.strictEqual(catalogRowOperations(heading), null);
    assert.strictEqual(catalogRowContext(heading), null);
    assert.strictEqual(catalogEntityPath(heading), null);
    assert.strictEqual(catalogEntityName(heading), null);
  });

  it('gives every message row no operation at all', async () => {
    const messages = await everyMessageNode();
    // The count is asserted so a message state added later without a verdict
    // here fails rather than passing unexamined.
    assert.strictEqual(
      messages.length, 4,
      'the run renders a number of message rows this check has not been extended to cover',
    );
    for (const node of messages) {
      const label = node.kind === 'message' ? node.label : '';
      assert.strictEqual(catalogRowContext(node), null, `"${label}" carries a row operation`);
      assert.strictEqual(catalogEntityPath(node), null, `"${label}" yields a path`);
      assert.strictEqual(catalogEntityName(node), null, `"${label}" yields a name`);
    }
  });
});

describe('the subject a row of the workspace catalog supplies', () => {
  it('hands a path-taking operation the workspace-relative document', () => {
    // Relative rather than absolute: the invocation runs in the workspace root,
    // so this is the form that resolves there and the form the reader sees in
    // the reported command line.
    assert.strictEqual(
      catalogEntityPath(entryNode()),
      'catalog/components/api-server.yaml',
    );
  });

  it('hands a path-taking operation nothing for a row with no document', () => {
    // This is the whole reason the panel needs two row values. Publishing and
    // both checks take a path; an entity that resolves without a document in
    // this workspace has none to give, so no path-taking operation can be
    // composed for it and none is offered.
    const node = entryNode({ origin: ENTITY_ORIGIN_CATALOG, file: '' });
    assert.strictEqual(catalogEntityPath(node), null);
    assert.strictEqual(node.kind === 'entry' ? node.row.openPath : 'unset', null);
  });

  it('hands an identity-taking operation the name, document or not', () => {
    assert.strictEqual(catalogEntityName(entryNode()), 'core/compute/api-server');
    const resolved = entryNode({ origin: ENTITY_ORIGIN_CATALOG, file: '' });
    assert.strictEqual(catalogEntityName(resolved), 'core/compute/api-server');
  });

  it('reads the subject from its own field rather than from what the row displays', () => {
    // The label is a display string and the subjects are invocation arguments.
    // Rewriting what the row reads must not change what its operations act on.
    const node = entryNode();
    if (node.kind !== 'entry') { throw new Error('expected an entry row'); }
    node.row.label = 'a rewritten display string';
    assert.strictEqual(catalogEntityName(node), 'core/compute/api-server');
    assert.strictEqual(catalogEntityPath(node), 'catalog/components/api-server.yaml');
  });

  it('withholds every path-taking operation from a workspace entity with no path', () => {
    // A workspace origin alone does not mean there is a document. An empty path
    // joined onto the workspace root yields the root itself, so reading the
    // origin by itself would offer to publish, lint and check the whole
    // workspace directory — and to open it as though it were a file.
    const node = entryNode({ origin: ENTITY_ORIGIN_WORKSPACE, file: '' });
    if (node.kind !== 'entry') { throw new Error('expected an entry row'); }
    assert.strictEqual(node.row.openPath, null);
    assert.strictEqual(node.row.entityPath, '');
    assert.strictEqual(catalogEntityPath(node), null);
    assert.deepStrictEqual(catalogRowOperations(node), ['inspect']);
  });
});

describe('the invocations a workspace-catalog row composes', () => {
  it('checks one entity by its path', () => {
    assert.deepStrictEqual(
      catalogValidateArgs('catalog/components/api-server.yaml'),
      ['validate', 'catalog/components/api-server.yaml'],
    );
  });

  it('checks one entity\'s publishing conventions by its path, as a request', () => {
    // The row's own value travels unconverted: the compiler resolves a document
    // parameter relative to the workspace root, which is the spelling the row
    // already carries. Converting it here would send a path the request refuses.
    assert.deepStrictEqual(
      lintRequestParams(entityLintSubject('catalog/components/api-server.yaml')),
      { entity: 'catalog/components/api-server.yaml' },
    );
  });

  it('asks for no pre-publication comparison, so a finding cannot fail the run', () => {
    // An equality on the WHOLE parameter object rather than a check that the
    // mode is absent: the comparison is the only mode whose verdict refuses, and
    // it is also the only one that reaches a registry, so a key arriving here
    // would change both what the run costs and what its outcome means.
    assert.deepStrictEqual(
      Object.keys(lintRequestParams(entityLintSubject('catalog/components/api-server.yaml'))),
      ['entity'],
    );
  });

  it('publishes one entity by its path, as a request rather than an invocation', () => {
    assert.deepStrictEqual(
      publishEntityRequest('catalog/components/api-server.yaml'),
      { entity: 'catalog/components/api-server.yaml' },
    );
  });

  it('refuses to compose any of them without a subject', () => {
    // Each of these operations has a pathless form addressing the whole catalog,
    // so a subject dropped on the way to the compiler would not fail — it would
    // silently run the wider operation instead of the one the row names. That is
    // why the composition refuses rather than defaulting, and it holds on both
    // transports: two of the three are requests and refuse on exactly the same
    // ground as the invocation beside them.
    for (const compose of [catalogValidateArgs, entityLintSubject, publishEntityRequest]) {
      assert.throws(() => compose(''), /and none was given/);
      assert.throws(() => compose('   '), /and none was given/);
    }
  });
});
