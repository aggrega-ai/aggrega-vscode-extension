// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { commandIdFor, commandsPanelOperations, ListPanelId } from '../../src/operation-groups';
import { OPERATION_MENUS } from '../../src/operation-menus';
import { OPERATIONS_CONFIG_SECTION, OPERATIONS_LAYOUT_KEY } from '../../src/settings';
import { Outcome } from './checks';
import { Box, WebviewDocument } from './drivers';
import { PanelBox } from './levels';
import { capture, run, SuiteContext } from './suite-context';
import { openSettingsOn, settingLabel, settingValue } from './suite-gateway';
import { centre, COMMANDS_PANEL, documentNow, pressIn, pressMenuItem, until } from './workbench';

// Reading the Commands panel as a reader meets it — the shape it is drawn in, its
// controls with their icons, borders and boxes, the menu a control has open and
// where that menu stands against the control — choosing the panel's shape on the
// settings screen, and moving the container the panel sits in to another part of
// the window, as a person does from the activity bar.

// LAYOUT_SETTING is the preference choosing the panel's shape, as the product
// names it.
export const LAYOUT_SETTING = `${OPERATIONS_CONFIG_SECTION}.${OPERATIONS_LAYOUT_KEY}`;

// ABSENCE_MS is how long these checks watch for something that must not happen,
// or must not be drawn, before taking it as absent.
export const ABSENCE_MS = 1500;

// COMMANDS_PANEL_GROUPS are the Commands panel's groups, each by its heading and
// its operations by the label each button reads, in the order a reader meets them.
// They are held as written because the order and the grouping are what a reader is
// promised, not a rule some declaration states: read from the product's own
// description, a change to that description would move the expectation with it.
// The operations acting on what a list panel lists head that panel instead, and
// are in none of these groups.
export const COMMANDS_PANEL_GROUPS: readonly { heading: string; labels: readonly string[] }[] = [
  { heading: 'Build', labels: ['Validate', 'Lint', 'Build', 'Preview', 'Graph'] },
  { heading: 'Dependencies', labels: ['Pull'] },
  { heading: 'Author', labels: ['Import', 'Inspect'] },
  { heading: 'Publish', labels: ['Push', 'Sign', 'Deprecate'] },
  { heading: 'Configuration', labels: ['Show config', 'Cache…'] },
];

// COMMANDS_PANEL_LABELS are the panel's buttons, by their labels, in the order it
// draws them.
export const COMMANDS_PANEL_LABELS: readonly string[] = COMMANDS_PANEL_GROUPS.flatMap((g) => [...g.labels]);

// LIST_PANEL_TITLES are the list panels by the product's own id for each, each by
// the title its pane is drawn with, so an operation heading one of them is paired
// with its panel by that id rather than by where it falls in a list.
export const LIST_PANEL_TITLES: Readonly<Record<ListPanelId, string>> = { registries: 'Registries', catalog: 'Catalog', plugins: 'Plugins' };

// PANEL_ORDER is the container's panels, top to bottom, held as written for the
// reason the groups are.
export const PANEL_ORDER: readonly string[] = ['Commands', LIST_PANEL_TITLES.registries, LIST_PANEL_TITLES.catalog, LIST_PANEL_TITLES.plugins];

// ACTIVE_CONTROL is what the panel's document has its focus on, by what the control
// runs or opens — an operation's command, "caret:" and its operation for a caret, a
// section heading's group — or '' where the document does not hold the keyboard or
// its focus is on none of them.
export const ACTIVE_CONTROL = `(() => {
  const e = document.activeElement;
  if (!document.hasFocus() || !e || e === document.body) { return ''; }
  return e.dataset.command || (e.dataset.dials ? 'caret:' + e.dataset.dials : '') || e.dataset.toggle || '';
})()`;

export function activeControl(doc: WebviewDocument): Promise<string> {
  return doc.evaluate<string>(ACTIVE_CONTROL);
}

// FOCUS_LOG is installed in the panel's document before an action whose effect
// on the focus is to be read, and records where its focus stands at each focus
// change, each window focus and blur, and just after each drawing the extension
// posts — read back from window.__focusLog by focusLog.
export const FOCUS_LOG = `(() => {
  const log = [];
  const on = () => { const e = document.activeElement; return (e ? (e.dataset.command || e.dataset.focusKey || e.tagName) : 'none') + (document.hasFocus() ? '' : ' (unfocused)'); };
  document.addEventListener('focusin', () => log.push('in ' + on()), true);
  document.addEventListener('focusout', () => log.push('out ' + on()), true);
  window.addEventListener('blur', () => log.push('blur ' + on()));
  window.addEventListener('focus', () => log.push('focus ' + on()));
  window.addEventListener('message', (m) => { if (m.data && m.data.type === 'panel') { log.push('drawn ' + on()); } });
  window.__focusLog = log;
  return true;
})()`;

// focusLog reads back what FOCUS_LOG has recorded since it was installed.
export function focusLog(doc: WebviewDocument): Promise<string[]> {
  return doc.evaluate<string[]>('window.__focusLog || []');
}

// restoring runs a check's body and then puts back what the body changed — a
// theme, a width — however the body ended. `putBack` answers null once the state
// is back, or the sentence saying what was left, and where it says one the check
// fails on it beside whatever the body saw, so a check after it never reads a state
// nobody reported. The putting back is never left to a `finally` that could throw
// over the body's own verdict.
export async function restoring(body: () => Promise<Outcome>, putBack: () => Promise<string | null>): Promise<Outcome> {
  const left = async (): Promise<string | null> => putBack().catch((err: unknown) => `putting it back stopped: ${err instanceof Error ? err.message : String(err)}`);
  let o: Outcome;
  try {
    o = await body();
  } catch (err) {
    const still = await left();
    if (still === null) { throw err; }
    throw new Error(`${err instanceof Error ? err.message : String(err)}; and ${still}`);
  }
  const still = await left();
  return still === null ? o : { passed: false, seen: `${o.seen}; ${still}`, evidence: o.evidence };
}

// inWindow turns a point of a webview document's own view into the window's
// coordinates: the frame's place is read from where the window and the document
// each put the document's body.
export async function inWindow(ctx: SuiteContext, doc: WebviewDocument, at: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const body = await ctx.d.box(doc, 'body');
  if (body === null) { throw new Error('the panel\'s document draws no body'); }
  const own = await doc.evaluate<{ x: number; y: number }>('(() => { const r = document.body.getBoundingClientRect(); return { x: r.x, y: r.y }; })()');
  return framePoint(body, own, at);
}

// framePoint is that sum, for a document read through a reader of its own: the
// body's box in the window, the body's place in the document's own view, and the
// point in that view.
export function framePoint(bodyInWindow: { x: number; y: number }, bodyInDoc: { x: number; y: number }, at: { x: number; y: number }): { x: number; y: number } {
  return { x: bodyInWindow.x - bodyInDoc.x + at.x, y: bodyInWindow.y - bodyInDoc.y + at.y };
}

// PanelControl is one control among the panel's operations as drawn: an
// operation's button, or the caret beside one. Its box is in the document's own
// coordinates — where it is drawn plus how far the panel is scrolled — so a
// reading taken after a scroll compares with one taken before it.
export interface PanelControl {
  kind: 'op' | 'caret';
  // command is the command an operation's button runs, or "caret:" and the
  // operation for a caret, which runs none.
  command: string;
  group: string;
  label: string;
  title: string;
  disabled: boolean;
  expanded: string | null;
  box: PanelBox;
  labelClipped: boolean;
  icon: string;
  glyph: boolean;
  borderWidth: number;
  borderColour: number[];
  background: number[];
}

// SectionHead is one section's heading in the section shape.
export interface SectionHead { group: string; title: string; expanded: boolean; chevron: string; glyph: boolean; box: PanelBox; borderWidth: number; borderColour: number[] }

// FlowItem is one element the flow holds, by what it is: an operation's button, a
// button and its caret held as one, or something else.
export interface FlowItem { kind: 'op' | 'pair' | 'other'; className: string; box: PanelBox }

// RowDrawn is one of the three rows as the icons and borders go: what each of its
// controls draws, and the edge each is drawn with; and its label as drawn —
// whether it is cut short, and how a cut is drawn.
export interface RowDrawn {
  icons: { control: string; icon: string; glyph: boolean }[];
  borders: { control: string; width: number; colour: number[] }[];
  valueOverflow: string;
  label: { text: string; clipped: boolean; overflow: string } | null;
}

// DrawnPanel is the panel as drawn now, read in one evaluation.
//
// 🔴 A DELIBERATE SECOND READER OF THE BUTTONS `operationButtons` (workbench.ts)
// READS, AND A THIRD OF THE ROWS beside `selectorRows` (workbench.ts) and
// `levelRows` (levels.ts). These checks judge where each control is drawn, what it
// is drawn with, and whether its border and its icon are there; those readers take
// the words and the state, and every other scenario's presses and verdicts are made
// through them. Widening one would change a reader those scenarios judge by, so the
// drawing is read here beside them, from the same elements.
export interface DrawnPanel {
  shape: 'buttons' | 'sections' | 'neither';
  view: { width: number; height: number; scrollWidth: number; scrollHeight: number; scrollX: number; scrollY: number };
  controls: PanelControl[];
  flow: FlowItem[];
  flowGap: number | null;
  heads: SectionHead[];
  // rules are each group box's top border, in the section shape.
  rules: { group: string; width: number; colour: number[] }[];
  iconFont: { faces: string[]; loaded: boolean };
  rows: RowDrawn[];
  rowsBottom: number;
  // overflowing names what is drawn past the panel's right edge, as far as it
  // reaches.
  overflowing: string[];
  ground: number[];
  bodyClass: string;
  // tokens are the editor's own colours the panel's marks are drawn in, read in
  // the panel's document as the colour each resolves to.
  tokens: { focusBorder: number[]; buttonHover: number[]; listHover: number[] };
}

// COLOUR turns a colour as a computed style or a theme token reads it into four
// numbers, so two spellings of one colour compare equal.
const COLOUR = `const colour = (c) => {
    const s = (c || '').trim();
    let m = /^rgba?\\(([^)]*)\\)$/.exec(s);
    if (m) { const p = m[1].split(',').map((x) => Number(x.trim())); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^#([0-9a-f]+)$/i.exec(s);
    if (m) {
      const h = m[1];
      const e = h.length <= 4 ? h.split('').map((x) => x + x).join('') : h;
      const n = (i) => parseInt(e.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), e.length >= 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1];
    }
    return [0, 0, 0, 0];
  };`;

const DRAWN_PANEL = `(() => {
  ${COLOUR}
  const sx = window.scrollX;
  const sy = window.scrollY;
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x + sx, y: r.y + sy, width: r.width, height: r.height }; };
  const glyph = (e) => {
    if (!e) { return false; }
    const cs = getComputedStyle(e, '::before');
    const r = e.getBoundingClientRect();
    return cs.content !== 'none' && cs.content !== 'normal' && cs.content !== '""' && /codicon/.test(cs.fontFamily) && r.width > 0 && r.height > 0;
  };
  const iconOf = (i) => (i ? ([...i.classList].find((c) => c.startsWith('codicon-')) || '') : '');
  const flowEl = document.querySelector('.ops-flow');
  const sections = document.querySelector('.groups-sections');
  const controls = [...document.querySelectorAll('button.op[data-command], button.op-caret')].map((b) => {
    const cs = getComputedStyle(b);
    const l = b.querySelector('.op-label');
    const i = b.querySelector('.codicon');
    return {
      kind: b.classList.contains('op-caret') ? 'caret' : 'op',
      command: b.dataset.command || ('caret:' + (b.dataset.dials || '')),
      group: b.dataset.group || '',
      label: ((l || {}).innerText || '').trim(),
      title: b.title || '',
      disabled: b.disabled,
      expanded: b.getAttribute('aria-expanded'),
      box: box(b),
      labelClipped: !!l && l.scrollWidth > l.clientWidth + 0.5,
      icon: iconOf(i),
      glyph: glyph(i),
      borderWidth: parseFloat(cs.borderTopWidth) || 0,
      borderColour: colour(cs.borderTopColor),
      background: colour(cs.backgroundColor),
    };
  });
  const flow = flowEl ? [...flowEl.children].map((e) => ({ kind: e.matches('button.op') ? 'op' : e.matches('.op-pair') ? 'pair' : 'other', className: String(e.className), box: box(e) })) : [];
  const heads = [...document.querySelectorAll('.section-head')].map((h) => {
    const cs = getComputedStyle(h);
    const i = h.querySelector('.codicon');
    return { group: h.dataset.toggle || '', title: ((h.querySelector('.section-title') || {}).innerText || '').trim(), expanded: h.getAttribute('aria-expanded') === 'true', chevron: iconOf(i), glyph: glyph(i), box: box(h), borderWidth: parseFloat(cs.borderTopWidth) || 0, borderColour: colour(cs.borderTopColor) };
  });
  const rules = [...document.querySelectorAll('.groups-sections .group')].map((g) => { const cs = getComputedStyle(g); return { group: g.dataset.group || '', width: parseFloat(cs.borderTopWidth) || 0, colour: colour(cs.borderTopColor) }; });
  const rows = [...document.querySelectorAll('.selector-row')].map((r) => {
    const parts = [['choosing', r.querySelector('button.selector')], ['create', r.querySelector('button.selector-create')], ['offer', r.querySelector('button.selector-offer')], ['mark', r.querySelector('.selector-warning')]].filter((p) => p[1]);
    const v = r.querySelector('.selector-value');
    const l = r.querySelector('.selector-label');
    return {
      icons: parts.map(([control, e]) => { const i = e.classList.contains('codicon') ? e : e.querySelector('.codicon'); return { control, icon: iconOf(i), glyph: glyph(i) }; }),
      borders: parts.filter((p) => p[0] !== 'mark').map(([control, e]) => { const cs = getComputedStyle(e); return { control, width: parseFloat(cs.borderTopWidth) || 0, colour: colour(cs.borderTopColor) }; }),
      valueOverflow: v ? getComputedStyle(v).textOverflow : '',
      label: l ? { text: (l.textContent || '').trim(), clipped: l.scrollWidth > l.clientWidth + 0.5, overflow: getComputedStyle(l).textOverflow } : null,
    };
  });
  const root = getComputedStyle(document.documentElement);
  const token = (n) => colour(root.getPropertyValue(n));
  const selectors = document.querySelector('.selectors');
  return {
    shape: flowEl ? 'buttons' : sections ? 'sections' : 'neither',
    view: { width: document.documentElement.clientWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, scrollX: sx, scrollY: sy },
    controls,
    flow,
    flowGap: flowEl ? parseFloat(getComputedStyle(flowEl).columnGap) || 0 : null,
    heads,
    rules,
    iconFont: { faces: [...document.fonts].map((f) => f.family + ' ' + f.status), loaded: [...document.fonts].some((f) => /codicon/.test(f.family) && f.status === 'loaded') },
    rows,
    rowsBottom: selectors ? box(selectors).y + box(selectors).height : 0,
    overflowing: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right + sx > document.documentElement.clientWidth + 0.5; })
      .map((e) => String(e.className || e.tagName.toLowerCase()).split(' ').slice(0, 2).join('.') + ' to ' + Math.round(e.getBoundingClientRect().right + sx) + ' px'),
    ground: colour(getComputedStyle(document.body).backgroundColor),
    bodyClass: document.body.className,
    tokens: { focusBorder: token('--vscode-focusBorder'), buttonHover: token('--vscode-button-secondaryHoverBackground'), listHover: token('--vscode-list-hoverBackground') },
  };
})()`;

export function drawnPanel(doc: WebviewDocument): Promise<DrawnPanel> {
  return doc.evaluate<DrawnPanel>(DRAWN_PANEL);
}

// sameColour compares two colours read through the helpers above.
export function sameColour(a: readonly number[], b: readonly number[]): boolean {
  return a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) <= (i === 3 ? 0.01 : 1));
}

// workbenchGround is the ground the side bar and the editor area are drawn on in
// the workbench, read the way the panel's own is, so the two compare.
export function workbenchGround(ctx: SuiteContext): Promise<{ sideBar: number[]; editor: number[] }> {
  return ctx.d.workbench(`(() => {
    ${COLOUR}
    const bg = (id) => { const e = document.getElementById(id); return e ? colour(getComputedStyle(e).backgroundColor) : [0, 0, 0, 0]; };
    return { sideBar: bg('workbench.parts.sidebar'), editor: bg('workbench.parts.editor') };
  })()`);
}

// seen says a colour is drawn at all.
export function seen(c: readonly number[]): boolean {
  return c.length === 4 && c[3] > 0;
}

// rgb words a colour for a check's report.
export function rgb(c: readonly number[]): string {
  return `rgba(${c.join(', ')})`;
}

// ops are the operations' buttons among a reading's controls, in the order drawn.
export function ops(panel: DrawnPanel): PanelControl[] {
  return panel.controls.filter((c) => c.kind === 'op');
}

// lines groups the controls by the line they are drawn on, top to bottom, each
// line's controls left to right.
export function lines(panel: DrawnPanel): PanelControl[][] {
  const out: PanelControl[][] = [];
  for (const c of [...panel.controls].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last[0].box.y + last[0].box.height / 2 - (c.box.y + c.box.height / 2)) < 4) { last.push(c); } else { out.push([c]); }
  }
  return out;
}

// ---- a menu and the control it belongs to ---------------------------------------------

// OpenMenu is the menu a control has open, read in one evaluation with the control
// it belongs to. Boxes here are where they are drawn in the panel's window, which
// is what a menu is placed against.
export interface OpenMenu {
  open: boolean;
  id: string;
  command: string;
  label: string;
  box: PanelBox | null;
  // cap and floor are the widest and narrowest the menu's own style lets it be,
  // resolved in the panel to pixels: the style may state either as a share of
  // the panel, which reads back as a formula rather than as a length.
  cap: number;
  floor: number;
  // needed is what the widest of its rows takes, with the menu's own edges: the
  // width at which no row would be cut short.
  needed: number;
  rows: { text: string; label: string; clipped: boolean }[];
  status: string;
  // marked is every control drawn as held open, and opener the one whose menu
  // this is.
  marked: string[];
  opener: PanelBox | null;
  // view is the panel's own width and height, as the window it is drawn in has
  // them — the edges a menu is kept inside — and contentWidth the width left
  // beside the panel's scroll bar where it draws one.
  view: { width: number; height: number; contentWidth: number };
}

const OPEN_MENU = `(() => {
  const m = [...document.querySelectorAll('.op-menu')].find((x) => !x.hidden) || null;
  const box = (e) => { if (!e) { return null; } const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const edges = (e) => { const cs = getComputedStyle(e); return px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth); };
  // A bound the style states as a share of the panel reads back as a formula, so
  // it is resolved by a box standing where the menu stands — fixed against the
  // panel's view — given that bound and a width it must give way to. The box is
  // set under the root rather than in the body, so nothing watching the panel's
  // content sees it, and it is taken out in the same reading.
  const resolved = (bound, value) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position: fixed; left: 0; top: 0; visibility: hidden; padding: 0; border: 0; box-sizing: content-box;';
    probe.style.width = bound === 'max' ? '100000px' : '0px';
    if (bound === 'max') { probe.style.maxWidth = value; } else { probe.style.minWidth = value; }
    document.documentElement.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const marked = [...document.querySelectorAll('[aria-expanded="true"]')].filter((e) => e.matches('button.op, button.op-caret'));
  const opener = m ? document.querySelector('[aria-controls="' + m.id + '"]') : null;
  const entries = m ? [...m.querySelectorAll('.op-menu-option, .op-menu-dial')].filter((o) => !o.hidden) : [];
  const needed = m ? Math.max(0, ...entries.map((o) => {
    const parts = [...o.querySelectorAll('.op-menu-label, .op-menu-detail')];
    const inner = o.classList.contains('op-menu-dial')
      ? [...o.children].reduce((w, c) => w + c.scrollWidth, 0) + px(getComputedStyle(o).columnGap) * Math.max(0, o.children.length - 1)
      : Math.max(0, ...parts.map((p) => p.scrollWidth));
    return inner + edges(o);
  })) + edges(m) : 0;
  return {
    open: m !== null,
    id: m ? m.id : '',
    command: m ? (m.dataset.menuCommand || '') : '',
    label: m ? (m.getAttribute('aria-label') || '') : '',
    box: box(m),
    cap: m ? resolved('max', getComputedStyle(m).maxWidth) : 0,
    floor: m ? resolved('min', getComputedStyle(m).minWidth) : 0,
    needed,
    rows: entries.map((o) => ({ text: (o.innerText || '').replace(/\\s+/g, ' ').trim(), label: ((o.querySelector('.op-menu-label') || {}).innerText || '').trim(), clipped: [...o.querySelectorAll('.op-menu-label, .op-menu-detail')].some((p) => p.scrollWidth > p.clientWidth + 0.5) })),
    status: m ? (((m.querySelector('[data-menu-status]') || {}).textContent) || '').trim() : '',
    marked: marked.map((e) => e.dataset.command || ('caret:' + (e.dataset.dials || ''))),
    opener: box(opener),
    view: { width: window.innerWidth, height: window.innerHeight, contentWidth: document.documentElement.clientWidth },
  };
})()`;

export function openMenu(doc: WebviewDocument): Promise<OpenMenu> {
  return doc.evaluate<OpenMenu>(OPEN_MENU);
}

// Placement is where a menu of choices stands against the control that opened it,
// by the rule a reader is promised: beneath the control, or above it where there is
// no room below; its left edge on the control's left edge, pulled in from the
// panel's right edge where it would otherwise run past it — the edge left of the
// panel's scroll bar, where it draws one, since a menu's end under the bar is out
// of sight; and never narrower than its rows need, up to as wide as the panel lets
// it be.
export interface Placement { below: boolean; across: 'on the control\'s left edge' | 'pulled in from the right edge'; breaks: string[] }

export function placement(m: OpenMenu): Placement {
  if (m.box === null || m.opener === null) {
    return { below: false, across: 'on the control\'s left edge', breaks: ['no menu, or no control it belongs to, is drawn'] };
  }
  const breaks: string[] = [];
  const b = m.box;
  const o = m.opener;
  const edge = m.view.contentWidth;
  const room = m.view.height - (o.y + o.height);
  const above = room < b.height && o.y > b.height;
  if (above && Math.abs(b.y + b.height - o.y) > 1) { breaks.push(`with ${Math.round(room)} px below the control for a ${Math.round(b.height)} px menu it is to end at the control's top (${Math.round(o.y)}), and ends at ${Math.round(b.y + b.height)}`); }
  if (!above && Math.abs(b.y - (o.y + o.height)) > 1) { breaks.push(`it is to start at the control's bottom (${Math.round(o.y + o.height)}), and starts at ${Math.round(b.y)}`); }
  const wanted = Math.max(0, Math.min(o.x, edge - b.width));
  if (Math.abs(b.x - wanted) > 1) { breaks.push(`its left edge is to be at ${Math.round(wanted)} (the control's left edge ${Math.round(o.x)}, the panel ${edge} px wide left of its scroll bar), and is at ${Math.round(b.x)}`); }
  if (b.x + b.width > edge + 1) { breaks.push(`it runs ${Math.round(b.x + b.width - edge)} px past the panel's right edge${edge < m.view.width ? ', under the panel\'s scroll bar' : ''}`); }
  const least = Math.min(Math.max(m.needed, m.floor), m.cap);
  if (b.width < least - 1) { breaks.push(`it is ${Math.round(b.width)} px wide where its rows need ${Math.round(m.needed)} px and the panel lets it be ${Math.round(m.cap)}`); }
  return { below: !above, across: wanted < o.x - 1 ? 'pulled in from the right edge' : 'on the control\'s left edge', breaks };
}

// describeMenu words a menu and where it stands, for a check's report.
export function describeMenu(m: OpenMenu): string {
  if (!m.open || m.box === null) { return 'no menu open'; }
  const p = placement(m);
  return `"${m.label}" ${Math.round(m.box.width)} px wide at ${Math.round(m.box.x)},${Math.round(m.box.y)}, its right edge at ${Math.round(m.box.x + m.box.width)}, for a control at ${m.opener ? `${Math.round(m.opener.x)},${Math.round(m.opener.y)}–${Math.round(m.opener.y + m.opener.height)}` : 'nowhere'} in a ${m.view.width} × ${m.view.height} panel${m.view.contentWidth < m.view.width ? `, ${m.view.contentWidth} px of it left of its scroll bar` : ''}; ${p.below ? 'beneath it' : 'above it'}, ${p.across}; its rows need ${Math.round(m.needed)} px${m.rows.some((r) => r.clipped) ? ', some cut short' : ''}${p.breaks.length > 0 ? `; against the rule: ${p.breaks.join('; ')}` : ''}`;
}

// MENU_CONTROLS are the operations whose press opens a menu of choices beside their
// button, from the product's own description of them.
export const MENU_CONTROLS: readonly string[] = Object.entries(OPERATION_MENUS)
  .filter(([id, menu]) => menu !== undefined && menu.kind !== 'dials' && !id.startsWith('dials-'))
  .map(([id]) => id);

// menuWords is how the product names a control's menu, and what a menu whose
// choices are asked for says while it reads.
export function menuWords(id: string): { label: string; pending: string } {
  const menu = (OPERATION_MENUS as Record<string, { kind: string; label: string; pending?: string } | undefined>)[id];
  if (menu === undefined) { throw new Error(`the product describes no menu for ${id}`); }
  return { label: menu.label, pending: menu.pending ?? '' };
}

// menuCommand is the command and the label of the operation whose id is `id`.
export function menuCommand(id: string): { command: string; label: string } {
  const op = commandsPanelOperations().find((o) => o.id === id);
  if (op === undefined) { throw new Error(`the product describes no operation ${id}`); }
  return { command: commandIdFor(op), label: op.label };
}

// MenuOpened is one control's menu opened where it is drawn: the panel read just
// before the press and just after, and the menu.
export interface MenuOpened { id: string; label: string; before: DrawnPanel; after: DrawnPanel; menu: OpenMenu }

// openMenuOf brings a control into the panel's view, presses it, waits for its
// menu to stand open with its choices drawn, and reads the panel and the menu. The
// menu is left open.
//
// The pointer is taken off the button before the panel is read again, because a
// control under the pointer is drawn on its hover ground — the very ground a held
// control is marked with — so a reading taken with the pointer still resting on
// the button could not tell the mark from the hover.
export async function openMenuOf(ctx: SuiteContext, panel: WebviewDocument, id: string): Promise<MenuOpened> {
  const { command, label } = menuCommand(id);
  const selector = `button.op[data-command="${command}"]`;
  await scrollIntoPanel(panel, selector);
  const before = await drawnPanel(panel);
  await pressIn(ctx.d, panel, selector);
  const menu = await waitMenuOpen(panel, `the ${label} menu standing open with its choices`);
  await pointerOff(ctx, panel);
  return { id, label, before, after: await drawnPanel(panel), menu };
}

// pointerOff rests the pointer on the open menu's own heading line, which is no
// control, and waits for no control of the panel to be under it. The pointer is
// kept inside the panel's document because the document goes on reading the last
// element it had under the pointer as hovered once the pointer leaves it.
export async function pointerOff(ctx: SuiteContext, panel: WebviewDocument): Promise<void> {
  const menu = await ctx.d.box(panel, '.op-menu:not([hidden])');
  if (menu === null) { throw new Error('no menu stands open to rest the pointer on'); }
  await ctx.d.moveTo({ x: menu.x + menu.width / 2, y: menu.y + 3 });
  await until('no control of the panel under the pointer', 3000, () => panel.evaluate<number>('document.querySelectorAll(\'button.op:hover, button.op-caret:hover, .section-head:hover\').length'), (n) => n === 0);
}

// waitMenuOpen waits for a control's menu to stand open with its choices drawn.
export function waitMenuOpen(doc: WebviewDocument, what: string, boundMs = 20000): Promise<OpenMenu> {
  return until(what, boundMs, () => openMenu(doc), (m) => m.open && m.rows.length > 0);
}

// waitMenuClosed waits for no menu to stand open and no control to be drawn held.
export function waitMenuClosed(doc: WebviewDocument, what: string, boundMs = 5000): Promise<OpenMenu> {
  return until(what, boundMs, () => openMenu(doc), (m) => !m.open && m.marked.length === 0);
}

// MENU_STATUS_OBSERVER is installed in the panel's document before a press, and
// records every change of what the open menu's status line says and how many
// choices it draws, so a line that stands only while the menu reads is caught as it
// is drawn.
export const MENU_STATUS_OBSERVER = `(() => {
  const log = [];
  let last = null;
  const read = () => {
    const m = [...document.querySelectorAll('.op-menu')].find((x) => !x.hidden) || null;
    const status = m ? (((m.querySelector('[data-menu-status]') || {}).textContent) || '').trim() : '';
    const choices = m ? m.querySelectorAll('.op-menu-option').length : 0;
    return { open: m !== null, status, choices };
  };
  const sample = () => { const v = read(); const k = JSON.stringify(v); if (k !== last) { last = k; log.push({ at: Date.now(), ...v }); } };
  sample();
  const observer = new MutationObserver(sample);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  log.stop = () => observer.disconnect();
  window.__commandsPanelMenuLog = log;
  return log.length;
})()`;

export interface MenuReading { at: number; open: boolean; status: string; choices: number }

export function menuReadings(doc: WebviewDocument): Promise<MenuReading[]> {
  return doc.evaluate<MenuReading[]>('(window.__commandsPanelMenuLog || []).map((r) => ({ at: r.at, open: r.open, status: r.status, choices: r.choices }))');
}

// ---- the panes and their title bars -------------------------------------------------

// TitleActions is one pane's header: where it is, and the actions its title bar
// draws, each with how wide it is drawn — an action the bar keeps hidden until the
// header is pointed at is drawn with no width.
export interface TitleActions { header: Box; actions: { label: string; icon: string; box: Box }[] }

// paneTitleActions reads the header of the pane titled `title`, wherever the
// container sits.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF `commandsTitleActions` (welcome.ts), which reads
// the Commands pane alone, in the primary side bar, and waits for its bar to draw
// something. These checks read every pane, a pane that draws nothing at rest among
// them, and read the bar again as the pointer moves; that helper's wait is part of
// what the welcome page's checks judge by, so it is left as it is.
export function paneTitleActions(ctx: SuiteContext, title: string): Promise<TitleActions | null> {
  return ctx.d.workbench<TitleActions | null>(`((t) => {
    const b = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const tt = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim().toLowerCase() : '';
      if (tt !== t.toLowerCase()) { continue; }
      return { header: b(h), actions: [...h.querySelectorAll('.action-label')].map((a) => ({ label: a.getAttribute('aria-label') || '', icon: (String(a.className).match(/codicon-[a-z-]+/) || [''])[0], box: b(a) })) };
    }
    return null;
  })(${JSON.stringify(title)})`);
}

// drawnActions are the actions a header draws with a width, by their labels.
export function drawnActions(t: TitleActions | null): string[] {
  return t === null ? [] : t.actions.filter((a) => a.box.width > 0).map((a) => a.label);
}

// PanesAt is where the container's panes are drawn: in which part of the window,
// in what order, and how wide the Commands panel's own document is — null where
// that document is not drawn, or did not answer, at the reading.
export interface PanesAt { part: string; titles: string[]; width: number | null }

const PANES = `[...document.querySelectorAll('.pane')].map((p) => {
  const h = p.querySelector('.pane-header');
  const part = p.closest('[id^="workbench.parts."]');
  const r = p.getBoundingClientRect();
  return { title: h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '', part: part ? part.id : '', y: r.y, x: r.x, height: r.height };
})`;

// panesOf reads where the panes the manifest names are drawn, in the order they
// are drawn, as one reading: the Commands panel's document is looked for once,
// so a wait polling these readings is what waits for it.
export async function panesOf(ctx: SuiteContext): Promise<PanesAt> {
  const names = viewNames(ctx).map((n) => n.toLowerCase());
  const panes = (await ctx.d.workbench<{ title: string; part: string; y: number; x: number; height: number }[]>(PANES))
    .filter((p) => names.includes(p.title.toLowerCase()) && p.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const doc = await documentNow(ctx.d, COMMANDS_PANEL);
  const width = doc === null ? null : await doc.evaluate<number>('document.documentElement.clientWidth').catch(() => null);
  const parts = [...new Set(panes.map((p) => p.part))];
  return { part: parts.join(', '), titles: panes.map((p) => p.title), width };
}

// ContainerManifest is what the manifest of the copy under test says about the
// container and its views, beside what the suite's own manifest type carries.
export interface ContainerManifest {
  publisher: string;
  name: string;
  contributes: {
    viewsContainers: { activitybar: { id: string; title: string }[] };
    views: Record<string, { id: string; name: string }[]>;
    commands: { command: string; title: string; category?: string; icon?: string }[];
    configuration: { properties: Record<string, { default?: unknown; description?: string; enum?: string[]; enumDescriptions?: string[] }> };
  };
}

// containerManifest is the context's own reading of that manifest — the copy under
// test's package.json, parsed once as the scenario starts — typed for the fields
// these checks read beside the ones every scenario does.
export function containerManifest(ctx: SuiteContext): ContainerManifest {
  return ctx.manifest as unknown as ContainerManifest;
}

// containerViews are the container's views as the manifest declares them, in its
// order.
export function containerViews(ctx: SuiteContext): { id: string; name: string }[] {
  const m = containerManifest(ctx);
  return m.contributes.views[m.contributes.viewsContainers.activitybar[0].id] ?? [];
}

// viewNames are the container's panels by the names the manifest gives them.
export function viewNames(ctx: SuiteContext): string[] {
  return containerViews(ctx).map((v) => v.name);
}

// iconOfCommand is the codicon class a command's manifest icon names.
export function iconOfCommand(ctx: SuiteContext, command: string): string {
  const c = containerManifest(ctx).contributes.commands.find((x) => x.command === command);
  const m = /^\$\(([a-z-]+)\)$/.exec(c?.icon ?? '');
  return m ? `codicon-${m[1]}` : '';
}

// moveContainer moves the container to `destination` — the activity bar menu's
// entry under "Move To", by the words it reads — as a person does: a right-click on
// the container's entry in the activity bar, then the two entries pressed. It
// answers with where the panes are once every one is drawn in `part` and the
// Commands panel's document answers there, and refuses where an entry is not drawn
// or the panes do not arrive.
export async function moveContainer(ctx: SuiteContext, destination: string, part: string): Promise<PanesAt> {
  const title = containerManifest(ctx).contributes.viewsContainers.activitybar[0].title;
  const at = await until(`the activity bar's "${title}" entry`, 10000, () => ctx.d.workbench<{ x: number; y: number } | null>(`((t) => {
    const a = [...document.querySelectorAll('#workbench\\\\.parts\\\\.activitybar .action-item .action-label')].find((x) => x.getAttribute('aria-label') === t);
    if (!a) { return null; }
    const r = a.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  })(${JSON.stringify(title)})`), (v) => v !== null);
  if (at === null) { throw new Error(`unreachable: the activity bar's "${title}" entry`); }
  await ctx.d.click(at, 'right');
  await until('the activity bar\'s menu', 5000, () => ctx.d.workbench<boolean>(`!!document.querySelector('.context-view .monaco-menu')`), (v) => v);
  if (await pressMenuItem(ctx.d, 'Move To') === null) { throw new Error('the activity bar\'s menu draws no "Move To" entry'); }
  await until(`the "${destination}" entry under "Move To"`, 5000, () => ctx.d.box(null, `.context-view .action-label[aria-label="${destination}"]`), (b) => b !== null && b.width > 0);
  if (await pressMenuItem(ctx.d, destination) === null) { throw new Error(`the "Move To" menu draws no "${destination}" entry`); }
  return until(`the panes drawn in ${part}`, 10000, () => panesOf(ctx), (p) => p.part === part && p.titles.length === viewNames(ctx).length && p.width !== null);
}

// ---- the section shape's headings ----------------------------------------------------------

// pressHead presses a section's heading where a person presses it.
export async function pressHead(ctx: SuiteContext, panel: WebviewDocument, group: string): Promise<void> {
  await pressIn(ctx.d, panel, `.section-head[data-toggle="${group}"]`);
}

// openEverySection opens every section that is closed, and waits for them all to
// read open.
export async function openEverySection(ctx: SuiteContext, panel: WebviewDocument): Promise<DrawnPanel> {
  for (const h of (await drawnPanel(panel)).heads.filter((x) => !x.expanded)) { await pressHead(ctx, panel, h.group); }
  return until('every section open', 5000, () => drawnPanel(panel), (p) => p.heads.length > 0 && p.heads.every((h) => h.expanded));
}

// ---- the panel's focus and its own scroll ------------------------------------------------

const FOCUS_ATTEMPTS = 3;

// focusInPanel gives one control of the panel the focus with the panel's own
// document holding the keyboard, as a person arrives at it before pressing keys
// there: the view focused by its own command, then the control. It refuses where
// the control does not end up holding the focus.
//
// The command does not always bring the keyboard into the panel's document, and
// where it does not, no wait brings it there; a person focuses the view again,
// and so the command is given again, at most FOCUS_ATTEMPTS times in all.
export async function focusInPanel(ctx: SuiteContext, doc: WebviewDocument, selector: string): Promise<void> {
  const holding = (): Promise<boolean> => doc.evaluate<boolean>('document.hasFocus()');
  for (let attempt = 1; attempt <= FOCUS_ATTEMPTS; attempt++) {
    await run(ctx, 'aggrega.operations.focus');
    if (await until('the panel\'s document holding the keyboard', 2000, holding, (v) => v).then(() => true, () => false)) { break; }
    if (attempt === FOCUS_ATTEMPTS) { throw new Error(`the panel's document did not hold the keyboard after the view was focused ${FOCUS_ATTEMPTS} times`); }
  }
  const there = await doc.evaluate<boolean>(`((s) => { const e = document.querySelector(s); if (e) { e.focus(); } return !!e; })(${JSON.stringify(selector)})`);
  if (!there) { throw new Error(`the panel draws nothing matching ${selector}`); }
  await until(`${selector} holding the focus`, 3000, () => doc.evaluate<boolean>(`((s) => document.hasFocus() && document.activeElement === document.querySelector(s))(${JSON.stringify(selector)})`), (v) => v);
}

// panelViewCentre is the middle of the panel's view in the window's coordinates,
// wherever the panel is scrolled.
export async function panelViewCentre(ctx: SuiteContext, doc: WebviewDocument): Promise<{ x: number; y: number }> {
  const view = await doc.evaluate<{ width: number; height: number }>('({ width: window.innerWidth, height: window.innerHeight })');
  return inWindow(ctx, doc, { x: view.width / 2, y: view.height / 2 });
}

// scrollIntoPanel brings one control into the panel's view, as a person scrolls to a
// button before pressing it, and waits for the panel to come to rest — so the boxes
// read after it are the ones a press is made over.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF THE SCROLL `pressIn` (workbench.ts) MAKES BEFORE
// IT PRESSES. That one does not wait for the panel to come to rest, and every
// scenario's presses are made through it, so it is left as it is; these checks read
// the panel between the scroll and the press, which only a panel at rest answers
// for.
export async function scrollIntoPanel(doc: WebviewDocument, selector: string): Promise<void> {
  const there = await doc.evaluate<boolean>(`((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } return !!e; })(${JSON.stringify(selector)})`);
  if (!there) { throw new Error(`the panel draws nothing matching ${selector}`); }
  let last = -1;
  await until('the panel coming to rest', 3000, async () => {
    const y = await doc.evaluate<number>('window.scrollY');
    const still = y === last;
    last = y;
    return still;
  }, (v) => v, 100);
}

// ---- the panel's shape, chosen on the settings screen --------------------------------

// LayoutChoice is what choosing a shape on the settings screen read: the drop-down's
// rows as drawn, the description it drew beside the row it was resting on, and the
// capture taken while it stood open.
export interface LayoutChoice { rows: { value: string; aria: string }[]; details: string[]; shot: string }

// DropDown is the settings screen's drop-down as drawn: its rows, which one the
// keys rest on, and the description its details pane draws for that one.
interface DropDown { rows: { value: string; aria: string }[]; focused: number; details: string }

const DROP_DOWN = `(() => {
  const c = document.querySelector('.monaco-select-box-dropdown-container.visible');
  if (!c) { return null; }
  const rows = [...c.querySelectorAll('.monaco-list-row')];
  return {
    rows: rows.map((r) => ({ value: (r.innerText || '').trim().split('\\n')[0], aria: r.getAttribute('aria-label') || '' })),
    focused: rows.findIndex((r) => r.classList.contains('focused')),
    details: ((c.querySelector('.select-box-details-pane') || {}).innerText || '').trim(),
  };
})()`;

// chooseLayout sets the panel's shape on the editor's own settings screen, as a
// person does with the keyboard: the setting found by its key, its drop-down
// opened, the keys moved over each row in turn so the description the drop-down
// draws for it is read, then onto the row naming `value`, and Enter. It waits for
// the value in force to read `value` — the editor writes the user's own value, or
// takes it out of the file where `value` is the declared default.
export async function chooseLayout(ctx: SuiteContext, value: string, shotName: string): Promise<LayoutChoice> {
  const title = ctx.manifest.contributes.configuration.title;
  await openSettingsOn(ctx, LAYOUT_SETTING, settingLabel(title, LAYOUT_SETTING));
  const select = `.settings-editor .setting-item-contents[data-key="${LAYOUT_SETTING}"] select.monaco-select-box`;
  const at = await until('the shape setting\'s drop-down being drawn', 10000, () => ctx.d.box(null, select), (b) => b !== null && b.width > 0);
  if (at === null) { throw new Error('unreachable: the shape setting\'s drop-down'); }
  await ctx.d.click(centre(at));
  const read = (): Promise<DropDown | null> => ctx.d.workbench<DropDown | null>(DROP_DOWN);
  const open = await until('the drop-down listing the shapes', 5000, read, (v) => v !== null && v.rows.length > 0 && v.focused !== -1);
  if (open === null) { throw new Error('unreachable: the drop-down'); }
  // The keys go to the first row, then down each row in turn.
  let at0 = open.focused;
  for (; at0 > 0; at0--) { await ctx.d.press('ArrowUp'); }
  await until('the keys on the first row', 3000, read, (v) => v !== null && v.focused === 0);
  const details: string[] = [];
  for (let i = 0; i < open.rows.length; i++) {
    if (i > 0) { await ctx.d.press('ArrowDown'); }
    const d = await until(`the keys on "${open.rows[i].value}"`, 3000, read, (v) => v !== null && v.focused === i);
    details.push(d?.details ?? '');
  }
  const shot = await capture(ctx, shotName);
  const target = open.rows.findIndex((r) => r.value === value);
  if (target === -1) { throw new Error(`the drop-down lists ${JSON.stringify(open.rows.map((r) => r.value))}, not "${value}"`); }
  for (let i = open.rows.length - 1; i > target; i--) { await ctx.d.press('ArrowUp'); }
  await until(`the keys on "${value}"`, 3000, read, (v) => v !== null && v.focused === target);
  await ctx.d.press('Enter');
  await until(`the value in force reading "${value}"`, 10000, () => settingValue(ctx, LAYOUT_SETTING), (v) => v.value === value);
  return { rows: open.rows, details, shot };
}
