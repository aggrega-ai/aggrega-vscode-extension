// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the topology renderer: the transform from the
// compiler's IR graph into an elk layout graph, and the hover text for a node
// and an edge. It reads no document, calls no layout engine and holds no state
// between transforms, so the ordering and the hover contents can be exercised
// on their own. media/graph.js draws whatever this produces.
//
// Everything here renders values the compiler put in the IR. Nothing is
// inferred from a name, and a field the compiler did not send is left out
// rather than defaulted.

(function (root) {
  'use strict';

  const NODE_H = 46;
  const CHAR_W = 7.5;
  const MIN_NODE_W = 90;
  const CONTAINER_PAD_TOP = 26;

  // The container fallback title for a node whose boundary or subsystem path is
  // empty. The compiler sends no path for a node outside any named grouping,
  // and one container per graph collects those.
  const UNGROUPED = '(default)';

  // ACCENT_PALETTE is the colour-blind-safe categorical palette (Okabe-Ito,
  // minus black and minus the two hues reserved for edge provenance) used for
  // node-type accents. Colours are assigned to distinct type values in
  // first-encounter order and cycle if the palette is exhausted, so the same
  // type always draws the same accent within a render.
  const ACCENT_PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2'];

  const TYPE_LABEL = 'component.aggrega.ai/type';

  function nodeWidth(label) {
    return Math.max(MIN_NODE_W, Math.round(label.length * CHAR_W) + 24);
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

  function containerOpts(rank) {
    return partitioned(rank, {
      // A container's own children are partitioned too, so a boundary holding
      // two waves shows them ordered inside itself.
      'elk.partitioning.activate': 'true',
      'elk.padding': `[top=${CONTAINER_PAD_TOP},left=14,bottom=14,right=14]`,
      'elk.spacing.nodeNode': '22',
    });
  }

  // toElkGraph builds the nested elk graph and a side table of node metadata
  // the renderer reads back after layout (source file, hover text, accent
  // colour). Node ids are grouped by boundary, then subsystem, and ordered by
  // deployment wave within each grouping.
  function toElkGraph(graph) {
    const spec = (graph && graph.spec) || {};
    const nodes = spec.nodes || {};
    const edges = spec.edges || [];

    // Group node ids by boundary, then subsystem, preserving encounter order
    // (the IR nodes object is already author-ordered); the wave ordering below
    // is applied on top of that order, so nodes sharing a wave stay in the
    // order their author wrote them.
    const boundaries = new Map(); // boundaryKey -> Map(subsystemKey -> [nodeId])
    const meta = new Map(); // nodeId -> { component, version, wave, labels, catalog, sourceFile, accent }
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
      waves.push(wave);
      meta.set(id, {
        component: n.component || id,
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

    const children = [];
    for (const [bKey, subs] of boundaries) {
      const bChildren = [];
      for (const [sKey, ids] of subs) {
        const ordered = byWave(ids, rankOf);
        const sChildren = ordered.map((id) => ({
          id,
          width: nodeWidth(id),
          height: NODE_H,
          layoutOptions: partitioned(rankOf(id)),
        }));
        bChildren.push({
          id: `s::${bKey}::${sKey}`,
          _title: sKey,
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
        _kind: 'boundary',
        _rank: orderedSubs.length > 0 ? orderedSubs[0]._rank : 0,
        children: orderedSubs,
      });
    }
    const orderedBoundaries = byRank(children);

    // The layout options are attached after ordering so a container's rank is
    // known before it is written out.
    for (const b of orderedBoundaries) {
      b.layoutOptions = containerOpts(b._rank);
      for (const s of b.children) {
        s.layoutOptions = containerOpts(s._rank);
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
    nodeTooltip,
    edgeTooltip,
    waveRanks,
    nodeWave,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
