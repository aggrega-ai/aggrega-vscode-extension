// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAttachmentsModel } from '../../src/graph-payload';
import { ensureAggregaBinary, sensitivityFixtureRoot } from '../helpers/build-aggrega';

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

describe('withheld marker conformance (compiler output against this reader)', function () {
  // The compiler is built on demand on a cold cache.
  this.timeout(180_000);

  let emitted: string;
  let model: Record<string, unknown>;

  before(function () {
    let binaryPath: string;
    try {
      binaryPath = ensureAggregaBinary();
    } catch (err) {
      // Without the sibling source tree or a Go toolchain there is no compiler
      // to compare against. Skipping is right here: the alternative is a
      // failure that reports on the environment rather than on the marker.
      // eslint-disable-next-line no-console
      console.warn(`Skipping withheld marker conformance: ${(err as Error).message}`);
      this.skip();
      return;
    }

    const fixture = sensitivityFixtureRoot();
    if (!fs.existsSync(path.join(fixture, 'release.yaml'))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping withheld marker conformance: no fixture at ${fixture}`);
      this.skip();
      return;
    }

    const run = spawnSync(
      binaryPath,
      ['inspect', './release.yaml', '--resolved', '--output', 'yaml', '--catalog', './catalog/base'],
      { cwd: fixture, encoding: 'utf8' },
    );
    if (run.status !== 0) {
      throw new Error(`aggrega inspect failed (status=${run.status}): ${run.stderr}`);
    }
    emitted = run.stdout;

    model = loadAttachmentsModel(path.resolve(__dirname, '..', '..', '..')) as unknown as Record<string, unknown>;
  });

  it('emits a marker keyed exactly as this reader recognises', function () {
    const key = model.WITHHELD_MARKER_KEY as string;
    assert.ok(
      typeof key === 'string' && key.length > 0,
      'this extension exposes no marker key to compare against',
    );
    assert.ok(
      emitted.includes(`${key}:`),
      `the compiler emitted no value keyed ${key}. Either it withheld nothing — in which case this ` +
        'fixture stopped declaring sensitivity and the test is no longer measuring anything — or the ' +
        'two sides have drifted onto different keys, and this reader would draw the compiler\'s ' +
        'marker as an ordinary authored object.',
    );
  });

  it('emits only reasons this reader can word', function () {
    const key = model.WITHHELD_MARKER_KEY as string;
    const withheldNote = model.withheldNote as (reason: string) => string;

    // Every line carrying the marker key, read for the reason it carries. The
    // reason is what the panel turns into a sentence, so a reason this reader
    // does not know is a field it would report as absent without saying why.
    const reasons = new Set<string>();
    for (const line of emitted.split('\n')) {
      const match = new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`).exec(line);
      if (match) {
        reasons.add(match[1]);
      }
    }
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
        !emitted.includes(secret),
        `the compiler emitted the declared-sensitive value ${secret} in the clear`,
      );
    }
  });
});
