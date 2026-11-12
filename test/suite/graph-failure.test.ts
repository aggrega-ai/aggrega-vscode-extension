// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { GraphFailure, reportGraphFailure } from '../../src/graph-failure';
import { DaemonErrorRouting, WhoAsked } from '../../src/error-surfaces';
import { ERR_ENTITY_NOT_RESOLVABLE, ERR_LOCKFILE_ABSENT, JsonRpcError } from '../../src/types';

interface Recorder {
  routed: Array<{ err: unknown; fallbackPath: string; whoAsked: WhoAsked }>;
  logged: string[];
  // notified holds the compiler's words the panel was told; told holds the
  // whole of what it was told, the line beside them included.
  notified: string[];
  told: GraphFailure[];
  // order records which sink was written, in the order they were written, so
  // the routing-before-reporting sequence is asserted rather than described.
  order: string[];
}

function recorder(): Recorder {
  return { routed: [], logged: [], notified: [], told: [], order: [] };
}

function sinksOver(rec: Recorder, routing: DaemonErrorRouting = 'surfaced') {
  return {
    reportDaemonError: (err: unknown, fallbackPath: string, whoAsked: WhoAsked): DaemonErrorRouting => {
      rec.routed.push({ err, fallbackPath, whoAsked });
      rec.order.push('routed');
      return routing;
    },
    logLine: (line: string): void => {
      rec.logged.push(line);
      rec.order.push('logged');
    },
    notifyPanel: (failure: GraphFailure): void => {
      rec.notified.push(failure.message);
      rec.told.push(failure);
      rec.order.push('notified');
    },
  };
}

describe('reportGraphFailure', () => {
  it('keeps a daemon refusal\'s message on both surfaces, and no code a reader cannot act on', () => {
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

    reportGraphFailure(envelope, 'environments/dev/release.yaml', 'reader', sinksOver(rec));

    assert.deepStrictEqual(rec.notified, ['aggregate.yaml: component "api" resolves to no catalog entity']);
    assert.deepStrictEqual(rec.logged, [
      'The topology of environments/dev/release.yaml could not be drawn: aggregate.yaml: component "api" resolves to no catalog entity',
    ]);
    // The panel is told the reason, not a re-wording of it, so the two surfaces
    // cannot drift into saying different things about one failure.
    assert.ok(rec.logged[0].endsWith(rec.notified[0]));
  });

  it('hands the panel the channel\'s own line, saying what could not be drawn ahead of the compiler\'s words', () => {
    const rec = recorder();
    const envelope: JsonRpcError = {
      code: ERR_ENTITY_NOT_RESOLVABLE,
      message: '/w/no-such-catalog: catalog load: no such directory',
    };

    reportGraphFailure(envelope, 'release-compose.yaml', 'reader', sinksOver(rec));

    // A panel with nothing drawn shows this line as it stands, so it is asserted
    // whole: the act a reader knows, the Release, then the compiler's words —
    // and no request name or transport code anywhere in it.
    assert.deepStrictEqual(rec.told, [{
      message: '/w/no-such-catalog: catalog load: no such directory',
      line: 'The topology of release-compose.yaml could not be drawn: /w/no-such-catalog: catalog load: no such directory',
    }]);
    // One line on both surfaces, composed once.
    assert.strictEqual(rec.told[0].line, rec.logged[0]);
  });

  it('routes the envelope before it logs or notifies, and does both either way', () => {
    const rec = recorder();
    const envelope: JsonRpcError = { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'no entity' };

    reportGraphFailure(envelope, 'release.yaml', 'reader', sinksOver(rec));

    // Routing first is what puts the fault on the document the envelope names,
    // where the reader can act on it. Recognising the envelope does not consume
    // it: the panel still has to be told the graph is not coming.
    assert.deepStrictEqual(rec.order, ['routed', 'logged', 'notified']);
    assert.deepStrictEqual(rec.routed, [{ err: envelope, fallbackPath: 'release.yaml', whoAsked: 'reader' }]);
  });

  it('reports a value the per-code surfaces do not recognise', () => {
    const rec = recorder();
    const unrecognised: JsonRpcError = { code: -32603, message: 'internal error' };

    reportGraphFailure(unrecognised, 'release.yaml', 'reader', sinksOver(rec, 'unrecognised'));

    // Nothing else surfaces an unrecognised envelope, so the log line and the
    // panel notice are the only places its text appears at all.
    assert.deepStrictEqual(rec.order, ['routed', 'logged', 'notified']);
    assert.strictEqual(rec.notified[0], 'internal error');
  });

  it('reports a thrown Error in its own words', () => {
    const rec = recorder();

    reportGraphFailure(new Error('the language server is not running'), 'release.yaml', 'reader', sinksOver(rec));

    assert.strictEqual(rec.notified[0], 'the language server is not running');
    assert.strictEqual(
      rec.logged[0],
      'The topology of release.yaml could not be drawn: the language server is not running',
    );
  });

  it('reports a value that is neither an envelope nor an Error', () => {
    const rec = recorder();

    reportGraphFailure('redaction could not be performed', 'release.yaml', 'reader', sinksOver(rec));

    assert.strictEqual(rec.notified[0], 'redaction could not be performed');
  });

  it('names the Release the render was for on the channel', () => {
    const rec = recorder();
    const envelope: JsonRpcError = { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'no entity' };

    reportGraphFailure(envelope, 'environments/staging/release.yaml', 'reader', sinksOver(rec));

    // A workspace holds several Releases and the channel outlives the panel, so
    // a line that does not name one cannot be attributed later.
    assert.ok(rec.logged[0].includes('environments/staging/release.yaml'));
  });

  it('passes whether the reader asked for the drawing through to the routing, unread', () => {
    // A drawing the reader asked for and the quiet redraw after a save reach the
    // same routing; only the routing decides whether a notice may be held back,
    // so this side neither reads the value nor alters what it reports.
    const envelope: JsonRpcError = {
      code: ERR_LOCKFILE_ABSENT,
      message: 'lockfile /w/release.lock not found; run `aggrega pull --release release.yaml` to generate',
      data: { lockfile: '/w/release.lock', release: 'release.yaml' },
    };
    const asked = recorder();
    reportGraphFailure(envelope, 'release.yaml', 'reader', sinksOver(asked, 'notified'));
    const quiet = recorder();
    reportGraphFailure(envelope, 'release.yaml', 'nobody', sinksOver(quiet, 'surfaced'));
    assert.deepStrictEqual(asked.routed.map((r) => r.whoAsked), ['reader']);
    assert.deepStrictEqual(quiet.routed.map((r) => r.whoAsked), ['nobody']);
    // The channel and the panel hear the same thing either way.
    assert.deepStrictEqual(asked.logged, quiet.logged);
    assert.deepStrictEqual(asked.told, quiet.told);
  });
});
