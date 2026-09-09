// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  ATTACHMENT_SUBJECT,
  PluginAddParams,
  PluginAddResult,
  attachmentDetail,
  attachmentProgressTitle,
  attachmentRequest,
  runPluginAttachment,
} from '../../src/plugin-attachment';
import { ATTACHABLE_PLUGIN_TYPES, GOVERNANCE_ROLES } from '../../src/plugins-run';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import {
  EXTENSION_ROOT,
  assertCensusInstrumentFires,
  launchFacilityCount,
} from '../helpers/launch-census';

// This spec drives the whole attachment decision with no transport, no editor and
// no process: every sentence a reader meets is read back here, and every request
// this side would send is recorded rather than sent.
//
// 🔴 EVERY EXPECTED SENTENCE BELOW IS AN INDEPENDENT LITERAL. Composing an
// expectation from the module's own helpers would put the implementation on both
// sides of the comparison, and such a test proves the two agree while accepting
// any wording at all — including one that lost the compiler's words.
//
// The per-module launch census is not repeated here. It lives once, over the whole
// source tree, in the helper that declares it and the spec that asserts it; a
// module-scoped copy of the same question would be the reading whichever spec held
// it consulted.

// A recorded transport. It answers with whatever it was given and keeps every
// request and every signal, so what was sent is a measurement rather than an
// inference.
function recorder(answer: PluginAddResult | unknown): {
  deps: { addPlugin(params: PluginAddParams, signal?: CancellationSignal): Promise<PluginAddResult> };
  sent: PluginAddParams[];
  signals: Array<CancellationSignal | undefined>;
} {
  const sent: PluginAddParams[] = [];
  const signals: Array<CancellationSignal | undefined> = [];
  return {
    sent,
    signals,
    deps: {
      addPlugin(params: PluginAddParams, signal?: CancellationSignal): Promise<PluginAddResult> {
        sent.push(params);
        signals.push(signal);
        if (answer instanceof Error || (answer && typeof (answer as { code?: unknown }).code === 'number')) {
          return Promise.reject(answer);
        }
        return Promise.resolve(answer as PluginAddResult);
      },
    },
  };
}

// A socket attachment as the compiler answers it: the version it pinned, and the
// project's own configuration file it wrote.
const ATTACHED: PluginAddResult = {
  type: 'linter',
  identity: 'linter/publishing-conventions:1.4.0',
  scope: {
    configFile: '/work/project/aggrega.yaml',
    machineWide: false,
    workspaceRoot: '/work/project',
  },
};

// A provider binding as the compiler answers it: the artifact identity it bound
// and the capability that binding now serves.
const BOUND: PluginAddResult = {
  type: 'provider',
  uri: 'oci://registry.example.test/plugin/provider/helm',
  capability: 'helm',
  scope: {
    configFile: '/work/project/aggrega.yaml',
    machineWide: false,
    workspaceRoot: '/work/project',
  },
};

// The compiler's own refusal for a term matching more than one plugin, quoted
// from the shared operation's wording. It is a literal here on purpose: the point
// of the assertions using it is that this side does not re-word it.
const REFUSAL_CODE = -32602;
const COMPILER_REFUSAL =
  'aggrega plugin add: "cel" matches 2 governance plugins (plugin/governance/cel-guard, '
  + 'plugin/governance/cel-policy); narrow the query to one';

// --- what the request carries --------------------------------------------

describe('the attachment request carries what the compiler needs and nothing it refuses', () => {
  it('carries exactly the type and the search term for a socket attachment', () => {
    // 🔴 A KEY-SET EQUALITY RATHER THAN A PRESENCE CHECK. A presence check on the
    // type and the term would pass with any further field added, and two of the
    // fields the operation accepts change which file is written while a third is
    // refused outright on every type this surface offers.
    assert.deepStrictEqual(
      Object.keys(attachmentRequest({ type: 'linter', query: 'publishing' })).sort(),
      ['query', 'type'],
    );
  });

  it('carries the capability on a provider binding, and on nothing else', () => {
    assert.deepStrictEqual(
      attachmentRequest({ type: 'provider', query: 'helm', capability: 'helm' }),
      { type: 'provider', query: 'helm', capability: 'helm' },
    );
    assert.ok(
      !('capability' in attachmentRequest({ type: 'linter', query: 'publishing' })),
      'a socket attachment carries a capability field the operation refuses on that type',
    );
  });

  it('carries the role on a governance attachment, and on nothing else', () => {
    assert.deepStrictEqual(
      attachmentRequest({ type: 'governance', query: 'cel', role: 'ir-verdict' }),
      { type: 'governance', query: 'cel', role: 'ir-verdict' },
    );
    assert.ok(
      !('role' in attachmentRequest({ type: 'importer', query: 'langflow' })),
      'an importer attachment carries a role field the operation refuses on that type',
    );
  });

  it('sends no write-target override on any type it offers, so the default stands', () => {
    // 🔴 THE ABSENCE IS THE CONTRACT. Every type this surface offers is scoped to
    // one project's build, so the operation's own default is this project's
    // configuration file — which is what the question asking for a search term
    // already tells the reader. Sending an override would decide for the operator a
    // setting that is theirs, and sending both is refused outright.
    for (const type of ATTACHABLE_PLUGIN_TYPES) {
      const params = attachmentRequest({
        type,
        query: 'anything',
        capability: type === 'provider' ? 'helm' : undefined,
        role: type === 'governance' ? 'ir-verdict' : undefined,
      });
      const keys = Object.keys(params);
      assert.ok(!keys.includes('global'), `${type} sends a global override`);
      assert.ok(!keys.includes('workspace'), `${type} sends a workspace override`);
    }
  });

  it('sends no capability consent, which the operation refuses on every type it offers', () => {
    // 🔴 THIS ONE PINS A MEASUREMENT, NOT A PREFERENCE. The consent field belongs
    // to the command-extension type, which this surface does not offer; the shared
    // operation refuses that field on every other type, naming it as applying to
    // that one alone. So sending it would not grant a consent nobody gave — it
    // would halt the attachment before anything was searched for.
    for (const type of ATTACHABLE_PLUGIN_TYPES) {
      const params = attachmentRequest({
        type,
        query: 'anything',
        capability: type === 'provider' ? 'helm' : undefined,
        role: type === 'governance' ? 'ir-verdict' : undefined,
      });
      assert.ok(
        !Object.keys(params).includes('acceptCapabilities'),
        `${type} sends a capability consent, which the operation refuses on that type`,
      );
    }
  });

  it('every type it offers composes a request, and every role too', () => {
    // The offered sets are the ones the control reads, so what is claimed here is
    // that nothing the reader can pick composes a request the compiler refuses.
    // That the sets are the right sets is asserted where they are declared, against
    // literals this module does not read.
    for (const type of ATTACHABLE_PLUGIN_TYPES) {
      const params = attachmentRequest({
        type,
        query: 'anything',
        capability: type === 'provider' ? 'helm' : undefined,
        role: type === 'governance' ? 'ir-verdict' : undefined,
      });
      assert.strictEqual(params.type, type);
      assert.strictEqual(params.query, 'anything');
    }
    for (const role of GOVERNANCE_ROLES) {
      assert.deepStrictEqual(
        attachmentRequest({ type: 'governance', query: 'cel', role }),
        { type: 'governance', query: 'cel', role },
      );
    }
  });

  it('refuses a provider binding with no capability, before anything is sent', () => {
    assert.throws(() => attachmentRequest({ type: 'provider', query: 'helm' }), /capability/);
  });

  it('refuses a governance attachment with no role, before anything is sent', () => {
    assert.throws(() => attachmentRequest({ type: 'governance', query: 'cel' }), /role/);
  });

  it('refuses a capability or a role on a type that does not accept one', () => {
    // The shared operation treats either as a refusal, so composing one builds a
    // request that cannot succeed — and refusing it here tells the reader what the
    // operation needed instead of spending a round trip to hear it.
    assert.throws(
      () => attachmentRequest({ type: 'linter', query: 'publishing', capability: 'helm' }),
      /only to the provider type/,
    );
    assert.throws(
      () => attachmentRequest({ type: 'linter', query: 'publishing', role: 'ir-verdict' }),
      /only to the governance type/,
    );
  });

  it('refuses with no search term and with no type', () => {
    assert.throws(() => attachmentRequest({ type: 'linter', query: '' }), /a name to search/);
    assert.throws(() => attachmentRequest({ type: '', query: 'publishing' }), /takes the plugin's type/);
  });

  it('trims the answers the reader typed, so a stray space is not a different plugin', () => {
    assert.deepStrictEqual(
      attachmentRequest({ type: '  linter  ', query: '  publishing  ' }),
      { type: 'linter', query: 'publishing' },
    );
    assert.strictEqual(
      attachmentRequest({ type: 'provider', query: 'helm', capability: '  helm  ' }).capability,
      'helm',
    );
  });

  it('sends exactly one request, carrying exactly what was composed', async () => {
    // 🔴 A COUNT AND AN EQUALITY. "A request was sent" passes when two are sent,
    // and two sends for one operation is the second execution path this change
    // removes.
    const r = recorder(ATTACHED);
    await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' });
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.sent, [{ type: 'linter', query: 'publishing' }]);
  });

  it('sends nothing at all when an answer names nothing, and says so', async () => {
    // The refusal is REPORTED rather than thrown past the reader, and the count is
    // the half that matters: nothing reached the compiler.
    const r = recorder(ATTACHED);
    const outcome = await runPluginAttachment(r.deps, { type: 'linter', query: '  ' });
    assert.strictEqual(r.sent.length, 0, 'a blank search term reached the compiler');
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: 'aggrega plugin add takes a name to search the registry for, and none was given',
    });
  });
});

// --- the stop ------------------------------------------------------------

describe('the attachment offers a stop, and the stop reaches the request', () => {
  it('takes a stop, and keeps taking one', () => {
    // 🔴 THE ARITY IS THE ASSERTION. The removal beside it deliberately takes no
    // signal, because its shared work accepts no cancellation and a stop would only
    // stop this side waiting. This one is the opposite case and the arity records
    // it, so removing the parameter has to be argued rather than slipped in.
    assert.strictEqual(runPluginAttachment.length, 3);
  });

  it("hands the reader's own signal to the request, not one of its own", async () => {
    // An IDENTITY comparison rather than a "a signal arrived" check: a module that
    // manufactured its own signal would satisfy the weaker reading while the
    // reader's cancel reached nothing.
    const signal: CancellationSignal = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() { /* nothing to release */ } }),
    };
    const r = recorder(ATTACHED);
    await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' }, signal);
    assert.strictEqual(r.signals.length, 1);
    assert.strictEqual(r.signals[0], signal);
  });

  it('reports an attachment the reader stopped as stopped, never as broken', async () => {
    // The reader who stopped it must not be told it failed. The classification is by
    // the thrown value's TYPE rather than by its message, which is why the fixture is
    // the real rejection rather than an error wearing its name.
    const r = recorder(new OperationCancelled(ATTACHMENT_SUBJECT));
    const outcome = await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' });
    assert.strictEqual(outcome.kind, 'cancelled');
    assert.strictEqual(
      terminalLine(ATTACHMENT_SUBJECT, outcome),
      'The attachment stopped at your request.',
    );
  });

  it('names the search in the indicator, because searching is what the wait is', () => {
    assert.strictEqual(
      attachmentProgressTitle('linter'),
      'Aggrega: searching the registry for a linter plugin',
    );
  });
});

// --- what the reader is left with ----------------------------------------

describe('the ending is composed from the answer', () => {
  it('names the plugin the search resolved to, what it was attached as, and where', () => {
    assert.strictEqual(
      terminalLine(ATTACHMENT_SUBJECT, { kind: 'ok', detail: attachmentDetail(ATTACHED) }),
      'The attachment added linter/publishing-conventions:1.4.0 as a linter plugin in '
      + "/work/project/aggrega.yaml, this project's own configuration file.",
    );
  });

  it('names the capability and the artifact identity for a provider binding', () => {
    assert.strictEqual(
      terminalLine(ATTACHMENT_SUBJECT, { kind: 'ok', detail: attachmentDetail(BOUND) }),
      'The attachment bound capability helm to '
      + 'oci://registry.example.test/plugin/provider/helm in /work/project/aggrega.yaml, '
      + "this project's own configuration file.",
    );
  });

  it('reads the pinned version off the ANSWER, not off the term that was searched', () => {
    // 🔴 THE FACT THIS MOVE EXISTS FOR. The old ending echoed the type and the term
    // the reader typed and named nothing the compiler measured — so a reader could
    // not tell which plugin the term resolved to, nor which version was pinned.
    const line = attachmentDetail(ATTACHED);
    assert.ok(line.includes('linter/publishing-conventions:1.4.0'));
    assert.ok(
      !line.includes('publishing plugin'),
      'the ending echoes the search term rather than what the search resolved to',
    );
  });

  it('reads grammatically for a vowel-initial type, which one of the four is', () => {
    // 🔴 CAUGHT BY DRIVING THE OPERATION, NOT BY AN ASSERTION. Three of the four
    // types this surface offers begin with a consonant, so a fixed article reads
    // correctly for them and wrongly for the fourth — and a spec that exercised
    // only the three would never have shown it. The article is read off the type,
    // because the type is a value the compiler owns and its set grows.
    const importer: PluginAddResult = {
      type: 'importer',
      identity: 'importer/langflow:2.0.0',
      scope: ATTACHED.scope,
    };
    assert.strictEqual(
      attachmentDetail(importer),
      "added importer/langflow:2.0.0 as an importer plugin in /work/project/aggrega.yaml, "
      + "this project's own configuration file.",
    );
    // The consonant case in the same assertion, so a repair that flipped the test
    // rather than the rule fails from the other side.
    assert.ok(attachmentDetail(ATTACHED).includes('as a linter plugin'));
  });

  it('reads the file and the reach off the ANSWER, not off the request', () => {
    // The request names no destination at all, so an ending describing one could
    // only have invented it. An answer reporting the machine-wide file must be
    // described as machine-wide even though nothing asked for it.
    const machineWide: PluginAddResult = {
      ...ATTACHED,
      scope: {
        configFile: '/home/reader/.config/aggrega/config.yaml',
        machineWide: true,
        workspaceRoot: '/work/project',
      },
    };
    assert.strictEqual(
      attachmentDetail(machineWide),
      'added linter/publishing-conventions:1.4.0 as a linter plugin in '
      + '/home/reader/.config/aggrega/config.yaml, the global file shared by every project '
      + 'on this machine.',
    );
  });

  it('describes an answer that named neither identity without naming an absent value', () => {
    // No type this surface offers produces such an answer, and a sentence built from
    // a missing field would read as a plugin called undefined. What is said is what
    // is certain.
    const neither: PluginAddResult = { type: 'linter', scope: ATTACHED.scope };
    const line = attachmentDetail(neither);
    assert.strictEqual(
      line,
      "added a linter plugin in /work/project/aggrega.yaml, this project's own configuration file.",
    );
    assert.ok(!line.includes('undefined'));
  });
});

// --- the compiler diagnostic, unaltered ----------------------------------

describe('a refusal reaches the reader as the compiler wrote it', () => {
  it('renders the refusal exactly, character for character, prefix included', async () => {
    // 🔴 THE WHOLE LINE AS AN EQUALITY. The extension's one rendering home prefixes
    // a transport refusal with its code, and that prefix is ADDITIVE — the
    // compiler's sentence follows it unaltered. Asserting only that the sentence
    // appears somewhere would pass a line that wrapped it in a message of this
    // surface's own.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const outcome = await runPluginAttachment(r.deps, { type: 'governance', query: 'cel', role: 'ir-verdict' });
    assert.strictEqual(
      terminalLine(ATTACHMENT_SUBJECT, outcome),
      'The attachment did not complete: code=-32602 aggrega plugin add: "cel" matches 2 '
      + 'governance plugins (plugin/governance/cel-guard, plugin/governance/cel-policy); '
      + 'narrow the query to one',
    );
  });

  it('composes the same line from its three parts, so a reflow fails structurally', async () => {
    // The second half of the assertion above, and the one that survives a rewording
    // of the compiler's own sentence: the line must be the subject, then the code
    // prefix, then the compiler's text — with nothing of this surface's interleaved.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const outcome = await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' });
    assert.strictEqual(
      terminalLine(ATTACHMENT_SUBJECT, outcome),
      `${ATTACHMENT_SUBJECT} did not complete: code=${REFUSAL_CODE} ${COMPILER_REFUSAL}`,
    );
  });

  it('keeps the facts the refusal named, which a wrapper message would discard', async () => {
    // The load-bearing halves of the compiler's sentence: the candidates it found,
    // and the remedy naming what to do about them. A reader acts on both.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const outcome = await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' });
    const line = terminalLine(ATTACHMENT_SUBJECT, outcome);
    assert.ok(line.includes('plugin/governance/cel-guard'));
    assert.ok(line.includes('narrow the query to one'));
    assert.ok(
      !line.includes('[object Object]'),
      'a refusal rendered as [object Object] loses the whole diagnostic',
    );
  });

  it('carries the message of a transport failure that is a real error', async () => {
    // Not every failure is a refusal: a request sent while no server is running
    // throws an ordinary error, and its sentence names the state to fix.
    const r = recorder(new Error('the Aggrega language server is not running'));
    const outcome = await runPluginAttachment(r.deps, { type: 'linter', query: 'publishing' });
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: 'the Aggrega language server is not running',
    });
  });
});

// --- one execution path --------------------------------------------------

describe('the attachment reaches the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES A ZERO MEAN ANYTHING.
    // A pattern that has stopped matching reports every module clean, so a census
    // without a control cannot tell an absence from a dead instrument.
    assertCensusInstrumentFires((value, message) => assert.ok(value, message));
  });

  it('gives the module that decides an attachment no way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/plugin-attachment.ts'), 0);
  });

  it('gives that module no way to reach a process or an editor at all', () => {
    // Read as the WHOLE import list, so a module added to it has to be looked at —
    // including one that could start a process and one that would carry the editor
    // in, which is what keeps the attachment decision readable without a host.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/plugin-attachment.ts'), 'utf8');
    const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      imported.sort(),
      [
        './cancellation',
        './config-write-scope',
        './operation-groups',
        './operation-outcome',
        './plugins-run',
      ],
    );
  });

  it('sends the attachment from exactly one place', () => {
    // One question with two senders is two execution paths. The method name is the
    // compiler's identifier, read from the surface that sends it rather than
    // restated as a constant this side owns.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const senders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /'aggrega\/pluginAdd'/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(
      senders,
      ['extension.ts'],
      `aggrega/pluginAdd is sent from ${senders.length} place(s)`,
    );
  });

  it('composes no argument list for an attachment, so it cannot be launched', () => {
    // 🔴 THE OLD PATTERN, SWEPT FOR RATHER THAN ASSUMED GONE. A retired composer
    // left standing with no caller is a launch waiting to be reached, and it would
    // be invisible to every assertion above: the request would still be sent from
    // one place, and the panel would still hold no watched launch.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/plugins-run.ts'), 'utf8');
    assert.ok(
      !/function\s+pluginAddArgs\b/.test(source),
      'pluginAddArgs still composes a command line for an operation that is now a request',
    );
    // The positive control for this sweep: the pattern still finds a composer that
    // legitimately remains, so the absence above is an absence.
    assert.ok(
      /function\s+pluginGenCatalogArgs\b/.test(source),
      'the composer pattern no longer matches a composer that provably exists, so the absence '
      + 'above would pass vacuously',
    );
  });

  it('leaves the retired composer named nowhere in the source tree', () => {
    // A tree-wide COUNT rather than a check of the one module that declared the
    // composition: a call left behind elsewhere would not compile, but a name
    // surviving in a comment would read as though the composition were the path.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const holders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bpluginAddArgs\b/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(holders, []);
  });
});
