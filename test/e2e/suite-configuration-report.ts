// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { loadAll } from 'js-yaml';

import { DEFAULTS_SOURCE } from '../../src/config-model';
import { PRESENTATION_TOGGLE_COMMAND } from '../../src/config-render';
import { DAEMON_ACTION_LABEL, RESTART_COMMAND, STATUS_BAR_MENU_COMMAND } from '../../src/daemon-status';
import { OperationId } from '../../src/operation-groups';
import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import { ScratchHome } from './cli';
import { menuCommand } from './commands-panel';
import { FixtureError, FixtureProof } from './fixtures';
import { readEnviron } from './processes';
import { referenceAnswer, ReferenceAnswer } from './reference';
import { capture, closeAllEditors, commandTitle, deleteLine, open, ready, run, save, send, SuiteContext, theServer } from './suite-context';
import { ConfigPanel, configPanel, HEADINGS, HOSTED, LAST_HEADING, TO_EXPANDED, TO_TABLE } from './suite-config-panel';
import { paletteTitle } from './suite-first-day';
import { RELEASE } from './suite-graph-panel';
import { DialogSeen, dialogsSeen } from './levels';
import { setBinaryPath } from './suite-killed';
import { CONFIG_SCHEMA_KIND, describeSaid, leftOpen, markSaid, saidSince, statusReadsSince } from './suite-list-panels';
import { globalConfiguration, sameSet } from './suite-registry';
import { THEMES, writeColourTheme } from './suite-welcome-mixed';
import { clearForCapture, describeReadings, runningAgain, statusMark, TabSeen, tabs } from './welcome';
import {
  centre, commandsPanel, documentWith, evaluateWithin, holds, NOT_RUNNING, paletteRows, pickQuickInputRow, pressOperation, pressToastButton, quickInput,
  Reading as StatusReading, RUNNING, stated, statusLog, Toast, until, waitQuickInput, waitToast,
} from './workbench';

// The checks run on the configuration panel as a reader meets it in the gateway
// folder, whose file sets its catalog directories through the list's additive
// companion: the table it opens as, each of its rows against the configuration
// schema the language server serves and against the language server's own report
// of what is in force, the heading row over each group, the one value column and
// its mark, the description behind each row's circle with its code drawn as code,
// the switch to the per-setting shape and what that shape adds, the Global marker
// and its rule, the names derived from the keys, the companion folded into its
// list's row, the shape the panel reopens in, that nothing on it edits a setting,
// a setting put in force by the folder's file, what pressing it says and offers
// with the language server stopped, and that the start it offers starts the
// server. Beside them, the same setting put in force by the editor's environment,
// and the panel in a folder holding nothing configured at all.

export const CONFIGURATION_REPORT_CHECKS = [
  'config-panel.opens-as-a-table-in-its-own-tab',
  'config-panel.every-setting-the-schema-declares-is-a-row-or-named-on-its-lists',
  'config-panel.coverage-sentence-names-what-the-report-leaves-unattributed',
  'config-panel.each-group-opens-with-a-heading-row-and-entry-fields-are-named',
  'config-panel.grouped-table-is-the-right-shape',
  'config-panel.columns-read-in-order-under-visible-headings',
  'config-panel.columns-and-their-headings-are-the-ones-wanted',
  'config-panel.one-value-column-marked-where-not-the-declared-default',
  'config-panel.none-where-no-value-is-in-force',
  'config-panel.no-value-breaks-inside-a-word',
  'config-panel.each-description-is-the-schemas-own-sentence',
  'config-panel.shape-switch-sits-below-the-summary-and-draws-each-setting-in-full',
  'config-panel.reach-note-on-the-machine-wide-settings-alone',
  'config-panel.descriptions-draw-their-code-as-code',
  'config-panel.global-marker-on-the-machine-wide-rows-and-its-rule-at-the-head',
  'config-panel.reach-note-placement-and-its-narrowness-read-right',
  'config-panel.names-derived-from-the-keys-read-apart',
  'config-panel.plain-labels-read-well-enough',
  'config-panel.companion-set-in-the-folders-file-reads-on-its-lists-row',
  'config-panel.coverage-sentence-earns-its-place',
  'config-panel.reopens-in-the-shape-it-was-left-in',
  'config-panel.reports-and-offers-nothing-to-edit',
  'config-panel.table-earns-its-place-in-each-theme',
  'config-panel.pressed-again-reveals-the-open-panel-and-reads-again',
  'config-panel.setting-in-the-folders-file-reads-in-every-column-of-both-shapes',
  'config-panel.with-the-server-stopped-leaves-no-panel-and-says-why',
  'config-panel.open-panel-with-the-server-stopped-is-told-why-from-the-commands-panel',
  'config-panel.open-panel-with-the-server-stopped-is-told-why-from-the-palette',
  'config-panel.start-on-the-notification-starts-the-language-server',
] as const;

export const CONFIGURATION_FROM_THE_ENVIRONMENT_CHECKS = [
  'config-panel.setting-from-the-environment-names-the-variable-in-both-shapes',
] as const;

export const NOTHING_CONFIGURED_CHECKS = [
  'config-panel.nothing-configured-reads-every-setting-at-its-default',
] as const;

// The command Show config runs, which its button on the Commands panel and its
// entry in the command palette both name, read from the product's own description
// of the Commands panel by the operation's id.
const SHOW_CONFIG_OPERATION: OperationId = 'configShow';
const SHOW_CONFIG = menuCommand(SHOW_CONFIG_OPERATION).command;

// OFFLINE_VARIABLE is the variable a reader puts offline in force with from the
// editor's environment, and OFFLINE_IN_THE_ENVIRONMENT what the environment
// scenario adds to the editor's environment for it.
export const OFFLINE_VARIABLE = 'AGGREGA_OFFLINE';
export const OFFLINE_IN_THE_ENVIRONMENT: Readonly<Record<string, string>> = { [OFFLINE_VARIABLE]: 'true' };

// The words these checks hold the panel to, as written, so a change of wording is
// reported rather than followed: the tab's title, the summary box's heading and
// its line for a folder nothing configures, the opening of the coverage
// sentence, what the table and the per-setting shape say of a value's standing
// and its source, "none", the mark and the words naming why a value carries it,
// the circle, the Global marker, its rule and the reach note's label and whole
// sentence on the registries setting, the phrases naming what a toggle, a bounded
// whole number and a keyed collection take and the words before the fields a
// list's entries carry, what the report gives for a list and its companion, the
// notification raised when there is no language server to ask, the channel's
// line when the report could not be read, its line when a change of the binary
// setting schedules a restart, which names the grace that restart waits, and its
// line when that restart is cancelled; and the status bar menu's placeholder and
// its entry cancelling it.
const PANEL_TAB = 'Aggrega configuration';
const SUMMARY_HEADING = 'Where these values come from';
const NO_FILE_LEAD = 'No configuration file contributed';
const NO_ROW_LEAD = 'The configuration report carries no row for ';
const NOT_REPORTED = 'not reported';
const BUILT_IN = 'built-in default';
const DECLARED_DEFAULT_MARK = '(declared default)';
const IN_FORCE = 'In force: ';
const SOURCE = 'Source: ';
const environmentCell = (variable: string): string => `environment: ${variable}`;
const environmentSource = (variable: string): string => `${SOURCE}the environment variable ${variable}`;
const NONE = 'none';
const MARK = '●';
const SET_IN_A_FILE = 'Set in a file';
const SET_IN_THE_ENVIRONMENT = 'Set in the environment';
const NOT_THE_DEFAULT = 'Not its declared default';
const markWords = (why: string, dflt: string | null): string => `${why}; ${dflt === null ? 'the schema declares no default' : `its declared default is ${dflt}`}.`;
const CIRCLE = 'i';
const GLOBAL = 'Global';
const GLOBAL_LABEL = `${GLOBAL}:`;
const REACH_RULE = `A setting marked ${GLOBAL} belongs to this machine rather than to one project, and the note on it says why.`;
const REGISTRIES_NOTE = `${GLOBAL_LABEL} A registry and its signature trust policy are global tooling, so registering one changes what every project on this machine resolves through.`;
const TOGGLE_TAKES = 'true or false';
const wholeNumberTakes = (minimum: number | string): string => `a whole number, at least ${minimum}`;
const NAMED_ENTRIES = 'named entries, each carrying ';
const EACH_CARRYING = 'each carrying';
const foldWords = (companion: string): string => `The configuration report gives this list and ${companion} as one value, holding the entries of both under one source; it does not say which of them ${companion} added.`;
const NOTICE_LEAD = 'The configuration surface could not be drawn';
const STOPPED_NOTICE = `${NOTICE_LEAD}: the Aggrega language server is not running`;
const REPORT_UNREAD = 'Aggrega configuration: the resolved-configuration report could not be read, so every setting is shown with its declared default and no source.';
const SCHEDULED_RESTART = /binary path changed; restarting in (\d+)s/;
const RESTART_CANCELLED = 'binary path restart cancelled';
const MENU_PLACEHOLDER = 'Aggrega: choose an action';
const CANCEL_RESTART = 'Cancel restart';

// START is the label the status bar's offer gives a start, read from the
// product rather than written here: what the checks hold the notification to is
// offering the start under that same label.
const START = DAEMON_ACTION_LABEL.start;

// The settings these checks name, as a reader names them: the toggle a reader
// puts in force, a list whose entries' fields are named on its row, a keyed
// collection, the machine-wide settings the reach note and the Global marker are
// drawn on and settings beside them they are not, a setting nested in groups
// within groups, the names some settings are drawn with, a group's heading, the
// companion the folder's file sets and the list it adds to, and the setting the
// per-setting shape is contrasted with.
export const OFFLINE = 'offline';
const ENTRIES = 'registries';
const KEYED = 'workspace.releases';
const CLI_PLUGINS = 'plugins.cli';
const PARSE_CACHE_CAP = 'parse_cache.max_bytes';
const MODULE_CACHE_CAP = 'compiled_module_cache.max_bytes';
const MACHINE_WIDE = [ENTRIES, CLI_PLUGINS, MODULE_CACHE_CAP];
const DEFAULT_REGISTRY = 'default_registry';
const UNCLASSIFIED_NAMED = [OFFLINE, 'auto_pull', DEFAULT_REGISTRY];
const UNCLASSIFIED_GROUP = 'signing';
const NESTED = 'lint.publishing_discipline.allow_dynamic_refs';
const NAMED_LABELS: readonly { path: string; label: string }[] = [
  { path: 'build.yaml_indent', label: 'YAML indent' },
  { path: CLI_PLUGINS, label: 'CLI' },
  { path: PARSE_CACHE_CAP, label: 'Parse cache max bytes' },
  { path: MODULE_CACHE_CAP, label: 'Compiled module cache max bytes' },
  { path: 'mcp.health.listen', label: 'Health listen' },
  { path: NESTED, label: 'Allow dynamic refs' },
];
const ALIKE = [PARSE_CACHE_CAP, MODULE_CACHE_CAP];
const NAMED_GROUP = 'parse_cache';
const COMPANION_LIST = 'workspace.catalog_dirs';
const COMPANION = 'workspace.catalog_dirs_append';
const CONTRAST = MODULE_CACHE_CAP;

// PANEL_DRAWN_MS bounds both readings of whether a press drew the panel: the wait
// for it to be drawn where it must be, and the window it is watched not being
// drawn over where it must not, so an absence is watched for as long as its
// control is given. The panel's reading of a setting is bounded and watched the
// same way: read again on a press, and not read again with nothing pressed.
const PANEL_DRAWN_MS = 10000;
const SERVER_BOUND_MS = 60000;

// GRACE_SETTING is how long a change of the binary setting waits before the
// restart it schedules. The check pressing the notification's start sets it to
// HELD_GRACE_SECONDS before it puts the binary setting back: ten times the bound
// it waits for the server, so the restart that change schedules cannot begin
// while the check reads, and a start the check reads is the press's.
const GRACE_SETTING = 'aggrega.server.restartGraceSeconds';
const HELD_GRACE_SECONDS = (10 * SERVER_BOUND_MS) / 1000;

// SUMMARY_WATCH_MS is how long the summary box of a folder nothing configures is
// watched drawing no list of files.
const SUMMARY_WATCH_MS = 1000;

// ROWS_GIVEN is how many of the table's rows the theme captures give in their
// text.
const ROWS_GIVEN = 12;

// ---- the served schema, walked here ------------------------------------------

// SchemaNode is the part of a JSON Schema declaration these checks read.
interface SchemaNode {
  $ref?: string;
  type?: unknown;
  description?: unknown;
  default?: unknown;
  minimum?: unknown;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: boolean | SchemaNode;
  $defs?: Record<string, SchemaNode>;
}

// Declared is one setting the served schema declares: its path as a reader types
// it, the sentence the schema gives it, its default where it declares one, and,
// for a list's additive companion, the list it adds to.
interface Declared { path: string; description: string; hasDefault: boolean; dflt: unknown; node: SchemaNode; addsTo: string | null }

// 🔴 THIS WALK IS WRITTEN HERE, APART FROM THE EXTENSION'S OWN, ON PURPOSE. The
// checks hold the panel's rows against it, so a row the extension's walk drops or
// invents shows as a disagreement between this walk and the extension's; reading
// the extension's walk instead would hold the panel to itself. It follows the rule
// a reader is given: a declaration with properties of its own is a group and is
// descended into, and any other is a setting drawn as one row — a list of entries
// included — except a list's additive companion, a list whose key is another
// list's key in the same group followed by `_append`, which is named on that
// list's row.
function resolved(node: SchemaNode, defs: Record<string, SchemaNode>): SchemaNode {
  let at = node;
  const seen = new Set<string>();
  while (typeof at.$ref === 'string' && !seen.has(at.$ref)) {
    seen.add(at.$ref);
    const next = defs[at.$ref.replace(/^#\/\$defs\//, '')];
    if (next === undefined) { break; }
    at = next;
  }
  return at;
}

const words = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

const isList = (node: SchemaNode): boolean => node.type === 'array'
  || (node.type === 'object' && typeof node.additionalProperties === 'object');

function declaredSettings(schema: SchemaNode): { settings: Declared[]; groups: string[] } {
  const defs = schema.$defs ?? {};
  const settings: Declared[] = [];
  const groups: string[] = [];
  const walk = (node: SchemaNode, at: string[]): void => {
    const own = Object.entries(node.properties ?? {});
    for (const [key, declared] of own) {
      const r = resolved(declared, defs);
      const here = [...at, key];
      if (r.properties !== undefined) {
        groups.push(here.join('.'));
        walk(r, here);
        continue;
      }
      const hasDefault = 'default' in declared || 'default' in r;
      const base = key.endsWith('_append') ? own.find(([k]) => k === key.slice(0, -'_append'.length)) : undefined;
      const addsTo = base !== undefined && isList(r) && isList(resolved(base[1], defs)) ? [...at, base[0]].join('.') : null;
      settings.push({ path: here.join('.'), description: words(declared.description) || words(r.description), hasDefault, dflt: 'default' in declared ? declared.default : r.default, node: r, addsTo });
    }
  };
  walk(schema, []);
  return { settings, groups };
}

// drawnWords is a schema sentence as the panel is to draw it: each run it writes
// between backticks drawn as code, so its words are the sentence's with those
// backticks gone. Written apart from the extension's own reading, for the reason
// the walk above is.
const drawnWords = (sentence: string): string => {
  const parts = sentence.split('`');
  return parts.length % 2 === 1 ? parts.join('') : `${parts.slice(0, -1).join('')}\`${parts[parts.length - 1]}`;
};

// codeRuns are the runs a schema sentence writes between backticks.
const codeRuns = (sentence: string): string[] => sentence.split('`').filter((_, i, all) => i % 2 === 1 && (all.length % 2 === 1 || i < all.length - 1));

// reportSpelling is a declared default as the report spells a value, where the
// two notations agree, or null where they do not.
function reportSpelling(dflt: unknown): string | null {
  if (typeof dflt === 'string' || typeof dflt === 'number' || typeof dflt === 'boolean') { return String(dflt); }
  if (Array.isArray(dflt) && dflt.length === 0) { return '[]'; }
  return null;
}

// entryFields names every field an entry of a list declares, at any depth.
function entryFields(schema: SchemaNode, setting: Declared): string[] {
  const defs = schema.$defs ?? {};
  const entry = resolved(setting.node.items ?? (typeof setting.node.additionalProperties === 'object' ? setting.node.additionalProperties : {}), defs);
  const names: string[] = [];
  const walk = (node: SchemaNode): void => {
    for (const [key, declared] of Object.entries(node.properties ?? {})) {
      const r = resolved(declared, defs);
      if (r.properties !== undefined) { walk(r); } else { names.push(key); }
    }
  };
  walk(entry);
  return names;
}

// spelled is a declared default in the schema's own notation.
const spelled = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

// inWords is a key's last segment as the rule a reader is given says it is drawn:
// each underscore a space, an acronym in capitals, `x` joined to the word after it
// with a hyphen, the first letter capitalised, and nothing else. It is written
// apart from the extension's own derivation for the reason the walk above is.
const SPELLED: Readonly<Record<string, string>> = { ai: 'AI', cli: 'CLI', id: 'ID', jwks: 'JWKS', mcp: 'MCP', tls: 'TLS', url: 'URL', yaml: 'YAML' };
function inWords(key: string): string {
  const words = (key.split('.').pop() ?? key).split('_').filter((w) => w !== '');
  return words.map((w, i) => {
    const spelled = Object.hasOwn(SPELLED, w) ? SPELLED[w] : w;
    const shown = i === 0 ? spelled.charAt(0).toUpperCase() + spelled.slice(1) : spelled;
    return i === 0 ? shown : words[i - 1] === 'x' ? `-${shown}` : ` ${shown}`;
  }).join('');
}

// namedAs is the name the panel is to draw each of a page's settings with: its
// key in words, and where two read alike, each with the key of the group it sits
// in ahead of its own, one group further out while they still collide.
function namedAs(paths: string[]): Map<string, string> {
  const depth = new Map(paths.map((p) => [p, 1]));
  const nameOf = (p: string): string => inWords(p.split('.').slice(-(depth.get(p) ?? 1)).join('_'));
  for (;;) {
    const byName = new Map<string, string[]>();
    for (const p of paths) { byName.set(nameOf(p), [...(byName.get(nameOf(p)) ?? []), p]); }
    let grew = false;
    for (const alike of byName.values()) {
      if (alike.length < 2) { continue; }
      for (const p of alike) {
        const d = depth.get(p) ?? 1;
        if (d < p.split('.').length) { depth.set(p, d + 1); grew = true; }
      }
    }
    if (!grew) { return new Map(paths.map((p) => [p, nameOf(p)])); }
  }
}

// ---- the language server's own answers ---------------------------------------

interface Reported { field: string; value: string; source: string }
interface Report { layers: string[]; settings: Reported[] }

// ask asks the language server one question over the folder the window opened,
// outside the editor and through the extension's own client.
function ask(ctx: SuiteContext, method: string, params: unknown): Promise<ReferenceAnswer> {
  return referenceAnswer({ binary: ctx.inputs.compiler.path, root: ctx.folder, method, params, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
}

function schemaIn(a: ReferenceAnswer): SchemaNode | null {
  const s = a.ok ? (a.result as { schema?: unknown } | null)?.schema : null;
  return typeof s === 'object' && s !== null ? s as SchemaNode : null;
}

function reportIn(a: ReferenceAnswer): Report | null {
  const r = a.ok ? a.result as { layers?: unknown; settings?: unknown } | null : null;
  if (r === null || !Array.isArray(r.settings)) { return null; }
  return { layers: Array.isArray(r.layers) ? r.layers.filter((l): l is string => typeof l === 'string') : [], settings: r.settings as Reported[] };
}

const answerText = (a: ReferenceAnswer): string => JSON.stringify(a).slice(0, 300);

// ---- the panel as drawn -------------------------------------------------------

// TableRow is one setting's row of the table as drawn: its cells, its path and
// the companions named under it, its name and Global marker, its value with the
// words naming its mark, what it takes and its source, its circle and the hover
// on it, and the paragraphs the circle opens with the code drawn in the first.
interface TableRow {
  cells: number; path: string; companions: string[]; name: string; global: string | null; value: string; mark: string | null;
  takes: string; source: string; circle: string | null; title: string; description: string; paragraphs: string[]; codes: string[];
}
// BodyEntry is one row of the table's body in order: a group's heading row, read
// as the path it draws, or a setting's row, read as its path.
type BodyEntry = { group: string; name: string } | { setting: string };
interface Block { path: string; companions: string[]; label: string; description: string; descriptions: string[]; codes: string[]; shape: string; value: string; fold: string; source: string; reach: string | null }
interface Heading { text: string; own: string; named: string }
interface Census { forms: string[]; editable: string[]; saves: string[]; focusable: string[]; links: { words: string; href: string }[]; summaries: number; scripts: number }
interface Summary { heading: string; notes: string[]; layers: string[] | null; lists: number[] }
interface Switcher { words: string; afterSummary: boolean; next: string; top: number; summaryBottom: number | null }

// Reading is the whole panel as drawn now, in whichever shape it is in.
interface Reading {
  shape: 'table' | 'expanded';
  tables: number;
  heads: Heading[];
  body: BodyEntry[];
  rows: TableRow[];
  blocks: Block[];
  groups: { path: string; heading: string; description: string }[];
  headings: { level: string; text: string; inSummary: boolean }[];
  rule: { text: string; beforeSettings: boolean; count: number };
  // drawn is every description the page draws — a paragraph or a hover — as its
  // words, for the check that no backtick is drawn.
  drawn: string[];
  summary: Summary | null;
  switcher: Switcher | null;
  census: Census;
  bodyClass: string;
}

const READING = `(() => {
  const text = (e) => (e ? (e.textContent || '') : '').replace(/\\s+/g, ' ').trim();
  const table = d.querySelector('table.config-table');
  const summary = d.querySelector('section.config-summary');
  const sw = d.querySelector('p.config-switch');
  const link = sw ? sw.querySelector('a.config-switch-control') : null;
  const heads = table ? [...table.querySelectorAll('thead th')].map((th) => {
    const off = th.querySelector('.config-offscreen');
    return { text: (th.innerText || '').trim(), own: text(th).replace(off ? text(off) : '\\u0000', '').trim(), named: text(th) };
  }) : [];
  const isGroup = (tr) => tr.classList.contains('config-group-row');
  const codesIn = (e) => (e ? [...e.querySelectorAll('code')].map(text) : []);
  const bodyRows = table ? [...table.querySelectorAll('tbody tr')] : [];
  const body = bodyRows.map((tr) => (isGroup(tr) ? { group: text(tr.children[0]), name: text(tr.children[1]) } : { setting: text(tr.children[0] ? tr.children[0].querySelector('code') : null) }));
  const rows = bodyRows.filter((tr) => !isGroup(tr)).map((tr) => {
    const c = [...tr.children];
    const info = tr.querySelector('td.config-cell-info');
    const s = info ? info.querySelector('details.config-info > summary') : null;
    const mark = c[2] ? c[2].querySelector('.config-mark') : null;
    const value = c[2] ? (c[2].querySelector('.config-value-text') || c[2]) : null;
    const global = c[1] ? c[1].querySelector('.config-global') : null;
    return { cells: c.length, path: text(c[0] ? c[0].querySelector('code') : null), companions: c[0] ? [...c[0].querySelectorAll('.config-companion code')].map(text) : [],
      name: text(c[1] ? (c[1].querySelector('.config-name') || c[1]) : null), global: global ? text(global) : null, value: text(value), mark: mark ? (mark.getAttribute('aria-label') || text(mark)) : null,
      takes: text(c[3]), source: text(c[4]),
      circle: s ? text(s) : null, title: s ? (s.getAttribute('title') || '').replace(/\\s+/g, ' ').trim() : '', description: info ? text(info.querySelector('.config-description')) : '',
      paragraphs: info ? [...info.querySelectorAll('details.config-info > p')].map(text) : [], codes: codesIn(info ? info.querySelector('.config-description') : null) };
  });
  const blocks = [...d.querySelectorAll('dl.config-row')].map((dl) => ({ path: text(dl.querySelector('dt')), companions: [...dl.querySelectorAll('dt')].slice(1).map(text), label: text(dl.querySelector('.config-label')), description: text(dl.querySelector('.config-description')),
    descriptions: [...dl.querySelectorAll('.config-description')].map(text), codes: codesIn(dl.querySelector('.config-description')),
    shape: text(dl.querySelector('.config-shape')), value: text(dl.querySelector('.config-value')), fold: text(dl.querySelector('.config-fold')), source: text(dl.querySelector('.config-source')), reach: dl.querySelector('.config-reach') ? text(dl.querySelector('.config-reach')) : null }));
  const groups = [...d.querySelectorAll('section.config-group')].map((g) => {
    const h = g.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
    return { path: h ? text(h.querySelector('code')) : '', heading: text(h), description: text(g.querySelector(':scope > .config-description')) };
  });
  const ruleEl = d.querySelector('p.config-reach-rule');
  const firstBlock = d.querySelector('dl.config-row');
  const rule = { text: text(ruleEl), count: d.querySelectorAll('p.config-reach-rule').length,
    beforeSettings: !!ruleEl && !!firstBlock && !!(ruleEl.compareDocumentPosition(firstBlock) & Node.DOCUMENT_POSITION_FOLLOWING) };
  const drawn = [...d.querySelectorAll('.config-description, .config-fold')].map(text)
    .concat([...d.querySelectorAll('details.config-info > summary')].map((s) => s.getAttribute('title') || ''));
  const headings = [...d.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: h.tagName.toLowerCase(), text: text(h), inSummary: !!h.closest('section.config-summary') }));
  const census = {
    forms: [...d.querySelectorAll('input, select, textarea, button, option, form')].map((e) => e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '')),
    editable: [...d.querySelectorAll('[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="checkbox"], [role="switch"], [role="combobox"], [role="spinbutton"], [role="slider"], [role="button"], [role="radio"], [role="menuitem"]')].map((e) => e.tagName.toLowerCase()),
    saves: [...d.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /^save\\b/i.test(text(e))).map(text),
    focusable: [...d.querySelectorAll('[tabindex]')].filter((e) => e.tabIndex >= 0).map((e) => e.tagName.toLowerCase()),
    links: [...d.querySelectorAll('a[href]')].map((a) => ({ words: text(a), href: a.getAttribute('href') || '' })),
    summaries: d.querySelectorAll('details > summary').length,
    scripts: d.scripts.length,
  };
  return {
    shape: table ? 'table' : 'expanded', tables: d.querySelectorAll('table').length, heads, body, rows, blocks, groups, headings, rule, drawn,
    summary: summary ? { heading: text(summary.querySelector('h2')), notes: [...summary.querySelectorAll('p.config-note')].map(text), layers: summary.querySelector('ul.config-layers') ? [...summary.querySelectorAll('ul.config-layers > li')].map(text) : null, lists: [...summary.querySelectorAll('ul')].map((u) => u.children.length) } : null,
    switcher: sw ? { words: text(link), afterSummary: !!summary && sw.previousElementSibling === summary, next: sw.nextElementSibling ? sw.nextElementSibling.tagName.toLowerCase() + (sw.nextElementSibling.className ? '.' + String(sw.nextElementSibling.className).split(' ')[0] : '') : '', top: sw.getBoundingClientRect().top, summaryBottom: summary ? summary.getBoundingClientRect().bottom : null } : null,
    census,
    bodyClass: d.body ? d.body.className : '',
  };
})()`;

function readPanel(p: ConfigPanel): Promise<Reading> {
  return p.read<Reading>(READING);
}

// PanelsNow is how many configuration panels are drawn now: the documents holding
// one, and the editor tabs titled for one.
interface PanelsNow { documents: number; tabs: TabSeen[] }

async function panelsNow(ctx: SuiteContext): Promise<PanelsNow> {
  let documents = 0;
  for (const doc of await ctx.d.webviews()) {
    try {
      if (await evaluateWithin<boolean>(doc, `((d) => !!d && !!d.querySelector('main#config'))(${HOSTED})`, 2000)) { documents++; }
    } catch {
      // A document being replaced, or one that does not answer, is not counted.
      // That cannot make a drawn panel read as absent: the tabs titled for the
      // panel are read beside the documents, and every absence here holds only
      // where both read none.
    }
  }
  return { documents, tabs: (await tabs(ctx)).filter((t) => t.label === PANEL_TAB) };
}

const describePanels = (v: PanelsNow): string => `${v.documents} panel document(s), ${v.tabs.length} tab(s) titled "${PANEL_TAB}"${v.tabs.some((t) => t.active) ? ', one of them in front' : ''}`;

// pressShowConfig presses Show config on the Commands panel, as a reader does.
async function pressShowConfig(ctx: SuiteContext): Promise<void> {
  await run(ctx, 'workbench.view.extension.aggrega');
  await pressOperation(ctx.d, await commandsPanel(ctx.d), SHOW_CONFIG);
}

// shapeNow is the shape the panel is drawn in, once it is drawn.
async function shapeNow(ctx: SuiteContext): Promise<'table' | 'expanded'> {
  const host = await documentWith(ctx.d, 'the configuration panel drawn in either shape', `((d) => !!d && !!d.querySelector('main#config') && !!d.querySelector('a.config-switch-control'))(${HOSTED})`, PANEL_DRAWN_MS);
  return (await evaluateWithin<boolean>(host, `((d) => !!d.querySelector('table.config-table'))(${HOSTED})`, 5000)) ? 'table' : 'expanded';
}

// drawnAsTable is whether the panel is drawn as the table now.
const drawnAsTable = (p: ConfigPanel): Promise<boolean> => p.read<boolean>('!!d.querySelector(\'table.config-table\')');

// pressSwitch presses the shape switch and answers with the panel drawn in the
// other shape.
//
// 🔴 THE PRESS IS CONFIRMED BY THE REDRAW, AND MADE ONCE MORE ONLY WHERE THE PANEL
// STILL READS THE SHAPE IT WAS PRESSED IN. A click made just after the switch is
// scrolled a long way into view can run nothing, with the link under the pointer,
// where the same click made later redraws the panel. A second press is never made
// over a panel already redrawn, so a press that was only slow is not undone by it.
async function pressSwitch(ctx: SuiteContext, p: ConfigPanel, to: 'table' | 'expanded'): Promise<ConfigPanel> {
  const press = async (): Promise<void> => {
    await p.read(`(() => { const a = d.querySelector('a.config-switch-control'); if (a) { a.scrollIntoView({ block: 'center' }); } return !!a; })()`);
    const link = await p.box('a.config-switch-control');
    if (link === null || link.width === 0) { throw new Error('the panel draws no shape switch to press'); }
    await ctx.d.click(centre(link));
  };
  await press();
  const taken = await until(`the panel redrawn in its ${to} shape`, PANEL_DRAWN_MS, () => drawnAsTable(p), (t) => t === (to === 'table')).then(() => true, () => false);
  if (!taken && (await drawnAsTable(p)) !== (to === 'table')) { await press(); }
  return configPanel(ctx, to);
}

// inShape answers the panel drawn in `shape`, pressing the shape switch where it
// is drawn in the other.
async function inShape(ctx: SuiteContext, p: ConfigPanel, shape: 'table' | 'expanded'): Promise<ConfigPanel> {
  return (await drawnAsTable(p)) === (shape === 'table') ? p : pressSwitch(ctx, p, shape);
}

// closePanels closes every editor, the panel among them, and waits until no panel
// is drawn.
async function closePanels(ctx: SuiteContext): Promise<void> {
  await closeAllEditors(ctx);
  await until('no configuration panel left drawn', 5000, () => panelsNow(ctx), (v) => v.documents === 0 && v.tabs.length === 0);
}

const rowOf = (r: Reading, p: string): TableRow | undefined => r.rows.find((x) => x.path === p);
const blockOf = (r: Reading, p: string): Block | undefined => r.blocks.find((x) => x.path === p);
const describeRow = (r: TableRow | undefined): string => (r === undefined ? 'no such row' : JSON.stringify({ companions: r.companions, value: r.value, mark: r.mark, takes: r.takes, source: r.source }));
const describeBlock = (b: Block | undefined): string => (b === undefined ? 'no such block' : JSON.stringify({ companions: b.companions, value: b.value, fold: b.fold, source: b.source, reach: b.reach }));

// valueAsDrawn is the value the table is to draw for a value the report gives:
// the report's own spelling, or "none" where it gives none.
const valueAsDrawn = (reported: string): string => (reported === '' ? NONE : reported);

// waitNotice waits for the notification whose message opens as the panel's
// refusal does, and answers with it, or with why none came within the bound.
async function waitNotice(ctx: SuiteContext, mark: number): Promise<{ toast: Toast | null; why: string }> {
  return waitToast(ctx.d, `a notification opening "${NOTICE_LEAD}"`, mark, (t) => t.message.startsWith(NOTICE_LEAD), stated(PANEL_DRAWN_MS))
    .then((toast) => ({ toast, why: '' }), (err: unknown) => ({ toast: null, why: err instanceof Error ? err.message : String(err) }));
}

const describeNotice = (n: { toast: Toast | null; why: string }): string => (n.toast === null ? `none (${n.why})` : `"${n.toast.message}" (${n.toast.severity}), its actions ${JSON.stringify(n.toast.buttons)}`);

// toldNotRunning is whether the notification waited for is the one error saying
// the language server is not running, carrying the start and nothing else.
const toldNotRunning = (n: { toast: Toast | null }): boolean => n.toast !== null && n.toast.message === STOPPED_NOTICE && n.toast.severity === 'error'
  && n.toast.buttons.length === 1 && n.toast.buttons[0] === START;

// noPanelSince watches, from the notification on, that no panel is drawn, by the
// reading the check opening the panel saw it drawn with.
interface NoPanel { held: boolean; readings: number; broke?: PanelsNow; atMs?: number }
const noPanelSince = (ctx: SuiteContext): Promise<NoPanel> => holds(PANEL_DRAWN_MS, () => panelsNow(ctx), (v) => v.documents === 0 && v.tabs.length === 0);

const describeNone = (none: NoPanel): string => (none.held ? `no panel standing over ${none.readings} readings in ${PANEL_DRAWN_MS} ms` : `${describePanels(none.broke as PanelsNow)} ${none.atMs} ms in`);

// dialogDetail is the detail of each modal dialog drawn since a mark. `saidSince`
// records a dialog by its message alone, and the editor's own notice that a
// command failed carries the failure in its detail, so the detail is read beside
// it from the same observer.
async function dialogDetail(ctx: SuiteContext, mark: number): Promise<string> {
  const drawn: DialogSeen[] = (await dialogsSeen(ctx.d)).slice(mark);
  return drawn.length === 0 ? '' : `, their detail ${JSON.stringify(drawn.map((x) => x.detail))}`;
}

// OpenThenStopped is the panel a check opened with the language server running and
// left open while the server was stopped: the panel, what the reading the checks'
// absences are read by saw drawn with it open, the mark its document was given,
// and the status bar's readings as the server stopped.
interface OpenThenStopped { opened: ConfigPanel; drawn: PanelsNow; token: string; stop: StatusReading[] }

// openThenStop points the binary setting back at the binary under test from
// `notABinary`, waits for the language server to read running, opens the panel
// with Show config, marks its document, and stops the server again by pointing
// the setting at `notABinary`, leaving the panel open.
async function openThenStop(ctx: SuiteContext, notABinary: string): Promise<OpenThenStopped> {
  const start = await statusMark(ctx);
  await setBinaryPath(ctx, notABinary, ctx.inputs.compiler.path);
  await statusReadsSince(ctx, start, RUNNING, SERVER_BOUND_MS);
  await pressShowConfig(ctx);
  const opened = await configPanel(ctx, await shapeNow(ctx));
  const drawn = await panelsNow(ctx);
  const token = `reading-${Date.now()}`;
  await opened.read(`(d.documentElement.dataset.suiteReading = ${JSON.stringify(token)}, true)`);
  const mark = await statusMark(ctx);
  await setBinaryPath(ctx, ctx.inputs.compiler.path, notABinary, 'its-own');
  const stop = await statusReadsSince(ctx, mark, NOT_RUNNING, SERVER_BOUND_MS);
  return { opened, drawn, token, stop };
}

// stillTheDocument is whether the panel opened before the stop is still drawn
// with the mark its document was given, said in words; a panel closed since has
// no document to read.
async function stillTheDocument(o: OpenThenStopped): Promise<string> {
  return o.opened.read<boolean>(`d.documentElement.dataset.suiteReading === ${JSON.stringify(o.token)}`)
    .then((v) => (v ? 'its document still the document read before the stop' : 'its document one drawn since'), (err: unknown) => `its document not readable: ${err instanceof Error ? err.message : String(err)}`);
}

// userSettingsOf is the user settings file of the scenario's own profile.
const userSettingsOf = (ctx: SuiteContext): string => path.join(ctx.s.root.userData, 'User', 'settings.json');

// GRACE_LINE is the grace setting's line as the check writes it into the user
// settings.
const GRACE_LINE = `  ${JSON.stringify(GRACE_SETTING)}: ${HELD_GRACE_SECONDS},`;

// holdRestartGrace writes GRACE_LINE into the user settings, in the editor as a
// person edits it, as the first line inside the file's opening brace, and saves
// it; with `hold` false it takes that line out again, leaving the grace at its
// default. Every editor is closed afterwards, as setBinaryPath leaves them.
async function holdRestartGrace(ctx: SuiteContext, hold: boolean): Promise<void> {
  const file = userSettingsOf(ctx);
  if (hold) {
    const text = (await open(ctx, file)).text ?? '';
    need(text.startsWith('{\n') && !text.includes(GRACE_SETTING), `the user settings do not open with a brace on a line of its own, or already name ${GRACE_SETTING}`);
    await ctx.probe.request('document.edit', { path: file, start: { line: 1, character: 0 }, text: `${GRACE_LINE}\n` });
  } else {
    await deleteLine(ctx, file, GRACE_LINE);
  }
  await save(ctx, file);
  await closeAllEditors(ctx);
}

// statusMenu opens the status bar menu and answers with the entries it offers.
async function statusMenu(ctx: SuiteContext): Promise<string[]> {
  await send(ctx, STATUS_BAR_MENU_COMMAND);
  const q = await waitQuickInput(ctx.d, 'the status bar menu', (x) => x.placeholder === MENU_PLACEHOLDER && x.rows.length > 0);
  return q.rows.map((r) => r.label);
}

// closeStatusMenu puts the status bar menu away with Escape and waits for it to go.
async function closeStatusMenu(ctx: SuiteContext): Promise<void> {
  await ctx.d.press('Escape');
  await until('the status bar menu closing on Escape', 5000, () => quickInput(ctx.d), (q) => q === null);
}

// NothingPending is whether no restart is left pending, and how that was read.
interface NothingPending { none: boolean; seen: string }

// putAwayPendingRestart leaves no restart pending, through the product's own
// control for one: the status bar menu offers "Cancel restart" exactly while a
// restart is pending. Where it is offered it is pressed, the channel's word that
// the restart was cancelled is waited for, and the menu is read again; where it
// is not, nothing was pending. What stops it is said rather than thrown.
async function putAwayPendingRestart(ctx: SuiteContext): Promise<NothingPending> {
  try {
    const offered = await statusMenu(ctx);
    if (!offered.includes(CANCEL_RESTART)) {
      await closeStatusMenu(ctx);
      return { none: true, seen: `the status bar menu offered ${JSON.stringify(offered)}, no "${CANCEL_RESTART}", so no restart was pending` };
    }
    const mark = ctx.out.mark();
    await pickQuickInputRow(ctx.d, CANCEL_RESTART);
    await ctx.out.waitFor(`the channel saying "${RESTART_CANCELLED}"`, mark, (t) => t.includes(RESTART_CANCELLED), PANEL_DRAWN_MS);
    const after = await statusMenu(ctx);
    await closeStatusMenu(ctx);
    return {
      none: !after.includes(CANCEL_RESTART),
      seen: `the status bar menu offered ${JSON.stringify(offered)}, a restart still pending; "${CANCEL_RESTART}" pressed, the channel said "${RESTART_CANCELLED}", and the menu opened again offered ${JSON.stringify(after)}`,
    };
  } catch (err) {
    return { none: false, seen: `the pending restart was not put away: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function configurationReportChecks(ctx: SuiteContext, notABinary: string): Promise<void> {
  const c = ctx.checks;
  const showTitle = commandTitle(ctx.manifest, SHOW_CONFIG);
  // putAway puts away whatever a press left drawn — the editor's own dialog, where
  // the command failed — through `leftOpen`, so the checks after it start from the
  // workbench at rest. What it answers fails the check that left something, and a
  // reading of it that stops is said the same way rather than ending the check and
  // its seen text with it.
  const putAway = (): Promise<string | null> => leftOpen(ctx).catch((err: unknown) => `what was left drawn could not be read: ${err instanceof Error ? err.message : String(err)}`);
  await ready(ctx);

  // What the language server serves and reports, asked once each and kept, with
  // its answer as given where it gave none a check can read.
  let schemaAnswer: ReferenceAnswer | null = null;
  const servedSchema = async (): Promise<{ schema: SchemaNode | null; seen: string }> => {
    schemaAnswer = schemaAnswer ?? await ask(ctx, 'aggrega/getSchema', { kind: CONFIG_SCHEMA_KIND });
    const schema = schemaIn(schemaAnswer);
    return { schema, seen: schema === null ? `aggrega/getSchema answered ${answerText(schemaAnswer)}` : '' };
  };
  let reportAnswer: ReferenceAnswer | null = null;
  const servedReport = async (): Promise<{ report: Report | null; seen: string }> => {
    reportAnswer = reportAnswer ?? await ask(ctx, 'aggrega/effectiveConfiguration', {});
    const report = reportIn(reportAnswer);
    return { report, seen: report === null ? `aggrega/effectiveConfiguration answered ${answerText(reportAnswer)}` : '' };
  };

  let panel: ConfigPanel | null = null;
  let table: Reading | null = null;
  let expanded: Reading | null = null;
  let drawnMs: number | null = null;

  await c.run('config-panel.opens-as-a-table-in-its-own-tab', {
    expected: `with no panel drawn, pressing "${showTitle}" on the Commands panel draws one panel within ${PANEL_DRAWN_MS} ms, in the editor area under one tab titled "${PANEL_TAB}", that tab in front, holding one table with a row per setting — the shape it opens in for a reader who has never chosen one`,
    plant: 'in the scratch copy, out/src/config-view.js with the panel created under another title',
  }, async () => {
    await closePanels(ctx);
    const before = await panelsNow(ctx);
    const t0 = Date.now();
    await pressShowConfig(ctx);
    const drawn = await until('the configuration panel being drawn', stated(PANEL_DRAWN_MS), () => panelsNow(ctx), (v) => v.documents === 1);
    drawnMs = Date.now() - t0;
    const shape = await shapeNow(ctx);
    panel = await configPanel(ctx, shape);
    const r = await readPanel(panel);
    // A panel opened in the other shape fails this check; the checks after it are
    // about the table, so they are handed the table all the same.
    if (r.shape !== 'table') { panel = await pressSwitch(ctx, panel, 'table'); }
    table = r.shape === 'table' ? r : await readPanel(panel);
    const tabsNow = (await panelsNow(ctx)).tabs;
    return {
      passed: tabsNow.length === 1 && tabsNow[0].active && r.shape === 'table' && r.tables === 1 && r.rows.length > 0,
      seen: `before the press ${describePanels(before)}; ${drawnMs} ms after it ${describePanels(drawn)}, drawn in the ${shape} shape with ${r.tables} table(s) of ${r.rows.length} row(s); the tabs titled for it ${JSON.stringify(tabsNow.map((t) => `${t.label}${t.active ? ' (in front)' : ''}`))}`,
    };
  });

  await c.run('config-panel.every-setting-the-schema-declares-is-a-row-or-named-on-its-lists', {
    expected: `the table's settings — each row's path, and each companion named under it — are, once each, exactly the settings the configuration schema the language server serves declares (aggrega/getSchema asked for "${CONFIG_SCHEMA_KIND}" over the same folder): a declaration that groups others is descended into and is no row itself, as ${NAMED_GROUP} is not and its members are, a list of entries is one row, and a list's additive companion — its key the list's followed by "_append", as ${COMPANION} — is named on its list's row and is no row of its own; and the last row, scrolled to, stands drawn whole in the panel's view`,
    plant: 'in the scratch copy, out/src/config-schema.js with the last declaration at every level of the schema left out of the walk',
  }, async () => {
    need(table !== null && panel !== null, 'no panel was drawn by the check opening it');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const declared = declaredSettings(schema);
    const drawn = [...table.rows.map((r) => r.path), ...table.rows.flatMap((r) => r.companions)];
    const want = declared.settings.map((s) => s.path);
    const missing = want.filter((p) => !drawn.includes(p));
    const extra = drawn.filter((p) => !want.includes(p));
    const twice = drawn.filter((p, i) => drawn.indexOf(p) !== i);
    const groupRows = drawn.filter((p) => declared.groups.includes(p));
    // Each companion is named on its own list's row and on no other, and is no row.
    const misplaced = declared.settings.filter((s) => s.addsTo !== null)
      .filter((s) => rowOf(table as Reading, s.addsTo as string)?.companions.includes(s.path) !== true || rowOf(table as Reading, s.path) !== undefined)
      .map((s) => s.path);
    const companions = declared.settings.filter((s) => s.addsTo !== null).map((s) => `${s.path} on ${s.addsTo}`);
    const last = await panel.read<{ path: string; top: number; bottom: number; height: number; view: number } | null>(`(() => {
      const rows = d.querySelectorAll('table.config-table tbody tr');
      const r = rows[rows.length - 1];
      if (!r) { return null; }
      r.scrollIntoView({ block: 'end' });
      const b = r.getBoundingClientRect();
      const code = r.children[0].querySelector('code');
      return { path: ((code || r.children[0]).textContent || '').trim(), top: b.top, bottom: b.bottom, height: b.height, view: d.defaultView.innerHeight };
    })()`);
    await panel.read('(d.scrollingElement.scrollTop = 0, true)');
    const lastInView = last !== null && last.height > 0 && last.top >= -0.5 && last.bottom <= last.view + 0.5;
    return {
      passed: want.length > 0 && missing.length === 0 && extra.length === 0 && twice.length === 0 && groupRows.length === 0 && companions.length > 0 && misplaced.length === 0 && lastInView,
      seen: `the served schema declares ${want.length} settings in ${declared.groups.length} groups, ${companions.length} of them a list's companion (${companions.join('; ')}); the table draws ${table.rows.length} rows naming ${drawn.length} settings${missing.length > 0 ? `, missing ${JSON.stringify(missing)}` : ''}${extra.length > 0 ? `, beyond the schema ${JSON.stringify(extra)}` : ''}${twice.length > 0 ? `, twice ${JSON.stringify(twice)}` : ''}${groupRows.length > 0 ? `, a group drawn as a row ${JSON.stringify(groupRows)}` : ''}${misplaced.length > 0 ? `, companions not named on their list's row alone ${JSON.stringify(misplaced)}` : ''}; the last row ${last === null ? 'not found' : `"${last.path}" scrolled to stands ${Math.round(last.top)} to ${Math.round(last.bottom)} px in a view ${last.view} px tall`}`,
    };
  });

  await c.run('config-panel.coverage-sentence-names-what-the-report-leaves-unattributed', {
    expected: `the summary box carries a line opening "${NO_ROW_LEAD}" exactly where some row's setting is named nowhere in the language server's own report (aggrega/effectiveConfiguration over the same folder), and that line names each such setting; where the report names every row — as it does here, each list's companion being folded into its list's row — no such line is drawn`,
    plant: 'in the scratch copy, out/src/config-render.js with the coverage sentence drawn whether or not a setting is left unattributed',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const { report, seen } = await servedReport();
    if (report === null) { return { passed: false, seen }; }
    const named = new Set(report.settings.map((s) => s.field));
    const unattributed = table.rows.filter((r) => !named.has(r.path)).map((r) => r.path);
    const notes = table.summary?.notes ?? [];
    const lines = notes.filter((n) => n.startsWith(NO_ROW_LEAD));
    const right = unattributed.length === 0
      ? lines.length === 0
      : lines.length === 1 && unattributed.every((p) => lines[0].includes(p));
    return {
      passed: right,
      seen: `${table.rows.length} rows drawn, ${unattributed.length === 0 ? 'every one named by the report' : `the report naming none of ${JSON.stringify(unattributed)}`} (${report.settings.length} settings reported); the summary's lines ${JSON.stringify(notes)}`,
    };
  });

  await c.run('config-panel.each-group-opens-with-a-heading-row-and-entry-fields-are-named', {
    expected: `the table marks its groups: every setting inside a group stands beneath a heading row reading its group's path — the nearest heading row above it — and every heading row reads a group the served schema declares, once, followed by at least one setting of that group; the settings at the top level come before the first heading row; the table reaches every depth: ${NESTED}, a member of a group within a group, is a row beneath "lint.publishing_discipline"; and the ${ENTRIES} row's Takes cell names, after "${EACH_CARRYING}", every field the served schema declares for one of its entries, at any depth`,
    plant: 'in the scratch copy, out/src/config-render.js with no heading row drawn over a group; out/src/config-schema.js with the fields an entry declares inside a group of its own left out of the fields named',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const declared = declaredSettings(schema);
    const groupOf = (p: string): string => p.split('.').slice(0, -1).join('.');
    const wrong: string[] = [];
    let under: string | null = null;
    const headed: string[] = [];
    let since = 0;
    for (const entry of table.body) {
      if ('group' in entry) {
        if (under !== null && since === 0) { wrong.push(`the heading ${under} heads no setting`); }
        under = entry.group;
        headed.push(entry.group);
        since = 0;
        if (!declared.groups.includes(entry.group)) { wrong.push(`a heading reads ${JSON.stringify(entry.group)}, no group the schema declares`); }
        continue;
      }
      since++;
      const want = groupOf(entry.setting);
      if ((want === '' && under !== null) || (want !== '' && under !== want)) { wrong.push(`${entry.setting} stands under ${under === null ? 'no heading' : JSON.stringify(under)}`); }
    }
    if (under !== null && since === 0) { wrong.push(`the heading ${under} heads no setting`); }
    const twice = headed.filter((g, i) => headed.indexOf(g) !== i);
    const nested = rowOf(table, NESTED);
    const entriesDeclared = declared.settings.find((s) => s.path === ENTRIES);
    const fields = entriesDeclared === undefined ? [] : entryFields(schema, entriesDeclared);
    const entries = rowOf(table, ENTRIES);
    const after = entries === undefined ? -1 : entries.takes.indexOf(`${EACH_CARRYING} `);
    const named = entries === undefined || after === -1 ? [] : entries.takes.slice(after + EACH_CARRYING.length + 1).split(', ');
    const unnamed = fields.filter((f) => !named.includes(f));
    return {
      passed: headed.length > 0 && wrong.length === 0 && twice.length === 0 && nested !== undefined && fields.length > 0 && entries !== undefined && unnamed.length === 0,
      seen: `${headed.length} heading rows ${JSON.stringify(headed)}${twice.length > 0 ? `, drawn twice ${JSON.stringify(twice)}` : ''}${wrong.length > 0 ? `; out of place: ${JSON.stringify(wrong.slice(0, 5))}` : '; every setting beneath its own group\'s heading, the top-level ones first'}; ${NESTED} ${nested === undefined ? 'drawn as no row' : 'drawn as a row'}; the ${ENTRIES} entry declares ${JSON.stringify(fields)} and its row takes ${JSON.stringify(entries?.takes ?? null)}${unnamed.length > 0 ? `, naming none of ${JSON.stringify(unnamed)}` : ''}`,
    };
  });

  await c.forPerson('config-panel.grouped-table-is-the-right-shape', {
    expected: 'the table as it opens, its settings beneath a heading row for each group of the configuration, the top-level settings first',
    plant: 'none: whether the grouped table is right is the judgement asked for',
    question: 'The capture shows the configuration table as it opens; the text below lists its rows in order, each group\'s heading row marked "▸". Do the group headings make the table read right — and do the names beside each path read well under them?',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const left = await clearForCapture(ctx);
    const rows = table.body.map((entry) => ('group' in entry ? `▸ ${entry.group} | ${entry.name}` : `${entry.setting} | ${rowOf(table as Reading, entry.setting)?.name ?? ''}`));
    return { screenshot: await capture(ctx, 'config-table-as-it-opens'), drawnText: `${table.rows.length} rows:\n${rows.join('\n')}${left}` };
  });

  await c.run('config-panel.columns-read-in-order-under-visible-headings', {
    expected: `the table's headings read, left to right, ${HEADINGS.join(', ')} and ${LAST_HEADING}, every one drawn in words — the last too, over the column of circles; every setting's row has a cell under each, the last holding the small circle marked "${CIRCLE}", so no column is given to a setting's reach; ${PARSE_CACHE_CAP} takes "${wholeNumberTakes('<the minimum the served schema declares for it>')}"; and ${KEYED}, a collection of entries keyed by name, takes "${NAMED_ENTRIES}…"`,
    plant: 'in the scratch copy, out/src/config-render.js with the first heading reading "config keyword"; out/src/config-render.js with the last heading drawing no words',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const drawn = table.heads.map((h) => h.text);
    const visible = table.heads.every((h) => h.own !== '' && h.own === h.text);
    const offRows = table.rows.filter((r) => r.cells !== HEADINGS.length + 1 || r.circle !== CIRCLE);
    const minimum = declaredSettings(schema).settings.find((s) => s.path === PARSE_CACHE_CAP)?.node.minimum;
    const bounded = rowOf(table, PARSE_CACHE_CAP);
    const keyed = rowOf(table, KEYED);
    return {
      passed: JSON.stringify(drawn) === JSON.stringify([...HEADINGS, LAST_HEADING]) && visible && offRows.length === 0 && typeof minimum === 'number' && bounded !== undefined && bounded.takes === wholeNumberTakes(minimum)
        && keyed !== undefined && keyed.takes.startsWith(NAMED_ENTRIES),
      seen: `the headings drawn ${JSON.stringify(drawn)}${visible ? ', each in words' : `, as read for assistive technology ${JSON.stringify(table.heads.map((h) => h.named))}`}; ${offRows.length === 0 ? 'every row ends in the circle' : `rows not ending in the circle ${JSON.stringify(offRows.slice(0, 3).map((r) => `${r.path}: ${r.cells} cells, ${JSON.stringify(r.circle)}`))}`}; ${PARSE_CACHE_CAP} declared at least ${String(minimum)} and taking ${JSON.stringify(bounded?.takes ?? null)}; ${KEYED} taking ${JSON.stringify(keyed?.takes ?? null)}`,
    };
  });

  await c.forPerson('config-panel.columns-and-their-headings-are-the-ones-wanted', {
    expected: `the table's columns as they are drawn: the setting as written, its name in words, the one Value column — what applies now, marked "${MARK}" where a file or the environment set it or it is not the declared default — Takes, Source, and ${LAST_HEADING} over the circles`,
    plant: 'none: whether the columns and their headings are the right ones is the judgement asked for',
    question: `The capture shows the configuration table's columns; the text below gives the headings and each row's Value and Takes cells. Do the one Value column with its mark, and the headings as drawn — the last reading "${LAST_HEADING}" — say what you want them to?`,
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'config-table-columns'), drawnText: `headings: ${JSON.stringify(table.heads.map((h) => h.text))}\n${table.rows.map((r) => `${r.path} | ${r.mark === null ? '' : `${MARK} `}${r.value} | takes ${r.takes}`).join('\n')}${left}` };
  });

  await c.run('config-panel.one-value-column-marked-where-not-the-declared-default', {
    expected: `each row's one value cell reads what applies now — the value the language server's own report gives it, "${NONE}" where the report gives none — and carries the mark "${MARK}" exactly where that report attributes the value to a file or to the environment, or gives a value that is not the default the served schema declares; the mark's words say why, as "${markWords(SET_IN_A_FILE, '<the declared default>')}"; here the folder's own ${CONFIG_FILENAME} sets ${COMPANION}, so the ${COMPANION_LIST} row is marked, and the rows at the built-in defaults are not`,
    plant: 'in the scratch copy, out/src/config-model.js with every value the report gives marked as one a file set',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const { schema, seen: schemaSeen } = await servedSchema();
    const { report, seen } = await servedReport();
    if (schema === null || report === null) { return { passed: false, seen: `${schemaSeen} ${seen}`.trim() }; }
    const declared = declaredSettings(schema).settings;
    const wrong: string[] = [];
    for (const r of table.rows) {
      const rep = report.settings.find((s) => s.field === r.path);
      if (rep === undefined) { continue; }
      const d = declared.find((s) => s.path === r.path);
      const dflt = d !== undefined && d.hasDefault ? spelled(d.dflt) : null;
      const asReported = d !== undefined && d.hasDefault ? reportSpelling(d.dflt) : null;
      const why = rep.source.startsWith('env:') ? SET_IN_THE_ENVIRONMENT
        : rep.source !== '' && rep.source !== DEFAULTS_SOURCE ? SET_IN_A_FILE
          : asReported !== null && asReported !== rep.value ? NOT_THE_DEFAULT : null;
      const mark = why === null ? null : markWords(why, dflt);
      if (r.value !== valueAsDrawn(rep.value) || r.mark !== mark) { wrong.push(`${r.path}: ${describeRow(r)} where ${JSON.stringify({ value: valueAsDrawn(rep.value), mark })}`); }
    }
    const marked = table.rows.filter((r) => r.mark !== null).map((r) => r.path);
    const unmarkedAtDefaults = table.rows.filter((r) => r.mark === null && report.settings.some((s) => s.field === r.path && s.source === DEFAULTS_SOURCE)).length;
    return {
      passed: wrong.length === 0 && marked.includes(COMPANION_LIST) && unmarkedAtDefaults > 0,
      seen: `rows carrying the mark ${JSON.stringify(marked)}; ${unmarkedAtDefaults} row(s) at the built-in defaults carry none${wrong.length > 0 ? `; otherwise than the report: ${JSON.stringify(wrong.slice(0, 5))}` : ''}`,
    };
  });

  await c.run('config-panel.none-where-no-value-is-in-force', {
    expected: `every row the language server's own report gives no value for reads "${NONE}" in its value cell rather than drawing nothing, and an empty list reads "[]" as the report gives it; no value cell is drawn empty`,
    plant: 'in the scratch copy, out/src/config-render.js with "none" drawn as nothing',
  }, async () => {
    need(table !== null, 'no panel was drawn by the check opening it');
    const { report, seen } = await servedReport();
    if (report === null) { return { passed: false, seen }; }
    const givenNone = report.settings.filter((s) => s.value === '').map((s) => s.field);
    const emptyLists = report.settings.filter((s) => s.value === '[]').map((s) => s.field);
    const notNone = givenNone.filter((p) => rowOf(table as Reading, p)?.value !== NONE);
    const notList = emptyLists.filter((p) => rowOf(table as Reading, p)?.value !== '[]');
    const blank = table.rows.filter((r) => r.value === '').map((r) => r.path);
    return {
      passed: givenNone.length > 0 && emptyLists.length > 0 && notNone.length === 0 && notList.length === 0 && blank.length === 0,
      seen: `${givenNone.length} setting(s) the report gives no value, ${notNone.length === 0 ? `each reading "${NONE}"` : `these not reading "${NONE}": ${JSON.stringify(notNone.map((p) => `${p}: ${JSON.stringify(rowOf(table as Reading, p)?.value ?? null)}`))}`}; ${emptyLists.length} empty list(s), ${notList.length === 0 ? 'each reading "[]"' : `these otherwise ${JSON.stringify(notList)}`}; value cells drawn empty ${JSON.stringify(blank)}`,
    };
  });

  await c.run('config-panel.no-value-breaks-inside-a-word', {
    expected: 'as the table opens in the editor area, no line break inside a value cell or a Source cell falls between two letters or digits — every break comes after a space, "/", ".", "_" or "-" — read character by character from each cell\'s own text',
    plant: 'in the scratch copy, media/config.css with a value or a source allowed to break anywhere',
  }, async () => {
    need(panel !== null, 'no panel was drawn by the check opening it');
    const read = await panel.read<{ cells: number; wrapped: number; breaks: { path: string; pair: string }[] }>(`(() => {
      const rows = [...d.querySelectorAll('table.config-table tbody tr:not(.config-group-row)')];
      const breaks = [];
      let wrapped = 0;
      let cells = 0;
      for (const tr of rows) {
        const code = tr.children[0] ? tr.children[0].querySelector('code') : null;
        const key = code ? (code.textContent || '').trim() : '';
        for (const cell of [tr.querySelector('td.config-cell-value'), tr.querySelector('td.config-cell-source')]) {
          if (!cell) { continue; }
          cells++;
          let before = null;
          let lines = 0;
          const walk = d.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
            for (let i = 0; i < n.data.length; i++) {
              const r = d.createRange();
              r.setStart(n, i);
              r.setEnd(n, i + 1);
              const b = [...r.getClientRects()].find((x) => x.width > 0);
              if (!b) { continue; }
              const top = Math.round(b.top);
              if (before === null) { lines = 1; } else if (top > before.top + 1) { lines++; breaks.push({ path: key, pair: before.ch + n.data[i] }); }
              before = { ch: n.data[i], top };
            }
          }
          if (lines > 1) { wrapped++; }
        }
      }
      return { cells, wrapped, breaks };
    })()`);
    const midWord = read.breaks.filter((b) => /^[\p{L}\p{N}][\p{L}\p{N}]$/u.test(b.pair));
    return {
      passed: read.cells > 0 && midWord.length === 0,
      seen: `${read.cells} value and Source cells, ${read.wrapped} of them on more than one line, ${read.breaks.length} breaks in all; ${midWord.length === 0 ? 'none between two letters or digits' : `inside a word: ${JSON.stringify(midWord.slice(0, 5).map((b) => `${b.path} at "${b.pair[0]}|${b.pair[1]}"`))}`}`,
    };
  });

  await c.run('config-panel.each-description-is-the-schemas-own-sentence', {
    expected: `every row's circle carries, as the words its hover shows (the control's title) and in the paragraph it opens, the description the served schema declares for that setting — its declaration's own, or the definition's it refers to — in the words the panel draws it in, each run the schema writes between backticks drawn as code; and none is empty; a row a companion is folded into carries after it the companion's own sentence, opened by the companion's path, and what the report gives for the two; pressing the circle on the ${OFFLINE} row opens that paragraph in the row, drawn with a height, and pressing it again closes it; and the page holds no script`,
    plant: 'in the scratch copy, out/src/config-render.js with each circle\'s hover reading the words that name its control instead of the setting\'s description',
  }, async () => {
    need(table !== null && panel !== null, 'no panel was drawn by the check opening it');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const declared = declaredSettings(schema).settings;
    const sentenceOf = (p: string): string => drawnWords(declared.find((s) => s.path === p)?.description ?? '');
    const off = table.rows.filter((r) => {
      const want = sentenceOf(r.path);
      const after = r.companions.flatMap((c) => [`${c}: ${sentenceOf(c)}`]).concat(r.companions.length > 0 ? [foldWords(r.companions.join(' and '))] : []);
      return want === '' || r.title !== want || r.description !== want || JSON.stringify(r.paragraphs) !== JSON.stringify([want, ...after]);
    });
    const at = table.rows.findIndex((r) => r.path === OFFLINE);
    if (at === -1) { return { passed: false, seen: `the table draws no ${OFFLINE} row to press the circle of` }; }
    // The row is found by the path it draws, and marked for the reads below, so a
    // group's heading row before it does not count among the rows.
    const p = panel;
    await p.read(`(() => { for (const tr of d.querySelectorAll('table.config-table tbody tr')) { const code = tr.children[0] ? tr.children[0].querySelector('code') : null; if (code && (code.textContent || '').trim() === ${JSON.stringify(OFFLINE)}) { tr.dataset.suiteRow = 'pressed'; } } return true; })()`);
    const details = 'table.config-table tbody tr[data-suite-row="pressed"] details.config-info';
    const opened = (): Promise<{ open: boolean; height: number; text: string }> => p.read(`(() => { const det = d.querySelector(${JSON.stringify(details)}); const para = det ? det.querySelector('.config-description') : null; return { open: !!det && det.open, height: para ? para.getBoundingClientRect().height : 0, text: para ? (para.textContent || '').replace(/\\s+/g, ' ').trim() : '' }; })()`);
    const press = async (): Promise<void> => {
      await p.read(`(d.querySelector(${JSON.stringify(`${details} > summary`)}).scrollIntoView({ block: 'center' }), true)`);
      const box = await p.box(`${details} > summary`);
      if (box === null || box.width === 0) { throw new Error(`the ${OFFLINE} row draws no circle to press`); }
      await ctx.d.click(centre(box));
    };
    const t0 = Date.now();
    await press();
    const shown = await until(`the ${OFFLINE} row's description opening on the press`, 5000, opened, (v) => v.open && v.height > 0);
    const openMs = Date.now() - t0;
    await press();
    await until(`the ${OFFLINE} row's description closing on the second press`, 5000, opened, (v) => !v.open);
    await p.read('(d.scrollingElement.scrollTop = 0, true)');
    const want = sentenceOf(OFFLINE);
    return {
      passed: off.length === 0 && shown.text === want && table.census.scripts === 0,
      seen: `${off.length === 0 ? `every one of the ${table.rows.length} rows carries the schema's sentence on its hover and in its paragraph` : `rows otherwise: ${JSON.stringify(off.slice(0, 3).map((r) => `${r.path}: hover ${JSON.stringify(r.title.slice(0, 80))}, paragraph ${JSON.stringify(r.description.slice(0, 80))}`))}`}; the ${OFFLINE} circle pressed opened its paragraph ${Math.round(shown.height)} px tall ${openMs} ms after the press, reading ${JSON.stringify(shown.text.slice(0, 120))}, and a second press closed it; ${table.census.scripts} script element(s) on the page`,
    };
  });

  await c.run('config-panel.shape-switch-sits-below-the-summary-and-draws-each-setting-in-full', {
    expected: `the element immediately after the box headed "${SUMMARY_HEADING}" — drawn below it, and before the table — is the one control reading "${TO_EXPANDED}"; pressing it redraws the panel as one block per setting, the same settings the table drew, each block carrying in place the description the served schema declares for it, and the control then reads "${TO_TABLE}"`,
    plant: 'in the scratch copy, out/src/config-render.js with the shape switch drawn after the settings',
  }, async () => {
    need(table !== null && panel !== null, 'no panel was drawn by the check opening it');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const sw = table.switcher;
    const placed = sw !== null && sw.afterSummary && sw.words === TO_EXPANDED && sw.next.startsWith('table') && sw.summaryBottom !== null && sw.top >= sw.summaryBottom - 0.5;
    const headed = table.summary?.heading === SUMMARY_HEADING;
    panel = await pressSwitch(ctx, panel, 'expanded');
    expanded = await readPanel(panel);
    const declared = declaredSettings(schema).settings;
    const undescribed = expanded.blocks.filter((b) => b.description === '' || b.description !== drawnWords(declared.find((s) => s.path === b.path)?.description ?? ''));
    const same = sameSet(expanded.blocks.map((b) => b.path), table.rows.map((r) => r.path));
    return {
      passed: placed && headed && same && undescribed.length === 0 && expanded.switcher?.words === TO_TABLE,
      seen: `the summary box headed ${JSON.stringify(table.summary?.heading ?? null)}; the element after it ${sw === null ? 'no switch' : `${sw.afterSummary ? 'is' : 'is not'} the switch, reading ${JSON.stringify(sw.words)}, its top ${Math.round(sw.top)} px against the box's bottom ${sw.summaryBottom === null ? '-' : Math.round(sw.summaryBottom)} px, followed by ${sw.next}`}; pressed, the panel draws ${expanded.blocks.length} block(s)${same ? ', the table\'s settings' : ', not the table\'s settings'}${undescribed.length > 0 ? `, ${undescribed.length} without the schema's sentence, as ${JSON.stringify(undescribed.slice(0, 3).map((b) => b.path))}` : ', each with the schema\'s sentence'}, and the switch reads ${JSON.stringify(expanded.switcher?.words ?? null)}`,
    };
  });

  await c.run('config-panel.reach-note-on-the-machine-wide-settings-alone', {
    expected: `in the per-setting shape a note is drawn on exactly the blocks of ${MACHINE_WIDE.join(', ')}, each opening with the label "${GLOBAL_LABEL}" and then its reason, no reason calling its setting machine-wide; the ${ENTRIES} block's note reads "${REGISTRIES_NOTE}" and its block names its entry's fields; ${UNCLASSIFIED_NAMED.join(', ')} and every setting of the ${UNCLASSIFIED_GROUP} group carry none`,
    plant: 'in the scratch copy, out/src/config-render.js with the reach note labelled "Machine-wide:"',
  }, async () => {
    need(expanded !== null, 'the panel was not drawn in the per-setting shape by the check switching to it');
    const noted = expanded.blocks.filter((b) => b.reach !== null);
    const mislabelled = noted.filter((b) => !(b.reach ?? '').startsWith(`${GLOBAL_LABEL} `) || /machine-wide/i.test(b.reach ?? ''));
    const entries = blockOf(expanded, ENTRIES);
    const plain = expanded.blocks.filter((b) => UNCLASSIFIED_NAMED.includes(b.path) || b.path.startsWith(`${UNCLASSIFIED_GROUP}.`));
    return {
      passed: sameSet(noted.map((b) => b.path), MACHINE_WIDE) && mislabelled.length === 0 && entries?.reach === REGISTRIES_NOTE && (entries?.shape ?? '').includes(EACH_CARRYING) && plain.length > 0 && plain.every((b) => b.reach === null),
      seen: `notes on ${JSON.stringify(noted.map((b) => `${b.path}: ${b.reach}`))}; the ${ENTRIES} block takes ${JSON.stringify(entries?.shape ?? null)}; ${plain.length} block(s) of ${UNCLASSIFIED_NAMED.join(', ')} and the ${UNCLASSIFIED_GROUP} group, ${plain.filter((b) => b.reach === null).length} without a note`,
    };
  });

  await c.run('config-panel.descriptions-draw-their-code-as-code', {
    expected: 'no description the panel draws — behind a row\'s circle, on its hover, on a block or a group in the per-setting shape — carries a literal backtick; and every run the served schema writes between backticks in a setting\'s sentence is drawn as code, in the table and in the per-setting shape alike',
    plant: 'in the scratch copy, out/src/config-render.js with a sentence drawn with its backticks as written',
  }, async () => {
    need(table !== null && expanded !== null, 'the panel was not drawn in both shapes by the checks before this one');
    const { schema, seen } = await servedSchema();
    if (schema === null) { return { passed: false, seen }; }
    const declared = declaredSettings(schema).settings;
    const ticked = [...table.drawn, ...expanded.drawn].filter((t) => t.includes('`'));
    const runsOf = (p: string): string[] => codeRuns(declared.find((s) => s.path === p)?.description ?? '');
    const tableOff = table.rows.filter((r) => JSON.stringify(r.codes) !== JSON.stringify(runsOf(r.path))).map((r) => r.path);
    const blockOff = expanded.blocks.filter((b) => JSON.stringify(b.codes) !== JSON.stringify(runsOf(b.path))).map((b) => b.path);
    const withCode = table.rows.filter((r) => r.codes.length > 0).length;
    return {
      passed: ticked.length === 0 && tableOff.length === 0 && blockOff.length === 0 && withCode > 0,
      seen: `${table.drawn.length + expanded.drawn.length} descriptions drawn across both shapes, ${ticked.length === 0 ? 'none carrying a backtick' : `${ticked.length} carrying one, as ${JSON.stringify(ticked.slice(0, 2).map((t) => t.slice(0, 120)))}`}; ${withCode} row(s) drawing code in their sentence${tableOff.length > 0 ? `; in the table drawing other code than the schema writes ${JSON.stringify(tableOff.slice(0, 5))}` : ''}${blockOff.length > 0 ? `; on the blocks ${JSON.stringify(blockOff.slice(0, 5))}` : ''}`,
    };
  });

  await c.run('config-panel.global-marker-on-the-machine-wide-rows-and-its-rule-at-the-head', {
    expected: `in the table the rows of exactly ${MACHINE_WIDE.join(', ')} carry the one word "${GLOBAL}" beside their name, and no other row does; in the per-setting shape the rule for it, "${REACH_RULE}", is drawn once, ahead of every setting`,
    plant: 'in the scratch copy, out/src/config-render.js with the Global marker left off the table\'s rows',
  }, async () => {
    need(table !== null && expanded !== null, 'the panel was not drawn in both shapes by the checks before this one');
    const marked = table.rows.filter((r) => r.global !== null);
    const wrongWord = marked.filter((r) => r.global !== GLOBAL).map((r) => `${r.path}: ${r.global}`);
    return {
      passed: sameSet(marked.map((r) => r.path), MACHINE_WIDE) && wrongWord.length === 0 && expanded.rule.text === REACH_RULE && expanded.rule.count === 1 && expanded.rule.beforeSettings,
      seen: `the rows marked ${JSON.stringify(marked.map((r) => `${r.path}: ${r.global}`))}; the per-setting shape draws ${expanded.rule.count} rule line(s), ${JSON.stringify(expanded.rule.text)}, ${expanded.rule.beforeSettings ? 'ahead of every setting' : 'not ahead of the settings'}`,
    };
  });

  await c.forPerson('config-panel.reach-note-placement-and-its-narrowness-read-right', {
    expected: `the per-setting shape at the ${ENTRIES} block, its note drawn in place, the rule for the Global marker at the head of that shape; the table, which the panel opens in, marking the same settings "${GLOBAL}" on their rows`,
    plant: 'none: whether the marker, its rule and the narrowness of the settings it is drawn on read right is the judgement asked for',
    question: `The capture shows the per-setting shape at the ${ENTRIES} block; the text below gives the rule drawn at the head of that shape, every note it draws, and the rows the table marks "${GLOBAL}". Does the marker in the table, with the rule stated once here, tell a reader enough — say, that ${CONTRAST} written in a project's file is not the cap in force? And ${DEFAULT_REGISTRY} and the top-level ${UNCLASSIFIED_GROUP} block carry no marker though they look alike: does that read as an inconsistency?`,
  }, async () => {
    need(expanded !== null && panel !== null, 'the panel was not drawn in the per-setting shape by the check switching to it');
    // A block not drawn is the product's own answer, so it is said in the text and
    // the capture taken where the shape opens, for the person to see; the check
    // before this one fails on it.
    const at = expanded.blocks.findIndex((b) => b.path === ENTRIES);
    if (at !== -1) { await panel.read(`(d.querySelectorAll('dl.config-row')[${at}].scrollIntoView({ block: 'start' }), true)`); }
    const left = await clearForCapture(ctx);
    const shot = await capture(ctx, 'config-reach-notes');
    await panel.read('(d.scrollingElement.scrollTop = 0, true)');
    const missing = at === -1 ? `the per-setting shape draws no ${ENTRIES} block, so the capture shows it where it opens\n` : '';
    const rows = (table?.rows ?? []).filter((r) => r.global !== null).map((r) => `table: ${r.path} | ${r.name} ${r.global}`);
    return { screenshot: shot, drawnText: `${missing}rule: ${expanded.rule.text}\n${expanded.blocks.filter((b) => b.reach !== null).map((b) => `${b.path}: ${b.reach}`).join('\n')}\n${rows.join('\n')}${left}` };
  });

  await c.run('config-panel.names-derived-from-the-keys-read-apart', {
    expected: `each setting's name — the table's second column, and the label of its block in the per-setting shape — is derived from the key a reader types: its last segment with each underscore read as a space, an acronym in capitals (yaml, cli, url, ai, jwks, mcp, tls, id), "x" joined to the word after it with a hyphen, the first letter capitalised, and, where two settings' names would read alike, the key of the group each sits in ahead of its own; so no two rows share a name, and ${NAMED_LABELS.map((n) => `${n.path} reads "${n.label}"`).join(', ')}; each group heading in the per-setting shape reads its path and then its last segment derived the same way, as ${NAMED_GROUP} reads "${NAMED_GROUP} ${inWords(NAMED_GROUP)}"`,
    plant: 'in the scratch copy, out/src/config-schema.js with every word of a name capitalised; out/src/config-schema.js with yaml spelled as the key writes it; out/src/config-model.js with names left to read alike',
  }, async () => {
    need(table !== null && expanded !== null, 'the panel was not drawn in both shapes by the checks before this one');
    const want = namedAs(table.rows.map((r) => r.path));
    const tableOff = table.rows.filter((r) => r.name !== want.get(r.path)).map((r) => `${r.path}: ${r.name}`);
    const blockOff = expanded.blocks.filter((b) => b.label !== want.get(b.path)).map((b) => `${b.path}: ${b.label}`);
    const groupOff = expanded.groups.filter((g) => g.heading !== `${g.path} ${inWords(g.path)}`).map((g) => g.heading);
    const namedOff = NAMED_LABELS.filter((n) => rowOf(table as Reading, n.path)?.name !== n.label).map((n) => `${n.path}: ${rowOf(table as Reading, n.path)?.name ?? 'no row'}`);
    const names = table.rows.map((r) => r.name);
    const twice = names.filter((n, i) => names.indexOf(n) !== i);
    const namedGroup = expanded.groups.find((g) => g.path === NAMED_GROUP);
    return {
      passed: tableOff.length === 0 && blockOff.length === 0 && groupOff.length === 0 && namedOff.length === 0 && twice.length === 0 && namedGroup !== undefined && expanded.groups.length > 0,
      seen: `names otherwise than the rule: in the table ${JSON.stringify(tableOff.slice(0, 5))}, on the blocks ${JSON.stringify(blockOff.slice(0, 5))}, on ${expanded.groups.length} group heading(s) ${JSON.stringify(groupOff.slice(0, 5))}; the named ones ${namedOff.length === 0 ? 'as the rule gives them' : JSON.stringify(namedOff)}; ${twice.length === 0 ? `no two of the ${names.length} rows share a name` : `names drawn more than once ${JSON.stringify(twice)}`}; the ${NAMED_GROUP} heading ${JSON.stringify(namedGroup?.heading ?? null)}`,
    };
  });

  await c.forPerson('config-panel.plain-labels-read-well-enough', {
    expected: 'the names each setting is drawn with, every one derived from its key and none written by hand, acronyms in capitals and the group added where two would read alike',
    plant: 'none: whether the derived names read well enough is the judgement asked for',
    question: `The text below gives every setting's name beside its key, and the capture shows the table. Each name is still derived from the key — an acronym spelled in capitals, and the group's key added where two would otherwise read alike (${ALIKE.join(' and ')} read "${namedAs(ALIKE).get(ALIKE[0])}" and "${namedAs(ALIKE).get(ALIKE[1])}"). Do the names read well enough now?`,
  }, async () => {
    need(table !== null && panel !== null, 'no panel was drawn by the check opening it');
    // The capture shows the table, so the panel is put back in it from the shape
    // the checks before this one left it in.
    panel = await inShape(ctx, panel, 'table');
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'config-derived-names'), drawnText: `${table.rows.map((r) => `${r.path} → ${r.name}`).join('\n')}${left}` };
  });

  await c.run('config-panel.companion-set-in-the-folders-file-reads-on-its-lists-row', {
    expected: `the folder's own ${CONFIG_FILENAME} sets ${COMPANION} and not ${COMPANION_LIST} — the scenario's preparation moves the folder's list there — and the language server's own report names the file on its ${COMPANION_LIST} row and carries no row for ${COMPANION}; the table draws no row of the companion's own and names it under the ${COMPANION_LIST} row's path, which reads the report's value, marked "${markWords(SET_IN_A_FILE, null)}", Source the folder's file, and behind its circle "${foldWords(COMPANION)}"; no row reads "${NOT_REPORTED}"; and the per-setting shape's ${COMPANION_LIST} block names ${COMPANION} beside its path and reads "${IN_FORCE}" followed by the report's value, "${SOURCE}" followed by the file, and the same sentence of what the report gives for the two; and ${CONTRAST}, at the built-in defaults, reads "${BUILT_IN}" and the report's value in both shapes, unmarked`,
    plant: 'in the scratch copy, out/src/config-model.js with a companion drawn as a row of its own',
  }, async () => {
    need(table !== null && expanded !== null, 'the panel was not drawn in both shapes by the checks before this one');
    const { report, seen } = await servedReport();
    if (report === null) { return { passed: false, seen }; }
    const file = path.join(ctx.folder, CONFIG_FILENAME);
    const setInFile = fs.readFileSync(file, 'utf8');
    const list = report.settings.find((s) => s.field === COMPANION_LIST);
    const ownRow = report.settings.some((s) => s.field === COMPANION);
    const r = rowOf(table, COMPANION_LIST);
    const b = blockOf(expanded, COMPANION_LIST);
    const tableOk = list !== undefined && list.source === file && !ownRow && rowOf(table, COMPANION) === undefined && r !== undefined
      && JSON.stringify(r.companions) === JSON.stringify([COMPANION]) && r.value === list.value && r.mark === markWords(SET_IN_A_FILE, null)
      && r.source === file && r.paragraphs.includes(foldWords(COMPANION));
    const blockOk = list !== undefined && b !== undefined && JSON.stringify(b.companions) === JSON.stringify([COMPANION]) && b.value === `${IN_FORCE}${list.value}`
      && b.source === `${SOURCE}${file}` && b.fold === foldWords(COMPANION) && blockOf(expanded, COMPANION) === undefined;
    const unreported = table.rows.filter((x) => x.source === NOT_REPORTED).map((x) => x.path);
    const rep = report.settings.find((s) => s.field === CONTRAST);
    const cr = rowOf(table, CONTRAST);
    const cb = blockOf(expanded, CONTRAST);
    const contrast = rep !== undefined && rep.source === DEFAULTS_SOURCE && cr !== undefined && cr.source === BUILT_IN && cr.mark === null && cr.value === rep.value
      && !cr.value.includes(DECLARED_DEFAULT_MARK) && cb !== undefined && cb.value === `${IN_FORCE}${rep.value}` && cb.source === `${SOURCE}the built-in default, unchanged by any file`;
    const unread = ctx.out.text().split('\n').find((l) => l.includes(REPORT_UNREAD));
    return {
      passed: setInFile.includes(`${COMPANION.slice(COMPANION.lastIndexOf('.') + 1)}:`) && tableOk && blockOk && unreported.length === 0 && contrast,
      seen: `the folder's file reads ${JSON.stringify(setInFile)}; the report gives ${COMPANION_LIST} ${JSON.stringify(list ?? null)}${ownRow ? ` and a row for ${COMPANION}` : `, and no row for ${COMPANION}`}; the table's ${COMPANION_LIST} row ${describeRow(r)}, its circle's paragraphs ${JSON.stringify((r?.paragraphs ?? []).slice(1))}${rowOf(table, COMPANION) !== undefined ? `; a row of its own for ${COMPANION} ${describeRow(rowOf(table, COMPANION))}` : ''}; the block ${describeBlock(b)}; rows reading "${NOT_REPORTED}" ${JSON.stringify(unreported)}; ${CONTRAST} reported ${JSON.stringify(rep ?? null)}, drawn ${describeRow(cr)} and ${describeBlock(cb)}${unread !== undefined ? `; the channel carries "${unread.trim()}"` : ''}`,
    };
  });

  await c.forPerson('config-panel.coverage-sentence-earns-its-place', {
    expected: 'the summary box above the table, with the coverage sentence where the report leaves a setting unattributed and none where it leaves none',
    plant: 'none: whether the summary box says what it should is the judgement asked for',
    question: 'The capture shows the summary box at the head of the configuration panel; the text below is what it says. Each list\'s companion is now named on its list\'s row, so the report attributes every row and no coverage sentence is drawn: is the box right as it stands?',
  }, async () => {
    need(panel !== null, 'no panel was drawn by the check opening it');
    panel = await inShape(ctx, panel, 'table');
    const r = await readPanel(panel);
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'config-coverage-sentence'), drawnText: `${r.summary?.heading ?? ''}\n${(r.summary?.notes ?? []).join('\n')}\n${(r.summary?.layers ?? []).join('\n')}${left}` };
  });

  await c.run('config-panel.reopens-in-the-shape-it-was-left-in', {
    expected: `put in the per-setting shape, closed, and opened again with "${showTitle}", the panel is drawn in the per-setting shape; switched to the table there, closed, and opened again, it is drawn as the table`,
    plant: 'in the scratch copy, out/src/config-view.js with the shape forgotten when the panel is closed',
  }, async () => {
    need(panel !== null, 'no panel was drawn by the check opening it');
    panel = await inShape(ctx, panel, 'expanded');
    await closePanels(ctx);
    await pressShowConfig(ctx);
    const first = await shapeNow(ctx);
    panel = await configPanel(ctx, first);
    if (first === 'expanded') { panel = await pressSwitch(ctx, panel, 'table'); }
    await closePanels(ctx);
    await pressShowConfig(ctx);
    const second = await shapeNow(ctx);
    panel = await configPanel(ctx, second);
    if (second === 'expanded') { panel = await pressSwitch(ctx, panel, 'table'); }
    return { passed: first === 'expanded' && second === 'table', seen: `left in the per-setting shape it opened again as the ${first === 'table' ? 'table' : 'per-setting shape'}; left as the table it opened again as the ${second === 'table' ? 'table' : 'per-setting shape'}` };
  });

  await c.run('config-panel.reports-and-offers-nothing-to-edit', {
    expected: `in both shapes the page holds no form control — no text box, toggle, list, button or file chooser — no element made editable or given a control's role, nothing taking the focus of its own, and no Save; what responds to a press is the one link reaching the shape switch (command:${PRESENTATION_TOGGLE_COMMAND}), and in the table the circle at the end of each row, both found by the same reading`,
    plant: 'in the scratch copy, out/src/config-render.js with a checkbox drawn beside the shape switch',
  }, async () => {
    need(table !== null && expanded !== null, 'the panel was not drawn in both shapes by the checks before this one');
    const off = (r: Reading): string[] => {
      const x = r.census;
      const out: string[] = [];
      if (x.forms.length > 0) { out.push(`form controls ${JSON.stringify(x.forms.slice(0, 5))}`); }
      if (x.editable.length > 0) { out.push(`editable or control roles ${JSON.stringify(x.editable.slice(0, 5))}`); }
      if (x.saves.length > 0) { out.push(`Save ${JSON.stringify(x.saves)}`); }
      if (x.focusable.length > 0) { out.push(`focusable of their own ${JSON.stringify(x.focusable.slice(0, 5))}`); }
      if (x.links.length !== 1 || x.links[0].href !== `command:${PRESENTATION_TOGGLE_COMMAND}`) { out.push(`links ${JSON.stringify(x.links)}`); }
      if (x.summaries !== (r.shape === 'table' ? r.rows.length : 0)) { out.push(`${x.summaries} circle(s) for ${r.rows.length} row(s)`); }
      return out;
    };
    const t = off(table);
    const e = off(expanded);
    return {
      passed: t.length === 0 && e.length === 0,
      seen: `the table: ${t.length === 0 ? `the switch's link and ${table.census.summaries} circle(s), nothing else` : t.join('; ')}; the per-setting shape: ${e.length === 0 ? 'the switch\'s link, nothing else' : e.join('; ')}`,
    };
  });

  await c.forPerson('config-panel.table-earns-its-place-in-each-theme', {
    expected: `the table as it opens in ${THEMES.map((t) => t.name).join(', ')}, ${ROWS_GIVEN} of its rows given in the text`,
    plant: 'none: whether the table earns its place, its columns are the right ones and its widths hold up is the judgement asked for',
    question: `The captures show the configuration table in each of ${THEMES.map((t) => t.name).join(', ')}; the text below gives ${ROWS_GIVEN} of its rows as drawn. Does the table earn its place: are its columns the right ones, is any dead weight, and do the column widths and the layout hold up in each theme?`,
  }, async () => {
    need(panel !== null, 'the panel was not drawn by the checks before this one');
    const p = panel;
    const shots: string[] = [];
    const left: string[] = [];
    let from = THEMES[0].name;
    let restored = '';
    try {
      for (const theme of THEMES) {
        if (theme.name !== from) { writeColourTheme(ctx, from, theme.name); from = theme.name; }
        await until(`the panel drawn in ${theme.name}`, 15000, () => p.read<string>('d.body.className'), (cls) => cls.split(/\s+/).includes(theme.bodyClass));
        const note = await clearForCapture(ctx);
        shots.push(await capture(ctx, `config-table-${theme.bodyClass}`));
        if (note !== '') { left.push(`${theme.name}:${note}`); }
      }
    } finally {
      try {
        if (from !== THEMES[0].name) { writeColourTheme(ctx, from, THEMES[0].name); }
        restored = `the theme put back to ${THEMES[0].name}`;
      } catch (err) {
        restored = `the theme was not put back to ${THEMES[0].name}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    const r = await readPanel(p);
    const given = r.body.slice(0, ROWS_GIVEN).map((entry) => {
      if ('group' in entry) { return `▸ ${entry.group} | ${entry.name}`; }
      const x = rowOf(r, entry.setting);
      return x === undefined ? entry.setting : [x.path, `${x.name}${x.global === null ? '' : ` ${x.global}`}`, `${x.mark === null ? '' : `${MARK} `}${x.value}`, x.takes, x.source].join(' | ');
    });
    return { screenshot: shots[0] ?? null, drawnText: `captures ${shots.join(', ')}; ${restored}${left.length > 0 ? `\n${left.join('\n')}` : ''}\n${r.heads.map((h) => h.text).join(' | ')}\n${given.join('\n')}` };
  });

  // ---- a setting put in force by the folder's own file ----
  let edited = false;
  await c.run('config-panel.pressed-again-reveals-the-open-panel-and-reads-again', {
    expected: `with the panel open as the table reading ${OFFLINE}'s value in force as other than true, "${OFFLINE}: true" added to the folder's ${CONFIG_FILENAME} and the language server restarted, the panel, with nothing pressed, still reads ${OFFLINE} as it did at every reading over ${PANEL_DRAWN_MS} ms; with the folder's ${RELEASE} then opened in front of it, pressing "${showTitle}" again brings the same one panel to the front — one panel document, one tab titled "${PANEL_TAB}" — and within ${PANEL_DRAWN_MS} ms the same reading reads ${OFFLINE}'s value in force as true`,
    plant: 'in the scratch copy, out/src/config-view.js with a panel already open brought to the front without being read again',
  }, async () => {
    need(panel !== null, 'the panel was not drawn by the checks before this one');
    const p = panel;
    const offlineEffective = async (): Promise<string> => rowOf(await readPanel(p), OFFLINE)?.value ?? 'no row';
    const before = await offlineEffective();
    fs.appendFileSync(path.join(ctx.folder, CONFIG_FILENAME), `${OFFLINE}: true\n`);
    edited = true;
    const mark = await statusMark(ctx);
    await send(ctx, RESTART_COMMAND);
    const restart = await runningAgain(ctx, mark, SERVER_BOUND_MS);
    // That the panel is not read again by itself is watched for as long as the
    // press after it is given to read it, by the same reading, which is the
    // watch's control.
    const stale = await holds(PANEL_DRAWN_MS, offlineEffective, (v) => v === before);
    // Another editor is put in front of the panel first, so the press is seen to
    // bring the panel forward rather than find it there.
    await open(ctx, path.join(ctx.folder, RELEASE));
    const behind = await panelsNow(ctx);
    await pressShowConfig(ctx);
    const after = await until(`the panel reading ${OFFLINE} in force as true`, stated(PANEL_DRAWN_MS), offlineEffective, (v) => v === 'true');
    const now = await panelsNow(ctx);
    return {
      passed: before !== 'true' && stale.held && behind.tabs.length === 1 && !behind.tabs[0].active && now.documents === 1 && now.tabs.length === 1 && now.tabs[0].active,
      seen: `${OFFLINE} in force read ${JSON.stringify(before)} before the edit; the restart read ${describeReadings(restart)}; ${stale.held ? `the panel then read ${JSON.stringify(before)} at each of ${stale.readings} readings over ${PANEL_DRAWN_MS} ms` : `the panel read ${JSON.stringify(stale.broke)} ${stale.atMs} ms after the restart with nothing pressed`}; with ${RELEASE} opened in front, ${describePanels(behind)}; pressed again it read ${JSON.stringify(after)}, with ${describePanels(now)}`,
    };
  });

  await c.run('config-panel.setting-in-the-folders-file-reads-in-every-column-of-both-shapes', {
    expected: `with "${OFFLINE}: true" in the folder's ${CONFIG_FILENAME} and the language server restarted, the table's ${OFFLINE} row reads Value "true" carrying the mark, its words "${markWords(SET_IN_A_FILE, '<the default the served schema declares for it>')}", Takes "${TOGGLE_TAKES}" and Source the path the language server's own report names for it — the folder's own ${CONFIG_FILENAME}; and the per-setting shape reads "${IN_FORCE}true" and "${SOURCE}" followed by the same path, both shapes agreeing`,
    plant: 'in the scratch copy, out/src/config-model.js with a file named in the table by its base name alone',
  }, async () => {
    need(edited && panel !== null, `the folder's ${CONFIG_FILENAME} was not changed by the check before this one`);
    const { schema, seen: schemaSeen } = await servedSchema();
    const answer = await ask(ctx, 'aggrega/effectiveConfiguration', {});
    const report = reportIn(answer);
    if (schema === null || report === null) { return { passed: false, seen: `${schemaSeen} ${report === null ? `aggrega/effectiveConfiguration answered ${answerText(answer)}` : ''}`.trim() }; }
    const rep = report.settings.find((s) => s.field === OFFLINE);
    const d = declaredSettings(schema).settings.find((s) => s.path === OFFLINE);
    const dflt = d !== undefined && d.hasDefault ? spelled(d.dflt) : null;
    const file = path.join(ctx.folder, CONFIG_FILENAME);
    const r = rowOf(await readPanel(panel), OFFLINE);
    const tableOk = rep !== undefined && rep.value === 'true' && rep.source === file && dflt !== null && r !== undefined
      && r.value === 'true' && r.mark === markWords(SET_IN_A_FILE, dflt) && r.takes === TOGGLE_TAKES && r.source === rep.source;
    panel = await pressSwitch(ctx, panel, 'expanded');
    const b = blockOf(await readPanel(panel), OFFLINE);
    const blockOk = rep !== undefined && b !== undefined && b.value === `${IN_FORCE}true` && b.source === `${SOURCE}${rep.source}`;
    panel = await pressSwitch(ctx, panel, 'table');
    return {
      passed: tableOk && blockOk,
      seen: `the report gives ${JSON.stringify(rep ?? null)}, the schema declares the default ${dflt ?? 'none'}; the table's row ${describeRow(r)}; the block ${describeBlock(b)}`,
    };
  });

  // ---- the language server stopped ----
  // stopped is whether the checks before left the language server stopped by the
  // binary setting pointed at `notABinary`, which the checks after start from.
  let stopped = false;
  await c.run('config-panel.with-the-server-stopped-leaves-no-panel-and-says-why', {
    expected: `with the panel closed and the language server stopped — the binary setting pointed at a file that is not a binary, the status bar reading "${NOT_RUNNING}" — pressing "${showTitle}" raises, within ${PANEL_DRAWN_MS} ms, one error notification reading "${STOPPED_NOTICE}" and carrying one action, "${START}", the label the status bar's offer gives a start; and leaves no panel standing: from the notification on, no panel document and no tab titled "${PANEL_TAB}" over ${PANEL_DRAWN_MS} ms, read the way the check opening the panel saw it drawn`,
    plant: 'in the scratch copy, out/src/config-view.js with the panel a failed drawing leaves standing open',
  }, async () => {
    await closePanels(ctx);
    const mark = await statusMark(ctx);
    await setBinaryPath(ctx, ctx.inputs.compiler.path, notABinary);
    const stop = await statusReadsSince(ctx, mark, NOT_RUNNING, SERVER_BOUND_MS);
    stopped = true;
    const said = await markSaid(ctx);
    await pressShowConfig(ctx);
    const told = await waitNotice(ctx, said.toasts);
    const none = await noPanelSince(ctx);
    const since = await saidSince(ctx, said);
    const detail = await dialogDetail(ctx, said.dialogs);
    const notices = since.told.filter((m) => m.startsWith(NOTICE_LEAD));
    const left = await putAway();
    return {
      passed: toldNotRunning(told) && notices.length === 1 && none.held && drawnMs !== null && left === null,
      seen: `stopped: ${describeReadings(stop)}; the notification waited for ${describeNotice(told)}; since the press ${describeSaid(since)}${detail}${left === null ? '' : `; ${left}`}; ${describeNone(none)}, ${drawnMs === null ? 'where the same reading never saw the panel drawn, so it is not shown to see one' : `where the same reading saw the panel drawn ${drawnMs} ms after a press with the server running`}`,
    };
  });

  await c.run('config-panel.open-panel-with-the-server-stopped-is-told-why-from-the-commands-panel', {
    expected: `with the language server running again and the panel opened, then the server stopped the same way with the panel left open, pressing "${showTitle}" on the Commands panel ends as the press with the panel closed does: within ${PANEL_DRAWN_MS} ms one error notification reading "${STOPPED_NOTICE}" and carrying one action, "${START}", and from the notification on no panel standing over ${PANEL_DRAWN_MS} ms, read by the reading that saw the panel drawn open before the stop — rather than the panel brought to the front still showing the reading it showed before the stop`,
    plant: 'in the scratch copy, out/src/config-view.js with a panel already open left standing when it cannot be read again',
  }, async () => {
    need(stopped, 'the language server was not left stopped by the check before this one');
    stopped = false;
    const o = await openThenStop(ctx, notABinary);
    stopped = true;
    const said = await markSaid(ctx);
    await pressShowConfig(ctx);
    const told = await waitNotice(ctx, said.toasts);
    const none = await noPanelSince(ctx);
    const since = await saidSince(ctx, said);
    const detail = await dialogDetail(ctx, said.dialogs);
    const notices = since.told.filter((m) => m.startsWith(NOTICE_LEAD));
    const same = await stillTheDocument(o);
    const left = await putAway();
    return {
      passed: o.drawn.documents === 1 && o.drawn.tabs.length === 1 && toldNotRunning(told) && notices.length === 1 && none.held && left === null,
      seen: `open before the stop: ${describePanels(o.drawn)}; stopped: ${describeReadings(o.stop)}; the notification waited for ${describeNotice(told)}; since the press ${describeSaid(since)}${detail}${left === null ? '' : `; ${left}`}; ${describeNone(none)}, ${same}`,
    };
  });

  await c.run('config-panel.open-panel-with-the-server-stopped-is-told-why-from-the-palette', {
    expected: `with the language server running again and the panel opened, then the server stopped the same way with the panel left open, "${paletteTitle(ctx, SHOW_CONFIG)}" taken from the command palette ends the same way: within ${PANEL_DRAWN_MS} ms one error notification reading "${STOPPED_NOTICE}" and carrying one action, "${START}", no modal dialog, and from the notification on no panel standing over ${PANEL_DRAWN_MS} ms`,
    plant: 'in the scratch copy, out/src/config-view.js with a panel already open left standing when it cannot be read again',
  }, async () => {
    need(stopped, 'the language server was not left stopped by the check before this one');
    stopped = false;
    const o = await openThenStop(ctx, notABinary);
    stopped = true;
    const title = paletteTitle(ctx, SHOW_CONFIG);
    const q = await paletteRows(ctx.d, (x) => send(ctx, x), title);
    const offered = q.rows.length > 0 && q.rows[0].label === title;
    // The mark is taken with the palette already drawn, so what is read since is
    // what taking the command told or asked.
    const said = await markSaid(ctx);
    if (offered) { await ctx.d.press('Enter'); }
    const told = offered ? await waitNotice(ctx, said.toasts) : { toast: null, why: 'not taken' };
    const none = await noPanelSince(ctx);
    const since = await saidSince(ctx, said);
    const detail = await dialogDetail(ctx, said.dialogs);
    const notices = since.told.filter((m) => m.startsWith(NOTICE_LEAD));
    const same = await stillTheDocument(o);
    const left = await putAway();
    return {
      passed: offered && o.drawn.documents === 1 && o.drawn.tabs.length === 1 && toldNotRunning(told) && notices.length === 1 && since.dialogs.length === 0 && none.held && left === null,
      seen: `open before the stop: ${describePanels(o.drawn)}; stopped: ${describeReadings(o.stop)}; the palette ${offered ? `offered "${title}" first, taken with Enter` : `offered ${JSON.stringify(q.rows.map((r) => r.label).slice(0, 5))}`}; the notification waited for ${describeNotice(told)}; since then ${describeSaid(since)}${detail}${left === null ? '' : `; ${left}`}; ${describeNone(none)}, ${same}`,
    };
  });

  await c.run('config-panel.start-on-the-notification-starts-the-language-server', {
    expected: `in the same state, with "${GRACE_SETTING}" set to ${HELD_GRACE_SECONDS} in the user settings — ten times the ${SERVER_BOUND_MS} ms this check waits for the server — and then the binary setting put back on the binary under test, the channel saying the change scheduled its own restart that far off ("binary path changed; restarting in ${HELD_GRACE_SECONDS}s"), so no restart but the press's can begin while the check reads: pressing "${START}" on the notification "${STOPPED_NOTICE}" moves the status bar from "${NOT_RUNNING}" no earlier than the press, and it reads "${RUNNING}" within ${SERVER_BOUND_MS} ms of the press; and the check leaves the server settled — no restart pending, read on the status bar menu, which offers "${CANCEL_RESTART}" while one is (where it does, pressed, the channel saying "${RESTART_CANCELLED}" and the menu opened again offering it no longer), "${GRACE_SETTING}" taken out of the user settings again, and the status bar's last reading "${RUNNING}"`,
    plant: 'in the scratch copy, out/src/config-view.js with the start on the notification running nothing',
  }, async () => {
    need(stopped, 'the language server was not left stopped, its notification drawn, by the check before this one');
    await holdRestartGrace(ctx, true);
    const mark = await statusMark(ctx);
    const out = ctx.out.mark();
    await setBinaryPath(ctx, notABinary, ctx.inputs.compiler.path);
    stopped = false;
    // The press is made once the extension has taken the setting, which its
    // channel says as it schedules the restart the change calls for: a press made
    // before that would start the binary the setting named until then. The line
    // names the grace that restart waits, and the press is made only where it is
    // the grace written above, since that is what keeps the restart out of the
    // check.
    const scheduled = await ctx.out.waitFor('the channel saying the binary setting\'s change scheduled a restart', out, (t) => SCHEDULED_RESTART.test(t), SERVER_BOUND_MS)
      .then((t) => ({ line: SCHEDULED_RESTART.exec(t), why: '' }), (err: unknown) => ({ line: null, why: err instanceof Error ? err.message : String(err) }));
    const held = scheduled.line !== null && Number(scheduled.line[1]) === HELD_GRACE_SECONDS;
    const pressedAt = Date.now();
    const pressed = held && await pressToastButton(ctx.d, NOTICE_LEAD, START);
    const since = async (): Promise<StatusReading[]> => (await statusLog(ctx.d)).slice(mark);
    const up = pressed
      ? await until(`the status bar reading "${RUNNING}" after the press`, stated(SERVER_BOUND_MS), since, (v) => v.some((r) => r.reading === RUNNING))
        .then(() => '', (err: unknown) => `; ${err instanceof Error ? err.message : String(err)}`)
      : '';
    const pending = await putAwayPendingRestart(ctx);
    const graceBack = await holdRestartGrace(ctx, false).then(
      () => (fs.readFileSync(userSettingsOf(ctx), 'utf8').includes(GRACE_SETTING) ? `the user settings still name "${GRACE_SETTING}"` : null),
      (err: unknown) => `"${GRACE_SETTING}" was not taken out of the user settings: ${err instanceof Error ? err.message : String(err)}`,
    );
    const readings = await since();
    const moved = readings.find((r) => r.reading !== NOT_RUNNING);
    const running = readings.find((r) => r.reading === RUNNING);
    const last = readings.length === 0 ? null : readings[readings.length - 1].reading;
    const timed = (v: StatusReading[]): string => JSON.stringify(v.map((r) => `${r.reading || '(no standing drawn)'} at ${r.at - pressedAt} ms`));
    const channel = scheduled.line === null ? `nothing matching (${scheduled.why})` : `"${scheduled.line[0]}"`;
    return {
      passed: held && pressed && moved !== undefined && moved.at >= pressedAt && running !== undefined && running.at - pressedAt <= SERVER_BOUND_MS
        && pending.none && graceBack === null && last === RUNNING,
      seen: `with the binary setting put back the channel said ${channel}${held ? '' : `, not the grace written, so "${START}" was not pressed`}; "${START}" ${pressed ? 'pressed' : held ? 'not drawn on the notification to press' : 'not pressed'}; counted from the press, the status bar read ${timed(readings)}${up}; settling, ${pending.seen}; ${graceBack ?? `"${GRACE_SETTING}" taken out of the user settings again`}; the status bar's last reading ${last === null ? `none since the binary setting was put back, "${NOT_RUNNING}" standing` : `"${last}"`}`,
    };
  });
  await closeAllEditors(ctx);
}

// ---- a setting put in force by the editor's environment -----------------------

// proveNothingSetIn proves the folder's configuration file sets the top-level
// `key` in none of its documents, so what a scenario reads of it comes from
// elsewhere or from what the scenario writes. The file is parsed rather than
// scanned for a line, because a quoted key and a flow mapping each set the key
// with no line opening with it; a file that does not parse proves nothing, and is
// refused.
export function proveNothingSetIn(folder: string, key: string): FixtureProof {
  const file = path.join(folder, CONFIG_FILENAME);
  const fixture = `${key} set in no file`;
  const text = fs.readFileSync(file, 'utf8');
  let documents: unknown[];
  try {
    documents = loadAll(text);
  } catch (err) {
    throw new FixtureError(fixture, `${file} does not parse: ${err instanceof Error ? err.message : String(err)}`);
  }
  const setting = documents.some((d) => typeof d === 'object' && d !== null && !Array.isArray(d) && Object.hasOwn(d, key));
  if (setting) { throw new FixtureError(fixture, `${file} sets ${key}`); }
  return { fixture, built: true, proof: `${file} parses to ${documents.length} document(s), none setting ${key}` };
}

// setListThroughItsCompanion rewrites the folder's configuration file so it sets
// its catalog directories through the list's additive companion rather than the
// list: the same directories, read the same way — the built-in list is empty, and
// the companion adds its entries to it — so the folder resolves as it did, while
// its file sets the companion and not the list. Exactly one key is moved, and it
// is refused unless the file carries the list's key once and the companion's
// nowhere.
export function setListThroughItsCompanion(folder: string): FixtureProof {
  const file = path.join(folder, CONFIG_FILENAME);
  const fixture = `${COMPANION} set in the folder's file in place of ${COMPANION_LIST}`;
  const listKey = COMPANION_LIST.slice(COMPANION_LIST.lastIndexOf('.') + 1);
  const companionKey = COMPANION.slice(COMPANION.lastIndexOf('.') + 1);
  const list = `  ${listKey}:\n`;
  const companion = `  ${companionKey}:\n`;
  const text = fs.readFileSync(file, 'utf8');
  if (text.split(list).length !== 2 || text.includes(companion)) {
    throw new FixtureError(fixture, `${file} does not carry the line ${JSON.stringify(list)} exactly once with no ${JSON.stringify(companion)}`);
  }
  fs.writeFileSync(file, text.replace(list, companion));
  const parsed = loadAll(fs.readFileSync(file, 'utf8'))[0] as { workspace?: Record<string, unknown> } | undefined;
  const workspace = parsed?.workspace ?? {};
  if (!Array.isArray(workspace[companionKey]) || Object.hasOwn(workspace, listKey)) {
    throw new FixtureError(fixture, `${file} does not parse to a workspace block setting the companion and not the list`);
  }
  return { fixture, built: true, proof: `${file} sets ${COMPANION} to ${JSON.stringify(workspace[companionKey])} and does not set ${COMPANION_LIST}` };
}

export async function configurationFromTheEnvironmentChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  await c.run('config-panel.setting-from-the-environment-names-the-variable-in-both-shapes', {
    expected: `in an editor started with ${OFFLINE_VARIABLE}=true in its environment, which the language server it starts carries too, and ${OFFLINE} set in no file, the configuration table's ${OFFLINE} row reads Value "true" carrying the mark, its words opening "${SET_IN_THE_ENVIRONMENT};", and Source "${environmentCell(OFFLINE_VARIABLE)}", and the per-setting shape reads "${IN_FORCE}true" and "${environmentSource(OFFLINE_VARIABLE)}", both shapes agreeing`,
    plant: 'in the scratch copy, out/src/config-model.js with the compiler\'s spelling of a value taken from an environment variable unrecognised, so it reads as a file',
  }, async () => {
    const server = await theServer(ctx);
    const carried = readEnviron(server.pid)[OFFLINE_VARIABLE];
    await closePanels(ctx);
    await pressShowConfig(ctx);
    let p = await inShape(ctx, await configPanel(ctx, await shapeNow(ctx)), 'table');
    const r = rowOf(await readPanel(p), OFFLINE);
    p = await pressSwitch(ctx, p, 'expanded');
    const b = blockOf(await readPanel(p), OFFLINE);
    await pressSwitch(ctx, p, 'table');
    return {
      passed: carried === 'true' && r !== undefined && r.value === 'true' && (r.mark ?? '').startsWith(`${SET_IN_THE_ENVIRONMENT};`) && r.source === environmentCell(OFFLINE_VARIABLE) && b !== undefined && b.value === `${IN_FORCE}true` && b.source === environmentSource(OFFLINE_VARIABLE),
      seen: `the language server carries ${OFFLINE_VARIABLE}=${JSON.stringify(carried ?? null)}; the table's row ${describeRow(r)}; the block ${describeBlock(b)}`,
    };
  });
  await closeAllEditors(ctx);
}

// ---- a folder holding nothing configured at all -------------------------------

// proveNoGlobalFile proves the scenario's home holds no global configuration file,
// so nothing but the folder can contribute a layer.
export function proveNoGlobalFile(home: ScratchHome): FixtureProof {
  const file = globalConfiguration(home);
  if (fs.existsSync(file)) { throw new FixtureError('no global configuration file', `${file} exists`); }
  return { fixture: 'no global configuration file', built: true, proof: `${file} does not exist` };
}

export async function nothingConfiguredChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  await c.run('config-panel.nothing-configured-reads-every-setting-at-its-default', {
    expected: `in a folder holding only a Release, with no configuration file in it, above it or in the home directory's configuration, the panel's summary box draws a line opening "${NO_FILE_LEAD}" and no list of files, empty or not, at every reading over ${SUMMARY_WATCH_MS} ms, and every row reads at its default: no mark on its value, and either Source "${BUILT_IN}" with the language server's own reported value — "${NONE}" where it gives none — or Source "${NOT_REPORTED}" with the declared default followed by "${DECLARED_DEFAULT_MARK}"; once "${OFFLINE}: true" is written into a ${CONFIG_FILENAME} there, the language server restarted and the panel pressed again, the same reading lists that file and reads ${OFFLINE} set in it`,
    plant: 'in the scratch copy, out/src/config-render.js with the summary drawing its list of files whether or not a file contributed',
  }, async () => {
    const schemaAnswer = await ask(ctx, 'aggrega/getSchema', { kind: CONFIG_SCHEMA_KIND });
    const reportAnswer = await ask(ctx, 'aggrega/effectiveConfiguration', {});
    const schema = schemaIn(schemaAnswer);
    const report = reportIn(reportAnswer);
    if (schema === null || report === null) { return { passed: false, seen: `aggrega/getSchema answered ${answerText(schemaAnswer)}; aggrega/effectiveConfiguration answered ${answerText(reportAnswer)}` }; }
    const declared = declaredSettings(schema).settings;
    await closePanels(ctx);
    await pressShowConfig(ctx);
    const panel = await inShape(ctx, await configPanel(ctx, await shapeNow(ctx)), 'table');
    const r = await readPanel(panel);
    const kept = await holds(SUMMARY_WATCH_MS, async () => (await readPanel(panel)).summary, (s) => s !== null && s.layers === null && s.lists.length === 0);
    const noFile = (r.summary?.notes ?? []).find((n) => n.startsWith(NO_FILE_LEAD));
    const wrong: string[] = [];
    for (const row of r.rows) {
      const rep = report.settings.find((s) => s.field === row.path);
      const d = declared.find((s) => s.path === row.path);
      const atDefault = rep !== undefined
        ? rep.source === DEFAULTS_SOURCE && row.source === BUILT_IN && row.value === valueAsDrawn(rep.value)
        : d !== undefined && d.hasDefault && row.source === NOT_REPORTED && row.value === `${spelled(d.dflt)} ${DECLARED_DEFAULT_MARK}`;
      if (row.mark !== null || !atDefault) { wrong.push(`${row.path}: ${describeRow(row)}`); }
    }
    // The control: a file written, the server restarted, the panel pressed again,
    // read by the same reading.
    const file = path.join(ctx.folder, CONFIG_FILENAME);
    fs.writeFileSync(file, `${OFFLINE}: true\n`);
    const mark = await statusMark(ctx);
    await send(ctx, RESTART_COMMAND);
    await runningAgain(ctx, mark, SERVER_BOUND_MS);
    await pressShowConfig(ctx);
    const after = await until(`the panel listing ${file} and reading ${OFFLINE} set`, PANEL_DRAWN_MS, () => readPanel(panel), (x) => (x.summary?.layers ?? []).includes(file) && rowOf(x, OFFLINE)?.value === 'true' && (rowOf(x, OFFLINE)?.mark ?? '').startsWith(`${SET_IN_A_FILE};`));
    return {
      passed: noFile !== undefined && kept.held && r.rows.length > 0 && wrong.length === 0,
      seen: `the summary's lines ${JSON.stringify(r.summary?.notes ?? [])}, its lists ${JSON.stringify(r.summary?.lists ?? [])}${kept.held ? ` over ${SUMMARY_WATCH_MS} ms` : `, otherwise ${kept.atMs} ms in`}; ${r.rows.length} rows${wrong.length > 0 ? `, these not at their default: ${JSON.stringify(wrong.slice(0, 5))}` : ', every one at its default with no mark on its value'}; with ${file} written the same reading lists ${JSON.stringify(after.summary?.layers ?? [])} and reads ${OFFLINE} ${describeRow(rowOf(after, OFFLINE))}`,
    };
  });
  await closeAllEditors(ctx);
}
