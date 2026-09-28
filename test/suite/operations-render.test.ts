// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CACHE_OPERATIONS,
  OPERATION_GROUPS,
  OperationDef,
  OperationId,
  OperationsLayout,
  commandsPanelOperations,
  commandIdFor,
} from '../../src/operation-groups';
import {
  OperationsBody,
  operationsBodyHtml,
  operationsDocumentHtml,
} from '../../src/operations-render';
import { NO_RELEASE_SELECTED_CONTROL_REASON } from '../../src/release-selection';
import { SELECTOR_ROW_KEYS, SELECTOR_ROW_LABELS } from '../../src/selector-levels';
import {
  SelectorCandidates,
  createControlKey,
  offerControlKey,
  rowCommands,
  selectorRows,
} from '../../src/selector-rows';
import { EXTENSION_ROOT } from '../helpers/launch-census';
import { cssRuleBody, declarationOf } from '../helpers/stylesheet';

// The composer holds no editor type, so every assertion here reads back exactly
// the markup a reader is shown. What no test in this repository can reach is
// what the editor then DOES with that markup: the focus ring, the arrow keys
// actually moving the roving stop, a screen reader's announcement, and the icon
// font resolving. Those are walked by hand at the editor. What is provable here
// is that the document carries the properties those behaviours need, which is
// the half that regresses silently.

const ANCHORED = '/work/demo';
const SELECTED = { kind: 'selected', release: 'releases/prod.yaml', absolute: '/work/demo/releases/prod.yaml' } as const;
const NO_ANSWER_YET = { kind: 'unknown' } as const;
// Several of each, so a document drawn from this fixture is not silently the
// one-candidate case — the wording of which is a separate claim with its own
// assertions in the rows' own suite.
const SEVERAL: SelectorCandidates = { projectFolders: 3, aggregaWorkspaces: 2, releases: 4 };

function body(over: Partial<OperationsBody> = {}): OperationsBody {
  return {
    layout: 'buttons',
    selectors: selectorRows(ANCHORED, ANCHORED, ANCHORED, SELECTED, SEVERAL),
    unavailable: {},
    collapsed: [],
    focused: null,
    dials: [],
    ...over,
  };
}

// What the rows contribute to a count taken over the whole document: every
// control every row draws.
//
// DERIVED FROM THE ROWS RATHER THAN WRITTEN AS A NUMBER, so a row gained or a
// control withdrawn moves every total that depends on it in the same act. A
// literal here is a number that has to be found and changed by whoever next
// touches the rows, and the totals it feeds are exactly the assertions that say
// nothing until they are wrong. It is read through the rows' own enumeration of
// their commands, so a control added to the row shape is counted here without
// this line being touched.
const ROW_CONTROLS = body().selectors.flatMap(rowCommands).length;

// And what they contribute to a count of this extension's OWN commands. The
// project-folder row runs the editor's command rather than one of ours, so it
// is not among them — which is the distinction this reads rather than assumes.
const ROW_AGGREGA_COMMANDS = body().selectors
  .flatMap(rowCommands)
  .filter((command) => command.startsWith('aggrega.')).length;

// occurrences counts a pattern rather than asserting its presence, because
// several of the rules below are about how MANY of something the document
// carries — one row per group, one tab stop per container, one divider.
function occurrences(html: string, pattern: RegExp): number {
  return html.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
}

// sectionsOf splits the document into one chunk per group, in document order, so
// a per-group rule is asserted against that group's own markup rather than
// against the whole document — where a count can be right in total and wrong
// everywhere.
function sectionsOf(html: string): string[] {
  return html.split('<section class="group').slice(1);
}

// commandsIn reports the commands a chunk's controls name, in order.
function commandsIn(html: string): string[] {
  return Array.from(html.matchAll(/data-command="([^"]+)"/g)).map((m) => m[1]);
}

// groupsInDocument recovers, from the document's own attributes, which group
// each control states it belongs to — as consecutive runs, in document order.
//
// It reads membership AND order: a group whose controls were split apart would
// come back as two runs under one id and fail the comparison, and two groups
// swapped would come back in the wrong order. It is written against the
// attribute rather than against a wrapper so it reads both shapes — the flow
// has no wrapper to read, which is the whole reason the attribute is there.
//
// Requiring data-group to follow data-focus-key is what confines this to the
// operation controls: the rows naming the panel's subject carry a command and a
// focus key and no group, and they must not be counted as members of one.
function groupsInDocument(html: string): Array<[string, string[]]> {
  const runs: Array<[string, string[]]> = [];
  for (const m of html.matchAll(/data-command="([^"]+)" data-focus-key="[^"]*" data-group="([^"]+)"/g)) {
    const command = m[1];
    const group = m[2];
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === group) { last[1].push(command); }
    else { runs.push([group, [command]]); }
  }
  return runs;
}

// flowOf slices the flow's own container out of the document, so an assertion
// about what the flow holds is made against the flow rather than against a
// document that also carries the rows above it.
function flowOf(html: string): string {
  const at = html.indexOf('<div class="groups ops-flow"');
  assert.notStrictEqual(at, -1, 'the document draws no flow at all');
  return html.slice(at);
}

// betweenTheButtonsOf reports what the flow draws that is NOT one of its
// buttons: the flow's markup with the container's own tags and every complete
// button removed, leaving whatever sat between them.
//
// This is the instrument the absence claim below rests on, and it is written as
// a residue rather than as a search for a class name on purpose. A search finds
// only what it was told to look for, so a divider re-introduced under a
// different class, as a different element, or as a bare character would pass it;
// a residue reports whatever is there. Buttons do not nest, so removing each
// complete button cannot swallow anything that sat outside one.
//
// The unit a button and its caret are drawn in is taken apart first, and ONLY
// where it holds exactly an operation's button followed by a caret: it is how
// those two controls are drawn rather than something between them. A unit
// holding anything else, or wrapped around any other control, is left in place
// and comes back as residue — so the unwrapping cannot become the route by which
// something is drawn among the buttons unseen.
function betweenTheButtonsOf(html: string): string {
  return flowOf(html)
    .replace(/^<div\b[^>]*>/, '')
    .replace(/<\/div>[\s\S]*$/, '')
    .replace(pairHoldingExactlyTwo(), '$1$2')
    .replace(/<button\b[\s\S]*?<\/button>/g, '')
    .trim();
}

// PAIR_CLASS is the class of the unit a button and its caret are drawn in, and
// PAIR_OPENING is that unit's whole opening tag: a class, and nothing a reader
// is told about or can stop on.
const PAIR_CLASS = 'op-pair';
const PAIR_OPENING = `<span class="${PAIR_CLASS}">`;

// pairHoldingExactlyTwo matches one unit holding an operation's button and then
// a caret, with nothing but whitespace around or between them, capturing the
// two. Built fresh per call, because a global expression carries a position
// from one use to the next.
function pairHoldingExactlyTwo(): RegExp {
  return new RegExp(
    `${PAIR_OPENING}\\s*(<button class="op"[\\s\\S]*?</button>)\\s*`
      + '(<button class="op-caret"[\\s\\S]*?</button>)\\s*</span>',
    'g',
  );
}

// controlOf names one complete button by what it is: `op:<command>` for an
// operation, `caret:<holder>` for the caret beside one, and its opening tag for
// anything else — so a control of some third kind is reported as itself rather
// than taken for one of the two.
function controlOf(button: string): string {
  const tag = /^<button [^>]*>/.exec(button)?.[0] ?? button;
  if (tag.startsWith('<button class="op-caret"')) {
    return `caret:${/data-dials="([^"]*)"/.exec(tag)?.[1] ?? '?'}`;
  }
  if (tag.startsWith('<button class="op"')) {
    return `op:${/data-command="([^"]*)"/.exec(tag)?.[1] ?? '?'}`;
  }
  return tag;
}

// entriesIn reads, in order, what a container holds DIRECTLY — from just inside
// its opening tag up to its own closing tag — naming each complete button by
// what it is, and the unit a button and its caret are drawn in as
// `pair(<a>, <b>)`, with whatever that unit holds read the same way.
//
// 🔴 IT READS STRUCTURE, NOT PRESENCE. Anything that is neither a button nor
// that unit's exact opening tag is reported as `other:<its opening tag>` and
// ends the read, so a wrapper of another kind, a unit that gained an attribute,
// or anything drawn among the controls comes back as what it is and fails the
// comparison rather than being stepped over. Buttons do not nest, so a lazy
// match to the first closing tag is one whole button.
function entriesIn(markup: string, closing: string): { entries: string[]; rest: string } {
  const entries: string[] = [];
  let rest = markup;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith(closing)) { return { entries, rest: rest.slice(closing.length) }; }
    const button = /^<button\b[\s\S]*?<\/button>/.exec(rest);
    if (button !== null) {
      entries.push(controlOf(button[0]));
      rest = rest.slice(button[0].length);
      continue;
    }
    if (rest.startsWith(PAIR_OPENING)) {
      const inner = entriesIn(rest.slice(PAIR_OPENING.length), '</span>');
      entries.push(`pair(${inner.entries.join(', ')})`);
      rest = inner.rest;
      continue;
    }
    entries.push(`other:${/^<[^>]*>/.exec(rest)?.[0] ?? rest.slice(0, 60)}`);
    return { entries, rest: '' };
  }
}

// flowEntriesOf reads what the flow holds directly.
function flowEntriesOf(html: string): string[] {
  const flow = flowOf(html);
  const opening = /^<div\b[^>]*>/.exec(flow);
  assert.ok(opening !== null, 'the flow has no opening tag to read inside');
  return entriesIn(flow.slice(opening[0].length), '</div>').entries;
}

// sectionEntriesOf reads what each section's body holds directly, one list per
// group, in document order.
function sectionEntriesOf(html: string): string[][] {
  return Array.from(html.matchAll(/<div class="section-body"[^>]*>/g))
    .map((m) => entriesIn(html.slice((m.index ?? 0) + m[0].length), '</div>').entries);
}

// entriesExpected is what a container must hold for a run of operations: each
// operation's button alone, except that an operation in the literal list of
// adjustable ones, while it can run, is ONE unit holding its button and then
// its caret, and nothing else.
function entriesExpected(ops: OperationDef[], cannotRun: OperationId[] = []): string[] {
  return ops.map((op) => {
    const button = `op:${commandIdFor(op)}`;
    const adjustable = DIALS_RULED.some((ruled) => ruled.holder === op.id);
    return adjustable && !cannotRun.includes(op.id) ? `pair(${button}, caret:${op.id})` : button;
  });
}

// operationsCss is the stylesheet the panel is drawn through, read from the file
// the document links rather than restated here.
function operationsCss(): string {
  return fs.readFileSync(path.join(EXTENSION_ROOT, 'media', 'operations.css'), 'utf8');
}

// MENUS_RULED is the set of controls that answer a press by offering a choice
// beside themselves, with the words a reader reads.
//
// 🔴 WRITTEN OUT LITERALLY, AND NOT READ BACK FROM THE DESCRIPTION THE COMPOSER
// READS. A comparison whose two sides come from one table agrees with itself
// whatever that table says, so it would accept a menu silently emptied, a menu
// gained by a control that must not have one, and a rename applied on one side
// only. The literal list is the independent side, so a change here is a
// deliberate decision recorded in this file rather than a consequence nobody
// reviewed.
//
// The fetched ones carry NO options: their choices are held by the compiler —
// the workspace's own entities for two of them, and the kinds an author may
// write a document of for the third — so the composed document cannot hold them,
// which is the difference this list has to be able to see.
// The reader-visible words and the values each choice COMPOSES are separate
// fields, and both are asserted even where they read alike. Taking a label as
// the value an operation acts on is exactly the coupling that breaks silently,
// so the document is required to carry them apart.
const MENUS_RULED: Array<{
  id: OperationId;
  command: string;
  label: string;
  waiting: string;
  values: string[];
  labels: string[];
}> = [
  {
    id: 'scaffold',
    command: 'aggrega.op.scaffold',
    label: 'Kind of entity to draft',
    waiting: 'Reading the entity kinds the compiler declares…',
    values: [],
    labels: [],
  },
  {
    id: 'inspect',
    command: 'aggrega.op.inspect',
    label: 'Entity to inspect',
    waiting: 'Reading the workspace entity index…',
    values: [],
    labels: [],
  },
  {
    id: 'push',
    command: 'aggrega.op.push',
    label: 'Entity to publish',
    waiting: 'Reading the workspace entity index…',
    values: [],
    labels: [],
  },
  {
    id: 'cache',
    command: 'aggrega.op.cache',
    label: 'Cache operation',
    waiting: '',
    values: ['status', 'prune', 'evict', 'clear'],
    labels: ['status', 'prune', 'evict', 'clear'],
  },
];

// MENU_OPTIONS_DRAWN is how many choices the document carries when every control
// can run. Stated as a sum of the list above rather than as a number, so it
// cannot drift from the list it counts.
const MENU_OPTIONS_DRAWN = MENUS_RULED.reduce((total, menu) => total + menu.values.length, 0);

// DIALS_RULED is the set of buttons that carry a CARET beside them opening
// adjustments to the next press, with the words a reader reads.
//
// 🔴 A SEPARATE LIST FROM THE ONE ABOVE, BECAUSE THESE ARE NOT CHOICES. A choice
// answers the question its operation was going to ask and the menu closes; a
// setting is carried into the next press and the menu stays open. They therefore
// differ in what the document has to carry — a settings menu names no command,
// and each entry reports whether it is on — so folding them into one list would
// mean asserting each row against fields the other kind has no answer for.
//
// Written out literally, and NOT read back from the description the composer
// reads, for the reason stated on the list above: a comparison whose two sides
// come from one table agrees with itself whatever that table says.
//
// 🔴 THE HOLDER IS THE OPERATION AND THE CONTROL IS A DIFFERENT ID, and both are
// stated because the difference is the whole design. A control that carries a
// menu opens it instead of running, so adjustments registered against `build`
// would stop the Build button building.
const DIALS_RULED: Array<{
  holder: OperationId;
  control: string;
  label: string;
  caretName: string;
  values: string[];
  labels: string[];
  details: string[];
}> = [
  {
    holder: 'build',
    control: 'dials-build',
    label: 'Adjustments for the next build',
    caretName: 'Build adjustments',
    values: ['autoPull'],
    labels: ['Auto pull'],
    details: [
      "Resolve the Release's dependencies into the lockfile before rendering, then build against them",
    ],
  },
];

// DIALS_DRAWN is how many settings the document carries when every control can
// run. A sum of the list above rather than a number, so it cannot drift from it.
const DIALS_DRAWN = DIALS_RULED.reduce((total, dials) => total + dials.values.length, 0);

// MENU_IDS_IN_ORDER is every region the menu layer holds, in the order the
// document draws them.
//
// 🔴 WRITTEN OUT IN DOCUMENT ORDER RATHER THAN CONCATENATED FROM THE TWO LISTS
// ABOVE. The layer is composed from one walk over the groups, so a settings menu
// lands wherever its holder sits among the operations rather than after them —
// interleaved, and the interleaving is exactly what a concatenation would get
// wrong while still agreeing with itself. Stating the order here is what makes a
// menu that moved a diff in this file.
const MENU_IDS_IN_ORDER: string[] = [
  'dials-build',
  'scaffold',
  'inspect',
  'push',
  'cache',
];

// menusOf slices the document into one chunk per menu, in document order.
//
// 🔴 THE SEPARATOR ADMITS THE SETTINGS MENU'S SECOND CLASS. A split on the bare
// opening tag would not match a menu carrying one, so such a menu would be
// swallowed into its NEIGHBOUR's chunk — leaving the per-menu assertions below
// reading one region while believing they read another, and the count of menus
// short by one with nothing saying so. The optional class is written into the
// separator rather than the split being loosened, because loosening it to
// `op-menu` alone would also split at the LAYER that holds them
// (`class="op-menus"`) and shift every chunk.
function menusOf(html: string): string[] {
  return html.split(/<div class="op-menu(?: op-menu-dials)?"/).slice(1);
}

// menuIdsIn reports the regions the menu layer holds, in document order.
//
// 🔴 THE CHARACTER CLASS ADMITS A HYPHEN, and that is not cosmetic: a settings
// menu's region is named after a control whose id carries one, so a class of
// letters alone would MATCH NOTHING for it and report a clean census over a menu
// it never looked at. That is the shape of false zero this file's own negative
// controls exist to catch, so the widening is asserted rather than assumed —
// the ruled order below names such a region, and a class that could not see it
// would fail against it.
function menuIdsIn(html: string): string[] {
  return Array.from(html.matchAll(/<div class="op-menu[^"]*" id="menu-([a-zA-Z-]+)"/g))
    .map((m) => m[1]);
}

// menuChunkFor slices ONE menu out of the document by the control it belongs
// to, and fails naming the control when the document draws no menu for it — so
// an assertion about one menu is made against that menu rather than against a
// position in a list that another change could shift underneath it.
function menuChunkFor(html: string, id: string): string {
  const chunk = menusOf(html).find((c) => c.startsWith(` id="menu-${id}"`));
  assert.ok(chunk !== undefined, `the document draws no menu for ${id}`);
  return chunk;
}

// dialsIn reports the settings a chunk draws, by the value each composes.
function dialsIn(html: string): string[] {
  return Array.from(html.matchAll(/data-dial="([^"]*)"/g)).map((m) => m[1]);
}

// caretTagOf reports the caret drawn beside one button, or undefined.
function caretTagOf(html: string, holder: OperationId): string | undefined {
  return tagsOf(html).find((tag) => tag.includes(`data-dials="${holder}"`));
}

// optionsIn reports the choices a chunk draws, by the value each composes.
function optionsIn(html: string): string[] {
  return Array.from(html.matchAll(/data-option="([^"]*)"/g)).map((m) => m[1]);
}

// optionLabelsIn reports what a chunk's choices READ, which is a different
// question from what they compose — and the two differ for one menu, which is
// why both are asserted.
function optionLabelsIn(html: string): string[] {
  return Array.from(html.matchAll(/<span class="op-menu-label">(.*?)<\/span>/g)).map((m) => m[1]);
}

// tagsOf reports every opening button tag, so a per-control rule is asserted
// against the control rather than against a count over the whole document —
// where a total can be right and every part of it wrong.
function tagsOf(html: string): string[] {
  return Array.from(html.matchAll(/<button [^>]*>/g)).map((m) => m[0]);
}

const BOTH: OperationsLayout[] = ['buttons', 'sections'];

describe('the Commands panel document', () => {
  it('draws one continuous flow of buttons, with no group title anywhere', () => {
    // The buttons are siblings in one wrapping container. Per-group rows spent
    // a line on every group whether it needed one or not, and a title line on
    // top of that; a flow lets a line that has room for the next group's first
    // button take it.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /data-flow/), 1,
      'the buttons shape draws a number of flows other than one',
    );
    // No group box between the controls, which is what makes the sequence
    // continuous rather than one row per group.
    assert.strictEqual(
      occurrences(html, /<section/), 0,
      'the buttons shape still wraps each group in a box, so its buttons cannot share a line',
    );
    assert.strictEqual(
      occurrences(html, /class="group-row"/), 0,
      'the buttons shape still draws a row per group',
    );
    // The titles, by class and by element: a heading re-introduced as a
    // different element would pass a check written only against the class.
    assert.strictEqual(
      occurrences(html, /class="group-heading"/), 0,
      'the buttons shape still draws a group title',
    );
    assert.strictEqual(
      occurrences(html, /<h[1-6]/), 0,
      'the buttons shape draws a heading element, which is a group title by another name',
    );
    assert.strictEqual(
      occurrences(html, /class="section-title"/), 0,
      'the buttons shape draws a group title as the section shape\'s own title element',
    );
    // A closed set over what the flow is built from, so a title cannot arrive
    // as some element the checks above do not name. The container, the
    // controls, and the spans that are their icons, their labels, their reasons
    // and the unit holding a button together with its caret — and nothing else.
    //
    // Asserted this way rather than by searching for each group's name as
    // content, which cannot work: one group is called Build and so is one of
    // the operations inside it, so that search reports a title that is not
    // there.
    const flow = html.slice(html.indexOf('<div class="groups ops-flow"'));
    assert.deepStrictEqual(
      Array.from(new Set(Array.from(flow.matchAll(/<([a-z0-9]+)[\s>]/g)).map((m) => m[1]))).sort(),
      ['button', 'div', 'span'],
      'the flow draws an element that is neither the container, a control, nor part of one',
    );
    // A negative control: the operations themselves ARE drawn, so the zeros
    // above measure the titles rather than an empty document.
    assert.strictEqual(
      occurrences(html, /class="op"/),
      commandsPanelOperations().length,
      'the flow draws a number of operations other than all of them',
    );
  });

  it('draws each operation\'s name and nothing else, in both shapes', () => {
    // A label carries the name; the explanation is on the control's hover,
    // where a reader who wants it asks for it. Written out literally rather
    // than read back from the same table the composer reads, which would agree
    // with itself whatever the table said.
    const ruled = [
      'Validate', 'Lint', 'Build', 'Preview', 'Graph',
      'Pull',
      'Draft entity', 'Import', 'Inspect',
      'Push', 'Sign', 'Deprecate',
      'Show config', 'Cache…',
    ];
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      assert.deepStrictEqual(
        Array.from(html.matchAll(/<span class="op-label">(.*?)<\/span>/g)).map((m) => m[1]),
        ruled,
        `the ${layout} shape draws a different label, or draws them in a different order`,
      );
    }
  });

  it('marks the one entry that asks WHICH operation, and no entry that asks for a subject', () => {
    // The mark reads as a promise about what happens next. Asking for the
    // SUBJECT of a named operation is what almost every entry here does, so
    // marking that would mark most of the panel and distinguish nothing. The
    // cache is not the same act: pressing it names no operation, and what it
    // asks is which one to run.
    const marked = commandsPanelOperations().filter((op) => op.label.endsWith('…')).map((op) => op.id);
    assert.deepStrictEqual(
      marked, ['cache'],
      'an entry that asks for a subject is marked as though it asked which operation',
    );
    // A negative control on the census: the mark is a character this search can
    // actually see, established against the one label that carries it.
    assert.ok(
      commandsPanelOperations().some((op) => op.label.includes('…')),
      'the census cannot see the mark on a label that carries it, so its zeros mean nothing',
    );
    // And it reaches the drawn document, not only the table.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /<span class="op-label">[^<]*…<\/span>/), 1,
      'the drawn labels carry a number of marks other than the one',
    );
  });

  it('carries the same groups, the same membership and the same order in both shapes', () => {
    // The shape decides how a group is drawn, never what is in it or what order
    // they come in — which a finished decision settled and this document does
    // not revisit.
    const expected: Array<[string, string[]]> = OPERATION_GROUPS
      .map((group) => [group.id, group.operations.map(commandIdFor)]);
    for (const layout of BOTH) {
      assert.deepStrictEqual(
        groupsInDocument(operationsBodyHtml(body({ layout }))), expected,
        `the ${layout} shape draws different groups, membership or order`,
      );
    }
    // The section shape additionally nests each group's controls inside that
    // group's own box, which is what its headings label.
    const sections = operationsBodyHtml(body({ layout: 'sections' }));
    assert.deepStrictEqual(
      sectionsOf(sections).map(commandsIn),
      OPERATION_GROUPS.map((group) => group.operations.map(commandIdFor)),
      'the section shape does not nest each group\'s controls in that group\'s box',
    );
  });

  it('puts the rows naming the subject ahead of every group, in both shapes', () => {
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      const rows = html.indexOf('class="selectors"');
      const groups = html.indexOf('class="groups');
      assert.notStrictEqual(rows, -1, 'the rows are not drawn at all');
      assert.notStrictEqual(groups, -1, 'no group is drawn at all');
      assert.ok(
        rows < groups,
        `the ${layout} shape draws a group before the rows naming what it acts on`,
      );
      // And no row is inside the operations, which is what makes the rule
      // a property of the document rather than one somebody has to remember.
      // Asserted over everything from the operations onward, so it holds for
      // the flow — which has no per-group box for the loop below to slice.
      assert.strictEqual(
        occurrences(html.slice(groups), /class="selector"/), 0,
        `the ${layout} shape puts a selector row among the operations`,
      );
      assert.strictEqual(
        occurrences(html.slice(groups), /class="selector-create"/), 0,
        `the ${layout} shape puts a create control among the operations`,
      );
      for (const chunk of sectionsOf(html)) {
        assert.strictEqual(
          occurrences(chunk, /class="selector"/), 0,
          `the ${layout} shape puts a selector row inside a group`,
        );
      }
    }
  });

  it('keeps every row in front of a reader who has closed every section', () => {
    // The clause that would fail if any row were inside a group.
    const html = operationsBodyHtml(body({
      layout: 'sections',
      collapsed: OPERATION_GROUPS.map((group) => group.id),
    }));
    for (const row of selectorRows(ANCHORED, ANCHORED, ANCHORED, SELECTED, SEVERAL)) {
      assert.ok(
        html.includes(`data-focus-key="${row.key}"`),
        `the ${row.label} row is gone once every section is closed`,
      );
      assert.ok(html.includes(row.value), `the ${row.label} row shows no value`);
    }
    // A negative control: with every section closed, no operation is reachable,
    // so the rows above are the only controls left. If an operation were still
    // drawn as visible content the assertion would be measuring the wrong
    // document.
    assert.strictEqual(
      occurrences(html, /aria-expanded="true"/), 0,
      'a section reported itself open after being closed',
    );
    assert.strictEqual(
      occurrences(html, /<div class="section-body" id="sec-[a-z]+" role="group" hidden>/),
      OPERATION_GROUPS.length,
      'a closed section stayed in the accessibility tree instead of leaving it',
    );
  });

  it('keeps each context row to one line and puts its detail on the hover', () => {
    // The row exists so a reader knows WHAT the buttons would act on, and the
    // identity answers that. The full path answers "which one exactly", which
    // is a second question — so it is asked for rather than drawn, and the row
    // costs one line instead of a block.
    const rows = selectorRows('/work/demo', '/work/demo/services/api', '/work/demo/services/api', SELECTED, SEVERAL);
    const html = operationsBodyHtml(body({ selectors: rows }));

    // Nothing is drawn beneath a row, by class and by count.
    assert.strictEqual(
      occurrences(html, /class="selector-detail"/), 0,
      'a row still draws a block of text beneath itself',
    );
    assert.strictEqual(
      occurrences(html, /class="selector-line"/), 0,
      'a row still draws its explanation as lines of its own',
    );

    // What each row DRAWS is its own name and its own value, and nothing else.
    // Sliced from the control's own markup rather than searched for across the
    // document: the control carries the whole text as its hover, so a
    // document-wide search finds every line whether it is drawn or not.
    const drawn = Array.from(html.matchAll(/<button class="selector"[^>]*>(.*?)<\/button>/gs))
      .map((m) => m[1]);
    assert.strictEqual(drawn.length, rows.length, 'a row is not drawn as a control');
    // Asserted as an EQUALITY over the row's whole drawn text rather than as
    // two containments, and over every row rather than over one of them. A
    // containment passes over a row that drew its name, its value AND the full
    // path beside them, which is the regression this is here for; and an
    // assertion pinned to a position stops describing the row it was written
    // about the moment another is added above it.
    for (let at = 0; at < rows.length; at += 1) {
      const text = drawn[at].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      assert.strictEqual(
        text, `${rows[at].label} ${rows[at].value}`,
        `the ${rows[at].key} row draws something other than its own name and value`,
      );
    }
    const workspaceAt = rows.findIndex((row) => row.key === 'workspace');
    assert.notStrictEqual(workspaceAt, -1, 'there is no workspace row to check');
    assert.ok(
      !drawn[workspaceAt].includes('Aggrega workspace: /work/demo'),
      'the workspace row still draws the anchored path rather than leaving it to the hover',
    );

    // And every line of every row's text is on that row's hover, whole and
    // unfiltered — including the open folder, which is the fact that only
    // exists when the two differ. A row that dropped a line would have moved
    // the detail nowhere rather than onto the hover.
    const hovers = Array.from(html.matchAll(/<button class="selector"[^>]*title="([^"]*)"/gs))
      .map((m) => m[1]);
    assert.strictEqual(hovers.length, rows.length, 'a row carries no hover at all');
    assert.ok(
      hovers[workspaceAt].includes('/work/demo/services/api'),
      'the open folder reaches neither the workspace row nor its hover',
    );
    for (let at = 0; at < rows.length; at += 1) {
      for (const line of rows[at].tooltip.split('\n')) {
        assert.ok(
          hovers[at].includes(line),
          `the ${rows[at].key} hover drops the line ${JSON.stringify(line)}`,
        );
      }
    }
  });

  it('draws three rows, in the order that teaches the containment', () => {
    // The arrangement IS the teaching: three things nest, and a reader is shown
    // that by where the rows sit rather than told it in a paragraph. So the
    // order is asserted over the composed document, not only over the list the
    // composer was handed — a composer that reordered them would leave that
    // list right and the reader wrong.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      const drawn = Array.from(html.matchAll(/<span class="selector-label">([^<]*)<\/span>/g))
        .map((m) => m[1]);
      assert.deepStrictEqual(
        drawn,
        ['Project folder', 'Aggrega workspace', 'Release'],
        `the ${layout} shape draws the levels in an order that teaches the wrong containment`,
      );
      assert.deepStrictEqual(
        drawn,
        SELECTOR_ROW_KEYS.map((key) => SELECTOR_ROW_LABELS[key]),
        `the ${layout} shape draws a name the rows do not declare`,
      );
    }
  });

  it('gives each row its own value, and none of them a neighbour\'s', () => {
    // The three levels nest on disk, so a row reading the wrong one still draws
    // something that looks like an answer. Distinct inputs are what make a
    // crossed pair visible.
    const rows = selectorRows('/work/demo', '/work/demo/services/api', '/work/demo/services/api', SELECTED, SEVERAL);
    const html = operationsBodyHtml(body({ selectors: rows }));
    const values = Array.from(html.matchAll(/<span class="selector-value">([^<]*)<\/span>/g))
      .map((m) => m[1]);
    assert.deepStrictEqual(values, ['api', 'demo', 'releases/prod.yaml']);
    assert.strictEqual(
      new Set(values).size, values.length,
      'two rows drew the same value, so one of them is reporting the wrong level',
    );
  });

  it('draws the create control BESIDE the choosing control and never inside it', () => {
    // 🔴 THE CLAIM THIS RESTS ON IS THAT A PRESS CANNOT LAND ON THE WRONG ONE.
    // A press is routed by the nearest enclosing element carrying a command, so
    // a create control drawn inside the choosing control would be inside that
    // control's press target and would choose instead of creating — silently,
    // because nothing tells a reader the target they aimed at is not the one
    // they hit. The instrument is the choosing control's OWN markup: it carries
    // exactly one command, and it is the one that chooses.
    const html = operationsBodyHtml(body());
    const rows = body().selectors;
    const choosing = Array.from(html.matchAll(/<button class="selector"[\s\S]*?<\/button>/g))
      .map((m) => m[0]);
    assert.strictEqual(choosing.length, rows.length, 'a row is not drawn as a choosing control');
    for (let at = 0; at < rows.length; at += 1) {
      assert.deepStrictEqual(
        commandsIn(choosing[at]), [rows[at].command],
        `the ${rows[at].key} choosing control carries a command that is not its own`,
      );
      assert.strictEqual(
        occurrences(choosing[at], /<button/), 1,
        `the ${rows[at].key} choosing control encloses a second control`,
      );
    }

    // And the create controls are their own targets, carrying their own command
    // and their own place for the reader to return to.
    const creatable = rows.filter((row) => row.create !== null);
    const creating = Array.from(html.matchAll(/<button class="selector-create"[\s\S]*?<\/button>/g))
      .map((m) => m[0]);
    assert.strictEqual(
      creating.length, creatable.length,
      'a level that can be created is drawn without a control that creates it',
    );
    for (let at = 0; at < creatable.length; at += 1) {
      const row = creatable[at];
      assert.deepStrictEqual(commandsIn(creating[at]), [row.create?.command]);
      assert.ok(
        creating[at].includes(`data-focus-key="${createControlKey(row.key)}"`),
        `the ${row.key} create control does not take a place of its own`,
      );
      assert.ok(
        creating[at].includes('type="button"'),
        `the ${row.key} create control is not a native button, so the platform gives it nothing`,
      );
      assert.ok(
        creating[at].includes(`aria-label="${row.create?.label}"`),
        `the ${row.key} create control draws no word and announces none either`,
      );
    }
  });

  it('draws the offer BESIDE the other two controls, with its own place and its own name', () => {
    // 🔴 THE CLAIM THIS RESTS ON IS THE CREATE CONTROL'S, WITH MORE AT STAKE. A
    // press is routed by the nearest enclosing element carrying a command, so an
    // offer drawn inside the choosing control would choose instead of opening —
    // and an offer drawn where the create control was would reload the window
    // for a reader who aimed at making a workspace.
    const rows = selectorRows('/work/demo', '/work/demo/services/api', '/work/demo/services/api', SELECTED, SEVERAL);
    const html = operationsBodyHtml(body({ selectors: rows }));
    const offering = rows.filter((row) => row.offer !== null);
    assert.strictEqual(
      offering.length, 1,
      'the number of rows offering to open a folder is not the one row that has a folder of its own',
    );
    const drawn = Array.from(html.matchAll(/<button class="selector-offer"[\s\S]*?<\/button>/g))
      .map((m) => m[0]);
    assert.strictEqual(
      drawn.length, offering.length,
      'a row that carries an offer is drawn without a control that performs it',
    );
    const row = offering[0];
    assert.deepStrictEqual(commandsIn(drawn[0]), [row.offer?.command]);
    assert.ok(
      drawn[0].includes(`data-focus-key="${offerControlKey(row.key)}"`),
      'the offer does not take a place of its own, so the reader\'s place moves when it appears',
    );
    assert.ok(
      drawn[0].includes('type="button"'),
      'the offer is not a native button, so the platform gives it nothing',
    );
    assert.ok(
      drawn[0].includes(`aria-label="${row.offer?.label}"`),
      'the offer draws no word and announces none either',
    );
    assert.ok(
      drawn[0].includes(`title="${row.offer?.label}"`),
      'the offer says what it costs to a reader using a keyboard and not to one using a pointer',
    );
    // And the consequence reaches the drawn document rather than stopping at the
    // row: this is the only channel a reader has before pressing.
    assert.ok(
      /reload/i.test(drawn[0]),
      `the drawn offer names a destination and no consequence:\n${drawn[0]}`,
    );

    // The row it sits on still runs what it ran, and so does the create control
    // beside it — the offer is an addition rather than a replacement.
    const choosing = Array.from(html.matchAll(/<button class="selector"[\s\S]*?<\/button>/g))
      .map((m) => m[0]);
    const at = rows.findIndex((r) => r.key === row.key);
    assert.deepStrictEqual(commandsIn(choosing[at]), [row.command]);
    assert.strictEqual(
      occurrences(choosing[at], /<button/), 1,
      'the choosing control encloses the offer, so a press on the offer chooses instead',
    );
  });

  it('reserves the offer\'s column on every row, so no value moves as a window changes', () => {
    // 🔴 THE COLUMN IS RESERVED FOR A REASON THE CREATE COLUMN DOES NOT HAVE.
    // What fills it comes and goes with the window rather than with the level,
    // so a column standing only while it is filled would slide one row's value
    // sideways as the reader opened a different folder — under their pointer, on
    // the surface they are reading to find out where they are.
    const cases: Array<[string, string]> = [
      ['/work/demo', '/work/demo/services/api'],
      ['/work/demo', '/work/demo'],
    ];
    for (const [anchored, opened] of cases) {
      const rows = selectorRows(anchored, opened, opened, SELECTED, SEVERAL);
      const html = operationsBodyHtml(body({ selectors: rows }));
      const chunks = Array.from(html.matchAll(/<div class="selector-row">([\s\S]*?)<\/div>/g))
        .map((m) => m[1]);
      assert.strictEqual(chunks.length, rows.length, 'a row is not drawn in a row container');
      for (let at = 0; at < rows.length; at += 1) {
        const expected = rows[at].offer === null ? 0 : 1;
        assert.strictEqual(
          occurrences(chunks[at], /class="selector-offer"/), expected,
          `the ${rows[at].key} row draws the wrong number of offers with ${opened} open`,
        );
        assert.strictEqual(
          occurrences(chunks[at], /class="selector-offer-gap"/), 1 - expected,
          `the ${rows[at].key} row does not keep the same three columns as the others with `
          + `${opened} open`,
        );
      }
      // 🔴 AND THE LITERAL SIDE, which is what makes the loop worth running:
      // both of its sides come from the rows, so it agrees with itself whatever
      // the rows say. The total is written out.
      assert.strictEqual(
        occurrences(html, /class="selector-offer-gap"/),
        anchored === opened ? 3 : 2,
        `the reserved columns do not add up with ${opened} open`,
      );
    }

    // The reserved column is a gap and not a control: it takes no press, no tab
    // stop and no announcement, so what it adds is width and nothing else.
    const gap = operationsBodyHtml(body()).match(/<span class="selector-offer-gap"[^>]*>/);
    assert.notStrictEqual(gap, null, 'no column is reserved at all');
    assert.ok(gap !== null && gap[0].includes('aria-hidden="true"'));
    assert.ok(gap !== null && !gap[0].includes('data-command'));
    assert.ok(gap !== null && !gap[0].includes('data-focus-key'));
  });

  it('draws no create control on the project-folder row, and still reserves its column', () => {
    // Bringing a project folder into being is not an Aggrega act, so a control
    // there would promise a creation nothing performs. The column is reserved
    // all the same: without it the choosing control on that row is a different
    // width from the two below, which puts its value out of line with theirs —
    // and the rows are read down the panel as three answers to one question.
    const html = operationsBodyHtml(body());
    const chunks = Array.from(html.matchAll(/<div class="selector-row">([\s\S]*?)<\/div>/g))
      .map((m) => m[1]);
    const rows = body().selectors;
    assert.strictEqual(chunks.length, rows.length, 'a row is not drawn in a row container');
    for (let at = 0; at < rows.length; at += 1) {
      const expected = rows[at].create === null ? 0 : 1;
      assert.strictEqual(
        occurrences(chunks[at], /class="selector-create"/), expected,
        `the ${rows[at].key} row draws the wrong number of create controls`,
      );
      assert.strictEqual(
        occurrences(chunks[at], /class="selector-create-gap"/), 1 - expected,
        `the ${rows[at].key} row does not keep the same two columns as the others`,
      );
    }
    // 🔴 AND THE LITERAL SIDE, WHICH IS WHAT MAKES THE LOOP ABOVE WORTH
    // RUNNING. Both sides of that loop come from the rows, so it agrees with
    // itself whatever the rows say — a project-folder row that grew a create
    // control would move the expectation with it and pass. The level that must
    // have none is therefore named here, and the total is written out.
    const project = chunks.find((chunk) => chunk.includes('>Project folder<'));
    assert.notStrictEqual(project, undefined, 'no row names the project folder at all');
    assert.strictEqual(
      occurrences(project ?? '', /class="selector-create"/), 0,
      'the project-folder row draws a control that would create nothing',
    );
    assert.strictEqual(
      occurrences(html, /class="selector-create"/), 2,
      'a level gained or lost a create control',
    );

    // The reserved column is a gap and not a control: it takes no press, no tab
    // stop and no announcement, so what it adds is width and nothing else.
    const gap = html.match(/<span class="selector-create-gap"[^>]*>/);
    assert.notStrictEqual(gap, null, 'no column is reserved at all');
    assert.ok(gap !== null && gap[0].includes('aria-hidden="true"'));
    assert.ok(gap !== null && !gap[0].includes('data-command'));
    assert.ok(gap !== null && !gap[0].includes('data-focus-key'));
  });

  it('tracks the reader\'s open and closed sections in what it composes', () => {
    // The document is composed already in the shape the reader left it, so
    // there is no frame in which every section is open and then closes.
    const html = operationsBodyHtml(body({ layout: 'sections', collapsed: ['publish'] }));
    assert.ok(
      html.includes('aria-controls="sec-publish" tabindex="-1" data-toggle="publish"')
      || html.includes('aria-expanded="false" aria-controls="sec-publish"'),
      'the closed section does not report itself closed',
    );
    // Counted over the SECTION TOGGLES rather than over the document, because a
    // control offering a menu also reports whether that menu is open — and a
    // document-wide count would fold the two states into one number, where a
    // section wrongly reporting itself closed could be cancelled out by a menu
    // wrongly reporting itself open. The two are counted apart and then
    // accounted for in total, so nothing goes unmeasured either way.
    const toggles = tagsOf(html).filter((tag) => tag.includes('data-toggle='));
    assert.strictEqual(
      toggles.filter((tag) => tag.includes('aria-expanded="false"')).length, 1,
      'the number of sections reporting themselves closed is not the number the reader closed',
    );
    assert.strictEqual(
      occurrences(html, /aria-expanded="false"/),
      1 + MENUS_RULED.length + DIALS_RULED.length,
      'something other than the closed section, the menus and the adjustment carets reports itself closed',
    );
    assert.strictEqual(
      occurrences(html, /aria-expanded="true"/),
      OPERATION_GROUPS.length - 1,
      'a section the reader left open reports itself closed',
    );
    assert.ok(
      html.includes('id="sec-publish" role="group" hidden'),
      'the closed section\'s content stays in the accessibility tree',
    );
  });
});

describe('an operation whose invocation cannot succeed', () => {
  const noRelease: Partial<Record<OperationId, string | null>> = {
    build: NO_RELEASE_SELECTED_CONTROL_REASON,
    preview: NO_RELEASE_SELECTED_CONTROL_REASON,
  };

  it('stays in place, disabled, rather than being removed', () => {
    // In a horizontal row removing one moves the others under the reader's
    // pointer as the state changes, so a press lands on something other than
    // what was there a moment ago. The row's geometry is what a disabled control
    // preserves.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout, unavailable: noRelease }));
      assert.deepStrictEqual(
        commandsIn(html).filter((c) => c.startsWith('aggrega.')).length,
        commandsPanelOperations().length + ROW_AGGREGA_COMMANDS,
        `the ${layout} shape drew a different number of controls than there are entries and rows`,
      );
      assert.strictEqual(
        occurrences(html, / disabled/), 2,
        `the ${layout} shape disabled a number of controls other than the two that cannot run`,
      );
    }
  });

  it('carries the reason, both as a description and where a pointer finds it', () => {
    const html = operationsBodyHtml(body({ unavailable: noRelease }));
    assert.ok(
      html.includes(`<span class="op-reason" id="why-build">${NO_RELEASE_SELECTED_CONTROL_REASON}</span>`),
      'the reason is not carried on the control at all',
    );
    assert.ok(
      html.includes('aria-describedby="why-build"'),
      'the control does not point at its own reason, so nothing announces it',
    );
    assert.ok(
      html.includes(`title="Compile a Release and write its rendered artifacts; findings land in the Problems panel — ${NO_RELEASE_SELECTED_CONTROL_REASON}"`),
      'the reason is not reachable by pointer',
    );
  });

  it('is never given the tab stop, because a disabled control cannot hold focus', () => {
    // A container whose tab stop sat on a disabled control would strand the
    // reader: Tab would reach a control that never receives the keystroke. The
    // reader's own place is set to a control that cannot run, so the fallback is
    // what has to hold.
    //
    // Asserted by reading every button tag rather than by slicing around one
    // control: an earlier form of this test sliced a window and compared its
    // start, which could never match, so it passed whatever the document said.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({
        layout,
        unavailable: noRelease,
        focused: 'aggrega.op.build',
      }));
      const tags = Array.from(html.matchAll(/<button [^>]*>/g)).map((m) => m[0]);
      const stopped = tags.filter((tag) => tag.includes('tabindex="0"'));
      assert.ok(
        stopped.length > 0,
        `the ${layout} shape places no tab stop at all, so the absence below measures nothing`,
      );
      for (const tag of stopped) {
        assert.ok(
          !tag.includes(' disabled'),
          `the ${layout} shape puts the tab stop on a control that cannot take focus`,
        );
      }
      assert.ok(
        !tags.some((tag) => tag.includes('aggrega.op.build') && tag.includes('tabindex="0"')),
        `the ${layout} shape left the reader's place on an entry that cannot run`,
      );
    }
    const buttons = operationsBodyHtml(body({ unavailable: noRelease, focused: 'aggrega.op.build' }));
    assert.strictEqual(
      occurrences(buttons, /tabindex="0"/), 1,
      'the flow carries a number of tab stops other than one',
    );
  });

  it('reports no reason for anything when nothing is unavailable', () => {
    // A negative control for the block above: with an empty map the document
    // disables nothing, so the counts above measure the map rather than the
    // composer.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      assert.strictEqual(occurrences(html, / disabled/), 0);
      assert.strictEqual(occurrences(html, /class="op-reason"/), 0);
      assert.strictEqual(occurrences(html, /aria-describedby/), 0);
    }
  });
});

describe('what the panel owes a reader who is not using a pointer', () => {
  it('draws every control as a native button and nothing as a stand-in for one', () => {
    // Activation on Enter and on Space, the unavailable state and the
    // accessible name all come from the platform for a button and from nowhere
    // for an element dressed as one.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      assert.strictEqual(
        occurrences(html, /role="button"/), 0,
        `the ${layout} shape dresses something up as a button`,
      );
      const controls = occurrences(html, /<button /);
      assert.strictEqual(
        controls,
        commandsPanelOperations().length
        + ROW_CONTROLS
        + MENU_OPTIONS_DRAWN
        + DIALS_RULED.length
        + DIALS_DRAWN
        + (layout === 'sections' ? OPERATION_GROUPS.length : 0),
        `the ${layout} shape draws a number of buttons other than its controls`,
      );
      assert.strictEqual(
        occurrences(html, /type="button"/), controls,
        `the ${layout} shape draws a button that would submit rather than act`,
      );
    }
  });

  it('names every group once as a landmark in the section shape, which has a box to label', () => {
    // A tree announces "N of M, level L" for free. In the section shape a
    // labelled landmark per group is the replacement, and it is cheaper and
    // clearer than hanging a description off every button.
    const html = operationsBodyHtml(body({ layout: 'sections' }));
    for (const group of OPERATION_GROUPS) {
      assert.ok(
        html.includes(`role="group" aria-labelledby="grp-${group.id}"`),
        `the section shape leaves ${group.id} unlabelled`,
      );
      assert.strictEqual(
        occurrences(html, new RegExp(`id="grp-${group.id}"`)), 1,
        `the section shape gives ${group.id} a number of labels other than one`,
      );
    }
  });

  it('names the flow itself, and states each control\'s group on the control', () => {
    // The flow shape has no group box and no title, so there is nothing to hang
    // a per-group landmark on: the replacement is one named toolbar the reader
    // is told they have entered and positioned within. Which group a control
    // belongs to is a ruled property of the surface rather than a consequence
    // of the drawing, so the control states it whether or not anything draws a
    // box around it — which is what keeps membership readable in a shape that
    // draws no grouping at all.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.ok(
      html.includes('role="toolbar" aria-label="Commands" aria-orientation="horizontal"'),
      'the flow does not declare itself a named horizontal toolbar',
    );
    assert.strictEqual(
      occurrences(html, /data-group="/),
      commandsPanelOperations().length,
      'a control in the flow states no group, or one is stated twice',
    );
    assert.strictEqual(
      occurrences(html, /aria-labelledby="grp-/), 0,
      'the flow points at a group label that no longer exists',
    );
  });

  it('costs one tab stop for the whole flow, not one per group', () => {
    // A stop per control would cost one for every operation and every row,
    // against a tree's one — and that cost grows with the panel. Per-group rows
    // cost one each; a single flow costs one for the panel, and the arrow keys
    // walk the whole sequence — which is the contract a reader already has from
    // the trees beside this panel, now cheaper.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /data-roving/), 1,
      'the button shape does not put one roving container around the whole flow',
    );
    assert.strictEqual(
      occurrences(html, /tabindex="0"/), 1,
      'the flow carries a number of tab stops other than one',
    );
    // Counted over the operation controls rather than over the document. A
    // menu's choices are out of the tab order too, and for the same reason —
    // a menu is reached by pressing the control that opens it, never by tabbing
    // into one — but they are not controls in the flow, so folding them into
    // this count would let a control that HAD escaped the roving stop be hidden
    // by a menu having gained a choice.
    const opTags = tagsOf(html).filter((tag) => tag.includes('class="op"'));
    assert.strictEqual(
      opTags.length, commandsPanelOperations().length,
      'the flow draws a number of operation controls other than all of them',
    );
    assert.strictEqual(
      opTags.filter((tag) => tag.includes('tabindex="-1"')).length,
      commandsPanelOperations().length - 1,
      'a control in the flow is outside the roving stop\'s reach',
    );
    // 🔴 AND NOTHING ELSE IN THE DOCUMENT IS OUTSIDE ONE OR THE OTHER. This is
    // the clause that keeps the narrowing above from being a weakening: every
    // stop-less control is one of a closed set of kinds, and a kind arriving
    // from outside it fails here.
    //
    // The kinds are: an operation the roving stop passes over; a menu choice; an
    // adjustment caret, which the roving stop DOES walk and so passes over on
    // every drawing but one; and an adjustment itself, which is inside a menu and
    // out of the tab order for the same reason a choice is.
    assert.strictEqual(
      occurrences(html, /tabindex="-1"/),
      commandsPanelOperations().length - 1 + MENU_OPTIONS_DRAWN + DIALS_RULED.length + DIALS_DRAWN,
      'something other than the flow\'s controls, the menu choices and the adjustments carries no tab stop',
    );
  });

  it('costs one tab stop for the whole list in the section shape', () => {
    const html = operationsBodyHtml(body({ layout: 'sections' }));
    assert.strictEqual(
      occurrences(html, /data-roving/), 1,
      'the section shape does not put one roving container around the whole list',
    );
    assert.strictEqual(
      occurrences(html, /tabindex="0"/), 1,
      'the section list carries a number of tab stops other than one',
    );
  });

  it('returns the tab stop to the control the reader was on', () => {
    // The panel re-draws underneath a reader — on readiness, on a selection
    // change, on the anchored folder moving — and a re-drawing that lost their
    // place would send them back to the first control each time.
    const html = operationsBodyHtml(body({ layout: 'buttons', focused: 'aggrega.op.deprecate' }));
    assert.ok(
      html.includes('tabindex="0" data-command="aggrega.op.deprecate"'),
      'the reader\'s own control did not keep the tab stop',
    );
  });

  it('falls back to the first control where the reader\'s place is gone', () => {
    // The shape changed, a group closed, or the control became unavailable. A
    // container with no tab stop at all is one Tab skips entirely, which is
    // worse than starting the reader at the beginning of it.
    const html = operationsBodyHtml(body({ layout: 'buttons', focused: 'aggrega.op.nothing' }));
    assert.strictEqual(occurrences(html, /tabindex="0"/), 1);
    assert.ok(html.includes('tabindex="0" data-command="aggrega.op.validate"'));
  });

  it('makes the whole heading row the toggle, as the whole row toggles in a tree', () => {
    const html = operationsBodyHtml(body({ layout: 'sections' }));
    assert.strictEqual(
      occurrences(html, /class="section-head"/),
      OPERATION_GROUPS.length,
      'a group is missing its toggle, or carries two',
    );
    assert.strictEqual(
      tagsOf(html).filter((tag) => tag.includes('data-toggle=') && tag.includes('aria-expanded=')).length,
      OPERATION_GROUPS.length,
      'a toggle does not report whether its section is open',
    );
    assert.strictEqual(
      occurrences(html, /aria-controls="sec-/),
      OPERATION_GROUPS.length,
      'a toggle does not name the region it controls',
    );
    // The total is accounted for, so the narrowing above cannot hide a control
    // that reports an expansion state it has no business having: a toggle, a
    // control that opens a menu, or a caret that opens adjustments, and nothing
    // else.
    assert.strictEqual(
      occurrences(html, /aria-expanded=/),
      OPERATION_GROUPS.length + MENUS_RULED.length + DIALS_RULED.length,
      'something that neither opens a section, a menu nor a set of adjustments reports an expansion state',
    );
  });
});

describe('how one group is separated from the next', () => {
  it('marks a difference in KIND once, in the section shape, which has a box to border', () => {
    // The group declares that its operations differ in kind — publishing
    // changes what every consumer of a catalog resolves, while everything else
    // writes to this machine. The section shape has a group box, so it draws
    // that as a rule with a margin ahead of the one group carrying it.
    const separated = OPERATION_GROUPS.filter((group) => group.separated).map((g) => g.id);
    assert.deepStrictEqual(separated, ['publish'], 'the group model separates a different group');
    const html = operationsBodyHtml(body({ layout: 'sections' }));
    assert.strictEqual(
      occurrences(html, /group group-separated/), 1,
      'the section shape draws a number of dividers other than one',
    );
    assert.ok(
      html.includes('class="group group-separated" role="group" aria-labelledby="grp-publish"'),
      'the section shape separates the wrong group',
    );
    assert.strictEqual(
      occurrences(html, /─/), 0,
      'the section shape still stands a row of characters in for a divider',
    );
  });

  it('draws NOTHING between one group and the next in the flow, at any width', () => {
    // The flow separates its groups by the order they come in and by nothing
    // drawn: compactness is what the shape is for, and a divider at every
    // adjacent pair spends a control's worth of width and a gap on each. The
    // group order still fixes the sequence, and each control still states the
    // group it belongs to — asserted by the membership-and-order clause above.
    //
    // "AT ANY WIDTH" is a property of the composition rather than a range this
    // can iterate: operationsBodyHtml takes no width, so there is one composed
    // document and it is what every width is drawn from. What no test here can
    // reach is the browser's own layout — but the flow now carries nothing for
    // a layout to place between the buttons, which is the whole claim.
    //
    // THE INSTRUMENT IS betweenTheButtonsOf, a residue rather than a search:
    // whatever the flow draws that is not one of its buttons comes back, under
    // whatever class or element name it was written as.
    for (const focused of [null, 'aggrega.op.deprecate']) {
      const html = operationsBodyHtml(body({ layout: 'buttons', focused }));
      assert.strictEqual(
        betweenTheButtonsOf(html), '',
        'the flow draws something between its buttons',
      );
    }

    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    // A negative control on the instrument: the residue is taken from a flow
    // that really does hold every button, so the empty result above measures
    // what sits BETWEEN them rather than an empty flow.
    assert.strictEqual(
      occurrences(flowOf(html), /class="op"/),
      commandsPanelOperations().length,
      'the flow holds a number of buttons other than all of them, so the residue measures the wrong document',
    );
    // And the kind-based divider is not quietly redrawn here instead. The flow
    // has no group box to border, so the group model's flag draws nothing on
    // this shape — while the section shape still draws it, asserted above.
    assert.strictEqual(
      occurrences(html, /group-separated/), 0,
      'the flow draws the kind-based divider, which belongs to the shape that has a box',
    );
  });
});

describe('a control that offers its choices beside itself', () => {
  it('offers a menu on exactly the controls ruled to have one, in both shapes', () => {
    // The set is compared against the literal list at the top of this file
    // rather than against the description the composer reads. A comparison
    // sharing one table with the composer agrees with itself whatever that
    // table says, which is how a menu silently gained or emptied would pass.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      assert.deepStrictEqual(
        menuIdsIn(html),
        MENU_IDS_IN_ORDER,
        `the ${layout} shape draws a different set of menus, or draws them in a different order`,
      );
      // And no OTHER control claims to open one. This is the half that catches a
      // menu reference added to a control the layer holds no menu for — which
      // would be a control announcing a choice that does not exist.
      assert.deepStrictEqual(
        Array.from(html.matchAll(/aria-haspopup="menu" aria-expanded="false" aria-controls="menu-([a-zA-Z-]+)"/g))
          .map((m) => m[1])
          .sort(),
        [...MENU_IDS_IN_ORDER].sort(),
        `the ${layout} shape has a control claiming a menu that is not there, or a menu no control opens`,
      );
    }
    // 🔴 A NEGATIVE CONTROL ON THE WIDENED INSTRUMENT, and it is the reason the
    // widening is safe to make. The ruled order above names a region whose id
    // carries a hyphen, so a census over letters alone would have found nothing
    // for it and reported a clean sweep over a menu it never inspected. This
    // establishes that such an id IS in the ruled set, which is what makes the
    // comparisons above measure the wider surface rather than the old one.
    assert.ok(
      MENU_IDS_IN_ORDER.some((id) => id.includes('-')),
      'no ruled region carries a hyphenated id, so the widened census measures nothing the narrow one missed',
    );
    assert.deepStrictEqual(
      MENU_IDS_IN_ORDER.filter((id) => id.includes('-')),
      DIALS_RULED.map((dials) => dials.control),
      'the hyphenated regions are not the adjustment menus, so the widening admits something unaccounted for',
    );
  });

  it('draws each menu\'s choices, by what they compose and by what they read', () => {
    // Each menu is sliced by the control it belongs to rather than by its
    // position, so a menu that MOVED in the layer — which a settings menu
    // interleaved among the operations does — fails the order clause above
    // rather than silently shifting every assertion here onto its neighbour.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      menusOf(html).length,
      MENUS_RULED.length + DIALS_RULED.length,
      'the document draws a different number of menus',
    );
    for (const ruled of MENUS_RULED) {
      const chunk = menuChunkFor(html, ruled.id);
      assert.deepStrictEqual(
        optionsIn(chunk), ruled.values,
        `${ruled.id} composes a different selection, or composes them in a different order`,
      );
      assert.deepStrictEqual(
        optionLabelsIn(chunk), ruled.labels,
        `${ruled.id} reads differently, or reads its choices in a different order`,
      );
      assert.ok(
        chunk.includes(`aria-label="${ruled.label}"`),
        `${ruled.id}'s menu is not named ${JSON.stringify(ruled.label)} for a reader who cannot see it`,
      );
      assert.ok(
        chunk.includes(`data-menu-command="${ruled.command}"`),
        `${ruled.id}'s menu names a command other than the one its control runs`,
      );
    }
  });

  it('draws each fixed menu\'s choices as the values that operation\'s own set declares', () => {
    // 🔴 THIS IS ONE OF THREE DELIBERATELY OVERLAPPING CLAUSES, AND NONE OF THEM
    // IS REDUNDANT. Each is blind to something the other two see, so the reasons
    // are written here rather than left for a reader to reconstruct — an
    // unrecorded near-duplicate is indistinguishable from an accident.
    //
    //   - MENUS_RULED, written out literally, pins what a reader is offered and
    //     what each choice composes. A declared set edited without the words
    //     here being changed to match fails against it, which is what makes an
    //     edit to one of those sets a decision somebody reviewed. What it cannot
    //     judge is where those words came from.
    //   - THIS clause holds the drawn document against the set the operation
    //     declares, in order — so a choice dropped, reordered, or spelled
    //     differently from its own set fails here even though the literal list
    //     was updated to match. It reads the same set the composition reads, and
    //     is therefore blind to a value changed INSIDE that set: both sides move
    //     together and the comparison still agrees. That is exactly what the
    //     literal list covers.
    //   - the clause below moves the set and requires the menu to follow, which
    //     is what refuses an option list hand-written to agree with its set.
    //     Neither clause above can: such a list draws byte-identical markup,
    //     measured, so there is nothing in the document for them to see.
    //
    // 🔴 UNIFYING ANY TWO OF THEM, OR DELETING ANY ONE, RESTORES ONE OF THOSE
    // BLINDNESSES. The duplication is the mechanism here, not an oversight.
    //
    // The pairs below are the FIXED menus and the set each one reads. The
    // fetched menus are deliberately absent and cannot be covered: their choices
    // are held by the compiler — the workspace's own entities for two of them,
    // and the kinds an author may write a document of for the third — so this
    // side declares no set for them to be compared against. That is a bound on
    // what is provable rather than an omission, and the partition asserted first
    // is what keeps it from widening silently: a menu that stops being fetched
    // arrives here needing a declared set, and one added as fetched cannot be
    // quietly covered by nothing.
    const declared: Array<{ id: OperationId; values: readonly string[] }> = [
      { id: 'cache', values: CACHE_OPERATIONS.map((operation) => operation.value) },
    ];
    assert.deepStrictEqual(
      declared.map((pair) => pair.id),
      MENUS_RULED.filter((menu) => menu.waiting === '').map((menu) => menu.id),
      'a fixed menu is held against no declared set, or a set is named for a menu whose choices the compiler holds',
    );
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    for (const pair of declared) {
      // IN ORDER as well as by membership: a menu offering the right choices in
      // a different sequence is a different surface, and the order a reader
      // meets them in is the one the declared set states.
      assert.deepStrictEqual(
        optionsIn(menuChunkFor(html, pair.id)), pair.values,
        `${pair.id} composes something other than the values its own set declares, so its menu is no longer derived from that set`,
      );
      // A negative control on that comparison: the declared set is not empty, so
      // the agreement above is an agreement about real values rather than two
      // empty lists matching each other.
      assert.ok(
        pair.values.length > 0,
        `the set behind ${pair.id} declares nothing, so the comparison above measures nothing`,
      );
    }
  });

  it('offers a new choice as soon as the operation\'s own set declares one', () => {
    // 🔴 THIS IS THE ONLY CLAUSE HERE THAT CAN REFUSE AN OPTION LIST WRITTEN OUT
    // BY HAND TO AGREE WITH THE DECLARED SET, and the reason it takes this shape
    // is worth stating, because it is not obvious. Such a list composes markup
    // that is BYTE-IDENTICAL to the derivation's — measured — so no assertion
    // over the drawn document can tell the two apart, however it is written. The
    // property that separates them is not what the menu holds today; it is what
    // the menu DOES when the set moves.
    //
    // So this clause moves the set and requires the menu to follow. A menu
    // composes its fixed choices once, as its description is first loaded, so
    // the set is changed and that description is re-read — which is what makes
    // the observation a fresh derivation rather than the one already in hand.
    // It reads the description rather than the drawn document, so it disturbs
    // nothing the clauses around it measure.
    //
    // It answers the question the other two cannot: the day an operation's set
    // declares one more value, is a reader offered it?
    //
    // The fetched menus are absent for the same reason they are absent above —
    // there is no set on this side to move, because the compiler is what holds
    // their choices.
    const description = '../../src/operation-menus';
    // reload re-reads the menu description against the sets AS THEY NOW STAND.
    const reload = (): typeof import('../../src/operation-menus') => {
      delete require.cache[require.resolve(description)];
      return require(description);
    };
    // offered reports the values one menu composes, from a freshly re-read
    // description.
    const offered = (id: OperationId): string[] => {
      const menu = reload().OPERATION_MENUS[id];
      assert.ok(
        menu !== undefined && menu.kind === 'fixed',
        `${id} no longer holds a menu whose choices this side declares`,
      );
      return menu.options.map((option) => option.value);
    };
    // Each probe grows one operation's own set by one value and puts it back.
    //
    // It appends a value the set ALREADY declares rather than inventing one:
    // inventing would put a word in this file that the product does not have,
    // and the question here is whether the menu follows its set at all rather
    // than what the next value happens to be called.
    const probes: Array<{
      id: OperationId;
      declared: () => string[];
      grow: () => void;
      putBack: () => void;
    }> = [
      {
        id: 'cache',
        declared: () => CACHE_OPERATIONS.map((operation) => operation.value),
        grow: () => { CACHE_OPERATIONS.push({ ...CACHE_OPERATIONS[0] }); },
        putBack: () => { CACHE_OPERATIONS.pop(); },
      },
    ];
    assert.deepStrictEqual(
      probes.map((probe) => probe.id),
      MENUS_RULED.filter((menu) => menu.waiting === '').map((menu) => menu.id),
      'a menu whose choices this side declares is never moved, so nothing here holds it to its set',
    );
    for (const probe of probes) {
      const pristine = probe.declared();
      probe.grow();
      try {
        const grown = probe.declared();
        // A self-check on the probe: a probe that moved nothing would leave the
        // comparison below trivially true.
        assert.strictEqual(
          grown.length, pristine.length + 1,
          `the probe on ${probe.id} did not grow that operation's set, so the clause below measures nothing`,
        );
        assert.deepStrictEqual(
          offered(probe.id), grown,
          `${probe.id} withheld a value its own set declares, so what it offers is a list that agrees with that set rather than one read from it`,
        );
      } finally {
        probe.putBack();
      }
      // The set is back and the description re-read from it, so this clause
      // leaves nothing behind for anything after it to measure.
      assert.deepStrictEqual(
        probe.declared(), pristine,
        `the set behind ${probe.id} was not put back`,
      );
      assert.deepStrictEqual(
        offered(probe.id), pristine,
        `${probe.id} was left describing a set this clause moved`,
      );
    }
  });

  it('composes every choice as a native menu item that holds no tab stop', () => {
    // Activation on Enter and on Space comes from the platform for a button and
    // from nowhere for an element dressed as one. And a menu must not add a
    // second tab stop to a panel that costs exactly one: a menu is reached by
    // pressing the control that opens it, so every choice is out of the tab
    // order and focus is moved onto it deliberately.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    const options = tagsOf(html).filter((tag) => tag.includes('class="op-menu-option"'));
    assert.strictEqual(options.length, MENU_OPTIONS_DRAWN, 'a choice is not drawn as a control');
    for (const tag of options) {
      assert.ok(tag.includes('type="button"'), 'a choice would submit rather than act');
      assert.ok(tag.includes('role="menuitem"'), 'a choice is not reported as one');
      assert.ok(tag.includes('tabindex="-1"'), 'a choice adds a second tab stop to the panel');
      assert.ok(
        !tag.includes('data-command='),
        'a choice carries a command of its own, so it is a second route to the operation rather than an answer to it',
      );
      assert.ok(
        !tag.includes('data-focus-key='),
        'a choice would be walked by the panel\'s own roving stop',
      );
    }
    // A negative control on the loop: the operation controls DO carry a command
    // and a focus key, so the two absences above measure the choices rather
    // than an attribute nothing in the document has.
    const opTags = tagsOf(html).filter((tag) => tag.includes('class="op"'));
    assert.ok(
      opTags.every((tag) => tag.includes('data-command=') && tag.includes('data-focus-key=')),
      'an operation control carries no command or no focus key, so the absences above prove nothing',
    );
  });

  it('opens a fetched menu SAYING IT IS READING, and never as an empty list', () => {
    // 🔴 This is the clause the two fetched controls exist to satisfy. A menu
    // that opened empty while the workspace was being read would be worse than
    // the chooser it replaces: emptiness reads as "there is nothing" rather
    // than as "wait", and a reader acts on that reading.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    for (const ruled of MENUS_RULED) {
      const chunk = menuChunkFor(html, ruled.id);
      const fetched = ruled.waiting !== '';
      assert.strictEqual(
        chunk.includes('data-menu-fetched'), fetched,
        `${ruled.id} is drawn as ${fetched ? 'a fixed' : 'a fetched'} menu`,
      );
      if (!fetched) {
        // A fixed menu has nothing to wait for, so its line says nothing and is
        // hidden — a choice announced with no text is worse than no choice.
        assert.ok(
          chunk.includes('data-menu-status hidden>'),
          `${ruled.id} draws a waiting line it has nothing to wait for`,
        );
        continue;
      }
      assert.strictEqual(
        optionsIn(chunk).length, 0,
        `${ruled.id} composes choices the workspace has not been asked for yet`,
      );
      assert.ok(
        chunk.includes(`aria-live="polite" data-menu-status>${ruled.waiting}</div>`),
        `${ruled.id} does not say it is reading, or says it where nothing announces it`,
      );
      assert.ok(
        chunk.includes(`data-menu-pending="${ruled.waiting}"`),
        `${ruled.id} carries no waiting line to return to, so re-opening it would show a stale answer`,
      );
    }
  });

  it('leaves a closed menu out of the accessibility tree entirely', () => {
    // Hidden rather than merely unpainted, so a closed menu is not content a
    // reader can reach but not see — the same treatment a closed section gets.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /<div class="op-menu[^"]*" id="menu-[a-zA-Z-]+" role="menu" aria-label="[^"]*" hidden /),
      MENUS_RULED.length + DIALS_RULED.length,
      'a menu is drawn open, or is closed by something other than leaving the tree',
    );
  });

  it('offers no menu at all on a control that cannot run', () => {
    // A disabled control cannot be pressed, so a menu composed for one would be
    // a choice the reader can never reach — and the document would carry an
    // offer nothing can accept. The control disabled here is the menu-bearing
    // one the panel CAN disable, so this measures the rule rather than an empty
    // case; a menu-bearing control nothing the panel reads can disable could not
    // establish it.
    const html = operationsBodyHtml(body({
      unavailable: {
        push: NO_RELEASE_SELECTED_CONTROL_REASON,
      },
    }));
    assert.deepStrictEqual(
      menuIdsIn(html),
      MENU_IDS_IN_ORDER.filter((id) => id !== 'push'),
      'a menu is composed for a control that cannot open it, or one is lost from a control that can',
    );
    // And the disabled control no longer claims to open one, which is the half
    // that would otherwise leave a reference pointing at nothing.
    for (const tag of tagsOf(html).filter((t) => t.includes(' disabled'))) {
      assert.ok(
        !tag.includes('aria-haspopup'),
        'a control that cannot run still announces a menu',
      );
    }
  });

  it('withdraws the caret AND its adjustments from a button that cannot run', () => {
    // 🔴 THE SAME RULE AS ABOVE, ASSERTED FOR THE OTHER KIND OF MENU, and it is
    // not covered by that clause: the button whose adjustments these are is one
    // the panel CAN disable, so the case is reachable rather than theoretical.
    // Adjustments to a press a reader cannot make are settings for a build that
    // cannot start — and a caret left standing beside a disabled button would
    // let them be turned, with the panel remembering a setting nothing will
    // carry.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({
        layout,
        unavailable: { build: NO_RELEASE_SELECTED_CONTROL_REASON },
      }));
      for (const ruled of DIALS_RULED) {
        assert.strictEqual(
          caretTagOf(html, ruled.holder), undefined,
          `the ${layout} shape still draws a caret beside ${ruled.holder}, which cannot run`,
        );
      }
      assert.deepStrictEqual(
        menuIdsIn(html),
        MENU_IDS_IN_ORDER.filter((id) => !DIALS_RULED.some((d) => d.control === id)),
        `the ${layout} shape holds an adjustment menu no control can open`,
      );
      // And the caret is not merely disabled in place: it is gone, so the walk
      // cannot stop on it. A disabled control cannot take focus, so a stop
      // placed on one would be a stop the reader can never reach.
      assert.strictEqual(
        occurrences(html, /class="op-caret"/), 0,
        `the ${layout} shape left the caret in place rather than withdrawing it`,
      );
    }
    // A negative control on all three: with the button available every one of
    // them IS drawn, so the absences above measure the rule rather than a
    // document that never carried a caret.
    const available = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(available, /class="op-caret"/),
      DIALS_RULED.length,
      'no caret is drawn when the button can run, so the withdrawal above proves nothing',
    );
  });

  it('draws the menus OUTSIDE the flow, so the flow still holds only its buttons', () => {
    // The flow is one continuous sequence with nothing between one button and
    // the next, and that absence is asserted as a residue. A menu among the
    // buttons would be exactly the something the flow must not draw — and it
    // would be a flow item, so it would push the buttons around as it opened.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      betweenTheButtonsOf(html), '',
      'a menu was composed among the flow\'s own buttons',
    );
    const flowAt = html.indexOf('<div class="groups ops-flow"');
    const layerAt = html.indexOf('<div class="op-menus">');
    assert.notStrictEqual(layerAt, -1, 'the document draws no menu layer at all');
    assert.ok(flowAt < layerAt, 'the menu layer is drawn before the flow it belongs to');
    // A negative control on the residue: the flow really does hold every
    // button, so the empty result above measures what sits between them.
    assert.strictEqual(
      occurrences(flowOf(html), /class="op"/),
      commandsPanelOperations().length,
      'the flow holds a number of buttons other than all of them',
    );
  });

  it('leaves every control that gained NO menu exactly as it was', () => {
    // 🔴 CLAUSE-BY-CLAUSE ENUMERATION, because a partial conversion that
    // silently changed a neighbour is the failure mode here. Every control not
    // in the ruled set must announce no menu, reference no menu, and report no
    // expansion state — and the list is written out so a control quietly
    // gaining one is a diff in this file.
    const unchanged: OperationId[] = [
      'validate', 'lint', 'build', 'preview', 'graph',
      'pull',
      'import',
      'sign', 'deprecate',
      'configShow',
    ];
    // The two lists together are the whole surface, which is what makes the
    // enumeration exhaustive rather than a sample.
    assert.strictEqual(
      unchanged.length + MENUS_RULED.length,
      commandsPanelOperations().length,
      'the two lists do not account for every operation, so this proves nothing about the rest',
    );
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const id of unchanged) {
        const command = commandIdFor(
          commandsPanelOperations().find((op) => op.id === id) as never,
        );
        const tag = tagsOf(html).find((t) => t.includes(`data-command="${command}"`));
        assert.ok(tag !== undefined, `${id} is not drawn at all in the ${layout} shape`);
        assert.ok(
          !tag.includes('aria-haspopup'),
          `${id} announces a menu in the ${layout} shape, and it is ruled to have none`,
        );
        assert.ok(
          !tag.includes('aria-controls="menu-'),
          `${id} references a menu in the ${layout} shape`,
        );
        assert.ok(
          !tag.includes('aria-expanded'),
          `${id} reports an expansion state in the ${layout} shape`,
        );
        assert.ok(
          !tag.includes('data-menu='),
          `${id} is marked as opening a menu in the ${layout} shape`,
        );
      }
    }
    // 🔴 A NEGATIVE CONTROL ON THE WHOLE CLAUSE. The absences above are read
    // with the same instrument that finds the attribute where it IS present,
    // established here against a control ruled to carry one — so a zero above
    // measures the control rather than a search that never matches.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    const cacheTag = tagsOf(html).find((t) => t.includes('data-command="aggrega.op.cache"'));
    assert.ok(cacheTag !== undefined, 'the control the control-case rests on is not drawn');
    assert.ok(
      cacheTag.includes('aria-haspopup') && cacheTag.includes('aria-controls="menu-cache"'),
      'the instrument cannot see a menu on a control that carries one, so its zeros mean nothing',
    );
  });
});

describe('a button whose next press can be adjusted', () => {
  it('🔴 KEEPS ITS OWN PRESS: the button offers no menu, so pressing it runs', () => {
    // 🔴 THE CLAUSE THE WHOLE ARRANGEMENT EXISTS FOR. The panel's script answers
    // a press on a control carrying a menu by OPENING that menu instead of
    // running the command — so adjustments hung off the Build button would take
    // the press away, and a reader pressing Build would get a list rather than a
    // build. The adjustments therefore sit on a control of their own and the
    // button is left exactly as it was.
    //
    // Asserted against the button's own tag in both shapes, by every attribute
    // the script or the platform would read to divert a press.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const ruled of DIALS_RULED) {
        const command = commandIdFor(
          commandsPanelOperations().find((op) => op.id === ruled.holder) as never,
        );
        const tag = tagsOf(html).find((t) => t.includes(`data-command="${command}"`));
        assert.ok(tag !== undefined, `${ruled.holder} is not drawn at all in the ${layout} shape`);
        assert.ok(
          !tag.includes('data-menu='),
          `${ruled.holder} is marked as opening a menu, so pressing it would open one instead of running`,
        );
        assert.ok(
          !tag.includes('aria-haspopup'),
          `${ruled.holder} announces a menu, so a reader is told the button asks rather than acts`,
        );
        assert.ok(
          !tag.includes('aria-expanded'),
          `${ruled.holder} reports an expansion state, which a button that runs has none of`,
        );
        assert.ok(
          !tag.includes('aria-controls='),
          `${ruled.holder} points at a region of its own`,
        );
      }
    }
  });

  it('draws the caret immediately after its own button, in both shapes', () => {
    // Adjacency is what makes the caret read as belonging to the button rather
    // than as another operation. It is asserted as adjacency in the DOCUMENT —
    // nothing between the two but whitespace — because the flow wraps at
    // whatever width the reader drags the panel to, and a caret with another
    // control between it and its button could wrap onto a line under a button
    // that is not its own. Adjacency alone does not keep the two on one line,
    // though: a wrapping row may end a line between any two of its items, which
    // is why they are drawn as one unit — the clause below.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const ruled of DIALS_RULED) {
        const command = commandIdFor(
          commandsPanelOperations().find((op) => op.id === ruled.holder) as never,
        );
        const buttonEnd = html.indexOf('</button>', html.indexOf(`data-command="${command}"`));
        assert.notStrictEqual(buttonEnd, -1, `${ruled.holder} is not drawn as a control`);
        const after = html.slice(buttonEnd + '</button>'.length);
        assert.strictEqual(
          after.trimStart().startsWith(`<button class="op-caret"`), true,
          `the ${layout} shape draws something between ${ruled.holder} and its caret`,
        );
      }
    }
  });

  it('🔴 holds each button and its caret in ONE unit, and draws no unit around anything else', () => {
    // The flow is a wrapping row, and a wrapping row may end a line between ANY
    // two of its items. A caret drawn as an item of its own beside its button is
    // therefore parted from it at some width — the button ends one line and the
    // caret starts the next, alone, reading as belonging to whatever sits beside
    // it. So the two are drawn as one item, and the flow moves them together.
    //
    // Asserted as an EQUALITY over everything each container holds directly, in
    // both shapes, against the literal list of adjustable operations rather than
    // the description the composer reads: every one of them is a unit holding
    // its button and then its caret and nothing else, and every other operation
    // is its button alone. A unit missing, a caret left outside its unit, a
    // third thing inside one, and a unit around an operation that has no caret
    // each change the comparison.
    const flow = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.deepStrictEqual(
      flowEntriesOf(flow), entriesExpected(commandsPanelOperations()),
      'the flow does not hold each adjustable button and its caret as one unit, and every other button alone',
    );
    const sections = operationsBodyHtml(body({ layout: 'sections' }));
    assert.deepStrictEqual(
      sectionEntriesOf(sections),
      OPERATION_GROUPS.map((group) => entriesExpected(group.operations)),
      'a section does not hold each adjustable button and its caret as one unit, and every other button alone',
    );
    // THE UNIT IS A CLASS AND NOTHING ELSE — no role, no name, no tab index and
    // no focus key — so a reader is told nothing about it and cannot stop on it,
    // and the walk, the names and the presses stay the two controls' own. Read
    // off every element carrying the class, so a unit drawn under a different
    // opening tag is counted here rather than missed.
    for (const html of [flow, sections]) {
      assert.deepStrictEqual(
        Array.from(html.matchAll(new RegExp(`<[a-z]+ [^>]*\\b${PAIR_CLASS}\\b[^>]*>`, 'g'))).map((m) => m[0]),
        DIALS_RULED.map(() => PAIR_OPENING),
        'the unit carries something besides its class, or is drawn other than once per adjustable button',
      );
    }
    // A negative control on the comparison: the expectation holds units AND bare
    // buttons, so the equalities above are not between two lists of one kind.
    const expected = entriesExpected(commandsPanelOperations());
    assert.strictEqual(
      expected.filter((entry) => entry.startsWith('pair(')).length, DIALS_RULED.length,
      'the expectation holds no unit, so the comparison cannot see one missing',
    );
    assert.strictEqual(
      expected.filter((entry) => entry.startsWith('op:')).length,
      commandsPanelOperations().length - DIALS_RULED.length,
      'the expectation holds no bare button, so the comparison cannot see a unit drawn around one',
    );
  });

  it('draws a button that cannot run as its button alone, with no unit around it', () => {
    // The caret is withdrawn from a button that cannot run, so there is no pair
    // left to hold together — and a unit drawn around the button by itself would
    // be an element the reader's panel carries for nothing. It is drawn exactly as
    // a button that has no adjustments is.
    const cannotRun = DIALS_RULED.map((ruled) => ruled.holder);
    const unavailable: Partial<Record<OperationId, string | null>> = {};
    for (const holder of cannotRun) { unavailable[holder] = NO_RELEASE_SELECTED_CONTROL_REASON; }
    const flow = operationsBodyHtml(body({ layout: 'buttons', unavailable }));
    assert.deepStrictEqual(
      flowEntriesOf(flow), entriesExpected(commandsPanelOperations(), cannotRun),
      'the flow draws a unit around a button that cannot run, or no longer holds that button directly',
    );
    const sections = operationsBodyHtml(body({ layout: 'sections', unavailable }));
    assert.deepStrictEqual(
      sectionEntriesOf(sections),
      OPERATION_GROUPS.map((group) => entriesExpected(group.operations, cannotRun)),
      'a section draws a unit around a button that cannot run, or no longer holds that button directly',
    );
    for (const html of [flow, sections]) {
      assert.strictEqual(
        occurrences(html, new RegExp(`\\b${PAIR_CLASS}\\b`)), 0,
        'a unit is drawn although no button beside a caret can run',
      );
    }
  });

  it('keeps the unit on one line in the stylesheet the panel loads, spaced as any two controls are', () => {
    // The markup makes the pair ONE item of the flow; what holds that item's two
    // controls on one line is the stylesheet, where the wrapping is decided — so
    // it is read from the file the document links, each declaration exactly, by
    // selector and by property.
    const css = operationsCss();
    const flow = cssRuleBody(css, '.ops-flow');
    const unit = cssRuleBody(css, `.ops-flow .${PAIR_CLASS}`);
    assert.ok(flow !== null, 'the stylesheet lays out no flow');
    assert.ok(unit !== null, 'the stylesheet lays out no unit inside the flow, so the pair is drawn as two items');
    // A negative control: the flow itself wraps, so what the unit declares is
    // what keeps the pair together rather than a flow that never wraps at all.
    assert.strictEqual(declarationOf(flow, 'flex-wrap'), 'wrap', 'the flow does not wrap, so nothing here is tested');
    assert.strictEqual(declarationOf(unit, 'display'), 'inline-flex', 'the unit does not lay its two controls out in a row');
    assert.strictEqual(declarationOf(unit, 'flex-wrap'), 'nowrap', 'the unit lets its own two controls wrap apart');
    assert.strictEqual(
      declarationOf(unit, 'flex'), '0 0 auto',
      'the unit can grow or shrink, so a narrow line squeezes the pair instead of moving it whole',
    );
    // Spaced by the flow's own gap and drawing nothing of its own, so the caret
    // sits exactly as far from its button as any control sits from the next.
    assert.notStrictEqual(declarationOf(flow, 'gap'), null, 'the flow declares no gap to compare against');
    assert.strictEqual(
      declarationOf(unit, 'gap'), declarationOf(flow, 'gap'),
      'the caret sits a different distance from its button than any control sits from the next',
    );
    for (const property of ['padding', 'margin', 'border', 'background']) {
      assert.strictEqual(
        declarationOf(unit, property), null,
        `the unit declares a ${property} of its own, so the pair no longer looks like the two controls side by side`,
      );
    }
    // In the section shape the unit is a plain block, so the caret stays the
    // full-width row beneath its button.
    const rows = cssRuleBody(css, `.groups-sections .${PAIR_CLASS}`);
    assert.ok(rows !== null, 'the stylesheet does not lay out the unit in the section shape');
    assert.strictEqual(
      declarationOf(rows, 'display'), 'block',
      'the section shape does not keep the caret as the full-width row beneath its button',
    );
  });

  it('gives the caret no command, no group, and a place in the roving walk', () => {
    // NO COMMAND: nothing the caret does reaches the compiler, so a command on
    // it would be a second route to an operation it does not run — and the
    // panel's guard admits a press only for a command its own content offers,
    // which a caret has none of.
    //
    // NO GROUP: the caret is an adjunct of one control rather than a member of
    // the operation surface. Stating a group on it would put a non-operation
    // into the surface's own membership, which the membership clause reads off
    // exactly that attribute.
    //
    // A PLACE IN THE WALK: a reader who cannot use a pointer reaches the
    // adjustments with the arrow keys that reach every other control, rather
    // than by a gesture of its own.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const ruled of DIALS_RULED) {
        const caret = caretTagOf(html, ruled.holder);
        assert.ok(caret !== undefined, `no caret is drawn beside ${ruled.holder} in the ${layout} shape`);
        assert.ok(caret.includes('type="button"'), 'the caret would submit rather than act');
        assert.ok(!caret.includes('data-command='), 'the caret carries a command of its own');
        assert.ok(!caret.includes('data-group='), 'the caret claims membership of an operation group');
        assert.ok(
          caret.includes(`data-focus-key="${ruled.control}"`),
          'the caret is outside the roving walk, so the arrow keys cannot reach it',
        );
        assert.ok(
          caret.includes(`aria-controls="menu-${ruled.control}"`),
          'the caret does not name the region it opens',
        );
        assert.ok(
          caret.includes('aria-expanded="false"'),
          'the caret does not report its region closed, so a reader is told neither open nor closed',
        );
        // It draws no word of its own, so it says what it is for a reader who
        // meets it without seeing it — and that name says whose adjustments
        // these are rather than merely that adjustments exist.
        assert.ok(
          caret.includes(`aria-label="${ruled.caretName}"`),
          'the caret carries no name, so a reader who cannot see it is told nothing',
        );
      }
    }
  });

  it('says how many adjustments are on, so one left on is not silently carried', () => {
    // The caret draws no word, so a reader who turned something on and pressed
    // elsewhere has nothing in front of them saying so. The count is put on the
    // name and the hover, which is where a reader can ask for it — a drawn count
    // would spend the flow's width on a fact that is usually zero.
    const ruled = DIALS_RULED[0];
    const off = operationsBodyHtml(body({ layout: 'buttons' }));
    const on = operationsBodyHtml(body({ layout: 'buttons', dials: ruled.values }));
    assert.ok(
      (caretTagOf(off, ruled.holder) ?? '').includes(`aria-label="${ruled.caretName}"`),
      'the caret names a count when nothing is on',
    );
    assert.ok(
      (caretTagOf(on, ruled.holder) ?? '')
        .includes(`aria-label="${ruled.caretName}, ${ruled.values.length} on"`),
      'the caret does not say how many adjustments are on',
    );
  });

  it('draws each adjustment as a setting with a state, never as a choice', () => {
    // 🔴 THE ATTRIBUTE THAT SEPARATES THEM IS ASSERTED AS ABSENT, and the reason
    // is behavioural rather than cosmetic: the panel's script answers a press on
    // `data-option` by CLOSING the menu and running the operation. An adjustment
    // carrying that attribute would therefore run a build the moment a reader
    // turned it, and close the menu before they could turn a second — which is
    // the failure this absence prevents.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    for (const ruled of DIALS_RULED) {
      const chunk = menuChunkFor(html, ruled.control);
      assert.deepStrictEqual(
        dialsIn(chunk), ruled.values,
        `${ruled.control} composes a different set of adjustments, or in a different order`,
      );
      assert.deepStrictEqual(
        optionsIn(chunk), [],
        `${ruled.control} draws an adjustment as a choice, so turning it would run the operation and close the menu`,
      );
      assert.deepStrictEqual(
        optionLabelsIn(chunk), ruled.labels,
        `${ruled.control} reads differently, or reads its adjustments in a different order`,
      );
      assert.ok(
        chunk.includes(`aria-label="${ruled.label}"`),
        `${ruled.control} is not named for a reader who cannot see it`,
      );
      // NO COMMAND ON THE MENU EITHER. A choice reaches its operation because the
      // menu names the command; a settings menu must name none, or a press on a
      // setting would have an operation to run.
      assert.ok(
        !chunk.includes('data-menu-command='),
        `${ruled.control} names a command, so an adjustment would be a route to an operation`,
      );
      const entries = tagsOf(chunk).filter((tag) => tag.includes('class="op-menu-dial"'));
      assert.strictEqual(
        entries.length, ruled.values.length,
        `${ruled.control} draws a number of settings other than the ones it holds`,
      );
      for (const tag of entries) {
        assert.ok(tag.includes('type="button"'), 'an adjustment would submit rather than act');
        assert.ok(
          tag.includes('role="menuitemcheckbox"'),
          'an adjustment is reported as a choice, so nothing announces whether it is on',
        );
        assert.ok(
          tag.includes('tabindex="-1"'),
          'an adjustment adds a second tab stop to the panel',
        );
        assert.ok(
          !tag.includes('data-command='),
          'an adjustment carries a command of its own',
        );
        assert.ok(
          !tag.includes('data-focus-key='),
          'an adjustment would be walked by the panel\'s own roving stop',
        );
      }
    }
  });

  it('reports each adjustment\'s state, and composes the reader\'s own into the first drawing', () => {
    // The state is composed rather than set afterwards, for the same reason the
    // reader's closed sections are: restoring after the document loads always
    // paints the default first, and the frame in between is the flicker. It also
    // means the document is the one home of that state — the panel's script
    // reads it back from here rather than keeping a copy that could start empty
    // in front of a drawing that already said otherwise.
    const ruled = DIALS_RULED[0];
    const off = menuChunkFor(operationsBodyHtml(body()), ruled.control);
    assert.strictEqual(
      occurrences(off, /aria-checked="false"/), ruled.values.length,
      'an adjustment nobody turned does not report itself off',
    );
    assert.strictEqual(
      occurrences(off, /aria-checked="true"/), 0,
      'an adjustment reports itself on before anybody turned it',
    );
    const on = menuChunkFor(operationsBodyHtml(body({ dials: ruled.values })), ruled.control);
    assert.strictEqual(
      occurrences(on, /aria-checked="true"/), ruled.values.length,
      'the reader\'s own adjustment is not composed into the drawing',
    );
    assert.strictEqual(
      occurrences(on, /aria-checked="false"/), 0,
      'an adjustment the reader turned on still reports itself off',
    );
    // A value the panel does not offer is not drawn as an adjustment that is on.
    // A document composed by an earlier version of this extension can record
    // one, and it must not turn something else on by arriving.
    const stray = menuChunkFor(
      operationsBodyHtml(body({ dials: ['somethingWithdrawn'] })),
      ruled.control,
    );
    assert.strictEqual(
      occurrences(stray, /aria-checked="true"/), 0,
      'a recorded value the panel does not offer turned an adjustment on',
    );
  });

  it('draws the adjustments OUTSIDE the flow, so the flow still holds only buttons', () => {
    // The same rule the choice menus follow, and for the same structural reason:
    // the flow draws nothing between one button and the next, and a menu among
    // them would be a flow item that repacked the buttons as it opened. The
    // caret IS in the flow — it is a button — and the menu it opens is not.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      betweenTheButtonsOf(html), '',
      'an adjustment menu was composed among the flow\'s own buttons',
    );
    // A negative control on that residue: the caret really is inside the flow,
    // so the empty result above measures what sits between the buttons rather
    // than a flow the caret never reached.
    assert.strictEqual(
      occurrences(flowOf(html), /class="op-caret"/),
      DIALS_RULED.length,
      'the caret is not in the flow at all, so the residue measures the wrong document',
    );
    for (const ruled of DIALS_RULED) {
      assert.ok(
        html.indexOf('<div class="op-menus">') < html.indexOf(`id="menu-${ruled.control}"`),
        `${ruled.control} is drawn outside the menu layer`,
      );
    }
  });
});

describe('the whole document', () => {
  const document = (over: Partial<OperationsBody> = {}): string => operationsDocumentHtml({
    nonce: 'NONCE',
    styleUri: 'vscode-resource://media/operations.css',
    codiconUri: 'vscode-resource://media/codicon.css',
    scriptUri: 'vscode-resource://media/operations.js',
    cspSource: 'vscode-resource:',
    ...body(over),
  });

  it('admits the icon font, without which every icon on the panel is silently absent', () => {
    // The editor puts no icon font into a document it hosts, and every entry,
    // every row and every control beside a row names an icon. The font ships
    // beside the stylesheet, so the policy has to admit it.
    const html = document();
    assert.ok(html.includes('font-src vscode-resource:'), 'the content policy admits no font');
    assert.ok(html.includes('codicon.css'), 'the stylesheet naming the font is not loaded');
    // Counted from the rows themselves rather than from a number written here:
    // each row draws one icon and each create control beside one draws another,
    // so a row gained or a create control withdrawn moves this total without
    // anyone having to remember to move it too.
    assert.strictEqual(
      occurrences(html, /class="codicon codicon-[a-z-]+"/),
      commandsPanelOperations().length + ROW_CONTROLS + DIALS_RULED.length + DIALS_DRAWN,
      'a control draws no icon, or one is drawn twice',
    );
  });

  it('admits its own script by nonce and nothing else at all', () => {
    const html = document();
    assert.ok(html.includes(`default-src 'none'`), 'the policy admits everything by default');
    assert.ok(html.includes(`script-src 'nonce-NONCE'`), 'the policy admits any script');
    assert.ok(html.includes('<script nonce="NONCE"'), 'the script carries no nonce');
    assert.strictEqual(occurrences(html, /<script/), 1, 'the document loads a second script');
  });

  it('composes the first drawing already in the shape the reader left', () => {
    // Restoring after the document loads always paints the default first, and
    // the frame in between is the flicker. The state is read before the first
    // composition instead.
    const html = document({ layout: 'sections', collapsed: ['author'], focused: 'toggle:config' });
    assert.ok(html.includes('id="sec-author" role="group" hidden'), 'the closed section opened');
    assert.ok(
      html.includes('tabindex="0" data-toggle="config"'),
      'the reader\'s place was not composed into the first drawing',
    );
  });

  it('renders text as text', () => {
    // The rows carry paths and a language server\'s own prose, and neither is
    // this document\'s to interpret.
    const html = document({
      selectors: selectorRows(
        '/work/<script>x</script>',
        '/work/<script>x</script>',
        '/work/<script>x</script>',
        NO_ANSWER_YET,
        SEVERAL,
      ),
    });
    assert.strictEqual(occurrences(html, /<script>x<\/script>/), 0, 'authored text reached the document as markup');
    assert.ok(html.includes('&lt;script&gt;'), 'authored text was dropped rather than escaped');
  });
});
