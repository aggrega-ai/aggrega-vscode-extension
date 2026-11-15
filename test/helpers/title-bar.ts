// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// The Commands panel's title bar, named once.
//
// 🔴 THIS EXISTS BECAUSE THE SAME EXPECTATION WAS HAND-WRITTEN IN FOUR SPECS AT
// ONCE, AND FOUR COPIES OF ONE VALUE AGREE UNTIL THE DAY THE VALUE MOVES. Each of
// those specs asserts something about its own panel — that its operations are on
// the Commands panel as labelled buttons rather than as hover-revealed icons in a
// title bar — and each expressed it by comparing the Commands title bar against a
// literal list. Adding one correct entry to that bar therefore failed four specs
// that have nothing to do with it, each reporting as though the entry were the
// defect.
//
// The comparison stays an EQUALITY rather than becoming a presence check, because
// a presence reading passes however many entries were added beside the one it
// looked for, and "these and no others" is the whole claim. What changes is that
// the expectation has one home.

// COMMANDS_PANEL_VIEW is the condition an entry declares to sit on the Commands
// panel's title bar.
export const COMMANDS_PANEL_VIEW = 'view == aggrega.operations';

// COMMANDS_TITLE_BAR_ENTRIES is every command contributed there, sorted.
//
// 🔴 EACH ONE IS ADMITTED BY THE SAME TEST AND THE LIST IS NOT THE TEST. An entry
// belongs on a view's title bar when it is not an operation on anything the panel
// holds: the settings entry opens the reader's own preferences, and the way back
// opens a surface belonging to the extension. An operation on the workspace
// belongs in the panel's own flow, as a labelled button a reader can see, rather
// than as an unlabelled icon revealed by hovering a header.
//
// So a new entry here is not automatically wrong — it is a claim to check against
// that test. What the comparison catches is the entry added without anyone
// checking.
//
// The Draft button passes the same test: it acts on nothing a panel holds — it
// writes a new document or a new folder — and it is drawn in every Aggrega
// panel's title bar and the Explorer's alike, so a reader meets it wherever they
// start, including in a window with no Aggrega folder open.
export const COMMANDS_TITLE_BAR_ENTRIES: readonly string[] = [
  'aggrega.getStarted.open',
  'aggrega.op.draft',
  'aggrega.settings.open',
];

// DRAFT_BUTTON is the Draft button's command, which every Aggrega panel's title
// bar carries beside what belongs to that view.
export const DRAFT_BUTTON = 'aggrega.op.draft';

// MenuContribution is the shape a `view/title` entry is read back as. It is
// declared here rather than in each caller so the four readings of one
// contribution cannot describe it differently.
export interface MenuContribution {
  command: string;
  when?: string;
  group?: string;
}

// commandsPanelTitleBar reports what the manifest contributes to that title bar,
// sorted, so a comparison against the list above is not also a claim about the
// order entries happen to be written in.
export function commandsPanelTitleBar(entries: readonly MenuContribution[]): string[] {
  return entries
    .filter((m) => m.when === COMMANDS_PANEL_VIEW)
    .map((m) => m.command)
    .sort();
}
