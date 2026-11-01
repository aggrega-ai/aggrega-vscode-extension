// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  INDEX_BUILD_SUBJECT,
  IndexedHost,
  RegistryUpdateParams,
  RegistryUpdateResult,
  deprecationLine,
  hostLines,
  indexBuildLines,
  indexBuildOpeningLine,
  indexBuildOutcome,
  indexBuildRequest,
  runIndexBuild,
  skippedLine,
} from '../../src/registry-index-request';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import {
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  readSourceTree,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';

// Exact says whether two key sets are the same set, in both directions. A single
// `extends` answers only one of them, so a shape that gained a member would still
// satisfy it — which is the reading that goes quietly permissive.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// This spec drives the whole index-build decision with no transport, no editor and
// no process: every sentence a reader meets is read back here, and every request
// this side would send is recorded rather than sent.
//
// 🔴 EVERY EXPECTED SENTENCE BELOW IS AN INDEPENDENT LITERAL. Composing an
// expectation from the module's own helpers would put the implementation on both
// sides of the comparison, and such a test proves the two agree while accepting
// any wording at all.

function recorder(answer: RegistryUpdateResult | unknown): {
  deps: {
    updateRegistryIndex(
      params: RegistryUpdateParams,
      signal?: CancellationSignal,
    ): Promise<RegistryUpdateResult>;
  };
  sent: RegistryUpdateParams[];
  signals: Array<CancellationSignal | undefined>;
} {
  const sent: RegistryUpdateParams[] = [];
  const signals: Array<CancellationSignal | undefined> = [];
  return {
    sent,
    signals,
    deps: {
      updateRegistryIndex(
        params: RegistryUpdateParams,
        signal?: CancellationSignal,
      ): Promise<RegistryUpdateResult> {
        sent.push(params);
        signals.push(signal);
        if (
          answer instanceof Error
          || (answer && typeof (answer as { code?: unknown }).code === 'number')
        ) {
          return Promise.reject(answer);
        }
        return Promise.resolve(answer as RegistryUpdateResult);
      },
    },
  };
}

function host(over: Partial<IndexedHost>): IndexedHost {
  return {
    host: 'registry.example.test',
    indexed: 0,
    deprecationsExamined: true,
    deprecationsRecorded: 0,
    skipped: [],
    deprecations: [],
    readsRetried: 0,
    ...over,
  };
}

// A walk over two registries that reached both, as the compiler answers one.
const WALKED: RegistryUpdateResult = {
  hosts: [
    host({ host: 'hub.example.test', indexed: 40, deprecationsRecorded: 1 }),
    host({ host: 'mid.example.test', indexed: 2 }),
  ],
  failed: [],
  indexRoot: '/work/project/.aggrega/index',
  registriesConfigured: true,
  reachedRegistries: true,
};

const REFUSAL_CODE = -32603;
const COMPILER_REFUSAL =
  'aggrega registry update: no registry matches "typo.example.test"; `aggrega registry list` '
  + 'shows the configured hosts and their aliases';

// The compiler's own words for a registry it could not reach and for one it
// reached whose listing repeated itself, as the pinned language server answered an
// index build over both. Literals, for the reason the refusal above is.
const UNREACHED_ERROR = 'search registry: Get "https://registry.invalid/v2/_catalog": dial tcp '
  + '127.0.0.1:443: connect: connection refused';
const REPEATED_LISTING = 'the registry\'s repository listing repeated itself: it named '
  + 'component/stub/compute/listed-again a second time, so the walk stopped rather than follow the '
  + 'listing round again';
const UNREACHED_REFUSAL = `aggrega registry update: registry.invalid: ${UNREACHED_ERROR}`;

// --- what the request carries --------------------------------------------

describe('the index-build request is one operation with one scope field', () => {
  it('sends no field at all for every configured registry', () => {
    // 🔴 AN EQUALITY OVER THE WHOLE OBJECT, NOT A CHECK THAT THE SCOPE IS ABSENT.
    // An absent registry is what the compiler reads as "index every configured
    // one", so a request carrying any other field would change the walk while
    // still satisfying a check that the scope was unset.
    assert.deepStrictEqual(indexBuildRequest(), {});
  });

  it('sends the scope, and only the scope, for one registry', () => {
    assert.deepStrictEqual(indexBuildRequest('mid.example.test'), {
      registry: 'mid.example.test',
    });
  });

  it('passes an alias through verbatim, because the compiler resolves either form', () => {
    assert.deepStrictEqual(indexBuildRequest('staging'), { registry: 'staging' });
  });

  it('trims a padded scope to what the compiler reads', () => {
    assert.deepStrictEqual(indexBuildRequest('  mid.example.test '), {
      registry: 'mid.example.test',
    });
  });

  it('refuses a present-but-blank scope instead of widening it to every registry', () => {
    // 🔴 THE DISTINCTION FROM AN ABSENT SCOPE IS THE WHOLE POINT OF THE GUARD. The
    // two are indistinguishable on the wire once a blank is trimmed away, so a row
    // that named nothing would index every configured registry — a walk over every
    // host, reaching the network for each, from a press meant for one row.
    for (const blank of ['', '   ', '\t']) {
      assert.throws(
        () => indexBuildRequest(blank),
        /takes that registry, and none was named/,
      );
    }
    // The control for that pair of behaviours read together: absent is legal and
    // blank is not, so the guard cannot be a blanket refusal of a missing value.
    assert.deepStrictEqual(indexBuildRequest(undefined), {});
  });

  it('declares no field for the full re-read that ignores the cache', () => {
    // The conditional refresh is what a bare command line does, and it is what
    // omitting the field takes. A declared field is a field a later call site fills.
    //
    // 🔴 THE DECLARATION IS HELD STRUCTURALLY RATHER THAN BY READING THE SOURCE.
    // The request shape is a projection of the published one naming the members
    // this surface sends, so the exactness below is a statement the compiler
    // checks: naming a second member widens the key set, `Exact` yields false, and
    // the assignment stops compiling. A reading of the source text could not see
    // that — and it would need a vacuity guard of its own, because a pattern over
    // prose goes quietly blind, which is the failure mode this structure removes
    // rather than merely detects.
    const keySetIsExactlyTheScope: Exact<keyof RegistryUpdateParams, 'registry'> = true;
    assert.ok(keySetIsExactlyTheScope);
    // And what actually leaves, at both scopes, carries that one key and no other.
    assert.deepStrictEqual(Object.keys(indexBuildRequest()), []);
    assert.deepStrictEqual(Object.keys(indexBuildRequest('h.example.test')), ['registry']);
  });

  it('sends the scope it was given and hands the signal through, at both scopes', async () => {
    const signal = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() {} }),
    };
    const all = recorder(WALKED);
    await runIndexBuild(all.deps, undefined, signal as never);
    assert.deepStrictEqual(all.sent, [{}]);
    assert.deepStrictEqual(all.signals, [signal as never]);

    const one = recorder(WALKED);
    await runIndexBuild(one.deps, 'mid.example.test', signal as never);
    assert.deepStrictEqual(one.sent, [{ registry: 'mid.example.test' }]);
    assert.deepStrictEqual(one.signals, [signal as never]);
  });
});

// --- what the reader reads on the channel --------------------------------

describe('what one index build puts on the channel', () => {
  it('names the scope on the opening line, which the answer does not carry back', () => {
    // An answer over one registry and an answer over a single configured registry
    // are indistinguishable, so the scope the reader pressed is stated here.
    assert.strictEqual(
      indexBuildOpeningLine(),
      '\nIndex build for every configured registry.',
    );
    assert.strictEqual(
      indexBuildOpeningLine('mid.example.test'),
      '\nIndex build for mid.example.test.',
    );
  });

  it('renders an unreadable repository with the compiler reason untouched', () => {
    assert.strictEqual(
      skippedLine({ repo: 'component/core/legacy', reason: 'no conforming version' }),
      '    skipped component/core/legacy: no conforming version',
    );
  });

  it('distinguishes a recorded marker from one that was not recorded, and why', () => {
    // 🔴 THE REASON IS WHAT SEPARATES TWO DIFFERENT SITUATIONS A READER ACTS ON
    // DIFFERENTLY: a marker that could not be read at all, and one whose signature
    // was not honoured. Reporting only that it was not recorded collapses them.
    assert.strictEqual(
      deprecationLine({
        repo: 'component/core/database', version: '1.0.0', recorded: true, severity: 'retracted',
      }),
      '    deprecation component/core/database:1.0.0: recorded as retracted',
    );
    assert.strictEqual(
      deprecationLine({
        repo: 'component/core/database',
        version: '1.0.0',
        recorded: false,
        reason: 'marker signature does not match the artifact signer',
      }),
      '    deprecation component/core/database:1.0.0: present, not recorded — marker signature '
      + 'does not match the artifact signer',
    );
  });

  it('says a registry markers were not examined rather than showing a zero', () => {
    // 🔴 "THIS REGISTRY PUBLISHED NO HONOURED MARKER" AND "THIS RUN HAD NO TRUST
    // BASIS TO JUDGE ONE" ARE DIFFERENT FACTS, and a reader shown only a zero
    // cannot tell them apart. Both lines are asserted, so neither can collapse into
    // the other.
    assert.deepStrictEqual(
      hostLines(host({ host: 'mid.example.test', indexed: 5, deprecationsExamined: false })),
      [
        '  mid.example.test: 5 entities, 0 reads retried',
        '    deprecation markers not examined: signature verification is disabled for this'
        + ' registry',
      ],
    );
    assert.deepStrictEqual(
      hostLines(host({ host: 'mid.example.test', indexed: 5 })),
      [
        '  mid.example.test: 5 entities, 0 reads retried',
        '    0 deprecation markers recorded',
      ],
    );
  });

  it('reports a failed host with the compiler error and no count beside it', () => {
    // A count of zero beside a failure would read as a registry that held nothing.
    assert.deepStrictEqual(
      hostLines(host({ host: 'bad.example.test', error: 'dial tcp: connection refused' })),
      ['  bad.example.test: dial tcp: connection refused'],
    );
  });

  it('names a host the answer says could not be reached as not reached, ahead of the compiler error', () => {
    // 🔴 THE FIELD DECIDES, NEVER THE WORDS. The two rows carry the same error; only
    // the one the answer marks unreachable is named as not reached, so a reading
    // that searched the error for a refused connection would fail the second row.
    assert.deepStrictEqual(
      hostLines(host({ host: 'registry.invalid', error: UNREACHED_ERROR, unreachable: true })),
      [`  registry.invalid could not be reached: ${UNREACHED_ERROR}`],
    );
    assert.deepStrictEqual(
      hostLines(host({ host: 'registry.invalid', error: UNREACHED_ERROR })),
      [`  registry.invalid: ${UNREACHED_ERROR}`],
    );
    // And a registry that answered, whatever it answered, keeps the compiler's
    // words alone.
    assert.deepStrictEqual(
      hostLines(host({ host: '127.0.0.1:39875', error: REPEATED_LISTING })),
      [`  127.0.0.1:39875: ${REPEATED_LISTING}`],
    );
  });

  it('lists every registry walk, then where the index was written', () => {
    // 🔴 A WHOLE-LIST EQUALITY, NOT A MEMBERSHIP TEST. The order and the presence
    // of the destination are both the claim, and a membership test passes on any
    // order and on a list missing the destination entirely.
    assert.deepStrictEqual(indexBuildLines(WALKED), [
      '  hub.example.test: 40 entities, 0 reads retried',
      '    1 deprecation marker recorded',
      '  mid.example.test: 2 entities, 0 reads retried',
      '    0 deprecation markers recorded',
      '  index written to /work/project/.aggrega/index',
    ]);
  });

  it('names the destination only when a registry was actually indexed', () => {
    // The index directory is resolved once there is a registry to walk, so naming
    // it after a walk that indexed nothing would name a directory nothing reached.
    assert.deepStrictEqual(
      indexBuildLines({
        ...WALKED,
        hosts: [host({ host: 'bad.example.test', error: 'dial tcp: connection refused' })],
        failed: ['bad.example.test'],
      }),
      ['  bad.example.test: dial tcp: connection refused'],
    );
  });

  it('says a workspace has no configured registry rather than showing an empty list', () => {
    assert.deepStrictEqual(
      indexBuildLines({
        hosts: [],
        failed: [],
        indexRoot: '',
        registriesConfigured: false,
        reachedRegistries: true,
      }),
      ['  no registries are configured'],
    );
  });

  it('carries each unreadable repository and each marker under its own registry', () => {
    assert.deepStrictEqual(
      hostLines(host({
        host: 'hub.example.test',
        indexed: 7,
        deprecationsRecorded: 1,
        skipped: [
          { repo: 'component/core/legacy', reason: 'no conforming version' },
          { repo: 'plugin/core/old', reason: 'manifest could not be read' },
        ],
        deprecations: [
          { repo: 'component/core/db', version: '1.0.0', recorded: true, severity: 'warning' },
        ],
      })),
      [
        '  hub.example.test: 7 entities, 2 repositories could not be read, 0 reads retried',
        '    1 deprecation marker recorded',
        '    skipped component/core/legacy: no conforming version',
        '    skipped plugin/core/old: manifest could not be read',
        '    deprecation component/core/db:1.0.0: recorded as warning',
      ],
    );
  });

  it('states the reads the walk asked again on the registry row, beside the unreadable count', () => {
    // 🔴 A WALK WHOSE RETRIES ALL SUCCEEDED LISTS NO REPOSITORY, so the count is the
    // only sign of how close it came to leaving one out — and it is stated at zero
    // too, so a row saying nothing is never read as none. The singular is its own
    // row, since one read is the count a single passing failure produces.
    assert.deepStrictEqual(
      hostLines(host({ host: 'hub.example.test', indexed: 40, readsRetried: 3 }))[0],
      '  hub.example.test: 40 entities, 3 reads retried',
    );
    assert.deepStrictEqual(
      hostLines(host({ host: 'hub.example.test', indexed: 40, readsRetried: 1 }))[0],
      '  hub.example.test: 40 entities, 1 read retried',
    );
    assert.deepStrictEqual(
      hostLines(host({
        host: 'hub.example.test',
        indexed: 39,
        readsRetried: 4,
        skipped: [{ repo: 'component/core/web', reason: 'the registry answered 503 Service Unavailable: …' }],
      }))[0],
      '  hub.example.test: 39 entities, 1 repository could not be read, 4 reads retried',
    );
  });
});

// --- how it ends ---------------------------------------------------------

describe('the sentence an index build ends in', () => {
  it('totals what was indexed and names the directory it landed in', () => {
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome(WALKED)),
      'The index build indexed 42 entities from 2 registries, into '
      + '/work/project/.aggrega/index.',
    );
  });

  it('reads the counts in the singular where there is one of each', () => {
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome({
        ...WALKED,
        hosts: [host({ host: 'mid.example.test', indexed: 1 })],
      })),
      'The index build indexed 1 entity from 1 registry, into /work/project/.aggrega/index.',
    );
  });

  it('reports a workspace with no configured registry as a result, not in silence', () => {
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome({
        hosts: [],
        failed: [],
        indexRoot: '',
        registriesConfigured: false,
        reachedRegistries: true,
      })),
      'The index build found no configured registries, so there was nothing to index.',
    );
  });

  it('reports a partial walk as an operation that did not complete', () => {
    // 🔴 THIS IS WHAT THE COMMAND LINE REPORTS FOR THE SAME WALK, as a non-zero
    // exit, because a shell has no other channel. The request ANSWERS instead,
    // carrying the hosts that failed — so the decision of what a reader is
    // told moves here, and reporting it as done would tell them their index is
    // current when part of it is not.
    const outcome = indexBuildOutcome({
      ...WALKED,
      hosts: [
        host({ host: 'hub.example.test', indexed: 40, deprecationsRecorded: 1 }),
        host({ host: 'bad.example.test', error: 'dial tcp: connection refused' }),
      ],
      failed: ['bad.example.test'],
    });
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, outcome),
      'The index build did not complete: 1 registry could not be indexed '
      + '(bad.example.test); 40 entities were indexed from 1 registry.',
    );
  });

  it('agrees the verb with a single indexed entity', () => {
    const outcome = indexBuildOutcome({
      ...WALKED,
      hosts: [
        host({ host: 'one.example.test', indexed: 1 }),
        host({ host: 'bad.example.test', error: 'unauthorized' }),
      ],
      failed: ['bad.example.test'],
    });
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, outcome),
      'The index build did not complete: 1 registry could not be indexed '
      + '(bad.example.test); 1 entity was indexed from 1 registry.',
    );
  });

  it('says nothing was indexed when no registry was reached at all', () => {
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome({
        ...WALKED,
        hosts: [
          host({ host: 'a.example.test', error: 'dial tcp: connection refused' }),
          host({ host: 'b.example.test', error: 'unauthorized' }),
        ],
        failed: ['a.example.test', 'b.example.test'],
      })),
      'The index build did not complete: 2 registries could not be indexed '
      + '(a.example.test, b.example.test); nothing was indexed.',
    );
  });

  it('names a registry not reached apart from one that could not be indexed, in one sentence', () => {
    // The answer of an index build over the scratch registry, a registry that could
    // not be reached, one whose listing repeated itself and a well-behaved one, in
    // the order the answer lists them.
    const outcome = indexBuildOutcome({
      ...WALKED,
      hosts: [
        host({ host: '127.0.0.1:45609', indexed: 1 }),
        host({ host: 'registry.invalid', error: UNREACHED_ERROR, unreachable: true }),
        host({ host: '127.0.0.1:39875', error: REPEATED_LISTING }),
        host({ host: '127.0.0.1:45483', indexed: 1 }),
      ],
      failed: ['registry.invalid', '127.0.0.1:39875'],
    });
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, outcome),
      'The index build did not complete: 1 registry could not be reached (registry.invalid) and 1 '
      + 'could not be indexed (127.0.0.1:39875); 2 entities were indexed from 2 registries.',
    );
  });

  it('names only the registries not reached where no other failed, and counts each group', () => {
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome({
        ...WALKED,
        hosts: [
          host({ host: 'a.example.test', error: 'dial tcp: lookup a.example.test: no such host', unreachable: true }),
          host({ host: 'b.example.test', error: 'dial tcp: connect: connection refused', unreachable: true }),
        ],
        failed: ['a.example.test', 'b.example.test'],
      })),
      'The index build did not complete: 2 registries could not be reached (a.example.test, '
      + 'b.example.test); nothing was indexed.',
    );
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, indexBuildOutcome({
        ...WALKED,
        hosts: [
          host({ host: 'a.example.test', error: 'dial tcp: connect: connection refused', unreachable: true }),
          host({ host: 'b.example.test', error: 'unauthorized' }),
          host({ host: 'c.example.test', error: REPEATED_LISTING }),
          host({ host: 'hub.example.test', indexed: 40 }),
        ],
        failed: ['a.example.test', 'b.example.test', 'c.example.test'],
      })),
      'The index build did not complete: 1 registry could not be reached (a.example.test) and 2 '
      + 'could not be indexed (b.example.test, c.example.test); 40 entities were indexed from 1 '
      + 'registry.',
    );
  });

  it('excludes a failed host from the entity total rather than adding its count', () => {
    // A failed host indexed nothing, so a total that read its count would report
    // entities from a registry the walk never finished reading.
    const outcome = indexBuildOutcome({
      ...WALKED,
      hosts: [
        host({ host: 'hub.example.test', indexed: 40 }),
        host({ host: 'bad.example.test', indexed: 999, error: 'unauthorized' }),
      ],
      failed: ['bad.example.test'],
    });
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      outcome.message,
      '1 registry could not be indexed (bad.example.test); 40 entities were indexed from '
      + '1 registry.',
    );
  });
});

// --- a refusal, and a reader who stopped it ------------------------------

describe('a refusal reaches the reader in the compiler own words', () => {
  it('carries the refusal text unaltered, with nothing on the channel', async () => {
    // 🔴 THE COMPILER'S SENTENCE IS THE WHOLE LINE. The extension's one home for
    // rendering a thrown value adds nothing to the message, the transport's code
    // included, and changes not one character of it, so the assertion is the whole
    // rendered line — the only shape that tells a message carried whole from a
    // re-wording.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runIndexBuild(r.deps, 'typo.example.test');
    assert.deepStrictEqual(report.lines, []);
    assert.deepStrictEqual(report.outcome, {
      kind: 'failed',
      message: COMPILER_REFUSAL,
    });
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, report.outcome),
      `The index build did not complete: ${COMPILER_REFUSAL}`,
    );
    const rendered = (report.outcome as { message: string }).message;
    assert.strictEqual(rendered.slice(-COMPILER_REFUSAL.length), COMPILER_REFUSAL);
  });

  it('names the registry the request named as not reached where the refusal\'s data says so', async () => {
    // 🔴 THE DATA DECIDES, NEVER THE WORDS, and the registry named is the one the
    // request carried, trimmed as it was sent. The compiler's text follows whole.
    const r = recorder({ code: REFUSAL_CODE, message: UNREACHED_REFUSAL, data: { unreachable: true } });
    const report = await runIndexBuild(r.deps, '  registry.invalid ');
    assert.deepStrictEqual(r.sent, [{ registry: 'registry.invalid' }]);
    assert.deepStrictEqual(report.lines, []);
    assert.strictEqual(
      terminalLine(INDEX_BUILD_SUBJECT, report.outcome),
      `The index build did not complete: registry.invalid could not be reached: ${UNREACHED_REFUSAL}`,
    );
  });

  it('carries a refusal whose data does not say so in the compiler words alone, whatever they say', async () => {
    // The same refused connection in the words, with no data, or with data that
    // does not say the registry was not reached, reads as any other refusal.
    for (const data of [undefined, null, { release: 'release.yaml' }, { unreachable: false }]) {
      const r = recorder({ code: REFUSAL_CODE, message: UNREACHED_REFUSAL, data });
      const report = await runIndexBuild(r.deps, 'registry.invalid');
      assert.deepStrictEqual(report.outcome, { kind: 'failed', message: UNREACHED_REFUSAL }, JSON.stringify(data));
    }
    // A failure that is not a language-server refusal is never read as one.
    const thrown = Object.assign(new Error(UNREACHED_REFUSAL), { data: { unreachable: true } });
    const report = await runIndexBuild(recorder(thrown).deps, 'registry.invalid');
    assert.deepStrictEqual(report.outcome, { kind: 'failed', message: UNREACHED_REFUSAL });
  });

  it('reports a reader who stopped it as stopped, never as broken', async () => {
    const r = recorder(new OperationCancelled('The index build'));
    const report = await runIndexBuild(r.deps);
    assert.deepStrictEqual(report.outcome, { kind: 'cancelled' });
  });

  it('reports a scope this surface refused through the same ending', async () => {
    // The blank guard is inside the attempt, so a row that named nothing is
    // reported exactly as a token the compiler refuses — and, decisively, nothing
    // is sent, so no walk over every registry is started by a press meant for one.
    const r = recorder(WALKED);
    const report = await runIndexBuild(r.deps, '  ');
    assert.strictEqual(report.outcome.kind, 'failed');
    assert.deepStrictEqual(r.sent, [], 'a blank scope was sent, which indexes every registry');
  });
});

// --- one execution path --------------------------------------------------

describe('the index build reaches the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    assertCensusInstrumentFires((value, message) => assert.ok(value, message));
  });

  it('gives the module that decides an index build no way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/registry-index-request.ts'), 0);
  });

  it('gives that module no way to reach a process or an editor at all', () => {
    // The value list is what the claim is about; the wire shapes arrive as
    // declarations alone and are asserted separately, so a later change from one
    // kind to the other cannot pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/registry-index-request.ts'),
      ['./cancellation', './not-reached', './operation-outcome'],
    );
    // The module it reaches for the reading and the wording of a registry not
    // reached is on the same side of the claim, so it is measured too.
    assert.deepStrictEqual(valueImports('src/not-reached.ts'), ['./error-text']);
    assert.deepStrictEqual(valueImports('src/error-text.ts'), []);
    assert.strictEqual(launchFacilityCount('src/not-reached.ts'), 0);
    assert.deepStrictEqual(
      typeOnlyImports('src/registry-index-request.ts'),
      [WIRE_CONTRACT],
    );
  });

  it('sends the index build from exactly one place', () => {
    const senders = readSourceTree()
      .filter(([, source]) => /'aggrega\/registryUpdate'/.test(source))
      .map(([file]) => file);
    assert.deepStrictEqual(
      senders,
      ['extension.ts'],
      `aggrega/registryUpdate is sent from ${senders.length} place(s)`,
    );
  });

  it('leaves the retired composers named nowhere in the source tree', () => {
    // A tree-wide COUNT rather than a check of the one module that declared them:
    // a call left behind elsewhere would not compile, but a name surviving in a
    // comment would read as though the composition were still the path.
    for (const retired of ['registryUpdateAllArgs', 'registryUpdateOneArgs']) {
      const holders = readSourceTree()
        .filter(([, source]) => new RegExp(`\\b${retired}\\b`).test(source))
        .map(([file]) => file);
      assert.deepStrictEqual(holders, [], `${retired} is still named in the source tree`);
    }
    // The control: the same pattern shape finds a composer that provably remains,
    // so the two absences above are absences rather than a pattern gone blind.
    const holders = readSourceTree()
      .filter(([, source]) => /\breleaseScopedArgs\b/.test(source))
      .map(([file]) => file);
    assert.deepStrictEqual(
      holders,
      ['operation-groups.ts', 'operations.ts'],
      'the name pattern no longer finds a composer that provably exists, so the absences above '
      + 'would pass vacuously',
    );
  });
});
