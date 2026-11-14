// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import { RecordsActiveRelease, recordActiveRelease } from '../../src/active-release-marker';
import type { SetActiveReleaseParams } from '../../src/types';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import { tokenModules } from '../helpers/open-folder-census';
import { TEXT_LOOKUP, valueImports } from '../helpers/launch-census';

// Recording the selected Release as the workspace's default is a request to the
// language server, which writes the marker under the one judgement every write
// inside the workspace is held to. These specs hold the request the action sends,
// the ending it reaches for each way the request can end, and that nothing in the
// extension writes the marker itself.

// The compiler's own words for a write the boundary refuses, as the language
// server answers them: its short code ahead of the condition's sentence, and the
// condition named in the data. Literals, because the property under test is that
// they arrive unaltered; an expectation built from the extension's own rendering
// would move with it.
const BOUNDARY_REFUSAL = {
  code: -32602,
  message: 'E0320: the link /w/.aggrega leads to /elsewhere/aggdir, outside /w: a path this operation '
    + 'writes or deletes leads through a link out of the directory it must stay inside',
  data: { code: 'write-leads-out-of-workspace', shortCode: 'E0320' },
};
const WRITE_FAILURE = {
  code: -32603,
  message: 'create the directory of the active-Release marker: mkdir /w/.aggrega: not a directory',
};
const NOT_RUNNING = 'the Aggrega language server is not running';

// recorder is the request as a test holds it: every parameter object sent, in
// order, and the one way it ends.
function recorder(ends: { answer: unknown } | { refusal: unknown }): {
  sent: SetActiveReleaseParams[];
  record: RecordsActiveRelease;
} {
  const sent: SetActiveReleaseParams[] = [];
  return {
    sent,
    record: (params) => {
      sent.push(params);
      return 'answer' in ends ? Promise.resolve(ends.answer) : Promise.reject(ends.refusal);
    },
  };
}

describe('the selected Release recorded as the workspace default', () => {
  it('asks the language server to record the selected Release, and nothing else', async () => {
    const r = recorder({ answer: { release: '/w/envs/prod.yaml' } });
    const ending = await recordActiveRelease(r.record, 'envs/prod.yaml');
    // 🔴 THE WHOLE PARAMETER OBJECT, as an equality: the workspace root is added by
    // the client for every request, so anything else here would be a field the
    // action invented.
    assert.deepStrictEqual(r.sent, [{ release: 'envs/prod.yaml' }]);
    assert.deepStrictEqual(ending, {
      failed: false,
      message: "Aggrega: envs/prod.yaml is now this workspace's default Release.",
    });
  });

  it('ends a refusal in the compiler\'s own words, after the marker it names', async () => {
    const r = recorder({ refusal: BOUNDARY_REFUSAL });
    const ending = await recordActiveRelease(r.record, 'envs/prod.yaml');
    assert.deepStrictEqual(ending, {
      failed: true,
      message: `Aggrega: could not write .aggrega/active-release: ${BOUNDARY_REFUSAL.message}`,
    });
  });

  it('ends any other failure of the write the same way, in its own words', async () => {
    const r = recorder({ refusal: WRITE_FAILURE });
    const ending = await recordActiveRelease(r.record, 'envs/prod.yaml');
    assert.deepStrictEqual(ending, {
      failed: true,
      message: `Aggrega: could not write .aggrega/active-release: ${WRITE_FAILURE.message}`,
    });
  });

  it('says the marker was not written where no language server is running', async () => {
    const r = recorder({ refusal: new Error(NOT_RUNNING) });
    const ending = await recordActiveRelease(r.record, 'envs/prod.yaml');
    assert.deepStrictEqual(ending, {
      failed: true,
      message: `Aggrega: could not write .aggrega/active-release: ${NOT_RUNNING}`,
    });
  });

  it('asks nothing where no Release is selected, and says so', async () => {
    for (const none of [null, '']) {
      const r = recorder({ answer: {} });
      const ending = await recordActiveRelease(r.record, none);
      assert.deepStrictEqual(r.sent, [], `a request was sent for ${JSON.stringify(none)}`);
      assert.deepStrictEqual(ending, {
        failed: false,
        message: 'Aggrega: no Release is selected, so there is none to set as this workspace default. Select one first.',
      });
    }
  });
});

describe('the extension writes no active-release marker of its own', () => {
  it('sends the action through the method that writes the marker', () => {
    // The command handler hands the action the selection and the request, and the
    // request names the language server's writing method. Read from the source,
    // because the module holding both imports the editor.
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'createActiveReleaseMarker'),
      [['selectedRelease()', 'requestSetActiveRelease']],
    );
    const request = functionBody('src/extension.ts', 'async function requestSetActiveRelease(');
    assert.ok(
      request.includes("'aggrega/setActiveRelease'"),
      'the request the action is handed does not name aggrega/setActiveRelease',
    );
  });

  it('leaves no file write in the action', () => {
    // The decision reaches no filesystem and no editor, and the action that shows
    // its ending writes nothing either. An equality over the value imports, so a
    // module gaining a way to write is a difference rather than a presence a later
    // edit could satisfy.
    // The text lookup is admitted by name, for the reason TEXT_LOOKUP carries.
    assert.deepStrictEqual(valueImports('src/active-release-marker.ts'), ['./error-text', TEXT_LOOKUP, './workspace']);
    const action = functionBody('src/release-actions.ts', 'export async function createActiveReleaseMarker(');
    for (const write of ['fs.', 'writeFile', 'mkdir', 'appendFile', 'rename']) {
      assert.ok(!action.includes(write), `createActiveReleaseMarker reaches the filesystem (${write})`);
    }
  });

  it('names the marker in exactly the modules that watch it or say where it is', () => {
    // The marker's name is composed in the module that defines it (where the
    // watcher's glob is built) and in the module whose sentence names it, and in
    // no other: a third module composing it is a second writer in the making.
    assert.deepStrictEqual(
      tokenModules('ACTIVE_RELEASE_MARKER_BASENAME').map(([module]) => module),
      ['active-release-marker.ts', 'workspace.ts'],
    );
  });
});
