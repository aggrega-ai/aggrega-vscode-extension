// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// The welcome panel is the editor's answer to "I have installed this; what
// now". It is a panel of Aggrega's own, in its own editor tab, and that is a
// decision rather than a default.
//
// WHY A PANEL AND NOT A MODAL DIALOG. A dialog takes the editor away and has to
// be dismissed before anything can be looked at — and every step here asks the
// reader to point at something in their own workspace: which folder, which
// Release, where their compiler is. A reader cannot answer any of those while a
// dialog is covering the files that hold the answers. A panel sits beside them.
// A dialog is the shape someone reaches for by default, which is why the reason
// is written here rather than left to be re-derived.
//
// WHY AGGREGA'S OWN PANEL AND NOT A SIDEBAR VIEW. A sidebar view is a narrow
// column with no room to say what the product IS, so a first-time reader was
// told what was missing before being told what they were looking at. It also
// cost a permanent slot in the panel container, above the panel a reader uses
// every day. An editor-area tab has the width to carry a heading, a description
// and a pane per condition, and it costs the container nothing.
//
// WHY AGGREGA'S OWN TAB AND NOT A PAGE INSIDE THE EDITOR'S WELCOME. Onboarding
// hosted inside the editor's own welcome page is one card among whatever else is
// installed, reached through a page belonging to the editor rather than to
// Aggrega. It also inherits that surface's step model, where a step, once
// checked off, can only ever stay checked off — so a reader whose workspace
// stops satisfying a condition is told it is still satisfied. A panel this
// extension draws itself has neither constraint: it is reached and dismissed on
// its own terms, and its steps report what is true now.
//
// WHY THE STEPS READ THE CURRENT STATE INSTEAD OF ASKING. Many readers arrive
// having already built a working configuration from the command line, and a
// list that only knows how to create things treats them as though they had
// nothing. Each step below is a CONDITION the extension genuinely needs, read
// from what is already true, so a reader who has met it sees it met and is
// asked nothing.
//
// WHY EVERY STEP OFFERS AT LEAST TWO PATHS. For the same reason: one path brings
// the thing into being, another points at the one you already have, and both end
// in the same state. A step that only knew how to create would walk that reader
// through making what they have. Where a condition can also be reached in a way
// that is neither of those, the step offers that as well: a reader whose
// situation is served by none of the paths drawn is one the panel has stranded
// on the step it invited them to.
//
// This module holds no editor types, so what a reader is shown — which steps
// exist, which is met, the words each step carries, and the words the panel
// opens with — is assertable without an extension host. What it reads from
// elsewhere holds none either, which is what keeps that true.

import { DAEMON_STANDING_WORDS } from './daemon-status';
import * as l10n from './l10n';
import { panelActionLabel } from './operation-groups';
import { SELECT_RELEASE_COMMAND } from './release-selection';
import { REGISTRY_ADD_COMMAND } from './registry-configure';
import { SELECTOR_ROW_DRAWN_LABELS, SELECTOR_ROW_LABELS } from './selector-levels';
import { USER_HOME_VARIABLE } from './settings';
import { DOWNLOAD_COMPILER_ACTION } from './start-failure';
import { SpawnFn, readDaemonVersion } from './version-check';

// WELCOME_SHOW_SETTING is the preference that decides whether the panel opens
// by itself. It is the reader's own, like every other preference here, and it is
// never written into a project.
//
// 🔴 IT SPELLS THE SAME TEXT AS WELCOME_SHOW_COMMAND BELOW, AND THE TWO NAME
// DIFFERENT SURFACES. The editor keeps commands and configuration properties in
// separate namespaces, so one identifier registered in both is legal — but a
// reader of either constant has to be able to tell which registration it is.
// The shared prefix says the text is shared; the suffix says which surface
// declares it, this one the configuration property and the other the command.
//
// WHY A PREFERENCE RATHER THAN EDITOR-LOCAL STATE, WHICH WOULD ALSO BE
// PER-READER. Storage private to this extension can only be read once this
// extension is running, and it is read here to decide whether to open the panel
// at all — during the very startup the reader may have declined. The preference
// is also what a reader can find and change without this extension running,
// which is what makes the dismissal legible rather than a state only the
// extension can see.
export const WELCOME_SHOW_SETTING = 'aggrega.getStarted.show';

// WELCOME_PANEL_TITLE is the tab the panel opens in. It names Aggrega, because
// a tab is read in a strip beside whatever else the reader has open and a title
// that only said "Welcome" would not say whose.
export const WELCOME_PANEL_TITLE = l10n.t('Welcome to Aggrega');

// WELCOME_VIEW_TYPE is the type the panel is drawn under, which is what tells the
// editor's tabs holding it apart from every other page.
export const WELCOME_VIEW_TYPE = 'aggrega.welcome';

// EDITOR_PAGE_TYPE_PREFIX is what the editor puts in front of the type an
// extension draws a page under when it reports that page's tab back to it.
const EDITOR_PAGE_TYPE_PREFIX = 'mainThreadWebview-';

// isWelcomePageTab reports whether a tab's page type, as the editor reports it,
// is the welcome panel's.
//
// 🔴 BOTH SPELLINGS ARE READ, AND NO LOOSER MATCH, BECAUSE THE PREFIX IS THE
// EDITOR'S OWN. The editor reports a page's tab under the type it was drawn with
// behind a prefix of its own, which is no part of the interface it publishes —
// so the bare type is read as well, in case an editor stops adding one. A match
// on the type's ending instead would also take another extension's page whose
// type merely ends the same way, and a tab taken by mistake is a tab closed.
export function isWelcomePageTab(viewType: string): boolean {
  return viewType === WELCOME_VIEW_TYPE || viewType === `${EDITOR_PAGE_TYPE_PREFIX}${WELCOME_VIEW_TYPE}`;
}

// WELCOME_GREETING and WELCOME_DESCRIPTION are the words the panel opens with:
// the greeting drawn as the panel's heading, then the product's own description
// as its own paragraph beneath it.
//
// THE DESCRIPTION IS TRANSCRIBED, NEVER COMPOSED. It is the description the
// product's own documentation carries, character for character. Two divergent
// descriptions of the product is exactly the drift a single source exists to
// prevent, so this is not re-worded, re-wrapped into different sentences, or
// trimmed to fit a surface. Where it does not fit, that is a layout problem and
// it is solved in the layout.
//
// TWO ASSERTIONS GUARD IT, AND THEY GUARD DIFFERENT THINGS. One reads the
// composed panel back against this constant, which catches a layout that
// trimmed or re-wrapped the words on their way to the reader. The other
// compares this constant against the product documentation's own copy, which is
// the only one that can catch an edit HERE — a check that read the panel
// against this constant alone would move both of its sides at once and pass a
// paraphrase.
//
// 🔴 A TRANSLATION OF THE DESCRIPTION IS THE TRANSLATED DOCUMENTATION'S OWN COPY,
// for the same reason: in a language the documentation is published in, the
// panel carries the description that documentation carries, character for
// character, rather than a second translation of the English.
export const WELCOME_GREETING = l10n.t('Welcome to Aggrega!');
export const WELCOME_DESCRIPTION =
  l10n.t('Aggrega is an open-source compiler for AI-era architecture. Describe the components of an application and how they connect; Aggrega turns them, deterministically, into the deployment files that run it.');

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
//
// 🔴 THREE OF THE FOUR CONDITIONS ARE THE PRESENCE OF THE VALUE ITSELF, WHICH IS
// WHY THERE IS NO SEPARATE BOOLEAN BESIDE THEM. A folder is anchored exactly
// when there is one to name, a Release is selected exactly when there is one to
// name, and a registry is configured exactly when the resolved configuration
// names one. Carrying a standing alongside the value would be two records of
// one fact, and they would agree until the day a caller set one without the
// other — at which point the panel would tick a step it could not name a value
// for, or name one under a step it called still to do.
//
// 🔴 THE COMPILER IS THE EXCEPTION AND IT IS A REAL ONE. Whether the language
// server answers, whether the named compiler runs, and which binary the reader
// has named are independent: a reader who has named a compiler that will not
// start has a value and no answer, and the plain name the preference defaults to
// means the value is never absent merely because nothing is running. A compiler
// that runs with no language server answering is the ordinary state of a reader
// who has not yet opened a folder Aggrega recognises, because the server is
// started only once one is anchored. So that step carries all three, and none is
// derivable from another.
//
// 🔴 TWO STEPS CARRY A THIRD KIND OF FACT — HOW MANY THERE ARE TO CHOOSE FROM —
// AND IT IS NEITHER THEIR CONDITION NOR THEIR VALUE. It decides only which
// words stand where a value would be: a reader told nothing is selected when
// nothing exists to select goes looking for a chooser that cannot help them.
// Only the two steps whose second way through OFFERS A LIST carry one; the
// other two reach their answer by naming or creating, so there is no list to be
// empty and no state in which the reader cannot act.
export interface GetStartedFacts {
  // workspaceRoot is the folder the extension resolved to work in, or null when
  // none has been. Without one the language server is not started at all and
  // every operation has nowhere to run.
  workspaceRoot: string | null;
  // workspaceCandidates is how many folders the step's own chooser would
  // offer — the folders in this window Aggrega already recognises as a
  // workspace root — or null where nobody has looked.
  //
  // It is read from the same place that chooser reads, so the words shown and
  // the list a press produces cannot disagree. It is deliberately NOT the count
  // of open folders that are themselves anchored: discovery climbs, so a reader
  // who opened a folder above the one carrying the configuration has none of
  // the second and one of the first — and they are precisely the reader the
  // chooser exists for.
  workspaceCandidates: number | null;
  // compilerAnswering is whether the language server can be asked right now.
  compilerAnswering: boolean;
  // compilerRuns is whether the compiler the reader has named, run on this
  // machine and asked for its version, answered with one. It is what the step's
  // condition rests on where no language server is answering, so a compiler
  // that works is counted as one before any folder is anchored.
  compilerRuns: boolean;
  // compilerPath is the compiler the reader has named for the editor to start.
  // It is the preference itself rather than the binary a running language
  // server happens to have been started from: this is the value the step's own
  // two ways through write, so it is the one that moves when a reader presses
  // one of them.
  compilerPath: string;
  // release is the selected Release, named as the language server names it, or
  // null when none is selected. Building, previewing and the topology graph
  // each act on one, so the editor needs to know which.
  release: string | null;
  // releaseCandidates is how many Releases the last enumeration could name in a
  // request, or null where no enumeration has produced an answer.
  //
  // It is the selection's own count rather than a second walk of the workspace,
  // for the reason every other field here is passed in: the answer already has
  // an owner, and a second derivation would agree with it until the day it did
  // not.
  releaseCandidates: number | null;
  // registries names the registries the resolved configuration declares, in the
  // order the compiler answered in. An empty list is a configuration that names
  // none; null is a question that produced no answer at all, which is a
  // different statement and is reported as one. Without a registry, pulling
  // dependencies and searching the published catalog have nothing to resolve
  // against.
  registries: readonly string[] | null;
}

// stepMet reports whether one condition already holds.
export function stepMet(id: StepId, facts: GetStartedFacts): boolean {
  switch (id) {
    case 'workspace':
      return facts.workspaceRoot !== null;
    case 'compiler':
      return facts.compilerAnswering || facts.compilerRuns;
    case 'release':
      return facts.release !== null;
    case 'registry':
      return (facts.registries ?? []).length > 0;
  }
}

// compilerRunsAt reports whether one compiler, asked for its version, answered
// with one. It reads through the one place a compiler's version is obtained, so
// the step and every other surface naming a version agree about what the same
// binary did. A blank path names nothing and is not run.
export async function compilerRunsAt(binaryPath: string, spawn: SpawnFn): Promise<boolean> {
  if (binaryPath === '') { return false; }
  return (await readDaemonVersion({ binaryPath, spawn })).kind === 'reported';
}

// The words a step shows where it has no value to name. Each says what is not
// chosen rather than leaving a blank, because a blank line reads as something
// the panel failed to draw rather than as an answer the reader has not given.
//
// 🔴 NOTHING CHOSEN AND NOTHING TO CHOOSE ARE DIFFERENT SENTENCES, AND THAT IS
// THE DISTINCTION THESE TWO EXIST FOR. A reader told nothing is selected when
// no candidate exists goes looking for a chooser that can only come back
// empty, and the press that discovers this is one they had to make to find
// out. So a level that holds nothing says so, and only a level that holds
// something invites a choice.
//
// They are two sentences rather than one per step because the distinction is
// about the level's contents and never about which level it is. The step's own
// heading already names what is missing, so repeating the noun here would put
// it twice in two lines and leave four wordings to keep in step where one pair
// says the whole thing.
//
// 🔴 THE SAME PAIR OF WORDS, IN LOWER CASE AND WITHOUT THE STOP, IS WHAT THE
// COMMANDS PANEL'S ROWS SHOW, AND THE NEAR-DUPLICATE IS DELIBERATE. A row draws
// its value after a label that names the level, so it reads as the tail of a
// phrase; these stand alone on a line of their own and read as sentences.
// Sharing one constant between the two would need a case-and-punctuation
// transform at one of them, which is a second mechanic in place of a second
// short string.
export const VALUE_NONE_SELECTED = l10n.t('None selected.');
export const VALUE_NONE_AVAILABLE = l10n.t('None available.');

// 🔴 THE REGISTRY STEP KEEPS A THIRD SENTENCE AND THE DISTINCTION IS
// LOAD-BEARING. A configuration that names no registry and a question that
// produced no answer are different facts, and the second is not the reader's
// doing — telling them they have configured none when nothing was able to
// answer would be a statement the panel has no grounds for. They read as the
// same standing, because in neither case can a registry be named, and they read
// as different values, because only one of them is about what the reader has
// done.
//
// It is the registry's alone. A Release whose enumeration has not run is a
// different shape: whether one is SELECTED is known there, and only what is on
// offer is unread — so that step says nothing is selected and claims nothing
// about what exists.
export const REGISTRY_VALUE_UNREAD = l10n.t('Not read yet.');

// REGISTRY_SEPARATOR joins the registries a configuration names, because the
// condition is satisfied by having one and a reader may have several. They are
// joined in the order the compiler answered in and never re-ordered: the
// enumeration states its own order, and a surface that sorted it again would
// show a reader a different list from the one the command line shows them.
const REGISTRY_SEPARATOR = ', ';

// StepValue is what one step currently stands at: either the value the reader
// has chosen, or the words standing where a value would be.
//
// The two are distinct shapes rather than a string that is sometimes a sentence
// because the panel draws them differently — a chosen value is a token to
// compare character by character, and an absent one is prose — and because a
// caller cannot then mistake the words for a value it could act on.
export type StepValue =
  | { readonly chosen: string }
  | { readonly absent: string };

// chosenOrAbsent reads one value, treating a blank as no value at all.
//
// Blank counts as unset everywhere rather than per step: a preference a reader
// has emptied and a preference nothing ever wrote are the same state as far as
// this panel can tell, and drawing an empty line for either is the rendering
// fault the words exist to prevent.
function chosenOrAbsent(raw: string | null, absent: string): StepValue {
  return raw === null || raw === '' ? { absent } : { chosen: raw };
}

// absentWording picks between the two empty sentences from what the step's own
// level holds.
//
// 🔴 AN UNREAD COUNT READS AS NOTHING SELECTED, NEVER AS NOTHING AVAILABLE.
// Saying a level is empty is the stronger of the two claims and it needs
// evidence; nobody having looked is not evidence, and a surface that guessed
// that way would tell a reader to give up on a level that may be full.
function absentWording(candidates: number | null): string {
  return candidates === 0 ? VALUE_NONE_AVAILABLE : VALUE_NONE_SELECTED;
}

// stepValue reports what one step currently stands at.
//
// Every branch that can be empty goes through chosenOrAbsent, so what counts as
// no value at all is decided in one place; what differs between them is only
// which words stand there.
//
// 🔴 ONLY TWO STEPS CONSULT A COUNT, AND THE OTHER TWO CANNOT REACH THE
// NOTHING-AVAILABLE SENTENCE AT ALL. Every one of the compiler's ways through
// names a binary and every one of the registry's registers one, so neither step
// has a list that can come back empty and neither has a state its reader cannot
// act in.
// Telling them nothing is available would be false in the one direction that
// costs them something.
export function stepValue(id: StepId, facts: GetStartedFacts): StepValue {
  switch (id) {
    case 'workspace':
      return chosenOrAbsent(facts.workspaceRoot, absentWording(facts.workspaceCandidates));
    case 'compiler':
      return chosenOrAbsent(facts.compilerPath, VALUE_NONE_SELECTED);
    case 'release':
      return chosenOrAbsent(facts.release, absentWording(facts.releaseCandidates));
    case 'registry':
      if (facts.registries === null) { return { absent: REGISTRY_VALUE_UNREAD }; }
      return facts.registries.length === 0
        ? { absent: VALUE_NONE_SELECTED }
        : { chosen: facts.registries.join(REGISTRY_SEPARATOR) };
  }
}

// StepReading is one step as the panel draws it: whether its condition holds,
// and what it currently stands at.
//
// The two travel together because they are read together, from one set of facts
// in one pass. Handing the composition a standing and a value from two separate
// readings is what would let a panel mark a step met beside a value read before
// the condition moved.
export interface StepReading {
  readonly met: boolean;
  readonly value: StepValue;
}

// stepReadings reports every step at once, which is what the panel is composed
// from.
//
// It is recomputed from the facts on every refresh rather than accumulated, and
// that is what makes a standing REVERSIBLE: a condition that lapses is read as
// unmet on the next refresh and the step goes back to still-to-do. Nothing here
// remembers that a step was once met, because a checklist that only ticks
// forward tells a reader they have something they have since lost. The value
// follows the same rule for the same reason: a value the reader has since
// cleared is drawn as absent again.
export function stepReadings(facts: GetStartedFacts): Record<StepId, StepReading> {
  const reading = (id: StepId): StepReading => ({
    met: stepMet(id, facts),
    value: stepValue(id, facts),
  });
  return {
    workspace: reading('workspace'),
    compiler: reading('compiler'),
    release: reading('release'),
    registry: reading('registry'),
  };
}

// unmetStepIds lists the conditions still to do, in list order.
export function unmetStepIds(facts: GetStartedFacts): StepId[] {
  return STEP_IDS.filter((id) => !stepMet(id, facts));
}

// readCollapsedSteps takes the sections a panel reports the reader has closed.
//
// The payload arrives from a document, so it is unknown by contract — anything
// at all can be posted — and every entry is therefore checked against the
// conditions that actually exist rather than trusted. An entry naming none of
// them is dropped, and anything that is not a list of them at all reads as
// nothing closed, which is the panel's open shape.
//
// The answer follows condition order rather than the order the payload happened
// to arrive in, so one arrangement has one spelling however the reader reached
// it.
export function readCollapsedSteps(value: unknown): StepId[] {
  if (!Array.isArray(value)) { return []; }
  return STEP_IDS.filter((id) => value.includes(id));
}

// EVERYTHING_MET is the state of a reader who built their configuration
// elsewhere and has just opened the editor on it. It is named rather than
// spelled out at each use because it is the state the panel is measured
// against: every condition reports itself met, so such a reader is asked
// nothing.
//
// The values stand for what such a reader's answers look like; nothing reads
// them for their content, only for their presence. The counts say the levels
// hold what was chosen from them, which is the only reading consistent with
// having chosen.
export const EVERYTHING_MET: GetStartedFacts = {
  workspaceRoot: '/work/demo',
  workspaceCandidates: 1,
  compilerAnswering: true,
  compilerRuns: true,
  compilerPath: 'aggrega',
  release: 'releases/prod.yaml',
  releaseCandidates: 1,
  registries: ['registry.example.com'],
};

// NOTHING_MET is the opposite end: nothing named, nothing selected and nothing
// answering.
//
// The compiler path is empty here rather than the plain name the preference
// defaults to, because this constant is the far end rather than a transcript of
// a fresh profile — a reader who has never opened the settings screen does in
// fact carry the default.
//
// The two counts differ, and both follow from the rest of the state rather than
// being chosen for effect. This window holds no folder Aggrega recognises, so
// the workspace level genuinely holds none and says so. Nothing is answering,
// so no enumeration of Releases has run and that count is unread rather than
// zero — the same reason the registries are null here.
export const NOTHING_MET: GetStartedFacts = {
  workspaceRoot: null,
  workspaceCandidates: 0,
  compilerAnswering: false,
  compilerRuns: false,
  compilerPath: '',
  release: null,
  releaseCandidates: null,
  registries: null,
};

// The identifiers below name the commands the panel's controls invoke, and hold
// only those this surface is the home of. A control that offers a choice another
// module owns reads that module's own identifier — the Release step's second
// action is one — because a declaration here for a command this surface does
// not own is a copy, and a copy agrees until one of the two moves.
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
// DOWNLOAD_COMPILER_COMMAND downloads a compiler from a published release. The
// notification of a compiler that was not found runs it too, so a reader offered
// the download in either place gets the same flow.
export const DOWNLOAD_COMPILER_COMMAND = 'aggrega.getStarted.downloadCompiler';
export const DRAFT_RELEASE_COMMAND = 'aggrega.getStarted.draftRelease';
export const SEED_REGISTRY_COMMAND = 'aggrega.getStarted.seedRegistry';
export const SEED_NAMED_REGISTRY_COMMAND = 'aggrega.getStarted.seedNamedRegistry';
export const DISMISS_COMMAND = 'aggrega.getStarted.dismiss';

// WELCOME_SHOW_COMMAND is the palette command that brings the page back and
// opens it. It spells the same text as WELCOME_SHOW_SETTING above, which the
// manifest declares as a configuration property rather than as a command; the
// note there says why both names carry the surface they name.
export const WELCOME_SHOW_COMMAND = 'aggrega.getStarted.show';

// SHOW_COMMAND_TITLE is how the way back is named in the command palette. The
// dismissal is not a one-way door, and this is the door back; a conformance
// assertion requires it to stay reachable there.
//
// It and the other command titles below are the manifest's own titles, which the
// editor draws from the manifest and its translations; they are not looked up
// here, because nothing draws them from this module. A sentence quoting the way
// back takes the title the palette lists, read from the manifest the editor
// loaded — see dismissedConfirmation below.
export const SHOW_COMMAND_TITLE = 'Aggrega: Get started';

// WELCOME_OPEN_COMMAND opens the page and changes nothing else.
//
// 🔴 IT IS A SECOND COMMAND BECAUSE IT DOES A DIFFERENT THING, NOT BECAUSE IT
// REACHES THE PAGE FROM A DIFFERENT PLACE. The command above turns the startup
// preference back on and then opens the page — one act, which is what undoing a
// dismissal means. This one opens the page and leaves the preference exactly
// where the reader put it. Whether the page is REACHABLE and whether it opens BY
// ITSELF are separate questions, so an affordance whose whole job is the first
// must not answer the second on the reader's behalf: somebody who turned the
// page off and then wants to look at it would otherwise have turned it back on
// by looking.
//
// The page-opening itself has one home, which both commands run; what differs is
// only what each does around it.
export const WELCOME_OPEN_COMMAND = 'aggrega.getStarted.open';

// OPEN_COMMAND_TITLE is what the reader reads on the control that runs it.
//
// It names the surface in the words every other user-visible string uses for it,
// and it says what pressing it does rather than what it is for — a title-bar
// entry is drawn as an icon with its title as the tooltip, so this is the only
// sentence a reader gets before pressing.
export const OPEN_COMMAND_TITLE = 'Open the welcome page';

// DISMISS_COMMAND_TITLE is how the dismissal is named in the command palette.
//
// It is in the palette because the palette is where a reader looks to find out
// whether a capability exists at all, and a command withheld from it does not
// read as unavailable but as absent — which is what a reader would then
// conclude about turning this panel off. It sits beside the way back, so both
// directions are found in the same place.
//
// The panel carries the same switch at its foot. That is not a second door to
// the same room: the palette entry is how the capability is FOUND, and the foot
// control is how it is reached from where the panel is being read. Both run
// this one command, so neither can come to mean something the other does not.
export const DISMISS_COMMAND_TITLE = 'Aggrega: Stop opening the welcome page on startup';

// dismissedConfirmation is what the reader is told once the panel is put away.
// It names the way back, because a control that removes something permanently
// and says nothing leaves a reader with no way to find out that it can be
// brought back.
//
// 🔴 THE WAY BACK IS NAMED AS THE PALETTE LISTS IT, SO THE TITLE IS HANDED IN.
// Showing another language, the palette lists the manifest's translation of the
// title rather than SHOW_COMMAND_TITLE's English, and a sentence quoting the
// English would send a reader looking for an entry worded differently. The title
// is read from the manifest the editor loaded, which this module does not reach
// for, so whoever raises the confirmation reads it and passes it here.
export function dismissedConfirmation(showTitle: string): string {
  return l10n.t('Aggrega: the welcome page will not open on startup again. Run "{0}" from the Command Palette to bring it back.', showTitle);
}

// StepAction is one way through a step: the words on the control, and the
// command pressing it runs.
export interface StepAction {
  readonly label: string;
  readonly command: string;
}

// StepDetail is one block of a step's explanation. Two shapes are enough for
// what these steps have to say, and holding it as data rather than as a markup
// document is what lets the panel be composed and asserted without a parser.
export type StepDetail =
  | { readonly paragraph: string }
  | { readonly bullets: readonly string[] };

// StepContent is everything a step shows.
//
// 🔴 THE ACTIONS CARRY A FLOOR IN THE TYPE AND NO CEILING, and the asymmetry is
// the ruling rather than an accident of how it is written. The floor is two, so
// a step offering only one way through does not compile: one path brings the
// thing into being, the other points at the one you already have, and stating
// that in the type is what keeps it from being eroded a step at a time. A
// ceiling would guard nothing and cost something real — a condition can be
// reached in a way that is neither of those two, and a reader whose situation is
// served by that third way is stranded by a shape with nowhere to put it. Being
// stranded on a step is the worse failure of the two, and it is the one a
// reader meets.
export interface StepContent {
  readonly id: StepId;
  readonly title: string;
  readonly summary: string;
  readonly detail: readonly StepDetail[];
  readonly actions: readonly [StepAction, StepAction, ...StepAction[]];
}

// STEP_CONTENT is the words each step carries, in condition order.
//
// Inline emphasis and code spans are written in the three markers the panel
// renders — a pair of asterisks, a single asterisk, and backticks — and nothing
// else. The renderer escapes first and applies exactly those three, so this text
// can never introduce markup of its own.
//
// 🔴 A SENTENCE NAMING A CONTROL ANOTHER SURFACE DRAWS COMPOSES THAT CONTROL'S
// LABEL FROM THE LABEL'S ONE HOME rather than spelling it again. A reader looks
// for the words the sentence gives them, so a row named here by any other
// spelling is a row they cannot find, and a second spelling agrees with the
// surface only until that surface's label is edited. The rows of the Commands
// panel and the Catalog panel's drafting row are composed that way below.
//
// THE CONFIGURATION WORDING IS THE PRODUCT DOCUMENTATION'S OWN, AND THE FULLER
// MODEL IS POINTED AT RATHER THAN RESTATED. The two files a project needs — one
// at the project root and one on the machine — are described here in the words
// the product's configuration reference uses, because two surfaces describing
// one model in different words teaches a reader to distrust both. The mechanisms
// beyond those two files were built for projects large enough to need them: more
// than one configuration file inside one project, a list that extends an outer
// file's rather than replacing it, a file a pipeline owns, the further ways a
// root is recognised, and what a relative path in a configuration file resolves
// against. They are named here and explained there, so a reader who has the
// problem one of them solves can find it and a reader who does not is not taught
// it first.
//
// WHAT EARNS THE GLOBAL FILE IS GLOBAL TOOLING, NOT CREDENTIALS, and the
// plausible version of that claim is wrong: a registry password and a signing
// identity token are never fields in either configuration file, so "the global
// file exists so credentials need not be committed" is not the reason and must
// not be written back in. What belongs there is the registries and their
// signature trust policy, the compiled-module store's size, and the installed
// command extensions — the settings that are the same wherever the reader works.
//
// 🔴 A SENTENCE NAMING ONE OF A STEP'S OWN CONTROLS TAKES THE CONTROL'S LABEL AS A
// PLACEHOLDER, set in bold as the control's name. Each label is held once, below,
// and read by both the control and the sentence, so a translation names the
// control in the explanation exactly as the button reads. The same holds for the
// words the status bar shows for the language server's state, which a sentence
// here names as the reader will see them.
const CREATE_WORKSPACE_LABEL = l10n.t('Create a workspace configuration');
const CHOOSE_WORKSPACE_LABEL = l10n.t('Use a folder that already has one');
const USE_COMPILER_ON_PATH_LABEL = l10n.t('Use the compiler on my PATH');
const LOCATE_COMPILER_LABEL = l10n.t('Point at a compiler I have');
const DRAFT_RELEASE_LABEL = l10n.t('Draft a Release');
const CHOOSE_RELEASE_LABEL = l10n.t('Choose a Release I already have');
const SEED_REGISTRY_LABEL = l10n.t('Seed the official hub');
const SEED_NAMED_REGISTRY_LABEL = l10n.t('Seed a registry I name');
const ADD_REGISTRY_LABEL = l10n.t('Add a registry to what I have');

export const STEP_CONTENT: readonly StepContent[] = [
  {
    id: 'workspace',
    title: l10n.t('A workspace Aggrega recognises'),
    summary:
      l10n.t('Aggrega reads one file at your project root — `.aggrega-config.yaml`, carrying a `workspace:` block — and climbs to find it, starting at the folder you opened.'),
    detail: [
      {
        paragraph:
          l10n.t('Every Aggrega operation runs against a **workspace root** — one folder that the compiler treats as the top of your project. It is where catalog directories are resolved from, where rendered artifacts are written, and what every path in a request is interpreted relative to.'),
      },
      {
        paragraph:
          l10n.t('Aggrega\'s own configuration is **two files, and most projects need nothing else**:'),
      },
      {
        bullets: [
          l10n.t('**One file in your project**, named `.aggrega-config.yaml`, sitting at the project root. Its `workspace:` block is what marks the directory as the project root, and a project that vendors no catalog content still writes the block empty — `workspace: {}` — because the block\'s presence is the marker.'),
          l10n.t('**One global file on your machine**, at `~/.config/aggrega/config.yaml`. It holds settings that belong to the machine rather than to any one project — the registries you pull from and the signature trust policy for each, how large the compiled-module store may grow, and any command-extension plugin you have installed. It loads automatically when it is there, and nothing breaks when it is not.'),
        ],
      },
      {
        paragraph:
          l10n.t('Between the two files, your project\'s file wins. Marking the root with a `workspace:` block is the explicit choice and the one to prefer; a project that has never declared one can still be recognised by other markers, so a folder can be a workspace root without carrying that file at all.'),
      },
      // The row is named in full and then as the panel draws it, shortened: the
      // full name is the one every other sentence teaches, and the drawn one is
      // what a reader sent to the panel has to find there.
      {
        paragraph:
          l10n.t('Because discovery climbs rather than descends, the root may legitimately sit *above* the folder you opened. The **{0} ({1})** row at the top of the Commands panel always names the folder that was actually anchored, so when it differs from what you opened you can see why.', SELECTOR_ROW_LABELS.workspace, SELECTOR_ROW_DRAWN_LABELS.workspace),
      },
      {
        paragraph:
          l10n.t('That is the whole model for one project on one machine. Everything else exists for projects that outgrow it — more than one configuration file inside one project, a list that extends what an outer file declared rather than replacing it, a configuration file your pipeline owns, the other ways a project root is recognised, and what a relative path written in a configuration file points at. Aggrega\'s own configuration reference carries every one of them, and `aggrega config show --origin` names where each setting in force right now came from: a configuration file, an environment variable, or the built-in default.'),
      },
      {
        paragraph:
          l10n.t('**{0}** writes the smallest file that anchors a root, in the folder you have open. **{1}** offers the folders beneath you that Aggrega already recognises, and adds the one you choose so the compiler anchors there.', CREATE_WORKSPACE_LABEL, CHOOSE_WORKSPACE_LABEL),
      },
    ],
    actions: [
      { label: CREATE_WORKSPACE_LABEL, command: CREATE_WORKSPACE_COMMAND },
      { label: CHOOSE_WORKSPACE_LABEL, command: CHOOSE_WORKSPACE_COMMAND },
    ],
  },
  {
    id: 'compiler',
    title: l10n.t('A compiler this editor can run'),
    summary:
      l10n.t('The editor starts the `aggrega` binary named in your settings; a plain name is looked up on your PATH.'),
    detail: [
      {
        paragraph:
          l10n.t('This extension computes nothing about your architecture itself. It renders the compiler\'s own answers — so a compiler it can start is what everything else here depends on.'),
      },
      {
        paragraph: l10n.t('Two transports carry those answers, and both run the same binary:'),
      },
      {
        bullets: [
          l10n.t('a **language server**, started once and kept running, which answers validation, navigation, hover, completion, the topology graph and the workspace catalog;'),
          l10n.t('**one-shot commands**, run per operation and streamed to the Aggrega output channel, which carry fetching dependencies, the plugin list, generating catalog entities from a plugin, and the Catalog panel\'s check of one entity.'),
        ],
      },
      {
        paragraph:
          // The editor's home-folder variable is a placeholder argument rather than
          // written in the message: its braces would otherwise read as a placeholder.
          l10n.t('Which binary runs is the `aggrega.server.binaryPath` setting. A plain name is looked up on your `PATH`; a path starting with `~/` (or `~\\` on Windows) or with `{0}` is read from your home folder on the machine the editor runs its extensions on; a relative path is resolved against the first folder of the workspace; any other path is honoured as written.', USER_HOME_VARIABLE),
      },
      {
        paragraph:
          l10n.t('That setting is yours rather than the project\'s: it names something about the machine you are working on, so a repository cannot pin it for whoever clones it. The consequence is deliberate — a project cannot point this extension at a checked-in build — and it is what lets you keep one path locally and a different one inside a container.'),
      },
      {
        paragraph:
          l10n.t('The language server\'s state is reported in the status bar, on the left. It reads **{0}**, **{1}**, or **{2}**, and its tooltip says which of two reasons applies: nothing here is a folder Aggrega recognises, or there is one and no server is attached to it. Clicking it offers to start or restart.',
            DAEMON_STANDING_WORDS.running, DAEMON_STANDING_WORDS.starting, DAEMON_STANDING_WORDS.notRunning),
      },
      {
        paragraph:
          l10n.t('**{0}** restores the plain name — the path for someone who installed the compiler after opening the editor. **{1}** selects a build you keep elsewhere.', USE_COMPILER_ON_PATH_LABEL, LOCATE_COMPILER_LABEL),
      },
      {
        paragraph:
          l10n.t('**{0}** fetches the newest published release this extension works with, built for the machine the editor runs its extensions on — the remote machine, in a window opened on one. It proposes the folder Aggrega\'s install scripts use, `~/.local/bin` on Linux and macOS and `%LOCALAPPDATA%\\Programs\\aggrega` on Windows, which you can change; it shows the version and asks you to confirm before anything is downloaded, checks the file against the release\'s published checksums, and then sets `aggrega.server.binaryPath` to it. It never replaces a compiler you put somewhere yourself, and it never upgrades on its own.', DOWNLOAD_COMPILER_ACTION),
      },
    ],
    actions: [
      { label: USE_COMPILER_ON_PATH_LABEL, command: USE_COMPILER_ON_PATH_COMMAND },
      { label: LOCATE_COMPILER_LABEL, command: LOCATE_COMPILER_COMMAND },
      { label: DOWNLOAD_COMPILER_ACTION, command: DOWNLOAD_COMPILER_COMMAND },
    ],
  },
  {
    id: 'release',
    title: l10n.t('A Release to act on'),
    summary:
      l10n.t('Building, previewing and the topology graph each act on one Release, so the editor needs to know which one you mean.'),
    detail: [
      {
        paragraph:
          l10n.t('A **Release** is the document that says *this* Aggregate is deployed *here*, with these parameters fulfilled. It is what turns developer intent into something a compiler can render.'),
      },
      {
        paragraph:
          l10n.t('So most of what this extension does acts on one Release rather than on the workspace in general: validation, building, previewing a build, the topology graph and pulling dependencies all need to know which one you mean. The editor asks once and remembers, rather than asking at every command.'),
      },
      {
        paragraph:
          l10n.t('The selection is named in two places — a status-bar indicator, and a **{0}** row at the top of the Commands panel — so the Problems panel and the graph always describe the same Release, and you can see which without pressing anything.', SELECTOR_ROW_LABELS.release),
      },
      {
        paragraph: l10n.t('Two properties of the selection are worth knowing:'),
      },
      {
        bullets: [
          l10n.t('**It is remembered per editor window, not in the repository.** Your choice does not travel to whoever else opens the project.'),
          l10n.t('**It is re-verified when it is restored.** A Release that no longer resolves falls back to the workspace\'s own default, and says so — rather than failing on first use, at a moment you cannot connect to a choice made in a previous session.'),
        ],
      },
      {
        paragraph:
          l10n.t('The Releases offered are the ones the language server will accept, named relative to the folder it anchored to. Recording a workspace\'s own persisted default is a separate, explicit act.'),
      },
      {
        paragraph:
          l10n.t('**{0}** opens the same drafting flow as **{1}** at the head of the Catalog panel, with the kind already settled — you are asked for the name and nothing else. **{2}** opens the picker over what this workspace offers.', DRAFT_RELEASE_LABEL, panelActionLabel('scaffold'), CHOOSE_RELEASE_LABEL),
      },
    ],
    actions: [
      { label: DRAFT_RELEASE_LABEL, command: DRAFT_RELEASE_COMMAND },
      { label: CHOOSE_RELEASE_LABEL, command: SELECT_RELEASE_COMMAND },
    ],
  },
  {
    id: 'registry',
    title: l10n.t('A registry to resolve from'),
    summary:
      l10n.t('Pulling dependencies and searching the published catalog resolve against the registries your configuration names.'),
    detail: [
      {
        paragraph:
          l10n.t('A **registry** is where published catalog content lives — the Components, Features, Recipes and Plugins your Aggregate refers to but does not itself contain.'),
      },
      {
        paragraph: l10n.t('Two things have nothing to resolve against without one:'),
      },
      {
        bullets: [
          l10n.t('**Pulling dependencies**, which fetches what a Release refers to and pins it,'),
          l10n.t('**Searching the published catalog**, which is how you find an entity to refer to in the first place.'),
        ],
      },
      {
        paragraph:
          l10n.t('Registries are named by your configuration rather than by this extension, and each one carries its own signature trust policy — whether artifacts pulled from it must be signed. The **Registries** panel lists every registry the effective configuration declares, with each one\'s host, its alias, which is the default, whether signatures are required, and whether a credential for that host is present. Reading that list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it.'),
      },
      {
        paragraph:
          l10n.t('A registry belongs in the global file on your machine rather than in your project\'s: the registries you pull from are the same wherever you are working, so declaring them once is the point. **Secrets are not configuration** — a registry password and a signing identity token are never fields in either file, and are supplied by environment variable or flag at the moment they are needed.'),
      },
      {
        paragraph:
          l10n.t('**{0}** registers the public hub together with its signature trust policy, using the compiler\'s own seeding — so what you get here and what you would get from the command line are the same configuration. It writes the global file on your machine rather than one in your project. Seeding is for a machine that has no configuration file yet: where one is already there it declines, names the file it found, and leaves that file exactly as it stands.', SEED_REGISTRY_LABEL),
      },
      {
        paragraph:
          l10n.t('**{0}** does the same for a host you supply, which is the path for a private or air-gapped hub.', SEED_NAMED_REGISTRY_LABEL),
      },
      {
        paragraph:
          l10n.t('**{0}** is the one to press when a configuration file already exists — including when seeding has just declined and named it. Registering a registry carries no such condition, because the entry is merged into the configuration that is there: every registry you have already declared keeps its entry, and nothing in the file is rewritten. It asks you for the host and for which configuration file to write it to.', ADD_REGISTRY_LABEL),
      },
    ],
    actions: [
      { label: SEED_REGISTRY_LABEL, command: SEED_REGISTRY_COMMAND },
      { label: SEED_NAMED_REGISTRY_LABEL, command: SEED_NAMED_REGISTRY_COMMAND },
      { label: ADD_REGISTRY_LABEL, command: REGISTRY_ADD_COMMAND },
    ],
  },
];

// PANEL_SETTING_LABEL is the words beside the tick at the foot. They name the
// preference itself, and they are the same words in both standings.
//
// 🔴 THE WORDS SAY WHAT THE STATE IS RATHER THAN WHAT PRESSING WILL DO, WHICH IS
// WHY THERE IS ONE LABEL AND NOT ONE PER STANDING. A control that offered the
// act — stop opening this, start opening this — left the reader to work the
// current value out backwards from the offer, and an offer is a poor way to
// report a state: it says what is available, not what is so. A tick reports the
// state directly, so the words are free to name the preference and nothing else.
// Words that moved with the standing would be describing the press again, and
// the reader would be back to inferring.
//
// They are also the words a reader would search the settings screen for, so the
// preference is described in one vocabulary wherever it is met rather than in
// one here and another there.
export const PANEL_SETTING_LABEL = l10n.t('Show Aggrega welcome page on startup');

// OPEN_ON_STARTUP_COMMAND turns the startup preference on and does nothing else.
// Ticking the box at the page's foot runs it.
//
// 🔴 IT IS NOT THE PALETTE'S WAY BACK, AND THE DIFFERENCE IS THE OPENING. The way
// back turns the preference on and then brings the page to the front, and
// bringing forward a page that is already open moves the keyboard focus into the
// page and off the box the reader pressed, so their next key reaches nothing. The
// tick is pressed on the very page the way back would open, so the opening has
// nothing left to do there except take the focus. This command writes the one
// preference through the same writer the way back uses and leaves the page, and
// the focus, where they are.
//
// It is kept out of the command palette for the reason the opening-only command
// is: the capability is already listed there as the way back, and two entries
// differing only by whether the page is opened behind one of them is a choice no
// single line of text puts to a reader well.
export const OPEN_ON_STARTUP_COMMAND = 'aggrega.getStarted.openOnStartup';

// OPEN_ON_STARTUP_COMMAND_TITLE is how that command is named where the editor
// lists every command, in the vocabulary the rest of the surface uses.
export const OPEN_ON_STARTUP_COMMAND_TITLE = 'Aggrega: Open the welcome page on startup';

// PANEL_SETTING_COMMANDS is what a press at the foot runs, one entry for a page
// that opens on startup and one for a page that does not. A press moves the
// preference the way it is not already set, so the standing picks the command
// while the words above stay put. Unticking runs the palette's own way out, which
// also says how to bring the page back; ticking runs the command above, which
// opens nothing because the page being pressed on is already open.
//
// 🔴 THE CONTROL IS COMPOSED FROM THE PREFERENCE AND HOLDS NO STATE OF ITS OWN.
// It reads and writes the one preference that already decides whether the panel
// opens, so turning the panel off in the settings screen and reopening it shows
// the control already reflecting that, and pressing the control changes what
// the settings screen shows. A control keeping its own answer beside the
// preference would be two records of one fact, and the failure would be a
// switch at the foot of the panel disagreeing with the switch in the settings
// screen — each correct about itself.
export const PANEL_SETTING_COMMANDS: readonly [string, string] = [
  DISMISS_COMMAND,
  OPEN_ON_STARTUP_COMMAND,
];

// panelSettingCommand picks the command a press would run from the standing the
// preference is currently in.
export function panelSettingCommand(opensWithEditor: boolean): string {
  return opensWithEditor ? PANEL_SETTING_COMMANDS[0] : PANEL_SETTING_COMMANDS[1];
}

// panelControlCommands is what a press in the panel is allowed to run.
//
// It is DERIVED from the panel's own content rather than listed a second time,
// so a control cannot exist that the guard does not admit, and the guard cannot
// admit one no control offers. The panel forwards a press by the command it
// names, and the host checks the name against this before running anything —
// so what the panel can reach stays exactly what it draws, whatever a page it
// is showing might later be persuaded to send.
//
// It reads TWO declarations because the panel draws two kinds of control: a
// step's own ways through, and the one at the foot that decides whether the
// panel opens. Both standings of the foot control are admitted, because which
// one is drawn depends on the preference and the guard is asked before the
// composition is consulted. Deriving from the declarations rather than from a
// composed document is what keeps that from widening the guard by hand.
export function panelControlCommands(): string[] {
  return [
    ...STEP_CONTENT.flatMap((step) => step.actions.map((action) => action.command)),
    ...PANEL_SETTING_COMMANDS,
  ];
}
