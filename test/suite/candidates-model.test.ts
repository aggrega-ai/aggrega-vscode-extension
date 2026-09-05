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
}

interface CandidatesModel {
  projectCandidates(result: unknown): Projected;
  emptyNote(labelSource: string): string;
  failureNote(message: unknown): string;
  CANDIDATES_TITLE: string;
  CANDIDATES_CAPTION: string;
  PENDING_NOTE: string;
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
    projectCandidates: (result) => structuredClone(model.projectCandidates(result)),
    emptyNote: (labelSource) => model.emptyNote(labelSource),
    failureNote: (message) => model.failureNote(message),
    CANDIDATES_TITLE: model.CANDIDATES_TITLE,
    CANDIDATES_CAPTION: model.CANDIDATES_CAPTION,
    PENDING_NOTE: model.PENDING_NOTE,
  };
}

// answer wraps a candidate list in the envelope the language server's
// attach-candidates result carries, so the fixtures below are shaped like the
// real payload.
function answer(
  candidates: Array<Record<string, unknown>>,
  labelSource = 'supplied',
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
    }
    assert.match(resolved, /finalised/);
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
});
