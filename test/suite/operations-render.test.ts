// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import {
  OPERATION_GROUPS,
  OperationId,
  OperationsLayout,
  allOperations,
  commandIdFor,
} from '../../src/operation-groups';
import {
  OperationsBody,
  operationsBodyHtml,
  operationsDocumentHtml,
} from '../../src/operations-render';
import { NO_RELEASE_SELECTED_CONTROL_REASON } from '../../src/release-selection';
import { selectorRows } from '../../src/selector-rows';

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

function body(over: Partial<OperationsBody> = {}): OperationsBody {
  return {
    layout: 'buttons',
    selectors: selectorRows(ANCHORED, ANCHORED, SELECTED),
    unavailable: {},
    collapsed: [],
    focused: null,
    ...over,
  };
}

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
// operation controls: the two rows naming the panel's subject carry a command
// and a focus key and no group, and they must not be counted as members of one.
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
// document that also carries the two rows above it.
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
function betweenTheButtonsOf(html: string): string {
  return flowOf(html)
    .replace(/^<div\b[^>]*>/, '')
    .replace(/<\/div>[\s\S]*$/, '')
    .replace(/<button\b[\s\S]*?<\/button>/g, '')
    .trim();
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
// The two fetched ones carry NO options: their choices are the workspace's, so
// the composed document cannot hold them, which is the difference this list has
// to be able to see.
// The reader-visible words and the values each choice COMPOSES are separate
// fields, and both are asserted — they differ for the generation control, which
// reads two sentences and composes two one-word selections. Taking a label as
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
  {
    id: 'pluginAdd',
    command: 'aggrega.plugins.add',
    label: 'Type of plugin to add',
    waiting: '',
    values: ['provider', 'governance', 'linter', 'importer'],
    labels: ['provider', 'governance', 'linter', 'importer'],
  },
  {
    id: 'pluginEntities',
    command: 'aggrega.plugins.genCatalog',
    label: 'Plugins to generate an entity for',
    waiting: '',
    values: ['embedded', 'artifact'],
    labels: ['Every plugin built into the compiler', 'One plugin artifact on this machine'],
  },
];

// MENU_OPTIONS_DRAWN is how many choices the document carries when every control
// can run. Stated as a sum of the list above rather than as a number, so it
// cannot drift from the list it counts.
const MENU_OPTIONS_DRAWN = MENUS_RULED.reduce((total, menu) => total + menu.values.length, 0);

// menusOf slices the document into one chunk per menu, in document order.
function menusOf(html: string): string[] {
  return html.split('<div class="op-menu"').slice(1);
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
    // controls, and the spans that are their icons, their labels and their
    // reasons — and nothing else.
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
      allOperations().length,
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
      'Pull', 'Acquire inputs',
      'Draft entity', 'Import', 'Inspect',
      'Push', 'Sign', 'Deprecate',
      'Show config', 'Cache…',
      'Add registry', 'Update index',
      'Search catalog',
      'Add plugin', 'Generate entities',
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
    const marked = allOperations().filter((op) => op.label.endsWith('…')).map((op) => op.id);
    assert.deepStrictEqual(
      marked, ['cache'],
      'an entry that asks for a subject is marked as though it asked which operation',
    );
    // A negative control on the census: the mark is a character this search can
    // actually see, established against the one label that carries it.
    assert.ok(
      allOperations().some((op) => op.label.includes('…')),
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

  it('puts the two rows naming the subject ahead of every group, in both shapes', () => {
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      const rows = html.indexOf('class="selectors"');
      const groups = html.indexOf('class="groups');
      assert.notStrictEqual(rows, -1, 'the two rows are not drawn at all');
      assert.notStrictEqual(groups, -1, 'no group is drawn at all');
      assert.ok(
        rows < groups,
        `the ${layout} shape draws a group before the rows naming what it acts on`,
      );
      // And neither row is inside the operations, which is what makes the rule
      // a property of the document rather than one somebody has to remember.
      // Asserted over everything from the operations onward, so it holds for
      // the flow — which has no per-group box for the loop below to slice.
      assert.strictEqual(
        occurrences(html.slice(groups), /class="selector"/), 0,
        `the ${layout} shape puts a selector row among the operations`,
      );
      for (const chunk of sectionsOf(html)) {
        assert.strictEqual(
          occurrences(chunk, /class="selector"/), 0,
          `the ${layout} shape puts a selector row inside a group`,
        );
      }
    }
  });

  it('keeps both rows in front of a reader who has closed every section', () => {
    // The clause that would fail if either row were inside a group.
    const html = operationsBodyHtml(body({
      layout: 'sections',
      collapsed: OPERATION_GROUPS.map((group) => group.id),
    }));
    for (const row of selectorRows(ANCHORED, ANCHORED, SELECTED)) {
      assert.ok(
        html.includes(`data-focus-key="${row.key}"`),
        `the ${row.label} row is gone once every section is closed`,
      );
      assert.ok(html.includes(row.value), `the ${row.label} row shows no value`);
    }
    // A negative control: with every section closed, no operation is reachable,
    // so the two rows above are the only controls left. If an operation were
    // still drawn as visible content the assertion would be measuring the wrong
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
    const rows = selectorRows('/work/demo', '/work/demo/services/api', SELECTED);
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
    for (let at = 0; at < rows.length; at += 1) {
      assert.ok(drawn[at].includes(rows[at].label), `the ${rows[at].key} row draws no name`);
      assert.ok(drawn[at].includes(rows[at].value), `the ${rows[at].key} row draws no value`);
    }
    assert.ok(
      !drawn[0].includes('/work/demo/services/api'),
      'the workspace row still draws the open folder rather than leaving it to the hover',
    );
    assert.ok(
      !drawn[0].includes('Aggrega workspace: /work/demo'),
      'the workspace row still draws the anchored path rather than leaving it to the hover',
    );

    // And every line of it is on the hover, whole and unfiltered — including
    // the open folder, which is the fact that only exists when the two differ.
    // A row that dropped a line would have moved the detail nowhere rather
    // than onto the hover.
    const hovers = Array.from(html.matchAll(/<button class="selector"[^>]*title="([^"]*)"/gs))
      .map((m) => m[1]);
    assert.strictEqual(hovers.length, rows.length, 'a row carries no hover at all');
    assert.ok(
      hovers[0].includes('/work/demo/services/api'),
      'the open folder reaches neither the row nor its hover',
    );
    for (const line of rows[0].tooltip.split('\n')) {
      assert.ok(
        hovers[0].includes(line),
        `the hover drops the line ${JSON.stringify(line)}`,
      );
    }
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
      1 + MENUS_RULED.length,
      'something other than the closed section and the menus reports itself closed',
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
        allOperations().length + 2,
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
        allOperations().length
        + 2
        + MENU_OPTIONS_DRAWN
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
      allOperations().length,
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
      opTags.length, allOperations().length,
      'the flow draws a number of operation controls other than all of them',
    );
    assert.strictEqual(
      opTags.filter((tag) => tag.includes('tabindex="-1"')).length,
      allOperations().length - 1,
      'a control in the flow is outside the roving stop\'s reach',
    );
    // 🔴 AND NOTHING ELSE IN THE DOCUMENT IS OUTSIDE ONE OR THE OTHER. This is
    // the clause that keeps the narrowing above from being a weakening: every
    // stop-less control is either an operation the roving stop passes over or a
    // menu choice, and a third kind arriving fails here.
    assert.strictEqual(
      occurrences(html, /tabindex="-1"/),
      allOperations().length - 1 + MENU_OPTIONS_DRAWN,
      'something other than the flow\'s controls and the menu choices carries no tab stop',
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
    // that reports an expansion state it has no business having: a toggle, or a
    // control that opens a menu, and nothing else.
    assert.strictEqual(
      occurrences(html, /aria-expanded=/),
      OPERATION_GROUPS.length + MENUS_RULED.length,
      'something that neither opens a section nor opens a menu reports an expansion state',
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
      allOperations().length,
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
        Array.from(html.matchAll(/<div class="op-menu" id="menu-([a-zA-Z]+)"/g)).map((m) => m[1]),
        MENUS_RULED.map((menu) => menu.id),
        `the ${layout} shape draws a different set of menus, or draws them in a different order`,
      );
      // And no OTHER control claims to open one. This is the half that catches a
      // menu reference added to a control the layer holds no menu for — which
      // would be a control announcing a choice that does not exist.
      assert.deepStrictEqual(
        Array.from(html.matchAll(/aria-haspopup="menu" aria-expanded="false" aria-controls="menu-([a-zA-Z]+)"/g))
          .map((m) => m[1])
          .sort(),
        MENUS_RULED.map((menu) => menu.id).sort(),
        `the ${layout} shape has a control claiming a menu that is not there, or a menu no control opens`,
      );
    }
  });

  it('draws each menu\'s choices, by what they compose and by what they read', () => {
    const chunks = menusOf(operationsBodyHtml(body({ layout: 'buttons' })));
    assert.strictEqual(chunks.length, MENUS_RULED.length, 'the document draws a different number of menus');
    for (let at = 0; at < MENUS_RULED.length; at += 1) {
      const ruled = MENUS_RULED[at];
      assert.deepStrictEqual(
        optionsIn(chunks[at]), ruled.values,
        `${ruled.id} composes a different selection, or composes them in a different order`,
      );
      assert.deepStrictEqual(
        optionLabelsIn(chunks[at]), ruled.labels,
        `${ruled.id} reads differently, or reads its choices in a different order`,
      );
      assert.ok(
        chunks[at].includes(`aria-label="${ruled.label}"`),
        `${ruled.id}'s menu is not named ${JSON.stringify(ruled.label)} for a reader who cannot see it`,
      );
      assert.ok(
        chunks[at].includes(`data-menu-command="${ruled.command}"`),
        `${ruled.id}'s menu names a command other than the one its control runs`,
      );
    }
    // 🔴 THE ONE MENU WHOSE WORDS AND VALUES DIFFER, ASSERTED AS DIFFERING. It
    // is the clause that makes the two comparisons above two comparisons: if a
    // later change made every label its own value, the pair would still pass
    // while having stopped distinguishing anything.
    const differ = MENUS_RULED.filter(
      (menu) => menu.values.length > 0
        && JSON.stringify(menu.values) !== JSON.stringify(menu.labels),
    ).map((menu) => menu.id);
    assert.deepStrictEqual(
      differ, ['pluginEntities'],
      'no menu reads differently from what it composes, so the two comparisons measure one thing',
    );
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
    const chunks = menusOf(operationsBodyHtml(body({ layout: 'buttons' })));
    for (let at = 0; at < MENUS_RULED.length; at += 1) {
      const ruled = MENUS_RULED[at];
      const fetched = ruled.waiting !== '';
      assert.strictEqual(
        chunks[at].includes('data-menu-fetched'), fetched,
        `${ruled.id} is drawn as ${fetched ? 'a fixed' : 'a fetched'} menu`,
      );
      if (!fetched) {
        // A fixed menu has nothing to wait for, so its line says nothing and is
        // hidden — a choice announced with no text is worse than no choice.
        assert.ok(
          chunks[at].includes('data-menu-status hidden>'),
          `${ruled.id} draws a waiting line it has nothing to wait for`,
        );
        continue;
      }
      assert.strictEqual(
        optionsIn(chunks[at]).length, 0,
        `${ruled.id} composes choices the workspace has not been asked for yet`,
      );
      assert.ok(
        chunks[at].includes(`aria-live="polite" data-menu-status>${ruled.waiting}</div>`),
        `${ruled.id} does not say it is reading, or says it where nothing announces it`,
      );
      assert.ok(
        chunks[at].includes(`data-menu-pending="${ruled.waiting}"`),
        `${ruled.id} carries no waiting line to return to, so re-opening it would show a stale answer`,
      );
    }
  });

  it('leaves a closed menu out of the accessibility tree entirely', () => {
    // Hidden rather than merely unpainted, so a closed menu is not content a
    // reader can reach but not see — the same treatment a closed section gets.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /<div class="op-menu" id="menu-[a-zA-Z]+" role="menu" aria-label="[^"]*" hidden /),
      MENUS_RULED.length,
      'a menu is drawn open, or is closed by something other than leaving the tree',
    );
  });

  it('offers no menu at all on a control that cannot run', () => {
    // A disabled control cannot be pressed, so a menu composed for one would be
    // a choice the reader can never reach — and the document would carry an
    // offer nothing can accept. The two menu-bearing controls that CAN be
    // disabled are used, so this measures the rule rather than an empty case.
    const html = operationsBodyHtml(body({
      unavailable: {
        push: NO_RELEASE_SELECTED_CONTROL_REASON,
        pluginAdd: NO_RELEASE_SELECTED_CONTROL_REASON,
      },
    }));
    assert.deepStrictEqual(
      Array.from(html.matchAll(/<div class="op-menu" id="menu-([a-zA-Z]+)"/g)).map((m) => m[1]),
      MENUS_RULED.filter((menu) => menu.id !== 'push' && menu.id !== 'pluginAdd').map((menu) => menu.id),
      'a menu is composed for a control that cannot open it, or one is lost from a control that can',
    );
    // And neither disabled control still claims to open one, which is the half
    // that would otherwise leave a reference pointing at nothing.
    for (const tag of tagsOf(html).filter((t) => t.includes(' disabled'))) {
      assert.ok(
        !tag.includes('aria-haspopup'),
        'a control that cannot run still announces a menu',
      );
    }
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
      allOperations().length,
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
      'pull', 'acquire',
      'scaffold', 'import',
      'sign', 'deprecate',
      'configShow',
      'registryAdd', 'registryIndex',
      'catalogSearch',
    ];
    // The two lists together are the whole surface, which is what makes the
    // enumeration exhaustive rather than a sample.
    assert.strictEqual(
      unchanged.length + MENUS_RULED.length,
      allOperations().length,
      'the two lists do not account for every operation, so this proves nothing about the rest',
    );
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const id of unchanged) {
        const command = commandIdFor(
          allOperations().find((op) => op.id === id) as never,
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
    // The editor puts no icon font into a document it hosts, and every entry
    // and both rows name an icon. The font ships beside the stylesheet, so the
    // policy has to admit it.
    const html = document();
    assert.ok(html.includes('font-src vscode-resource:'), 'the content policy admits no font');
    assert.ok(html.includes('codicon.css'), 'the stylesheet naming the font is not loaded');
    assert.strictEqual(
      occurrences(html, /class="codicon codicon-[a-z-]+"/),
      allOperations().length + 2,
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
      selectors: selectorRows('/work/<script>x</script>', '/work/<script>x</script>', NO_ANSWER_YET),
    });
    assert.strictEqual(occurrences(html, /<script>x<\/script>/), 0, 'authored text reached the document as markup');
    assert.ok(html.includes('&lt;script&gt;'), 'authored text was dropped rather than escaped');
  });
});
