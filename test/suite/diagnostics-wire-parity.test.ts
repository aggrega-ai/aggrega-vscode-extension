// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  groupDiagnosticsBySource,
  shapeForDaemonDiagnostic,
  sourceForDaemonDiagnostic,
} from '../../src/diagnostics-shape';

// Parity between the daemon's real output and the client's reading of it.
//
// Every other diagnostic fixture in this suite is hand-authored, which pins the
// client against itself: the grouping stays correct with respect to a shape
// nobody checked against the producer. The frames below are different — each is
// the verbatim `diagnostics` entry of an `aggrega/publishDiagnostics`
// notification captured from a running `aggrega serve`, so a change to the wire
// that the client does not follow fails here rather than in a user's editor.
//
// Provenance, so the fixture can be re-derived rather than trusted:
//
//   binary   aggrega 0.6.1-631-g8afac72b (commit 8afac72b, abi v1alpha1)
//   captured 2026-08-29, driving JSON-RPC over stdin/stdout
//   sequence aggrega/initialize -> aggrega/validate -> aggrega/irGraph
//   flag     `aggrega serve --build-on-inspect`
//
// The render-layer frame requires that flag: with the dial off the render does
// not run, so the layer stays empty and only the document-validation layer
// appears.
//
// Two deliberate elisions, named so the fixture is not read as more verbatim
// than it is. The enclosing notification's `file` field is an absolute path
// under the capture directory and is not reproduced. The validation frame's
// message is kept only as far as its `Details:` boundary: the tail enumerates
// content digests of the entities that drifted, which would make this fixture
// rot on any unrelated catalog edit while testing nothing about the client.
// Every other field of both frames, and the render frame's message in full, are
// byte-for-byte as they arrived.
//
// Both frames carry a `code` the client's own wire type does not model. That is
// deliberate in the fixture: an unmodelled field must be carried harmlessly
// rather than break the reading, and pinning it here is what keeps that true.
const RENDER_LAYER_FRAME = {
  line: 1,
  column: 1,
  severity: 'warning',
  message:
    'node "db" (provider "compose"): target "compose" does not fully support '
    + 'containers.main.health; a service carries a single healthcheck, so only '
    + 'the live probe is translated and the ready probe is dropped',
  code: 'unsupported-field',
  source: 'aggrega-build',
};

const VALIDATION_LAYER_FRAME = {
  line: 1,
  column: 1,
  severity: 'warning',
  message:
    'Lockfile drifted from current closure. Run `aggrega pull --upgrade '
    + '--release <release>` to update.',
  code: 'lockfile/lockfile-drift',
  source: 'aggrega',
};

describe('daemon diagnostic wire parity', () => {
  it('files a captured render-layer frame under the layer the daemon named', () => {
    // The whole point of grouping by the wire's own value: this frame reaches
    // its own layer without the client knowing anything about render advisories.
    assert.strictEqual(sourceForDaemonDiagnostic(RENDER_LAYER_FRAME), 'aggrega-build');
  });

  it('files a captured validation-layer frame under the validation layer', () => {
    assert.strictEqual(sourceForDaemonDiagnostic(VALIDATION_LAYER_FRAME), 'aggrega');
  });

  it('splits two captured layers into two independently clearable groups', () => {
    // This is the behaviour the per-layer collections exist for: two real
    // findings from two real layers must not land in one group, or neither can
    // be cleared without disturbing the other.
    const grouped = groupDiagnosticsBySource([VALIDATION_LAYER_FRAME, RENDER_LAYER_FRAME]);

    assert.deepStrictEqual([...grouped.keys()], ['aggrega', 'aggrega-build']);
    assert.deepStrictEqual(
      grouped.get('aggrega')!.map(d => d.message),
      [VALIDATION_LAYER_FRAME.message],
    );
    assert.deepStrictEqual(
      grouped.get('aggrega-build')!.map(d => d.message),
      [RENDER_LAYER_FRAME.message],
    );
  });

  it('converts a captured frame head-of-file position to editor coordinates', () => {
    // A render advisory names a component and a delivery key rather than a
    // position in the document, so the daemon attributes it to the head of the
    // file. The client's 1-based-to-0-based conversion has to hold at that
    // boundary value, which is the one every render advisory uses.
    const shape = shapeForDaemonDiagnostic(RENDER_LAYER_FRAME);

    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
    assert.strictEqual(shape.endLine, 0);
    assert.strictEqual(shape.endChar, 0);
    assert.strictEqual(shape.severity, 'warning');
    assert.strictEqual(shape.source, 'aggrega-build');
    assert.strictEqual(shape.message, RENDER_LAYER_FRAME.message);
  });

  it('carries a captured frame through even though its code is unmodelled', () => {
    // The wire carries a machine-matchable code the client's type does not
    // declare. Reading must ignore it rather than fail on it, so that the
    // daemon can name a finding's class before the client has a use for it.
    const shape = shapeForDaemonDiagnostic(RENDER_LAYER_FRAME);
    assert.strictEqual(shape.message, RENDER_LAYER_FRAME.message);
    assert.ok(!('code' in shape), 'the converted shape models no code today');
  });
});
