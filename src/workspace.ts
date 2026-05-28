// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_FILENAME = '.aggrega-config.yaml';
const AGGREGA_DIR = '.aggrega';
const GLOB_PREFIXES = ['aggregate', 'release', 'manifest'] as const;
const LOCKFILE_SUFFIX = '.lock.yaml';
const YAML_SUFFIX = '.yaml';

// FolderLike is a structural subset of vscode.WorkspaceFolder. Used so
// helpers in this module remain testable without importing vscode.
export interface FolderLike {
  uri: { fsPath: string };
}

// AnchoredFolder pairs a workspace folder with the marker path that
// caused findAggregaWorkspaceAnchor to identify it as Aggrega-anchored.
export interface AnchoredFolder<F extends FolderLike = FolderLike> {
  folder: F;
  anchorPath: string;
}

// findAggregaWorkspaceAnchor walks parent directories from start
// looking for any of the five workspace anchor markers the daemon
// recognizes:
//
//   1. .aggrega-config.yaml         (file)
//   2. .aggrega/                    (directory)
//   3. aggregate*.yaml              (glob)
//   4. release*.yaml                (glob)
//   5. manifest*.yaml               (glob)
//
// Lockfile-suffixed matches (e.g., release.lock.yaml) are excluded
// from the glob tier so a lockfile alone does not anchor a workspace.
// Returns the absolute path of the first match (any tier) found in
// the walk, or null when the filesystem root is reached without a
// match.
//
// The walk is lexical (filepath.Dir-equivalent); symlinks are not
// dereferenced. Matches the daemon's discoverWorkspaceRoot semantics
// 1:1 so client and server agree on which workspace folders are
// Aggrega workspaces.
export async function findAggregaWorkspaceAnchor(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    const hit = await checkMarkersInDir(current);
    if (hit !== null) {
      return hit;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

// findAllAnchoredFolders runs findAggregaWorkspaceAnchor against
// each entry in folders, keeping only the folders where a marker was
// found. The result preserves the input order. Folders without an
// anchor are silently dropped.
export async function findAllAnchoredFolders<F extends FolderLike>(
  folders: readonly F[],
): Promise<AnchoredFolder<F>[]> {
  const out: AnchoredFolder<F>[] = [];
  for (const folder of folders) {
    const anchorPath = await findAggregaWorkspaceAnchor(folder.uri.fsPath);
    if (anchorPath !== null) {
      out.push({ folder, anchorPath });
    }
  }
  return out;
}

// findCandidateReleases scans the workspace root for files whose
// basename matches the same glob shapes findAggregaWorkspaceAnchor
// uses to identify Release-like anchors: aggregate*.yaml,
// release*.yaml, manifest*.yaml. Lockfile-suffixed matches are
// excluded. The scan is shallow (no recursion into subdirectories)
// because the cascade's single-Release heuristic operates on the
// workspace root only.
//
// Returns absolute paths sorted lexicographically for deterministic
// quick-pick ordering. Returns an empty slice when the workspace
// root has no Release-like files — the caller decides whether to
// omit the "Use marker file" button.
export async function findCandidateReleases(workspaceRoot: string): Promise<string[]> {
  const entries = (await readdirSafe(workspaceRoot)).sort();
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(YAML_SUFFIX) || name.endsWith(LOCKFILE_SUFFIX)) {
      continue;
    }
    for (const prefix of GLOB_PREFIXES) {
      if (name.startsWith(prefix)) {
        out.push(path.join(workspaceRoot, name));
        break;
      }
    }
  }
  return out;
}

async function checkMarkersInDir(dir: string): Promise<string | null> {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (await isFile(configPath)) {
    return configPath;
  }
  const aggregaDir = path.join(dir, AGGREGA_DIR);
  if (await isDirectory(aggregaDir)) {
    return aggregaDir;
  }
  // Sort entries for lexical-order parity with the daemon's
  // filepath.Glob semantics (Go's documented behavior). Node's
  // readdir order is filesystem-dependent and not part of its API
  // contract; sorting makes downstream consumers of the returned
  // path deterministic across platforms.
  const entries = (await readdirSafe(dir)).sort();
  for (const prefix of GLOB_PREFIXES) {
    for (const name of entries) {
      if (
        name.startsWith(prefix) &&
        name.endsWith(YAML_SUFFIX) &&
        !name.endsWith(LOCKFILE_SUFFIX)
      ) {
        return path.join(dir, name);
      }
    }
  }
  return null;
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}
