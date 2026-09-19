// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DISMISS_COMMAND,
  DISMISS_COMMAND_TITLE,
  EVERYTHING_MET,
  NOTHING_MET,
  OPEN_COMMAND_TITLE,
  PANEL_SETTING_COMMANDS,
  PANEL_SETTING_LABEL,
  SHOW_COMMAND_TITLE,
  STEP_CONTENT,
  STEP_IDS,
  StepId,
  WELCOME_DESCRIPTION,
  WELCOME_GREETING,
  WELCOME_OPEN_COMMAND,
  WELCOME_PANEL_TITLE,
  WELCOME_SHOW_COMMAND,
  WELCOME_SHOW_SETTING,
  panelControlCommands,
  readCollapsedSteps,
  stepMet,
  stepStandings,
  unmetStepIds,
} from '../../src/get-started-steps';
import { escapeHtml } from '../../src/html';
import {
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  readSourceTree,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';
import {
  COMMANDS_PANEL_VIEW,
  COMMANDS_TITLE_BAR_ENTRIES,
  MenuContribution,
  commandsPanelTitleBar,
} from '../helpers/title-bar';
import {
  COMPILER_VERSION_LABEL,
  EXTENSION_VERSION_LABEL,
  MET_LABEL,
  UNMET_LABEL,
  VERSION_ABSENT,
  VersionStandings,
  dismissHtml,
  initiallyCollapsedStepIds,
  inlineHtml,
  stepsHtml,
  toggleLabel,
  versionsHtml,
  welcomeDocumentHtml,
} from '../../src/welcome-render';
import {
  ANCHOR_CANDIDATE_GLOB,
  CONFIG_FILENAME,
  WORKSPACE_ANCHOR_CONFIG,
  findAggregaWorkspaceAnchor,
} from '../../src/workspace';

// The manifest is read and parsed rather than pattern-matched: what is asserted
// below is a property of the declared contributions, and only a parse can see
// that.
const MANIFEST = path.resolve(__dirname, '../../../package.json');
const README = path.resolve(__dirname, '../../../README.md');
const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

// PRODUCT_README is the product documentation's own account of what Aggrega is,
// and it is the ORACLE the panel's description is checked against — the one
// copy this extension does not own. It sits outside this repository, so it is
// reachable when the extension is checked out beside the documentation and not
// when the extension is cloned alone; the assertion that uses it says which of
// those happened rather than passing quietly either way.
const PRODUCT_README = path.resolve(__dirname, '../../../../aggrega-docs/README.md');

// PRODUCT_CONFIGURATION_PAGE is the product's own account of how configuration
// is layered, and it is the ORACLE the panel's configuration wording is checked
// against for the same reason PRODUCT_README is the oracle for the product
// description: it is a copy this extension does not own and cannot move. It sits
// outside this repository, so the assertion that reads it says which of the two
// checkouts happened rather than passing quietly either way.
const PRODUCT_CONFIGURATION_PAGE = path.resolve(
  __dirname,
  '../../../../aggrega-docs/language-reference/cli/configuration.md',
);

// CONFIGURATION_FILE_LOCATIONS are the two places Aggrega's own configuration
// lives, and they are the one thing on these surfaces a reader will TYPE — so a
// stale one is worse than no sentence at all.
//
// They are literals here rather than the extension's own constant for the same
// reason the phrases below are: the check has to be able to disagree with this
// extension. The project file does have one home in the sources, and reading it
// from there would prove the two agree while proving nothing about whether
// either is what the product documents.
//
// The panel's list and the settings screen's both read THESE two rather than
// spelling either path a second time. Both lists are checked against the
// product's reference, so sharing the paths blinds nothing: an invented location
// fails on both surfaces instead of one.
const CONFIGURATION_FILE_LOCATIONS: readonly string[] = [
  '.aggrega-config.yaml',
  '~/.config/aggrega/config.yaml',
];

// SIMPLE_CASE_PHRASES are the load-bearing phrases the panel must carry about
// where configuration lives, WRITTEN OUT HERE AS LITERALS.
//
// 🔴 THEY ARE LITERALS ON PURPOSE, AND IMPORTING THE PANEL'S OWN CONSTANT WOULD
// DESTROY THE CHECK. A comparison whose two sides both read the step content
// moves both sides at once and passes any paraphrase — the same blindness the
// product description is guarded against. So these are transcribed from the
// product's configuration reference and held here, where an edit to the panel
// cannot reach them.
//
// Two assertions read them and they catch different things. One asserts the
// composed panel carries each phrase, which fails when the panel drops, trims or
// re-words one. The other asserts the product's own reference carries each
// phrase, which is the only one that can catch a paraphrase written HERE — a
// phrase this list invented would satisfy the first assertion forever.
const SIMPLE_CASE_PHRASES: readonly string[] = [
  ...CONFIGURATION_FILE_LOCATIONS,
  'two files, and most projects need nothing else',
  'because the block\'s presence is the marker',
  'the explicit choice and the one to prefer',
  'settings that belong to the machine rather than to any one project',
  'the registries you pull from and the signature trust policy for each',
  'how large the compiled-module store may grow',
  'and any command-extension plugin you have installed',
  'It loads automatically when it is there, and nothing breaks when it is not',
  'your project\'s file wins',
  'Secrets are not configuration',
  'never fields in either file',
];

// BEYOND_THE_SIMPLE_CASE is what a reader meeting Aggrega for the first time
// must NOT be taught on this surface. Each entry is a mechanism built for a
// project large enough to need it, and the panel names that such mechanisms
// exist and points at the reference rather than explaining any of them.
//
// The last two are wrong LOCATIONS for the file on the machine rather than
// mechanisms. They are here because a location is the one thing on this surface
// a reader will type, so a stale one is worse than no sentence at all.
const BEYOND_THE_SIMPLE_CASE: readonly string[] = [
  '<code>.aggrega</code>',
  'catalog_dirs_append',
  '.aggrega-config-append-ci.yaml',
  'resolved against the directory of the file that declared it',
  '/etc/aggrega',
  '~/.aggrega/config.yaml',
];

// REFUTED_CREDENTIAL_RATIONALE matches the plausible-and-wrong reason for the
// file on the machine: that it exists so credentials need not sit in a file the
// project commits. Credentials are not in either configuration file at all —
// they are supplied by environment variable or flag when they are needed — so
// the rationale is false, and it reads well enough to be written back in.
//
// 🔴 IT IS A TOKEN CHECK AND NOT A READING. It matches the vocabulary that
// rationale is written in and cannot judge a sentence that means the same thing
// in other words; the phrase asserted PRESENT above is what makes the claim
// self-contradicting for a reader. Both are needed and neither replaces the
// other.
const REFUTED_CREDENTIAL_RATIONALE =
  /(so|keeps?|keeping|rather than)[^.]*\b(credentials?|passwords?|secrets?|tokens?)\b[^.]*\b(out of|committed|shared|checked in|in the repository)\b/i;

interface ViewEntry { id?: unknown; name?: unknown; when?: unknown }
interface CommandEntry { command?: unknown; title?: unknown; category?: unknown; icon?: unknown }
interface MenuEntry { command?: unknown; when?: unknown; group?: unknown }

function manifest(): {
  activationEvents: string[];
  walkthroughs: unknown[];
  views: ViewEntry[];
  commands: CommandEntry[];
  palette: MenuEntry[];
  viewTitleMenus: MenuEntry[];
  version: string;
  properties: Record<string, {
    type?: unknown;
    default?: unknown;
    scope?: unknown;
    description?: unknown;
  }>;
  viewsWelcome: unknown[];
} {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    activationEvents: pkg.activationEvents ?? [],
    walkthroughs: pkg.contributes.walkthroughs ?? [],
    views: pkg.contributes.views.aggrega,
    commands: pkg.contributes.commands,
    palette: pkg.contributes.menus.commandPalette ?? [],
    viewTitleMenus: pkg.contributes.menus['view/title'] ?? [],
    version: pkg.version,
    properties: pkg.contributes.configuration.properties,
    viewsWelcome: pkg.contributes.viewsWelcome ?? [],
  };
}

// renderedPanel composes the panel exactly as the extension composes it, with
// the addresses the editor would have resolved standing in as plain strings.
// The composition holds no editor types, which is what makes the panel a reader
// meets assertable without an extension host.
//
// The arrangement is a parameter of its own here for the same reason it is one
// in the composition: it is not derivable from the standings beside it, so a
// caller that wants a particular arrangement has to say so.
//
// opensWithEditor defaults to the preference's own default, so a caller that
// says nothing about it composes the panel a reader meets on a fresh profile.
//
// versions defaults to a pair of readings that were taken, so a caller saying
// nothing about them composes the panel of a reader whose compiler is running.
// The default is a value rather than an absence for the same reason
// opensWithEditor's is: the common case should be what a caller gets for free.
function renderedPanel(
  standings: Record<StepId, boolean>,
  collapsed: readonly StepId[] = [],
  opensWithEditor = true,
  versions: VersionStandings = { extension: '9.9.9', compiler: '8.8.8' },
): string {
  return welcomeDocumentHtml({
    nonce: 'test-nonce',
    styleUri: 'vscode-resource://media/welcome.css',
    scriptUri: 'vscode-resource://media/welcome.js',
    cspSource: 'vscode-resource:',
    standings,
    collapsed,
    opensWithEditor,
    versions,
  });
}

// RETIRED_UNMET_WORD is the word the unmet standing used to read, kept here as
// the subject of an absence assertion rather than as a value anything composes.
//
// 🔴 IT IS SPELLED OUT SO THE ABSENCE CAN BE ASSERTED AT ALL. The word also
// means *excellent* in English, so on a list of standings it can read as praise
// for the step rather than as work left for the reader — and the glyph beside
// the word is hidden from assistive technology, which makes the word the only
// channel a reader using a screen reader gets. A search of the sources is what
// establishes that it is gone from the code; this is what establishes that it
// cannot come back through the composition without something failing.
const RETIRED_UNMET_WORD = 'Outstanding';

// MIXED is a workspace where two conditions hold and two do not.
//
// 🔴 IT IS THE ONLY FIXTURE THAT CATCHES A WRONGLY ATTRIBUTED SECTION — the
// arrangement being right in aggregate while the wrong sections carry it,
// because a step read a neighbour's standing rather than its own. Over a
// workspace where every condition is met, and over one where none is, every
// step has the same standing, so a rule reading the wrong step's standing
// returns exactly the right answer and both of those fixtures pass it.
//
// A WHOLESALE INVERSION IS A DIFFERENT AND WEAKER CASE, and worth stating
// because it is easy to assume the mixed fixture is the only thing standing
// between the panel and it. Negating the rule flips a uniform workspace's
// answer from nothing-closed to everything-closed, so the two uniform fixtures
// below catch an inversion on their own. What they cannot catch is the
// attribution, which is why the mixed one is here as well and not instead.
const MIXED = stepStandings({
  workspaceAnchored: true,
  compilerAnswering: false,
  releaseSelected: true,
  registryConfigured: false,
});

// MIXED_MET and MIXED_UNMET are the two halves of that workspace, spelled out
// rather than recomputed from the same filter the subject under test uses — a
// filter shared with the subject would move both sides of the comparison at
// once and pass an inversion.
const MIXED_MET: StepId[] = ['workspace', 'release'];
const MIXED_UNMET: StepId[] = ['compiler', 'registry'];

// expandedSteps and collapsedSteps report the sections a composed panel opens
// and closes, read back out of the document rather than from what was asked
// for. The caret's expansion state is what a screen reader is told, so it is
// what is read.
function expandedSteps(html: string): string[] {
  return [...html.matchAll(/aria-expanded="true" aria-controls="[^"]*" aria-label="[^"]*" data-toggle="([^"]+)"/g)]
    .map((m) => m[1]);
}

function collapsedSteps(html: string): string[] {
  return [...html.matchAll(/aria-expanded="false" aria-controls="[^"]*" aria-label="[^"]*" data-toggle="([^"]+)"/g)]
    .map((m) => m[1]);
}

// hiddenProse reports the sections whose explanation the document withholds.
// Read separately from the caret above, because the two are what must agree:
// a caret announcing a closed section over an explanation still on screen, or
// the reverse, is the failure this pair catches.
function hiddenProse(html: string): string[] {
  return [...html.matchAll(/<div class="step-prose" id="step-prose-([^"]+)" hidden>/g)]
    .map((m) => m[1]);
}

// sectionOf cuts one step's markup out of the composed list, so an assertion
// about what a section contains cannot be satisfied by a neighbour.
function sectionOf(html: string, id: StepId): string {
  const opens = html.indexOf(`data-step="${id}"`);
  assert.ok(opens >= 0, `the composed panel carries no ${id} section`);
  const ends = html.indexOf('</section>', opens);
  return html.slice(opens, ends);
}

// commandsInPanel collects the commands the panel's controls actually carry, as
// they appear in the composed document — so what is asserted is what a press
// would send, not what a list of constants says.
function commandsInPanel(html: string): string[] {
  return [...html.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1]);
}

describe('the welcome panel', () => {
  describe('what the panel means', () => {
    it('reports every condition met for a reader who configured everything elsewhere', () => {
      assert.deepStrictEqual(unmetStepIds(EVERYTHING_MET), []);
      assert.deepStrictEqual(stepStandings(EVERYTHING_MET), {
        workspace: true, compiler: true, release: true, registry: true,
      });
    });

    it('reports every condition still to do for a reader who has just installed it', () => {
      assert.deepStrictEqual(unmetStepIds(NOTHING_MET), [...STEP_IDS]);
    });

    // Each condition is read from its own fact and from no other. A step that
    // quietly tracked a neighbour would report itself met on the strength of
    // something the reader never did.
    it('reads each condition from its own fact alone', () => {
      for (const id of STEP_IDS) {
        const facts = { ...NOTHING_MET };
        switch (id) {
          case 'workspace': facts.workspaceAnchored = true; break;
          case 'compiler': facts.compilerAnswering = true; break;
          case 'release': facts.releaseSelected = true; break;
          case 'registry': facts.registryConfigured = true; break;
        }
        assert.strictEqual(stepMet(id, facts), true, `${id} did not read its own fact`);
        assert.deepStrictEqual(
          unmetStepIds(facts),
          STEP_IDS.filter((other) => other !== id),
          `satisfying ${id} moved another step`,
        );
      }
    });
  });

  // 🔴 THE DEFECT THE MOVE EXISTS TO FIX, ASSERTED IN BOTH DIRECTIONS.
  //
  // The editor's own step completion is monotonic and persisted: once a step is
  // checked off it stays checked off, so a condition that later lapsed left its
  // step showing met. A panel this extension draws has no such constraint, and
  // these are the assertions that fail if anything ever accumulates a mark
  // rather than recomputing it.
  //
  // Every composition below is asked for with NOTHING closed, whatever the
  // standings are, and that is deliberate: the mark is the subject here, and
  // asking for the arrangement separately is what keeps these assertions from
  // moving when the arrangement rules change.
  describe('a step follows its condition in both directions', () => {
    it('marks a step met when its condition holds', () => {
      const html = stepsHtml(stepStandings(EVERYTHING_MET), []);
      for (const step of STEP_CONTENT) {
        assert.ok(
          html.includes(`class="step step-met" data-step="${step.id}"`),
          `${step.id} is not marked met though its condition holds`,
        );
      }
      assert.ok(!html.includes('step-unmet'), 'a step is still to do with every condition met');
    });

    it('marks a step still to do again when its condition lapses', () => {
      // The same step, read from facts that satisfied it and then from facts
      // that no longer do. Nothing between the two calls carries a mark
      // forward, which is the whole property: the second render is composed
      // from the second reading alone.
      const held = stepsHtml(stepStandings(EVERYTHING_MET), []);
      assert.ok(held.includes('class="step step-met" data-step="compiler"'));

      const lapsed = stepsHtml(
        stepStandings({ ...EVERYTHING_MET, compilerAnswering: false }),
        [],
      );
      assert.ok(
        lapsed.includes('class="step step-unmet" data-step="compiler"'),
        'a condition that lapsed left its step marked met, which is the defect this panel exists to fix',
      );
      // And only that one moved.
      for (const other of ['workspace', 'release', 'registry']) {
        assert.ok(
          lapsed.includes(`class="step step-met" data-step="${other}"`),
          `${other} moved when the compiler condition lapsed`,
        );
      }
    });

    it('says the standing in words as well as in a mark', () => {
      const met = stepsHtml(stepStandings(EVERYTHING_MET), []);
      const unmet = stepsHtml(stepStandings(NOTHING_MET), []);
      assert.ok(met.includes(MET_LABEL), 'a met step says so in words');
      assert.ok(unmet.includes(UNMET_LABEL), 'a step still to do says so in words');
      assert.ok(
        !met.includes(UNMET_LABEL),
        'a panel with every condition met still reads as having work left',
      );
    });

    // 🔴 THE WORD FOR AN UNMET STEP IS THE ONLY CHANNEL A SCREEN READER GETS,
    // WHICH IS WHY IT IS ASSERTED RATHER THAN LEFT TO THE CONSTANT.
    //
    // The mark beside it is drawn `aria-hidden`, deliberately — it is a glyph
    // repeating what the word already says — so a reader using a screen reader
    // is told the standing by this word and by nothing else. That makes an
    // ambiguous word a defect rather than a preference, and the retired one was
    // ambiguous in the worst direction: it also means *excellent*, so it could
    // read as praise for the step rather than as a job for the reader.
    it('names an unmet step as work to do, in a word that cannot read as praise', () => {
      assert.strictEqual(
        UNMET_LABEL,
        'To do',
        'the unmet standing is the only channel a screen reader has for what a step needs, so it names the job plainly',
      );
      assert.strictEqual(MET_LABEL, 'Met');
      assert.notStrictEqual(
        UNMET_LABEL,
        RETIRED_UNMET_WORD,
        'the retired word is back on the badge, and it reads as praise for the step to exactly the reader who has only the word',
      );
    });

    // 🔴 THE MARK IS HIDDEN FROM ASSISTIVE TECHNOLOGY, WHICH IS THE PREMISE THE
    // ASSERTION ABOVE RESTS ON — so it is asserted rather than assumed. If the
    // glyph ever stopped being hidden the word would no longer be the only
    // channel, and the reasoning for the word would need re-deciding rather
    // than silently ceasing to apply.
    it('draws the glyph as decoration, so the word carries the standing alone', () => {
      const html = stepsHtml(MIXED, []);
      assert.ok(
        html.includes('<span class="step-mark" aria-hidden="true">'),
        'the mark is announced as well as drawn, so the standing now reaches a screen reader twice and the word is no longer its only channel',
      );
    });

    // An absence claim with its instrument named: the composition itself. A
    // search of the sources is the other half and is not something an assertion
    // can do; this half is the one that fails if the word returns through a
    // constant, a label or a piece of step prose.
    it('composes no panel carrying the retired unmet word, in either standing', () => {
      for (const standings of [EVERYTHING_MET, NOTHING_MET]) {
        for (const opensWithEditor of [true, false]) {
          const html = renderedPanel(stepStandings(standings), [], opensWithEditor);
          assert.ok(
            !html.includes(RETIRED_UNMET_WORD),
            `the composed panel carries "${RETIRED_UNMET_WORD}"`,
          );
          assert.ok(
            !html.toLowerCase().includes(RETIRED_UNMET_WORD.toLowerCase()),
            `the composed panel carries "${RETIRED_UNMET_WORD}" in some other case`,
          );
        }
      }
    });

    // 🔴 THE SECOND SURFACE, AND MISSING IT IS THE LIKELY FAILURE. The badge is
    // one place the standings are named; the settings screen's own description
    // of the panel is the other, and it names them in lowercase prose where no
    // assertion about the composed document reaches it.
    it('describes the standings in the settings screen in the words the badge uses', () => {
      const description = String(
        manifest().properties[WELCOME_SHOW_SETTING].description ?? '',
      );
      assert.ok(description.length > 0, 'the preference carries no description at all');
      assert.ok(
        !description.toLowerCase().includes(RETIRED_UNMET_WORD.toLowerCase()),
        'the settings screen still describes an unmet step with the retired word, so the two surfaces name one standing two ways',
      );
      assert.ok(
        description.toLowerCase().includes(UNMET_LABEL.toLowerCase()),
        `the settings screen does not name the unmet standing as "${UNMET_LABEL}", which is what the badge reads`,
      );
      // 🔴 The met word is deliberately NOT asserted the same way. It is three
      // letters and a substring of ordinary words — a check for it would pass on
      // "metadata" and prove nothing, which is worse than no check because it
      // reads as one. The unmet word is the one that moved and the one whose
      // spelling is distinctive enough to look for.
    });
  });

  // 🔴 THE ARRANGEMENT IS DECIDED ONCE AND THE MARK IS DECIDED EVERY TIME, AND
  // THAT ASYMMETRY IS THE SUBJECT OF THIS WHOLE BLOCK.
  //
  // They are neighbours and they look like one behaviour, so collapsing them
  // into one is the obvious simplification — and it is wrong in both
  // directions. A mark held still stops reporting a condition that lapsed. An
  // arrangement recomputed folds a step away under a reader who is in the
  // middle of reading it, on an event they never initiated, and discards
  // whatever they had toggled while it is at it.
  describe('which sections a panel opens', () => {
    it('closes the satisfied sections and leaves the ones still to do open', () => {
      const collapsed = initiallyCollapsedStepIds(MIXED);
      assert.deepStrictEqual(
        collapsed,
        MIXED_MET,
        'the sections a panel opens closed are the ones whose condition is already satisfied: the panel exists to show what is still needed',
      );
      assert.deepStrictEqual(
        STEP_IDS.filter((id) => !collapsed.includes(id)),
        MIXED_UNMET,
        'a step still to do opens closed, so the reader is shown a title where they needed an explanation',
      );
    });

    // The inversion is one character away in the subject: negate the filter and
    // the panel folds away every step still to do and opens every satisfied
    // one, which reads as deliberate, produces no error, and is the exact
    // opposite of what the panel is for. The equality above already excludes
    // it; this names it, and checks first that the fixture still has conditions
    // on both sides — a fixture that drifted to uniform would go on passing
    // while quietly testing less than it says.
    it('does not open the still-to-do sections closed, which is the inversion', () => {
      const collapsed = initiallyCollapsedStepIds(MIXED);
      assert.deepStrictEqual(
        MIXED_UNMET,
        STEP_IDS.filter((id) => !MIXED[id]),
        'this fixture no longer has conditions on both sides, so it can no longer tell the rule from its inversion',
      );
      assert.notDeepStrictEqual(
        collapsed,
        MIXED_UNMET,
        'the arrangement is inverted: the satisfied steps are open and the ones still to do are folded away, so the panel hides exactly the work it exists to show',
      );
    });

    it('opens every section for a reader who has satisfied nothing', () => {
      assert.deepStrictEqual(initiallyCollapsedStepIds(stepStandings(NOTHING_MET)), []);
    });

    it('closes every section for a reader who configured everything elsewhere', () => {
      assert.deepStrictEqual(
        initiallyCollapsedStepIds(stepStandings(EVERYTHING_MET)),
        [...STEP_IDS],
        'a reader who has satisfied every condition is asked nothing, so the panel opens as four titles and their controls',
      );
    });

    // 🔴 THE ASSERTION THAT FAILS IF THE ARRANGEMENT IS EVER RE-DERIVED INSIDE
    // THE COMPOSITION. Every condition here is met and nothing is asked to be
    // closed, and the composition must honour that rather than deciding for
    // itself — because that is the state a reader is in the moment after they
    // satisfy the last step while looking at it.
    it('composes the arrangement it is given, not the one the standings imply', () => {
      const html = stepsHtml(stepStandings(EVERYTHING_MET), []);
      assert.deepStrictEqual(
        collapsedSteps(html),
        [],
        'the composition closed a section nobody asked it to close, so it is deriving the arrangement from the standings — and a step satisfied while it was being read will fold up under the reader',
      );
      assert.deepStrictEqual(hiddenProse(html), []);
      assert.deepStrictEqual(expandedSteps(html), [...STEP_IDS]);
    });

    it('composes a closure the reader asked for even where the step is still to do', () => {
      const html = stepsHtml(stepStandings(NOTHING_MET), ['compiler']);
      assert.deepStrictEqual(
        collapsedSteps(html),
        ['compiler'],
        'a reader who closes a section still to do is entitled to have it stay closed',
      );
      assert.deepStrictEqual(hiddenProse(html), ['compiler']);
    });

    // 🔴 THE MARK MOVES AND THE ARRANGEMENT DOES NOT — the two halves in one
    // assertion, over one section, across the moment the condition changes.
    // It is the state a reader is in whenever they satisfy a step while its
    // section is open, which is the ordinary way of satisfying one.
    it('leaves a section open when its condition becomes satisfied under the reader', () => {
      const before = stepsHtml(stepStandings(NOTHING_MET), []);
      assert.ok(before.includes('class="step step-unmet" data-step="compiler"'));
      assert.ok(expandedSteps(before).includes('compiler'));

      // The same arrangement, re-composed from standings that now satisfy the
      // step the reader is reading. The arrangement is passed unchanged because
      // nothing the reader did changed it.
      const after = stepsHtml(
        stepStandings({ ...NOTHING_MET, compilerAnswering: true }),
        [],
      );
      assert.ok(
        after.includes('class="step step-met" data-step="compiler"'),
        'the mark did not follow the condition: holding the arrangement still has held the mark still along with it, and those are two different things',
      );
      assert.ok(
        expandedSteps(after).includes('compiler'),
        'the section folded up when its condition became satisfied, under a reader who was reading it — the arrangement is following the standings instead of the reader',
      );
      assert.deepStrictEqual(hiddenProse(after), []);
    });

    // The whole point of recording what is CLOSED rather than what is open: a
    // panel composed before anything was decided and a panel a reader has
    // closed nothing in are the same panel.
    it('treats an empty arrangement as every section open', () => {
      assert.deepStrictEqual(
        expandedSteps(stepsHtml(MIXED, [])),
        [...STEP_IDS],
      );
    });

    // 🔴 THE ARRANGEMENT AND THE MARKS AGREE WHEN BOTH COME FROM ONE READING —
    // ASSERTED OVER A MIXED WORKSPACE, WHICH IS THE ONLY FIXTURE THAT CAN TELL.
    //
    // This is the composed end-to-end shape rather than the two halves checked
    // apart: the derivation is asserted above and the composition is asserted
    // above, and both pass while the panel still folds the wrong sections if
    // the two are wired to each other crosswise. Over a uniform workspace they
    // cannot be told apart — every step has the same standing, so a rule
    // reading a neighbour's returns the right answer — which is why this runs
    // over a fixture with conditions on both sides.
    it('folds exactly the satisfied sections when the arrangement is read from the same standings', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      assert.deepStrictEqual(
        collapsedSteps(html).sort(),
        [...MIXED_MET].sort(),
        'the folded sections are not the satisfied ones, so a step is carrying a neighbour\'s standing',
      );
      assert.deepStrictEqual(
        expandedSteps(html).sort(),
        [...MIXED_UNMET].sort(),
        'the open sections are not the ones still to do, so the panel is not opening on the work it exists to show',
      );
      assert.deepStrictEqual(
        hiddenProse(html).sort(),
        [...MIXED_MET].sort(),
        'the withheld explanations are not the satisfied steps\'',
      );
      // And the marks agree with the folds, per step, over the same reading.
      for (const id of MIXED_MET) {
        assert.ok(
          html.includes(`class="step step-met" data-step="${id}"`),
          `${id} is folded but not marked met, so the fold and the mark disagree about one step`,
        );
      }
      for (const id of MIXED_UNMET) {
        assert.ok(
          html.includes(`class="step step-unmet" data-step="${id}"`),
          `${id} is open but marked met, so the fold and the mark disagree about one step`,
        );
      }
    });

    // 🔴 THE ARRANGEMENT IS A PURE FUNCTION OF THE READING IT IS GIVEN, AND THAT
    // IS WHY *WHEN* THE READING IS TAKEN DECIDES WHETHER THE PANEL IS RIGHT.
    //
    // This is the assertion that names the defect the opening moment exists to
    // avoid, at the only level a test here can reach it. A reading taken before
    // the four conditions are established is honestly all-false, and the
    // arrangement derived from it is empty — permanently, because the
    // arrangement is deliberately not live. So a panel created from such a
    // reading opens every section, and then the marks correct themselves on the
    // next refresh while the folds cannot. A reader who had satisfied
    // everything would meet four ticked steps with every explanation showing.
    //
    // 🔴 WHAT THIS DOES NOT PROVE, STATED SO THE GREEN IS NOT READ AS WIDER
    // THAN IT IS: that the extension takes its reading at a settled moment.
    // That wiring lives in the module that holds the editor types, which no
    // test in this container can load. Only a person opening a cold window can
    // see it, and the operator's walk is where that is recorded.
    it('derives an empty arrangement from an unsettled reading, whatever the facts later are', () => {
      const unsettled = stepStandings(NOTHING_MET);
      assert.deepStrictEqual(
        initiallyCollapsedStepIds(unsettled),
        [],
        'an all-false reading no longer yields an empty arrangement, so the reasoning for when the reading is taken no longer holds and must be re-decided rather than assumed',
      );
      // The shape a reader who has satisfied everything would meet if the panel
      // were created from that reading: every mark corrected, every section
      // still open.
      const drawnFromUnsettled = stepsHtml(
        stepStandings(EVERYTHING_MET),
        initiallyCollapsedStepIds(unsettled),
      );
      assert.deepStrictEqual(
        collapsedSteps(drawnFromUnsettled),
        [],
        'the composition folded a section the arrangement did not name, which would hide this defect rather than fix it',
      );
      // And the arrangement the same reader is entitled to, from a settled one.
      assert.deepStrictEqual(
        initiallyCollapsedStepIds(stepStandings(EVERYTHING_MET)),
        [...STEP_IDS],
        'a settled all-met reading no longer folds every section',
      );
    });
  });

  // A closed section is not a title. It keeps both ways forward and hides only
  // the explanation, which is unusual enough that it is asserted rather than
  // left to be preserved by whoever reads the layout next.
  describe('what a closed section still shows', () => {
    it('keeps both controls in a closed section', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      for (const id of MIXED_MET) {
        const section = sectionOf(html, id as StepId);
        const step = STEP_CONTENT.find((s) => s.id === id);
        assert.ok(step, `no content for ${id}`);
        for (const action of step.actions) {
          // The whole control, not merely the command it names: a closed
          // section that carried the command in some other element would have
          // nothing for the reader to press.
          assert.ok(
            section.includes(
              `<button class="step-action" type="button" data-command="${escapeHtml(action.command)}">${escapeHtml(action.label)}</button>`,
            ),
            `the closed ${id} section dropped its "${action.label}" control; a closed section hides the explanation and keeps both ways forward`,
          );
        }
      }
    });

    it('keeps the title and the standing in a closed section', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      for (const id of MIXED_MET) {
        const section = sectionOf(html, id as StepId);
        const step = STEP_CONTENT.find((s) => s.id === id);
        assert.ok(step);
        assert.ok(section.includes(escapeHtml(step.title)), `the closed ${id} section has no title`);
        assert.ok(section.includes(MET_LABEL), `the closed ${id} section no longer says its standing`);
      }
    });

    it('withholds the explanation of a closed section and only that', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      assert.deepStrictEqual(
        hiddenProse(html).sort(),
        [...MIXED_MET].sort(),
        'the sections whose explanation is withheld are not the sections that are closed',
      );
    });
  });

  // The caret is a control, so it is reachable, named, and says which way it is
  // pointing. None of that is optional and none of it is visible in a
  // screenshot.
  describe('the caret that opens a section', () => {
    it('gives every section a caret that toggles it', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      for (const id of STEP_IDS) {
        assert.ok(
          sectionOf(html, id).includes(`data-toggle="${id}"`),
          `the ${id} section has no caret, so there is nothing to open or close it with`,
        );
      }
    });

    it('names every caret for a reader who cannot see it', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      for (const step of STEP_CONTENT) {
        assert.ok(
          sectionOf(html, step.id).includes(`aria-label="${escapeHtml(toggleLabel(step.title))}"`),
          `the ${step.id} caret is an unnamed control, which is announced as "button" and nothing else`,
        );
      }
    });

    // The caret's own state and the region's state are two attributes, and the
    // stylesheet draws the caret's direction from the first of them — so this
    // is the assertion that fails if they ever come apart.
    it('points the way the section actually is', () => {
      const html = stepsHtml(MIXED, initiallyCollapsedStepIds(MIXED));
      assert.deepStrictEqual(collapsedSteps(html).sort(), [...MIXED_MET].sort());
      assert.deepStrictEqual(expandedSteps(html).sort(), [...MIXED_UNMET].sort());
      assert.deepStrictEqual(
        collapsedSteps(html).sort(),
        hiddenProse(html).sort(),
        'a caret announces a state the explanation beside it does not have, so one reader is told the section is closed and another sees it open',
      );
    });

    it('addresses the region it controls', () => {
      const html = stepsHtml(MIXED, []);
      for (const id of STEP_IDS) {
        const section = sectionOf(html, id);
        assert.ok(
          section.includes(`aria-controls="step-prose-${id}"`),
          `the ${id} caret does not say which region it governs`,
        );
        assert.ok(
          section.includes(`id="step-prose-${id}"`),
          `the ${id} caret names a region the document does not carry`,
        );
      }
    });
  });

  // What the panel reports back is a payload from a document, so it is checked
  // rather than trusted — and normalised, so one arrangement has one spelling.
  describe('reading the arrangement a panel reports', () => {
    it('keeps the sections that exist and drops the rest', () => {
      assert.deepStrictEqual(
        readCollapsedSteps(['registry', 'not-a-step', 'workspace']),
        ['workspace', 'registry'],
      );
    });

    it('answers nothing closed for anything that is not a list of sections', () => {
      for (const value of [undefined, null, 'workspace', 42, {}, { collapsed: [] }]) {
        assert.deepStrictEqual(readCollapsedSteps(value), [], `${JSON.stringify(value)} was read as an arrangement`);
      }
    });

    it('answers in condition order however the panel ordered it', () => {
      assert.deepStrictEqual(
        readCollapsedSteps(['registry', 'compiler', 'workspace', 'release']),
        [...STEP_IDS],
      );
    });

    it('drops an entry that is not a string at all', () => {
      assert.deepStrictEqual(readCollapsedSteps(['workspace', 7, null]), ['workspace']);
    });
  });

  describe('what the panel is', () => {
    // 🔴 THE CONTRIBUTION IS RETIRED, NOT LEFT BESIDE THE PANEL. Two surfaces
    // offering the same onboarding is worse than either alone: they drift, and
    // a reader meeting the editor's own welcome page would find a second,
    // stale Aggrega flow inside it.
    it('contributes no walkthrough at all', () => {
      assert.deepStrictEqual(
        manifest().walkthroughs,
        [],
        'the welcome is Aggrega\'s own panel in its own tab; a surviving walkthrough would put a second onboarding flow inside the editor\'s welcome page',
      );
    });

    // 🔴 THE ASSERTION THAT FAILS WHEN THE PANEL BECOMES UNREACHABLE FOR THE
    // READER IT EXISTS FOR.
    //
    // A panel this extension draws cannot open before this extension runs. The
    // reader a welcome panel is for is the one who has just installed it and
    // opened a folder with nothing in it — no Aggrega YAML, no configuration
    // file — so neither the language event nor the workspace-contains event
    // fires for them. An activation event with no workspace precondition is
    // what covers that, and without one the manifest stays well formed, the
    // panel stays registered, every other assertion here passes, and the panel
    // never opens for anybody who needs it.
    it('activates with no workspace precondition, so the panel can open at all', () => {
      const events: string[] = manifest().activationEvents;
      const unconditional = events.filter(
        (e) => e === 'onStartupFinished' || e === '*',
      );
      assert.ok(
        unconditional.length > 0,
        `every activation event this extension declares is conditional on the workspace (${events.join(', ')}), so a reader who opens an empty folder starts nothing — and the welcome panel, which this extension draws, can never open for them`,
      );
    });

    it('opens in its own tab, titled for Aggrega', () => {
      assert.ok(
        WELCOME_PANEL_TITLE.includes('Aggrega'),
        'a tab is read in a strip beside whatever else is open, so its title has to say whose it is',
      );
      assert.ok(renderedPanel(stepStandings(NOTHING_MET)).includes(WELCOME_PANEL_TITLE));
    });

    // 🔴 NO ROUTE BACK TO THE EDITOR'S OWN WELCOME PAGE. A reader who opened
    // Aggrega's panel is not partway through someone else's flow, and offering
    // a way "back" to a page they never came from would say they are. This
    // asserts the absence of any link at all, which is stronger than naming the
    // one command a route would go through: a breadcrumb or a header pointing
    // there would need an anchor, and there are none.
    it('offers no route back to the editor\'s welcome page', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      assert.ok(!/<a[\s>]/.test(html), 'the panel carries a link, and it has nowhere legitimate to link to');
      assert.ok(
        !/walkthrough/i.test(html),
        'the panel mentions the surface it was moved out of',
      );
      assert.ok(
        !html.includes('command:'),
        'the panel carries a command link, which is the walkthrough\'s way of drawing a control rather than this panel\'s',
      );
    });

    it('costs the sidebar container no slot', () => {
      const { views, viewsWelcome } = manifest();
      const stranded = views.filter((v) => String(v.id).startsWith('aggrega.getStarted'));
      assert.deepStrictEqual(
        stranded.map((v) => v.id),
        [],
        `the welcome is an editor-area panel, so it must cost the sidebar container no slot; these views remain: ${stranded.map((v) => String(v.id)).join(', ')}`,
      );
      assert.deepStrictEqual(
        viewsWelcome,
        [],
        'a view-welcome contribution survives the view it was drawn in, so its content is declared against nothing',
      );
    });

    // The container's own order is asserted where the container is the subject.
    // What matters here is only that the panel takes none of its slots.
    it('leaves the container carrying its own four panels', () => {
      assert.deepStrictEqual(
        manifest().views.map((v) => v.id),
        [
          'aggrega.operations',
          'aggrega.registries',
          'aggrega.workspaceCatalog',
          'aggrega.plugins',
        ],
        'the panel costs no sidebar slot, so the container reads Commands, Registries, Catalog, Plugins in both states — shown and dismissed',
      );
    });

    // The panel names its own stylesheet and script, and the editor serves them
    // from this installation. A named file that is not there leaves a panel that
    // opens and draws nothing.
    it('ships the resources the panel names', () => {
      for (const asset of ['media/welcome.css', 'media/welcome.js']) {
        assert.ok(
          fs.existsSync(path.join(EXTENSION_ROOT, asset)),
          `the panel names ${asset}, which is not in the extension`,
        );
      }
    });
  });

  describe('what the panel says', () => {
    // 🔴 THE COMPOSITION DELIVERS THE WORDS WHOLE. This is the assertion that
    // fails when the panel trims, re-wraps or otherwise reshapes the
    // description on its way to the reader — the layout being made to fit the
    // words rather than the other way round.
    //
    // 🔴 IT DOES NOT, AND CANNOT, CATCH AN EDIT TO THE CONSTANT ITSELF: both
    // sides of this comparison read the same constant, so editing it moves
    // both. What anchors the wording to the product is the separate assertion
    // below, against a copy this extension does not own.
    it('delivers the greeting and the product description into the panel whole', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      assert.ok(
        html.includes(WELCOME_GREETING),
        'the panel does not carry the greeting as it is written',
      );
      assert.ok(
        html.includes(WELCOME_DESCRIPTION),
        'the panel must carry the product description exactly as it is written, not a paraphrase, a trim, or a re-wrap to fit the layout',
      );
    });

    // 🔴 THE DESCRIPTION IS TRANSCRIBED, NEVER COMPOSED — and this is the only
    // assertion that can tell. It compares the words the panel opens with
    // against the product documentation's own account of what Aggrega is, which
    // is a copy this extension does not own and cannot move: two divergent
    // descriptions of the product is exactly the drift a single source exists
    // to prevent, and a paraphrase reads perfectly well, so nothing but an
    // exact comparison against an independent copy catches it.
    it('carries the description the product documentation carries, character for character', function () {
      if (!fs.existsSync(PRODUCT_README)) {
        // Checked out without the documentation beside it. Reported as pending
        // rather than passed: a silent skip would read as the anchor holding.
        this.skip();
        return;
      }
      const docs = fs.readFileSync(PRODUCT_README, 'utf8');
      assert.ok(
        docs.includes(WELCOME_DESCRIPTION),
        'the panel\'s description of Aggrega is not the one the product documentation carries, so the product now has two accounts of itself',
      );
    });

    it('declares the preference as a reader-facing switch that starts on', () => {
      const property = manifest().properties[WELCOME_SHOW_SETTING];
      assert.ok(property, `the manifest declares no ${WELCOME_SHOW_SETTING} preference`);
      assert.strictEqual(property.type, 'boolean');
      assert.strictEqual(
        property.default,
        true,
        'the panel starts on: a reader who wants it gone says so, and one who has read nothing yet is exactly the reader who would not notice a switch already thrown',
      );
    });

    // 🔴 ONE SETTING, RE-POINTED — NEVER A SECOND ONE. One user-facing concept
    // has exactly one name, and a second key meaning "do not show the welcome"
    // would be two divergent names covering one concept.
    it('gates the panel on one preference and no other', () => {
      const welcomeKeys = Object.keys(manifest().properties)
        .filter((k) => k.startsWith('aggrega.getStarted.'));
      assert.deepStrictEqual(
        welcomeKeys,
        [WELCOME_SHOW_SETTING],
        'a second preference covers the same concept as the one that already gates the panel',
      );
    });

    // One step per condition, in condition order, and nothing else. A fifth
    // step would be an entry in a checklist that no fact ever checks off, so it
    // would read as work to do forever.
    it('carries one step per condition, in condition order', () => {
      assert.deepStrictEqual(
        STEP_CONTENT.map((s) => s.id),
        [...STEP_IDS],
        'the panel\'s steps are the conditions the extension needs, in the order each one\'s remedy depends on the ones above it',
      );
    });

    // 🔴 BOTH WAYS THROUGH EVERY STEP — create one, or point at one you already
    // have. The pair is fixed in the type, so a step offering one way does not
    // compile; this asserts what the type cannot, which is that the two are
    // actually different offers rather than the same one twice.
    it('offers two distinct ways through every step', () => {
      for (const step of STEP_CONTENT) {
        const [first, second] = step.actions;
        assert.notStrictEqual(
          first.command,
          second.command,
          `the ${step.id} step offers the same command twice, so a reader who already has the thing is still only offered the way to create one`,
        );
        assert.ok(first.label.length > 0 && second.label.length > 0);
      }
    });

    it('explains every step as well as naming it', () => {
      for (const step of STEP_CONTENT) {
        assert.ok(step.title.length > 0, `the ${step.id} step has no title`);
        assert.ok(step.summary.length > 0, `the ${step.id} step has no summary`);
        assert.ok(
          step.detail.length > 0,
          `the ${step.id} step says what it is but not what the condition is for, so the panel is a checklist rather than somewhere to read about the product`,
        );
      }
    });

    // The editor derives an activation event from each declared command, so a
    // control naming an undeclared one would do nothing at all for a reader
    // whose workspace has not otherwise started the extension — and it is a
    // failure that reports nothing anywhere.
    it('declares every command a control invokes', () => {
      const declared = new Set(manifest().commands.map((c) => String(c.command)));
      const invoked = [...new Set(commandsInPanel(renderedPanel(stepStandings(NOTHING_MET))))];
      assert.ok(invoked.length > 0, 'the panel draws no controls at all');
      const undeclared = invoked.filter((c) => !declared.has(c));
      assert.deepStrictEqual(
        undeclared,
        [],
        `these controls invoke commands the manifest does not declare, so pressing one does nothing: ${undeclared.join(', ')}`,
      );
    });

    // 🔴 WHAT A PRESS CAN REACH IS EXACTLY WHAT THE PANEL DRAWS. The guard the
    // host checks a press against is derived from the same content the controls
    // are drawn from, so neither can grow past the other. Asserted as a set
    // equality in both directions, because a guard that admitted more than the
    // panel offers would be the interesting failure and a subset check would
    // pass it.
    // 🔴 THE UNION ACROSS BOTH STANDINGS OF THE FOOT CONTROL, NOT ONE OF THEM.
    // The panel draws one of two controls at its foot according to the
    // preference, so no single composition carries every command the guard must
    // admit — and a subset check in either direction would pass a guard that
    // had been widened by hand to admit something no control can carry. Set
    // equality over the union keeps the property the guard exists for: what a
    // press can reach is exactly what the panel is able to draw.
    it('admits exactly the commands its own controls can carry, in either standing', () => {
      const opening = commandsInPanel(renderedPanel(stepStandings(NOTHING_MET), [], true));
      const withheld = commandsInPanel(renderedPanel(stepStandings(NOTHING_MET), [], false));
      const drawn = [...new Set([...opening, ...withheld])].sort();
      const admitted = [...new Set(panelControlCommands())].sort();
      assert.deepStrictEqual(
        admitted,
        drawn,
        'the guard on a press and the controls the panel draws have come apart',
      );
      // And each standing genuinely draws a different one, so the union above
      // is a union of two things rather than the same set twice.
      assert.notDeepStrictEqual(
        [...new Set(opening)].sort(),
        [...new Set(withheld)].sort(),
        'both standings of the foot control draw the same command, so this fixture can no longer tell the two apart',
      );
    });

    // 🔴 THE ONE DECISION THAT BELONGS TO NO STEP, AT THE FOOT AND OUTSIDE THE
    // STEP LIST — which is the placement that lets it exist at all. The steps
    // are the conditions and nothing else, so a control belonging to none of
    // them has nowhere to sit AMONG them; the foot of the page is not among
    // them, and that is what this asserts rather than the styling.
    it('carries the panel\'s own switch at its foot, outside the step list', () => {
      const html = renderedPanel(MIXED);
      const stepsAt = html.indexOf('<div id="steps"');
      const dismissAt = html.indexOf('<div id="dismiss"');
      assert.ok(stepsAt >= 0, 'the panel carries no step list');
      assert.ok(dismissAt >= 0, 'the panel carries no control at its foot at all');
      assert.ok(
        dismissAt > stepsAt,
        'the foot control is composed before the step list, so it is not at the foot',
      );
      assert.ok(
        !html.slice(stepsAt, dismissAt).includes('dismiss-checkbox'),
        'the foot control sits inside the step list, which is the placement the steps-are-the-conditions rule forbids',
      );
      assert.ok(
        html.includes('id="dismiss" class="welcome-dismiss"'),
        'the foot control has no region of its own, so it cannot be re-composed when the preference moves without the step list being re-drawn with it',
      );
    });

    // 🔴 THE CONTROL IS COMPOSED FROM THE PREFERENCE, WHICH IS WHAT MAKES IT THE
    // SAME SWITCH AS THE SETTINGS SCREEN'S RATHER THAN A SECOND ONE BESIDE IT. A
    // reader who turned the page off elsewhere meets a control already
    // reflecting that, and a press moves the preference the way it is not
    // already set.
    it('offers the switch in the direction the preference is not already in', () => {
      const opening = dismissHtml(true);
      const withheld = dismissHtml(false);
      assert.ok(
        opening.includes(`data-command="${DISMISS_COMMAND}"`),
        'a page that opens on startup does not offer to stop doing so',
      );
      assert.ok(
        !opening.includes(`data-command="${WELCOME_SHOW_COMMAND}"`),
        'a page that already opens on startup offers to make it open, which is a control with nothing to do',
      );
      assert.ok(
        withheld.includes(`data-command="${WELCOME_SHOW_COMMAND}"`),
        'a page the reader turned off does not offer the way back from where they are reading it',
      );
      assert.ok(
        !withheld.includes(`data-command="${DISMISS_COMMAND}"`),
        'a page already withheld offers to withhold it again',
      );
    });

    // 🔴 THE WORDS REPORT THE PREFERENCE AND DO NOT MOVE WITH IT, WHICH IS THE
    // WHOLE POINT OF A TICK. A control whose words changed with the standing
    // would be describing the press again, leaving the reader to work the
    // current value out backwards from the offer — so the SAME words appearing
    // in both standings is the property, not an oversight.
    //
    // The words are also asserted to be the ones the manifest's own description
    // is written in, because a reader searching the settings screen for them is
    // the reason they were chosen.
    it('names the preference in the same words in both standings', () => {
      const opening = dismissHtml(true);
      const withheld = dismissHtml(false);
      const words = escapeHtml(PANEL_SETTING_LABEL);
      assert.ok(opening.includes(words), 'the ticked control does not carry the preference\'s words');
      assert.ok(withheld.includes(words), 'the unticked control does not carry the preference\'s words');
      assert.ok(
        /on startup/i.test(PANEL_SETTING_LABEL),
        'the control does not say WHEN the page opens, so a reader cannot tell what the tick decides',
      );
      const description = String(manifest().properties[WELCOME_SHOW_SETTING].description ?? '');
      assert.ok(
        /welcome page/i.test(description) && /on startup/i.test(description),
        `the settings screen describes this preference in words the control does not use, so one preference is met under two vocabularies: ${description}`,
      );
      assert.ok(
        !/welcome panel|with the editor/i.test(description),
        `the settings screen still describes this preference in the retired words: ${description}`,
      );
    });

    // 🔴 THE TICK IS A REAL CONTROL AND ITS NAME COMES FROM ITS LABEL. This page
    // is an ordinary document rather than a menu, so the platform's own checkbox
    // is what belongs here — and a name declared on the control instead of bound
    // to it would be a second copy of the words, wrong the moment the words move.
    it('draws the switch as a checkbox whose name comes from its bound label', () => {
      const html = dismissHtml(true);
      const box = /<input\b[^>]*>/.exec(html)?.[0] ?? '';
      assert.ok(box, 'the foot control is not an input at all, so it is not a checkbox');
      assert.ok(/type="checkbox"/.test(box), `the foot control is an input of another type: ${box}`);
      assert.ok(
        !/aria-label/.test(html),
        'the foot control declares its own name as well as carrying a label, which is two copies of one string',
      );
      // The association is read from the document rather than compared against
      // the constant that composed it: a check whose two sides both read that
      // constant moves both at once and passes any spelling.
      const id = /\bid="([^"]+)"/.exec(box)?.[1] ?? '';
      const boundTo = /<label\b[^>]*\bfor="([^"]+)"/.exec(html)?.[1] ?? '';
      assert.ok(id, `the checkbox carries no identifier, so nothing can be bound to it: ${box}`);
      assert.strictEqual(
        boundTo,
        id,
        'the label is not bound to the checkbox, so the control reaches a reader using assistive technology unnamed',
      );
    });

    // 🔴 THE TICK FOLLOWS THE PREFERENCE AND IS THE ONLY RECORD OF IT. The state
    // is carried by the attribute a screen reader reads it from, so the two
    // readers cannot be told different things; and it is composed from the one
    // reading handed in rather than remembered, which is what keeps the foot and
    // the settings screen one switch.
    it('ticks the box exactly when the preference says the page opens', () => {
      assert.ok(
        / checked\b/.test(dismissHtml(true)),
        'a page that opens on startup draws an unticked box, so the control reports the opposite of the preference',
      );
      assert.ok(
        !/ checked\b/.test(dismissHtml(false)),
        'a page the reader turned off draws a ticked box, so the control reports the opposite of the preference',
      );
      // The declared default is what makes the box ticked for a reader who has
      // never touched it, and it lives in the manifest rather than beside the
      // control: a fallback written here would be a second default.
      assert.strictEqual(
        manifest().properties[WELCOME_SHOW_SETTING].default,
        true,
        'the preference no longer defaults to on, so the box a first-time reader meets is unticked',
      );
    });

    // The foot control is a press like any other in this panel, so it goes
    // through the same guard — and the commands it names are palette commands
    // the manifest already declares, which is what keeps the two directions one
    // capability rather than two.
    it('reaches the panel switch through the same declared commands the palette uses', () => {
      const declared = new Set(manifest().commands.map((c) => String(c.command)));
      for (const command of PANEL_SETTING_COMMANDS) {
        assert.ok(
          declared.has(command),
          `the foot control names ${command}, which the manifest does not declare, so pressing it derives no activation event and does nothing`,
        );
        assert.ok(
          panelControlCommands().includes(command),
          `the host refuses ${command}, so the foot control is drawn and cannot be pressed`,
        );
      }
      assert.deepStrictEqual(
        [...PANEL_SETTING_COMMANDS],
        [DISMISS_COMMAND, WELCOME_SHOW_COMMAND],
        'the foot control no longer runs the two commands the palette runs, so the panel and the palette are two switches rather than one',
      );
    });

    // 🔴 NOTHING ELSE BECAME REACHABLE. The guard was widened by exactly the two
    // commands the foot control declares and by nothing else, asserted against
    // the step-derived set rather than against a remembered count.
    it('widened what a press may reach by the foot control alone', () => {
      const stepCommands = STEP_CONTENT.flatMap((s) => s.actions.map((a) => a.command));
      const admitted = panelControlCommands();
      assert.deepStrictEqual(
        admitted,
        [...stepCommands, ...PANEL_SETTING_COMMANDS],
        'the guard admits something that is neither a step\'s way through nor the panel\'s own switch',
      );
    });

    // Both directions live in the palette, and that is what makes the dismissal
    // safe to offer. The steps are the conditions and nothing else, so a control
    // belonging to none of them has nowhere to sit among them — and a command
    // withheld from the editor's own index of what exists reads as absent rather
    // than as unavailable.
    it('keeps both the way out and the way back in the command palette', () => {
      const { commands, palette } = manifest();
      for (const [command, title] of [
        [WELCOME_SHOW_COMMAND, SHOW_COMMAND_TITLE],
        [DISMISS_COMMAND, DISMISS_COMMAND_TITLE],
      ] as const) {
        const declared = commands.find((c) => c.command === command);
        assert.ok(declared, `${command} is not declared`);
        assert.strictEqual(declared.title, title);
        assert.strictEqual(
          palette.find((m) => m.command === command),
          undefined,
          `${command} must stay in the palette: the panel has no slot for it, so hiding it leaves a reader no way to reach it at all`,
        );
      }
    });

    // A step's own control is a button in the panel and belongs nowhere else:
    // run from the palette it acts on whatever the panel happens to be showing,
    // with none of the surrounding explanation. The two commands that turn the
    // panel on and off are the exception, and they are asserted above.
    it('keeps the panel\'s step controls out of the command palette', () => {
      const hidden = new Set(
        manifest().palette.filter((m) => m.when === 'false').map((m) => String(m.command)),
      );
      const stepControls = [...new Set(panelControlCommands())]
        .filter((c) => c.startsWith('aggrega.getStarted.'))
        .filter((c) => c !== WELCOME_SHOW_COMMAND && c !== DISMISS_COMMAND);
      const leaked = stepControls.filter((c) => !hidden.has(c));
      assert.deepStrictEqual(
        leaked,
        [],
        `these belong to the panel rather than to the palette: ${leaked.join(', ')}`,
      );
    });
  });

  // 🔴 THE PAGE IS REACHABLE FROM SOMEWHERE A READER IS ALREADY LOOKING, AND
  // THAT IS A DIFFERENT CLAIM FROM THE ONE ABOVE. The palette answers "does this
  // capability exist"; it does not answer "how do I get back to that page", which
  // is a question a reader asks while looking at the Aggrega view and expects to
  // answer by looking at it. A command reachable only by knowing what to type is
  // one a reader concludes is not there.
  describe('the way back sits where the reader is looking', () => {
    it('contributes an entry in the Commands panel title bar, in the row of icons', () => {
      const entry = manifest().viewTitleMenus.find((m) => m.command === WELCOME_OPEN_COMMAND);
      assert.ok(
        entry,
        `no view/title entry contributes ${WELCOME_OPEN_COMMAND}, so the page is reachable only by `
        + 'typing its command — which is the state this entry exists to end',
      );
      assert.strictEqual(entry.when, COMMANDS_PANEL_VIEW);
      // navigation is what puts a title-bar action in the row of icons rather
      // than in the overflow menu, which is the difference between something a
      // reader sees and something they have to go looking for.
      assert.strictEqual(entry.group, 'navigation');
    });

    // A title-bar entry is drawn as an icon with its title as the tooltip,
    // because the pane's toolbar is constructed with labels off. An entry with
    // no icon therefore draws as an empty control: present, pressable, and
    // showing nothing.
    it('declares an icon, because an entry without one draws as an empty control', () => {
      const declared = manifest().commands.find((c) => c.command === WELCOME_OPEN_COMMAND);
      assert.ok(declared, `${WELCOME_OPEN_COMMAND} appears in a menu but is declared in no command`);
      assert.ok(
        typeof declared.icon === 'string' && /^\$\([a-z0-9-]+\)$/.test(declared.icon),
        `${WELCOME_OPEN_COMMAND} declares ${String(declared.icon)} rather than an icon, so the `
        + 'title bar would carry a control a reader cannot see',
      );
      const settings = manifest().commands.find((c) => c.command === 'aggrega.settings.open');
      assert.ok(settings);
      assert.notStrictEqual(
        declared.icon,
        settings.icon,
        'the two entries beside each other draw the same glyph, so a reader cannot tell them apart',
      );
    });

    // 🔴 ONE ICON, NOT TWO. The version lives on the page rather than behind an
    // affordance of its own, so the one entry that opens the page is the whole
    // of what this change adds to the title bar. The claim is an EQUALITY over
    // the entries on this view rather than a presence, because a presence
    // reading passes however many entries were added beside it.
    it('adds exactly one entry, beside the settings cog and nothing else', () => {
      // The admitted set has one home, shared with the per-panel specs that
      // assert their own operations are not up here. A copy of it beside this
      // assertion would be the fifth, and four copies of it already drifted at
      // once the moment the set grew.
      assert.deepStrictEqual(
        commandsPanelTitleBar(manifest().viewTitleMenus as MenuContribution[]),
        [...COMMANDS_TITLE_BAR_ENTRIES],
        'the Commands panel title bar carries something other than the way back to the page and '
        + 'the way to the settings — a second icon for the version is exactly what this refuses, '
        + 'since the version is on the page the first icon opens',
      );
      assert.ok(
        COMMANDS_TITLE_BAR_ENTRIES.includes(WELCOME_OPEN_COMMAND),
        'the shared set no longer names the way back, so the equality above would pass over a title '
        + 'bar that has lost it',
      );
    });

    // What the tooltip says is the title, and it is the only sentence a reader
    // gets before pressing. It names the surface in the words every other
    // user-visible string uses for it.
    it('says what it opens, in the words the rest of the surface uses', () => {
      const declared = manifest().commands.find((c) => c.command === WELCOME_OPEN_COMMAND);
      assert.ok(declared);
      assert.strictEqual(declared.title, OPEN_COMMAND_TITLE);
      assert.match(
        OPEN_COMMAND_TITLE,
        /welcome page/,
        'the title names the surface as something other than the welcome page, so the one sentence '
        + 'a reader gets before pressing uses a word no other surface uses',
      );
      assert.ok(
        /^[A-Za-z][A-Za-z ']*$/.test(OPEN_COMMAND_TITLE),
        `the title carries something that is not plain words: ${OPEN_COMMAND_TITLE}`,
      );
    });

    // 🔴 PRESSING IT MUST NOT DECIDE ANYTHING ON THE READER'S BEHALF. Whether the
    // page is reachable and whether it opens by itself are separate questions.
    // The command in the palette answers both at once, deliberately — undoing a
    // dismissal is one act — and that is exactly why the title-bar entry cannot
    // be that command: a reader who turned the page off and then glances at it
    // would have turned it back on by glancing.
    it('runs a command that opens the page without moving the startup preference', () => {
      assert.notStrictEqual(
        WELCOME_OPEN_COMMAND,
        WELCOME_SHOW_COMMAND,
        'the title-bar entry runs the command that also turns the startup preference back on, so '
        + 'looking at the page re-arms it',
      );
      const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'get-started.ts'), 'utf8');
      // Both commands are registered by the constants asserted against the
      // manifest above, so the chain is complete: the manifest names this
      // constant's value, and the module registers this constant.
      //
      // 🔴 THE CALIBRATION IS THE FIRST ASSERTION, NOT A SEPARATE ONE. A pattern
      // that has stopped matching reports every registration absent, so the
      // neighbouring registration — which provably exists — is what says the
      // reading about the new one means anything.
      const registers = (identifier: string): boolean =>
        new RegExp(`registerCommand\\(\\s*${identifier}\\b`).test(source);
      assert.ok(
        registers('WELCOME_SHOW_COMMAND'),
        'the instrument no longer finds the registration it was calibrated on, so what it reports '
        + 'about the entry beside it means nothing',
      );
      assert.ok(
        registers('WELCOME_OPEN_COMMAND'),
        `${WELCOME_OPEN_COMMAND} is contributed to the title bar and registered nowhere, so the `
        + 'icon is drawn and pressing it reaches nothing',
      );
    });
  });

  // What the reader is running, on the page they already have a way back to.
  describe('the page says what is running', () => {
    it('carries both readings, each beside the word naming it', () => {
      const html = versionsHtml({ extension: '0.4.2', compiler: '1.9.3-rc1' });
      assert.match(html, new RegExp(`${EXTENSION_VERSION_LABEL}[^<]*<[^>]*>0\\.4\\.2<`));
      assert.match(html, new RegExp(`${COMPILER_VERSION_LABEL}[^<]*<[^>]*>1\\.9\\.3-rc1<`));
    });

    // 🔴 A READING THAT WAS NOT TAKEN KEEPS ITS LABEL. A row that vanished would
    // leave a reader unable to tell a version they failed to notice from one the
    // page never had — and the second is the case worth telling them about.
    it('keeps the label and says so where a reading was not taken', () => {
      const html = versionsHtml({ extension: '0.4.2', compiler: null });
      assert.ok(html.includes(COMPILER_VERSION_LABEL));
      assert.ok(html.includes(VERSION_ABSENT));
      assert.ok(
        !html.includes('null') && !html.includes('undefined'),
        'an absent reading reached the page as the name of its own absence in code',
      );
    });

    // 🔴 THE COMPOSITION FOLLOWS THE READING, SHOWN BY COMPOSING TWICE. A
    // rendering assertion against one value passes on a constant, so what is
    // asserted here is the difference between two compositions of the whole
    // page: each carries its own reading and neither carries the other's.
    it('shows a different version when a different version is read', () => {
      const first = renderedPanel(stepStandings(EVERYTHING_MET), [], true, {
        extension: '0.1.0',
        compiler: '0.6.1-1122-g7a7dd003-dirty',
      });
      const second = renderedPanel(stepStandings(EVERYTHING_MET), [], true, {
        extension: '0.2.0',
        compiler: '(devel)',
      });
      assert.notStrictEqual(first, second, 'two readings composed the same page');
      assert.ok(first.includes('0.6.1-1122-g7a7dd003-dirty') && first.includes('0.1.0'));
      assert.ok(second.includes('(devel)') && second.includes('0.2.0'));
      assert.ok(
        !first.includes('(devel)') && !second.includes('0.6.1-1122-g7a7dd003-dirty'),
        'a composition carries a version it was not handed, so something on this page remembers a '
        + 'reading rather than drawing the one it was given',
      );
    });

    // 🔴 THE EXTENSION'S OWN VERSION HAS ONE HOME AND IT IS THE MANIFEST. A
    // release moves it there; a literal anywhere in the source would be a second
    // one, correct until the first release that forgot it. This is a census over
    // the whole source tree rather than a look at the one module that reads it,
    // because the copy worth catching is the one somebody adds elsewhere.
    it('holds no copy of its own version anywhere in the source', () => {
      const declared = manifest().version;
      assert.match(declared, /^\d+\.\d+\.\d+/, 'the manifest declares no version to compare against');
      const copies = readSourceTree()
        .filter(([, source]) => source.includes(`'${declared}'`) || source.includes(`"${declared}"`))
        .map(([file]) => file);
      assert.deepStrictEqual(
        copies,
        [],
        `these hold the manifest's own version as a literal, so a release moves one of the two and `
        + `leaves the other: ${copies.join(', ')}`,
      );
    });
  });

  // The panel is composed as a document, so text that is not treated as text is
  // markup a reader never wrote. These are the assertions that fail if the
  // escaping is ever dropped or reordered behind the inline markers.
  describe('composing the panel treats its text as text', () => {
    it('renders markup in the content as characters', () => {
      assert.strictEqual(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
    });

    it('escapes before it applies an inline marker, so content cannot introduce markup', () => {
      assert.strictEqual(
        inlineHtml('a `<script>` span'),
        'a <code>&lt;script&gt;</code> span',
      );
      assert.strictEqual(inlineHtml('**bold**'), '<strong>bold</strong>');
      assert.strictEqual(inlineHtml('*quiet*'), '<em>quiet</em>');
      assert.ok(!inlineHtml('<img src=x>').includes('<img'));
    });

    it('carries the step content through the markers it is written in', () => {
      const html = stepsHtml(stepStandings(NOTHING_MET), []);
      assert.ok(html.includes('<code>.aggrega-config.yaml</code>'));
      assert.ok(html.includes('<strong>workspace root</strong>'));
    });
  });

  // The template a control writes and the probe that decides what anchors are
  // one rule seen from its two sides. Held apart they agree until somebody
  // tightens the probe or rewords the template, and the symptom is a reader
  // pressing "create a workspace configuration", getting a file, and still
  // being told nothing is anchored.
  describe('what the create control writes is what discovery recognises', () => {
    it('anchors a directory it is written into', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-get-started-'));
      try {
        const target = path.join(dir, CONFIG_FILENAME);
        fs.writeFileSync(target, WORKSPACE_ANCHOR_CONFIG);
        const anchor = await findAggregaWorkspaceAnchor(dir);
        assert.strictEqual(
          anchor,
          target,
          'the configuration the create control writes does not anchor a workspace, so the step it satisfies would report itself unmet',
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('anchors from a directory below it, which is how discovery is reached', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-get-started-'));
      try {
        const target = path.join(dir, CONFIG_FILENAME);
        fs.writeFileSync(target, WORKSPACE_ANCHOR_CONFIG);
        const nested = path.join(dir, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        assert.strictEqual(await findAggregaWorkspaceAnchor(nested), target);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    // The candidate pattern only narrows a search whose results are then
    // confirmed through discovery, so it has to be a superset. Narrowing it
    // hides a folder the reader has; this names the parts it must keep.
    it('searches for at least every marker discovery recognises', () => {
      for (const part of [CONFIG_FILENAME, '.aggrega/', 'aggregate*.yaml', 'release*.yaml', 'manifest*.yaml']) {
        assert.ok(
          ANCHOR_CANDIDATE_GLOB.includes(part),
          `the candidate search would not reach ${part}, so a folder anchored only by it is offered to nobody`,
        );
      }
    });
  });

  // The panel is where many readers meet Aggrega's configuration for the first
  // time, and what they need there is the case that covers nearly every project:
  // one file at the project root, one on the machine. The mechanisms built for
  // larger projects are named and pointed at, never explained here — a reader
  // taught the general case first has to understand five mechanisms to create
  // one file.
  describe('the configuration the panel teaches', () => {
    it('carries every load-bearing phrase about where configuration lives', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      const missing = SIMPLE_CASE_PHRASES.filter((phrase) => !html.includes(phrase));
      assert.deepStrictEqual(
        missing,
        [],
        `the panel no longer tells a reader where configuration lives: ${missing.join(' | ')}`,
      );
    });

    // 🔴 THE ONLY ASSERTION THAT CAN CATCH A PARAPHRASE WRITTEN IN THIS FILE.
    // The list above and the panel could drift together into wording the product
    // does not use, and every other check here would still pass; this compares
    // the list against a copy the extension does not own.
    //
    // Case is ignored deliberately: the panel places some of these phrases
    // mid-sentence, so a leading capital follows the panel's grammar rather than
    // the reference's, and that difference is not a paraphrase.
    //
    // 🔴 THE REFERENCE IS HARD-WRAPPED PROSE, SO ITS LINE BREAKS ARE COLLAPSED
    // BEFORE THE COMPARISON. Without that, a phrase the reference carries word
    // for word is reported as invented purely because a line ended in the middle
    // of it — the check would then be measuring where the reference happens to
    // wrap rather than what it says. The panel's side needs no such treatment:
    // each block of its text is one string, so no phrase there spans a break.
    it('takes those phrases from the product\'s own configuration reference', function () {
      if (!fs.existsSync(PRODUCT_CONFIGURATION_PAGE)) {
        // Checked out without the documentation beside it. Reported as pending
        // rather than passed: a silent skip would read as the anchor holding.
        this.skip();
        return;
      }
      const page = fs.readFileSync(PRODUCT_CONFIGURATION_PAGE, 'utf8')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      const invented = SIMPLE_CASE_PHRASES.filter(
        (phrase) => !page.includes(phrase.toLowerCase()),
      );
      assert.deepStrictEqual(
        invented,
        [],
        `these phrases are not the product's own words, so the panel and the reference now describe one model two ways: ${invented.join(' | ')}`,
      );
    });

    it('teaches none of the mechanisms built for larger projects', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      const taught = BEYOND_THE_SIMPLE_CASE.filter((phrase) => html.includes(phrase));
      assert.deepStrictEqual(
        taught,
        [],
        `the panel puts a mechanism for larger projects, or a wrong file location, in front of a first-time reader: ${taught.join(' | ')}`,
      );
    });

    // 🔴 THE SETTINGS SCREEN IS THE OTHER SURFACE A READER MEETS WITHOUT OPENING
    // ANY DOCUMENTATION, and the whole `aggrega.` block there reads as though it
    // were Aggrega's own configuration. So the setting a reader is most likely to
    // open draws the line and names both files. Two things are pinned: that the
    // description names each location, and that each location is one the product
    // documents — a description naming a path the product does not use would
    // otherwise satisfy the first check forever, and a reader will type it.
    it('names both configuration files in the settings description a reader opens', function () {
      const description = String(manifest().properties['aggrega.server.binaryPath']?.description ?? '');
      const unnamed = CONFIGURATION_FILE_LOCATIONS.filter((where) => !description.includes(where));
      assert.deepStrictEqual(
        unnamed,
        [],
        `the settings screen does not say where Aggrega's own configuration lives, so a reader who never opens the welcome panel cannot act: ${unnamed.join(' | ')}`,
      );

      if (!fs.existsSync(PRODUCT_CONFIGURATION_PAGE)) {
        this.skip();
        return;
      }
      const page = fs.readFileSync(PRODUCT_CONFIGURATION_PAGE, 'utf8');
      const undocumented = CONFIGURATION_FILE_LOCATIONS.filter((where) => !page.includes(where));
      assert.deepStrictEqual(
        undocumented,
        [],
        `these locations are not the ones the product documents, so this surface would have a reader type a path that is wrong: ${undocumented.join(' | ')}`,
      );
    });

    // What earns the global file on the machine is global tooling — the
    // registries and their trust policy, the compiled-module store's size, the
    // installed command extensions. Not credentials: those are in neither file.
    it('does not explain the file on the machine as somewhere to keep credentials', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      // The matched text alone, never the match object: a failing comparison
      // against the object prints the whole composed document with it, which
      // buries the one sentence the reader of the failure needs.
      const found = REFUTED_CREDENTIAL_RATIONALE.exec(html)?.[0] ?? null;
      assert.strictEqual(
        found,
        null,
        `the panel explains the machine's configuration file as a place credentials go, which is false — they are fields in neither file: ${found ?? ''}`,
      );
    });

    // 🔴 THE SHARED CONFIGURATION FILE IS CALLED GLOBAL ON BOTH SURFACES A READER
    // MEETS WITHOUT OPENING ANY DOCUMENTATION — the welcome panel and the settings
    // screen. The word is the one every comparable tool spells it, so a reader
    // arrives already carrying it; one concept carries one name.
    //
    // 🔴 THE PHRASES ARE LITERALS HERE, AND READING THEM FROM THE STEP CONTENT
    // WOULD DESTROY THE CHECK — the same blindness this file guards the
    // configuration wording against. A comparison whose two sides both read the
    // panel's own constant moves both sides at once and passes any rename.
    //
    // The name is asserted ALONGSIDE the teaching rather than in place of it: the
    // panel must still say the file is on your machine and holds what belongs to
    // the machine rather than to one project, which the phrase list above pins
    // against the product's own reference. "Global" on its own says less than the
    // sentence it sits in, so it is checked as an addition, never a replacement.
    //
    // 🔴 THE CHECK IS THAT EVERY MENTION CARRIES THE NAME, NOT THAT ONE DOES.
    // A plain `includes` for the named form is satisfied by any single mention,
    // so a surface naming the file three times and losing the name on the one
    // that INTRODUCES it passes — measured, on this very assertion, by planting
    // exactly that defect. Comparing the two counts is what closes it: the named
    // form must account for every occurrence of the bare one.
    it('calls the shared configuration file global on both surfaces, and keeps the teaching', () => {
      const html = renderedPanel(stepStandings(NOTHING_MET));
      const description = String(manifest().properties['aggrega.server.binaryPath']?.description ?? '');

      // Occurrences, not matching lines and not a substring test: both of those
      // report "present" for a surface that names the file twice and got it
      // right once.
      const occurrences = (haystack: string, needle: string): number =>
        haystack.split(needle).length - 1;

      for (const [surface, text] of [['panel', html], ['settings description', description]] as const) {
        const lower = text.toLowerCase();
        const mentions = occurrences(lower, 'file on your machine');
        const named = occurrences(lower, 'global file on your machine');
        assert.ok(
          mentions > 0,
          `the ${surface} no longer tells a reader the shared configuration file is on their machine`,
        );
        assert.strictEqual(
          named,
          mentions,
          `the ${surface} names the shared configuration file ${mentions} time(s) but calls it global only ${named}, so a reader meets it under two names`,
        );
        for (const withdrawn of ['machine-wide', 'machine wide']) {
          assert.ok(
            !lower.includes(withdrawn),
            `the ${surface} still says "${withdrawn}", which is not what this file is called`,
          );
        }
      }

      // The teaching, checked on the surface that carries the fuller sentence: a
      // reader must still learn WHICH machine and WHY the file is separate, not
      // merely that the file has a name.
      assert.ok(
        html.includes('on your machine'),
        'the panel names the file global but no longer says where it is, which teaches less than the phrase it replaced',
      );
    });
  });

  describe('the preference the README teaches', () => {
    it('names the get-started preference', () => {
      const readme = fs.readFileSync(README, 'utf8');
      assert.ok(
        readme.includes(WELCOME_SHOW_SETTING),
        'a preference the README does not name is one a reader has no way to find out about',
      );
    });

    // The README taught the panel as a page inside the editor's own welcome
    // page, and every sentence saying so became wrong the moment the panel
    // moved. This is the assertion that fails if that teaching is left behind.
    it('does not teach the panel as a page inside the editor\'s welcome', () => {
      const readme = fs.readFileSync(README, 'utf8');
      assert.ok(
        !/walkthrough/i.test(readme),
        'the README still teaches the welcome as one of the editor\'s walkthroughs, which is the surface it was moved out of',
      );
    });
  });
});

describe('the welcome panel seeds a configuration without starting a process', () => {
  it('fires on a module that does launch, so a zero below is an absence and not a broken pattern', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES THE ZERO MEAN
    // ANYTHING. A pattern that has stopped matching reports every module clean.
    // The control is a module the extension deliberately still launches from, so
    // it is on the same side of the claim as the subject and moves independently
    // of it.
    assertCensusInstrumentFires(assert.ok);
  });

  it('creates no child process anywhere in the panel\'s own module', () => {
    // The panel's seeding asks the language server, so this module needs no way
    // to start a process — the facility is absent rather than merely unused.
    assert.strictEqual(
      launchFacilityCount('src/get-started.ts'),
      0,
      'the welcome panel starts a process again, so two execution paths reach the compiler',
    );
  });

  it('reaches no process-launching helper either, so the module is launch-free END TO END', () => {
    // 🔴 THE STRONGER CLAIM, AND IT NEEDS THE IMPORT LIST RATHER THAN THE LAUNCH
    // PATTERN. A module holding no spawn of its own can still reach one through a
    // helper, which is what a launch census over the module alone cannot see. Both
    // of the panel's compiler questions — the seeding and the configured-registry
    // reading — now travel as injected requests, so the helper that captures a
    // structured command run is not imported here at all.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/get-started.ts'), 'utf8');
    const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.ok(
      !imported.includes('./cli-json'),
      'the panel reaches the structured-run helper again, which starts a process',
    );
    assert.ok(
      !imported.includes('./cli-run'),
      'the panel reaches the streaming-run helper again, which starts a process',
    );
    // The positive control for THIS instrument: the import list is genuinely
    // being read, so the two absences above are absences and not an empty parse.
    assert.ok(
      imported.includes('./config-seeding'),
      'the import list came back without a module the panel provably imports, so the '
      + 'two assertions above prove nothing',
    );
  });

  it('reads the configured registries over the language server, from one place', () => {
    // The method is the compiler's identifier, so it is read from the surface
    // that sends it rather than restated as a constant this side owns.
    //
    // TWO call sites consume this one answer — the panel's registry condition and
    // the registries tree — and the count is what holds them to ONE request
    // wrapper. Two sends would be two execution paths for one question again,
    // which is the defect the count exists to catch.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/extension.ts'), 'utf8');
    assert.strictEqual(
      (source.match(/'aggrega\/registryList'/g) ?? []).length,
      1,
      'the registry listing is sent from more than one place, so one question has two paths',
    );
    assert.strictEqual(
      (source.match(/'aggrega\/search'/g) ?? []).length,
      1,
      'the catalog search is sent from more than one place, so one question has two paths',
    );
  });

  it('gives the seeding decision no way to reach a process at all', () => {
    // The module that owns the seeding imports three things, and none can start
    // anything: the classification of an ending, how far a configuration write
    // reached, and what a registration produced. Read as the whole import list
    // rather than as an absence, so a module added to it has to be looked at —
    // including one that could reach a process, and one that would carry the
    // editor in, which is what keeps this decision readable without a host.
    // 🔴 THE VALUE LIST, WHICH IS WHAT THE CLAIM IS ABOUT. The wire shapes come
    // from the published contract rather than being restated here, and they come
    // as declarations alone — erased before anything runs, so the module reaches
    // no code through them. Asserted separately below, because a reading that
    // folded the two together would let a later change from one kind to the other
    // pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/config-seeding.ts'),
      ['./config-write-scope', './operation-outcome', './registration-outcome'],
    );
    assert.deepStrictEqual(typeOnlyImports('src/config-seeding.ts'), [WIRE_CONTRACT]);
    assert.strictEqual(launchFacilityCount('src/config-seeding.ts'), 0);
    // The shared homes are on the same side of the claim, so each is measured too
    // rather than trusted for being small.
    assert.strictEqual(launchFacilityCount('src/config-write-scope.ts'), 0);
    assert.strictEqual(launchFacilityCount('src/registration-outcome.ts'), 0);
  });

  it('sends the seeding to the language server under the compiler\'s own method name', () => {
    // The method is the compiler's identifier, so it is read from the surface
    // that sends it rather than restated as a constant this side owns — a
    // constant would agree on the day it was written and be the only thing
    // consulted afterwards.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/extension.ts'), 'utf8');
    const sends = (source.match(/'aggrega\/configInit'/g) ?? []).length;
    assert.strictEqual(
      sends,
      1,
      'the seeding request is sent from exactly one place, or the panel has two routes to it',
    );
  });
});
