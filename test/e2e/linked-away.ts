// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { NotRun } from './checks';
import { changeSince, Tree, TreeChange } from './fixtures';

// A path of a scenario's folder replaced, for the length of one check, by a link
// leading out of the workspace — a build's output directory, a lockfile, a
// Release, a cache directory — and put back afterwards, so the check after it
// finds the folder as it was.
//
// What stood at the path is moved aside, beside the folder and outside it, rather
// than copied: a copy left in place would still be read, and a path the language
// server never sees is the only kind a link can stand in for.

// outsideTheWorkspace is a directory beside the folder, outside the workspace,
// named for what a check keeps there behind its link.
export function outsideTheWorkspace(folder: string, name: string): string {
  return path.join(path.dirname(folder), 'outside-the-workspace', name);
}

// LinkedAway is one path of a folder replaced by a link: the link, where it
// leads, what stood at its place before, moved aside, and the directory made to
// hold the link where none stood.
export interface LinkedAway { link: string; target: string; setAside: string | null; madeParent: string | null }

function present(p: string): boolean {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

// firstMissing is the outermost directory `dir` names that does not exist, or
// null where it exists.
function firstMissing(dir: string): string | null {
  let missing: string | null = null;
  for (let d = dir; !present(d); d = path.dirname(d)) { missing = d; }
  return missing;
}

// linkAway replaces `rel` in `folder` with a link to `target`, which lies outside
// the folder and is placed by the caller, first moving aside whatever stood at
// `rel`. It refuses as not run, with the folder put back, where the link cannot
// be placed or does not lead out of the folder.
export function linkAway(folder: string, rel: string, target: string): LinkedAway {
  const link = path.join(folder, rel);
  const setAside = present(link) ? path.join(path.dirname(folder), 'set-aside', path.basename(folder), rel.split(path.sep).join('--')) : null;
  const placed: LinkedAway = { link, target, setAside, madeParent: firstMissing(path.dirname(link)) };
  try {
    if (setAside !== null) {
      fs.mkdirSync(path.dirname(setAside), { recursive: true });
      fs.renameSync(link, setAside);
    }
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, fs.statSync(target).isDirectory() ? 'dir' : 'file');
  } catch (err) {
    putBackLinked(placed);
    throw new NotRun(`${rel} in ${folder} could not be replaced by a link to ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!path.relative(folder, fs.realpathSync(link)).startsWith('..')) {
    putBackLinked(placed);
    throw new NotRun(`${link} does not lead outside ${folder}`);
  }
  return placed;
}

// putBackLinked takes the link away and returns what was moved aside to its
// place, and takes away the directory made to hold the link where it is left
// empty.
export function putBackLinked(l: LinkedAway): void {
  try {
    if (fs.lstatSync(l.link).isSymbolicLink()) { fs.unlinkSync(l.link); }
  } catch { /* not there */ }
  if (l.setAside !== null && present(l.setAside) && !present(l.link)) { fs.renameSync(l.setAside, l.link); }
  if (l.madeParent !== null) {
    try { fs.rmdirSync(l.madeParent); } catch { /* holds something, or gone */ }
  }
}

// untouched reports whether a directory outside the workspace still holds what
// it held, and words the reading for a check's report.
export function untouched(before: Tree, dir: string): { same: boolean; seen: string; change: TreeChange } {
  const change = changeSince(before, dir);
  const same = change.changed.length === 0 && change.missing.length === 0 && change.added.length === 0;
  return {
    same,
    change,
    seen: same
      ? `${dir} holds the same ${before.size} file(s) with the same bytes`
      : `${dir} changed: ${JSON.stringify(change)}`,
  };
}
