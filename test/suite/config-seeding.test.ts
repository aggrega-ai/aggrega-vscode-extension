// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import {
  ConfigInitParams,
  ConfigInitResult,
  OFFICIAL_HUB_LABEL,
  SEEDING_SUBJECT,
  runSeeding,
  seedParams,
  seedingDetail,
  seedingOpeningLine,
} from '../../src/config-seeding';
import { terminalLine } from '../../src/operation-outcome';

// A DAEMON REFUSAL IS AN ENVELOPE OBJECT, NOT AN ERROR, and that is the shape
// this file's central assertion is built on. The client rejects a refused
// request with the raw JSON-RPC error member, so anything that reads a failure
// as `err.message` sees nothing and anything that stringifies it sees
// `[object Object]` — which loses the compiler's whole diagnostic rather than
// re-wording it.
interface DaemonRefusal {
  code: number;
  message: string;
}

// COMPILER_REFUSAL is the sentence the compiler writes when it declines to
// replace a configuration that is already there.
//
// 🔴 IT IS A LITERAL HERE ON PURPOSE. The extension holds no copy of this
// sentence and must not: it is the compiler's, and the whole property under test
// is that it arrives unaltered. A test that built its expectation from the
// extension's own rendering would move both sides of the comparison at once, so
// it would accept any re-wording — a comparison is blind to a change that
// reaches both of its sides.
const COMPILER_REFUSAL =
  'config init: /home/reader/.config/aggrega/config.yaml already exists and was left '
  + 'untouched; send force to write it anyway, which merges the registry entry into what '
  + 'is already there';

const REFUSAL_CODE = -32602;

// answer builds a seeding answer, defaulting to the shape the compiler produces
// for an unqualified seeding: the global file, written, with an advertised trust
// policy pinned.
function answer(over: Partial<ConfigInitResult> = {}): ConfigInitResult {
  return {
    host: 'hub.aggrega.ai',
    scope: {
      configFile: '/home/reader/.config/aggrega/config.yaml',
      machineWide: true,
      workspaceRoot: '/work/project',
    },
    trust: { pinned: true, identities: 3 },
    written: true,
    ...over,
  };
}

// recorder is a seeding that records what it was asked and answers as told. It
// stands in for the language server, so the whole decision runs with no
// transport, no compiler and no editor. It answers whether the language server
// running afterwards has read the write, as the extension's own request does;
// false unless a spec says otherwise.
function recorder(result: ConfigInitResult | Error | DaemonRefusal, inEffect = false) {
  const sent: ConfigInitParams[] = [];
  return {
    sent,
    seedConfiguration(params: ConfigInitParams) {
      sent.push(params);
      if (result instanceof Error) { return Promise.reject(result); }
      if ('code' in result) { return Promise.reject(result); }
      return Promise.resolve({ answer: result, inEffect });
    },
  };
}

describe('the seeding request says only what this surface has decided to say', () => {
  it('names no registry when the reader named none', () => {
    // The key is ABSENT rather than empty. Both reach the compiler's own
    // default, so this is not a correctness fix — it is that a request saying
    // nothing about the registry should not claim to name one.
    assert.deepStrictEqual(seedParams(null), {});
    assert.deepStrictEqual(Object.keys(seedParams(null)), []);
  });

  it('carries exactly the named registry and nothing else', () => {
    // 🔴 THIS IS AN EQUALITY, NOT A PRESENCE, AND THAT IS THE WHOLE POINT. An
    // assertion that the params "contain" the registry would pass with a force
    // override or a write-target choice added beside it — the two things this
    // surface must not send. Exact equality is what makes such an addition fail.
    assert.deepStrictEqual(seedParams('registry.example.com'), {
      registry: 'registry.example.com',
    });
  });

  it('sends no force override, so an existing configuration is never replaced', () => {
    // Named separately from the equality above because it is the property, and a
    // reader of a failure should see which rule was broken. Every key the
    // request could carry is checked by name against the set that would change
    // the destination or press past the refusal.
    for (const host of [null, 'registry.example.com']) {
      const params = seedParams(host) as Record<string, unknown>;
      for (const forbidden of ['force', 'global', 'workspace', 'report']) {
        assert.ok(
          !(forbidden in params),
          `${forbidden} must not be sent: it either replaces a working configuration `
          + 'or decides which file a seeding lands in, and neither is this surface\'s to decide',
        );
      }
    }
  });

  it('sends the composed request unchanged, exactly once', async () => {
    const seeding = recorder(answer());
    await runSeeding(seeding, 'registry.example.com');
    assert.deepStrictEqual(seeding.sent, [{ registry: 'registry.example.com' }]);
  });

  it('accepts no cancellation, because the compiler cannot interrupt the work', () => {
    // 🔴 THE ARITY IS THE ASSERTION. The work reaches a registry, which is the
    // reading under which an operation is watched and stoppable — but the shared
    // operation behind the request takes no cancellation and the handler checks
    // for a stopped caller only after its operation has returned, so a stop would
    // stop this side waiting and not the work. Presenting that as a stop breaks
    // the rule that stopping means the compiler stopped.
    //
    // Holding the arity means a third parameter carrying a stop has to be argued
    // rather than added, and it fails here the moment one appears.
    assert.strictEqual(
      runSeeding.length,
      2,
      'a third argument carrying a stop would offer a stop the compiler cannot honour',
    );
  });
});

describe('a completed seeding says what was seeded and where', () => {
  it('names the host and the file the write landed in', async () => {
    const outcome = await runSeeding(recorder(answer()), null);
    assert.strictEqual(outcome.kind, 'ok');
    const line = terminalLine(SEEDING_SUBJECT, outcome);
    assert.strictEqual(
      line,
      'The seeding registered hub.aggrega.ai in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project '
      + 'on this machine. Its advertised signature trust policy was pinned, naming 3 '
      + 'identities.',
    );
  });

  it('says the seeding is in effect once the restarted language server has read it', async () => {
    // The ending a reader meets, driven through the operation: the one sentence
    // is added to it where the answer says the running server has read the write,
    // and the ending above — the same answer, not read — carries none.
    const outcome = await runSeeding(recorder(answer(), true), null);
    assert.strictEqual(
      terminalLine(SEEDING_SUBJECT, outcome),
      'The seeding registered hub.aggrega.ai in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project '
      + 'on this machine. Its advertised signature trust policy was pinned, naming 3 '
      + 'identities. The change is now in effect: the running language server has read it.',
    );
  });

  it('says the reach of the file, because the default is the machine-wide one', () => {
    // 🔴 BOTH BRANCHES ARE WHOLE-MESSAGE EQUALITIES. They were containment checks,
    // which pass on a message that keeps the phrase and re-words everything
    // around it — the failure this repository has measured. The phrasing is now
    // shared with every other operation that writes configuration, so a change to
    // it would otherwise show up in no assertion at all.
    assert.strictEqual(
      seedingDetail(answer()),
      'registered hub.aggrega.ai in /home/reader/.config/aggrega/config.yaml, the global '
      + 'file shared by every project on this machine. Its advertised signature trust policy '
      + 'was pinned, naming 3 identities.',
    );
    const projectLocal = seedingDetail(answer({
      scope: {
        configFile: '/work/project/.aggrega-config.yaml',
        machineWide: false,
        workspaceRoot: '/work/project',
      },
    }));
    assert.strictEqual(
      projectLocal,
      'registered hub.aggrega.ai in /work/project/.aggrega-config.yaml, this project\'s own '
      + 'configuration file. Its advertised signature trust policy was pinned, naming 3 '
      + 'identities.',
    );
    assert.ok(
      !projectLocal.includes('every project on this machine'),
      'a project-local write must never be described as machine-wide',
    );
  });

  it('reads one identity as one identity', () => {
    assert.ok(seedingDetail(answer({ trust: { pinned: true, identities: 1 } }))
      .endsWith('pinned, naming 1 identity.'));
  });

  it('reports a registry that advertises nothing as a result, carrying the compiler\'s reason', () => {
    // A registry other than the hub that advertises nothing is written from what
    // the request supplied, and this client supplies no identity and no key — so
    // the sentence says the entry carries no policy, rather than claiming one.
    const reason = 'GET https://registry.example.com/.well-known/aggrega-trust: 404 Not Found';
    const detail = seedingDetail(answer({
      host: 'registry.example.com',
      trust: { pinned: false, notAdvertised: true, reason },
    }));
    assert.strictEqual(
      detail,
      'registered registry.example.com in /home/reader/.config/aggrega/config.yaml, the global '
      + 'file shared by every project on this machine. It advertises no signature trust policy, '
      + 'and this registration names no identity or key, so the entry carries none. '
      + reason,
    );
  });

  it('reports the official hub seeded offline as pinned to its built-in baseline', async () => {
    // The answer the language server gives for the official hub seeded while the
    // workspace is offline: the hub was never asked, so the answer carries the
    // baseline alone and the offline refusal as the reason, which arrives whole.
    const reason = 'registrytrust: fetch hub.aggrega.ai: egress: network access refused because '
      + 'the workspace is offline; remediation: pass `--offline=false` to allow the network for '
      + 'this one run, or clear the top-level `offline` key in the configuration file (or '
      + 'AGGREGA_OFFLINE) to allow it from now on; where the work is a build that needs content '
      + 'the machine does not have, run `aggrega pull --release <release>` from a connected '
      + 'environment first to populate the cache';
    const outcome = await runSeeding(
      recorder(answer({ trust: { pinned: false, baseline: true, reason } })),
      null,
    );
    assert.strictEqual(
      terminalLine(SEEDING_SUBJECT, outcome),
      'The seeding registered hub.aggrega.ai in /home/reader/.config/aggrega/config.yaml, the '
      + 'global file shared by every project on this machine. The built-in trust baseline was '
      + `pinned instead of an advertised policy. ${reason}`,
    );
  });

  it('reports a fetch that was not attempted, and never as a failure', () => {
    const detail = seedingDetail(answer({ trust: { pinned: false, skipped: true } }));
    assert.ok(detail.includes('No advertised signature trust policy was fetched.'));
    assert.doesNotMatch(detail, /fail|error/i);
  });

  it('reports an answer that named no trust outcome rather than picking one', () => {
    // Reading a state the compiler did not send would report a fact this surface
    // invented. Saying the answer named none is the honest reading.
    const detail = seedingDetail(answer({ trust: { pinned: false } }));
    assert.ok(detail.includes('names no signature trust policy outcome'));
  });

  it('does not claim a file was written when the answer says it was not', () => {
    const detail = seedingDetail(answer({ written: false }));
    assert.ok(detail.startsWith('reported the configuration for hub.aggrega.ai without writing '));
    assert.ok(!detail.startsWith('registered'));
  });

  it('never ends in silence, whatever the answer carried', async () => {
    // Silence never means success. Every shape of answer produces a sentence
    // with something in it, so no seeding can end in nothing.
    const shapes: Partial<ConfigInitResult>[] = [
      {},
      { written: false },
      { trust: { pinned: false } },
      { trust: { pinned: false, skipped: true } },
      { trust: { pinned: false, notAdvertised: true } },
      { trust: { pinned: false, baseline: true } },
      { trust: { pinned: false, notAdvertised: true, baseline: true } },
      { trust: { pinned: true } },
    ];
    for (const over of shapes) {
      const outcome = await runSeeding(recorder(answer(over)), null);
      assert.strictEqual(outcome.kind, 'ok');
      assert.ok(terminalLine(SEEDING_SUBJECT, outcome).trim().length > 0);
    }
  });
});

describe('the compiler\'s own words reach the reader', () => {
  it('carries a refused seeding\'s diagnostic through as an exact suffix', async () => {
    // 🔴 THE ASSERTION IS AN EQUALITY AGAINST A LITERAL THE IMPLEMENTATION DOES
    // NOT READ. A substring check would pass on a truncated diagnostic and on a
    // wrapper sentence with the compiler's text buried in it; an equality
    // against the whole rendered line cannot.
    const outcome = await runSeeding(
      recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL }),
      null,
    );
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      outcome.kind === 'failed' ? outcome.message : '',
      COMPILER_REFUSAL,
    );
    assert.strictEqual(
      terminalLine(SEEDING_SUBJECT, outcome),
      `The seeding did not complete: ${COMPILER_REFUSAL}`,
    );
  });

  it('keeps the remedy the compiler named, which a wrapper message would discard', async () => {
    const outcome = await runSeeding(
      recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL }),
      null,
    );
    const line = terminalLine(SEEDING_SUBJECT, outcome);
    // The two load-bearing halves of the compiler's sentence: the file it found,
    // and what to send to write it anyway. Both are what an author acts on.
    assert.ok(line.includes('/home/reader/.config/aggrega/config.yaml'));
    assert.ok(line.includes('send force to write it anyway'));
    assert.ok(
      !line.includes('[object Object]'),
      'a refusal rendered as [object Object] loses the whole diagnostic',
    );
  });

  it('carries the message of a transport failure that is a real error', async () => {
    // Not every failure is a language-server refusal: a request sent while no
    // server is running throws an ordinary error, and its sentence is what the
    // reader needs — it names the state to fix rather than the operation.
    const outcome = await runSeeding(
      recorder(new Error('the Aggrega language server is not running')),
      null,
    );
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: 'the Aggrega language server is not running',
    });
  });
});

describe('the channel is told what is being done before the work starts', () => {
  it('names the official hub when the reader named no host', () => {
    assert.strictEqual(
      seedingOpeningLine(null),
      `\nSeeding ${OFFICIAL_HUB_LABEL}, with its signature trust policy.`,
    );
    assert.strictEqual(OFFICIAL_HUB_LABEL, 'the official hub');
  });

  it('names the host the reader typed', () => {
    assert.strictEqual(
      seedingOpeningLine('registry.example.com'),
      '\nSeeding registry.example.com, with its signature trust policy.',
    );
  });

  it('says something for either host, so the channel is never left empty', () => {
    for (const host of [null, 'registry.example.com']) {
      assert.ok(seedingOpeningLine(host).trim().length > 0);
    }
  });
});
