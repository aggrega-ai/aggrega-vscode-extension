// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS_TITLE_BAR_ENTRIES, commandsPanelTitleBar } from '../helpers/title-bar';
import { PANEL_ACTIONS, commandIdFor, commandsPanelOperations } from '../../src/operation-groups';
import { REGISTRY_ROW_CONTEXT } from '../../src/registries-run';
import {
  EXTENSION_ROOT,
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';

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

  it('leaves the refresh alone in the title bar, the operations being rows at the head of the list', () => {
    // A title-bar entry is a hover-revealed unlabelled icon, which reads as a
    // different surface from a labelled control — so every operation acting on
    // the whole panel is a labelled row at the head of its list instead, and the
    // title bar carries only what belongs to the view.
    assert.deepStrictEqual(
      titleBarEntries().map((m) => m.command),
      ['aggrega.registries.refresh'],
      'an operation is still a hover-revealed icon in this panel\'s title bar',
    );
  });

  it('draws both whole-set operations at the head of this panel, and on no other surface', () => {
    // Present at the head of this panel and absent from the Commands panel, so
    // neither operation is merely gone and neither has two places a reader
    // could look. Read from the operation surface, which is the one description
    // of where each is drawn.
    const headed = PANEL_ACTIONS.registries.map(commandIdFor);
    assert.deepStrictEqual(
      headed,
      ['aggrega.registries.add', 'aggrega.registries.update'],
      'a reader can see their registries and cannot add one, or cannot update their index',
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
    const src = path.join(__dirname, '..', '..', '..', 'src');
    const source = fs.readFileSync(path.join(src, 'registries-view.ts'), 'utf8');
    // 🔴 A COMMAND NAMED BY MORE THAN ONE SURFACE IS REGISTERED THROUGH A
    // CONSTANT, AND THAT CONSTANT IS DECLARED WHERE THE OPERATION LIVES RATHER
    // THAN IN THIS VIEW — so its declaration is looked for across the sources
    // while the registration is still required to be in the view. Matching only
    // the literal spelling would report a missing handler for a command that is
    // registered, which is the reading that would send somebody to "fix" a
    // single-sourced id back into two copies.
    const idOfConstant = new Map(
      fs.readdirSync(src)
        .filter((name) => name.endsWith('.ts'))
        .flatMap((name) => Array.from(
          fs.readFileSync(path.join(src, name), 'utf8')
            .matchAll(/export const ([A-Z][A-Z0-9_]*) = '(aggrega\.[^']+)'/g),
        ))
        .map((m) => [m[2], m[1]] as const),
    );
    const contributed = manifest.contributes.commands
      .map((c) => c.command)
      .filter((c) => c.startsWith('aggrega.registries.'));

    assert.ok(contributed.length > 0, 'the panel contributes no commands at all');
    // A control on the constant arm: it resolves the declaration of an id this
    // panel does contribute, so a miss below is a missing registration rather
    // than a lookup that finds nothing whatever the sources say.
    assert.ok(
      contributed.some((id) => idOfConstant.has(id)),
      'no contributed registry command resolves to a declared constant, so the constant arm of this '
      + 'census matches nothing and a command registered through one would read as unregistered',
    );
    for (const id of contributed) {
      // The identifier sits on its own line for the longer registrations, so
      // the match spans whitespace rather than assuming one formatting.
      const literal = `'${id.replace(/\./g, '\\.')}'`;
      const constant = idOfConstant.get(id);
      const spelling = constant === undefined ? literal : `(?:${literal}|${constant}\\s*,)`;
      const registered = new RegExp(`registerCommand\\(\\s*${spelling}`);
      assert.ok(
        registered.test(source),
        `${id} is contributed but never registered, so pressing it finds no command`,
      );
    }
  });

  it('adds nothing to the Commands panel\'s title bar', () => {
    // Its operations are rows at the head of its own list, not title-bar entries
    // anywhere — so that title bar carries only what belongs to that view.
    assert.deepStrictEqual(
      commandsPanelTitleBar(manifest.contributes.menus['view/title']),
      [...COMMANDS_TITLE_BAR_ENTRIES],
      'the title bar carries what belongs to the view, and the flow carries the operations',
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

// --- one execution path per operation ------------------------------------

describe('the registries panel and the catalog search reach the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL. A pattern that has stopped matching reports every
    // module clean, so without this the absences below would pass vacuously. The
    // control is a module the extension deliberately still launches from, so it
    // moves independently of the subjects.
    assertCensusInstrumentFires(assert.ok);
  });

  it('gives neither reading module any way to start a process', () => {
    // The two modules that decide what a listing and a search MEAN hold no launch
    // at all, so the facility is absent rather than merely unused.
    for (const module of ['src/registries-run.ts', 'src/catalog-search-run.ts']) {
      assert.strictEqual(launchFacilityCount(module), 0, module);
    }
  });

  it('gives neither panel module any way to start a process', () => {
    // The registries tree still runs one command — the index refresh, which is
    // the one registry operation that reaches the registries themselves and the
    // one whose run can be stopped — and it goes through the shared invocation
    // helper rather than through a launch of this module's own.
    for (const module of ['src/registries-view.ts', 'src/catalog-views.ts']) {
      assert.strictEqual(launchFacilityCount(module), 0, module);
    }
  });

  it('gives the module that decides the three registry changes no way to reach a process', () => {
    // 🔴 THE STRONGER CLAIM, AND IT NEEDS THE IMPORT LIST RATHER THAN THE LAUNCH
    // PATTERN. A module holding no spawn of its own can still reach one through a
    // helper. Read as the WHOLE import list, so a module added to it has to be
    // looked at — including one that could start a process and one that would
    // carry the editor in, which is what keeps these decisions readable without a
    // host.
    // 🔴 THE VALUE LIST, WHICH IS WHAT THE CLAIM IS ABOUT. The wire shapes come
    // from the published contract rather than being restated here, and they come
    // as declarations alone — erased before anything runs, so the module reaches
    // no code through them. Asserted separately below, because a reading that
    // folded the two together would let a later change from one kind to the other
    // pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/registry-configure.ts'),
      [
        './config-change-watch',
        './config-write-scope',
        './error-surfaces',
        './operation-groups',
        './operation-outcome',
        './registration-outcome',
      ],
    );
    assert.deepStrictEqual(typeOnlyImports('src/registry-configure.ts'), [WIRE_CONTRACT]);
    assert.strictEqual(launchFacilityCount('src/registry-configure.ts'), 0);
    // The module that says whether a write is in effect is on the same side of
    // the claim, so it is measured too: it names the editor nowhere and starts
    // nothing, and the one module it reaches for a declaration is erased. The one
    // module it reaches for code renders a thrown value as a line, and it is held
    // here to reaching nothing at runtime itself, so the claim stays whole.
    assert.deepStrictEqual(valueImports('src/config-change-watch.ts'), ['./error-text', 'path']);
    assert.deepStrictEqual(typeOnlyImports('src/config-change-watch.ts'), ['./binary-restart']);
    assert.strictEqual(launchFacilityCount('src/config-change-watch.ts'), 0);
    assert.deepStrictEqual(valueImports('src/error-text.ts'), []);
    assert.strictEqual(launchFacilityCount('src/error-text.ts'), 0);
  });

  it('reaches no process-launching helper from the module that owns the search', () => {
    // The stronger claim, which a launch census over one module cannot make: a
    // module holding no spawn can still reach one through a helper. Read as the
    // whole import list, so a module added to it has to be looked at — including
    // one that could start a process and one that would carry the editor in,
    // which is what keeps the search decision readable without a host.
    // The value list is what the claim is about; the wire shapes arrive as
    // declarations alone and are asserted separately, so a later change from one
    // kind to the other cannot pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/catalog-search-run.ts'),
      ['./error-surfaces', './operation-groups', './registries-run', './uri-display', './workspace'],
    );
    assert.deepStrictEqual(typeOnlyImports('src/catalog-search-run.ts'), [WIRE_CONTRACT]);
  });

  it('reaches no process-launching helper from the module that owns the listing', () => {
    assert.deepStrictEqual(
      valueImports('src/registries-run.ts'),
      ['./error-surfaces', './workspace', './workspace-catalog-run'],
    );
    assert.deepStrictEqual(typeOnlyImports('src/registries-run.ts'), ['./panel-actions', WIRE_CONTRACT]);
    // The listing draws the Catalog panel's row for a language server that is not
    // running, so the module composing that row is on the same side of the claim,
    // and so is the one it takes the row's words from: neither starts a process,
    // and neither reaches the client that does.
    for (const module of ['src/workspace-catalog-run.ts', 'src/daemon-status.ts']) {
      assert.strictEqual(launchFacilityCount(module), 0, module);
      assert.ok(!valueImports(module).includes('./daemon'), `${module} reaches the language-server client`);
    }
  });

  it('🔴 THE SURVIVING LAUNCH HELPER HAS EXACTLY ONE CONSUMER, AND IT IS DELIBERATE', () => {
    // A COUNT rather than a presence, and over the whole source tree rather than
    // over a module: the claim is that ONE execution path is left per operation,
    // and a second consumer appearing anywhere would be a second path for
    // something.
    //
    // The one that remains survives for a stated reason rather than by omission:
    // the compiler does not serve it over the request surface, because its
    // subject is the toolchain rather than a workspace.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const importers = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /from\s+'\.\/cli-json'/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(
      importers,
      ['plugins-view.ts'],
      'the structured-run helper gained or lost a consumer; each one is a process launch and '
      + 'each needs a stated reason to exist',
    );
  });
});
