// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';
import {
  CatalogIndexDoc,
  EMPTY_LABEL,
  FAILURE_LABEL,
  SERVER_STOPPED_LABEL,
  WorkspaceCatalogNode,
  WorkspaceEntityRow,
  labelSegments,
  rowForEntity,
  workspaceCatalogNodes,
} from '../../src/workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';

const WORKSPACE_ROOT = '/ws';

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

interface Harness {
  nodes(): Promise<WorkspaceCatalogNode[]>;
  log: FakeLog;
  invocations(): number;
}

// harness builds the run's dependency set over a recorder and a caller-supplied
// answer for the index request, so a test reads back exactly the rows an author
// would have seen in the view.
function harness(
  root: string | null,
  answer: () => Promise<CatalogIndexDoc>,
  serverRunning = true,
): Harness {
  const log = new FakeLog();
  let calls = 0;
  return {
    log,
    invocations: () => calls,
    nodes: () =>
      workspaceCatalogNodes({
        getWorkspaceRoot: () => root,
        isLanguageServerRunning: () => serverRunning,
        requestCatalogIndex: () => {
          calls++;
          return answer();
        },
        log,
      }),
  };
}

function ok(doc: CatalogIndexDoc): () => Promise<CatalogIndexDoc> {
  return () => Promise.resolve(doc);
}

function groupsOf(nodes: WorkspaceCatalogNode[]): { label: string; rows: WorkspaceEntityRow[] }[] {
  return nodes.flatMap((n) => (n.kind === 'group' ? [{ label: n.label, rows: n.rows }] : []));
}

function messagesOf(nodes: WorkspaceCatalogNode[]): { label: string; detail?: string }[] {
  return nodes.flatMap((n) => (n.kind === 'message' ? [{ label: n.label, detail: n.detail }] : []));
}

// flatRows is every entity row in the order the tree would reveal it: heading by
// heading, and within a heading in the order that heading carries.
function flatRows(nodes: WorkspaceCatalogNode[]): WorkspaceEntityRow[] {
  return groupsOf(nodes).flatMap((g) => g.rows);
}

// MEASURED_DOCUMENT is the response the language server emitted for a workspace
// declaring an Aggregate, two Components, a Feature and a Recipe — one Component
// carrying two labels and a description, the other declaring neither. It is kept
// verbatim so the shaping is asserted against what the server actually sends
// rather than against a hand-tidied approximation of it.
//
// Two properties of the real payload are load-bearing here and are visible in
// it: a document declaring no description carries an EMPTY STRING rather than
// omitting the key, and a document declaring no labels carries an EMPTY OBJECT
// rather than null. The workspace also held a values file declaring no kind and
// a Component declaring no name; neither reached this response, which is what
// makes this an entity index rather than a file listing.
const MEASURED_DOCUMENT: CatalogIndexDoc = {
  entities: [
    {
      kind: 'Aggregate',
      name: 'storefront',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'The storefront application',
      labels: {},
      file: 'aggregate.yaml',
    },
    {
      kind: 'Component',
      name: 'cache',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: 'components/cache.yaml',
    },
    {
      kind: 'Component',
      name: 'web',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'The public web tier',
      labels: {
        'component.aggrega.ai/category': 'compute',
        tier: 'frontend',
      },
      file: 'components/web.yaml',
    },
    {
      kind: 'Feature',
      name: 'tls',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'Terminates TLS at the edge',
      labels: { 'feature.aggrega.ai/scope': 'edge' },
      file: 'features/tls.yaml',
    },
    {
      kind: 'Recipe',
      name: 'web-helm',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: 'recipes/web-helm.yaml',
    },
  ],
};

describe('workspaceCatalogNodes', () => {
  it('groups the measured response under one heading per kind', async () => {
    const h = harness(WORKSPACE_ROOT, ok(MEASURED_DOCUMENT));
    const groups = groupsOf(await h.nodes());

    assert.deepStrictEqual(
      groups.map((g) => g.label),
      ['Aggregate', 'Component', 'Feature', 'Recipe'],
    );
    assert.deepStrictEqual(groups.map((g) => g.rows.length), [1, 2, 1, 1]);
    // Every entity is reachable through a heading and none is dropped.
    assert.strictEqual(flatRows(await h.nodes()).length, MEASURED_DOCUMENT.entities.length);
  });

  it('names the entity and renders its labels as key=value', async () => {
    const h = harness(WORKSPACE_ROOT, ok(MEASURED_DOCUMENT));
    const rows = flatRows(await h.nodes());
    const web = rows.find((r) => r.label === 'web');
    assert.ok(web, 'the labelled Component is present');

    assert.strictEqual(web.label, 'web');
    assert.strictEqual(web.description, 'component.aggrega.ai/category=compute · tier=frontend');
    assert.strictEqual(
      web.tooltip,
      [
        'kind: Component',
        'name: web',
        'apiVersion: aggrega.ai/v1alpha1',
        'description: The public web tier',
        'label: component.aggrega.ai/category=compute',
        'label: tier=frontend',
        'file: components/web.yaml',
      ].join('\n'),
    );
  });

  it('renders an entity with no labels and no description without a placeholder', async () => {
    // The wire carries labels as {} and description as '' for this entity, so
    // this pins the contract rather than defending against a null.
    const h = harness(WORKSPACE_ROOT, ok(MEASURED_DOCUMENT));
    const rows = flatRows(await h.nodes());
    const cache = rows.find((r) => r.label === 'cache');
    assert.ok(cache, 'the bare Component is present');

    assert.strictEqual(cache.description, '');
    assert.ok(!cache.description.includes('·'));
    assert.strictEqual(
      cache.tooltip,
      [
        'kind: Component',
        'name: cache',
        'apiVersion: aggrega.ai/v1alpha1',
        'file: components/cache.yaml',
      ].join('\n'),
    );
    // Neither field contributes a named-but-empty line.
    assert.ok(!cache.tooltip.includes('description:'));
    assert.ok(!cache.tooltip.includes('label:'));
  });

  it('resolves each row against the workspace root, so a click opens that file', async () => {
    const h = harness(WORKSPACE_ROOT, ok(MEASURED_DOCUMENT));
    const rows = flatRows(await h.nodes());

    assert.deepStrictEqual(rows.map((r) => r.openPath), [
      '/ws/aggregate.yaml',
      '/ws/components/cache.yaml',
      '/ws/components/web.yaml',
      '/ws/features/tls.yaml',
      '/ws/recipes/web-helm.yaml',
    ]);
    // Each resolved path is absolute and inverts back to the relative path the
    // server reported — the round trip, rather than a repeat of the join.
    rows.forEach((row, i) => {
      assert.ok(path.isAbsolute(row.openPath), `${row.label} resolves to an absolute path`);
      assert.strictEqual(
        path.relative(WORKSPACE_ROOT, row.openPath),
        MEASURED_DOCUMENT.entities[i].file,
      );
    });
  });

  it('presents the order the server sent and re-sorts nothing', async () => {
    // Deliberately NOT in the server's own kind-then-name order: a view that
    // sorted client-side would rearrange this into the measured order above,
    // and would make the assertion below fail.
    const unsorted: CatalogIndexDoc = {
      entities: [
        {
          kind: 'Recipe', name: 'zulu', apiVersion: 'v', description: '',
          labels: {}, file: 'z.yaml',
        },
        {
          kind: 'Recipe', name: 'alpha', apiVersion: 'v', description: '',
          labels: {}, file: 'a.yaml',
        },
        {
          kind: 'Aggregate', name: 'mid', apiVersion: 'v', description: '',
          labels: {}, file: 'm.yaml',
        },
      ],
    };
    const h = harness(WORKSPACE_ROOT, ok(unsorted));
    const nodes = await h.nodes();

    assert.deepStrictEqual(groupsOf(nodes).map((g) => g.label), ['Recipe', 'Aggregate']);
    assert.deepStrictEqual(flatRows(nodes).map((r) => r.label), ['zulu', 'alpha', 'mid']);
  });

  it('shows a kind the server split as two headings rather than re-gathering it', async () => {
    // Grouping by a map keyed on kind would silently merge these into one
    // heading, presenting an order the server never sent. Reporting what
    // arrived keeps the view an honest rendering of the response.
    const split: CatalogIndexDoc = {
      entities: [
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml' },
        { kind: 'Feature', name: 'f', apiVersion: 'v', description: '', labels: {}, file: 'f.yaml' },
        { kind: 'Component', name: 'b', apiVersion: 'v', description: '', labels: {}, file: 'b.yaml' },
      ],
    };
    const groups = groupsOf(await harness(WORKSPACE_ROOT, ok(split)).nodes());

    assert.deepStrictEqual(groups.map((g) => g.label), ['Component', 'Feature', 'Component']);
    assert.deepStrictEqual(groups.map((g) => g.rows.map((r) => r.label)), [['a'], ['f'], ['b']]);
  });

  it('a workspace declaring no entity is a successful empty answer, not a failure', async () => {
    // The measured response for an empty workspace is exactly {"entities": []}.
    const nodes = await harness(WORKSPACE_ROOT, ok({ entities: [] })).nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: EMPTY_LABEL }]);
    assert.strictEqual(EMPTY_LABEL, 'No entities in this workspace.');
    assert.notStrictEqual(EMPTY_LABEL, FAILURE_LABEL);
    assert.strictEqual(groupsOf(nodes).length, 0);
  });

  it('a failed request does not look like an empty workspace, and carries the server message', async () => {
    const message = 'method not found: aggrega/catalogIndex';
    const h = harness(WORKSPACE_ROOT, () => Promise.reject(new Error(message)));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: FAILURE_LABEL, detail: message }]);
    // The server's own text reaches the reader verbatim, not re-worded.
    assert.deepStrictEqual(h.log.lines, [message]);
  });

  it('reports a stopped language server as its own state, and does not ask it', async () => {
    const h = harness(WORKSPACE_ROOT, ok(MEASURED_DOCUMENT), /*serverRunning=*/ false);
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: SERVER_STOPPED_LABEL }]);
    assert.strictEqual(h.invocations(), 0);
    assert.notStrictEqual(SERVER_STOPPED_LABEL, FAILURE_LABEL);
    assert.notStrictEqual(SERVER_STOPPED_LABEL, EMPTY_LABEL);
  });

  it('does not ask the server when nothing is anchored', async () => {
    const h = harness(null, ok(MEASURED_DOCUMENT));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }]);
    assert.strictEqual(h.invocations(), 0);
  });

  it('the four no-entity rows are four distinct sentences', () => {
    const labels = [
      EMPTY_LABEL,
      FAILURE_LABEL,
      SERVER_STOPPED_LABEL,
      NO_ANCHORED_WORKSPACE_TREE_LABEL,
    ];
    assert.strictEqual(new Set(labels).size, labels.length);
    assert.deepStrictEqual(messagesOf([]), []);
  });

  it('re-asks the server on every enumeration, so a refresh repopulates from it', async () => {
    let doc: CatalogIndexDoc = {
      entities: [
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml' },
      ],
    };
    const h = harness(WORKSPACE_ROOT, () => Promise.resolve(doc));

    assert.deepStrictEqual(flatRows(await h.nodes()).map((r) => r.label), ['a']);
    doc = {
      entities: [
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml' },
        { kind: 'Component', name: 'b', apiVersion: 'v', description: '', labels: {}, file: 'b.yaml' },
      ],
    };
    assert.deepStrictEqual(flatRows(await h.nodes()).map((r) => r.label), ['a', 'b']);
    assert.strictEqual(h.invocations(), 2);
  });
});

describe('labelSegments', () => {
  it('renders no segment for a document declaring no label', () => {
    assert.deepStrictEqual(labelSegments({}), []);
  });

  it('keeps the order the labels arrived in', () => {
    // The server emits an entity's labels in a deterministic order; preserving
    // it keeps one ordering with one owner.
    assert.deepStrictEqual(
      labelSegments({ zulu: '1', alpha: '2', mid: '3' }),
      ['zulu=1', 'alpha=2', 'mid=3'],
    );
  });
});

describe('rowForEntity', () => {
  it('carries every declared fact into the tooltip, named, one per line', () => {
    const row = rowForEntity(WORKSPACE_ROOT, {
      kind: 'Manifest',
      name: 'platform',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'The platform manifest',
      labels: { env: 'prod' },
      file: 'manifest.yaml',
    });

    assert.strictEqual(row.label, 'platform');
    assert.strictEqual(row.description, 'env=prod');
    assert.strictEqual(row.openPath, '/ws/manifest.yaml');
    assert.deepStrictEqual(row.tooltip.split('\n'), [
      'kind: Manifest',
      'name: platform',
      'apiVersion: aggrega.ai/v1alpha1',
      'description: The platform manifest',
      'label: env=prod',
      'file: manifest.yaml',
    ]);
  });

  it('groups a kind the extension has no list of, because the server reports what an author wrote', () => {
    // Nothing here validates kind against a closed set: an entity whose kind
    // the extension has never heard of still gets a heading and a row.
    const row = rowForEntity(WORKSPACE_ROOT, {
      kind: 'SomeKindThisExtensionDoesNotKnow',
      name: 'x',
      apiVersion: 'v',
      description: '',
      labels: {},
      file: 'x.yaml',
    });
    assert.strictEqual(row.label, 'x');
    assert.ok(row.tooltip.startsWith('kind: SomeKindThisExtensionDoesNotKnow'));
  });
});
