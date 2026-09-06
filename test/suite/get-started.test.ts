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
  STEP_IDS,
  WALKTHROUGH_ID,
  WELCOME_DESCRIPTION,
  WELCOME_GREETING,
  stepCompletionEvent,
  stepContextKey,
  stepMet,
  stepStandings,
  unmetStepIds,
  walkthroughAddress,
} from '../../src/get-started-steps';
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

interface StepEntry {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  media?: unknown;
  completionEvents?: unknown;
}
interface WalkthroughEntry {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  steps?: StepEntry[];
}
interface ViewEntry { id?: unknown; name?: unknown; when?: unknown }
interface CommandEntry { command?: unknown; title?: unknown }
interface MenuEntry { command?: unknown; when?: unknown }

function manifest(): {
  walkthroughs: WalkthroughEntry[];
  views: ViewEntry[];
  commands: CommandEntry[];
  palette: MenuEntry[];
  properties: Record<string, { type?: unknown; default?: unknown; scope?: unknown }>;
  viewsWelcome: unknown[];
} {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    walkthroughs: pkg.contributes.walkthroughs ?? [],
    views: pkg.contributes.views.aggrega,
    commands: pkg.contributes.commands,
    palette: pkg.contributes.menus.commandPalette ?? [],
    properties: pkg.contributes.configuration.properties,
    viewsWelcome: pkg.contributes.viewsWelcome ?? [],
  };
}

// ourWalkthrough is the panel this extension contributes. Fetched rather than
// indexed, so adding a second walkthrough later does not silently re-point
// every assertion below at the wrong one.
function ourWalkthrough(): WalkthroughEntry {
  const found = manifest().walkthroughs.find((w) => w.id === WALKTHROUGH_ID);
  assert.ok(found, `the manifest contributes no walkthrough with id ${WALKTHROUGH_ID}`);
  return found;
}

// ourSteps are the panel's steps, in the order the manifest declares them —
// which is the order they render in.
function ourSteps(): StepEntry[] {
  return ourWalkthrough().steps ?? [];
}

// commandLinksIn collects the controls in a set of steps — the links the editor
// turns into buttons and into clickable text.
function commandLinksIn(steps: StepEntry[]): string[] {
  const found: string[] = [];
  for (const step of steps) {
    for (const match of String(step.description ?? '').matchAll(/\(command:([^)]+)\)/g)) {
      found.push(match[1]);
    }
  }
  return found;
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

    it('names one condition key per step, and one completion event per key', () => {
      const keys = STEP_IDS.map(stepContextKey);
      assert.strictEqual(new Set(keys).size, keys.length, 'two steps share a condition key');
      for (const id of STEP_IDS) {
        assert.strictEqual(stepCompletionEvent(id), `onContext:${stepContextKey(id)}`);
      }
      const events = STEP_IDS.map(stepCompletionEvent);
      assert.strictEqual(
        new Set(events).size,
        events.length,
        'two steps are checked off by the same event, so one of them reports a condition it never read',
      );
    });

    // The address the editor takes is the extension's own identifier and the
    // walkthrough's, joined by a hash. Asserted on an arbitrary identifier
    // rather than on this extension's, so what is proved is the SHAPE — the
    // part that could be got wrong — independently of who is asking.
    it('addresses the panel as the editor addresses a contributed walkthrough', () => {
      assert.strictEqual(
        walkthroughAddress('some.extension'),
        `some.extension#${WALKTHROUGH_ID}`,
      );
    });
  });

  describe('what the editor is told to draw', () => {
    // 🔴 THE PANEL IS AN EDITOR-AREA WALKTHROUGH AND NO LONGER A SIDEBAR VIEW.
    // The assertion this replaces required the get-started view to sit first in
    // the container. It is retired rather than adjusted: the view has left the
    // container, so an assertion pinning it to any position could only be
    // satisfied by putting it back.
    it('contributes the panel as a walkthrough rather than as a container view', () => {
      const { views, viewsWelcome } = manifest();
      const stranded = views.filter((v) => String(v.id).startsWith('aggrega.getStarted'));
      assert.deepStrictEqual(
        stranded.map((v) => v.id),
        [],
        `the panel is an editor-area walkthrough, so it must cost the sidebar container no slot; these views remain: ${stranded.map((v) => String(v.id)).join(', ')}`,
      );
      // Every welcome contribution this extension had targeted that view, so a
      // surviving one would be content declared against a view nothing draws.
      assert.deepStrictEqual(
        viewsWelcome,
        [],
        'a view-welcome contribution survives the view it was drawn in, so its content is declared against nothing',
      );
      assert.ok(ourWalkthrough(), 'the panel is contributed as a walkthrough');
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
        'the panel no longer costs a sidebar slot, so the container reads Operations, Registries, Catalog, Plugins in both states — shown and dismissed',
      );
    });

    // 🔴 THE COPY IS TRANSCRIBED, NOT COMPOSED. The description is the one the
    // product's own documentation carries, character for character. This is the
    // assertion that fails when somebody re-words it for the surface: two
    // divergent descriptions of the product is the drift a single source exists
    // to prevent, and a paraphrase reads perfectly well, so nothing but an
    // exact comparison catches it.
    it('opens with the greeting and the product description, verbatim', () => {
      const walkthrough = ourWalkthrough();
      assert.strictEqual(walkthrough.title, WELCOME_GREETING);
      assert.strictEqual(
        walkthrough.description,
        WELCOME_DESCRIPTION,
        'the panel must carry the product description exactly as it is written, not a paraphrase or a trim',
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

    // One step per condition, in condition order, and nothing else. A fifth
    // step would be an entry in a checklist that no fact ever checks off, so it
    // would read as outstanding work forever.
    it('contributes one step per condition, in condition order', () => {
      assert.deepStrictEqual(
        ourSteps().map((s) => s.id),
        [...STEP_IDS],
        'the panel\'s steps are the conditions the extension needs, in the order each one\'s remedy depends on the ones above it',
      );
    });

    // 🔴 THE ASSERTION THAT FAILS WHEN A STEP STOPS READING ITS OWN FACT. Every
    // other assertion here holds while a step is checked off by a key belonging
    // to a different condition — at which point the panel reports a reader has
    // something they do not. It replaces the met/unmet entry pair the sidebar
    // needed: the editor now draws the standing itself, from this event.
    it('checks off every step from its own condition and no other', () => {
      for (const step of ourSteps()) {
        const id = STEP_IDS.find((candidate) => candidate === step.id);
        assert.ok(id, `the panel declares a step ${String(step.id)} that is not a condition`);
        assert.deepStrictEqual(
          step.completionEvents,
          [stepCompletionEvent(id)],
          `the ${id} step must be checked off by its own condition; a step left with no completion event is checked off by merely pressing one of its controls, whether or not that control worked`,
        );
      }
    });

    it('offers two ways through every step', () => {
      for (const step of ourSteps()) {
        const controls = commandLinksIn([step]);
        assert.strictEqual(
          controls.length,
          2,
          `the ${String(step.id)} step offers ${controls.length} way(s) through — a step that knows only how to create walks a reader through making what they already have: ${controls.join(', ')}`,
        );
      }
    });

    // Media is required on every step by the contribution's own schema, so a
    // step without it is not a presentation choice: the editor rejects the
    // contribution and the whole panel goes missing.
    it('gives every step the pane the contribution requires', () => {
      for (const step of ourSteps()) {
        assert.ok(
          step.media && typeof step.media === 'object',
          `the ${String(step.id)} step declares no media, which the walkthrough contribution requires`,
        );
        const markdown = (step.media as { markdown?: unknown }).markdown;
        assert.strictEqual(
          typeof markdown,
          'string',
          `the ${String(step.id)} step's pane must name a markdown document`,
        );
        const resolved = path.resolve(__dirname, '../../..', String(markdown));
        assert.ok(
          fs.existsSync(resolved),
          `the ${String(step.id)} step names a pane that is not in the extension: ${String(markdown)}`,
        );
      }
    });

    // The editor derives an activation event from each declared command, so a
    // control naming an undeclared one would do nothing at all for a reader
    // whose workspace has not otherwise started the extension — which is most
    // readers meeting this panel, and a failure that reports nothing anywhere.
    it('declares every command a control invokes', () => {
      const declared = new Set(manifest().commands.map((c) => String(c.command)));
      const invoked = [...new Set(commandLinksIn(ourSteps()))];
      const undeclared = invoked.filter((c) => !declared.has(c));
      assert.deepStrictEqual(
        undeclared,
        [],
        `these controls invoke commands the manifest does not declare, so no activation event is derived for them and pressing one does nothing: ${undeclared.join(', ')}`,
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
      const stepControls = [...new Set(commandLinksIn(ourSteps()))]
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
  });
});
