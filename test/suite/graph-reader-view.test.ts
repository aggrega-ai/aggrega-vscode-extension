// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { sourceOf } from '../helpers/graph-refresh-census';
import {
  DRAWABLE_GRAPH,
  GraphWebview,
  StubElement,
  loadGraphWebview,
} from '../helpers/webview-dom';

// What a redraw the reader did not ask for does to what they are looking at.
//
// 🔴 EVERY DEFECT THESE ARE ABOUT IS SILENT. A drawing framed for the wrong
// area is still a drawing: it is scaled, it is centred, nothing throws and
// nothing is logged. The reader finds out by looking, which is exactly the
// evidence a test cannot collect after the fact — so what is asserted here is
// the frame itself, read off the drawn group, before and after each thing that
// could move it.
//
// TWO READINGS OF ONE SYMPTOM ARE BOTH DRIVEN, and that is the reason the
// hidden-panel specs come in pairs. A panel the editor is not showing may
// report an empty drawing area or a collapsed one; the two are indistinguishable
// from inside the panel, they produce the same ruined drawing, and a repair that
// only handled one of them would pass everything the other one asks. Neither is
// asserted to be what the editor really does — this stand-in reports whatever it
// is told — so what these prove is that the repair does not depend on which it
// is.

const RELEASE = 'releases/dev.yaml';

// The drawing area a reader is looking at, and the two a panel that is not on
// screen might report instead.
const ON_SCREEN = { width: 800, height: 600 };
const REPORTS_NOTHING = { width: 0, height: 0 };
const REPORTS_COLLAPSED = { width: 16, height: 9 };

// A legend over the lower left of that drawing area, tall enough to leave a
// third of the height above it — so a drawing fitted to the whole area runs
// under it, and one fitted to the room above it does not.
const LEGEND = { left: 8, top: 200, width: 300, height: 392 };

// A third node, so a refresh can carry a topology that genuinely differs rather
// than the same one twice.
const GROWN_GRAPH = {
  apiVersion: 'aggrega.ai/v1beta1',
  kind: 'IRGraph',
  spec: {
    nodes: {
      api: { component: 'core/service', resolved_version: '1.0.0' },
      db: { component: 'core/database', resolved_version: '1.0.0' },
      cache: { component: 'core/cache', resolved_version: '1.0.0' },
    },
    edges: [
      { source: 'api', target: 'db', socket: 'store', alias: 'primary' },
      { source: 'api', target: 'cache', socket: 'cache', alias: 'session' },
    ],
  },
};

// drawOnce renders one topology and does not return until THIS render has
// landed.
//
// 🔴 IT IS THE CONTROL EVERY ASSERTION BELOW RESTS ON, and it waits on the
// pan/zoom group being a new one rather than on the canvas being non-empty: a
// render replaces that group, so its identity distinguishes this render from
// the one before it, while "something is drawn" is already true the second time
// round. A run in which the second render never happened would otherwise read
// as a frame that survived it.
async function drawOnce(
  view: GraphWebview,
  graph: unknown = DRAWABLE_GRAPH,
  opts: { asked?: boolean } = {},
): Promise<void> {
  const previous = view.element('canvas').firstChild;
  view.post({
    type: 'render',
    release: RELEASE,
    graph: graph as Record<string, unknown>,
    asked: !!opts.asked,
  });
  await view.settle(
    () => view.element('canvas').firstChild !== previous && view.drawn() > 0,
    'a drawn topology',
  );
  assert.ok(
    view.drawn() > 0,
    'the control drew nothing, so every frame read below would be a reading of an empty canvas '
    + 'rather than of a drawing',
  );
}

// geometry is where every box of the drawing sits in the laid-out graph's own
// coordinates. Combined with an unchanged frame it is what "the same node is
// still under the same part of the panel" means: the panel maps one to the
// other, and neither moved.
function geometry(view: GraphWebview): string[] {
  const found: string[] = [];
  const walk = (node: StubElement): void => {
    if (node.tag === 'rect') {
      found.push(`${node.getAttribute('x')},${node.getAttribute('y')}`);
    }
    for (const child of node.children) { walk(child); }
  };
  walk(view.element('canvas'));
  return found.sort();
}

// scaleOf reads the zoom out of a frame, so a spec can say how small a drawing
// came out rather than only that it changed.
function scaleOf(frame: string | null): number {
  const found = /scale\(([-0-9.e]+)\)/.exec(frame ?? '');
  assert.ok(found, `no zoom in the frame: ${frame}`);
  return Number(found[1]);
}

// panOf reads where a frame puts the laid-out graph's origin in the panel.
function panOf(frame: string | null): { x: number; y: number } {
  const found = /translate\(([-0-9.e]+),([-0-9.e]+)\)/.exec(frame ?? '');
  assert.ok(found, `no pan in the frame: ${frame}`);
  return { x: Number(found[1]), y: Number(found[2]) };
}

// drawnSpan is the smallest box holding every box of the drawing, in the panel's
// own coordinates under the frame it carries — where a reader sees it drawn.
function drawnSpan(view: GraphWebview): { left: number; top: number; right: number; bottom: number } {
  const frame = view.frame();
  const scale = scaleOf(frame);
  const pan = panOf(frame);
  const span = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const walk = (node: StubElement): void => {
    if (node.tag === 'rect') {
      const x = Number(node.getAttribute('x'));
      const y = Number(node.getAttribute('y'));
      span.left = Math.min(span.left, x);
      span.top = Math.min(span.top, y);
      span.right = Math.max(span.right, x + Number(node.getAttribute('width')));
      span.bottom = Math.max(span.bottom, y + Number(node.getAttribute('height')));
    }
    for (const child of node.children) { walk(child); }
  };
  walk(view.element('canvas'));
  return {
    left: pan.x + span.left * scale,
    top: pan.y + span.top * scale,
    right: pan.x + span.right * scale,
    bottom: pan.y + span.bottom * scale,
  };
}

// extent is how far the drawing reaches in the laid-out graph's own
// coordinates. Multiplied by the zoom it is how much of the panel the drawing
// asks for, which is what "the whole topology is on screen" is measured
// against.
function extent(view: GraphWebview): { width: number; height: number } {
  let width = 0;
  let height = 0;
  const walk = (node: StubElement): void => {
    if (node.tag === 'rect') {
      width = Math.max(width, Number(node.getAttribute('x')) + Number(node.getAttribute('width')));
      height = Math.max(height, Number(node.getAttribute('y')) + Number(node.getAttribute('height')));
    }
    for (const child of node.children) { walk(child); }
  };
  walk(view.element('canvas'));
  return { width, height };
}

// a topology of `count` services in a chain, which is how a drawing is made big
// enough to ask the question about zoom.
function chainOf(count: number): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  const edges: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    nodes[`service-${i}`] = { component: 'core/service', resolved_version: '1.0.0' };
    if (i > 0) {
      edges.push({
        source: `service-${i - 1}`, target: `service-${i}`, socket: 'next', alias: `link-${i}`,
      });
    }
  }
  return { apiVersion: 'aggrega.ai/v1beta1', kind: 'IRGraph', spec: { nodes, edges } };
}

// panAndZoom moves the drawing the way a reader does, through the renderer's
// own handlers. The drag continues on the window, which is where the renderer
// listens for it.
function panAndZoom(view: GraphWebview): void {
  const canvas = view.element('canvas');
  canvas.fire('wheel', { deltaY: -1, clientX: 400, clientY: 300 });
  canvas.fire('mousedown', { clientX: 400, clientY: 300 });
  view.fireWindow('mousemove', { clientX: 470, clientY: 250 });
  view.fireWindow('mouseup', {});
}

// openedOnScreen loads a panel the editor is showing, with a drawing area to
// frame against.
function openedOnScreen(): GraphWebview {
  const view = loadGraphWebview();
  view.setDrawingArea(ON_SCREEN.width, ON_SCREEN.height);
  return view;
}

describe('what a redraw does to what the reader is looking at', () => {
  it('fits a drawing nobody has seen yet, because there is no view to keep', async () => {
    const view = openedOnScreen();
    await drawOnce(view);

    const frame = view.frame();
    assert.ok(frame, 'the first drawing carries no frame at all, so nothing positioned it');
    const scale = scaleOf(frame);
    assert.ok(
      scale > 0 && scale <= 1.5,
      `the first drawing was not fitted to the panel: it came out at ${scale}`,
    );
    assert.ok(
      /translate\((?!0,0\))/.test(frame),
      `the first drawing was not centred in the panel. Its frame is ${frame}`,
    );
  });

  it('fits a first drawing to the room above the legend, centred from side to side', async () => {
    const view = openedOnScreen();
    view.element('legend').box = LEGEND;
    await drawOnce(view);

    const at = drawnSpan(view);
    const above = LEGEND.top - at.bottom;
    assert.ok(
      above >= 0,
      `the first drawing reaches ${(-above).toFixed(1)} px under the top of the legend, which stays over `
      + `the panel's lower left whatever the reader does, so what it covers is hidden from the first `
      + `look. The drawing spans ${JSON.stringify(at)} and the legend's top is at ${LEGEND.top}`,
    );
    const left = at.left;
    const right = ON_SCREEN.width - at.right;
    assert.ok(
      Math.abs(left - right) <= 1,
      `the first drawing is not centred from side to side: ${left.toFixed(1)} px are left empty at its `
      + `left and ${right.toFixed(1)} at its right`,
    );
    assert.ok(
      Math.abs(at.top - above) <= 1,
      `the first drawing is not fitted to the room above the legend: ${at.top.toFixed(1)} px are left `
      + `empty above it and ${above.toFixed(1)} between it and the legend, where a drawing fitted to `
      + 'that room leaves the two even',
    );
  });

  it('leaves the reader\'s own pan and zoom alone when the same topology is rebuilt',
    async () => {
      const view = openedOnScreen();
      await drawOnce(view);
      const fitted = view.frame();

      panAndZoom(view);
      const readers = view.frame();
      assert.notStrictEqual(
        readers, fitted,
        'the reader\'s pan and zoom did not move the drawing, so the assertion below would pass '
        + 'against a view nobody had changed',
      );
      const wasAt = geometry(view);

      await drawOnce(view);

      assert.strictEqual(
        view.frame(), readers,
        'a rebuild the reader did not ask for moved the drawing out from under them. They panned '
        + 'and zoomed to what they were reading, and a redraw that re-fits the panel throws that '
        + 'away every time the compiler finishes',
      );
      assert.deepStrictEqual(
        geometry(view), wasAt,
        'the rebuilt topology is the same one, so every node should have come back where it was — '
        + 'and with the frame unchanged that is what keeps one under the same part of the panel',
      );
    });

  it('leaves it alone when the rebuilt topology genuinely differs', async () => {
    const view = openedOnScreen();
    await drawOnce(view);
    panAndZoom(view);
    const readers = view.frame();
    const wasAt = geometry(view);

    await drawOnce(view, GROWN_GRAPH);

    assert.notDeepStrictEqual(
      geometry(view), wasAt,
      'the second render drew the same boxes, so this is the same topology twice and says nothing '
      + 'about one that differs',
    );
    assert.strictEqual(
      view.frame(), readers,
      'a topology that grew a node moved the reader somewhere else. Where they are looking is '
      + 'theirs: a node they cannot see is one pan away, while a frame that jumps takes away the '
      + 'bearings they had',
    );
  });

  it('does not frame a drawing against a panel that reports no drawing area', async () => {
    const reference = openedOnScreen();
    await drawOnce(reference);
    const onScreen = reference.frame();

    const view = loadGraphWebview();
    view.post({ type: 'visibility', visible: false });
    view.setDrawingArea(REPORTS_NOTHING.width, REPORTS_NOTHING.height);

    await drawOnce(view);
    assert.strictEqual(
      view.frame(), 'translate(0,0) scale(1)',
      `a panel the editor is not showing framed its drawing anyway, against a drawing area of `
      + `${REPORTS_NOTHING.width}×${REPORTS_NOTHING.height}. Its frame is ${view.frame()}`,
    );

    view.setDrawingArea(ON_SCREEN.width, ON_SCREEN.height);
    view.post({ type: 'visibility', visible: true });

    assert.strictEqual(
      view.frame(), onScreen,
      'the drawing was never framed once the panel came back on screen, so the reader is looking '
      + 'at whatever the render happened to leave behind',
    );
  });

  it('does not frame it against a panel that reports a collapsed drawing area either',
    async () => {
      const reference = openedOnScreen();
      await drawOnce(reference);
      const onScreen = reference.frame();

      const view = loadGraphWebview();
      view.post({ type: 'visibility', visible: false });
      view.setDrawingArea(REPORTS_COLLAPSED.width, REPORTS_COLLAPSED.height);

      await drawOnce(view);
      assert.strictEqual(
        view.frame(), 'translate(0,0) scale(1)',
        `a panel the editor is not showing framed its drawing against a collapsed drawing area of `
        + `${REPORTS_COLLAPSED.width}×${REPORTS_COLLAPSED.height}. A number this small is what a `
        + `measurement cannot tell from a narrow panel in use, which is why the panel is told `
        + `rather than asked. Its frame is ${view.frame()}`,
      );

      view.setDrawingArea(ON_SCREEN.width, ON_SCREEN.height);
      view.post({ type: 'visibility', visible: true });

      assert.strictEqual(
        view.frame(), onScreen,
        'the drawing was never framed once the panel came back on screen',
      );
    });

  it('keeps the reader\'s frame through a rebuild that lands while the panel is away',
    async () => {
      for (const away of [REPORTS_NOTHING, REPORTS_COLLAPSED]) {
        const view = openedOnScreen();
        await drawOnce(view);
        panAndZoom(view);
        const readers = view.frame();

        view.post({ type: 'visibility', visible: false });
        view.setDrawingArea(away.width, away.height);
        await drawOnce(view, GROWN_GRAPH);
        view.setDrawingArea(ON_SCREEN.width, ON_SCREEN.height);
        view.post({ type: 'visibility', visible: true });

        assert.strictEqual(
          view.frame(), readers,
          `a rebuild that landed while the panel was away came back framed differently, with the `
          + `panel reporting ${away.width}×${away.height} while it was away. This is what the `
          + `reader meets as a drawing gone small and pushed into a corner`,
        );
      }
    });

  it('frames the drawing afresh when the reader asks for the graph again', async () => {
    const view = openedOnScreen();
    await drawOnce(view);
    const fitted = view.frame();
    panAndZoom(view);
    assert.notStrictEqual(
      view.frame(), fitted,
      'the reader\'s pan and zoom did not move the drawing, so nothing below distinguishes a '
      + 'reframing from a view that never left',
    );

    await drawOnce(view, DRAWABLE_GRAPH, { asked: true });

    assert.strictEqual(
      view.frame(), fitted,
      'a reader who pressed for the graph did not get the whole topology back. That press is the '
      + 'way back from a corner of a large drawing, and without it a reader who zooms in has to '
      + 'close the panel to see the shape of their system again',
    );
  });

  it('shows the whole of a large topology rather than a readable corner of it', async () => {
    const view = openedOnScreen();
    await drawOnce(view, chainOf(40));

    const scale = scaleOf(view.frame());
    const reach = extent(view);
    assert.ok(
      scale < 0.5,
      `the topology driven here is not large enough to ask the question: it came out at ${scale}, `
      + 'which is a zoom a reader can still read',
    );
    assert.ok(
      reach.width * scale <= ON_SCREEN.width && reach.height * scale <= ON_SCREEN.height,
      'a large topology was framed so that part of it falls outside the panel. The whole shape is '
      + 'what a first drawing is for — a reader who cannot read the names can still see how their '
      + 'system is put together, and reaches the names by zooming, whereas a corner of a drawing '
      + `says nothing about how much more there is. It reached ${reach.width}×${reach.height} at a `
      + `zoom of ${scale}`,
    );
  });

  it('frames a first drawing once the drawing area gains a size, with no message to say so',
    async () => {
      const reference = openedOnScreen();
      await drawOnce(reference);
      const onScreen = reference.frame();

      // On screen throughout: the panel is showing, and the only thing missing
      // is a document that has been laid out. Nothing announces that passing,
      // so the drawing area is watched.
      const view = loadGraphWebview();
      view.setDrawingArea(0, 0);
      await drawOnce(view);
      assert.strictEqual(
        view.frame(), 'translate(0,0) scale(1)',
        `a drawing area of nothing was framed against anyway. Its frame is ${view.frame()}`,
      );

      view.setDrawingArea(ON_SCREEN.width, ON_SCREEN.height);

      assert.strictEqual(
        view.frame(), onScreen,
        'a panel that was on screen the whole time never framed its first drawing, so a reader '
        + 'whose panel had not been laid out when the graph arrived is left with an unframed one '
        + 'and nothing that will ever frame it',
      );
    });
});

// The two facts the panel is told rather than working out, asserted where they
// are said.
//
// 🔴 THESE ARE DELIBERATELY A READING OF THE SOURCE, and the reason is that
// nothing in this suite can drive the editor side: the view is registered
// against the editor's own module, so there is no in-process way to open a
// panel, hide it, and watch what leaves. The specs above prove what the panel
// does with each fact once it has it; these prove it is sent, which is the half
// that would otherwise fail silently — a panel never told it is off screen
// keeps only the guard against an empty drawing area, and a panel never told
// the reader pressed for a graph loses their way back to the whole topology.
// Both leave every spec above passing.
describe('what the editor side tells the panel', () => {
  const source = (): string => sourceOf('src/graph-view.ts');

  it('tells the panel when the editor stops or starts showing it', () => {
    const view = source();
    assert.ok(
      view.includes('onDidChangeViewState'),
      'the panel is no longer told when the editor stops showing it. It cannot measure that for '
      + 'itself — a panel that is off screen reports a size like any other, and one that looks '
      + 'plausible is exactly what a drawing then gets framed against',
    );
    assert.ok(
      /toPanel\.post\(\{\s*type: 'visibility', visible: panel\.visible \}\)/.test(view),
      'the editor\'s own answer about whether the panel is showing is not what is sent, so what '
      + 'the panel acts on is something computed on its behalf',
    );
  });

  it('tells the panel whether the reader asked for the drawing', () => {
    assert.ok(
      /type: 'render',[^}]*asked: !opts\.quiet/.test(source()),
      'a drawing no longer says whether the reader asked for it. Without it every render is a '
      + 'quiet one, so a reader who has zoomed into a corner of a large topology has no way back '
      + 'to the whole of it short of closing the panel',
    );
  });
});
