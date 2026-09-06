// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The get-started list is the editor's answer to "I have installed this; what
// now". It is a VIEW rather than a dialog, and that is a decision rather than a
// default.
//
// WHY A VIEW AND NOT A MODAL DIALOG. A dialog takes the editor away and has to
// be dismissed before anything can be looked at — and every step here asks the
// reader to point at something in their own workspace: which folder, which
// Release, where their compiler is. A reader cannot answer any of those while a
// dialog is covering the files that hold the answers. A view sits beside them.
// A dialog is the shape someone reaches for by default, which is why the reason
// is written here rather than left to be re-derived.
//
// WHY THE STEPS READ THE CURRENT STATE INSTEAD OF ASKING. Many readers arrive
// having already built a working configuration from the command line, and a
// list that only knows how to create things treats them as though they had
// nothing. Each step below is a CONDITION the extension genuinely needs, read
// from what is already true, so a reader who has met it sees it met and is
// asked nothing.
//
// WHY EVERY STEP OFFERS TWO PATHS. For the same reason: one path brings the
// thing into being, the other points at the one you already have, and both end
// in the same state. A step that only knew how to create would walk that reader
// through making what they have.
//
// This module holds no editor types, so what a reader is shown — which steps
// exist, which is met, and the exact condition each entry is drawn under — is
// assertable without an extension host.

// GET_STARTED_VIEW_ID is the view the list is drawn in, as the manifest
// declares it.
//
// The list is contributed to the editor rather than drawn by this extension, so
// it is on screen for a reader whose workspace has activated nothing at all —
// which is precisely the reader who has nothing configured yet. Drawing it from
// code would reach only the readers who already have enough set up to start the
// extension.
export const GET_STARTED_VIEW_ID = 'aggrega.getStarted';

// GET_STARTED_SHOW_SETTING is the preference that decides whether the list
// appears. It is the reader's own, like every other preference here, and it is
// never written into a project.
//
// WHY A PREFERENCE RATHER THAN EDITOR-LOCAL STATE, WHICH WOULD ALSO BE
// PER-READER. The editor evaluates a `config.`-prefixed condition itself,
// against the settings it has already loaded, without starting any extension.
// Storage private to this extension can only be read once this extension is
// running — so a reader who dismissed the list would be shown it again in the
// one situation where nothing else has started the extension, which is exactly
// the situation the list is for. The preference is what makes the dismissal
// hold on the next window.
export const GET_STARTED_SHOW_SETTING = 'aggrega.getStarted.show';

// GET_STARTED_VIEW_WHEN is the condition the view itself is drawn under. The
// manifest carries this string; a conformance assertion holds the two in step,
// so a hand edit that drifted from it fails rather than leaving a list nothing
// can turn off.
export const GET_STARTED_VIEW_WHEN = `config.${GET_STARTED_SHOW_SETTING}`;

// StepId names one condition the extension needs before it can do the work it
// is for.
export type StepId = 'workspace' | 'compiler' | 'release' | 'registry';

// STEP_IDS is the list in the order a reader meets it, and the order is not
// arbitrary: each step's own remedy needs the ones above it. Choosing a Release
// needs a compiler to enumerate the candidates, and running the compiler needs
// somewhere to run it.
export const STEP_IDS: readonly StepId[] = ['workspace', 'compiler', 'release', 'registry'];

// GetStartedFacts is what the four conditions are read from. Each field is a
// fact some other part of the extension already owns, passed in rather than
// re-derived here — a second derivation would agree until the day it did not.
export interface GetStartedFacts {
  // workspaceAnchored is whether a folder the compiler recognises has been
  // resolved. Without one the language server is not started at all and every
  // operation has nowhere to run.
  workspaceAnchored: boolean;
  // compilerAnswering is whether the language server can be asked right now.
  compilerAnswering: boolean;
  // releaseSelected is whether a Release is selected. Building, previewing and
  // the topology graph each act on one, so the editor needs to know which.
  releaseSelected: boolean;
  // registryConfigured is whether the resolved configuration names at least one
  // registry. Without one, pulling dependencies and searching the published
  // catalog have nothing to resolve against.
  registryConfigured: boolean;
}

// stepContextKey is the condition key the editor evaluates a step's entry
// against. One key per step, named for the step, so the manifest entry and the
// code that sets it cannot drift onto different spellings.
export function stepContextKey(id: StepId): string {
  return `aggrega.getStarted.${id}Ready`;
}

// stepWhenClause is the exact condition string a step's entry carries in the
// manifest — one for the met form and one for the unmet form.
//
// This is the one home for those strings. The manifest is declarative data the
// editor reads and nothing here can generate into it, so the two are held
// together by a conformance assertion reading the manifest back against this
// function. Without that, an entry could carry a condition naming a key nobody
// sets, and the symptom would be a step that silently never reports itself met.
export function stepWhenClause(id: StepId, met: boolean): string {
  const key = stepContextKey(id);
  return met ? key : `!${key}`;
}

// stepMet reports whether one condition already holds.
export function stepMet(id: StepId, facts: GetStartedFacts): boolean {
  switch (id) {
    case 'workspace':
      return facts.workspaceAnchored;
    case 'compiler':
      return facts.compilerAnswering;
    case 'release':
      return facts.releaseSelected;
    case 'registry':
      return facts.registryConfigured;
  }
}

// stepStandings reports every condition at once, which is what the surface sets
// the editor's condition keys from.
export function stepStandings(facts: GetStartedFacts): Record<StepId, boolean> {
  return {
    workspace: stepMet('workspace', facts),
    compiler: stepMet('compiler', facts),
    release: stepMet('release', facts),
    registry: stepMet('registry', facts),
  };
}

// unmetStepIds lists the conditions still outstanding, in list order.
export function unmetStepIds(facts: GetStartedFacts): StepId[] {
  return STEP_IDS.filter((id) => !stepMet(id, facts));
}

// EVERYTHING_MET is the state of a reader who built their configuration
// elsewhere and has just opened the editor on it. It is named rather than
// spelled out at each use because it is the state the list is measured against:
// such a reader must be asked nothing, and the only thing left to press is the
// one control that puts the list away.
export const EVERYTHING_MET: GetStartedFacts = {
  workspaceAnchored: true,
  compilerAnswering: true,
  releaseSelected: true,
  registryConfigured: true,
};

// NOTHING_MET is the opposite end: a reader who has just installed the
// extension and opened a folder with nothing in it.
export const NOTHING_MET: GetStartedFacts = {
  workspaceAnchored: false,
  compilerAnswering: false,
  releaseSelected: false,
  registryConfigured: false,
};

// WORKSPACE_CONFIG_COMMAND and the identifiers below name the commands the
// list's controls invoke.
//
// Every one of them is declared in the manifest's command contribution, and
// that is load-bearing rather than tidiness: the editor derives an activation
// event from each declared command, so a control invoking an undeclared one
// would do nothing for a reader whose workspace has not otherwise started the
// extension — which is most readers meeting this list. A conformance assertion
// requires every command a control names to be declared.
export const CREATE_WORKSPACE_COMMAND = 'aggrega.getStarted.createWorkspace';
export const CHOOSE_WORKSPACE_COMMAND = 'aggrega.getStarted.chooseWorkspace';
export const USE_COMPILER_ON_PATH_COMMAND = 'aggrega.getStarted.useCompilerOnPath';
export const LOCATE_COMPILER_COMMAND = 'aggrega.getStarted.locateCompiler';
export const DRAFT_RELEASE_COMMAND = 'aggrega.getStarted.draftRelease';
export const SEED_REGISTRY_COMMAND = 'aggrega.getStarted.seedRegistry';
export const SEED_NAMED_REGISTRY_COMMAND = 'aggrega.getStarted.seedNamedRegistry';
export const DISMISS_COMMAND = 'aggrega.getStarted.dismiss';
export const SHOW_COMMAND = 'aggrega.getStarted.show';

// SHOW_COMMAND_TITLE is how the way back is named in the command palette. The
// dismissal is not a one-way door, and this is the door back; a conformance
// assertion requires it to stay reachable there.
export const SHOW_COMMAND_TITLE = 'Aggrega: Get started';

// DISMISSED_CONFIRMATION is what the reader is told once the list is put away.
// It names the way back, because a control that removes something permanently
// and says nothing leaves a reader with no way to find out that it can be
// brought back.
export const DISMISSED_CONFIRMATION =
  `Aggrega: the get-started list will not appear again. Run "${SHOW_COMMAND_TITLE}" from the Command Palette to bring it back.`;
