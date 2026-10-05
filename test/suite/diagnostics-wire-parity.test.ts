// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  DIAGNOSTIC_SOURCE_BUILD,
  editorCodeForShape,
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
// Both frames carry a `code` and neither carries the two identifier keys the
// wire offers beside it — the quotable code and the reference to where the
// condition is explained. That is a property of the capture rather than of the
// wire: these bytes came off a daemon whose diagnostics carried the one key, and
// they are kept as captured. What they therefore pin is the case the client will
// keep meeting in the field, which is a daemon older than the client reading it:
// the code is read, and the absent keys leave the reader with a code and no link
// rather than with a link to nowhere.
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

  it('names the build\'s layer as the captured render-layer frame names it', () => {
    // The one layer name the extension holds — the layer a document's close
    // leaves standing — is the name the producer put on a real render finding,
    // so a renamed layer fails here rather than as findings that leave with
    // their document.
    assert.strictEqual(DIAGNOSTIC_SOURCE_BUILD, sourceForDaemonDiagnostic(RENDER_LAYER_FRAME));
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

  it('reads a captured frame code and offers nothing to follow', () => {
    // A frame from a daemon that sent the machine-matchable code and nothing
    // beside it. The code is read; the two keys that would make it followable
    // are absent, and the absence has to survive the conversion rather than
    // becoming an empty value — a reference present and empty is what a client
    // would render as a link to nowhere.
    const shape = shapeForDaemonDiagnostic(RENDER_LAYER_FRAME);
    assert.strictEqual(shape.message, RENDER_LAYER_FRAME.message);
    assert.strictEqual(shape.code, RENDER_LAYER_FRAME.code);
    assert.ok(!('shortCode' in shape), 'a frame that sent no quotable code must carry no such key');
    assert.ok(!('codeHref' in shape), 'a frame that sent no reference must carry no such key');

    // And the decision a publish makes from it: a bare identifier the reader can
    // copy, never a link. Asserting the type as well as the value is what
    // separates "a code" from "a code with somewhere to go".
    const code = editorCodeForShape(shape);
    assert.strictEqual(typeof code, 'string', 'a code with no reference must not become a link');
    assert.strictEqual(code, RENDER_LAYER_FRAME.code);
  });

  it('reads both identifier keys and the reference when a frame carries them', () => {
    // The same captured frame with the keys a current daemon adds, so the pair of
    // cases differs in exactly the fields under test and in nothing else.
    const shape = shapeForDaemonDiagnostic({
      ...VALIDATION_LAYER_FRAME,
      shortCode: 'E0164',
      codeDescription: { href: 'https://aggrega.example/docs/errors#codes' },
    });

    assert.strictEqual(shape.code, VALIDATION_LAYER_FRAME.code);
    assert.strictEqual(shape.shortCode, 'E0164');
    assert.strictEqual(shape.codeHref, 'https://aggrega.example/docs/errors#codes');

    // The affordance: the slot carries the QUOTABLE code, which is the one a
    // reader searches for, together with the address to open.
    assert.deepStrictEqual(editorCodeForShape(shape), {
      value: 'E0164',
      target: 'https://aggrega.example/docs/errors#codes',
    });
  });
});
