// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { BUILD_ON_INSPECT_KEY, SERVER_CONFIG_SECTION } from '../../src/settings';
import { buildValidateParams } from '../../src/validate-request';
import { need } from './checks';
import { WebviewDocument } from './drivers';
import { FixtureError, FixtureProof } from './fixtures';
import {
  boundaryTitle, contains, containsPoint, describeFraming, Drawing, DrawnContainer, DrawnNode, drawnText, framingOf, layoutModel, lineEnters,
  noticeReadings, onBorder, overlaps, readDrawing, readFrame, readLegend, rect, sameRect, shownDrawing, subsystemTitle, told, union, visibilityReadings,
  watchNotice, watchVisibility,
} from './graph-drawing';
import {
  findGraphPanel, graphState, graphTabInFront, pointAtNode, pressNode, putAwayNotifications, readPanel, revealGraphTab, showGraph,
} from './graph-panel';
import { DiagnosticEntry } from './probe-client';
import { readStat } from './processes';
import { referenceAnswer } from './reference';
import { capture, describeDiagnostics, diagnostics, lineIn, open, ready, run, save, SuiteContext, theServer } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { ADMIN, CACHE, GATEWAY, RELEASE, staleDrawing, yamlOf } from './suite-graph-panel';
import { Bound, commandsPanel, guard, holds, pressOperation, stated, toasts, toastsSince, until, WaitExpired } from './workbench';

// The checks run in the storefront folder with the topology graph open: what the
// first drawing measures — the whole topology framed to the panel, no two labels
// over one another, each component name inside its card, the Release's
// boundaries and the Aggregate's subsystems drawn as declared, the imported
// module's component in its boundary, each edge between the boxes of its two
// ends and across no other box — and the legend; and when the open graph draws
// itself again and what that leaves alone: a save redrawing it and typing not, a
// write from outside the editor redrawing it, the reader's view and selection
// kept through a redraw nobody pressed for while a press frames the whole
// topology again, a redraw that fails presenting the drawing as out of date the
// same way by every route, and a redraw landing behind another tab.

export const GRAPH_DRAWING_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'graph.first-opening-frames-the-whole-topology',
  'graph.no-two-labels-overlap',
  'graph.component-names-drawn-whole-inside-their-cards',
  'graph.release-boundaries-drawn-holding-what-they-place',
  'graph.subsystems-drawn-nested-as-declared',
  'graph.imported-module-component-drawn-in-its-boundary',
  'graph.edge-between-boundaries-runs-from-one-card-to-the-other',
  'graph.edge-inside-a-subsystem-stays-inside-it',
  'graph.no-edge-crosses-a-container-it-has-no-end-in',
  'legend.lower-left-names-the-groupings-and-the-type-bar-and-bounds-the-colours',
  'legend.grouping-rows-name-the-declaring-document-and-are-drawn-whole',
  'legend.legible-in-the-panel-font',
  'graph.reads-well-as-a-whole',
  'graph.typing-moves-the-problems-panel-and-not-the-drawing',
  'graph.save-redraws-the-drawing-with-no-press',
  'graph.write-from-outside-the-editor-redraws-the-drawing',
  'graph.redraw-after-a-save-keeps-the-view-and-the-selection',
  'graph.redraw-of-an-addition-keeps-the-view-and-draws-it-once',
  'graph.press-frames-the-whole-topology-afresh',
  'graph.failed-redraw-after-a-save-dims-the-drawing-and-says-so',
  'graph.press-on-the-same-fault-ends-in-the-same-presentation',
  'graph.good-redraw-lifts-the-dimming',
  'graph.failure-with-nothing-drawn-claims-no-drawing-out-of-date',
  'graph.first-drawing-behind-another-tab-framed-on-return',
  'graph.redraw-behind-another-tab-keeps-the-view',
] as const;

// The nodes the checks press and watch are the storefront's, as its graph panel
// scenario names them; this is the component the redraws add.
const ADDED = 'extra';

// The edits the redraws are made by, each a line of the folder's Aggregate as
// written there and what it is changed to: the cache's type switched to another
// the catalog carries, which compiles with the Aggregate alone; the key of that
// line misspelled, which the document's own validation answers while it is
// typed; and the admin console's type pointed at a name the catalog does not
// carry, which the compiler refuses.
const CACHE_TYPE = 'type: core/datastore/memcached';
const CACHE_SWITCHED = 'type: core/datastore/valkey';
const CACHE_MISKEYED = 'typ: core/datastore/memcached';
const ADMIN_TYPE = 'type: core/devtool/adminer';
const ADMIN_BROKEN = 'type: core/devtool/adminerx';
const componentOf = (typeLine: string): string => typeLine.slice('type: '.length);

// What the legend is to read — its heading, its rows in order and the note
// bounding what a type colour means — is what the layout model declares
// (layoutModel in graph-drawing.ts); the rules its words keep, naming the
// document that declares a grouping and no position, are the model's own specs'.
//
// The notice a press puts up while the drawing is laid out. The panel's script
// writes it in place and declares nothing a check can read, so it is held here
// as written.
const layingOut = (release: string): string => `Laying out ${release}…`;

// How far a reader's zoom goes before a redraw, in turns of the wheel: far
// enough that the topology runs past the panel's edges, which is the corner a
// press on Graph brings the reader back from.
const ZOOM_TURNS = 12;

// How long after a drawing its absences are still watched: a notice, a second
// drawing or a dimming landing just after it falls inside this window.
const SETTLE_MS = 3000;

// ---- what the folder declares, and what the language server answers ---------

// Declared is what the folder's Release and Aggregate declare: each boundary by
// its path, a boundary declared inside another named after it with a slash, with
// the components and modules the Release places directly in it; each subsystem
// by its dotted path with the components declared directly under it; and each
// use one component makes of another.
interface Declared {
  boundaries: Map<string, { components: string[]; modules: string[] }>;
  subsystems: { path: string; components: string[] }[];
  uses: { from: string; to: string }[];
}

type Yaml = Record<string, unknown>;
const mapping = (v: unknown): Yaml => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Yaml : {});

function declaredIn(aggregateFile: string, releaseFile: string): Declared {
  const releaseSpec = mapping(mapping(yamlOf(fs.readFileSync(releaseFile, 'utf8'))).spec);
  const boundaries = new Map<string, { components: string[]; modules: string[] }>();
  const place = (block: Yaml, prefix: string): void => {
    for (const [name, b] of Object.entries(block)) {
      const p = prefix === '' ? name : `${prefix}/${name}`;
      boundaries.set(p, { components: Object.keys(mapping(mapping(b).components)), modules: Object.keys(mapping(mapping(b).aggregates)) });
      place(mapping(mapping(b).boundaries), p);
    }
  };
  place(mapping(releaseSpec.boundaries), '');
  const spec = mapping(mapping(yamlOf(fs.readFileSync(aggregateFile, 'utf8'))).spec);
  const subsystems: { path: string; components: string[] }[] = [];
  const uses: { from: string; to: string }[] = [];
  const components = (block: Yaml): string[] => {
    for (const [name, comp] of Object.entries(block)) {
      for (const socket of Object.values(mapping(mapping(comp).uses))) {
        for (const edge of Object.values(mapping(socket))) {
          const target = mapping(edge).target;
          if (typeof target === 'string') { uses.push({ from: name, to: target }); }
        }
      }
    }
    return Object.keys(block);
  };
  const walk = (block: Yaml, prefix: string): void => {
    for (const [name, s] of Object.entries(block)) {
      const p = prefix === '' ? name : `${prefix}.${name}`;
      subsystems.push({ path: p, components: components(mapping(mapping(s).components)) });
      walk(mapping(mapping(s).subsystems), p);
    }
  };
  components(mapping(spec.components));
  walk(mapping(spec.subsystems), '');
  return { boundaries, subsystems, uses };
}

// boundaryOf names the boundary the Release places a component in.
function boundaryOf(d: Declared, component: string): string | null {
  for (const [name, b] of d.boundaries) { if (b.components.includes(component)) { return name; } }
  return null;
}

// subsystemOf names the subsystem a component is declared directly under.
function subsystemOf(d: Declared, component: string): string | null {
  return d.subsystems.find((s) => s.components.includes(component))?.path ?? null;
}

// IrNode is one node of the language server's own graph answer.
interface IrNode { component?: string; boundary_path?: string; subsystem_path?: string }

async function irNodes(ctx: SuiteContext, reference: string): Promise<Record<string, IrNode>> {
  const a = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/irGraph', params: { release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  need(a.ok, `the language server drew no graph of the reference copy: ${a.ok ? '' : a.error.message}`);
  const r = a.result as { graph?: { spec?: { nodes?: Record<string, IrNode> } }; spec?: { nodes?: Record<string, IrNode> } };
  return (r.graph ?? r).spec?.nodes ?? {};
}

// ---- reading and editing the folder with the panel left where it is ----------

// Edited is one line of a document as an edit left it — where it is and its
// indentation — and what the whole file is to read once the document is saved.
interface Edited { file: string; index: number; indent: string; text: string }

// lineOnDisk finds the one line of a file, as it stands on disk, whose content is
// `text` once its indentation is set aside. lineOf in suite-context.ts finds the
// same line in the document it brings in front, which would take the graph panel
// out of sight, so these checks find it on disk, edit the document there, and
// hold the file each save writes to what the edits meant (savedAs).
function lineOnDisk(file: string, text: string): Edited {
  const whole = fs.readFileSync(file, 'utf8');
  const line = lineIn(file, whole.split('\n'), text);
  return { file, index: line.index, indent: line.text.slice(0, line.text.length - line.text.trimStart().length), text: whole };
}

// rewriteLine replaces one line of a document without saving it or bringing it
// in front, and returns it as edited, so the same line can be written again
// before the document is saved.
async function rewriteLine(ctx: SuiteContext, file: string, from: string, to: string): Promise<Edited> {
  return rewriteAt(ctx, lineOnDisk(file, from), to);
}

async function rewriteAt(ctx: SuiteContext, at: Edited, to: string): Promise<Edited> {
  const r = await ctx.probe.request<{ applied: boolean }>('document.edit', { path: at.file, start: { line: at.index, character: 0 }, end: { line: at.index + 1, character: 0 }, text: `${at.indent}${to}\n` });
  need(r.applied, `the editor did not apply the edit to ${path.basename(at.file)}`);
  const lines = at.text.split('\n');
  lines[at.index] = `${at.indent}${to}`;
  return { ...at, text: lines.join('\n') };
}

// insertBelow writes lines below one line of a document, without saving it or
// bringing it in front, and returns the document as edited.
async function insertBelow(ctx: SuiteContext, at: Edited, added: readonly string[]): Promise<Edited> {
  const r = await ctx.probe.request<{ applied: boolean }>('document.edit', { path: at.file, start: { line: at.index + 1, character: 0 }, text: added.map((l) => `${l}\n`).join('') });
  need(r.applied, `the editor did not apply the edit to ${path.basename(at.file)}`);
  const lines = at.text.split('\n');
  lines.splice(at.index + 1, 0, ...added);
  return { ...at, text: lines.join('\n') };
}

// savedAs saves documents one after another, as Save All writes them, and then
// holds each file to what its edits meant. An edit lands in the editor's own copy
// of the document at a line found on disk; where the editor had not yet read
// back a write made from outside it, that copy differs from the disk and the
// file saved reads otherwise than the edits meant. That is the edit not having
// been made as the check means it, so it stops the check as not run.
async function savedAs(ctx: SuiteContext, ...edits: Edited[]): Promise<void> {
  for (const e of edits) { await save(ctx, e.file); }
  for (const e of edits) {
    need(fs.readFileSync(e.file, 'utf8') === e.text, `${path.basename(e.file)} as saved does not read as its edits meant, so the editor's copy differed from the disk when it was edited`);
  }
}

// Waited is how a bounded wait ended: the reading that met its condition, or,
// where it ran out, its own account of what it waited for, its bound and its
// last reading, for the check's report.
type Waited<T> = { met: true; value: T } | { met: false; missed: string };

async function waited<T>(wait: Promise<T>): Promise<Waited<T>> {
  try {
    return { met: true, value: await wait };
  } catch (err) {
    if (err instanceof WaitExpired) { return { met: false, missed: err.message }; }
    throw err;
  }
}

const missedOf = <T>(w: Waited<T>): string => (w.met ? '' : w.missed);

// componentDrawn is what the drawing writes beneath a node's id, read whether or
// not the panel is on screen.
async function componentDrawn(doc: WebviewDocument, node: string): Promise<string | null> {
  return (await drawnText(doc)).find((n) => n.id === node)?.component ?? null;
}

// redrawn waits for the drawing after `renders` to write `component` beneath
// `node`, and returns how many drawings the canvas was then given.
async function redrawn(doc: WebviewDocument, renders: number, node: string, component: string, what: string, bound: Bound = 30000): Promise<number> {
  const s = await until(what, bound, async () => ({ renders: (await graphState(doc)).renders, component: await componentDrawn(doc, node) }),
    (v) => v.renders > renders && v.component === component);
  return s.renders;
}

// zoomInto zooms the panel into one node, as a person turns the wheel with the
// pointer resting on it, and returns the node's card once the zoom is drawn.
async function zoomInto(ctx: SuiteContext, doc: WebviewDocument, node: string, turns: number): Promise<DrawnNode> {
  const before = (await readDrawing(doc)).nodes.find((n) => n.id === node);
  need(before !== undefined, `the drawing holds no ${node}`);
  const at = await pointAtNode(ctx, doc, node);
  await ctx.d.moveTo(at);
  for (let i = 0; i < turns; i++) { await ctx.d.wheel(0, -120); }
  const after = await until(`the zoom into ${node} drawn`, 10000, async () => (await readDrawing(doc)).nodes.find((n) => n.id === node) ?? null,
    (n) => n !== null && n.card.height > before.card.height * 1.5);
  return after as DrawnNode;
}

// drawingsSettle waits until the canvas has been given no new drawing for
// `quietMs`, within guard(boundMs), and returns how many it had been given then.
async function drawingsSettle(doc: WebviewDocument, quietMs = 2000, boundMs = 30000): Promise<number> {
  const capMs = guard(boundMs);
  const end = Date.now() + capMs;
  let count = (await graphState(doc)).renders;
  for (;;) {
    const watch = await holds(quietMs, async () => (await graphState(doc)).renders, (v) => v === count);
    if (watch.held) { return count; }
    count = watch.broke as number;
    if (Date.now() >= end) { throw new WaitExpired('the drawings settling', capMs, `${count} drawings, the last within ${quietMs} ms`); }
  }
}

// pressedDrawing presses Graph over an open panel and waits for the drawing that
// press laid out, in three parts: showGraph's own wait, for a drawing made after
// the extension sent one the reader asked for; the notice the press alone puts up,
// recorded by the observer installed before it, coming down over a drawing; and no
// further drawing for a while, so that a redraw nobody pressed for — the later of
// two a save brought about — still on its way is not read as the drawing in place.
async function pressedDrawing(ctx: SuiteContext, panel: WebviewDocument): Promise<WebviewDocument> {
  const from = await watchNotice(panel);
  const d = await showGraph(ctx);
  await until('the drawing the press laid out', 60000, () => noticeReadings(d, from), (v) => {
    const laying = v.findIndex((x) => x.text === layingOut(RELEASE));
    return laying !== -1 && v.slice(laying + 1).some((x) => x.text === '' && x.nodes > 0);
  });
  await drawingsSettle(d);
  return d;
}

// closeGraphPanel closes the graph panel's tab, as a person closes it.
export async function closeGraphPanel(ctx: SuiteContext): Promise<void> {
  await revealGraphTab(ctx);
  await run(ctx, 'workbench.action.closeActiveEditor');
  await until('the graph panel closing', 10000, () => findGraphPanel(ctx), (d) => d === null);
}

// putBehind brings a document's tab in front of the graph panel's, as a person
// switches to another editor, and waits for the graph panel's tab to leave the
// front.
async function putBehind(ctx: SuiteContext, file: string): Promise<Waited<boolean>> {
  await open(ctx, file);
  return waited(until(`the graph panel behind the tab of ${path.basename(file)}`, 10000, () => graphTabInFront(ctx.d), (v) => !v));
}

// containerTitled is the drawn container of one kind with one title.
function containerTitled(d: Drawing, kind: DrawnContainer['kind'], title: string): DrawnContainer | undefined {
  return d.containers.find((k) => k.kind === kind && k.title === title);
}

// holdingCard lists the containers whose box holds a node's card.
function holdingCard(d: Drawing, node: DrawnNode): DrawnContainer[] {
  return d.containers.filter((k) => contains(k.box, node.card));
}

// cardOf is the card a drawing draws for a node, where it draws one.
function cardOf(d: Drawing, id: string): DrawnNode['card'] | undefined {
  return d.nodes.find((n) => n.id === id)?.card;
}

export async function graphDrawingChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const releaseFile = path.join(ctx.folder, RELEASE);
  const originalAggregate = fs.readFileSync(aggregate, 'utf8');
  const originalRelease = fs.readFileSync(releaseFile, 'utf8');
  const declared = declaredIn(aggregate, releaseFile);
  const legend = layoutModel();
  // The language server's own graph answer over the reference copy, asked for
  // once by whichever check needs it first.
  let answered: Record<string, IrNode> | null = null;
  const irAnswer = async (): Promise<Record<string, IrNode>> => {
    if (answered === null) { answered = await irNodes(ctx, reference); }
    return answered;
  };
  await ready(ctx);
  await contextRowsCheck(ctx);

  // ---- the first drawing ----
  let doc: WebviewDocument | null = null;
  let first: Drawing | null = null;
  await c.run('graph.first-opening-frames-the-whole-topology', {
    expected: 'the first press of Graph in the window opens the panel on a drawing framed whole: every node\'s card inside the canvas, and the drawing\'s boxes leaving margins left and right, and top and bottom, within 2 px of each other',
    plant: 'in the scratch copy, media/graph.js made to frame a drawing pushed to the right of the panel',
  }, async () => {
    need((await findGraphPanel(ctx)) === null, 'a graph panel is already open, so this is not its first opening');
    doc = await showGraph(ctx);
    first = await shownDrawing(doc);
    const f = framingOf(first);
    return {
      passed: f.whole && f.centred && first.unread.length === 0,
      seen: `${first.nodes.length} cards, ${first.containers.length} containers and ${first.edges.length} edges on a canvas ${rect(first.canvas)}; ${describeFraming(f)}${first.unread.length > 0 ? `; not read: ${first.unread.join('; ')}` : ''}`,
      evidence: { drawing: first },
    };
  });

  await c.run('graph.no-two-labels-overlap', {
    expected: 'no two labels of the first drawing share any area: each node\'s label, which is its id with the component name beneath it, and each container\'s title',
    plant: 'in the scratch copy, media/graph.js made to write each container\'s title across the middle of its box',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const labels = [
      ...d.nodes.map((n) => ({ name: `node ${n.id}`, box: n.componentBox === null ? n.idBox : union([n.idBox, n.componentBox]) })),
      ...d.containers.map((k) => ({ name: `title "${k.title}"`, box: k.titleBox })),
    ];
    const clashes: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (overlaps(labels[i].box, labels[j].box)) { clashes.push(`${labels[i].name} ${rect(labels[i].box)} over ${labels[j].name} ${rect(labels[j].box)}`); }
      }
    }
    return { passed: labels.length > 1 && clashes.length === 0, seen: `${labels.length} labels; ${clashes.length === 0 ? 'none shares any area with another' : clashes.join('; ')}` };
  });

  await c.run('graph.component-names-drawn-whole-inside-their-cards', {
    expected: 'every node whose component, as the language server\'s own graph answer names it over a reference copy, is longer than its id — every node of this folder — draws that component beneath its id in full, both lines inside its card, with no other card under either line and no edge drawn across either',
    plant: 'in the scratch copy, media/graph-model.js made to size a card against its id alone',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const ir = await irAnswer();
    const longer = Object.entries(ir).filter(([id, n]) => typeof n.component === 'string' && n.component.length > id.length);
    need(longer.length > 0, 'no node of the folder has a component name longer than its id');
    const seen: string[] = [];
    let passed = true;
    for (const [id, n] of longer) {
      const node = d.nodes.find((x) => x.id === id);
      if (node === undefined) { passed = false; seen.push(`${id}: not drawn`); continue; }
      const lines = node.componentBox === null ? [node.idBox] : [node.idBox, node.componentBox];
      const whole = node.component === n.component;
      const inCard = node.componentBox !== null && lines.every((l) => contains(node.card, l));
      const under = d.nodes.filter((o) => o.id !== id && lines.some((l) => overlaps(o.card, l))).map((o) => o.id);
      const crossed = d.edges.filter((e) => lines.some((l) => lineEnters(e.points, l, 0))).map((e) => `${e.from} → ${e.to}`);
      passed = passed && whole && inCard && under.length === 0 && crossed.length === 0;
      seen.push(`${id}: ${JSON.stringify(node.component)}${whole ? '' : ` where the answer names ${JSON.stringify(n.component)}`}, ${inCard ? 'inside its card' : `card ${rect(node.card)}, its lines ${lines.map(rect).join(' and ')}`}${under.length > 0 ? `, over the card of ${under.join(', ')}` : ''}${crossed.length > 0 ? `, crossed by ${crossed.join(', ')}` : ''}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.run('graph.release-boundaries-drawn-holding-what-they-place', {
    expected: `the drawing draws one boundary for each the Release declares (${[...declared.boundaries.keys()].join(', ')}) and no other, each titled "${boundaryTitle('<name>')}" and holding the card of every component the Release places in it and of every component of each module it routes there, as the language server's own graph answer over a reference copy names the module's components`,
    plant: 'in the scratch copy, media/graph-model.js made to set aside the boundary the compiler sends for each node, so every node lands in one box',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const ir = await irAnswer();
    const titles = d.containers.filter((k) => k.kind === 'boundary').map((k) => k.title);
    const want = [...declared.boundaries.keys()].map(boundaryTitle);
    const sameSet = titles.length === want.length && want.every((t) => titles.includes(t));
    const seen: string[] = [];
    let held = true;
    for (const [name, b] of declared.boundaries) {
      const box = containerTitled(d, 'boundary', boundaryTitle(name));
      const ids = [...b.components, ...Object.keys(ir).filter((id) => b.modules.some((m) => id.startsWith(`${m}.`)))];
      const outside = ids.filter((id) => { const n = d.nodes.find((x) => x.id === id); return box === undefined || n === undefined || !contains(box.box, n.card); });
      held = held && box !== undefined && ids.length > 0 && outside.length === 0;
      seen.push(`${name}: ${box === undefined ? 'no box titled so' : `holding ${ids.length - outside.length} of ${JSON.stringify(ids)}`}${outside.length > 0 ? `, not ${JSON.stringify(outside)}` : ''}`);
    }
    return { passed: sameSet && held, seen: `boundary titles drawn ${JSON.stringify(titles)}; ${seen.join('; ')}` };
  });

  await c.run('graph.subsystems-drawn-nested-as-declared', {
    expected: `each subsystem the Aggregate declares (${declared.subsystems.map((s) => s.path).join(', ')}) is drawn as a box titled "${subsystemTitle('<path>')}", inside the box of the boundary the Release places its components in and, where it is declared inside another subsystem, inside that subsystem's box, holding the card of each component declared directly under it`,
    plant: 'in the scratch copy, media/graph-model.js made to read every subsystem as declared at the top of its Aggregate, so one declared inside another is laid out beside it',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const seen: string[] = [];
    let passed = declared.subsystems.length > 0;
    for (const s of declared.subsystems) {
      const box = containerTitled(d, 'subsystem', subsystemTitle(s.path));
      const deep = declared.subsystems.filter((x) => x.path === s.path || x.path.startsWith(`${s.path}.`)).flatMap((x) => x.components);
      const homes = [...new Set(deep.map((x) => boundaryOf(declared, x)).filter((x): x is string => x !== null))];
      const boundary = homes.length === 1 ? containerTitled(d, 'boundary', boundaryTitle(homes[0])) : undefined;
      const parentPath = s.path.includes('.') ? s.path.slice(0, s.path.lastIndexOf('.')) : null;
      const parent = parentPath === null ? undefined : containerTitled(d, 'subsystem', subsystemTitle(parentPath));
      const inBoundary = box !== undefined && boundary !== undefined && contains(boundary.box, box.box);
      const inParent = parentPath === null || (box !== undefined && parent !== undefined && contains(parent.box, box.box));
      const loose = s.components.filter((id) => { const n = d.nodes.find((x) => x.id === id); return box === undefined || n === undefined || !contains(box.box, n.card); });
      passed = passed && inBoundary && inParent && loose.length === 0;
      seen.push(`${s.path}: ${box === undefined ? 'no box titled so' : `${rect(box.box)}, ${inBoundary ? `inside ${homes[0]}` : `not inside the boundary ${homes.join(' or ')}`}${parentPath === null ? '' : inParent ? `, inside ${parentPath}` : `, not inside ${parentPath}${parent === undefined ? '' : ` ${rect(parent.box)}`}`}${loose.length > 0 ? `, not holding ${JSON.stringify(loose)}` : ''}`}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.run('graph.imported-module-component-drawn-in-its-boundary', {
    expected: 'the card of each component of a module the Release routes into a boundary — the module\'s component, as the language server\'s own graph answer names it over a reference copy — is drawn inside that boundary\'s box',
    plant: 'in the scratch copy, media/graph-model.js made to place each box by its position inside its container, unresolved against the container\'s own',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const routed = [...declared.boundaries].flatMap(([name, b]) => b.modules.map((m) => ({ boundary: name, module: m })));
    need(routed.length > 0, 'the Release routes no module into a boundary');
    const ir = await irAnswer();
    const seen: string[] = [];
    let passed = true;
    for (const r of routed) {
      const ids = Object.keys(ir).filter((id) => id.startsWith(`${r.module}.`));
      const box = containerTitled(d, 'boundary', boundaryTitle(r.boundary));
      const outside = ids.filter((id) => { const n = d.nodes.find((x) => x.id === id); return box === undefined || n === undefined || !contains(box.box, n.card); });
      passed = passed && ids.length > 0 && box !== undefined && outside.length === 0;
      seen.push(`${r.module} into ${r.boundary}: ${ids.length === 0 ? 'the answer names no component of it' : `${JSON.stringify(ids)} ${outside.length === 0 ? 'drawn inside' : `not inside: ${outside.map((id) => `${id} ${rect(cardOf(d, id))}`).join(', ')}`}`}${box === undefined ? '; no box titled so' : ` ${rect(box.box)}`}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  // The edges the Aggregate declares, by where the Release and the Aggregate
  // place their ends: in different boundaries; in one subsystem of one boundary;
  // and in different containers of either kind.
  const crossing = declared.uses.filter((u) => boundaryOf(declared, u.from) !== boundaryOf(declared, u.to));
  const inner = declared.uses.filter((u) => subsystemOf(declared, u.from) !== null && subsystemOf(declared, u.from) === subsystemOf(declared, u.to) && boundaryOf(declared, u.from) === boundaryOf(declared, u.to));
  const spanning = declared.uses.filter((u) => boundaryOf(declared, u.from) !== boundaryOf(declared, u.to) || subsystemOf(declared, u.from) !== subsystemOf(declared, u.to));
  // endsOnCards reads whether a drawn line starts on one card's border and ends
  // on the other's.
  const endsOnCards = (points: { x: number; y: number }[], from: DrawnNode | undefined, to: DrawnNode | undefined): boolean =>
    points.length >= 2 && from !== undefined && to !== undefined && onBorder(from.card, points[0]) && onBorder(to.card, points[points.length - 1]);
  await c.run('graph.edge-between-boundaries-runs-from-one-card-to-the-other', {
    expected: `each edge the Aggregate declares between components the Release places in different boundaries (${crossing.map((u) => `${u.from} → ${u.to}`).join(', ')}) is drawn, its line starting on the card of the component that uses — inside that component's boundary and subsystem — and ending on the card of the one it uses, inside the boundary and subsystem the drawing names for that one`,
    plant: 'in the scratch copy, media/graph-model.js made to place each box by its position inside its container, unresolved against the container\'s own',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    need(crossing.length > 0, 'the Aggregate declares no edge between components in different boundaries');
    const d = first;
    const ir = await irAnswer();
    const seen: string[] = [];
    let passed = true;
    for (const u of crossing) {
      const e = d.edges.find((x) => x.from === u.from && x.to === u.to);
      const from = d.nodes.find((n) => n.id === u.from);
      const to = d.nodes.find((n) => n.id === u.to);
      const want = [u.from, u.to].map((id) => {
        const n = ir[id];
        return [boundaryTitle(boundaryOf(declared, id) ?? ''), subsystemTitle(n?.subsystem_path ?? subsystemOf(declared, id) ?? '')];
      });
      const homeOf = (n: DrawnNode | undefined): string[] => (n === undefined ? [] : holdingCard(d, n).map((k) => k.title));
      const homed = [from, to].every((n, i) => want[i].every((t) => homeOf(n).includes(t)));
      const ends = e !== undefined && endsOnCards(e.points, from, to);
      passed = passed && e !== undefined && ends && homed;
      seen.push(`${u.from} → ${u.to}: ${e === undefined ? 'not drawn' : `${e.points.length} points, ${ends ? 'from one card\'s border to the other\'s' : `from ${JSON.stringify(e.points[0])} to ${JSON.stringify(e.points[e.points.length - 1])}, cards ${rect(from?.card)} and ${rect(to?.card)}`}`}; ${u.from} drawn in ${JSON.stringify(homeOf(from))}, ${u.to} in ${JSON.stringify(homeOf(to))}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.run('graph.edge-inside-a-subsystem-stays-inside-it', {
    expected: `each edge the Aggregate declares between two components of one subsystem placed in one boundary (${inner.map((u) => `${u.from} → ${u.to}`).join(', ')}) is drawn from one card's border to the other's with every point of its line inside that subsystem's box`,
    plant: 'in the scratch copy, media/graph-model.js made to read an edge\'s geometry as stated against the whole drawing rather than against the container it belongs to',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    need(inner.length > 0, 'the Aggregate declares no edge inside one subsystem');
    const d = first;
    const seen: string[] = [];
    let passed = true;
    for (const u of inner) {
      const e = d.edges.find((x) => x.from === u.from && x.to === u.to);
      const box = containerTitled(d, 'subsystem', subsystemTitle(subsystemOf(declared, u.from) ?? ''));
      const out = e === undefined || box === undefined ? [] : e.points.filter((p) => !containsPoint(box.box, p));
      const ends = e !== undefined && endsOnCards(e.points, d.nodes.find((n) => n.id === u.from), d.nodes.find((n) => n.id === u.to));
      passed = passed && e !== undefined && box !== undefined && out.length === 0 && ends;
      seen.push(`${u.from} → ${u.to}: ${e === undefined ? 'not drawn' : box === undefined ? 'no subsystem box' : `${e.points.length} points, ${out.length === 0 ? `all inside ${box.title}` : `${out.length} outside ${box.title} ${rect(box.box)}: ${JSON.stringify(out)}`}${ends ? '' : ', not running from one card to the other'}`}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.run('graph.no-edge-crosses-a-container-it-has-no-end-in', {
    expected: `in the drawing of ${RELEASE}, whose Aggregate declares edges between components it and the Release place in different containers (${spanning.map((u) => `${u.from} → ${u.to}`).join(', ')}), each of those edges is drawn and no edge's line runs through the inside of a container that holds neither of its two cards`,
    plant: 'in the scratch copy, media/graph.js made to draw each edge as one straight line between its first and its last point',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    need(spanning.length > 0, `the Aggregate declares no edge of ${RELEASE} between components in different containers, so none can cross a container it has no end in`);
    const d = first;
    const undrawn = spanning.filter((u) => !d.edges.some((e) => e.from === u.from && e.to === u.to)).map((u) => `${u.from} → ${u.to}`);
    const seen: string[] = [];
    let passed = undrawn.length === 0;
    for (const e of d.edges) {
      const ends = d.nodes.filter((n) => n.id === e.from || n.id === e.to);
      const foreign = d.containers.filter((k) => !ends.some((n) => contains(k.box, n.card)));
      const crossed = foreign.filter((k) => lineEnters(e.points, k.box));
      passed = passed && crossed.length === 0;
      seen.push(`${e.from} → ${e.to}: ${crossed.length === 0 ? `through none of the ${foreign.length} container(s) holding neither end` : `through ${crossed.map((k) => `${k.title} ${rect(k.box)}`).join(', ')}`}`);
    }
    return { passed, seen: `${RELEASE}${undrawn.length > 0 ? `, not drawn: ${JSON.stringify(undrawn)}` : ''}; ${seen.join('; ')}` };
  });

  // ---- the legend ----
  await c.run('legend.lower-left-names-the-groupings-and-the-type-bar-and-bounds-the-colours', {
    expected: `beside the first drawing, a legend at the lower left of the panel — nearer its left edge than its right, and nearer its foot than its head — reading as the layout model declares it: headed "${legend.LEGEND_TITLE}", its rows reading ${legend.LEGEND_ROWS.map((r) => `"${r.text}"`).join(', ')} in that order, and its note "${legend.LEGEND_NOTE}"`,
    plant: 'in the scratch copy, media/graph.css made to draw the legend at the upper right; or media/graph-model.js made to drop the note\'s second sentence',
  }, async () => {
    need(doc !== null && first !== null, 'the graph was not drawn');
    const l = await readLegend(doc);
    const cv = first.canvas;
    const left = l.box.x - cv.x;
    const right = cv.x + cv.width - (l.box.x + l.box.width);
    const top = l.box.y - cv.y;
    const foot = cv.y + cv.height - (l.box.y + l.box.height);
    const lowerLeft = left < right && foot < top;
    const rows = l.rows.map((r) => r.text);
    const passed = l.shown && lowerLeft && l.title === legend.LEGEND_TITLE && JSON.stringify(rows) === JSON.stringify(legend.LEGEND_ROWS.map((r) => r.text)) && l.note === legend.LEGEND_NOTE;
    return {
      passed,
      seen: `${l.shown ? `drawn at ${rect(l.box)}, ${left.toFixed(0)} px from the left and ${right.toFixed(0)} from the right, ${foot.toFixed(0)} from the foot and ${top.toFixed(0)} from the head` : 'not drawn'}; headed ${JSON.stringify(l.title)}; rows ${JSON.stringify(rows)}; note ${l.note === legend.LEGEND_NOTE ? 'as declared' : JSON.stringify(l.note)}`,
      evidence: { legend: l },
    };
  });

  const groupingRows = legend.LEGEND_ROWS.filter((r) => r.swatch === 'boundary' || r.swatch === 'subsystem');
  await c.run('legend.grouping-rows-name-the-declaring-document-and-are-drawn-whole', {
    expected: `with both a boundary and a subsystem declared by the folder, the legend's grouping rows read as the layout model declares them, each naming the document that declares the grouping (${groupingRows.map((r) => `"${r.text}"`).join(' and ')}), and each row is drawn whole: its drawn text the whole sentence, its box inside the legend's and inside the panel`,
    plant: 'in the scratch copy, media/graph-model.js made to word the boundary row by where its box sits; or media/graph.css made to hold the legend to a width its rows are cut off at',
  }, async () => {
    need(doc !== null, 'the graph was not drawn');
    need(declared.boundaries.size > 0 && declared.subsystems.length > 0, 'the folder does not declare both a boundary and a subsystem, so the two rows are not exercised');
    const l = await readLegend(doc);
    const seen: string[] = [];
    let passed = l.shown && groupingRows.length === 2;
    for (const want of groupingRows) {
      const row = l.rows.find((r) => r.swatch === want.swatch);
      const worded = row !== undefined && row.text === want.text;
      const whole = row !== undefined && row.drawn === row.text && contains(l.box, row.box) && contains(l.view, row.box);
      passed = passed && worded && whole;
      seen.push(row === undefined ? `no ${want.swatch} row drawn` : `${JSON.stringify(row.text)}${worded ? '' : ` where "${want.text}" is declared`}, drawn ${whole ? 'whole' : `as ${JSON.stringify(row.drawn)} at ${rect(row.box)} in a legend at ${rect(l.box)} and a panel ${rect(l.view)}`}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.forPerson('legend.legible-in-the-panel-font', {
    expected: 'the legend draws at all, neither grouping row is clipped or cut short by the panel, and the em-dash in each row reads legibly in the font the panel draws it in',
    plant: 'none: this is a judgement of the drawn legend',
    question: 'In the capture, is the legend legible: both grouping rows whole, nothing cut off by the panel, and the em-dash in each row clear in the panel\'s font (named below)?',
  }, async () => {
    need(doc !== null, 'the graph was not drawn');
    const l = await readLegend(doc);
    const fonts: string[] = [];
    for (const n of [2, 3]) {
      const f = await ctx.d.platformFonts(doc, `#legend > .legend-row:nth-child(${n}) .legend-text`).then(
        (p) => `${p.cssFontFamily ?? 'no family'} → ${p.fonts.map((x) => `${x.familyName} (${x.glyphCount} glyphs)`).join(', ')}`,
        (err: unknown) => `the fonts could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
      fonts.push(`row ${n - 1}: ${f}`);
    }
    await putAwayNotifications(ctx);
    return { screenshot: await capture(ctx, 'graph-legend'), drawnText: [l.title, ...l.rows.map((r) => r.drawn), l.note, ...fonts].join('\n') };
  });

  await c.forPerson('graph.reads-well-as-a-whole', {
    expected: 'the first drawing reads well: each card\'s id and component legible, the boundaries and subsystems telling apart what they hold, and each edge easy to follow from one card to the other',
    plant: 'none: this is a judgement of the drawing',
    question: 'In the capture of the first drawing, does the graph read well — names legible, the boxes telling apart what they hold, the edges easy to follow?',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const lines = [
      ...d.containers.map((k) => `${k.title} ${rect(k.box)}`),
      ...d.nodes.map((n) => `${n.id}${n.component === null ? '' : ` / ${n.component}`} ${rect(n.card)}`),
      ...d.edges.map((e) => `${e.from} → ${e.to}`),
    ];
    // A notification the editor draws over the panel would hide part of what is
    // to be judged; it is put away, and stays in the notification centre.
    await putAwayNotifications(ctx);
    return { screenshot: await capture(ctx, 'graph-first-drawing'), drawnText: lines.join('\n') };
  });

  // ---- when the graph draws itself again ----
  let saveRedraw: { ms: number | null; missed: string; drawnAt: number; noticeFrom: number; toastFrom: number } | null = null;
  await c.run('graph.typing-moves-the-problems-panel-and-not-the-drawing', {
    expected: `typing the key of the cache's type line as "${CACHE_MISKEYED}", unsaved, puts in the Problems panel on the Aggregate the findings the language server's own validation answers for the same text over a reference copy, while the drawing is not drawn again and still writes "${componentOf(CACHE_TYPE)}" beneath ${CACHE} (watched for 5 s); the control, read by the same reading: once the line reads "${CACHE_SWITCHED}" and the Aggregate is saved, the drawing is drawn again writing it`,
    plant: 'in the scratch copy, out/src/extension.js made to redraw an open graph on every change of a document\'s text',
  }, async () => {
    need(doc !== null && first !== null, 'the graph was not drawn');
    const d = doc;
    const typed = originalAggregate.replace(CACHE_TYPE, CACHE_MISKEYED);
    need(typed !== originalAggregate, `the Aggregate holds no "${CACHE_TYPE}" line to type over`);
    const ref = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/validate', params: buildValidateParams(path.join(reference, 'aggregate.yaml'), typed, RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    const wanted = ref.ok ? ((ref.result as { diagnostics?: { message: string }[] | null }).diagnostics ?? []).map((x) => x.message) : [];
    need(wanted.length > 0, `the language server's own validation of the typed text answers no finding: ${JSON.stringify(ref).slice(0, 300)}`);
    const renders = (await graphState(d)).renders;
    const typedLine = await rewriteLine(ctx, aggregate, CACHE_TYPE, CACHE_MISKEYED);
    const filed = await waited(until('the Problems panel following the typed text', 20000, () => diagnostics(ctx, aggregate), (v) => wanted.every((m) => v.some((x) => x.source === 'aggrega' && x.message === m))));
    const shown = await diagnostics(ctx, aggregate);
    const still = await holds(5000, async () => ({ renders: (await graphState(d)).renders, component: await componentDrawn(d, CACHE) }),
      (v) => v.renders === renders && v.component === componentOf(CACHE_TYPE));
    const switched = await rewriteAt(ctx, typedLine, CACHE_SWITCHED);
    const noticeFrom = await watchNotice(d);
    const toastFrom = (await toasts(ctx.d)).length;
    const savedAt = Date.now();
    await savedAs(ctx, switched);
    const after = await waited(redrawn(d, renders, CACHE, componentOf(CACHE_SWITCHED), 'the drawing after the save'));
    saveRedraw = { ms: after.met ? Date.now() - savedAt : null, missed: missedOf(after), drawnAt: Date.now(), noticeFrom, toastFrom };
    return {
      passed: filed.met && still.held && after.met,
      seen: `the Problems panel ${filed.met ? 'followed the typed text' : `did not follow the typed text (${filed.missed})`}: ${describeDiagnostics(aggregate, shown)}, the server answering ${JSON.stringify(wanted)}; while it stood typed ${still.held ? `the drawing was not drawn again over ${still.readings} readings` : `the drawing read ${JSON.stringify(still.broke)} at ${still.atMs} ms`}; after the save ${after.met ? `it was drawn again writing ${componentOf(CACHE_SWITCHED)}` : `it was not drawn again (${after.missed})`}`,
    };
  });

  await c.run('graph.save-redraws-the-drawing-with-no-press', {
    expected: `the save of the Aggregate with the cache's type switched alone draws the graph again within 10 s, with no press on Graph, writing "${componentOf(CACHE_SWITCHED)}" beneath ${CACHE}, and from that save until ${SETTLE_MS / 1000} s after the drawing no notice is put up at the panel's top (the notice a press puts up is read by the same observer in this scenario)`,
    plant: 'in the scratch copy, out/src/extension.js made not to redraw an open graph when a document changes on disk',
  }, async () => {
    need(doc !== null && saveRedraw !== null, 'the Aggregate was not saved with the graph open');
    const d = doc;
    const r = saveRedraw;
    // The observer has recorded every change since the save; the window is kept
    // open until SETTLE_MS after the drawing, and its record then read whole.
    await holds(Math.max(0, r.drawnAt + SETTLE_MS - Date.now()), () => noticeReadings(d, r.noticeFrom), (v) => v.every((x) => x.text === ''));
    const notices = (await noticeReadings(d, r.noticeFrom)).filter((x) => x.text !== '');
    const said = (await toastsSince(ctx.d, r.toastFrom)).map((t) => t.message);
    return {
      passed: notices.length === 0 && r.ms !== null && r.ms <= 10000,
      seen: `${r.ms === null ? `not drawn again: ${r.missed}` : `drawn again ${r.ms} ms after the save`}; the panel's notice ${notices.length === 0 ? `stayed down from the save until ${SETTLE_MS} ms after ${r.ms === null ? 'the wait for the drawing ran out' : 'the drawing'}` : `read ${JSON.stringify(notices.map((x) => x.text))}`}; notifications drawn since the save: ${JSON.stringify(said)}`,
    };
  });

  await c.run('graph.write-from-outside-the-editor-redraws-the-drawing', {
    expected: `with the graph open and the Aggregate saved, writing the Aggregate's file from outside the editor with the cache's type back to "${componentOf(CACHE_TYPE)}" draws the graph again within 30 s writing it, with no press`,
    plant: 'in the scratch copy, out/src/extension.js made not to redraw an open graph when a document changes on disk',
  }, async () => {
    need(doc !== null && saveRedraw !== null, 'the Aggregate was not saved with the graph open');
    const renders = (await graphState(doc)).renders;
    fs.writeFileSync(aggregate, originalAggregate);
    const after = await waited(redrawn(doc, renders, CACHE, componentOf(CACHE_TYPE), 'the drawing after the write from outside', stated(30000)));
    return { passed: after.met, seen: after.met ? `drawn again writing ${componentOf(CACHE_TYPE)}` : `not drawn again (${after.missed}); ${CACHE} reads ${JSON.stringify(await componentDrawn(doc, CACHE))}` };
  });

  // ---- what a redraw leaves alone ----
  let zoomed: DrawnNode | null = null;
  await c.run('graph.redraw-after-a-save-keeps-the-view-and-the-selection', {
    expected: `with ${ADMIN} selected and the panel zoomed into it past the frame the first drawing was given, switching the cache's type and saving draws the graph again with the change and leaves ${ADMIN}'s card at the same place at the same size, still selected, the attachments panel still naming it`,
    plant: 'in the scratch copy, media/graph.js made to frame every drawing afresh, asked for or not; or made to drop the selection on every drawing',
  }, async () => {
    need(doc !== null && first !== null, 'the graph was not drawn');
    const d = doc;
    const fitted = first.nodes.find((n) => n.id === ADMIN);
    need(fitted !== undefined, `the first drawing holds no ${ADMIN}`);
    await pressNode(ctx, d, ADMIN);
    const before = await zoomInto(ctx, d, ADMIN, ZOOM_TURNS);
    zoomed = before;
    const renders = (await graphState(d)).renders;
    await savedAs(ctx, await rewriteLine(ctx, aggregate, CACHE_TYPE, CACHE_SWITCHED));
    const changed = await waited(redrawn(d, renders, CACHE, componentOf(CACHE_SWITCHED), 'the drawing after the save'));
    const after = (await readDrawing(d)).nodes.find((n) => n.id === ADMIN);
    const panel = await readPanel(d);
    const kept = after !== undefined && sameRect(before.card, after.card);
    const passed = changed.met && kept && after.selected && panel?.title === ADMIN && before.card.height > fitted.card.height;
    return {
      passed,
      seen: `${ADMIN}'s card at the first frame ${rect(fitted.card)}, zoomed to ${rect(before.card)}; the drawing ${changed.met ? 'drawn again with the change' : `not drawn again with the change (${changed.missed})`}; after it ${after === undefined ? `no ${ADMIN}` : `${rect(after.card)}, ${after.selected ? 'selected' : 'not selected'}`}; the attachments panel names ${JSON.stringify(panel?.title ?? null)}`,
    };
  });

  await c.run('graph.redraw-of-an-addition-keeps-the-view-and-draws-it-once', {
    expected: `adding a component "${ADDED}" beside ${CACHE} in the Aggregate and beside it in the Release's data boundary, both saved together, draws the graph again once — one drawing reaching it, no notice put up on the way, and no second drawing over the ${SETTLE_MS / 1000} s after it — with "${ADDED}" drawn inside the boxes titled "${subsystemTitle('backend')}" and "${boundaryTitle('data')}", and keeps the frame the reader's zoom put the drawing at: the pan and zoom the panel's document carries on the drawing read the same before the redraw and after it, that frame zoomed past the one the first drawing was given (${ADMIN}'s card drawn larger in it than in the first drawing)`,
    plant: 'in the scratch copy, media/graph.js made to frame every drawing afresh, asked for or not',
  }, async () => {
    need(doc !== null && zoomed !== null && first !== null, 'the panel was not zoomed into a node');
    const d = doc;
    const fitted = first.nodes.find((n) => n.id === ADMIN);
    const before = (await readDrawing(d)).nodes.find((n) => n.id === ADMIN);
    need(fitted !== undefined && before !== undefined, `the drawing holds no ${ADMIN}`);
    const frameBefore = await readFrame(d);
    const renders = (await graphState(d)).renders;
    // The new component goes beside the cache, its key where the cache's is and
    // its type where the cache's is, and beside the cache in the data boundary.
    const key = lineOnDisk(aggregate, `${CACHE}:`);
    const typed = lineOnDisk(aggregate, CACHE_SWITCHED);
    need(typed.index === key.index + 1, `the cache's type is not the line after its key in ${path.basename(aggregate)}`);
    const placed = lineOnDisk(releaseFile, `${CACHE}: {}`);
    const aggregateAdded = await insertBelow(ctx, typed, [`${key.indent}${ADDED}:`, `${typed.indent}${CACHE_TYPE}`]);
    const releaseAdded = await insertBelow(ctx, placed, [`${placed.indent}${ADDED}: {}`]);
    const from = await watchNotice(d);
    // Saved together: the two writes reach the disk a moment apart, as Save All
    // writes them.
    await savedAs(ctx, aggregateAdded, releaseAdded);
    const reached = await waited(until('the drawing holding the addition', 30000, async () => ({ renders: (await graphState(d)).renders, ids: (await drawnText(d)).map((n) => n.id) }),
      (v) => v.renders > renders && v.ids.includes(ADDED)));
    const once = reached.met ? reached.value.renders : null;
    const quiet = once === null ? null : await holds(SETTLE_MS, async () => (await graphState(d)).renders, (v) => v === once);
    const notices = (await noticeReadings(d, from)).filter((x) => x.text !== '').map((x) => x.text);
    const after = await readDrawing(d);
    const frameAfter = await readFrame(d);
    const added = after.nodes.find((n) => n.id === ADDED);
    const homes = added === undefined ? [] : holdingCard(after, added).map((k) => k.title);
    const admin = after.nodes.find((n) => n.id === ADMIN);
    const kept = frameBefore !== null && frameAfter === frameBefore;
    const zoomedPast = before.card.height > fitted.card.height;
    const landed = homes.includes(subsystemTitle('backend')) && homes.includes(boundaryTitle('data'));
    return {
      passed: once === renders + 1 && quiet !== null && quiet.held && notices.length === 0 && landed && kept && zoomedPast,
      seen: `${once === null ? `not drawn again with the addition (${missedOf(reached)})` : `drawn ${once - renders} time(s) to reach it${quiet?.held ? `, and not again over ${SETTLE_MS} ms` : `, and again at ${quiet?.atMs} ms`}`}; the panel's notice ${notices.length === 0 ? 'stayed down' : `read ${JSON.stringify(notices)}`}; ${ADDED} ${added === undefined ? 'not drawn' : `drawn in ${JSON.stringify(homes)}`}; the frame ${JSON.stringify(frameBefore)} before, ${JSON.stringify(frameAfter)} after${kept ? ', the same' : ''}; ${ADMIN}'s card ${rect(fitted.card)} in the first drawing, ${rect(before.card)} before the redraw${zoomedPast ? '' : ', not zoomed past the first drawing'}, ${admin === undefined ? 'gone' : rect(admin.card)} after`,
    };
  });

  await c.run('graph.press-frames-the-whole-topology-afresh', {
    expected: 'from a view zoomed so that cards lie past the canvas\'s edges, pressing Graph draws the topology framed whole: every card inside the canvas, the drawing\'s margins even within 2 px',
    plant: 'in the scratch copy, media/graph.js made never to frame a drawing afresh once it has been framed',
  }, async () => {
    need(doc !== null && zoomed !== null, 'the panel was not zoomed into a node');
    const before = framingOf(await readDrawing(doc));
    need(!before.whole, 'the zoomed view still holds every card inside the canvas, so a press framing afresh cannot be told from one leaving the view');
    const d = await pressedDrawing(ctx, doc);
    doc = d;
    const after = await shownDrawing(d);
    const f = framingOf(after);
    return { passed: f.whole && f.centred, seen: `before the press ${describeFraming(before)}; after it ${describeFraming(f)}` };
  });

  // ---- a redraw that fails ----
  let words = '';
  let failedSave: { text: string; outOfDate: boolean; nodes: number } | null = null;
  await c.run('graph.failed-redraw-after-a-save-dims-the-drawing-and-says-so', {
    expected: `with a good drawing on screen, pointing ${ADMIN}'s type at "${componentOf(ADMIN_BROKEN)}" and saving leaves the drawing on the canvas, dimmed, under the notice "${staleDrawing(RELEASE)} <message>" — <message> being the language server's own answer to the same graph request over a reference copy broken the same way; the dimming and the words are read apart`,
    plant: 'in the scratch copy, media/graph.js made not to dim a drawing the compiler could not rebuild; or out/src/graph-failure.js made to send the panel the thrown value rendered as a string',
  }, async () => {
    need(doc !== null, 'the graph was not drawn');
    const d = doc;
    // The folder as it was found, so it is the reference copy broken one way.
    const renders = (await graphState(d)).renders;
    fs.writeFileSync(aggregate, originalAggregate);
    fs.writeFileSync(releaseFile, originalRelease);
    const putBack = await waited(until('the drawing of the folder as it was found', 30000, async () => ({ s: await graphState(d), ids: (await drawnText(d)).map((n) => n.id) }),
      (v) => v.s.renders > renders && !v.ids.includes(ADDED) && v.s.status === '' && !v.s.outOfDate));
    need(putBack.met, `the folder written back as it was found did not draw again cleanly, so there is no good drawing to break: ${missedOf(putBack)}`);
    const refAggregate = path.join(reference, 'aggregate.yaml');
    const refText = fs.readFileSync(refAggregate, 'utf8');
    fs.writeFileSync(refAggregate, refText.replace(ADMIN_TYPE, ADMIN_BROKEN));
    const ref = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/irGraph', params: { release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    fs.writeFileSync(refAggregate, refText);
    need(!ref.ok, 'the language server drew the reference copy with the admin console\'s type broken');
    words = ref.error.message.split(reference).join(ctx.folder);
    const ids = (await drawnText(d)).map((n) => n.id);
    const from = await watchNotice(d);
    await savedAs(ctx, await rewriteLine(ctx, aggregate, ADMIN_TYPE, ADMIN_BROKEN));
    const said = await until('the notice the failed redraw puts up', 30000, () => noticeReadings(d, from), (v) => v.some((x) => x.text !== '' && !x.text.startsWith(layingOut(RELEASE))));
    const last = said[said.length - 1];
    failedSave = { text: last.text, outOfDate: last.outOfDate, nodes: last.nodes };
    const kept = JSON.stringify((await drawnText(d)).map((n) => n.id)) === JSON.stringify(ids);
    const wordsRight = last.text === `${staleDrawing(RELEASE)} ${words}`;
    return {
      passed: wordsRight && last.outOfDate && kept,
      seen: `the words: ${wordsRight ? 'as expected' : `"${last.text}"`}; the dimming: ${last.outOfDate ? 'dimmed' : 'NOT dimmed'}; the drawing ${kept ? `kept, ${ids.length} cards` : 'not kept'}; the language server's answer "${words}"`,
    };
  });

  await c.run('graph.press-on-the-same-fault-ends-in-the-same-presentation', {
    expected: `with the fault still saved, pressing Graph puts up "${layingOut(RELEASE)}" for a moment (caught as it is drawn) and ends in the same presentation the save ended in: the same words and the same dimming, the drawing still on the canvas`,
    plant: 'in the scratch copy, media/graph.js made to put up no notice while a pressed drawing is laid out; or out/src/graph-view.js made to send a failure the reader pressed for without the Release it is about',
  }, async () => {
    need(doc !== null && failedSave !== null, 'the failed redraw after the save was not read');
    const d = doc;
    const saved = failedSave;
    const from = await watchNotice(d);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const ended = await waited(until('the press laid out and ended', 60000, () => noticeReadings(d, from), (v) => {
      const lay = v.findIndex((x) => x.text === layingOut(RELEASE));
      return lay !== -1 && v.slice(lay + 1).some((x) => x.text !== '' && x.text !== layingOut(RELEASE));
    }));
    const readings = ended.met ? ended.value : await noticeReadings(d, from);
    const laid = readings.some((x) => x.text === layingOut(RELEASE));
    const end = readings.filter((x) => x.text !== '' && x.text !== layingOut(RELEASE)).pop();
    const same = end !== undefined && end.text === saved.text && end.outOfDate === saved.outOfDate && end.nodes > 0;
    return {
      passed: ended.met && laid && same,
      seen: `${ended.met ? '' : `${ended.missed}; `}the notices read ${JSON.stringify(readings.map((x) => `${x.text || '(none)'}${x.outOfDate ? ' [dimmed]' : ''}`))}; the save ended in "${saved.text}"${saved.outOfDate ? ', dimmed' : ''}`,
    };
  });

  await c.run('graph.good-redraw-lifts-the-dimming', {
    expected: `pointing ${ADMIN}'s type back at "${componentOf(ADMIN_TYPE)}" and saving draws the graph again with the dimming lifted and no notice at the panel's top`,
    plant: 'in the scratch copy, media/graph.js made to leave the dimming on a drawing that is rebuilt',
  }, async () => {
    need(doc !== null && failedSave !== null, 'the drawing was not left dimmed by a failed redraw');
    const d = doc;
    const renders = (await graphState(d)).renders;
    await savedAs(ctx, await rewriteLine(ctx, aggregate, ADMIN_BROKEN, ADMIN_TYPE));
    const drawnAgain = await waited(until('the drawing rebuilt', 30000, () => graphState(d), (s) => s.renders > renders && s.nodes.length > 0));
    const lifted = await waited(until('the notice down and the dimming lifted', 5000, () => graphState(d), (v) => !v.outOfDate && v.status === ''));
    const s = lifted.met ? lifted.value : await graphState(d);
    return {
      passed: drawnAgain.met && lifted.met,
      seen: `${drawnAgain.met ? 'drawn again' : `not drawn again (${drawnAgain.missed})`}; ${s.outOfDate ? 'still dimmed' : 'not dimmed'}; the notice ${s.status === '' ? 'down' : `"${s.status}"`}${lifted.met ? '' : ` (${lifted.missed})`}`,
    };
  });

  await c.run('graph.failure-with-nothing-drawn-claims-no-drawing-out-of-date', {
    expected: `with the panel closed and the fault saved again, pressing Graph opens a panel that names the failure as "${RELEASE}: <message>" — the language server's own words for the same fault over the reference copy broken the same way — and that, from its opening until ${SETTLE_MS / 1000} s after it names the failure, draws no card and is never dimmed, so it claims no drawing out of date; read by the observer the dimming of the failed redraw is read by in this scenario`,
    plant: 'in the scratch copy, media/graph.js made to read the canvas as holding a drawing whether or not it does',
  }, async () => {
    need(doc !== null && words !== '', 'the language server\'s words for the fault were not read');
    await closeGraphPanel(ctx);
    await savedAs(ctx, await rewriteLine(ctx, aggregate, ADMIN_TYPE, ADMIN_BROKEN));
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const d = await until('the graph panel opening', 30000, () => findGraphPanel(ctx), (x) => x !== null) as WebviewDocument;
    doc = d;
    // The panel this press opened is a new document, so the observer installed
    // in it now records, from its first reading on, only this panel's states.
    await watchNotice(d);
    const named = await waited(until('the panel naming the failure', 60000, () => noticeReadings(d), (v) => v.some((x) => x.text !== '' && !x.text.startsWith(layingOut(RELEASE)))));
    const nothing = (v: { outOfDate: boolean; nodes: number }[]): boolean => v.every((x) => !x.outOfDate && x.nodes === 0);
    const after = named.met ? await holds(SETTLE_MS, () => noticeReadings(d), nothing) : null;
    const readings = await noticeReadings(d);
    const last = readings.filter((x) => x.text !== '' && !x.text.startsWith(layingOut(RELEASE))).pop();
    const passed = named.met && after !== null && after.held && nothing(readings) && last?.text === `${RELEASE}: ${words}`;
    return {
      passed,
      seen: `${named.met ? `the notice "${last?.text ?? ''}"` : `the failure not named (${named.missed})`}; from the panel's opening ${nothing(readings) ? `until ${SETTLE_MS} ms after it named the failure, no card drawn and never dimmed` : `the readings ${JSON.stringify(readings.map((x) => `${x.text || '(none)'}${x.outOfDate ? ' [dimmed]' : ''}, ${x.nodes} cards`))}`}`,
    };
  });
  // ---- a drawing that lands behind another tab ----
  await c.run('graph.first-drawing-behind-another-tab-framed-on-return', {
    expected: `the panel just opened on the faulty Release, having drawn nothing, is put behind the Aggregate's tab and told it is off screen; mending ${ADMIN}'s type and saving there draws the panel's first drawing while it is behind — read in its document before it is brought back — and once it is brought back and told it is on screen that drawing is framed whole: every card inside the canvas, the margins even within 2 px, card for card where a press of Graph with the panel in front frames it`,
    plant: 'in the scratch copy, media/graph.js made to frame a drawing that arrives off screen against a size of its own choosing',
  }, async () => {
    need(doc !== null && (await graphState(doc)).nodes.length === 0 && fs.readFileSync(aggregate, 'utf8').includes(ADMIN_BROKEN), 'no panel is open on the faulty Release having drawn nothing');
    const d = doc;
    const hiddenFrom = await watchVisibility(d);
    const behind = await putBehind(ctx, aggregate);
    need(behind.met, `the graph panel could not be put behind another tab: ${missedOf(behind)}`);
    const hidden = await waited(told(d, hiddenFrom, false));
    if (!hidden.met) { return { passed: false, seen: `put behind the Aggregate's tab, the panel was not told it is off screen: ${hidden.missed}` }; }
    await savedAs(ctx, await rewriteLine(ctx, aggregate, ADMIN_BROKEN, ADMIN_TYPE));
    const landed = await waited(until('the first drawing behind the tab', 30000, () => graphState(d), (s) => s.nodes.length > 0));
    const stillBehind = !(await graphTabInFront(ctx.d));
    if (!landed.met) { return { passed: false, seen: `the panel drew nothing behind the tab once the mended Aggregate was saved: ${landed.missed}` }; }
    const shownFrom = (await visibilityReadings(d)).length;
    await revealGraphTab(ctx);
    const onScreen = await waited(told(d, shownFrom, true));
    if (!onScreen.met) { return { passed: false, seen: `brought back, the panel was not told it is on screen: ${onScreen.missed}` }; }
    const back = await shownDrawing(d);
    const f = framingOf(back);
    // The control: the same panel, in front, framed by a press.
    const pressed = await pressedDrawing(ctx, d);
    const framed = await shownDrawing(pressed);
    const differs = back.nodes.filter((n) => { const m = framed.nodes.find((x) => x.id === n.id); return m === undefined || !sameRect(n.card, m.card); }).map((n) => n.id);
    return {
      passed: stillBehind && f.whole && f.centred && differs.length === 0 && back.nodes.length === framed.nodes.length,
      seen: `the first drawing landed ${stillBehind ? 'while the panel was behind the tab' : 'once the panel was back in front'}; on return ${describeFraming(f)}; against a press with the panel in front, ${differs.length === 0 ? 'every card in the same place' : `cards elsewhere: ${differs.map((id) => `${id} ${rect(cardOf(back, id))} against ${rect(cardOf(framed, id))}`).join('; ')}`}`,
    };
  });

  await c.run('graph.redraw-behind-another-tab-keeps-the-view', {
    expected: `with the panel zoomed into ${GATEWAY} and then put behind the Aggregate's tab and told it is off screen, one save switching the cache's type draws the graph again while it is behind — read in its document before it is brought back — and once it is brought back and told it is on screen ${GATEWAY}'s card is at the same place at the same size, the change drawn`,
    plant: 'in the scratch copy, media/graph.js made to frame every drawing afresh, asked for or not',
  }, async () => {
    need(doc !== null && (await graphState(doc)).nodes.length > 0, 'no drawing is on screen');
    const d = doc;
    await revealGraphTab(ctx);
    const before = await zoomInto(ctx, d, GATEWAY, ZOOM_TURNS);
    const hiddenFrom = await watchVisibility(d);
    const behind = await putBehind(ctx, aggregate);
    need(behind.met, `the graph panel could not be put behind another tab: ${missedOf(behind)}`);
    const hidden = await waited(told(d, hiddenFrom, false));
    if (!hidden.met) { return { passed: false, seen: `put behind the Aggregate's tab, the panel was not told it is off screen: ${hidden.missed}` }; }
    const renders = (await graphState(d)).renders;
    await savedAs(ctx, await rewriteLine(ctx, aggregate, CACHE_TYPE, CACHE_SWITCHED));
    const landed = await waited(redrawn(d, renders, CACHE, componentOf(CACHE_SWITCHED), 'the drawing behind the tab'));
    const stillBehind = !(await graphTabInFront(ctx.d));
    const shownFrom = (await visibilityReadings(d)).length;
    await revealGraphTab(ctx);
    const onScreen = await waited(told(d, shownFrom, true));
    const after = onScreen.met ? (await shownDrawing(d)).nodes.find((n) => n.id === GATEWAY) : undefined;
    const kept = after !== undefined && sameRect(before.card, after.card);
    return {
      passed: landed.met && stillBehind && onScreen.met && kept,
      seen: `${GATEWAY}'s card zoomed to ${rect(before.card)}; the drawing ${landed.met ? `drawn again ${stillBehind ? 'while behind' : 'once back in front'}` : `not drawn again behind the tab (${landed.missed})`}; brought back, ${onScreen.met ? rect(after?.card) : `the panel not told it is on screen (${onScreen.missed})`}`,
    };
  });

}

// ---- the open graph at rest ---------------------------------------------------

// The checks run in the storefront folder with the build's analysis on, so a
// graph request compiles and renders the Release, and with one of its sockets
// misspelled by a character, so every compile files the same advisory again: the
// open graph compiling once and then resting for a minute with nothing touched,
// and the advisory leaving once the spelling is put right and saved.

export const GRAPH_IDLE_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'graph.open-panel-compiles-once-then-rests',
  'problems.misspelled-socket-leaves-once-it-is-put-right',
] as const;

// BUILD_ON_INSPECT is the setting that turns the build's analysis on, spelled as
// the extension reads it, and GRAPH_IDLE_SETTINGS the scenario's one change to
// the settings baseline: the analysis is what makes a graph request compile and
// render, which is what an open panel would turn on if it asked again.
const BUILD_ON_INSPECT = `${SERVER_CONFIG_SECTION}.${BUILD_ON_INSPECT_KEY}`;
export const GRAPH_IDLE_SETTINGS: Readonly<Record<string, unknown>> = { [BUILD_ON_INSPECT]: true };

// The socket misspelled, as the Aggregate declares it; how long nothing is
// touched while the panel is watched; and how long the advisory and the drift
// warning have to leave after the save that puts the spelling right.
const SOCKET = 'databases:';
const SOCKET_MISSPELLED = 'databasses:';
const QUIET_MS = 60000;
const LEAVE_MS = 30000;
const LAYERS = ['aggrega', 'aggrega-build'];

const nearMisses = (ds: DiagnosticEntry[]): DiagnosticEntry[] => ds.filter((x) => x.message.includes(SOCKET_MISSPELLED.slice(0, -1)));

// Filings is what the Problems panel carries on the Aggregate and on its
// lockfile at one moment.
interface Filings { a: DiagnosticEntry[]; l: DiagnosticEntry[] }

export async function graphIdleChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const lock = path.join(ctx.folder, RELEASE.replace(/\.yaml$/, '.lock'));
  const filings = async (): Promise<Filings> => ({ a: await diagnostics(ctx, aggregate), l: await diagnostics(ctx, lock) });
  const cleared = (v: Filings): boolean => nearMisses(v.a).length === 0 && !v.l.some((x) => x.source === LAYERS[0]);
  await ready(ctx);
  await contextRowsCheck(ctx);
  let filed: { aggregate: DiagnosticEntry[]; lock: DiagnosticEntry[] } | null = null;
  // How the Problems panel left the advisory and the drift warning, watched from
  // the save that put the spelling right.
  let leaving: { w: Waited<Filings>; ms: number } | null = null;
  await c.run('graph.open-panel-compiles-once-then-rests', {
    expected: `with the build's analysis on and the socket "${SOCKET.slice(0, -1)}" misspelled "${SOCKET_MISSPELLED.slice(0, -1)}" and saved, showing the graph compiles the Release and files a near-miss for the socket under both "${LAYERS[0]}" and "${LAYERS[1]}"; then, with nothing touched for ${QUIET_MS / 1000} s, the drawing is not drawn again and the language server spends less than half the CPU time over the whole minute that the one compile that drew the graph spent; the control, read by the same two readings: putting the spelling right and saving draws the graph again, and the language server spends at least that half doing it, which the save's own validation without a compile does not reach`,
    plant: 'in the scratch copy, out/src/extension.js made to redraw an open graph on every set of findings the compiler pushes',
  }, async () => {
    need((await ctx.probe.request<{ value: unknown }>('configuration.inspect', { key: BUILD_ON_INSPECT })).value === true, 'the build\'s analysis is not on');
    await savedAs(ctx, await rewriteLine(ctx, aggregate, SOCKET, SOCKET_MISSPELLED));
    // The saved document's own validation is let finish before the compile is
    // timed, so what is counted is the compile the panel asked for.
    const validated = await waited(until('the saved Aggregate validated', 30000, () => diagnostics(ctx, aggregate), (v) => nearMisses(v).some((x) => x.source === LAYERS[0])));
    const server = await theServer(ctx);
    const t0 = readStat(server.pid);
    need(t0 !== null, `the language server ${server.pid} could not be read`);
    const doc = await showGraph(ctx);
    // The near-miss under both layers is what the compile files and what an open
    // graph would turn on; a wait for it that runs out fails the check.
    const both = await until('the near-miss filed under both layers', 60000, () => diagnostics(ctx, aggregate), (v) => LAYERS.every((s) => nearMisses(v).some((x) => x.source === s)));
    filed = { aggregate: both, lock: await diagnostics(ctx, lock) };
    const t1 = readStat(server.pid);
    need(t1 !== null && t1.start === t0.start, 'the language server did not stay the same process through the compile');
    const compile = t1.cpuTicks - t0.cpuTicks;
    // One compile of the Release spends about what the one that drew the graph
    // spent, and the save's validation alone a small part of it; half of that
    // compile is the line a minute at rest stays under and a compile crosses.
    const half = compile / 2;
    const renders = (await graphState(doc)).renders;
    const every: number[] = [];
    const quiet = await holds(QUIET_MS, async () => {
      const s = readStat(server.pid);
      if (s !== null) { every.push(s.cpuTicks - t1.cpuTicks); }
      return { renders: (await graphState(doc)).renders, same: s !== null && s.start === t0.start };
    }, (v) => v.renders === renders && v.same, 5000);
    // The window's last reading falls before its end, so the count is read once
    // more as it closes: a drawing in its last seconds still counts against it.
    const closing = (await graphState(doc)).renders;
    const t2 = readStat(server.pid);
    const rest = t2 === null ? -1 : t2.cpuTicks - t1.cpuTicks;
    await savedAs(ctx, await rewriteLine(ctx, aggregate, SOCKET_MISSPELLED, SOCKET));
    // From the save on, the drawing is waited for and the advisory watched
    // leaving at once, so the leaving is timed from the save.
    const putRightAt = Date.now();
    const [drawn, left] = await Promise.all([
      waited(until('the drawing after the spelling is put right', 60000, () => graphState(doc), (s) => s.renders > closing)).then((w) => ({ w, t3: readStat(server.pid) })),
      waited(until('the near-miss and the drift warning leaving', stated(LEAVE_MS), filings, cleared)).then((w) => ({ w, ms: Date.now() - putRightAt })),
    ]);
    leaving = left;
    const t3 = drawn.t3;
    const control = t2 !== null && t3 !== null ? t3.cpuTicks - t2.cpuTicks : -1;
    const rested = quiet.held && closing === renders;
    return {
      passed: rested && rest >= 0 && rest < half && drawn.w.met && control >= half,
      seen: `the saved Aggregate's own near-miss ${validated.met ? 'filed before the press' : `not filed before the press (${validated.missed}), so the timing below may count its validation`}; the compile that drew the graph: ${compile} ticks of the kernel's clock, half of it ${half}; over the next ${QUIET_MS} ms ${rested ? `the drawing was not drawn again and the server spent ${rest} ticks (running total every 5 s: ${JSON.stringify(every)})` : quiet.held ? `the drawing was drawn again in the window's last seconds (${closing - renders} drawing(s))` : `the drawing was drawn again, or the server replaced, at ${quiet.atMs} ms`}; with the spelling put right ${drawn.w.met ? 'the graph was drawn again' : `the graph was not drawn again (${drawn.w.missed})`}${control >= 0 ? `, the server spending ${control} ticks` : ''}`,
      evidence: { compile, rest, every, control },
    };
  });

  await c.run('problems.misspelled-socket-leaves-once-it-is-put-right', {
    expected: `with the misspelling saved and the graph shown, the near-miss is filed on the Aggregate at the line declaring ${ADMIN} under both "${LAYERS[0]}" and "${LAYERS[1]}", and a drift warning on ${path.basename(lock)} under "${LAYERS[0]}"; once the spelling is put right and saved, all three leave the Problems panel within ${LEAVE_MS / 1000} s of that save with nothing pressed`,
    plant: 'in the scratch copy, out/src/extension.js made not to redraw an open graph when a document changes on disk',
  }, async () => {
    need(filed !== null && leaving !== null, 'the misspelled socket was not filed with the graph shown, then put right and saved');
    const before = filed;
    const gone = leaving;
    // The line declaring the admin console is the one above its type.
    const declares = lineOnDisk(aggregate, ADMIN_TYPE).index - 1;
    need(fs.readFileSync(aggregate, 'utf8').split('\n')[declares].trim() === `${ADMIN}:`, `the line above ${ADMIN}'s type does not declare it`);
    const atAdmin = LAYERS.every((s) => nearMisses(before.aggregate).some((x) => x.source === s && x.range.start.line === declares));
    const drift = before.lock.some((x) => x.source === LAYERS[0]);
    const after = gone.w.met ? gone.w.value : await filings();
    return {
      passed: atAdmin && drift && gone.w.met,
      seen: `filed: ${describeDiagnostics(aggregate, nearMisses(before.aggregate))}; ${describeDiagnostics(lock, before.lock)}; after the spelling was put right${gone.w.met ? `, gone ${gone.ms} ms after its save` : ` (${gone.w.missed})`}: ${describeDiagnostics(aggregate, nearMisses(after.a))}; ${describeDiagnostics(lock, after.l)}`,
    };
  });
}

// ---- a topology of a few dozen nodes ------------------------------------------

// The checks run in a folder of a few dozen components grouped in subsystems
// inside boundaries: the first drawing showing the whole shape fitted to the
// panel, however small that makes its names, and whether that trade reads right.

export const FLEET_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'graph.large-topology-arrives-whole-in-its-first-drawing',
  'graph.large-topology-arriving-small-reads-right',
] as const;

export async function fleetChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const declared = declaredIn(path.join(ctx.folder, 'aggregate.yaml'), path.join(ctx.folder, RELEASE));
  const placed = [...declared.boundaries.values()].flatMap((b) => b.components);
  await ready(ctx);
  await contextRowsCheck(ctx);
  let first: Drawing | null = null;
  await c.run('graph.large-topology-arrives-whole-in-its-first-drawing', {
    expected: `the first drawing of the ${placed.length} components the Release places shows the whole shape fitted to the panel: every one of their cards drawn and inside the canvas, the margins even within 2 px, at whatever size that takes`,
    plant: 'in the scratch copy, media/graph.js made to hold a first fit to a smallest zoom, so a large topology runs past the panel\'s edges',
  }, async () => {
    need(placed.length > 0, 'the Release places no component');
    const doc = await showGraph(ctx);
    first = await shownDrawing(doc);
    const d = first;
    const f = framingOf(d);
    const missing = placed.filter((id) => !d.nodes.some((n) => n.id === id));
    const card = d.nodes[0];
    return {
      passed: missing.length === 0 && f.whole && f.centred,
      seen: `${d.nodes.length} cards drawn${missing.length > 0 ? `, missing ${JSON.stringify(missing)}` : ''}; ${describeFraming(f)}; a card drawn ${card === undefined ? '-' : `${card.card.width.toFixed(1)}×${card.card.height.toFixed(1)}, its id ${card.idBox.height.toFixed(1)} px high`}`,
      evidence: { drawing: d },
    };
  });
  await c.forPerson('graph.large-topology-arriving-small-reads-right', {
    expected: 'a first drawing of a few dozen nodes arrives whole and small, its names possibly too small to read until the reader zooms in, because no smallest zoom holds the first fit; the reader judges whether that trade reads right',
    plant: 'none: this is a judgement of the trade',
    question: 'The whole topology arrives fitted to the panel, small enough that its names may be unreadable until you zoom in, and there is deliberately no smallest zoom on that first fit. Does that trade read right to you?',
  }, async () => {
    need(first !== null, 'the graph was not drawn');
    const d = first;
    const lines = [
      `${d.nodes.length} cards on a canvas ${rect(d.canvas)}; ${describeFraming(framingOf(d))}`,
      ...d.containers.map((k) => `${k.title} ${rect(k.box)}`),
      ...d.nodes.map((n) => `${n.id}${n.component === null ? '' : ` / ${n.component}`} ${rect(n.card)}`),
    ];
    // A notification the editor draws over the panel would hide part of the
    // shape to be judged; it is put away, and stays in the notification centre.
    await putAwayNotifications(ctx);
    return { screenshot: await capture(ctx, 'graph-large-topology-first-drawing'), drawnText: lines.join('\n') };
  });
}

// ---- boundaries declared inside boundaries ------------------------------------

// The checks run in a copy of the storefront folder whose Release declares its
// boundaries one inside another: the first drawing drawing each boundary inside
// the one it is declared in, a boundary holding nothing but the one inside it
// included.

export const NESTED_BOUNDARY_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'graph.release-boundaries-drawn-nested-as-declared',
] as const;

// NESTED_BOUNDARIES is the boundaries block the copy's Release declares in place
// of the folder's own. It places every component the folder's Release places and
// routes the same module: the edge boundary places nothing itself and holds
// "public", which places the gateway and the admin console; the data boundary
// places the cache, routes the sessions module, and holds "inner", which places
// the orders database.
const NESTED_BOUNDARIES = [
  '  boundaries:',
  '    edge:',
  '      directory: edge',
  '      boundaries:',
  '        public:',
  '          directory: public',
  '          components:',
  '            gateway:',
  '              infra:',
  '                port: 8081',
  '            admin:',
  '              infra:',
  '                port: 8080',
  '    data:',
  '      directory: data',
  '      components:',
  '        cache: {}',
  '      aggregates:',
  '        sessions: {}',
  '      boundaries:',
  '        inner:',
  '          directory: inner',
  '          components:',
  '            orders: {}',
] as const;

// enclosingBoundary is the path of the boundary a boundary is declared in, or
// null for one declared at the top of its Release.
const enclosingBoundary = (p: string): string | null => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null);

// nestBoundaries writes NESTED_BOUNDARIES over the boundaries block of a folder's
// Release, which ends it, and reads the Release back: what it places and routes
// is what it placed and routed before, and it declares a boundary inside another
// and a boundary that places nothing itself.
export function nestBoundaries(folder: string): FixtureProof {
  const aggregate = path.join(folder, 'aggregate.yaml');
  const file = path.join(folder, RELEASE);
  const fixture = `${RELEASE} with boundaries declared inside boundaries`;
  const placed = (d: Declared): string[] => [...d.boundaries.values()].flatMap((b) => [...b.components, ...b.modules]).sort();
  const before = declaredIn(aggregate, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = lines.indexOf(NESTED_BOUNDARIES[0]);
  if (at === -1) { throw new FixtureError(fixture, `${file} holds no line "${NESTED_BOUNDARIES[0]}" to write the nested block over`); }
  fs.writeFileSync(file, `${[...lines.slice(0, at), ...NESTED_BOUNDARIES].join('\n')}\n`);
  const after = declaredIn(aggregate, file);
  const paths = [...after.boundaries.keys()];
  const nested = paths.filter((p) => enclosingBoundary(p) !== null);
  const hollow = [...after.boundaries].filter(([, b]) => b.components.length === 0 && b.modules.length === 0).map(([p]) => p);
  if (JSON.stringify(placed(after)) !== JSON.stringify(placed(before))) {
    throw new FixtureError(fixture, `the Release written places ${JSON.stringify(placed(after))} where the folder's placed ${JSON.stringify(placed(before))}`);
  }
  if (nested.length === 0 || hollow.length === 0) {
    throw new FixtureError(fixture, `the Release written declares the boundaries ${JSON.stringify(paths)}, which lack a boundary inside another or one that places nothing itself`);
  }
  return { fixture, built: true, proof: `${file} declares the boundaries ${JSON.stringify(paths)}, ${JSON.stringify(nested)} inside another and ${JSON.stringify(hollow)} placing nothing itself, and places ${JSON.stringify(placed(after))} as the folder's own did` };
}

export async function nestedBoundaryChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const declared = declaredIn(path.join(ctx.folder, 'aggregate.yaml'), path.join(ctx.folder, RELEASE));
  const paths = [...declared.boundaries.keys()];
  await ready(ctx);
  await contextRowsCheck(ctx);
  await c.run('graph.release-boundaries-drawn-nested-as-declared', {
    expected: `the first drawing draws one boundary for each the Release declares at every depth (${paths.join(', ')}) and no other, each titled "${boundaryTitle('<path>')}", each declared inside another inside that one's box — a boundary placing nothing itself drawn around the one inside it — and each holding the card of every component the Release places directly in it`,
    plant: 'in the scratch copy, media/graph-model.js made to take a boundary\'s path apart at the dot a subsystem\'s path is joined with, so every boundary is read as declared at the top of its Release',
  }, async () => {
    need(paths.some((p) => enclosingBoundary(p) !== null), 'the Release declares no boundary inside another');
    const d = await shownDrawing(await showGraph(ctx));
    const titles = d.containers.filter((k) => k.kind === 'boundary').map((k) => k.title);
    const want = paths.map(boundaryTitle);
    let passed = titles.length === want.length && want.every((t) => titles.includes(t));
    const seen: string[] = [];
    for (const [p, b] of declared.boundaries) {
      const box = containerTitled(d, 'boundary', boundaryTitle(p));
      const outerPath = enclosingBoundary(p);
      const outer = outerPath === null ? undefined : containerTitled(d, 'boundary', boundaryTitle(outerPath));
      const inOuter = outerPath === null || (box !== undefined && outer !== undefined && contains(outer.box, box.box));
      const loose = b.components.filter((id) => { const n = d.nodes.find((x) => x.id === id); return box === undefined || n === undefined || !contains(box.box, n.card); });
      passed = passed && box !== undefined && inOuter && loose.length === 0;
      seen.push(`${p}: ${box === undefined ? 'no box titled so' : `${rect(box.box)}${outerPath === null ? '' : inOuter ? `, inside ${outerPath}` : `, not inside ${outerPath}${outer === undefined ? '' : ` ${rect(outer.box)}`}`}, ${b.components.length === 0 ? 'placing nothing itself' : loose.length === 0 ? `holding ${JSON.stringify(b.components)}` : `not holding ${JSON.stringify(loose)}`}`}`);
    }
    return { passed, seen: `boundary titles drawn ${JSON.stringify(titles)}; ${seen.join('; ')}` };
  });
}
