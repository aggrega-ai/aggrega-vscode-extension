// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  OPERATION_GROUPS,
  OperationDef,
  OperationGroup,
  OperationGroupId,
  OperationId,
  OperationsLayout,
  commandIdFor,
} from './operation-groups';
import { escapeHtml } from './html';
import { SelectorRow } from './selector-rows';

// This module composes the Commands panel's document and holds no editor
// type, so what a reader is shown is assertable without an extension host: the
// two rows arriving ahead of the operations, one continuous flow of buttons in
// the button shape, the same groups in the same order in the section shape,
// every control naming the command it runs and the group it belongs to, and an
// unavailable control carrying the reason it cannot run.
//
// THE PANEL'S BODY IS COMPOSED HERE AND NOWHERE ELSE, including on refresh. The
// alternative — posting the facts and letting the panel's script build the same
// markup a second time — would put one layout in two languages, and the copy is
// what drifts. The script this composes for swaps in a fragment, forwards a
// press, moves the roving tab stop and remembers the reader's place.
//
// EVERY CONTROL IS A NATIVE BUTTON. Activation on Enter and on Space, the
// unavailable state, and the accessible name then all come from the platform
// rather than from anything written here — which is the half of this panel's
// accessibility that cannot regress.

// PANEL_TITLE is the document's title. The view's own name comes from the
// manifest; this is what a reader's assistive technology announces for the
// document inside it.
const PANEL_TITLE = 'Aggrega commands';

// selectorHtml draws one of the two rows naming what the panel acts on. The key
// is already the row's, and it is reused as the control's focus key so the
// reader's place survives a re-composition.
//
// THE ROW IS ONE LINE: the concept, then the current answer. Everything else
// the row's own text carries — the anchored folder's full path, the open folder
// where the two differ, what pressing it does — reaches the reader on the
// hover and is drawn nowhere. The row exists so a reader knows WHAT the buttons
// would act on, and the identity answers that; the path answers "which one
// exactly", which is a second question and is asked for on demand.
//
// The whole text goes onto the hover unfiltered. Which of its lines matter is
// not decided here: the module that writes them owns that, and a filter here
// would be a second editorial judgement over one text.
function selectorHtml(row: SelectorRow): string {
  return `<button class="selector" type="button" data-command="${escapeHtml(row.command)}" data-focus-key="${escapeHtml(row.key)}" title="${escapeHtml(row.tooltip)}">
  <span class="codicon codicon-${escapeHtml(row.icon)}" aria-hidden="true"></span>
  <span class="selector-label">${escapeHtml(row.label)}</span>
  <span class="selector-value">${escapeHtml(row.value)}</span>
</button>`;
}

// operationHtml draws one entry.
//
// An entry whose invocation cannot succeed is drawn in place and disabled,
// carrying the reason, rather than removed. In a horizontal row removing one
// moves the others under the reader's pointer as the state changes, so a press
// lands on something other than what was there a moment ago; a disabled control
// keeps the row's geometry fixed, and it can say why, which an absent one
// cannot. The reason is announced through a description rather than drawn into
// the label, because a label that grows a sentence is a row that reflows.
function operationHtml(
  op: OperationDef,
  group: OperationGroupId,
  reason: string | null,
  focused: boolean,
): string {
  const command = commandIdFor(op);
  const reasonId = `why-${op.id}`;
  const described = reason === null ? '' : ` aria-describedby="${reasonId}"`;
  const disabled = reason === null ? '' : ' disabled';
  // Whether this control can hold the roving stop is decided by focusKeys, which
  // leaves out every entry that cannot run — a disabled control cannot take
  // focus, so a stop placed on one would be a stop the reader can never reach.
  // Re-checking it here as well was tried and removed: two statements of one rule
  // meant that disabling the first left the second still enforcing it, so a
  // planted defect in the real guard passed unnoticed. One home, and an assertion
  // over the composed document rather than a second guard.
  const tabindex = focused ? '0' : '-1';
  const hint = reason === null ? op.detail : `${op.detail} — ${reason}`;
  const note = reason === null
    ? ''
    : `<span class="op-reason" id="${reasonId}">${escapeHtml(reason)}</span>`;
  // The group each control belongs to is stated on the control itself. In the
  // flow shape there is no group box left to read it off, and which group an
  // operation sits in is a ruled property of the surface rather than a
  // consequence of how it is drawn — so the document says it in both shapes,
  // and the flow's membership stays assertable without one.
  return `<button class="op" type="button"${disabled}${described} tabindex="${tabindex}" data-command="${escapeHtml(command)}" data-focus-key="${escapeHtml(command)}" data-group="${escapeHtml(group)}" title="${escapeHtml(hint)}">
      <span class="codicon codicon-${escapeHtml(op.icon)}" aria-hidden="true"></span>
      <span class="op-label">${escapeHtml(op.label)}</span>${note}
    </button>`;
}

// groupClasses carries the divider ahead of a group whose operations differ in
// kind, as a rule with a margin rather than as a row of characters standing in
// for one. Only the section shape has a group box to draw it on; the flow shape
// marks every boundary instead, and draws nothing from this.
function groupClasses(group: OperationGroup): string {
  return group.separated ? 'group group-separated' : 'group';
}

// boundaryHtml draws the mark between the last control of one group and the
// first control of the next, named after the group it opens.
//
// IT CARRIES NO VERDICT ABOUT WHETHER IT IS DRAWN, and it cannot: whether a
// boundary falls in the middle of a line or at the edge of one is decided by
// where the flow wraps, and nothing here knows the panel's width. The document
// therefore emits one mark per boundary, unconditionally, and the panel's own
// script suppresses the ones that land at a line edge once the browser has laid
// the flow out. A mark composed as suppressed, or omitted, would be a guess
// about a width this side never sees.
function boundaryHtml(opens: OperationGroupId): string {
  return `<span class="flow-bar" role="separator" aria-orientation="vertical" data-boundary="${escapeHtml(opens)}"></span>`;
}

// OperationsBody is what the panel is drawn from: the shape, the two rows, which
// entries cannot run and why, which groups the reader has closed, and where
// their focus was.
export interface OperationsBody {
  layout: OperationsLayout;
  selectors: SelectorRow[];
  // unavailable maps an operation to the reason it cannot run. An operation
  // absent from the map, or mapped to null, is drawn as available.
  unavailable: Partial<Record<OperationId, string | null>>;
  // collapsed names the groups the reader has closed, in the section shape.
  // Closed rather than open is the recorded state so that an empty list is the
  // default shape: a reader who has closed nothing, and a document composed
  // before any state was recorded, draw the same panel.
  collapsed: string[];
  // focused is the control the reader was on, by its focus key, or null. The
  // roving tab stop is composed onto it, so a re-composition and a window
  // reload both return the reader to where they were rather than to the start.
  focused: string | null;
}

// FLOW_LABEL names the flow for a reader who arrives at it without seeing it.
// It is the panel's own name, which is the word that container already puts in
// front of them.
const FLOW_LABEL = 'Commands';

// buttonsFlowHtml draws every operation as one continuous sequence of buttons
// that wraps over as many lines as the panel's width needs, with a mark at each
// group boundary and NO GROUP TITLES AT ALL.
//
// The buttons are siblings in one wrapping container rather than one row per
// group, and that is the whole shape: a group's buttons cannot claim a line of
// their own, so a line that has room for the next group's first button gets it.
// A row per group would spend a line on every group whether it needed one or
// not, and a title line on top of that.
//
// It is ONE toolbar with ONE tab stop: Tab reaches the flow once and the arrow
// keys walk every operation in it, which is the contract a reader already has
// from every tree in this container. A row per group would instead cost one
// stop each.
//
// A group with no operations contributes no boundary mark. Two marks side by
// side would draw a doubled bar, and a mark with no control beside it separates
// nothing.
function buttonsFlowHtml(
  body: OperationsBody,
  rovingKey: string | null,
): string {
  const pieces: string[] = [];
  for (const group of OPERATION_GROUPS) {
    if (group.operations.length === 0) { continue; }
    if (pieces.length > 0) { pieces.push(boundaryHtml(group.id)); }
    for (const op of group.operations) {
      pieces.push(operationHtml(
        op,
        group.id,
        body.unavailable[op.id] ?? null,
        commandIdFor(op) === rovingKey,
      ));
    }
  }
  return `<div class="groups ops-flow" role="toolbar" aria-label="${escapeHtml(FLOW_LABEL)}" aria-orientation="horizontal" data-flow data-roving data-orientation="horizontal">
    ${pieces.join('\n    ')}
</div>`;
}

// sectionsGroupHtml draws one group as a section the reader opens.
//
// The whole heading row is the toggle, because the whole row toggles in a tree.
// It is a button carrying its own expansion state and naming the region it
// controls, and a closed region is hidden — so it leaves the accessibility tree
// rather than staying in it as content the reader cannot see.
function sectionsGroupHtml(
  group: OperationGroup,
  body: OperationsBody,
  rovingKey: string | null,
): string {
  const open = !body.collapsed.includes(group.id);
  const toggleKey = `toggle:${group.id}`;
  const controls = group.operations
    .map((op) => operationHtml(
      op,
      group.id,
      body.unavailable[op.id] ?? null,
      commandIdFor(op) === rovingKey,
    ))
    .join('\n    ');
  return `<section class="${groupClasses(group)}" role="group" aria-labelledby="grp-${group.id}" data-group="${group.id}">
  <button class="section-head" type="button" id="grp-${group.id}" aria-expanded="${open}" aria-controls="sec-${group.id}" tabindex="${toggleKey === rovingKey ? '0' : '-1'}" data-toggle="${group.id}" data-focus-key="${toggleKey}">
    <span class="codicon codicon-${open ? 'chevron-down' : 'chevron-right'}" aria-hidden="true"></span>
    <span class="section-title">${escapeHtml(group.heading)}</span>
  </button>
  <div class="section-body" id="sec-${group.id}" role="group"${open ? '' : ' hidden'}>
    ${controls}
  </div>
</section>`;
}

// focusKeys reports every control the roving tab stop can land on, in the order
// a reader meets them. Composed from the same walk that draws them, so the stop
// cannot be placed on a control the document does not carry.
function focusKeys(body: OperationsBody): string[] {
  const keys: string[] = [];
  for (const group of OPERATION_GROUPS) {
    if (body.layout === 'sections') {
      keys.push(`toggle:${group.id}`);
      if (body.collapsed.includes(group.id)) { continue; }
    }
    for (const op of group.operations) {
      if ((body.unavailable[op.id] ?? null) !== null) { continue; }
      keys.push(commandIdFor(op));
    }
  }
  return keys;
}

// rovingKeyFor decides which control holds the tab stop.
//
// The reader's own place wins where the document still carries that control.
// Where it does not — the shape changed, a group closed, an operation became
// unavailable — the stop falls to the first control rather than being lost,
// because a container with no tab stop is a container Tab skips entirely.
function rovingKeyFor(body: OperationsBody, container: string[]): string | null {
  if (body.focused !== null && container.includes(body.focused)) { return body.focused; }
  return container[0] ?? null;
}

// operationsBodyHtml composes the panel's body: the two rows naming what the
// editor is acting on, then the operations in one of the two shapes.
//
// The rows are the document's first two elements — siblings that precede every
// operation — so "above the operations and never inside a group" is a property
// of the document's shape. A reader who has closed every section still has both
// facts in front of them, because neither is inside a section to be closed.
export function operationsBodyHtml(body: OperationsBody): string {
  const selectors = body.selectors.map(selectorHtml).join('\n  ');
  const reachable = focusKeys(body);

  if (body.layout === 'sections') {
    // One roving stop for the whole list, which is what a tree costs: the arrow
    // keys move between headings and entries, and Tab leaves the list.
    const roving = rovingKeyFor(body, reachable);
    const groups = OPERATION_GROUPS
      .map((group) => sectionsGroupHtml(group, body, roving))
      .join('\n');
    return `<div class="selectors">
  ${selectors}
</div>
<div class="groups groups-sections" data-roving data-orientation="vertical">
${groups}
</div>`;
  }

  // One roving stop for the whole flow, because the flow is one sequence: Tab
  // reaches it once and the arrow keys walk every operation in it.
  return `<div class="selectors">
  ${selectors}
</div>
${buttonsFlowHtml(body, rovingKeyFor(body, reachable))}`;
}

// OperationsDocumentOptions carries the addresses the editor resolves for this
// installation's own resources, alongside what the panel is drawn from. They are
// plain strings so this module keeps no editor type, and the caller passes what
// the webview gave it.
export interface OperationsDocumentOptions extends OperationsBody {
  nonce: string;
  styleUri: string;
  codiconUri: string;
  scriptUri: string;
  cspSource: string;
}

// operationsDocumentHtml composes the whole panel.
//
// The document is composed already in the shape the reader left it — the
// sections they closed are closed, and the control they were on holds the tab
// stop — because restoring from the panel's own script after it loads always
// paints the default first, and the frame in between is the flicker.
//
// The content policy admits this installation's own styles, its own script by
// nonce, and the icon font those styles load. The panel draws the editor's own
// icons, and the editor puts no icon font into a document it hosts, so the font
// ships beside the stylesheet and is named here — without it every icon on the
// panel is silently absent.
export function operationsDocumentHtml(opts: OperationsDocumentOptions): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource}`,
    `style-src ${opts.cspSource}`,
    `font-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${opts.codiconUri}" rel="stylesheet">
  <link href="${opts.styleUri}" rel="stylesheet">
  <title>${escapeHtml(PANEL_TITLE)}</title>
</head>
<body>
  <main id="panel" class="panel" aria-label="${escapeHtml(PANEL_TITLE)}">${operationsBodyHtml(opts)}</main>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
