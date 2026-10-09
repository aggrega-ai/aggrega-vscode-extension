// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DeprecateArtifactResult,
  PublishEntityResult,
  SignArtifactsResult,
  deprecateArtifactRequest,
  publicationLines,
  publicationOutcome,
  publishEntityRequest,
  runDeprecateArtifact,
  runPublishEntity,
  runSignArtifacts,
  signArtifactsRequest,
  signatureLines,
  signatureOutcome,
  withdrawalLines,
  withdrawalOutcome,
} from '../../src/publication-request';
import {
  EXTENSION_ROOT,
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';

// A publication answer as the compiler sends one, with every field present so a
// test overrides only the one it is about.
function published(over: Partial<PublishEntityResult> = {}): PublishEntityResult {
  return {
    reference: 'registry.example.com/component/api-server',
    tag: '1.2.0',
    kind: 'Component',
    mediaType: 'application/vnd.aggrega.component.v1+yaml',
    size: 2048,
    sizeText: '2.0 KiB',
    digest: 'sha256:abc123',
    signed: false,
    alreadyPublished: false,
    dryRun: false,
    reach: { registry: 'registry.example.com', beyondThisMachine: true },
    ...over,
  };
}

function signedBatch(over: Partial<SignArtifactsResult> = {}): SignArtifactsResult {
  return {
    signed: [{ reference: 'registry.example.com/component/api-server:1.2.0', digest: 'sha256:abc123' }],
    reach: { registry: 'registry.example.com', beyondThisMachine: true },
    ...over,
  };
}

function withdrawn(over: Partial<DeprecateArtifactResult> = {}): DeprecateArtifactResult {
  return {
    marked: [{
      reference: 'registry.example.com/component/api-server:1.2.0',
      severity: 'retracted',
      issuedOn: '2026-09-11T10:00:00Z',
      digest: 'sha256:marker99',
    }],
    reach: { registry: 'registry.example.com', beyondThisMachine: true },
    ...over,
  };
}

describe('what each publication request carries', () => {
  it('publishes a named entity by its workspace-relative path and nothing else', () => {
    // An EQUALITY rather than a containment: a request that grew a field would
    // pass any "carries the entity" reading while sending something nobody here
    // decided to send.
    assert.deepStrictEqual(
      publishEntityRequest('catalog/components/api-server.yaml'),
      { entity: 'catalog/components/api-server.yaml' },
    );
  });

  it('signs a named reference, as the list the batch operation takes', () => {
    assert.deepStrictEqual(
      signArtifactsRequest('registry.example.com/component/api-server:1.2.0'),
      { references: ['registry.example.com/component/api-server:1.2.0'] },
    );
  });

  it('carries the withdrawal severity and reason, because nothing here can ask for them', () => {
    assert.deepStrictEqual(
      deprecateArtifactRequest(
        'registry.example.com/component/api-server:1.2.0', 'retracted', 'superseded by 2.x',
      ),
      {
        reference: 'registry.example.com/component/api-server:1.2.0',
        severity: 'retracted',
        reason: 'superseded by 2.x',
      },
    );
  });

  it('sends no credential of its own, on any of the three', () => {
    // 🔴 THE CONTRACT IS THAT THIS SURFACE NAMES NO SIGNING KEY AND NO TOKEN. The
    // compiler resolves identity from what the request carries or what the
    // environment already holds, and refuses in its own words naming what to
    // supply. A field appearing here would be this surface deciding a credential
    // question that is not its own, so the assertion is over the WHOLE key set
    // rather than over any one name.
    const keys = [
      ...Object.keys(publishEntityRequest('catalog/x.yaml')),
      ...Object.keys(signArtifactsRequest('registry/x:1')),
      ...Object.keys(deprecateArtifactRequest('registry/x:1', 'warning', 'why')),
    ].sort();
    assert.deepStrictEqual(
      keys,
      ['entity', 'reason', 'reference', 'references', 'severity'],
      'a publication request carries a subject and the withdrawal content, and nothing else',
    );
  });
});

describe('a publication request with nothing to act on is refused before it is sent', () => {
  const bare: Array<[string, () => unknown]> = [
    ['a publication with no entity', () => publishEntityRequest('')],
    ['a publication with a whitespace entity', () => publishEntityRequest('   ')],
    ['a signature with no reference', () => signArtifactsRequest('')],
    ['a withdrawal with no reference', () => deprecateArtifactRequest('', 'warning', 'why')],
  ];

  for (const [what, compose] of bare) {
    it(`refuses ${what}`, () => {
      assert.throws(compose, /takes|requires|and none was given/);
    });
  }

  it('refuses a withdrawal missing the severity the compiler requires', () => {
    assert.throws(() => deprecateArtifactRequest('registry/x:1', '', 'why'), /severity/);
  });

  it('refuses a withdrawal missing the reason the compiler requires', () => {
    assert.throws(() => deprecateArtifactRequest('registry/x:1', 'warning', '  '), /reason/);
  });
});

describe('what a reader is told, composed from the answer rather than from the request', () => {
  it('names what the tag now points at, and how far it reached', () => {
    const outcome = publicationOutcome(published());
    assert.strictEqual(outcome.kind, 'ok');
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'published registry.example.com/component/api-server:1.2.0 as sha256:abc123.'
      + ' Anyone resolving from registry.example.com now sees it.',
    );
  });

  it('says a dry run published nothing, which an exit status could not distinguish', () => {
    // 🔴 THE THREE ENDINGS A ZERO EXIT CANNOT TELL APART. A publication, a
    // re-publication of identical bytes and a dry run all succeed, so
    // the surface this replaced could report only that something had happened.
    const outcome = publicationOutcome(published({
      dryRun: true, reach: { registry: 'registry.example.com', beyondThisMachine: false },
    }));
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'reported registry.example.com/component/api-server:1.2.0 without publishing it.'
      + ' Nothing left this machine.',
    );
  });

  it('says an already-published tag uploaded no content', () => {
    const outcome = publicationOutcome(published({
      alreadyPublished: true,
      reach: { registry: 'registry.example.com', beyondThisMachine: false },
    }));
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'found registry.example.com/component/api-server:1.2.0 already published as sha256:abc123,'
      + ' uploaded no content. Nothing left this machine.',
    );
  });

  it('says an already-published tag was given the signature it lacked, where the answer says one was attached', () => {
    // The answer carries whether a signature was attached and not whether a
    // publication date was, so the sentence names the signature and nothing else.
    const outcome = publicationOutcome(published({ alreadyPublished: true, signed: true }));
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'found registry.example.com/component/api-server:1.2.0 already published as sha256:abc123,'
      + ' uploaded no content and attached a signature.'
      + ' Anyone resolving from registry.example.com now sees it.',
    );
  });

  it('names the signature only where the compiler attached one', () => {
    const withSignature = publicationOutcome(published({ signed: true }));
    assert.ok(
      (withSignature.kind === 'ok' ? withSignature.detail : '').includes(', signed.'),
    );
    const without = publicationOutcome(published({ signed: false }));
    assert.strictEqual(
      (without.kind === 'ok' ? without.detail : '').includes('signed'),
      false,
    );
  });

  it('names the digest a signature commits to, not merely the reference', () => {
    const outcome = signatureOutcome(signedBatch());
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'attached a signature to registry.example.com/component/api-server:1.2.0,'
      + ' committing to sha256:abc123.'
      + ' Anyone resolving from registry.example.com now sees it.',
    );
  });

  it('reports a batch that signed nothing as a result rather than as silence', () => {
    const outcome = signatureOutcome(signedBatch({
      signed: [], reach: { registry: 'registry.example.com', beyondThisMachine: false },
    }));
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'signed nothing. Nothing left this machine.',
    );
  });

  it('reads the withdrawal severity off the marker the compiler attached', () => {
    // The request asked for one severity and the answer reports another. They
    // agree in practice, and that is exactly why the test drives them apart: an
    // ending composed from the REQUEST would report what was asked for as though
    // it were what happened.
    const outcome = withdrawalOutcome(withdrawn({
      marked: [{
        reference: 'registry.example.com/component/api-server:1.2.0',
        severity: 'warning',
        issuedOn: '2026-09-11T10:00:00Z',
        digest: 'sha256:marker99',
      }],
    }));
    assert.strictEqual(
      outcome.kind === 'ok' ? outcome.detail : '',
      'marked registry.example.com/component/api-server:1.2.0 deprecated at warning,'
      + ' as sha256:marker99.'
      + ' Anyone resolving from registry.example.com now sees it.',
    );
  });
});

describe('the lines the channel gets', () => {
  it('renders the publication facts the command line prints, from the answer', () => {
    assert.deepStrictEqual(publicationLines(published({ signed: true })), [
      '  published: registry.example.com/component/api-server:1.2.0 (sha256:abc123)',
      '  kind: Component',
      '  mediatype: application/vnd.aggrega.component.v1+yaml',
      '  size: 2.0 KiB',
      '  signature attached: registry.example.com/component/api-server:1.2.0',
    ]);
  });

  it('renders the executable size only where the compiler reported one', () => {
    // A labelled size with nothing beside it is the shape this guards against, so
    // the pair is asserted as a COUNT of lines rather than by looking for one.
    const withPlugin = publicationLines(published({ pluginSize: 900, pluginSizeText: '900 B' }));
    const without = publicationLines(published());
    assert.strictEqual(withPlugin.length - without.length, 1);
    assert.ok(withPlugin.includes('  executable size: 900 B'));
  });

  it('uses the compiler\'s own rendered size rather than recomputing one', () => {
    // 🔴 DERIVED FROM SOMEWHERE THE IMPLEMENTATION DOES NOT READ. The expected
    // text is a literal chosen here, and the answer carries a byte count that
    // disagrees with it — so a surface that formatted the number itself would
    // produce something other than this, and the assertion would fail. A test
    // that recomputed the expectation from `size` would accept either.
    const lines = publicationLines(published({ size: 999999, sizeText: 'whatever the compiler said' }));
    assert.ok(lines.includes('  size: whatever the compiler said'));
  });

  it('says a dry run published nothing on the channel too', () => {
    assert.strictEqual(
      publicationLines(published({ dryRun: true }))[0],
      '  dry run: registry.example.com/component/api-server:1.2.0 — nothing was published',
    );
  });

  it('lists each signature with the digest it commits to', () => {
    assert.deepStrictEqual(signatureLines(signedBatch()), [
      '  signature attached: registry.example.com/component/api-server:1.2.0 (sha256:abc123)',
    ]);
  });

  it('lists each marker with its severity, issue time and own digest', () => {
    assert.deepStrictEqual(withdrawalLines(withdrawn()), [
      '  marker attached: registry.example.com/component/api-server:1.2.0 — retracted,'
      + ' issued 2026-09-11T10:00:00Z (sha256:marker99)',
    ]);
  });
});

describe('a refusal reaches the reader in the compiler\'s own words', () => {
  // 🔴 PINNED. A publication refusal is exactly the message its author
  // needs — it names the remediation — so a friendlier wrapper substituted here
  // would discard the one useful thing in it. The assertion is an EQUALITY
  // against the compiler's text, so a surface that prefixed, suffixed or
  // re-worded it fails.
  const compilerText = 'keyless signing needs an identity token: no identityToken was sent, no '
    + 'AGGREGA_IDENTITY_TOKEN or SIGSTORE_ID_TOKEN is exported, and no ambient GitHub Actions '
    + 'OIDC endpoint is available; on GitHub Actions the workflow OIDC token is used '
    + 'automatically, otherwise export one of those variables (for example a CI workflow OIDC '
    + 'token) or send identityToken';

  it('carries a publication refusal through unaltered, and puts nothing on the channel', () => {
    return runPublishEntity(
      { publishEntity: () => Promise.reject(new Error(compilerText)) },
      'catalog/components/api-server.yaml',
    ).then((report) => {
      assert.strictEqual(report.outcome.kind, 'failed');
      assert.strictEqual(
        report.outcome.kind === 'failed' ? report.outcome.message : '',
        compilerText,
      );
      // Nothing was answered, so nothing is narrated: a channel line here would be
      // this surface describing a run that produced no facts.
      assert.deepStrictEqual(report.lines, []);
    });
  });

  it('carries a signing refusal through unaltered', () => {
    return runSignArtifacts(
      { signArtifacts: () => Promise.reject(new Error(compilerText)) },
      'registry.example.com/component/api-server:1.2.0',
    ).then((report) => {
      assert.strictEqual(
        report.outcome.kind === 'failed' ? report.outcome.message : '',
        compilerText,
      );
    });
  });

  it('carries a withdrawal refusal through unaltered', () => {
    return runDeprecateArtifact(
      { deprecateArtifact: () => Promise.reject(new Error(compilerText)) },
      'registry.example.com/component/api-server:1.2.0', 'warning', 'why',
    ).then((report) => {
      assert.strictEqual(
        report.outcome.kind === 'failed' ? report.outcome.message : '',
        compilerText,
      );
    });
  });
});

describe('the reader\'s stop is handed to the compiler', () => {
  // The signal is what makes the stop reach the work rather than only ending this
  // side's wait, so it is asserted to ARRIVE rather than merely to be accepted.
  it('passes the signal into each of the three requests', async () => {
    const seen: string[] = [];
    const signal = {} as never;
    await runPublishEntity({
      publishEntity: (_p, s) => { seen.push(s === signal ? 'publish' : 'publish:lost'); return Promise.resolve(published()); },
    }, 'catalog/x.yaml', signal);
    await runSignArtifacts({
      signArtifacts: (_p, s) => { seen.push(s === signal ? 'sign' : 'sign:lost'); return Promise.resolve(signedBatch()); },
    }, 'registry/x:1', signal);
    await runDeprecateArtifact({
      deprecateArtifact: (_p, s) => { seen.push(s === signal ? 'withdraw' : 'withdraw:lost'); return Promise.resolve(withdrawn()); },
    }, 'registry/x:1', 'warning', 'why', signal);
    assert.deepStrictEqual(seen, ['publish', 'sign', 'withdraw']);
  });
});

describe('the publication family reaches the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES A ZERO MEAN ANYTHING.
    // A pattern that has stopped matching reports every module clean, so a census
    // without a control cannot tell an absence from a dead instrument.
    assertCensusInstrumentFires((value, message) => assert.ok(value, message));
  });

  it('gives the module that decides a publication no way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/publication-request.ts'), 0);
  });

  it('gives that module no way to reach a process or an editor at all', () => {
    // Read as the WHOLE import list, so a module added to it has to be looked at —
    // including one that could start a process and one that would carry the editor
    // in, which is what keeps every publication decision readable without a host.
    // 🔴 THE VALUE LIST, WHICH IS WHAT THE CLAIM IS ABOUT. The wire shapes come
    // from the published contract rather than being restated here, and they come
    // as declarations alone — erased before anything runs, so the module reaches
    // no code through them. Asserted separately below, because a reading that
    // folded the two together would let a later change from one kind to the other
    // pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/publication-request.ts'),
      ['./cancellation', './operation-groups', './operation-outcome'],
    );
    assert.deepStrictEqual(
      typeOnlyImports('src/publication-request.ts'),
      [WIRE_CONTRACT],
    );
  });

  it('sends each of the three from exactly one place', () => {
    // One question with two senders is two execution paths. The method names are
    // the compiler's identifiers, read from the surface that sends them rather
    // than restated as constants this side owns.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    for (const method of ['publishEntity', 'signArtifacts', 'deprecateArtifact']) {
      const senders = files
        .filter((f) => new RegExp(`'aggrega/${method}'`).test(
          fs.readFileSync(path.join(dir, f), 'utf8'),
        ))
        .sort();
      assert.deepStrictEqual(
        senders,
        ['extension.ts'],
        `aggrega/${method} is sent from ${senders.length} place(s)`,
      );
    }
  });

  it('leaves no argument composer for any of the three anywhere in the tree', () => {
    // 🔴 A COUNT OVER THE WHOLE TREE, NOT A CHECK OF THE MODULES THAT CHANGED. A
    // composition surviving in a module nobody looked at is the shape that keeps a
    // second execution path alive while the surface reports it retired.
    //
    // The forms are enumerated before counting, because a census anchored on one
    // spelling under-reports silently.
    // The expression is built fresh per file: a global one carries a lastIndex,
    // and a shared one would make the reading depend on the order the files
    // happened to be walked in.
    const retired = (): RegExp => /\b(catalogUploadArgs|signArgs|deprecateArgs)\b/;
    const dir = path.join(EXTENSION_ROOT, 'src');
    const survivors = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => retired().test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(survivors, []);
  });
});
