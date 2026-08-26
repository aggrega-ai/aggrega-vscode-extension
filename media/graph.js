// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// Webview renderer for the Aggrega IR topology graph. Receives the serialized
// IRGraph from the extension, lays it out with elkjs (nested boundary →
// subsystem → node containers, since the IR ships no coordinates), draws it as
// SVG, and posts a source-open request back when a node is clicked. Depends
// only on the global `ELK` exposed by elk.bundled.js and the global
// `AggregaGraphModel` exposed by graph-model.js, which holds the IR-to-layout
// transform and the hover text — no network access.

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const elk = new ELK();
  const model = AggregaGraphModel;

  const statusEl = document.getElementById('status');
  const canvas = document.getElementById('canvas');

  // viewport is the pan/zoom group; every rendered element lives under it so a
  // single transform drives pan and zoom.
  let viewport = null;
  const view = { x: 0, y: 0, scale: 1 };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'loading') {
      setStatus(`Laying out ${msg.release}…`, false);
    } else if (msg.type === 'error') {
      setStatus(`${msg.release}: ${msg.message}`, true);
    } else if (msg.type === 'render') {
      renderGraph(msg.graph).catch((err) => setStatus(String(err), true));
    }
  });

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.remove('hidden');
  }

  function hideStatus() {
    statusEl.classList.add('hidden');
  }

  // --- render -------------------------------------------------------------

  async function renderGraph(graph) {
    const { root, meta } = model.toElkGraph(graph);
    const laid = await elk.layout(root);
    hideStatus();

    while (canvas.firstChild) { canvas.removeChild(canvas.firstChild); }
    viewport = document.createElementNS(SVGNS, 'g');
    canvas.appendChild(viewport);

    // Draw containers and nodes with accumulated absolute offsets, then edges
    // (whose section coordinates are relative to root, i.e. absolute here).
    drawChildren(laid.children || [], 0, 0, meta);
    drawEdges(laid.edges || []);

    fitToView(laid);
    installInteraction();
  }

  function drawChildren(children, offX, offY, meta) {
    for (const child of children) {
      const x = offX + (child.x || 0);
      const y = offY + (child.y || 0);
      if (child._kind === 'boundary' || child._kind === 'subsystem') {
        drawContainer(child, x, y);
        drawChildren(child.children || [], x, y, meta);
      } else {
        drawNode(child, x, y, meta.get(child.id));
      }
    }
  }

  function drawContainer(c, x, y) {
    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', c.width || 0);
    rect.setAttribute('height', c.height || 0);
    rect.setAttribute('rx', '6');
    rect.setAttribute('class', c._kind === 'boundary' ? 'container-boundary' : 'container-subsystem');
    viewport.appendChild(rect);

    const title = document.createElementNS(SVGNS, 'text');
    title.setAttribute('x', x + 10);
    title.setAttribute('y', y + 16);
    title.setAttribute('class', 'container-title');
    title.textContent = (c._kind === 'boundary' ? '▣ ' : '▢ ') + c._title;
    viewport.appendChild(title);
  }

  function drawNode(node, x, y, m) {
    const g = document.createElementNS(SVGNS, 'g');

    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('class', 'node-rect');
    g.appendChild(rect);

    // Type accent bar down the leading edge, colour-blind-safe palette.
    const accent = m && m.accent;
    if (accent) {
      const bar = document.createElementNS(SVGNS, 'rect');
      bar.setAttribute('x', x);
      bar.setAttribute('y', y);
      bar.setAttribute('width', 5);
      bar.setAttribute('height', node.height);
      bar.setAttribute('class', 'node-accent');
      bar.style.fill = accent;
      g.appendChild(bar);
    }

    const cx = x + node.width / 2;
    const label = document.createElementNS(SVGNS, 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', y + node.height / 2 - 4);
    label.setAttribute('class', 'node-label');
    label.textContent = node.id;
    g.appendChild(label);

    if (m && m.component && m.component !== node.id) {
      const sub = document.createElementNS(SVGNS, 'text');
      sub.setAttribute('x', cx);
      sub.setAttribute('y', y + node.height / 2 + 11);
      sub.setAttribute('class', 'node-sub');
      sub.textContent = m.component;
      g.appendChild(sub);
    }

    const tip = document.createElementNS(SVGNS, 'title');
    tip.textContent = model.nodeTooltip(node.id, m);
    g.appendChild(tip);

    if (m && m.sourceFile) {
      g.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSource', nodeId: node.id, sourceFile: m.sourceFile });
      });
    }
    viewport.appendChild(g);
  }

  function drawEdges(edges) {
    for (const e of edges) {
      for (const sec of e.sections || []) {
        const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
          .map((p) => `${p.x},${p.y}`)
          .join(' ');
        const poly = document.createElementNS(SVGNS, 'polyline');
        poly.setAttribute('points', pts);
        let cls = 'edge';
        if (e._origin === 'release') { cls += ' edge-release'; }
        else if (e._origin === 'feature') { cls += ' edge-feature'; }
        poly.setAttribute('class', cls);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = model.edgeTooltip(e);
        poly.appendChild(tip);
        viewport.appendChild(poly);
      }
    }
  }

  // --- pan / zoom ---------------------------------------------------------

  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function fitToView(laid) {
    const w = laid.width || 1;
    const h = laid.height || 1;
    const vw = canvas.clientWidth || 800;
    const vh = canvas.clientHeight || 600;
    const scale = Math.min(vw / (w + 40), vh / (h + 40), 1.5);
    view.scale = scale > 0 ? scale : 1;
    view.x = (vw - w * view.scale) / 2;
    view.y = (vh - h * view.scale) / 2;
    applyView();
  }

  let interactionInstalled = false;
  function installInteraction() {
    if (interactionInstalled) { return; }
    interactionInstalled = true;

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      // Zoom around the cursor.
      view.x = mx - (mx - view.x) * factor;
      view.y = my - (my - view.y) * factor;
      view.scale *= factor;
      applyView();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('mousedown', (ev) => {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      canvas.classList.add('panning');
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) { return; }
      view.x += ev.clientX - lastX;
      view.y += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      applyView();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      canvas.classList.remove('panning');
    });
  }
})();
