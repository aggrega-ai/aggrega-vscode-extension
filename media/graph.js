// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// Webview renderer for the Aggrega IR topology graph. Receives the serialized
// IRGraph from the extension, lays it out with elkjs (each node inside its
// boundary and its subsystem, and each boundary or subsystem inside the one it
// is declared in, since the IR ships no coordinates), draws it as
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

  // Whether the editor is showing this panel.
  //
  // It is told rather than worked out, because the panel cannot work it out: a
  // panel the editor is not showing is free to report whatever size it likes
  // for itself, and a plausible small one is indistinguishable by measurement
  // from a genuinely narrow panel the reader is looking at. A panel starts on
  // screen — it is opened by a reader who is then looking at it — and hears
  // about every change from there.
  let panelOnScreen = true;

  // THE FRAME IS THE READER'S ONCE THEY HAVE ONE. A drawing nobody has seen is
  // framed to fit, because there is no view to keep and a graph that runs off
  // the panel teaches nothing. After that the frame is what the reader panned
  // and zoomed to, and a redraw they did not ask for keeps it, whatever its new
  // layout moves inside it.
  let framed = false;
  // The layout a still-owed framing will be computed against. It is held
  // because the moment a drawing arrives and the moment a frame can be computed
  // for it are not always the same moment.
  let unframedLayout = null;

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
  // The drawn node groups, so selecting one can mark it and unmark the rest,
  // and so what the drawing on screen carries is read off the drawing itself.
  const nodeGroups = new Map();
  // The body of the palette section for the node the panel is showing, so an
  // answer that arrives later fills it without the whole panel being redrawn
  // underneath the reader.
  let candidatesBodyEl = null;
  // Where the result of committing a candidate is written. It is a line of its
  // own rather than a replacement for the palette, because the reader is likely
  // to attach a second Feature and a surface that replaced the list with a
  // confirmation would take it away at the moment it is next wanted.
  let attachOutcomeEl = null;
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
      reportFailure(msg.release, msg.message, msg.line);
    } else if (msg.type === 'render') {
      // Whether the setting that shows sensitive values was on for this graph is
      // handed to the projection as it arrived: the projection is where it is
      // read, and where anything but the boolean true reads as off.
      renderGraph(msg.graph, !!msg.asked, msg.showsSensitiveValues)
        .catch((err) => reportFailure(msg.release, String(err)));
    } else if (msg.type === 'attachCandidates') {
      showCandidates(msg.requestId, candidates.projectCandidates(msg.result));
    } else if (msg.type === 'attachCandidatesError') {
      showCandidatesFailure(msg.requestId, msg.message);
    } else if (msg.type === 'attachOutcome') {
      showAttachOutcome(msg.nodeId, msg.message, msg.attached);
    } else if (msg.type === 'visibility') {
      panelOnScreen = !!msg.visible;
      // Coming back on screen is when a framing that was refused can be
      // computed. Going off screen owes nothing: what is already framed stays
      // as the reader left it.
      if (panelOnScreen) { frameOrRestore(); }
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

  // hasDrawing reports whether there is a graph on the canvas for a failure to
  // be about.
  //
  // It reads the canvas rather than a flag kept beside it. A flag describing
  // something it sits next to is free to disagree with it, and what a failure
  // has to say depends on the picture that is actually in front of the reader
  // rather than on the one the bookkeeping believes is.
  function hasDrawing() {
    return canvas.firstChild !== null;
  }

  // reportFailure says that a topology could not be drawn.
  //
  // 🔴 A DRAWING THAT SURVIVES A FAILURE STOPS BEING PRESENTED AS CURRENT. A
  // graph is built from the authored documents as they stand on disk, so a
  // rebuild that fails leaves the canvas showing a topology that is no longer
  // true of any of them — and the reader has no way to know that from a picture
  // alone. What is withdrawn is the claim that the drawing is current, not the
  // drawing: the topology it shows is still worth reading, and it is still
  // where the reader was working.
  //
  // It is said twice because the notice is a line in a corner that a reader may
  // not read: in words, and by dimming the drawing so a reader who reads
  // nothing still sees that it is not the current one.
  //
  // 🔴 EVERY ROUTE TO A FAILURE COMES THROUGH HERE — the refresh that follows a
  // document reaching disk, the reader pressing the command, and a drawing that
  // cannot be laid out — so no one of them can come to present the same failure
  // differently from the others.
  //
  // A panel that has drawn nothing yet has no such claim to withdraw, and is
  // told only what went wrong: the line the extension composed for the failure,
  // the same line its output channel carries — that the topology of the Release
  // could not be drawn, then the compiler's own words. It arrives composed rather
  // than being worded again here, so the panel and the channel cannot come to
  // say two things about one failure. A drawing that fails in this panel's own
  // layout arrives with no such line, and is named after its Release with the
  // layout's own words.
  function reportFailure(release, message, line) {
    const subject = release ? `${release}: ` : '';
    const stale = hasDrawing();
    setStatus(stale
      ? `${subject}the topology could not be rebuilt, so the graph on screen is out of date. `
        + `${message}`
      : (line || `${subject}${message}`), true);
    canvas.classList.toggle('out-of-date', stale);
  }

  // --- render -------------------------------------------------------------

  async function renderGraph(graph, asked, showsSensitiveValues) {
    const { root, meta } = model.toElkGraph(graph, measureText);
    // A first layout says which groupings came out tall; where two or more
    // siblings did, the graph is laid out again with those siblings side by
    // side, so a large topology fills the panel's width rather than a narrow
    // column of it. The second layout is handed a graph built afresh rather
    // than the first one changed in place.
    let laid = await elk.layout(root);
    const spread = model.groupingsToSpread(laid);
    if (spread.length > 0) {
      laid = await elk.layout(model.toElkGraph(graph, measureText, spread).root);
    }
    hideStatus();

    // The selection survives a re-render when the new graph still holds the
    // node. A recompile re-renders underneath the reader, and dropping the
    // selection every time would close the panel while they are reading it.
    const wasSelected = selectedId;
    shownAttachments = projectAttachments(graph, showsSensitiveValues);
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
    drawLegend(model.legendRows(root, meta));

    if (wasSelected !== null && nodeGroups.has(wasSelected)) {
      selectNode(wasSelected);
    }

    // A drawing the reader asked for is framed afresh, and that is the way back
    // to the whole topology for a reader who has zoomed into a corner of a
    // large one: pressing for the graph shows it to them again. A drawing they
    // did not ask for asks nothing of their view — it is put back on the group
    // this render just built, which a new group does not carry on its own.
    if (asked) { framed = false; }
    if (!framed) { unframedLayout = laid; }
    frameOrRestore();
    installInteraction();
    // The drawing on the canvas is now the one the compiler just built, so
    // whatever an earlier failure said about the last one no longer applies.
    canvas.classList.remove('out-of-date');
  }

  function drawContainer(box) {
    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', box.x);
    rect.setAttribute('y', box.y);
    rect.setAttribute('width', box.width);
    rect.setAttribute('height', box.height);
    rect.setAttribute('rx', '6');
    // A box holding the nodes in no declared grouping keeps its kind's class,
    // which says which axis it stands on, and takes one more that draws it apart
    // from a grouping a document declares. The legend's row for it shows that
    // drawing beside the words saying what the box holds.
    const kindClass = box.kind === 'boundary' ? 'container-boundary' : 'container-subsystem';
    rect.setAttribute('class', box.node._declared === false ? `${kindClass} container-undeclared` : kindClass);
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

  // drawEdges draws each edge's line and, at the end it points to, the mark
  // saying which way it runs.
  //
  // The line alone says two components are joined and not which of them uses
  // the other, so the end on the target carries an arrowhead (the legend says
  // so). The arrowhead is written straight after the line it ends and carries
  // the line's own classes, so it is stroked by the same declarations — the
  // same colour, and the same dash where the edge's origin draws one — and an
  // arrowhead cannot read as belonging to a different edge than its line. It is
  // drawn on the last section of the edge, the one arriving at the target.
  function drawEdges(edges, origins) {
    for (const e of edges) {
      // An edge's geometry is stated against the container the layout engine
      // assigned it to rather than against the graph as a whole, so it is
      // resolved into the one absolute space the boxes were drawn in.
      const paths = model.edgePaths(e, origins);
      let cls = 'edge';
      if (e._origin === 'release') { cls += ' edge-release'; }
      else if (e._origin === 'feature') { cls += ' edge-feature'; }
      const hover = model.edgeTooltip(e);
      paths.forEach((path, at) => {
        const pts = path.map((p) => `${p.x},${p.y}`).join(' ');
        const poly = document.createElementNS(SVGNS, 'polyline');
        poly.setAttribute('points', pts);
        poly.setAttribute('class', cls);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = hover;
        poly.appendChild(tip);
        viewport.appendChild(poly);
        if (at === paths.length - 1) { drawDirectionMark(path, cls, hover); }
      });
    }
  }

  // drawDirectionMark draws the arrowhead at a line's last point, with the
  // line's classes and its hover, so pointing at the arrowhead names the same
  // edge pointing at the line does.
  function drawDirectionMark(path, cls, hover) {
    const points = model.directionMark(path);
    if (points.length === 0) { return; }
    const mark = document.createElementNS(SVGNS, 'polygon');
    mark.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    mark.setAttribute('class', `${cls} edge-mark`);
    const tip = document.createElementNS(SVGNS, 'title');
    tip.textContent = hover;
    mark.appendChild(tip);
    viewport.appendChild(mark);
  }

  // --- the legend -----------------------------------------------------------

  // drawLegend fills the legend with the rows the layout model composed for the
  // drawing on the canvas, and reveals it once there is a graph for it to
  // explain.
  //
  // It sits outside the pan/zoom group, so it stays put and stays readable
  // whatever the reader does to the canvas. What it names is the part of the
  // drawing a reader cannot work out by looking: which document declares each
  // grouping and what the box holding the nodes in none holds, which end of an
  // edge is its target, which type each node colour stands for, and that those
  // colours are local to the graph in front of them.
  //
  // Each swatch is drawn from the same declarations as the thing it stands for:
  // a box's from its box's class, an edge's as a short line with its arrowhead
  // carrying the edge's own classes, a type's in the colour that type's bar is
  // drawn in.
  function drawLegend(rows) {
    clear(legendEl);
    legendEl.appendChild(el('div', 'legend-title', model.LEGEND_TITLE));
    for (const row of rows) {
      const line = el('div', 'legend-row');
      const swatch = el('span', `legend-swatch legend-swatch-${row.swatch}`);
      if (row.swatch === 'edge') { swatch.appendChild(edgeSwatch()); }
      if (row.colour) { swatch.style.borderLeftColor = row.colour; }
      line.appendChild(swatch);
      line.appendChild(el('span', 'legend-text', row.text));
      legendEl.appendChild(line);
    }
    legendEl.appendChild(el('p', 'legend-note', model.LEGEND_NOTE));
    legendEl.classList.remove('hidden');
  }

  // edgeSwatch is an edge drawn the length of a swatch: a line and the
  // arrowhead at its end, from the layout model's own mark.
  function edgeSwatch() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 12');
    const path = [{ x: 1, y: 6 }, { x: 23, y: 6 }];
    const line = document.createElementNS(SVGNS, 'polyline');
    line.setAttribute('points', path.map((p) => `${p.x},${p.y}`).join(' '));
    line.setAttribute('class', 'edge');
    svg.appendChild(line);
    const mark = document.createElementNS(SVGNS, 'polygon');
    mark.setAttribute('points', model.directionMark(path).map((p) => `${p.x},${p.y}`).join(' '));
    mark.setAttribute('class', 'edge edge-mark');
    svg.appendChild(mark);
    return svg;
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
    attachOutcomeEl = null;
  }

  // projectAttachments projects every node's attachments up front, so the IR
  // payload is read here and nowhere else and need not outlive the render. The
  // projection is made against the setting the graph was posted with, so a panel
  // left open shows what that graph was built to show until the next one arrives.
  function projectAttachments(graph, showsSensitiveValues) {
    const nodes = ((graph && graph.spec) || {}).nodes || {};
    const projected = new Map();
    for (const id of Object.keys(nodes)) {
      projected.set(id, attachments.attachmentsFor(graph, id, showsSensitiveValues));
    }
    return projected;
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
    box.appendChild(el('p', 'candidates-caption', candidates.ATTACH_ACTION_CAPTION));
    const body = el('div', 'candidates-body');
    body.appendChild(el('p', 'panel-empty', candidates.PENDING_NOTE));
    box.appendChild(body);
    candidatesBodyEl = body;
    // The outcome line sits below the palette and outside its body, so filling
    // the body with a fresh answer does not erase what the last edit reported.
    const outcome = el('p', 'attach-outcome hidden');
    box.appendChild(outcome);
    attachOutcomeEl = outcome;
    return box;
  }

  // askWhatMayAttach asks the host about the node the reader just selected,
  // naming it by the id this drawing keys it under.
  //
  // Nothing this view read off the drawing is sent beside the id. The host adds
  // the Release the graph was drawn from, and the compiler matches the labels
  // that Release's graph carries for the node against the Features it can see
  // for that Release — so what this view holds is the question's address and
  // not its content.
  function askWhatMayAttach(nodeId) {
    candidatesRequestId += 1;
    vscode.postMessage({
      type: 'attachCandidates',
      nodeId: nodeId,
      requestId: candidatesRequestId,
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

  // drawCandidate draws one row of the palette together with the control that
  // commits it.
  //
  // The control is a button rather than the row itself, so the row stays
  // readable without being an affordance: a reader scanning what may attach is
  // not one press away from editing their file every time they click a name.
  //
  // The button carries the entity's name and nothing else. Where the edit lands
  // is resolved on the other side of this boundary, from the graph the compiler
  // sent — so this posts what the reader chose and never where it goes.
  function drawCandidate(row) {
    const box = el('section', 'candidate');
    const head = el('div', 'candidate-head');
    head.appendChild(el('span', 'candidate-name', row.name));
    const attach = el('button', 'candidate-attach', candidates.ATTACH_ACTION);
    attach.addEventListener('click', () => {
      vscode.postMessage({
        type: 'attachFeature',
        nodeId: selectedId,
        featureName: row.name,
      });
    });
    head.appendChild(attach);
    box.appendChild(head);
    if (row.facts.length > 0) {
      const facts = el('dl', 'facts');
      for (const f of row.facts) { addFact(facts, f.key, f.value); }
      box.appendChild(facts);
    }
    return box;
  }

  // showAttachOutcome reports what became of a commit, under the list the panel
  // is showing, in the words it arrived in.
  //
  // It draws an outcome about the node the panel is showing, and a refusal
  // naming a node the drawing on screen does not carry. The first answers the
  // reader's press. The second is about a node this drawing never offered for
  // selection, so no selection in it can have moved on from that node, and
  // dropping it would leave the request with no answer at all.
  //
  // An outcome about another node the drawing does carry is dropped. The reader
  // has selected something else, and a line about the previous node under the
  // current node's palette reads as being about the current one.
  //
  // What the drawing carries is read off the node groups it was drawn with.
  // They are replaced only once a new layout has been drawn, so an outcome
  // arriving while one is still being computed is judged against the drawing
  // still on screen, which is the one whose list the line would be written
  // under.
  function showAttachOutcome(nodeId, message, attached) {
    if (attachOutcomeEl === null) { return; }
    if (nodeId !== selectedId && (attached || nodeGroups.has(nodeId))) { return; }
    attachOutcomeEl.textContent = message;
    attachOutcomeEl.classList.remove('hidden');
    attachOutcomeEl.classList.toggle('attach-failed', !attached);
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

  // readableBox reports the panel's drawing area, or nothing when there is no
  // area worth framing a drawing against.
  //
  // 🔴 THE REFUSAL IS THE POINT, AND NO MADE-UP SIZE STANDS IN FOR IT. Supplying
  // one where a measurement is missing does not produce a worse frame — it
  // produces a frame for a viewport that does not exist, and it does so
  // silently, because a drawing scaled and centred for an imaginary box looks
  // exactly like one framed properly until the reader sees it. A larger made-up
  // size only changes which imaginary box it is.
  //
  // Both conditions are read and neither covers the other. The editor is asked
  // whether the panel is on screen, because a panel that is not can report a
  // small box as readily as an empty one and no measurement separates that from
  // a narrow panel in use. The box is then required to be positive, because a
  // panel that IS on screen but whose document has not been laid out yet
  // reports nothing to divide by.
  function readableBox() {
    if (!panelOnScreen) { return null; }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!(width > 0) || !(height > 0)) { return null; }
    return { width: width, height: height };
  }

  // frameOrRestore frames a drawing that has never been framed, and otherwise
  // puts the reader's own frame back.
  //
  // Putting it back is not optional. Every render builds a new pan/zoom group,
  // and a new group carries no transform at all — so a render that merely
  // declined to re-fit would drop the reader at the origin at natural size,
  // which loses their view by a second route.
  //
  // It is the one place a frame is computed, so the three moments that can
  // discharge an owed framing — the drawing arriving, the panel coming back on
  // screen, and the drawing area gaining a size — cannot come to disagree about
  // what framing means.
  function frameOrRestore() {
    if (viewport === null) { return; }
    if (!framed && unframedLayout !== null) {
      const box = readableBox();
      if (box !== null) {
        frameToFit(unframedLayout, box);
        unframedLayout = null;
        framed = true;
      }
    }
    applyView();
  }

  // frameToFit scales and centres one laid-out graph inside one drawing area.
  // It is only ever handed an area that exists.
  function frameToFit(laid, box) {
    const w = laid.width || 1;
    const h = laid.height || 1;
    const scale = Math.min(box.width / (w + 40), box.height / (h + 40), 1.5);
    view.scale = scale > 0 ? scale : 1;
    view.x = (box.width - w * view.scale) / 2;
    view.y = (box.height - h * view.scale) / 2;
  }

  // WHEN A DRAWING AREA THAT COULD NOT BE FRAMED AGAINST BECOMES ONE THAT CAN.
  // The panel returning to the screen is the usual moment and the editor
  // announces it, but it is not the only one: a panel that is on screen before
  // its own document has been laid out reports nothing to frame against either,
  // and no message marks that passing. Watching the drawing area covers both.
  //
  // It covers nothing else: a frame that has already been computed belongs to
  // the reader, so resizing the panel moves what they are looking at no more
  // than a redraw does.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { frameOrRestore(); }).observe(canvas);
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

  // 🔴 THE EXTENSION IS TOLD THIS PANEL LISTENS ONLY ONCE IT DOES, AND IT SENDS
  // NOTHING BEFORE THAT. The editor hands a message to this document whether or
  // not this script has run yet, and a message arriving before the listener above
  // is lost with nothing to say so. This script runs only after the layout library
  // has loaded, which on a busy machine is after the drawing the reader asked for
  // has already been sent — and the panel would then go on showing the sentence it
  // opens with. So the extension holds what it has for this panel until this
  // line, and this line is the last thing the script does: everything a message
  // reaches is in place by then.
  vscode.postMessage({ type: 'listening' });
})();
