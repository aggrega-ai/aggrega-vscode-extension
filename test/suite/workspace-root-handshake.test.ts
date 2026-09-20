// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Daemon } from '../../src/daemon';
import { settingsFromObject } from '../../src/settings';
import {
  findAggregaWorkspaceAnchor,
  windowAnchoring,
  WindowAnchoring,
} from '../../src/workspace';
import { selectorRows } from '../../src/selector-rows';
import {
  anchoringAssignments,
  callArguments,
  nulledIn,
} from '../helpers/anchoring-census';

// What the editor declares to the language server, and what it shows for the two
// places a window opened on a subdirectory is in.
//
// 🔴 THE LAYOUT IS THE WHOLE SUBJECT: one open folder at R/docs, the marker at
// R/.aggrega-config.yaml carrying a top-level `workspace:` block, and nothing at
// all marking R/docs. Every case here rests on the two values differing, so the
// layout is asserted before anything is read from it — a fixture that collapsed
// to one directory would let every case below pass while measuring nothing.
//
// The compiler PINS to the root it is handed rather than climbing from it, so
// what the editor declares IS what the server uses: declaring the folder rather
// than the root puts that workspace's own settings and catalog locations outside
// the cascade for the life of the connection.

interface Layout {
  root: string;
  docs: string;
  harness: string;
  anchoring: WindowAnchoring;
}

let layout: Layout;

// RECORDING_SERVER is a stand-in for `aggrega serve` that keeps the initialize
// request it is sent and then answers it the way the compiler does — pinned to
// whatever root arrived, never to something it climbed to for itself.
//
// 🔴 IT RECORDS THE BYTES THE CLIENT WROTE, which is the only reading that is
// about the composed request rather than about a value some getter would return.
// The client's own framing helper says the same thing at its declaration: it is
// exported so a test can read back exactly the bytes a send produces.
//
// It is written per case with its record path baked in rather than read from the
// environment, so two cases cannot race for one variable.
function writeRecordingServer(dir: string, recordTo: string): string {
  const file = path.join(dir, `recording-serve-${path.basename(recordTo)}.js`);
  const body = [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    `const recordTo = ${JSON.stringify(recordTo)};`,
    'let buf = Buffer.alloc(0);',
    "process.stdin.on('data', (chunk) => {",
    '  buf = Buffer.concat([buf, chunk]);',
    '  for (;;) {',
    "    const headerEnd = buf.indexOf('\\r\\n\\r\\n');",
    '    if (headerEnd < 0) { return; }',
    "    const m = /Content-Length: (\\d+)/i.exec(buf.subarray(0, headerEnd).toString('ascii'));",
    '    if (!m) { return; }',
    '    const length = parseInt(m[1], 10);',
    '    const bodyStart = headerEnd + 4;',
    '    if (buf.byteLength < bodyStart + length) { return; }',
    "    const raw = buf.subarray(bodyStart, bodyStart + length).toString('utf8');",
    '    buf = buf.subarray(bodyStart + length);',
    '    const req = JSON.parse(raw);',
    "    if (req.method === 'aggrega/shutdown') { process.exit(0); }",
    "    if (req.method !== 'aggrega/initialize') { continue; }",
    "    fs.writeFileSync(recordTo, raw, 'utf8');",
    '    const declared = (req.params && req.params.workspaceRoot) || process.cwd();',
    '    const result = {',
    "      capabilities: { positionEncoding: 'utf-8' },",
    '      workspaceRoot: declared,',
    "      configSource: 'workspace',",
    '    };',
    "    const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), 'utf8');",
    '    process.stdout.write(Buffer.concat([',
    "      Buffer.from('Content-Length: ' + payload.byteLength + '\\r\\n\\r\\n', 'ascii'),",
    '      payload,',
    '    ]));',
    '  }',
    '});',
    'setInterval(() => {}, 60000);',
    '',
  ].join('\n');
  fs.writeFileSync(file, body, 'utf8');
  fs.chmodSync(file, 0o755);
  return file;
}

// composedInitialize drives a real client over the recording server and returns
// the initialize request it wrote.
async function composedInitialize(startAt: string, label: string): Promise<{
  params: { workspaceRoot?: string };
}> {
  const recordTo = path.join(layout.harness, `${label}.json`);
  const binaryPath = writeRecordingServer(layout.harness, recordTo);
  const daemon = new Daemon(
    settingsFromObject({ binaryPath, respawnAttempts: 3, respawnWindowSeconds: 60 }),
    () => { /* the narration is not this reading's subject */ },
  );
  try {
    await daemon.start(startAt);
  } finally {
    await daemon.stop();
  }
  return JSON.parse(fs.readFileSync(recordTo, 'utf8'));
}

before(async function () {
  this.timeout(30_000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-anchoring-')));
  fs.writeFileSync(
    path.join(root, '.aggrega-config.yaml'),
    'workspace:\n  catalog_dirs:\n    - ./catalog\n',
    'utf8',
  );
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs);
  const harness = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-anchoring-harness-')));
  const anchorPath = await findAggregaWorkspaceAnchor(docs);
  assert.strictEqual(
    anchorPath,
    path.join(root, '.aggrega-config.yaml'),
    'the fixture must anchor at the config carrying the workspace block, above the open folder',
  );
  layout = {
    root,
    docs,
    harness,
    anchoring: windowAnchoring({ folder: { uri: { fsPath: docs } }, anchorPath: anchorPath! }),
  };
});

describe('the window has two facts, and they differ here', () => {
  it('climbs to the root while the editor stays on the folder it opened', () => {
    assert.strictEqual(layout.anchoring.workspaceRoot, layout.root);
    assert.strictEqual(layout.anchoring.openedFolder, layout.docs);
    assert.notStrictEqual(
      layout.anchoring.workspaceRoot,
      layout.anchoring.openedFolder,
      'the fixture must put the marker ABOVE the open folder; with the two equal every reading '
      + 'below passes while measuring nothing',
    );
  });
});

describe('the initialize handshake declares the Aggrega workspace root', function () {
  this.timeout(30_000);

  it('carries the climbed root, read off the request the client wrote', async () => {
    const composed = await composedInitialize(layout.anchoring.workspaceRoot, 'climbed');
    assert.strictEqual(
      composed.params.workspaceRoot,
      layout.root,
      'the declared workspace must be the root the marker sits in; the compiler pins to what it '
      + 'is handed, so a declaration naming anything else is the workspace the whole connection '
      + 'then resolves against',
    );
    assert.notStrictEqual(
      composed.params.workspaceRoot,
      layout.docs,
      'declaring the folder the editor opened puts the workspace\'s own declared settings and '
      + 'catalog locations outside the cascade',
    );
  });

  // 🔴 THE CONTROL, and without it the reading above is not a measurement. It
  // shows the same instrument reports the OTHER value when the other value is
  // what is handed over — so a pass above is the client having declared the root,
  // rather than the recording having stopped working.
  it('carries the opened folder when the opened folder is what it is handed', async () => {
    const composed = await composedInitialize(layout.anchoring.openedFolder, 'opened');
    assert.strictEqual(
      composed.params.workspaceRoot,
      layout.docs,
      'the recording must still be able to report the folder, or the reading above cannot tell a '
      + 'correct declaration from a broken instrument',
    );
  });
});

describe('the two rows name the two places at the same moment', () => {
  const candidates = { projectFolders: 1, aggregaWorkspaces: 1, releases: null };

  it('reports the opened folder as the Project folder and the climbed root as the Aggrega workspace', () => {
    // The anchored argument is the root, because the compiler pins to the root
    // it was handed and answers with it.
    const rows = selectorRows(
      layout.anchoring.workspaceRoot,
      layout.anchoring.openedFolder,
      layout.anchoring.openedFolder,
      { kind: 'unknown' },
      candidates,
    );
    const project = rows.find((r) => r.key === 'project');
    const workspace = rows.find((r) => r.key === 'workspace');
    assert.ok(project && workspace, 'both rows must be drawn');
    assert.strictEqual(project.value, path.basename(layout.docs), 'Project folder names the opened folder');
    assert.strictEqual(workspace.value, path.basename(layout.root), 'Aggrega workspace names the climbed root');
    assert.notStrictEqual(
      project.value,
      workspace.value,
      'the two rows exist to report a difference; reporting one place twice removes the subject '
      + 'while leaving the row',
    );
    assert.ok(
      workspace.tooltip.includes(`The open folder is ${layout.docs}.`),
      `the workspace row must name the folder it differs from; tooltip was:\n${workspace.tooltip}`,
    );
  });

  // 🔴 THE CONTROL FOR THE READING ABOVE: collapsing the two onto one value is
  // exactly the change that would make the Project folder row name the workspace
  // and delete the difference the row below it exists to explain — and this shows
  // the assertions above name it rather than passing through it.
  it('names the collapse: one value in both places renames the Project folder row and silences the difference', () => {
    const collapsed = selectorRows(
      layout.anchoring.workspaceRoot,
      layout.anchoring.workspaceRoot,
      layout.anchoring.workspaceRoot,
      { kind: 'unknown' },
      candidates,
    );
    const project = collapsed.find((r) => r.key === 'project');
    const workspace = collapsed.find((r) => r.key === 'workspace');
    assert.ok(project && workspace, 'both rows must be drawn');
    assert.strictEqual(
      project.value,
      path.basename(layout.root),
      'a collapse makes the Project folder row name the workspace root, which is the falsehood the '
      + 'separate fact exists to prevent',
    );
    assert.ok(
      !workspace.tooltip.includes('The open folder is'),
      'a collapse makes the difference test permanently false, so the row stops reporting the '
      + 'difference rather than reporting that there is none',
    );
  });
});

// 🔴 WHAT THE WIRING DOES, MEASURED ON THE SOURCE BECAUSE IT CANNOT BE DRIVEN.
// The modules holding these sites import the editor, which does not start in a
// headless run — so nothing here can call them, and a spec that called the pure
// helpers instead would pass while the wiring handed the wrong value over. These
// are equalities against a recorded shape, which is its own control: an
// extraction that stopped working returns an empty list, and an empty list is not
// the recorded shape.
describe('the anchoring census over the wiring', () => {
  it('starts the language server at the workspace root and at nothing else', () => {
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'daemon.start'),
      [['anchoring.workspaceRoot']],
      'the client is started at the root the marker sits in; handing it the opened folder is the '
      + 'defect this census exists to refuse, and the compiler pins to whatever arrives',
    );
  });

  it('assigns each fact of the window to its own value', () => {
    assert.deepStrictEqual(
      anchoringAssignments('src/extension.ts'),
      [
        ['openedProjectFolder', 'openedFolder'],
        ['workspaceRootForCommands', 'workspaceRoot'],
      ],
      'the two facts are held apart; two targets taking one field is the collapse that makes the '
      + 'Project folder row name the workspace root',
    );
  });

  // The whole set is recorded rather than the two facts alone, and deliberately:
  // filtering to the two would accept a third value quietly joining or leaving
  // them, and what this claim is about is that the window's state is dropped as
  // one thing.
  it('drops both facts together when the language server goes', () => {
    assert.deepStrictEqual(
      nulledIn('src/extension.ts', 'async function stopDaemon('),
      ['activeAnchored', 'daemon', 'openedProjectFolder', 'workspaceRootForCommands'],
      'a root cleared while the folder stood would leave one row naming somewhere nothing is '
      + 'working in while the row below it reported nothing in use',
    );
  });

  it('draws the rows from the server\'s answer, the opened folder and the chosen one', () => {
    const calls = callArguments('src/operations.ts', 'selectorRows');
    assert.ok(calls.length > 0, 'the panel must still compose its rows here');
    for (const args of calls) {
      // 🔴 THREE DIFFERENT FACTS, AND THE THIRD IS THE ONE THAT MUST NOT BE
      // DRAWN FROM EITHER OTHER. The workspace row takes the root the compiler
      // reported; it also takes the folder that workspace was reached from, so
      // it can say the two differ. The Project folder row takes the reader's own
      // CHOICE — which is a decision rather than an outcome, and drawing it from
      // the opened folder is exactly the derivation the outer level is being
      // moved off.
      assert.deepStrictEqual(
        args.slice(0, 3),
        [
          'this.deps.getAnchoredWorkspaceRoot()',
          'this.deps.getOpenedProjectFolder()',
          'this.deps.getChosenProjectFolder()',
        ],
        'a row is drawn from a value that is not its own fact; the outer level drawn from the '
        + 'opened folder is the derivation this arrangement exists to end',
      );
      assert.strictEqual(
        new Set(args.slice(0, 3)).size, 3,
        'two rows are drawn from one value, so one of them reports a level it is not about',
      );
    }
  });
});
