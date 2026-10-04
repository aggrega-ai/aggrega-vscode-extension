// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BUILD_ON_INSPECT_KEY,
  BUILD_ON_INSPECT_MENU_LABEL,
  DEFAULT_SETTINGS,
  SERVER_CONFIG_SECTION,
  buildOnInspectConfirmation,
  buildOnInspectMenuDescription,
  settingsFromObject,
} from '../../src/settings';
import { buildServeArgs } from '../../src/daemon';

// The manifest is read and parsed rather than pattern-matched, so what is
// asserted is a property of the declared settings and commands.
const MANIFEST = path.resolve(__dirname, '../../../package.json');

// The command line's own source for `aggrega serve`, whose flag help is where the
// setting's description takes its qualifier from. A checkout without the compiler
// beside it reports the spec reading it as pending rather than passed.
const SERVE_COMMAND_SOURCE = path.resolve(__dirname, '../../../../aggrega-cli/cmd/aggrega/serve.go');

interface ManifestProperty { description?: unknown; markdownDescription?: unknown }

function manifest(): { properties: Record<string, ManifestProperty>; commands: { command?: unknown; title?: unknown }[] } {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return { properties: pkg.contributes.configuration.properties, commands: pkg.contributes.commands };
}

// SETTING_LINK is how a Markdown setting description names another setting: the
// setting's id between `#` marks inside backticks, which the settings screen draws
// as a link reading the name the screen gives that setting.
const SETTING_LINK = /`#([^#\s`]+)#`/g;

// sentencesOf splits a description into its sentences, each ending at its full
// stop, so one can be matched whole rather than as a fragment of another.
function sentencesOf(text: string): string[] {
  return text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s !== '');
}

describe('settings', () => {
  it('exposes the documented defaults', () => {
    assert.strictEqual(DEFAULT_SETTINGS.binaryPath, 'aggrega');
    assert.strictEqual(DEFAULT_SETTINGS.buildOnInspect, false);
    assert.strictEqual(DEFAULT_SETTINGS.debounceMs, 300);
    assert.strictEqual(DEFAULT_SETTINGS.respawnAttempts, 5);
    assert.strictEqual(DEFAULT_SETTINGS.respawnWindowSeconds, 180);
    assert.strictEqual(DEFAULT_SETTINGS.restartGraceSeconds, 5);
    assert.strictEqual(DEFAULT_SETTINGS.toastDebounceMode, 'time');
    assert.strictEqual(DEFAULT_SETTINGS.toastThrottleSeconds, 300);
  });

  it('settingsFromObject overlays the new debounce + restart-grace fields onto defaults', () => {
    const s = settingsFromObject({
      restartGraceSeconds: 10,
      toastDebounceMode: 'session',
      toastThrottleSeconds: 60,
    });
    assert.strictEqual(s.restartGraceSeconds, 10);
    assert.strictEqual(s.toastDebounceMode, 'session');
    assert.strictEqual(s.toastThrottleSeconds, 60);
    assert.strictEqual(s.binaryPath, DEFAULT_SETTINGS.binaryPath);
  });

  it('settingsFromObject overlays values onto defaults', () => {
    const s = settingsFromObject({ debounceMs: 750, buildOnInspect: true });
    assert.strictEqual(s.debounceMs, 750);
    assert.strictEqual(s.buildOnInspect, true);
    assert.strictEqual(s.binaryPath, DEFAULT_SETTINGS.binaryPath);
    assert.strictEqual(s.respawnAttempts, DEFAULT_SETTINGS.respawnAttempts);
  });

  it('settingsFromObject returns a fresh object', () => {
    const s = settingsFromObject({});
    s.debounceMs = 999;
    assert.strictEqual(DEFAULT_SETTINGS.debounceMs, 300);
  });

  describe('buildServeArgs', () => {
    it('omits --build-on-inspect by default (dial off)', () => {
      const args = buildServeArgs(settingsFromObject({}));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('omits --build-on-inspect when buildOnInspect is false', () => {
      const args = buildServeArgs(settingsFromObject({ buildOnInspect: false }));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('appends --build-on-inspect only when buildOnInspect is true', () => {
      const args = buildServeArgs(settingsFromObject({ buildOnInspect: true }));
      assert.deepStrictEqual(args, ['serve', '--build-on-inspect']);
    });

    // The flag the daemon rejects must never be reachable. A settings object is
    // the only thing buildServeArgs reads, so an object carrying the superseded
    // key and nothing else is exactly the shape a fallback read would resurrect
    // the flag from.
    it('never emits a flag the daemon does not accept', () => {
      const withSupersededKey = settingsFromObject(
        { renderDiagnostics: true } as unknown as Partial<typeof DEFAULT_SETTINGS>,
      );
      const args = buildServeArgs(withSupersededKey);
      assert.deepStrictEqual(args, ['serve']);
      assert.ok(
        !args.some(a => a === '--render-diagnostics'),
        'the superseded flag must not reach the daemon argv',
      );
    });

    // Both spawn shapes, asserted as whole arrays so an extra argument fails
    // rather than passing a substring check.
    it('produces exactly one of two argv shapes', () => {
      assert.deepStrictEqual(
        buildServeArgs(settingsFromObject({ buildOnInspect: false })),
        ['serve'],
      );
      assert.deepStrictEqual(
        buildServeArgs(settingsFromObject({ buildOnInspect: true })),
        ['serve', '--build-on-inspect'],
      );
    });
  });

  describe('the setting the toggle writes', () => {
    it('names one section and one key, shared by the reader and the writer', () => {
      assert.strictEqual(SERVER_CONFIG_SECTION, 'aggrega.server');
      assert.strictEqual(BUILD_ON_INSPECT_KEY, 'buildOnInspect');
    });
  });

  describe('what the toggle shows the user', () => {
    it('keeps one menu label across both states so the menu dispatches on it', () => {
      assert.strictEqual(BUILD_ON_INSPECT_MENU_LABEL, 'Run the artifact-rendering stage while inspecting');
    });

    it('says which way selecting the entry would flip the setting', () => {
      assert.strictEqual(buildOnInspectMenuDescription(false), 'Currently off — turn it on');
      assert.strictEqual(buildOnInspectMenuDescription(true), 'Currently on — turn it off');
      assert.notStrictEqual(
        buildOnInspectMenuDescription(true),
        buildOnInspectMenuDescription(false),
      );
    });

    // By EQUALITY on the whole sentence, so a term changed, the outcome dropped or
    // the restart consequence lost each changes the comparison.
    it('states the outcome, in the setting\'s own terms, and that a restart applies it', () => {
      assert.strictEqual(
        buildOnInspectConfirmation(true),
        'Aggrega: the artifact-rendering stage will run while inspecting a graph. The language server reads this setting when it starts, so restart it to apply the change.',
      );
      assert.strictEqual(
        buildOnInspectConfirmation(false),
        'Aggrega: the artifact-rendering stage will not run while inspecting a graph. The language server reads this setting when it starts, so restart it to apply the change.',
      );
    });
  });

  // 🔴 THE SETTING ADDS THE RENDERING STAGE'S ADVISORIES AND NONE OF THE CHECKS A
  // BUILD HALTS ON, and every surface naming it says so in the command line's own
  // terms. A reader who turns it on to see in the editor what a build would refuse
  // is told on the settings screen that it does not. The title and the
  // description are declarative manifest text, so nothing composes them from the
  // term the source holds; these hold them to it by equality instead.
  describe('what the setting says it adds', () => {
    it('titles the toggle command with the term the menu and the confirmation use', () => {
      const command = manifest().commands.find((c) => c.command === 'aggrega.server.toggleBuildOnInspect');
      assert.ok(command !== undefined, 'the manifest declares no toggle command');
      assert.strictEqual(command.title, 'Aggrega: Toggle the artifact-rendering stage while inspecting');
    });

    it('describes the setting in the command line\'s words, as a Markdown description drawing its code as code', () => {
      const property = manifest().properties['aggrega.server.buildOnInspect'];
      assert.strictEqual(property.description, undefined, 'the setting carries a plain description, which draws its code\'s backticks literally');
      assert.strictEqual(
        property.markdownDescription,
        'When true, the language server runs the artifact-rendering stage while inspecting an IR graph, so the advisories `aggrega build` raises while rendering also appear as editor problems. It adds none of the checks a build halts on. Inspecting a graph costs more when that stage runs than when it does not. Nothing is written to disk: no rendered artifacts, no output directory, no lockfile. Off by default, matching `aggrega inspect`, which raises no such advisory either. When true, the extension passes `--build-on-inspect` to `aggrega serve`.',
      );
    });

    it('carries the command line\'s qualifier as a sentence of its own, word for word as the flag help says it', function () {
      const qualifier = 'It adds none of the checks a build halts on.';
      const description = String(manifest().properties['aggrega.server.buildOnInspect'].markdownDescription ?? '');
      assert.ok(
        sentencesOf(description).includes(qualifier),
        `the setting's description does not say, as a sentence of its own, "${qualifier}"`,
      );
      if (!fs.existsSync(SERVE_COMMAND_SOURCE)) {
        this.skip();
        return;
      }
      // The help is one Go string written across concatenated literals, so the
      // joins are taken out before its sentences are read.
      const help = fs.readFileSync(SERVE_COMMAND_SOURCE, 'utf8').replace(/"\s*\+\s*"/g, '');
      assert.ok(
        sentencesOf(help).includes(qualifier),
        `the command line's help for --build-on-inspect no longer says "${qualifier}", so the setting's description quotes a sentence the compiler does not`,
      );
    });
  });

  // 🔴 A PLAIN DESCRIPTION DRAWS ITS BACKTICKS AS THEY ARE TYPED, AND A SETTING'S
  // ID IS NOT WHAT THE SETTINGS SCREEN CALLS IT. So a description showing code is
  // declared as a Markdown description, which draws it as code, and one naming
  // another setting names it by the editor's own link, which draws the name the
  // screen gives that setting and leads to it.
  describe('how the settings descriptions draw code and name each other', () => {
    it('declares no plain description carrying code, and none in two forms', () => {
      const { properties } = manifest();
      assert.ok(Object.keys(properties).length > 0, 'the manifest declares no settings, so the assertions below would pass over an empty set');
      const plainWithCode = Object.keys(properties).filter((key) => typeof properties[key].description === 'string' && String(properties[key].description).includes('`'));
      assert.deepStrictEqual(plainWithCode, [], `these settings draw their code's backticks literally: ${plainWithCode.join(', ')}`);
      const twoForms = Object.keys(properties).filter((key) => properties[key].description !== undefined && properties[key].markdownDescription !== undefined);
      assert.deepStrictEqual(twoForms, [], `these settings carry a description in two forms, two homes for one text: ${twoForms.join(', ')}`);
    });

    it('names another setting only by the editor\'s link to it, and links only to a setting that exists', () => {
      const { properties } = manifest();
      const keys = Object.keys(properties);
      // A setting is named by its whole id, or by its last segment where that is
      // an identifier rather than a word — a camel-case segment no sentence uses.
      const namesOf = (key: string): string[] => {
        const leaf = key.split('.').pop() ?? key;
        return /[A-Z]/.test(leaf) ? [key, leaf] : [key];
      };
      const unlinked: string[] = [];
      const dead: string[] = [];
      let links = 0;
      for (const key of keys) {
        const text = String(properties[key].markdownDescription ?? properties[key].description ?? '');
        for (const m of text.matchAll(SETTING_LINK)) {
          links += 1;
          if (!keys.includes(m[1])) { dead.push(`${key} → ${m[1]}`); }
        }
        const unlinkedText = text.replace(SETTING_LINK, '');
        for (const other of keys.filter((k) => k !== key)) {
          for (const name of namesOf(other)) {
            if (new RegExp(`(^|[^A-Za-z0-9.])${name.replace(/\./g, '\\.')}([^A-Za-z0-9]|$)`).test(unlinkedText)) { unlinked.push(`${key} names ${name}`); }
          }
        }
      }
      // The control: the readings above found links to read, so their silence
      // about a dead or missing link is about links that were there.
      assert.ok(links > 0, 'no description links to another setting, so the readings above read no link');
      assert.deepStrictEqual(unlinked, [], `these descriptions name another setting by its id rather than by the editor's link: ${unlinked.join('; ')}`);
      assert.deepStrictEqual(dead, [], `these descriptions link to a setting the manifest does not declare: ${dead.join('; ')}`);
    });

    it('links the restart grace to the binary path it waits on', () => {
      const text = String(manifest().properties['aggrega.server.restartGraceSeconds'].markdownDescription ?? '');
      assert.deepStrictEqual([...text.matchAll(SETTING_LINK)].map((m) => m[1]), ['aggrega.server.binaryPath']);
    });
  });
});
