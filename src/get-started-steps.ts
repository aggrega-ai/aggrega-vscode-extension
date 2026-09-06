// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The welcome panel is the editor's answer to "I have installed this; what
// now". It is a WALKTHROUGH in the editor area rather than a dialog or a
// sidebar view, and that is a decision rather than a default.
//
// WHY A PANEL AND NOT A MODAL DIALOG. A dialog takes the editor away and has to
// be dismissed before anything can be looked at — and every step here asks the
// reader to point at something in their own workspace: which folder, which
// Release, where their compiler is. A reader cannot answer any of those while a
// dialog is covering the files that hold the answers. A panel sits beside them.
// A dialog is the shape someone reaches for by default, which is why the reason
// is written here rather than left to be re-derived.
//
// WHY THE EDITOR'S OWN WALKTHROUGH AND NOT A SIDEBAR VIEW. A sidebar view is a
// narrow column with no room to say what the product IS, so a first-time reader
// was told what was missing before being told what they were looking at. It
// also cost a permanent slot in the panel container, above the panel a reader
// uses every day. The walkthrough is the surface the editor's own welcome page
// hosts: it carries a heading, a description and a step per condition, each
// step with its own pane, and it costs the container nothing.
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
// exist, which is met, the exact event each step is checked off by, and the
// words the panel opens with — is assertable without an extension host.

// WALKTHROUGH_ID is the panel, as the manifest declares it.
//
// The panel is contributed to the editor rather than drawn by this extension,
// so the editor renders it for a reader whose workspace has activated nothing
// at all — which is precisely the reader who has nothing configured yet. The
// editor derives an activation event from the contribution and fires it when
// the panel is opened, so opening the panel is what starts this extension, and
// the conditions below are published from that start.
export const WALKTHROUGH_ID = 'aggregaWelcome';

// walkthroughAddress composes how the editor addresses one extension's
// walkthrough: the extension's own identifier, then the walkthrough's, joined
// by a hash.
//
// The extension identifier is a parameter rather than read from a constant
// here, so the shape of the address is provable on its own — a test can hand it
// any identifier and read back the address, which is the part that could be got
// wrong. The caller passes the one identifier the extension already holds, so
// publisher and name keep a single home.
export function walkthroughAddress(extensionId: string): string {
  return `${extensionId}#${WALKTHROUGH_ID}`;
}

// GET_STARTED_SHOW_SETTING is the preference that decides whether the panel
// opens by itself. It is the reader's own, like every other preference here,
// and it is never written into a project.
//
// WHY A PREFERENCE RATHER THAN EDITOR-LOCAL STATE, WHICH WOULD ALSO BE
// PER-READER. Storage private to this extension can only be read once this
// extension is running, and the reader this panel exists for is the one whose
// workspace starts nothing — so a dismissal held privately would be honoured
// everywhere except the situation the panel is for. The preference is also read
// without starting anything, which is what makes the dismissal hold on the next
// window.
export const GET_STARTED_SHOW_SETTING = 'aggrega.getStarted.show';

// WELCOME_GREETING and WELCOME_DESCRIPTION are the words the panel opens with:
// the greeting the editor draws as the panel's heading, then the product's own
// description as its own paragraph beneath it.
//
// THE DESCRIPTION IS TRANSCRIBED, NEVER COMPOSED. It is the description the
// product's own documentation carries, character for character. Two divergent
// descriptions of the product is exactly the drift a single source exists to
// prevent, so this is not re-worded, re-wrapped into different sentences, or
// trimmed to fit a surface. The manifest carries both strings and a conformance
// assertion reads them back against these, so a hand edit that paraphrased
// either one fails rather than shipping a second account of what Aggrega is.
export const WELCOME_GREETING = 'Welcome to Aggrega!';
export const WELCOME_DESCRIPTION =
  'Aggrega is an open-source language, ecosystem, and compiler for defining and rendering enterprise architectures, featuring a standard library highly specialized for AI applications. It serves as a bridge between abstract developer intent (including cognitive AI frameworks like LangGraph or CrewAI) and secure, physical cloud-native reality.';

// StepId names one condition the extension needs before it can do the work it
// is for.
export type StepId = 'workspace' | 'compiler' | 'release' | 'registry';

// STEP_IDS is the conditions in the order a reader meets them, and the order is not
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

// stepCompletionEvent is the exact string a step carries in the manifest to say
// what checks it off: the editor's context-key form, naming that step's own
// condition key.
//
// This is the one home for those strings. The manifest is declarative data the
// editor reads and nothing here can generate into it, so the two are held
// together by a conformance assertion reading the manifest back against this
// function. Without that, a step could name a key nobody sets, and the symptom
// would be a step that silently never reports itself met.
//
// The editor accepts a context-key EXPRESSION here rather than only a bare key,
// which is why the form is composed rather than being the key itself: a later
// step whose condition is a conjunction stays expressible without a second
// shape of this function.
export function stepCompletionEvent(id: StepId): string {
  return `onContext:${stepContextKey(id)}`;
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
// spelled out at each use because it is the state the panel is measured
// against: every condition reports itself met, so such a reader is asked
// nothing.
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

// The identifiers below name the commands the panel's controls invoke.
//
// Every one of them is declared in the manifest's command contribution, and
// that is load-bearing rather than tidiness: the editor derives an activation
// event from each declared command, so a control invoking an undeclared one
// would do nothing for a reader whose workspace has not otherwise started the
// extension — which is most readers meeting this panel. A conformance assertion
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

// DISMISS_COMMAND_TITLE is how the dismissal is named in the command palette,
// and it is in the palette because the panel has no slot for it.
//
// The steps are the conditions and nothing else, so a control belonging to none
// of them has nowhere to sit among them; the panel's own heading and
// description are the product's, not a place for a control. The palette is
// where a reader looks to find out whether a capability exists at all, and a
// command withheld from it does not read as unavailable but as absent — which
// is what a reader would then conclude about turning this panel off. It sits
// beside the way back, so both directions are found in the same place.
export const DISMISS_COMMAND_TITLE = 'Aggrega: Stop opening the welcome panel';

// DISMISSED_CONFIRMATION is what the reader is told once the panel is put away.
// It names the way back, because a control that removes something permanently
// and says nothing leaves a reader with no way to find out that it can be
// brought back.
export const DISMISSED_CONFIRMATION =
  `Aggrega: the welcome panel will not open again. Run "${SHOW_COMMAND_TITLE}" from the Command Palette to bring it back.`;
