// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CACHE_SUBCOMMANDS,
  CacheSubcommand,
  DEPRECATION_SEVERITIES,
  OPERATION_GROUPS,
  OperationsNode,
  allOperations,
  cacheArgs,
  cacheConfirmation,
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
    origin: 'workspace',
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

  // The get-started list sits ahead of the operations because it is what a
  // reader with nothing configured needs first, and it is the one panel that
  // goes away: it is drawn only while the reader's own preference asks for it.
  it('orders the container panels Get started, Operations, Registries, Catalog, Plugins', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.name),
      ['Get started', 'Operations', 'Registries', 'Catalog', 'Plugins'],
    );
  });

  it('keeps every panel identifier, because it is the key a reader\'s layout is remembered under', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.id),
      [
        'aggrega.getStarted',
        'aggrega.operations',
        'aggrega.registries',
        'aggrega.workspaceCatalog',
        'aggrega.plugins',
      ],
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
    // The parameter type already refuses an unnamed subcommand at authoring
    // time, which is the primary defence. The cast reaches past it on purpose,
    // to prove the runtime guard still fires for a value that arrives from
    // outside the type system — a hand-edited setting, or a caller written
    // later against a widened signature.
    ['a cache run with no subcommand', () => cacheArgs('' as CacheSubcommand)],
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

  it('carries the reader’s answer into the wipe, which refuses without one', () => {
    // The command asks for confirmation at an interactive terminal and refuses
    // outright when there is none. This surface spawns it with no terminal, so
    // an invocation that did not carry the answer could only ever report a
    // refusal — which is the same shape as the deprecation above.
    assert.deepStrictEqual(cacheArgs('clear'), ['cache', 'clear', '--yes']);
  });

  it('carries no consent into the operations that were never asked about', () => {
    // Only the wipe is confirmed, so only the wipe may claim consent. Passing
    // it elsewhere would assert an answer the reader was never asked for.
    assert.deepStrictEqual(cacheArgs('status'), ['cache', 'status']);
    assert.deepStrictEqual(cacheArgs('prune'), ['cache', 'prune']);
  });
});

describe('a destructive cache operation names its scope before it runs', () => {
  it('asks nothing before an operation that removes nothing', () => {
    assert.strictEqual(cacheConfirmation('status'), null);
  });

  for (const subcommand of ['prune', 'clear'] as const) {
    it(`confirms ${subcommand} before anything happens`, () => {
      const confirmation = cacheConfirmation(subcommand);
      assert.ok(confirmation, 'a removal must be confirmed');
      assert.ok(confirmation.question.trim().endsWith('?'), 'the confirmation asks a question');
      assert.ok(confirmation.confirmLabel.trim().length > 0);
      assert.notStrictEqual(
        confirmation.confirmLabel.toLowerCase(),
        'ok',
        'the affirmative names the act, so a reader dismissing quickly reads what they agreed to',
      );
    });

    it(`names BOTH scopes for ${subcommand}, because it reaches both`, () => {
      // Established against the compiler rather than guessed: the workspace
      // artifact caches sit under the workspace's own configured cache
      // directory, while the compiled-module and plugin-describe caches are
      // rooted at the user cache root and shared by every project on the
      // machine. Both removals reach both, so a confirmation naming only one
      // would understate what is about to happen.
      const { scope } = cacheConfirmation(subcommand)!;
      assert.match(scope, /this workspace/i, 'the workspace scope must be named');
      assert.match(scope, /this machine/i, 'the machine-wide scope must be named');
      assert.match(scope, /compiled-module cache/, 'the shared cache is named as the compiler names it');
      assert.match(scope, /plugin-describe cache/, 'the shared cache is named as the compiler names it');
    });
  }

  it('offers every subcommand it can compose, and no other', () => {
    // The offered set and the composable set are one set. A row the composition
    // refuses would be a control that always fails.
    for (const { value } of CACHE_SUBCOMMANDS) {
      assert.doesNotThrow(() => cacheArgs(value));
    }
    assert.deepStrictEqual(
      CACHE_SUBCOMMANDS.map((s) => s.value),
      ['status', 'prune', 'clear'],
    );
  });

  it('states each subcommand’s reach on its own row', () => {
    // A reader choosing from the list needs the workspace/machine distinction
    // before they choose, not after.
    for (const { value, detail } of CACHE_SUBCOMMANDS) {
      assert.ok(detail.trim().length > 0);
      if (value === 'status') {
        assert.match(detail, /removes nothing/i);
        continue;
      }
      assert.match(detail, /this workspace/i);
      assert.match(detail, /this machine/i);
    }
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
