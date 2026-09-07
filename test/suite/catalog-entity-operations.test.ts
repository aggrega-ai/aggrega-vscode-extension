// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  CATALOG_DOCUMENT_ROW_CONTEXT,
  CATALOG_NO_DOCUMENT_ROW_CONTEXT,
  catalogEntityName,
  catalogEntityPath,
  catalogLintArgs,
  catalogRowContext,
  catalogUploadArgs,
  catalogValidateArgs,
} from '../../src/catalog-entity-operations';
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

function entryNode(over: Partial<CatalogIndexEntity> = {}): WorkspaceCatalogNode {
  return { kind: 'entry', row: rowForEntity(WORKSPACE_ROOT, entity(over)) };
}

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
  const noWorkspace = await workspaceCatalogNodes({
    getWorkspaceRoot: () => null,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    log,
  });
  const serverStopped = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => false,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    log,
  });
  const failed = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.reject(new Error('the server declined')),
    log,
  });
  const empty = await workspaceCatalogNodes({
    getWorkspaceRoot: () => WORKSPACE_ROOT,
    isLanguageServerRunning: () => true,
    requestCatalogIndex: () => Promise.resolve({ entities: [] }),
    log,
  });
  return [...noWorkspace, ...serverStopped, ...failed, ...empty]
    .filter((node) => node.kind === 'message');
}

describe('what a row of the workspace catalog admits', () => {
  it('marks a row backed by a document in this workspace', () => {
    assert.strictEqual(catalogRowContext(entryNode()), CATALOG_DOCUMENT_ROW_CONTEXT);
  });

  it('marks a row for an entity this workspace holds no document for', () => {
    const node = entryNode({ origin: ENTITY_ORIGIN_CATALOG, file: '' });
    assert.strictEqual(catalogRowContext(node), CATALOG_NO_DOCUMENT_ROW_CONTEXT);
  });

  it('marks an origin it has no reading for as carrying no document', () => {
    // An origin this build does not recognise resolves against nothing on this
    // side, so it falls on the withholding side rather than being assumed to
    // behave like a workspace document.
    const node = entryNode({ origin: 'something-else', file: 'catalog/x.yaml' });
    assert.strictEqual(catalogRowContext(node), CATALOG_NO_DOCUMENT_ROW_CONTEXT);
  });

  it('gives a kind heading no operation at all', () => {
    // A heading names a kind, not an entity, so every extractor must decline
    // it: an operation bound to a heading could only be invoked with no
    // subject.
    const groups = nodesForDocument(WORKSPACE_ROOT, { entities: [entity()] });
    const heading = groups.find((node) => node.kind === 'group');
    assert.ok(heading, 'the grouping produced no kind heading to check');
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
    assert.strictEqual(catalogRowContext(node), CATALOG_NO_DOCUMENT_ROW_CONTEXT);
  });
});

describe('the invocations a workspace-catalog row composes', () => {
  it('checks one entity by its path', () => {
    assert.deepStrictEqual(
      catalogValidateArgs('catalog/components/api-server.yaml'),
      ['validate', 'catalog/components/api-server.yaml'],
    );
  });

  it('checks one entity\'s publishing conventions by its path', () => {
    assert.deepStrictEqual(
      catalogLintArgs('catalog/components/api-server.yaml'),
      ['lint', 'catalog/components/api-server.yaml'],
    );
  });

  it('publishes one entity by its path', () => {
    assert.deepStrictEqual(
      catalogUploadArgs('catalog/components/api-server.yaml'),
      ['push', 'catalog/components/api-server.yaml'],
    );
  });

  it('refuses to compose any of them without a subject', () => {
    // Each of these commands has a pathless form addressing the whole catalog,
    // so a subject dropped on the way to the invocation would not fail — it
    // would silently run the wider operation instead of the one the row names.
    // That is why the composition refuses rather than defaulting.
    for (const compose of [catalogValidateArgs, catalogLintArgs, catalogUploadArgs]) {
      assert.throws(() => compose(''), /and none was given/);
      assert.throws(() => compose('   '), /and none was given/);
    }
  });
});
