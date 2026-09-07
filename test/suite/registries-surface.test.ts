// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REGISTRY_ROW_CONTEXT } from '../../src/registries-run';

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

const REGISTRIES_VIEW = 'view == aggrega.registries';
const REGISTRY_ROW = `viewItem == ${REGISTRY_ROW_CONTEXT}`;

function declared(): Map<string, CommandEntry> {
  return new Map(manifest.contributes.commands.map((c) => [c.command, c]));
}

function titleBarEntries(): MenuEntry[] {
  return manifest.contributes.menus['view/title'].filter((m) => m.when === REGISTRIES_VIEW);
}

function rowEntries(): MenuEntry[] {
  return manifest.contributes.menus['view/item/context'] ?? [];
}

// registryRowEntries narrows to the entries this panel contributes. Every panel
// that offers a row operation adds to the one shared block, so a check on how
// THIS panel binds its rows has to select its own entries: read whole, the block
// answers for every panel at once, and the answer another panel is entitled to
// give would read here as this one having bound a row wrongly.
function registryRowEntries(): MenuEntry[] {
  return rowEntries().filter((m) => m.command.startsWith('aggrega.registries.'));
}

describe('the operations the registries panel contributes', () => {
  it('keeps the refresh command in the title bar, where it already was', () => {
    const refresh = titleBarEntries().find((m) => m.command === 'aggrega.registries.refresh');
    assert.ok(refresh, 'the registries refresh is no longer on the registries panel');
    assert.strictEqual(refresh.group, 'navigation');
  });

  it('puts the operations acting on the whole panel in its title bar', () => {
    const commands = titleBarEntries().map((m) => m.command);
    assert.ok(
      commands.includes('aggrega.registries.add'),
      'a reader can see their registries and cannot add one',
    );
    assert.ok(
      commands.includes('aggrega.registries.update'),
      'the whole-set index build is on no panel',
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
    for (const entry of [...titleBarEntries(), ...rowEntries()]) {
      assert.ok(
        commands.has(entry.command),
        `${entry.command} is bound to a menu the manifest does not contribute a command for`,
      );
    }
  });

  it('puts the operations acting on one registry on a registry row', () => {
    const commands = rowEntries()
      .filter((m) => m.when === REGISTRY_ROW)
      .map((m) => m.command);

    for (const id of [
      'aggrega.registries.updateOne',
      'aggrega.registries.remove',
      'aggrega.registries.logout',
    ]) {
      assert.ok(commands.includes(id), `${id} acts on one registry but is on no row`);
    }
  });

  it('targets a row operation by the value only a registry row carries', () => {
    // This is the assertion that keeps a registry operation off the message
    // rows. Targeting the view instead would put every one of them on "No
    // registries configured." and on the failure row, where pressing one could
    // only invoke it with no subject.
    for (const entry of registryRowEntries()) {
      assert.strictEqual(
        entry.when, REGISTRY_ROW,
        `${entry.command} is bound by "${entry.when}", which reaches rows that name no registry`,
      );
    }
  });

  it('binds the row entries to the value the view actually sets', () => {
    // The manifest's string and the code's constant are one value read from two
    // places; asserting they agree is what keeps a rename from silently
    // unbinding every row operation.
    assert.strictEqual(REGISTRY_ROW_CONTEXT, 'aggrega.registry');
    assert.ok(
      registryRowEntries().length > 0,
      'the panel contributes no row operations at all',
    );
  });

  it('keeps a row operation out of the command palette, where it would have no row', () => {
    // Invoked from the palette a row command receives no row, so it would run
    // with no subject — the invocation that cannot succeed. Hiding it is what
    // makes the row the only way in.
    const hidden = new Set(
      manifest.contributes.menus.commandPalette
        .filter((m) => m.when === 'false')
        .map((m) => m.command),
    );
    for (const id of [
      'aggrega.registries.updateOne',
      'aggrega.registries.remove',
      'aggrega.registries.logout',
    ]) {
      assert.ok(
        hidden.has(id),
        `${id} is offered in the command palette, where it is invoked with no registry`,
      );
    }
  });

  it('leaves a panel-scoped operation in the palette, where it composes its own subject', () => {
    // The counterpart to the rule above: these two need no row. Registering a
    // registry asks for the host, and the whole-set index build takes no
    // argument at all, so both succeed from the palette.
    const hidden = new Set(
      manifest.contributes.menus.commandPalette
        .filter((m) => m.when === 'false')
        .map((m) => m.command),
    );
    assert.ok(!hidden.has('aggrega.registries.add'));
    assert.ok(!hidden.has('aggrega.registries.update'));
  });

  it('registers every command it contributes, so none resolves to nothing when pressed', () => {
    // Contributing a command and never registering a handler for it is the
    // other half of a dead button: the entry draws, and pressing it reports
    // that the command was not found. The manifest cannot see that, so the
    // source that registers them is read here.
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'registries-view.ts'),
      'utf8',
    );
    const contributed = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.registries.'));

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

  it('adds nothing to the operations panel', () => {
    const onOperations = manifest.contributes.menus['view/title']
      .filter((m) => m.when === 'view == aggrega.operations')
      .map((m) => m.command);
    assert.deepStrictEqual(
      onOperations,
      ['aggrega.settings.open'],
      'each panel carries the buttons for its own area',
    );
  });

  it('leaves the registry operations off every other panel', () => {
    const registryCommands = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.registries.'));
    const misplaced = manifest.contributes.menus['view/title']
      .filter((m) => registryCommands.includes(m.command) && m.when !== REGISTRIES_VIEW);
    assert.deepStrictEqual(misplaced, []);
  });
});
