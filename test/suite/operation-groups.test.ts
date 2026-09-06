// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEPRECATION_SEVERITIES,
  OPERATION_GROUPS,
  OperationsNode,
  allOperations,
  cacheArgs,
  catalogUploadArgs,
  commandIdFor,
  deprecateArgs,
  importArgs,
  inspectableSubjects,
  operationsTopLevel,
  operationsUnder,
  publishableSubjects,
  readLayout,
  releaseScopedArgs,
  signArgs,
} from '../../src/operation-groups';
import { CatalogIndexEntity } from '../../src/workspace-catalog-run';

function entity(over: Partial<CatalogIndexEntity>): CatalogIndexEntity {
  return {
    kind: 'Component',
    name: 'api-server',
    apiVersion: 'aggrega.ai/v1alpha1',
    description: '',
    labels: {},
    file: 'catalog/components/api-server.yaml',
    ...over,
  };
}

function operationsOf(nodes: OperationsNode[]): string[] {
  return nodes.filter((n) => n.kind === 'operation').map((n) => n.op.id);
}

describe('the operation surface, grouped by what a reader came to do', () => {
  it('carries the five groups in the ruled order', () => {
    assert.deepStrictEqual(
      OPERATION_GROUPS.map((g) => g.id),
      ['build', 'dependencies', 'author', 'publish', 'config'],
    );
  });

  it('carries the ruled membership, group by group', () => {
    const membership = Object.fromEntries(
      OPERATION_GROUPS.map((g) => [g.id, g.operations.map((op) => op.id)]),
    );
    assert.deepStrictEqual(membership, {
      build: ['validate', 'lint', 'build', 'preview', 'graph'],
      dependencies: ['pull', 'acquire'],
      author: ['scaffold', 'import', 'inspect'],
      publish: ['push', 'sign', 'deprecate'],
      config: ['configShow', 'cache'],
    });
  });

  it('keeps Lint immediately beside Validate, so one question sits in one place', () => {
    const build = OPERATION_GROUPS.find((g) => g.id === 'build');
    assert.ok(build, 'the build group is missing');
    const validate = build.operations.findIndex((op) => op.id === 'validate');
    const lint = build.operations.findIndex((op) => op.id === 'lint');
    assert.notStrictEqual(validate, -1, 'Validate is not in the build group');
    assert.strictEqual(
      lint, validate + 1,
      'Validate and Lint both report into the Problems panel; separating them puts one question in two places',
    );
  });

  it('sets the publish group apart, and only that one', () => {
    assert.deepStrictEqual(
      OPERATION_GROUPS.filter((g) => g.separated).map((g) => g.id),
      ['publish'],
      'publishing changes what other people resolve; the rest touches this machine',
    );
  });

  it('answers what the configuration is before offering to change anything', () => {
    const config = OPERATION_GROUPS.find((g) => g.id === 'config');
    assert.ok(config, 'the config group is missing');
    assert.strictEqual(config.operations[0].id, 'configShow');
  });

  it('offers no entry that seeds a configuration', () => {
    // A negative control first: the census finds an id that IS present, so a
    // zero below is a measurement rather than a claim about the search.
    assert.ok(
      allOperations().some((op) => op.id === 'configShow'),
      'the census cannot see an operation that is present, so its zeros mean nothing',
    );
    assert.deepStrictEqual(
      allOperations().filter((op) => /init|scaffold-config|seed/i.test(op.id + op.label)),
      [],
      'seeding a configuration belongs to the welcome flow, where it is a first step rather than a routine action',
    );
  });

  it('gives every entry exactly one command, and no two entries the same one', () => {
    const commands = allOperations().map(commandIdFor);
    assert.strictEqual(new Set(commands).size, commands.length, 'two entries share a command');
    for (const op of allOperations()) {
      assert.ok(commandIdFor(op).startsWith('aggrega.'), `${op.id} runs no aggrega command`);
      assert.ok(op.label.trim() !== '', `${op.id} has no label`);
      assert.ok(op.detail.trim() !== '', `${op.id} explains nothing on hover`);
      assert.ok(op.icon.trim() !== '', `${op.id} has no icon`);
    }
  });

  it('points the topology-graph entry at the command already contributed for it', () => {
    const graph = allOperations().find((op) => op.id === 'graph');
    assert.ok(graph);
    assert.strictEqual(
      commandIdFor(graph), 'aggrega.graph.show',
      'a command id is what a reader binds a keystroke to, so it is reused rather than renamed',
    );
  });
});

describe('the surface the manifest actually contributes', () => {
  // Read from the manifest on disk rather than imported, so the assertion is
  // about the file the editor loads and not about a copy the compiler made.
  interface Manifest {
    contributes: {
      views: { aggrega: Array<{ id: string; name: string }> };
      menus: { 'view/title': Array<{ command: string; when: string }> };
      commands: Array<{ command: string; title: string }>;
      configuration: { properties: Record<string, { enum?: string[]; default?: unknown }> };
    };
  }

  const manifest: Manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
  );

  it('orders the container panels Operations, Registries, Catalog, Plugins', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.name),
      ['Operations', 'Registries', 'Catalog', 'Plugins'],
    );
  });

  it('keeps every panel identifier, because it is the key a reader\'s layout is remembered under', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.id),
      ['aggrega.operations', 'aggrega.registries', 'aggrega.workspaceCatalog', 'aggrega.plugins'],
    );
  });

  it('leaves no other area\'s button on the operations panel', () => {
    const onOperations = manifest.contributes.menus['view/title']
      .filter((m) => m.when === 'view == aggrega.operations')
      .map((m) => m.command);
    // The cog belongs to this panel: it opens the preferences that decide how
    // this panel and the compiler behind it behave. Every other panel's refresh
    // and search buttons stay on their own panel.
    assert.deepStrictEqual(
      onOperations,
      ['aggrega.settings.open'],
      'each panel carries the buttons for its own area',
    );
  });

  it('puts the published-catalog search on the catalog panel', () => {
    const search = manifest.contributes.menus['view/title']
      .find((m) => m.command === 'aggrega.catalog.searchPublished');
    assert.ok(search, 'the published-catalog search is bound to no panel');
    assert.strictEqual(search.when, 'view == aggrega.workspaceCatalog');
  });

  it('declares a command for every entry on the panel, so no entry is a dead button', () => {
    const declared = new Set(manifest.contributes.commands.map((c) => c.command));
    for (const op of allOperations()) {
      assert.ok(
        declared.has(commandIdFor(op)),
        `the ${op.id} entry runs ${commandIdFor(op)}, which the manifest does not contribute`,
      );
    }
  });

  it('puts every contributed operation command on the panel, so none is stranded', () => {
    const onPanel = new Set(allOperations().map(commandIdFor));
    const stranded = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.op.') && !onPanel.has(c));
    assert.deepStrictEqual(stranded, []);
  });

  it('offers the two shapes the surface knows how to draw, and defaults to the grouped one', () => {
    const layout = manifest.contributes.configuration.properties['aggrega.operations.layout'];
    assert.ok(layout, 'the panel shape is not a setting');
    assert.deepStrictEqual(layout.enum, ['grouped', 'collapsible']);
    assert.strictEqual(readLayout(layout.default), 'grouped');
  });
});

describe('the argument list each entry composes', () => {
  it('scopes a pull to the selected Release', () => {
    assert.deepStrictEqual(
      releaseScopedArgs('pull', 'releases/production.yaml'),
      ['pull', '--release', 'releases/production.yaml'],
    );
  });

  it('scopes an acquisition to the selected Release, which the command marks required', () => {
    assert.deepStrictEqual(
      releaseScopedArgs('acquire', 'releases/production.yaml'),
      ['acquire', '--release', 'releases/production.yaml'],
    );
  });

  it('publishes a named entity, never a bare verb', () => {
    assert.deepStrictEqual(
      catalogUploadArgs('catalog/components/api-server.yaml'),
      ['push', 'catalog/components/api-server.yaml'],
    );
  });

  it('signs a named artifact reference', () => {
    assert.deepStrictEqual(
      signArgs('registry.example.com/component/api-server:1.2.0'),
      ['sign', 'registry.example.com/component/api-server:1.2.0'],
    );
  });

  it('carries the deprecation severity and reason as flags, because a subprocess has no terminal to be asked at', () => {
    assert.deepStrictEqual(
      deprecateArgs('registry.example.com/component/api-server:1.2.0', 'retracted', 'superseded by 2.x'),
      [
        'deprecate',
        'registry.example.com/component/api-server:1.2.0',
        '--severity', 'retracted',
        '--reason', 'superseded by 2.x',
      ],
    );
  });

  it('imports a named source', () => {
    assert.deepStrictEqual(importArgs('./chart'), ['import', './chart']);
  });

  it('runs a named cache subcommand', () => {
    assert.deepStrictEqual(cacheArgs('prune'), ['cache', 'prune']);
  });

  it('offers the three severities the compiler records, in increasing strength', () => {
    assert.deepStrictEqual(
      DEPRECATION_SEVERITIES.map((s) => s.value),
      ['warning', 'error', 'retracted'],
    );
  });
});

describe('an entry whose invocation cannot succeed is refused before it is built', () => {
  // The panel shipped one such entry for a long time: the catalog upload ran the
  // bare verb, so pressing it could only ever produce a usage error. These are
  // the assertions that fail if any entry regresses to that shape.
  const bare: Array<[string, () => unknown]> = [
    ['the catalog upload with no entity', () => catalogUploadArgs('')],
    ['the catalog upload with a whitespace entity', () => catalogUploadArgs('   ')],
    ['a signature with no reference', () => signArgs('')],
    ['a deprecation with no reference', () => deprecateArgs('', 'warning', 'why')],
    ['an import with no source', () => importArgs('')],
    ['a cache run with no subcommand', () => cacheArgs('')],
    ['a pull with no Release', () => releaseScopedArgs('pull', '')],
    ['an acquisition with no Release', () => releaseScopedArgs('acquire', '  ')],
  ];

  for (const [what, compose] of bare) {
    it(`refuses to compose ${what}`, () => {
      assert.throws(compose, /takes|requires/);
    });
  }

  it('refuses a deprecation missing the severity the command needs', () => {
    assert.throws(() => deprecateArgs('registry/x:1', '', 'why'), /severity/);
  });

  it('refuses a deprecation missing the reason the command needs', () => {
    assert.throws(() => deprecateArgs('registry/x:1', 'warning', '  '), /reason/);
  });
});

describe('the two shapes the panel is drawn in', () => {
  it('defaults to the grouped shape, and reads only the one alternative spelling', () => {
    assert.strictEqual(readLayout(undefined), 'grouped');
    assert.strictEqual(readLayout('grouped'), 'grouped');
    assert.strictEqual(readLayout('collapsible'), 'collapsible');
    assert.strictEqual(readLayout('Collapsible'), 'grouped', 'an unreadable value draws the panel, not nothing');
    assert.strictEqual(readLayout(7), 'grouped');
  });

  it('shows every operation at once in the grouped shape', () => {
    assert.deepStrictEqual(
      operationsOf(operationsTopLevel('grouped')),
      allOperations().map((op) => op.id),
    );
  });

  it('shows one row per group in the collapsible shape, and nothing else at that level', () => {
    const top = operationsTopLevel('collapsible');
    assert.deepStrictEqual(
      top.filter((n) => n.kind === 'group').map((n) => n.group.id),
      OPERATION_GROUPS.map((g) => g.id),
    );
    assert.deepStrictEqual(operationsOf(top), [], 'an operation is reached by opening its group');
  });

  it('carries the same operations in the same order whichever shape is drawn', () => {
    const grouped = operationsOf(operationsTopLevel('grouped'));
    const collapsible = operationsTopLevel('collapsible')
      .filter((n) => n.kind === 'group')
      .flatMap((n) => operationsOf(operationsUnder(n.group)));
    assert.deepStrictEqual(
      collapsible, grouped,
      'the shape changes how a group is drawn, never which operations exist',
    );
  });

  it('separates the publish group in both shapes', () => {
    for (const layout of ['grouped', 'collapsible'] as const) {
      const nodes = operationsTopLevel(layout);
      const separators = nodes
        .map((n, i) => (n.kind === 'separator' ? i : -1))
        .filter((i) => i !== -1);
      assert.strictEqual(separators.length, 1, `${layout} draws ${separators.length} separators`);
      const next = nodes[separators[0] + 1];
      const groupId = next.kind === 'group' ? next.group.id
        : next.kind === 'heading' ? next.group.id : null;
      assert.strictEqual(groupId, 'publish', `${layout} separates the wrong group`);
    }
  });

  it('heads every group in the grouped shape', () => {
    assert.deepStrictEqual(
      operationsTopLevel('grouped').filter((n) => n.kind === 'heading').map((n) => n.group.id),
      OPERATION_GROUPS.map((g) => g.id),
    );
  });
});

describe('the subjects the workspace itself can answer for', () => {
  it('offers a workspace entity as the subject of a publication', () => {
    assert.deepStrictEqual(
      publishableSubjects([entity({})]),
      [{
        label: 'api-server',
        description: 'Component',
        detail: 'catalog/components/api-server.yaml',
        name: 'api-server',
        file: 'catalog/components/api-server.yaml',
      }],
    );
  });

  it('leaves out an entity the publication would have no path to name', () => {
    // An entity the workspace holds no file for reaches the index with an empty
    // path. Offering it would compose a publication of nothing.
    const offered = publishableSubjects([
      entity({ name: 'from-the-catalog', file: '' }),
      entity({ name: 'authored-here' }),
    ]);
    assert.deepStrictEqual(offered.map((s) => s.name), ['authored-here']);
  });

  it('still offers that entity to an inspection, which names it by identity', () => {
    const offered = inspectableSubjects([
      entity({ name: 'from-the-catalog', file: '' }),
      entity({ name: 'authored-here' }),
    ]);
    assert.deepStrictEqual(offered.map((s) => s.name), ['from-the-catalog', 'authored-here']);
  });

  it('composes a publication from a chosen subject and nothing else', () => {
    const [subject] = publishableSubjects([entity({})]);
    assert.deepStrictEqual(
      catalogUploadArgs(subject.file),
      ['push', 'catalog/components/api-server.yaml'],
    );
  });
});
