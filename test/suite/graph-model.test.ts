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
// The layout engine is a dependency of this package, so the geometry tests
// below run a REAL hierarchical layout and assert against what it returns.
// That is what lets the coordinate space an edge is stated in be proved here
// rather than left to a reader looking at a picture.
//
// What remains unverifiable here is the drawing itself — the SVG, the text
// advance a font actually produces, and everything the panel puts on screen.
// The rules those rest on are all here; the pixels are not.

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
  _kind?: string;
  _title?: string;
  _label?: string;
  _rank?: number;
}

interface ElkPoint { x: number; y: number }

interface ElkSection {
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  sections?: ElkSection[];
  _origin: string;
  _socket: string;
  _alias: string;
}

interface ElkRoot extends ElkNode {
  edges: ElkEdge[];
}

interface NodeMeta {
  component: string;
  subLabel: string;
  version: string;
  wave: number;
  labels: Record<string, string>;
  catalog: unknown;
  sourceFile: string;
  accent: string | null;
}

interface PlacedBox {
  node: ElkNode;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LegendRow { swatch: string; text: string }

type Measure = (text: string, role: string) => number;

interface GraphModel {
  toElkGraph(graph: unknown, measure?: Measure): { root: ElkRoot; meta: Map<string, NodeMeta> };
  place(laid: unknown): { boxes: PlacedBox[]; origins: Map<string, ElkPoint> };
  edgePaths(edge: unknown, origins: Map<string, ElkPoint>): ElkPoint[][];
  nodeTooltip(id: string, m: NodeMeta | undefined): string;
  edgeTooltip(edge: ElkEdge): string;
  waveRanks(waves: number[]): Map<number, number>;
  nodeWave(node: unknown): number;
  containerLabel(kind: string, title: string): string;
  ROLE_NODE_ID: string;
  ROLE_NODE_COMPONENT: string;
  ROLE_CONTAINER_TITLE: string;
  LEGEND_TITLE: string;
  LEGEND_ROWS: LegendRow[];
  LEGEND_NOTE: string;
}

// The advance each text role gets in the stand-in measurement below. The three
// differ so an assertion can tell WHICH drawn line a width was computed from,
// which one shared advance could not.
const ROLE_ADVANCE: Record<string, number> = {
  'node-id': 10,
  'node-component': 6,
  'container-title': 5,
};

// measured is a deterministic stand-in for the webview's own measurement. The
// real one asks the document for a font's text advance; this one is the same
// contract with an arithmetic answer, so what the tests exercise is the sizing
// rule rather than a font.
const measured: Measure = (text, role) => text.length * (ROLE_ADVANCE[role] ?? 0);

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
  // boundary lets the assertions below compare values rather than realms — and
  // it is also what makes the transform's output acceptable to the layout
  // engine, whose importer type-checks the arrays it is handed.
  return {
    toElkGraph: (graph, measure) => structuredClone(model.toElkGraph(graph, measure ?? measured)),
    place: (laid) => structuredClone(model.place(laid)),
    edgePaths: (edge, origins) => structuredClone(model.edgePaths(edge, origins)),
    waveRanks: (waves) => structuredClone(model.waveRanks(waves)),
    nodeTooltip: (id, m) => model.nodeTooltip(id, m),
    edgeTooltip: (edge) => model.edgeTooltip(edge),
    nodeWave: (n) => model.nodeWave(n),
    containerLabel: (kind, title) => model.containerLabel(kind, title),
    ROLE_NODE_ID: model.ROLE_NODE_ID,
    ROLE_NODE_COMPONENT: model.ROLE_NODE_COMPONENT,
    ROLE_CONTAINER_TITLE: model.ROLE_CONTAINER_TITLE,
    LEGEND_TITLE: model.LEGEND_TITLE,
    LEGEND_ROWS: structuredClone(model.LEGEND_ROWS),
    LEGEND_NOTE: model.LEGEND_NOTE,
  };
}

// rawModel hands back the shipped script's own exports, uncloned, for the one
// assertion that is about the transform refusing rather than about its output.
function rawModel(): GraphModel {
  const file = path.join(__dirname, '..', '..', '..', 'media', 'graph-model.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  return sandbox.AggregaGraphModel as GraphModel;
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

describe('topology graph model — sizing a box around the text it draws', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  function widthOf(id: string, fields: Record<string, unknown>, measure?: Measure): number {
    const { root } = model.toElkGraph(irGraph({ [id]: node(fields) }), measure);
    const box = leaves(root).find(n => n.id === id);
    assert.ok(box, `no box for ${id}`);
    return box.width ?? 0;
  }

  it('sizes the box against the component name when that is the longer line', () => {
    // The line under the id is the one whose length nothing else bounds, and it
    // is drawn precisely when it differs from the id — so a box sized against
    // the id alone is a box the component name runs out of.
    const id = 'db';
    const component = 'core/postgresql-with-read-replicas';
    const width = widthOf(id, { component });
    assert.ok(
      width >= measured(component, model.ROLE_NODE_COMPONENT),
      `box ${width} is narrower than the component name it draws `
      + `(${measured(component, model.ROLE_NODE_COMPONENT)})`,
    );
    // And it is that line, not the id, that decided the width.
    assert.ok(width > measured(id, model.ROLE_NODE_ID) + 24);
  });

  it('sizes the box against the id when the id is the longer line', () => {
    const id = 'payments-ledger-projection';
    const width = widthOf(id, { component: 'svc' });
    assert.ok(
      width >= measured(id, model.ROLE_NODE_ID),
      `box ${width} is narrower than the id it draws`,
    );
  });

  it('measures nothing for a second line it will not draw', () => {
    // A component name repeating the id draws no second line, so it must not
    // widen the box either — otherwise the box carries room for text nobody
    // put on it.
    const asked: string[] = [];
    const spy: Measure = (text, role) => { asked.push(role); return measured(text, role); };
    const { meta } = model.toElkGraph(irGraph({ svc: node({ component: 'svc' }) }), spy);
    assert.strictEqual(meta.get('svc')!.subLabel, '');
    assert.ok(!asked.includes(model.ROLE_NODE_COMPONENT), 'measured a line it will not draw');
  });

  it('reports the second line it will draw, so the drawing and the sizing agree', () => {
    const { meta } = model.toElkGraph(irGraph({
      db: node({ component: 'core/postgresql' }),
      svc: node({ component: 'svc' }),
    }));
    assert.strictEqual(meta.get('db')!.subLabel, 'core/postgresql');
    assert.strictEqual(meta.get('svc')!.subLabel, '');
  });

  it('never draws a box narrower than the minimum', () => {
    assert.strictEqual(widthOf('a', { component: 'a' }), 90);
  });

  it('refuses to size anything without a measurement', () => {
    // The measurement is required rather than defaulted, because a default
    // would be an estimate and an estimate standing in silently for a
    // measurement is the fault this argument exists to remove.
    const raw = rawModel();
    assert.throws(() => raw.toElkGraph(irGraph({ a: node({}) })));
  });
});

describe('topology graph model — telling the two container kinds apart', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  it('names each kind in words, so an ungrouped workspace can still tell them apart', () => {
    // A node in no declared grouping falls back to one title at BOTH levels, so
    // a boundary ends up holding a subsystem of the same name. The kind is what
    // separates them, and it is a word rather than a glyph a few pixels wide.
    const { root } = model.toElkGraph(irGraph({ solo: node({}) }));
    const drawn = containers(root).map(c => c._label);
    assert.strictEqual(drawn.length, 2);
    assert.notStrictEqual(drawn[0], drawn[1], 'both containers draw the same title');
    assert.ok(drawn[0]!.includes('boundary'), `outer container reads ${drawn[0]}`);
    assert.ok(drawn[1]!.includes('subsystem'), `inner container reads ${drawn[1]}`);
    // And the fallback says no grouping was declared rather than naming one.
    for (const label of drawn) {
      assert.ok(label!.includes('(none declared)'), `fallback reads ${label}`);
    }
  });

  it('names a declared grouping after its kind', () => {
    const { root } = model.toElkGraph(irGraph({
      web: node({ boundary_path: 'serving', subsystem_path: 'front' }),
    }));
    const drawn = containers(root).map(c => c._label);
    assert.ok(drawn[0]!.endsWith('serving'), `outer container reads ${drawn[0]}`);
    assert.ok(drawn[1]!.endsWith('front'), `inner container reads ${drawn[1]}`);
    assert.ok(drawn[0]!.includes('boundary') && drawn[1]!.includes('subsystem'));
  });

  it('keeps the grouping the compiler named separate from the title drawn for it', () => {
    // The path is a fact from the IR and the label is what the drawing says
    // about it; conflating them would leave the layout keyed on presentation.
    const { root } = model.toElkGraph(irGraph({
      web: node({ boundary_path: 'serving' }),
    }));
    assert.strictEqual(containers(root)[0]!._title, 'serving');
    assert.strictEqual(containers(root)[0]!._label, model.containerLabel('boundary', 'serving'));
  });
});

describe('topology graph model — groupings nobody declared', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  // The title the drawing gives the nodes in no declared grouping, as a reader
  // meets it.
  const NONE = '(none declared)';

  // titles lists every container's title, depth first, as "kind title".
  const titles = (root: ElkNode): string[] => containers(root).map(c => `${c._kind} ${c._title}`);

  it('titles a grouping the compiler marks as synthesized as declaring none, on both axes', () => {
    // The compiler gives the grouping it synthesizes a name, so the name it
    // sends says nothing about whether anyone declared the grouping; the mark
    // it sends beside it does.
    const { root } = model.toElkGraph(irGraph({
      solo: node({
        boundary_path: 'default', subsystem_path: 'default', synthesized_boundary: true, synthesized_subsystem: true,
      }),
    }));
    assert.deepStrictEqual(titles(root), [`boundary ${NONE}`, `subsystem ${NONE}`]);
    assert.deepStrictEqual(
      containers(root).map(c => c._label),
      [model.containerLabel('boundary', NONE), model.containerLabel('subsystem', NONE)],
    );
  });

  it('reads each axis by its own mark', () => {
    // A module listing its components at the top level, routed into a boundary
    // the Release declares: the subsystem is the compiler's and the boundary is
    // the author's, and each is titled for what it is.
    const { root } = model.toElkGraph(irGraph({
      cache: node({ boundary_path: 'data', subsystem_path: 'backend' }),
      'sessions.store': node({ boundary_path: 'data', subsystem_path: 'default', synthesized_subsystem: true }),
    }));
    assert.deepStrictEqual(titles(root), ['boundary data', 'subsystem backend', `subsystem ${NONE}`]);
  });

  it('keeps the name of a grouping an author declared, the name the compiler gives its own included', () => {
    const { root } = model.toElkGraph(irGraph({
      solo: node({ boundary_path: 'default', subsystem_path: 'default' }),
    }));
    assert.deepStrictEqual(titles(root), ['boundary default', 'subsystem default']);
  });

  it('draws a declared grouping and a synthesized one of the same name as two boxes', () => {
    // Keyed by the name, the two would share one box, and whichever title it
    // took would be wrong about the other's nodes.
    const { root } = model.toElkGraph(irGraph({
      api: node({ boundary_path: 'data', subsystem_path: 'default' }),
      'sessions.store': node({ boundary_path: 'data', subsystem_path: 'default', synthesized_subsystem: true }),
    }));
    const subsystems = containers(root).filter(c => c._kind === 'subsystem');
    assert.deepStrictEqual(
      subsystems.map(s => [s._title, leaves(s).map(n => n.id)]),
      [['default', ['api']], [NONE, ['sessions.store']]],
    );
  });
});

// nestedSubsystems is a topology whose subsystems are declared inside one
// another, two deep, and with one subsystem that holds no node of its own. In
// the zone boundary: outer holds gate, outer.middle holds api, and
// outer.middle.inner holds db; hollow holds nothing but hollow.leaf, which holds
// job. db is the first node, so the subsystems it sits inside are first met
// through it. api→db joins two nested subsystems, gate→api runs from a subsystem
// into one declared inside it, and gate→job leaves both for the boundary.
function nestedSubsystems(waves: Record<string, number> = {}): unknown {
  const at = (subsystem: string, id: string): Record<string, unknown> =>
    node({ boundary_path: 'zone', subsystem_path: subsystem, ...(id in waves ? { sync_wave: waves[id] } : {}) });
  return irGraph(
    {
      db: at('outer.middle.inner', 'db'),
      gate: at('outer', 'gate'),
      api: at('outer.middle', 'api'),
      job: at('hollow.leaf', 'job'),
    },
    [
      { source: 'api', target: 'db' },
      { source: 'gate', target: 'api' },
      { source: 'gate', target: 'job' },
    ],
  );
}

// outline is a container's contents as titles and ids, nested as they are
// handed to the layout engine.
function outline(n: ElkNode): unknown[] {
  return (n.children ?? []).map(c => (c._kind ? { [`${c._kind} ${c._title}`]: outline(c) } : c.id));
}

describe('topology graph model — subsystems declared inside one another', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  it('puts each subsystem inside the one it is declared in, at every depth', () => {
    // hollow holds no node of its own, and still gets its box, because the
    // subsystem declared inside it has to sit somewhere.
    const { root } = model.toElkGraph(nestedSubsystems());
    assert.deepStrictEqual(outline(root), [{
      'boundary zone': [
        { 'subsystem outer': ['gate', { 'subsystem outer.middle': ['api', { 'subsystem outer.middle.inner': ['db'] }] }] },
        { 'subsystem hollow': [{ 'subsystem hollow.leaf': ['job'] }] },
      ],
    }]);
  });

  it('titles a nested subsystem with its whole path', () => {
    const { root } = model.toElkGraph(nestedSubsystems());
    const inner = containers(root).find(c => c._title === 'outer.middle.inner');
    assert.ok(inner, 'no container for outer.middle.inner');
    assert.strictEqual(inner._label, model.containerLabel('subsystem', 'outer.middle.inner'));
  });

  it('orders a subsystem by the earliest wave anywhere inside it', () => {
    // job, two levels into hollow, is the earliest work in the zone, so hollow
    // is laid out ahead of outer although outer was met first.
    const { root } = model.toElkGraph(nestedSubsystems({ job: -1 }));
    const zone = (root.children ?? [])[0]!;
    assert.deepStrictEqual((zone.children ?? []).map(c => c._title), ['hollow', 'outer']);
    assert.deepStrictEqual((zone.children ?? []).map(partitionOf), ['0', '1']);
    for (const c of containers(root)) {
      assert.strictEqual(c.layoutOptions?.['elk.partitioning.activate'], 'true', `container ${c.id}`);
      assert.ok(partitionOf(c) !== undefined, `container ${c.id} carries no partition`);
    }
  });
});

// nestedBoundaries is a topology whose Release boundaries are declared inside
// one another, two deep, and with one boundary that places no node of its own.
// site places gate; site/zone places api, in the subsystem svc; site/zone/vault
// places db, in svc.store, so the nodes of one subsystem are placed in two
// boundaries; shell places nothing and holds shell/core, which places job. db is
// the first node, so the boundaries it sits inside are first met through it.
// api→db joins two nested boundaries, gate→api runs from a boundary into one
// declared inside it, and gate→job leaves both for the graph as a whole.
function nestedBoundaries(waves: Record<string, number> = {}): unknown {
  const at = (boundary: string, subsystem: string, id: string): Record<string, unknown> =>
    node({ boundary_path: boundary, subsystem_path: subsystem, ...(id in waves ? { sync_wave: waves[id] } : {}) });
  return irGraph(
    {
      db: at('site/zone/vault', 'svc.store', 'db'),
      gate: at('site', 'front', 'gate'),
      api: at('site/zone', 'svc', 'api'),
      job: at('shell/core', 'batch', 'job'),
    },
    [
      { source: 'api', target: 'db' },
      { source: 'gate', target: 'api' },
      { source: 'gate', target: 'job' },
    ],
  );
}

describe('topology graph model — boundaries declared inside one another', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  it('puts each boundary inside the one it is declared in, at every depth', () => {
    // shell places no node of its own, and still gets its box, because the
    // boundary declared inside it has to sit somewhere. Each boundary holds the
    // subsystems of the nodes it places itself, so svc is drawn in site/zone and
    // again in site/zone/vault, around svc.store.
    const { root } = model.toElkGraph(nestedBoundaries());
    assert.deepStrictEqual(outline(root), [
      {
        'boundary site': [
          { 'subsystem front': ['gate'] },
          {
            'boundary site/zone': [
              { 'subsystem svc': ['api'] },
              { 'boundary site/zone/vault': [{ 'subsystem svc': [{ 'subsystem svc.store': ['db'] }] }] },
            ],
          },
        ],
      },
      { 'boundary shell': [{ 'boundary shell/core': [{ 'subsystem batch': ['job'] }] }] },
    ]);
  });

  it('titles a nested boundary with its whole path', () => {
    const { root } = model.toElkGraph(nestedBoundaries());
    const vault = containers(root).find(c => c._title === 'site/zone/vault');
    assert.ok(vault, 'no container for site/zone/vault');
    assert.strictEqual(vault._label, model.containerLabel('boundary', 'site/zone/vault'));
  });

  it('orders a boundary by the earliest wave anywhere inside it', () => {
    // db, two boundaries into site, is the earliest work there, so site/zone is
    // laid out ahead of the subsystem front although front holds a node of site
    // itself.
    const { root } = model.toElkGraph(nestedBoundaries({ db: -1 }));
    const site = (root.children ?? []).find(c => c._title === 'site');
    assert.ok(site, 'no container for site');
    assert.deepStrictEqual((site.children ?? []).map(c => c._title), ['site/zone', 'front']);
    assert.deepStrictEqual((site.children ?? []).map(partitionOf), ['0', '1']);
  });
});

describe('topology graph model — the legend', () => {
  let model: GraphModel;

  beforeEach(() => {
    model = loadModel();
  });

  const rowFor = (m: GraphModel, swatch: string): string => {
    const row = m.LEGEND_ROWS.find(r => r.swatch === swatch);
    assert.ok(row, `the legend has no ${swatch} row`);
    return row!.text;
  };

  it('names each grouping by the document that declares it', () => {
    // Asserting that a row merely MENTIONS its own subject is satisfied by any
    // wording at all, including one that only says where the box sits — which a
    // reader can already see. What the legend has to carry is where a grouping
    // comes from: boundaries are declared on a Release and subsystems on an
    // Aggregate, and naming the document is what turns a box on the canvas into
    // a file the reader knows how to open.
    const boundary = rowFor(model, 'boundary');
    assert.ok(/\bBoundary\b/.test(boundary), `the boundary row drops its heading: ${boundary}`);
    assert.ok(/\bRelease\b/.test(boundary), `the boundary row never names the Release: ${boundary}`);

    const subsystem = rowFor(model, 'subsystem');
    assert.ok(/\bSubsystem\b/.test(subsystem), `the subsystem row drops its heading: ${subsystem}`);
    assert.ok(
      /\bAggregate\b/.test(subsystem),
      `the subsystem row never names the Aggregate: ${subsystem}`,
    );

    const accent = rowFor(model, 'accent');
    assert.ok(/node type/i.test(accent), `the accent row never names the node type: ${accent}`);

    assert.deepStrictEqual(
      model.LEGEND_ROWS.map(r => r.swatch),
      ['boundary', 'subsystem', 'accent'],
    );
  });

  it('states where a grouping comes from and not where its box sits', () => {
    // The nesting the drawing shows is how this graph happens to be laid out. A
    // row asserting that one grouping sits inside the other would be a rule the
    // legend cannot vouch for, and one describing a box's position teaches the
    // reader nothing they cannot see.
    //
    // This polices the positional vocabulary, which is the wording that was
    // there to be restored; it cannot police the habit, so a containment claim
    // phrased in words this pattern does not carry would pass it.
    for (const swatch of ['boundary', 'subsystem']) {
      const text = rowFor(model, swatch);
      assert.ok(
        !/\b(inside|outer|inner|within|contains?|nested?)\b/i.test(text),
        `the ${swatch} row describes position rather than origin: ${text}`,
      );
    }
  });

  it('says an accent colour means nothing outside the graph it is drawn in', () => {
    // The colours are assigned in first-encounter order from a fixed palette,
    // so they group nodes within one drawing and carry no meaning between two.
    // A reader not told that will compare two graphs by colour.
    const note = model.LEGEND_NOTE.toLowerCase();
    assert.ok(note.includes('this graph'), `the bound is not stated: ${model.LEGEND_NOTE}`);
    assert.ok(
      note.includes('another graph') || note.includes('other graph'),
      `the note never says what a colour does NOT mean: ${model.LEGEND_NOTE}`,
    );
  });
});

// onBorder reports whether a point sits on the outline of a box, within the
// rounding the layout's own fractional coordinates carry.
function onBorder(p: ElkPoint, b: PlacedBox): boolean {
  const eps = 0.01;
  const onX = Math.abs(p.x - b.x) < eps || Math.abs(p.x - (b.x + b.width)) < eps;
  const onY = Math.abs(p.y - b.y) < eps || Math.abs(p.y - (b.y + b.height)) < eps;
  const withinX = p.x >= b.x - eps && p.x <= b.x + b.width + eps;
  const withinY = p.y >= b.y - eps && p.y <= b.y + b.height + eps;
  return (onX && withinY) || (onY && withinX);
}

// inside reports whether one placed box lies wholly within another.
function inside(inner: PlacedBox, outer: PlacedBox): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

// containerPlaced is the box a placed layout holds for the container titled
// `title`, the first met in draw order.
function containerPlaced(placed: { boxes: PlacedBox[] }, title: string): PlacedBox {
  const box = placed.boxes.find(b => b.kind !== 'node' && b.node._title === title);
  assert.ok(box, `nothing was placed for ${title}`);
  return box;
}

// nodePlaced is the box a placed layout holds for the node `id`.
function nodePlaced(placed: { boxes: PlacedBox[] }, id: string): PlacedBox {
  const box = placed.boxes.find(b => b.kind === 'node' && b.node.id === id);
  assert.ok(box, `nothing was placed for ${id}`);
  return box;
}

// crossesContainers is a topology whose edges leave their subsystem and leave
// their boundary, which is what lets it say anything about hierarchical routing
// at all: a graph whose edges all sit inside one container exercises none of it.
//
// serving/front holds web and api; serving/aux holds cache; data/store holds db
// and backup. api→cache leaves a subsystem, api→db and web→backup leave a
// boundary, and web→api and backup→db stay put.
function crossesContainers(): unknown {
  return irGraph(
    {
      web: node({ boundary_path: 'serving', subsystem_path: 'front', sync_wave: 0 }),
      api: node({ boundary_path: 'serving', subsystem_path: 'front', sync_wave: 0 }),
      cache: node({ boundary_path: 'serving', subsystem_path: 'aux', sync_wave: 1 }),
      db: node({ boundary_path: 'data', subsystem_path: 'store', sync_wave: 0 }),
      backup: node({ boundary_path: 'data', subsystem_path: 'store', sync_wave: 2 }),
    },
    [
      { source: 'web', target: 'api' },
      { source: 'api', target: 'cache' },
      { source: 'api', target: 'db' },
      { source: 'backup', target: 'db' },
      { source: 'web', target: 'backup' },
    ],
  );
}

describe('topology graph model — resolving a real layout into one space', function () {
  // A real layout run, so this is slower than the transform tests beside it.
  this.timeout(20000);

  // The layout engine ships with this package and runs in process, so the
  // geometry a drawing would use is obtainable here without an editor. What is
  // asserted is the resolution the drawing performs, over what the engine
  // actually returns rather than over an assumption about it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ELK = require('elkjs/lib/elk.bundled.js');

  let model: GraphModel;
  let laid: ElkRoot;
  let placed: { boxes: PlacedBox[]; origins: Map<string, ElkPoint> };

  before(async () => {
    model = loadModel();
    const { root } = model.toElkGraph(crossesContainers());
    const elk = new ELK();
    laid = JSON.parse(JSON.stringify(await elk.layout(root))) as ElkRoot;
    placed = model.place(laid);
  });

  function boxOf(id: string): PlacedBox {
    const box = placed.boxes.find(b => b.node.id === id);
    assert.ok(box, `nothing was placed for ${id}`);
    return box;
  }

  it('exercises the hierarchical case rather than only the flat one', () => {
    // The whole point of the fixture. An edge the engine assigns to a container
    // is one whose geometry is NOT stated against the graph as a whole, and if
    // no edge in the fixture is one of those, everything below passes without
    // having tested anything.
    const nested = laid.edges.filter(e => e.container && e.container !== laid.id);
    assert.ok(nested.length > 0, 'no edge was assigned to a container; the fixture proves nothing');
    const flat = laid.edges.filter(e => !e.container || e.container === laid.id);
    assert.ok(flat.length > 0, 'no edge spans containers; the fixture proves nothing');
  });

  it('puts both ends of every edge on the nodes it joins', () => {
    // An edge's geometry is stated against the container the engine assigned it
    // to, not against the graph as a whole. Reading it as though it were stated
    // against the graph shifts a contained edge up and left by its container's
    // origin — out of the box it belongs to and across whatever lies that way,
    // which is an edge drawn cutting through a container it has no endpoint in.
    for (const e of laid.edges) {
      const source = boxOf(e.sources[0]);
      const target = boxOf(e.targets[0]);
      const paths = model.edgePaths(e, placed.origins);
      assert.ok(paths.length > 0, `${e.id} was laid out with no geometry`);
      for (const points of paths) {
        const start = points[0]!;
        const end = points[points.length - 1]!;
        assert.ok(
          onBorder(start, source),
          `${e.id} starts at (${start.x},${start.y}), off ${e.sources[0]}`,
        );
        assert.ok(
          onBorder(end, target),
          `${e.id} ends at (${end.x},${end.y}), off ${e.targets[0]}`,
        );
      }
    }
  });

  it('moves the geometry of an edge the engine assigned to a container', () => {
    // The control on the assertion above: without this, a resolution that did
    // nothing at all would pass it on a layout that happened to be flat.
    const nested = laid.edges.find(e => e.container && e.container !== laid.id);
    assert.ok(nested, 'no contained edge to check');
    const origin = placed.origins.get(nested.container!);
    assert.ok(origin, `no origin was recorded for ${nested.container}`);
    assert.ok(origin.x !== 0 || origin.y !== 0, 'the container sits at the graph origin');
    const raw = nested.sections![0]!.startPoint;
    const resolved = model.edgePaths(nested, placed.origins)[0]![0]!;
    assert.notDeepStrictEqual({ x: raw.x, y: raw.y }, resolved);
  });

  it('reads an edge that names no container against the graph itself', () => {
    const points = model.edgePaths(
      { container: undefined, sections: [{ startPoint: { x: 3, y: 4 }, endPoint: { x: 5, y: 6 } }] },
      placed.origins,
    );
    assert.deepStrictEqual(points, [[{ x: 3, y: 4 }, { x: 5, y: 6 }]]);
  });

  it('keeps every container wide enough for the title drawn on it', () => {
    // The title names the container's kind as well as its grouping, so it is
    // longer than the grouping alone — and a container's size is otherwise
    // decided by what it holds, which a box holding one narrow node makes far
    // too small for the words naming it.
    for (const box of placed.boxes) {
      if (box.kind === 'node') { continue; }
      const label = box.node._label!;
      const needed = measured(label, model.ROLE_CONTAINER_TITLE) + 10;
      assert.ok(
        box.width >= needed,
        `${box.node.id} is ${box.width} wide and its title "${label}" needs ${needed}`,
      );
    }
  });

  it('places every box inside the one that holds it', () => {
    for (const box of placed.boxes) {
      if (box.kind === 'boundary') { continue; }
      const parent = placed.boxes.find(
        b => b !== box && (b.node.children ?? []).some(c => c.id === box.node.id),
      );
      assert.ok(parent, `${box.node.id} was placed with no parent`);
      assert.ok(inside(box, parent), `${box.node.id} is not inside ${parent.node.id}`);
    }
  });
});

describe('topology graph model — laying out subsystems declared inside one another', function () {
  // A real layout run, as the one above.
  this.timeout(20000);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ELK = require('elkjs/lib/elk.bundled.js');

  let model: GraphModel;
  let laid: ElkRoot;
  let placed: { boxes: PlacedBox[]; origins: Map<string, ElkPoint> };

  before(async () => {
    model = loadModel();
    const { root } = model.toElkGraph(nestedSubsystems());
    laid = JSON.parse(JSON.stringify(await new ELK().layout(root))) as ElkRoot;
    placed = model.place(laid);
  });

  const boxTitled = (title: string): PlacedBox => containerPlaced(placed, title);
  const boxOf = (id: string): PlacedBox => nodePlaced(placed, id);

  it('draws a subsystem nested two deep inside both subsystems it is declared in', () => {
    const zone = boxTitled('zone');
    const outer = boxTitled('outer');
    const middle = boxTitled('outer.middle');
    const inner = boxTitled('outer.middle.inner');
    assert.ok(inside(inner, middle), 'outer.middle.inner is not drawn inside outer.middle');
    assert.ok(inside(middle, outer), 'outer.middle is not drawn inside outer');
    assert.ok(inside(outer, zone), 'outer is not drawn inside its boundary');
    assert.ok(inside(boxOf('db'), inner), 'db is not drawn inside outer.middle.inner');
    // A subsystem holding no node of its own is drawn, around the one inside it.
    assert.ok(inside(boxTitled('hollow.leaf'), boxTitled('hollow')), 'hollow.leaf is not drawn inside hollow');
    assert.ok(inside(boxOf('job'), boxTitled('hollow.leaf')), 'job is not drawn inside hollow.leaf');
  });

  it('resolves an edge between nested subsystems into the container the two share', () => {
    // api sits in outer.middle and db one level further in, so the engine
    // states that edge's geometry against outer.middle — a container two levels
    // below the graph, whose own position is the sum of the two holding it.
    const edge = laid.edges.find(e => e.sources[0] === 'api' && e.targets[0] === 'db');
    assert.ok(edge, 'no edge from api to db was laid out');
    const middle = boxTitled('outer.middle');
    assert.strictEqual(edge.container, middle.node.id);
    const paths = model.edgePaths(edge, placed.origins);
    assert.ok(paths.length > 0, 'the edge was laid out with no geometry');
    for (const points of paths) {
      const start = points[0]!;
      const end = points[points.length - 1]!;
      assert.ok(onBorder(start, boxOf('api')), `the edge starts at (${start.x},${start.y}), off api`);
      assert.ok(onBorder(end, boxOf('db')), `the edge ends at (${end.x},${end.y}), off db`);
    }
  });

  it('puts both ends of every edge on the nodes it joins, at each depth the edge is stated at', () => {
    // gate→api is stated against outer and gate→job against the boundary, so
    // with api→db the three edges are stated at three different depths.
    const stated = new Set(laid.edges.map(e => e.container));
    assert.strictEqual(stated.size, 3, `the edges are stated against ${JSON.stringify([...stated])}`);
    for (const e of laid.edges) {
      for (const points of model.edgePaths(e, placed.origins)) {
        assert.ok(onBorder(points[0]!, boxOf(e.sources[0])), `${e.id} starts off ${e.sources[0]}`);
        assert.ok(onBorder(points[points.length - 1]!, boxOf(e.targets[0])), `${e.id} ends off ${e.targets[0]}`);
      }
    }
  });
});

describe('topology graph model — laying out boundaries declared inside one another', function () {
  // A real layout run, as the ones above.
  this.timeout(20000);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ELK = require('elkjs/lib/elk.bundled.js');

  let model: GraphModel;
  let laid: ElkRoot;
  let placed: { boxes: PlacedBox[]; origins: Map<string, ElkPoint> };

  before(async () => {
    model = loadModel();
    const { root } = model.toElkGraph(nestedBoundaries());
    laid = JSON.parse(JSON.stringify(await new ELK().layout(root))) as ElkRoot;
    placed = model.place(laid);
  });

  const boxTitled = (title: string): PlacedBox => containerPlaced(placed, title);
  const boxOf = (id: string): PlacedBox => nodePlaced(placed, id);

  it('draws a boundary nested two deep inside both boundaries it is declared in', () => {
    const site = boxTitled('site');
    const zone = boxTitled('site/zone');
    const vault = boxTitled('site/zone/vault');
    assert.ok(inside(vault, zone), 'site/zone/vault is not drawn inside site/zone');
    assert.ok(inside(zone, site), 'site/zone is not drawn inside site');
    assert.ok(inside(boxOf('db'), vault), 'db is not drawn inside site/zone/vault');
    assert.ok(inside(boxOf('api'), zone) && !inside(boxOf('api'), vault), 'api is not drawn in site/zone alone');
    // A boundary placing no node of its own is drawn, around the one inside it.
    assert.ok(inside(boxTitled('shell/core'), boxTitled('shell')), 'shell/core is not drawn inside shell');
    assert.ok(inside(boxOf('job'), boxTitled('shell/core')), 'job is not drawn inside shell/core');
  });

  it('resolves an edge between nested boundaries into the container the two share', () => {
    // api sits in site/zone and db one boundary further in, so the engine states
    // that edge's geometry against site/zone, a container whose own position is
    // the sum of the two holding it.
    const edge = laid.edges.find(e => e.sources[0] === 'api' && e.targets[0] === 'db');
    assert.ok(edge, 'no edge from api to db was laid out');
    assert.strictEqual(edge.container, boxTitled('site/zone').node.id);
    const paths = model.edgePaths(edge, placed.origins);
    assert.ok(paths.length > 0, 'the edge was laid out with no geometry');
    for (const points of paths) {
      const start = points[0]!;
      const end = points[points.length - 1]!;
      assert.ok(onBorder(start, boxOf('api')), `the edge starts at (${start.x},${start.y}), off api`);
      assert.ok(onBorder(end, boxOf('db')), `the edge ends at (${end.x},${end.y}), off db`);
    }
  });

  it('puts both ends of every edge on the nodes it joins, at each depth the edge is stated at', () => {
    // gate→api is stated against site and gate→job against the graph as a
    // whole, so with api→db the three edges are stated at three different
    // depths.
    const stated = new Set(laid.edges.map(e => e.container));
    assert.strictEqual(stated.size, 3, `the edges are stated against ${JSON.stringify([...stated])}`);
    for (const e of laid.edges) {
      for (const points of model.edgePaths(e, placed.origins)) {
        assert.ok(onBorder(points[0]!, boxOf(e.sources[0])), `${e.id} starts off ${e.sources[0]}`);
        assert.ok(onBorder(points[points.length - 1]!, boxOf(e.targets[0])), `${e.id} ends off ${e.targets[0]}`);
      }
    }
  });
});
