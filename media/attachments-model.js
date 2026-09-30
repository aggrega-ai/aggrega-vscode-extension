// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the attachments panel: the transform from the
// compiler's IR into the rows the panel draws for one selected node, and the
// redaction that runs before the IR is handed to the view at all. It reads no
// document, touches no DOM and holds no state between projections, so the
// projection — and above all the withholding of sensitive material — can be
// exercised on its own. media/graph.js draws whatever this produces.
//
// Everything here reports what the compiler put in the IR. Nothing is inferred
// from a name, nothing is resolved, and a field the compiler did not send is
// left out rather than defaulted. An attachment's configuration is shown as its
// author wrote it, or it is withheld — never guessed at and never summarised.
//
// This file is loaded twice, on the two sides of the view boundary, and that is
// the point of it. The side holding the compiled graph calls redactGraph before
// handing the payload over, so a value the rule withholds is removed while it is
// still on that side; the view then projects what arrives. Both sides run these
// same functions, so the question "is this value withheld" has one answer and
// one implementation, and the two cannot drift into disagreeing.
//
// The reader's setting that shows sensitive values reaches both sides from one
// reading of it. The sending side does not redact a payload built with the
// setting on, and says with each graph it posts whether the setting was on for
// that payload; the view hands that statement to the projection. Only the
// boolean true reads as on, so a graph posted without saying so, or saying so in
// any other shape, is projected with the setting off — and the view then still
// withholds a declared value that reaches it unredacted.

(function (root) {
  'use strict';

  // The reasons a value is not shown. Each is a distinct statement about the
  // IR, and the panel words them apart, because saying "this is a secret" about
  // a leaf its author left readable would assert something the IR does not.
  //
  // DECLARED   — the attached Feature declares this leaf, or one above it,
  //              to carry sensitive material.
  // ATTACHMENT — the attachment's sensitivity marking arrived in a shape this
  //              projection cannot read, so no leaf on it can be judged and
  //              every one of them is withheld.
  // UNREADABLE — the value is in no shape this projection can render as text.
  const WITHHELD_DECLARED = 'declared';
  const WITHHELD_ATTACHMENT = 'attachment';
  const WITHHELD_UNREADABLE = 'unreadable';

  // WITHHELD_MARKER_KEY is the sole key of the object redactGraph leaves where a
  // value used to be. It carries the reason the value was withheld, so the panel
  // can still say why a field is absent once the value itself is gone.
  //
  // A removed value needs SOME representation, because dropping the key would
  // drop the field's path with it and the reader would no longer learn that the
  // field exists at all. The representation may not be one an author could have
  // written, which rules out every plain scalar: `null` is the trap worth naming,
  // because scalarText reads it as the readable text "null" and the panel would
  // then draw that word where the authored value used to be — a confident wrong
  // answer in place of a correct refusal. A single-key object is a shape this
  // file recognises before it reads any value out of it.
  //
  // An author who writes this exact shape into their own configuration has their
  // value withheld and told it was withheld. That is over-withholding, which
  // cannot leak.
  //
  // THE COMPILER DEFINES THIS KEY AND THE REASONS ABOVE; the spelling here is a
  // second runtime's copy of a contract it does not own. The compiler writes the
  // same marker into the structured views it emits, and the two cannot be held
  // together by importing anything, because they are different languages.
  //
  // So they are held together by measurement instead: a conformance test runs
  // the compiler for real over a workspace that declares sensitivity and hands
  // the marker it emits to the reader below. A rename on either side leaves the
  // reader recognising nothing and fails that test. Do not "simplify" the check
  // into a comparison against a recorded sample — a sample is a third copy, and
  // it would agree with this one while both had drifted from the compiler.
  const WITHHELD_MARKER_KEY = 'aggrega_withheld';

  // The pillars of an attachment that carry authored configuration, in the
  // order the IR writes them. These are the names the declared-sensitive leaf
  // paths are prefixed with, so they are also what the paths are matched on.
  const PILLARS = ['values', 'infra'];

  function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  // withheldMarker builds the object that stands in for a value redactGraph
  // removed.
  function withheldMarker(reason) {
    const marker = {};
    marker[WITHHELD_MARKER_KEY] = reason;
    return marker;
  }

  // markerReason reads the reason out of a withheld marker, or reports the empty
  // string for anything that is not one.
  //
  // A marker carrying a reason this file does not recognise is still a marker: a
  // value was removed, and the only question left is which sentence to show. It
  // falls back to the attachment-wide reason, which is the one that claims least
  // about the individual leaf — it says the marking could not be read rather
  // than asserting anything about what the author declared at this path, which
  // is the only honest thing to say about a reason nothing here understands.
  function markerReason(v) {
    if (!isPlainObject(v)) { return ''; }
    const keys = Object.keys(v);
    if (keys.length !== 1 || keys[0] !== WITHHELD_MARKER_KEY) { return ''; }
    const reason = v[WITHHELD_MARKER_KEY];
    if (reason === WITHHELD_DECLARED || reason === WITHHELD_UNREADABLE) { return reason; }
    return WITHHELD_ATTACHMENT;
  }

  // WITHHOLDING IS PER LEAF, AND THE FAIL-SAFE IS PER ATTACHMENT.
  //
  // A leaf is withheld when one of the IR's declared-sensitive leaf paths
  // covers it. The attachment-wide marking is a different statement about a
  // different subject: it says the attachment handles material an author
  // declared sensitive somewhere — in its values, its infra, its provides, or
  // the slot it fills — and it names no datum at all. So it is reported on the
  // attachment and never spread down onto individual leaves. Spreading it hides
  // a referenceable credential's own name and key, which are public locators
  // its author left undeclared and needs in order to read the file being
  // edited; the terminal surface showing the same attachment hides neither, and
  // the same author reads both about the same file.
  //
  // THE FAIL-SAFE IS WHAT KEEPS THAT SAFE, AND IT IS PER ATTACHMENT BECAUSE
  // THAT IS THE UNIT IT CAN JUDGE. This projection may act on the per-leaf
  // marking only where it can read it. An entry that is not an attachment, an
  // attachment-wide marking in an unrecognised shape, and a declared-leaf list
  // this code cannot match against all leave every leaf unjudgeable — failing
  // to match a path is indistinguishable from the path not being declared — so
  // each of them withholds the whole attachment. Over-withholding costs a
  // reader one value they must find another way; under-withholding prints a
  // secret.
  //
  // An ABSENT declared-leaf list is not one of those cases: it is the
  // compiler's own positive finding that no leaf of this attachment's payload
  // is covered by a declaration, which is the same answer the terminal surface
  // reaches from the same declarations.

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
  //
  // Every case here is a shape this projection cannot read, and that is the
  // whole of it. The attachment-wide sensitivity marking is deliberately NOT
  // consulted: it is a fact about the attachment rather than about any one of
  // its values, so withholding on it hides the public locators an author needs
  // — see the asymmetry above. It is still read for its SHAPE, because a
  // marking this code cannot parse is a payload it cannot judge.
  function withholdsWholly(entry) {
    if (!isPlainObject(entry)) { return true; }
    if (!recognisedFlag(entry.sensitive)) { return true; }
    if (!recognisedLeafList(entry.sensitive_payload_leaves)) { return true; }
    return false;
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

  // installer returns the function that writes a replacement value back where
  // the walked value sits. redactGraph uses it to put a marker where a value was;
  // the projection ignores it. It is produced by the walk itself so that the
  // side that removes a value and the side that reads it derive their leaf paths
  // from one traversal rather than from two that agree today.
  function installer(container, key) {
    return function (replacement) { container[key] = replacement; };
  }

  function noInstall() {}

  // walk decomposes an authored value into dotted leaf paths, which is the form
  // the IR writes its declared-sensitive leaf paths in. An empty object or list
  // is itself a leaf: it holds no value to show, and dropping it would lose a
  // key its author wrote.
  //
  // A value already replaced by a withheld marker is a leaf carrying that
  // marker's reason and no text. It is recognised before the object branch,
  // because a marker IS an object and descending into one would report its
  // internals as authored keys.
  function walk(path, value, out, install) {
    const marked = markerReason(value);
    if (marked) {
      out.push({ path: path, text: '', known: false, withheld: marked, install: install });
      return;
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        out.push({ path: path, text: '{}', known: true, withheld: '', install: install });
        return;
      }
      for (let i = 0; i < keys.length; i++) {
        walk(path + '.' + keys[i], value[keys[i]], out, installer(value, keys[i]));
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push({ path: path, text: '[]', known: true, withheld: '', install: install });
        return;
      }
      for (let i = 0; i < value.length; i++) {
        walk(path + '.' + i, value[i], out, installer(value, i));
      }
      return;
    }
    const scalar = scalarText(value);
    out.push({
      path: path, text: scalar.text, known: scalar.known, withheld: '', install: install,
    });
  }

  // flattenPillar decomposes one authored pillar into leaves under its own
  // name. A pillar the compiler did not send contributes nothing; a pillar in
  // no shape recognised here contributes one unreadable leaf rather than
  // vanishing, so a key its author wrote is never silently absent.
  function flattenPillar(pillar, payload, out, install) {
    if (payload === undefined || payload === null) { return; }
    const marked = markerReason(payload);
    if (marked) {
      out.push({ path: pillar, text: '', known: false, withheld: marked, install: install });
      return;
    }
    if (isPlainObject(payload)) {
      const keys = Object.keys(payload);
      for (let i = 0; i < keys.length; i++) {
        walk(pillar + '.' + keys[i], payload[keys[i]], out, installer(payload, keys[i]));
      }
      return;
    }
    out.push({ path: pillar, text: '', known: false, withheld: '', install: install });
  }

  // leavesOf decomposes an attachment's authored pillars into leaves, in the
  // order the IR writes the pillars. Both the projection and the redaction read
  // an attachment through this one function.
  function leavesOf(entry, install) {
    const leaves = [];
    for (let i = 0; i < PILLARS.length; i++) {
      flattenPillar(PILLARS[i], entry[PILLARS[i]], leaves, install(PILLARS[i]));
    }
    return leaves;
  }

  // declaredLeaves reports the declared-sensitive leaf paths to match against.
  // An attachment withheld wholly has nothing to match: every leaf goes anyway,
  // and reading the list would only invite treating the ones it omits as shown.
  function declaredLeaves(entry, wholly) {
    return !wholly && Array.isArray(entry.sensitive_payload_leaves)
      ? entry.sensitive_payload_leaves
      : [];
  }

  // withholdingFor is what an attachment's sensitivity markings withhold: whether
  // the fail-safe withholds the whole attachment, and the declared leaf paths to
  // match against. Both sides of the boundary read an attachment's markings
  // through this one function.
  //
  // WITH THE SETTING ON, NOTHING IS WITHHELD FOR SENSITIVITY — neither a declared
  // leaf nor an attachment whose marking cannot be read. The reader has asked to
  // read back what they wrote, and the sending side sends both untouched in that
  // state, so withholding either here would refuse what the reader asked for and
  // protect nothing, the value having already crossed. A value in no shape the
  // panel can render as text is still withheld, and for that reason alone: it is
  // a limit of drawing, not a sensitivity refusal.
  //
  // Only the boolean true is the setting on. What this is handed is the sending
  // side's statement about the payload, and anything else — no statement, or one
  // in a shape this cannot read — is the setting off, which withholds by the
  // markings whatever arrived.
  //
  // The sending side makes the same choice where it decides whether to redact at
  // all, rather than by asking this: in that direction it must not need this file,
  // so that a rule file which cannot be loaded blocks only the direction that
  // needs the rule in order to be safe.
  function withholdingFor(entry, showsSensitiveValues) {
    if (showsSensitiveValues === true) { return { wholly: false, declared: [] }; }
    const wholly = withholdsWholly(entry);
    return { wholly: wholly, declared: declaredLeaves(entry, wholly) };
  }

  // withheldReasonFor is the single decision "is this leaf withheld, and why".
  // With the setting off, the side that strips a value before it crosses and the
  // side that draws what arrives both ask it, so the set of values removed is by
  // construction the set the panel reports as withheld — not two sets that happen
  // to coincide. With the setting on nothing is removed, and the panel withholds
  // only a value it cannot render as text.
  //
  // A leaf already carrying a marker keeps that marker's reason: the value is
  // gone, and the reason recorded when it was removed is the truthful one.
  function withheldReasonFor(leaf, wholly, declared) {
    if (leaf.withheld) { return leaf.withheld; }
    if (wholly) { return WITHHELD_ATTACHMENT; }
    if (coveredByDeclaration(leaf.path, declared)) { return WITHHELD_DECLARED; }
    if (!leaf.known) { return WITHHELD_UNREADABLE; }
    return '';
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
  // a separate field and frequently a different word. `showsSensitiveValues` is
  // the sending side's statement of whether the reader's setting was on for the
  // payload this entry arrived in; withholdingFor says what it changes, and why
  // only the boolean true reads as on.
  function projectAttachment(name, entry, showsSensitiveValues) {
    const safe = isPlainObject(entry) ? entry : {};
    const withholding = withholdingFor(entry, showsSensitiveValues);

    // With the setting off, this projection runs on data the boundary has
    // already redacted, and the withholding below therefore has nothing left to
    // withhold. It is kept DELIBERATELY, and it is not a duplicate of the
    // redaction: it is the same single-sourced decision running on the far side
    // of the boundary, so the panel still refuses a value that reached it by any
    // route the redaction did not cover — an unredacted payload, a future sender.
    // Do not remove it as redundant. What lifts it is the sending side's own
    // statement that the setting was on, never the arrival of a value.
    const leaves = leavesOf(safe, function () { return noInstall; });

    const fields = leaves.map(function (leaf) {
      const reason = withheldReasonFor(leaf, withholding.wholly, withholding.declared);
      if (reason) {
        return { path: leaf.path, value: null, withheld: reason };
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
  // and the panel states plainly. `showsSensitiveValues` is passed through to
  // each attachment's projection as it arrived.
  function attachmentsFor(graph, nodeId, showsSensitiveValues) {
    const spec = (graph && graph.spec) || {};
    const mapping = spec.feature_values_mapping;
    const bucket = isPlainObject(mapping) ? mapping[nodeId] : undefined;
    if (!isPlainObject(bucket)) { return { nodeId: nodeId, attachments: [] }; }
    const names = Object.keys(bucket);
    return {
      nodeId: nodeId,
      attachments: names.map(function (n) {
        return projectAttachment(n, bucket[n], showsSensitiveValues);
      }),
    };
  }

  // --- redaction at the boundary -------------------------------------------
  //
  // redactGraph is what the side holding the compiled graph calls before handing
  // the payload to the view, whenever the reader's setting that shows sensitive
  // values is not on. It removes the values the rule above withholds and
  // KEEPS the markings that say why, so the panel can still name the reason a
  // field is absent. Stripping the markings too would leave the panel able to
  // report only that something is missing.
  //
  // Its reach is the attachment table and nothing else, because that is where a
  // sensitivity marking can appear at all: the marking lives on an attachment
  // entry, and the attachment table is the only place the compiler puts one. A
  // payload the graph carries that no marking covers is left exactly as it
  // arrived — this removes what is marked, and nothing else.

  // cloneValue copies the structures walk descends into, so redaction rewrites a
  // copy and the graph it was handed is left as it was. A value walk treats as a
  // leaf is returned as it stands: a scalar cannot be mutated through, and
  // anything else is replaced by a marker rather than kept.
  function cloneValue(value) {
    if (isPlainObject(value)) {
      const copy = {};
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        copy[keys[i]] = cloneValue(value[keys[i]]);
      }
      return copy;
    }
    if (Array.isArray(value)) {
      const copy = [];
      for (let i = 0; i < value.length; i++) {
        copy.push(cloneValue(value[i]));
      }
      return copy;
    }
    return value;
  }

  // redactAttachment returns the entry with every withheld value replaced by a
  // marker and every other key — the markings above all — carried through as it
  // stands.
  //
  // An entry that is not an attachment at all yields an empty one. Such an entry
  // is withheld wholly, so the panel already draws nothing from it, and carrying
  // its content across the boundary would move material the view has no way to
  // show and no reason to hold.
  function redactAttachment(entry) {
    if (!isPlainObject(entry)) { return {}; }

    const out = {};
    const keys = Object.keys(entry);
    for (let i = 0; i < keys.length; i++) {
      out[keys[i]] = entry[keys[i]];
    }

    // The sending side redacts only a payload built with the setting off, so it
    // asks the rule with the setting off.
    const withholding = withholdingFor(entry, false);

    for (let i = 0; i < PILLARS.length; i++) {
      const pillar = PILLARS[i];
      if (entry[pillar] === undefined || entry[pillar] === null) { continue; }
      out[pillar] = cloneValue(entry[pillar]);
    }

    const leaves = leavesOf(out, function (pillar) { return installer(out, pillar); });
    for (let i = 0; i < leaves.length; i++) {
      const reason = withheldReasonFor(leaves[i], withholding.wholly, withholding.declared);
      if (reason) { leaves[i].install(withheldMarker(reason)); }
    }
    return out;
  }

  // redactGraph returns the graph with the attachment table redacted. A payload
  // carrying no attachment table has nothing to redact and is returned as it
  // stands.
  function redactGraph(graph) {
    if (!isPlainObject(graph) || !isPlainObject(graph.spec)) { return graph; }
    const mapping = graph.spec.feature_values_mapping;
    if (!isPlainObject(mapping)) { return graph; }

    const redacted = {};
    const nodeIds = Object.keys(mapping);
    for (let i = 0; i < nodeIds.length; i++) {
      const bucket = mapping[nodeIds[i]];
      const out = {};
      if (isPlainObject(bucket)) {
        const names = Object.keys(bucket);
        for (let j = 0; j < names.length; j++) {
          out[names[j]] = redactAttachment(bucket[names[j]]);
        }
      }
      redacted[nodeIds[i]] = out;
    }

    const spec = {};
    const specKeys = Object.keys(graph.spec);
    for (let i = 0; i < specKeys.length; i++) {
      spec[specKeys[i]] = graph.spec[specKeys[i]];
    }
    spec.feature_values_mapping = redacted;

    const out = {};
    const graphKeys = Object.keys(graph);
    for (let i = 0; i < graphKeys.length; i++) {
      out[graphKeys[i]] = graph[graphKeys[i]];
    }
    out.spec = spec;
    return out;
  }

  // withheldNote is the sentence the panel shows in place of a value. Each
  // reason says only what the IR supports: that a declaration covers the leaf,
  // that the attachment's own sensitivity marking could not be read, or that
  // the value arrived in a shape this view cannot render. None of them names
  // WHICH declaration withheld a value — the reason is one of this fixed set,
  // so the note tells a reader what to do without becoming a second, weaker
  // copy of the declaration itself.
  function withheldNote(reason) {
    if (reason === WITHHELD_DECLARED) {
      return 'withheld — declared sensitive';
    }
    if (reason === WITHHELD_ATTACHMENT) {
      return 'withheld — this attachment\'s sensitivity marking is unreadable';
    }
    if (reason === WITHHELD_UNREADABLE) {
      return 'withheld — value not in a readable shape';
    }
    return '';
  }

  root.AggregaAttachments = {
    attachmentsFor: attachmentsFor,
    projectAttachment: projectAttachment,
    redactGraph: redactGraph,
    withheldNote: withheldNote,
    WITHHELD_DECLARED: WITHHELD_DECLARED,
    WITHHELD_ATTACHMENT: WITHHELD_ATTACHMENT,
    WITHHELD_UNREADABLE: WITHHELD_UNREADABLE,
    WITHHELD_MARKER_KEY: WITHHELD_MARKER_KEY,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
