// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  OPEN_FOLDER_COMMAND,
  OPEN_WORKSPACE_ROOT_COMMAND,
  openWorkspaceRootInvocation,
  rowCommands,
  selectorRows,
  workspaceRow,
} from '../../src/selector-rows';
import { CHOOSE_PROJECT_FOLDER_COMMAND } from '../../src/project-folder';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import { callSites, tokenModules } from '../helpers/open-folder-census';

const ROOT = path.join(path.sep, 'work', 'demo');
const OPENED_BELOW = path.join(ROOT, 'services', 'api');
const CANDIDATES = { projectFolders: 1, aggregaWorkspaces: 1, releases: null };

// THE HANDLER'S OWN HEADER, written once. Every reading scoped to the press is
// scoped by this, so a registration that moved would fail the readings rather
// than silently widening them to the whole module.
const PRESS_HANDLER = 'registerCommand(OPEN_WORKSPACE_ROOT_COMMAND, () =>';

// The editor is made to work in a different folder in two ways and they are
// not one act. Opening a named folder replaces what the window has open; adding
// a folder puts one beside the folders the window has. The first is the
// editor's command, spelled once and run by name, because no typed call opens a
// folder; the second is the editor's typed call for adding folders, made at one
// site. Reading either on its own leaves the difference invisible, which is why
// both are stated here together.
describe('the two ways the editor is made to work in another folder', () => {
  it('spells the named-folder command once, and adds a folder by no command at all', () => {
    // 🔴 THE CONTROL ON THE CENSUS, and without it the readings below are
    // claims about the instrument. One token is certainly present and one
    // certainly is not, so a census that had stopped reading the tree would fail
    // the first and a census matching anything would fail the second.
    assert.notStrictEqual(
      tokenModules('OPEN_WORKSPACE_ROOT_COMMAND').length, 0,
      'the census sees no module naming a token it certainly should, so its zeros mean nothing',
    );
    assert.deepStrictEqual(
      tokenModules('aTokenNoModuleOfThisExtensionCarries'), [],
      'the census reports a module for a token nothing carries, so its findings mean nothing',
    );

    assert.deepStrictEqual(
      tokenModules(`'${OPEN_FOLDER_COMMAND}'`),
      [['selector-rows.ts', 1]],
      'the identifier that opens a NAMED folder is written somewhere else as well; a second '
      + 'spelling is a second thing to keep in step with the editor\'s own declarations',
    );
    // 🔴 THE ADD IS A TYPED CALL, MADE ONCE, AND IT IS NOT THE NAMED-FOLDER
    // COMMAND. A command run by name is a string nothing checks, so a wrong one
    // fails only at the press; the typed call is checked when the extension is
    // built. An equality over every call in the tree, so a second site adding a
    // folder, or the one site turning into something else, fails this.
    assert.deepStrictEqual(
      callSites('vscode.workspace.updateWorkspaceFolders').map((site) => [site.module, site.args]),
      [['window-folders.ts', ['vscode.workspace.workspaceFolders?.length ?? 0', 'null', '{ uri: location }']]],
      'a folder is added somewhere other than the one call that appends it after the folders open',
    );
    // And the command that REPLACES the window's folder is named where it is
    // declared and where the offer's invocation is composed, and where the
    // Project folder row's open entry runs it — and nowhere else. An add routed
    // through it would take away every folder the reader had open. 🔴 The open
    // entry's site is admitted by NAMING it in the equality, so a further module
    // naming the command still fails this.
    assert.deepStrictEqual(
      tokenModules('OPEN_FOLDER_COMMAND'),
      [['selector-rows.ts', 2], ['window-folders.ts', 2]],
      'the named-folder command is named outside the module that declares it and composes the '
      + 'offer with it and the one that opens the folder the reader picked, so something else can '
      + 'replace the window\'s folders',
    );
    // And the one place it is run by name is that open, handed the folder and
    // nothing else.
    assert.deepStrictEqual(
      callSites('vscode.commands.executeCommand')
        .filter((site) => site.args[0] === 'OPEN_FOLDER_COMMAND')
        .map((site) => [site.module, site.args]),
      [['window-folders.ts', ['OPEN_FOLDER_COMMAND', 'location']]],
      'the named-folder command is run by name somewhere other than the one open the chooser makes',
    );
  });

  it('gives each surface the command that does its job', () => {
    const rows = selectorRows(ROOT, OPENED_BELOW, OPENED_BELOW, { kind: 'unknown' }, CANDIDATES);
    const project = rows.find((row) => row.key === 'project');
    const workspace = rows.find((row) => row.key === 'workspace');
    assert.ok(project && workspace, 'both rows must be drawn');

    // 🔴 THE PROJECT FOLDER ROW RUNS THIS EXTENSION'S OWN COMMAND. It asks
    // which of the folders the window ALREADY HAS is the one Aggrega works from,
    // which is a question no editor command answers — opening a named folder
    // replaces what the window has. Opening a folder and adding one are the last
    // two entries inside that command's chooser, so the reader can still reach a
    // folder the window does not hold.
    assert.strictEqual(
      project.command, CHOOSE_PROJECT_FOLDER_COMMAND,
      'the row runs something other than the chooser among the folders already open, so the '
      + 'choice that scopes the level beneath it cannot be made at all',
    );
    // The offer runs a command of this extension's that names its destination,
    // so it puts no question in front of a reader who has already been shown
    // the answer.
    assert.strictEqual(
      workspace.offer?.command, OPEN_WORKSPACE_ROOT_COMMAND,
      'the offer runs something other than its own command, which opens the workspace it names',
    );
    assert.strictEqual(
      openWorkspaceRootInvocation(ROOT)?.command, OPEN_FOLDER_COMMAND,
      'the offer runs something other than the editor\'s named-folder command',
    );
  });
});

// What a press composes, driven rather than read: the editor's own command for
// a named folder, and the Aggrega workspace root as its location. The half that
// needs the editor — wrapping that location as a file location and handing the
// pair over — is read off the source below, because the module holding it
// imports the editor and the editor does not start here.
describe('what the offer composes for the editor', () => {
  it('names the command and the Aggrega workspace root', () => {
    assert.deepStrictEqual(
      openWorkspaceRootInvocation(ROOT),
      { command: OPEN_FOLDER_COMMAND, location: ROOT },
    );
  });

  it('composes nothing where there is no Aggrega workspace to open', () => {
    // 🔴 THE HALF THAT MATTERS AT THE PRESS RATHER THAN AT THE DRAWING. The
    // offer is drawn only where there is a workspace, so this state is reached
    // by the workspace going away between the drawing and the press — at which
    // point opening what used to be there would move the window somewhere
    // nothing is working.
    assert.strictEqual(openWorkspaceRootInvocation(null), null);
  });

  it('hands the location over as a file location, and the pair to the editor', () => {
    // Read off the source: this is the one statement in the chain that needs the
    // editor, so no spec here can call it. It is an equality over EVERY
    // invocation this module makes rather than a search for one, because a total
    // cannot say which of them is which — and one appearing is the change this
    // claim exists to refuse. The three are the press a reader made, the cog at
    // the top of the panel, and the folder the offer composed.
    assert.deepStrictEqual(
      callArguments('src/operations.ts', 'vscode.commands.executeCommand'),
      [
        ['press.command', 'press.option ?? undefined'],
        ['OPEN_SETTINGS_COMMAND', 'extensionSettingsQuery(EXTENSION_ID)'],
        ['opening.command', 'vscode.Uri.file(opening.location)'],
      ],
      'the panel hands the editor something other than the three invocations it is supposed to: '
      + 'the press a reader made, the cog, and the folder the offer composed',
    );
  });
});

// 🔴 THE CLAUSE THE WHOLE CONTROL RESTS ON. Opening a folder takes the window
// down and stands it back up, so the act is a reader's and nothing performs it
// on their behalf. Each reading below has been shown to name the defect it
// guards by planting that defect and reading the refusal.
describe('the offer runs on a press and on no other path', () => {
  it('composes the folder at the two sites that are presses, and at no third', () => {
    // 🔴 THERE ARE TWO READER PRESSES AND THE EQUALITY NAMES BOTH. One is the
    // control on the row; the other is the action on the interruption raised
    // when the workspace turns out to sit above the folder the window is open
    // on. Both are a reader choosing to reload their window, which is the rule
    // this census holds — so a second site is admitted by NAMING it rather than
    // by loosening the reading into a presence. A third site still fails, and
    // that is the whole value of leaving this an equality.
    //
    // Both compose through the one pure decision rather than deriving a folder
    // of their own, so what happens when the workspace has gone away between
    // the drawing and the press has one answer for both.
    assert.deepStrictEqual(
      callSites('openWorkspaceRootInvocation').map((site) => [site.module, site.args]),
      [
        ['extension.ts', ['anchoredWorkspaceRoot()']],
        ['operations.ts', ['deps.getAnchoredWorkspaceRoot()']],
      ],
      'something other than the two presses composes a folder to open — a refresh, an activation '
      + 'or a reaction to the workspace changing would restart the window a reader was working in '
      + 'because a value they never touched had settled',
    );
  });

  it('puts that site inside the registered command and nowhere else in the module', () => {
    const body = functionBody('src/operations.ts', PRESS_HANDLER);
    assert.ok(
      body.includes('openWorkspaceRootInvocation('),
      `the registered command composes no folder at all; its body was:\n${body}`,
    );
    assert.ok(
      body.includes('vscode.Uri.file('),
      `the registered command hands the editor no file location; its body was:\n${body}`,
    );
    // 🔴 THE NEEDLE ON THE BLOCK, and without it the containment above is a
    // claim about a brace scan rather than about the module. A block that ran
    // past its own end would swallow the rest of the module and pass both
    // readings above whatever was written; a block that stopped short would fail
    // them. This names a statement the real body ends with.
    assert.ok(
      body.trim().endsWith('vscode.Uri.file(opening.location));'),
      `the scanned body does not end where the handler does; it was:\n${body}`,
    );
    assert.ok(
      !body.includes('reg(\'validate\''),
      'the scanned body ran past the handler into the rest of the module, so the containment '
      + 'above is measuring more than the handler',
    );
  });

  it('is never handed to the editor to run, so only a reader\'s press reaches it', () => {
    // The panel runs exactly one command whose name it did not write: the one a
    // reader's press named, checked against what the panel's own content offers.
    // A module naming this command TO the editor would be running the offer
    // without a press, which is the defect no amount of care at the handler
    // would catch.
    const invoked = callSites('vscode.commands.executeCommand').map((site) => site.args[0]);
    assert.ok(
      invoked.includes('press.command'),
      'the census sees no invocation it certainly should, so its absences mean nothing',
    );
    assert.ok(
      !invoked.includes('OPEN_WORKSPACE_ROOT_COMMAND'),
      'a module asks the editor to run the offer, so the window can be restarted with nobody '
      + 'having pressed anything',
    );
  });

  it('spells the offer\'s own command in the row that draws it and the module that registers it', () => {
    assert.deepStrictEqual(
      tokenModules('OPEN_WORKSPACE_ROOT_COMMAND').map(([file]) => file),
      ['operations.ts', 'selector-rows.ts'],
      'a third module names the offer\'s command; the row that draws it and the one that '
      + 'registers it are the only two that have any business with it',
    );
  });
});

// The row's own promise, before and after. The offer is an ADDITION: what the
// two controls that were there already reach is what they reached before, so no
// press lands on a target the reader did not aim at.
describe('the offer leaves the row\'s existing controls where they were', () => {
  it('changes neither what the row runs nor what its create control runs', () => {
    const withOffer = workspaceRow(ROOT, OPENED_BELOW, 1);
    const without = workspaceRow(ROOT, ROOT, 1);
    assert.notStrictEqual(withOffer.offer, null, 'the case with an offer has none');
    assert.strictEqual(without.offer, null, 'the case without an offer has one');

    assert.strictEqual(
      withOffer.command, without.command,
      'the row runs a different command once it carries an offer, so a press on the row lands '
      + 'somewhere the reader did not aim',
    );
    assert.strictEqual(
      withOffer.create?.command, without.create?.command,
      'the create control runs a different command once the row carries an offer',
    );
    assert.strictEqual(
      withOffer.create?.label, without.create?.label,
      'the create control announces itself differently once the row carries an offer',
    );
  });

  it('adds one command to what the panel admits, and takes none away', () => {
    const without = rowCommands(workspaceRow(ROOT, ROOT, 1));
    const withOffer = rowCommands(workspaceRow(ROOT, OPENED_BELOW, 1));
    for (const command of without) {
      assert.ok(
        withOffer.includes(command),
        `${command} stops being admitted once the row carries an offer, so a control the panel `
        + 'still draws would be refused when pressed',
      );
    }
    assert.deepStrictEqual(
      withOffer.filter((command) => !without.includes(command)),
      [OPEN_WORKSPACE_ROOT_COMMAND],
      'the offer admits something other than its own command',
    );
  });
});
