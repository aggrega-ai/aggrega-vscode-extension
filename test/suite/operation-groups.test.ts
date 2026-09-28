// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS_TITLE_BAR_ENTRIES, commandsPanelTitleBar } from '../helpers/title-bar';

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
  OperationDef,
  OperationId,
  PANEL_ACTIONS,
  PanelActionId,
  allPanelActions,
  cacheConfirmation,
  commandIdFor,
  commandsPanelOperations,
  inspectableSubjects,
  operationHint,
  panelActionLabel,
  panelActionReason,
  publishableSubjects,
  readLayout,
  releaseScopedArgs,
  unavailableReason,
} from '../../src/operation-groups';
import { publishEntityRequest } from '../../src/publication-request';
import { SWITCH_ANCHOR_COMMAND } from '../../src/anchor-picker';
import {
  OPEN_WORKSPACE_ROOT_COMMAND,
  rowCommands,
  selectorRows,
} from '../../src/selector-rows';
import {
  NO_RELEASE_SELECTED_CONTROL_REASON,
} from '../../src/release-selection';
import { CatalogIndexEntity } from '../../src/workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_CONTROL_REASON } from '../../src/workspace';

// THE FIVE OPERATIONS DRAWN AT THE HEAD OF A LIST PANEL, written out literally
// rather than read back from the description: an expectation read from the table
// under test agrees with that table whatever it says, so it could not see an
// operation returned to the Commands panel or dropped from a panel's head.
const HEADED: Record<string, Array<{ id: PanelActionId; label: string; command: string }>> = {
  registries: [
    { id: 'registryAdd', label: 'Add registry', command: 'aggrega.registries.add' },
    { id: 'registryIndex', label: 'Update index', command: 'aggrega.registries.update' },
  ],
  catalog: [
    { id: 'catalogSearch', label: 'Search catalog', command: 'aggrega.catalog.searchPublished' },
  ],
  plugins: [
    { id: 'pluginAdd', label: 'Add plugin', command: 'aggrega.plugins.add' },
    { id: 'pluginEntities', label: 'Generate entities', command: 'aggrega.plugins.genCatalog' },
  ],
};
const HEADED_ALL = Object.values(HEADED).flat();

// everyOperation is both descriptions together, for the properties that hold of
// every operation wherever it is drawn.
function everyOperation(): OperationDef[] {
  return [...commandsPanelOperations(), ...allPanelActions()];
}

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
  it('carries the ruled groups in the ruled order', () => {
    // The groups keep the order and the positions readers have learnt, and no
    // group of the list panels' own operations sits among them: those are drawn
    // at the head of the panel whose list they concern.
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
      dependencies: ['pull'],
      author: ['scaffold', 'import', 'inspect'],
      publish: ['push', 'sign', 'deprecate'],
      config: ['configShow', 'cache'],
    });
  });

  it('holds none of the operations a list panel draws at its head, so each has one place', () => {
    // The ruling this asserts: an operation acting on what a list panel lists
    // is drawn at the head of that panel and NOT here, so a reader has one
    // place to look for it. Asserted by command, by id and by label against the
    // literal set at the top of this file, so an entry returned here under any
    // one of the three is caught.
    const onThisPanel = commandsPanelOperations();
    // A negative control first: the census does see an entry that IS here, so
    // the absences below are measurements rather than claims about the set.
    assert.ok(
      onThisPanel.some((op) => commandIdFor(op) === 'aggrega.op.scaffold' && op.label === 'Draft entity'),
      'the census cannot see an entry that is on the panel, so its absences mean nothing',
    );
    for (const headed of HEADED_ALL) {
      assert.ok(
        !onThisPanel.some((op) => commandIdFor(op) === headed.command),
        `${headed.command} heads a list panel and is on the Commands panel as well`,
      );
      assert.ok(
        !onThisPanel.some((op) => op.id === headed.id),
        `${headed.id} heads a list panel and is on the Commands panel as well`,
      );
      assert.ok(
        !onThisPanel.some((op) => op.label === headed.label),
        `"${headed.label}" heads a list panel and is drawn on the Commands panel as well`,
      );
    }
  });

  it('keeps drafting an entity here, as its one entry', () => {
    // Drafting is a button here rather than a row at the head of the Catalog
    // panel: it opens a starter document in a tab and writes nothing. The
    // failure this guards against is a second Draft entity button, which the
    // uniqueness assertion below would catch, but only if this one establishes
    // that the single entry is still present.
    const offered = commandsPanelOperations().map(commandIdFor);
    assert.ok(offered.includes('aggrega.op.scaffold'), 'drafting an entity is on no panel');
  });

  it('leaves every row-scoped operation off this panel, so none re-asks what a click answered', () => {
    // The other half of the ruling, and the half that would break the list
    // panels if it were got wrong: an operation acting on a particular
    // registry, entity or plugin takes its subject from the row the reader
    // clicked, so an entry here would have to open a picker to ask again.
    const offered = new Set(commandsPanelOperations().map(commandIdFor));
    // A negative control first: the census does see a command that IS offered,
    // so the absences below are measurements rather than claims about the set.
    assert.ok(offered.has('aggrega.op.build'), 'the census cannot see an offered command');
    for (const command of [
      'aggrega.registries.updateOne',
      'aggrega.registries.logout',
      'aggrega.registries.remove',
      'aggrega.workspaceCatalog.inspect',
      'aggrega.workspaceCatalog.validate',
      'aggrega.workspaceCatalog.lint',
      'aggrega.workspaceCatalog.push',
      'aggrega.plugins.remove',
    ]) {
      assert.ok(
        !offered.has(command),
        `${command} acts on one row's subject; on this panel it could only re-ask for it`,
      );
    }
  });

  it('keeps the refresh commands off this panel, because each belongs to its own list', () => {
    // A refresh re-reads one list rather than acting on the thing listed, so it
    // belongs to that view. In one panel it would have no answer to "refresh
    // which list?".
    const offered = new Set(commandsPanelOperations().map(commandIdFor));
    for (const command of [
      'aggrega.registries.refresh',
      'aggrega.workspaceCatalog.refresh',
      'aggrega.plugins.refresh',
    ]) {
      assert.ok(!offered.has(command), `${command} belongs to its own list view, not to this panel`);
    }
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
      commandsPanelOperations().some((op) => op.id === 'configShow'),
      'the census cannot see an operation that is present, so its zeros mean nothing',
    );
    assert.deepStrictEqual(
      commandsPanelOperations().filter((op) => /init|scaffold-config|seed/i.test(op.id + op.label)),
      [],
      'seeding a configuration belongs to the welcome flow, where it is a first step rather than a routine action',
    );
  });

  it('gives every entry exactly one command, and no two entries the same one', () => {
    // Across BOTH descriptions, because an operation drawn once on the Commands
    // panel and once at a list panel's head is one operation in two places —
    // which is exactly what this surface rules out — and two command ids alike
    // is how such a pair would show.
    const commands = everyOperation().map(commandIdFor);
    assert.strictEqual(new Set(commands).size, commands.length, 'two entries share a command');
    const ids = everyOperation().map((op) => op.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'one operation is described twice');
    for (const op of everyOperation()) {
      assert.ok(commandIdFor(op).startsWith('aggrega.'), `${op.id} runs no aggrega command`);
      assert.ok(op.label.trim() !== '', `${op.id} has no label`);
      assert.ok(op.detail.trim() !== '', `${op.id} explains nothing on hover`);
      assert.ok(op.icon.trim() !== '', `${op.id} has no icon`);
    }
  });

  it('reuses the command already contributed for an entry another surface owns', () => {
    // A command id is what a reader binds a keystroke to, so it is reused
    // rather than renamed — and the handler stays where it already is rather
    // than being wrapped in a second command that only forwards.
    const borrowed: Array<[string, string]> = [
      ['graph', 'aggrega.graph.show'],
      ['configShow', 'aggrega.config.open'],
      ...HEADED_ALL.map((headed): [string, string] => [headed.id, headed.command]),
    ];
    for (const [id, command] of borrowed) {
      const entry = everyOperation().find((op) => op.id === id);
      assert.ok(entry, `the ${id} entry is drawn nowhere at all`);
      assert.strictEqual(commandIdFor(entry), command);
    }
  });

  it('reaches a registered handler for every entry, including the ones it does not own', () => {
    // The defect this catches is a dead button: an entry naming a command
    // nothing registers draws normally and reports "command not found" when
    // pressed. The manifest cannot see that, so the sources that register are
    // read. Three registration shapes are collected — the literal id, this
    // surface's own composition from an entry id, and a single-sourced constant
    // — because an entry may reach a handler through any of them.
    const src = path.join(__dirname, '..', '..', '..', 'src');
    const sources = fs.readdirSync(src)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => fs.readFileSync(path.join(src, name), 'utf8'))
      .join('\n');
    // 🔴 A COMMAND ID DECLARED ONCE AND IMPORTED IS REGISTERED THROUGH ITS
    // CONSTANT, NOT THROUGH ITS TEXT, AND A LITERAL-ONLY CENSUS CANNOT SEE IT.
    // That is not a rare shape here: a command named by more than one surface is
    // declared beside the operation it performs precisely so the surfaces cannot
    // drift apart, and reading only the literal spelling would report a missing
    // handler for every id written the way this project asks for.
    const idOfConstant = new Map(
      Array.from(sources.matchAll(/export const ([A-Z][A-Z0-9_]*) = '(aggrega\.[^']+)'/g))
        .map((m) => [m[1], m[2]] as const),
    );
    const throughConstant = Array.from(
      sources.matchAll(/registerCommand\(\s*([A-Z][A-Z0-9_]*)\s*,/g),
    )
      .map((m) => idOfConstant.get(m[1]))
      .filter((id): id is string => id !== undefined);
    const registered = new Set<string>([
      ...Array.from(sources.matchAll(/registerCommand\(\s*'([^']+)'/g)).map((m) => m[1]),
      ...throughConstant,
      ...Array.from(sources.matchAll(/\breg\(\s*'([^']+)'/g)).map((m) => `aggrega.op.${m[1]}`),
    ]);
    // A negative control on the census: it does find a registration that is
    // certainly there, so a miss below is a missing handler rather than a
    // pattern that matches nothing.
    assert.ok(
      registered.has('aggrega.op.build'),
      'the census sees no registration it certainly should, so its misses mean nothing',
    );
    // A control on the arm added for the constant spelling, because the control
    // above cannot reach it: that one is satisfied by the literal arm alone, so
    // the constant arm could match nothing at all and every miss it caused would
    // read as a missing handler.
    assert.ok(
      throughConstant.length > 0,
      'the census resolved no registration made through a constant, so it is reading literal ids only '
      + 'and a command declared once and imported would be reported as having no handler',
    );
    for (const op of everyOperation()) {
      assert.ok(
        registered.has(commandIdFor(op)),
        `the ${op.id} entry runs ${commandIdFor(op)}, which no source registers a handler for`,
      );
    }
  });
});

describe('the operations drawn at the head of each list panel', () => {
  it('heads each list panel with its own operations, labelled, in the ruled order', () => {
    // Compared field by field against the literal set at the top of this file:
    // the id says which operation, the label what the row reads, and the
    // command what pressing it runs — the one each already ran, so a key
    // binding or a palette entry is unchanged.
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(PANEL_ACTIONS).map(([panel, actions]) => [
        panel,
        actions.map((action) => ({ id: action.id, label: action.label, command: commandIdFor(action) })),
      ])),
      HEADED,
    );
  });

  it('reads each panel\'s head in the container\'s own panel order', () => {
    assert.deepStrictEqual(Object.keys(PANEL_ACTIONS), ['registries', 'catalog', 'plugins']);
    assert.deepStrictEqual(allPanelActions().map((action) => action.id), HEADED_ALL.map((h) => h.id));
  });

  it('gives a sentence the label its row carries, and refuses an id no row carries', () => {
    for (const headed of HEADED_ALL) {
      assert.strictEqual(panelActionLabel(headed.id), headed.label);
    }
    assert.throws(
      () => panelActionLabel('validate' as PanelActionId),
      /drawn at the head of no list panel/,
      'a sentence could send a reader to a row no panel draws',
    );
  });

  it('decides a row\'s availability by the Commands panel\'s own rule, on the anchored folder alone', () => {
    // 🔴 ONE HOME FOR THE DECISION: the row's answer is the Commands panel's,
    // asked with the one fact a list panel holds. It is compared against that
    // rule in BOTH selection states, which is what shows the selection a list
    // panel cannot observe is never what decides a row.
    for (const headed of HEADED_ALL) {
      assert.strictEqual(
        panelActionReason(headed.id, false),
        NO_ANCHORED_WORKSPACE_CONTROL_REASON,
        `${headed.id} is drawn as pressable in the state its invocation refuses`,
      );
      assert.strictEqual(panelActionReason(headed.id, true), null, `${headed.id} is refused with a folder anchored`);
      for (const workspaceAnchored of [false, true]) {
        for (const releaseSelected of [false, true]) {
          assert.strictEqual(
            panelActionReason(headed.id, workspaceAnchored),
            unavailableReason(headed.id, { workspaceAnchored, releaseSelected }),
            `${headed.id}'s row and the Commands panel's rule disagree when a folder is ${workspaceAnchored ? '' : 'not '}anchored and a Release is ${releaseSelected ? '' : 'not '}selected`,
          );
        }
      }
    }
  });

  it('hovers a control with what it does, and where it cannot run, why', () => {
    const [add] = PANEL_ACTIONS.registries;
    assert.strictEqual(operationHint(add, null), 'Register a registry to resolve dependencies from and publish to');
    assert.strictEqual(
      operationHint(add, NO_ANCHORED_WORKSPACE_CONTROL_REASON),
      `Register a registry to resolve dependencies from and publish to — ${NO_ANCHORED_WORKSPACE_CONTROL_REASON}`,
    );
  });
});

describe('the surface the manifest actually contributes', () => {
  // Read from the manifest on disk rather than imported, so the assertion is
  // about the file the editor loads and not about a copy the compiler made.
  interface Manifest {
    contributes: {
      views: { aggrega: Array<{ id: string; name: string; type?: string }> };
      menus: {
        'view/title': Array<{ command: string; when: string }>;
        'view/item/context': Array<{ command: string; when: string; group?: string }>;
      };
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

  // The commands lead, because they are what a reader came to do. What a
  // reader with nothing configured needs first is the welcome panel, and that
  // opens in its own editor tab rather than as a panel here — so it costs the
  // container no slot, and this order holds whether it is shown or dismissed.
  it('orders the container panels Commands, Registries, Catalog, Plugins', () => {
    assert.deepStrictEqual(
      manifest.contributes.views.aggrega.map((v) => v.name),
      ['Commands', 'Registries', 'Catalog', 'Plugins'],
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

  it('keeps this panel\'s title bar to what belongs to the view', () => {
    // Every entry there belongs to the VIEW rather than to the workspace: one
    // opens the reader's own preferences, one opens a surface of the extension's
    // own, and neither acts on anything the panel holds — exactly as a refresh
    // belongs to the list it re-reads. So they stay and are not duplicated into
    // the flow, while every operation is a labelled control — a button in the
    // drawn document, or a row at a list panel's head — and never a title-bar
    // entry.
    assert.deepStrictEqual(
      commandsPanelTitleBar(manifest.contributes.menus['view/title']),
      [...COMMANDS_TITLE_BAR_ENTRIES],
      'the title bar carries what belongs to the view, and the flow carries the operations',
    );
  });

  it('clears the three list panels\' title bars of operations, leaving each its refresh', () => {
    // The ruling this asserts: a title-bar operation was a hover-revealed
    // unlabelled icon, which reads as a different surface from a labelled
    // button. A refresh is not an operation in that sense — it re-reads a list
    // rather than acting on the thing listed — so it stays, and the sweep is of
    // operations rather than of every entry.
    const byView = new Map<string, string[]>();
    for (const entry of manifest.contributes.menus['view/title']) {
      byView.set(entry.when, [...(byView.get(entry.when) ?? []), entry.command]);
    }
    assert.deepStrictEqual(
      byView.get('view == aggrega.registries'),
      ['aggrega.registries.refresh'],
    );
    assert.deepStrictEqual(
      byView.get('view == aggrega.workspaceCatalog'),
      ['aggrega.workspaceCatalog.refresh'],
    );
    assert.deepStrictEqual(
      byView.get('view == aggrega.plugins'),
      ['aggrega.plugins.refresh'],
    );
    // And nothing else is bound to a title bar at all, so an operation cannot
    // return to one under a `when` clause this check did not name.
    assert.deepStrictEqual(
      [...byView.keys()].sort(),
      [
        'view == aggrega.operations',
        'view == aggrega.plugins',
        'view == aggrega.registries',
        'view == aggrega.workspaceCatalog',
      ],
    );
  });

  it('binds none of the list panels\' own operations to a title bar, where it would be a hover-revealed icon', () => {
    const inTitleBars = manifest.contributes.menus['view/title']
      .map((m) => m.command);
    // A negative control: the census does see a command that IS in a title bar,
    // so the absences below measure the manifest rather than the search.
    assert.ok(
      inTitleBars.includes('aggrega.settings.open'),
      'the census cannot see a title-bar entry that is present',
    );
    for (const headed of HEADED_ALL) {
      assert.ok(
        !inTitleBars.includes(headed.command),
        `${headed.command} is a hover-revealed icon in a title bar as well as a row at its panel's head`,
      );
    }
  });

  it('removes the drafting entry from the catalog title bar rather than duplicating it', () => {
    // Drafting was panel-scoped AND already a button in the flow, so its
    // title-bar entry was a duplicate. Moving it would have shipped a second
    // Draft entity button; this asserts one entry, in the flow, and none in a
    // title bar.
    assert.ok(
      !manifest.contributes.menus['view/title'].some((m) => m.command === 'aggrega.op.scaffold'),
      'the drafting entry is still in a title bar as well as in the flow',
    );
    assert.deepStrictEqual(
      commandsPanelOperations().filter((op) => commandIdFor(op) === 'aggrega.op.scaffold').map((op) => op.id),
      ['scaffold'],
      'the flow carries a number of drafting entries other than one',
    );
  });

  it('leaves every row-scoped operation bound to its row', () => {
    // Clause-for-clause the counterpart of the title-bar sweep: the ruling
    // reaches the title bars and does not reach the rows, so every operation
    // whose subject is the clicked thing is still bound in the row block.
    const onRows = new Set(
      (manifest.contributes.menus['view/item/context'] ?? []).map((m) => m.command),
    );
    for (const command of [
      'aggrega.registries.updateOne',
      'aggrega.registries.logout',
      'aggrega.registries.remove',
      'aggrega.workspaceCatalog.inspect',
      'aggrega.workspaceCatalog.validate',
      'aggrega.workspaceCatalog.lint',
      'aggrega.workspaceCatalog.push',
      'aggrega.plugins.remove',
    ]) {
      assert.ok(onRows.has(command), `${command} acts on one row's subject and is bound to no row`);
    }
  });

  it('declares a command for every entry on either surface, so no entry is a dead button', () => {
    const declared = new Set(manifest.contributes.commands.map((c) => c.command));
    for (const op of everyOperation()) {
      assert.ok(
        declared.has(commandIdFor(op)),
        `the ${op.id} entry runs ${commandIdFor(op)}, which the manifest does not contribute`,
      );
    }
  });

  it('declares a command for every control on a row, so no row and no + is a dead button', () => {
    // The editor derives an activation event from each declared command, so a
    // control naming an undeclared one does NOTHING for a reader whose
    // workspace has not otherwise started the extension — which is exactly the
    // reader meeting an empty workspace and reaching for the + that creates one.
    //
    // 🔴 BOTH ARRANGEMENTS OF THE WINDOW ARE WALKED, because one row's controls
    // are not all present in either alone: the offer to open the Aggrega
    // workspace exists only where that workspace is not the folder already open,
    // so a census over one arrangement would report a full surface while leaving
    // the control that appears in the other unexamined.
    const declared = new Set<string>(manifest.contributes.commands.map((c) => c.command));
    const candidates = { projectFolders: 2, aggregaWorkspaces: 2, releases: 2 };
    const rows = [
      ...selectorRows(
        '/ws/project', '/ws/project', '/ws/project', { kind: 'unknown' }, candidates,
      ),
      ...selectorRows(
        '/ws/project', '/ws/project/services/api', '/ws/project/services/api',
        { kind: 'unknown' }, candidates,
      ),
    ];
    const ours = rows
      .flatMap(rowCommands)
      .filter((command) => command.startsWith('aggrega.'));
    // A negative control on the census, because the loop below is satisfied by
    // an empty list: a filter that matched nothing would pass exactly as a
    // fully-declared surface does.
    assert.ok(
      ours.includes(SWITCH_ANCHOR_COMMAND),
      'the census sees no row command it certainly should, so its verdict means nothing',
    );
    assert.ok(
      ours.includes(OPEN_WORKSPACE_ROOT_COMMAND),
      'the census sees neither arrangement\'s whole set of controls, so its verdict covers less '
      + 'than the surface it is about',
    );
    for (const command of ours) {
      assert.ok(
        declared.has(command),
        `a row control runs ${command}, which the manifest does not contribute`,
      );
    }
    // 🔴 AND NO ROW CONTROL RUNS AN EDITOR COMMAND AT ALL, which is what makes
    // the census above a statement about the whole surface rather than about the
    // part of it we happen to own. Every level is chosen through a command of
    // ours, and the editor's own folder-opening command is reached from INSIDE
    // the Project folder chooser rather than from the row — so a reader's press
    // on a row always lands somewhere the assertion above has checked is
    // contributed. The empty expectation is the strong form: any future row
    // control wired straight to an editor command fails here.
    //
    // The list above is non-empty, established by the two controls named as
    // negative controls, so this absence is measured rather than vacuous.
    assert.deepStrictEqual(
      [...new Set(rows.flatMap(rowCommands).filter((c) => !c.startsWith('aggrega.')))],
      [],
      'a row control runs an editor command directly instead of one of ours',
    );
  });

  it('puts every contributed operation command on the panel, so none is stranded', () => {
    const contributed = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.op.'));
    // A negative control on the census, because the assertion below is an
    // absence: a filter that matched nothing would report the same empty list
    // as a manifest with nothing stranded, so the zero would be a claim about
    // the census rather than a measurement of the file.
    assert.ok(
      contributed.includes('aggrega.op.build'),
      'the census sees no contributed operation command it certainly should, so its zeros mean nothing',
    );
    const onPanel = new Set(commandsPanelOperations().map(commandIdFor));
    assert.deepStrictEqual(
      contributed.filter((c) => !onPanel.has(c)),
      [],
      'the manifest contributes an operation command no entry on the panel runs, so it draws in the command palette and finds nothing when pressed',
    );
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
  it('scopes a pull to the selected Release, which the command marks required', () => {
    assert.deepStrictEqual(
      releaseScopedArgs('pull', 'releases/production.yaml'),
      ['pull', '--release', 'releases/production.yaml'],
    );
  });

  it('composes an argument list for the resolution and for nothing else', () => {
    // 🔴 AN EQUALITY OVER THE WHOLE EXPORT SET, NOT A PER-OPERATION FILTER. The
    // filters this replaced named the operations somebody had thought to name —
    // cache, import, publication — so a composition reappearing under a name none
    // of them anticipated would have passed every one of them. The set equality
    // fails on any composition at all, whatever it is called.
    //
    // The one survivor is the Release-scoped resolution, and it is held by a
    // measured property of the compiler rather than by nobody having moved it: its
    // closure walk resolves each entity through a catalog lookup that takes no
    // context, so a request's stop cannot reach the registry fetch inside it.
    const composers = Object.keys(groups).filter((name) => /Args$/.test(name));
    assert.deepStrictEqual(
      composers,
      ['releaseScopedArgs'],
      'this panel gained or lost an argument list; every other entry reaches the compiler as a '
      + 'request, and a composition for one of those would be a second way to run it',
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
  // bare verb, so pressing it could only ever produce a usage error. These are the
  // assertions that fail if any entry regresses to that shape.
  //
  // 🔴 THE GUARDS FOR THE ENTRIES THAT MOVED WENT WITH THEM, AND NAMING WHERE IS
  // WHAT KEEPS THIS FROM READING AS A REMOVED PROTECTION. Each now refuses a
  // REQUEST rather than an argument list, in the module that composes it and
  // against the same shapes: the publication family in publication-request.test.ts,
  // the import in import-request.test.ts, and the registry index build's row scope
  // in registry-index-request.test.ts.
  const bare: Array<[string, () => unknown]> = [
    ['a pull with no Release', () => releaseScopedArgs('pull', '')],
    ['a pull with a whitespace Release', () => releaseScopedArgs('pull', '  ')],
  ];

  for (const [what, compose] of bare) {
    it(`refuses to compose ${what}`, () => {
      assert.throws(compose, /takes|requires/);
    });
  }

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
      everyOperation().map((op) => op.id).sort(),
    );
  });

  it('reads each requirement off the guard the operation\'s own handler applies', () => {
    // Established by reading the handlers rather than inferred from the entry.
    // A Release-scoped operation checks the anchored folder and then the
    // selection. A command-line-backed one checks the folder it runs in,
    // because the one invocation path they share refuses without it. A
    // language-server-backed one that takes no subject checks neither, so
    // nothing this panel can observe stops it.
    assert.deepStrictEqual(OPERATION_REQUIREMENTS, {
      validate: 'none',
      lint: 'workspace',
      build: 'release',
      preview: 'release',
      graph: 'release',
      pull: 'release',
      scaffold: 'none',
      import: 'workspace',
      inspect: 'none',
      push: 'workspace',
      sign: 'workspace',
      deprecate: 'workspace',
      configShow: 'none',
      cache: 'none',
      registryAdd: 'workspace',
      registryIndex: 'workspace',
      catalogSearch: 'workspace',
      pluginAdd: 'workspace',
      pluginEntities: 'workspace',
    });
  });

  it('gates every operation heading a list panel on the anchored folder, and never on a Release', () => {
    // A list panel observes the anchored folder and not the selection, so the
    // requirement of each operation drawn there is the folder or nothing. The
    // row is drawn unavailable in exactly that state, with the reason, and
    // never hidden.
    const nothing = { workspaceAnchored: false, releaseSelected: false };
    const anchored = { workspaceAnchored: true, releaseSelected: false };
    for (const { id } of HEADED_ALL) {
      assert.notStrictEqual(
        OPERATION_REQUIREMENTS[id], 'release',
        `${id} heads a list panel and needs a selected Release, which that panel cannot observe`,
      );
      assert.strictEqual(
        unavailableReason(id, nothing),
        NO_ANCHORED_WORKSPACE_CONTROL_REASON,
        `${id} is drawn as pressable in the state its invocation refuses`,
      );
      assert.strictEqual(
        unavailableReason(id, anchored), null,
        `${id} asks for a Release, which its handler never reads`,
      );
    }
  });

  it('reports no reason for anything once a folder is anchored and a Release chosen', () => {
    const ready = { workspaceAnchored: true, releaseSelected: true };
    for (const op of everyOperation()) {
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
    const asked = commandsPanelOperations()
      .map((op) => op.id)
      .filter((id) => unavailableReason(id, anchored) === NO_RELEASE_SELECTED_CONTROL_REASON);
    assert.deepStrictEqual(asked, ['build', 'preview', 'graph', 'pull']);
  });

  it('leaves the entries no observable fact gates without a reason at all', () => {
    // A control drawn as unavailable for a reason nothing on the panel can
    // evaluate would be a guess presented as a fact — so an operation this
    // panel cannot observe a blocker for carries no unavailable state in any
    // combination of the facts it can observe.
    const unconditional = commandsPanelOperations()
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

  it('composes a publication request from a chosen subject and nothing else', () => {
    const [subject] = publishableSubjects([entity({})]);
    assert.deepStrictEqual(
      publishEntityRequest(subject.file),
      { entity: 'catalog/components/api-server.yaml' },
    );
  });
});
