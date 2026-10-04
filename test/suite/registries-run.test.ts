// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  EMPTY_LABEL,
  FAILURE_LABEL,
  RegistryEntry,
  RegistryListDoc,
  RegistryNode,
  RegistryRow,
  registryNodes,
  registrySubject,
  rowForRegistry,
} from '../../src/registries-run';
import { indexBuildRequest } from '../../src/registry-index-request';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';
import { workspaceCatalogNodes } from '../../src/workspace-catalog-run';

// The published listing shape says an entry always carries its default flag, its
// credential state and its trust posture, so a fixture omitting one of them is
// not something this compiler can send. These fixtures omit them deliberately:
// the rendering's defence against a peer that is NOT this compiler is what they
// exercise, and an untested defence is one nobody can show working. The cast is
// what lets an unreachable state be driven at all.
function fromANonConformingPeer(entry: Partial<RegistryEntry> & { host: string }): RegistryEntry {
  return entry as RegistryEntry;
}

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

interface Harness {
  nodes(): Promise<RegistryNode[]>;
  log: FakeLog;
  invocations(): number;
}

// harness builds the run's dependency set over a recorder and a caller-supplied
// answer for the request, so a test reads back exactly the rows an author would
// have seen in the view.
function harness(
  root: string | null,
  answer: () => Promise<RegistryListDoc>,
  running = true,
): Harness {
  const log = new FakeLog();
  let calls = 0;
  return {
    log,
    invocations: () => calls,
    nodes: () =>
      registryNodes({
        getWorkspaceRoot: () => root,
        isLanguageServerRunning: () => running,
        runRegistryList: () => {
          calls++;
          return answer();
        },
        log,
      }),
  };
}

function ok(doc: RegistryListDoc): () => Promise<RegistryListDoc> {
  return () => Promise.resolve(doc);
}

function rowsOf(nodes: RegistryNode[]): RegistryRow[] {
  return nodes.flatMap((n) => (n.kind === 'entry' ? [n.row] : []));
}

function labelsOf(nodes: RegistryNode[]): string[] {
  return nodes.map((n) => (n.kind === 'entry' ? n.row.label : n.label));
}

// MEASURED_DOCUMENT is the document the command emitted for a configuration
// declaring three registries — one with an alias and signatures required, one
// with an alias and no default, and one with no alias at all. It is kept
// verbatim so the shaping is asserted against what the product actually sends
// rather than against a hand-tidied approximation of it.
const MEASURED_DOCUMENT: RegistryListDoc = {
  registries: [
    {
      host: 'alpha.example.test',
      default: false,
      authState: 'none',
      trust: { signaturesRequired: false },
    },
    {
      host: 'mid.example.test',
      name: 'middle',
      default: true,
      authState: 'configured',
      trust: { signaturesRequired: false },
    },
    {
      host: 'zulu.example.test',
      name: 'zulu',
      default: false,
      authState: 'none',
      trust: { signaturesRequired: true },
    },
  ],
  credentialStateIsMachineWide: true,
};

describe('registryNodes', () => {
  it('populates one row per configured registry, in the order the product emitted', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT));
    const nodes = await h.nodes();

    assert.deepStrictEqual(labelsOf(nodes), [
      'alpha.example.test',
      'mid.example.test',
      'zulu.example.test',
    ]);
    assert.strictEqual(rowsOf(nodes).length, 3);
  });

  it('names the host, the alias where there is one, the default, the trust and the credential', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows[1].label, 'mid.example.test');
    assert.strictEqual(rows[1].description, 'middle · default · signatures optional · credential configured');
    assert.strictEqual(
      rows[1].tooltip,
      ['host: mid.example.test', 'alias: middle', 'default registry', 'trust: signatures optional', 'credential: configured'].join('\n'),
    );

    assert.strictEqual(rows[2].description, 'zulu · signatures required · no credential');
  });

  it('renders a registry with no alias without an empty placeholder', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT));
    const rows = rowsOf(await h.nodes());

    // No leading separator, no blank segment, and no alias line in the tooltip.
    assert.strictEqual(rows[0].description, 'signatures optional · no credential');
    assert.ok(!rows[0].description.startsWith(' '));
    assert.ok(!rows[0].description.includes('··'));
    assert.ok(!rows[0].tooltip.includes('alias:'));
  });

  it('marks the default registry and nothing else', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT));
    const rows = rowsOf(await h.nodes());
    const marked = rows.filter((r) => r.description.split(' · ').includes('default'));

    assert.deepStrictEqual(marked.map((r) => r.label), ['mid.example.test']);
    assert.strictEqual(rows[1].icon, 'star-full');
    assert.strictEqual(rows[0].icon, 'cloud');
  });

  it('marks no registry when the configured default names a host that is not configured', async () => {
    // Measured state: with default_registry naming an absent host, every entry
    // carries default:false. A view that assumed a default exists would be
    // wrong here, so the absence is asserted rather than assumed away.
    const h = harness('/ws', ok({
      registries: [
        { host: 'alpha.example.test', default: false, authState: 'none', trust: { signaturesRequired: false } },
        { host: 'zulu.example.test', default: false, authState: 'none', trust: { signaturesRequired: false } },
      ],
      credentialStateIsMachineWide: true,
    }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((r) => !r.description.split(' · ').includes('default')));
    assert.ok(rows.every((r) => r.icon === 'cloud'));
    assert.ok(rows.every((r) => !r.tooltip.includes('default registry')));
  });

  it('renders a credential state it has no phrase for as itself, never as "none"', async () => {
    const h = harness('/ws', ok({
      registries: [fromANonConformingPeer({
        host: 'a.example.test',
        authState: 'from-helper',
        trust: { signaturesRequired: false },
      })],
      credentialStateIsMachineWide: true,
    }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows[0].description, 'signatures optional · credential: from-helper');
    assert.ok(rows[0].tooltip.includes('credential: from-helper'));
    assert.ok(!rows[0].description.includes('no credential'));
  });

  it('says nothing about a state the product did not report', async () => {
    const h = harness('/ws', ok({
      registries: [fromANonConformingPeer({ host: 'a.example.test' })],
      credentialStateIsMachineWide: true,
    }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows[0].label, 'a.example.test');
    assert.strictEqual(rows[0].description, '');
    assert.strictEqual(rows[0].tooltip, 'host: a.example.test');
  });

  it('a configuration naming no registry is a successful empty answer, in the product\'s own words', async () => {
    const h = harness('/ws', ok({ registries: [], credentialStateIsMachineWide: true }));
    assert.deepStrictEqual(await h.nodes(), [{ kind: 'message', label: EMPTY_LABEL }]);
    assert.strictEqual(EMPTY_LABEL, 'No registries configured.');
  });

  it('a failed enumeration does not look like an empty list, and carries the product\'s message', async () => {
    const message = 'aggrega registry list: unknown --output value "nonsense"; expected one of table, json';
    const h = harness('/ws', () => Promise.reject(new Error(message)));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: FAILURE_LABEL, detail: message }]);
    assert.notStrictEqual(FAILURE_LABEL, EMPTY_LABEL);
    // The product's own text reaches the reader verbatim, not re-worded.
    assert.deepStrictEqual(h.log.lines, [message]);
  });

  it('asks nothing when nothing is anchored', async () => {
    const h = harness(null, ok(MEASURED_DOCUMENT));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }]);
    assert.strictEqual(h.invocations(), 0);
  });

  it('asks nothing of a language server that is not running, and draws the Catalog panel’s row offering to start it', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT), false);
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{
      kind: 'message',
      label: 'The Aggrega language server is not running.',
      detail: 'The Aggrega language server is not running, so the operations that ask it a question are unavailable. Click to start it.',
      press: { command: 'aggrega.server.restart', title: 'Start the Aggrega language server' },
    }]);
    assert.strictEqual(h.invocations(), 0);
    assert.deepStrictEqual(h.log.lines, [], 'a state is not a failure, so nothing is written to the channel');
    // The same row the Catalog panel draws for the same state, by equality.
    const catalog = await workspaceCatalogNodes({
      getWorkspaceRoot: () => '/ws',
      isLanguageServerRunning: () => false,
      requestCatalogIndex: () => Promise.reject(new Error('not asked')),
      entityKinds: () => Promise.reject(new Error('not asked')),
      log: new FakeLog(),
    });
    assert.deepStrictEqual(nodes, catalog);
  });

  it('asks again on every enumeration, so a refresh repopulates from the compiler', async () => {
    let doc: RegistryListDoc = {
      registries: [fromANonConformingPeer({ host: 'a.example.test' })],
      credentialStateIsMachineWide: true,
    };
    const h = harness('/ws', () => Promise.resolve(doc));

    assert.deepStrictEqual(labelsOf(await h.nodes()), ['a.example.test']);
    doc = {
      registries: [
        fromANonConformingPeer({ host: 'a.example.test' }),
        fromANonConformingPeer({ host: 'b.example.test' }),
      ],
      credentialStateIsMachineWide: true,
    };
    assert.deepStrictEqual(labelsOf(await h.nodes()), ['a.example.test', 'b.example.test']);
    assert.strictEqual(h.invocations(), 2);
  });

  it('🔴 A LANGUAGE-SERVER REFUSAL CARRIES THE COMPILER’S TEXT, NOT "[object Object]"', async () => {
    // The transport rejects with the raw error member — an envelope object, not
    // an error — so a reading of its own here would put [object Object] in the
    // row's detail AND in the channel. The equality is on the whole message,
    // because a substring check passes on a wrapper that dropped the text.
    const h = harness('/ws', () => Promise.reject({
      code: -32603,
      message: 'the daemon holds no resolved workspace to report configured registries for',
    }));
    const nodes = await h.nodes();
    const rendered = 'the daemon holds no resolved workspace to report configured registries for';

    assert.deepStrictEqual(nodes, [
      { kind: 'message', label: FAILURE_LABEL, detail: rendered },
    ]);
    assert.deepStrictEqual(h.log.lines, [rendered]);
  });

  it('a refusal still never reads as "no registries configured"', async () => {
    // One means the reader has configured none; the other means the set is not
    // known. That distinction must survive the rejection shape changing.
    const h = harness('/ws', () => Promise.reject({ code: -32603, message: 'unavailable' }));
    assert.deepStrictEqual(labelsOf(await h.nodes()), [FAILURE_LABEL]);
    assert.notStrictEqual(FAILURE_LABEL, EMPTY_LABEL);
  });
});

describe('rowForRegistry', () => {
  it('treats a missing default flag as no claim of being the default', () => {
    const row = rowForRegistry(fromANonConformingPeer({
      host: 'a.example.test',
      trust: { signaturesRequired: true },
    }));
    assert.strictEqual(row.description, 'signatures required');
    assert.strictEqual(row.icon, 'cloud');
  });

  it('uses the command\'s own words for both trust postures', () => {
    assert.ok(
      rowForRegistry(fromANonConformingPeer({ host: 'a', trust: { signaturesRequired: true } }))
        .description.includes('signatures required'),
    );
    assert.ok(
      rowForRegistry(fromANonConformingPeer({ host: 'a', trust: { signaturesRequired: false } }))
        .description.includes('signatures optional'),
    );
  });

  it('carries the host as its own field, not only as the label a reader sees', () => {
    // The subject an operation is invoked with is read from this field. Were it
    // read back off the label, a later change to what a row displays would
    // silently change what its operations act on.
    const row = rowForRegistry(fromANonConformingPeer({
      host: 'a.example.test',
      name: 'alias',
      default: true,
    }));
    assert.strictEqual(row.host, 'a.example.test');
  });
});

describe('registrySubject', () => {
  it('reports the registry an entry row names', async () => {
    const h = harness('/ws', ok(MEASURED_DOCUMENT));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes.map(registrySubject), [
      'alpha.example.test',
      'mid.example.test',
      'zulu.example.test',
    ]);
  });

  it('reports no subject for a row that names no registry, so no operation can be composed', async () => {
    // The three message states in turn. Each is a real, reachable row, and an
    // operation invoked on one could only be invoked with no subject — which is
    // an invocation that cannot succeed, so none is offered.
    const configuredNone = await harness('/ws', ok({
      registries: [],
      credentialStateIsMachineWide: true,
    })).nodes();
    const failed = await harness('/ws', () => Promise.reject(new Error('boom'))).nodes();
    const unanchored = await harness(null, ok(MEASURED_DOCUMENT)).nodes();

    for (const nodes of [configuredNone, failed, unanchored]) {
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0].kind, 'message');
      assert.strictEqual(
        registrySubject(nodes[0]), null,
        'a message row must yield no subject',
      );
    }
  });

  it('yields a subject for every entry row and for no message row', async () => {
    const mixed: RegistryNode[] = [
      ...(await harness('/ws', ok(MEASURED_DOCUMENT)).nodes()),
      { kind: 'message', label: EMPTY_LABEL },
      { kind: 'message', label: FAILURE_LABEL, detail: 'detail' },
    ];
    const withSubject = mixed.filter((n) => registrySubject(n) !== null);

    assert.strictEqual(withSubject.length, 3);
    assert.ok(withSubject.every((n) => n.kind === 'entry'));
  });
});

describe('what a row carries into the request that acts on it', () => {
  it('carries the subject a row names through the one extractor', async () => {
    // The end-to-end shape the panel actually uses: a row, through the one
    // extractor, into the request that narrows an index build to it. This is the
    // assertion that fails if a row ever stops carrying its subject.
    //
    // 🔴 AN EQUALITY, NOT A MEMBERSHIP TEST. Asserting that the request merely
    // MENTIONS the host passes on one that carries it under the wrong key, or
    // alongside a field this surface does not send — so the whole request object
    // is compared against a literal written here.
    const nodes = await harness('/ws', ok(MEASURED_DOCUMENT)).nodes();
    const host = registrySubject(nodes[1]);
    assert.ok(host);
    assert.deepStrictEqual(
      indexBuildRequest(host),
      { registry: 'mid.example.test' },
    );
  });

  it('composes an argument list for nothing at all, because every registry operation is a request', () => {
    // 🔴 A COUNT OVER THE MODULE'S OWN EXPORTS, AND IT IS NOW ZERO. Five composers
    // were retired here as their operations became requests, the index build last,
    // and a presence check on a survivor would have gone on passing had any of them
    // been left standing with no caller — which is the shape that keeps a second
    // execution path reachable while every other assertion reads clean.
    const module: Record<string, unknown> = require('../../src/registries-run');
    const composers = Object.keys(module).filter((name) => name.endsWith('Args')).sort();
    assert.deepStrictEqual(
      composers,
      [],
      'a registry operation gained an argument list; a composer with no caller is a launch '
      + 'waiting to be reached',
    );
    // The control for that zero: the same filter, over a set it CAN match, still
    // picks out a composer-shaped name. An empty answer above is therefore an empty
    // module rather than a filter that stopped working.
    assert.deepStrictEqual(
      ['registryUpdateAllArgs', 'registryNodes'].filter((name) => name.endsWith('Args')),
      ['registryUpdateAllArgs'],
      'the composer filter no longer matches a composer-shaped name, so the zero above would '
      + 'pass vacuously',
    );
  });
});
