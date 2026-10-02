// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import { loadAll } from 'js-yaml';
import * as path from 'path';
import { SELECTOR_ROW_LABELS } from './selector-levels';

// CONFIG_FILENAME is the single canonical basename of the workspace
// configuration file, shared across the extension (discovery here,
// scaffolding in release-actions) so the name has one definition.
export const CONFIG_FILENAME = '.aggrega-config.yaml';

// The state "this project holds nothing Aggrega can work in", written once and
// rendered four ways below.
//
// 🔴 THE IDENTIFIERS BELOW KEEP THE WORD "ANCHORED" AND THE SENTENCES DO NOT,
// AND THAT DIVERGENCE IS DELIBERATE. Anchoring is what this module does — it is
// the name of the climb, of the marker, and of the remembered choice — so an
// identifier that said anything else would describe the mechanism wrongly. It
// is not, however, a word the reader ever authors or meets anywhere else, and
// the level they are being told about has a name of its own. So the code keeps
// its name and the reader gets theirs, and neither is a synonym waiting to be
// unified with the other.
//
// The sentence and the ways out are separate because the four renderings take
// different subsets of them: a notification carries both, a row carries both on
// two lines, a tree row carries neither, and the reason a control gives carries
// only the way out. Holding them apart is what lets each take what it needs
// without any of them restating the other.
const NO_AGGREGA_WORKSPACE_STATE =
  `no ${SELECTOR_ROW_LABELS.workspace} is available in this project`;

// The two ways out of that state, in the order a reader is likeliest to want
// them: bring one into the window, or make one.
//
// It names the config file through CONFIG_FILENAME rather than spelling it
// again, so the filename the message teaches cannot part company with the one
// discovery actually looks for. A Release file is named as the other common
// anchor; findAggregaWorkspaceAnchor below is the full set, and reciting it here
// would trade a readable sentence for an inventory that goes stale whenever the
// set moves.
const NO_AGGREGA_WORKSPACE_WAYS_OUT =
  `Open a ${SELECTOR_ROW_LABELS.project} holding ${CONFIG_FILENAME} or a Release file, `
  + `or create an ${SELECTOR_ROW_LABELS.workspace}.`;

// NO_ANCHORED_WORKSPACE_MESSAGE is the one message every surface shows when
// nothing is anchored. One state, one wording: a reader who meets this
// condition through two different commands must not be told two different
// things about it, and a wording duplicated per call site drifts the moment
// either copy is reworded.
export const NO_ANCHORED_WORKSPACE_MESSAGE =
  `Aggrega: ${NO_AGGREGA_WORKSPACE_STATE}. ${NO_AGGREGA_WORKSPACE_WAYS_OUT}`;

// NO_ANCHORED_WORKSPACE_TREE_LABEL is the same state rendered as a tree row.
//
// A row is not a notification, so it carries neither the product prefix nor the
// remediation clause: a tree reports what is there, while a notification
// addresses the reader. The two forms live together because they describe one
// state — a view that grows a row for this condition should find the wording
// already written rather than invent another.
export const NO_ANCHORED_WORKSPACE_TREE_LABEL =
  `No ${SELECTOR_ROW_LABELS.workspace} available.`;

// NO_ANCHORED_WORKSPACE_CONTROL_REASON is the same state again, as the reason a
// control that needs an anchored folder gives for being unavailable.
//
// It is the shortest of the four because of where it is read: beside a control
// the reader is looking at, which already tells them the control cannot run. So
// it carries only what they cannot see — what to do to make it run — and drops
// both the product prefix a notification needs and the account of the state a
// row needs.
export const NO_ANCHORED_WORKSPACE_CONTROL_REASON =
  `Open or create an ${SELECTOR_ROW_LABELS.workspace} first.`;

// NO_ANCHORED_WORKSPACE_ROW_TOOLTIP is the same state again, as the hover of the
// selector row that reports the level.
//
// It lives here with its three siblings rather than in the module that draws
// the row, and that placement is the whole point: a surface that grows a
// rendering for this state should find the wording already written rather than
// invent another. A fourth rendering written where it is drawn is how the row
// and a dozen notifications came to describe one state in two vocabularies.
//
// It differs from the notification in one thing only — the ways out sit on a
// line of their own, because a hover is read as a block and a notification as a
// sentence.
export const NO_ANCHORED_WORKSPACE_ROW_TOOLTIP =
  `Aggrega: ${NO_AGGREGA_WORKSPACE_STATE}.\n${NO_AGGREGA_WORKSPACE_WAYS_OUT}`;

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

// YAML_SUFFIXES are both spellings of a YAML file's extension that the glob
// tier accepts, and LOCKFILE_SUFFIXES are the lockfile forms it refuses. A
// reader whose Release is named release.yml is in an Aggrega workspace exactly
// as one whose Release is release.yaml is, so the climb answers the same for
// both — the compiler accepts either spelling, and an editor that accepted only
// one would tell a reader they are nowhere while a build works.
//
// 🔴 THE SECOND LIST IS DERIVED FROM THE FIRST, AND THAT DERIVATION IS WHAT
// KEEPS A LOCKFILE FROM ANCHORING A ROOT. The two are one rule read from its
// two sides: a suffix is accepted, and that same suffix behind `.lock` is not.
// Written as two independent lists they would agree until a spelling was added
// to the accepted one alone, at which point release.lock.yml would anchor a
// workspace — silently, because nothing compares one list to the other.
// Deriving one from the other makes that divergence unwritable rather than
// merely untested.
const YAML_SUFFIXES = ['.yaml', '.yml'] as const;
const LOCKFILE_SUFFIXES = YAML_SUFFIXES.map((suffix) => `.lock${suffix}`);

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
  GLOB_PREFIXES.flatMap(
    (prefix) => YAML_SUFFIXES.map((suffix) => `${prefix}*${suffix}`),
  ).join(',') +
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

// AnchoredFolder names one Aggrega workspace the window can reach, together
// with the open folder it was reached from.
//
// 🔴 THE MARKER IDENTIFIES THE ENTRY; THE FOLDER IS ONLY HOW IT IS REACHED.
// Discovery climbs, so one marker answers for every open folder beneath it —
// which means "which folder contains this workspace" has more than one true
// answer whenever two open folders climb to the same place. The entry is
// therefore keyed on the marker, and the folder it carries is whichever of
// those came first. A caller comparing entries, counting them, naming one to a
// reader, or starting a language server uses the marker or the root derived
// from it; what the folder answers is which folder the editor has open.
export interface AnchoredFolder<F extends FolderLike = FolderLike> {
  folder: F;
  anchorPath: string;
}

// workspaceRootOf is the directory a marker makes the root of an Aggrega
// workspace: the directory the marker sits in.
//
// It holds for every tier findAggregaWorkspaceAnchor can answer with — the
// config file, the .aggrega/ directory and each glob match all sit directly in
// the root they anchor — and it is written once here so no surface derives the
// root a second way. The language server PINS to the root it is handed rather
// than climbing from it, so this is the value the handshake declares: a row
// drawn from this and a row drawn from the server's own answer name one
// directory because this is the directory the server was given.
export function workspaceRootOf(anchored: Pick<AnchoredFolder, 'anchorPath'>): string {
  return path.dirname(anchored.anchorPath);
}

// WindowAnchoring names the two true and different answers a window has to
// "where are we": the Aggrega workspace root, and the folder the editor opened
// in order to reach it.
//
// 🔴 THEY ARE TWO FIELDS BECAUSE THEY ARE TWO FACTS, AND A SURFACE READING ONE
// OF THEM HAS TO SAY WHICH. The root is what the language server is started at
// and pins to, so it is what every path on a request resolves against and what
// the workspace's own declared settings and catalog locations are read from.
// The opened folder is what the reader has in the editor, and it is the only
// honest answer to a surface asking which folder this window has open. They
// coincide whenever the opened folder is itself the root, and differ whenever
// the marker sits above it — which is exactly when a surface that had conflated
// them starts saying something false.
export interface WindowAnchoring {
  workspaceRoot: string;
  openedFolder: string;
}

// windowAnchoring reads both facts off one reachable Aggrega workspace.
//
// They are returned together rather than derived separately at each call so
// that the pair is taken from one place: a caller that computed one of them for
// itself would be a second derivation of a value this module already owns, and
// the two would agree until the day they did not.
export function windowAnchoring(anchored: AnchoredFolder): WindowAnchoring {
  return {
    workspaceRoot: workspaceRootOf(anchored),
    openedFolder: anchored.folder.uri.fsPath,
  };
}

// findAggregaWorkspaceAnchor walks parent directories from start
// looking for any of the workspace anchor markers the daemon
// recognizes:
//
//   1. .aggrega-config.yaml carrying a top-level `workspace:` block
//   2. .aggrega/                                 (directory)
//   3. aggregate*.yaml / aggregate*.yml          (glob)
//   4. release*.yaml / release*.yml              (glob)
//   5. manifest*.yaml / manifest*.yml            (glob)
//
// Both YAML spellings anchor in the glob tiers, because both are
// spellings the compiler itself accepts.
//
// A `.aggrega-config.yaml` WITHOUT a `workspace:` block does not
// anchor — a bare settings/global config must not mark every parent
// directory as a workspace root. Lockfile-suffixed matches (e.g.,
// release.lock.yaml, release.lock.yml) are excluded from the glob tier
// so a lockfile alone does not anchor a workspace. Returns the
// absolute path of the first match (any tier) found in the walk, or
// null when the filesystem root is reached without a match.
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

// fromWorkspaceRelative is the other direction: a path the daemon reported,
// resolved to the absolute path the editor opens.
//
// The daemon names a document inside the workspace relative to the root, and
// one outside it by its absolute path, so a value read off an answer is either.
// A relative one resolves against the anchored root; an absolute one is already
// complete and is returned unchanged.
export function fromWorkspaceRelative(workspaceRoot: string, reported: string): string {
  return path.isAbsolute(reported) ? reported : path.join(workspaceRoot, reported);
}

// relativeIfInside is this module's one containment judgement: it answers with
// the relative form of target when target names somewhere inside the root, and
// null when it does not. The workspace-relative request parameters on this
// surface share it, and so does the question whether a remembered workspace's
// root sits inside a folder.
//
// The contract belongs to the surface rather than to any one parameter, which is
// why it is judged here once and each parameter below adds only the one reading
// that is its own. A copy of the judgement per parameter is how one of them would
// come to accept a path another refuses — and it would happen silently, because
// two copies agree on every case either is driven with right up until a boundary
// case is added to one and not the other.
//
// Escape is judged on where the value lands, not on how it is spelled: the
// judgement runs on the normalised relative path, so an interior `a/../b`
// resolves and passes while a path that climbs out of the root does not. A
// sibling directory whose name merely extends the root's is outside it and is
// refused, which a string prefix comparison against the root would wrongly
// accept. An absent or empty root is nothing to judge containment against, so
// nothing is inside it.
//
// 🔴 THE EMPTY RESULT IS THE CALLER'S TO READ, AND IT IS THE ONE THING THIS
// DELIBERATELY DOES NOT DECIDE. A target that resolves to the root itself is
// inside the root, so it is answered with rather than refused — but what it MEANS
// is not the same for every caller, and that is the only axis the callers
// disagree on. Each settles it in a line of its own; folding one reading in here
// would decide it for all of them.
//
// It stays private, and every reading of it is in this file — the two parameters
// below, and the judgement of whether a remembered workspace's root sits inside a
// folder — so a surface reaching for the rule reaches it through one of them,
// which is what stops another reading of it growing somewhere this file cannot see.
//
// This is a DELIBERATE second implementation of the containment rule the daemon
// applies to these same parameters — it refuses an absolute value and one that
// climbs out of the root, on the Release path and on the build destination alike
// — and it is recorded as one so nobody later unifies it away as an accident. The
// two run in different languages and the judgement is needed before a request is
// sent, so there is nothing to call. The duplication is held the way the
// anchor-discovery rule above holds its own: by a table of cases covering each
// boundary the rule turns on — an interior climb that resolves back inside, a
// sibling whose name merely extends the root, the root itself — driven through
// the two parameters below, which are its only way in from a request. A case
// added on one side belongs on the other.
function relativeIfInside(workspaceRoot: string | null, target: string): string | null {
  if (workspaceRoot === null || workspaceRoot === '') {
    return null;
  }
  const relative = toWorkspaceRelative(workspaceRoot, target);
  if (path.isAbsolute(relative)) {
    return null;
  }
  const cleaned = path.normalize(relative);
  if (cleaned === '..' || cleaned.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relative;
}

// releaseParamFor converts a Release path into the request parameter the daemon
// will accept for it, or reports that no such parameter exists.
//
// The parameter's contract is a path relative to the workspace root naming a
// document inside it, and the daemon refuses anything else. So a Release is
// offerable exactly when this returns a value, and the offer and the acceptance
// are then one rule rather than two statements of it kept in step by eye.
//
// Neither the conversion nor the containment judgement is repeated here: the
// first stays in toWorkspaceRelative and the second in relativeIfInside, both
// above, which this delegates to. What this adds is the one reading that is its
// own — a value resolving to the root names no document, so the empty result is
// refused here where the destination below carries it.
//
// Returns null for an empty root, for a value that resolves to the root itself
// (which names no document), and for one that climbs out of it.
export function releaseParamFor(workspaceRoot: string, releasePath: string): string | null {
  const inside = relativeIfInside(workspaceRoot, releasePath);
  return inside === '' ? null : inside;
}

// outputParentFor converts the folder the reader works from into the request
// parameter that says where inside the workspace a build writes, or reports
// that there is no such parameter to send.
//
// The contract is the same one every destination on this surface takes: a path
// relative to the workspace root, naming somewhere inside it. What a build then
// writes is its output directory created INSIDE that path, which is the result
// a reader gets from running a build in the folder they are standing in — so
// the value is where they are standing, expressed the way a request can carry
// it, and the artifacts land one level below it rather than in it. That is why
// the parameter names a parent rather than the directory written into.
//
// 🔴 NULL MEANS "SEND NOTHING", AND IT IS AN ANSWER RATHER THAN A FAILURE. A
// window with several folders open and none chosen has no folder the reader is
// standing in, and a request that named one of them would be reporting a choice
// nobody made. Omitting the parameter is a defined state — a build then writes
// where a build run at the workspace root writes — so the honest value for "the
// editor cannot say" is no value at all.
//
// The same answer covers a folder that does not sit inside the root at all.
// That it does is not a structural invariant: it holds because one re-evaluation
// settles the folder in force and then computes the anchoring over that folder
// alone, so it is a property of that ordering rather than of either value, and
// the two are held separately, written at different moments, and read from
// different sources. Judging it here costs one comparison and makes the answer
// independent of that ordering — a value climbing out would be refused on
// arrival, and a refusal for something the reader never authored is worse than
// the default they would otherwise have got.
//
// The root itself yields the empty string, which is carried rather than dropped:
// it names the root, which IS where that reader is standing, and it says so in
// the request instead of leaving the destination to a default.
//
// Neither the conversion nor the containment judgement is repeated here: the
// first stays in toWorkspaceRelative and the second in relativeIfInside, both
// above, which the Release parameter is judged by too. What this adds is the one
// reading that is its own — a directory resolving to the root names the root, so
// the empty result is carried here where the Release parameter above refuses it.
// That difference is the reason these are two functions.
export function outputParentFor(
  workspaceRoot: string | null,
  projectFolder: string | null,
): string | null {
  // An absent or empty folder is the editor unable to say where the reader is
  // standing, and that is a different fact from a folder resolving to the root:
  // the judgement below answers the second with the empty string, which IS
  // carried. Refusing it here is what keeps the two from arriving as one value.
  if (projectFolder === null || projectFolder === '') {
    return null;
  }
  return relativeIfInside(workspaceRoot, projectFolder);
}

// workspaceSitsAboveFolder reports whether the Aggrega workspace in force is a
// different directory from the folder it was reached from.
//
// 🔴 IT IS THE ONE COMPARISON OF THOSE TWO PATHS AND EVERY SURFACE THAT TURNS ON
// THE FACT READS IT FROM HERE. Three surfaces do: the row that names the
// workspace explains itself differently, it offers to open the workspace, and
// the reader is told out loud that the editor is working outside their window.
// A second comparison written beside any of them would agree today and be the
// thing that drifted the first time either side learned about a symbolic link or
// a filesystem that ignores case — and the symptom would be one surface warning
// while another said nothing, which is worse than neither.
//
// It lives here rather than beside any of those surfaces because it is a fact
// about a workspace root and a folder rather than about a row, a modal or a
// marker, and this module is where the rest of that arithmetic already is.
//
// Both absences answer false, and they are the same answer for different
// reasons: with no workspace in force there is nothing sitting above anything,
// and with no folder reached there is nothing for a workspace to sit above.
export function workspaceSitsAboveFolder(
  anchoredRoot: string | null,
  openedFolder: string | null,
): boolean {
  return anchoredRoot !== null
    && openedFolder !== null
    && path.resolve(anchoredRoot) !== path.resolve(openedFolder);
}

// findAllAnchoredFolders runs findAggregaWorkspaceAnchor against each entry in
// folders and answers with one entry per Aggrega workspace reached. The result
// preserves the input order. Folders without an anchor are silently dropped.
//
// 🔴 ONE ENTRY PER WORKSPACE, NOT PER FOLDER, AND THAT IS THE WHOLE CONTRACT.
// The walk climbs, so two open folders under one marker both reach it; an entry
// per folder would report that one workspace twice. Everything downstream reads
// this as a population of things to choose between — the activation decision
// branches on its length, the panel reports that length as how many Aggrega
// workspaces are available, and the picker draws one line per entry — so a
// duplicate makes the extension ask which of two identical answers the reader
// wants, count two where there is one, and withhold the sentence that says a
// level holds only one candidate at exactly the moment it is most wanted.
//
// The folder kept for a workspace reached from several is the first in the
// window's own order. Which one it is does not change where the language server
// ends up: the root is derived from the marker rather than from the folder, and
// it is the root the server is handed. So the choice is arbitrary and needs to
// be stable rather than right, and input order is what makes it stable.
export async function findAllAnchoredFolders<F extends FolderLike>(
  folders: readonly F[],
): Promise<AnchoredFolder<F>[]> {
  const climbed: AnchoredFolder<F>[] = [];
  for (const folder of folders) {
    const anchorPath = await findAggregaWorkspaceAnchor(folder.uri.fsPath);
    if (anchorPath === null) { continue; }
    climbed.push({ folder, anchorPath });
  }
  return dedupeByWorkspaceRoot(climbed);
}

// dedupeByWorkspaceRoot keeps the first entry for each Aggrega workspace and
// drops the rest, preserving input order.
//
// 🔴 THE KEY IS THE WORKSPACE ROOT AND NEVER THE DIRECTORY A MARKER WAS FOUND
// IN. Discovery gives an explicit workspace configuration precedence across
// directories, so a marker found in a subdirectory can confirm to a root above
// it — which means two directories, each carrying something that looks like a
// marker, are frequently one workspace. Keying on where the file was found
// reports two, and the reader is then asked to choose between two entries that
// name the same place.
//
// It is the one home of that judgement, shared by the climb above and by the
// reach below, because those two are the same population read at two scopes: a
// second key written beside either would agree until the day discovery's
// precedence moved, and the symptom would be a count that disagreed with the
// list beneath it.
export function dedupeByWorkspaceRoot<F extends FolderLike>(
  found: readonly AnchoredFolder<F>[],
): AnchoredFolder<F>[] {
  const out: AnchoredFolder<F>[] = [];
  const roots = new Set<string>();
  for (const entry of found) {
    const root = workspaceRootOf(entry);
    if (roots.has(root)) { continue; }
    roots.add(root);
    out.push(entry);
  }
  return out;
}

// CandidateFileSearch looks inside ONE open folder for files that might anchor a
// workspace, answering with their absolute paths.
//
// It arrives as an argument rather than being called directly because the search
// is the editor's, and this module holds no editor type — which is what keeps
// the reach rule below drivable against a real directory tree with no editor
// running. The search narrows; it decides nothing. Every path it answers with is
// still confirmed through findAggregaWorkspaceAnchor, so a pattern that is too
// wide can only produce a candidate the confirmation drops.
export type CandidateFileSearch<F extends FolderLike = FolderLike> =
  (folder: F) => Promise<readonly string[]>;

// workspacesReachedFrom answers with the Aggrega workspaces one open folder
// reaches: the one found by walking UP from it, and every one found by looking
// DOWN inside it.
//
// 🔴 REACHING IS NOT CONTAINING, AND THE DIFFERENCE IS THE WHOLE RULE. The walk
// climbs, so the workspace a folder reaches is frequently its parent — a folder
// opened inside a larger repository reaches the repository's root and contains
// nothing at all. A rule phrased as containment deletes that reader's only
// workspace, which is the commonest way to open one of these projects.
//
// Both directions are needed and neither subsumes the other. The walk finds the
// workspace above a folder that holds no marker of its own, which no search
// inside that folder can see. The search finds the workspaces beneath a folder
// that already sits in one, which the walk stops at the first of and never
// reports. Answering with one direction alone loses a population the reader has.
//
// The walk's answer comes first because it is the one the editor already acts
// on, so a caller that takes only what it needs takes the same workspace the
// language server attaches to.
export async function workspacesReachedFrom<F extends FolderLike>(
  folder: F,
  search: CandidateFileSearch<F>,
): Promise<AnchoredFolder<F>[]> {
  const found: AnchoredFolder<F>[] = [];
  const climbed = await findAggregaWorkspaceAnchor(folder.uri.fsPath);
  if (climbed !== null) {
    found.push({ folder, anchorPath: climbed });
  }
  const directories = new Set<string>();
  for (const file of await search(folder)) {
    directories.add(path.dirname(file));
  }
  // Sorted so the order a reader is shown is stable between invocations; the
  // editor's own search makes no promise about the order it answers in.
  for (const directory of [...directories].sort()) {
    const anchorPath = await findAggregaWorkspaceAnchor(directory);
    if (anchorPath === null) { continue; }
    found.push({ folder, anchorPath });
  }
  return dedupeByWorkspaceRoot(found);
}

// workspacesReachedFromAll answers with every Aggrega workspace a set of open
// folders reaches between them.
//
// 🔴 IT IS THE SAME RULE AS ABOVE READ AT A WIDER SCOPE, NEVER A SET WITH A
// FILTER OVER IT. The population a window offers and the population one chosen
// folder offers are computed by one function called with different arguments, so
// there is nothing that could decide the two differently. That is what a choice
// at the outer level scoping the level beneath it means here: the narrowed list
// is this same reach asked at one folder instead of at all of them.
//
// Every entry carries the folder it was reached FROM, which is what lets a
// caller say where a workspace came from without asking a question that has more
// than one true answer.
export async function workspacesReachedFromAll<F extends FolderLike>(
  folders: readonly F[],
  search: CandidateFileSearch<F>,
): Promise<AnchoredFolder<F>[]> {
  const found: AnchoredFolder<F>[] = [];
  for (const folder of folders) {
    found.push(...await workspacesReachedFrom(folder, search));
  }
  return dedupeByWorkspaceRoot(found);
}

// rememberedWorkspaceReached answers with the entry for a remembered Aggrega
// workspace, by its marker, where one of `folders` still reaches it, and null where
// none does.
//
// 🔴 IT ASKS THE TWO QUESTIONS THE REACH ASKS, OF ONE MARKER, AND NEEDS NO SEARCH
// TO ASK THEM. The reach finds a workspace by walking up from a folder, and by
// confirming through discovery the directory of each candidate file the editor's
// search lists inside it. A remembered marker already names its own directory, so
// the second question is put to it directly: its root sits at or inside the
// folder, and discovery asked from that root still answers with this marker, which
// is the answer the reach takes from the files marking that root. That is what lets
// a choice made below the folder be honoured as the window is evaluated, with
// nothing waiting on a glob across everything the window holds. And it is
// discovery's answer rather than a test beside it, so a marker that has been
// deleted, or that a workspace configuration further up now claims, is reached by
// neither question. It is still a second derivation of the reach's population,
// held to one answer with it by a test that computes both over real directories.
//
// The folder carried is the first, in the window's own order, that reaches the
// marker, asked the walk before the look inside — the order the reach keeps — so
// the entry is the one the fuller population lists for that workspace.
export async function rememberedWorkspaceReached<F extends FolderLike>(
  anchorPath: string,
  folders: readonly F[],
): Promise<AnchoredFolder<F> | null> {
  const root = workspaceRootOf({ anchorPath });
  for (const folder of folders) {
    if (await findAggregaWorkspaceAnchor(folder.uri.fsPath) === anchorPath) {
      return { folder, anchorPath };
    }
    if (relativeIfInside(folder.uri.fsPath, root) !== null && await findAggregaWorkspaceAnchor(root) === anchorPath) {
      return { folder, anchorPath };
    }
  }
  return null;
}

// heuristicMarkerInDir reports the highest-priority heuristic marker present in
// dir (.aggrega/ then a file whose name begins `aggregate`, `release` or
// `manifest` in either YAML spelling, lockfiles excluded), or null. Only the
// name is read, never the document — a marker says a workspace is here, not
// what the file holds. The `workspace:`-config tier is handled by the caller,
// which gives it cross-directory precedence over these heuristics.
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
        endsWithAny(name, YAML_SUFFIXES) &&
        !endsWithAny(name, LOCKFILE_SUFFIXES)
      ) {
        return path.join(dir, name);
      }
    }
  }
  return null;
}

function endsWithAny(name: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

// hasWorkspaceBlock reports whether the file at p exists and carries a
// top-level `workspace` key — the marker that anchors a workspace root. A file
// without it (a bare settings/global config) does not anchor. This is the
// client-side, pre-daemon counterpart to the Go side's raw-document
// `workspace` probe; both treat presence of the key — including the empty
// `workspace: {}` form — as the marker. It asks the compiler's question in this
// language and reads none of the compiler's code: the cross-language parity
// test is what holds the two answers together, over the shared fixtures.
//
// 🔴 THE DOCUMENT IS PARSED RATHER THAN SCANNED FOR A LINE, BECAUSE A LINE
// SHAPED LIKE THE KEY IS NOT ALWAYS THE KEY AND THE KEY IS NOT ALWAYS A LINE.
// A document whose root is a block scalar is one string, so a `workspace:`
// line inside it names nothing. A flow mapping, `{workspace: {}}`, carries the
// key with no line beginning with it. A quoted key is the same key as a bare
// one. Each of those is a question about what the document IS rather than how
// its lines read, and a parse answers every one of them the way the compiler's
// discovery does, with no special case for any.
//
// It reads that one key and judges nothing else. A file whose other settings
// the compiler would refuse still anchors here, because whether the rest of
// the file is acceptable is the compiler's question and not discovery's.
//
// A document that does not parse anchors nothing. That is the compiler's
// answer too: its discovery finds no key in a file it cannot read, and climbs
// on past it, so a Release in a folder below that file roots the workspace
// there for both. What it costs is one reader: the one whose only marker is a
// configuration that is unreadable when the editor looks for the workspace,
// who is told that no workspace is available rather than shown what is wrong
// with the file.
async function hasWorkspaceBlock(p: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(p, 'utf8');
  } catch {
    return false;
  }
  return firstDocumentCarriesWorkspaceKey(content);
}

// firstDocumentCarriesWorkspaceKey reports whether the first document of a YAML
// text parses to a mapping with a top-level `workspace` key.
//
// Only the first document is asked, because it is the only one the compiler's
// discovery reads: a key in a later document marks nothing. The parser builds
// every document before it answers, though, so a later document that does not
// parse makes this answer no where the compiler, reading the first alone,
// answers yes.
function firstDocumentCarriesWorkspaceKey(content: string): boolean {
  let first: unknown;
  try {
    [first] = loadAll(content);
  } catch {
    return false;
  }
  // A mapping is the one node that carries keys. A sequence arrives as an
  // array and is refused by name; a scalar arrives as a value with no own
  // `workspace` property, which the last test refuses.
  return typeof first === 'object'
    && first !== null
    && !Array.isArray(first)
    && Object.hasOwn(first, 'workspace');
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}
