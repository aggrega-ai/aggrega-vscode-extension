// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EXTENSION_ROOT } from './launch-census';

// This helper reads the extension's manifest as the editor draws it, and it is the
// one place a spec does that — and the one place the shape of a text key in the
// manifest is written.
//
// The manifest names each piece of its text — a command's title, a setting's
// description, a view's name — by a key written `%key%`, whose English is held in
// package.nls.json beside it and whose translations are held in
// package.nls.<language>.json. The editor puts the text in place of the key before
// anything reads the manifest. A spec asserting on a title or a description
// therefore reads the manifest with the English in place: that is what an editor
// showing English draws, and what each such assertion is about.
//
// 🔴 A KEY THE ENGLISH DOES NOT HOLD IS AN ERROR HERE, NOT A STRING. The editor
// would draw the key itself, so a spec reading it as text would be asserting on
// something no reader is meant to see.
//
// Its second job is loading the bundle generator for the specs, typed once here,
// because the manifest's translation files are named by that generator.

// BundleGenerator is what the bundle generator, build/l10n-bundle.js, exports: the
// collection of the English bundle, the language map, and the one home of where
// the translation files sit and what they are called.
export interface BundleGenerator {
  BUNDLE_PATH: string;
  L10N_DIR: string;
  bundleFile(id?: string): string;
  manifestFile(id?: string): string;
  translationOf(name: string): { kind: 'bundle' | 'manifest'; id: string } | null;
  collectMessages(root?: string): { messages: string[]; refusals: string[] };
  renderBundle(messages: readonly string[]): string;
  languages(): Record<string, string>;
}

// bundleGenerator is the generator itself, loaded from the build rather than
// re-implemented, so every spec reads the files the build reads and writes.
export const bundleGenerator = require(path.join(EXTENSION_ROOT, 'build', 'l10n-bundle.js')) as BundleGenerator;

const MANIFEST = path.join(EXTENSION_ROOT, 'package.json');
const MANIFEST_ENGLISH = path.join(EXTENSION_ROOT, bundleGenerator.manifestFile());

// MANIFEST_TEXT_KEY is a manifest string standing for a piece of text: the whole
// value is a key between two percent signs, the key spelled as the editor reads
// one.
export const MANIFEST_TEXT_KEY = /^%([\w.-]+)%$/;

// withKeys walks a parsed manifest and answers it with every text key's string
// replaced by what text answers for that key — the one walk both readings below
// make, so the keys listed are exactly the keys replaced.
function withKeys(value: unknown, text: (key: string) => unknown): unknown {
  if (typeof value === 'string') {
    const key = MANIFEST_TEXT_KEY.exec(value);
    return key === null ? value : text(key[1]);
  }
  if (Array.isArray(value)) {
    return value.map((item) => withKeys(item, text));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, withKeys(item, text)]));
  }
  return value;
}

// readRawManifest answers package.json as written, its text keys unreplaced.
export function readRawManifest(): unknown {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

// readManifestEnglish answers package.json's English text by key, or an empty
// set where the manifest keeps no text apart.
export function readManifestEnglish(): Record<string, unknown> {
  return fs.existsSync(MANIFEST_ENGLISH) ? JSON.parse(fs.readFileSync(MANIFEST_ENGLISH, 'utf8')) : {};
}

// manifestTextKeys lists every text key a parsed manifest names, in the order the
// walk meets them.
export function manifestTextKeys(manifest: unknown): string[] {
  const keys: string[] = [];
  withKeys(manifest, (key) => { keys.push(key); return key; });
  return keys;
}

// readManifest answers the manifest with every `%key%` replaced by its English.
// It is typed as loosely as a parse is, because each caller states the shape it
// reads, as it did when it parsed the file itself.
export function readManifest(): any {
  const english = readManifestEnglish();
  return withKeys(readRawManifest(), (key) => {
    if (!Object.prototype.hasOwnProperty.call(english, key)) {
      throw new Error(`package.json names %${key}%, which package.nls.json does not hold`);
    }
    return english[key];
  });
}
