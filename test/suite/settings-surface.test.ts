// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EXTENSION_ID,
  SETTINGS_COMMAND,
  SETTINGS_SCOPE,
  USER_ONLY_SCOPES,
  extensionSettingsQuery,
} from '../../src/settings';

// The manifest is read and parsed rather than pattern-matched. A token census
// over the file answers a question about the text; what is being asserted here
// is a property of the declared properties, and only a parse can see that.
const MANIFEST = path.resolve(__dirname, '../../../package.json');

// PRODUCT_EDITOR_PAGE is the documentation's guide to this extension — the
// manual a reader is sent to from this repository's README. It sits outside
// this repository, so it is reachable when the extension is checked out beside
// the documentation and not when the extension is cloned alone; the assertions
// that read it report themselves pending in the second case rather than
// passing quietly.
const PRODUCT_EDITOR_PAGE = path.resolve(__dirname, '../../../../aggrega-docs/authoring/editor.md');

interface ConfigProperty { scope?: unknown }
interface MenuEntry { command?: unknown; when?: unknown; group?: unknown }
interface CommandEntry { command?: unknown; title?: unknown; icon?: unknown }

function manifest(): {
  properties: Record<string, ConfigProperty>;
  viewTitleMenus: MenuEntry[];
  commands: CommandEntry[];
  publisher: string;
  name: string;
} {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    properties: pkg.contributes.configuration.properties,
    viewTitleMenus: pkg.contributes.menus['view/title'],
    commands: pkg.contributes.commands,
    publisher: pkg.publisher,
    name: pkg.name,
  };
}

describe('one settings surface, holding only user preferences', () => {
  describe('every preference is the reader\'s own', () => {
    // Deliberately NOT "all N are scoped". A count is unfalsifiable a month
    // later because nobody can reconstruct what was counted; the property is
    // what holds however many properties the manifest grows to.
    it('declares a scope on every property under the configuration contribution', () => {
      const { properties } = manifest();
      assert.ok(Object.keys(properties).length > 0, 'the manifest declares no configuration properties at all — the assertion below would pass over an empty set');
      const unscoped = Object.keys(properties).filter(
        (key) => properties[key].scope === undefined,
      );
      assert.deepStrictEqual(
        unscoped,
        [],
        `every extension preference is the reader's own and must declare a scope confining it to their own settings; these declare none, so a repository can pin them for whoever opens it: ${unscoped.join(', ')}`,
      );
    });

    it('confines every property to the reader, never to the project', () => {
      const { properties } = manifest();
      const offending = Object.keys(properties).filter(
        (key) => !(USER_ONLY_SCOPES as readonly unknown[]).includes(properties[key].scope),
      );
      assert.deepStrictEqual(
        offending,
        [],
        `a scope outside ${USER_ONLY_SCOPES.join('/')} is settable per workspace, so a preference about one person's editor would travel with a repository: ${offending.map((k) => `${k}=${String(properties[k].scope)}`).join(', ')}`,
      );
    });

    it('gives every property the same scope, so the surface can be read rather than tested', () => {
      const { properties } = manifest();
      const scopes = [...new Set(Object.keys(properties).map((key) => String(properties[key].scope)))];
      assert.deepStrictEqual(
        scopes,
        [SETTINGS_SCOPE],
        `one dial behaving differently from the rest is a surface whose scope cannot be read from where it sits; found ${scopes.join(', ')}`,
      );
    });
  });

  describe('the cog that reaches them', () => {
    it('sits in the Commands panel title, in the navigation group', () => {
      const { viewTitleMenus } = manifest();
      const entry = viewTitleMenus.find((m) => m.command === SETTINGS_COMMAND);
      assert.ok(entry, `no view/title entry contributes ${SETTINGS_COMMAND}`);
      assert.strictEqual(entry.when, 'view == aggrega.operations');
      // navigation is what puts a title-bar action in the row of icons rather
      // than in the overflow menu, which is the difference between a cog a
      // reader sees and one they have to go looking for.
      assert.strictEqual(entry.group, 'navigation');
    });

    it('is declared as a command, with a cog', () => {
      const { commands } = manifest();
      const declared = commands.find((c) => c.command === SETTINGS_COMMAND);
      assert.ok(declared, `${SETTINGS_COMMAND} appears in a menu but is declared in no command`);
      assert.strictEqual(declared.icon, '$(gear)');
      assert.strictEqual(declared.title, 'Open settings');
    });

    it('is one surface: the cog is not also an operation row', () => {
      const { commands } = manifest();
      assert.ok(
        !SETTINGS_COMMAND.startsWith('aggrega.op.'),
        'the settings entry must not be an operation, or the panel would carry a second door to the same room',
      );
      const duplicates = commands.filter((c) => c.title === 'Open settings');
      assert.strictEqual(duplicates.length, 1, 'exactly one command opens the settings');
    });

    it('narrows the editor\'s settings to one extension', () => {
      assert.strictEqual(extensionSettingsQuery('some.extension'), '@ext:some.extension');
      assert.strictEqual(extensionSettingsQuery(EXTENSION_ID), `@ext:${EXTENSION_ID}`);
    });

    // The identifier is a literal because both the extension lookup and this
    // filter take a composed id and have nothing to compose it from. This is
    // what keeps that literal honest: renaming the publisher or the extension
    // fails here rather than leaving a lookup that finds nothing and a settings
    // page that opens empty — neither of which reports anything at runtime.
    it('addresses this extension by the identity the manifest declares', () => {
      const { publisher, name } = manifest();
      assert.strictEqual(EXTENSION_ID, `${publisher}.${name}`);
    });
  });

  // The settings page a reader is sent to is the editor's, generated from the
  // manifest, so it cannot go stale. The editor guide's table is written by hand
  // and therefore can — it had fallen four settings behind the manifest, silently,
  // because nothing compared the two. This is that comparison. It is a weaker
  // check than it looks: it sees whether a setting is named, never whether what
  // is said about it is still true, and only a reader can judge that.
  describe('the settings the editor guide teaches', () => {
    function documentedSettings(): string[] {
      const guide = fs.readFileSync(PRODUCT_EDITOR_PAGE, 'utf8');
      const afterHeading = guide.split('## Settings')[1];
      assert.ok(afterHeading, 'the editor guide has no Settings section to compare against');
      const table = afterHeading.split('\n## ')[0];
      return [...table.matchAll(/^\|\s*`(aggrega\.[^`]+)`/gm)].map((m) => m[1]);
    }

    it('names every setting the manifest contributes', function () {
      if (!fs.existsSync(PRODUCT_EDITOR_PAGE)) {
        // Checked out without the documentation beside it. Reported as pending
        // rather than passed: a silent skip would read as the guide holding.
        this.skip();
        return;
      }
      const declared = Object.keys(manifest().properties);
      const documented = documentedSettings();
      const missing = declared.filter((key) => !documented.includes(key));
      assert.deepStrictEqual(
        missing,
        [],
        `these settings exist and the editor guide does not mention them, so a reader has no way to find out they are there: ${missing.join(', ')}`,
      );
    });

    it('names no setting the manifest does not contribute', function () {
      if (!fs.existsSync(PRODUCT_EDITOR_PAGE)) {
        this.skip();
        return;
      }
      const declared = Object.keys(manifest().properties);
      const stranded = documentedSettings().filter((key) => !declared.includes(key));
      assert.deepStrictEqual(
        stranded,
        [],
        `the editor guide documents settings that do not exist, so a reader setting one gets no effect and no error: ${stranded.join(', ')}`,
      );
    });
  });
});
