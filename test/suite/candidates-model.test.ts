// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// The candidate projection runs in the webview, so it is a plain script rather
// than a module the suite can import. These tests evaluate the shipped file the
// same way the webview does — as a script assigning to the global — so what is
// asserted is the file that actually ships and not a copy of it.
//
// What remains unverifiable here is the drawing: whether the section lands in
// the panel and what it looks like needs the extension host. What these tests
// do cover is every sentence the reader is shown and every row the panel is
// handed, including the two cases that mean opposite things — an answer naming
// nothing, and no answer at all.

interface CandidateFact {
  key: string;
  value: string;
}

interface CandidateRow {
  name: string;
  facts: CandidateFact[];
}

interface Projected {
  title: string;
  caption: string;
  rows: CandidateRow[];
  emptyNote: string;
  linksNote: string;
}

interface SlotProjected {
  name: string;
  description: string;
  facts: CandidateFact[];
  rows: CandidateRow[];
  emptyNote: string;
}

interface SlotsProjected {
  title: string;
  caption: string;
  slots: SlotProjected[];
  noSlotNote: string;
  linksNote: string;
}

interface CandidatesModel {
  projectCandidates(result: unknown, linksNote?: unknown): Projected;
  projectSlots(result: unknown, linksNote?: unknown): SlotsProjected;
  noSlotNote(reason: unknown): string;
  emptyNote(labelSource: string): string;
  failureNote(message: unknown): string;
  CANDIDATES_TITLE: string;
  CANDIDATES_CAPTION: string;
  PENDING_NOTE: string;
  SLOTS_CAPTION: string;
  SLOTS_ACTION_CAPTION: string;
  SLOTS_ENTRY_ACTION_CAPTION: string;
  SLOTS_PENDING_NOTE: string;
  SLOT_EMPTY_NOTE: string;
}

function loadModel(): CandidatesModel {
  const file = path.join(__dirname, '..', '..', '..', 'media', 'candidates-model.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaCandidates as CandidatesModel | undefined;
  assert.ok(model, `${file} defined no AggregaCandidates global`);
  // The script runs in its own realm, so the arrays it builds are instances of
  // that realm's constructors and compare unequal to this one's however
  // identical their contents. Cloning the structured result across the boundary
  // lets the assertions below compare values rather than realms.
  return {
    projectCandidates: (result, linksNote) => structuredClone(model.projectCandidates(result, linksNote)),
    projectSlots: (result, linksNote) => structuredClone(model.projectSlots(result, linksNote)),
    noSlotNote: (reason) => model.noSlotNote(reason),
    emptyNote: (labelSource) => model.emptyNote(labelSource),
    failureNote: (message) => model.failureNote(message),
    CANDIDATES_TITLE: model.CANDIDATES_TITLE,
    CANDIDATES_CAPTION: model.CANDIDATES_CAPTION,
    PENDING_NOTE: model.PENDING_NOTE,
    SLOTS_CAPTION: model.SLOTS_CAPTION,
    SLOTS_ACTION_CAPTION: model.SLOTS_ACTION_CAPTION,
    SLOTS_ENTRY_ACTION_CAPTION: model.SLOTS_ENTRY_ACTION_CAPTION,
    SLOTS_PENDING_NOTE: model.SLOTS_PENDING_NOTE,
    SLOT_EMPTY_NOTE: model.SLOT_EMPTY_NOTE,
  };
}

// answer wraps a candidate list in the envelope the language server's
// attach-candidates result carries, so the fixtures below are shaped like the
// real payload. Its label source is the one the server reports for the question
// the panel asks — a node of the drawn graph and the Release that graph was
// built from.
function answer(
  candidates: Array<Record<string, unknown>>,
  labelSource = 'resolved',
  nodeLabels: Record<string, string> = {},
): unknown {
  return { node: '', nodeLabels, labelSource, candidates };
}

describe('the candidate projection', () => {
  const model = loadModel();

  it('renders a workspace-declared candidate with the path a reader can act on', () => {
    const projected = model.projectCandidates(answer([
      { kind: 'Feature', name: 'tls', file: 'features/tls.yaml', origin: 'workspace' },
    ]));

    assert.strictEqual(projected.rows.length, 1);
    assert.strictEqual(projected.rows[0].name, 'tls');
    assert.deepStrictEqual(projected.rows[0].facts, [
      { key: 'kind', value: 'Feature' },
      { key: 'declared in', value: 'features/tls.yaml' },
    ]);
    // A populated answer shows the rows, so there is no sentence standing in
    // for them.
    assert.strictEqual(projected.emptyNote, '');
  });

  it('says where a catalog-resolved candidate came from, since it carries no path', () => {
    const projected = model.projectCandidates(answer([
      { kind: 'Feature', name: 'observability', file: '', origin: 'catalog' },
    ]));

    assert.deepStrictEqual(projected.rows[0].facts, [
      { key: 'kind', value: 'Feature' },
      { key: 'from', value: 'the configured catalog' },
    ]);
  });

  it('keeps the order the answer arrived in rather than imposing a second one', () => {
    const projected = model.projectCandidates(answer([
      { kind: 'Feature', name: 'zeta', file: 'a.yaml', origin: 'workspace' },
      { kind: 'Feature', name: 'alpha', file: 'b.yaml', origin: 'workspace' },
      { kind: 'Feature', name: 'mid', file: 'c.yaml', origin: 'workspace' },
    ]));

    assert.deepStrictEqual(
      projected.rows.map((r) => r.name),
      ['zeta', 'alpha', 'mid'],
    );
  });

  it('carries the heading and caption that keep a proposal from reading as a promise', () => {
    const projected = model.projectCandidates(answer([
      { kind: 'Feature', name: 'tls', file: 'f.yaml', origin: 'workspace' },
    ]));

    assert.strictEqual(projected.title, model.CANDIDATES_TITLE);
    assert.strictEqual(projected.caption, model.CANDIDATES_CAPTION);
    // The claim is about what a Feature DECLARES, and it says so rather than
    // asserting an outcome nobody has computed.
    assert.match(projected.caption, /declare/);
    assert.match(projected.caption, /not what a build will do/);
  });

  it('states the narrower thing for an empty answer, never "nothing can attach"', () => {
    const projected = model.projectCandidates(answer([]));

    assert.deepStrictEqual(projected.rows, []);
    assert.strictEqual(
      projected.emptyNote,
      'No Feature\'s declared applicability matches the labels on this node.',
    );
  });

  it('words the empty answer from the label set it was actually computed over', () => {
    // The three label sets are genuinely different statements, so one sentence
    // covering all of them would report the weakest answer as the strongest.
    const supplied = model.emptyNote('supplied');
    const resolved = model.emptyNote('resolved');
    const declared = model.emptyNote('declared');
    const unstated = model.emptyNote('');

    const all = [supplied, resolved, declared, unstated];
    assert.strictEqual(new Set(all).size, 4, 'each label set gets its own sentence');
    for (const note of all) {
      assert.match(note, /declared applicability/);
      // 🔴 The claim an empty list does NOT support.
      assert.doesNotMatch(note, /nothing can attach/i);
      assert.doesNotMatch(note, /cannot attach/i);
      // The wire words for the label sets are matched on, never shown.
      assert.doesNotMatch(note, /labelSource|supplied|resolved/);
      // A word for how the build arrives at a node's labels is one the panel
      // teaches nowhere, so no sentence reaches for it.
      assert.doesNotMatch(note, /finali[sz]ed/i);
    }

    // The set the panel's answer is computed over is the set the caption above
    // the list names, so its sentence names it in the caption's words — and no
    // other sentence does, because none of the other sets is that node's.
    const onThisNode = 'the labels on this node';
    assert.ok(model.CANDIDATES_CAPTION.includes(onThisNode), 'the caption names the labels on this node');
    assert.strictEqual(resolved, `No Feature's declared applicability matches ${onThisNode}.`);
    for (const note of [supplied, declared, unstated]) {
      assert.doesNotMatch(note, /on this node/);
    }
    assert.match(supplied, /sent with the request/);
    assert.match(declared, /that document declares/);
  });

  it('reports a refusal as a refusal, keeping the reason it was given', () => {
    const note = model.failureNote('the Aggrega language server is not running');

    assert.match(note, /^Cannot list what may attach: /);
    // The reason reaches the reader as it was reported, so a message naming a
    // remediation still names it.
    assert.match(note, /the Aggrega language server is not running$/);
    // A refusal is not an empty answer, and must not be worded as one.
    assert.doesNotMatch(note, /No Feature/);
  });

  it('still says the list is missing when the refusal carried no reason', () => {
    assert.strictEqual(model.failureNote(''), 'Cannot list what may attach.');
    assert.strictEqual(model.failureNote(undefined), 'Cannot list what may attach.');
  });

  it('draws no rows out of a payload it cannot read', () => {
    // A shape this file does not recognise yields the empty answer for an
    // unstated label set rather than rows built out of guesses.
    for (const bad of [undefined, null, 'nope', 42, [], { candidates: 'nope' }]) {
      const projected = model.projectCandidates(bad);
      assert.deepStrictEqual(projected.rows, [], `rows for ${JSON.stringify(bad) ?? 'undefined'}`);
      assert.strictEqual(projected.emptyNote, model.emptyNote(''));
    }
  });

  it('shows a provenance it does not recognise rather than dropping it', () => {
    // A candidate with no path has to say where it came from, or it is
    // indistinguishable from a row nothing filled in. A provenance this file
    // has no wording for is reported as it was sent — which says less than a
    // phrase invented here would, and nothing that is untrue.
    const projected = model.projectCandidates(answer([
      { kind: 'Feature', name: 'later', file: '', origin: 'somewhere-new' },
    ]));

    assert.deepStrictEqual(projected.rows[0].facts, [
      { key: 'kind', value: 'Feature' },
      { key: 'from', value: 'somewhere-new' },
    ]);
  });

  it('reads a candidate defensively, filling no field the answer did not carry', () => {
    const projected = model.projectCandidates(answer([
      {},
      { name: 'nameless-kind' },
      { name: 'odd', kind: 7, file: null, origin: undefined },
    ] as Array<Record<string, unknown>>));

    assert.deepStrictEqual(projected.rows, [
      { name: '', facts: [] },
      { name: 'nameless-kind', facts: [] },
      { name: 'odd', facts: [] },
    ]);
  });

  it('offers a waiting sentence that is neither an answer nor a failure', () => {
    assert.ok(model.PENDING_NOTE.length > 0);
    assert.doesNotMatch(model.PENDING_NOTE, /No Feature/);
    assert.doesNotMatch(model.PENDING_NOTE, /Cannot/);
  });

  it('carries the line naming the links leading out of the workspace as it was sent, beside rows or none', () => {
    // The line is composed on the host side from the language server's own
    // answer, so it is carried word for word rather than worded again here.
    const line = 'Features reached through this link are not offered, because it leads outside the Aggrega workspace: linked-feature.yaml';
    const withRows = model.projectCandidates(answer([{ kind: 'Feature', name: 'tls', file: 'f.yaml', origin: 'workspace' }]), line);
    assert.strictEqual(withRows.linksNote, line);
    assert.strictEqual(withRows.rows.length, 1);
    const withNone = model.projectCandidates(answer([]), line);
    assert.strictEqual(withNone.linksNote, line);
    assert.strictEqual(withNone.emptyNote, model.emptyNote('resolved'), 'the line took the place of the sentence for an empty answer');
  });

  it('carries no line where none was sent, or where what was sent is not a line', () => {
    for (const sent of [undefined, null, 42, { line: 'x' }]) {
      assert.strictEqual(model.projectCandidates(answer([]), sent).linksNote, '', `a line for ${JSON.stringify(sent) ?? 'undefined'}`);
    }
  });
});

// The answer the language server gives for a connection, as it answered for one
// the Aggregate drew with two slots: the node half, then the slots in the order
// the component declares them.
const TOKEN = { kind: 'Feature', name: 'feature.conn/token', file: 'catalog/features/token.yaml', origin: 'workspace' };
const AUDIT = { kind: 'Feature', name: 'feature.conn/audit', file: 'catalog/features/audit.yaml', origin: 'workspace' };
const PEERING = { kind: 'Feature', name: 'feature.conn/peering', file: 'catalog/features/peering.yaml', origin: 'workspace' };

function connectionAnswer(slots: unknown, noSlotReason?: string): unknown {
  const result: Record<string, unknown> = {
    node: 'gateway', nodeLabels: { 'component.aggrega.ai/type': 'server' }, labelSource: 'resolved',
    candidates: [AUDIT, PEERING, TOKEN], slots,
  };
  if (noSlotReason !== undefined) { result.noSlotReason = noSlotReason; }
  return result;
}

const MEASURED_SLOTS = [
  {
    slot: 'credential', selector: 'feature.aggrega.ai/kind=secret', required: true, inject: ['env'], sensitive: true,
    description: 'The credential the gateway presents to the model a connection reaches.', candidates: [TOKEN],
  },
  {
    slot: 'trace', selector: '', required: false, inject: [], sensitive: false,
    description: 'Where the gateway reports the calls a connection carries.', candidates: [AUDIT, PEERING, TOKEN],
  },
];

describe('the slot projection', () => {
  const model = loadModel();

  it('draws each slot in the order the answer names them, with what the answer says about it', () => {
    const projected = model.projectSlots(connectionAnswer(MEASURED_SLOTS));
    assert.deepStrictEqual(projected.slots.map((s) => s.name), ['credential', 'trace']);
    assert.deepStrictEqual(projected.slots[0].facts, [
      { key: 'required', value: 'yes' },
      { key: 'sensitive', value: 'yes' },
      { key: 'inject', value: 'env' },
      { key: 'selector', value: 'feature.aggrega.ai/kind=secret' },
    ]);
    assert.strictEqual(projected.slots[0].description, 'The credential the gateway presents to the model a connection reaches.');
    // A slot declaring no selector and no inject says so, rather than leaving
    // the fact out as though nothing had filled it in.
    assert.deepStrictEqual(projected.slots[1].facts, [
      { key: 'required', value: 'no' },
      { key: 'sensitive', value: 'no' },
      { key: 'inject', value: 'none declared' },
      { key: 'selector', value: 'none declared' },
    ]);
    assert.strictEqual(projected.noSlotNote, '');
  });

  it('draws the Features of each slot as the node\'s palette draws a candidate, in the answer\'s order', () => {
    const projected = model.projectSlots(connectionAnswer(MEASURED_SLOTS));
    assert.deepStrictEqual(projected.slots[0].rows, [
      { name: 'feature.conn/token', facts: [{ key: 'kind', value: 'Feature' }, { key: 'declared in', value: 'catalog/features/token.yaml' }] },
    ]);
    assert.deepStrictEqual(projected.slots[1].rows.map((r) => r.name),
      ['feature.conn/audit', 'feature.conn/peering', 'feature.conn/token']);
    // The node's own candidates, which the same answer carries, are not drawn
    // as a slot's: they answer a different question.
    assert.strictEqual(projected.slots.length, 2);
  });

  it('says what a slot with no Feature listed supports, and never that nothing can fill it', () => {
    const projected = model.projectSlots(connectionAnswer([{ ...MEASURED_SLOTS[0], candidates: [] }]));
    assert.deepStrictEqual(projected.slots[0].rows, []);
    assert.strictEqual(projected.slots[0].emptyNote, model.SLOT_EMPTY_NOTE);
    assert.match(model.SLOT_EMPTY_NOTE, /declared applicability/);
    assert.match(model.SLOT_EMPTY_NOTE, /selector/);
    assert.doesNotMatch(model.SLOT_EMPTY_NOTE, /cannot|nothing can/i);
    // A slot with rows has no sentence standing in for them.
    assert.strictEqual(model.projectSlots(connectionAnswer(MEASURED_SLOTS)).slots[0].emptyNote, '');
  });

  it('draws the reason for no slot in words, one sentence per reason the answer can give', () => {
    const notes = ['feature-created-connection', 'ad-hoc-socket', 'no-slot-declared'].map((reason) => {
      const projected = model.projectSlots(connectionAnswer([], reason));
      assert.deepStrictEqual(projected.slots, [], `slots drawn for ${reason}`);
      return projected.noSlotNote;
    });
    assert.strictEqual(new Set(notes).size, 3, 'two reasons share one sentence');
    assert.match(notes[0], /A Feature drew this connection/);
    assert.match(notes[1], /socket the component does not declare/);
    assert.match(notes[2], /with no slots/);
    for (const note of notes) {
      assert.match(note, /nothing may be attached here/);
      // The wire words for the reasons are matched on, never shown.
      assert.doesNotMatch(note, /feature-created|ad-hoc-socket|no-slot-declared/);
    }
  });

  it('claims nothing beyond "nothing may be attached here" for a reason it has no words for, or none', () => {
    for (const reason of ['a-reason-from-later', undefined]) {
      assert.strictEqual(model.projectSlots(connectionAnswer([], reason)).noSlotNote, 'Nothing may be attached here.');
    }
    assert.strictEqual(model.noSlotNote(7), 'Nothing may be attached here.');
  });

  it('offers nothing out of an answer whose slots it cannot read', () => {
    for (const bad of [undefined, null, 'nope', { slots: 'nope' }, { node: 'gateway' }]) {
      const projected = model.projectSlots(bad);
      assert.deepStrictEqual(projected.slots, [], `slots for ${JSON.stringify(bad) ?? 'undefined'}`);
      assert.strictEqual(projected.noSlotNote, 'Nothing may be attached here.');
    }
  });

  it('carries the line naming the links leading out of the workspace beside slots, and not where none may be filled', () => {
    const line = 'Features reached through this link are not offered, because it leads outside the Aggrega workspace: linked-feature.yaml';
    assert.strictEqual(model.projectSlots(connectionAnswer(MEASURED_SLOTS), line).linksNote, line);
    assert.strictEqual(model.projectSlots(connectionAnswer([], 'no-slot-declared'), line).linksNote, '');
  });

  it('heads the section as the node\'s palette is headed, with captions of its own', () => {
    const projected = model.projectSlots(connectionAnswer(MEASURED_SLOTS));
    assert.strictEqual(projected.title, model.CANDIDATES_TITLE);
    assert.strictEqual(projected.caption, model.SLOTS_CAPTION);
    assert.match(model.SLOTS_CAPTION, /not what a build will do/);
    assert.match(model.SLOTS_ACTION_CAPTION, /under the slot's name/);
    assert.match(model.SLOTS_ACTION_CAPTION, /the Release for a connection the Release drew, the Aggregate otherwise/);
    assert.ok(model.SLOTS_PENDING_NOTE.length > 0);
    assert.notStrictEqual(model.SLOTS_PENDING_NOTE, model.PENDING_NOTE);
  });

  it('says where an attach from a connection selected from its entry in a document is written', () => {
    assert.strictEqual(
      model.SLOTS_ENTRY_ACTION_CAPTION,
      'Attaching writes the Feature under the slot\'s name on this connection\'s entry in the document the '
      + 'command was run in. The change lands in the editor, where it can be undone.',
    );
    assert.notStrictEqual(model.SLOTS_ENTRY_ACTION_CAPTION, model.SLOTS_ACTION_CAPTION);
  });
});
