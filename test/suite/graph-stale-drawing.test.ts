// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { DRAWABLE_GRAPH, GraphWebview, loadGraphWebview } from '../helpers/webview-dom';

// What the topology panel presents when a graph could not be drawn.
//
// 🔴 THE DEFECT THESE ARE ABOUT IS SILENT BY CONSTRUCTION. A graph is built from
// the authored documents as they stand on disk; a rebuild that fails leaves the
// canvas holding a topology that is no longer true of any of them, and a drawing
// carries no indication of when it was made. Nothing fails, nothing is logged,
// and the reader goes on working from a picture that has stopped being true. So
// what is asserted here is not that a message was written — it is what is in
// front of the reader afterwards.
//
// There are THREE routes to one failure, and the specs drive all three: the
// refresh that follows a document reaching disk, the reader pressing the command
// again, and a drawing the layout engine refuses. They must end in the same
// presentation, because the reader cannot tell which route they are on and the
// failure is the same failure.

const RELEASE = 'releases/dev.yaml';
const REFUSAL = 'the Aggregate names a component the catalog does not carry';

// A graph the layout engine refuses: an edge naming neither end. It is refused
// after the transform and before the canvas is touched, which is what makes it
// the third route rather than a fourth defect.
const UNDRAWABLE_GRAPH = {
  apiVersion: 'aggrega.ai/v1alpha1',
  kind: 'IRGraph',
  spec: {
    nodes: { api: { component: 'core/service', resolved_version: '1.0.0' } },
    edges: [{ socket: 'store' }],
  },
};

// drawOnce renders the drawable topology and does not return until THIS render
// has landed on the canvas.
//
// 🔴 IT IS THE CONTROL EVERY ASSERTION BELOW RESTS ON. Each of them is about
// something on the canvas SURVIVING; a run in which nothing was ever drawn
// reports the same zero at every step and reads exactly like a canvas that was
// cleared. Two earlier readings of this very question were wrong that way — an
// instrument that had stopped drawing reported the defect as absent — so the
// drawing is required to exist before anything is concluded from it.
//
// 🔴 IT WAITS ON THE PAN/ZOOM GROUP BEING A NEW ONE, not on the canvas being
// non-empty. A render replaces that group, so its identity distinguishes THIS
// render from the one before it, while "something is drawn" is already true the
// second time round and would let a spec read the previous render's result as
// this one's. It is deliberately independent of everything asserted below: a
// wait keyed on the thing under test passes by waiting for it and reports
// nothing.
async function drawOnce(view: GraphWebview): Promise<number> {
  const previous = view.element('canvas').firstChild;
  view.post({ type: 'render', release: RELEASE, graph: DRAWABLE_GRAPH });
  await view.settle(
    () => view.element('canvas').firstChild !== previous && view.drawn() > 0,
    'a drawn topology',
  );
  const drawn = view.drawn();
  assert.ok(
    drawn > 0,
    'the control drew nothing, so every count below would be measuring an empty canvas rather '
    + 'than a drawing that survived',
  );
  return drawn;
}

describe('what the topology panel presents when a graph could not be drawn', () => {
  it('keeps the drawing and says it is out of date, rather than leaving it standing as current',
    async () => {
      const view = loadGraphWebview();
      const drawn = await drawOnce(view);

      view.post({ type: 'error', release: RELEASE, message: REFUSAL });

      assert.strictEqual(
        view.drawn(), drawn,
        'the drawing was discarded. The topology it shows is the last one the compiler built and '
        + 'is still worth reading, and it is still where the reader was working — what a failure '
        + 'withdraws is the claim that it is current, not the drawing',
      );
      assert.ok(
        view.canvasClasses().includes('out-of-date'),
        'the drawing that survived the failure is not marked, so a reader who does not read the '
        + 'notice in the corner is looking at a topology that has stopped being true with nothing '
        + 'saying so',
      );
      assert.ok(
        view.statusText().includes('out of date'),
        `the notice does not say the graph on screen is out of date. It said: ${view.statusText()}`,
      );
      assert.ok(
        view.statusText().includes(REFUSAL),
        'the compiler\'s own sentence was dropped, and it is usually the one naming what the '
        + `reader has to change. The notice said: ${view.statusText()}`,
      );
      assert.ok(
        view.statusClasses().includes('error'),
        'the notice is not marked as a failure',
      );
    });

  it('presents the same failure the same way whichever route reached it', async () => {
    // The refresh that follows a document reaching disk shows no notice first.
    const watched = loadGraphWebview();
    await drawOnce(watched);
    watched.post({ type: 'error', release: RELEASE, message: REFUSAL });

    // The reader pressing the command shows one first, which is what makes this
    // a different route rather than the same one twice.
    const pressed = loadGraphWebview();
    await drawOnce(pressed);
    pressed.post({ type: 'loading', release: RELEASE });
    assert.ok(
      pressed.statusText().includes('Laying out'),
      'the second route did not take the path that shows a notice first, so the two readings '
      + 'below are of one route rather than of two',
    );
    pressed.post({ type: 'error', release: RELEASE, message: REFUSAL });

    // A drawing the layout engine refuses fails inside the panel rather than at
    // the compiler, and reaches the notice by a third path entirely.
    const refused = loadGraphWebview();
    await drawOnce(refused);
    refused.post({ type: 'render', release: RELEASE, graph: UNDRAWABLE_GRAPH });
    await refused.settle(
      () => refused.canvasClasses().includes('out-of-date'),
      'a layout failure reported',
    );

    assert.strictEqual(
      watched.statusText(), pressed.statusText(),
      'the same failure reads differently depending on whether the reader pressed the command or '
      + 'saved a document, and a reader cannot tell which route they are on',
    );
    assert.deepStrictEqual(
      watched.canvasClasses(), pressed.canvasClasses(),
      'the drawing is presented differently by route for one failure',
    );
    assert.deepStrictEqual(
      watched.canvasClasses(), refused.canvasClasses(),
      'a drawing that could not be laid out leaves the previous one presented differently from a '
      + 'graph the compiler refused, and both are the same thing to a reader: the picture in '
      + 'front of them is not the current topology',
    );
    assert.ok(
      refused.statusText().includes('out of date'),
      `a drawing that could not be laid out left the previous one standing as current. The notice `
      + `said: ${refused.statusText()}`,
    );
  });

  it('claims no stale drawing when the panel has drawn none', () => {
    const view = loadGraphWebview();
    assert.strictEqual(view.drawn(), 0, 'the canvas is not empty before anything is rendered');

    view.post({ type: 'error', release: RELEASE, message: REFUSAL });

    assert.ok(
      !view.statusText().includes('out of date'),
      'a panel that has drawn nothing was told its drawing is out of date. There is no drawing, '
      + `so the sentence is false. It said: ${view.statusText()}`,
    );
    assert.ok(
      !view.canvasClasses().includes('out-of-date'),
      'an empty canvas was marked as holding a drawing that is out of date',
    );
    assert.ok(
      view.statusText().includes(REFUSAL),
      `the reader was not told what went wrong. The notice said: ${view.statusText()}`,
    );
  });

  it('withdraws the mark when a drawing is rebuilt', async () => {
    const view = loadGraphWebview();
    await drawOnce(view);
    view.post({ type: 'error', release: RELEASE, message: REFUSAL });
    assert.ok(
      view.canvasClasses().includes('out-of-date'),
      'the drawing was not marked in the first place, so the withdrawal below would pass '
      + 'vacuously',
    );

    await drawOnce(view);

    assert.ok(
      !view.canvasClasses().includes('out-of-date'),
      'a drawing the compiler has just rebuilt is still presented as out of date, so the mark '
      + 'means nothing after the first failure',
    );
  });
});
