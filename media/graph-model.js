// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.
//
// The document-free half of the topology renderer: the transform from the
// compiler's IR graph into an elk layout graph, which of its groupings a first
// layout says to lay side by side, the resolution of the laid-out graph's nested
// coordinates into one absolute space, the mark at the end an edge points to,
// the legend's rows for one drawing, and the hover text for a node and an edge.
// It reads no document, calls no layout engine and holds no state between
// transforms, so the ordering, the geometry, the legend and the hover contents
// can be exercised on their own. media/graph.js draws whatever this produces.
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

  // The container title for the nodes in no declared grouping on one axis: a
  // node whose boundary, or whose subsystem, the compiler marks as one it
  // synthesized — the grouping it creates for a Release or an Aggregate that
  // lists its components at the top level — and a node it sends no path for.
  //
  // The mark is read and the name is not. The compiler gives the grouping it
  // synthesizes a name, and an author may declare a grouping under that same
  // name; the mark is the one fact telling the two apart, so a grouping an
  // author declared is titled with its name whatever the name is.
  //
  // It says none was declared rather than naming one, because there is no
  // grouping called this: the box exists to hold the nodes that are in none.
  // For the same reason the box is marked as declared by nobody (`_declared`
  // on its container), so the drawing draws it apart from a grouping that was
  // declared and the legend gives it a row of its own saying what it holds. A
  // box titled this but drawn like a declared grouping reads as a grouping
  // called "(none declared)", which the legend's row for that kind — a grouping
  // a document declares — then contradicts.
  const UNGROUPED = '(none declared)';

  // The separator in each kind of grouping's path. The compiler composes the
  // path of a grouping declared inside another of its kind from the path of the
  // one it is declared in, the separator and its own name — a slash between
  // boundaries and a dot between subsystems — and neither kind's declared name
  // can contain its separator. So the path up to its last separator is the path
  // of the grouping it is declared in. The nesting the drawing shows is read
  // from the path the compiler sent, taken apart as the compiler puts it
  // together.
  const BOUNDARY_SEPARATOR = '/';
  const SUBSYSTEM_SEPARATOR = '.';

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
  // they would edit to change it. An edge's line does not say which of its two
  // ends uses the other, so its row says what the mark at one end means, in the
  // words the documentation uses for an edge's two ends: the consuming component
  // and its target. The accent bar is a colour whose meaning is local to the
  // drawing it appears in, and a reader told nothing will read a colour as fixed
  // and compare two graphs by it — and no colour says which type it stands for,
  // so each one drawn is named beside its swatch (legendRows, below).
  const LEGEND_TITLE = 'Legend';

  // LEGEND_ROWS are the rows every drawing's legend carries, in the order it
  // draws them; legendRows adds the rows that depend on what one drawing holds.
  // The two grouping rows come first and stay together.
  const LEGEND_ROWS = [
    { swatch: 'boundary', text: 'Boundary — a grouping the Release declares.' },
    { swatch: 'subsystem', text: 'Subsystem — a grouping the Aggregate declares.' },
    { swatch: 'edge', text: 'Edge — from the consuming component to its target, the arrowhead at the target.' },
    { swatch: 'accent', text: `Node type — the bar down a node's leading edge, coloured by its ${TYPE_LABEL} label:` },
  ];

  // The row each kind of box holding nodes in no declared grouping gets, where
  // the drawing draws one. It says what the box holds, which is the one thing
  // its title cannot: the title says only that nothing was declared.
  const UNDECLARED_ROWS = {
    boundary: { swatch: 'undeclared', text: `${UNGROUPED} — a box holding the nodes the Release places in no boundary.` },
    subsystem: { swatch: 'undeclared', text: `${UNGROUPED} — a box holding the nodes the Aggregate places in no subsystem.` },
  };

  // The row for the nodes that carry no type label, where the drawing draws
  // one: such a node draws no bar, and a legend naming only the colours would
  // leave a reader to guess what a node without one is.
  const UNTYPED_ROW = { swatch: 'untyped', text: `(no ${TYPE_LABEL} label)` };

  const LEGEND_NOTE =
    'Type colours are assigned as this graph is drawn, in the order the types are '
    + 'met. They group nodes within this graph only: the same colour in another '
    + 'graph is not the same type.';

  // containerLabel is what a container's title reads: the kind, then the
  // grouping's title — the whole path the compiler sent for a declared one, so
  // a grouping declared inside another names both, and the fallback above for
  // the nodes in none.
  function containerLabel(kind, title) {
    const k = CONTAINER_KINDS[kind];
    return k ? `${k.glyph} ${k.word} · ${title}` : title;
  }

  // declaredPath is the grouping a node is in on one axis, as the path the
  // compiler sent, or null where the node is in no declared grouping on that
  // axis.
  function declaredPath(path, synthesized) {
    return synthesized === true || !path ? null : path;
  }

  // enclosingPath is the path of the grouping a grouping is declared in, or the
  // empty string for one declared at the top of its document.
  function enclosingPath(path, separator) {
    const at = path.lastIndexOf(separator);
    return at === -1 ? '' : path.slice(0, at);
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
  //
  // A container named as one whose groupings go side by side takes those
  // options too (see SIDE_BY_SIDE).
  function containerOpts(rank, minWidth, sideBySide) {
    return partitioned(rank, Object.assign({
      // A container's own children are partitioned too, so a boundary holding
      // two waves shows them ordered inside itself.
      'elk.partitioning.activate': 'true',
      'elk.padding': `[top=${CONTAINER_PAD_TOP},left=14,bottom=14,right=14]`,
      'elk.spacing.nodeNode': '22',
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${minWidth},0)`,
    }, sideBySide ? SIDE_BY_SIDE : {}));
  }

  // SIDE_BY_SIDE lays the groupings one container holds side by side, each in
  // a layer of its own along the layout's direction, rather than stacked in
  // one: the layering that takes a bound on how many go in a layer, bounded to
  // one.
  //
  // The default layering puts every grouping with no edge to a sibling in one
  // layer, which stacks them in one column. Where they are tall, that column is
  // what turns a large topology into a narrow strip, and a first fit — which
  // scales the drawing until its longer side fits the panel — then shrinks it
  // by its height and leaves most of the panel's width empty. Side by side, the
  // same groupings make a drawing whose proportions are nearer the panel's, so
  // the same fit draws it larger. Edges between siblings still decide which
  // goes ahead of which.
  const SIDE_BY_SIDE = {
    'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
    'elk.layered.layering.coffmanGraham.layerBound': '1',
  };

  // groupingsToSpread reads a laid-out graph and names each container, the
  // graph itself included, whose groupings are to be laid side by side: one
  // holding only groupings, two or more of which the layout drew taller than
  // they are wide.
  //
  // It is decided from a layout rather than declared, because whether a
  // grouping is tall is a fact about how it was laid out — how many nodes it
  // stacks, and whether edges inside it run them across instead — which the
  // graph alone does not say. Groupings that are not tall are left stacked: a
  // drawing already wider than it is tall would only be widened further, and
  // drawn smaller for it. The caller lays the graph out once, asks this, and
  // where it names any container lays it out again with toElkGraph told which.
  function groupingsToSpread(laid) {
    const spread = [];
    const visit = (k) => {
      const held = (k && k.children) || [];
      const groupings = held.filter((c) => c._kind);
      const tall = groupings.filter((c) => (c.height || 0) > (c.width || 0));
      if (groupings.length === held.length && tall.length > 1) { spread.push(k.id); }
      for (const c of groupings) { visit(c); }
    };
    visit(laid);
    return spread;
  }

  // groupingTree is an empty tree of groupings of one kind: each grouping by its
  // path, and those declared at the top of the document in the order they are
  // first met. `holds` makes what a grouping of that kind holds besides the
  // groupings declared inside it — a boundary the subsystems of the nodes placed
  // directly in it, a subsystem the nodes declared directly in it.
  function groupingTree(separator, holds) {
    return { separator, holds, byPath: new Map(), top: [] };
  }

  // groupingIn returns the grouping at `path` in one tree, adding it the first
  // time it is met — and adding first the grouping it is declared inside, at
  // every depth, so a grouping that holds nothing of its own but holds one that
  // does still has its place. The grouping nobody declared, keyed by null, is
  // declared inside nothing, and is the one grouping marked as not declared.
  function groupingIn(tree, path) {
    if (tree.byPath.has(path)) { return tree.byPath.get(path); }
    const g = Object.assign({ title: path === null ? UNGROUPED : path, declared: path !== null, inner: [] }, tree.holds());
    const outer = path === null ? '' : enclosingPath(path, tree.separator);
    if (outer === '') {
      tree.top.push(g);
    } else {
      groupingIn(tree, outer).inner.push(g);
    }
    tree.byPath.set(path, g);
    return g;
  }

  // toElkGraph builds the nested elk graph and a side table of node metadata
  // the renderer reads back after layout (source file, hover text, accent
  // colour). Each node is put inside its boundary's container and, within it,
  // inside its subsystem's; a boundary declared inside another is put inside
  // that one's container, and a subsystem declared inside another likewise, at
  // every depth. Within each container, what it holds is ordered by deployment
  // wave.
  //
  // measure(text, role) reports the drawn width of one string in one of the
  // three roles above. It is required rather than defaulted: a default would be
  // an estimate, and an estimate standing in silently for a measurement is the
  // fault this argument exists to remove.
  //
  // spread names the containers, by id, whose groupings are laid side by side —
  // what groupingsToSpread reads off a first layout of the same graph. Left out,
  // every container lays its groupings out as the default layering does.
  function toElkGraph(graph, measure, spread) {
    const spec = (graph && graph.spec) || {};
    const nodes = spec.nodes || {};
    const edges = spec.edges || [];
    const sideBySide = new Set(spread || []);

    // Group node ids by boundary, then subsystem, preserving encounter order
    // (the IR nodes object is already author-ordered); the wave ordering below
    // is applied on top of that order, so nodes sharing a wave stay in the
    // order their author wrote them. A grouping nobody declared is keyed by
    // null, which no path the compiler sends can equal. Each boundary keeps the
    // subsystems of the nodes placed directly in it, so a subsystem whose nodes
    // the Release places in two boundaries is drawn in each.
    const boundaries = groupingTree(BOUNDARY_SEPARATOR, () => ({
      subsystems: groupingTree(SUBSYSTEM_SEPARATOR, () => ({ ids: [] })),
    }));
    const meta = new Map(); // nodeId -> { component, subLabel, version, wave, labels, catalog, sourceFile, type, accent }
    const waves = [];
    const accents = new Map();

    for (const id of Object.keys(nodes)) {
      const n = nodes[id] || {};
      const boundary = groupingIn(boundaries, declaredPath(n.boundary_path, n.synthesized_boundary));
      groupingIn(boundary.subsystems, declaredPath(n.subsystem_path, n.synthesized_subsystem)).ids.push(id);

      const wave = nodeWave(n);
      const component = n.component || id;
      const type = typeOf(n.labels);
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
        // The type the accent is coloured by, kept beside the colour so the
        // legend names each colour by the value it was assigned for.
        type,
        accent: accentColor(type, accents),
      });
    }

    const ranks = waveRanks(waves);
    const rankOf = (id) => ranks.get(meta.get(id).wave) || 0;
    const titleFloor = (label) =>
      Math.ceil(measure(label, ROLE_CONTAINER_TITLE)) + CONTAINER_TITLE_PAD;

    // A container is itself a node in its parent's ordering, so it takes the
    // earliest wave it holds at any depth: a grouping whose first work happens
    // in an earlier wave is laid out ahead of one whose does not. Its layout
    // options are written once what it holds is ordered, so its rank is known.
    // Whether anybody declared its grouping travels with it, for the drawing and
    // the legend to read.
    const container = (kind, id, title, declared, held) => {
      const ordered = byRank(held);
      const rank = ordered.length > 0 ? ordered[0].rank : 0;
      const label = containerLabel(kind, title);
      return {
        id,
        _title: title,
        _label: label,
        _kind: kind,
        _rank: rank,
        _declared: declared,
        layoutOptions: containerOpts(rank, titleFloor(label), sideBySide.has(id)),
        children: ordered.map((h) => h.child),
      };
    };
    const ranked = (c) => ({ rank: c._rank, child: c });
    // A subsystem's container holds the boxes of the nodes declared directly in
    // it and the containers of the subsystems declared directly inside it.
    const subsystemContainer = (boundaryTitle, s) => container('subsystem', `s::${boundaryTitle}::${s.title}`, s.title, s.declared, [
      ...s.ids.map((id) => ({
        rank: rankOf(id),
        child: {
          id,
          width: nodeBoxWidth(id, meta.get(id).subLabel, measure),
          height: NODE_H,
          layoutOptions: partitioned(rankOf(id)),
        },
      })),
      ...s.inner.map((inner) => ranked(subsystemContainer(boundaryTitle, inner))),
    ]);
    // A boundary's container holds the containers of the subsystems its own
    // nodes are declared in and the containers of the boundaries declared
    // directly inside it.
    const boundaryContainer = (b) => container('boundary', `b::${b.title}`, b.title, b.declared, [
      ...b.subsystems.top.map((s) => ranked(subsystemContainer(b.title, s))),
      ...b.inner.map((inner) => ranked(boundaryContainer(inner))),
    ]);
    const orderedBoundaries = byRank(boundaries.top.map((b) => ranked(boundaryContainer(b)))).map((h) => h.child);

    const elkEdges = edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.source],
      targets: [e.target],
      _origin: e.origin_release ? 'release' : (e.origin_feature ? 'feature' : 'aggregate'),
      _socket: e.socket || '',
      _alias: e.alias || '',
    }));

    // The graph itself is laid out with its boundaries the way a container is
    // with its groupings, so it too may be named as one whose boundaries go
    // side by side.
    const root = {
      id: 'root',
      layoutOptions: Object.assign({
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
      }, sideBySide.has('root') ? SIDE_BY_SIDE : {}),
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

  // How far the direction mark reaches back along its line from the point it
  // marks, and how far it spreads to either side of the line, in the layout's
  // own units — so it scales with the drawing, as the line it ends does.
  const MARK_LENGTH = 10;
  const MARK_HALF_WIDTH = 5;

  // directionMark is the arrowhead drawn where a line ends: its tip on the
  // line's last point, its base back along the line's last segment, as three
  // points with the tip first — or none for a line with no length to point
  // along.
  //
  // An edge runs from the consuming component to its target — the layout is
  // handed each edge's source and target as the compiler sent them — so its
  // geometry ends on the target's border, and the mark at the end is the mark
  // on the target. Its direction is the last segment's, which is the way the
  // line arrives at the box it ends on.
  function directionMark(points) {
    const tip = points && points[points.length - 1];
    let from = null;
    for (let i = (points || []).length - 2; i >= 0; i--) {
      if (points[i].x !== tip.x || points[i].y !== tip.y) { from = points[i]; break; }
    }
    if (!tip || !from) { return []; }
    const length = Math.hypot(tip.x - from.x, tip.y - from.y);
    const ux = (tip.x - from.x) / length;
    const uy = (tip.y - from.y) / length;
    const bx = tip.x - ux * MARK_LENGTH;
    const by = tip.y - uy * MARK_LENGTH;
    return [
      { x: tip.x, y: tip.y },
      { x: bx - uy * MARK_HALF_WIDTH, y: by + ux * MARK_HALF_WIDTH },
      { x: bx + uy * MARK_HALF_WIDTH, y: by - ux * MARK_HALF_WIDTH },
    ];
  }

  // byRank orders what a container holds by wave rank, keeping the order it was
  // handed within a rank: its nodes in author order, then the containers beside
  // them in the order they were first met. Handing elk the children already
  // ordered means the wave sequence is visible even where the layout falls back
  // to input order.
  function byRank(held) {
    return held
      .map((h, i) => ({ h, i }))
      .sort((a, b) => (a.h.rank - b.h.rank) || (a.i - b.i))
      .map((entry) => entry.h);
  }

  // typeOf is the value of a node's type label as its author wrote it, or null
  // when the node carries none. It is read once, here, and both the accent and
  // the legend row naming the accent are read from what it returns.
  function typeOf(labels) {
    const value = labels ? labels[TYPE_LABEL] : null;
    return value ? value : null;
  }

  // accentColor returns a stable accent colour for a node's type, or null when
  // the node carries no type label (the neutral node body stands alone).
  function accentColor(type, assignments) {
    if (type === null) { return null; }
    if (!assignments.has(type)) {
      assignments.set(type, ACCENT_PALETTE[assignments.size % ACCENT_PALETTE.length]);
    }
    return assignments.get(type);
  }

  // legendRows composes the legend for one drawing, from the graph handed to
  // the layout and the node table toElkGraph returned with it: the rows every
  // legend carries (LEGEND_ROWS), a row for each kind of box holding nodes in no
  // declared grouping where the drawing draws one, and, beneath the node-type
  // row, one row for each type the drawing colours.
  //
  // A type row names the type label's value exactly as the author wrote it,
  // beside the colour the drawing gave that value — read from the node table,
  // where both were set together, so the row cannot name one value beside
  // another's colour. The rows come in the order the colours were assigned,
  // which is the order the types are first met. A row for the nodes carrying no
  // type label comes last, where the drawing draws any.
  function legendRows(root, meta) {
    const undeclared = new Set();
    const visit = (k) => {
      for (const c of (k && k.children) || []) {
        if (!c._kind) { continue; }
        if (c._declared === false) { undeclared.add(c._kind); }
        visit(c);
      }
    };
    visit(root);
    const types = new Map();
    let untyped = false;
    for (const m of meta.values()) {
      if (m.type === null) { untyped = true; } else if (!types.has(m.type)) { types.set(m.type, m.accent); }
    }
    const rows = [];
    for (const row of LEGEND_ROWS) {
      rows.push(Object.assign({}, row));
      // Each kind's row for its box holding the nodes in none goes after the
      // grouping rows, which stay together as the first two.
      if (row.swatch === 'subsystem') {
        for (const kind of ['boundary', 'subsystem']) {
          if (undeclared.has(kind)) { rows.push(Object.assign({}, UNDECLARED_ROWS[kind])); }
        }
      }
    }
    for (const [type, colour] of types) { rows.push({ swatch: 'type', text: type, colour }); }
    if (untyped) { rows.push(Object.assign({}, UNTYPED_ROW)); }
    return rows;
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
    groupingsToSpread,
    place,
    edgePaths,
    directionMark,
    legendRows,
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
