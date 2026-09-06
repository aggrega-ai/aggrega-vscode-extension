// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
// WHY EVERY STEP OFFERS TWO PATHS. For the same reason: one path brings the
// thing into being, the other points at the one you already have, and both end
// in the same state. A step that only knew how to create would walk that reader
// through making what they have.
//
// This module holds no editor types, so what a reader is shown — which steps
// exist, which is met, the words each step carries, and the words the panel
// opens with — is assertable without an extension host.

// GET_STARTED_SHOW_SETTING is the preference that decides whether the panel
// opens by itself. It is the reader's own, like every other preference here,
// and it is never written into a project.
//
// WHY A PREFERENCE RATHER THAN EDITOR-LOCAL STATE, WHICH WOULD ALSO BE
// PER-READER. Storage private to this extension can only be read once this
// extension is running, and it is read here to decide whether to open the panel
// at all — during the very startup the reader may have declined. The preference
// is also what a reader can find and change without this extension running,
// which is what makes the dismissal legible rather than a state only the
// extension can see.
export const GET_STARTED_SHOW_SETTING = 'aggrega.getStarted.show';

// WELCOME_PANEL_TITLE is the tab the panel opens in. It names Aggrega, because
// a tab is read in a strip beside whatever else the reader has open and a title
// that only said "Welcome" would not say whose.
export const WELCOME_PANEL_TITLE = 'Welcome to Aggrega';

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

// stepStandings reports every condition at once, which is what the panel draws
// its marks from.
//
// It is recomputed from the facts on every refresh rather than accumulated, and
// that is what makes a standing REVERSIBLE: a condition that lapses is read as
// unmet on the next refresh and the step goes back to outstanding. Nothing here
// remembers that a step was once met, because a checklist that only ticks
// forward tells a reader they have something they have since lost.
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
export const SELECT_RELEASE_COMMAND = 'aggrega.release.select';
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
// The two actions are a PAIR IN THE TYPE rather than a list of some length, so
// a step offering only one way through does not compile. That pairing is a
// settled ruling — one path brings the thing into being, the other points at
// the one you already have — and stating it in the type is what keeps it from
// being eroded a step at a time.
export interface StepContent {
  readonly id: StepId;
  readonly title: string;
  readonly summary: string;
  readonly detail: readonly StepDetail[];
  readonly actions: readonly [StepAction, StepAction];
}

// STEP_CONTENT is the words each step carries, in condition order.
//
// Inline emphasis and code spans are written in the two markers the panel
// renders — a pair of asterisks, and backticks — and nothing else. The renderer
// escapes first and applies exactly those two, so this text can never introduce
// markup of its own.
export const STEP_CONTENT: readonly StepContent[] = [
  {
    id: 'workspace',
    title: 'A workspace Aggrega recognises',
    summary:
      'Aggrega looks for a `.aggrega-config.yaml` carrying a `workspace:` block, an `.aggrega` directory, or an `aggregate`, `release` or `manifest` YAML file — starting at the folder you opened and climbing from there.',
    detail: [
      {
        paragraph:
          'Every Aggrega operation runs against a **workspace root** — one folder that the compiler treats as the top of your project. It is where catalog directories are resolved from, where rendered artifacts are written, and what every path in a request is interpreted relative to.',
      },
      {
        paragraph:
          'Aggrega finds that folder by climbing. Starting at the folder you opened it looks upward for any of:',
      },
      {
        bullets: [
          'a `.aggrega-config.yaml` carrying a top-level `workspace:` block,',
          'an `.aggrega` directory,',
          'an `aggregate`, `release` or `manifest` YAML file.',
        ],
      },
      {
        paragraph:
          'A `.aggrega-config.yaml` **without** a `workspace:` block does not anchor a root. Settings can live in a configuration file anywhere, and a file that only carries settings must not turn every directory above it into a project root.',
      },
      {
        paragraph:
          'Because discovery climbs rather than descends, the root may legitimately sit *above* the folder you opened. The **Workspace** row at the top of the Operations panel always names the folder that was actually anchored, so when it differs from what you opened you can see why.',
      },
      {
        paragraph:
          '**Create a workspace configuration** writes the smallest file that anchors a root, in the folder you have open. **Use a folder that already has one** offers the folders beneath you that Aggrega already recognises, and adds the one you choose so the compiler anchors there.',
      },
    ],
    actions: [
      { label: 'Create a workspace configuration', command: CREATE_WORKSPACE_COMMAND },
      { label: 'Use a folder that already has one', command: CHOOSE_WORKSPACE_COMMAND },
    ],
  },
  {
    id: 'compiler',
    title: 'A compiler this editor can run',
    summary:
      'The editor starts the `aggrega` binary named in your settings; a plain name is looked up on your PATH.',
    detail: [
      {
        paragraph:
          'This extension computes nothing about your architecture itself. It renders the compiler\'s own answers — so a compiler it can start is what everything else here depends on.',
      },
      {
        paragraph: 'Two transports carry those answers, and both run the same binary:',
      },
      {
        bullets: [
          'a **language server**, started once and kept running, which answers validation, navigation, hover, completion, the topology graph and the workspace catalog;',
          '**one-shot commands**, run per operation and streamed to the Aggrega output channel, which carry publishing, dependency fetching and cache maintenance.',
        ],
      },
      {
        paragraph:
          'Which binary runs is the `aggrega.server.binaryPath` setting. A plain name is looked up on your `PATH`; an absolute or relative path is honoured as written.',
      },
      {
        paragraph:
          'That setting is yours rather than the project\'s: it names something about the machine you are working on, so a repository cannot pin it for whoever clones it. The consequence is deliberate — a project cannot point this extension at a checked-in build — and it is what lets you keep one path locally and a different one inside a container.',
      },
      {
        paragraph:
          'The language server\'s state is reported in the status bar, on the left. It reads **running**, **starting**, or **not running**, and its tooltip says which of two reasons applies: nothing here is a folder Aggrega recognises, or there is one and no server is attached to it. Clicking it offers to start or restart.',
      },
      {
        paragraph:
          '**Use the compiler on my PATH** restores the plain name — the path for someone who installed the compiler after opening the editor. **Point at a compiler I have** selects a build you keep elsewhere.',
      },
    ],
    actions: [
      { label: 'Use the compiler on my PATH', command: USE_COMPILER_ON_PATH_COMMAND },
      { label: 'Point at a compiler I have', command: LOCATE_COMPILER_COMMAND },
    ],
  },
  {
    id: 'release',
    title: 'A Release to act on',
    summary:
      'Building, previewing and the topology graph each act on one Release, so the editor needs to know which one you mean.',
    detail: [
      {
        paragraph:
          'A **Release** is the document that says *this* Aggregate is deployed *here*, with these parameters fulfilled. It is what turns developer intent into something a compiler can render.',
      },
      {
        paragraph:
          'So most of what this extension does acts on one Release rather than on the workspace in general: validation, building, previewing a build, the topology graph, pulling dependencies and acquiring inputs all need to know which one you mean. The editor asks once and remembers, rather than asking at every command.',
      },
      {
        paragraph:
          'The selection is named in two places — a status-bar indicator, and a **Release** row at the top of the Operations panel — so the Problems panel and the graph always describe the same Release, and you can see which without pressing anything.',
      },
      {
        paragraph: 'Two properties of the selection are worth knowing:',
      },
      {
        bullets: [
          '**It is remembered per editor window, not in the repository.** Your choice does not travel to whoever else opens the project.',
          '**It is re-verified when it is restored.** A Release that no longer resolves falls back to the workspace\'s own default, and says so — rather than failing on first use, at a moment you cannot connect to a choice made in a previous session.',
        ],
      },
      {
        paragraph:
          'The Releases offered are the ones the language server will accept, named relative to the folder it anchored to. Recording a workspace\'s own persisted default is a separate, explicit act.',
      },
      {
        paragraph:
          '**Draft a Release** opens the same drafting flow the Author group uses, asking for the kind and the name. **Choose a Release I already have** opens the picker over what this workspace offers.',
      },
    ],
    actions: [
      { label: 'Draft a Release', command: DRAFT_RELEASE_COMMAND },
      { label: 'Choose a Release I already have', command: SELECT_RELEASE_COMMAND },
    ],
  },
  {
    id: 'registry',
    title: 'A registry to resolve from',
    summary:
      'Pulling dependencies and searching the published catalog resolve against the registries your configuration names.',
    detail: [
      {
        paragraph:
          'A **registry** is where published catalog content lives — the Components, Features, Recipes and Plugins your Aggregate refers to but does not itself contain.',
      },
      {
        paragraph: 'Two things have nothing to resolve against without one:',
      },
      {
        bullets: [
          '**Pulling dependencies**, which fetches what a Release refers to and pins it,',
          '**Searching the published catalog**, which is how you find an entity to refer to in the first place.',
        ],
      },
      {
        paragraph:
          'Registries are named by your configuration rather than by this extension, and each one carries its own signature trust policy — whether artifacts pulled from it must be signed. The **Registries** panel lists every registry the effective configuration declares, with each one\'s host, its alias, which is the default, whether signatures are required, and whether a credential for that host is present. Reading that list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it.',
      },
      {
        paragraph:
          '**Seed the official hub** registers the public hub together with its signature trust policy, using the compiler\'s own seeding — so what you get here and what you would get from the command line are the same configuration. Seeding declines rather than replacing a configuration that is already there, and says which file it found; replacing one is something you ask for explicitly at the command line.',
      },
      {
        paragraph:
          '**Seed a registry I name** does the same for a host you supply, which is the path for a private or air-gapped hub.',
      },
    ],
    actions: [
      { label: 'Seed the official hub', command: SEED_REGISTRY_COMMAND },
      { label: 'Seed a registry I name', command: SEED_NAMED_REGISTRY_COMMAND },
    ],
  },
];

// panelControlCommands is what a press in the panel is allowed to run.
//
// It is DERIVED from the step content rather than listed a second time, so a
// control cannot exist that the guard does not admit, and the guard cannot
// admit one no control offers. The panel forwards a press by the command it
// names, and the host checks the name against this before running anything —
// so what the panel can reach stays exactly what it draws, whatever a page it
// is showing might later be persuaded to send.
export function panelControlCommands(): string[] {
  return STEP_CONTENT.flatMap((step) => step.actions.map((action) => action.command));
}
