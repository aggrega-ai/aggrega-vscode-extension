// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createGraphRedactor, loadAttachmentsModel } from '../../src/graph-payload';
import { SHOW_SENSITIVE_VALUES_KEY, showsSensitiveValues } from '../../src/settings';

// These tests exercise the payload the topology view is handed — what crosses
// the boundary, not what the panel draws with it afterwards. That distinction is
// the whole subject: a value the panel declines to draw has still crossed, and
// an assertion about the drawn document would not notice.
//
// They run the shared rule the way the extension host runs it, out of the
// extension's own media directory, so what is asserted is the file that ships.

const EXTENSION_ROOT = path.join(__dirname, '..', '..', '..');

// The credential. Named once, and every assertion below looks for it across the
// WHOLE payload rather than at the field it is expected to sit in, so a value
// that survived by a route no test author imagined is still caught.
const SECRET = 'by-value-plaintext';

// A public locator sitting on the same attachment as the credential. It carries
// no sensitivity declaration, so it is what proves the redaction is not simply
// emptying everything it touches.
const PUBLIC_LOCATOR = 'db-creds';

// credentialEntry is an attachment entry in the shape the compiler emits, with
// all three sensitivity markings populated: the attachment-wide roll-up, the
// per-delivery-key taint, and the per-leaf marking naming the one leaf
// this deployment authored a declared-sensitive value at.
function credentialEntry(): Record<string, unknown> {
  return {
    type: 'feature.gov/db-credential',
    resolved_version: '1.0.0',
    labels: { 'feature.aggrega.ai/kind': 'secret' },
    binding: 'credentials',
    values: { secretName: PUBLIC_LOCATOR, literalPassword: SECRET },
    inject: { env: { DATABASE_PASSWORD: 'password' } },
    origin: 'explicit',
    sensitive: true,
    sensitive_inject: { env: { DATABASE_PASSWORD: 'password' } },
    sensitive_payload_leaves: ['values.literalPassword'],
  };
}

// irGraph wraps attachment buckets in the envelope the daemon's irGraph result
// carries, so what is redacted below is shaped like the real payload.
function irGraph(mapping: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return {
    apiVersion: 'aggrega.ai/v1alpha1',
    kind: 'IR',
    metadata: { name: 'probe' },
    spec: {
      nodes: { api: { component: 'api', resolved_version: '1.0.0', labels: {} } },
      edges: [],
      values_mapping: {},
      infra_mapping: {},
      feature_values_mapping: mapping,
      provenance: {},
    },
  };
}

function appearsAnywhere(payload: unknown, needle: string): boolean {
  return JSON.stringify(payload).includes(needle);
}

// The shared rule runs in a context of its own, so the objects and arrays it
// builds are instances of that context's constructors and compare unequal to
// this one's however identical their contents. Cloning the results across lets
// the assertions below compare values rather than realms.
function project(graph: unknown, nodeId: string): Attachment[] {
  return structuredClone(model.attachmentsFor(graph, nodeId).attachments);
}

function projectOne(name: string, entry: unknown): Field[] {
  return structuredClone(model.projectAttachment(name, entry).fields);
}

interface Field { path: string; value: string | null; withheld: string }
interface Attachment { sensitive: boolean; fields: Field[] }

const redact = createGraphRedactor(EXTENSION_ROOT);
const model = loadAttachmentsModel(EXTENSION_ROOT) as unknown as {
  redactGraph(graph: unknown): unknown;
  attachmentsFor(graph: unknown, nodeId: string): {
    attachments: Array<{
      sensitive: boolean;
      fields: Array<{ path: string; value: string | null; withheld: string }>;
    }>;
  };
  projectAttachment(name: string, entry: unknown): {
    fields: Array<{ path: string; value: string | null; withheld: string }>;
  };
  withheldNote(reason: string): string;
  WITHHELD_DECLARED: string;
  WITHHELD_ATTACHMENT: string;
  WITHHELD_MARKER_KEY: string;
};

describe('the payload handed to the topology view', () => {
  it('withholds the credential by default, and the credential DOES cross without it', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });

    // The control: with nothing redacting, the credential is in the payload.
    // Without this the assertion below could pass over a payload that never
    // carried the value in the first place.
    assert.ok(
      appearsAnywhere(redact(graph, true), SECRET),
      'the control failed: the unredacted payload does not carry the credential',
    );

    assert.ok(
      !appearsAnywhere(redact(graph, false), SECRET),
      'the credential crossed the boundary',
    );
  });

  it('keeps the markings, so the view can still say WHY a value is absent', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    const posted = redact(graph, false) as Record<string, any>;
    const entry = posted.spec.feature_values_mapping.api.credentials;

    assert.strictEqual(entry.sensitive, true);
    assert.deepStrictEqual(entry.sensitive_payload_leaves, ['values.literalPassword']);
    assert.deepStrictEqual(entry.sensitive_inject, { env: { DATABASE_PASSWORD: 'password' } });
    assert.strictEqual(entry.binding, 'credentials');
    assert.deepStrictEqual(entry.labels, { 'feature.aggrega.ai/kind': 'secret' });
  });

  it('leaves the field paths standing, so the reader still learns the fields exist', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    const paths = project(redact(graph, false), 'api')[0].fields.map((f) => f.path);
    assert.deepStrictEqual(paths, ['values.secretName', 'values.literalPassword']);
  });

  it('projects a stand-in to a WITHHELD field, never to a drawable value', () => {
    // The trap this guards against, demonstrated first rather than asserted
    // about: a scalar left where a value was is read as a readable value, and
    // `null` is read as the readable text "null". A stand-in of that shape would
    // put a confident wrong answer where a correct refusal belongs.
    assert.deepStrictEqual(projectOne('x', { values: { wasSecret: null } }), [
      { path: 'values.wasSecret', value: 'null', withheld: '' },
    ]);

    // The stand-in actually used is in no shape a value can be read out of.
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    let seen = false;
    for (const f of project(redact(graph, false), 'api')[0].fields) {
      if (f.path === 'values.literalPassword') {
        seen = true;
        assert.strictEqual(f.value, null, 'the withheld leaf carried a drawable value');
        assert.strictEqual(f.withheld, model.WITHHELD_DECLARED);
        assert.ok(model.withheldNote(f.withheld).length > 0);
      }
    }
    // Without this the loop above would pass over a projection that carried the
    // leaf under some other path, or carried no leaves at all.
    assert.ok(seen, 'the projection carried no values.literalPassword field to assert on');
  });

  it('lets the public locator on a roll-up-marked attachment cross and be shown', () => {
    // The entry carries `sensitive: true` — the attachment does handle a
    // credential — beside a locator no declaration covers. The terminal surface
    // shows that locator; so does this one, and the value has to CROSS the
    // boundary for the panel to have anything to draw.
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    const posted = redact(graph, false);

    assert.ok(!appearsAnywhere(posted, SECRET), 'the credential crossed the boundary');
    assert.ok(
      appearsAnywhere(posted, PUBLIC_LOCATOR),
      'the locator was stripped: the panel can report only that it is missing',
    );

    const attachment = project(posted, 'api')[0];
    assert.strictEqual(attachment.sensitive, true, 'the roll-up stopped being reported');
    const byPath = new Map(attachment.fields.map((f) => [f.path, f]));
    assert.strictEqual(byPath.get('values.secretName')!.value, PUBLIC_LOCATOR);
    assert.strictEqual(byPath.get('values.secretName')!.withheld, '');
    assert.strictEqual(byPath.get('values.literalPassword')!.withheld, model.WITHHELD_DECLARED);
  });

  it('withholds by the declaration when the attachment as a whole is not marked', () => {
    const entry = credentialEntry();
    entry.sensitive = false;
    delete entry.sensitive_inject;
    const graph = irGraph({ api: { credentials: entry } });
    const posted = redact(graph, false);

    assert.ok(!appearsAnywhere(posted, SECRET), 'the declared-sensitive leaf crossed');

    const fields = project(posted, 'api')[0].fields;
    const byPath = new Map(fields.map((f) => [f.path, f]));
    assert.strictEqual(byPath.get('values.literalPassword')!.withheld, model.WITHHELD_DECLARED);
    assert.strictEqual(
      model.withheldNote(model.WITHHELD_DECLARED),
      'withheld — declared sensitive',
    );
    // And the locator on the same attachment, which no declaration covers.
    assert.strictEqual(byPath.get('values.secretName')!.value, PUBLIC_LOCATOR);
  });

  it('withholds a value whose sensitivity marking is in an unrecognised shape', () => {
    // The marking has more than two states, and an unreadable one is not
    // permission. Over-withholding cannot leak; under-withholding can.
    for (const marking of ['yes', 1, {}, [], 'false']) {
      const entry = credentialEntry();
      entry.sensitive = marking;
      const posted = redact(irGraph({ api: { credentials: entry } }), false);
      assert.ok(
        !appearsAnywhere(posted, SECRET),
        `marking ${JSON.stringify(marking)} let the credential cross`,
      );
    }
    // The same, for an unreadable declared-leaf list.
    for (const leaves of [[{}], [1], 'values.literalPassword', {}]) {
      const entry = credentialEntry();
      entry.sensitive = false;
      entry.sensitive_payload_leaves = leaves;
      const posted = redact(irGraph({ api: { credentials: entry } }), false);
      assert.ok(
        !appearsAnywhere(posted, SECRET),
        `leaf list ${JSON.stringify(leaves)} let the credential cross`,
      );
    }
  });

  it('withholds an entry that is not an attachment at all', () => {
    for (const entry of [SECRET, 42, [SECRET], { values: SECRET }]) {
      const posted = redact(irGraph({ api: { credentials: entry as never } }), false);
      assert.ok(
        !appearsAnywhere(posted, SECRET),
        `entry ${JSON.stringify(entry)} let the credential cross`,
      );
    }
  });

  it('leaves a payload carrying nothing sensitive byte-for-byte unchanged', () => {
    const graph = irGraph({
      api: {
        tuning: {
          type: 'core/sizing',
          resolved_version: '2.1.0',
          binding: 'sizing',
          values: { replicas: 3, tier: 'standard', tags: [], opts: {} },
          infra: { size: 'small', zones: ['eu-west-1a', 'eu-west-1b'] },
        },
      },
    });
    const before = JSON.stringify(graph);
    assert.strictEqual(JSON.stringify(redact(graph, false)), before);
    assert.strictEqual(JSON.stringify(redact(graph, true)), before);
    // And what the view then projects is unchanged too.
    assert.deepStrictEqual(project(redact(graph, false), 'api'), project(graph, 'api'));
  });

  it('leaves the graph it was handed untouched', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    const before = JSON.stringify(graph);
    redact(graph, false);
    assert.strictEqual(JSON.stringify(graph), before, 'redaction mutated its input');
  });

  it('carries every part of the graph no sensitivity marking reaches', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } }) as Record<string, any>;
    graph.spec.edges = [{ source: 'api', target: 'db', socket: 'database' }];
    graph.spec.values_mapping = { api: { port: 8080 } };
    const posted = redact(graph, false) as Record<string, any>;

    assert.deepStrictEqual(posted.spec.nodes, graph.spec.nodes);
    assert.deepStrictEqual(posted.spec.edges, graph.spec.edges);
    assert.deepStrictEqual(posted.spec.values_mapping, graph.spec.values_mapping);
    assert.strictEqual(posted.apiVersion, graph.apiVersion);
    assert.deepStrictEqual(posted.metadata, graph.metadata);
  });
});

describe('the opt-out the author owns', () => {
  it('shows the credential when the setting is on, and withholds it when off', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });

    const shown = redact(graph, showsSensitiveValues(true)) as Record<string, any>;
    assert.strictEqual(
      shown.spec.feature_values_mapping.api.credentials.values.literalPassword,
      SECRET,
    );

    const withheld = redact(graph, showsSensitiveValues(false));
    assert.ok(!appearsAnywhere(withheld, SECRET));
  });

  it('shows the payload exactly as the compiler produced it when the setting is on', () => {
    const graph = irGraph({ api: { credentials: credentialEntry() } });
    assert.strictEqual(JSON.stringify(redact(graph, true)), JSON.stringify(graph));
  });

  it('withholds for every configured value except the boolean true', () => {
    // A workspace with no configuration at all reads as undefined here, which is
    // the case a default that depends on a file existing would get wrong.
    assert.strictEqual(showsSensitiveValues(undefined), false);
    assert.strictEqual(showsSensitiveValues(null), false);
    // A setting present but in a shape that cannot be read falls back to
    // withholding, never to disclosing.
    for (const configured of ['true', 'yes', 1, {}, [], 'false', 0, '']) {
      assert.strictEqual(
        showsSensitiveValues(configured),
        false,
        `configured ${JSON.stringify(configured)} disclosed the values`,
      );
    }
    assert.strictEqual(showsSensitiveValues(true), true);
  });

  it('names the setting with the key the manifest declares', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'),
    );
    const declared = manifest.contributes.configuration.properties[
      `aggrega.graph.${SHOW_SENSITIVE_VALUES_KEY}`
    ];
    assert.ok(declared, 'the setting the reader reads is not declared in the manifest');
    assert.strictEqual(declared.type, 'boolean');
    assert.strictEqual(declared.default, false, 'the declared default discloses values');
    assert.ok(
      declared.description.includes('in the clear'),
      'the setting does not say what turning it on exposes',
    );
  });
});

describe('the rule the two sides of the boundary share', () => {
  it('is loaded from the media file that ships, and not from a copy of it', () => {
    // A planted needle: the loader is pointed at a root whose media file has been
    // altered, and the alteration has to show up in what it returns. Without this
    // the tests above would pass just as well against a rule compiled into this
    // side, which is the arrangement they exist to rule out.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-model-'));
    try {
      fs.mkdirSync(path.join(root, 'media'));
      const shipped = fs.readFileSync(
        path.join(EXTENSION_ROOT, 'media', 'attachments-model.js'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(root, 'media', 'attachments-model.js'),
        shipped.replace(
          "const WITHHELD_MARKER_KEY = 'aggrega_withheld';",
          "const WITHHELD_MARKER_KEY = 'planted_needle';",
        ),
      );
      const planted = loadAttachmentsModel(root) as unknown as { WITHHELD_MARKER_KEY: string };
      assert.strictEqual(planted.WITHHELD_MARKER_KEY, 'planted_needle');
      assert.strictEqual(model.WITHHELD_MARKER_KEY, 'aggrega_withheld');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to build a payload at all when the rule cannot be loaded', () => {
    // With no rule there is no way to tell a value that may be shown from one
    // that may not, so nothing is posted. The caller reports the failure in the
    // panel; it does not fall back to sending the graph.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-model-'));
    try {
      const broken = createGraphRedactor(root);
      assert.throws(() => broken(irGraph({}), false));
      // The direction that does not need the rule is unaffected: the reader
      // asked for the payload as it stands.
      assert.doesNotThrow(() => broken(irGraph({}), true));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes exactly the set the view reports as withheld', () => {
    // The two sides are not two rules that agree; they are one rule asked twice.
    // What proves it is that the leaves removed on this side are the same leaves
    // the view marks withheld on the other, over an attachment carrying both
    // kinds of marked leaf and an unmarked one.
    const entry = {
      type: 'feature.gov/db-credential',
      resolved_version: '1.0.0',
      values: {
        secretName: PUBLIC_LOCATOR,
        credentials: { user: 'admin', password: SECRET },
        port: 5432,
      },
      infra: { size: 'small' },
      sensitive: false,
      sensitive_payload_leaves: ['values.credentials'],
    };

    const withheldBefore = projectOne('credentials', entry)
      .filter((f) => f.withheld)
      .map((f) => f.path);

    const posted = redact(irGraph({ api: { credentials: entry } }), false);
    const withheldAfter = project(posted, 'api')[0].fields
      .filter((f) => f.withheld)
      .map((f) => f.path);

    assert.deepStrictEqual(withheldAfter, withheldBefore);
    assert.deepStrictEqual(withheldBefore, [
      'values.credentials.user',
      'values.credentials.password',
    ]);
    assert.ok(!appearsAnywhere(posted, SECRET));
  });
});
