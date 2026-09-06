// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EVERYTHING_MET,
  GET_STARTED_SHOW_SETTING,
  GET_STARTED_VIEW_ID,
  GET_STARTED_VIEW_WHEN,
  NOTHING_MET,
  SHOW_COMMAND,
  SHOW_COMMAND_TITLE,
  STEP_IDS,
  StepId,
  stepContextKey,
  stepMet,
  stepStandings,
  stepWhenClause,
  unmetStepIds,
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

interface WelcomeEntry { view?: unknown; contents?: unknown; when?: unknown }
interface ViewEntry { id?: unknown; name?: unknown; when?: unknown }
interface CommandEntry { command?: unknown; title?: unknown }
interface MenuEntry { command?: unknown; when?: unknown }

function manifest(): {
  welcome: WelcomeEntry[];
  views: ViewEntry[];
  commands: CommandEntry[];
  palette: MenuEntry[];
  properties: Record<string, { type?: unknown; default?: unknown; scope?: unknown }>;
} {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    welcome: pkg.contributes.viewsWelcome ?? [],
    views: pkg.contributes.views.aggrega,
    commands: pkg.contributes.commands,
    palette: pkg.contributes.menus.commandPalette ?? [],
    properties: pkg.contributes.configuration.properties,
  };
}

// ourEntries are the contributed welcome entries for this list, in the order the
// manifest declares them — which is the order they render in, since ordering a
// welcome contribution any other way needs an editor capability this extension
// does not opt into.
function ourEntries(): WelcomeEntry[] {
  return manifest().welcome.filter((e) => e.view === GET_STARTED_VIEW_ID);
}

// visibleFor selects the entries the editor would draw for a given state,
// WITHOUT interpreting the condition strings. Each entry is matched against the
// exact clause the model produces for that state, so nothing here re-implements
// the editor's own condition grammar — a second implementation of which would
// agree with the editor until the day it did not.
function visibleFor(met: Record<StepId, boolean>): WelcomeEntry[] {
  const wanted = new Set(STEP_IDS.map((id) => stepWhenClause(id, met[id])));
  return ourEntries().filter((e) => e.when === undefined || wanted.has(e.when as string));
}

// commandLinksIn counts the controls in a set of entries — the links the editor
// turns into buttons and into clickable text.
function commandLinksIn(entries: WelcomeEntry[]): string[] {
  const found: string[] = [];
  for (const entry of entries) {
    for (const match of String(entry.contents).matchAll(/\(command:([^)]+)\)/g)) {
      found.push(match[1]);
    }
  }
  return found;
}

describe('the get-started list', () => {
  describe('what the list means', () => {
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

    it('names one condition key per step, and one clause per standing', () => {
      const keys = STEP_IDS.map(stepContextKey);
      assert.strictEqual(new Set(keys).size, keys.length, 'two steps share a condition key');
      for (const id of STEP_IDS) {
        assert.strictEqual(stepWhenClause(id, true), stepContextKey(id));
        assert.strictEqual(stepWhenClause(id, false), `!${stepContextKey(id)}`);
      }
    });
  });

  describe('what the editor is told to draw', () => {
    it('declares the list as a view gated on the reader\'s own preference', () => {
      const { views } = manifest();
      const view = views.find((v) => v.id === GET_STARTED_VIEW_ID);
      assert.ok(view, `the manifest contributes no ${GET_STARTED_VIEW_ID} view`);
      assert.strictEqual(
        view.when,
        GET_STARTED_VIEW_WHEN,
        'the view must be drawn under the preference the dismissal writes, or nothing turns the list off',
      );
      assert.strictEqual(
        views[0].id,
        GET_STARTED_VIEW_ID,
        'the list is what a reader with nothing configured needs first, so it sits first in the panel',
      );
    });

    it('declares the preference as a reader-facing switch that starts on', () => {
      const property = manifest().properties[GET_STARTED_SHOW_SETTING];
      assert.ok(property, `the manifest declares no ${GET_STARTED_SHOW_SETTING} preference`);
      assert.strictEqual(property.type, 'boolean');
      assert.strictEqual(
        property.default,
        true,
        'the list starts on: a reader who wants it gone says so, and one who has read nothing yet is exactly the reader who would not notice a switch already thrown',
      );
    });

    // Two entries per step and no more: one for met, one for unmet. A step with
    // only the unmet form would go on asking a reader who has already answered.
    it('contributes both standings of every step', () => {
      const entries = ourEntries();
      for (const id of STEP_IDS) {
        for (const met of [true, false]) {
          const clause = stepWhenClause(id, met);
          const matching = entries.filter((e) => e.when === clause);
          assert.strictEqual(
            matching.length,
            1,
            `expected exactly one entry drawn under \`${clause}\`, found ${matching.length}`,
          );
        }
      }
    });

    it('offers two ways through every step a reader has not met', () => {
      const entries = ourEntries();
      for (const id of STEP_IDS) {
        const unmet = entries.find((e) => e.when === stepWhenClause(id, false));
        assert.ok(unmet, `no unmet entry for ${id}`);
        const controls = commandLinksIn([unmet]);
        assert.strictEqual(
          controls.length,
          2,
          `the ${id} step offers ${controls.length} way(s) through — a step that knows only how to create walks a reader through making what they already have: ${controls.join(', ')}`,
        );
      }
    });

    it('asks a reader who has met a step for nothing at all', () => {
      const entries = ourEntries();
      for (const id of STEP_IDS) {
        const met = entries.find((e) => e.when === stepWhenClause(id, true));
        assert.ok(met, `no met entry for ${id}`);
        assert.deepStrictEqual(
          commandLinksIn([met]),
          [],
          `the ${id} step still offers a control once it is met`,
        );
      }
    });

    // 🔴 THE COUNT THAT THE REST OF THIS FILE WOULD OTHERWISE PASS AROUND. Every
    // assertion above holds while a reader who configured everything from the
    // command line is still asked four questions. This is the one that measures
    // it: with every condition met, the only control left is the one that puts
    // the list away.
    it('leaves a fully configured reader exactly one control to press', () => {
      const visible = visibleFor(stepStandings(EVERYTHING_MET));
      const controls = commandLinksIn(visible);
      assert.deepStrictEqual(
        controls,
        ['aggrega.getStarted.dismiss'],
        `a reader who arrives with everything configured must be asked nothing; they are still offered ${controls.length} control(s): ${controls.join(', ')}`,
      );
    });

    it('offers a reader who has just installed it every way through', () => {
      const visible = visibleFor(stepStandings(NOTHING_MET));
      const controls = commandLinksIn(visible);
      assert.strictEqual(
        controls.length,
        STEP_IDS.length * 2 + 1,
        `expected two ways through each of the ${STEP_IDS.length} steps plus the dismissal; found: ${controls.join(', ')}`,
      );
    });

    // The editor derives an activation event from each declared command, so a
    // control naming an undeclared one would do nothing at all for a reader
    // whose workspace has not otherwise started the extension — which is most
    // readers meeting this list, and a failure that reports nothing anywhere.
    it('declares every command a control invokes', () => {
      const declared = new Set(manifest().commands.map((c) => String(c.command)));
      const invoked = [...new Set(commandLinksIn(ourEntries()))];
      const undeclared = invoked.filter((c) => !declared.has(c));
      assert.deepStrictEqual(
        undeclared,
        [],
        `these controls invoke commands the manifest does not declare, so no activation event is derived for them and pressing one does nothing: ${undeclared.join(', ')}`,
      );
    });

    it('keeps the way back in the command palette', () => {
      const { commands, palette } = manifest();
      const declared = commands.find((c) => c.command === SHOW_COMMAND);
      assert.ok(declared, `${SHOW_COMMAND} is not declared`);
      assert.strictEqual(declared.title, SHOW_COMMAND_TITLE);
      const hidden = palette.find((m) => m.command === SHOW_COMMAND);
      assert.strictEqual(
        hidden,
        undefined,
        'the way back must stay in the palette, or dismissing the list is a one-way door',
      );
    });

    it('keeps the list\'s own controls out of the command palette', () => {
      const hidden = new Set(
        manifest().palette.filter((m) => m.when === 'false').map((m) => String(m.command)),
      );
      const stepControls = [...new Set(commandLinksIn(ourEntries()))]
        .filter((c) => c.startsWith('aggrega.getStarted.'))
        .filter((c) => c !== SHOW_COMMAND);
      const leaked = stepControls.filter((c) => !hidden.has(c));
      assert.deepStrictEqual(
        leaked,
        [],
        `these belong to the list rather than to the palette: ${leaked.join(', ')}`,
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
