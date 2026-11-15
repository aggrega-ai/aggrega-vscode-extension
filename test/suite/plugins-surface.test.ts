// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS_TITLE_BAR_ENTRIES, DRAFT_BUTTON, commandsPanelTitleBar } from '../helpers/title-bar';
import { PANEL_ACTIONS, commandIdFor, commandsPanelOperations } from '../../src/operation-groups';
import {
  PLUGIN_CONFIG_ENTRY_ROW_CONTEXT,
  PLUGIN_ROW_CONTEXT,
} from '../../src/plugins-run';

// What a reader sees and presses on this panel is not provable here — driving
// the panel needs an extension host, and the suite that supplies one does not
// run in this container. What IS provable is everything that decides whether a
// press can succeed at all: that each entry names a command the editor will
// find, that each title-bar entry carries the icon its toolbar needs to draw
// anything, and that no entry lands on a row carrying no subject for it.

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

// Read from the manifest on disk rather than imported, so the assertion is
// about the file the editor loads and not about a copy the compiler made.
const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
);

const PLUGINS_VIEW = 'view == aggrega.plugins';
const PLUGIN_ROW = `viewItem == ${PLUGIN_CONFIG_ENTRY_ROW_CONTEXT}`;
const PLUGIN_COMMAND_PREFIX = 'aggrega.plugins.';

function declared(): Map<string, CommandEntry> {
  return new Map(manifest.contributes.commands.map((c) => [c.command, c]));
}

function titleBarEntries(): MenuEntry[] {
  return manifest.contributes.menus['view/title'].filter((m) => m.when === PLUGINS_VIEW);
}

// pluginRowEntries narrows to the entries this panel contributes. Every panel
// that offers a row operation adds to the one shared block, so a check on how
// THIS panel binds its rows has to select its own entries: read whole, the block
// answers for every panel at once, and the answer another panel is entitled to
// give would read here as this one having bound a row wrongly.
function pluginRowEntries(): MenuEntry[] {
  return (manifest.contributes.menus['view/item/context'] ?? [])
    .filter((m) => m.command.startsWith(PLUGIN_COMMAND_PREFIX));
}

// targetedRowValues reads the row values a `when` clause compares against.
//
// It parses the comparisons rather than searching the clause for a value's text,
// and the difference is not cosmetic. One row value is a prefix of the other and
// of the view's own id, so a text search answers on a coincidence — and, worse,
// a clause naming BOTH values would look to a text search like a clause naming
// only the wider one, which is precisely the defect this file checks for.
function targetedRowValues(when: string): string[] {
  return [...when.matchAll(/viewItem\s*==\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
}

function pluginCommands(): string[] {
  return manifest.contributes.commands
    .map((c) => c.command)
    .filter((c) => c.startsWith(PLUGIN_COMMAND_PREFIX));
}

function paletteSuppressed(): Set<string> {
  return new Set(
    manifest.contributes.menus.commandPalette
      .filter((m) => m.when === 'false')
      .map((m) => m.command),
  );
}

describe('the operations the plugins panel contributes', () => {
  it('keeps the refresh command in the title bar, where it already was', () => {
    const refresh = titleBarEntries().find((m) => m.command === 'aggrega.plugins.refresh');
    assert.ok(refresh, 'the plugins refresh is no longer on the plugins panel');
    assert.strictEqual(refresh.group, 'navigation');
  });

  it('leaves the refresh alone in the title bar, the operations being rows at the head of the list', () => {
    // A title-bar entry is a hover-revealed unlabelled icon, which reads as a
    // different surface from a labelled control — so every operation acting on
    // the whole panel is a labelled row at the head of its list instead, and the
    // title bar carries only what belongs to the view.
    assert.deepStrictEqual(
      titleBarEntries().map((m) => m.command),
      [DRAFT_BUTTON, 'aggrega.plugins.refresh'],
      'an operation is still a hover-revealed icon in this panel\'s title bar',
    );
  });

  it('draws both whole-set operations at the head of this panel, and on no other surface', () => {
    // Present at the head of this panel and absent from the Commands panel, so
    // neither operation is merely gone and neither has two places a reader
    // could look.
    const headed = PANEL_ACTIONS.plugins.map(commandIdFor);
    assert.deepStrictEqual(
      headed,
      ['aggrega.plugins.add', 'aggrega.plugins.genCatalog'],
      'a reader can see their plugins and cannot add one, or cannot generate their entities',
    );
    const onCommands = commandsPanelOperations().map(commandIdFor);
    for (const command of headed) {
      assert.ok(!onCommands.includes(command), `${command} is on the Commands panel as well`);
    }
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
    for (const entry of [...titleBarEntries(), ...pluginRowEntries()]) {
      assert.ok(
        commands.has(entry.command),
        `${entry.command} is bound to a menu the manifest does not contribute a command for`,
      );
    }
  });

  it('puts the operation acting on one plugin on a plugin row', () => {
    const commands = pluginRowEntries()
      .filter((m) => m.when === PLUGIN_ROW)
      .map((m) => m.command);
    assert.ok(
      commands.includes('aggrega.plugins.remove'),
      'removing one plugin acts on that plugin but is on no row',
    );
  });

  it('targets a row operation by the value only an addressable plugin row carries', () => {
    // This is the assertion that keeps a plugin operation off the group
    // headings, off the message rows, off a plugin built into the compiler, and
    // off a configured attachment nothing answered for. Targeting the view
    // instead would put it on all of them, where pressing it could only invoke it
    // with no subject or with a type the product never reported.
    const entries = pluginRowEntries();
    assert.ok(entries.length > 0, 'the panel contributes no row operations at all');
    for (const entry of entries) {
      assert.strictEqual(
        entry.when, PLUGIN_ROW,
        `${entry.command} is bound by "${entry.when}", which reaches rows that name no plugin`,
      );
      assert.ok(
        !/\bview\s*==/.test(entry.when),
        `${entry.command} is bound to the view rather than to a row value`,
      );
      assert.deepStrictEqual(
        targetedRowValues(entry.when), [PLUGIN_CONFIG_ENTRY_ROW_CONTEXT],
        `${entry.command} compares against row values it should not`,
      );
    }
  });

  it('binds the row entries to the value the view actually sets', () => {
    // The manifest's string and the code's constant are one value read from two
    // places; asserting they agree is what keeps a rename from silently
    // unbinding every row operation.
    assert.strictEqual(PLUGIN_CONFIG_ENTRY_ROW_CONTEXT, 'aggrega.plugin.configEntry');
    assert.strictEqual(PLUGIN_ROW_CONTEXT, 'aggrega.plugin');
    assert.notStrictEqual(
      PLUGIN_CONFIG_ENTRY_ROW_CONTEXT, PLUGIN_ROW_CONTEXT,
      'the two row values must differ, or every row admits every operation',
    );
  });

  it('binds nothing to the value a row with no removable entry carries', () => {
    // The second value exists to be the one nothing is bound to. An entry
    // targeting it would put the removal back on exactly the rows that cannot
    // supply its subject — including one that names both values, which is why the
    // comparisons are read rather than the clause searched.
    const misbound = (manifest.contributes.menus['view/item/context'] ?? [])
      .filter((m) => targetedRowValues(m.when).includes(PLUGIN_ROW_CONTEXT))
      .map((m) => `${m.command} bound by "${m.when}"`);
    assert.deepStrictEqual(misbound, []);
  });

  it('keeps a row operation out of the command palette, where it would have no row', () => {
    // Invoked from the palette a row command receives no row, so it would run
    // with no subject — the invocation that cannot succeed. Hiding it is what
    // makes the row the only way in.
    const hidden = paletteSuppressed();
    for (const entry of pluginRowEntries()) {
      assert.ok(
        hidden.has(entry.command),
        `${entry.command} is offered in the command palette, where it is invoked with no plugin`,
      );
    }
  });

  it('leaves a panel-scoped operation in the palette, where it composes its own subject', () => {
    // The counterpart to the rule above: these need no row. Both ask for what
    // they act on before running, so both succeed from the palette.
    const hidden = paletteSuppressed();
    assert.ok(!hidden.has('aggrega.plugins.add'));
    assert.ok(!hidden.has('aggrega.plugins.genCatalog'));
    assert.ok(!hidden.has('aggrega.plugins.refresh'));
  });

  it('registers every command it contributes, so none resolves to nothing when pressed', () => {
    // Contributing a command and never registering a handler for it is the
    // other half of a dead button: the entry draws, and pressing it reports
    // that the command was not found. The manifest cannot see that, so the
    // source that registers them is read here.
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'plugins-view.ts'),
      'utf8',
    );
    const contributed = pluginCommands();

    assert.ok(contributed.length > 0, 'the panel contributes no commands at all');
    for (const id of contributed) {
      // The identifier sits on its own line for the longer registrations, so
      // the match spans whitespace rather than assuming one formatting.
      const registered = new RegExp(
        `registerCommand\\(\\s*'${id.replace(/\./g, '\\.')}'`,
      );
      assert.ok(
        registered.test(source),
        `${id} is contributed but never registered, so pressing it finds no command`,
      );
    }
  });

  it('adds nothing to the Commands panel\'s title bar', () => {
    // Its operations are rows at the head of its own list, not title-bar entries
    // anywhere — so that title bar carries only what belongs to that view, which
    // is named in one place rather than restated here.
    assert.deepStrictEqual(
      commandsPanelTitleBar(manifest.contributes.menus['view/title']),
      [...COMMANDS_TITLE_BAR_ENTRIES],
      'the title bar carries what belongs to the view, and the flow carries the operations',
    );
  });

  it('leaves the plugin operations off every other panel', () => {
    const commands = pluginCommands();
    const misplaced = manifest.contributes.menus['view/title']
      .filter((m) => commands.includes(m.command) && m.when !== PLUGINS_VIEW);
    assert.deepStrictEqual(misplaced, []);
  });
});
