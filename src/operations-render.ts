// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import {
  OPERATION_GROUPS,
  OperationDef,
  OperationGroup,
  OperationGroupId,
  OperationId,
  OperationsLayout,
  commandIdFor,
  controlHint,
  operationHint,
} from './operation-groups';
import {
  MenuControlId,
  MenuDial,
  MenuOption,
  OperationMenu,
  dialsControlId,
  menuFor,
} from './operation-menus';
import { escapeHtml } from './html';
import * as l10n from './l10n';
import {
  SelectorCreate,
  SelectorOffer,
  SelectorRow,
  createControlKey,
  offerControlKey,
} from './selector-rows';

// This module composes the Commands panel's document and holds no editor
// type, so what a reader is shown is assertable without an extension host: the
// three rows arriving ahead of the operations, one continuous flow of buttons
// in the button shape, the same groups in the same order in the section shape,
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
//
// AN OPERATION THAT CAN BE ADJUSTED BEFORE IT RUNS GETS A SECOND CONTROL BESIDE
// ITS OWN, and never a menu on its own button. A control carrying a menu answers
// a press by opening it instead of running, so adjustments hung off the button
// would take the button's press away — and the whole design is that pressing
// Build gets a build with the current settings, with no dialog and no choice in
// the way. The caret is therefore a control of its own, drawn immediately after
// the button in both shapes and in the roving walk, carrying no command because
// nothing it does reaches the compiler — and drawn together with the button in
// one unit, so the flow's wrapping moves the two as one.

// PANEL_TITLE is the document's title. The view's own name comes from the
// manifest; this is what a reader's assistive technology announces for the
// document inside it.
const PANEL_TITLE = l10n.t('Aggrega commands');

// selectorCreateHtml draws the control that makes a new value for one level,
// BESIDE that level's own choosing control.
//
// 🔴 IT IS A SECOND CONTROL RATHER THAN A MARK INSIDE THE FIRST, AND THAT IS
// FORCED RATHER THAN CHOSEN. A press anywhere on the choosing control chooses,
// so a create affordance drawn inside it would sit inside that press target and
// run the wrong thing — and a control that silently does something other than
// what a reader aimed at is worse than no control, because nothing tells them
// they missed.
//
// The name says which level it creates, because the control draws no word of
// its own: a reader meeting it by keyboard is told only what it is called, and
// the same bare "create" on two rows would announce nothing that distinguishes
// them. The name is written where the rows are written and is not composed
// here.
function selectorCreateHtml(row: SelectorRow, create: SelectorCreate): string {
  return `<button class="selector-create" type="button" data-command="${escapeHtml(create.command)}" data-focus-key="${escapeHtml(createControlKey(row.key))}" aria-label="${escapeHtml(create.label)}" title="${escapeHtml(create.label)}">
    <span class="codicon codicon-add" aria-hidden="true"></span>
  </button>`;
}

// selectorOfferHtml draws the control that acts on the value a row is already
// naming, BESIDE the other two and never inside either.
//
// It carries the create control's reason — a press anywhere on the choosing
// control chooses — and one of its own: what it does reaches past this panel,
// which makes a press landing on it by accident the most expensive miss on this
// surface.
//
// The name is written where the rows are written and is not composed here, and
// it is the control's whole accessible name, so what pressing costs the reader
// is in that name or nowhere.
function selectorOfferHtml(row: SelectorRow, offer: SelectorOffer): string {
  return `<button class="selector-offer" type="button" data-command="${escapeHtml(offer.command)}" data-focus-key="${escapeHtml(offerControlKey(row.key))}" aria-label="${escapeHtml(offer.label)}" title="${escapeHtml(offer.label)}">
    <span class="codicon codicon-folder-opened" aria-hidden="true"></span>
  </button>`;
}

// selectorHtml draws one of the three rows naming what the panel acts on. The
// key is already the row's, and it is reused as the choosing control's focus
// key so the reader's place survives a re-composition.
//
// THE ROW IS ONE LINE: the concept, then the current answer. Everything else
// the row's own text carries — the anchored folder's full path, the open folder
// where the two differ, whether there is more than one to choose between, what
// pressing it does — reaches the reader on the hover and is drawn nowhere. The
// row exists so a reader knows WHAT the buttons would act on, and the identity
// answers that; the path answers "which one exactly", which is a second
// question and is asked for on demand.
//
// The whole text goes onto the hover unfiltered. Which of its lines matter is
// not decided here: the module that writes them owns that, and a filter here
// would be a second editorial judgement over one text.
//
// The label drawn is the row's own, which for the Aggrega workspace row is the
// shortened form so the value has room; the hover opens with the level's whole
// name. The control's name is its drawn text and nothing written over it, so
// the words a reader sees on the row are the words it is announced by, and the
// hover, with the whole name, is its description.
//
// THE ROW IS A CONTAINER RATHER THAN A SINGLE BUTTON, because a level that can
// be created carries two press targets and buttons do not nest.
//
// 🔴 EVERY ROW HAS THE SAME THREE COLUMNS WHATEVER IT CAN DO. The columns are
// the three rows' one grid, laid out by the panel's stylesheet, so a row's
// choosing control spans the same columns as its neighbours' whatever the row
// carries, and its label stands in the column every label shares; a row that
// does not fill one of the two columns beside the choosing control stands a gap
// there that is not a control. The rows are read down the panel as three
// answers to one question, so a value that does not start and end where its
// neighbours' do is the arrangement failing at the one job it has.
//
// 🔴 THE THIRD COLUMN IS RESERVED FOR A SECOND REASON THE OTHER TWO DO NOT
// NEED, and it is the stronger one: what fills it comes and goes with the
// window rather than with the level. A column standing only while it is filled
// would move one row's value sideways as the reader opened a different folder —
// under their pointer, on the surface they are reading to find out where they
// are.
//
// A gap carries no command, no focus key and no name: it is out of the press
// order, out of the tab order and out of the accessibility tree, so it adds
// nothing a reader can press, reach or hear.
function selectorHtml(row: SelectorRow): string {
  const beside = row.create === null
    ? '<span class="selector-create-gap" aria-hidden="true"></span>'
    : selectorCreateHtml(row, row.create);
  // The offer comes last, so the control a reader has already learned the place
  // of keeps that place. A column inserted ahead of the create control would
  // move it, and a press aimed at where it used to be would create nothing and
  // reload the window.
  const acting = row.offer === null
    ? '<span class="selector-offer-gap" aria-hidden="true"></span>'
    : selectorOfferHtml(row, row.offer);
  // 🔴 THE MARK IS AN ELEMENT OF ITS OWN AND NEVER A CHARACTER IN THE VALUE, and
  // it sits AFTER the value rather than before it. A pictograph written into the
  // value string would be drawn where the value is drawn and read as the first
  // character of the folder's name — teaching something false about the one
  // piece of text on this surface a reader consults to find out where they are.
  // Placed before the value it would push the value out of line with the rows
  // above and below as it came and went; placed after it, the value keeps its
  // place and the mark sits at the row's own edge.
  //
  // It draws no text of its own, so what a reader meeting it by keyboard is told
  // is its name — which is why the name is a whole sentence rather than a word
  // for the shape of the glyph.
  const marked = row.warning === null
    ? ''
    : `\n    <span class="codicon codicon-warning selector-warning" role="img" `
      + `aria-label="${escapeHtml(row.warning)}"></span>`;
  return `<div class="selector-row">
  <button class="selector" type="button" data-command="${escapeHtml(row.command)}" data-focus-key="${escapeHtml(row.key)}" title="${escapeHtml(row.tooltip)}">
    <span class="codicon codicon-${escapeHtml(row.icon)}" aria-hidden="true"></span>
    <span class="selector-label">${escapeHtml(row.label)}</span>
    <span class="selector-value">${escapeHtml(row.value)}</span>${marked}
  </button>
  ${beside}
  ${acting}
</div>`;
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
  const hint = operationHint(op, reason);
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
// control rather than recorded, so the control's reference and the menu's own
// identifier cannot disagree.
function menuId(id: MenuControlId): string {
  return `menu-${id}`;
}

// dialsCaretHtml draws the control that opens one operation's adjustments,
// BESIDE that operation's own button.
//
// 🔴 IT IS A SECOND CONTROL RATHER THAN A MENU ON THE FIRST, AND THAT IS FORCED
// RATHER THAN CHOSEN. A control carrying a menu answers a press by opening it
// instead of running, so hanging the adjustments off the operation's own button
// would stop that operation running at all — and the whole design is that a
// reader presses Build and gets a build, with nothing in the way. Splitting the
// two gives the button back its press and puts the adjustments where a reader
// can see them without learning that they exist.
//
// It carries NO command. Nothing it does reaches the compiler: it opens and
// closes a region of this document, so a command on it would be a second route
// to an operation it does not run. It carries no group either — it is an adjunct
// of one control rather than a member of the operation surface, and stating a
// group on it would put a non-operation into the surface's own membership.
//
// It takes a place in the roving walk, so a reader who cannot use a pointer
// reaches the adjustments with the same arrow keys they reach every other
// control with, rather than by a gesture of its own.
//
// 🔴 WHERE ITS BUTTON CANNOT RUN, THE CARET IS DRAWN IN PLACE AND DISABLED,
// CARRYING THE BUTTON'S REASON, on exactly the terms every other control here
// is: in a wrapping flow a control that comes and goes with the state moves
// every control after it under the reader's pointer, and a disabled one keeps
// the geometry and can say why. Disabled, it claims no menu and names no region,
// because the adjustments are not composed for a button that cannot run, so it
// opens nothing; it holds no place in the walk, which focusKeys decides from the
// same rule; and its hover and its description carry the button's reason, the
// way the button's own do.
//
// IN THE SECTION SHAPE IT DRAWS ITS NAME, ahead of its glyph. There it is a
// full-width row of its own beneath its button, and a chevron alone on a row is
// what an open section's heading draws, so a nameless one reads as a section to
// open rather than as the button's options. In the flow it sits on its button's
// line, where the glyph alone already reads as part of the button, and the width
// a word would spend is the width that shape exists to save.
function dialsCaretHtml(op: OperationDef, layout: OperationsLayout, reason: string | null, focused: boolean): string {
  const control = dialsControlId(op.id);
  // The name says which button's options these are, because in the flow the
  // caret draws no word of its own and a reader meeting it by keyboard is told
  // only what it is called. It is the same whatever is ticked: nothing on the
  // caret counts what is on, and each option's own box is where its state is
  // read.
  if (!isAdjustable(op.id)) {
    throw new Error(`${op.id} offers adjustments, and the control opening them has no name`);
  }
  const label = caretName(op.id);
  const reasonId = `why-${control}`;
  const disabled = reason === null ? '' : ` disabled aria-describedby="${reasonId}"`;
  const opens = reason === null
    ? ` aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId(control)}"`
    : '';
  const named = layout === 'sections'
    ? `\n      <span class="op-caret-label">${escapeHtml(label)}</span>`
    : '';
  const note = reason === null
    ? ''
    : `<span class="op-reason" id="${reasonId}">${escapeHtml(reason)}</span>`;
  return `<button class="op-caret" type="button"${disabled} tabindex="${focused ? '0' : '-1'}" data-dials="${escapeHtml(op.id)}" data-focus-key="${escapeHtml(control)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(controlHint(label, reason))}"${opens}>${named}
      <span class="codicon codicon-chevron-down" aria-hidden="true"></span>${note}
    </button>`;
}

// ADJUSTABLE_OPERATIONS is every operation drawn with a control for its
// adjustments beside its button. It is closed so the control's name below is
// written for each: an operation added here without its name does not compile,
// and a caret drawn for one missing here refuses to draw rather than borrow a
// name from anywhere else.
const ADJUSTABLE_OPERATIONS = ['build'] as const;
type AdjustableOperation = typeof ADJUSTABLE_OPERATIONS[number];

function isAdjustable(id: OperationId): id is AdjustableOperation {
  return (ADJUSTABLE_OPERATIONS as readonly OperationId[]).includes(id);
}

// caretName is the name of the control opening one operation's adjustments.
//
// The button's label is a noun inside that name rather than a label standing on
// its own, so a translation has to give it the form the name needs: each name is
// a whole message of its own, spelling the label OPERATION_GROUPS gives the
// button.
function caretName(id: AdjustableOperation): string {
  switch (id) {
    case 'build':
      return l10n.t('Build options');
  }
}

// dialsFor reports the adjustments an operation offers, or null where it offers
// none. Read through the one menu description, so a control cannot come to draw
// a caret for adjustments that description does not hold.
function dialsFor(id: OperationId): MenuDial[] | null {
  const menu = menuFor(dialsControlId(id));
  return menu !== null && menu.kind === 'dials' ? menu.dials : null;
}

// dialsDrawnFor reports the caret an operation is drawn with, or the empty
// string where it offers no adjustments.
//
// It is drawn whether or not the operation can run, disabled and carrying the
// operation's own reason where it cannot. What is withheld from a control that
// cannot run is the adjustments themselves, on exactly the terms a menu is: a
// disabled button cannot be pressed, so adjustments to it would be settings for
// a press the reader cannot make, and menusHtml composes none for it.
function dialsDrawnFor(
  op: OperationDef,
  body: OperationsBody,
  rovingKey: string | null,
): string {
  const dials = dialsFor(op.id);
  if (dials === null) { return ''; }
  const control = dialsControlId(op.id);
  return dialsCaretHtml(op, body.layout, body.unavailable[op.id] ?? null, control === rovingKey);
}

// operationEntryHtml draws one operation as a reader meets it: its button and,
// where the next press can be adjusted, the caret beside it — the two drawn as
// ONE unit. Both shapes draw every entry through here, so which controls are
// held together is decided once.
//
// 🔴 THE UNIT IS AN ELEMENT OF ITS OWN BECAUSE ADJACENCY DOES NOT KEEP TWO
// CONTROLS ON ONE LINE. The flow is a wrapping row, and a wrapping row may end a
// line between ANY two of its items, so a button and a caret drawn as two items
// side by side are parted by the wrapping at some width: the button ends one
// line and its caret starts the next, where it reads as belonging to whatever
// sits beside it. No rule written on either control prevents that — only a
// single item is never broken across lines — so the pair is made one item, and
// the stylesheet keeps its two controls on one line inside it.
//
// The unit is drawn ONLY where a caret is, and a caret is wherever an operation
// offers adjustments, whether or not it can run: an operation that cannot run
// keeps its unit, its caret disabled beside its disabled button, so the flow
// wraps the same way in both states and nothing after it moves as the state
// changes. An operation that offers no adjustments is its button alone, exactly
// as every other entry is. The unit carries no role, no name and no focus key,
// so it adds nothing a reader is told about or can stop on: the walk, the names
// and the presses remain the two controls' own.
function operationEntryHtml(
  op: OperationDef,
  group: OperationGroupId,
  body: OperationsBody,
  rovingKey: string | null,
): string {
  const button = operationHtml(
    op,
    group,
    body.unavailable[op.id] ?? null,
    commandIdFor(op) === rovingKey,
  );
  const caret = dialsDrawnFor(op, body, rovingKey);
  if (caret === '') { return button; }
  return `<span class="op-pair">${button}
    ${caret}
    </span>`;
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
  // The two are joined as the panel's script joins a fetched option's label and
  // detail, so a choice's hint reads alike whichever kind of menu drew it.
  const hint = option.detail === '' ? option.label : `${option.label} — ${option.detail}`;
  return `<button class="op-menu-option" type="button" role="menuitem" tabindex="-1" data-option="${escapeHtml(option.value)}" title="${escapeHtml(hint)}">
      <span class="op-menu-label">${escapeHtml(option.label)}</span>${detail}
    </button>`;
}

// menuDialHtml draws one setting.
//
// 🔴 IT CARRIES NO `data-option`, AND THE ABSENCE IS LOAD-BEARING RATHER THAN
// incidental. A press on a choice closes the menu and runs the operation; a
// press on a setting must do neither — the menu stays open so a reader can turn
// a second one, and nothing runs until they press the button beside it. The two
// therefore carry different attributes, so the panel's script tells them apart
// by reading the document rather than by remembering which menu it is in.
//
// It is announced as a setting with a state rather than as a choice, so a reader
// who cannot see the mark is told whether it is on — which for a choice is not a
// question that exists.
//
// 🔴 WHAT THE SETTING DOES IS CARRIED ON THE HINT AND DRAWN NOWHERE. A row states
// its effect once: written beside the label as well, the same sentence reaches a
// reader twice at once — under the label and in the hint the pointer raises over
// it — and the row is held open for a line that is a copy of one already there.
// The row is therefore the mark and the label, and the sentence is one hover away.
function menuDialHtml(dial: MenuDial, on: boolean): string {
  const hint = `${dial.label} — ${dial.detail}`;
  return `<button class="op-menu-dial" type="button" role="menuitemcheckbox" aria-checked="${on}" tabindex="-1" data-dial="${escapeHtml(dial.value)}" title="${escapeHtml(hint)}">
      <span class="codicon codicon-${on ? 'check' : 'blank'}" aria-hidden="true"></span>
      <span class="op-menu-dial-text">
        <span class="op-menu-label">${escapeHtml(dial.label)}</span>
      </span>
    </button>`;
}

// dialsMenuHtml draws one control's adjustments, closed.
//
// It carries NO command, unlike every other menu here, and that is the same
// property the caret has: nothing in it runs anything. A command on the menu is
// what makes a choice reach an operation, so a menu whose entries are settings
// must not name one — the settings reach the compiler on the next press of the
// button beside it, as parameters of that one request.
//
// It carries no status line either. A status line says what a menu is waiting
// for or how far a reader's typing has narrowed it; this menu waits for nothing
// and holds a set small enough to read whole.
//
// Nor does it draw its name at its head, as a menu of choices does. It opens
// from the caret beside the one button it adjusts, a control already named for
// that button, and it is as wide as its settings' own words and no wider — so a
// name drawn above them would either widen it past those words or be cut short.
function dialsMenuHtml(id: MenuControlId, menu: Extract<OperationMenu, { kind: 'dials' }>, on: string[]): string {
  const entries = menu.dials
    .map((dial) => menuDialHtml(dial, on.includes(dial.value)))
    .join('\n    ');
  return `<div class="op-menu op-menu-dials" id="${menuId(id)}" role="menu" aria-label="${escapeHtml(menu.label)}" hidden data-menu="${escapeHtml(id)}" data-menu-dials>
    ${entries}
  </div>`;
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
//
// A MENU OF CHOICES DRAWS ITS NAME AT ITS HEAD, as text a reader sees, wherever
// the menu stands — beneath its control or above it, in a panel docked in the
// side bar or anywhere else — because a menu open beside a row of buttons does
// not otherwise say which button it answers or what it is choosing. The name is
// the same words the menu is announced by, so the drawn line is kept out of the
// accessibility tree: a reader using assistive technology hears the name once,
// on entering the menu, rather than again as the menu's first line.
//
// The parameter admits the two kinds whose entries are CHOICES and refuses the
// kind whose entries are settings, so a settings menu drawn through here is a
// compile error rather than a menu that would carry a command and run something
// when a reader adjusted it.
function menuHtml(
  id: OperationId,
  command: string,
  menu: Exclude<OperationMenu, { kind: 'dials' }>,
): string {
  const title = `<div class="op-menu-title" aria-hidden="true">${escapeHtml(menu.label)}</div>`;
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
    ${title}
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
//
// An operation's own menu and its adjustments are emitted from THIS ONE WALK, in
// that order, so the layer holds exactly the menus the pass over the controls
// drew a reference for — the same guarantee the operation menus already had,
// extended rather than duplicated.
function menusHtml(body: OperationsBody): string {
  const pieces: string[] = [];
  for (const group of OPERATION_GROUPS) {
    for (const op of group.operations) {
      if ((body.unavailable[op.id] ?? null) !== null) { continue; }
      const menu = menuFor(op.id);
      // The kind whose entries are settings is never registered against an
      // operation's own id — a control in that map opens its menu instead of
      // running — so meeting one here would mean the Build button had stopped
      // building, and it is skipped rather than drawn.
      if (menu !== null && menu.kind !== 'dials') {
        pieces.push(menuHtml(op.id, commandIdFor(op), menu));
      }
      const dials = menuFor(dialsControlId(op.id));
      if (dials !== null && dials.kind === 'dials') {
        pieces.push(dialsMenuHtml(dialsControlId(op.id), dials, body.dials));
      }
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

// OperationsBody is what the panel is drawn from: the shape, the three rows,
// which entries cannot run and why, which groups the reader has closed, and
// where their focus was.
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
  // dials names the adjustments the reader has turned ON.
  //
  // On rather than off is the recorded state, for the same reason closed rather
  // than open is above and with the same consequence: an empty list is the
  // default shape, so a reader who has adjusted nothing and a document composed
  // before anything was recorded draw the same panel — and that default is the
  // command line's own, which is what keeps the two surfaces performing one
  // operation.
  dials: string[];
  // focused is the control the reader was on, by its focus key, or null. The
  // roving tab stop is composed onto it, so a re-composition and a window
  // reload both return the reader to where they were rather than to the start.
  focused: string | null;
}

// FLOW_LABEL names the flow for a reader who arrives at it without seeing it.
// It is the panel's own name, which is the word that container already puts in
// front of them.
const FLOW_LABEL = l10n.t('Commands');

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
      // One piece per operation, and a caret is inside its button's piece rather
      // than a piece of its own: the entry is one item of the flow, so the
      // wrapping moves a button and the adjustments to it together.
      pieces.push(operationEntryHtml(op, group.id, body, rovingKey));
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
    .map((op) => operationEntryHtml(op, group.id, body, rovingKey))
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
      // The caret follows its own button in the walk, so the arrow keys reach
      // the adjustments to a control immediately after the control itself —
      // which is where a reader looking for them would try next. It is placed
      // from the same walk that draws it, so the stop cannot land on a caret the
      // document does not carry.
      if (dialsFor(op.id) !== null) { keys.push(dialsControlId(op.id)); }
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

// operationsBodyHtml composes the panel's body: the three rows naming what the
// editor is acting on, then the operations in one of the two shapes.
//
// The rows are the document's first elements — siblings that precede every
// operation — so "above the operations and never inside a group" is a property
// of the document's shape. A reader who has closed every section still has all
// three facts in front of them, because none is inside a section to be closed.
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
  // language is the editor's display language, which the document declares so
  // assistive technology reads the panel's words in the language they are
  // written in. Absent, the document declares English, the language of every
  // message the lookup answers where there is no translation.
  language?: string;
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
<html lang="${escapeHtml(opts.language ?? 'en')}">
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
