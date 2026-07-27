// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// Webview renderer for the Aggrega IR topology graph. Receives the serialized
// IRGraph from the extension, lays it out with elkjs (nested boundary →
// subsystem → node containers, since the IR ships no coordinates), draws it as
// SVG, and posts a source-open request back when a node is clicked. Depends
// only on the global `ELK` exposed by elk.bundled.js — no network access.

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const elk = new ELK();

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

  // --- transform: IRGraph -> elk graph ------------------------------------

  const NODE_H = 46;
  const CHAR_W = 7.5;
  const MIN_NODE_W = 90;
  const CONTAINER_PAD_TOP = 26;

  function nodeWidth(label) {
    return Math.max(MIN_NODE_W, Math.round(label.length * CHAR_W) + 24);
  }

  // toElk builds the nested elk graph and a side table of node metadata the
  // renderer reads back after layout (source file, tooltip, color key).
  function toElk(graph) {
    const spec = (graph && graph.spec) || {};
    const nodes = spec.nodes || {};
    const edges = spec.edges || [];

    // Group node ids by boundary, then subsystem, preserving encounter order
    // (the IR nodes object is already author-ordered).
    const boundaries = new Map(); // boundaryKey -> Map(subsystemKey -> [nodeId])
    const meta = new Map(); // nodeId -> { component, version, labels, sourceFile }

    for (const id of Object.keys(nodes)) {
      const n = nodes[id] || {};
      const bKey = n.boundary_path || '(default)';
      const sKey = n.subsystem_path || '(default)';
      if (!boundaries.has(bKey)) { boundaries.set(bKey, new Map()); }
      const subs = boundaries.get(bKey);
      if (!subs.has(sKey)) { subs.set(sKey, []); }
      subs.get(sKey).push(id);
      meta.set(id, {
        component: n.component || id,
        version: n.resolved_version || '',
        labels: n.labels || {},
        sourceFile: n.source_file || '',
      });
    }

    const children = [];
    for (const [bKey, subs] of boundaries) {
      const bChildren = [];
      for (const [sKey, ids] of subs) {
        const sChildren = ids.map((id) => {
          const label = id;
          return {
            id,
            width: nodeWidth(label),
            height: NODE_H,
          };
        });
        bChildren.push({
          id: `s::${bKey}::${sKey}`,
          _title: sKey,
          _kind: 'subsystem',
          layoutOptions: containerOpts(),
          children: sChildren,
        });
      }
      children.push({
        id: `b::${bKey}`,
        _title: bKey,
        _kind: 'boundary',
        layoutOptions: containerOpts(),
        children: bChildren,
      });
    }

    const elkEdges = edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.source],
      targets: [e.target],
      _origin: e.origin_release ? 'release' : (e.origin_feature ? 'feature' : 'aggregate'),
      _socket: e.socket || '',
      _alias: e.alias || '',
    }));

    const root = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.spacing.nodeNode': '28',
        'elk.padding': '[top=20,left=20,bottom=20,right=20]',
      },
      children,
      edges: elkEdges,
    };

    return { root, meta };
  }

  function containerOpts() {
    return {
      'elk.padding': `[top=${CONTAINER_PAD_TOP},left=14,bottom=14,right=14]`,
      'elk.spacing.nodeNode': '22',
    };
  }

  // --- render -------------------------------------------------------------

  async function renderGraph(graph) {
    accentAssignments.clear();
    const { root, meta } = toElk(graph);
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
    const accent = accentColor(m);
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
    tip.textContent = tooltip(node.id, m);
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
        tip.textContent = edgeTooltip(e);
        poly.appendChild(tip);
        viewport.appendChild(poly);
      }
    }
  }

  function tooltip(id, m) {
    if (!m) { return id; }
    const lines = [id];
    if (m.component) { lines.push(`component: ${m.component}`); }
    if (m.version) { lines.push(`version: ${m.version}`); }
    const labelKeys = Object.keys(m.labels || {});
    for (const k of labelKeys) { lines.push(`${k}: ${m.labels[k]}`); }
    if (m.sourceFile) { lines.push(`↪ ${m.sourceFile}`); }
    return lines.join('\n');
  }

  function edgeTooltip(e) {
    const parts = [`${e.sources[0]} → ${e.targets[0]}`, `origin: ${e._origin}`];
    if (e._socket) { parts.push(`socket: ${e._socket}`); }
    if (e._alias) { parts.push(`alias: ${e._alias}`); }
    return parts.join('\n');
  }

  // ACCENT_PALETTE is the colour-blind-safe categorical palette (Okabe-Ito,
  // minus black and minus the two hues reserved for edge provenance) used for
  // node-type accents. Colours are assigned to distinct type values in
  // first-encounter order and cycle if the palette is exhausted, so the same
  // type always draws the same accent within a render.
  const ACCENT_PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2'];
  const accentAssignments = new Map();

  // accentColor returns a stable accent colour for a node's type label, or null
  // when the node carries no type label (the neutral node body stands alone).
  function accentColor(m) {
    if (!m || !m.labels) { return null; }
    const key = m.labels['component.aggrega.ai/type'];
    if (!key) { return null; }
    if (!accentAssignments.has(key)) {
      accentAssignments.set(key, ACCENT_PALETTE[accentAssignments.size % ACCENT_PALETTE.length]);
    }
    return accentAssignments.get(key);
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
