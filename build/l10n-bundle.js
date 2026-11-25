// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// Writes the extension's English message bundle, l10n/bundle.l10n.json, from the
// messages its sources pass to the one lookup, src/l10n.ts.
//
// 🔴 THE BUNDLE IS GENERATED, NEVER KEPT BY HAND. Every message is the first
// argument of an `l10n.t(...)` call in src/, read off the source with the
// TypeScript parser, and nothing else becomes an entry. A bundle kept by hand
// would be a second statement of which messages exist, and would agree with the
// sources only until the first message was reworded; the unit suite regenerates
// it in memory and fails where the committed file differs.
//
// It refuses, naming each site, every shape that would leave a message the
// reader sees without an entry, or an entry for a message no call sends:
//
// - a call whose first argument is not a string literal — a variable, a template
//   with substitutions, a concatenation, or no argument at all;
// - the lookup taken as a value rather than called, which would send messages
//   from a site this reading cannot see;
// - the lookup imported under any other name or shape than
//   `import * as l10n from './l10n'`, which is the one shape read here;
// - the editor's own lookup reached from any module but src/l10n.ts.
//
// The entries are keyed by the message itself, as the editor keys a bundle when
// a call carries no comment, and are written in the order the messages are first
// met: files in path order, calls in source order. A message sent from several
// sites is one entry.
//
// The language map, build/l10n-languages.json, is read here too, so the unit
// suite reaches it through this module: each language the docs site publishes,
// by its site code, to the language id the editor names its files by. The editor
// names a runtime bundle by the language of the language pack it resolved, after
// stripping a region the user's locale carries where no pack matches it whole, so
// one id per site code reaches every locale that pack serves; a site code the
// editor spells differently is mapped explicitly.
//
// 🔴 THE MAP'S KEYS ARE A DELIBERATE COPY of the `published` list in the docs
// site's language file, aggrega-docs/site/src/languages.json. The extension's
// repository carries its own list so that it builds and packages without the
// documentation checked out beside it. The two are held to each other by the unit
// spec "maps exactly the languages the docs site publishes"
// (test/suite/l10n-bundles.test.ts): wherever aggrega-docs is checked out beside
// the extension it fails on a difference and on a file it cannot read, and in a
// checkout of the extension alone it stands down, saying so.
//
// This module is also the one home of where the translation files sit and what
// they are called: the directory is the one the manifest's `l10n` field names, a
// runtime bundle is bundle.l10n[.<id>].json in it, and a manifest translation is
// package.nls[.<id>].json beside package.json. The unit suite reads them through
// the functions below rather than spelling them again.
//
// Run it with `npm run l10n-bundle`; it exits non-zero, writing nothing, on any
// refusal.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const LOOKUP_MODULE_NAME = 'l10n';
const LOOKUP_NAME = 'l10n';
const LANGUAGES_PATH = path.join(__dirname, 'l10n-languages.json');

// L10N_DIR is the directory the manifest's `l10n` field names, which is where the
// editor looks for the runtime bundles.
const L10N_DIR = (() => {
  const declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).l10n;
  if (typeof declared !== 'string' || declared === '') {
    throw new Error('package.json declares no `l10n` directory, so the editor loads no runtime bundle');
  }
  return path.resolve(ROOT, declared);
})();

// bundleFile names a runtime bundle: the English one with no id, a translation
// with the editor's language id.
function bundleFile(id) {
  return id === undefined ? 'bundle.l10n.json' : `bundle.l10n.${id}.json`;
}

// manifestFile names the manifest's text file: the English one with no id, a
// translation with the editor's language id.
function manifestFile(id) {
  return id === undefined ? 'package.nls.json' : `package.nls.${id}.json`;
}

// translationOf reads a file name as a translation: which kind it is and the
// language id it is for, or null where the name is no translation's.
function translationOf(name) {
  for (const [kind, named] of [['bundle', bundleFile], ['manifest', manifestFile]]) {
    const [head, tail] = named('\u0000').split('\u0000');
    if (name.startsWith(head) && name.endsWith(tail) && name.length > head.length + tail.length) {
      return { kind, id: name.slice(head.length, name.length - tail.length) };
    }
  }
  return null;
}

const BUNDLE_PATH = path.join(L10N_DIR, bundleFile());

// sourceFiles lists every TypeScript source under dir, in path order.
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// importsLookup reports whether an import declaration in file names the lookup
// module, lookup being that module's path without its extension.
function importsLookup(file, declaration, lookup) {
  const specifier = declaration.moduleSpecifier;
  if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) { return false; }
  const target = path.resolve(path.dirname(file), specifier.text).replace(/\.(ts|js)$/, '');
  return target === lookup;
}

// collectMessages reads every message the sources under root send to the lookup,
// and every site that sends one this reading cannot list.
function collectMessages(root = ROOT) {
  const sourceDir = path.join(root, 'src');
  const lookup = path.resolve(sourceDir, LOOKUP_MODULE_NAME);
  const messages = [];
  const seen = new Set();
  const refusals = [];
  for (const file of sourceFiles(sourceDir)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const isLookupModule = path.resolve(file).replace(/\.ts$/, '') === lookup;
    const at = (node) => {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${relative}:${line + 1}:${character + 1}`;
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && importsLookup(file, node, lookup)) {
        const clause = node.importClause;
        const bindings = clause && clause.namedBindings;
        const asNamespace = clause && !clause.name && !clause.isTypeOnly && bindings
          && ts.isNamespaceImport(bindings) && bindings.name.text === LOOKUP_NAME;
        if (!asNamespace) {
          refusals.push(`${at(node)}: import the lookup as \`import * as ${LOOKUP_NAME} from './l10n'\`, the one shape the bundle is read from`);
        }
      }
      if (!isLookupModule && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === 'vscode') {
        const bindings = node.importClause && node.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)
          && bindings.elements.some((e) => (e.propertyName || e.name).text === 'l10n')) {
          refusals.push(`${at(node)}: the editor's lookup is reached only from src/l10n.ts; call l10n.t from './l10n'`);
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const owner = node.expression.text;
        const member = node.name.text;
        if (!isLookupModule && member === 'l10n' && owner === 'vscode') {
          refusals.push(`${at(node)}: the editor's lookup is reached only from src/l10n.ts; call l10n.t from './l10n'`);
        }
        if (owner === LOOKUP_NAME && member === 't') {
          const call = node.parent;
          if (!ts.isCallExpression(call) || call.expression !== node) {
            refusals.push(`${at(node)}: l10n.t is taken as a value; call it where the message is written, so the bundle can list the message`);
          } else {
            const first = call.arguments[0];
            if (first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
              if (!seen.has(first.text)) {
                seen.add(first.text);
                messages.push(first.text);
              }
            } else {
              refusals.push(`${at(node)}: the message passed to l10n.t is not a string literal; write the whole message as a literal and pass what varies as a {0} placeholder argument`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { messages, refusals };
}

// renderBundle writes the bundle for messages: each message keyed by itself, two
// spaces of indentation, a closing line ending.
function renderBundle(messages) {
  const bundle = {};
  for (const message of messages) {
    bundle[message] = message;
  }
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

// languages reads the language map: site code to the editor's language id.
function languages() {
  return JSON.parse(fs.readFileSync(LANGUAGES_PATH, 'utf8'));
}

module.exports = {
  BUNDLE_PATH,
  L10N_DIR,
  bundleFile,
  collectMessages,
  languages,
  manifestFile,
  renderBundle,
  translationOf,
};

if (require.main === module) {
  const { messages, refusals } = collectMessages();
  if (refusals.length > 0) {
    for (const refusal of refusals) {
      console.error(refusal);
    }
    console.error(`l10n-bundle: ${refusals.length} message site(s) refused; ${path.relative(ROOT, BUNDLE_PATH)} was not written`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(BUNDLE_PATH), { recursive: true });
  fs.writeFileSync(BUNDLE_PATH, renderBundle(messages));
  console.log(`l10n-bundle: wrote ${messages.length} message(s) to ${path.relative(ROOT, BUNDLE_PATH)}`);
}
