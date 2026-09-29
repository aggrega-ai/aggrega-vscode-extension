// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { loadAll } from 'js-yaml';

import { need, Outcome } from './checks';
import { runCompiler } from './cli';
import { WebviewDocument } from './drivers';
import { changeSince, Tree } from './fixtures';
import {
  findGraphPanel, graphState, Panel, panelReadings, pointAtNode, postFromPanel, pressAttach, pressNode, readPanel, revealGraphTab,
  settledPanel, showGraph,
} from './graph-panel';
import { referenceAnswer } from './reference';
import { LOCKFILE_PULL_BUTTON, lockfileNoticeOpening } from './suite-above';
import { capture, lineOf, open, ready, run, save, send, SuiteContext } from './suite-context';
import { contextRowsCheck, openSettingsOn, settingLabel } from './suite-gateway';
import {
  commandsPanel, dialog, holds, NOT_RUNNING, operationButtons, pressDialogButton, pressIn, pressOperation, RUNNING, sleep, toasts, until, waitStatus,
  waitToast,
} from './workbench';

// The checks run in the storefront folder with the topology graph open: what the
// attachments panel draws for a value a Feature declares sensitive, with the
// setting that shows it unset, on, off again and set to something that is not a
// boolean; the list of what may attach, its rows, the node it follows and a
// refusal of it; that nothing offers a connection between components; attaching a
// Feature to a component inside a subsystem, two subsystems deep and through a
// module, each left unsaved, undone in one step and landing where the unsaved
// buffer puts it; the reasons a failed drawing and a refused attach give; and the
// folder left byte for byte as the scenario found it.

export const GRAPH_PANEL_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'settings.show-sensitive-values-label-is-derived-from-its-key',
  'settings.show-sensitive-values-description-names-the-exposure',
  'attachments-panel.declared-sensitive-value-is-withheld-by-default',
  'attachments-panel.withholds-exactly-what-the-command-line-withholds',
  'attachments-panel.undeclared-value-reads-as-authored',
  'attachments-panel.setting-on-shows-the-value-as-authored',
  'attachments-panel.setting-off-again-withholds-the-value',
  'attachments-panel.setting-that-is-not-a-boolean-withholds-the-value',
  'may-attach.section-is-headed-captioned-and-waits-in-words',
  'may-attach.rows-name-each-feature-its-kind-and-where-it-was-read',
  'may-attach.list-follows-the-node-selected-last',
  'graph-panel.offers-no-way-to-draw-a-connection',
  'attach.press-inside-a-subsystem-writes-the-entry-unsaved',
  'attach.one-undo-removes-the-whole-entry',
  'attach.lands-where-the-unsaved-buffer-puts-it',
  'attach.two-subsystems-deep-lands-beside-the-existing-attachment',
  'attach.module-component-lands-in-the-modules-document',
  'graph.failed-render-names-its-reason-in-the-panel-and-the-channel',
  'attach.refusal-carries-the-compilers-words',
  'attach.request-for-a-node-the-panel-did-not-draw-is-refused-in-its-words',
  'may-attach.refusal-says-the-list-is-not-coming-and-why',
  'graph.failed-render-with-the-server-stopped-names-the-extensions-reason',
  'attach.nothing-is-saved-and-the-folder-is-as-it-started',
] as const;

export const RELEASE = 'release-compose.yaml';
const SENSITIVE_KEY = 'aggrega.graph.showSensitiveValues';

// The nodes the checks press, the attachment the storefront authors, its two
// leaves, and the Feature the folder's own catalog declares.
const ORDERS = 'orders';
const ADMIN = 'admin';
const CACHE = 'cache';
const GATEWAY = 'gateway';
const STORE = 'sessions.store';
const PASSWORD = 'password';
const KEY_LEAF = 'values.key';
const ORIGIN_LEAF = 'values.origin';
const LOCAL_FEATURE = 'local/nightly-backup';

// The words a reader is to meet, held here as written, so a change of wording in
// the extension is a change these checks report rather than follow: the three
// sentences a withheld value may read, the heading and the two captions of the
// list of what may attach, what it reads while it waits, where a row's Feature
// came from when no file names it, the sentence for a list naming nothing, the
// openings of a refused list and a refused attach, and the extension's own reason
// when no language server is running.
export const WITHHELD_SENTENCES = [
  'withheld — declared sensitive',
  'withheld — this attachment\'s sensitivity marking is unreadable',
  'withheld — value not in a readable shape',
];
const WITHHELD_DECLARED = WITHHELD_SENTENCES[0];
export const MAY_ATTACH_TITLE = 'May attach';
export const MAY_ATTACH_CAPTION = 'Features whose declared applicability the labels on this node satisfy. Listing is what a Feature declares, not what a build will do.';
export const ATTACH_CAPTION = 'Attaching edits the Aggregate that declares this component. The change lands in the editor, where it can be undone.';
export const PENDING = 'Looking for Features that may attach…';
const FROM_CATALOG = 'the configured catalog';
const CANNOT_LIST = 'Cannot list what may attach: ';
const CANNOT_ATTACH = 'Cannot attach: ';
const NOT_RUNNING_REASON = 'the Aggrega language server is not running';
const DEFAULT_INDENT_NOTE = ' The document exhibits no nesting to measure, so a default indentation was used.';
const staleDrawing = (release: string): string => `${release}: the topology could not be rebuilt, so the graph on screen is out of date.`;
const notOnTheGraph = (node: string): string => `${node} is not on the graph this panel drew.`;

// A control, or words, offering to connect one component to another.
const CONNECTION_WORDS = /connect|coming soon|\bwire\b|link to|draw an edge/i;

// ---- what the command line and the language server answer --------------------

// Leaf is one authored leaf of an attachment as the command line prints it: its
// dotted path, and either its value as text or the reason it is withheld.
interface Leaf { path: string; value: string | null; withheld: string | null }

function leavesOf(pillar: string, value: unknown, out: Leaf[]): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'aggrega_withheld') {
      out.push({ path: pillar, value: null, withheld: String((value as Record<string, unknown>).aggrega_withheld) });
      return;
    }
    for (const k of keys) { leavesOf(`${pillar}.${k}`, (value as Record<string, unknown>)[k], out); }
    return;
  }
  out.push({ path: pillar, value: typeof value === 'string' ? value : JSON.stringify(value), withheld: null });
}

// commandLineLeaves is what `aggrega inspect --ir-graph` prints for one
// attachment's authored leaves over the reference copy: the IR graph it prints
// first, read as JSON, and the attachment's values and infra walked leaf by leaf.
async function commandLineLeaves(ctx: SuiteContext, reference: string, node: string, attachment: string): Promise<Leaf[]> {
  const cli = await runCompiler(ctx.inputs.compiler.path, ['--offline', 'inspect', `./${RELEASE}`, '--ir-graph'], { cwd: reference, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
  need(cli.status === 0, `the command line's inspection exited ${cli.status ?? cli.signal}: ${cli.stderr.trim().slice(0, 200)}`);
  const lines = cli.stdout.split('\n');
  const end = lines.indexOf('}');
  need(end > 0, 'the command line\'s inspection printed no IR graph ahead of its listing');
  const ir = JSON.parse(lines.slice(0, end + 1).join('\n')) as { spec?: { feature_values_mapping?: Record<string, Record<string, Record<string, unknown>>> } };
  const entry = ir.spec?.feature_values_mapping?.[node]?.[attachment];
  need(entry !== undefined, `the command line's IR graph carries no ${attachment} attachment on ${node}`);
  const out: Leaf[] = [];
  for (const pillar of ['values', 'infra']) {
    const v = entry[pillar];
    if (v === undefined || v === null) { continue; }
    for (const k of Object.keys(v as object)) { leavesOf(`${pillar}.${k}`, (v as Record<string, unknown>)[k], out); }
  }
  return out;
}

// CandidateAnswer is the language server's own answer about what may attach.
interface CandidateAnswer { labelSource?: string; candidates?: { kind?: string; name?: string; file?: string; origin?: string }[] }

async function candidatesAnswer(ctx: SuiteContext, reference: string, node: string): Promise<CandidateAnswer> {
  const a = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/attachCandidates', params: { graphNode: node, release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  need(a.ok, `the language server gave no answer about what may attach to ${node} over the reference copy: ${a.ok ? '' : a.error.message}`);
  return a.result as CandidateAnswer;
}

// drawnAsAnswered holds a drawn list against the answer it was drawn from: one
// row per candidate, in the answer's order, naming it, its kind, and either the
// file that declares it or that it came from the configured catalog.
export function drawnAsAnswered(p: Panel, answer: CandidateAnswer): { same: boolean; seen: string } {
  const want = (answer.candidates ?? []).map((c) => ({
    name: c.name ?? '',
    facts: [
      ...(c.kind ? [`kind=${c.kind}`] : []),
      ...(c.file ? [`declared in=${c.file}`] : c.origin === 'catalog' ? [`from=${FROM_CATALOG}`] : c.origin ? [`from=${c.origin}`] : []),
    ],
  }));
  const drawn = (p.candidates?.rows ?? []).map((r) => ({ name: r.name, facts: r.facts.map((f) => `${f.key}=${f.value}`), button: r.button }));
  const same = drawn.length === want.length && drawn.every((d, i) => d.name === want[i].name && JSON.stringify(d.facts) === JSON.stringify(want[i].facts) && d.button === 'Attach');
  const shown = drawn.map((d) => `${d.name} [${d.facts.join('; ')}]`);
  return { same, seen: same ? `${drawn.length} rows as answered: ${JSON.stringify(shown)}` : `drawn ${JSON.stringify(shown)} against the answer ${JSON.stringify(want.map((w) => `${w.name} [${w.facts.join('; ')}]`))}` };
}

interface Located { file: string; container: string[] }
interface Insertion { entryIndent: number; indentStepMeasured: boolean }

async function containerAnswer(ctx: SuiteContext, reference: string, node: string): Promise<Located> {
  const a = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/attachmentContainer', params: { graphNode: node, release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  need(a.ok, `the language server reported no container for ${node} over the reference copy: ${a.ok ? '' : a.error.message}`);
  return a.result as Located;
}

async function insertionAnswer(ctx: SuiteContext, reference: string, at: Located): Promise<Insertion> {
  const a = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/insertionPoint', params: { file: at.file, container: at.container }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  need(a.ok, `the language server reported no insertion point in ${at.file} over the reference copy: ${a.ok ? '' : a.error.message}`);
  return a.result as Insertion;
}

// ---- documents ------------------------------------------------------------

function yamlOf(text: string): unknown {
  return loadAll(text)[0];
}

function child(v: unknown, key: string): unknown {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined;
}

function dig(v: unknown, keys: string[]): unknown {
  return keys.reduce((x, k) => child(x, k), v);
}

// PASSWORD_VALUES is where the storefront's Aggregate authors the password
// attachment's values.
const PASSWORD_VALUES = ['spec', 'subsystems', 'backend', 'subsystems', 'storage', 'components', 'orders', 'features', 'password', 'values'];

// EntryCheck is an attach's edit held against the document it was made in: that
// every line the document had is still there, in order, with the new lines in
// one run between them; that the new entry sits at the container path the
// compiler names, under the name the panel reported and typed as the Feature;
// that removing it — and a container key it wrote, where the document had none
// — gives back exactly the document as it was; and at what indentation its first
// line sits.
interface EntryCheck { ok: boolean; seen: string; inserted: string[]; indent: number | null }

export function checkEntry(before: string, after: string, container: string[], name: string, feature: string): EntryCheck {
  const b = before.split('\n');
  const a = after.split('\n');
  let head = 0;
  while (head < b.length && head < a.length && a[head] === b[head]) { head++; }
  let tail = 0;
  while (tail < b.length - head && tail < a.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) { tail++; }
  const onlyInserted = head + tail === b.length;
  const inserted = onlyInserted ? a.slice(head, a.length - tail) : [];
  const entryLine = inserted.find((l) => l.trim() === `${name}:`);
  const indent = entryLine === undefined ? null : entryLine.length - entryLine.trimStart().length;
  let parsedAfter: unknown;
  let parsedBefore: unknown;
  try { parsedAfter = yamlOf(after); parsedBefore = yamlOf(before); } catch (err) {
    return { ok: false, seen: `the document does not parse after the attach: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, inserted, indent };
  }
  let holder: unknown = parsedAfter;
  for (const k of container) { holder = child(holder, k); }
  const entry = child(holder, name);
  const typed = JSON.stringify(entry) === JSON.stringify({ type: feature });
  // Taken back out, the entry and any container key written for it leave the
  // document as it was.
  const back = JSON.parse(JSON.stringify(parsedAfter ?? null)) as unknown;
  let cursor: unknown = back;
  const trail: unknown[] = [];
  for (const k of container) { trail.push(cursor); cursor = child(cursor, k); }
  if (typeof cursor === 'object' && cursor !== null) { delete (cursor as Record<string, unknown>)[name]; }
  let beforeHolder: unknown = parsedBefore;
  for (const k of container) { beforeHolder = child(beforeHolder, k); }
  if (beforeHolder === undefined && typeof cursor === 'object' && cursor !== null && Object.keys(cursor).length === 0) {
    const parent = trail[trail.length - 1];
    if (typeof parent === 'object' && parent !== null) { delete (parent as Record<string, unknown>)[container[container.length - 1]]; }
  }
  const restored = JSON.stringify(back) === JSON.stringify(parsedBefore ?? null);
  const ok = onlyInserted && typed && restored;
  return {
    ok, inserted, indent,
    seen: `${onlyInserted ? `every line of the document is kept, with ${inserted.length} line(s) inserted after line ${head}: ${JSON.stringify(inserted)}` : `lines of the document were changed, not only added: the first difference at line ${head + 1}`}; at ${container.join('.')}.${name} the document reads ${JSON.stringify(entry ?? null)}${typed ? '' : `, not { type: ${feature} }`}; ${restored ? 'with the entry taken out it reads as it did' : 'with the entry taken out it does not read as it did'}`,
  };
}

function literally(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// attachedName is the name the panel's line after an attach says the entry was
// written under, or null where the line is not that sentence for this Feature and
// this node: "Attached <Feature> to <node> as <name>.", with the default
// indentation sentence after it where the document gave no nesting to measure.
export function attachedName(outcome: string, feature: string, node: string): string | null {
  const m = new RegExp(`^Attached ${literally(feature)} to ${literally(node)} as (\\S+?)\\.(${literally(DEFAULT_INDENT_NOTE)})?$`).exec(outcome);
  return m ? m[1] : null;
}

// activeDocument is the active editor's document, as the probe reads it.
export async function activeDocument(ctx: SuiteContext): Promise<{ path: string; isDirty: boolean; text: string } | null> {
  return ctx.probe.request<{ path: string; isDirty: boolean; text: string } | null>('editor.active');
}

// revertActive puts the active document back to its bytes on disk and closes
// its tab, as a person closes a changed file without saving it.
async function revertActive(ctx: SuiteContext, file: string): Promise<void> {
  await open(ctx, file);
  await run(ctx, 'workbench.action.files.revert');
  await until(`${path.basename(file)} reading as it does on disk`, 10000, () => activeDocument(ctx), (d) => d !== null && d.path === file && !d.isDirty && d.text === fs.readFileSync(file, 'utf8'));
  await run(ctx, 'workbench.action.closeActiveEditor');
  await sleep(300);
}

// closeEverythingUnsaved closes every open editor, answering "Don't Save" where
// the editor asks about a changed document, so nothing reaches the disk.
export async function closeEverythingUnsaved(ctx: SuiteContext): Promise<string[]> {
  const answered: string[] = [];
  await send(ctx, 'workbench.action.closeAllEditors');
  for (let i = 0; i < 10; i++) {
    const d = await until('the editor asking about a changed document', 2000, () => dialog(ctx.d), (v) => v !== null).catch(() => null);
    if (d === null) { break; }
    need(d.buttons.includes('Don\'t Save'), `the editor asked "${d.message}" with ${JSON.stringify(d.buttons)} and offers no way to close without saving`);
    answered.push(d.message);
    await pressDialogButton(ctx.d, 'Don\'t Save');
    await sleep(300);
  }
  return answered;
}

// closeSettingsEditor closes the settings editor, which this editor draws over
// the whole workbench with a layer that takes every press until it is closed.
async function closeSettingsEditor(ctx: SuiteContext): Promise<void> {
  await run(ctx, 'workbench.action.closeActiveEditor');
  await until('the settings editor closing', 10000, () => ctx.d.workbench<boolean>(`!document.querySelector('.monaco-modal-editor-block') && !document.querySelector('.settings-editor')`), (v) => v);
}

// settingOf reads a setting's value at every scope.
async function settingOf(ctx: SuiteContext): Promise<{ value: unknown; globalValue: unknown; workspaceValue: unknown; workspaceFolderValue: unknown }> {
  const r = await ctx.probe.request<{ value: unknown; inspect: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | null }>('configuration.inspect', { key: SENSITIVE_KEY });
  return { value: r.value, globalValue: r.inspect?.globalValue, workspaceValue: r.inspect?.workspaceValue, workspaceFolderValue: r.inspect?.workspaceFolderValue };
}

// originAsRead reads the password attachment's origin leaf as the panel draws
// it, once the graph has been shown again and orders pressed.
async function originAsRead(ctx: SuiteContext): Promise<{ drawn: string | null; seen: string }> {
  const doc = await showGraph(ctx);
  await pressNode(ctx, doc, ORDERS);
  const p = await readPanel(doc);
  const leaf = p?.attachments.find((a) => a.name === PASSWORD)?.config.find((f) => f.key === ORIGIN_LEAF);
  return { drawn: leaf === undefined ? null : leaf.value, seen: leaf === undefined ? `no ${ORIGIN_LEAF} row drawn on ${PASSWORD}` : `${ORIGIN_LEAF} reads ${JSON.stringify(leaf.value)}${leaf.withheld ? ', drawn as withheld' : ''}` };
}

export async function graphPanelChecks(ctx: SuiteContext, reference: string, snapshot: Tree, missingCompiler: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const moduleFile = path.join(ctx.folder, 'catalog', 'aggregate', 'local', 'sessions', '1.0.0', 'aggregate.yaml');
  const lock = path.join(ctx.folder, RELEASE.replace(/\.yaml$/, '.lock'));
  const userSettings = path.join(ctx.s.root.userData, 'User', 'settings.json');
  const originalAggregate = fs.readFileSync(aggregate, 'utf8');
  const originalModule = fs.readFileSync(moduleFile, 'utf8');
  // The values the Aggregate authors on the password attachment, read from the
  // file itself.
  const authoredValues = dig(yamlOf(originalAggregate), PASSWORD_VALUES);
  const authoredOrigin = typeof child(authoredValues, 'origin') === 'string' ? child(authoredValues, 'origin') as string : '';
  const authoredKey = typeof child(authoredValues, 'key') === 'string' ? child(authoredValues, 'key') as string : '';
  await ready(ctx);
  await contextRowsCheck(ctx);

  // ---- the setting that shows withheld values: its label and its description ----
  const title = ctx.manifest.contributes.configuration.title;
  const label = settingLabel(title, SENSITIVE_KEY);
  const declared = ctx.manifest.contributes.configuration.properties[SENSITIVE_KEY]?.description ?? '';
  let drawnDescription = '';
  let settingShot: string | null = null;
  await c.run('settings.show-sensitive-values-label-is-derived-from-its-key', {
    expected: `searching the settings editor for "showSensitiveValues" draws the label "${label}" — the configuration's title "${title}" and the key path ${SENSITIVE_KEY} as the editor words it, with no title of the property's own — and beside it the description the manifest declares`,
    plant: 'in the scratch copy\'s package.json, a markdown description given to the property, which the settings editor draws in place of the declared one',
  }, async () => {
    need(declared !== '', `the manifest declares no ${SENSITIVE_KEY}`);
    const item = await openSettingsOn(ctx, 'showSensitiveValues', label);
    drawnDescription = item.description;
    settingShot = await capture(ctx, 'settings-show-sensitive-values');
    return { passed: item.description === declared, seen: `label "${item.category}${item.label}"; description ${item.description === declared ? 'as declared' : `"${item.description}"`}`, evidence: { item } };
  });
  await c.forPerson('settings.show-sensitive-values-description-names-the-exposure', {
    expected: 'the description states plainly that turning the setting on displays a credential in the clear, and that what is displayed is readable by anyone who can see the editor window or a screen recording of it',
    plant: 'none: this is a judgement of the wording',
    question: 'Does the drawn description name the exposure plainly — a credential shown in the clear, readable by anyone who can see the window or a recording of it — rather than describing the switch in a way that hides the consequence?',
  }, async () => {
    need(drawnDescription !== '', 'the setting was not drawn, so there is no description to judge');
    return { screenshot: settingShot, drawnText: drawnDescription };
  });
  await closeEverythingUnsaved(ctx);

  // ---- a declared-sensitive value, with the setting unset ----
  let defaultPanel: Panel | null = null;
  await c.run('attachments-panel.declared-sensitive-value-is-withheld-by-default', {
    expected: `with no ${SENSITIVE_KEY} entry at any scope, Show topology graph and a press on ${ORDERS} draw the ${PASSWORD} attachment's ${ORIGIN_LEAF} row by its path and, in place of its value, exactly "${WITHHELD_DECLARED}" — one of the three sentences ${WITHHELD_SENTENCES.map((s) => `"${s}"`).join(', ')} — never the authored value, the word null or a blank`,
    plant: 'in the scratch copy, media/graph.js made to draw a withheld value as a blank',
  }, async () => {
    const s = await settingOf(ctx);
    need(s.globalValue === undefined && s.workspaceValue === undefined && s.workspaceFolderValue === undefined && !fs.readFileSync(userSettings, 'utf8').includes(SENSITIVE_KEY), `the setting carries a value (${JSON.stringify(s)}), so this is not the default`);
    const doc = await showGraph(ctx);
    await pressNode(ctx, doc, ORDERS);
    defaultPanel = await readPanel(doc);
    const a = defaultPanel?.attachments.find((x) => x.name === PASSWORD);
    const leaf = a?.config.find((f) => f.key === ORIGIN_LEAF);
    const passed = leaf !== undefined && leaf.drawn && leaf.value === WITHHELD_DECLARED && leaf.value !== authoredOrigin && leaf.value !== 'null';
    return { passed, seen: a === undefined ? `no ${PASSWORD} attachment drawn on ${ORDERS}: ${JSON.stringify(defaultPanel?.attachments.map((x) => x.name))}` : `the ${PASSWORD} rows read ${JSON.stringify(a.config.map((f) => `${f.key}: ${f.value}${f.withheld ? ' (withheld)' : ''}${f.drawn ? '' : ' (not drawn)'}`))}`, evidence: { panel: defaultPanel } };
  });
  await c.run('attachments-panel.withholds-exactly-what-the-command-line-withholds', {
    expected: `the ${PASSWORD} attachment's rows are the leaves \`aggrega inspect ./${RELEASE} --ir-graph\` prints for it over a reference copy: each leaf it marks withheld is drawn as the withheld sentence for that reason, and every other leaf is drawn with its value — so the declared leaf beside a readable one is withheld alone, not the whole attachment`,
    plant: 'in the scratch copy, media/attachments-model.js made to withhold every leaf of an attachment',
  }, async () => {
    need(defaultPanel !== null, 'the panel was not read with the setting unset');
    const leaves = await commandLineLeaves(ctx, reference, ORDERS, PASSWORD);
    const reasons: Record<string, string> = { declared: WITHHELD_SENTENCES[0], attachment: WITHHELD_SENTENCES[1], unreadable: WITHHELD_SENTENCES[2] };
    const drawn = defaultPanel.attachments.find((x) => x.name === PASSWORD)?.config ?? [];
    const want = leaves.map((l) => `${l.path}: ${l.withheld !== null ? reasons[l.withheld] ?? `withheld for ${l.withheld}` : l.value}`);
    const got = drawn.map((f) => `${f.key}: ${f.value}`);
    const readable = leaves.filter((l) => l.withheld === null).length;
    return { passed: JSON.stringify(got) === JSON.stringify(want) && readable > 0 && readable < leaves.length, seen: `drawn ${JSON.stringify(got)}; the command line prints ${JSON.stringify(leaves)}` };
  });
  await c.run('attachments-panel.undeclared-value-reads-as-authored', {
    expected: `on the same attachment, ${KEY_LEAF}, which no sensitivity declaration covers, is drawn exactly as the Aggregate authors it`,
    plant: 'in the scratch copy, media/attachments-model.js made to withhold every leaf of an attachment',
  }, async () => {
    need(defaultPanel !== null, 'the panel was not read with the setting unset');
    need(authoredKey !== '', `the Aggregate authors no ${KEY_LEAF} on ${PASSWORD}`);
    const leaf = defaultPanel.attachments.find((x) => x.name === PASSWORD)?.config.find((f) => f.key === KEY_LEAF);
    return { passed: leaf !== undefined && leaf.drawn && !leaf.withheld && leaf.value === authoredKey, seen: leaf === undefined ? `no ${KEY_LEAF} row drawn` : `${KEY_LEAF} reads ${JSON.stringify(leaf.value)}${leaf.withheld ? ' (withheld)' : ''}; the Aggregate authors ${JSON.stringify(authoredKey)}` };
  });

  // ---- the setting turned on, off again, and set to something not a boolean ----
  const checkbox = '.settings-editor .setting-item-bool .setting-value-checkbox';
  let turnedOn = false;
  await c.run('attachments-panel.setting-on-shows-the-value-as-authored', {
    expected: `with the setting ticked in the settings editor, showing the graph again and pressing ${ORDERS} draws ${ORIGIN_LEAF} exactly as the Aggregate authors it ("${authoredOrigin}")`,
    plant: 'green under the correction: in the scratch copy, media/attachments-model.js made to leave the leaves the graph was sent withheld to the markers the sending side leaves, rather than matching the declarations again',
  }, async () => {
    need(authoredOrigin !== '', `the Aggregate authors no ${ORIGIN_LEAF}`);
    await openSettingsOn(ctx, 'showSensitiveValues', label);
    await pressIn(ctx.d, null, checkbox);
    const on = await until('the setting reading on', 10000, () => settingOf(ctx), (v) => v.globalValue === true).then(() => true, () => false);
    need(on, 'ticking the setting did not turn it on, so what it shows cannot be observed');
    turnedOn = true;
    await closeSettingsEditor(ctx);
    const r = await originAsRead(ctx);
    return { passed: r.drawn === authoredOrigin, seen: `${r.seen}; the Aggregate authors ${JSON.stringify(authoredOrigin)}` };
  });
  await c.run('attachments-panel.setting-off-again-withholds-the-value', {
    expected: `with the setting ticked off again, showing the graph again and pressing ${ORDERS} draws ${ORIGIN_LEAF} as "${WITHHELD_DECLARED}"`,
    plant: 'in the scratch copy, media/attachments-model.js made to match no declared leaf, on the side that sends the graph and on the side that draws it',
  }, async () => {
    need(turnedOn, 'the setting was not turned on, so turning it off again is not what this reads');
    await openSettingsOn(ctx, 'showSensitiveValues', label);
    await pressIn(ctx.d, null, checkbox);
    const off = await until('the setting reading off', 10000, () => settingOf(ctx), (v) => v.globalValue !== true).then(() => true, () => false);
    need(off, 'ticking the setting again did not turn it off');
    await closeSettingsEditor(ctx);
    const r = await originAsRead(ctx);
    return { passed: r.drawn === WITHHELD_DECLARED, seen: `the setting reads ${JSON.stringify((await settingOf(ctx)).globalValue)}; ${r.seen}` };
  });
  await closeEverythingUnsaved(ctx);
  // setByHand writes the setting's line in the user settings file as a person
  // types it there, replacing the line where one is already written, and saves.
  const settingText = (value: string): string => `  ${JSON.stringify(SENSITIVE_KEY)}: ${value},`;
  const setByHand = async (value: string, replacing: string | null): Promise<void> => {
    await open(ctx, userSettings);
    if (replacing === null) {
      await ctx.probe.request('document.edit', { path: userSettings, start: { line: 1, character: 0 }, text: `${settingText(value)}\n` });
    } else {
      const at = await lineOf(ctx, userSettings, settingText(replacing));
      await ctx.probe.request('document.edit', { path: userSettings, start: { line: at.index, character: 0 }, end: { line: at.index + 1, character: 0 }, text: `${settingText(value)}\n` });
    }
    await save(ctx, userSettings);
  };
  await c.run('attachments-panel.setting-that-is-not-a-boolean-withholds-the-value', {
    expected: `with the user settings file hand-edited to set ${SENSITIVE_KEY} to the string "yes", and then to the number 1, showing the graph again and pressing ${ORDERS} draws ${ORIGIN_LEAF} as "${WITHHELD_DECLARED}" each time`,
    plant: 'in the scratch copy, media/attachments-model.js made to match no declared leaf, on the side that sends the graph and on the side that draws it',
  }, async () => {
    await open(ctx, userSettings);
    const text = (await activeDocument(ctx))?.text ?? '';
    need(text.startsWith('{\n') && !text.includes(SENSITIVE_KEY), 'the user settings file does not open with a brace on a line of its own, or already names the setting');
    const seen: string[] = [];
    let passed = true;
    let written: string | null = null;
    for (const [value, spelled] of [['yes', '"yes"'], [1, '1']] as const) {
      await setByHand(spelled, written);
      written = spelled;
      const set = await until(`the setting reading ${spelled}`, 10000, () => settingOf(ctx), (v) => v.globalValue === value).then(() => true, () => false);
      need(set, `the hand-edited setting did not read ${spelled}`);
      const r = await originAsRead(ctx);
      passed = passed && r.drawn === WITHHELD_DECLARED;
      seen.push(`set to ${spelled}: ${r.seen}`);
    }
    return { passed, seen: seen.join('; ') };
  });
  // The line is taken out again, leaving the setting at its default.
  await open(ctx, userSettings);
  const handWritten = await lineOf(ctx, userSettings, settingText('1')).catch(() => lineOf(ctx, userSettings, settingText('"yes"'))).catch(() => null);
  if (handWritten !== null) {
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: handWritten.index, character: 0 }, end: { line: handWritten.index + 1, character: 0 }, text: '' });
    await save(ctx, userSettings);
  }
  await until('the setting at its default again', 10000, () => settingOf(ctx), (v) => v.globalValue === undefined).catch(() => undefined);
  await closeEverythingUnsaved(ctx);

  // ---- what may attach ----
  let doc: WebviewDocument = await showGraph(ctx);
  await c.run('may-attach.section-is-headed-captioned-and-waits-in-words', {
    expected: `pressing ${ADMIN}, which has nothing attached, draws below the attachments a section headed "${MAY_ATTACH_TITLE}" with the captions "${MAY_ATTACH_CAPTION}" and "${ATTACH_CAPTION}", reading "${PENDING}" while the answer is in flight (caught as it is drawn) and then the answer`,
    plant: 'in the scratch copy, media/candidates-model.js made to draw nothing while the answer is in flight',
  }, async () => {
    const from = (await panelReadings(doc)).length;
    await pressNode(ctx, doc, ADMIN);
    const p = await settledPanel(doc, ADMIN, PENDING);
    const readings = await panelReadings(doc, from);
    const waited = readings.some((r) => r.title === ADMIN && r.candidates === PENDING);
    const passed = p.attachments.length === 0 && p.candidates !== null && p.candidates.title === MAY_ATTACH_TITLE
      && JSON.stringify(p.candidates.captions) === JSON.stringify([MAY_ATTACH_CAPTION, ATTACH_CAPTION]) && waited && p.candidates.rows.length > 0;
    return { passed, seen: `attachments ${p.attachments.length} (${JSON.stringify(p.nothingAttached)}); heading ${JSON.stringify(p.candidates?.title)}; captions ${JSON.stringify(p.candidates?.captions)}; while in flight ${waited ? `it read "${PENDING}"` : `it never read "${PENDING}": ${JSON.stringify(readings.map((r) => r.candidates).slice(0, 5))}`}; then ${p.candidates?.rows.length ?? 0} rows` };
  });
  await c.run('may-attach.rows-name-each-feature-its-kind-and-where-it-was-read', {
    expected: `for each of ${ORDERS}, ${CACHE} and ${STORE}, the list draws one row per Feature the language server's own answer names for that node over a reference copy, in the answer's order, each naming the Feature, its kind and either "declared in" with the file that declares it or "from" "${FROM_CATALOG}", never both, with an Attach button: the standard library's Features from the configured catalog, then ${LOCAL_FEATURE} declared in a file of the folder`,
    plant: 'in the scratch copy, media/candidates-model.js made to say nothing of where a Feature read from the catalog came from; or to draw the rows in the reverse of the answer\'s order',
  }, async () => {
    const seen: string[] = [];
    let passed = true;
    for (const node of [ORDERS, CACHE, STORE]) {
      const answer = await candidatesAnswer(ctx, reference, node);
      await pressNode(ctx, doc, node);
      const p = await settledPanel(doc, node, PENDING);
      const r = drawnAsAnswered(p, answer);
      const rows = p.candidates?.rows ?? [];
      const last = rows[rows.length - 1];
      const shape = rows.length > 1 && last.name === LOCAL_FEATURE && last.facts.some((f) => f.key === 'declared in' && f.value !== '')
        && rows.slice(0, -1).every((x) => x.facts.some((f) => f.key === 'from' && f.value === FROM_CATALOG) && !x.facts.some((f) => f.key === 'declared in'));
      passed = passed && r.same && shape;
      seen.push(`${node}: ${r.seen}${shape ? '' : '; not the standard library\'s Features from the configured catalog followed by the folder\'s own'}`);
    }
    return { passed, seen: seen.join(' || ') };
  });
  await c.run('may-attach.list-follows-the-node-selected-last', {
    expected: `pressing ${GATEWAY} and ${ORDERS} quickly back and forth, three times over and ending on each in turn, leaves the list showing the rows the language server's own answer names for the node pressed last`,
    plant: 'in the scratch copy, media/graph.js made to draw every answer that arrives, not only the one for the latest press; or out/src/graph-view.js made to ask about the gateway whatever node was pressed',
  }, async () => {
    const answers: Record<string, CandidateAnswer> = { [GATEWAY]: await candidatesAnswer(ctx, reference, GATEWAY), [ORDERS]: await candidatesAnswer(ctx, reference, ORDERS) };
    need(JSON.stringify(answers[GATEWAY].candidates) !== JSON.stringify(answers[ORDERS].candidates), 'the two nodes are answered alike, so the list cannot tell them apart');
    const seen: string[] = [];
    let passed = true;
    for (let round = 1; round <= 3; round++) {
      for (const last of [ORDERS, GATEWAY]) {
        const other = last === ORDERS ? GATEWAY : ORDERS;
        // Both brought within reach first, so the presses that follow land with
        // nothing between them.
        await pointAtNode(ctx, doc, other);
        const lastAt = await pointAtNode(ctx, doc, last);
        const otherAt = await pointAtNode(ctx, doc, other);
        for (const at of [otherAt, lastAt, otherAt, lastAt, otherAt, lastAt]) {
          await ctx.d.click(at);
          await sleep(60);
        }
        const p = await settledPanel(doc, last, PENDING).catch(async () => (await readPanel(doc)) as Panel);
        const r = drawnAsAnswered(p, answers[last]);
        passed = passed && p.title === last && r.same;
        seen.push(`round ${round}, ending on ${last}: the panel names ${p.title}; ${r.same ? 'its answer drawn' : r.seen}`);
      }
    }
    return { passed, seen: seen.join('; ') };
  });
  await c.run('graph-panel.offers-no-way-to-draw-a-connection', {
    expected: 'with a node selected and its list drawn, the graph panel offers no control for connecting components — every control it draws is the attachments panel\'s close button or a row\'s Attach button, none disabled — and no words offering to connect, wire or link this node to another; the same reading finds the close button and the Attach buttons',
    plant: 'in the scratch copy, media/graph.js made to draw a "Connect to…" button in the attachments panel',
  }, async () => {
    await pressNode(ctx, doc, ORDERS);
    await settledPanel(doc, ORDERS, PENDING);
    const found = await doc.evaluate<{ controls: { tag: string; cls: string; text: string; disabled: boolean }[]; words: string }>(`(() => ({
      controls: [...document.querySelectorAll('button, a, input, select, textarea, [role="button"], [draggable="true"], [contenteditable="true"]')].map((e) => ({ tag: e.tagName.toLowerCase(), cls: typeof e.className === 'string' ? e.className : '', text: (e.innerText || e.getAttribute('aria-label') || e.title || '').trim(), disabled: !!e.disabled })),
      words: document.body.innerText || '',
    }))()`);
    const known = (x: { cls: string; text: string }): boolean => x.cls === 'panel-close' || (x.cls === 'candidate-attach' && x.text === 'Attach');
    const other = found.controls.filter((x) => !known(x) || x.disabled);
    const words = found.words.split('\n').filter((l) => CONNECTION_WORDS.test(l));
    const control = found.controls.some((x) => x.cls === 'panel-close') && found.controls.some((x) => x.cls === 'candidate-attach');
    return { passed: other.length === 0 && words.length === 0 && control, seen: `${found.controls.length} control(s): ${other.length === 0 ? 'the close button and Attach buttons only' : `besides those, ${JSON.stringify(other)}`}; words offering a connection: ${words.length === 0 ? 'none' : JSON.stringify(words)}; the close button and an Attach button ${control ? 'found' : 'not both found'} by the same reading` };
  });

  // ---- attaching a Feature ----
  // attachAndRead presses Attach on a row of the node's list and reads what
  // follows: the document the edit opened, the channel's line, the panel's line,
  // and whether the drawing moved. `before` is the document's text as the editor
  // holds it before the press, which is what the edit is read against.
  const attachAndRead = async (node: string, feature: string | null, file: string, before: string): Promise<{ feature: string; after: string; dirty: boolean; activePath: string; channel: string; outcome: string; failed: boolean; drawnAgain: boolean; stillShows: string }> => {
    doc = (await findGraphPanel(ctx)) ?? await showGraph(ctx);
    await revealGraphTab(ctx);
    await pressNode(ctx, doc, node);
    const p = await settledPanel(doc, node, PENDING);
    const chosen = feature ?? p.candidates?.rows[0]?.name ?? '';
    need(chosen !== '' && (p.candidates?.rows ?? []).some((r) => r.name === chosen), `the list for ${node} draws no row for ${chosen || 'any Feature'}`);
    const rendersBefore = (await graphState(doc)).renders;
    const mark = ctx.out.mark();
    await pressAttach(ctx, doc, chosen);
    const opened = await until(`the edited document in front`, 20000, () => activeDocument(ctx), (d) => d !== null && d.path === file && d.text !== before && d.isDirty).catch(() => activeDocument(ctx));
    const text = await ctx.out.waitFor('the attach recorded on the channel', mark, (t) => /^(attached|attaching) /m.test(t), 20000).catch(() => ctx.out.since(mark));
    await revealGraphTab(ctx);
    const outcome = await until('the panel\'s line about the attach', 10000, () => readPanel(doc), (x) => x !== null && x.outcome !== null).catch(() => readPanel(doc));
    const still = await holds(2000, () => graphState(doc), (s) => s.renders === rendersBefore);
    return {
      feature: chosen,
      after: opened?.path === file ? opened.text : fs.readFileSync(file, 'utf8'),
      dirty: opened?.path === file && opened.isDirty,
      activePath: opened?.path ?? '',
      channel: text.split('\n').find((l) => /^(attached|attaching) /.test(l)) ?? '',
      outcome: outcome?.outcome?.text ?? '',
      failed: outcome?.outcome?.failed ?? false,
      drawnAgain: !still.held,
      stillShows: outcome?.attachments.map((a) => a.name).join(', ') || (outcome?.nothingAttached ?? ''),
    };
  };
  let attached: { feature: string; name: string } | null = null;
  await c.run('attach.press-inside-a-subsystem-writes-the-entry-unsaved', {
    expected: `pressing Attach on the first row of ${ADMIN}'s list, ${ADMIN} being declared under spec.subsystems.frontend.components with no features key, opens the Aggregate in front with the entry under the container path the language server's own answer names for ${ADMIN} over a reference copy, at the indentation that answer gives, a features key written for it, and every other line of the document kept as it was; the document is changed and not saved, the file on disk unchanged; the panel says "Attached <Feature> to ${ADMIN} as <name>." (with the default-indentation sentence only where that answer says the nesting was not measured) and the channel "attached <Feature> to ${ADMIN} as <name> in <file>"; and the graph is not drawn again (watched for 2 s)`,
    plant: 'in the scratch copy, out/src/attachment-edit.js made to write no container key the document lacks; or out/src/graph-view.js made to save the document after the edit',
  }, async (): Promise<Outcome> => {
    const at = await containerAnswer(ctx, reference, ADMIN);
    const ins = await insertionAnswer(ctx, reference, at);
    need(path.join(ctx.folder, at.file) === aggregate, `the language server places ${ADMIN}'s attachments in ${at.file}, not the Aggregate`);
    const r = await attachAndRead(ADMIN, null, aggregate, originalAggregate);
    const name = attachedName(r.outcome, r.feature, ADMIN) ?? '';
    const e = checkEntry(originalAggregate, r.after, at.container, name, r.feature);
    const noteRight = r.outcome.endsWith(DEFAULT_INDENT_NOTE) === !ins.indentStepMeasured;
    const passed = name !== '' && !r.failed && noteRight && e.ok && e.indent === ins.entryIndent && r.dirty && fs.readFileSync(aggregate, 'utf8') === originalAggregate
      && r.channel === `attached ${r.feature} to ${ADMIN} as ${name} in ${at.file}` && !r.drawnAgain;
    if (e.ok && name !== '') { attached = { feature: r.feature, name }; }
    return { passed, seen: `the panel: "${r.outcome}"${r.failed ? ' (as a failure)' : ''}; the channel: "${r.channel}"; the document in front ${r.activePath}${r.dirty ? ', changed' : ', not changed'}; on disk ${fs.readFileSync(aggregate, 'utf8') === originalAggregate ? 'unchanged' : 'CHANGED'}; ${e.seen}; the entry at indentation ${e.indent} where the answer gives ${ins.entryIndent}; the graph ${r.drawnAgain ? 'was drawn again' : 'was not drawn again'}, the panel still listing ${JSON.stringify(r.stillShows)}` };
  });
  await c.run('attach.one-undo-removes-the-whole-entry', {
    expected: 'one undo in the Aggregate takes the whole entry out, leaving the document as it was before the press',
    plant: 'in the scratch copy, out/src/graph-view.js made to apply the entry as two edits',
  }, async () => {
    need(attached !== null, 'no entry was attached, so there is nothing to undo');
    await ctx.probe.request('document.undo', { path: aggregate });
    const d = await activeDocument(ctx);
    const passed = d !== null && d.path === aggregate && d.text === originalAggregate;
    const left = d === null ? [] : d.text.split('\n').filter((l) => !originalAggregate.split('\n').includes(l));
    return { passed, seen: d === null ? 'no document in front' : passed ? 'the document reads as it did before the press' : `after one undo the document still holds ${JSON.stringify(left)}` };
  });
  await revertActive(ctx, aggregate);
  await c.run('attach.lands-where-the-unsaved-buffer-puts-it', {
    expected: `with two comment lines typed into the Aggregate above ${ADMIN} and not saved, pressing Attach on the same row puts the entry under ${ADMIN}'s container in the document as it stands in the editor: every line of it kept, the entry at the container path, and nothing else changed`,
    plant: 'in the scratch copy, out/src/graph-view.js made to place the entry by the line the document has on disk',
  }, async () => {
    need(attached !== null, 'no entry was attached before, so which row to press is not known');
    const at = await containerAnswer(ctx, reference, ADMIN);
    const spec = await lineOf(ctx, aggregate, 'spec:');
    await ctx.probe.request('document.edit', { path: aggregate, start: { line: spec.index + 1, character: 0 }, text: '  # Typed here and not saved, so the document on disk\n  # is two lines shorter than the one in the editor.\n' });
    const edited = (await activeDocument(ctx))?.text ?? '';
    need(edited.split('\n').length === originalAggregate.split('\n').length + 2, 'the two lines were not typed into the Aggregate');
    const r = await attachAndRead(ADMIN, attached.feature, aggregate, edited);
    const e = checkEntry(edited, r.after, at.container, attached.name, attached.feature);
    await revertActive(ctx, aggregate);
    return { passed: e.ok && !r.failed && fs.readFileSync(aggregate, 'utf8') === originalAggregate, seen: `the panel: "${r.outcome}"; ${e.seen}` };
  });
  await c.run('attach.two-subsystems-deep-lands-beside-the-existing-attachment', {
    expected: `pressing Attach on ${LOCAL_FEATURE} in the list of ${ORDERS}, declared under backend › storage with a features block already holding ${PASSWORD}, puts the entry in that block beside ${PASSWORD}, at its indentation and after it, at the container path the language server's own answer names; the document is changed and not saved`,
    plant: 'in the scratch copy, out/src/attachment-edit.js made to indent the entry one step further than the answer says',
  }, async () => {
    const at = await containerAnswer(ctx, reference, ORDERS);
    const r = await attachAndRead(ORDERS, LOCAL_FEATURE, aggregate, originalAggregate);
    const name = attachedName(r.outcome, r.feature, ORDERS) ?? '';
    const e = checkEntry(originalAggregate, r.after, at.container, name, r.feature);
    let holder: unknown = e.ok ? yamlOf(r.after) : null;
    for (const k of at.container) { holder = child(holder, k); }
    const keys = typeof holder === 'object' && holder !== null ? Object.keys(holder) : [];
    const passwordLine = originalAggregate.split('\n').find((l) => l.trim() === `${PASSWORD}:`) ?? '';
    const beside = JSON.stringify(keys) === JSON.stringify([PASSWORD, name]) && e.indent === passwordLine.length - passwordLine.trimStart().length;
    await revertActive(ctx, aggregate);
    return { passed: name !== '' && e.ok && beside && r.dirty && !r.failed, seen: `the panel: "${r.outcome}"; ${e.seen}; the block holds ${JSON.stringify(keys)}, the entry at indentation ${e.indent} where ${PASSWORD} sits at ${passwordLine.length - passwordLine.trimStart().length}` };
  });
  await c.run('attach.module-component-lands-in-the-modules-document', {
    expected: `pressing Attach on ${LOCAL_FEATURE} in the list of ${STORE}, reached through the module the Aggregate imports, opens the document the language server's own answer names for ${STORE} — the module's own file, not the Aggregate the Release points at — with the entry under that answer's container path, changed and not saved; the Aggregate is not changed; the channel names the module's file`,
    plant: 'in the scratch copy, out/src/graph-view.js made to write the entry into the Aggregate the Release names',
  }, async () => {
    const at = await containerAnswer(ctx, reference, STORE);
    need(path.join(ctx.folder, at.file) === moduleFile, `the language server places ${STORE}'s attachments in ${at.file}, not the module's file`);
    const r = await attachAndRead(STORE, LOCAL_FEATURE, moduleFile, originalModule);
    const name = attachedName(r.outcome, r.feature, STORE) ?? '';
    const e = checkEntry(originalModule, r.after, at.container, name, r.feature);
    const agg = await open(ctx, aggregate);
    const aggregateUntouched = !agg.isDirty && (agg.text ?? '') === originalAggregate;
    await revertActive(ctx, aggregate).catch(() => undefined);
    await revertActive(ctx, moduleFile);
    const passed = name !== '' && e.ok && r.activePath === moduleFile && r.dirty && aggregateUntouched && r.channel === `attached ${r.feature} to ${STORE} as ${name} in ${at.file}`;
    return { passed, seen: `the document in front ${r.activePath}; the panel: "${r.outcome}"; the channel: "${r.channel}"; ${e.seen}; the Aggregate ${aggregateUntouched ? 'unchanged' : 'CHANGED'}` };
  });

  // ---- a failed drawing and a refused attach, with the lockfile moved aside ----
  const aside = `${lock}.aside`;
  const refLock = path.join(reference, path.basename(lock));
  const refAside = `${refLock}.aside`;
  let lockAside = false;
  await c.run('graph.failed-render-names-its-reason-in-the-panel-and-the-channel', {
    expected: `with the Release's lockfile moved aside and a drawing on screen, pressing Graph writes "irGraph failed for ${RELEASE}: code=<n> <message>" to the channel and draws "${staleDrawing(RELEASE)} code=<n> <message>" over the dimmed drawing, <n> and <message> being the language server's own answer to the same graph request over a reference copy without its lockfile; and it raises the one missing-lockfile notice, "${lockfileNoticeOpening(RELEASE)} <message>" with a "${LOCKFILE_PULL_BUTTON}" button`,
    plant: 'in the scratch copy, out/src/graph-failure.js made to write the failure as the thrown value rendered as a string',
  }, async () => {
    need(fs.existsSync(lock) && fs.existsSync(refLock), 'the Release has no lockfile to move aside');
    fs.renameSync(refLock, refAside);
    const ref = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/irGraph', params: { release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    fs.renameSync(refAside, refLock);
    need(!ref.ok, 'the language server drew the reference copy\'s graph although it has no lockfile');
    const message = ref.error.message.split(reference).join(ctx.folder);
    const words = `code=${String(ref.error.code)} ${message}`;
    doc = (await findGraphPanel(ctx)) ?? await showGraph(ctx);
    await revealGraphTab(ctx);
    need((await graphState(doc)).nodes.length > 0, 'no drawing is on screen for the failure to leave in place');
    fs.renameSync(lock, aside);
    lockAside = true;
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const channel = await ctx.out.waitFor('the failure on the channel', mark, (t) => t.split('\n').some((l) => l.startsWith(`irGraph failed for ${RELEASE}:`)), 60000).catch(() => ctx.out.since(mark));
    const line = channel.split('\n').find((l) => l.startsWith(`irGraph failed for ${RELEASE}:`)) ?? '';
    const state = await until('the panel naming the failure', 15000, () => graphState(doc), (s) => s.status !== '' && !s.status.startsWith('Laying out')).catch(() => graphState(doc));
    const notice = await waitToast(ctx.d, 'the missing-lockfile notice', toastMark, (t) => t.message.startsWith(lockfileNoticeOpening(RELEASE)), 15000).catch(() => null);
    const passed = line === `irGraph failed for ${RELEASE}: ${words}` && state.status === `${staleDrawing(RELEASE)} ${words}` && state.outOfDate
      && notice !== null && notice.message === `${lockfileNoticeOpening(RELEASE)} ${message}` && notice.buttons.includes(LOCKFILE_PULL_BUTTON);
    return { passed, seen: `the channel: "${line}"; the panel: "${state.status}"${state.outOfDate ? ', the drawing dimmed' : ', the drawing not dimmed'}; the notice ${notice === null ? 'not drawn' : `"${notice.message}" with ${JSON.stringify(notice.buttons)}`}; the language server's answer "${words}"` };
  });
  await c.run('attach.refusal-carries-the-compilers-words', {
    expected: `with the lockfile still aside and ${STORE}'s list still drawn, pressing Attach on ${LOCAL_FEATURE} draws "${CANNOT_ATTACH}code=<n> <message>" as a failure, <n> and <message> being the language server's own answer to the same container request over a reference copy without its lockfile, writes "attaching ${LOCAL_FEATURE} to ${STORE} failed: code=<n> <message>" to the channel, and changes no document`,
    plant: 'in the scratch copy, out/src/attachment-edit.js made to word a declined attach in the extension\'s own sentence',
  }, async () => {
    need(lockAside, 'the lockfile was not moved aside');
    fs.renameSync(refLock, refAside);
    const ref = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/attachmentContainer', params: { graphNode: STORE, release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    fs.renameSync(refAside, refLock);
    need(!ref.ok, `the language server reported a container for ${STORE} over a reference copy with no lockfile`);
    const words = `code=${String(ref.error.code)} ${ref.error.message.split(reference).join(ctx.folder)}`;
    const p = await readPanel(doc);
    need(p !== null && p.title === STORE && (p.candidates?.rows ?? []).some((r) => r.name === LOCAL_FEATURE), `the panel does not still show ${STORE}'s list with ${LOCAL_FEATURE} on it: ${JSON.stringify(p?.title)}`);
    // The line the panel drew for the attach before this one is still standing,
    // so what this press drew is the line once it reads otherwise.
    const standing = JSON.stringify(p.outcome);
    const mark = ctx.out.mark();
    await pressAttach(ctx, doc, LOCAL_FEATURE);
    const drawn = await until('the panel\'s line about this attach', 20000, () => readPanel(doc), (x) => x !== null && x.outcome !== null && JSON.stringify(x.outcome) !== standing).catch(() => readPanel(doc));
    const channel = await ctx.out.waitFor('the refusal on the channel', mark, (t) => /^attaching /m.test(t), 10000).catch(() => ctx.out.since(mark));
    const line = channel.split('\n').find((l) => l.startsWith('attaching ')) ?? '';
    const active = await activeDocument(ctx);
    const unchanged = fs.readFileSync(moduleFile, 'utf8') === originalModule && (active === null || !active.isDirty);
    const passed = drawn?.outcome?.text === `${CANNOT_ATTACH}${words}` && drawn.outcome.failed && line === `attaching ${LOCAL_FEATURE} to ${STORE} failed: ${words}` && unchanged;
    return { passed, seen: `the panel: ${JSON.stringify(drawn?.outcome ?? null)}; the channel: "${line}"; ${unchanged ? 'no document changed' : `a document changed: ${active?.path}`}; the language server's answer "${words}"` };
  });
  if (lockAside && fs.existsSync(aside)) {
    fs.renameSync(aside, lock);
    lockAside = false;
    doc = await showGraph(ctx).catch(async () => doc);
  }
  await c.run('attach.request-for-a-node-the-panel-did-not-draw-is-refused-in-its-words', {
    expected: `with ${ADMIN} selected, a request to attach posted into the graph panel's own channel for a node the drawing does not carry, "no-such-node", is answered in the panel with "${notOnTheGraph('no-such-node')}" as a failure, and changes no document`,
    plant: 'green under the correction: in the scratch copy, media/graph.js made to draw a line about an attach whatever node it names',
  }, async () => {
    const d = (await findGraphPanel(ctx)) ?? await showGraph(ctx);
    doc = d;
    await revealGraphTab(ctx);
    await pressNode(ctx, d, ADMIN);
    const p = await settledPanel(d, ADMIN, PENDING);
    const feature = p.candidates?.rows[0]?.name ?? '';
    need(feature !== '', `${ADMIN}'s list draws no row, so no Feature can be named in the request`);
    need(!(await graphState(d)).nodes.includes('no-such-node'), 'the drawing carries a node named no-such-node');
    const from = (await panelReadings(d)).length;
    await postFromPanel(ctx, d, { type: 'attachFeature', nodeId: 'no-such-node', featureName: feature });
    const drawn = await until('the panel\'s line about the request', 5000, () => readPanel(d), (x) => x !== null && x.outcome !== null).catch(() => readPanel(d));
    const readings = await panelReadings(d, from);
    const active = await activeDocument(ctx);
    const passed = drawn?.outcome?.text === notOnTheGraph('no-such-node') && drawn.outcome.failed && (active === null || !active.isDirty);
    return { passed, seen: `the panel ${drawn?.outcome ? `says ${JSON.stringify(drawn.outcome)}` : 'draws no line within 5000 ms'}; its readings since the request ${JSON.stringify(readings.map((r) => r.outcome))}; the document in front ${active?.path ?? 'none'}${active?.isDirty ? ', changed' : ''}` };
  });

  // ---- with the language server stopped ----
  const settingLine = `  "aggrega.server.binaryPath": ${JSON.stringify(bin)}`;
  let stopped = false;
  const stopServer = async (): Promise<void> => {
    need(!fs.existsSync(missingCompiler), `${missingCompiler} exists`);
    await open(ctx, userSettings);
    const at = await lineOf(ctx, userSettings, settingLine);
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: at.index, character: 0 }, end: { line: at.index + 1, character: 0 }, text: `${settingLine.replace(JSON.stringify(bin), JSON.stringify(missingCompiler))}\n` });
    await save(ctx, userSettings);
    await run(ctx, 'workbench.action.closeActiveEditor');
    stopped = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
  };
  await c.run('may-attach.refusal-says-the-list-is-not-coming-and-why', {
    expected: `with the language server stopped by a binary path that does not exist, pressing ${GATEWAY} draws, in place of the list, "${CANNOT_LIST}${NOT_RUNNING_REASON}" — not an empty list and not the previous node's rows — and the channel carries "attachCandidates failed for ${GATEWAY}: ${NOT_RUNNING_REASON}"`,
    plant: 'in the scratch copy, out/src/graph-view.js made to send the panel nothing when the list is refused',
  }, async () => {
    await stopServer();
    need(stopped, `the status bar did not read "${NOT_RUNNING}", so the server is not stopped`);
    const d = (await findGraphPanel(ctx)) as WebviewDocument;
    need(d !== null, 'no graph panel is open');
    doc = d;
    await revealGraphTab(ctx);
    if ((await readPanel(d))?.title === GATEWAY) { await pressNode(ctx, d, ORDERS); }
    const mark = ctx.out.mark();
    await pressNode(ctx, d, GATEWAY);
    const p = await settledPanel(d, GATEWAY, PENDING, 20000).catch(async () => (await readPanel(d)) as Panel);
    const channel = await ctx.out.waitFor('the refusal on the channel', mark, (t) => t.includes(`attachCandidates failed for ${GATEWAY}:`), 10000).catch(() => ctx.out.since(mark));
    const line = channel.split('\n').find((l) => l.startsWith('attachCandidates failed for ')) ?? '';
    const passed = p?.candidates?.failed === `${CANNOT_LIST}${NOT_RUNNING_REASON}` && (p.candidates?.rows.length ?? 0) === 0 && line === `attachCandidates failed for ${GATEWAY}: ${NOT_RUNNING_REASON}`;
    return { passed, seen: `the list reads ${JSON.stringify(p?.candidates?.body ?? null)}; the channel: "${line}"` };
  });
  await c.run('graph.failed-render-with-the-server-stopped-names-the-extensions-reason', {
    expected: `with the language server stopped and a drawing on screen, showing the graph writes "irGraph failed for ${RELEASE}: ${NOT_RUNNING_REASON}" to the channel, the extension's own sentence carrying no code, and draws "${staleDrawing(RELEASE)} ${NOT_RUNNING_REASON}" over the dimmed drawing`,
    plant: 'in the scratch copy, out/src/graph-failure.js made to write the failure as the thrown value rendered as a string',
  }, async () => {
    need(stopped, 'the server was not stopped');
    const d = (await findGraphPanel(ctx)) as WebviewDocument;
    need(d !== null && (await graphState(d)).nodes.length > 0, 'no drawing is on screen');
    const mark = ctx.out.mark();
    const graphButton = (await operationButtons(await commandsPanel(ctx.d))).find((b) => b.command === 'aggrega.graph.show');
    if (graphButton && !graphButton.disabled) { await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show'); } else { await send(ctx, 'aggrega.graph.show'); }
    const channel = await ctx.out.waitFor('the failure on the channel', mark, (t) => t.includes(`irGraph failed for ${RELEASE}:`), 20000).catch(() => ctx.out.since(mark));
    const line = channel.split('\n').find((l) => l.startsWith(`irGraph failed for ${RELEASE}:`)) ?? '';
    const state = await until('the panel naming the failure', 10000, () => graphState(d), (s) => s.status !== '' && !s.status.startsWith('Laying out')).catch(() => graphState(d));
    const passed = line === `irGraph failed for ${RELEASE}: ${NOT_RUNNING_REASON}` && state.status === `${staleDrawing(RELEASE)} ${NOT_RUNNING_REASON}` && state.outOfDate;
    return { passed, seen: `pressed ${graphButton && !graphButton.disabled ? 'the Graph button' : 'the command, the button being greyed'}; the channel: "${line}"; the panel: "${state.status}"${state.outOfDate ? ', dimmed' : ''}` };
  });
  // The binary put back, and the server running again.
  await open(ctx, userSettings);
  const back = await lineOf(ctx, userSettings, settingLine.replace(JSON.stringify(bin), JSON.stringify(missingCompiler))).catch(() => null);
  if (back !== null) {
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: back.index, character: 0 }, end: { line: back.index + 1, character: 0 }, text: `${settingLine}\n` });
    await save(ctx, userSettings);
  }
  await run(ctx, 'workbench.action.closeActiveEditor').catch(() => undefined);
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);

  // ---- the folder as it was found ----
  await c.run('attach.nothing-is-saved-and-the-folder-is-as-it-started', {
    expected: 'with every editor closed without saving, every file of the folder copy reads byte for byte as it did when the scenario started, and no file is missing or added',
    plant: 'in the scratch copy, out/src/graph-view.js made to save the document after the edit',
  }, async () => {
    const answered = await closeEverythingUnsaved(ctx);
    const change = changeSince(snapshot, ctx.folder);
    const passed = change.changed.length === 0 && change.missing.length === 0 && change.added.length === 0;
    return { passed, seen: `${snapshot.size} file(s) at the start; changed ${JSON.stringify(change.changed)}, missing ${JSON.stringify(change.missing)}, added ${JSON.stringify(change.added)}${answered.length > 0 ? `; closing asked about ${JSON.stringify(answered)} and was answered Don't Save` : ''}` };
  });
}
