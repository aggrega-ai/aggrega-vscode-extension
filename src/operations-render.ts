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
import { MenuOption, OperationMenu, menuFor } from './operation-menus';
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
//
// A CONTROL THAT OFFERS A CHOICE PRESENTS IT BESIDE ITSELF, and the menus are
// composed into a LAYER OF THEIR OWN after the operations rather than among
// them. Two reasons, and the first is the binding one. The flow is one
// continuous sequence with nothing drawn between one button and the next, and
// that absence is asserted as a RESIDUE — whatever the flow holds that is not
// one of its buttons — so a menu sitting among them would be exactly the
// something the flow must not draw. Second, a closed menu drawn inside a
// wrapping flow would still be a flow item, and the browser's own wrapping is
// what decides the panel's height. Each menu names the command it belongs to
// and each control points at its menu, so the pairing is stated in the document
// rather than inferred from where the markup sits.

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
  // A control that opens a menu SAYS SO, and says whether the menu is open.
  //
  // Both are composed rather than left to the script. The state has to be
  // present and false while the menu is closed, because a control announced as
  // having a menu and nothing said about its state reads as neither open nor
  // closed — and the closed state is the one a reader meets first, every time.
  //
  // It is offered only where the control can run: a disabled control cannot be
  // pressed, so a menu composed for one would be a menu nothing can open, and
  // the document would carry a choice the reader can never reach. That mirrors
  // how the roving stop is placed, and for the same reason.
  const menu = reason === null ? menuFor(op.id) : null;
  const opens = menu === null
    ? ''
    : ` aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId(op.id)}" data-menu="${escapeHtml(op.id)}"`;
  // The group each control belongs to is stated on the control itself. In the
  // flow shape there is no group box left to read it off, and which group an
  // operation sits in is a ruled property of the surface rather than a
  // consequence of how it is drawn — so the document says it in both shapes,
  // and the flow's membership stays assertable without one.
  return `<button class="op" type="button"${disabled}${described} tabindex="${tabindex}" data-command="${escapeHtml(command)}" data-focus-key="${escapeHtml(command)}" data-group="${escapeHtml(group)}" title="${escapeHtml(hint)}"${opens}>
      <span class="codicon codicon-${escapeHtml(op.icon)}" aria-hidden="true"></span>
      <span class="op-label">${escapeHtml(op.label)}</span>${note}
    </button>`;
}

// menuId names the region a control's menu occupies. It is derived from the
// operation rather than recorded, so the control's reference and the menu's own
// identifier cannot disagree.
function menuId(id: OperationId): string {
  return `menu-${id}`;
}

// menuOptionHtml draws one choice.
//
// It is a native button for the same reason every other control here is one:
// activation on Enter and on Space comes from the platform. It carries NO
// command of its own — the command is stated once, on the menu — because a
// choice is not a second route to the operation, it is the answer the operation
// was going to ask for.
//
// It holds no tab stop. A menu is reached by pressing the control that opens
// it, never by tabbing into one, so every choice is out of the tab order and
// focus is moved onto it deliberately. That is what keeps a menu from adding a
// second stop to a panel that costs exactly one.
function menuOptionHtml(option: MenuOption): string {
  const detail = option.detail === ''
    ? ''
    : `
      <span class="op-menu-detail">${escapeHtml(option.detail)}</span>`;
  const hint = option.detail === '' ? option.label : `${option.label} — ${option.detail}`;
  return `<button class="op-menu-option" type="button" role="menuitem" tabindex="-1" data-option="${escapeHtml(option.value)}" title="${escapeHtml(hint)}">
      <span class="op-menu-label">${escapeHtml(option.label)}</span>${detail}
    </button>`;
}

// menuHtml draws one control's menu, closed.
//
// It is composed hidden rather than merely unpainted, so a closed menu leaves
// the accessibility tree instead of staying in it as content a reader can reach
// but not see — the same treatment a closed section gets, for the same reason.
//
// EVERY MENU CARRIES ONE STATUS LINE, and what it says at rest is the whole
// difference between the two kinds. A fetched menu opens saying it is reading,
// with no options at all beneath it; a fixed menu opens with its options and the
// line hidden, because there is nothing to wait for. 🔴 The alternative for the
// fetched kind — composing an empty menu and filling it in — is the one shape
// that must not ship: an empty list of choices reads as "there is nothing", and
// a reader acts on that reading while the answer is still on its way.
//
// The line is a choice announced as unavailable rather than a bare piece of
// text, so a reader who has just entered the menu is told about it as part of
// the menu; and it is a live region, so what replaces it is announced rather
// than silently swapped in. It is hidden when it has nothing to say, because a
// choice announced with no text is worse than no choice at all.
function menuHtml(id: OperationId, command: string, menu: OperationMenu): string {
  const waiting = menu.kind === 'fetched' ? menu.pending : '';
  const status = `<div class="op-menu-status" role="menuitem" aria-disabled="true" aria-live="polite" data-menu-status${waiting === '' ? ' hidden' : ''}>${escapeHtml(waiting)}</div>`;
  const options = menu.kind === 'fixed'
    ? `\n    ${menu.options.map(menuOptionHtml).join('\n    ')}`
    : '';
  // The waiting line is carried as a value as well as as text, because the text
  // is replaced by the answer and a menu re-opened has to say it is reading
  // again. Composing it once here is what keeps the panel's script from holding
  // a wording of its own — the sentence a reader sees has one home, and it is
  // not that file.
  const fetched = menu.kind === 'fetched'
    ? ` data-menu-fetched data-menu-pending="${escapeHtml(menu.pending)}"`
    : '';
  return `<div class="op-menu" id="${menuId(id)}" role="menu" aria-label="${escapeHtml(menu.label)}" hidden data-menu="${escapeHtml(id)}" data-menu-command="${escapeHtml(command)}"${fetched}>
    ${status}${options}
  </div>`;
}

// menusHtml draws the layer holding every menu the document offers.
//
// The walk is the same one that draws the controls, and it skips an entry that
// cannot run for the same reason that entry carries no menu reference: a menu
// nothing can open is a choice the reader cannot reach. So the layer's contents
// and the controls that point into it are composed from one pass and cannot
// disagree — a control cannot reference a menu the layer does not hold, and the
// layer cannot hold one no control opens.
//
// The layer is drawn in both shapes. Which shape the panel is in decides how a
// group is drawn and never what a control does when pressed.
function menusHtml(body: OperationsBody): string {
  const pieces: string[] = [];
  for (const group of OPERATION_GROUPS) {
    for (const op of group.operations) {
      if ((body.unavailable[op.id] ?? null) !== null) { continue; }
      const menu = menuFor(op.id);
      if (menu === null) { continue; }
      pieces.push(menuHtml(op.id, commandIdFor(op), menu));
    }
  }
  if (pieces.length === 0) { return ''; }
  return `
<div class="op-menus">
  ${pieces.join('\n  ')}
</div>`;
}

// groupClasses carries the divider ahead of a group whose operations differ in
// kind, as a rule with a margin rather than as a row of characters standing in
// for one. Only the section shape has a group box to draw it on: the flow draws
// nothing between one group and the next, so it draws nothing from this either.
function groupClasses(group: OperationGroup): string {
  return group.separated ? 'group group-separated' : 'group';
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
// that wraps over as many lines as the panel's width needs, with NO GROUP
// TITLES AT ALL and NOTHING DRAWN BETWEEN ONE GROUP AND THE NEXT.
//
// The buttons are siblings in one wrapping container rather than one row per
// group, and that is the whole shape: a group's buttons cannot claim a line of
// their own, so a line that has room for the next group's first button gets it.
// A row per group would spend a line on every group whether it needed one or
// not, and a title line on top of that.
//
// The GROUPS still decide the order the buttons come in, and nothing here
// draws them. Compactness is what this shape is for, and a divider between
// every adjacent pair spends room on a distinction a reader of a flow of named
// buttons does not need — so the order carries the grouping and the drawing
// carries none of it. Which group a control belongs to is still stated on the
// control, where it stays readable without being drawn.
//
// It is ONE toolbar with ONE tab stop: Tab reaches the flow once and the arrow
// keys walk every operation in it, which is the contract a reader already has
// from every tree in this container. A row per group would instead cost one
// stop each.
function buttonsFlowHtml(
  body: OperationsBody,
  rovingKey: string | null,
): string {
  const pieces: string[] = [];
  for (const group of OPERATION_GROUPS) {
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
</div>${menusHtml(body)}`;
  }

  // One roving stop for the whole flow, because the flow is one sequence: Tab
  // reaches it once and the arrow keys walk every operation in it.
  return `<div class="selectors">
  ${selectors}
</div>
${buttonsFlowHtml(body, rovingKeyFor(body, reachable))}${menusHtml(body)}`;
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
