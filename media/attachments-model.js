// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the attachments panel: the transform from the
// compiler's IR into the rows the panel draws for one selected node. It reads
// no document, touches no DOM and holds no state between projections, so the
// projection — and above all the withholding of sensitive material — can be
// exercised on its own. media/graph.js draws whatever this produces.
//
// Everything here reports what the compiler put in the IR. Nothing is inferred
// from a name, nothing is resolved, and a field the compiler did not send is
// left out rather than defaulted. An attachment's configuration is shown as its
// author wrote it, or it is withheld — never guessed at and never summarised.

(function (root) {
  'use strict';

  // The reasons a value is not shown. Each is a distinct statement about the
  // IR, and the panel words them apart, because saying "this is a secret" about
  // a leaf its author left readable would assert something the IR does not.
  //
  // DECLARED   — the attached Feature declares this leaf, or one above it,
  //              to carry sensitive material.
  // ATTACHMENT — the attachment as a whole handles declared-sensitive
  //              material, or carries a sensitivity marking in a shape this
  //              projection does not recognise.
  // UNREADABLE — the value is in no shape this projection can render as text.
  const WITHHELD_DECLARED = 'declared';
  const WITHHELD_ATTACHMENT = 'attachment';
  const WITHHELD_UNREADABLE = 'unreadable';

  // The pillars of an attachment that carry authored configuration, in the
  // order the IR writes them. These are the names the declared-sensitive leaf
  // paths are prefixed with, so they are also what the paths are matched on.
  const PILLARS = ['values', 'infra'];

  function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  // WITHHOLDING IS ASYMMETRIC, DELIBERATELY: a value is shown only when the IR
  // positively reports that nothing about it was declared sensitive. Every
  // other case withholds — a marking that is set, a marking in a shape this
  // code does not recognise, an entry that is not an attachment at all.
  //
  // The asymmetry is what the IR itself asks for. An absent per-leaf marking
  // states that no authored leaf matched a declaration; it never states that
  // the attachment carries nothing sensitive. Reading an absent marking as
  // permission to display a value in the clear reads it backwards, so this
  // projection never treats absence as permission — it treats only an
  // understood, unset marking as permission, and withholds on anything else.

  // recognisedFlag reports whether the attachment-wide sensitivity marking is
  // in the shape this projection understands. A boolean is understood; so is an
  // unset marking, which is the compiler's own finding that no sensitivity was
  // declared. Any other shape is a marking this code cannot read, and an
  // unreadable marking withholds rather than guesses.
  function recognisedFlag(v) {
    return v === undefined || v === null || typeof v === 'boolean';
  }

  // recognisedLeafList reports whether the declared-sensitive leaf paths are in
  // the shape this projection understands: absent, or a list of path strings.
  // A list carrying anything else cannot be matched against, and failing to
  // match a path is indistinguishable from the path not being declared — so an
  // unreadable list withholds the whole attachment instead.
  function recognisedLeafList(v) {
    if (v === undefined || v === null) { return true; }
    return Array.isArray(v) && v.every(function (p) { return typeof p === 'string'; });
  }

  // withholdsWholly reports whether every value on this attachment must be
  // withheld, whatever its individual leaves say.
  function withholdsWholly(entry) {
    if (!isPlainObject(entry)) { return true; }
    if (!recognisedFlag(entry.sensitive)) { return true; }
    if (!recognisedLeafList(entry.sensitive_authored_leaves)) { return true; }
    return entry.sensitive === true;
  }

  // coveredByDeclaration reports whether a leaf path is covered by one of the
  // attachment's declared-sensitive leaf paths.
  //
  // A declared path covers the leaf it names AND every leaf beneath it. A
  // declaration may land on an interior key whose children are the authored
  // values — a declared `values.credentials` above an authored
  // `values.credentials.password` — and matching only the exact path would
  // leave those children shown in the clear while the panel reported the
  // parent as protected.
  function coveredByDeclaration(path, declared) {
    for (let i = 0; i < declared.length; i++) {
      const d = declared[i];
      if (path === d || path.indexOf(d + '.') === 0) { return true; }
    }
    return false;
  }

  // scalarText renders a leaf value as the text the author wrote. A value in no
  // shape recognised here yields no text and is reported unreadable, so an
  // unexpected shape is withheld rather than stringified blindly.
  function scalarText(v) {
    if (v === null) { return { text: 'null', known: true }; }
    if (typeof v === 'string') { return { text: v, known: true }; }
    if (typeof v === 'number' || typeof v === 'boolean') {
      return { text: String(v), known: true };
    }
    return { text: '', known: false };
  }

  // walk decomposes an authored value into dotted leaf paths, which is the form
  // the IR writes its declared-sensitive leaf paths in. An empty object or list
  // is itself a leaf: it holds no value to show, and dropping it would lose a
  // key its author wrote.
  function walk(path, value, out) {
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) { out.push({ path: path, text: '{}', known: true }); return; }
      for (let i = 0; i < keys.length; i++) {
        walk(path + '.' + keys[i], value[keys[i]], out);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) { out.push({ path: path, text: '[]', known: true }); return; }
      for (let i = 0; i < value.length; i++) {
        walk(path + '.' + i, value[i], out);
      }
      return;
    }
    const scalar = scalarText(value);
    out.push({ path: path, text: scalar.text, known: scalar.known });
  }

  // flattenPillar decomposes one authored pillar into leaves under its own
  // name. A pillar the compiler did not send contributes nothing; a pillar in
  // no shape recognised here contributes one unreadable leaf rather than
  // vanishing, so a key its author wrote is never silently absent.
  function flattenPillar(pillar, payload, out) {
    if (payload === undefined || payload === null) { return; }
    if (isPlainObject(payload)) {
      const keys = Object.keys(payload);
      for (let i = 0; i < keys.length; i++) {
        walk(pillar + '.' + keys[i], payload[keys[i]], out);
      }
      return;
    }
    out.push({ path: pillar, text: '', known: false });
  }

  // pairs renders a string-keyed map as ordered key/value pairs, preserving the
  // order the compiler wrote them in.
  function pairs(m) {
    if (!isPlainObject(m)) { return []; }
    return Object.keys(m).map(function (k) {
      const v = m[k];
      return { key: k, value: typeof v === 'string' ? v : String(v) };
    });
  }

  function text(v) {
    return typeof v === 'string' ? v : '';
  }

  // projectAttachment turns one IR attachment into the row the panel draws.
  // `name` is the instance name its author gave the attachment, which is the
  // key it sits under; `binding` is the host Component slot it fills, which is
  // a separate field and frequently a different word.
  function projectAttachment(name, entry) {
    const wholly = withholdsWholly(entry);
    const safe = isPlainObject(entry) ? entry : {};
    const declared = !wholly && Array.isArray(safe.sensitive_authored_leaves)
      ? safe.sensitive_authored_leaves
      : [];

    const leaves = [];
    for (let i = 0; i < PILLARS.length; i++) {
      flattenPillar(PILLARS[i], safe[PILLARS[i]], leaves);
    }

    const fields = leaves.map(function (leaf) {
      if (wholly) {
        return { path: leaf.path, value: null, withheld: WITHHELD_ATTACHMENT };
      }
      if (coveredByDeclaration(leaf.path, declared)) {
        return { path: leaf.path, value: null, withheld: WITHHELD_DECLARED };
      }
      if (!leaf.known) {
        return { path: leaf.path, value: null, withheld: WITHHELD_UNREADABLE };
      }
      return { path: leaf.path, value: leaf.text, withheld: '' };
    });

    return {
      name: name,
      type: text(safe.type),
      version: text(safe.resolved_version),
      binding: text(safe.binding),
      origin: text(safe.origin),
      annotationKey: text(safe.annotation_key),
      annotationSource: text(safe.annotation_source),
      labels: pairs(safe.labels),
      // Whether the panel says this attachment handles sensitive material at
      // all. It is the attachment's own marking, reported as the IR set it —
      // not a summary of the leaves below, which answer a different question.
      sensitive: safe.sensitive === true,
      fields: fields,
    };
  }

  // attachmentsFor projects everything attached to one node. The IR keys its
  // attachment table by the same node ids the topology is keyed by, so the
  // selected node addresses its own bucket directly and nothing is matched by
  // name or inferred.
  //
  // A node with no bucket has nothing attached, which is a fact the IR carries
  // and the panel states plainly.
  function attachmentsFor(graph, nodeId) {
    const spec = (graph && graph.spec) || {};
    const mapping = spec.feature_values_mapping;
    const bucket = isPlainObject(mapping) ? mapping[nodeId] : undefined;
    if (!isPlainObject(bucket)) { return { nodeId: nodeId, attachments: [] }; }
    const names = Object.keys(bucket);
    return {
      nodeId: nodeId,
      attachments: names.map(function (n) { return projectAttachment(n, bucket[n]); }),
    };
  }

  // withheldNote is the sentence the panel shows in place of a value. Each
  // reason says only what the IR supports: that a declaration covers the leaf,
  // that the attachment as a whole carries declared-sensitive material, or that
  // the value arrived in a shape this view cannot render.
  function withheldNote(reason) {
    if (reason === WITHHELD_DECLARED) {
      return 'withheld — declared sensitive';
    }
    if (reason === WITHHELD_ATTACHMENT) {
      return 'withheld — this attachment handles sensitive material';
    }
    if (reason === WITHHELD_UNREADABLE) {
      return 'withheld — value not in a readable shape';
    }
    return '';
  }

  root.AggregaAttachments = {
    attachmentsFor: attachmentsFor,
    projectAttachment: projectAttachment,
    withheldNote: withheldNote,
    WITHHELD_DECLARED: WITHHELD_DECLARED,
    WITHHELD_ATTACHMENT: WITHHELD_ATTACHMENT,
    WITHHELD_UNREADABLE: WITHHELD_UNREADABLE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
