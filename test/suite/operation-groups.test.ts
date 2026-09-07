// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Imported as a namespace as well as by name, so the export surface itself can
// be censused: a claim that no cache operation composes an argument list is a
// claim about what this module exports, and reading the exports measures that
// directly rather than by pattern over its text.
import * as groups from '../../src/operation-groups';
import {
  CACHE_OPERATIONS,
  CacheOperation,
  DEPRECATION_SEVERITIES,
  OPERATION_GROUPS,
  OPERATION_REQUIREMENTS,
  OperationId,
  allOperations,
  cacheConfirmation,
  catalogUploadArgs,
  commandIdFor,
  deprecateArgs,
  importArgs,
  inspectableSubjects,
  publishableSubjects,
  readLayout,
  releaseScopedArgs,
  signArgs,
  unavailableReason,
} from '../../src/operation-groups';
import {
  NO_RELEASE_SELECTED_CONTROL_REASON,
} from '../../src/release-selection';
import { CatalogIndexEntity } from '../../src/workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_CONTROL_REASON } from '../../src/workspace';

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
      views: { aggrega: Array<{ id: string; name: string; type?: string }> };
      menus: { 'view/title': Array<{ command: string; when: string }> };
      commands: Array<{ command: string; title: string }>;
      configuration: {
        properties: Record<string, {
          enum?: string[];
          enumDescriptions?: string[];
          default?: unknown;
        }>;
      };
    };
  }

  const manifest: Manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
  );

  // The operations lead, because they are what a reader came to do. What a
  // reader with nothing configured needs first is the welcome panel, and that
  // opens in its own editor tab rather than as a panel here — so it costs the
  // container no slot, and this order holds whether it is shown or dismissed.
  it('orders the container panels Operations, Registries, Catalog, Plugins', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.name),
      ['Operations', 'Registries', 'Catalog', 'Plugins'],
    );
  });

  it('keeps every panel identifier, because it is the key a reader\'s layout is remembered under', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.id),
      [
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

  it('offers the two shapes the surface knows how to draw, and defaults to buttons', () => {
    const layout = manifest.contributes.configuration.properties['aggrega.operations.layout'];
    assert.ok(layout, 'the panel shape is not a setting');
    assert.deepStrictEqual(layout.enum, ['buttons', 'sections']);
    // Read through readLayout rather than compared to a literal, so the
    // manifest's default and the shape the surface actually draws for it cannot
    // come apart: a default the surface does not recognise would draw the panel
    // this assertion claims and still be wrong.
    assert.strictEqual(readLayout(layout.default), 'buttons');
    assert.strictEqual(layout.default, 'buttons');
  });

  it('says what a reader will see for each shape, on the shape itself', () => {
    // A reader chooses on the settings screen, where the only thing in front of
    // them is these two lines. One description per value, each naming what is
    // drawn rather than how the operations are arranged — both shapes are
    // grouped, so a description naming the grouping would tell them nothing.
    const layout = manifest.contributes.configuration.properties['aggrega.operations.layout'];
    assert.ok(layout.enum, 'the shape offers no values');
    assert.strictEqual(
      layout.enumDescriptions?.length,
      layout.enum.length,
      'a value with no description leaves a reader choosing blind',
    );
    for (const description of layout.enumDescriptions ?? []) {
      assert.ok(description.trim() !== '', 'a shape describes itself as nothing');
    }
  });

  it('declares the operations panel as a document it draws, and the other three as trees', () => {
    // The panel's default shape is one row of buttons per group, and a tree row
    // carries one whole-row command and no markup — so it cannot be several
    // buttons. This one view is therefore drawn by the extension. The other
    // three are data lists with per-row identity, which is what a tree is for,
    // and converting them would cost list type-ahead, row context menus and
    // native selection for nothing.
    const typeOf = Object.fromEntries(
      manifest.contributes.views.aggrega.map((v) => [v.id, v.type ?? 'tree']),
    );
    assert.deepStrictEqual(typeOf, {
      'aggrega.operations': 'webview',
      'aggrega.registries': 'tree',
      'aggrega.workspaceCatalog': 'tree',
      'aggrega.plugins': 'tree',
    });
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

  it('composes no argument list for a cache operation, because none is invoked', () => {
    // The cache operations are language-server requests, so there is no
    // argument list to compose and no verb to name. A negative control first,
    // so a zero below is a measurement of the module rather than a claim about
    // the census: the module does still export the compositions that survive.
    const composers = Object.keys(groups).filter((name) => /Args$/.test(name));
    assert.ok(
      composers.includes('importArgs'),
      'the census cannot see a composition that is present, so its zeros mean nothing',
    );
    assert.deepStrictEqual(
      composers.filter((name) => /cache/i.test(name)),
      [],
      'a cache operation that composed an argument list would be a second way to run one',
    );
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

  it('leaves the size cap unread, because the compiler owns what a size means', () => {
    // A cache trim takes a size cap, and this surface deliberately composes no
    // check over it: the language server parses it with the same parser the
    // command line uses and refuses a blank or unreadable one in its own words,
    // naming what a size cap looks like. A guard here would be a second answer
    // to what a size is, and it would replace that naming with a wording of
    // this surface's own.
    //
    // So this is the one subject on the panel that is NOT refused before it is
    // built, and the assertion records that as a decision rather than leaving
    // its absence to read as an oversight: nothing in the module reads or
    // validates a size.
    assert.deepStrictEqual(
      Object.keys(groups).filter((name) => /size|bytes|parse/i.test(name)),
      [],
      'a size cap read here would be a second statement of what a byte quantity means',
    );
  });
});

describe('a destructive cache operation names its scope before it runs', () => {
  // The three removals and the one report. Kept as a table because the reach
  // is not uniform: two removals reach both scopes and one reaches only what
  // the machine shares, so a loop asserting one formula over all of them would
  // pass on a confirmation that names the wrong scope.
  const REMOVALS = ['prune', 'evict', 'clear'] as const;

  it('offers exactly the operations the language server serves', () => {
    // Four, matching the four request methods. The panel offering fewer would
    // leave a capability reachable only outside the editor with nothing saying
    // so; offering more would draw a control with nothing behind it.
    assert.deepStrictEqual(
      CACHE_OPERATIONS.map((o) => o.value),
      ['status', 'prune', 'evict', 'clear'],
    );
  });

  it('asks nothing before an operation that removes nothing', () => {
    assert.strictEqual(cacheConfirmation('status'), null);
  });

  it('confirms every operation that removes something, and only those', () => {
    // Derived from the offered set rather than from a second list, so an
    // operation added later cannot be left unconfirmed by omission.
    const confirmed = CACHE_OPERATIONS
      .map((o) => o.value)
      .filter((value) => cacheConfirmation(value) !== null);
    assert.deepStrictEqual(confirmed, [...REMOVALS]);
  });

  for (const operation of REMOVALS) {
    it(`confirms ${operation} before anything happens`, () => {
      const confirmation = cacheConfirmation(operation);
      assert.ok(confirmation, 'a removal must be confirmed');
      assert.ok(confirmation.question.trim().endsWith('?'), 'the confirmation asks a question');
      assert.ok(confirmation.confirmLabel.trim().length > 0);
      assert.notStrictEqual(
        confirmation.confirmLabel.toLowerCase(),
        'ok',
        'the affirmative names the act, so a reader dismissing quickly reads what they agreed to',
      );
    });
  }

  for (const operation of ['prune', 'clear'] as const) {
    it(`names BOTH scopes for ${operation}, because it reaches both`, () => {
      // Established against the compiler rather than guessed: the workspace
      // artifact caches sit under the workspace's own configured cache
      // directory, while the compiled-module and plugin-describe caches are
      // rooted at the user cache root and shared by every project on the
      // machine. These two removals reach both, so a confirmation naming only
      // one would understate what is about to happen.
      const { scope } = cacheConfirmation(operation)!;
      assert.match(scope, /this workspace/i, 'the workspace scope must be named');
      assert.match(scope, /this machine/i, 'the machine-wide scope must be named');
      assert.match(scope, /compiled-module cache/, 'the shared cache is named as the compiler names it');
      assert.match(scope, /plugin-describe cache/, 'the shared cache is named as the compiler names it');
    });
  }

  it('names ONE scope for the trim, because it reaches one', () => {
    // The trim's subject is the compiled-module store alone, which is
    // machine-wide without qualification. The rule is that a confirmation names
    // both scopes when it reaches both — so this one names the machine-shared
    // store and says the workspace's own caches are untouched. Naming both
    // would overstate it in the same direction naming one understates the other
    // two, which is why this is asserted rather than left to the wording.
    const { scope } = cacheConfirmation('evict')!;
    assert.match(scope, /this machine/i, 'the machine-wide reach must be named');
    assert.match(scope, /compiled-module cache/, 'the store is named as the compiler names it');
    assert.doesNotMatch(
      scope,
      /plugin-describe cache/,
      'the trim does not reach the plugin-describe cache, so it must not claim to',
    );
    assert.match(
      scope,
      /Nothing under this workspace/,
      "a reader must be told the workspace's own caches are untouched, not left to infer it",
    );
  });

  it('states each operation’s reach on its own row', () => {
    // A reader choosing from the list needs the workspace/machine distinction
    // before they choose, not after — and needs it per operation, since the
    // three removals do not reach the same places.
    const reachOf = new Map<CacheOperation, RegExp[]>([
      ['status', [/removes nothing/i]],
      ['prune', [/this workspace/i, /this machine/i]],
      ['evict', [/compiled-module cache/, /this machine/i]],
      ['clear', [/this workspace/i, /this machine/i]],
    ]);
    for (const { value, detail } of CACHE_OPERATIONS) {
      assert.ok(detail.trim().length > 0, `${value} states no reach`);
      const expected = reachOf.get(value);
      assert.ok(expected, `${value} has no stated reach to check against`);
      for (const pattern of expected) {
        assert.match(detail, pattern, `the ${value} row must state its reach`);
      }
    }
    assert.strictEqual(
      reachOf.size,
      CACHE_OPERATIONS.length,
      'every offered operation is checked, so a new one cannot arrive unasserted',
    );
  });
});

describe('the two shapes the panel is drawn in', () => {
  it('defaults to buttons, and reads only the one alternative spelling', () => {
    assert.strictEqual(readLayout(undefined), 'buttons');
    assert.strictEqual(readLayout('buttons'), 'buttons');
    assert.strictEqual(readLayout('sections'), 'sections');
    assert.strictEqual(
      readLayout('Sections'), 'buttons',
      'an unreadable value draws the panel, not nothing',
    );
    assert.strictEqual(readLayout(7), 'buttons');
  });

  it('draws the panel for a value it has never heard of, rather than drawing nothing', () => {
    // The values a reader can choose changed, and a settings file written
    // before that change still holds one of the old ones. Nothing migrates it,
    // and nothing needs to: an unrecognised value reads as the default, so such
    // a file draws the default panel. This is asserted against the values the
    // surface no longer knows because that is the case a reader will actually
    // meet, and it is the reason no migration is owed.
    for (const stale of ['grouped', 'collapsible', '', 'BUTTONS', null]) {
      assert.strictEqual(
        readLayout(stale), 'buttons',
        `${JSON.stringify(stale)} must draw the default panel rather than nothing`,
      );
    }
  });
});

describe('what an entry needs before it can run', () => {
  it('decides a requirement for every operation, and for no name that is not one', () => {
    // The map is total over the operation ids, which is what stops a new
    // operation arriving with no decision made about it. Both directions are
    // asserted: a missing entry would leave an operation ungated, and a
    // left-over entry would be a decision about something that no longer
    // exists.
    assert.deepStrictEqual(
      Object.keys(OPERATION_REQUIREMENTS).sort(),
      allOperations().map((op) => op.id).sort(),
    );
  });

  it('reads each requirement off the guard the operation\'s own handler applies', () => {
    // Established by reading the handlers rather than inferred from the entry:
    // the five Release-scoped operations check the anchored folder and then the
    // selection; the five command-line-backed ones check the folder they run
    // in; and the five language-server-backed ones that take no subject check
    // neither, so nothing this panel can observe stops them.
    assert.deepStrictEqual(OPERATION_REQUIREMENTS, {
      validate: 'none',
      lint: 'workspace',
      build: 'release',
      preview: 'release',
      graph: 'release',
      pull: 'release',
      acquire: 'release',
      scaffold: 'none',
      import: 'workspace',
      inspect: 'none',
      push: 'workspace',
      sign: 'workspace',
      deprecate: 'workspace',
      configShow: 'none',
      cache: 'none',
    });
  });

  it('reports no reason for anything once a folder is anchored and a Release chosen', () => {
    const ready = { workspaceAnchored: true, releaseSelected: true };
    for (const op of allOperations()) {
      assert.strictEqual(
        unavailableReason(op.id, ready), null,
        `${op.id} is refused in the state where every requirement is met`,
      );
    }
  });

  it('names the anchored folder ahead of the selection, because the handlers check it first', () => {
    // An operation with neither would be told about the folder first if it were
    // pressed, so the control says the same thing the invocation would rather
    // than sending the reader after a Release in a window that has nowhere to
    // run one.
    const nothing = { workspaceAnchored: false, releaseSelected: false };
    assert.strictEqual(
      unavailableReason('build', nothing),
      NO_ANCHORED_WORKSPACE_CONTROL_REASON,
    );
    assert.strictEqual(
      unavailableReason('lint', nothing),
      NO_ANCHORED_WORKSPACE_CONTROL_REASON,
    );
  });

  it('asks for a Release only from the operations that act on one', () => {
    const anchored = { workspaceAnchored: true, releaseSelected: false };
    const asked = allOperations()
      .map((op) => op.id)
      .filter((id) => unavailableReason(id, anchored) === NO_RELEASE_SELECTED_CONTROL_REASON);
    assert.deepStrictEqual(asked, ['build', 'preview', 'graph', 'pull', 'acquire']);
  });

  it('leaves the entries no observable fact gates without a reason at all', () => {
    // A control drawn as unavailable for a reason nothing on the panel can
    // evaluate would be a guess presented as a fact — so an operation this
    // panel cannot observe a blocker for carries no unavailable state in any
    // combination of the facts it can observe.
    const unconditional = allOperations()
      .map((op) => op.id)
      .filter((id) => OPERATION_REQUIREMENTS[id] === 'none');
    assert.ok(
      unconditional.length > 0,
      'no operation is unconditional, so the absences below measure nothing',
    );
    const combinations = [
      { workspaceAnchored: false, releaseSelected: false },
      { workspaceAnchored: false, releaseSelected: true },
      { workspaceAnchored: true, releaseSelected: false },
      { workspaceAnchored: true, releaseSelected: true },
    ];
    for (const id of unconditional as OperationId[]) {
      for (const facts of combinations) {
        assert.strictEqual(
          unavailableReason(id, facts), null,
          `${id} is refused in a state its own handler does not check`,
        );
      }
    }
  });

  it('gives a reason that tells the reader what to do, not what went wrong', () => {
    // Read beside a control the reader can already see is unavailable: what
    // they cannot see is what would make it run. Both are the renderings held
    // beside the states they describe, so a control and a notification about
    // one state cannot come to say different things.
    for (const reason of [
      NO_ANCHORED_WORKSPACE_CONTROL_REASON,
      NO_RELEASE_SELECTED_CONTROL_REASON,
    ]) {
      assert.ok(reason.trim().endsWith('.'), `${reason} is not a sentence`);
      assert.ok(
        !reason.startsWith('Aggrega'),
        `${reason} carries the product prefix a notification needs and a control does not`,
      );
    }
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
