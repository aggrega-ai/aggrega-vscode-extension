// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  CatalogPanelNode,
  PanelActionNode,
  PluginsPanelNode,
  RegistriesPanelNode,
  catalogPanelNodes,
  pluginsPanelNodes,
  registriesPanelNodes,
} from '../../src/panel-actions';
import { PluginListDoc, pluginNodes } from '../../src/plugins-run';
import { RegistryListDoc, registryNodes } from '../../src/registries-run';
import {
  CatalogIndexDoc,
  workspaceCatalogNodes,
} from '../../src/workspace-catalog-run';
import {
  NO_ANCHORED_WORKSPACE_CONTROL_REASON,
  NO_ANCHORED_WORKSPACE_TREE_LABEL,
} from '../../src/workspace';

// What a reader meets at the head of each list panel, read back from the root
// the tree is handed, in every state that panel can be in. The editor's own
// drawing of a row — and a person pressing one — is not reachable here; what is
// provable is that the rows are the first thing in the root, in their order,
// each naming the command a press runs, and that a row which cannot run says why
// and binds nothing.

// The rows each panel is headed by, written out literally rather than read from
// the description the composition reads: an expectation read from that table
// agrees with it whatever it says, so it could not see a row dropped or
// reordered. folder says whether the row's operation needs an anchored folder,
// which is what decides whether it can run in a state that has none.
type Head = Array<{ label: string; command: string; icon: string; folder: boolean }>;

const REGISTRIES_HEAD: Head = [
  { label: 'Add registry', command: 'aggrega.registries.add', icon: 'add', folder: true },
  { label: 'Update index', command: 'aggrega.registries.update', icon: 'cloud-download', folder: true },
];
const CATALOG_HEAD: Head = [
  { label: 'Search catalog', command: 'aggrega.catalog.searchPublished', icon: 'cloud', folder: true },
  { label: 'Draft entity', command: 'aggrega.op.scaffold', icon: 'new-file', folder: false },
];
const PLUGINS_HEAD: Head = [
  { label: 'Add plugin', command: 'aggrega.plugins.add', icon: 'add', folder: true },
  { label: 'Generate entities', command: 'aggrega.plugins.genCatalog', icon: 'export', folder: true },
];

class FakeLog {
  readonly lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

// headOf splits a root into the rows at its head and what follows them, and
// fails where an action row appears anywhere but at the head — a row among the
// listed nodes would be an operation drawn inside the list rather than above it.
function headOf<N extends { kind: string }>(root: N[]): { head: PanelActionNode[]; rest: N[] } {
  const firstListed = root.findIndex((node) => node.kind !== 'action');
  const cut = firstListed === -1 ? root.length : firstListed;
  const head = root.slice(0, cut) as unknown as PanelActionNode[];
  const rest = root.slice(cut);
  assert.ok(
    rest.every((node) => node.kind !== 'action'),
    'an operation row is drawn among the listed nodes rather than at the head',
  );
  return { head, rest };
}

// assertHead checks the rows at a root's head against the literal set, in the
// state the folder is in. A row whose operation needs no folder, and any row
// with a folder anchored, runs its command and gives no reason; a row needing a
// folder, with none anchored, gives the reason the Commands panel gives for the
// same state, carries it on its hover, and binds nothing.
function assertHead(head: PanelActionNode[], expected: Head, anchored: boolean, state: string): void {
  assert.deepStrictEqual(
    head.map((node) => node.row.label),
    expected.map((row) => row.label),
    `in the ${state} state the head reads differently, or in a different order`,
  );
  for (const [at, node] of head.entries()) {
    const want = expected[at];
    assert.strictEqual(node.row.icon, want.icon, `${want.label} carries a different icon in the ${state} state`);
    if (anchored || !want.folder) {
      assert.deepStrictEqual(
        node.row.press,
        { command: want.command, title: want.label },
        `${want.label} does not run ${want.command} in the ${state} state`,
      );
      assert.strictEqual(node.row.description, '', `${want.label} gives a reason although it can run (${state})`);
      assert.ok(!node.row.tooltip.includes(NO_ANCHORED_WORKSPACE_CONTROL_REASON), `${want.label}'s hover gives a reason (${state})`);
    } else {
      assert.strictEqual(node.row.press, null, `${want.label} binds a command it cannot run (${state})`);
      assert.strictEqual(
        node.row.description,
        NO_ANCHORED_WORKSPACE_CONTROL_REASON,
        `${want.label} is drawn without the reason it cannot run (${state})`,
      );
      assert.ok(
        node.row.tooltip.endsWith(` — ${NO_ANCHORED_WORKSPACE_CONTROL_REASON}`),
        `${want.label}'s hover does not say why it cannot run (${state}): ${node.row.tooltip}`,
      );
    }
  }
}

// --- the Registries panel ------------------------------------------------

function registriesDeps(root: string | null, answer: () => Promise<RegistryListDoc>) {
  return { getWorkspaceRoot: () => root, runRegistryList: answer, log: new FakeLog() };
}

const ONE_REGISTRY: RegistryListDoc = {
  registries: [{ host: 'hub.example.test', default: true, authState: 'none', trust: { signaturesRequired: false } }],
  credentialStateIsMachineWide: true,
};

const REGISTRIES_STATES: Array<{
  state: string;
  root: string | null;
  answer: () => Promise<RegistryListDoc>;
  first: (node: RegistriesPanelNode) => boolean;
}> = [
  {
    state: 'nothing anchored',
    root: null,
    answer: () => Promise.resolve(ONE_REGISTRY),
    first: (node) => node.kind === 'message' && node.label === NO_ANCHORED_WORKSPACE_TREE_LABEL,
  },
  {
    state: 'nothing configured',
    root: '/ws',
    answer: () => Promise.resolve({ registries: [], credentialStateIsMachineWide: true }),
    first: (node) => node.kind === 'message' && node.label === 'No registries configured.',
  },
  {
    state: 'enumeration failed',
    root: '/ws',
    answer: () => Promise.reject(new Error('the configuration could not be read')),
    first: (node) => node.kind === 'message' && node.detail === 'the configuration could not be read',
  },
  {
    state: 'registries listed',
    root: '/ws',
    answer: () => Promise.resolve(ONE_REGISTRY),
    first: (node) => node.kind === 'entry' && node.row.host === 'hub.example.test',
  },
];

describe('the Registries panel is headed by its own operations in every state', () => {
  for (const { state, root, answer, first } of REGISTRIES_STATES) {
    it(`opens with Add registry then Update index — ${state}`, async () => {
      const { head, rest } = headOf(await registriesPanelNodes(registriesDeps(root, answer)));
      assertHead(head, REGISTRIES_HEAD, root !== null, state);
      assert.ok(rest.length > 0 && first(rest[0]), `in the ${state} state the list after the head is not the one this state draws`);
      // The list is the listing's own answer, untouched by what heads it.
      assert.deepStrictEqual(rest, await registryNodes(registriesDeps(root, answer)));
    });
  }
});

// --- the Catalog panel ---------------------------------------------------

function catalogDeps(root: string | null, running: boolean, answer: () => Promise<CatalogIndexDoc>) {
  return {
    getWorkspaceRoot: () => root,
    isLanguageServerRunning: () => running,
    requestCatalogIndex: answer,
    entityKinds: () => Promise.resolve({ entityKinds: [] }),
    log: new FakeLog(),
  };
}

const ONE_ENTITY: CatalogIndexDoc = {
  entities: [{
    kind: 'Component',
    name: 'api-server',
    apiVersion: 'aggrega.ai/v1alpha1',
    description: '',
    labels: {},
    file: 'catalog/components/api-server.yaml',
    origin: 'workspace',
  }],
};

const CATALOG_STATES: Array<{
  state: string;
  root: string | null;
  running: boolean;
  answer: () => Promise<CatalogIndexDoc>;
  first: (node: CatalogPanelNode) => boolean;
}> = [
  {
    state: 'nothing anchored',
    root: null,
    running: true,
    answer: () => Promise.resolve(ONE_ENTITY),
    first: (node) => node.kind === 'message' && node.label === NO_ANCHORED_WORKSPACE_TREE_LABEL,
  },
  {
    state: 'language server not running',
    root: '/ws',
    running: false,
    answer: () => Promise.resolve(ONE_ENTITY),
    first: (node) => node.kind === 'message' && node.label === 'The Aggrega language server is not running.',
  },
  {
    state: 'index failed',
    root: '/ws',
    running: true,
    answer: () => Promise.reject(new Error('the index could not be read')),
    first: (node) => node.kind === 'message' && node.detail === 'the index could not be read',
  },
  {
    state: 'no entities',
    root: '/ws',
    running: true,
    answer: () => Promise.resolve({ entities: [] }),
    first: (node) => node.kind === 'message' && node.label === 'No entities in this workspace.',
  },
  {
    state: 'entities listed',
    root: '/ws',
    running: true,
    answer: () => Promise.resolve(ONE_ENTITY),
    first: (node) => node.kind === 'group' && node.label === 'Component',
  },
];

describe('the Catalog panel is headed by its own operations in every state', () => {
  for (const { state, root, running, answer, first } of CATALOG_STATES) {
    it(`opens with Search catalog then Draft entity — ${state}`, async () => {
      const { head, rest } = headOf(await catalogPanelNodes(catalogDeps(root, running, answer)));
      assertHead(head, CATALOG_HEAD, root !== null, state);
      assert.ok(rest.length > 0 && first(rest[0]), `in the ${state} state the list after the head is not the one this state draws`);
      assert.deepStrictEqual(rest, await workspaceCatalogNodes(catalogDeps(root, running, answer)));
    });
  }
});

// --- the Plugins panel ---------------------------------------------------

function pluginsDeps(root: string | null, answer: () => Promise<{ doc: PluginListDoc; stderr: string }>) {
  return { getWorkspaceRoot: () => root, runPluginListJson: answer, log: new FakeLog() };
}

const PLUGINS_STATES: Array<{
  state: string;
  root: string | null;
  answer: () => Promise<{ doc: PluginListDoc; stderr: string }>;
  first: (node: PluginsPanelNode) => boolean;
}> = [
  {
    state: 'nothing anchored',
    root: null,
    answer: () => Promise.resolve({ doc: {}, stderr: '' }),
    first: (node) => node.kind === 'message' && node.label === NO_ANCHORED_WORKSPACE_TREE_LABEL,
  },
  {
    state: 'listing failed',
    root: '/ws',
    answer: () => Promise.reject(new Error('the listing could not run')),
    first: (node) => node.kind === 'message' && node.detail === 'the listing could not run',
  },
  {
    state: 'nothing listed',
    root: '/ws',
    answer: () => Promise.resolve({ doc: {}, stderr: '' }),
    first: (node) => node.kind === 'group' && node.entries.length === 0,
  },
  {
    state: 'plugins listed',
    root: '/ws',
    answer: () => Promise.resolve({ doc: { embedded: [{ uri: 'aggrega://embedded/linter/conventions', type: 'linter' }] }, stderr: '' }),
    first: (node) => node.kind === 'group' && node.entries.length === 1,
  },
];

describe('the Plugins panel is headed by its own operations in every state', () => {
  for (const { state, root, answer, first } of PLUGINS_STATES) {
    it(`opens with Add plugin then Generate entities — ${state}`, async () => {
      const { head, rest } = headOf(await pluginsPanelNodes(pluginsDeps(root, answer)));
      assertHead(head, PLUGINS_HEAD, root !== null, state);
      assert.ok(rest.length > 0 && first(rest[0]), `in the ${state} state the list after the head is not the one this state draws`);
      assert.deepStrictEqual(rest, await pluginNodes(pluginsDeps(root, answer)));
    });
  }
});

// --- one reading of the folder -------------------------------------------

describe('the head and the list are drawn from one reading of the anchored folder', () => {
  it('hands the list the reading the head was decided from, so the two cannot disagree', async () => {
    // A root that is anchored on the first reading and gone on the next: a
    // composition reading twice would draw a head that can run above a list
    // saying nothing is anchored. Read once, both say the folder is anchored.
    let reads = 0;
    const deps = {
      getWorkspaceRoot: (): string | null => (reads++ === 0 ? '/ws' : null),
      runRegistryList: () => Promise.resolve(ONE_REGISTRY),
      log: new FakeLog(),
    };
    const { head, rest } = headOf(await registriesPanelNodes(deps));
    assert.strictEqual(reads, 1, 'the anchored folder was read more than once for one drawing');
    assert.ok(head.every((node) => node.row.press !== null), 'the head was decided from a reading the list did not share');
    assert.ok(rest[0]?.kind === 'entry', 'the list was drawn from a second reading of the folder');
  });
});
