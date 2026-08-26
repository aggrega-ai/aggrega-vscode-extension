// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  CONFIGURED_GROUP_LABEL,
  EMBEDDED_GROUP_LABEL,
  FAILURE_LABEL,
  PluginEntry,
  PluginListDoc,
  PluginNode,
  PluginRow,
  isNoteworthyReadiness,
  nodesForDocument,
  pluginNodes,
  rowForPlugin,
} from '../../src/plugins-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

interface Harness {
  nodes(): Promise<PluginNode[]>;
  log: FakeLog;
  invocations(): number;
}

function harness(
  root: string | null,
  answer: () => Promise<{ doc: PluginListDoc; stderr: string }>,
): Harness {
  const log = new FakeLog();
  let calls = 0;
  return {
    log,
    invocations: () => calls,
    nodes: () =>
      pluginNodes({
        getWorkspaceRoot: () => root,
        runPluginListJson: () => {
          calls++;
          return answer();
        },
        log,
      }),
  };
}

function ok(doc: PluginListDoc): () => Promise<{ doc: PluginListDoc; stderr: string }> {
  return () => Promise.resolve({ doc, stderr: '' });
}

function groupsOf(nodes: PluginNode[]): Array<{ label: string; rows: PluginRow[] }> {
  return nodes.flatMap((n) => (n.kind === 'group' ? [{ label: n.label, rows: n.rows }] : []));
}

// --- fixtures ------------------------------------------------------------
//
// Every fixture below is a verbatim entry captured from the product's own
// `plugin list -o json`, so a test asserting on one asserts against a shape the
// product really emits rather than one this extension imagined.

// A governance guest: the minimum field set.
const GOVERNANCE_GUEST: PluginEntry = {
  uri: 'governance/cel',
  type: 'governance',
  version: '0.6.1-567-gf824b409-dirty',
  commit: 'f824b409',
  exports: ['verdict_ir', 'verdict_render', 'mutate', 'transform_annotations'],
};

// A provider guest: the widest embedded field set.
const PROVIDER_GUEST: PluginEntry = {
  uri: 'provider/helm',
  type: 'provider',
  version: '0.6.1-567-gf824b409-dirty',
  commit: 'f824b409',
  capabilities: ['helm'],
  inputKinds: ['sourced', 'synthesized', 'artifacts-standalone'],
  boundary: 'none',
  exports: ['render_node'],
};

// A configured provider binding: carries origin naming the config key.
const CONFIGURED_PROVIDER: PluginEntry = {
  ...PROVIDER_GUEST,
  origin: 'plugins.providers[0]',
};

// A configured attachment that could not be resolved: no type, no version, and
// the product's own error text.
const UNRESOLVED_BINDING: PluginEntry = {
  uri: '/w/linter/publishing',
  origin: 'plugins.linter[0]',
  error: 'read local plugin "/w/linter/publishing": open /w/linter/publishing: no such file or directory',
};

// A CLI-extension attachment: the only class that carries readiness, and the
// only place the install-time pin appears — inside origin, as the product's own
// shortened string.
const UNRESOLVED_CLI: PluginEntry = {
  uri: 'oci://hub.aggrega.ai/plugin/cli/example:1.0.0',
  origin: 'pinned 000000000000...',
  readiness: 'unresolved',
  error: 'plugin "oci://hub.aggrega.ai/plugin/cli/example:1.0.0" not resolvable',
};

// --- readiness -----------------------------------------------------------

describe('plugins-run: readiness', () => {
  it('an absent readiness is not noteworthy', () => {
    assert.strictEqual(isNoteworthyReadiness(undefined), false);
    assert.strictEqual(isNoteworthyReadiness(''), false);
  });

  it('ready is not noteworthy', () => {
    assert.strictEqual(isNoteworthyReadiness('ready'), false);
  });

  it('every abnormal label the product documents is noteworthy', () => {
    for (const label of ['unresolved', 'describe-failed', 'digest-drift']) {
      assert.strictEqual(isNoteworthyReadiness(label), true, label);
    }
  });

  it('a readiness value this build has never seen is treated as noteworthy', () => {
    // The value set belongs to the product and may grow. Erring toward
    // noteworthy is what keeps a future abnormal state from rendering as
    // healthy.
    assert.strictEqual(isNoteworthyReadiness('some-future-state'), true);
  });
});

// --- rows ----------------------------------------------------------------

describe('plugins-run: row shaping', () => {
  it('the label is the URI trailing segment and the tooltip carries the whole URI', () => {
    const row = rowForPlugin(GOVERNANCE_GUEST);
    assert.strictEqual(row.label, 'cel');
    assert.ok(row.tooltip.startsWith('governance/cel'));
  });

  it('a version-pinned reference keeps its pin in the label', () => {
    assert.strictEqual(rowForPlugin(UNRESOLVED_CLI).label, 'example:1.0.0');
  });

  it('the description carries type, version and readiness, and nothing absent', () => {
    assert.strictEqual(
      rowForPlugin(GOVERNANCE_GUEST).description,
      'governance · 0.6.1-567-gf824b409-dirty',
    );
  });

  it('an entry the product could not describe renders an empty description, not a blank-filled one', () => {
    // No type and no version arrived, so there is nothing to show. A separator
    // with nothing around it would read as a value that failed to load.
    assert.strictEqual(rowForPlugin(UNRESOLVED_BINDING).description, '');
  });

  it('readiness is carried through verbatim, with no re-wording', () => {
    const row = rowForPlugin(UNRESOLVED_CLI);
    assert.ok(row.description.includes('unresolved'), row.description);
    assert.ok(row.tooltip.includes('readiness: unresolved'), row.tooltip);
  });

  it('a future readiness value renders as itself', () => {
    const row = rowForPlugin({ ...UNRESOLVED_CLI, readiness: 'some-future-state' });
    assert.ok(row.description.includes('some-future-state'), row.description);
    assert.ok(row.tooltip.includes('readiness: some-future-state'), row.tooltip);
  });

  it('the install-time pin reaches the reader through origin, unparsed', () => {
    // The product carries the pin inside origin as its own shortened string.
    // It is shown as it arrived: nothing takes it apart to recover a digest.
    const row = rowForPlugin(UNRESOLVED_CLI);
    assert.ok(row.tooltip.includes('origin: pinned 000000000000...'), row.tooltip);
  });

  it('a configured binding names the config key it came from', () => {
    assert.ok(
      rowForPlugin(CONFIGURED_PROVIDER).tooltip.includes('origin: plugins.providers[0]'),
      'origin missing',
    );
  });

  it('the widest embedded entry surfaces every field the product sent', () => {
    const tooltip = rowForPlugin(PROVIDER_GUEST).tooltip;
    for (const expected of [
      'type: provider',
      'commit: f824b409',
      'capabilities: helm',
      'input kinds: sourced, synthesized, artifacts-standalone',
      'boundary: none',
      'exports: render_node',
    ]) {
      assert.ok(tooltip.includes(expected), `${expected} missing from:\n${tooltip}`);
    }
  });

  it('no field the product never sends is invented', () => {
    // The listing carries no digest key at all. A row must not grow one.
    const tooltip = rowForPlugin(UNRESOLVED_CLI).tooltip;
    assert.ok(!/^digest:/m.test(tooltip), tooltip);
    assert.ok(!/drift/i.test(rowForPlugin(PROVIDER_GUEST).tooltip));
  });

  it('an error and an abnormal readiness both mark the row', () => {
    assert.strictEqual(rowForPlugin(UNRESOLVED_BINDING).icon, 'warning');
    assert.strictEqual(
      rowForPlugin({ uri: 'x/y', readiness: 'digest-drift' }).icon,
      'warning',
    );
  });

  it('a healthy entry is not marked', () => {
    assert.strictEqual(rowForPlugin(PROVIDER_GUEST).icon, 'plug');
    assert.strictEqual(rowForPlugin({ uri: 'x/y', readiness: 'ready' }).icon, 'plug');
  });

  it('the error text is the product’s own, carried through', () => {
    assert.ok(
      rowForPlugin(UNRESOLVED_BINDING).tooltip.includes('no such file or directory'),
      'error text lost',
    );
  });
});

// --- documents -----------------------------------------------------------

describe('plugins-run: documents', () => {
  it('both groups are present, in the product’s order', () => {
    const groups = groupsOf(nodesForDocument({
      embedded: [GOVERNANCE_GUEST, PROVIDER_GUEST],
      configured: [CONFIGURED_PROVIDER],
    }));
    assert.deepStrictEqual(groups.map((g) => g.label), [
      EMBEDDED_GROUP_LABEL,
      CONFIGURED_GROUP_LABEL,
    ]);
    assert.deepStrictEqual(groups.map((g) => g.rows.length), [2, 1]);
  });

  it('an empty group is kept rather than dropped', () => {
    // A group reading zero is the answer. Dropping it would leave a reader
    // unable to tell "none are configured" from "they were not looked at".
    const groups = groupsOf(nodesForDocument({ embedded: [GOVERNANCE_GUEST], configured: [] }));
    assert.strictEqual(groups.length, 2);
    assert.deepStrictEqual(groups[1].rows, []);
  });

  it('a document missing a key renders as an empty group, not a crash', () => {
    const groups = groupsOf(nodesForDocument({}));
    assert.deepStrictEqual(groups.map((g) => g.rows.length), [0, 0]);
  });

  it('entry order within a group is the product’s', () => {
    const groups = groupsOf(nodesForDocument({ embedded: [PROVIDER_GUEST, GOVERNANCE_GUEST] }));
    assert.deepStrictEqual(groups[0].rows.map((r) => r.label), ['helm', 'cel']);
  });
});

// --- the run -------------------------------------------------------------

describe('plugins-run: the run', () => {
  it('nothing anchored means the command is never invoked', async () => {
    const h = harness(null, ok({}));
    const nodes = await h.nodes();
    assert.strictEqual(h.invocations(), 0);
    assert.deepStrictEqual(nodes, [
      { kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL },
    ]);
  });

  it('a failure becomes its own row carrying the product’s message', async () => {
    const message = 'workspaceconfig: /w/.aggrega-config.yaml: plugins.cli[0].digest: want "string"';
    const h = harness('/w', () => Promise.reject(new Error(message)));
    const nodes = await h.nodes();
    assert.deepStrictEqual(nodes, [
      { kind: 'message', label: FAILURE_LABEL, detail: message },
    ]);
    assert.deepStrictEqual(h.log.lines, [message]);
  });

  it('a failure never renders as an empty listing', async () => {
    const h = harness('/w', () => Promise.reject(new Error('boom')));
    const nodes = await h.nodes();
    assert.strictEqual(groupsOf(nodes).length, 0, 'a failure must not produce groups');
  });

  it('a non-Error rejection still reaches the reader', async () => {
    const h = harness('/w', () => Promise.reject('plain string'));
    const nodes = await h.nodes();
    assert.strictEqual(nodes[0].kind, 'message');
    assert.deepStrictEqual(h.log.lines, ['plain string']);
  });

  it('a report on stderr from a successful run is logged verbatim', async () => {
    // The command reports a configuration it had to ignore and keeps going.
    const warning = 'warning: configured CLI plugin "oci://…" is not registered';
    const h = harness('/w', () =>
      Promise.resolve({ doc: { embedded: [GOVERNANCE_GUEST] }, stderr: `${warning}\n` }));
    const nodes = await h.nodes();
    assert.deepStrictEqual(h.log.lines, [warning]);
    assert.strictEqual(groupsOf(nodes).length, 2, 'the listing still renders');
  });

  it('a silent stderr adds no log line', async () => {
    const h = harness('/w', ok({ embedded: [GOVERNANCE_GUEST] }));
    await h.nodes();
    assert.deepStrictEqual(h.log.lines, []);
  });
});
