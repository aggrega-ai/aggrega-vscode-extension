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

interface AttachmentsModel {
  attachmentsFor(graph: unknown, nodeId: string): Projection;
  projectAttachment(name: string, entry: unknown): Attachment;
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
  // boundary lets the assertions below compare values rather than realms.
  return {
    attachmentsFor: (graph, nodeId) => structuredClone(model.attachmentsFor(graph, nodeId)),
    projectAttachment: (name, entry) => structuredClone(model.projectAttachment(name, entry)),
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
  it('withholds every value on an attachment the IR marks sensitive', () => {
    const graph = irGraph({
      cache: {
        password: {
          type: 'core/secret-value',
          resolved_version: '1.0.0',
          binding: 'password',
          values: { key: 'REDIS_PASSWORD', origin: SECRET },
          sensitive: true,
          sensitive_authored_leaves: ['values.origin'],
        },
      },
    });

    const projected = model.attachmentsFor(graph, 'cache');
    const a = projected.attachments[0];

    // The whole projection, not only the field the marking named: a value that
    // escaped by any other route would still be caught here.
    assert.ok(!appearsAnywhere(projected, SECRET), 'the credential reached the projection');

    assert.strictEqual(a.sensitive, true);
    for (const f of a.fields) {
      assert.strictEqual(f.value, null, `${f.path} carried a value`);
      assert.strictEqual(f.withheld, model.WITHHELD_ATTACHMENT);
    }
    // The reader still learns the fields exist and where they are authored.
    assert.deepStrictEqual(a.fields.map((f) => f.path), ['values.key', 'values.origin']);
  });

  it('withholds a declared-sensitive leaf while showing its readable siblings', () => {
    const a = model.projectAttachment('password', {
      values: { key: 'REDIS_PASSWORD', origin: SECRET },
      sensitive: false,
      sensitive_authored_leaves: ['values.origin'],
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
      sensitive_authored_leaves: ['values.credentials'],
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
      sensitive_authored_leaves: ['values.db'],
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
        sensitive_authored_leaves: leaves,
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
    // an author declared. A readable leaf on a sensitive attachment is never
    // reported as itself declared sensitive.
    const a = model.projectAttachment('password', {
      values: { key: 'REDIS_PASSWORD' },
      sensitive: true,
    });
    assert.strictEqual(a.sensitive, true);
    assert.strictEqual(a.fields[0].withheld, model.WITHHELD_ATTACHMENT);
    assert.notStrictEqual(a.fields[0].withheld, model.WITHHELD_DECLARED);
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
});
