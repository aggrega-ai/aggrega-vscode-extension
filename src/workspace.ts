// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';

// CONFIG_FILENAME is the single canonical basename of the workspace
// configuration file, shared across the extension (discovery here,
// scaffolding in release-actions) so the name has one definition.
export const CONFIG_FILENAME = '.aggrega-config.yaml';

// NO_ANCHORED_WORKSPACE_MESSAGE is the one message every surface shows when
// nothing is anchored. One state, one wording: a reader who meets this
// condition through two different commands must not be told two different
// things about it, and a wording duplicated per call site drifts the moment
// either copy is reworded.
//
// It names the config file through CONFIG_FILENAME rather than spelling it
// again, so the filename the message teaches cannot part company with the one
// discovery actually looks for. A Release file is named as the other common
// anchor; findAggregaWorkspaceAnchor below is the full set, and reciting it here
// would trade a readable sentence for an inventory that goes stale whenever the
// set moves.
export const NO_ANCHORED_WORKSPACE_MESSAGE =
  `Aggrega: no anchored workspace. Open a folder containing ${CONFIG_FILENAME} or a Release file first.`;

// NO_ANCHORED_WORKSPACE_TREE_LABEL is the same state rendered as a tree row.
//
// A row is not a notification, so it carries neither the product prefix nor the
// remediation clause: a tree reports what is there, while a notification
// addresses the reader. The two forms live together because they describe one
// state — a view that grows a row for this condition should find the wording
// already written rather than invent another.
export const NO_ANCHORED_WORKSPACE_TREE_LABEL = 'No anchored workspace.';

// AGGREGA_DIR and ACTIVE_RELEASE_MARKER_BASENAME name the workspace's
// .aggrega/ directory and the active-release marker inside it. Both have their
// one definition here — the directory is a workspace anchor this module already
// detects, and the marker is written from one surface and watched from another.
// Both derive from these names rather than spelling them again: a marker that
// moves has to move in one place, or the writer and the watcher part company
// silently.
export const AGGREGA_DIR = '.aggrega';
export const ACTIVE_RELEASE_MARKER_BASENAME = 'active-release';
const GLOB_PREFIXES = ['aggregate', 'release', 'manifest'] as const;
const LOCKFILE_SUFFIX = '.lock.yaml';
const YAML_SUFFIX = '.yaml';

// WORKSPACE_ANCHOR_CONFIG is what a surface writes to make a directory the root
// of an Aggrega workspace: the smallest configuration that anchors one.
//
// It lives HERE, beside hasWorkspaceBlock, because the two are one rule seen
// from its two sides — what is written and what is recognised. Held apart they
// would agree until somebody tightened the probe or reworded the template, and
// the symptom would be a reader pressing "create a workspace configuration",
// getting a file, and still being told nothing is anchored. A test writes this
// through the probe rather than eyeballing the two.
//
// The `workspace:` key is the whole marker; an empty mapping is a complete
// answer, and the comment above it says what the file is for so the reader who
// opens it afterwards is not looking at two bare words.
export const WORKSPACE_ANCHOR_CONFIG =
  `# Aggrega reads this file to find the root of your workspace. The workspace\n` +
  `# key below is what marks this directory as that root; everything else in\n` +
  `# this file is optional and layers on top of Aggrega's own defaults.\n` +
  `workspace: {}\n`;

// ANCHOR_CANDIDATE_GLOB matches, loosely, the files whose presence in a
// directory might anchor a workspace there.
//
// It is deliberately a SUPERSET of what findAggregaWorkspaceAnchor decides on,
// and that asymmetry is the design rather than a shortcut. A surface offering a
// reader candidate folders uses this to narrow a whole-workspace search, then
// confirms each candidate through findAggregaWorkspaceAnchor — which stays the
// one home for the rule. So a pattern that is too wide can only produce a
// candidate the confirmation drops, while one that is too narrow hides a folder
// the reader has; the pattern is therefore built from the same constants the
// tiers are, and errs wide.
export const ANCHOR_CANDIDATE_GLOB =
  `**/{${CONFIG_FILENAME},${AGGREGA_DIR}/**,` +
  GLOB_PREFIXES.map((prefix) => `${prefix}*${YAML_SUFFIX}`).join(',') +
  `}`;

// activeReleaseMarkerPath is the absolute path of the workspace's
// active-release marker.
export function activeReleaseMarkerPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AGGREGA_DIR, ACTIVE_RELEASE_MARKER_BASENAME);
}

// ACTIVE_RELEASE_MARKER_GLOB matches the active-release marker anywhere in the
// open workspace, for a file watcher that wants to know when it changes.
//
// Separators are literal forward slashes rather than path.join's: the editor's
// glob patterns use forward slashes on every platform, so joining with the host
// separator would produce a pattern that matches nothing on Windows — and a
// watcher whose pattern matches nothing reports no error and logs nothing, so
// the only symptom is an indicator that quietly stops refreshing.
export const ACTIVE_RELEASE_MARKER_GLOB =
  `**/${AGGREGA_DIR}/${ACTIVE_RELEASE_MARKER_BASENAME}`;

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
// looking for any of the workspace anchor markers the daemon
// recognizes:
//
//   1. .aggrega-config.yaml carrying a top-level `workspace:` block
//   2. .aggrega/                    (directory)
//   3. aggregate*.yaml              (glob)
//   4. release*.yaml                (glob)
//   5. manifest*.yaml               (glob)
//
// A `.aggrega-config.yaml` WITHOUT a `workspace:` block does not
// anchor — a bare settings/global config must not mark every parent
// directory as a workspace root. Lockfile-suffixed matches (e.g.,
// release.lock.yaml) are excluded from the glob tier so a lockfile
// alone does not anchor a workspace. Returns the absolute path of the
// first match (any tier) found in the walk, or null when the
// filesystem root is reached without a match.
//
// The walk is lexical (filepath.Dir-equivalent); symlinks are not
// dereferenced. Mirrors the Go workspaceconfig.Resolve discovery
// semantics so the extension and daemon agree on which folders are
// Aggrega workspaces; the cross-language parity test pins the match.
export async function findAggregaWorkspaceAnchor(start: string): Promise<string | null> {
  let current = path.resolve(start);
  // Precedence mirrors the Go discoverRoot: the nearest `.aggrega-config.yaml`
  // carrying a `workspace:` block wins outright; otherwise the nearest
  // heuristic marker (.aggrega/ or a glob) anchors. So a `workspace:` config
  // higher up beats a nearer heuristic — discovery climbs past heuristics to
  // honor an explicit workspace root.
  let fallback: string | null = null;
  while (true) {
    const configPath = path.join(current, CONFIG_FILENAME);
    if (await hasWorkspaceBlock(configPath)) {
      return configPath;
    }
    if (fallback === null) {
      fallback = await heuristicMarkerInDir(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return fallback;
    }
    current = parent;
  }
}

// toWorkspaceRelative converts a Release path into the form the daemon's
// JSON-RPC surface accepts: a path relative to the workspace root, naming a
// document inside it.
//
// The daemon reports Release candidates as absolute paths and takes
// workspace-relative ones in its request parameters, so a value read from the
// first and sent to the second is converted here rather than at each call site.
// The daemon refuses the absolute form outright, which is why the conversion
// has one home: a surface that forgets it does not degrade, it fails.
//
// A path already in relative form is returned unchanged. Separators follow the
// host convention on both sides — the extension and the daemon it spawns run on
// the same machine — so no separator rewriting is done.
export function toWorkspaceRelative(workspaceRoot: string, releasePath: string): string {
  if (!path.isAbsolute(releasePath)) {
    return releasePath;
  }
  return path.relative(workspaceRoot, releasePath);
}

// releaseParamFor converts a Release path into the request parameter the daemon
// will accept for it, or reports that no such parameter exists.
//
// The parameter's contract is a path relative to the workspace root naming a
// document inside it, and the daemon refuses anything else. So a Release is
// offerable exactly when this returns a value, and the offer and the acceptance
// are then one rule rather than two statements of it kept in step by eye.
//
// The conversion itself is not repeated here — it stays in toWorkspaceRelative
// above, which this delegates to. What this adds is the containment judgement,
// made on the cleaned relative path so an interior `a/../b` resolves and passes
// while a path that climbs out of the root does not. A sibling directory whose
// name merely extends the root's is outside it and is refused, which a string
// prefix comparison against the root would wrongly accept.
//
// Returns null for an empty root, for a value that resolves to the root itself
// (which names no document), and for one that climbs out of it.
//
// This is a DELIBERATE second implementation of the containment rule the daemon
// applies to the same parameter, and it is recorded as one so nobody later
// unifies it away as an accident. The two run in different languages and the
// judgement is needed before a request is sent, so there is nothing to call. The
// duplication is held the way the anchor-discovery rule above holds its own: by
// a table of cases covering each boundary the rule turns on — an interior climb
// that resolves back inside, a sibling whose name merely extends the root, the
// root itself. A case added on one side belongs on the other.
export function releaseParamFor(workspaceRoot: string, releasePath: string): string | null {
  if (workspaceRoot === '') {
    return null;
  }
  const relative = toWorkspaceRelative(workspaceRoot, releasePath);
  if (relative === '' || path.isAbsolute(relative)) {
    return null;
  }
  const cleaned = path.normalize(relative);
  if (cleaned === '..' || cleaned.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relative;
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

// heuristicMarkerInDir reports the highest-priority heuristic marker present in
// dir (.aggrega/ then aggregate*.yaml / release*.yaml / manifest*.yaml,
// lockfiles excluded), or null. The `workspace:`-config tier is handled by the
// caller, which gives it cross-directory precedence over these heuristics.
async function heuristicMarkerInDir(dir: string): Promise<string | null> {
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

// hasWorkspaceBlock reports whether the file at p exists and declares a
// top-level `workspace:` key — the marker that anchors a workspace root. A
// file without it (a bare settings/global config) does not anchor. This is the
// client-side, pre-daemon counterpart to the Go side's raw-document
// `workspace:` probe; both treat presence of the key — including the empty
// `workspace: {}` form — as the marker. The cross-language parity test asserts
// the two agree on the shared fixtures. The probe is intentionally shallow (a
// top-level, unindented `workspace:` key) rather than a full YAML parse: the
// extension does no YAML parsing, and discovery runs before any daemon exists.
async function hasWorkspaceBlock(p: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(p, 'utf8');
  } catch {
    return false;
  }
  // A top-level mapping key has no leading indentation. Match `workspace:`
  // (optionally `workspace: {}` / trailing content) at the start of a line.
  return /^workspace[ \t]*:/m.test(content);
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}
