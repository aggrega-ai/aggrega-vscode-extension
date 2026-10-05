// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { DRAWABLE_GRAPH, GraphWebview, StubElement, loadGraphWebview } from '../helpers/webview-dom';

// Where the panel draws the line naming the links leading out of the workspace
// that the extension posts with an answer about what may attach: under the rows,
// or under the sentence standing in for them, inside the list it explains — and
// nowhere when none was posted. Driven on the shipped renderer, a stand-in
// document and the real layout engine, as a reader's press drives it.
//
// 🔴 A LINE NOT DRAWN AND A LIST NOT DRAWN LOOK THE SAME, so every reading that
// requires no line also requires the list it would sit under to be drawn.

const RELEASE = 'releases/dev.yaml';
const LINE = 'Features reached through this link are not offered, because it leads outside the Aggrega workspace: linked-feature.yaml';
const ONE_ROW = { node: 'api', nodeLabels: {}, labelSource: 'resolved', candidates: [{ kind: 'Feature', name: 'tls', file: 'features/tls.yaml', origin: 'workspace' }] };
const NO_ROW = { node: 'api', nodeLabels: {}, labelSource: 'resolved', candidates: [] };

function find(root: StubElement, match: (el: StubElement) => boolean): StubElement | null {
  for (const child of root.children) {
    if (match(child)) { return child; }
    const deeper = find(child, match);
    if (deeper !== null) { return deeper; }
  }
  return null;
}

// shownOn is a panel with the two-node topology drawn and one node pressed, as a
// reader presses it, answering with the id the panel minted for that press.
async function shownOn(id: string): Promise<{ view: GraphWebview; requestId: number }> {
  const view = loadGraphWebview();
  view.post({ type: 'render', release: RELEASE, graph: DRAWABLE_GRAPH as unknown as Record<string, unknown>, asked: false });
  await view.settle(() => view.drawn() > 0, 'a drawn topology');
  const node = find(view.element('canvas'), (el) => el.tag === 'g' && el.getAttribute('class') === 'node'
    && el.children.some((c) => c.getAttribute('class') === 'node-label' && c.textContent === id));
  assert.ok(node, `the drawing carries no node ${id} to press`);
  node.fire('click');
  const asked = view.posted.filter((m) => (m as { type?: string }).type === 'attachCandidates') as { requestId: number }[];
  assert.ok(asked.length > 0, `pressing ${id} asked nothing about what may attach`);
  return { view, requestId: asked[asked.length - 1].requestId };
}

// listBody is what the list of what may attach draws: each child of its body, by
// its class and its words.
function listBody(view: GraphWebview): { cls: string; text: string }[] {
  const body = find(view.element('panel-body'), (el) => el.classes.has('candidates-body'));
  assert.ok(body, 'the panel draws no list of what may attach');
  return body.children.map((c) => ({ cls: c.className, text: c.textContent }));
}

describe('the line naming the links leading out of the workspace, in the list of what may attach', () => {
  it('draws the line it was posted under the rows, in its words', async () => {
    const { view, requestId } = await shownOn('api');
    view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result: ONE_ROW, linksNote: LINE });
    const drawn = listBody(view);
    assert.deepStrictEqual(drawn.map((d) => d.cls), ['candidate', 'candidates-links']);
    assert.strictEqual(drawn[1].text, LINE);
  });

  it('draws it under the sentence standing in for an answer naming nothing', async () => {
    const { view, requestId } = await shownOn('api');
    view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result: NO_ROW, linksNote: LINE });
    const drawn = listBody(view);
    assert.deepStrictEqual(drawn.map((d) => d.cls), ['panel-empty', 'candidates-links']);
    assert.strictEqual(drawn[1].text, LINE);
  });

  it('draws no line where none was posted, the list itself drawn', async () => {
    for (const result of [ONE_ROW, NO_ROW]) {
      const { view, requestId } = await shownOn('api');
      view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result });
      const drawn = listBody(view);
      assert.ok(drawn.length > 0, 'the list was not drawn, so its having no line says nothing');
      assert.ok(!drawn.some((d) => d.cls === 'candidates-links'), `a line was drawn that nobody posted: ${JSON.stringify(drawn)}`);
    }
  });

  it('takes the line away with the list it explained when the next answer, or a refusal, replaces it', async () => {
    const { view, requestId } = await shownOn('api');
    view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result: ONE_ROW, linksNote: LINE });
    assert.ok(listBody(view).some((d) => d.cls === 'candidates-links'), 'the line was not drawn in the first place');
    view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result: ONE_ROW });
    assert.deepStrictEqual(listBody(view).map((d) => d.cls), ['candidate']);
    view.post({ type: 'attachCandidates', nodeId: 'api', requestId, result: ONE_ROW, linksNote: LINE });
    view.post({ type: 'attachCandidatesError', nodeId: 'api', requestId, message: 'the Aggrega language server is not running' });
    assert.deepStrictEqual(listBody(view).map((d) => d.cls), ['candidates-failed']);
  });
});
