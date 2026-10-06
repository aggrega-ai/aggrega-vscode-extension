// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CREDENTIAL_REMOVAL_SUBJECT,
  LogoutParams,
  LogoutResult,
  REGISTRATION_DESTINATION_PROMPT,
  REGISTRATION_SUBJECT,
  REGISTRY_REMOVAL_SUBJECT,
  REMOVAL_DESTINATION_PROMPT,
  RegistryAddParams,
  RegistryAddResult,
  RegistryRemoveParams,
  RegistryRemoveResult,
  TRUST_BY_HAND_CHOICES,
  TrustByHand,
  addRequest,
  asksForTrust,
  credentialRemovalDetail,
  logoutRequest,
  pinsAnything,
  refusedForWantOfTrust,
  removalConsentDetail,
  removeRequest,
  runLogout,
  runRegistryAdd,
  runRegistryAddWithTrust,
  runRegistryRemove,
} from '../../src/registry-configure';
import {
  CONFIG_WRITE_DESTINATIONS,
  configWriteOverrides,
  reachOfDestination,
} from '../../src/config-write-scope';
import { terminalLine } from '../../src/operation-outcome';
import { EXTENSION_ROOT, launchFacilityCount, readSourceTree } from '../helpers/launch-census';

// A DAEMON REFUSAL IS AN ENVELOPE OBJECT, NOT AN ERROR. The client rejects a
// refused request with the raw JSON-RPC error member, so anything that reads a
// failure as `err.message` sees nothing and anything that stringifies it sees
// `[object Object]` — which loses the compiler's whole diagnostic rather than
// re-wording it.
interface DaemonRefusal {
  code: number;
  message: string;
  data?: { code?: string; shortCode?: string };
}

// The three sentences the compiler writes when it refuses one of these
// operations.
//
// 🔴 EACH IS A LITERAL HERE ON PURPOSE. The extension holds no copy of any of
// them and must not: they are the compiler's, and the whole property under test
// is that each arrives unaltered. A test building its expectation from the
// extension's own rendering would move both sides of the comparison at once, so
// it would accept any re-wording — a comparison is blind to a change reaching
// both of its sides.
const ADD_REFUSAL =
  'registry add: host is required (the registry to register, such as '
  + 'registry.example.com)';
const REMOVE_REFUSAL =
  'registry remove: no registry matching "gone.example.test" is configured in '
  + '/home/reader/.config/aggrega/config.yaml; the configuration was left untouched';
const LOGOUT_REFUSAL =
  'logout: registry is required (the registry host whose stored credential to remove)';

const REFUSAL_CODE = -32602;

// The two files, spelled here as literals rather than read from the surface.
const GLOBAL_FILE = '/home/reader/.config/aggrega/config.yaml';
const PROJECT_FILE = '/work/project/aggrega.yaml';

// addAnswer builds a registration answer, defaulting to the shape the compiler
// produces for a registration that took the global file and pinned a policy.
function addAnswer(over: Partial<RegistryAddResult> = {}): RegistryAddResult {
  return {
    host: 'registry.example.test',
    scope: { configFile: GLOBAL_FILE, machineWide: true, workspaceRoot: '/work/project' },
    trust: { pinned: true, identities: 2 },
    ...over,
  };
}

function removeAnswer(over: Partial<RegistryRemoveResult> = {}): RegistryRemoveResult {
  return {
    host: 'registry.example.test',
    scope: { configFile: GLOBAL_FILE, machineWide: true, workspaceRoot: '/work/project' },
    ...over,
  };
}

type Answer<T> = T | Error | DaemonRefusal;

function settle<T>(result: Answer<T>): Promise<T> {
  if (result instanceof Error) { return Promise.reject(result); }
  if (typeof result === 'object' && result !== null && 'code' in result) {
    return Promise.reject(result);
  }
  return Promise.resolve(result as T);
}

// recorder stands in for the language server: it records what each operation was
// asked and answers as told, so every decision below runs with no transport, no
// compiler and no editor.
//
// The two writes answer whether the language server running afterwards has read
// them, as the extension's own requests do; that is false unless a spec says
// otherwise, which is the reading under which an ending adds nothing.
function recorder(answers: {
  add?: Answer<RegistryAddResult>;
  remove?: Answer<RegistryRemoveResult>;
  logout?: Answer<LogoutResult>;
  inEffect?: boolean;
}) {
  const addSent: RegistryAddParams[] = [];
  const removeSent: RegistryRemoveParams[] = [];
  const logoutSent: LogoutParams[] = [];
  const inEffect = answers.inEffect ?? false;
  return {
    addSent,
    removeSent,
    logoutSent,
    addRegistry(params: RegistryAddParams) {
      addSent.push(params);
      return settle(answers.add ?? addAnswer()).then((answer) => ({ answer, inEffect }));
    },
    removeRegistry(params: RegistryRemoveParams) {
      removeSent.push(params);
      return settle(answers.remove ?? removeAnswer()).then((answer) => ({ answer, inEffect }));
    },
    logOutOfRegistry(params: LogoutParams) {
      logoutSent.push(params);
      return settle(answers.logout ?? { registry: 'registry.example.test' });
    },
  };
}

// --- the destination a reader chooses ------------------------------------

describe('the destination a reader is offered', () => {
  it('offers exactly the two files, with the global one first', () => {
    // 🔴 AN EQUALITY OVER THE WHOLE OFFER, INCLUDING ITS ORDER. The order is
    // load-bearing rather than cosmetic: the first entry is the one a reader
    // takes by pressing nothing, so it is how "the global file remains the
    // default" is expressed to somebody who does not want to choose. A set
    // comparison, or a check that the global entry is merely present, would pass
    // on an offer that had quietly reordered.
    assert.deepStrictEqual(
      CONFIG_WRITE_DESTINATIONS.map((d) => d.value),
      ['global', 'workspace'],
      'the destination offer changed order or membership; the first entry is the default a '
      + 'reader takes by pressing nothing',
    );
  });

  it('labels each file in the words its ending will use, capitalised to stand alone', () => {
    // 🔴 LITERALS ON BOTH SIDES, DERIVED FROM NEITHER. The property is that a
    // reader picks between two files described in the same words the ending then
    // uses for them — so the labels and the reach phrases are each pinned to a
    // literal written here. Had either been derived from the other, an edit
    // reaching both would pass unnoticed, which is exactly how a single-sourcing
    // assertion goes blind.
    assert.deepStrictEqual(
      CONFIG_WRITE_DESTINATIONS.map((d) => d.label),
      [
        'The global file shared by every project on this machine',
        'This project\'s own configuration file',
      ],
    );
    assert.strictEqual(
      reachOfDestination('global'),
      'the global file shared by every project on this machine',
    );
    assert.strictEqual(
      reachOfDestination('workspace'),
      'this project\'s own configuration file',
    );
  });

  it('asks the question in each operation\'s own direction', () => {
    assert.strictEqual(
      REGISTRATION_DESTINATION_PROMPT,
      'Aggrega: which configuration file should the registry be written to?',
    );
    assert.strictEqual(
      REMOVAL_DESTINATION_PROMPT,
      'Aggrega: which configuration file should the entry be removed from?',
    );
  });

  it('turns a destination into exactly one override, never both and never neither', () => {
    // 🔴 THE TWO HAZARDS THE COMPILER CARES ABOUT, ASSERTED AS EQUALITIES. Both
    // overrides true is refused outright by the compiler; neither takes the
    // operation's own default instead of the reader's answer, which is a silent
    // wrong file rather than a refusal. One mapping in one place is what makes
    // each unreachable from a call site.
    assert.deepStrictEqual(configWriteOverrides('global'), { global: true, workspace: false });
    assert.deepStrictEqual(configWriteOverrides('workspace'), { global: false, workspace: true });
    for (const destination of CONFIG_WRITE_DESTINATIONS) {
      const overrides = configWriteOverrides(destination.value);
      assert.strictEqual(
        Number(overrides.global) + Number(overrides.workspace),
        1,
        `${destination.value} composed ${JSON.stringify(overrides)}, which is not exactly one `
        + 'override',
      );
    }
  });
});

// --- what each request says ----------------------------------------------

describe('the registration request says only what this surface has decided to say', () => {
  it('carries the host and the chosen destination and nothing else', () => {
    // 🔴 AN EQUALITY, NOT A PRESENCE, AND THAT IS THE WHOLE POINT. An assertion
    // that the params "contain" the host would pass with a trust field added
    // beside it — and two of those fields are pointer-valued in the compiler, so
    // sending one as false is not the same as omitting it: it would turn an
    // unqualified registration into one that pins nothing.
    assert.deepStrictEqual(addRequest('registry.example.test', 'global'), {
      host: 'registry.example.test',
      global: true,
      workspace: false,
    });
    assert.deepStrictEqual(
      Object.keys(addRequest('registry.example.test', 'workspace')).sort(),
      ['global', 'host', 'workspace'],
    );
  });

  it('sends no trust field where none was supplied, so the compiler\'s own defaults stand', () => {
    // Named separately from the equality above because it is the property, and a
    // reader of a failure should see which rule was broken. The fetch of an
    // advertised policy defaults to ON and an unset signature requirement is
    // distinguishable from one turned off, so an omitted field is not a false
    // one. The identities and the key are sent only where a reader supplied them,
    // which the specs on a policy pinned by hand hold.
    const params = addRequest('registry.example.test', 'global') as unknown as
      Record<string, unknown>;
    for (const forbidden of [
      'name',
      'identities',
      'keyPath',
      'trustedRoot',
      'requireSignatures',
      'advisory',
      'fetchTrust',
    ]) {
      assert.ok(
        !(forbidden in params),
        `${forbidden} must not be sent by a registration that supplies no trust detail: it `
        + 'shapes the trust policy, and sending its zero value is not the same as omitting it',
      );
    }
  });

  it('passes the host through verbatim, whatever it is', () => {
    // The compiler validates a host and reports on it. A reading here would be a
    // second answer to what a host is, and it would diverge the first time the
    // compiler accepted something this side had not thought of.
    for (const host of ['registry.example.test', 'localhost:5000', 'a.b.c.example']) {
      assert.strictEqual(addRequest(host, 'global').host, host);
    }
  });

  it('trims the host it was given, so a stray space is not part of the identity', () => {
    assert.strictEqual(addRequest('  registry.example.test  ', 'global').host,
      'registry.example.test');
  });

  it('refuses without a host, so no registration is sent with nothing to register', () => {
    assert.throws(() => addRequest('', 'global'), /takes the registry to register/);
    assert.throws(() => addRequest('   ', 'global'), /takes the registry to register/);
  });

  it('sends the composed request unchanged, exactly once', async () => {
    const registries = recorder({});
    await runRegistryAdd(registries, 'registry.example.test', 'workspace');
    assert.deepStrictEqual(registries.addSent, [
      { host: 'registry.example.test', global: false, workspace: true },
    ]);
  });

  it('accepts no cancellation, because the compiler cannot interrupt the work', () => {
    // 🔴 THE ARITY IS THE ASSERTION. The shared operation behind the request is
    // reached with no cancellation and the handler checks for a stopped caller
    // only after that operation has returned, so a stop would stop this side
    // waiting and not the work. Holding the arity means a fourth parameter
    // carrying a stop has to be argued rather than added.
    assert.strictEqual(
      runRegistryAdd.length,
      3,
      'a fourth argument carrying a stop would offer a stop the compiler cannot honour',
    );
  });
});

// --- a trust policy pinned by hand ---------------------------------------

// The compiler's own words for the three cases below, as the pinned language
// server answered them over stdio. Literals, for the reason the refusals above
// are: the property under test is that each arrives, or is read, unaltered.
const OFFLINE_REFUSAL =
  'E0310: aggrega registry add: localhost:2: a registry other than the official hub is not '
  + 'registered offline without a trust policy supplied by hand, because the policy it '
  + 'advertises cannot be fetched; register it once while online, or pin its trust by hand '
  + 'with `aggrega registry add <host> --identity <identity>=<issuer>` or `--key <public-key-file>`';
// The condition the offline refusal names, as its data carries it: the
// descriptive code a client branches on and the short code its message opens with.
const OFFLINE_CONDITION = { code: 'offline-registration-without-trust-policy', shortCode: 'E0310' };
const MALFORMED_IDENTITY_REFUSAL =
  'aggrega registry add: --identity "not-an-identity-pair" must be in the form identity=issuer';
const NOT_ADVERTISED = 'registrytrust: registry advertises no trust config';
const NOT_REACHED = 'registrytrust: fetch trust config from localhost:1: Get '
  + '"http://localhost:1/.well-known/aggrega-trust": dial tcp [::1]:1: connect: connection refused';

const IDENTITY_A = 'dev@example.com=https://accounts.google.com';
const IDENTITY_B = 'ci@example.com=https://token.actions.githubusercontent.com';
const KEY_FILE = '/home/reader/keys/registry.pub.pem';

describe('the reader is asked for a trust policy to pin by hand exactly where the command line takes one', () => {
  it('asks where the registry was asked and advertised nothing, naming the host the entry was keyed under', async () => {
    const answer = addAnswer({ host: 'normalised.example.test', trust: { pinned: false, notAdvertised: true, reason: NOT_ADVERTISED } });
    assert.strictEqual(asksForTrust(answer), true);
    const ending = await runRegistryAdd(recorder({ add: answer }), 'registry.example.test', 'global');
    assert.strictEqual(ending.asksForTrust, true);
    assert.strictEqual(ending.host, 'normalised.example.test');
  });

  it('asks where the registry could not be reached, as the command line takes a policy by hand for it too', async () => {
    // The answer reports an unreachable registry as not advertising, with the field
    // saying it was not reached beside it. The entry carries no policy either way,
    // and a policy stated by hand needs no fetch, so the question stands.
    const answer = addAnswer({ trust: { pinned: false, notAdvertised: true, unreachable: true, reason: NOT_REACHED } });
    assert.strictEqual(asksForTrust(answer), true);
    const ending = await runRegistryAdd(recorder({ add: answer }), 'registry.example.test', 'global');
    assert.strictEqual(ending.asksForTrust, true);
  });

  it('never asks where a policy was taken: an advertised one pinned, or the hub\'s baseline', async () => {
    // 🔴 A policy supplied by hand takes the place of the one the answer reports,
    // so asking in any of these would invite a reader to replace trust the entry
    // already carries. The second baseline row is the hub asked and advertising
    // nothing, which carries notAdvertised beside the baseline.
    const taken: Array<RegistryAddResult['trust']> = [
      { pinned: true, identities: 2 },
      { pinned: false, baseline: true, reason: 'offline' },
      { pinned: false, notAdvertised: true, baseline: true, reason: NOT_ADVERTISED },
      { pinned: false, notAdvertised: true, unreachable: true, baseline: true, reason: NOT_REACHED },
      { pinned: false, skipped: true },
      { pinned: false },
    ];
    for (const trust of taken) {
      const ending = await runRegistryAdd(recorder({ add: addAnswer({ trust }) }), 'registry.example.test', 'global');
      assert.strictEqual(ending.asksForTrust, false, `asked after an answer reporting ${JSON.stringify(trust)}`);
    }
  });

  it('asks after the offline refusal whose remedy is identities or a key, naming the host the request carried', async () => {
    const refusal: DaemonRefusal = { code: REFUSAL_CODE, message: OFFLINE_REFUSAL, data: OFFLINE_CONDITION };
    assert.strictEqual(refusedForWantOfTrust(refusal), true);
    const ending = await runRegistryAdd(recorder({ add: refusal }), '  localhost:2  ', 'global');
    assert.strictEqual(ending.asksForTrust, true);
    assert.strictEqual(ending.host, 'localhost:2');
    // The refusal is still the ending, whole, and it is what the reader meets
    // before the question.
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, ending.outcome),
      `The registration did not complete: ${OFFLINE_REFUSAL}`,
    );
  });

  it('does not ask after any other refusal, nor after a failure that is not a refusal', async () => {
    // The rows carrying the offline refusal's words name another condition in
    // their data, or none, or arrive on a value that is not a language-server
    // refusal at all — so what is read is the condition the server named, never
    // the words.
    const others: unknown[] = [
      { code: REFUSAL_CODE, message: ADD_REFUSAL },
      { code: REFUSAL_CODE, message: MALFORMED_IDENTITY_REFUSAL },
      { code: REFUSAL_CODE, message: OFFLINE_REFUSAL.replace('E0310: ', 'E0309: ') },
      { code: REFUSAL_CODE, message: OFFLINE_REFUSAL.replace('E0310: ', '') },
      {
        code: REFUSAL_CODE,
        message: OFFLINE_REFUSAL,
        data: { code: 'workspace-config-invalid', shortCode: 'E0224' },
      },
      new Error(OFFLINE_REFUSAL),
      Object.assign(new Error(OFFLINE_REFUSAL), { data: OFFLINE_CONDITION }),
    ];
    for (const refusal of others) {
      assert.strictEqual(refusedForWantOfTrust(refusal), false, `read ${String((refusal as { message?: string }).message)} as the offline refusal`);
    }
    const ending = await runRegistryAdd(recorder({ add: { code: REFUSAL_CODE, message: ADD_REFUSAL } }), 'registry.example.test', 'global');
    assert.strictEqual(ending.asksForTrust, false);
  });

  it('reads the offline refusal from the condition its data names, whatever its message says', () => {
    // 🔴 THE FIELDS WIN. A refusal whose message merely opens with the offline
    // refusal's short code names no condition unless its data does, and one whose
    // data names the condition is that refusal whatever its words — the short
    // code at the head of a message is there for the person reading it.
    assert.strictEqual(
      refusedForWantOfTrust({ code: REFUSAL_CODE, message: OFFLINE_REFUSAL }),
      false,
      'a message opening with the short code was read as naming the condition',
    );
    for (const message of [OFFLINE_REFUSAL.replace('E0310: ', ''), OFFLINE_REFUSAL.replace('E0310: ', 'E0309: '), '']) {
      assert.strictEqual(
        refusedForWantOfTrust({ code: REFUSAL_CODE, message, data: OFFLINE_CONDITION }),
        true,
        `the condition its data names was not read beside the message ${JSON.stringify(message)}`,
      );
    }
  });

  it('offers exactly the two kinds the command line takes for this case, one, the other, both or neither', () => {
    // 🔴 AN EQUALITY OVER THE WHOLE OFFER. The command line's notice for a
    // registry advertising nothing, and its offline refusal, name the identities
    // and the key and nothing else; a row reaching any other trust detail would be
    // a capability the two surfaces do not share.
    assert.deepStrictEqual(
      TRUST_BY_HAND_CHOICES.map((c) => [c.label, c.identities, c.key]),
      [
        ['Keyless identities', true, false],
        ['A public key', false, true],
        ['Keyless identities and a public key', true, true],
        ['Neither', false, false],
      ],
    );
  });

  it('sends a second registration only where the reader supplied something', () => {
    assert.strictEqual(pinsAnything(null), false);
    assert.strictEqual(pinsAnything({ identities: [], keyPath: null }), false);
    assert.strictEqual(pinsAnything({ identities: [IDENTITY_A], keyPath: null }), true);
    assert.strictEqual(pinsAnything({ identities: [], keyPath: KEY_FILE }), true);
  });
});

describe('a registration carrying a policy pinned by hand sends what was supplied and says what kind it pinned', () => {
  it('composes the host, the destination, the identities in order and the key path, and nothing else', () => {
    assert.deepStrictEqual(addRequest('registry.example.test', 'workspace', { identities: [IDENTITY_A, IDENTITY_B], keyPath: KEY_FILE }), {
      host: 'registry.example.test',
      global: false,
      workspace: true,
      identities: [IDENTITY_A, IDENTITY_B],
      keyPath: KEY_FILE,
    });
    assert.deepStrictEqual(addRequest('registry.example.test', 'global', { identities: [IDENTITY_A], keyPath: null }), {
      host: 'registry.example.test', global: true, workspace: false, identities: [IDENTITY_A],
    });
    assert.deepStrictEqual(addRequest('registry.example.test', 'global', { identities: [], keyPath: KEY_FILE }), {
      host: 'registry.example.test', global: true, workspace: false, keyPath: KEY_FILE,
    });
  });

  it('omits what was not supplied, so supplying nothing composes the bare request', () => {
    assert.deepStrictEqual(
      addRequest('registry.example.test', 'global', { identities: [], keyPath: null }),
      addRequest('registry.example.test', 'global'),
    );
  });

  it('sends each identity exactly as typed, leaving every check to the compiler', () => {
    // 🔴 No second rule: a malformed identity, one with stray spaces, and one with
    // no issuer each travel untouched, and the compiler's refusal is what the
    // reader meets.
    const typed = ['not-an-identity-pair', ' dev@example.com=https://accounts.google.com ', 'x='];
    assert.deepStrictEqual(addRequest('registry.example.test', 'global', { identities: typed, keyPath: null }).identities, typed);
  });

  it('registers once more at the same destination, through the same request, carrying what was supplied', async () => {
    const registries = recorder({ add: addAnswer({ trust: { pinned: false, skipped: true } }) });
    const byHand: TrustByHand = { identities: [IDENTITY_A], keyPath: KEY_FILE };
    await runRegistryAddWithTrust(registries, 'registry.example.test', 'workspace', byHand);
    assert.deepStrictEqual(registries.addSent, [
      { host: 'registry.example.test', global: false, workspace: true, identities: [IDENTITY_A], keyPath: KEY_FILE },
    ]);
  });

  it('says what kind of trust the entry now carries, and names none of the values', async () => {
    const opening = 'The registration registered registry.example.test in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project on this machine. ';
    const cases: Array<[TrustByHand, string]> = [
      [{ identities: [IDENTITY_A], keyPath: null },
        'Its signature trust policy is the keyless identity this registration supplied, so no advertised policy was fetched.'],
      [{ identities: [IDENTITY_A, IDENTITY_B], keyPath: null },
        'Its signature trust policy is the keyless identities this registration supplied, so no advertised policy was fetched.'],
      [{ identities: [], keyPath: KEY_FILE },
        'Its signature trust policy is the public key this registration supplied, so no advertised policy was fetched.'],
      [{ identities: [IDENTITY_A, IDENTITY_B], keyPath: KEY_FILE },
        'Its signature trust policy is the keyless identities and the public key this registration supplied, so no '
        + 'advertised policy was fetched.'],
    ];
    for (const [byHand, sentence] of cases) {
      const outcome = await runRegistryAddWithTrust(recorder({ add: addAnswer({ trust: { pinned: false, skipped: true } }) }), 'registry.example.test', 'global', byHand);
      const line = terminalLine(REGISTRATION_SUBJECT, outcome);
      assert.strictEqual(line, `${opening}${sentence}`);
      for (const value of [...byHand.identities, byHand.keyPath ?? '', 'dev@example.com', 'accounts.google.com']) {
        if (value !== '') { assert.ok(!line.includes(value), `the ending names "${value}": ${line}`); }
      }
    }
  });

  it('reads what was supplied only where the answer says the fetch was skipped', async () => {
    // An answer reporting anything else is read as that: the sentence is about
    // what the compiler did, and the request is not evidence of it.
    const outcome = await runRegistryAddWithTrust(
      recorder({ add: addAnswer({ trust: { pinned: false, notAdvertised: true, reason: NOT_ADVERTISED } }) }),
      'registry.example.test', 'global', { identities: [IDENTITY_A], keyPath: KEY_FILE },
    );
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      'The registration registered registry.example.test in /home/reader/.config/aggrega/config.yaml, the global '
      + 'file shared by every project on this machine. It advertises no signature trust policy, and this '
      + `registration names no identity or key, so the entry carries none. ${NOT_ADVERTISED}`,
    );
  });

  it('ends a refused one in the compiler\'s own sentence, whole', async () => {
    const outcome = await runRegistryAddWithTrust(
      recorder({ add: { code: REFUSAL_CODE, message: MALFORMED_IDENTITY_REFUSAL } }),
      'registry.example.test', 'global', { identities: ['not-an-identity-pair'], keyPath: null },
    );
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      `The registration did not complete: ${MALFORMED_IDENTITY_REFUSAL}`,
    );
  });

  it('accepts no cancellation either: its four arguments carry no stop', () => {
    assert.strictEqual(
      runRegistryAddWithTrust.length,
      4,
      'a fifth argument carrying a stop would offer a stop the compiler cannot honour',
    );
  });
});

describe('the removal request says only what this surface has decided to say', () => {
  it('carries the registry and the chosen destination and nothing else', () => {
    assert.deepStrictEqual(removeRequest('registry.example.test', 'workspace'), {
      registry: 'registry.example.test',
      global: false,
      workspace: true,
    });
    assert.deepStrictEqual(
      Object.keys(removeRequest('registry.example.test', 'global')).sort(),
      ['global', 'registry', 'workspace'],
    );
  });

  it('refuses without a registry', () => {
    assert.throws(() => removeRequest('', 'global'), /takes the registry to remove/);
    assert.throws(() => removeRequest('  ', 'global'), /takes the registry to remove/);
  });

  it('sends the composed request unchanged, exactly once', async () => {
    const registries = recorder({});
    await runRegistryRemove(registries, 'registry.example.test', 'global');
    assert.deepStrictEqual(registries.removeSent, [
      { registry: 'registry.example.test', global: true, workspace: false },
    ]);
  });

  it('accepts no cancellation', () => {
    assert.strictEqual(runRegistryRemove.length, 3);
  });
});

describe('the credential removal request says only what this surface has decided to say', () => {
  it('carries the registry and nothing else, because there is no destination to choose', () => {
    // 🔴 AN EQUALITY, AND THE ABSENCE IS THE COMPILER'S RATHER THAN A CHOICE.
    // The credential store has no project-scoped form to resolve to, so the
    // request surface carries no override at all — offering one here would be a
    // choice the compiler cannot honour.
    assert.deepStrictEqual(logoutRequest('registry.example.test'), {
      registry: 'registry.example.test',
    });
    assert.deepStrictEqual(Object.keys(logoutRequest('registry.example.test')), ['registry']);
  });

  it('refuses without a registry', () => {
    assert.throws(
      () => logoutRequest(''),
      /takes the registry whose stored credential to remove/,
    );
  });

  it('sends the composed request unchanged, exactly once', async () => {
    const registries = recorder({});
    await runLogout(registries, 'registry.example.test');
    assert.deepStrictEqual(registries.logoutSent, [{ registry: 'registry.example.test' }]);
  });

  it('accepts no cancellation and takes no destination', () => {
    assert.strictEqual(
      runLogout.length,
      2,
      'a third argument would be either a destination the compiler cannot honour or a stop it '
      + 'cannot honour',
    );
  });
});

// --- what a completed operation tells the reader -------------------------

describe('a completed registration says what was registered and where', () => {
  it('names the host, the file, how far it reaches, and what the registry advertised', async () => {
    const { outcome } = await runRegistryAdd(recorder({}), 'registry.example.test', 'global');
    assert.strictEqual(outcome.kind, 'ok');
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      'The registration registered registry.example.test in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project on '
      + 'this machine. Its advertised signature trust policy was pinned, naming 2 identities.',
    );
  });

  it('reads the file and the reach off the ANSWER, not off the request', async () => {
    // 🔴 A WHOLE-MESSAGE EQUALITY, and the case that separates the two sources.
    // The request asked for the global file and the answer reports the project's
    // one; the ending must describe where the write LANDED, because the compiler
    // resolves the destination and this surface only asked.
    const { outcome } = await runRegistryAdd(
      recorder({
        add: addAnswer({
          host: 'normalised.example.test',
          scope: {
            configFile: PROJECT_FILE,
            machineWide: false,
            workspaceRoot: '/work/project',
          },
          trust: { pinned: false, notAdvertised: true, reason: 'HTTP 404 from its origin' },
        }),
      }),
      'registry.example.test',
      'global',
    );
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      'The registration registered normalised.example.test in /work/project/aggrega.yaml, '
      + 'this project\'s own configuration file. It advertises no signature trust policy, and '
      + 'this registration names no identity or key, so the entry carries none. HTTP 404 from '
      + 'its origin',
    );
  });

  it('says what the trust fetch found in every state the answer can report', async () => {
    // Whole-message equalities per state rather than a containment check: a
    // containment check passes on a message that keeps one phrase and re-words
    // around it, which is the shape this project has measured passing a real
    // planted defect.
    const cases: Array<[RegistryAddResult['trust'], string]> = [
      [{ pinned: true, identities: 1 },
        'Its advertised signature trust policy was pinned, naming 1 identity.'],
      [{ pinned: true, identities: 0 },
        'Its advertised signature trust policy was pinned, naming 0 identities.'],
      [{ pinned: false, notAdvertised: true, reason: 'HTTP 404 from its origin' },
        'It advertises no signature trust policy, and this registration names no identity or '
        + 'key, so the entry carries none. HTTP 404 from its origin'],
      [{ pinned: false, notAdvertised: true },
        'It advertises no signature trust policy, and this registration names no identity or '
        + 'key, so the entry carries none.'],
      // A registry that could not be reached carries notAdvertised as well, and the
      // field beside it is what is read: the sentence says no policy could be
      // fetched and names the registry as not reached, ahead of the answer's reason.
      [{ pinned: false, notAdvertised: true, unreachable: true, reason: NOT_REACHED },
        'No signature trust policy could be fetched from it, and this registration names no '
        + 'identity or key, so the entry carries none. registry.example.test could not be '
        + `reached: ${NOT_REACHED}`],
      [{ pinned: false, notAdvertised: true, unreachable: true },
        'No signature trust policy could be fetched from it, and this registration names no '
        + 'identity or key, so the entry carries none. registry.example.test could not be '
        + 'reached.'],
      // The control for that reading: the same refused connection in the reason, with
      // no field saying the registry was not reached, reads as a registry that
      // answered — the words are never searched.
      [{ pinned: false, notAdvertised: true, reason: NOT_REACHED },
        'It advertises no signature trust policy, and this registration names no identity or '
        + `key, so the entry carries none. ${NOT_REACHED}`],
      [{ pinned: false, skipped: true },
        'No advertised signature trust policy was fetched.'],
      [{ pinned: false },
        'The answer names no signature trust policy outcome.'],
    ];
    for (const [trust, sentence] of cases) {
      const { outcome } = await runRegistryAdd(
        recorder({ add: addAnswer({ trust }) }),
        'registry.example.test',
        'global',
      );
      assert.strictEqual(
        terminalLine(REGISTRATION_SUBJECT, outcome),
        'The registration registered registry.example.test in '
        + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project '
        + `on this machine. ${sentence}`,
      );
    }
  });

  it('says the official hub was pinned to its built-in baseline, whether or not it was asked', async () => {
    // 🔴 THE BASELINE IS READ BEFORE NOT-ADVERTISED, and the second row is the one
    // that holds the order: the hub asked and advertising nothing carries both
    // keys, and its entry carries the baseline, so a sentence saying only that
    // nothing was advertised would tell the reader the entry trusts nothing. The
    // first row is the answer the language server gives for the hub registered
    // offline, where it was never asked: the baseline alone, with the offline
    // refusal as the reason, carried whole.
    const offline = 'registrytrust: fetch hub.aggrega.ai: egress: network access refused because '
      + 'the workspace is offline; remediation: pass `--offline=false` to allow the network for '
      + 'this one run, or clear the top-level `offline` key in the configuration file (or '
      + 'AGGREGA_OFFLINE) to allow it from now on; where the work is a build that needs content '
      + 'the machine does not have, run `aggrega pull --release <release>` from a connected '
      + 'environment first to populate the cache';
    const notFound = 'registrytrust: registry advertises no trust config';
    const unreached = 'registrytrust: fetch trust config from hub.aggrega.ai: Get '
      + '"https://hub.aggrega.ai/.well-known/aggrega-trust": dial tcp: lookup hub.aggrega.ai: no such host';
    const cases: Array<[RegistryAddResult['trust'], string]> = [
      [{ pinned: false, baseline: true, reason: offline },
        `The built-in trust baseline was pinned instead of an advertised policy. ${offline}`],
      [{ pinned: false, notAdvertised: true, baseline: true, reason: notFound },
        `The built-in trust baseline was pinned instead of an advertised policy. ${notFound}`],
      // The hub asked online and not reached: the entry carries the baseline, and the
      // reason names the hub as not reached ahead of the answer's own words.
      [{ pinned: false, notAdvertised: true, unreachable: true, baseline: true, reason: unreached },
        'The built-in trust baseline was pinned instead of an advertised policy. hub.aggrega.ai '
        + `could not be reached: ${unreached}`],
      [{ pinned: false, baseline: true },
        'The built-in trust baseline was pinned instead of an advertised policy.'],
    ];
    for (const [trust, sentence] of cases) {
      const { outcome } = await runRegistryAdd(
        recorder({ add: addAnswer({ host: 'hub.aggrega.ai', trust }) }),
        'hub.aggrega.ai',
        'global',
      );
      assert.strictEqual(
        terminalLine(REGISTRATION_SUBJECT, outcome),
        'The registration registered hub.aggrega.ai in '
        + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project '
        + `on this machine. ${sentence}`,
      );
    }
  });
});

describe('a completed removal says what was removed and from where', () => {
  it('names the registry, the file the write landed in, and how far that file reaches', async () => {
    const outcome = await runRegistryRemove(recorder({}), 'registry.example.test', 'global');
    assert.strictEqual(outcome.kind, 'ok');
    assert.strictEqual(
      terminalLine(REGISTRY_REMOVAL_SUBJECT, outcome),
      'The removal removed the registry registry.example.test from '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project on '
      + 'this machine.',
    );
  });

  it('describes a project-scoped removal as project-scoped', async () => {
    const outcome = await runRegistryRemove(
      recorder({
        remove: removeAnswer({
          scope: {
            configFile: PROJECT_FILE,
            machineWide: false,
            workspaceRoot: '/work/project',
          },
        }),
      }),
      'registry.example.test',
      'workspace',
    );
    assert.strictEqual(
      terminalLine(REGISTRY_REMOVAL_SUBJECT, outcome),
      'The removal removed the registry registry.example.test from '
      + '/work/project/aggrega.yaml, this project\'s own configuration file.',
    );
  });
});

// The ending of each configuration write says the change is in force once the
// language server running afterwards has read it, and says nothing of the kind
// otherwise. Both halves are whole-message equalities over the ending a reader
// meets, driven through the operation rather than read off the composer.
describe('a registration and a removal say they are in effect once the language server has read them', () => {
  it('ends a registration the restarted server has read by saying it is in effect', async () => {
    const { outcome } = await runRegistryAdd(recorder({ inEffect: true }), 'registry.example.test', 'global');
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      'The registration registered registry.example.test in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project on '
      + 'this machine. Its advertised signature trust policy was pinned, naming 2 identities. '
      + 'The change is now in effect: the running language server has read it.',
    );
  });

  it('ends a removal the restarted server has read by saying it is in effect', async () => {
    const outcome = await runRegistryRemove(recorder({ inEffect: true }), 'registry.example.test', 'global');
    assert.strictEqual(
      terminalLine(REGISTRY_REMOVAL_SUBJECT, outcome),
      'The removal removed the registry registry.example.test from '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project on '
      + 'this machine. The change is now in effect: the running language server has read it.',
    );
  });

  it('says nothing of the kind where no running server has read the write', async () => {
    const { outcome: add } = await runRegistryAdd(recorder({ inEffect: false }), 'registry.example.test', 'global');
    const remove = await runRegistryRemove(recorder({ inEffect: false }), 'registry.example.test', 'global');
    for (const outcome of [add, remove]) {
      assert.strictEqual(outcome.kind, 'ok');
      assert.ok(
        !terminalLine(REGISTRATION_SUBJECT, outcome).includes('in effect'),
        'an ending claims the change is in effect when no running server has read it',
      );
    }
  });
});

describe('a completed credential removal says what was removed', () => {
  it('names the registry the store was asked about, echoed from the answer', async () => {
    const outcome = await runLogout(
      recorder({ logout: { registry: 'normalised.example.test' } }),
      'registry.example.test',
    );
    assert.strictEqual(outcome.kind, 'ok');
    assert.strictEqual(
      terminalLine(CREDENTIAL_REMOVAL_SUBJECT, outcome),
      'The credential removal removed the stored credential for normalised.example.test.',
    );
  });

  it('names no location, because the store is frequently not a file', () => {
    // The store delegates to a keychain or a credential helper where one is
    // configured, so a sentence naming a path would assert a location the removal
    // did not necessarily touch. Asserted as an absence of either file rather
    // than as a wording, so a re-worded sentence that started naming one fails.
    const detail = credentialRemovalDetail({ registry: 'registry.example.test' });
    assert.ok(!detail.includes('/'), `the credential removal named a location: ${detail}`);
  });
});

// --- what the confirmation a reader consents to actually says ------------

describe('the confirmation is true of the file the reader chose', () => {
  it('states the machine-wide consequence for the global file', () => {
    assert.strictEqual(
      removalConsentDetail('global'),
      'The entry is removed from the global file shared by every project on this machine, so '
      + 'every project resolving through it is affected. Which registry is the default is left '
      + 'unchanged.',
    );
  });

  it('states the project-only consequence for the project\'s own file', () => {
    // 🔴 THIS IS THE ASSERTION A HARDCODED SENTENCE CANNOT PASS. A consent
    // sentence naming one file whatever the reader chose is true of one choice
    // and false of the other, and consent taken on a false claim is consent to
    // something else — so the sentence is pinned per destination rather than
    // checked for merely being non-empty.
    assert.strictEqual(
      removalConsentDetail('workspace'),
      'The entry is removed from this project\'s own configuration file, so no other project '
      + 'on this machine is affected. Which registry is the default is left unchanged.',
    );
  });

  it('says something different for each destination, so neither is the other\'s wording', () => {
    assert.notStrictEqual(removalConsentDetail('global'), removalConsentDetail('workspace'));
  });
});

// --- the compiler's own refusal, unaltered -------------------------------

describe('a refused operation carries the compiler\'s own diagnostic', () => {
  // 🔴 EACH LINE BELOW IS AN EXACT EQUALITY AGAINST A LITERAL THE IMPLEMENTATION
  // DOES NOT READ. That is what makes these able to see a re-wording: an
  // assertion that a message merely "appeared" passes on a wrapper sentence that
  // has discarded the compiler's text, and an assertion built from the
  // extension's own rendering moves both sides of the comparison at once.
  //
  // The transport code is prefixed by the extension's one rendering home, and
  // that prefix is ADDITIVE: the compiler's own sentence follows it unaltered.
  // Both halves are pinned here — the prefix so it cannot silently start
  // replacing the sentence, and the sentence so it cannot silently start being
  // summarised.
  it('renders the registration refusal exactly, character for character', async () => {
    const refusal: DaemonRefusal = { code: REFUSAL_CODE, message: ADD_REFUSAL };
    const { outcome } = await runRegistryAdd(
      recorder({ add: refusal }),
      'registry.example.test',
      'global',
    );
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(REGISTRATION_SUBJECT, outcome),
      'The registration did not complete: registry add: host is required (the '
      + 'registry to register, such as registry.example.com)',
    );
  });

  it('renders the removal refusal exactly, including the file it names', async () => {
    const refusal: DaemonRefusal = { code: REFUSAL_CODE, message: REMOVE_REFUSAL };
    const outcome = await runRegistryRemove(
      recorder({ remove: refusal }),
      'gone.example.test',
      'global',
    );
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(REGISTRY_REMOVAL_SUBJECT, outcome),
      'The removal did not complete: registry remove: no registry matching '
      + '"gone.example.test" is configured in /home/reader/.config/aggrega/config.yaml; the '
      + 'configuration was left untouched',
    );
  });

  it('renders the credential-removal refusal exactly', async () => {
    const refusal: DaemonRefusal = { code: REFUSAL_CODE, message: LOGOUT_REFUSAL };
    const outcome = await runLogout(recorder({ logout: refusal }), 'registry.example.test');
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      terminalLine(CREDENTIAL_REMOVAL_SUBJECT, outcome),
      'The credential removal did not complete: logout: registry is required (the '
      + 'registry host whose stored credential to remove)',
    );
  });

  it('carries the compiler\'s sentence as an unbroken RUN inside the line it renders', () => {
    // 🔴 THE SEPARATE PROPERTY, AND IT NEEDS ITS OWN ASSERTION. The three
    // equalities above would each keep passing if the compiler's sentence were
    // reflowed, re-punctuated or interleaved with words of this surface's own, so
    // long as somebody updated the literal to match. This one asserts the
    // structural claim instead: the line is the subject, the prefix, and the
    // compiler's sentence with nothing inserted into it — computed by removing
    // the sentence and checking that what remains carries none of it.
    for (const [subject, message] of [
      [REGISTRATION_SUBJECT, ADD_REFUSAL],
      [REGISTRY_REMOVAL_SUBJECT, REMOVE_REFUSAL],
      [CREDENTIAL_REMOVAL_SUBJECT, LOGOUT_REFUSAL],
    ]) {
      const line = terminalLine(subject, { kind: 'failed', message });
      assert.strictEqual(
        line,
        `${subject} did not complete: ${message}`,
        'the compiler\'s sentence is no longer one unbroken run in the rendered line',
      );
    }
  });

  it('reports a server that is not running as the failure it is, on all three', async () => {
    const notRunning = new Error('the Aggrega language server is not running');
    const outcomes = [
      (await runRegistryAdd(recorder({ add: notRunning }), 'registry.example.test', 'global')).outcome,
      await runRegistryRemove(
        recorder({ remove: notRunning }),
        'registry.example.test',
        'global',
      ),
      await runLogout(recorder({ logout: notRunning }), 'registry.example.test'),
    ];
    for (const outcome of outcomes) {
      assert.deepStrictEqual(outcome, {
        kind: 'failed',
        message: 'the Aggrega language server is not running',
      });
    }
  });
});

// --- one execution path per operation ------------------------------------

describe('the three registry changes reach the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES A ZERO MEAN
    // ANYTHING. A pattern that has stopped matching reports every module clean.
    // The control is a module the extension deliberately still launches from, so
    // it is on the same side of the claim as the subjects and moves independently
    // of them.
    assert.ok(
      launchFacilityCount('src/cli-json.ts') > 0,
      'the launch pattern no longer matches a module that provably launches, so every absence '
      + 'measured with it would pass vacuously',
    );
  });

  it('gives the module that decides the three changes no way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/registry-configure.ts'), 0);
  });

  it('leaves the panel with no call to any launch helper at all', () => {
    // 🔴 THE CONTROL LIVES OUTSIDE THE SUBJECT. The panel makes no launch of any
    // kind — the index build is a request, whose walk observes the request's own
    // context, so a stop reaches it — and so no count read from the panel's own
    // file can prove the reading live: a control read from the same file would be
    // asserting the very thing this test denies.
    //
    // So the subject is counted to zero across every helper, and the control is the
    // same patterns read over a module that provably launches.
    const sources = new Map(readSourceTree());
    const subject = sources.get('registries-view.ts') ?? '';
    const control = sources.get('workspace-catalog-view.ts') ?? '';
    const helpers = ['runCli', 'runCliJson', 'runWatchableCli'];
    const countIn = (source: string, helper: string): number => (
      source.match(new RegExp(`(?:^|[^a-zA-Z.])${helper}\\s*(?:<[^<>]*>)?\\s*\\(`, 'gm')) ?? []
    ).length;

    assert.deepStrictEqual(
      helpers.map((helper) => [helper, countIn(subject, helper)]),
      [['runCli', 0], ['runCliJson', 0], ['runWatchableCli', 0]],
      'the registries panel calls a launch helper again, so an operation that moved has a '
      + 'second execution path',
    );
    // The control: the same patterns, over a module whose launches are deliberate,
    // still count something. The zeros above are therefore absences rather than a
    // pattern that stopped matching or a file this test failed to read.
    assert.ok(
      helpers.some((helper) => countIn(control, helper) > 0),
      'the helper patterns match nothing in a module that provably launches, so the zeros '
      + 'above measure nothing',
    );
  });

  it('sends each of the three from exactly one place', () => {
    // Each request has one sender. A second would be a second execution path for
    // one operation, which is the shape a single execution path exists to rule
    // out. The method names are the compiler's identifiers, read from the surface
    // that sends them rather than restated as constants this side owns.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    for (const method of ['registryAdd', 'registryRemove', 'logout']) {
      const senders = files
        .filter((f) => new RegExp(`'aggrega/${method}'`).test(
          fs.readFileSync(path.join(dir, f), 'utf8'),
        ))
        .sort();
      assert.deepStrictEqual(
        senders,
        ['extension.ts'],
        `aggrega/${method} is sent from ${senders.length} place(s); one question with two `
        + 'senders is two execution paths',
      );
    }
  });

  it('composes no argument list for any registry operation, so none can be launched', () => {
    // 🔴 THE OLD PATTERN, SWEPT FOR RATHER THAN ASSUMED GONE. A retired composer
    // left standing with no caller is a launch waiting to be reached, and it
    // would be invisible to every assertion above: the requests would still be
    // sent from one place each, and the panel would still hold no launch.
    //
    // 🔴 THE INDEX BUILD IS IN THE RETIRED SET NOW, AND ITS ABSENCE IS WHY THIS
    // SWEEP HAD TO GROW A CORPUS. It was the positive control here, because it was
    // the one registry operation still invoked as a command; it is a request now,
    // so the module holds no composer at all — and a sweep of an empty module
    // reports every name absent whether or not one was written next door.
    const sources = readSourceTree();
    const retired = [
      'registryAddArgs',
      'registryRemoveArgs',
      'registryLogoutArgs',
      'registryUpdateAllArgs',
      'registryUpdateOneArgs',
    ];
    for (const name of retired) {
      const holders = sources
        .filter(([, source]) => new RegExp(`function\\s+${name}\\b`).test(source))
        .map(([file]) => file);
      assert.deepStrictEqual(
        holders,
        [],
        `${name} still composes a command line for an operation that is now a request`,
      );
    }
    // The positive control for this sweep: the same pattern shape, over the same
    // corpus, finds the composers that legitimately remain — an equality against a
    // set written here rather than a count derived from the walk, so the
    // expectation cannot agree with whatever the walk happened to find. Three are
    // operations still invoked as commands for reasons recorded at their own call
    // sites; the fourth is the arguments the language server itself is started
    // with, which is a launch that is never retired rather than an operation.
    const surviving = sources
      .flatMap(([file, source]) => (/function\s+[A-Za-z]+Args\b/.test(source) ? [file] : []))
      .sort();
    assert.deepStrictEqual(
      surviving,
      ['catalog-entity-operations.ts', 'daemon.ts', 'operation-groups.ts', 'plugins-run.ts'],
      'the composer pattern no longer matches the composers that provably exist, so the '
      + 'absences above prove nothing',
    );
  });
});
