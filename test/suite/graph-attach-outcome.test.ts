// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { DRAWABLE_GRAPH, GraphWebview, StubElement, loadGraphWebview } from '../helpers/webview-dom';

// Which line about an attach the panel draws, and under which list.
//
// The side that serves an attach answers every request with a line, and it
// answers about the node the request named. Which of those lines the panel
// draws is decided on the drawing side alone, against the node the reader is
// looking at and the nodes the drawing on screen carries, so that is where it is
// driven: the shipped renderer, a stand-in document, the real layout engine.
//
// 🔴 A DROPPED LINE AND A LINE THAT NEVER ARRIVED LOOK THE SAME, so every
// reading that requires a line not to be drawn is paired with one showing the
// same panel drawing a line it is owed. Without that control, a panel whose
// outcome line had stopped being drawn at all would pass every spec here that
// asks for silence.

const RELEASE = 'releases/dev.yaml';

// A node no drawing here carries.
const UNDRAWN = 'no-such-node';

// The two-node topology with its second node gone, so a redraw can take a drawn
// node away while the first stays selected.
const WITHOUT_DB = {
  apiVersion: 'aggrega.ai/v1alpha1',
  kind: 'IRGraph',
  spec: {
    nodes: { api: { component: 'core/service', resolved_version: '1.0.0' } },
    edges: [],
  },
};

// The lines the side serving an attach sends, as it words them.
const notOnTheGraph = (node: string): string => `${node} is not on the graph this panel drew.`;
const attachedTo = (node: string): string => `Attached core/backup to ${node} as backup.`;
const LIST_REFUSAL = 'Cannot attach: the attachments in this document are written as a list, which this cannot add to.';

function find(root: StubElement, match: (el: StubElement) => boolean): StubElement | null {
  for (const child of root.children) {
    if (match(child)) { return child; }
    const deeper = find(child, match);
    if (deeper !== null) { return deeper; }
  }
  return null;
}

// drawnNode is the group the drawing on screen drew for one node, or null.
function drawnNode(view: GraphWebview, id: string): StubElement | null {
  return find(view.element('canvas'), (el) => el.tag === 'g' && el.getAttribute('class') === 'node'
    && el.children.some((c) => c.getAttribute('class') === 'node-label' && c.textContent === id));
}

// draw renders one topology and does not return until THIS render has landed:
// a render replaces the pan/zoom group, so a new group is what distinguishes it
// from the drawing before it.
async function draw(view: GraphWebview, graph: unknown): Promise<void> {
  const previous = view.element('canvas').firstChild;
  view.post({ type: 'render', release: RELEASE, graph: graph as Record<string, unknown>, asked: false });
  await view.settle(
    () => view.element('canvas').firstChild !== previous && view.drawn() > 0,
    'a drawn topology',
  );
}

// select presses one drawn node, as a reader does, through the handler the
// renderer put on it.
function select(view: GraphWebview, id: string): void {
  const node = drawnNode(view, id);
  assert.ok(node, `the drawing carries no node ${id} to press`);
  node.fire('click');
  assert.strictEqual(
    view.element('panel-title').textContent, id,
    `pressing ${id} did not open the panel on it, so nothing below is about the list it shows`,
  );
}

// shownOn is a panel with the two-node topology drawn and one node selected.
async function shownOn(id: string): Promise<GraphWebview> {
  const view = loadGraphWebview();
  await draw(view, DRAWABLE_GRAPH);
  select(view, id);
  return view;
}

function outcome(view: GraphWebview, nodeId: string, message: string, attached: boolean): void {
  view.post({ type: 'attachOutcome', nodeId, message, attached });
}

// The one connection DRAWABLE_GRAPH draws, as an outcome about it names it.
const PRIMARY = { socket: 'store', alias: 'primary' };

function connectionOutcome(
  view: GraphWebview, nodeId: string, connection: { socket: string; alias: string }, message: string, attached: boolean,
): void {
  view.post({ type: 'attachOutcome', nodeId, connection, message, attached });
}

// selectConnection presses the one drawn edge, as a reader does, through the
// handler the renderer put on its group.
function selectConnection(view: GraphWebview): void {
  const edge = find(view.element('canvas'), (el) => el.tag === 'g' && el.getAttribute('class') === 'edge-group');
  assert.ok(edge, 'the drawing carries no edge to press');
  edge.fire('click');
  assert.strictEqual(
    view.element('panel-title').textContent, 'api → db',
    'pressing the edge did not open the panel on its connection, so nothing below is about the list it shows',
  );
}

// outcomeLine is the line under the list the panel is showing — its words, and
// whether it is drawn as a failure — or null where no line is drawn.
function outcomeLine(view: GraphWebview): { text: string; failed: boolean } | null {
  const line = find(view.element('panel-body'), (el) => el.classes.has('attach-outcome'));
  assert.ok(
    line,
    'the panel draws no place for an attach\'s outcome at all, so no reading of it here says anything',
  );
  return line.classes.has('hidden') ? null : { text: line.textContent, failed: line.classes.has('attach-failed') };
}

describe('which line about an attach the panel draws', () => {
  it('draws the outcome about the node it is showing, in the words it arrived in', async () => {
    const view = await shownOn('api');
    assert.strictEqual(outcomeLine(view), null, 'a line was drawn before any attach was answered');

    outcome(view, 'api', attachedTo('api'), true);
    assert.deepStrictEqual(outcomeLine(view), { text: attachedTo('api'), failed: false });

    outcome(view, 'api', LIST_REFUSAL, false);
    assert.deepStrictEqual(
      outcomeLine(view), { text: LIST_REFUSAL, failed: true },
      'a refused attach on the node the panel is showing is not drawn as a failure in its own words',
    );
  });

  it('drops an outcome about another node the drawing carries', async () => {
    const view = await shownOn('api');
    assert.ok(drawnNode(view, 'db'), 'the drawing carries no db, so this is not about a drawn node');

    for (const [message, attached] of [[attachedTo('db'), true], [LIST_REFUSAL, false]] as const) {
      outcome(view, 'db', message, attached);
      assert.strictEqual(
        outcomeLine(view), null,
        `a line about db was drawn under the list for api: ${JSON.stringify(outcomeLine(view))}. `
        + 'The reader is looking at api, and a line about the node they have moved on from, under '
        + 'the list of the one they are on, reads as being about the one they are on',
      );
    }

    // The control: the same panel draws the line it is owed, and a later line
    // about db does not replace it.
    outcome(view, 'api', attachedTo('api'), true);
    assert.deepStrictEqual(
      outcomeLine(view), { text: attachedTo('api'), failed: false },
      'the panel drew no line about its own node either, so the silence above is not a drop',
    );
    outcome(view, 'db', LIST_REFUSAL, false);
    assert.deepStrictEqual(
      outcomeLine(view), { text: attachedTo('api'), failed: false },
      'a line about db replaced the line about the node the panel is showing',
    );
  });

  it('draws the refusal for a node the drawing does not carry, as a failure, under the list it is showing',
    async () => {
      const view = await shownOn('api');
      assert.strictEqual(drawnNode(view, UNDRAWN), null, `the drawing carries a node named ${UNDRAWN}`);

      outcome(view, UNDRAWN, notOnTheGraph(UNDRAWN), false);

      assert.deepStrictEqual(
        outcomeLine(view), { text: notOnTheGraph(UNDRAWN), failed: true },
        'the refusal for a node the drawing does not carry was not drawn as a failure in its own words. '
        + 'No selection in this drawing can have moved on from that node, and dropping the line leaves '
        + 'the request with no answer at all',
      );
      assert.strictEqual(view.element('panel-title').textContent, 'api', 'the refusal moved the panel off api');
    });

  it('drops a line saying an attach was made for a node the drawing does not carry', async () => {
    const view = await shownOn('api');

    outcome(view, UNDRAWN, attachedTo(UNDRAWN), true);
    assert.strictEqual(
      outcomeLine(view), null,
      'a line saying an attach was made for a node the drawing does not carry was drawn under the list '
      + 'for api. Only a refusal is drawn for such a node: the edit a made attach wrote is in front of '
      + 'the reader already, and the line is about no node on screen',
    );

    // The control: the refusal for the same node is drawn in the same panel.
    outcome(view, UNDRAWN, notOnTheGraph(UNDRAWN), false);
    assert.deepStrictEqual(outcomeLine(view), { text: notOnTheGraph(UNDRAWN), failed: true });
  });

  it('judges an outcome against the drawing on screen while a new one is still being laid out',
    async () => {
      const view = await shownOn('api');
      const onScreen = view.element('canvas').firstChild;

      // The redraw takes db away, and its layout runs off a promise; the outcome
      // is handled before that promise can settle.
      view.post({ type: 'render', release: RELEASE, graph: WITHOUT_DB, asked: false });
      outcome(view, 'db', LIST_REFUSAL, false);

      assert.strictEqual(
        view.element('canvas').firstChild, onScreen,
        'the new layout had already been drawn, so this reading is not about one in flight',
      );
      assert.strictEqual(
        outcomeLine(view), null,
        'a refusal about db, which the drawing on screen still carries, was drawn under the list for '
        + 'api while a redraw without db was being laid out. A line is judged against the drawing the '
        + 'reader is looking at, and db is still in it',
      );

      await view.settle(
        () => view.element('canvas').firstChild !== onScreen && view.drawn() > 0,
        'the redrawn topology',
      );
      assert.strictEqual(drawnNode(view, 'db'), null, 'the redraw still carries db');
      assert.strictEqual(view.element('panel-title').textContent, 'api', 'the redraw dropped the selection of api');
      assert.strictEqual(outcomeLine(view), null, 'the redrawn panel carries a line no outcome was sent for');

      outcome(view, 'db', notOnTheGraph('db'), false);
      assert.deepStrictEqual(
        outcomeLine(view), { text: notOnTheGraph('db'), failed: true },
        'once db is off the drawing, the refusal naming it is not drawn under the list the panel shows',
      );
    });
});

// The same rule, with a connection as the subject. A connection's panel draws
// its own section of what may fill its slots, with its own outcome line, and an
// outcome naming a connection is judged by the one rule a node's is.
describe('which line about an attach to a connection the panel draws', () => {
  const ATTACHED = 'Attached feature.conn/audit to the connection primary through socket store of api as trace.';
  const FILLED = 'The slot credential of the connection primary through socket store of api is already filled.';
  const notDrawn = (alias: string): string => `The connection ${alias} through socket store of api is not on the graph this panel drew.`;

  async function onTheConnection(): Promise<GraphWebview> {
    const view = loadGraphWebview();
    await draw(view, DRAWABLE_GRAPH);
    selectConnection(view);
    return view;
  }

  it('asks what may fill the connection it opens on, by the node, the socket and the alias', async () => {
    const view = await onTheConnection();
    const asked = view.posted.filter((m) => (m as { type?: string }).type === 'connectionCandidates');
    assert.strictEqual(asked.length, 1, 'selecting the connection asked nothing, or asked twice');
    const question = asked[0] as { nodeId: string; connection: unknown; requestId: number };
    assert.strictEqual(question.nodeId, 'api');
    assert.deepStrictEqual({ ...(question.connection as object) }, PRIMARY);
    assert.strictEqual(typeof question.requestId, 'number');
  });

  it('draws the outcome about the connection it is showing, in the words it arrived in', async () => {
    const view = await onTheConnection();
    assert.strictEqual(outcomeLine(view), null, 'a line was drawn before any attach was answered');

    connectionOutcome(view, 'api', PRIMARY, ATTACHED, true);
    assert.deepStrictEqual(outcomeLine(view), { text: ATTACHED, failed: false });

    connectionOutcome(view, 'api', PRIMARY, FILLED, false);
    assert.deepStrictEqual(outcomeLine(view), { text: FILLED, failed: true });
  });

  it('drops an outcome about a node the drawing carries while it shows a connection', async () => {
    const view = await onTheConnection();

    outcome(view, 'api', attachedTo('api'), true);
    outcome(view, 'db', LIST_REFUSAL, false);
    assert.strictEqual(outcomeLine(view), null,
      'a line about a node was drawn under the list for a connection, where it reads as being about the connection');

    // The control: the same panel draws the line it is owed.
    connectionOutcome(view, 'api', PRIMARY, ATTACHED, true);
    assert.deepStrictEqual(outcomeLine(view), { text: ATTACHED, failed: false });
  });

  it('drops an outcome about the connection while it shows a node, and draws the node\'s own', async () => {
    const view = await shownOn('api');

    connectionOutcome(view, 'api', PRIMARY, ATTACHED, true);
    connectionOutcome(view, 'api', PRIMARY, FILLED, false);
    assert.strictEqual(outcomeLine(view), null,
      'a line about a drawn connection was drawn under the list for a node');

    outcome(view, 'api', attachedTo('api'), true);
    assert.deepStrictEqual(outcomeLine(view), { text: attachedTo('api'), failed: false });
  });

  it('draws the refusal for a connection the drawing does not carry, and drops a line saying one was attached', async () => {
    const view = await onTheConnection();
    const undrawn = { socket: 'store', alias: 'nonesuch' };

    connectionOutcome(view, 'api', undrawn, 'Attached core/x to the connection nonesuch.', true);
    assert.strictEqual(outcomeLine(view), null,
      'a line saying an attach was made to a connection the drawing does not carry was drawn');

    connectionOutcome(view, 'api', undrawn, notDrawn('nonesuch'), false);
    assert.deepStrictEqual(outcomeLine(view), { text: notDrawn('nonesuch'), failed: true },
      'the refusal for a connection the drawing does not carry was not drawn as a failure in its own words');
    assert.strictEqual(view.element('panel-title').textContent, 'api → db', 'the refusal moved the panel off the connection');
  });
});
