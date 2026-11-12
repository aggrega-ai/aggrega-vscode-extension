// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// filesUnder lists every file inside one directory, recursively, as absolute
// paths.
//
// 🔴 IT STANDS IN FOR THE EDITOR'S OWN PER-FOLDER SEARCH, AND IT IS A
// DELIBERATE NEAR-DUPLICATE RATHER THAN AN ACCIDENT. The editor's search cannot
// run here — the module holding it imports the editor, which does not start in a
// headless run — so the reach rule is driven against a real directory tree with
// this in its place. Recorded as deliberate so nobody later "unifies" it with
// the editor's search, which would leave the rule drivable by nothing.
//
// 🔴 IT IS A SUPERSET OF WHAT THE EDITOR'S SEARCH RETURNS, AND THAT MAKES IT THE
// STRICTER INSTRUMENT RATHER THAN A WEAKER ONE. The real search narrows to a
// pattern before the candidates are confirmed; this narrows to nothing. So every
// directory the real search would offer is offered here and more besides, and a
// test asserting an EXACT set of workspaces has to survive the extra ones being
// dropped by the confirmation. A rule that passed here and failed against the
// real search would have to be one that confirmed a directory the pattern hides,
// which the pattern being a superset of what confirms already rules out.
export async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await filesUnder(full));
      continue;
    }
    found.push(full);
  }
  return found;
}

// searchUnder is that listing in the shape the reach rule takes.
export function searchUnder(folder: { uri: { fsPath: string } }): Promise<readonly string[]> {
  return filesUnder(folder.uri.fsPath);
}

// folder makes the minimal structural folder the discovery rule accepts, so a
// layout below reads as the paths it is about rather than as editor plumbing.
export function folder(fsPath: string): { uri: { fsPath: string } } {
  return { uri: { fsPath } };
}
