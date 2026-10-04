// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { OperationCancelled } from '../../src/cancellation';
import {
  SHOW_OUTPUT_ACTION,
  countReport,
  outcomeOf,
  terminalLine,
} from '../../src/operation-outcome';

describe('every command ends in a sentence', () => {
  it('says what a completed operation did', () => {
    assert.strictEqual(
      terminalLine('The publication', { kind: 'ok', detail: 'published api-server.' }),
      'The publication published api-server.',
    );
  });

  it('says a stopped operation was stopped, and never that it failed', () => {
    const line = terminalLine('The build', { kind: 'cancelled' });
    assert.strictEqual(line, 'The build stopped at your request.');
    assert.doesNotMatch(line, /fail|error|abort|problem/i);
  });

  it('carries a failure message through verbatim', () => {
    // The compiler's own text usually names what to run or what to fix. This
    // asserts it arrives unaltered — a re-wording would discard exactly that.
    const compilerText = 'lockfile absent for release.yaml; run `aggrega pull --release release.yaml`';
    const line = terminalLine('The build', { kind: 'failed', message: compilerText });
    assert.ok(
      line.includes(compilerText),
      'the compiler’s message must appear unchanged inside the line',
    );
  });

  it('offers the remedy as an action rather than as a replacement', () => {
    // The action exists so the reader can reach the compiler's whole output.
    // Its label must not be a re-statement of the failure.
    assert.strictEqual(SHOW_OUTPUT_ACTION, 'Show output');
  });
});

describe('a thrown value is classified by type, not by wording', () => {
  it('reads a stopped operation as stopped', () => {
    assert.deepStrictEqual(outcomeOf(new OperationCancelled('The build')), { kind: 'cancelled' });
  });

  it('reads anything else as a failure carrying its own message', () => {
    assert.deepStrictEqual(outcomeOf(new Error('boom')), { kind: 'failed', message: 'boom' });
  });

  it('does not mistake a failure that merely mentions stopping', () => {
    // A message comparison would classify this as a cancellation and report a
    // real failure as something the reader chose.
    const err = new Error('the server stopped at your request handler');
    assert.strictEqual(outcomeOf(err).kind, 'failed');
  });

  it('reads a thrown non-error', () => {
    assert.deepStrictEqual(outcomeOf('plain string'), { kind: 'failed', message: 'plain string' });
  });

  it('carries a language-server refusal\'s own diagnostic, which is not an error object', () => {
    // 🔴 THE SHAPE THIS EXISTS FOR. A refused request rejects with the raw
    // JSON-RPC error member — a plain object with a numeric code — so a reading
    // that asks whether the thrown value is an error sees no message and falls
    // back to stringifying it, which yields "[object Object]" and loses the
    // compiler's whole diagnostic. That is not a re-wording, it is total loss,
    // and it is worse than the wrapper sentence the extension refuses to write.
    //
    // The expectation is an equality against a literal written here, not a
    // reading built from the extension's own rendering: a comparison whose two
    // sides both came from the implementation moves both at once and accepts
    // anything.
    const compilerText = 'config init: /home/reader/.config/aggrega/config.yaml already exists '
      + 'and was left untouched; send force to write it anyway';
    const outcome = outcomeOf({ code: -32602, message: compilerText });
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: compilerText,
    });
  });
});

describe('a finding count is reported, including when it is zero', () => {
  it('says so when nothing was found', () => {
    // The case the whole rule exists for: a clean run leaves the Problems panel
    // exactly as it was, so without this sentence it is indistinguishable from
    // a command that never ran.
    assert.strictEqual(
      countReport('Aggrega: validated api.yaml', 0, 'Problems panel'),
      'Aggrega: validated api.yaml: no problems found.',
    );
  });

  it('reads as one problem rather than 1 problems', () => {
    assert.strictEqual(
      countReport('Aggrega: validated api.yaml', 1, 'Problems panel'),
      'Aggrega: validated api.yaml: 1 problem — see the Problems panel.',
    );
  });

  it('names the count and where to read the findings', () => {
    assert.strictEqual(
      countReport('Aggrega: validated api.yaml', 4, 'Problems panel'),
      'Aggrega: validated api.yaml: 4 problems — see the Problems panel.',
    );
  });

  it('never returns an empty report for any count', () => {
    for (const n of [0, 1, 2, 17, 1000]) {
      assert.ok(countReport('X', n, 'Problems panel').trim().length > 0);
    }
  });
});
