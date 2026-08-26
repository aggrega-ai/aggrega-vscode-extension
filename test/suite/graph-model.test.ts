// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// The layout model runs in the webview, so it is a plain script rather than a
// module the suite can import. These tests evaluate the shipped file the same
// way the webview does — as a script assigning to the global — so what is
// asserted is the file that actually ships and not a copy of it.
//
// What remains unverifiable here is the drawing: whether elk honours the
// partitions, and where the boxes and edges land, needs the extension host and
// a real layout run. What these tests do cover is that the ordering the
// compiler declared reaches elk, in the form elk documents, for every node.

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
  _kind?: string;
  _title?: string;
  _rank?: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  _origin: string;
  _socket: string;
  _alias: string;
}

interface ElkRoot extends ElkNode {
  edges: ElkEdge[];
}

interface NodeMeta {
  component: string;
  version: string;
  wave: number;
  labels: Record<string, string>;
  catalog: unknown;
  sourceFile: string;
  accent: string | null;
}

interface GraphModel {
  toElkGraph(graph: unknown): { root: ElkRoot; meta: Map<string, NodeMeta> };
  nodeTooltip(id: string, m: NodeMeta | undefined): string;
  edgeTooltip(edge: ElkEdge): string;
  waveRanks(waves: number[]): Map<number, number>;
  nodeWave(node: unknown): number;
}

function loadModel(): GraphModel {
  const file = path.join(__dirname, '..', '..', '..', 'media', 'graph-model.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaGraphModel as GraphModel | undefined;
  assert.ok(model, `${file} defined no AggregaGraphModel global`);
  // The script runs in its own realm, so the arrays and maps it builds are
  // instances of that realm's constructors and compare unequal to this one's
  // however identical their contents. Cloning the structured results across the
  // boundary lets the assertions below compare values rather than realms.
  return {
    toElkGraph: (graph) => structuredClone(model.toElkGraph(graph)),
    waveRanks: (waves) => structuredClone(model.waveRanks(waves)),
    nodeTooltip: (id, m) => model.nodeTooltip(id, m),
    edgeTooltip: (edge) => model.edgeTooltip(edge),
    nodeWave: (n) => model.nodeWave(n),
  };
}

// irGraph wraps a node table and edge list in the envelope the daemon's irGraph
// result carries, so the fixtures below are shaped like the real payload.
function irGraph(
  nodes: Record<string, Record<string, unknown>>,
  edges: Record<string, unknown>[] = [],
): unknown {
  return {
    apiVersion: 'aggrega.ai/v1alpha1',
    kind: 'IRGraph',
    spec: { nodes, edges },
  };
}

// node builds one IR node with the two required-by-schema fields filled, so a
// fixture states only what the test is about.
function node(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({ component: 'svc', resolved_version: '1.0.0', labels: {} }, fields);
}

// leaves collects the leaf nodes of a laid-out graph in the order the model
// handed them to elk, depth first.
function leaves(n: ElkNode): ElkNode[] {
  if (!n.children || n.children.length === 0) {
    return n._kind ? [] : [n];
  }
  return n.children.flatMap(leaves);
}

function containers(n: ElkNode): ElkNode[] {
  const own = n._kind ? [n] : [];
  return own.concat((n.children ?? []).flatMap(containers));
}

function partitionOf(n: ElkNode): string | undefined {
  return n.layoutOptions?.['elk.partitioning.partition'];
}

describe('topology graph model — deployment wave ordering', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  it('ranks waves in ascending order, tolerating gaps and negatives', () => {
    // A wave may be negative and the values need not be contiguous, so the
    // ranks carry the order and never arithmetic on the values themselves.
    const ranks = model.waveRanks([7, -5, 0, 7]);
    assert.deepStrictEqual([...ranks.entries()].sort((a, b) => a[0] - b[0]), [
      [-5, 0],
      [0, 1],
      [7, 2],
    ]);
  });

  it('reads an absent, null or non-numeric wave as the default wave', () => {
    assert.strictEqual(model.nodeWave({}), 0);
    assert.strictEqual(model.nodeWave({ sync_wave: null }), 0);
    assert.strictEqual(model.nodeWave({ sync_wave: 'two' }), 0);
    assert.strictEqual(model.nodeWave({ sync_wave: 0 }), 0);
    assert.strictEqual(model.nodeWave({ sync_wave: -1 }), -1);
    assert.strictEqual(model.nodeWave({ sync_wave: 3 }), 3);
    assert.strictEqual(model.nodeWave(undefined), 0);
  });

  it('orders nodes of one subsystem by wave, keeping author order within a wave', () => {
    const { root } = model.toElkGraph(irGraph({
      late: node({ boundary_path: 'prod', subsystem_path: 'app', sync_wave: 1 }),
      'first-authored': node({ boundary_path: 'prod', subsystem_path: 'app', sync_wave: 0 }),
      'second-authored': node({ boundary_path: 'prod', subsystem_path: 'app', sync_wave: 0 }),
      earliest: node({ boundary_path: 'prod', subsystem_path: 'app', sync_wave: -1 }),
    }));

    assert.deepStrictEqual(
      leaves(root).map(n => n.id),
      ['earliest', 'first-authored', 'second-authored', 'late'],
    );
    assert.deepStrictEqual(
      leaves(root).map(partitionOf),
      ['0', '1', '1', '2'],
    );
  });

  it('orders boundaries by the earliest wave each one holds', () => {
    const { root } = model.toElkGraph(irGraph({
      web: node({ boundary_path: 'serving', sync_wave: 2 }),
      migration: node({ boundary_path: 'setup', sync_wave: -1 }),
      db: node({ boundary_path: 'data', sync_wave: 0 }),
      'db-backup': node({ boundary_path: 'data', sync_wave: 5 }),
    }));

    assert.deepStrictEqual(
      (root.children ?? []).map(c => c._title),
      ['setup', 'data', 'serving'],
    );
    // The boundary holding both the earliest and the latest work takes the
    // earliest, so it is not pushed behind a boundary that starts later.
    assert.deepStrictEqual((root.children ?? []).map(partitionOf), ['0', '1', '2']);
  });

  it('gives every node and every container a partition, and activates partitioning at each level', () => {
    // elk's own documentation notes the partition ordering is only dependable
    // when every node in the scope carries a partition, so a node whose wave
    // the compiler left out must still carry one.
    const { root } = model.toElkGraph(irGraph({
      unstated: node({ boundary_path: 'prod', subsystem_path: 'app' }),
      explicit: node({ boundary_path: 'prod', subsystem_path: 'app', sync_wave: 0 }),
      later: node({ boundary_path: 'prod', subsystem_path: 'jobs', sync_wave: 4 }),
    }));

    assert.strictEqual(root.layoutOptions?.['elk.partitioning.activate'], 'true');
    for (const c of containers(root)) {
      assert.strictEqual(c.layoutOptions?.['elk.partitioning.activate'], 'true', `container ${c.id}`);
      assert.ok(partitionOf(c) !== undefined, `container ${c.id} carries no partition`);
    }
    for (const n of leaves(root)) {
      assert.ok(partitionOf(n) !== undefined, `node ${n.id} carries no partition`);
    }
    // Two nodes the compiler put in the same wave — one by stating it, one by
    // saying nothing — land in the same partition.
    const byId = new Map(leaves(root).map(n => [n.id, n]));
    assert.strictEqual(partitionOf(byId.get('unstated')!), partitionOf(byId.get('explicit')!));
    assert.notStrictEqual(partitionOf(byId.get('later')!), partitionOf(byId.get('explicit')!));
  });

  it('renders a single-wave graph without inventing an ordering', () => {
    const { root } = model.toElkGraph(irGraph({
      a: node({}),
      b: node({}),
    }));
    assert.deepStrictEqual(leaves(root).map(n => n.id), ['a', 'b']);
    assert.deepStrictEqual(leaves(root).map(partitionOf), ['0', '0']);
  });

  it('lays out an empty graph and a graph with no spec without throwing', () => {
    assert.deepStrictEqual(model.toElkGraph(irGraph({})).root.children, []);
    assert.deepStrictEqual(model.toElkGraph({}).root.children, []);
    assert.deepStrictEqual(model.toElkGraph(undefined).root.children, []);
  });
});

describe('topology graph model — node hover', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  function metaFor(id: string, fields: Record<string, unknown>): NodeMeta {
    const { meta } = model.toElkGraph(irGraph({ [id]: node(fields) }));
    const m = meta.get(id);
    assert.ok(m, `no metadata for ${id}`);
    return m;
  }

  it('shows the resolved version, the labels and the catalog entity metadata', () => {
    const m = metaFor('payments', {
      component: 'core/service',
      resolved_version: '2.3.1',
      labels: { 'component.aggrega.ai/type': 'service' },
      catalog_metadata: {
        license: 'Apache-2.0',
        repository: 'https://example.invalid/payments',
        home: 'https://example.invalid/',
        keywords: ['payments', 'api'],
        maintainers: [
          { name: 'Platform Team', email: 'platform@example.invalid' },
          { name: 'Second Owner', url: 'https://example.invalid/owner' },
        ],
      },
      source_file: 'aggregate.yaml',
    });

    const lines = model.nodeTooltip('payments', m).split('\n');
    assert.deepStrictEqual(lines, [
      'payments',
      'component: core/service',
      'version: 2.3.1',
      'component.aggrega.ai/type: service',
      'license: Apache-2.0',
      'repository: https://example.invalid/payments',
      'home: https://example.invalid/',
      'keywords: payments, api',
      'maintainers: Platform Team <platform@example.invalid>, Second Owner <https://example.invalid/owner>',
      '↪ aggregate.yaml',
    ]);
  });

  it('omits every catalog field the compiler did not send, rather than defaulting it', () => {
    const m = metaFor('bare', {
      catalog_metadata: { license: 'MIT' },
      source_file: 'aggregate.yaml',
    });
    const text = model.nodeTooltip('bare', m);
    assert.ok(text.includes('license: MIT'));
    for (const absent of ['repository:', 'home:', 'keywords:', 'maintainers:']) {
      assert.ok(!text.includes(absent), `hover invented a ${absent} line`);
    }
  });

  it('omits the catalog block entirely when the node carries none', () => {
    const m = metaFor('plain', { source_file: 'aggregate.yaml' });
    assert.deepStrictEqual(model.nodeTooltip('plain', m).split('\n'), [
      'plain',
      'component: svc',
      'version: 1.0.0',
      '↪ aggregate.yaml',
    ]);
  });

  it('names a declared deployment wave, including a negative one, and stays silent on the default', () => {
    assert.ok(model.nodeTooltip('n', metaFor('n', { sync_wave: 3 })).includes('deployment wave: 3'));
    assert.ok(model.nodeTooltip('n', metaFor('n', { sync_wave: -1 })).includes('deployment wave: -1'));
    // The default wave is what a node with no declared one already sits in, so
    // naming it on every hover would tell the reader nothing.
    assert.ok(!model.nodeTooltip('n', metaFor('n', { sync_wave: 0 })).includes('deployment wave'));
    assert.ok(!model.nodeTooltip('n', metaFor('n', {})).includes('deployment wave'));
  });

  it('names a maintainer with no contact without leaving empty brackets', () => {
    const m = metaFor('n', { catalog_metadata: { maintainers: [{ name: 'Sole Owner' }] } });
    assert.ok(model.nodeTooltip('n', m).includes('maintainers: Sole Owner'));
    assert.ok(!model.nodeTooltip('n', m).includes('<>'));
  });

  it('assigns one accent per node type and repeats it for the same type', () => {
    const { meta } = model.toElkGraph(irGraph({
      a: node({ labels: { 'component.aggrega.ai/type': 'service' } }),
      b: node({ labels: { 'component.aggrega.ai/type': 'database' } }),
      c: node({ labels: { 'component.aggrega.ai/type': 'service' } }),
      d: node({ labels: {} }),
    }));
    assert.strictEqual(meta.get('a')!.accent, meta.get('c')!.accent);
    assert.notStrictEqual(meta.get('a')!.accent, meta.get('b')!.accent);
    assert.strictEqual(meta.get('d')!.accent, null);
  });

  it('holds no accent state between transforms', () => {
    // Each transform assigns from the head of the palette, so re-rendering the
    // same graph produces the same colours rather than drifting through the
    // palette on every refresh.
    const graph = irGraph({ a: node({ labels: { 'component.aggrega.ai/type': 'service' } }) });
    const first = model.toElkGraph(graph).meta.get('a')!.accent;
    const second = model.toElkGraph(graph).meta.get('a')!.accent;
    assert.strictEqual(first, second);
  });
});

describe('topology graph model — edge hover', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  it('carries the socket, the alias and where the edge came from', () => {
    const { root } = model.toElkGraph(irGraph(
      { app: node({}), db: node({}) },
      [{ source: 'app', target: 'db', socket: 'databases', alias: 'primary_db', origin_release: true }],
    ));
    const text = model.edgeTooltip(root.edges[0]);
    assert.deepStrictEqual(text.split('\n'), [
      'app → db',
      'origin: release',
      'socket: databases',
      'alias: primary_db',
    ]);
  });

  it('attributes an edge with no stated origin to the Aggregate', () => {
    const { root } = model.toElkGraph(irGraph(
      { app: node({}), db: node({}) },
      [{ source: 'app', target: 'db', socket: 'databases' }],
    ));
    assert.ok(model.edgeTooltip(root.edges[0]).includes('origin: aggregate'));
  });
});
