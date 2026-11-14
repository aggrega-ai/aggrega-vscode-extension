// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as l10n from './l10n';

// The three levels the editor works within, named once.
//
// They sit apart from the module that draws them as rows because the names are
// read by surfaces that draw no row: the explanation behind the status-bar
// indicator names the level a Release sits inside, and the sentence that says a
// level holds only one candidate is written per level. Keeping the names in the
// row module would make every one of those surfaces depend on how rows are
// composed — and for the module that describes a Release selection it is not
// merely undesirable but impossible, because the row module already reads that
// description and the dependency would then run both ways.

// SELECTOR_ROW_KEYS names the three levels in display order, and THE ORDER IS
// THE TEACHING.
//
// Three things nest — the folder the editor is working in, the Aggrega
// workspace reached from it, and the Release chosen inside that — and the
// arrangement is what shows a reader they nest. Explaining it in a sentence
// instead was the alternative and it is the wrong repair: the surface a reader
// meets first already carries more prose than anyone reads, so a fourth
// paragraph about containment would be read by nobody who needed it.
export const SELECTOR_ROW_KEYS = ['project', 'workspace', 'release'] as const;

export type SelectorRowKey = (typeof SELECTOR_ROW_KEYS)[number];

// SELECTOR_ROW_LABELS is the one home of the three names a reader is taught, so
// no two sentences written about a row can come to call its level two
// different things. A row draws the middle one shortened
// (SELECTOR_ROW_DRAWN_LABELS, below) and names it in full on its hover.
//
// THE MIDDLE ONE CARRIES THE PRODUCT NAME, and that is the point rather than
// verbosity. "Workspace" on its own already names the set of folders a window
// has open, so a row labelled with the bare word names two different things at
// once — which is the confusion these rows exist to remove rather than one to
// inherit.
//
// The last is the entity's own name, which stays as authored in every language,
// so it is not looked up.
export const SELECTOR_ROW_LABELS: Record<SelectorRowKey, string> = {
  project: l10n.t('Project folder'),
  workspace: l10n.t('Aggrega workspace'),
  release: 'Release',
};

// SELECTOR_ROW_DRAWN_LABELS is what each row draws as its label, and the one
// home of the shortened form.
//
// ONLY THE MIDDLE ONE DIFFERS FROM ITS LEVEL'S NAME, and only where it is drawn.
// The three rows share one label column as wide as the widest label, and the
// value is given what that column leaves; at the side bar's default width the
// long form of the middle name left each value too few characters to tell two
// values apart. Drawn as "Agg. worksp." it keeps the product name — the reason
// the name carries it — in less room, and every value gains what it gives
// up. Everything else that names the level keeps the long form: the row's own
// hover opens with it, and every sentence about the row is written from
// SELECTOR_ROW_LABELS above.
export const SELECTOR_ROW_DRAWN_LABELS: Record<SelectorRowKey, string> = {
  project: SELECTOR_ROW_LABELS.project,
  workspace: l10n.t('Agg. worksp.'),
  release: SELECTOR_ROW_LABELS.release,
};

// soleCandidateNote is the sentence a level's hover adds when it holds exactly
// one candidate, in the level's own name, from the one place those names are
// written.
//
// A chooser holding a single entry can read as broken — a reader presses it,
// meets a list of one, and cannot tell whether that is the answer or a failure
// to look — so a level may say there is only one before they press. The Project
// folder row says it, and then closes on what a press there does offer rather
// than on an invitation to choose between folders. The Aggrega workspace and
// Release rows do not say it, so their hovers stay short enough to read, and
// their choosers list what there is.
//
// Each level is its own whole message, spelling SELECTOR_ROW_LABELS[key] rather
// than taking it as a placeholder: the name is a noun after "one" there, so a
// translation has to give it the article and case the sentence needs.
export function soleCandidateNote(key: SelectorRowKey): string {
  switch (key) {
    case 'project':
      return l10n.t('Only one Project folder is available, so there are no others to choose between.');
    case 'workspace':
      return l10n.t('Only one Aggrega workspace is available, so there are no others to choose between.');
    case 'release':
      return l10n.t('Only one Release is available, so there are no others to choose between.');
  }
}
