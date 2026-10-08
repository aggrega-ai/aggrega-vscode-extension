// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { ConnectionSite, attachRefusal, connectionContainerRequest } from '../../src/attachment-edit';
import {
  ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND,
  CONNECTION_DOCUMENTS_CONTEXT_KEY,
  DocumentSelection,
  UNREADABLE_ANSWER,
  connectionAtPositionRequest,
  connectionDocumentFiles,
  documentSelections,
  loadNoSlotNote,
  noConnectionSentence,
  readConnectionAtPosition,
  selectConnectionMessage,
} from '../../src/connection-at-cursor';
import { CatalogIndexDoc } from '../../src/workspace-catalog-run';
import { EXTENSION_ROOT } from '../helpers/launch-census';

// The document-free half of attaching a Feature to the connection at the cursor,
// driven without an editor: the question composed for the cursor, the reading of
// the language server's answer, the sentence for a cursor on no connection, the
// rule an attach from that selection is written by, and which documents the
// command is offered in.
//
// The answers below are the language server's own, copied as it emitted them for
// a workspace whose Aggregate draws a connection through models under gpt, whose
// Release writes its own entry for that connection, and whose Release draws a
// connection through mirrors under m1.

const AGGREGATE_GPT = { graphNode: 'gateway', connection: { socket: 'models', alias: 'gpt', document: 'aggregate' } };
const RELEASE_GPT = { graphNode: 'gateway', connection: { socket: 'models', alias: 'gpt', document: 'release' } };
const RELEASE_M1 = { graphNode: 'gateway', connection: { socket: 'mirrors', alias: 'm1', document: 'release' } };

// The connection through models under gpt as the drawn graph records it: the
// Aggregate drew it, and its credential slot is filled.
const DRAWN_GPT: ConnectionSite = {
  source: 'gateway', socket: 'models', alias: 'gpt', document: 'aggregate', filled: ['credential'],
};

const RELEASE = 'release.yaml';

// The shipped candidate projection's own sentence for a connection no slot may
// be filled on, evaluated as the view evaluates it, so the sentence the command
// reuses is compared with the file that ships rather than with a copy of it.
function shippedNoSlotNote(reason: string): string {
  const file = path.join(EXTENSION_ROOT, 'media', 'candidates-model.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaCandidates as { noSlotNote(reason: string): string };
  return model.noSlotNote(reason);
}

describe('the question asked about the cursor', () => {
  it('names the document, the position in the session\'s units, and the Release', () => {
    const text = 'kind: Aggregate\nspec:\n  uses:\n    models:\n      gpt:\n';
    assert.deepStrictEqual(
      connectionAtPositionRequest('aggregate.yaml', text, { line: 4, character: 6 }, 'utf-16', RELEASE),
      { file: 'aggregate.yaml', position: { line: 4, character: 6 }, release: RELEASE },
    );
  });

  it('converts the editor\'s column into the units the session settled on', () => {
    // "é" is one UTF-16 unit and two UTF-8 bytes, so a column past it is one
    // unit further on in UTF-8 than in UTF-16.
    const text = 'metadata:\n  # é\n  é: x\n';
    const cursor = { line: 2, character: 3 };
    assert.deepStrictEqual(connectionAtPositionRequest('a.yaml', text, cursor, 'utf-8', RELEASE).position, { line: 2, character: 4 });
    assert.deepStrictEqual(connectionAtPositionRequest('a.yaml', text, cursor, 'utf-16', RELEASE).position, { line: 2, character: 3 });
  });

  it('carries exactly the three fields the request takes', () => {
    const request = connectionAtPositionRequest('release.yaml', 'x', { line: 0, character: 0 }, 'utf-8', RELEASE);
    assert.deepStrictEqual(Object.keys(request), ['file', 'position', 'release']);
  });
});

describe('the answer, read into a selection or a reason', () => {
  it('reads a connection on an Aggregate\'s entry, and on a Release\'s entry for the same connection', () => {
    assert.deepStrictEqual(readConnectionAtPosition(AGGREGATE_GPT), {
      selection: { source: 'gateway', socket: 'models', alias: 'gpt', document: 'aggregate' },
    });
    assert.deepStrictEqual(readConnectionAtPosition(RELEASE_GPT), {
      selection: { source: 'gateway', socket: 'models', alias: 'gpt', document: 'release' },
    });
    assert.deepStrictEqual(readConnectionAtPosition(RELEASE_M1), {
      selection: { source: 'gateway', socket: 'mirrors', alias: 'm1', document: 'release' },
    });
  });

  it('reads a reason as it arrived, worded or not', () => {
    for (const reason of ['no-connection-entry', 'feature-created-connection', 'unknown-connection', 'a-later-reason', '']) {
      assert.deepStrictEqual(readConnectionAtPosition({ noConnectionReason: reason }), { noConnectionReason: reason });
    }
  });

  it('reads nothing out of an answer carrying both halves, neither, or a part of one', () => {
    const conn = AGGREGATE_GPT.connection;
    for (const value of [
      undefined, null, 'gateway', [], {},
      { ...AGGREGATE_GPT, noConnectionReason: 'no-connection-entry' },
      { graphNode: 'gateway' },
      { connection: conn },
      { graphNode: '', connection: conn },
      { graphNode: 'gateway', connection: { ...conn, socket: '' } },
      { graphNode: 'gateway', connection: { ...conn, alias: 7 } },
      { graphNode: 'gateway', connection: { socket: 'models', alias: 'gpt' } },
      { graphNode: 'gateway', connection: { ...conn, document: 'manifest' } },
      { noConnectionReason: 7 },
    ]) {
      assert.strictEqual(readConnectionAtPosition(value), null, JSON.stringify(value));
    }
  });

  it('says an unreadable answer in the words the attach\'s other unreadable answers take', () => {
    assert.ok(UNREADABLE_ANSWER.startsWith(attachRefusal('')), UNREADABLE_ANSWER);
  });
});

describe('the sentence for a cursor on no connection', () => {
  it('says each reason in a sentence of its own', () => {
    const entry = noConnectionSentence('no-connection-entry', shippedNoSlotNote);
    const unknown = noConnectionSentence('unknown-connection', shippedNoSlotNote);
    const feature = noConnectionSentence('feature-created-connection', shippedNoSlotNote);
    assert.strictEqual(
      entry,
      'The cursor is not inside a connection\'s entry — the entry a component draws a connection with, under its '
      + 'alias, or the entry a Release writes for one — so nothing may be attached here.',
    );
    assert.strictEqual(
      unknown,
      'The entry at the cursor is one the Release writes for a connection its compiled graph does not carry, so '
      + 'nothing may be attached here.',
    );
    assert.strictEqual(new Set([entry, unknown, feature]).size, 3, 'two reasons are said in one sentence');
  });

  it('says a connection a Feature drew in the sentence the graph panel says it in', () => {
    assert.strictEqual(
      noConnectionSentence('feature-created-connection', shippedNoSlotNote),
      shippedNoSlotNote('feature-created-connection'),
    );
    // The sentence is the one loaded from the file that ships, by the loader the
    // command uses.
    assert.strictEqual(
      noConnectionSentence('feature-created-connection', loadNoSlotNote(EXTENSION_ROOT)),
      shippedNoSlotNote('feature-created-connection'),
    );
  });

  it('claims nothing beyond the reason for one it has no wording for, or for none', () => {
    for (const reason of ['a-later-reason', '', 'ad-hoc-socket']) {
      assert.strictEqual(noConnectionSentence(reason, shippedNoSlotNote), 'Nothing may be attached at the cursor.');
    }
  });

  it('refuses to load a candidate projection that defines no such sentence', () => {
    assert.throws(() => loadNoSlotNote(path.join(EXTENSION_ROOT, 'no-such-root')));
  });
});

describe('an attach from a connection selected at the cursor', () => {
  const fromRelease: DocumentSelection = { source: 'gateway', socket: 'models', alias: 'gpt', document: 'release' };

  it('asks for the container in the document the answer named, not the one that drew the connection', () => {
    const selections = documentSelections();
    const id = selections.mint(fromRelease);
    assert.deepStrictEqual(connectionContainerRequest(selections.siteFor(DRAWN_GPT, id), RELEASE), {
      graphNode: 'gateway',
      release: RELEASE,
      connection: { socket: 'models', alias: 'gpt', document: 'release' },
    });
  });

  it('keeps every other fact of the drawn site, the filled slots among them', () => {
    const selections = documentSelections();
    const id = selections.mint(fromRelease);
    assert.deepStrictEqual(selections.siteFor(DRAWN_GPT, id), { ...DRAWN_GPT, document: 'release' });
  });

  it('writes a pressed edge\'s attach by the panel\'s own rule: no id, an unknown id, or one minted for another connection', () => {
    const selections = documentSelections();
    const id = selections.mint(fromRelease);
    assert.strictEqual(selections.siteFor(DRAWN_GPT, undefined), DRAWN_GPT);
    assert.strictEqual(selections.siteFor(DRAWN_GPT, id + 1), DRAWN_GPT);
    const m1: ConnectionSite = { source: 'gateway', socket: 'mirrors', alias: 'm1', document: 'release', filled: ['note'] };
    assert.strictEqual(selections.siteFor(m1, id), m1);
    const other: ConnectionSite = { ...DRAWN_GPT, source: 'edge.web' };
    assert.strictEqual(selections.siteFor(other, id), other);
  });

  it('honours only the newest selection, and none once cleared', () => {
    const selections = documentSelections();
    const first = selections.mint(fromRelease);
    const second = selections.mint({ ...fromRelease, document: 'aggregate' });
    assert.notStrictEqual(first, second);
    assert.strictEqual(selections.named(first), undefined);
    assert.strictEqual(selections.siteFor(DRAWN_GPT, first), DRAWN_GPT);
    assert.deepStrictEqual(selections.named(second), { ...fromRelease, document: 'aggregate' });
    selections.clear();
    assert.strictEqual(selections.named(second), undefined);
    assert.strictEqual(selections.siteFor(DRAWN_GPT, second), DRAWN_GPT);
  });

  it('never mints an id twice, so one a closed panel was told cannot name a later selection', () => {
    const selections = documentSelections();
    const first = selections.mint(fromRelease);
    selections.clear();
    const second = selections.mint(fromRelease);
    assert.notStrictEqual(first, second);
    assert.strictEqual(selections.siteFor(DRAWN_GPT, first), DRAWN_GPT);
  });

  it('keeps its own copy of what it minted', () => {
    const selections = documentSelections();
    const minted = { ...fromRelease };
    const id = selections.mint(minted);
    minted.document = 'aggregate';
    assert.strictEqual(selections.siteFor(DRAWN_GPT, id).document, 'release');
  });
});

describe('the selection the panel is asked to make', () => {
  const read = (answer: unknown): DocumentSelection => {
    const got = readConnectionAtPosition(answer);
    assert.ok(got !== null && 'selection' in got);
    return got.selection;
  };

  it('names the connection as the panel names it, with the id and nothing that says where to write', () => {
    assert.deepStrictEqual(selectConnectionMessage(4, read(AGGREGATE_GPT)), {
      type: 'selectConnection',
      selection: 4,
      nodeId: 'gateway',
      connection: { socket: 'models', alias: 'gpt' },
    });
  });

  it('asks for a Release\'s entry on an Aggregate\'s connection in the same words, the id apart', () => {
    assert.deepStrictEqual(
      { ...selectConnectionMessage(1, read(RELEASE_GPT)), selection: 4 },
      selectConnectionMessage(4, read(AGGREGATE_GPT)),
    );
  });
});

describe('the documents the command is offered in', () => {
  // The entity index the language server answered for the same workspace, in the
  // selected Release's terms, copied as it emitted it with each entity's labels
  // and description left as they arrived.
  const index: CatalogIndexDoc = {
    entities: [
      ['Aggregate', 'connection-site-app', 'aggregate.yaml'],
      ['Component', 'conn/gateway', 'catalog/components/gateway.yaml'],
      ['Component', 'conn/model', 'catalog/components/model.yaml'],
      ['Component', 'conn/sink', 'catalog/components/sink.yaml'],
      ['Feature', 'feature.conn/audit', 'catalog/features/audit.yaml'],
      ['Feature', 'feature.conn/peering', 'catalog/features/peering.yaml'],
      ['Feature', 'feature.conn/token', 'catalog/features/token.yaml'],
      ['Feature', 'feature.conn/vault', 'catalog/features/vault.yaml'],
      ['FeatureRecipe', 'conn-audit-compose', 'catalog/feature-recipes/audit.yaml'],
      ['FeatureRecipe', 'conn-peering-compose', 'catalog/feature-recipes/peering.yaml'],
      ['FeatureRecipe', 'conn-token-compose', 'catalog/feature-recipes/token.yaml'],
      ['Manifest', 'connection-site-manifest', 'manifest.yaml'],
      ['Plugin', 'compose', 'catalog/plugins/compose-renderer.yaml'],
      ['Recipe', 'conn-gateway-recipe', 'catalog/recipes/gateway.yaml'],
      ['Recipe', 'conn-model-recipe', 'catalog/recipes/model.yaml'],
      ['Recipe', 'conn-sink-recipe', 'catalog/recipes/sink.yaml'],
      ['Release', 'connection-site-release', 'release.yaml'],
    ].map(([kind, name, file]) => ({
      kind, name, apiVersion: 'aggrega.ai/v1alpha1', description: '', labels: {}, file, origin: 'workspace',
    })),
    unreadLinkedDirs: [],
    unreadLinkedFiles: [],
  };

  it('offers it in exactly the documents the index reports as an Aggregate or a Release', () => {
    assert.deepStrictEqual(connectionDocumentFiles(index), ['aggregate.yaml', 'release.yaml']);
  });

  it('offers it in no document for an entity resolved from a catalog directory, which reports none', () => {
    const fromCatalog: CatalogIndexDoc = {
      ...index,
      entities: [{ kind: 'Aggregate', name: 'shared', apiVersion: 'aggrega.ai/v1alpha1', description: '', labels: {}, file: '', origin: 'catalog' }],
    };
    assert.deepStrictEqual(connectionDocumentFiles(fromCatalog), []);
  });

  it('names a document once however many entities it declares, and an index naming none offers it nowhere', () => {
    const twice: CatalogIndexDoc = {
      ...index,
      entities: [
        { kind: 'Release', name: 'a', apiVersion: 'aggrega.ai/v1alpha1', description: '', labels: {}, file: 'releases.yaml', origin: 'workspace' },
        { kind: 'Release', name: 'b', apiVersion: 'aggrega.ai/v1alpha1', description: '', labels: {}, file: 'releases.yaml', origin: 'workspace' },
      ],
    };
    assert.deepStrictEqual(connectionDocumentFiles(twice), ['releases.yaml']);
    assert.deepStrictEqual(connectionDocumentFiles({ ...index, entities: null }), []);
  });

  it('is offered under the names the manifest declares it under', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
      contributes: {
        commands: Array<{ command: string; title: string; category?: string }>;
        menus: Record<string, Array<{ command: string; when?: string }>>;
      };
    };
    const declared = manifest.contributes.commands.find((c) => c.command === ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND);
    assert.deepStrictEqual(declared, {
      command: ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND,
      title: 'Attach a Feature to the connection at the cursor',
      category: 'Aggrega',
    });
    // The context menu and the command palette, each offering it only in a
    // document the condition names.
    const when = `resourcePath in ${CONNECTION_DOCUMENTS_CONTEXT_KEY}`;
    for (const menu of ['editor/context', 'commandPalette']) {
      const entries = (manifest.contributes.menus[menu] ?? []).filter((m) => m.command === ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND);
      assert.deepStrictEqual(entries.map((m) => m.when), [when], menu);
    }
  });
});
