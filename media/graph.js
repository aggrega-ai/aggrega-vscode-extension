// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// Webview renderer for the Aggrega IR topology graph. Receives the serialized
// IRGraph from the extension, lays it out with elkjs (nested boundary →
// subsystem → node containers, since the IR ships no coordinates), draws it as
// SVG with a legend for the parts of the drawing that are otherwise unreadable,
// shows what is attached to the node the reader selects and what may attach to
// it, and posts a source-open request back when a node is double-clicked.
//
// This file owns the document, which makes it the only side that can measure
// text — so it supplies the measurement the layout model asks for, and every
// decision about which strings are drawn and how a box is sized around them
// stays in that model where it can be exercised without an editor.
// Depends only on the global `ELK` exposed by elk.bundled.js
// and the globals `AggregaGraphModel`, `AggregaAttachments` and
// `AggregaCandidates` exposed by graph-model.js, attachments-model.js and
// candidates-model.js, which hold the IR-to-layout transform, the hover text,
// the attachment projection and the candidate projection — no network access.
//
// Every value the panel shows comes from the attachment projection, and this
// file reads the IR's attachment table through nothing else. That is what keeps
// a value the projection withheld out of reach of the drawing code entirely,
// rather than relying on each drawing site to remember to check.
//
// THE PANEL ANSWERS TWO DIFFERENT QUESTIONS AND KEEPS THEM APART. What IS
// attached is projected from the IR already in hand and is drawn at once. What
// MAY attach is not in the IR at all: it is asked for when a node is selected
// and drawn when the answer arrives, so that half of the panel has a waiting
// state and a failure state the first half has no use for.

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const elk = new ELK();
  const model = AggregaGraphModel;
  const attachments = AggregaAttachments;
  const candidates = AggregaCandidates;

  const statusEl = document.getElementById('status');
  const canvas = document.getElementById('canvas');
  const panelEl = document.getElementById('panel');
  const panelTitleEl = document.getElementById('panel-title');
  const panelBodyEl = document.getElementById('panel-body');
  const panelCloseEl = document.getElementById('panel-close');
  const legendEl = document.getElementById('legend');
  const measureTextEl = document.getElementById('measure-text');

  // WHERE A MEASUREMENT CAN BE TAKEN, since the layout runs before any of the
  // graph is in the document. Nothing that is laid out exists yet at that
  // point, but the document itself does — so the measurement is taken on a text
  // element that is in the document from the start, in its own tiny SVG parked
  // off to the side of the viewport. It carries the same class the drawn text
  // carries, so it inherits the same font family and size, and the width it
  // reports is the width that will be drawn.
  //
  // The rig is positioned out of sight rather than hidden: an element the
  // browser does not lay out has no text advance to report, so hiding it would
  // silently measure every string as nothing.
  const MEASURE_CLASS = {};
  MEASURE_CLASS[model.ROLE_NODE_ID] = 'node-label';
  MEASURE_CLASS[model.ROLE_NODE_COMPONENT] = 'node-sub';
  MEASURE_CLASS[model.ROLE_CONTAINER_TITLE] = 'container-title';

  function measureText(text, role) {
    if (!text) { return 0; }
    measureTextEl.setAttribute('class', MEASURE_CLASS[role] || '');
    measureTextEl.textContent = text;
    return measureTextEl.getComputedTextLength();
  }

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

  // Each node's label set, kept from the render so selecting a node can ask
  // what may attach to it without the graph being fetched or rebuilt.
  //
  // These are the labels the compiler put on the drawn nodes, held exactly as
  // they arrived. Nothing here derives, merges or normalises them: the question
  // asked is about the labels the reader is looking at, and a set assembled
  // here would be a different question wearing the same name.
  let shownLabels = new Map();
  // The body of the palette section for the node the panel is showing, so an
  // answer that arrives later fills it without the whole panel being redrawn
  // underneath the reader.
  let candidatesBodyEl = null;
  // The id of the question the panel is currently waiting on. Every request
  // mints a new one and only the newest is drawn.
  //
  // The node id cannot do this job. A re-render re-asks about the SAME node,
  // precisely because that node's labels may have just changed, so two answers
  // can be in flight for one id — and they can complete in either order, since
  // each is a separate round trip. Matching on the node alone would let the
  // older answer land last and draw a candidate list computed over labels the
  // graph no longer has.
  let candidatesRequestId = 0;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'loading') {
      setStatus(`Laying out ${msg.release}…`, false);
    } else if (msg.type === 'error') {
      setStatus(`${msg.release}: ${msg.message}`, true);
    } else if (msg.type === 'render') {
      renderGraph(msg.graph).catch((err) => setStatus(String(err), true));
    } else if (msg.type === 'attachCandidates') {
      showCandidates(msg.requestId, candidates.projectCandidates(msg.result));
    } else if (msg.type === 'attachCandidatesError') {
      showCandidatesFailure(msg.requestId, msg.message);
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
    const { root, meta } = model.toElkGraph(graph, measureText);
    const laid = await elk.layout(root);
    hideStatus();

    // The selection survives a re-render when the new graph still holds the
    // node. A recompile re-renders underneath the reader, and dropping the
    // selection every time would close the panel while they are reading it.
    const wasSelected = selectedId;
    shownAttachments = projectAttachments(graph);
    shownLabels = nodeLabels(meta);
    clearSelection();
    nodeGroups.clear();

    while (canvas.firstChild) { canvas.removeChild(canvas.firstChild); }
    viewport = document.createElementNS(SVGNS, 'g');
    canvas.appendChild(viewport);

    // The layout is nested and every position in it is stated relative to a
    // parent, so it is resolved into one absolute space before anything is
    // drawn — boxes in draw order, and the origin each edge's own geometry is
    // stated against.
    const { boxes, origins } = model.place(laid);
    for (const box of boxes) {
      if (box.kind === 'boundary' || box.kind === 'subsystem') {
        drawContainer(box);
      } else {
        drawNode(box, meta.get(box.node.id));
      }
    }
    drawEdges(laid.edges || [], origins);
    drawLegend();

    if (wasSelected !== null && nodeGroups.has(wasSelected)) {
      selectNode(wasSelected);
    }

    fitToView(laid);
    installInteraction();
  }

  function drawContainer(box) {
    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', box.x);
    rect.setAttribute('y', box.y);
    rect.setAttribute('width', box.width);
    rect.setAttribute('height', box.height);
    rect.setAttribute('rx', '6');
    rect.setAttribute('class', box.kind === 'boundary' ? 'container-boundary' : 'container-subsystem');
    viewport.appendChild(rect);

    const title = document.createElementNS(SVGNS, 'text');
    title.setAttribute('x', box.x + 10);
    title.setAttribute('y', box.y + 16);
    title.setAttribute('class', 'container-title');
    // The title names the container's kind in words as well as by its glyph and
    // its border, because a workspace declaring no grouping gets the same
    // fallback name at both levels and the kind is then the only difference.
    title.textContent = box.node._label;
    viewport.appendChild(title);
  }

  function drawNode(box, m) {
    const node = box.node;
    const g = document.createElementNS(SVGNS, 'g');

    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', box.x);
    rect.setAttribute('y', box.y);
    rect.setAttribute('width', box.width);
    rect.setAttribute('height', box.height);
    rect.setAttribute('class', 'node-rect');
    g.appendChild(rect);

    // Type accent bar down the leading edge, colour-blind-safe palette.
    const accent = m && m.accent;
    if (accent) {
      const bar = document.createElementNS(SVGNS, 'rect');
      bar.setAttribute('x', box.x);
      bar.setAttribute('y', box.y);
      bar.setAttribute('width', 5);
      bar.setAttribute('height', box.height);
      bar.setAttribute('class', 'node-accent');
      bar.style.fill = accent;
      g.appendChild(bar);
    }

    const cx = box.x + box.width / 2;
    const label = document.createElementNS(SVGNS, 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', box.y + box.height / 2 - 4);
    label.setAttribute('class', 'node-label');
    label.textContent = node.id;
    g.appendChild(label);

    // The second line, and which string it is, is the layout model's own
    // decision — the same one the box was sized against, so what is drawn here
    // and what the box was measured for cannot part company.
    if (m && m.subLabel) {
      const sub = document.createElementNS(SVGNS, 'text');
      sub.setAttribute('x', cx);
      sub.setAttribute('y', box.y + box.height / 2 + 11);
      sub.setAttribute('class', 'node-sub');
      sub.textContent = m.subLabel;
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

  function drawEdges(edges, origins) {
    for (const e of edges) {
      // An edge's geometry is stated against the container the layout engine
      // assigned it to rather than against the graph as a whole, so it is
      // resolved into the one absolute space the boxes were drawn in.
      for (const path of model.edgePaths(e, origins)) {
        const pts = path.map((p) => `${p.x},${p.y}`).join(' ');
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

  // --- the legend -----------------------------------------------------------

  // drawLegend fills the legend from the rows the layout model declares, and
  // reveals it once there is a graph for it to explain.
  //
  // It sits outside the pan/zoom group, so it stays put and stays readable
  // whatever the reader does to the canvas. What it names is the part of the
  // drawing a reader cannot work out by looking: which box is which kind, and
  // that a node's accent colour is local to the graph in front of them.
  function drawLegend() {
    clear(legendEl);
    legendEl.appendChild(el('div', 'legend-title', model.LEGEND_TITLE));
    for (const row of model.LEGEND_ROWS) {
      const line = el('div', 'legend-row');
      line.appendChild(el('span', `legend-swatch legend-swatch-${row.swatch}`));
      line.appendChild(el('span', 'legend-text', row.text));
      legendEl.appendChild(line);
    }
    legendEl.appendChild(el('p', 'legend-note', model.LEGEND_NOTE));
    legendEl.classList.remove('hidden');
  }

  // --- selection and the attachments panel --------------------------------

  function clearSelection() {
    selectedId = null;
    nodeGroups.forEach((g) => { g.classList.remove('node-selected'); });
    panelEl.classList.add('hidden');
    panelTitleEl.textContent = '';
    clear(panelBodyEl);
    // The palette body belongs to the panel that was showing. Dropping the
    // reference with the panel is what makes a late answer harmless: there is
    // nothing left for it to fill.
    candidatesBodyEl = null;
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

  // nodeLabels keeps each node's label set from the layout model's own reading
  // of the graph, so the labels a question is asked about and the labels the
  // hover text shows are one reading rather than two.
  function nodeLabels(meta) {
    const kept = new Map();
    meta.forEach((m, id) => { kept.set(id, (m && m.labels) || {}); });
    return kept;
  }

  function selectNode(nodeId) {
    selectedId = nodeId;
    nodeGroups.forEach((g, id) => { g.classList.toggle('node-selected', id === nodeId); });
    drawPanel(shownAttachments.get(nodeId) || { nodeId: nodeId, attachments: [] });
    panelEl.classList.remove('hidden');
    askWhatMayAttach(nodeId);
  }

  // drawPanel writes the projection into the panel. It is handed the projected
  // rows and never the IR, so a value the projection withheld is not something
  // this code could draw even by mistake.
  //
  // The palette below the attachments is appended in both cases, because "what
  // may attach" is a question worth an answer precisely when nothing is
  // attached yet.
  function drawPanel(projected) {
    panelTitleEl.textContent = projected.nodeId;
    clear(panelBodyEl);

    if (projected.attachments.length === 0) {
      panelBodyEl.appendChild(el('p', 'panel-empty', 'Nothing is attached to this node.'));
    } else {
      for (const a of projected.attachments) {
        panelBodyEl.appendChild(drawAttachment(a));
      }
    }
    panelBodyEl.appendChild(drawCandidatesSection());
  }

  // --- what may attach ------------------------------------------------------

  // drawCandidatesSection builds the palette in its waiting state and hands
  // back the section. Its body is kept so the answer fills it in place.
  function drawCandidatesSection() {
    const box = el('section', 'candidates');
    box.appendChild(el('div', 'candidates-title', candidates.CANDIDATES_TITLE));
    box.appendChild(el('p', 'candidates-caption', candidates.CANDIDATES_CAPTION));
    const body = el('div', 'candidates-body');
    body.appendChild(el('p', 'panel-empty', candidates.PENDING_NOTE));
    box.appendChild(body);
    candidatesBodyEl = body;
    return box;
  }

  // askWhatMayAttach asks the host about the node the reader just selected,
  // passing the labels the drawn graph carries for it.
  //
  // A node the render kept no labels for is not asked about: there is no
  // subject to ask with, and sending an empty set in its place would ask a
  // question about a node carrying no labels — a different question with a
  // plausible-looking answer. The report says what this view observed rather
  // than what the node declares, which is the part it cannot know.
  function askWhatMayAttach(nodeId) {
    candidatesRequestId += 1;
    const asked = candidatesRequestId;
    const labels = shownLabels.get(nodeId);
    if (!labels) {
      showCandidatesFailure(asked, 'the rendered graph carries no labels for this node.');
      return;
    }
    vscode.postMessage({
      type: 'attachCandidates',
      nodeId: nodeId,
      labels: labels,
      requestId: asked,
    });
  }

  // showCandidates draws the answer, or the sentence that stands in for an
  // answer naming nothing.
  //
  // An answer to a question the panel has stopped waiting on is dropped —
  // a different node was selected, the panel was closed, or the graph
  // re-rendered and the same node was asked about again.
  function showCandidates(requestId, projected) {
    if (!answering(requestId)) { return; }
    const body = candidatesBodyEl;
    clear(body);

    if (projected.rows.length === 0) {
      body.appendChild(el('p', 'panel-empty', projected.emptyNote));
      return;
    }
    for (const row of projected.rows) {
      body.appendChild(drawCandidate(row));
    }
  }

  // showCandidatesFailure says the list could not be produced, in place of the
  // list. A reader who is told nothing would read the waiting state as an empty
  // answer, which is the one reading that is certainly wrong.
  function showCandidatesFailure(requestId, message) {
    if (!answering(requestId)) { return; }
    clear(candidatesBodyEl);
    candidatesBodyEl.appendChild(
      el('p', 'candidates-failed', candidates.failureNote(message)),
    );
  }

  // answering reports whether this is the answer the panel is still waiting
  // for, and has somewhere to draw it.
  function answering(requestId) {
    return requestId === candidatesRequestId && candidatesBodyEl !== null;
  }

  function drawCandidate(row) {
    const box = el('section', 'candidate');
    box.appendChild(el('div', 'candidate-name', row.name));
    if (row.facts.length > 0) {
      const facts = el('dl', 'facts');
      for (const f of row.facts) { addFact(facts, f.key, f.value); }
      box.appendChild(facts);
    }
    return box;
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
