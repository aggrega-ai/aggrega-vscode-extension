// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { EXTENSION_ROOT } from './launch-census';

// This helper is the one home of the two censuses that keep the welcome page's
// extension version honest: that the extension reads the build's provenance from
// the compiler's recipe and never derives it itself, and that no module reads the
// manifest's version in its place.
//
// 🔴 THE PATTERNS LIVE HERE AND ONLY HERE, AND NO FILE IS LEFT OUT OF THE
// PROVENANCE CENSUS — THIS ONE AND THE SPECS THAT CALL IT INCLUDED. The pattern
// below is spelled so that its own text does not match it, and the specs hold the
// command apart from its questions for the same reason, so the census needs no
// exception for the files that measure it.

// gitProvenanceReading matches a line that asks git about the tree the way the
// compiler's build-provenance recipe does: the command and either of the two
// questions the recipe asks, anywhere later on the same line. The same-line
// reach is what catches the shape a process launch takes — the command as one
// argument and the question as the next — as well as a shell line.
//
// It is built fresh per call, for the reason every pattern in these helpers is:
// a global expression carries a lastIndex, and a shared one makes a reading
// depend on the order the specs happened to run in.
export function gitProvenanceReading(): RegExp {
  return /\bgit\b.*?\b(?:describe|rev-parse)\b/;
}

// listFiles lists every file under one directory of the extension, recursively
// and in a fixed order, as paths relative to the extension root.
function listFiles(relativeDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(path.join(EXTENSION_ROOT, dir), { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relative);
      } else if (entry.isFile()) {
        out.push(relative);
      }
    }
  };
  walk(relativeDir);
  return out;
}

// extensionOwnSources reads every file the extension authors that could carry a
// build step or a reading of its own — the source modules, the build scripts, the
// packaging and publishing scripts, the workflows that run them, everything under
// the tests, and the manifest whose scripts run the compile — as [file, text]
// pairs.
export function extensionOwnSources(): Array<readonly [string, string]> {
  const files = [
    ...listFiles('src'),
    ...listFiles('build'),
    ...listFiles('scripts'),
    ...listFiles('.github'),
    ...listFiles('test'),
    'package.json',
  ];
  return files.map((file) => [file, fs.readFileSync(path.join(EXTENSION_ROOT, file), 'utf8')] as const);
}

// gitProvenanceReadings reports every line in a corpus that asks git about the
// tree, as "file:line" entries in corpus order.
export function gitProvenanceReadings(corpus: ReadonlyArray<readonly [string, string]>): string[] {
  const hits: string[] = [];
  for (const [file, text] of corpus) {
    text.split('\n').forEach((line, index) => {
      if (gitProvenanceReading().test(line)) { hits.push(`${file}:${index + 1}`); }
    });
  }
  return hits;
}

// manifestFieldReaders reports which source modules read one field of the
// manifest through the editor's record of the installed extension, in the order
// the modules are listed.
//
// A read is the manifest object and the field named in one statement, which is
// how every such read in this extension is written. It is the instrument the
// claim below is measured with, and a field the extension provably reads is its
// calibration.
export function manifestFieldReaders(
  sources: ReadonlyArray<readonly [string, string]>,
  field: string,
): string[] {
  const read = new RegExp(`packageJSON[^;]*?\\b${field}\\b`);
  return sources.filter(([, text]) => read.test(text)).map(([file]) => file);
}

// manifestImporters reports which source modules load the manifest file itself,
// the other way its version could be read.
export function manifestImporters(sources: ReadonlyArray<readonly [string, string]>): string[] {
  const load = /(?:\bfrom\s+|\brequire\(\s*)['"][^'"]*package\.json['"]/;
  return sources.filter(([, text]) => load.test(text)).map(([file]) => file);
}
