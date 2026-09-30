// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CONFIG_FILENAME, findAggregaWorkspaceAnchor } from '../../src/workspace';
import { FixtureError, FixtureProof } from './fixtures';

// The folder layouts the checks of which folder, which Aggrega workspace and which
// Release open: each one written the way a reader builds it by hand, inside the
// scenario's scratch root, and read back before anything rests on it.
//
// 🔴 A LAYOUT MEASURES WHAT IT SAYS ONLY WHERE NOTHING ABOVE IT MARKS A
// WORKSPACE. Both the compiler and the editor find a workspace by walking up
// from a folder, so a marker in any directory above the layouts would be found
// first and every reading taken over them would describe that directory instead.
// So every ancestor of the directory the layouts are built in is read for each
// thing that can mark a root, and a layout beneath one that carries any of them
// is refused rather than asserted on.

// POSTGRES_EXAMPLE is the documentation example that is the second of two Aggrega
// workspaces a window reaches, by its path under the documentation checkout. It
// names the standard library by the same line its sibling does.
export const POSTGRES_EXAMPLE = path.join('aggrega-docs', 'language-reference', 'examples', 'postgres-init-config');

// ROOT_MARKERS says, in words, what is looked for in each ancestor: the markers
// the compiler's own configuration help names.
export const ROOT_MARKERS = 'a .aggrega/ directory, a .aggrega-config.yaml, or an aggregate*, release* or manifest* file ending .yaml or .yml';

// markerIn reports whether a directory entry is one of the root markers. It is
// stricter than the compiler in one place on purpose: any configuration file
// counts, whether or not it carries a workspace key, because an ancestor holding
// one at all is not a place a layout's reading can be trusted beneath.
function markerIn(entry: fs.Dirent): boolean {
  if (entry.name === '.aggrega') { return entry.isDirectory(); }
  if (entry.name === CONFIG_FILENAME) { return true; }
  return !entry.isDirectory() && /^(aggregate|release|manifest).*\.ya?ml$/i.test(entry.name);
}

// nearMiss reports an entry whose name begins as a marker's does and ends
// otherwise, which marks nothing. Such entries are listed in the proof rather
// than refused, so the reading says what it saw beside what it ruled out.
function nearMiss(entry: fs.Dirent): boolean {
  return !markerIn(entry) && /^(aggregate|release|manifest)/i.test(entry.name);
}

// proveNothingAbove reads every directory above `dir`, up to the filesystem
// root, for a root marker, and refuses where it finds one. Asked to include `dir`
// itself, it reads that directory first, which is what the parent of several
// layouts needs: it sits above every one of them.
export function proveNothingAbove(dir: string, includeSelf = false): FixtureProof {
  const fixture = `nothing ${includeSelf ? 'in or ' : ''}above ${dir} marks a workspace`;
  const read: string[] = [];
  const found: string[] = [];
  const near: string[] = [];
  for (let d = includeSelf ? path.resolve(dir) : path.dirname(path.resolve(dir)); ; d = path.dirname(d)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      throw new FixtureError(fixture, `${d} could not be read, so whether it marks a workspace is unknown: ${err instanceof Error ? err.message : String(err)}`);
    }
    read.push(d);
    found.push(...entries.filter(markerIn).map((e) => path.join(d, e.name)));
    near.push(...entries.filter(nearMiss).map((e) => path.join(d, e.name)));
    if (path.dirname(d) === d) { break; }
  }
  if (found.length > 0) {
    throw new FixtureError(fixture, `a directory above it carries what marks a workspace root: ${found.join(', ')}`);
  }
  const alsoSeen = near.length === 0 ? '' : `; ${near.length} other file(s) whose name begins as a marker's does, marking nothing: ${near.join(', ')}`;
  return { fixture, built: true, proof: `${read.length} directories read, from ${read[0]} up to ${read[read.length - 1]}, and none holds ${ROOT_MARKERS}${alsoSeen}`, evidence: { read, near } };
}

// Layout is one folder a check opens, the files it holds — each by its path
// beneath the folder and its whole content — and the directories beneath it that
// hold nothing.
export interface Layout {
  folder: string;
  files: Readonly<Record<string, string>>;
  dirs?: readonly string[];
}

// placeLayout writes a layout and reads every file back, and answers with the
// root the editor's own discovery finds walking up from the folder, which is
// recorded beside the proof rather than asserted on: what a layout is FOR is the
// check that reads it.
export async function placeLayout(parent: string, layout: Layout): Promise<FixtureProof> {
  const folder = path.join(parent, layout.folder);
  const fixture = `layout ${layout.folder}`;
  fs.mkdirSync(folder, { recursive: true });
  for (const d of layout.dirs ?? []) { fs.mkdirSync(path.join(folder, d), { recursive: true }); }
  for (const [rel, content] of Object.entries(layout.files)) {
    const file = path.join(folder, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (fs.readFileSync(file, 'utf8') !== content) {
      throw new FixtureError(fixture, `${file} does not read back as written`);
    }
  }
  const missing = (layout.dirs ?? []).filter((d) => !fs.statSync(path.join(folder, d), { throwIfNoEntry: false })?.isDirectory());
  if (missing.length > 0) { throw new FixtureError(fixture, `${missing.join(', ')} beneath ${folder} is not a directory after it was made`); }
  const anchor = await findAggregaWorkspaceAnchor(folder);
  const listed = Object.keys(layout.files);
  const empty = (layout.dirs ?? []).length === 0 ? '' : `, and the empty director${(layout.dirs ?? []).length === 1 ? 'y' : 'ies'} ${(layout.dirs ?? []).join(', ')}`;
  return {
    fixture,
    built: true,
    proof: `${folder} holds ${listed.length === 0 ? 'no file' : listed.map((f) => `${f} (${JSON.stringify(layout.files[f])})`).join(', ')}${empty}; the editor's discovery walking up from it finds ${anchor ?? 'no marker'}`,
  };
}

// placeLayouts builds every layout beneath one directory, after proving nothing
// in or above that directory marks a workspace.
export async function placeLayouts(parent: string, layouts: readonly Layout[]): Promise<FixtureProof[]> {
  fs.mkdirSync(parent, { recursive: true });
  const proofs = [proveNothingAbove(parent, true)];
  for (const l of layouts) { proofs.push(await placeLayout(parent, l)); }
  return proofs;
}
