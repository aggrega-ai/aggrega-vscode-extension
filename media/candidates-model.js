// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the candidate palette: the transform from the
// language server's answer about what may attach into the rows the panel draws
// — for a node, the Features that may attach to it, and for a connection, the
// slots its socket declares with the Features that may fill each — and the
// sentences the panel shows while it waits, when nothing matched, when no slot
// may be filled, and when the request was refused. It reads no document,
// touches no DOM and holds no state between projections, so the wording and the
// row shape can be exercised on their own. media/graph.js draws whatever this
// produces.
//
// WHAT THIS PROJECTS IS A DIFFERENT PAYLOAD FROM THE ATTACHMENT PROJECTION NEXT
// TO IT, and the two share no rule. That one renders what IS attached, out of
// the compiled IR the panel already holds. This one renders what MAY attach,
// out of an answer computed elsewhere. Neither restates the other, and neither
// is a place to put the other's logic.
//
// Nothing here decides what may attach. The match is performed against the
// applicability every Feature declares, and this renders the result and adds
// nothing to it: no label, name or kind is read for meaning, and the order the
// answer arrived in is the order drawn, so what the reader sees is the answer
// rather than a second opinion about it.

(function (root) {
  'use strict';

  // The heading over the palette. It says MAY, and the caption below says what
  // that does and does not amount to: a Feature listed here has declared that
  // it applies to labels like these, which is a statement by its author and not
  // an outcome anybody has computed.
  const CANDIDATES_TITLE = 'May attach';

  const CANDIDATES_CAPTION =
    'Features whose declared applicability the labels on this node satisfy. '
    + 'Listing is what a Feature declares, not what a build will do.';

  const PENDING_NOTE = 'Looking for Features that may attach…';

  // The words on the control that commits a candidate, and the sentence under
  // the palette saying what pressing it does.
  //
  // The caption says the edit lands in the Aggregate rather than merely
  // happening, because the reader is about to have a file of theirs changed and
  // an affordance that does not say which file is one they cannot predict. It
  // says nothing about saving: the edit reaches the buffer, and whether that is
  // written to disk stays the reader's decision like every other edit.
  const ATTACH_ACTION = 'Attach';

  const ATTACH_ACTION_CAPTION =
    'Attaching edits the Aggregate that declares this component. '
    + 'The change lands in the editor, where it can be undone.';

  // The same section for a connection: what it lists, what pressing a row's
  // control does, and the sentence while the answer is in flight.
  //
  // Its caption names the two things the answer matched, because a Feature
  // listed under a slot is one whose declared applicability the consuming
  // component's labels satisfy AND whose own labels satisfy the slot's
  // selector — again a statement of what Features declare, not an outcome. The
  // action caption says which document the edit lands in, and under which name,
  // because the reader is about to have a file changed: the document that drew
  // the connection, under the slot's name.
  const SLOTS_CAPTION =
    'The slots this connection\'s socket declares, each with the Features that may fill it: '
    + 'those whose declared applicability the labels on the consuming component satisfy and '
    + 'whose own labels satisfy the slot\'s selector. '
    + 'Listing is what a Feature declares, not what a build will do.';

  const SLOTS_ACTION_CAPTION =
    'Attaching writes the Feature under the slot\'s name on this connection, in the document '
    + 'that drew it: the Release for a connection the Release drew, the Aggregate otherwise. '
    + 'The change lands in the editor, where it can be undone.';

  // The action caption for a connection selected from its entry in a document
  // rather than by pressing its edge. An attach made from that selection is
  // written on the entry the cursor was in, which for a Release's own entry on a
  // connection the Aggregate drew is not in the document that drew it — so this
  // caption names the document by where the command was run.
  const SLOTS_ENTRY_ACTION_CAPTION =
    'Attaching writes the Feature under the slot\'s name on this connection\'s entry in the '
    + 'document the command was run in. '
    + 'The change lands in the editor, where it can be undone.';

  const SLOTS_PENDING_NOTE = 'Looking for the slots this connection may fill…';

  // The reasons the answer gives for a connection with no slot to fill. These
  // are wire values, matched but never shown; the set is the answer's own, and
  // closed.
  const NO_SLOT_FEATURE_CREATED = 'feature-created-connection';
  const NO_SLOT_AD_HOC = 'ad-hoc-socket';
  const NO_SLOT_DECLARED = 'no-slot-declared';

  // The label sets an answer can be computed over. Each is a genuinely
  // different statement, so the empty-result sentence is worded from it rather
  // than from one sentence covering all three: an answer computed over labels
  // the caller supplied says nothing about where those labels came from, and
  // must not be reported as though something had vouched for them.
  //
  // These are wire values, matched but never shown: they name a distinction the
  // sentences below express in words the reader already has.
  const LABELS_DECLARED = 'declared';
  const LABELS_RESOLVED = 'resolved';
  const LABELS_SUPPLIED = 'supplied';

  // Where a candidate was read from. A workspace document reports its own
  // workspace-relative path; an entity resolved from the configured catalog
  // directories reports no path, because the only one it has would name a
  // layout on the machine running the language server.
  const ORIGIN_CATALOG = 'catalog';

  function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function text(v) {
    return typeof v === 'string' ? v : '';
  }

  // emptyNote is the sentence shown when the answer named no Feature.
  //
  // 🔴 IT NEVER SAYS "NOTHING CAN ATTACH HERE", because that is a stronger
  // claim than any of these answers supports. What each of them supports is
  // that no Feature's DECLARED APPLICABILITY matched one particular label set,
  // and the three differ in which label set that was — so each says which,
  // and none of them generalises past it.
  //
  // The answer the panel asks for is computed over a node of a compiled graph,
  // and its label set is the labels that node carries on the graph the panel
  // drew — the set the caption above the list calls the labels on this node.
  // So that sentence is worded in the caption's words: one set named two ways,
  // one line above the other, would read as two different sets.
  function emptyNote(labelSource) {
    if (labelSource === LABELS_RESOLVED) {
      return 'No Feature\'s declared applicability matches the labels on this node.';
    }
    if (labelSource === LABELS_SUPPLIED) {
      return 'No Feature\'s declared applicability matches the labels sent with the request.';
    }
    if (labelSource === LABELS_DECLARED) {
      return 'No Feature\'s declared applicability matches the labels that document declares.';
    }
    // The answer did not say which label set it used. Naming one anyway would
    // assert something it did not report, so this says only what is certain:
    // a match was evaluated, and nothing satisfied it.
    return 'No Feature\'s declared applicability matches the labels this answer was computed over.';
  }

  // failureNote is the sentence shown when the request could not be answered.
  // The reason is carried through as it was reported rather than re-worded, so
  // a message naming what to do reaches the reader still naming it.
  function failureNote(message) {
    const detail = text(message);
    return detail
      ? 'Cannot list what may attach: ' + detail
      : 'Cannot list what may attach.';
  }

  // candidateRow reduces one candidate to the row the panel draws: the entity's
  // name, and the facts that let a reader find it.
  //
  // A candidate carrying a file is one the workspace declares, and the path is
  // the thing a reader acts on. One carrying no file came from the configured
  // catalog directories, and saying so is the honest substitute — an absent
  // path is otherwise indistinguishable from a field nothing filled in.
  function candidateRow(candidate) {
    const safe = isPlainObject(candidate) ? candidate : {};
    const facts = [];
    const kind = text(safe.kind);
    if (kind) { facts.push({ key: 'kind', value: kind }); }

    const file = text(safe.file);
    const origin = text(safe.origin);
    if (file) {
      facts.push({ key: 'declared in', value: file });
    } else if (origin === ORIGIN_CATALOG) {
      facts.push({ key: 'from', value: 'the configured catalog' });
    } else if (origin) {
      facts.push({ key: 'from', value: origin });
    }

    return { name: text(safe.name), facts: facts };
  }

  // projectCandidates turns the answer into what the panel draws.
  //
  // The candidate order is the order the answer arrived in. That order is a
  // deterministic function of the entities themselves, so re-sorting here would
  // replace an ordering the answer guarantees with a second one this file would
  // then own.
  //
  // An answer in a shape this file does not recognise yields no rows and the
  // empty sentence for an unstated label set. That direction is the safe one:
  // it reports that nothing matched rather than drawing rows out of a payload
  // it could not read.
  //
  // linksNote is the line naming the links leading out of the workspace that the
  // host sent beside the answer, where it sent one. It is carried as it arrived:
  // the host composes it from the language server's own answer, and a second
  // wording here would be free to disagree with the one every other surface says.
  function projectCandidates(result, linksNote) {
    const safe = isPlainObject(result) ? result : {};
    const labelSource = text(safe.labelSource);
    const list = Array.isArray(safe.candidates) ? safe.candidates : [];
    const rows = list.map(candidateRow);
    return {
      title: CANDIDATES_TITLE,
      caption: CANDIDATES_CAPTION,
      rows: rows,
      // The sentence to show INSTEAD of the rows when there are none. It is
      // computed here rather than at the drawing site so the choice of sentence
      // is exercised by the same tests that exercise the rows.
      emptyNote: rows.length === 0 ? emptyNote(labelSource) : '',
      // The line drawn under the rows, or under the sentence standing in for
      // them, or empty where the host sent none.
      linksNote: text(linksNote),
    };
  }

  // noSlotNote is the sentence shown in place of the slots when the answer says
  // no slot may be filled on the connection, worded from the reason it gives.
  //
  // Each says why, in the answer's own terms, and that nothing may be attached
  // here — which is the answer's claim, not this file's. A reason this file has
  // no wording for, or none at all, claims nothing beyond that: naming a cause
  // the answer did not give would be a guess.
  function noSlotNote(reason) {
    if (reason === NO_SLOT_FEATURE_CREATED) {
      return 'A Feature drew this connection, and an attachment is written only on a connection '
        + 'a component or the Release draws, so nothing may be attached here.';
    }
    if (reason === NO_SLOT_AD_HOC) {
      return 'This connection is wired through a socket the component does not declare, so no slot '
        + 'is declared for it to fill and nothing may be attached here.';
    }
    if (reason === NO_SLOT_DECLARED) {
      return 'The component declares this connection\'s socket with no slots, so nothing may be '
        + 'attached here.';
    }
    return 'Nothing may be attached here.';
  }

  // SLOT_EMPTY_NOTE is the sentence shown under a slot no Feature was listed
  // for. Like the node's empty sentence it states the narrower thing the answer
  // supports — that no Feature matched both — and never that nothing can fill
  // the slot.
  const SLOT_EMPTY_NOTE =
    'No Feature whose declared applicability the labels on the consuming component satisfy '
    + 'carries labels this slot\'s selector matches.';

  // NOT_DECLARED stands for a selector or an inject list the slot declares none
  // of: an empty value in the answer is the slot declaring nothing, and saying so
  // keeps it from reading as a fact nothing filled in.
  const NOT_DECLARED = 'none declared';

  function yesNo(v) {
    return v === true ? 'yes' : 'no';
  }

  // slotRow reduces one slot of the answer to what the panel draws: its name and
  // what it says it is for, the facts the answer gives about it, and the
  // Features that may fill it, each as the node's palette draws a candidate.
  function slotRow(slot) {
    const safe = isPlainObject(slot) ? slot : {};
    const selector = text(safe.selector);
    const inject = Array.isArray(safe.inject)
      ? safe.inject.filter(function (m) { return typeof m === 'string'; })
      : [];
    const fills = Array.isArray(safe.candidates) ? safe.candidates.map(candidateRow) : [];
    return {
      name: text(safe.slot),
      description: text(safe.description),
      facts: [
        { key: 'required', value: yesNo(safe.required) },
        { key: 'sensitive', value: yesNo(safe.sensitive) },
        { key: 'inject', value: inject.length > 0 ? inject.join(', ') : NOT_DECLARED },
        { key: 'selector', value: selector || NOT_DECLARED },
      ],
      rows: fills,
      emptyNote: fills.length === 0 ? SLOT_EMPTY_NOTE : '',
    };
  }

  // projectSlots turns the answer about one connection into what the panel
  // draws: each slot in the order the answer names them, or the sentence for the
  // reason none may be filled.
  //
  // An answer naming no slot in a shape this file reads is drawn as one naming
  // none, with the sentence for the reason it gives; nothing is offered out of a
  // payload it could not read. The line naming the links leading out of the
  // workspace is carried only beside slots, since it explains why a Feature is
  // not offered and with no slot nothing is offered at all.
  function projectSlots(result, linksNote) {
    const safe = isPlainObject(result) ? result : {};
    const list = Array.isArray(safe.slots) ? safe.slots : [];
    const slots = list.map(slotRow);
    return {
      title: CANDIDATES_TITLE,
      caption: SLOTS_CAPTION,
      slots: slots,
      noSlotNote: slots.length === 0 ? noSlotNote(text(safe.noSlotReason)) : '',
      linksNote: slots.length > 0 ? text(linksNote) : '',
    };
  }

  root.AggregaCandidates = {
    projectCandidates: projectCandidates,
    projectSlots: projectSlots,
    noSlotNote: noSlotNote,
    emptyNote: emptyNote,
    failureNote: failureNote,
    SLOTS_CAPTION: SLOTS_CAPTION,
    SLOTS_ACTION_CAPTION: SLOTS_ACTION_CAPTION,
    SLOTS_ENTRY_ACTION_CAPTION: SLOTS_ENTRY_ACTION_CAPTION,
    SLOTS_PENDING_NOTE: SLOTS_PENDING_NOTE,
    SLOT_EMPTY_NOTE: SLOT_EMPTY_NOTE,
    CANDIDATES_TITLE: CANDIDATES_TITLE,
    CANDIDATES_CAPTION: CANDIDATES_CAPTION,
    PENDING_NOTE: PENDING_NOTE,
    ATTACH_ACTION: ATTACH_ACTION,
    ATTACH_ACTION_CAPTION: ATTACH_ACTION_CAPTION,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
