// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { reportGraphFailure } from '../../src/graph-failure';
import { ERR_ENTITY_NOT_RESOLVABLE, JsonRpcError } from '../../src/types';

interface Recorder {
  routed: Array<{ err: unknown; fallbackPath: string }>;
  logged: string[];
  notified: string[];
  // order records which sink was written, in the order they were written, so
  // the routing-before-reporting sequence is asserted rather than described.
  order: string[];
}

function recorder(): Recorder {
  return { routed: [], logged: [], notified: [], order: [] };
}

function sinksOver(rec: Recorder, recognised = true) {
  return {
    reportDaemonError: (err: unknown, fallbackPath: string): boolean => {
      rec.routed.push({ err, fallbackPath });
      rec.order.push('routed');
      return recognised;
    },
    logLine: (line: string): void => {
      rec.logged.push(line);
      rec.order.push('logged');
    },
    notifyPanel: (message: string): void => {
      rec.notified.push(message);
      rec.order.push('notified');
    },
  };
}

describe('reportGraphFailure', () => {
  it('keeps a daemon refusal\'s code and message on both surfaces', () => {
    const rec = recorder();
    // A refusal arriving over the language-server transport is a plain object
    // carrying a numeric code. It is not an Error, so a conversion that only
    // knows about Error renders it as an object with no text — and the sentence
    // the compiler wrote, which names what the reader has to change, is the
    // thing that would be lost.
    const envelope: JsonRpcError = {
      code: ERR_ENTITY_NOT_RESOLVABLE,
      message: 'aggregate.yaml: component "api" resolves to no catalog entity',
    };

    reportGraphFailure(envelope, 'environments/dev/release.yaml', sinksOver(rec));

    assert.strictEqual(rec.logged.length, 1);
    assert.strictEqual(rec.notified.length, 1);
    for (const surfaced of [rec.logged[0], rec.notified[0]]) {
      assert.ok(
        surfaced.includes(`code=${ERR_ENTITY_NOT_RESOLVABLE}`),
        `the refusal reached the reader without its code: ${surfaced}`,
      );
      assert.ok(
        surfaced.includes('component "api" resolves to no catalog entity'),
        `the refusal reached the reader without its message: ${surfaced}`,
      );
      assert.ok(
        !surfaced.includes('[object Object]'),
        `the refusal reached the reader as an unreadable object: ${surfaced}`,
      );
    }
    // The panel is told the reason, not a re-wording of it, so the two surfaces
    // cannot drift into saying different things about one failure.
    assert.ok(rec.logged[0].endsWith(rec.notified[0]));
  });

  it('routes the envelope before it logs or notifies, and does both either way', () => {
    const rec = recorder();
    const envelope: JsonRpcError = { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'no entity' };

    reportGraphFailure(envelope, 'release.yaml', sinksOver(rec));

    // Routing first is what puts the fault on the document the envelope names,
    // where the reader can act on it. Recognising the envelope does not consume
    // it: the panel still has to be told the graph is not coming.
    assert.deepStrictEqual(rec.order, ['routed', 'logged', 'notified']);
    assert.deepStrictEqual(rec.routed, [{ err: envelope, fallbackPath: 'release.yaml' }]);
  });

  it('reports a value the per-code surfaces do not recognise', () => {
    const rec = recorder();
    const unrecognised: JsonRpcError = { code: -32603, message: 'internal error' };

    reportGraphFailure(unrecognised, 'release.yaml', sinksOver(rec, false));

    // Nothing else surfaces an unrecognised envelope, so the log line and the
    // panel notice are the only places its text appears at all.
    assert.deepStrictEqual(rec.order, ['routed', 'logged', 'notified']);
    assert.strictEqual(rec.notified[0], 'code=-32603 internal error');
  });

  it('reports a thrown Error in its own words', () => {
    const rec = recorder();

    reportGraphFailure(new Error('the language server is not running'), 'release.yaml', sinksOver(rec));

    assert.strictEqual(rec.notified[0], 'the language server is not running');
    assert.strictEqual(
      rec.logged[0],
      'irGraph failed for release.yaml: the language server is not running',
    );
  });

  it('reports a value that is neither an envelope nor an Error', () => {
    const rec = recorder();

    reportGraphFailure('redaction could not be performed', 'release.yaml', sinksOver(rec));

    assert.strictEqual(rec.notified[0], 'redaction could not be performed');
  });

  it('names the Release the render was for on the channel', () => {
    const rec = recorder();
    const envelope: JsonRpcError = { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'no entity' };

    reportGraphFailure(envelope, 'environments/staging/release.yaml', sinksOver(rec));

    // A workspace holds several Releases and the channel outlives the panel, so
    // a line that does not name one cannot be attributed later.
    assert.ok(rec.logged[0].includes('environments/staging/release.yaml'));
  });
});
