// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS_TITLE_BAR_ENTRIES, commandsPanelTitleBar } from '../helpers/title-bar';
import {
  CATALOG_ENTITY_ROW_CONTEXT,
  CATALOG_ROW_OPERATIONS,
  CatalogRowOperation,
  catalogRowContext,
  catalogRowOperations,
} from '../../src/catalog-entity-operations';
import { PANEL_ACTIONS, commandIdFor, commandsPanelOperations } from '../../src/operation-groups';
import {
  ENTITY_ORIGIN_CATALOG,
  ENTITY_ORIGIN_WORKSPACE,
  WorkspaceCatalogNode,
  rowForEntity,
} from '../../src/workspace-catalog-run';

// What a reader sees and presses on this panel is not provable here — driving
// the panel needs an extension host, and the suite that supplies one does not
// run in this container. What IS provable is everything that decides whether a
// press can succeed at all: that each entry names a command the editor will
// find and a handler it will reach, that each title-bar entry carries the icon
// its toolbar needs to draw anything, and that no entry lands on a row carrying
// no subject for it.

interface MenuEntry {
  command: string;
  when: string;
  group?: string;
}

interface CommandEntry {
  command: string;
  title: string;
  category?: string;
  icon?: string;
}

interface Manifest {
  contributes: {
    menus: {
      commandPalette: Array<{ command: string; when: string }>;
      'view/title': MenuEntry[];
      'view/item/context': MenuEntry[];
    };
    commands: CommandEntry[];
  };
}

const REPO = path.join(__dirname, '..', '..', '..');

// Read from the manifest on disk rather than imported, so the assertion is
// about the file the editor loads and not about a copy the compiler made.
const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'),
);

const CATALOG_VIEW = 'view == aggrega.workspaceCatalog';

// ROW_COMMAND_PREFIX opens every command a row of this panel binds; what follows
// it is the operation's own token in the row's value.
const ROW_COMMAND_PREFIX = 'aggrega.workspaceCatalog.';

// The operations that take the entity's path, and the one addressed by identity.
const PATH_TAKING = [
  'aggrega.workspaceCatalog.validate',
  'aggrega.workspaceCatalog.lint',
  'aggrega.workspaceCatalog.push',
];
const IDENTITY_TAKING = 'aggrega.workspaceCatalog.inspect';

// everyRow is an entity row in every state the offering rule distinguishes: each
// combination of what the compiler accepts a document of the row's kind for,
// with and without a document, and a kind the compiler's answer holds no entry
// for, with and without one. What each offers is the classification's to say;
// what is asserted below is that the manifest offers exactly that.
function everyRow(): { name: string; node: WorkspaceCatalogNode }[] {
  const rows: { name: string; node: WorkspaceCatalogNode }[] = [];
  for (const document of [true, false]) {
    const at = document
      ? { origin: ENTITY_ORIGIN_WORKSPACE, file: 'catalog/components/api-server.yaml' }
      : { origin: ENTITY_ORIGIN_CATALOG, file: '' };
    const entity = {
      kind: 'Component', name: 'core/compute/api-server', apiVersion: 'aggrega.ai/v1alpha1',
      description: '', labels: {}, ...at,
    };
    for (const acceptance of [null, ...[0, 1, 2, 3, 4, 5, 6, 7].map((bits) => ({
      singleEntityValidation: (bits & 1) !== 0,
      publication: (bits & 2) !== 0,
      inspectionByName: (bits & 4) !== 0,
    }))]) {
      const kinds = acceptance === null ? [] : [{ kind: 'component', documentKind: 'Component', acceptedBy: acceptance }];
      rows.push({
        name: `${document ? 'with' : 'without'} a document, accepting ${JSON.stringify(acceptance)}`,
        node: { kind: 'entry', row: rowForEntity('/ws', entity, kinds) },
      });
    }
  }
  return rows;
}

// whenPattern reads the one clause a row entry is bound by — a pattern over the
// row's value — as the editor evaluates it, or null where the entry is bound by
// anything else.
function whenPattern(when: string): RegExp | null {
  const m = /^viewItem =~ \/(.+)\/$/.exec(when);
  return m === null ? null : new RegExp(m[1]);
}

// rowOperationOf is the operation a row entry's command binds, by the command's
// own last segment.
function rowOperationOf(command: string): string {
  return command.slice(ROW_COMMAND_PREFIX.length);
}

function declared(): Map<string, CommandEntry> {
  return new Map(manifest.contributes.commands.map((c) => [c.command, c]));
}

function titleBarEntries(): MenuEntry[] {
  return manifest.contributes.menus['view/title'].filter((m) => m.when === CATALOG_VIEW);
}

// catalogRowEntries narrows the shared row block to this panel's own entries.
// Every panel offering a row operation adds to one block, so read whole it
// answers for all of them at once.
function catalogRowEntries(): MenuEntry[] {
  return (manifest.contributes.menus['view/item/context'] ?? [])
    .filter((m) => m.command.startsWith('aggrega.workspaceCatalog.'));
}

function suppressedFromPalette(): Set<string> {
  return new Set(
    manifest.contributes.menus.commandPalette
      .filter((m) => m.when === 'false')
      .map((m) => m.command),
  );
}

describe('the operations the workspace-catalog panel contributes', () => {
  it('leaves the refresh alone in the title bar, the operations being labelled controls elsewhere', () => {
    // A title-bar entry is a hover-revealed unlabelled icon, which reads as a
    // different surface from a labelled control — so the published-catalog
    // search and the drafting entry are rows at the head of this panel's list,
    // and the title bar carries only what belongs to the view.
    const entries = titleBarEntries();
    assert.deepStrictEqual(
      entries.map((m) => m.command),
      ['aggrega.workspaceCatalog.refresh'],
      'an operation is still a hover-revealed icon in this panel\'s title bar',
    );
    assert.strictEqual(entries[0].group, 'navigation');
  });

  it('heads this panel with the search and then the drafting entry, and leaves neither on the Commands panel', () => {
    // Each is present in exactly one place, so neither is merely gone and
    // neither has two places a reader could look.
    assert.deepStrictEqual(
      PANEL_ACTIONS.catalog.map(commandIdFor),
      ['aggrega.catalog.searchPublished', 'aggrega.op.scaffold'],
      'this panel is not headed by the published-catalog search and then drafting an entity',
    );
    const onCommands = commandsPanelOperations().map(commandIdFor);
    // A negative control on the two absences below: the census does see a
    // command that IS on the Commands panel.
    assert.ok(
      onCommands.includes('aggrega.op.import'),
      'the census cannot see a command the Commands panel draws, so its absences mean nothing',
    );
    assert.ok(
      !onCommands.includes('aggrega.catalog.searchPublished'),
      'the published-catalog search is on the Commands panel as well',
    );
    assert.ok(
      !onCommands.includes('aggrega.op.scaffold'),
      'drafting an entity is on the Commands panel as well',
    );
  });

  it('gives every title-bar entry an icon, because the toolbar is drawn without labels', () => {
    // An entry with no icon renders as an empty control rather than as text, so
    // a missing icon is an invisible button rather than an ugly one.
    const commands = declared();
    for (const entry of titleBarEntries()) {
      const command = commands.get(entry.command);
      assert.ok(command, `${entry.command} is bound to the title bar but never contributed`);
      assert.ok(
        command.icon && command.icon.length > 0,
        `${entry.command} is in the title bar with no icon, so it draws as an empty control`,
      );
    }
  });

  it('declares a command for every entry it binds, so no entry is a dead button', () => {
    const commands = declared();
    for (const entry of [...titleBarEntries(), ...catalogRowEntries()]) {
      assert.ok(
        commands.has(entry.command),
        `${entry.command} is bound to a menu the manifest does not contribute a command for`,
      );
    }
  });

  it('binds each row operation where the classification offers it, and nowhere else', () => {
    // 🔴 THE MANIFEST IS READ BACK AGAINST THE ONE DECISION, NOT AGAINST A COPY OF
    // IT. Each entry's clause is evaluated over the value the view sets for a row
    // in every state the rule distinguishes, and it must reach exactly the rows the
    // classification offers that operation on — so an entry that reached a row the
    // compiler refuses the operation for, or missed one it accepts it for, fails
    // here whatever the clause's wording.
    const rows = everyRow();
    for (const entry of catalogRowEntries()) {
      const pattern = whenPattern(entry.when);
      assert.ok(pattern !== null, `${entry.command} is bound by "${entry.when}", which is not a pattern over the row's value`);
      const operation = rowOperationOf(entry.command);
      for (const { name, node } of rows) {
        const context = catalogRowContext(node);
        const reached: boolean = context !== null && pattern.test(context);
        const offered: boolean = (catalogRowOperations(node) ?? []).includes(operation as CatalogRowOperation);
        assert.strictEqual(
          reached, offered,
          `${entry.command} (${entry.group}) ${reached ? 'reaches' : 'misses'} a row ${name}, which the rule ${offered ? 'offers it on' : 'withholds it from'}`,
        );
      }
    }
    // The negative control: across those rows each operation is both offered and
    // withheld somewhere, so the equality above is not two sides that agree
    // because neither ever varies.
    for (const operation of CATALOG_ROW_OPERATIONS) {
      const offeredOn = rows.filter(({ node }) => (catalogRowOperations(node) ?? []).includes(operation)).length;
      assert.ok(offeredOn > 0 && offeredOn < rows.length, `${operation} is offered on ${offeredOn} of ${rows.length} rows`);
    }
  });

  it('binds every operation the classification can offer, and the path-taking ones only to a row with a document', () => {
    const bound = new Set(catalogRowEntries().map((m) => rowOperationOf(m.command)));
    assert.deepStrictEqual(
      [...CATALOG_ROW_OPERATIONS].sort(), [...bound].sort(),
      'an operation the rows can offer has no entry, or an entry binds an operation the rows never offer',
    );
    // Publishing and both checks take the entity's path; a row for an entity this
    // workspace holds no document for has none to give, so none of them may reach
    // it whatever its kind accepts.
    for (const { name, node } of everyRow()) {
      if (node.kind !== 'entry' || node.row.entityPath !== '') { continue; }
      const context = catalogRowContext(node);
      for (const entry of catalogRowEntries().filter((m) => PATH_TAKING.includes(m.command))) {
        const pattern = whenPattern(entry.when);
        assert.ok(
          context === null || pattern === null || !pattern.test(context),
          `${entry.command} takes a path but reaches a row ${name}`,
        );
      }
    }
  });

  it('gives the inline slot to the one operation that changes nothing', () => {
    // An inline action is reached without opening a menu, so it goes to the
    // read-only operation. Publishing stays behind the menu's deliberate second
    // step.
    const inline = catalogRowEntries().filter((m) => m.group === 'inline').map((m) => m.command);
    assert.deepStrictEqual(inline, [IDENTITY_TAKING]);
  });

  it('targets every row operation by a value only an entity row carries', () => {
    // This is the assertion that keeps an entity operation off the kind
    // headings and the message rows. Targeting the view instead would put every
    // one of them on "No entities in this workspace." and on the failure row,
    // where pressing one could only invoke it with no subject. Those rows carry
    // no value, so a clause that can match only a value opening with the entity
    // rows' own prefix reaches none of them.
    for (const entry of catalogRowEntries()) {
      assert.ok(
        entry.when.startsWith(`viewItem =~ /^${CATALOG_ENTITY_ROW_CONTEXT.replace(/\./g, '\\.')}(`),
        `${entry.command} is bound by "${entry.when}", which is not anchored to the entity rows' value`,
      );
    }
  });

  it('binds the row entries to the value the view actually sets', () => {
    // The manifest's pattern and the code's constant are the same value read from
    // two places; asserting it is what keeps a rename from silently unbinding
    // every row operation. The evaluation above is what shows the two agree.
    assert.strictEqual(CATALOG_ENTITY_ROW_CONTEXT, 'aggrega.catalogEntity');
    assert.ok(catalogRowEntries().length > 0, 'the panel contributes no row operations at all');
  });

  it('keeps a row operation out of the command palette, where it would have no row', () => {
    // Invoked from the palette a row command receives no row, so it would run
    // with no subject — the invocation that cannot succeed. Hiding it is what
    // makes the row the only way in.
    const hidden = suppressedFromPalette();
    for (const id of [...PATH_TAKING, IDENTITY_TAKING]) {
      assert.ok(
        hidden.has(id),
        `${id} is offered in the command palette, where it is invoked with no entity`,
      );
    }
  });

  it('leaves the drafting command in the palette, where it composes its own subject', () => {
    // The counterpart to the rule above: drafting needs no row. It asks for the
    // kind, so it succeeds from the palette.
    assert.ok(!suppressedFromPalette().has('aggrega.op.scaffold'));
  });

  it('registers a handler for every row command it contributes', () => {
    // Contributing a command and never registering a handler for it is the
    // other half of a dead button: the entry draws, and pressing it reports
    // that the command was not found. The manifest cannot see that, so the
    // source that registers them is read here.
    const source = fs.readFileSync(
      path.join(REPO, 'src', 'workspace-catalog-view.ts'),
      'utf8',
    );
    const contributed = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.workspaceCatalog.'));

    assert.ok(contributed.length > 0, 'the panel contributes no commands at all');
    for (const id of contributed) {
      // The identifier sits on its own line for the longer registrations, so
      // the match spans whitespace rather than assuming one formatting.
      const registered = new RegExp(`registerCommand\\(\\s*'${id.replace(/\./g, '\\.')}'`);
      assert.ok(
        registered.test(source),
        `${id} is contributed but never registered, so pressing it finds no command`,
      );
    }
  });

  it('reaches a registered handler for the search this panel\'s head runs', () => {
    // The search command is contributed and registered by the published-catalog
    // search rather than by the tree that draws the row, so the row is only as
    // good as this registration. Read from the source, which is the only place
    // it exists — the manifest cannot see whether a handler was ever registered.
    const source = fs.readFileSync(path.join(REPO, 'src', 'catalog-views.ts'), 'utf8');
    assert.match(
      source, /registerCommand\(\s*'aggrega\.catalog\.searchPublished'/,
      'the search heads the Catalog panel with no handler registered for it',
    );
  });

  it('adds nothing to the Commands panel\'s title bar', () => {
    // Its operation is a row at the head of its own list, not a title-bar entry
    // anywhere — so that title bar carries only what belongs to that view.
    assert.deepStrictEqual(
      commandsPanelTitleBar(manifest.contributes.menus['view/title']),
      [...COMMANDS_TITLE_BAR_ENTRIES],
      'the title bar carries what belongs to the view, and the flow carries the operations',
    );
  });

  it('leaves the workspace-catalog operations off every other panel', () => {
    const catalogCommands = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.workspaceCatalog.'));
    const misplaced = manifest.contributes.menus['view/title']
      .filter((m) => catalogCommands.includes(m.command) && m.when !== CATALOG_VIEW);
    assert.deepStrictEqual(misplaced, []);
  });
});
