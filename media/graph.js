// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// Webview renderer for the Aggrega IR topology graph. Receives the serialized
// IRGraph from the extension, lays it out with elkjs (nested boundary →
// subsystem → node containers, since the IR ships no coordinates), draws it as
// SVG, shows what is attached to the node the reader selects, and posts a
// source-open request back when a node is double-clicked. Depends only on the
// global `ELK` exposed by elk.bundled.js and the globals `AggregaGraphModel`
// and `AggregaAttachments` exposed by graph-model.js and attachments-model.js,
// which hold the IR-to-layout transform, the hover text and the attachment
// projection — no network access.
//
// Every value the panel shows comes from the attachment projection, and this
// file reads the IR's attachment table through nothing else. That is what keeps
// a value the projection withheld out of reach of the drawing code entirely,
// rather than relying on each drawing site to remember to check.

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const elk = new ELK();
  const model = AggregaGraphModel;
  const attachments = AggregaAttachments;

  const statusEl = document.getElementById('status');
  const canvas = document.getElementById('canvas');
  const panelEl = document.getElementById('panel');
  const panelTitleEl = document.getElementById('panel-title');
  const panelBodyEl = document.getElementById('panel-body');
  const panelCloseEl = document.getElementById('panel-close');

  // viewport is the pan/zoom group; every rendered element lives under it so a
  // single transform drives pan and zoom.
  let viewport = null;
  const view = { x: 0, y: 0, scale: 1 };

  // The projected attachments for every node of the rendered graph, and the
  // node the panel is showing. Both are rebuilt on every render: a re-render
  // may carry a different topology, and a panel left showing a node the new
  // graph no longer holds would report an attachment set that is nobody's.
  //
  // The projection is built once, at render, and the IR payload is not held
  // past it. What the panel needs is the projection; retaining the payload
  // would keep every value the projection withheld alive in this view for as
  // long as the panel stayed open, which buys nothing.
  let shownAttachments = new Map();
  let selectedId = null;
  // The drawn node groups, so selecting one can mark it and unmark the rest.
  const nodeGroups = new Map();

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

  panelCloseEl.addEventListener('click', () => { clearSelection(); });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { clearSelection(); }
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

    // The selection survives a re-render when the new graph still holds the
    // node. A recompile re-renders underneath the reader, and dropping the
    // selection every time would close the panel while they are reading it.
    const wasSelected = selectedId;
    shownAttachments = projectAttachments(graph);
    clearSelection();
    nodeGroups.clear();

    while (canvas.firstChild) { canvas.removeChild(canvas.firstChild); }
    viewport = document.createElementNS(SVGNS, 'g');
    canvas.appendChild(viewport);

    // Draw containers and nodes with accumulated absolute offsets, then edges
    // (whose section coordinates are relative to root, i.e. absolute here).
    drawChildren(laid.children || [], 0, 0, meta);
    drawEdges(laid.edges || []);

    if (wasSelected !== null && nodeGroups.has(wasSelected)) {
      selectNode(wasSelected);
    }

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

    // Selecting is the plain click and reaches every node, including one the
    // compiler sent no source file for. Opening the authoring file is the
    // double click, so the two coexist without either standing in for the
    // other — and a node with no file to open carries nothing on its double
    // click rather than an affordance that cannot do anything.
    g.setAttribute('class', 'node');
    g.addEventListener('click', () => { selectNode(node.id); });
    if (m && m.sourceFile) {
      g.addEventListener('dblclick', () => {
        vscode.postMessage({ type: 'openSource', nodeId: node.id, sourceFile: m.sourceFile });
      });
    }
    nodeGroups.set(node.id, g);
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

  // --- selection and the attachments panel --------------------------------

  function clearSelection() {
    selectedId = null;
    nodeGroups.forEach((g) => { g.classList.remove('node-selected'); });
    panelEl.classList.add('hidden');
    panelTitleEl.textContent = '';
    clear(panelBodyEl);
  }

  // projectAttachments projects every node's attachments up front, so the IR
  // payload is read here and nowhere else and need not outlive the render.
  function projectAttachments(graph) {
    const nodes = ((graph && graph.spec) || {}).nodes || {};
    const projected = new Map();
    for (const id of Object.keys(nodes)) {
      projected.set(id, attachments.attachmentsFor(graph, id));
    }
    return projected;
  }

  function selectNode(nodeId) {
    selectedId = nodeId;
    nodeGroups.forEach((g, id) => { g.classList.toggle('node-selected', id === nodeId); });
    drawPanel(shownAttachments.get(nodeId) || { nodeId: nodeId, attachments: [] });
    panelEl.classList.remove('hidden');
  }

  // drawPanel writes the projection into the panel. It is handed the projected
  // rows and never the IR, so a value the projection withheld is not something
  // this code could draw even by mistake.
  function drawPanel(projected) {
    panelTitleEl.textContent = projected.nodeId;
    clear(panelBodyEl);

    if (projected.attachments.length === 0) {
      panelBodyEl.appendChild(el('p', 'panel-empty', 'Nothing is attached to this node.'));
      return;
    }
    for (const a of projected.attachments) {
      panelBodyEl.appendChild(drawAttachment(a));
    }
  }

  function drawAttachment(a) {
    const box = el('section', 'attachment');

    const head = el('div', 'attachment-head');
    head.appendChild(el('span', 'attachment-name', a.name));
    if (a.sensitive) {
      head.appendChild(el('span', 'attachment-sensitive', 'sensitive'));
    }
    box.appendChild(head);

    const facts = el('dl', 'facts');
    addFact(facts, 'feature', a.type);
    addFact(facts, 'version', a.version);
    addFact(facts, 'slot', a.binding);
    addFact(facts, 'origin', a.origin);
    addFact(facts, 'annotation', a.annotationKey);
    addFact(facts, 'declared at', a.annotationSource);
    for (const l of a.labels) { addFact(facts, l.key, l.value); }
    if (facts.childNodes.length > 0) { box.appendChild(facts); }

    if (a.fields.length > 0) {
      const config = el('dl', 'facts config');
      for (const f of a.fields) {
        config.appendChild(el('dt', '', f.path));
        config.appendChild(f.withheld
          ? el('dd', 'withheld', attachments.withheldNote(f.withheld))
          : el('dd', '', f.value));
      }
      box.appendChild(config);
    }
    return box;
  }

  function addFact(dl, key, value) {
    if (!value) { return; }
    dl.appendChild(el('dt', '', key));
    dl.appendChild(el('dd', '', value));
  }

  // el builds an element and fills it through textContent, never through
  // markup: every string here is content an author wrote in their own YAML, so
  // it is text to display and never markup to interpret.
  function el(tag, cls, textContent) {
    const n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (textContent !== undefined) { n.textContent = textContent; }
    return n;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
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
