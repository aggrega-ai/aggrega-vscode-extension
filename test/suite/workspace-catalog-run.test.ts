// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';
import {
  CATALOG_ORIGIN_LABEL,
  CatalogIndexDoc,
  EMPTY_LABEL,
  ENTITY_ORIGIN_CATALOG,
  ENTITY_ORIGIN_WORKSPACE,
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
// Every entity here was read from a document in the workspace, which is why each
// carries that origin and a path. The two-origin response below is what covers
// the other case.
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
      origin: 'workspace',
    },
    {
      kind: 'Component',
      name: 'cache',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: 'components/cache.yaml',
      origin: 'workspace',
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
      origin: 'workspace',
    },
    {
      kind: 'Feature',
      name: 'tls',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'Terminates TLS at the edge',
      labels: { 'feature.aggrega.ai/scope': 'edge' },
      file: 'features/tls.yaml',
      origin: 'workspace',
    },
    {
      kind: 'Recipe',
      name: 'web-helm',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: 'recipes/web-helm.yaml',
      origin: 'workspace',
    },
  ],
};

// MEASURED_TWO_ORIGIN_DOCUMENT is the response the language server emitted for a
// workspace declaring one Component and configuring a catalog directory OUTSIDE
// its own root, which resolved a set of Features. Three of that response's
// entities are carried here, chosen for what each covers: the workspace
// Component, a catalog-resolved Feature declaring neither labels nor a
// description, and one declaring a label.
//
// Every field is as the server sent it save one — the last entity's prose
// description is kept to its own first sentence, because nothing here reads past
// it and the full paragraph would bury the fields that are load-bearing. What is
// being pinned is the origin strings and the empty path, not that text.
//
// The catalog directory has to sit outside the workspace root for this response
// to exist at all. A Feature inside the root is also a workspace document, and
// the server reports the workspace copy for such a name — with its file — so a
// directory nested under the root yields no catalog-origin entity to record.
//
// This is where the two origin strings are pinned. They are values on a wire
// that this side cannot import, so what holds this side to the server is that
// these were read back off the server's own answer.
const MEASURED_TWO_ORIGIN_DOCUMENT: CatalogIndexDoc = {
  entities: [
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
      origin: 'workspace',
    },
    {
      kind: 'Feature',
      name: 'core/apply-untrusted-label',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: '',
      origin: 'catalog',
    },
    {
      kind: 'Feature',
      name: 'core/referenced-secret',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: 'A credential that materializes as a referenceable secret resource and publishes that resource\'s identity for consumers to point at.',
      labels: { 'feature.aggrega.ai/kind': 'secret' },
      file: '',
      origin: 'catalog',
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
      const openPath = row.openPath;
      if (openPath === null) {
        assert.fail(`${row.label} came from a workspace document and must have a file to open`);
      }
      assert.ok(path.isAbsolute(openPath), `${row.label} resolves to an absolute path`);
      assert.strictEqual(
        path.relative(WORKSPACE_ROOT, openPath),
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
          labels: {}, file: 'z.yaml', origin: 'workspace',
        },
        {
          kind: 'Recipe', name: 'alpha', apiVersion: 'v', description: '',
          labels: {}, file: 'a.yaml', origin: 'workspace',
        },
        {
          kind: 'Aggregate', name: 'mid', apiVersion: 'v', description: '',
          labels: {}, file: 'm.yaml', origin: 'workspace',
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
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml', origin: 'workspace' },
        { kind: 'Feature', name: 'f', apiVersion: 'v', description: '', labels: {}, file: 'f.yaml', origin: 'workspace' },
        { kind: 'Component', name: 'b', apiVersion: 'v', description: '', labels: {}, file: 'b.yaml', origin: 'workspace' },
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
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml', origin: 'workspace' },
      ],
    };
    const h = harness(WORKSPACE_ROOT, () => Promise.resolve(doc));

    assert.deepStrictEqual(flatRows(await h.nodes()).map((r) => r.label), ['a']);
    doc = {
      entities: [
        { kind: 'Component', name: 'a', apiVersion: 'v', description: '', labels: {}, file: 'a.yaml', origin: 'workspace' },
        { kind: 'Component', name: 'b', apiVersion: 'v', description: '', labels: {}, file: 'b.yaml', origin: 'workspace' },
      ],
    };
    assert.deepStrictEqual(flatRows(await h.nodes()).map((r) => r.label), ['a', 'b']);
    assert.strictEqual(h.invocations(), 2);
  });

  it('reports what the workspace declares and what its catalog directories resolve', async () => {
    const rows = flatRows(await harness(WORKSPACE_ROOT, ok(MEASURED_TWO_ORIGIN_DOCUMENT)).nodes());

    assert.deepStrictEqual(
      rows.map((r) => r.label),
      ['web', 'core/apply-untrusted-label', 'core/referenced-secret'],
    );
  });

  it('offers to open only the rows that are files in this workspace', async () => {
    const rows = flatRows(await harness(WORKSPACE_ROOT, ok(MEASURED_TWO_ORIGIN_DOCUMENT)).nodes());

    // ABSENT, not merely different from the workspace root. A row asserting the
    // path is not the root would go on passing if the join were changed to
    // produce some other wrong path, which is the same defect one step over.
    assert.deepStrictEqual(rows.map((r) => r.openPath), [
      '/ws/components/web.yaml',
      null,
      null,
    ]);
    // The root is what the previous shaping produced for these two, so it is
    // named here rather than left implicit: joining an empty path onto a root
    // yields the root, and a row offering to open the whole workspace is what
    // this asserts is gone.
    assert.ok(!rows.some((r) => r.openPath === WORKSPACE_ROOT));
  });

  it('says where a catalog-resolved row came from, beside the labels its author declared', async () => {
    const rows = flatRows(await harness(WORKSPACE_ROOT, ok(MEASURED_TWO_ORIGIN_DOCUMENT)).nodes());
    const [web, bare, labelled] = rows;

    // A workspace document is the ordinary case and says nothing extra: its
    // dimmed line is the labels alone, exactly as before.
    assert.strictEqual(web.originLabel, '');
    assert.strictEqual(web.description, 'component.aggrega.ai/category=compute · tier=frontend');

    assert.strictEqual(bare.originLabel, CATALOG_ORIGIN_LABEL);
    assert.strictEqual(bare.description, 'from a configured catalog directory');

    assert.strictEqual(labelled.originLabel, CATALOG_ORIGIN_LABEL);
    assert.strictEqual(
      labelled.description,
      'from a configured catalog directory — feature.aggrega.ai/kind=secret',
    );
  });

  it('says where a catalog-resolved row came from without wording it as a fault', async () => {
    // The note reports a source. It is not one of the rows that report a
    // problem, and it must not read like one: an entity resolved from a
    // configured catalog directory is present, named and usable.
    assert.notStrictEqual(CATALOG_ORIGIN_LABEL, FAILURE_LABEL);
    assert.notStrictEqual(CATALOG_ORIGIN_LABEL, EMPTY_LABEL);
    assert.notStrictEqual(CATALOG_ORIGIN_LABEL, SERVER_STOPPED_LABEL);
    assert.notStrictEqual(CATALOG_ORIGIN_LABEL, NO_ANCHORED_WORKSPACE_TREE_LABEL);
  });

  it('names no file on a row that has none, and says where it came from instead', async () => {
    const rows = flatRows(await harness(WORKSPACE_ROOT, ok(MEASURED_TWO_ORIGIN_DOCUMENT)).nodes());
    const [web, bare] = rows;

    assert.deepStrictEqual(web.tooltip.split('\n'), [
      'kind: Component',
      'name: web',
      'apiVersion: aggrega.ai/v1alpha1',
      'description: The public web tier',
      'label: component.aggrega.ai/category=compute',
      'label: tier=frontend',
      'file: components/web.yaml',
    ]);

    assert.deepStrictEqual(bare.tooltip.split('\n'), [
      'kind: Feature',
      'name: core/apply-untrusted-label',
      'apiVersion: aggrega.ai/v1alpha1',
      'from a configured catalog directory',
    ]);
    // The empty path contributes no named-but-empty line, the same way an
    // undeclared description contributes none.
    assert.ok(!bare.tooltip.includes('file:'));
  });

  it('marks a row that is not a file in this workspace with its own icon', async () => {
    const rows = flatRows(await harness(WORKSPACE_ROOT, ok(MEASURED_TWO_ORIGIN_DOCUMENT)).nodes());
    const [web, bare, labelled] = rows;

    assert.notStrictEqual(bare.icon, web.icon);
    assert.strictEqual(bare.icon, labelled.icon);
  });

  it('reads back the two origins the server sends', () => {
    // The recorded response is what pins these. They are values on a wire this
    // side cannot import, so a change to either on the server's side is caught
    // by re-recording the response rather than by anything the compiler sees.
    const origins = MEASURED_TWO_ORIGIN_DOCUMENT.entities.map((e) => e.origin);
    assert.deepStrictEqual(origins, ['workspace', 'catalog', 'catalog']);
    assert.strictEqual(ENTITY_ORIGIN_WORKSPACE, 'workspace');
    assert.strictEqual(ENTITY_ORIGIN_CATALOG, 'catalog');
    assert.ok(origins.includes(ENTITY_ORIGIN_WORKSPACE));
    assert.ok(origins.includes(ENTITY_ORIGIN_CATALOG));
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
      origin: 'workspace',
    });

    assert.strictEqual(row.label, 'platform');
    assert.strictEqual(row.description, 'env=prod');
    assert.strictEqual(row.originLabel, '');
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
      origin: 'workspace',
    });
    assert.strictEqual(row.label, 'x');
    assert.ok(row.tooltip.startsWith('kind: SomeKindThisExtensionDoesNotKnow'));
  });

  it('reads the origin the server stated, and never the path it sent', () => {
    // The two entities differ ONLY in origin: same kind, same name, same empty
    // file. A shaping that decided by looking at the path could not tell them
    // apart, so this is the assertion that fails if the reading moves back onto
    // the consequence.
    const shared = {
      kind: 'Feature',
      name: 'core/retry-policy',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: '',
    };

    const fromCatalog = rowForEntity(WORKSPACE_ROOT, { ...shared, origin: 'catalog' });
    assert.strictEqual(fromCatalog.openPath, null);
    assert.strictEqual(fromCatalog.originLabel, CATALOG_ORIGIN_LABEL);

    // An origin the client does not recognise is classified as neither: no open
    // target guessed, and no note claiming a source it was not told about. The
    // failure this pins is a missing affordance, which a reader sees, rather
    // than a wrong one, which they do not.
    const unknown = rowForEntity(WORKSPACE_ROOT, { ...shared, origin: 'something-else' });
    assert.strictEqual(unknown.openPath, null);
    assert.strictEqual(unknown.originLabel, '');
  });

  it('a workspace document with a path opens it, whatever else is on the entity', () => {
    const row = rowForEntity(WORKSPACE_ROOT, {
      kind: 'Feature',
      name: 'tls',
      apiVersion: 'aggrega.ai/v1alpha1',
      description: '',
      labels: {},
      file: 'features/tls.yaml',
      origin: ENTITY_ORIGIN_WORKSPACE,
    });
    assert.strictEqual(row.openPath, '/ws/features/tls.yaml');
    assert.strictEqual(row.originLabel, '');
  });
});
