// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { AnchoredFolder, FolderLike, workspaceRootOf } from './workspace';
import { SELECTOR_ROW_LABELS } from './selector-levels';

// STATE_KEY is the workspaceState entry under which the active
// anchor's absolute path is persisted across VS Code sessions.
export const STATE_KEY = 'aggrega.activeAnchor';

// PickerItem captures the three-piece display the quick-pick renders
// (label / description / detail) plus the underlying anchored folder
// the operator is picking. The shape is kept structural so callers
// can map it onto vscode.QuickPickItem without this module importing
// the vscode namespace.
export interface PickerItem<F extends FolderLike = FolderLike> {
  label: string;
  description: string;
  detail: string;
  anchored: AnchoredFolder<F>;
}

// Decision captures the four-way outcome of classifyActivation. It counts
// Aggrega workspaces rather than open folders, because that is what
// findAllAnchoredFolders answers with and what the reader is choosing between.
// 'none' — no workspace reachable; the extension should no-op.
// 'single' — one workspace; attach the language server to it silently.
// 'multiSaved' — several reachable, valid saved choice; attach silently.
// 'multiPrompt' — several reachable, no valid saved choice; surface
//   the status-bar prompt and the toast, both of which offer the choice in
//   the one wording written below.
export type Decision<F extends FolderLike = FolderLike> =
  | { kind: 'none' }
  | { kind: 'single'; target: AnchoredFolder<F> }
  | { kind: 'multiSaved'; target: AnchoredFolder<F> }
  | { kind: 'multiPrompt'; anchored: AnchoredFolder<F>[] };

// WorkspaceStateLike is the structural subset of
// vscode.ExtensionContext.workspaceState that this module consumes.
// Tests pass a minimal Map-backed implementation.
export interface WorkspaceStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

// readSavedAnchor returns the saved active-anchor path or null.
// A non-string value (or absent key) reads as null.
export function readSavedAnchor(state: WorkspaceStateLike): string | null {
  const v = state.get<unknown>(STATE_KEY);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// rememberAnchorChoice records which anchored folder this window works in, and
// answers with the path it replaced.
//
// 🔴 IT IS THE ONE HOME OF THAT WRITE, AND THE READ ABOVE IS WHY. classifyActivation
// lets a still-valid remembered choice outrank everything else that moved, so a
// surface through which a reader NAMES a folder has to record the answer here or
// the reader's choice loses to the one they are trying to leave. The read and the
// write are one mechanism seen from its two sides; held apart, a surface that
// offers a choice and a surface that honours one would agree until either was
// reworded.
//
// Returning the previous path is what lets a caller that could not finish the move
// put it back, rather than leaving the window remembering a folder it never
// reached — which the next re-evaluation would drop, telling the reader a folder
// they never chose had stopped being anchored.
//
// A null path forgets the choice. It is spelled that way rather than as the
// editor's own absent-value convention so that callers state an intention instead
// of a storage detail.
export async function rememberAnchorChoice(
  state: WorkspaceStateLike,
  anchorPath: string | null,
): Promise<string | null> {
  const previous = readSavedAnchor(state);
  await state.update(STATE_KEY, anchorPath ?? undefined);
  return previous;
}

// isSavedAnchorValid checks whether the saved path still matches a workspace
// this window reaches. A saved path naming a marker nothing climbs to any more
// (folder removed, marker deleted) is stale.
//
// It compares markers, which is what makes a remembered choice survive the
// de-duplication above: the entry kept for a workspace reached from several
// folders carries the same marker whichever folder came first, so a choice
// recorded before a folder was added or removed still matches afterwards.
export function isSavedAnchorValid<F extends FolderLike>(
  savedPath: string | null,
  anchored: readonly AnchoredFolder<F>[],
): boolean {
  if (savedPath === null) { return false; }
  return anchored.some(a => a.anchorPath === savedPath);
}

// classifyActivation returns the four-way decision used by the
// extension activation path and the workspaceFolders change handler.
// Both call sites share this function so one-workspace activation,
// several-workspace activation with prior choice, several without prior
// choice, and no-workspace activation all dispatch uniformly.
//
// 🔴 IT BRANCHES ON HOW MANY AGGREGA WORKSPACES THERE ARE, WHICH IS NOT HOW
// MANY OPEN FOLDERS REACH ONE. Those two counts part company the moment a
// window has two folders under one marker, and branching on the second would
// prompt a reader to choose between two entries that are the same workspace.
// findAllAnchoredFolders is what makes the input the first count; this function
// reads its length and adds nothing to it.
export function classifyActivation<F extends FolderLike>(
  anchored: readonly AnchoredFolder<F>[],
  savedPath: string | null,
): Decision<F> {
  if (anchored.length === 0) {
    return { kind: 'none' };
  }
  if (anchored.length === 1) {
    return { kind: 'single', target: anchored[0] };
  }
  if (isSavedAnchorValid(savedPath, anchored)) {
    const target = anchored.find(a => a.anchorPath === savedPath)!;
    return { kind: 'multiSaved', target };
  }
  return { kind: 'multiPrompt', anchored: [...anchored] };
}

// buildPickerItems renders each entry into a three-piece display. Basenames
// disambiguate via parent-basename when two entries share one (e.g.,
// ~/projects/foo/web/ + ~/projects/bar/web/ render as `web (foo)` +
// `web (bar)`). The detail field carries the marker name
// (path.basename of the anchor path).
//
// 🔴 IT NAMES THE WORKSPACE ROOT, NEVER THE OPEN FOLDER THE SERVER IS STARTED
// AT. One entry stands for one Aggrega workspace, and the folder it carries is
// whichever of the several that reach it came first — so naming that folder
// would put an arbitrary answer in front of a reader as though it were the
// thing they are choosing. A reader picking `a` and finding themselves working
// in its parent has been told something untrue by the only text they were
// given.
export function buildPickerItems<F extends FolderLike>(
  anchored: readonly AnchoredFolder<F>[],
): PickerItem<F>[] {
  const basenameCounts = new Map<string, number>();
  for (const a of anchored) {
    const bn = path.basename(workspaceRootOf(a));
    basenameCounts.set(bn, (basenameCounts.get(bn) ?? 0) + 1);
  }

  return anchored.map(a => {
    const root = workspaceRootOf(a);
    const bn = path.basename(root);
    const collides = (basenameCounts.get(bn) ?? 0) > 1;
    const label = collides
      ? `${bn} (${path.basename(path.dirname(root))})`
      : bn;
    return {
      label,
      description: root,
      detail: path.basename(a.anchorPath),
      anchored: a,
    };
  });
}

// CHOOSE_ANCHOR_INVITATION is the offer to change which Aggrega workspace the
// editor works in, as the closing line of a hover.
//
// It names the level rather than a folder, and that is the correction rather
// than a rewording: the choice is between Aggrega workspaces, and one of them
// may be reached from two open folders at once — so "which folder" described a
// question this surface deliberately does not ask.
//
// It lives beside the choice's own read and write for the reason they live
// together. Three surfaces offer this one choice — the selector row, the
// status-bar prompt, and the chooser itself — and a reader who reaches it from
// one must not be told something different by another.
export const CHOOSE_ANCHOR_INVITATION =
  `Click to choose which ${SELECTOR_ROW_LABELS.workspace} the editor works in.`;

// CHOOSE_ANCHOR_PLACEHOLDER is the same offer as the chooser's own placeholder.
//
// A placeholder is read inside the control it belongs to, so it drops the
// instruction to click — the reader has already clicked — and takes the product
// prefix every quick-pick in this extension carries.
export const CHOOSE_ANCHOR_PLACEHOLDER =
  `Aggrega: choose which ${SELECTOR_ROW_LABELS.workspace} the editor works in`;

// CHOOSE_ANCHOR_ACTION is the same offer again, compressed to a control's own
// label — the status-bar prompt, and the button on the activation notice.
//
// It drops the product prefix the two longer forms carry, because the level's
// own name already holds it, and it keeps the full name rather than shortening
// to "workspace": that word names the set of folders a window has open, and a
// control read on its own, in a status bar or by a screen reader, has nothing
// around it to settle which of the two is meant.
export const CHOOSE_ANCHOR_ACTION = `Choose ${SELECTOR_ROW_LABELS.workspace}…`;

// anchorsAvailableSentence reports how many Aggrega workspaces this window
// reaches, for the two surfaces that say so before offering the choice.
//
// It counts workspaces rather than open folders because that is what
// findAllAnchoredFolders answers with; saying "folders" here would report a
// number the reader cannot reconcile with the list they are about to be shown.
export function anchorsAvailableSentence(count: number): string {
  return `${count} ${SELECTOR_ROW_LABELS.workspace}s are available in this project.`;
}

// WIDEN_ANCHOR_OFFER_DETAIL explains, on the offer's second line, what
// choosing it does — that the folder is one already inside the open workspace,
// and that taking it adds it rather than opening something elsewhere.
export const WIDEN_ANCHOR_OFFER_DETAIL =
  'Looks through the folders you have open for one Aggrega recognises, and adds it.';

// widenAnchorOfferLabel is the offer's label, and it is graded on whether
// anything is attached yet: "another" is true only when there is already one to
// be another of. The word is the difference between an accurate offer and one
// that implies a folder the reader does not have.
export function widenAnchorOfferLabel(anchoredCount: number): string {
  return anchoredCount === 0
    ? 'Choose a folder Aggrega recognises…'
    : 'Choose another folder Aggrega recognises…';
}

// AnchorOffer is one entry in what the Aggrega workspace row opens when
// clicked: either a workspace the window reaches now, or the way to make
// another one available.
//
// THE TWO ARE ONE LIST RATHER THAN TWO STEPS, and that is the point. A reader
// clicking the row is asking which Aggrega workspace the editor works in and
// whether they can change it; the honest answer is the workspaces reachable now
// together with how to make another reachable. Putting the second behind a
// prior choice would be a choice before the choice, which is the shape the row
// is being kept away from.
//
// The kind is carried rather than inferred from a missing field, so a caller
// dispatching on it cannot silently treat a widening offer as a folder to
// attach to.
export type AnchorOffer<F extends FolderLike = FolderLike> =
  | ({ kind: 'anchored' } & PickerItem<F>)
  | { kind: 'widen'; label: string; description: string; detail: string };

// anchorOffers composes what the Aggrega workspace row offers: every workspace
// the window reaches, then the route to widening.
//
// The entries are not shaped here — buildPickerItems above stays their one
// home, so the basename disambiguation cannot come to differ between the
// activation prompt and this offer. What this adds is the trailing entry and
// the order.
//
// A SOLE REACHABLE WORKSPACE IS STILL OFFERED RATHER THAN THE OFFER BEING DECLINED.
// This is the reader asking which Aggrega workspace the editor works in, and
// answering a request to choose by refusing to show the choice leaves them
// unable to tell that anything ran — the same reason the Release selection
// offers its sole candidate. It is also why the row's closing sentence needs no
// count: the click always opens a choice, so its promise holds however many
// workspaces are reachable.
export function anchorOffers<F extends FolderLike>(
  anchored: readonly AnchoredFolder<F>[],
): AnchorOffer<F>[] {
  const offers: AnchorOffer<F>[] = buildPickerItems(anchored).map(
    (item) => ({ kind: 'anchored' as const, ...item }),
  );
  offers.push({
    kind: 'widen',
    label: widenAnchorOfferLabel(anchored.length),
    description: '',
    detail: WIDEN_ANCHOR_OFFER_DETAIL,
  });
  return offers;
}

// anchorSwitchMessage is what a reader is told when the language server is being
// restarted at a different folder.
//
// THE RESTART IS ANNOUNCED RATHER THAN MERELY PERFORMED, and that is the whole
// reason this exists. Every request the extension makes is resolved against the
// anchored folder, so a reader who is not told the folder moved cannot tell a
// result computed against the folder they left from one computed against the
// folder they asked for — and a wrong value read as a right one contaminates
// every judgement made near it. A restart the reader has to infer from a status
// bar that flickers is one they will not infer.
//
// It names the full path rather than a basename: two folders open in one window
// can share a basename, which is the very collision the folder picker above
// disambiguates, and a message is read without the picker's side-by-side context.
export function anchorSwitchMessage(workspaceRoot: string): string {
  return `Aggrega: now working in ${workspaceRoot}. The language server is restarting there.`;
}

// activeWorkspaceLabel renders the status-bar text for an attached language
// server when the window reaches 2+ Aggrega workspaces. With one or zero,
// callers should display the existing single-workspace label instead.
// Basename-collision disambiguation matches buildPickerItems, and so does the
// thing named: the workspace root, not the open folder the server was started
// at, for the reason written there.
export function activeWorkspaceLabel<F extends FolderLike>(
  active: AnchoredFolder<F>,
  anchored: readonly AnchoredFolder<F>[],
): string {
  const basenameCounts = new Map<string, number>();
  for (const a of anchored) {
    const bn = path.basename(workspaceRootOf(a));
    basenameCounts.set(bn, (basenameCounts.get(bn) ?? 0) + 1);
  }
  const root = workspaceRootOf(active);
  const bn = path.basename(root);
  const collides = (basenameCounts.get(bn) ?? 0) > 1;
  return collides
    ? `Aggrega · ${bn} (${path.basename(path.dirname(root))})`
    : `Aggrega · ${bn}`;
}
