// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAttachmentsModel } from '../../src/graph-payload';
import { requireAggregaBinary, sensitivityFixtureRoot } from '../helpers/build-aggrega';

// THE WITHHELD MARKER HAS ONE DEFINITION AND IT IS THE COMPILER'S. This suite
// is what makes that true rather than aspirational.
//
// The marker is the object left where a value an author declared sensitive used
// to be. Two runtimes have to agree on it: the compiler writes one into the
// structured views it emits, and this extension recognises one in the graph it
// draws. They share no code — one is Go, the other JavaScript — so agreement
// cannot be arranged by importing a constant, and a constant declared twice
// agrees only for as long as nobody edits either copy.
//
// So the agreement is measured instead of assumed. The compiler is run for
// real, over a workspace that declares sensitivity, and the marker it emits is
// handed to THIS extension's own reader. A rename on the compiler side leaves
// the reader recognising nothing and fails here — which is the whole point, and
// the reason this file asserts against the binary rather than against a
// recorded sample of its output.
//
// THE GRAPH IS ASKED FOR BY ITS OWN FLAG. --output selects a format for the
// command's own readable document and never a different subject, and it
// reproduces an authored file as written — which is a reproduction of the
// author's own input rather than a view the compiler computed, and carries what
// they wrote. The graph is the computed subject, so it is what this suite
// asserts against, and --ir-graph is what asks for it.

describe('withheld marker conformance (compiler output against this reader)', function () {
  // The compiler is built on demand on a cold cache.
  this.timeout(180_000);

  let graphDocument: string;
  let graph: unknown;
  let model: Record<string, unknown>;

  before(function () {
    const binaryPath = requireAggregaBinary(this, 'withheld marker conformance');

    const fixture = sensitivityFixtureRoot();
    if (!fs.existsSync(path.join(fixture, 'release.yaml'))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping withheld marker conformance: no fixture at ${fixture}`);
      this.skip();
      return;
    }

    const run = spawnSync(
      binaryPath,
      ['inspect', './release.yaml', '--resolved', '--ir-graph', '--catalog', './catalog/base'],
      { cwd: fixture, encoding: 'utf8' },
    );
    if (run.status !== 0) {
      throw new Error(`aggrega inspect failed (status=${run.status}): ${run.stderr}`);
    }
    graphDocument = leadingGraphDocument(run.stdout);
    graph = JSON.parse(graphDocument);

    model = loadAttachmentsModel(path.resolve(__dirname, '..', '..', '..')) as unknown as Record<string, unknown>;
  });

  it('emits a marker keyed exactly as this reader recognises', function () {
    const key = model.WITHHELD_MARKER_KEY as string;
    assert.ok(
      typeof key === 'string' && key.length > 0,
      'this extension exposes no marker key to compare against',
    );
    assert.ok(
      markerReasons(graph, key).length > 0,
      `the compiler emitted no value keyed ${key}. Either it withheld nothing — in which case this ` +
        'fixture stopped declaring sensitivity and the test is no longer measuring anything — or the ' +
        'two sides have drifted onto different keys, and this reader would draw the compiler\'s ' +
        'marker as an ordinary authored object.',
    );
  });

  it('emits only reasons this reader can word', function () {
    const key = model.WITHHELD_MARKER_KEY as string;
    const withheldNote = model.withheldNote as (reason: string) => string;

    // The reason is what the panel turns into a sentence, so a reason this
    // reader does not know is a field it would report as absent without saying
    // why.
    const reasons = new Set(markerReasons(graph, key));
    assert.ok(reasons.size > 0, `no ${key} entry carried a readable reason`);

    for (const reason of reasons) {
      assert.notStrictEqual(
        withheldNote(reason),
        '',
        `the compiler emitted the reason ${JSON.stringify(reason)}, which this reader has no sentence ` +
          'for. A reader that cannot word a reason shows a field as absent and says nothing about why.',
      );
    }
  });

  it('withholds the values the fixture declares sensitive', function () {
    // The conformance above is about the SHAPE both sides agree on. This is the
    // property that shape exists to carry, asserted here too because a marker
    // both sides recognise is worth nothing if the value is emitted beside it.
    for (const secret of ['vault-token-plaintext', 'ak-plaintext', 'store-token-plaintext']) {
      assert.ok(
        !graphDocument.includes(secret),
        `the compiler emitted the declared-sensitive value ${secret} in the clear`,
      );
    }
  });

  it('leaves the values no declaration covers in the clear', function () {
    // THE POSITIVE CONTROL FOR THE ASSERTION ABOVE, AND IT IS LOAD-BEARING.
    // These values sit in the same payloads as those secrets, so a search that
    // could not see into the emission would report every secret absent whether
    // or not anything was withheld — and an absence assertion would then pass
    // on a build that withholds nothing at all, which is the one failure it
    // exists to catch. Failing here instead makes that visible.
    //
    // It is also the other direction of the property: over-withholding declares
    // public data secret, and that is the failure in this axis with no cheap
    // undo.
    for (const published of ['demo', 'not-a-secret', 'visible', 'boundary-wide']) {
      assert.ok(
        graphDocument.includes(published),
        `the compiler did not emit ${published}, which no declaration covers; withholding it ` +
          'declares public data secret.',
      );
    }
  });
});

// leadingGraphDocument returns the graph document at the head of an emission.
//
// The graph leads the stream and the readable layout follows it, so the document
// is taken alone: searched together, a value surviving in the readable layout
// would satisfy an assertion about the graph, and the other way round.
//
// The document is pretty-printed, which puts its own closing brace alone on a
// line and every nested one behind indentation — so the first such line ends it.
// The caller parses what this returns, and that parse is the check on the split:
// a boundary taken in the wrong place does not yield a JSON document.
function leadingGraphDocument(stream: string): string {
  const lines = stream.split('\n').map((line) => line.replace(/\r$/, ''));
  const end = lines.indexOf('}');
  assert.ok(end >= 0, 'the emission carries no graph document');
  return lines.slice(0, end + 1).join('\n');
}

// markerReasons collects the reason carried by every withheld marker in a
// document.
//
// A marker is the single-key object the reader recognises, and the key count is
// part of that recognition: the reader tests it before reading any value out, so
// a walk that only looked for the key would report agreement on a shape the
// reader would decline to read as a marker at all.
function markerReasons(node: unknown, key: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => markerReasons(item, key));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length === 1 && entries[0][0] === key) {
    return [String(entries[0][1])];
  }
  return entries.flatMap(([, value]) => markerReasons(value, key));
}
