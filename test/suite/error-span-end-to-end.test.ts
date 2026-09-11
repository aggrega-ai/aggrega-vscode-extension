// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Daemon, DaemonState } from '../../src/daemon';
import { ConvertedShape } from '../../src/diagnostics-shape';
import { handleDaemonError, isJsonRpcError } from '../../src/error-surfaces';
import { settingsFromObject } from '../../src/settings';
import { ERR_ENTITY_NOT_RESOLVABLE } from '../../src/types';
import { brokenManifestWorkspaceRoot, requireAggregaBinary } from '../helpers/build-aggrega';

// The whole point of this file is that neither half is written by hand. The
// payload comes out of a real aggrega serve subprocess, and the range comes
// out of the extension's own reading code applied to that payload. A test
// asserting a hand-built payload against either side would prove that one
// side agrees with a fixture, which is exactly what a producer and a consumer
// wired independently already do while lighting nothing up between them.
describe('Error-envelope span, daemon to editor range', function () {
  // A cold go build dominates this; the daemon request itself is fast.
  this.timeout(180_000);

  let binaryPath: string;
  let workspaceRoot: string;

  before(function () {
    binaryPath = requireAggregaBinary(this, 'error-envelope span suite');
    workspaceRoot = brokenManifestWorkspaceRoot();
  });

  it('underlines the manifest key the failing Release authored', async function () {
    const daemon = new Daemon(
      settingsFromObject({ binaryPath, respawnAttempts: 1, respawnWindowSeconds: 60 }),
    );
    let thrown: unknown;
    try {
      await daemon.start(workspaceRoot);
      assert.strictEqual(daemon.getState(), DaemonState.Running);
      try {
        await daemon.request('aggrega/irGraph', { release: 'release.yaml' });
        assert.fail('the graph request should have been refused');
      } catch (err) {
        thrown = err;
      }
    } finally {
      await daemon.stop();
    }

    assert.ok(isJsonRpcError(thrown), `expected a daemon envelope; got ${String(thrown)}`);

    // What the daemon actually produced, logged BEFORE anything is asserted
    // on it: a failure here is about which envelope arrived, and that question
    // is unanswerable from an assertion message naming only a code.
    // eslint-disable-next-line no-console
    console.log(`  daemon envelope: code=${thrown.code} message=${thrown.message}`);
    // eslint-disable-next-line no-console
    console.log(`  daemon payload: ${JSON.stringify(thrown.data)}`);

    assert.strictEqual(
      thrown.code,
      ERR_ENTITY_NOT_RESOLVABLE,
      'the fixture must fail at closure resolution; any other code means it failed earlier and this test is measuring the wrong refusal',
    );
    assert.ok(thrown.data, 'the envelope carried no structured payload');
    // The document the envelope names must be this fixture's own. Anchoring
    // walks up from the daemon's working directory, so a fixture that stops
    // anchoring gets anchored by a config above it in the checkout and every
    // assertion below would then be measured against another workspace's
    // documents — while still producing plausible-looking coordinates. This is
    // the check that makes that failure say what it is.
    assert.strictEqual(
      thrown.data.file,
      path.join(workspaceRoot, 'release.yaml'),
      'the daemon anchored somewhere other than this fixture',
    );

    // Now the extension's own reading code, unmodified, over that payload.
    // The range it computes is the range VS Code draws.
    const published: Array<{ shapes: ConvertedShape[] }> = [];
    const handled = handleDaemonError(thrown, {
      uri: { toString: () => 'file:///release.yaml' } as never,
      workspaceRoot,
      publishShape: (_uri, shapes: ConvertedShape[]) => { published.push({ shapes }); },
      logLine: () => { /* not the subject */ },
      toastInfo: () => Promise.resolve(undefined),
      createTerminal: (() => ({})) as never,
      selectedRelease: () => null,
      toastDebounce: new Map(),
      toastDebounceMode: 'session',
      toastThrottleSeconds: 300,
      now: () => 0,
    });
    assert.strictEqual(handled, true, 'the envelope was not recognised');
    assert.strictEqual(published.length, 1, 'expected exactly one published shape');
    const shape = published[0].shapes[0];
    // eslint-disable-next-line no-console
    console.log(`  editor range: ${shape.startLine}:${shape.startChar}-${shape.endLine}:${shape.endChar}`);

    // The range is not asserted against remembered numbers: it is read back
    // out of the authored document, so this fails if the daemon points at the
    // wrong token rather than merely at a different coordinate.
    const authored = fs.readFileSync(path.join(workspaceRoot, 'release.yaml'), 'utf8').split('\n');
    assert.strictEqual(
      shape.startLine,
      shape.endLine,
      'the manifest key sits on one line, so its range must not span two',
    );
    const underlined = authored[shape.startLine].slice(shape.startChar, shape.endChar);
    // eslint-disable-next-line no-console
    console.log(`  underlined text: ${JSON.stringify(underlined)}`);
    assert.strictEqual(
      underlined,
      'manifest',
      `the range should underline the manifest key; it underlines ${JSON.stringify(underlined)} on ${JSON.stringify(authored[shape.startLine])}`,
    );
    // A point-style range has start equal to end and underlines nothing, so
    // the editor draws a caret where this surface owes an underline. Asserting
    // the width separately keeps that failure legible as "it stopped spanning"
    // rather than as a coordinate mismatch.
    assert.ok(
      shape.endChar > shape.startChar,
      'the range is point-style, so the editor would draw a caret rather than an underline',
    );
  });
});
