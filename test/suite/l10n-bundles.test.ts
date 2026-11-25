// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as l10n from '../../src/l10n';
import { EXTENSION_ROOT, launchFacilityCount, typeOnlyImports, valueImports } from '../helpers/launch-census';
import { bundleGenerator, manifestTextKeys, readManifestEnglish, readRawManifest } from '../helpers/manifest';

// This file holds the extension's translations to the English they translate.
//
// The English runtime bundle is generated from the sources, so it is compared with
// what the sources generate now. Every translated file — a runtime bundle,
// l10n/bundle.l10n.<id>.json, or a manifest translation, package.nls.<id>.json —
// is compared with its English key for key and placeholder for placeholder. And
// the languages are the docs site's published ones, each through the one map of
// site codes to the editor's language ids.

// The bundle generator, read rather than re-implemented: the comparison below is
// only worth something if it is against what the build itself writes. It is also
// the one home of where the translation files sit and what they are called.
const generator = bundleGenerator;

// DOCS_LANGUAGES is the docs site's own list of the languages it publishes, in the
// aggrega-docs checkout beside the extension where a workspace has one.
const DOCS_LANGUAGES = path.resolve(EXTENSION_ROOT, '..', 'aggrega-docs', 'site', 'src', 'languages.json');

type Messages = Record<string, string>;

function readMessages(file: string): Messages {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Messages;
}

// translationGaps lists every way translated departs from english: a key the
// English has that the translation lacks, a key the translation has that the
// English lacks, and a message whose placeholders are not the English one's.
function translationGaps(english: Messages, translated: Messages): string[] {
  const gaps: string[] = [];
  for (const key of Object.keys(english)) {
    if (!Object.prototype.hasOwnProperty.call(translated, key)) {
      gaps.push(`missing: ${JSON.stringify(key)}`);
    }
  }
  for (const key of Object.keys(translated)) {
    if (!Object.prototype.hasOwnProperty.call(english, key)) {
      gaps.push(`not in the English: ${JSON.stringify(key)}`);
      continue;
    }
    const want = l10n.placeholders(english[key]);
    const got = l10n.placeholders(String(translated[key]));
    if (want.join('\u0000') !== got.join('\u0000')) {
      gaps.push(`placeholders ${JSON.stringify(got)}, not ${JSON.stringify(want)}: ${JSON.stringify(key)}`);
    }
  }
  return gaps;
}

// TranslatedFile is one translation in the tree: its path, the language id its
// name carries, and the English it translates.
interface TranslatedFile {
  file: string;
  id: string;
  english: string;
}

// translatedFiles lists every translation in the tree, runtime and manifest alike:
// the runtime bundles in the directory the manifest names, the manifest's own
// beside package.json.
function translatedFiles(): TranslatedFile[] {
  const found: TranslatedFile[] = [];
  const bundles = fs.existsSync(generator.L10N_DIR) ? fs.readdirSync(generator.L10N_DIR) : [];
  for (const name of bundles.sort()) {
    const translation = generator.translationOf(name);
    if (translation?.kind === 'bundle') {
      found.push({ file: path.join(generator.L10N_DIR, name), id: translation.id, english: generator.BUNDLE_PATH });
    }
  }
  for (const name of fs.readdirSync(EXTENSION_ROOT).sort()) {
    const translation = generator.translationOf(name);
    if (translation?.kind === 'manifest') {
      found.push({
        file: path.join(EXTENSION_ROOT, name),
        id: translation.id,
        english: path.join(EXTENSION_ROOT, generator.manifestFile()),
      });
    }
  }
  return found;
}

describe('the extension speaks the docs site\'s languages', () => {
  it('commits the English bundle the sources generate, and every message is a literal the bundle can list', () => {
    // 🔴 PLANTED DEFECT: add an l10n.t('…') call to a source, or reword one, without
    // running `npm run l10n-bundle`, and this reddens on the drift; pass l10n.t a
    // variable and it reddens on the refusal naming the site.
    const { messages, refusals } = generator.collectMessages();
    assert.deepStrictEqual(refusals, [], 'a message site the bundle cannot list');
    assert.ok(messages.includes('Show output'), 'the generator found none of the messages the sources send');
    assert.strictEqual(
      fs.readFileSync(generator.BUNDLE_PATH, 'utf8'),
      generator.renderBundle(messages),
      `${path.relative(EXTENSION_ROOT, generator.BUNDLE_PATH)} is not what the sources generate; run \`npm run l10n-bundle\``,
    );
  });

  it('names a connection in every message in the one order the compiler\'s refusals use', () => {
    // Every sentence naming a connection writes the alias, the socket and the node
    // inside its own message, in the order the compiler's own refusals name them:
    // "the connection {alias} through socket {socket} of {node}". The sentences sit
    // in several modules, so the order is held here, over every message the
    // sources send, rather than by a list of those modules kept in a comment.
    // 🔴 PLANTED DEFECT: write "through socket {1} of {2} the connection {0}" in
    // any message, or drop "of {2}" from one, and this reddens naming it.
    const { messages } = generator.collectMessages();
    const naming = messages.filter((message) => message.includes('through socket'));
    assert.ok(naming.length > 0, 'no message names a connection, so the reading below measures nothing');
    const form = /[Tt]he connection \{\d+\} through socket \{\d+\} of \{\d+\}/g;
    const departing = naming.filter((message) =>
      (message.match(form) ?? []).length !== message.split('through socket').length - 1);
    assert.deepStrictEqual(departing, [], 'a message names a connection in another order or shape');
  });

  it('lets the lookup reach the editor through one load of the editor module, and reach nothing else', () => {
    // 🔴 THE CENSUSES THAT ADMIT TEXT_LOOKUP BY NAME REST ON THIS, AND THIS IS THE
    // ONE PLACE IT IS CHECKED. A module held to
    // reaching neither a process nor the editor may still import the lookup,
    // because the lookup's one reach is the editor's translations: no module of
    // the extension at run time, the editor's declarations alone by import, and one
    // load of the editor module, made where the lookup looks for the translations.
    // PLANTED DEFECT: add any `require(…)` or value import to src/l10n.ts and this
    // reddens.
    assert.deepStrictEqual(valueImports('src/l10n.ts'), []);
    assert.deepStrictEqual(typeOnlyImports('src/l10n.ts'), ['vscode']);
    assert.strictEqual(launchFacilityCount('src/l10n.ts'), 0);
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'l10n.ts'), 'utf8');
    const loads = [...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.deepStrictEqual(loads, ["'vscode'"]);
  });

  it('refuses every message site whose message the bundle could not list', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-bundle-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src', 'l10n.ts'), 'export function t(m: string): string { return m; }\n');
      fs.writeFileSync(path.join(root, 'src', 'ok.ts'), [
        "import * as l10n from './l10n';",
        "export const A = l10n.t('first {0}', 1);",
        'export const B = l10n.t(`second`);',
        "export const C = l10n.t('first {0}', 2);",
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(root, 'src', 'refused.ts'), [
        "import * as l10n from './l10n';",
        "import { t } from './l10n';",
        "import * as vscode from 'vscode';",
        'const name = "x";',
        'export const D = l10n.t(name);',
        "export const E = l10n.t('a' + name);",
        'export const F = l10n.t(`a ${name}`);',
        'export const G = l10n.t;',
        "export const H = vscode.l10n.t('direct');",
        "export const I = t('named');",
        '',
      ].join('\n'));
      const { messages, refusals } = generator.collectMessages(root);
      assert.deepStrictEqual(messages, ['first {0}', 'second']);
      const at = refusals.map((r) => r.split(':').slice(0, 2).join(':'));
      assert.deepStrictEqual(at, [
        'src/refused.ts:2',
        'src/refused.ts:5',
        'src/refused.ts:6',
        'src/refused.ts:7',
        'src/refused.ts:8',
        'src/refused.ts:9',
      ], refusals.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds every gap a translation can have against its English', () => {
    // The comparison every translated file goes through, shown failing on a
    // planted file so a green run over the real ones is a comparison that could
    // have failed.
    const english = { 'Show output': 'Show output', '{0} did not complete: {1}': '{0} did not complete: {1}' };
    assert.deepStrictEqual(translationGaps(english, {
      '{0} did not complete: {1}': '{1} — {0} non è terminato',
      'Extra': 'In più',
    }), [
      'missing: "Show output"',
      'not in the English: "Extra"',
    ]);
    assert.deepStrictEqual(translationGaps(english, {
      'Show output': 'Mostra output',
      '{0} did not complete: {1}': '{0} non è terminato',
    }), ['placeholders ["0"], not ["0","1"]: "{0} did not complete: {1}"']);
    assert.deepStrictEqual(translationGaps(english, {
      'Show output': 'Mostra output',
      '{0} did not complete: {1}': '{1}: {0} non è terminato',
    }), []);
  });

  it('holds every translated file to its English, key for key and placeholder for placeholder', () => {
    // 🔴 PLANTED DEFECT: copy l10n/bundle.l10n.json to l10n/bundle.l10n.it.json and
    // delete one entry, and this reddens naming the file and the missing message.
    const languages = generator.languages();
    const ids = new Set(Object.values(languages));
    for (const translated of translatedFiles()) {
      assert.ok(ids.has(translated.id),
        `${path.basename(translated.file)} is for ${translated.id}, which the language map does not name`);
      assert.ok(fs.existsSync(translated.english),
        `${path.basename(translated.file)} translates ${path.basename(translated.english)}, which does not exist`);
      assert.deepStrictEqual(
        translationGaps(readMessages(translated.english), readMessages(translated.file)),
        [],
        `${path.relative(EXTENSION_ROOT, translated.file)} departs from its English`,
      );
    }
  });

  it('gives every language of the map its files, once any translation exists', () => {
    // 🔴 THE RULE: while no translation exists at all, a language without files is
    // not yet a gap — the English is all there is. Once ANY translated file exists,
    // every language the map names has a runtime bundle, and a manifest translation
    // wherever the manifest's English is held in package.nls.json, so no language
    // is shipped half done.
    const languages = generator.languages();
    const present = translatedFiles();
    if (present.length === 0) {
      return;
    }
    const manifestEnglish = fs.existsSync(path.join(EXTENSION_ROOT, generator.manifestFile()));
    const missing: string[] = [];
    for (const [site, id] of Object.entries(languages)) {
      const bundle = path.join(generator.L10N_DIR, generator.bundleFile(id));
      if (!fs.existsSync(bundle)) {
        missing.push(`${site}: ${path.relative(EXTENSION_ROOT, bundle)}`);
      }
      if (manifestEnglish && !fs.existsSync(path.join(EXTENSION_ROOT, generator.manifestFile(id)))) {
        missing.push(`${site}: ${generator.manifestFile(id)}`);
      }
    }
    assert.deepStrictEqual(missing, [], 'a published language with no translation');
  });

  it('maps each site code to one lower-case editor id', () => {
    const languages = generator.languages();
    const ids = Object.values(languages);
    assert.ok(ids.length > 0, 'the language map is empty');
    assert.deepStrictEqual(ids.filter((id) => id !== id.toLowerCase()), [], 'the editor names its languages in lower case');
    assert.strictEqual(new Set(ids).size, ids.length, 'two site codes map to one editor id');
  });

  it('maps exactly the languages the docs site publishes', function () {
    // Wherever aggrega-docs is checked out beside the extension this compares the map's
    // keys with the docs site's list, and a list that cannot be read or parsed fails the
    // spec; in a checkout of the extension alone there is nothing to compare with, and
    // the spec says so and stands down.
    // 🔴 AN UNREADABLE LANGUAGE LIST FAILS HERE WHERE aggrega-docs EXISTS; IT DOES NOT STAND THE SPEC DOWN.
    // PLANTED DEFECT: drop "vi" from build/l10n-languages.json and this reddens on
    // the set.
    const docsDir = path.resolve(EXTENSION_ROOT, '..', 'aggrega-docs');
    if (!fs.existsSync(docsDir)) {
      // eslint-disable-next-line no-console
      console.log(
        `[docs languages] SKIPPING: the extension is checked out without aggrega-docs beside it, `
        + `so the language map is not compared with the docs site's list in this run`,
      );
      this.skip();
    }
    let raw: string;
    try {
      raw = fs.readFileSync(DOCS_LANGUAGES, 'utf8');
    } catch (err) {
      throw new Error(`the docs site's languages are unreadable at ${DOCS_LANGUAGES} (${String(err)}).`);
    }
    const published = (JSON.parse(raw) as { published: Array<{ lang: string }> }).published.map((l) => l.lang);
    assert.ok(published.length > 0, 'the docs site publishes no language');
    assert.deepStrictEqual(Object.keys(generator.languages()).sort(), [...published].sort());
  });

  it('declares the runtime bundles to the editor, and names in the manifest only text its English holds', () => {
    // The generator throws on load where the manifest declares no `l10n`
    // directory, so reaching here means one is declared; what is asserted is that
    // the English bundle is in it, where the editor looks.
    assert.strictEqual(path.dirname(generator.BUNDLE_PATH), generator.L10N_DIR);
    assert.ok(fs.existsSync(generator.BUNDLE_PATH), 'the directory the manifest names holds no English bundle');
    const references = manifestTextKeys(readRawManifest());
    const english = readManifestEnglish();
    assert.deepStrictEqual(
      references.filter((key) => !Object.prototype.hasOwnProperty.call(english, key)),
      [],
      'a %key% the manifest names that package.nls.json does not hold',
    );
    assert.deepStrictEqual(
      Object.keys(english).filter((key) => !references.includes(key)),
      [],
      'a package.nls.json entry the manifest never names',
    );
  });
});
