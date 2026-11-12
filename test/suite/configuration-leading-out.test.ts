// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import {
  ServerListing,
  asTheServerSpellsIt,
  configurationOpening,
} from '../../src/configuration-leading-out';
import { callArguments, functionBody } from '../helpers/anchoring-census';

// Whether an action opens the workspace's configuration file is the language
// server's judgement of where that file leads, read off its Release listing. These
// specs hold the decision for each way that listing can answer, and that the two
// actions opening the file are both handed the same way of asking.

const ROOT = path.join(path.sep + 'w', 'proj');
const CONFIG = path.join(ROOT, '.aggrega-config.yaml');

// The sentence an action ends in where the file is not opened. A literal, because
// the words are what the reader is told and an expectation built from the
// module's own composer would accept any change to them.
const NOT_OPENED = 'Aggrega: .aggrega-config.yaml is not opened, because it leads outside the Aggrega workspace, '
  + 'so Aggrega does not use it.';

// The refusal of the listing over a configuration file that does not validate, as
// the language server answers it.
const INVALID_CONFIGURATION = {
  code: -32602,
  message: 'E0224: workspace config /w/proj/.aggrega-config.yaml is invalid: build: expected a mapping',
  data: { code: 'workspace-config-invalid', shortCode: 'E0224' },
};

// listing is the language server as one decision meets it: the listing's answer or
// refusal, the root it answers for, and how many times it was asked.
function listing(
  ends: { names: string[] } | { refusal: unknown },
  root: string | null = ROOT,
): ServerListing & { asked: number } {
  const held = {
    asked: 0,
    listReleases: () => {
      held.asked += 1;
      return 'names' in ends
        ? Promise.resolve({ unreadLinkedFiles: ends.names })
        : Promise.reject(ends.refusal);
    },
    answeredRoot: () => root,
  };
  return held;
}

describe('a configuration file is opened unless the language server names it as leading out', () => {
  it('leaves the file unopened, and says why, where the listing names it', async () => {
    const server = listing({ names: ['linked-release.yaml', '.aggrega-config.yaml'] });
    const opening = await configurationOpening(server, CONFIG, 'found');
    assert.deepStrictEqual(opening, { open: false, message: NOT_OPENED });
    assert.strictEqual(server.asked, 1);
  });

  it('names the file as the answer spells it, relative to the root the server answers for', async () => {
    const nested = path.join(ROOT, 'team', '.aggrega-config.yaml');
    // The server separates the parts of a name with a forward slash on every
    // platform, so its name is written as it sends it rather than joined here.
    const spelled = 'team/.aggrega-config.yaml';
    const opening = await configurationOpening(listing({ names: [spelled] }), nested, 'found');
    assert.deepStrictEqual(opening, {
      open: false,
      message: `Aggrega: ${spelled} is not opened, because it leads outside the Aggrega workspace, so Aggrega does not use it.`,
    });
  });

  it('opens the file where the listing answers without naming it', async () => {
    // The listing names other links, and none of them is this file: the server
    // read the configuration, so it does not lead out.
    for (const names of [[], ['linked-release.yaml'], ['team/.aggrega-config.yaml']]) {
      const opening = await configurationOpening(listing({ names }), CONFIG, 'found');
      assert.deepStrictEqual(opening, { open: true }, `refused where the listing named ${JSON.stringify(names)}`);
    }
  });

  it('opens the file where the listing is refused, so an invalid configuration can be repaired', async () => {
    const opening = await configurationOpening(listing({ refusal: INVALID_CONFIGURATION }), CONFIG, 'found');
    assert.deepStrictEqual(opening, { open: true });
  });

  it('opens the file where no language server is running to judge it', async () => {
    const opening = await configurationOpening(
      listing({ refusal: new Error('the Aggrega daemon is not running') }),
      CONFIG,
      'found',
    );
    assert.deepStrictEqual(opening, { open: true });
  });

  it('opens the file where the server has reported no root its names are relative to', async () => {
    for (const root of [null, '']) {
      const opening = await configurationOpening(listing({ names: ['.aggrega-config.yaml'] }, root), CONFIG, 'found');
      assert.deepStrictEqual(opening, { open: true }, `refused with the root ${JSON.stringify(root)}`);
    }
  });

  it('asks nothing about a file the action has just created', async () => {
    // Even a listing that would name it is not consulted: the action wrote the
    // file inside the workspace a moment ago, so there is no link to judge.
    const server = listing({ names: ['.aggrega-config.yaml'] });
    const opening = await configurationOpening(server, CONFIG, 'created');
    assert.deepStrictEqual(opening, { open: true });
    assert.strictEqual(server.asked, 0, 'the listing was asked about a file the action created');
  });
});

describe('the file is spelled as the language server spells a name', () => {
  it('separates the parts of a relative path with a forward slash whatever the platform separates them with', () => {
    // A platform separating with a backslash spells a file in a subdirectory
    // "team\.aggrega-config.yaml", and the server's answer names it
    // "team/.aggrega-config.yaml".
    assert.strictEqual(asTheServerSpellsIt('team\\.aggrega-config.yaml', '\\'), 'team/.aggrega-config.yaml');
    assert.strictEqual(asTheServerSpellsIt('a\\b\\.aggrega-config.yaml', '\\'), 'a/b/.aggrega-config.yaml');
    assert.strictEqual(asTheServerSpellsIt('.aggrega-config.yaml', '\\'), '.aggrega-config.yaml');
    assert.strictEqual(asTheServerSpellsIt('team/.aggrega-config.yaml', '/'), 'team/.aggrega-config.yaml');
  });

  it('compares the names in the answer with the file spelled that way', () => {
    // Read from the source, because on a platform separating with a forward slash
    // the comparison reads the same with the spelling left out.
    const body = functionBody('src/configuration-leading-out.ts', 'export async function configurationOpening(');
    assert.ok(
      body.includes('const spelled = asTheServerSpellsIt(toWorkspaceRelative(root, file));'),
      'configurationOpening compares the names with a spelling other than the one the server gives a name',
    );
  });
});

describe('both actions opening the configuration file ask the same way', () => {
  it('hands the command and the welcome page the one listing', () => {
    // Read from the source, because the modules holding both actions import the
    // editor: the command is handed the listing at its registration, and the
    // welcome page is handed it among its dependencies.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'openAuthoringReleaseConfig'),
      [['workspaceRootForCommands', 'configurationWatch.ownWrite', 'serverListing']],
    );
    const decided = (file: string) => callArguments(file, 'configurationOpening');
    assert.deepStrictEqual(decided('src/release-actions.ts'), [['serverListing', 'configPath', "created ? 'created' : 'found'"]]);
    assert.deepStrictEqual(decided('src/get-started.ts'), [['deps.serverListing', 'target', "created ? 'created' : 'found'"]]);
  });
});
