// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  ATTACHABLE_PLUGIN_TYPES,
  CONFIGURED_GROUP_LABEL,
  EMBEDDED_GROUP_LABEL,
  FAILURE_LABEL,
  GOVERNANCE_ROLES,
  PLUGIN_CONFIG_ENTRY_ROW_CONTEXT,
  PLUGIN_ROW_CONTEXT,
  PluginEntry,
  PluginEntryNode,
  PluginListDoc,
  PluginNode,
  PluginRow,
  isNoteworthyReadiness,
  nodesForDocument,
  pluginGenCatalogArgs,
  pluginNodes,
  pluginRemovalConfigTarget,
  pluginRemovalSubject,
  pluginRowContext,
  rowForPlugin,
} from '../../src/plugins-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';

class FakeLog {
  lines: string[] = [];
  appendLine(text: string): void { this.lines.push(text); }
}

// BINARY is the compiler the harness's listing is run with.
const BINARY = '/opt/aggrega/bin/aggrega';

// notStarted is the runtime's failure to start a program, carrying the fields
// the runtime attaches to it: the condition's code, the system call that failed
// and the path it tried. The message is the runtime's own wording, which nothing
// under test is to read.
function notStarted(code: string): Error {
  return Object.assign(new Error(`spawn ${BINARY} ${code}`), { code, errno: -2, syscall: `spawn ${BINARY}`, path: BINARY });
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
        getBinaryPath: () => BINARY,
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
  return nodes.flatMap((n) =>
    n.kind === 'group' ? [{ label: n.label, rows: n.entries.map((e) => e.row) }] : []);
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

  it('a compiler not at its path is named as not found, with the setting a press away', async () => {
    const h = harness('/w', () => Promise.reject(notStarted('ENOENT')));
    const nodes = await h.nodes();
    assert.deepStrictEqual(nodes, [{
      kind: 'message',
      label: `The plugin list could not run: the compiler at ${BINARY} was not found.`,
      detail: `The plugin list could not run: the compiler at ${BINARY} was not found. Set aggrega.server.binaryPath to the aggrega binary. Click to open that setting.`,
      press: { command: 'workbench.action.openSettings', title: 'Open binary path setting', arguments: ['@id:aggrega.server.binaryPath'] },
    }]);
    assert.deepStrictEqual(h.log.lines, [
      `The plugin list could not run: the compiler at ${BINARY} was not found. Set aggrega.server.binaryPath to the aggrega binary.`,
    ]);
  });

  it('a file at the path that cannot be run is named as not executable', async () => {
    const h = harness('/w', () => Promise.reject(notStarted('EACCES')));
    const nodes = await h.nodes();
    assert.strictEqual(nodes[0].kind === 'message' ? nodes[0].label : '', `The plugin list could not run: ${BINARY} is not an executable file.`);
    assert.deepStrictEqual(h.log.lines, [
      `The plugin list could not run: ${BINARY} is not an executable file. Set aggrega.server.binaryPath to the aggrega binary.`,
    ]);
  });

  it('a listing that ran and exited is a failed listing, not a compiler that could not start', async () => {
    // The status a program exits with is a number on the same field a failure to
    // start carries its code on, and no system call is named.
    const exited = Object.assign(new Error('exit status 2'), { code: 2 });
    const h = harness('/w', () => Promise.reject(exited));
    assert.deepStrictEqual(await h.nodes(), [{ kind: 'message', label: FAILURE_LABEL, detail: 'exit status 2' }]);
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

// --- what a row hands an operation --------------------------------------
//
// A configured CLI attachment the product resolved is not captured above but
// assembled from the emitter's own field mapping: the type is the guest's
// describe() self-report, the version comes from its metadata, origin carries the
// install-time pin, and a resolved pin that still matches reads ready.
const CONFIGURED_CLI: PluginEntry = {
  uri: 'oci://hub.aggrega.ai/plugin/cli/example:1.0.0',
  type: 'cli',
  version: '1.0.0',
  origin: 'pinned 000000000000...',
  readiness: 'ready',
};

function entriesOf(nodes: PluginNode[]): PluginEntryNode[] {
  return nodes.flatMap((n) => (n.kind === 'group' ? n.entries : []));
}

function entryFor(entry: PluginEntry, group: 'embedded' | 'configured'): PluginEntryNode {
  const nodes = nodesForDocument(group === 'embedded' ? { embedded: [entry] } : { configured: [entry] });
  const found = entriesOf(nodes);
  assert.strictEqual(found.length, 1, 'the fixture produced no single entry node');
  return found[0];
}

describe('plugins-run: which group a plugin came from', () => {
  it('every plugin carries its own group, so expanding one loses nothing', () => {
    // The group decides what can be done to a plugin, so it has to survive the
    // step from the listing to the row. Reading it back off a heading's label
    // would tie an operation to a display string.
    const nodes = nodesForDocument({
      embedded: [GOVERNANCE_GUEST, PROVIDER_GUEST],
      configured: [CONFIGURED_PROVIDER],
    });
    assert.deepStrictEqual(
      entriesOf(nodes).map((e) => e.group),
      ['embedded', 'embedded', 'configured'],
    );
  });

  it('the group a node names is the group its heading names', () => {
    const groups = nodesForDocument({}).flatMap((n) => (n.kind === 'group' ? [n] : []));
    assert.deepStrictEqual(groups.map((g) => g.group), ['embedded', 'configured']);
    assert.deepStrictEqual(groups.map((g) => g.label), [
      EMBEDDED_GROUP_LABEL,
      CONFIGURED_GROUP_LABEL,
    ]);
  });
});

describe('plugins-run: the subject a row hands an operation', () => {
  it('a configured plugin hands over the type and the reference the product reported', () => {
    // Both come from the row's own fields. Neither is recovered from the label,
    // which is shortened, nor from the description, which joins several facts
    // into one string.
    assert.deepStrictEqual(pluginRemovalSubject(entryFor(CONFIGURED_PROVIDER, 'configured')), {
      type: 'provider',
      reference: 'provider/helm',
    });
  });

  it('the reference is the full identity, not the shortened label', () => {
    const node = entryFor(CONFIGURED_CLI, 'configured');
    assert.strictEqual(node.row.label, 'example:1.0.0');
    assert.strictEqual(
      pluginRemovalSubject(node)?.reference,
      'oci://hub.aggrega.ai/plugin/cli/example:1.0.0',
    );
  });

  it('a plugin built into the compiler hands over nothing', () => {
    // It is no configuration entry, so there is nothing a removal could edit.
    const node = entryFor(PROVIDER_GUEST, 'embedded');
    assert.strictEqual(pluginRemovalSubject(node), null);
    assert.strictEqual(pluginRowContext(node), PLUGIN_ROW_CONTEXT);
  });

  it('a configured plugin nothing answered for hands over nothing', () => {
    // The product reports no type for an entry it could not resolve or describe,
    // and a removal needs one. Offering it would compose an invocation missing an
    // argument the command requires.
    const node = entryFor(UNRESOLVED_BINDING, 'configured');
    assert.strictEqual(node.row.type, '');
    assert.strictEqual(pluginRemovalSubject(node), null);
    assert.strictEqual(pluginRowContext(node), PLUGIN_ROW_CONTEXT);
  });

  it('only an addressable configured plugin carries the value the removal is bound to', () => {
    assert.strictEqual(
      pluginRowContext(entryFor(CONFIGURED_PROVIDER, 'configured')),
      PLUGIN_CONFIG_ENTRY_ROW_CONTEXT,
    );
  });

  it('a group heading and a message row carry no value at all', () => {
    const nodes = nodesForDocument({ configured: [CONFIGURED_PROVIDER] });
    const heading = nodes.find((n) => n.kind === 'group');
    assert.ok(heading);
    assert.strictEqual(pluginRowContext(heading), null);
    assert.strictEqual(
      pluginRowContext({ kind: 'message', label: FAILURE_LABEL, detail: 'boom' }),
      null,
    );
    assert.strictEqual(
      pluginRowContext({ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }),
      null,
    );
  });

  it('the value a row carries and the subject it hands over answer one question', () => {
    // Both read the same condition, so a row the manifest binds an operation to
    // can always supply that operation's subject, and one it does not bind can
    // never be made to.
    const nodes = nodesForDocument({
      embedded: [PROVIDER_GUEST],
      configured: [CONFIGURED_PROVIDER, UNRESOLVED_BINDING, CONFIGURED_CLI],
    });
    for (const node of entriesOf(nodes)) {
      const bound = pluginRowContext(node) === PLUGIN_CONFIG_ENTRY_ROW_CONTEXT;
      assert.strictEqual(
        pluginRemovalSubject(node) !== null,
        bound,
        `${node.row.reference} is bound=${bound} but its subject disagrees`,
      );
    }
  });
});

describe('plugins-run: which configuration file a removal writes', () => {
  it('a command plugin is removed from the configuration shared across workspaces', () => {
    assert.ok(
      pluginRemovalConfigTarget('cli').includes('every workspace'),
      pluginRemovalConfigTarget('cli'),
    );
  });

  it('every other type is removed from this project’s own configuration', () => {
    for (const type of ['provider', 'governance', 'linter', 'importer']) {
      assert.ok(
        pluginRemovalConfigTarget(type).includes("project's workspace"),
        `${type}: ${pluginRemovalConfigTarget(type)}`,
      );
    }
  });
});

// --- the arguments each operation composes -------------------------------
//
// The attachment and the removal compose no arguments: each is a request, and the
// properties its composition holds are asserted against the request object in the
// module that declares it.

describe('plugins-run: the answers an attachment is offered', () => {
  it('offers no type the extension cannot obtain every answer for', () => {
    // A command plugin's install confirms its declared capabilities at a
    // terminal, and there is none behind a button. Accepting the grant instead is
    // the reader's decision, not this surface's, so the type is not offered.
    assert.ok(!ATTACHABLE_PLUGIN_TYPES.includes('cli'));
    assert.deepStrictEqual([...ATTACHABLE_PLUGIN_TYPES], [
      'provider',
      'governance',
      'linter',
      'importer',
    ]);
  });

  it('offers the roles the compiler binds a governance attachment at', () => {
    // 🔴 THE EXPECTATION IS A LITERAL THIS MODULE DOES NOT READ, which is what
    // makes it worth asserting. The spec that drives an attachment loops over this
    // very set, so a set that lost a member would still satisfy every reading
    // there; only a comparison against an independently written list can say the
    // set is the right one.
    assert.deepStrictEqual([...GOVERNANCE_ROLES], [
      'annotation-transform',
      'label-transform',
      'ir-verdict',
      'render-verdict',
    ]);
  });
});

describe('plugins-run: composing a catalog generation', () => {
  it('selecting every built-in guest names the mode and both required paths', () => {
    assert.deepStrictEqual(
      pluginGenCatalogArgs({ kind: 'embedded' }, '/w/catalog', '/w/overlays'),
      ['plugin', 'gen-catalog', '--from-embedded', '--output-dir', '/w/catalog', '--overlay', '/w/overlays'],
    );
  });

  it('selecting one artifact names that artifact instead of the built-in mode', () => {
    const args = pluginGenCatalogArgs(
      { kind: 'artifact', artifactPath: '/w/build/guest.wasm' },
      '/w/catalog',
      '/w/overlay.yaml',
    );
    assert.deepStrictEqual(args, [
      'plugin', 'gen-catalog',
      '--plugin', '/w/build/guest.wasm',
      '--output-dir', '/w/catalog',
      '--overlay', '/w/overlay.yaml',
    ]);
    assert.ok(!args.includes('--from-embedded'), 'the two modes are mutually exclusive');
  });

  it('refuses without either path, both of which the command requires', () => {
    assert.throws(
      () => pluginGenCatalogArgs({ kind: 'embedded' }, '', '/w/overlays'),
      /the directory to write/,
    );
    assert.throws(
      () => pluginGenCatalogArgs({ kind: 'embedded' }, '/w/catalog', ''),
      /the authored overlay/,
    );
  });

  it('refuses an artifact selection naming no artifact', () => {
    assert.throws(
      () => pluginGenCatalogArgs({ kind: 'artifact', artifactPath: '' }, '/w/c', '/w/o'),
      /the path of the artifact/,
    );
  });
});
