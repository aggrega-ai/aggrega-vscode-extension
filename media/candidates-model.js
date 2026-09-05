// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// The document-free half of the candidate palette: the transform from the
// language server's answer about what may attach into the rows the panel draws,
// and the sentences the panel shows while it waits, when nothing matched, and
// when the request was refused. It reads no document, touches no DOM and holds
// no state between projections, so the wording and the row shape can be
// exercised on their own. media/graph.js draws whatever this produces.
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
  function emptyNote(labelSource) {
    if (labelSource === LABELS_SUPPLIED) {
      return 'No Feature\'s declared applicability matches the labels on this node.';
    }
    if (labelSource === LABELS_RESOLVED) {
      return 'No Feature\'s declared applicability matches this node\'s finalised labels.';
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
  function projectCandidates(result) {
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
    };
  }

  root.AggregaCandidates = {
    projectCandidates: projectCandidates,
    emptyNote: emptyNote,
    failureNote: failureNote,
    CANDIDATES_TITLE: CANDIDATES_TITLE,
    CANDIDATES_CAPTION: CANDIDATES_CAPTION,
    PENDING_NOTE: PENDING_NOTE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
