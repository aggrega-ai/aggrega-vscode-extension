// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  EMPTY_LABEL,
  FAILURE_LABEL,
  RegistryListDoc,
  RegistryNode,
  RegistryRow,
  registryNodes,
  rowForRegistry,
} from '../../src/registries-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';

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
// answer for the command invocation, so a test reads back exactly the rows an
// author would have seen in the view.
function harness(
  root: string | null,
  answer: () => Promise<{ doc: RegistryListDoc; stderr: string }>,
): Harness {
  const log = new FakeLog();
  let calls = 0;
  return {
    log,
    invocations: () => calls,
    nodes: () =>
      registryNodes({
        getWorkspaceRoot: () => root,
        runRegistryListJson: () => {
          calls++;
          return answer();
        },
        log,
      }),
  };
}

function ok(doc: RegistryListDoc): () => Promise<{ doc: RegistryListDoc; stderr: string }> {
  return () => Promise.resolve({ doc, stderr: '' });
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
    }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((r) => !r.description.split(' · ').includes('default')));
    assert.ok(rows.every((r) => r.icon === 'cloud'));
    assert.ok(rows.every((r) => !r.tooltip.includes('default registry')));
  });

  it('renders a credential state it has no phrase for as itself, never as "none"', async () => {
    const h = harness('/ws', ok({
      registries: [{ host: 'a.example.test', authState: 'from-helper', trust: { signaturesRequired: false } }],
    }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows[0].description, 'signatures optional · credential: from-helper');
    assert.ok(rows[0].tooltip.includes('credential: from-helper'));
    assert.ok(!rows[0].description.includes('no credential'));
  });

  it('says nothing about a state the product did not report', async () => {
    const h = harness('/ws', ok({ registries: [{ host: 'a.example.test' }] }));
    const rows = rowsOf(await h.nodes());

    assert.strictEqual(rows[0].label, 'a.example.test');
    assert.strictEqual(rows[0].description, '');
    assert.strictEqual(rows[0].tooltip, 'host: a.example.test');
  });

  it('a configuration naming no registry is a successful empty answer, in the product\'s own words', async () => {
    const h = harness('/ws', ok({ registries: [] }));
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

  it('does not invoke the command when nothing is anchored', async () => {
    const h = harness(null, ok(MEASURED_DOCUMENT));
    const nodes = await h.nodes();

    assert.deepStrictEqual(nodes, [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }]);
    assert.strictEqual(h.invocations(), 0);
  });

  it('re-runs the command on every enumeration, so a refresh repopulates from the product', async () => {
    let doc: RegistryListDoc = { registries: [{ host: 'a.example.test' }] };
    const h = harness('/ws', () => Promise.resolve({ doc, stderr: '' }));

    assert.deepStrictEqual(labelsOf(await h.nodes()), ['a.example.test']);
    doc = { registries: [{ host: 'a.example.test' }, { host: 'b.example.test' }] };
    assert.deepStrictEqual(labelsOf(await h.nodes()), ['a.example.test', 'b.example.test']);
    assert.strictEqual(h.invocations(), 2);
  });
});

describe('rowForRegistry', () => {
  it('treats a missing default flag as no claim of being the default', () => {
    const row = rowForRegistry({ host: 'a.example.test', trust: { signaturesRequired: true } });
    assert.strictEqual(row.description, 'signatures required');
    assert.strictEqual(row.icon, 'cloud');
  });

  it('uses the command\'s own words for both trust postures', () => {
    assert.ok(
      rowForRegistry({ host: 'a', trust: { signaturesRequired: true } })
        .description.includes('signatures required'),
    );
    assert.ok(
      rowForRegistry({ host: 'a', trust: { signaturesRequired: false } })
        .description.includes('signatures optional'),
    );
  });
});
