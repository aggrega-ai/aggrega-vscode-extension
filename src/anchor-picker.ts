// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { AnchoredFolder, FolderLike } from './workspace';

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

// Decision captures the four-way outcome of classifyActivation.
// 'none' — zero anchored folders; the extension should no-op.
// 'single' — one anchored folder; attach the daemon to it silently.
// 'multiSaved' — multiple anchored, valid saved choice; attach silently.
// 'multiPrompt' — multiple anchored, no valid saved choice; surface
//   the status-bar "Choose folder…" label and toast.
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

// isSavedAnchorValid checks whether the saved path still matches an
// anchored folder in the current workspace. A saved path that names a
// folder no longer anchored (folder removed, marker deleted) is
// stale.
export function isSavedAnchorValid<F extends FolderLike>(
  savedPath: string | null,
  anchored: readonly AnchoredFolder<F>[],
): boolean {
  if (savedPath === null) { return false; }
  return anchored.some(a => a.anchorPath === savedPath);
}

// classifyActivation returns the four-way decision used by the
// extension activation path and the workspaceFolders change handler.
// Both call sites share this function so single-folder activation,
// multi-folder activation with prior choice, multi-folder activation
// without prior choice, and zero-folder activation all dispatch
// uniformly.
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

// buildPickerItems renders each anchored folder into a three-piece
// display. Folder basenames disambiguate via parent-basename when
// two folders share the same basename (e.g.,
// ~/projects/foo/web/ + ~/projects/bar/web/ render as `web (foo)` +
// `web (bar)`). The detail field carries the marker name
// (path.basename of the anchor path).
export function buildPickerItems<F extends FolderLike>(
  anchored: readonly AnchoredFolder<F>[],
): PickerItem<F>[] {
  const basenameCounts = new Map<string, number>();
  for (const a of anchored) {
    const bn = path.basename(a.folder.uri.fsPath);
    basenameCounts.set(bn, (basenameCounts.get(bn) ?? 0) + 1);
  }

  return anchored.map(a => {
    const folderPath = a.folder.uri.fsPath;
    const bn = path.basename(folderPath);
    const collides = (basenameCounts.get(bn) ?? 0) > 1;
    const label = collides
      ? `${bn} (${path.basename(path.dirname(folderPath))})`
      : bn;
    return {
      label,
      description: folderPath,
      detail: path.basename(a.anchorPath),
      anchored: a,
    };
  });
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

// AnchorOffer is one entry in what the workspace row opens when clicked: either
// a folder that is attached now, or the way to make another one available.
//
// THE TWO ARE ONE LIST RATHER THAN TWO STEPS, and that is the point. A reader
// clicking the row is asking which folder the editor works in and whether they
// can change it; the honest answer is the folders available now together with
// how to make another available. Putting the second behind a prior choice would
// be a choice before the choice, which is the shape the row is being kept away
// from.
//
// The kind is carried rather than inferred from a missing field, so a caller
// dispatching on it cannot silently treat a widening offer as a folder to
// attach to.
export type AnchorOffer<F extends FolderLike = FolderLike> =
  | ({ kind: 'anchored' } & PickerItem<F>)
  | { kind: 'widen'; label: string; description: string; detail: string };

// anchorOffers composes what the workspace row offers: every attached folder,
// then the route to widening.
//
// The folder entries are not shaped here — buildPickerItems above stays their
// one home, so the basename disambiguation cannot come to differ between the
// activation prompt and this offer. What this adds is the trailing entry and
// the order.
//
// A SOLE ATTACHED FOLDER IS STILL OFFERED RATHER THAN THE OFFER BEING DECLINED.
// This is the reader asking which folder the editor works in, and answering a
// request to choose by refusing to show the choice leaves them unable to tell
// that anything ran — the same reason the Release selection offers its sole
// candidate. It is also why the workspace row's tooltip needs no count: the
// click always opens a choice, so its promise holds however many folders are
// attached.
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

// activeFolderLabel renders the status-bar text for an attached
// daemon when the workspace has 2+ anchored folders. With one or
// zero anchored, callers should display the existing single-folder
// label instead. Basename-collision disambiguation matches
// buildPickerItems.
export function activeFolderLabel<F extends FolderLike>(
  active: AnchoredFolder<F>,
  anchored: readonly AnchoredFolder<F>[],
): string {
  const basenameCounts = new Map<string, number>();
  for (const a of anchored) {
    const bn = path.basename(a.folder.uri.fsPath);
    basenameCounts.set(bn, (basenameCounts.get(bn) ?? 0) + 1);
  }
  const bn = path.basename(active.folder.uri.fsPath);
  const collides = (basenameCounts.get(bn) ?? 0) > 1;
  return collides
    ? `Aggrega · ${bn} (${path.basename(path.dirname(active.folder.uri.fsPath))})`
    : `Aggrega · ${bn}`;
}
