// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS_TITLE_BAR_ENTRIES, commandsPanelTitleBar } from '../helpers/title-bar';
import {
  CATALOG_DOCUMENT_ROW_CONTEXT,
  CATALOG_NO_DOCUMENT_ROW_CONTEXT,
} from '../../src/catalog-entity-operations';
import { PANEL_ACTIONS, commandIdFor, commandsPanelOperations } from '../../src/operation-groups';

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
const DOCUMENT_ROW = `viewItem == ${CATALOG_DOCUMENT_ROW_CONTEXT}`;
const ANY_ENTITY_ROW =
  `viewItem == ${CATALOG_DOCUMENT_ROW_CONTEXT} || viewItem == ${CATALOG_NO_DOCUMENT_ROW_CONTEXT}`;

// The operations that take the entity's path, and the one addressed by identity.
// They are listed apart because that difference is what decides which rows each
// appears on, and it is the panel's whole reason for carrying two row values.
const PATH_TAKING = [
  'aggrega.workspaceCatalog.validate',
  'aggrega.workspaceCatalog.lint',
  'aggrega.workspaceCatalog.push',
];
const IDENTITY_TAKING = 'aggrega.workspaceCatalog.inspect';

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
    // search is a row at the head of this panel's list and the drafting entry a
    // button on the Commands panel, and the title bar carries only what belongs
    // to the view.
    const entries = titleBarEntries();
    assert.deepStrictEqual(
      entries.map((m) => m.command),
      ['aggrega.workspaceCatalog.refresh'],
      'an operation is still a hover-revealed icon in this panel\'s title bar',
    );
    assert.strictEqual(entries[0].group, 'navigation');
  });

  it('draws the search at the head of this panel and the drafting entry on the Commands panel', () => {
    // Each is present in exactly one place, so neither is merely gone and
    // neither has two places a reader could look.
    assert.deepStrictEqual(
      PANEL_ACTIONS.catalog.map(commandIdFor),
      ['aggrega.catalog.searchPublished'],
      'the published-catalog search is not what this panel is headed by',
    );
    const onCommands = commandsPanelOperations().map(commandIdFor);
    assert.ok(
      !onCommands.includes('aggrega.catalog.searchPublished'),
      'the published-catalog search is on the Commands panel as well',
    );
    assert.ok(
      onCommands.includes('aggrega.op.scaffold'),
      'a reader can see the entities in this workspace and cannot draft one',
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

  it('offers every path-taking operation on a row that has a document, and only there', () => {
    // This is the rule the panel exists to express. Publishing and both checks
    // take the entity's path; a row for an entity this workspace holds no
    // document for has none to give, so an entry reaching it could only invoke
    // with no path.
    for (const id of PATH_TAKING) {
      const bindings = catalogRowEntries().filter((m) => m.command === id);
      assert.ok(bindings.length > 0, `${id} acts on one entity but is on no row`);
      for (const binding of bindings) {
        assert.strictEqual(
          binding.when, DOCUMENT_ROW,
          `${id} takes a path but is bound by "${binding.when}", which reaches a row with none`,
        );
      }
    }
  });

  it('offers the inspection on every entity row, because it is addressed by identity', () => {
    const bindings = catalogRowEntries().filter((m) => m.command === IDENTITY_TAKING);
    assert.ok(bindings.length > 0, 'the inspection is on no row');
    for (const binding of bindings) {
      assert.strictEqual(
        binding.when, ANY_ENTITY_ROW,
        `the inspection is bound by "${binding.when}", which withholds it from rows that can run it`,
      );
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
    // where pressing one could only invoke it with no subject.
    for (const entry of catalogRowEntries()) {
      assert.ok(
        entry.when === DOCUMENT_ROW || entry.when === ANY_ENTITY_ROW,
        `${entry.command} is bound by "${entry.when}", which reaches rows that name no entity`,
      );
    }
  });

  it('binds the row entries to the values the view actually sets', () => {
    // The manifest's strings and the code's constants are the same two values
    // read from two places; asserting they agree is what keeps a rename from
    // silently unbinding every row operation.
    assert.strictEqual(CATALOG_DOCUMENT_ROW_CONTEXT, 'aggrega.catalogEntity.document');
    assert.strictEqual(CATALOG_NO_DOCUMENT_ROW_CONTEXT, 'aggrega.catalogEntity.noDocument');
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
