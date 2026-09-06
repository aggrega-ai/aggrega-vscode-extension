// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the topology renderer: the transform from the
// compiler's IR graph into an elk layout graph, the resolution of the laid-out
// graph's nested coordinates into one absolute space, and the hover text for a
// node and an edge. It reads no document, calls no layout engine and holds no
// state between transforms, so the ordering, the geometry and the hover
// contents can be exercised on their own. media/graph.js draws whatever this
// produces.
//
// Text is MEASURED rather than estimated, and the measurement is supplied by
// the caller: a per-character estimate cannot be right for a font it has never
// seen, and only the drawing side has a document to measure in. So every
// transform here takes a measuring function and asks it for the advance of each
// string that will actually be drawn. What stays here is the rule — which
// strings are drawn and how a box is sized around them — which is what the
// tests exercise, with a measurement of their own.
//
// Everything here renders values the compiler put in the IR. Nothing is
// inferred from a name, and a field the compiler did not send is left out
// rather than defaulted.

(function (root) {
  'use strict';

  const NODE_H = 46;
  const MIN_NODE_W = 90;
  const CONTAINER_PAD_TOP = 26;

  // The horizontal room a node's box keeps around its widest drawn line, and
  // the room a container's box keeps around its title. The container's title is
  // drawn 10 in from its left edge, so half of its padding is that inset and
  // half is the margin left after the text.
  const NODE_PAD_X = 24;
  const CONTAINER_TITLE_PAD = 20;

  // The three text roles a measuring function is asked about. They name what is
  // being measured rather than how it is styled: the styling is the drawing
  // side's, and this file is the side that knows which strings get drawn.
  const ROLE_NODE_ID = 'node-id';
  const ROLE_NODE_COMPONENT = 'node-component';
  const ROLE_CONTAINER_TITLE = 'container-title';

  // The container fallback title for a node whose boundary or subsystem path is
  // empty. The compiler sends no path for a node outside any named grouping,
  // and one container per graph collects those.
  //
  // It says none was declared rather than naming a default, because there is no
  // grouping called this: the box exists to hold the nodes that are in none.
  const UNGROUPED = '(none declared)';

  // How each container kind names itself. The kind is spelled out in words and
  // not left to the glyph, because the two kinds nest one inside the other and
  // the fallback above titles BOTH levels identically — so in a workspace that
  // declares no grouping at all, the word is the only thing telling the outer
  // box from the inner one.
  const CONTAINER_KINDS = {
    boundary: { glyph: '▣', word: 'boundary' },
    subsystem: { glyph: '▢', word: 'subsystem' },
  };

  // ACCENT_PALETTE is the colour-blind-safe categorical palette (Okabe-Ito,
  // minus black and minus the two hues reserved for edge provenance) used for
  // node-type accents. Colours are assigned to distinct type values in
  // first-encounter order and cycle if the palette is exhausted, so the same
  // type always draws the same accent within a render.
  const ACCENT_PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2'];

  const TYPE_LABEL = 'component.aggrega.ai/type';

  // What the legend names, and in each case the one thing about it a reader
  // cannot work out by looking. A grouping's shape and its position are both on
  // the canvas already; which document declares it is not, so each grouping row
  // names that document — which is what lets a reader go from a box to the file
  // they would edit to change it. The accent bar is a colour whose meaning is
  // local to the drawing it appears in, and a reader told nothing will read a
  // colour as fixed and compare two graphs by it.
  const LEGEND_TITLE = 'Legend';

  const LEGEND_ROWS = [
    { swatch: 'boundary', text: 'Boundary — a grouping the Release declares.' },
    { swatch: 'subsystem', text: 'Subsystem — a grouping the Aggregate declares.' },
    { swatch: 'accent', text: 'Node type — the bar down a node\'s leading edge.' },
  ];

  const LEGEND_NOTE =
    'Type colours are assigned as this graph is drawn, in the order the types are '
    + 'met. They group nodes within this graph only: the same colour in another '
    + 'graph is not the same type.';

  // containerLabel is what a container's title reads: the kind, then whatever
  // the compiler named the grouping.
  function containerLabel(kind, title) {
    const k = CONTAINER_KINDS[kind];
    return k ? `${k.glyph} ${k.word} · ${title}` : title;
  }

  // subLabelFor is the second line a node's box draws, or the empty string when
  // it draws only one.
  //
  // The component name is drawn only where it differs from the node id, since
  // repeating the id under itself says nothing — and that is exactly the case
  // in which it can be longer than the id, which is why the box is sized
  // against it below rather than against the id alone.
  function subLabelFor(id, component) {
    return component && component !== id ? component : '';
  }

  // nodeBoxWidth sizes a node's box around EVERY line it will draw, not one of
  // them. Sizing against the id alone leaves the component name underneath it
  // free to run past the border, and no fixed per-character allowance fixes
  // that: it moves the width at which the text starts spilling without putting
  // a bound on the text.
  function nodeBoxWidth(id, subLabel, measure) {
    const idWidth = measure(id, ROLE_NODE_ID);
    const subWidth = subLabel ? measure(subLabel, ROLE_NODE_COMPONENT) : 0;
    return Math.max(MIN_NODE_W, Math.ceil(Math.max(idWidth, subWidth)) + NODE_PAD_X);
  }

  // nodeWave reads a node's deployment wave. The wave is optional and defaults
  // to 0, so a node the compiler sent no wave for sits in the same wave as one
  // that carries an explicit 0 — on the wire the two are the same node.
  function nodeWave(n) {
    const w = n && n.sync_wave;
    return typeof w === 'number' && Number.isFinite(w) ? Math.trunc(w) : 0;
  }

  // waveRanks maps every distinct deployment wave in the graph to a contiguous
  // rank counting from zero, ascending by wave.
  //
  // The ranks exist because elk's layout partition is an index and the
  // compiler's waves are not: a wave may be negative (`-1` for something that
  // has to be in place before the rest), and waves need not be contiguous, so
  // the values cannot be handed to elk as they stand. Ranking preserves the
  // relative order the compiler declared and nothing else — the graph shows the
  // order of the waves, never arithmetic on their values.
  function waveRanks(waves) {
    const distinct = Array.from(new Set(waves)).sort((a, b) => a - b);
    const ranks = new Map();
    for (let i = 0; i < distinct.length; i++) {
      ranks.set(distinct[i], i);
    }
    return ranks;
  }

  // partitioned returns the layout options that place a node in a wave
  // partition. elk orders lower partitions ahead of higher ones along the
  // layout direction, and its own documentation notes the ordering is only
  // dependable when every node in the scope carries a partition — so every
  // node and every container gets one, including rank 0.
  function partitioned(rank, extra) {
    const opts = Object.assign({}, extra || {});
    opts['elk.partitioning.partition'] = String(rank);
    return opts;
  }

  // containerOpts lays out one container and keeps it wide enough for its own
  // title. A container's size is otherwise computed from what it holds, so a
  // box holding one narrow node would be narrower than the words naming it and
  // the title would run out past the border — the same spill the node boxes are
  // sized to avoid. The minimum is a floor: elk keeps the wider of it and what
  // the contents need.
  function containerOpts(rank, minWidth) {
    return partitioned(rank, {
      // A container's own children are partitioned too, so a boundary holding
      // two waves shows them ordered inside itself.
      'elk.partitioning.activate': 'true',
      'elk.padding': `[top=${CONTAINER_PAD_TOP},left=14,bottom=14,right=14]`,
      'elk.spacing.nodeNode': '22',
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${minWidth},0)`,
    });
  }

  // toElkGraph builds the nested elk graph and a side table of node metadata
  // the renderer reads back after layout (source file, hover text, accent
  // colour). Node ids are grouped by boundary, then subsystem, and ordered by
  // deployment wave within each grouping.
  //
  // measure(text, role) reports the drawn width of one string in one of the
  // three roles above. It is required rather than defaulted: a default would be
  // an estimate, and an estimate standing in silently for a measurement is the
  // fault this argument exists to remove.
  function toElkGraph(graph, measure) {
    const spec = (graph && graph.spec) || {};
    const nodes = spec.nodes || {};
    const edges = spec.edges || [];

    // Group node ids by boundary, then subsystem, preserving encounter order
    // (the IR nodes object is already author-ordered); the wave ordering below
    // is applied on top of that order, so nodes sharing a wave stay in the
    // order their author wrote them.
    const boundaries = new Map(); // boundaryKey -> Map(subsystemKey -> [nodeId])
    const meta = new Map(); // nodeId -> { component, subLabel, version, wave, labels, catalog, sourceFile, accent }
    const waves = [];
    const accents = new Map();

    for (const id of Object.keys(nodes)) {
      const n = nodes[id] || {};
      const bKey = n.boundary_path || UNGROUPED;
      const sKey = n.subsystem_path || UNGROUPED;
      if (!boundaries.has(bKey)) { boundaries.set(bKey, new Map()); }
      const subs = boundaries.get(bKey);
      if (!subs.has(sKey)) { subs.set(sKey, []); }
      subs.get(sKey).push(id);

      const wave = nodeWave(n);
      const component = n.component || id;
      waves.push(wave);
      meta.set(id, {
        component,
        // The second line the box draws, decided here so the width is computed
        // over the same set of lines the drawing puts on the box.
        subLabel: subLabelFor(id, component),
        version: n.resolved_version || '',
        wave,
        labels: n.labels || {},
        catalog: n.catalog_metadata || null,
        sourceFile: n.source_file || '',
        accent: accentColor(n.labels, accents),
      });
    }

    const ranks = waveRanks(waves);
    const rankOf = (id) => ranks.get(meta.get(id).wave) || 0;
    const titleFloor = (label) =>
      Math.ceil(measure(label, ROLE_CONTAINER_TITLE)) + CONTAINER_TITLE_PAD;

    const children = [];
    for (const [bKey, subs] of boundaries) {
      const bChildren = [];
      for (const [sKey, ids] of subs) {
        const ordered = byWave(ids, rankOf);
        const sChildren = ordered.map((id) => ({
          id,
          width: nodeBoxWidth(id, meta.get(id).subLabel, measure),
          height: NODE_H,
          layoutOptions: partitioned(rankOf(id)),
        }));
        bChildren.push({
          id: `s::${bKey}::${sKey}`,
          _title: sKey,
          _label: containerLabel('subsystem', sKey),
          _kind: 'subsystem',
          _rank: minRank(ordered, rankOf),
          children: sChildren,
        });
      }
      // A container is itself a node in its parent's ordering, so it takes the
      // earliest wave it holds: a grouping whose first work happens in an
      // earlier wave is laid out ahead of one whose does not.
      const orderedSubs = byRank(bChildren);
      children.push({
        id: `b::${bKey}`,
        _title: bKey,
        _label: containerLabel('boundary', bKey),
        _kind: 'boundary',
        _rank: orderedSubs.length > 0 ? orderedSubs[0]._rank : 0,
        children: orderedSubs,
      });
    }
    const orderedBoundaries = byRank(children);

    // The layout options are attached after ordering so a container's rank is
    // known before it is written out.
    for (const b of orderedBoundaries) {
      b.layoutOptions = containerOpts(b._rank, titleFloor(b._label));
      for (const s of b.children) {
        s.layoutOptions = containerOpts(s._rank, titleFloor(s._label));
      }
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
        // Wave order is what the compiler declared, so it drives the layout:
        // with a left-to-right direction, an earlier wave sits to the left of a
        // later one and the reading order of the graph is the order the waves
        // are applied in.
        'elk.partitioning.activate': 'true',
        'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.spacing.nodeNode': '28',
        'elk.padding': '[top=20,left=20,bottom=20,right=20]',
      },
      children: orderedBoundaries,
      edges: elkEdges,
    };

    return { root, meta };
  }

  // place resolves a laid-out graph's nested coordinates into one absolute
  // space, and is the only place that resolution happens.
  //
  // elk states every child's position relative to its parent, so a nested
  // layout carries no absolute coordinate anywhere. This walks it once and
  // returns the boxes in draw order — a container ahead of what it holds, so a
  // child draws over it — together with the origin each container's contents
  // are stated against, which is what an edge's geometry needs (see edgePaths).
  function place(laid) {
    const boxes = [];
    const origins = new Map();
    // The root graph's own origin is where the drawing starts. elk reports an
    // edge whose endpoints share no closer ancestor as belonging to it.
    origins.set((laid && laid.id) || 'root', { x: 0, y: 0 });

    const walk = (children, offX, offY) => {
      for (const child of children) {
        const x = offX + (child.x || 0);
        const y = offY + (child.y || 0);
        boxes.push({
          node: child,
          kind: child._kind || 'node',
          x,
          y,
          width: child.width || 0,
          height: child.height || 0,
        });
        origins.set(child.id, { x, y });
        if (child.children && child.children.length > 0) {
          walk(child.children, x, y);
        }
      }
    };
    walk((laid && laid.children) || [], 0, 0);

    return { boxes, origins };
  }

  // edgePaths returns one array of absolute points per section of an edge.
  //
  // 🔴 A SECTION'S COORDINATES ARE NOT ABSOLUTE, and reading them as absolute
  // is what draws an edge across a container it has no endpoint in. With
  // hierarchy handling on, elk assigns each edge to the lowest common ancestor
  // of its endpoints and states that edge's geometry relative to THAT
  // container; only an edge whose endpoints share no ancestor but the root is
  // stated against the root. So an edge contained in a boundary is reported in
  // the boundary's own space, and drawing it unoffset shifts it up and left by
  // that boundary's origin — out of the box it belongs to and across whatever
  // lies that way. Offsetting by the origin of the container elk named is what
  // puts every endpoint back on its own node's border.
  //
  // An edge naming no container is stated against the root, which is the
  // origin this falls back to.
  function edgePaths(edge, origins) {
    const o = (origins && origins.get(edge && edge.container)) || { x: 0, y: 0 };
    return ((edge && edge.sections) || []).map((sec) =>
      [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
        .filter(Boolean)
        .map((p) => ({ x: p.x + o.x, y: p.y + o.y })));
  }

  // byWave orders node ids by wave rank, keeping author order within a wave.
  // Handing elk the children already ordered means the wave sequence is visible
  // even where the layout falls back to input order.
  function byWave(ids, rankOf) {
    return ids
      .map((id, i) => ({ id, i, rank: rankOf(id) }))
      .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
      .map((entry) => entry.id);
  }

  function byRank(containers) {
    return containers
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (a.c._rank - b.c._rank) || (a.i - b.i))
      .map((entry) => entry.c);
  }

  function minRank(ids, rankOf) {
    let min = 0;
    for (let i = 0; i < ids.length; i++) {
      const r = rankOf(ids[i]);
      if (i === 0 || r < min) { min = r; }
    }
    return min;
  }

  // accentColor returns a stable accent colour for a node's type label, or null
  // when the node carries no type label (the neutral node body stands alone).
  function accentColor(labels, assignments) {
    if (!labels) { return null; }
    const key = labels[TYPE_LABEL];
    if (!key) { return null; }
    if (!assignments.has(key)) {
      assignments.set(key, ACCENT_PALETTE[assignments.size % ACCENT_PALETTE.length]);
    }
    return assignments.get(key);
  }

  // nodeTooltip is the hover text for one node: what the compiler resolved for
  // it, then the catalog entity's own metadata, then where it was authored.
  // Every line is a value the compiler sent; an absent field contributes no
  // line rather than a placeholder.
  function nodeTooltip(id, m) {
    if (!m) { return id; }
    const lines = [id];
    if (m.component) { lines.push(`component: ${m.component}`); }
    if (m.version) { lines.push(`version: ${m.version}`); }
    // The default wave is what every node carrying no declared one already
    // sits in, so naming it on every hover would say nothing; a wave the author
    // declared is what the reader wants to see.
    if (m.wave) { lines.push(`deployment wave: ${m.wave}`); }
    for (const k of Object.keys(m.labels || {})) { lines.push(`${k}: ${m.labels[k]}`); }
    for (const line of catalogLines(m.catalog)) { lines.push(line); }
    if (m.sourceFile) { lines.push(`↪ ${m.sourceFile}`); }
    return lines.join('\n');
  }

  // catalogLines renders the Component's own catalog metadata. Each line is
  // labelled with the key the Architect authored in the entity's metadata
  // block, so what the hover shows is findable in the source it came from.
  function catalogLines(catalog) {
    if (!catalog) { return []; }
    const lines = [];
    for (const key of ['license', 'repository', 'home']) {
      if (catalog[key]) { lines.push(`${key}: ${catalog[key]}`); }
    }
    const keywords = catalog.keywords || [];
    if (keywords.length > 0) { lines.push(`keywords: ${keywords.join(', ')}`); }
    const maintainers = (catalog.maintainers || []).map(describeMaintainer).filter(Boolean);
    if (maintainers.length > 0) { lines.push(`maintainers: ${maintainers.join(', ')}`); }
    return lines;
  }

  function describeMaintainer(m) {
    if (!m) { return ''; }
    const name = m.name || '';
    const contact = m.email || m.url || '';
    if (name && contact) { return `${name} <${contact}>`; }
    return name || contact;
  }

  function edgeTooltip(e) {
    const parts = [`${e.sources[0]} → ${e.targets[0]}`, `origin: ${e._origin}`];
    if (e._socket) { parts.push(`socket: ${e._socket}`); }
    if (e._alias) { parts.push(`alias: ${e._alias}`); }
    return parts.join('\n');
  }

  root.AggregaGraphModel = {
    toElkGraph,
    place,
    edgePaths,
    nodeTooltip,
    edgeTooltip,
    waveRanks,
    nodeWave,
    containerLabel,
    ROLE_NODE_ID,
    ROLE_NODE_COMPONENT,
    ROLE_CONTAINER_TITLE,
    LEGEND_TITLE,
    LEGEND_ROWS,
    LEGEND_NOTE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
