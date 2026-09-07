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
  GET_STARTED_SHOW_SETTING,
  NOTHING_MET,
  SHOW_COMMAND,
  SHOW_COMMAND_TITLE,
  STEP_CONTENT,
  STEP_IDS,
  StepId,
  WELCOME_DESCRIPTION,
  WELCOME_GREETING,
  WELCOME_PANEL_TITLE,
  panelControlCommands,
  readCollapsedSteps,
  stepMet,
  stepStandings,
  unmetStepIds,
} from '../../src/get-started-steps';
import { escapeHtml } from '../../src/html';
import {
  MET_LABEL,
  UNMET_LABEL,
  initiallyCollapsedStepIds,
  inlineHtml,
  stepsHtml,
  toggleLabel,
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

interface ViewEntry { id?: unknown; name?: unknown; when?: unknown }
interface CommandEntry { command?: unknown; title?: unknown }
interface MenuEntry { command?: unknown; when?: unknown }

function manifest(): {
  activationEvents: string[];
  walkthroughs: unknown[];
  views: ViewEntry[];
  commands: CommandEntry[];
  palette: MenuEntry[];
  properties: Record<string, { type?: unknown; default?: unknown; scope?: unknown }>;
  viewsWelcome: unknown[];
} {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    activationEvents: pkg.activationEvents ?? [],
    walkthroughs: pkg.contributes.walkthroughs ?? [],
    views: pkg.contributes.views.aggrega,
    commands: pkg.contributes.commands,
    palette: pkg.contributes.menus.commandPalette ?? [],
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
function renderedPanel(
  standings: Record<StepId, boolean>,
  collapsed: readonly StepId[] = [],
): string {
  return welcomeDocumentHtml({
    nonce: 'test-nonce',
    styleUri: 'vscode-resource://media/welcome.css',
    scriptUri: 'vscode-resource://media/welcome.js',
    cspSource: 'vscode-resource:',
    standings,
    collapsed,
  });
}

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

    it('reports every condition outstanding for a reader who has just installed it', () => {
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
      assert.ok(!html.includes('step-unmet'), 'a step is outstanding with every condition met');
    });

    it('marks a step outstanding again when its condition lapses', () => {
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
      assert.ok(unmet.includes(UNMET_LABEL), 'an outstanding step says so in words');
      assert.ok(
        !met.includes(UNMET_LABEL),
        'a panel with every condition met still reads as having outstanding work',
      );
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
    it('closes the satisfied sections and leaves the outstanding ones open', () => {
      const collapsed = initiallyCollapsedStepIds(MIXED);
      assert.deepStrictEqual(
        collapsed,
        MIXED_MET,
        'the sections a panel opens closed are the ones whose condition is already satisfied: the panel exists to show what is still needed',
      );
      assert.deepStrictEqual(
        STEP_IDS.filter((id) => !collapsed.includes(id)),
        MIXED_UNMET,
        'an outstanding step opens closed, so the reader is shown a title where they needed an explanation',
      );
    });

    // The inversion is one character away in the subject: negate the filter and
    // the panel folds away every outstanding step and opens every satisfied
    // one, which reads as deliberate, produces no error, and is the exact
    // opposite of what the panel is for. The equality above already excludes
    // it; this names it, and checks first that the fixture still has conditions
    // on both sides — a fixture that drifted to uniform would go on passing
    // while quietly testing less than it says.
    it('does not open the outstanding sections closed, which is the inversion', () => {
      const collapsed = initiallyCollapsedStepIds(MIXED);
      assert.deepStrictEqual(
        MIXED_UNMET,
        STEP_IDS.filter((id) => !MIXED[id]),
        'this fixture no longer has conditions on both sides, so it can no longer tell the rule from its inversion',
      );
      assert.notDeepStrictEqual(
        collapsed,
        MIXED_UNMET,
        'the arrangement is inverted: the satisfied steps are open and the outstanding ones are folded away, so the panel hides exactly the work it exists to show',
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

    it('composes a closure the reader asked for even where the step is outstanding', () => {
      const html = stepsHtml(stepStandings(NOTHING_MET), ['compiler']);
      assert.deepStrictEqual(
        collapsedSteps(html),
        ['compiler'],
        'a reader who closes an outstanding section is entitled to have it stay closed',
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
      const property = manifest().properties[GET_STARTED_SHOW_SETTING];
      assert.ok(property, `the manifest declares no ${GET_STARTED_SHOW_SETTING} preference`);
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
        [GET_STARTED_SHOW_SETTING],
        'a second preference covers the same concept as the one that already gates the panel',
      );
    });

    // One step per condition, in condition order, and nothing else. A fifth
    // step would be an entry in a checklist that no fact ever checks off, so it
    // would read as outstanding work forever.
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
    it('admits exactly the commands its own controls carry', () => {
      const drawn = [...new Set(commandsInPanel(renderedPanel(stepStandings(NOTHING_MET))))].sort();
      const admitted = [...new Set(panelControlCommands())].sort();
      assert.deepStrictEqual(
        admitted,
        drawn,
        'the guard on a press and the controls the panel draws have come apart',
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
        [SHOW_COMMAND, SHOW_COMMAND_TITLE],
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
        .filter((c) => c !== SHOW_COMMAND && c !== DISMISS_COMMAND);
      const leaked = stepControls.filter((c) => !hidden.has(c));
      assert.deepStrictEqual(
        leaked,
        [],
        `these belong to the panel rather than to the palette: ${leaked.join(', ')}`,
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

  describe('the preference the README teaches', () => {
    it('names the get-started preference', () => {
      const readme = fs.readFileSync(README, 'utf8');
      assert.ok(
        readme.includes(GET_STARTED_SHOW_SETTING),
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
