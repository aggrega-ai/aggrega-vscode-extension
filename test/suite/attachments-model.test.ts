// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// The attachment projection runs in the webview, so it is a plain script rather
// than a module the suite can import. These tests evaluate the shipped file the
// same way the webview does — as a script assigning to the global — so what is
// asserted is the file that actually ships and not a copy of it.
//
// The centre of gravity here is withholding. A value the IR marks sensitive
// must not reach the panel, so most of these tests assert on the WHOLE
// projection rather than on the field under discussion: a leak that took a
// different route than the one a test was written for would still be caught.
//
// What remains unverifiable here is the drawing: whether the panel writes the
// projection into the document faithfully needs the extension host and a real
// webview. What these tests cover is that a withheld value carries no value to
// draw in the first place.

interface Field {
  path: string;
  value: string | null;
  withheld: string;
}

interface Attachment {
  name: string;
  type: string;
  version: string;
  binding: string;
  origin: string;
  annotationKey: string;
  annotationSource: string;
  labels: Array<{ key: string; value: string }>;
  sensitive: boolean;
  fields: Field[];
}

interface Projection {
  nodeId: string;
  attachments: Attachment[];
}

interface ConnectionRow {
  source: string;
  socket: string;
  alias: string;
  attachments: Attachment[];
}

interface AttachmentsModel {
  attachmentsFor(graph: unknown, nodeId: string, showsSensitiveValues?: unknown): Projection;
  connectionAttachmentsFor(graph: unknown, nodeId: string, showsSensitiveValues?: unknown): ConnectionRow[];
  connectionKey(source: string, socket: string, alias: string): string;
  projectAttachment(name: string, entry: unknown, showsSensitiveValues?: unknown): Attachment;
  redactGraph(graph: unknown): unknown;
  withheldNote(reason: string): string;
  WITHHELD_DECLARED: string;
  WITHHELD_ATTACHMENT: string;
  WITHHELD_UNREADABLE: string;
}

function loadModel(): AttachmentsModel {
  const file = path.join(__dirname, '..', '..', '..', 'media', 'attachments-model.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaAttachments as AttachmentsModel | undefined;
  assert.ok(model, `${file} defined no AggregaAttachments global`);
  // The script runs in its own realm, so the objects and arrays it builds are
  // instances of that realm's constructors and compare unequal to this one's
  // however identical their contents. Cloning the structured results across the
  // boundary lets the assertions below compare values rather than realms. The
  // setting's state is passed only where a caller gives one, so a call without it
  // reaches the model exactly as a message carrying none does.
  return {
    attachmentsFor: (...args) => structuredClone(model.attachmentsFor(...args)),
    connectionAttachmentsFor: (...args) => structuredClone(model.connectionAttachmentsFor(...args)),
    connectionKey: (...args) => model.connectionKey(...args),
    projectAttachment: (...args) => structuredClone(model.projectAttachment(...args)),
    redactGraph: (graph) => structuredClone(model.redactGraph(graph)),
    withheldNote: (reason) => model.withheldNote(reason),
    WITHHELD_DECLARED: model.WITHHELD_DECLARED,
    WITHHELD_ATTACHMENT: model.WITHHELD_ATTACHMENT,
    WITHHELD_UNREADABLE: model.WITHHELD_UNREADABLE,
  };
}

const model = loadModel();

// irGraph wraps an attachment table in the envelope the daemon's irGraph result
// carries, so the fixtures below are shaped like the real payload.
function irGraph(mapping: Record<string, Record<string, unknown>>): unknown {
  return {
    apiVersion: 'aggrega.ai/v1alpha1',
    kind: 'IRGraph',
    spec: { nodes: {}, edges: [], feature_values_mapping: mapping },
  };
}

// appearsAnywhere asks whether a string survives anywhere in a projection —
// any field, any depth, value or key. It is the assertion that does not depend
// on the leak taking the route the test author imagined.
function appearsAnywhere(projection: unknown, needle: string): boolean {
  return JSON.stringify(projection).includes(needle);
}

// fieldsByPath indexes an attachment's fields so a test can name the one it is
// about without depending on ordering.
function fieldsByPath(a: Attachment): Map<string, Field> {
  return new Map(a.fields.map((f) => [f.path, f]));
}

const SECRET = 'dev-cache-pw-change-me';

describe('AggregaAttachments — projecting what is attached', () => {
  it('reads the attachment table by the same node id the topology is keyed by', () => {
    const graph = irGraph({
      cache: {
        password: {
          type: 'core/secret-value',
          resolved_version: '1.0.0',
          binding: 'password',
          origin: 'explicit',
          labels: { 'feature.aggrega.ai/kind': 'secret' },
          values: { key: 'REDIS_PASSWORD' },
        },
      },
    });

    const projected = model.attachmentsFor(graph, 'cache');
    assert.strictEqual(projected.nodeId, 'cache');
    assert.strictEqual(projected.attachments.length, 1);

    const a = projected.attachments[0];
    assert.strictEqual(a.name, 'password');
    assert.strictEqual(a.type, 'core/secret-value');
    assert.strictEqual(a.version, '1.0.0');
    assert.strictEqual(a.binding, 'password');
    assert.strictEqual(a.origin, 'explicit');
    assert.deepStrictEqual(a.labels, [
      { key: 'feature.aggrega.ai/kind', value: 'secret' },
    ]);
  });

  it('reports a node with nothing attached as empty rather than as missing', () => {
    const graph = irGraph({ cache: { password: { type: 'core/secret-value' } } });
    assert.deepStrictEqual(model.attachmentsFor(graph, 'web'), {
      nodeId: 'web',
      attachments: [],
    });
  });

  it('survives a payload carrying no attachment table at all', () => {
    assert.deepStrictEqual(model.attachmentsFor({ spec: {} }, 'cache'), {
      nodeId: 'cache',
      attachments: [],
    });
    assert.deepStrictEqual(model.attachmentsFor(null, 'cache'), {
      nodeId: 'cache',
      attachments: [],
    });
  });

  it('keeps the author\'s attachment name distinct from the slot it fills', () => {
    const a = model.projectAttachment('primary-credential', {
      type: 'core/secret-value',
      binding: 'root_password',
    });
    assert.strictEqual(a.name, 'primary-credential');
    assert.strictEqual(a.binding, 'root_password');
  });

  it('decomposes nested configuration into the dotted paths the IR marks leaves by', () => {
    const a = model.projectAttachment('cfg', {
      values: { server: { host: 'db.internal', port: 5432 }, tls: true },
      infra: { size: 'small' },
    });
    assert.deepStrictEqual(a.fields.map((f) => f.path), [
      'values.server.host',
      'values.server.port',
      'values.tls',
      'infra.size',
    ]);
    assert.deepStrictEqual(a.fields.map((f) => f.value), [
      'db.internal', '5432', 'true', 'small',
    ]);
  });

  it('keeps an empty object or list as a leaf rather than dropping the key', () => {
    const a = model.projectAttachment('cfg', { values: { tags: [], opts: {} } });
    assert.deepStrictEqual(a.fields, [
      { path: 'values.tags', value: '[]', withheld: '' },
      { path: 'values.opts', value: '{}', withheld: '' },
    ]);
  });
});

describe('AggregaAttachments — withholding sensitive material', () => {
  it('withholds only the marked leaves of an attachment the IR marks sensitive', () => {
    // The attachment-wide marking says this attachment handles material an
    // author declared sensitive; it names no datum. The per-leaf marking names
    // the datum. Withholding on the first hides `values.key` — the data key
    // inside a Kubernetes Secret, which is public and which the author needs in
    // order to read the file they are editing. The terminal surface showing the
    // same attachment hides only what a declaration covers, and this shows the
    // same values it shows.
    const graph = irGraph({
      cache: {
        password: {
          type: 'core/secret-value',
          resolved_version: '1.0.0',
          binding: 'password',
          values: { key: 'REDIS_PASSWORD', origin: SECRET },
          sensitive: true,
          sensitive_payload_leaves: ['values.origin'],
        },
      },
    });

    const projected = model.attachmentsFor(graph, 'cache');
    const a = projected.attachments[0];

    // The whole projection, not only the field the marking named: a value that
    // escaped by any other route would still be caught here.
    assert.ok(!appearsAnywhere(projected, SECRET), 'the credential reached the projection');

    // The roll-up is still REPORTED on the attachment — it is a true fact about
    // the attachment, and dropping it would lose it.
    assert.strictEqual(a.sensitive, true);

    const byPath = fieldsByPath(a);
    assert.strictEqual(byPath.get('values.origin')!.value, null);
    assert.strictEqual(byPath.get('values.origin')!.withheld, model.WITHHELD_DECLARED);
    // The locator no declaration covers, on a roll-up-marked attachment, is
    // shown: the roll-up withholds none of the leaves its declarations leave out.
    assert.strictEqual(byPath.get('values.key')!.value, 'REDIS_PASSWORD');
    assert.strictEqual(byPath.get('values.key')!.withheld, '');
    // The reader still learns the fields exist and where they are authored.
    assert.deepStrictEqual(a.fields.map((f) => f.path), ['values.key', 'values.origin']);
  });

  it('shows every value of a roll-up-marked attachment whose marking names no leaf', () => {
    // The roll-up spans the values, infra and provides declarations AND the
    // slot the attachment fills, so it is set for an attachment publishing only
    // public locators — a referenced Secret's name and key are both public, yet
    // the slot they fill unquestionably handles secret material. An absent
    // per-leaf list is the compiler's positive finding that no payload leaf is
    // covered, and it is not permission withdrawn.
    const a = model.projectAttachment('referenced', {
      type: 'core/referenced-secret',
      binding: 'password',
      values: { name: 'db-credentials', key: 'password' },
      sensitive: true,
    });
    assert.strictEqual(a.sensitive, true);
    assert.deepStrictEqual(a.fields, [
      { path: 'values.name', value: 'db-credentials', withheld: '' },
      { path: 'values.key', value: 'password', withheld: '' },
    ]);
  });

  it('withholds a declared-sensitive leaf while showing its readable siblings', () => {
    const a = model.projectAttachment('password', {
      values: { key: 'REDIS_PASSWORD', origin: SECRET },
      sensitive: false,
      sensitive_payload_leaves: ['values.origin'],
    });

    assert.ok(!appearsAnywhere(a, SECRET), 'the credential reached the projection');
    const byPath = fieldsByPath(a);
    assert.strictEqual(byPath.get('values.key')!.value, 'REDIS_PASSWORD');
    assert.strictEqual(byPath.get('values.key')!.withheld, '');
    assert.strictEqual(byPath.get('values.origin')!.value, null);
    assert.strictEqual(byPath.get('values.origin')!.withheld, model.WITHHELD_DECLARED);
  });

  it('withholds every leaf BENEATH a declared path, not only the exact path', () => {
    // The declaration lands on an interior key; the authored values are its
    // children. Matching only the exact path would leave them in the clear.
    const a = model.projectAttachment('db', {
      values: { credentials: { user: 'admin', password: SECRET }, port: 5432 },
      sensitive_payload_leaves: ['values.credentials'],
    });

    assert.ok(!appearsAnywhere(a, SECRET), 'a value beneath a declared path reached the projection');
    const byPath = fieldsByPath(a);
    assert.strictEqual(byPath.get('values.credentials.user')!.withheld, model.WITHHELD_DECLARED);
    assert.strictEqual(byPath.get('values.credentials.password')!.withheld, model.WITHHELD_DECLARED);
    // A sibling that merely shares a name prefix is NOT covered.
    assert.strictEqual(byPath.get('values.port')!.value, '5432');
  });

  it('does not let a name-prefix collision withhold an unrelated field', () => {
    const a = model.projectAttachment('cfg', {
      values: { db: 'main', dbPassword: 'shown-because-undeclared' },
      sensitive_payload_leaves: ['values.db'],
    });
    const byPath = fieldsByPath(a);
    assert.strictEqual(byPath.get('values.db')!.withheld, model.WITHHELD_DECLARED);
    assert.strictEqual(byPath.get('values.dbPassword')!.value, 'shown-because-undeclared');
  });

  it('withholds everything when the attachment-wide marking is in an unrecognised shape', () => {
    // A marking this code cannot read is treated as set, never as unset: an
    // unreadable marking is not permission to display.
    for (const marking of ['yes', 1, {}, []]) {
      const a = model.projectAttachment('x', {
        values: { key: SECRET },
        sensitive: marking,
      });
      assert.ok(!appearsAnywhere(a, SECRET), `marking ${JSON.stringify(marking)} leaked the value`);
      assert.strictEqual(a.fields[0].withheld, model.WITHHELD_ATTACHMENT);
    }
  });

  it('withholds everything when the declared-leaf list is in an unrecognised shape', () => {
    // A list that cannot be matched against is indistinguishable from a list
    // that matches nothing, so the whole attachment is withheld instead.
    for (const leaves of [[{}], [1], 'values.origin', {}]) {
      const a = model.projectAttachment('x', {
        values: { key: SECRET },
        sensitive: false,
        sensitive_payload_leaves: leaves,
      });
      assert.ok(!appearsAnywhere(a, SECRET), `leaf list ${JSON.stringify(leaves)} leaked the value`);
      assert.strictEqual(a.fields[0].withheld, model.WITHHELD_ATTACHMENT);
    }
  });

  it('withholds when the entry is not an attachment at all', () => {
    for (const entry of [SECRET, 42, null, undefined, [SECRET]]) {
      const a = model.projectAttachment('x', entry);
      assert.ok(!appearsAnywhere(a, SECRET), `entry ${JSON.stringify(entry)} leaked the value`);
      assert.deepStrictEqual(a.fields, []);
    }
  });

  it('reports a configuration payload in an unrecognised shape rather than dropping it', () => {
    const a = model.projectAttachment('x', { values: SECRET });
    assert.ok(!appearsAnywhere(a, SECRET), 'an unrecognised payload leaked its content');
    assert.deepStrictEqual(a.fields, [
      { path: 'values', value: null, withheld: model.WITHHELD_UNREADABLE },
    ]);
  });

  it('withholds a leaf value in a shape it cannot render as text', () => {
    // Reachable from a payload this view did not decode itself. The value is
    // withheld rather than stringified blindly.
    const a = model.projectAttachment('x', {
      values: { odd: () => SECRET },
    });
    assert.ok(!appearsAnywhere(a, SECRET), 'an unrenderable value leaked');
    assert.deepStrictEqual(a.fields, [
      { path: 'values.odd', value: null, withheld: model.WITHHELD_UNREADABLE },
    ]);
  });

  it('reports the attachment marking without spreading it onto individual leaves', () => {
    // The two markings answer different questions: the per-attachment one says
    // the attachment handles sensitive material, the per-leaf one names a leaf
    // an author declared. Spreading the first onto the leaves would assert
    // about `values.key` something the IR never said, so the leaf is shown and
    // the attachment still carries its own marking.
    const a = model.projectAttachment('password', {
      values: { key: 'REDIS_PASSWORD' },
      sensitive: true,
    });
    assert.strictEqual(a.sensitive, true);
    assert.strictEqual(a.fields[0].withheld, '');
    assert.strictEqual(a.fields[0].value, 'REDIS_PASSWORD');
  });

  it('reports an unmarked attachment as not sensitive and shows its values', () => {
    const a = model.projectAttachment('tuning', { values: { replicas: 3 } });
    assert.strictEqual(a.sensitive, false);
    assert.deepStrictEqual(a.fields, [
      { path: 'values.replicas', value: '3', withheld: '' },
    ]);
  });

  it('gives every withholding reason a sentence, and a shown value none', () => {
    for (const reason of [
      model.WITHHELD_DECLARED,
      model.WITHHELD_ATTACHMENT,
      model.WITHHELD_UNREADABLE,
    ]) {
      assert.ok(model.withheldNote(reason).length > 0, `${reason} has no note`);
    }
    assert.strictEqual(model.withheldNote(''), '');
  });

  it('says what was withheld and why, without naming which declaration did it', () => {
    // Each sentence states one of a fixed set of reasons. None of them names a
    // declaration: a note that did would be a second, weaker copy of the
    // contract, and it would go stale the moment the declaration moved.
    assert.strictEqual(
      model.withheldNote(model.WITHHELD_DECLARED),
      'withheld — declared sensitive',
    );
    // The attachment-wide reason is only the fail-safe, so its sentence names
    // the fail-safe rather than claiming the attachment handles sensitive
    // material — a claim about the attachment that this reason does not
    // carry, and which would be false of a payload withheld merely because its
    // marking could not be parsed.
    assert.strictEqual(
      model.withheldNote(model.WITHHELD_ATTACHMENT),
      "withheld — this attachment's sensitivity marking is unreadable",
    );
    assert.strictEqual(
      model.withheldNote(model.WITHHELD_UNREADABLE),
      'withheld — value not in a readable shape',
    );
  });
});

describe('AggregaAttachments — the setting that shows sensitive values', () => {
  // The payload these tests project is one the sending side did NOT redact, so
  // the declared value is present in it. With the setting off that is a payload
  // the redaction missed, and the projection must still refuse it; with the
  // setting on it is exactly what the sending side sends, and the projection
  // must draw it. The same payload, projected with two statements about the
  // setting, is what tells the two apart.
  const LOCATOR = 'POSTGRES_PASSWORD';
  function unredacted(): unknown {
    return irGraph({
      orders: {
        password: {
          type: 'core/secret-value',
          binding: 'password',
          values: { key: LOCATOR, origin: SECRET },
          sensitive: true,
          sensitive_payload_leaves: ['values.origin'],
        },
      },
    });
  }

  it('withholds a declared value that arrives unredacted when the setting is off', () => {
    const projected = model.attachmentsFor(unredacted(), 'orders', false);
    assert.ok(!appearsAnywhere(projected, SECRET), 'the credential reached the projection');
    const byPath = fieldsByPath(projected.attachments[0]);
    assert.strictEqual(byPath.get('values.origin')!.value, null);
    assert.strictEqual(byPath.get('values.origin')!.withheld, model.WITHHELD_DECLARED);
  });

  it('draws the same payload as its author wrote it when the setting is on', () => {
    const projected = model.attachmentsFor(unredacted(), 'orders', true);
    const byPath = fieldsByPath(projected.attachments[0]);
    assert.deepStrictEqual(byPath.get('values.origin'), {
      path: 'values.origin', value: SECRET, withheld: '',
    });
    // The attachment is still reported as handling sensitive material: the
    // setting changes what is drawn, not what the IR says about the attachment.
    assert.strictEqual(projected.attachments[0].sensitive, true);
  });

  it('reads a graph that carries no statement about the setting as the setting off', () => {
    const projected = model.attachmentsFor(unredacted(), 'orders');
    assert.ok(!appearsAnywhere(projected, SECRET), 'a graph saying nothing about the setting drew the credential');
    assert.strictEqual(
      fieldsByPath(projected.attachments[0]).get('values.origin')!.withheld,
      model.WITHHELD_DECLARED,
    );
  });

  it('reads every statement about the setting except the boolean true as the setting off', () => {
    for (const stated of ['true', 'yes', 1, {}, [], null, 'on']) {
      const projected = model.attachmentsFor(unredacted(), 'orders', stated);
      assert.ok(
        !appearsAnywhere(projected, SECRET),
        `the statement ${JSON.stringify(stated)} drew the credential`,
      );
    }
  });

  it('draws an attachment whose sensitivity marking it cannot read when the setting is on', () => {
    // The sending side sends such an attachment untouched with the setting on,
    // so the fail-safe that withholds it whole with the setting off does not
    // apply: the value is already here, and the reader asked to see it.
    for (const marking of ['yes', 1, {}]) {
      const a = model.projectAttachment('x', { values: { key: SECRET }, sensitive: marking }, true);
      assert.deepStrictEqual(a.fields, [{ path: 'values.key', value: SECRET, withheld: '' }]);
    }
    const a = model.projectAttachment('x', {
      values: { key: SECRET }, sensitive: false, sensitive_payload_leaves: [1],
    }, true);
    assert.deepStrictEqual(a.fields, [{ path: 'values.key', value: SECRET, withheld: '' }]);
    // The same attachments with the setting off are withheld whole, as before.
    const off = model.projectAttachment('x', { values: { key: SECRET }, sensitive: 'yes' }, false);
    assert.strictEqual(off.fields[0].withheld, model.WITHHELD_ATTACHMENT);
  });

  it('keeps the unreadable-shape sentence, and a marker that arrived, when the setting is on', () => {
    // Neither is a sensitivity refusal. A value in no shape the panel can
    // render has no text to draw, and a value already replaced by a marker is
    // gone — the reason recorded when it was removed is the truthful one.
    assert.deepStrictEqual(model.projectAttachment('x', { values: SECRET }, true).fields, [
      { path: 'values', value: null, withheld: model.WITHHELD_UNREADABLE },
    ]);
    const marked = model.projectAttachment('x', {
      values: { origin: { aggrega_withheld: 'declared' } },
      sensitive_payload_leaves: ['values.origin'],
    }, true);
    assert.deepStrictEqual(marked.fields, [
      { path: 'values.origin', value: null, withheld: model.WITHHELD_DECLARED },
    ]);
  });

  it('draws the value no declaration covers the same way in every state of the setting', () => {
    for (const stated of [undefined, false, true, 'yes']) {
      const byPath = fieldsByPath(model.attachmentsFor(unredacted(), 'orders', stated).attachments[0]);
      assert.deepStrictEqual(byPath.get('values.key'), { path: 'values.key', value: LOCATOR, withheld: '' });
    }
  });
});

describe('AggregaAttachments — an attachment written on a connection', () => {
  // The fixtures here are the language server's own answer, copied as it emitted
  // it: the graph of a Release whose gateway holds two attachments of its own and
  // two written on its connections — one the Aggregate wrote on the connection it
  // draws through `models` under `gpt`, filling a slot declared sensitive with a
  // Feature that declares one of its values sensitive, and one the Release wrote
  // on the connection it draws through `mirrors` under `m1`. Every edge the
  // gateway draws is there, the two that carry nothing included, so a placement
  // that matched an edge by anything less than its source, socket and alias
  // would have somewhere wrong to put an attachment.
  //
  // The connection's sensitive value is spelled by the test rather than copied,
  // so the withheld state can be asserted both ways on one payload; the shape
  // around it is the emitted one.
  const CONNECTION_SECRET = 'conn-plaintext-for-the-gpt-connection';
  const OWN_SECRET = 'own-plaintext-for-the-gateway';

  // Each IR edge the gateway draws, in the order the compiler wrote them.
  const EDGES = [
    { source: 'gateway', target: 'model', socket: 'models', alias: 'gpt', socket_declaration: 'declared' },
    { source: 'gateway', target: 'sink', socket: 'extra', alias: 'side', socket_declaration: 'ad-hoc' },
    {
      source: 'gateway', target: 'model', socket: 'peer', alias: 'p1', socket_declaration: 'declared',
      origin_feature: 'feature.conn/peering', origin_feature_instance: 'peering',
    },
    {
      source: 'gateway', target: 'sink', socket: 'logs', alias: 'out', socket_declaration: 'declared',
      origin_release: true,
    },
    {
      source: 'gateway', target: 'sink', socket: 'mirrors', alias: 'm1', socket_declaration: 'declared',
      origin_release: true,
    },
  ];

  // The gateway's bucket as the compiler sends it with every value in place —
  // the answer to a request that asks for the values — keyed and ordered as the
  // compiler wrote it.
  function gatewayBucket(): Record<string, unknown> {
    return {
      peering: { type: 'feature.conn/peering', resolved_version: '1.0.0', binding: 'free', origin: 'explicit' },
      'own-token': {
        type: 'feature.conn/token',
        resolved_version: '1.0.0',
        labels: { 'feature.aggrega.ai/kind': 'secret' },
        binding: 'free',
        values: { key: 'own-key', secret: OWN_SECRET },
        origin: 'explicit',
        values_provenance: { key: { origin: 'explicit' }, secret: { origin: 'explicit' } },
        sensitive: true,
        sensitive_payload_leaves: ['values.secret'],
      },
      'gpt.credential': {
        type: 'feature.conn/token',
        resolved_version: '1.0.0',
        labels: { 'feature.aggrega.ai/kind': 'secret' },
        binding: 'credential',
        values: { key: 'gpt-key', secret: CONNECTION_SECRET },
        origin: 'explicit',
        values_provenance: { key: { origin: 'explicit' }, secret: { origin: 'explicit' } },
        sensitive: true,
        sensitive_payload_leaves: ['values.secret'],
        connection: { socket: 'models', alias: 'gpt' },
      },
      'm1.note': {
        type: 'feature.conn/audit',
        resolved_version: '1.0.0',
        binding: 'note',
        origin: 'explicit',
        connection: { socket: 'mirrors', alias: 'm1' },
      },
    };
  }

  // compiled wraps a bucket for the gateway, with the edges above, in the
  // envelope the graph answer carries.
  function compiled(bucket: Record<string, unknown>, edges: unknown[] = EDGES): unknown {
    return {
      apiVersion: 'aggrega.ai/v1alpha1',
      kind: 'IR',
      metadata: { aggregate_name: 'connection-site-app' },
      spec: {
        nodes: {
          gateway: { component: 'conn/gateway', resolved_version: '1.0.0' },
          model: { component: 'conn/model', resolved_version: '1.0.0' },
          sink: { component: 'conn/sink', resolved_version: '1.0.0' },
        },
        edges,
        values_mapping: {},
        infra_mapping: {},
        feature_values_mapping: { gateway: bucket },
      },
    };
  }

  function namesOn(projection: { attachments: Attachment[] }): string[] {
    return projection.attachments.map((a) => a.name);
  }

  it('draws a connection attachment on its edge and leaves it out of the node\'s list', () => {
    const graph = compiled(gatewayBucket());

    assert.deepStrictEqual(namesOn(model.attachmentsFor(graph, 'gateway')), ['peering', 'own-token']);

    const rows = model.connectionAttachmentsFor(graph, 'gateway');
    assert.deepStrictEqual(
      rows.map((r) => ({ source: r.source, socket: r.socket, alias: r.alias, names: namesOn(r) })),
      [
        { source: 'gateway', socket: 'models', alias: 'gpt', names: ['gpt.credential'] },
        { source: 'gateway', socket: 'mirrors', alias: 'm1', names: ['m1.note'] },
      ],
    );

    // Each connection row is drawn by the same projection a node's attachment is.
    const credential = rows[0].attachments[0];
    assert.strictEqual(credential.type, 'feature.conn/token');
    assert.strictEqual(credential.version, '1.0.0');
    assert.strictEqual(credential.binding, 'credential');
    assert.strictEqual(credential.sensitive, true);

    // The two lists partition the bucket: every entry is drawn once, on the node
    // or on a connection, and none is drawn twice or left out.
    const drawn = [
      ...namesOn(model.attachmentsFor(graph, 'gateway')),
      ...rows.flatMap((r) => namesOn(r)),
    ].sort();
    assert.deepStrictEqual(drawn, Object.keys(gatewayBucket()).sort());

    // The row is keyed as the drawing keys the edge it belongs to.
    assert.strictEqual(
      model.connectionKey(rows[0].source, rows[0].socket, rows[0].alias),
      model.connectionKey(EDGES[0].source, EDGES[0].socket, EDGES[0].alias),
    );
  });

  it('keeps an entry whose connection mark cannot be read in the node\'s list', () => {
    for (const mark of ['models.gpt', { socket: 'models' }, { alias: 'gpt' }, { socket: 1, alias: 'gpt' },
      { socket: 'models', alias: null }, null, ['models', 'gpt']]) {
      const bucket = gatewayBucket();
      (bucket['gpt.credential'] as Record<string, unknown>).connection = mark;
      const graph = compiled(bucket);
      assert.deepStrictEqual(
        namesOn(model.attachmentsFor(graph, 'gateway')), ['peering', 'own-token', 'gpt.credential'],
        `the mark ${JSON.stringify(mark)} took the attachment out of the node's list`,
      );
      assert.ok(
        !model.connectionAttachmentsFor(graph, 'gateway').some((r) => namesOn(r).includes('gpt.credential')),
        `the mark ${JSON.stringify(mark)} placed the attachment on a connection`,
      );
    }
  });

  it('keeps an entry whose mark names no drawn edge out of its node in the node\'s list', () => {
    const cases: Array<{ what: string; mark: unknown; edges: unknown[] }> = [
      { what: 'an alias the socket carries no edge under', mark: { socket: 'models', alias: 'nonesuch' }, edges: EDGES },
      { what: 'a socket the node draws no edge through', mark: { socket: 'nonesuch', alias: 'gpt' }, edges: EDGES },
      {
        what: 'an edge drawn from another node',
        mark: { socket: 'models', alias: 'gpt' },
        edges: [{ source: 'sink', target: 'model', socket: 'models', alias: 'gpt', socket_declaration: 'declared' }],
      },
      {
        what: 'two edges, which leaves no one connection to draw it on',
        mark: { socket: 'models', alias: 'gpt' },
        edges: [EDGES[0], { ...EDGES[0], target: 'sink' }],
      },
      { what: 'a graph drawing no edge at all', mark: { socket: 'models', alias: 'gpt' }, edges: [] },
    ];
    for (const c of cases) {
      const bucket = gatewayBucket();
      (bucket['gpt.credential'] as Record<string, unknown>).connection = c.mark;
      const graph = compiled(bucket, c.edges);
      assert.ok(
        namesOn(model.attachmentsFor(graph, 'gateway')).includes('gpt.credential'),
        `a mark naming ${c.what} left the attachment undrawn on the node`,
      );
      assert.ok(
        !model.connectionAttachmentsFor(graph, 'gateway').some((r) => namesOn(r).includes('gpt.credential')),
        `a mark naming ${c.what} placed the attachment on a connection`,
      );
    }
  });

  it('keeps an entry of the node\'s own block in the node\'s list, whatever its name reads like', () => {
    // An entry carrying no mark is the node's own, even under a name spelled the
    // way a connection attachment's is; and an entry carrying a mark is placed on
    // its connection under any name. The name is never read for a connection.
    const bucket = gatewayBucket();
    const own = { type: 'feature.conn/audit', resolved_version: '1.0.0', binding: 'free', origin: 'explicit' };
    const placed = { ...(bucket['gpt.credential'] as Record<string, unknown>) };
    const renamed: Record<string, unknown> = {
      peering: bucket.peering,
      'own-token': bucket['own-token'],
      'gpt.trace': own,
      'credential-for-the-model': placed,
    };
    const graph = compiled(renamed);

    assert.deepStrictEqual(namesOn(model.attachmentsFor(graph, 'gateway')), ['peering', 'own-token', 'gpt.trace']);
    assert.deepStrictEqual(
      model.connectionAttachmentsFor(graph, 'gateway').map((r) => [r.socket, r.alias, namesOn(r)]),
      [['models', 'gpt', ['credential-for-the-model']]],
    );
  });

  it('withholds a declared-sensitive value on a connection attachment with the setting off, and shows it on',
    () => {
      const graph = compiled(gatewayBucket());

      for (const stated of [undefined, false, 'true', 1]) {
        const rows = model.connectionAttachmentsFor(graph, 'gateway', stated);
        assert.ok(
          !appearsAnywhere(rows, CONNECTION_SECRET),
          `with the setting stated as ${JSON.stringify(stated)}, the connection's credential reached the projection`,
        );
        const byPath = fieldsByPath(rows[0].attachments[0]);
        assert.deepStrictEqual(byPath.get('values.secret'), {
          path: 'values.secret', value: null, withheld: model.WITHHELD_DECLARED,
        });
        // The value no declaration covers is shown, on a connection as on a node.
        assert.deepStrictEqual(byPath.get('values.key'), { path: 'values.key', value: 'gpt-key', withheld: '' });
      }

      const shown = model.connectionAttachmentsFor(graph, 'gateway', true);
      assert.deepStrictEqual(fieldsByPath(shown[0].attachments[0]).get('values.secret'), {
        path: 'values.secret', value: CONNECTION_SECRET, withheld: '',
      });
      assert.strictEqual(shown[0].attachments[0].sensitive, true);
    });

  it('withholds a connection attachment\'s declared-sensitive value at the boundary, where the redaction runs',
    () => {
      // The side holding the graph redacts every entry of every bucket before the
      // view is handed anything, so a connection's value is removed there too and
      // the view finds only the marker saying why.
      const redacted = model.redactGraph(compiled(gatewayBucket()));
      assert.ok(!appearsAnywhere(redacted, CONNECTION_SECRET), 'the redaction left the connection\'s credential in');
      assert.ok(!appearsAnywhere(redacted, OWN_SECRET), 'the redaction left the node\'s own credential in');

      const rows = model.connectionAttachmentsFor(redacted, 'gateway', false);
      assert.deepStrictEqual(rows.map((r) => [r.socket, r.alias]), [['models', 'gpt'], ['mirrors', 'm1']]);
      assert.deepStrictEqual(fieldsByPath(rows[0].attachments[0]).get('values.secret'), {
        path: 'values.secret', value: null, withheld: model.WITHHELD_DECLARED,
      });
    });
});
