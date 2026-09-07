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

const BOTH: OperationsLayout[] = ['buttons', 'sections'];

describe('the Operations panel document', () => {
  it('draws one row of buttons per group, and as many rows as there are groups', () => {
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /class="group-row"/),
      OPERATION_GROUPS.length,
      'a group without its own row is a group whose buttons joined another one',
    );
    for (const chunk of sectionsOf(html)) {
      assert.strictEqual(
        occurrences(chunk, /class="group-row"/), 1,
        'a group draws one row, so its buttons sit on one line and wrap together',
      );
    }
  });

  it('carries the same groups, the same membership and the same order in both shapes', () => {
    // The shape decides how a group is drawn, never what is in it or what order
    // they come in — which a finished decision settled and this document does
    // not revisit.
    const expected = OPERATION_GROUPS.map((group) => group.operations.map(commandIdFor));
    for (const layout of BOTH) {
      const drawn = sectionsOf(operationsBodyHtml(body({ layout }))).map(commandsIn);
      assert.deepStrictEqual(
        drawn, expected,
        `the ${layout} shape draws different groups, membership or order`,
      );
    }
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
      // And neither row is inside a group, which is what makes the rule a
      // property of the document rather than one somebody has to remember.
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

  it('draws the workspace explanation inside the row rather than only on hover', () => {
    // The explanation names the anchored folder and, when they differ, the
    // folder that was opened. It is load-bearing and multi-line, and a reader
    // should not have to hover to learn which folder the offered Releases come
    // from.
    const rows = selectorRows('/work/demo', '/work/demo/services/api', SELECTED);
    const html = operationsBodyHtml(body({ selectors: rows }));

    // Asserted inside the drawn explanation, never against the whole document:
    // the control also carries the whole text as its hover, so a document-wide
    // search finds every line whether it is DRAWN or not — which is how an
    // earlier form of this test passed with the explanation cut to one line.
    const drawn = Array.from(html.matchAll(/<span class="selector-detail">(.*?)<\/span>\s*<\/button>/gs))
      .map((m) => m[1]);
    assert.strictEqual(drawn.length, rows.length, 'a row draws no explanation at all');

    const workspace = drawn[0];
    assert.ok(
      workspace.includes('/work/demo/services/api'),
      'the open folder is not drawn where it differs from the anchored one',
    );
    assert.ok(
      occurrences(workspace, /class="selector-line"/) >= 2,
      'the explanation is drawn as one line, so its later facts are not drawn at all',
    );
    // Every line the row's own text carries is drawn, so nothing here decides
    // which of them a reader is allowed to see.
    for (const line of rows[0].tooltip.split('\n')) {
      assert.ok(
        workspace.includes(line),
        `the explanation drops the line ${JSON.stringify(line)}`,
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
    assert.strictEqual(
      occurrences(html, /aria-expanded="false"/), 1,
      'the number of sections reporting themselves closed is not the number the reader closed',
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
    for (const chunk of sectionsOf(buttons)) {
      assert.strictEqual(
        occurrences(chunk, /tabindex="0"/), 1,
        'a group carries a number of tab stops other than one',
      );
    }
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
        allOperations().length + 2 + (layout === 'sections' ? OPERATION_GROUPS.length : 0),
        `the ${layout} shape draws a number of buttons other than its controls`,
      );
      assert.strictEqual(
        occurrences(html, /type="button"/), controls,
        `the ${layout} shape draws a button that would submit rather than act`,
      );
    }
  });

  it('names every group once, as a landmark the reader is told they have entered', () => {
    // A tree announces "N of M, level L" for free; a flat row of buttons
    // announces nothing about where the reader is. One labelled landmark per
    // group is the replacement, and it is cheaper and clearer than hanging a
    // description off every button.
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      for (const group of OPERATION_GROUPS) {
        assert.ok(
          html.includes(`role="group" aria-labelledby="grp-${group.id}"`),
          `the ${layout} shape leaves ${group.id} unlabelled`,
        );
        assert.strictEqual(
          occurrences(html, new RegExp(`id="grp-${group.id}"`)), 1,
          `the ${layout} shape gives ${group.id} a number of labels other than one`,
        );
      }
    }
  });

  it('costs one tab stop per group in the button shape, not one per operation', () => {
    // Fifteen operations and two rows would be seventeen tab stops against a
    // tree's one. The arrow keys move within a group and Tab moves between
    // them, which is the contract a reader already has from the trees beside
    // this panel.
    const html = operationsBodyHtml(body({ layout: 'buttons' }));
    assert.strictEqual(
      occurrences(html, /data-roving/),
      OPERATION_GROUPS.length,
      'the button shape does not put one roving container around each group',
    );
    for (const chunk of sectionsOf(html)) {
      assert.strictEqual(
        occurrences(chunk, /tabindex="0"/), 1,
        'a group carries a number of tab stops other than one',
      );
      assert.ok(
        chunk.includes('role="toolbar" aria-orientation="horizontal"'),
        'a group\'s row does not declare itself a horizontal toolbar',
      );
    }
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
    for (const chunk of sectionsOf(html)) {
      assert.strictEqual(occurrences(chunk, /tabindex="0"/), 1);
    }
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
      occurrences(html, /aria-expanded=/),
      OPERATION_GROUPS.length,
      'a toggle does not report whether its section is open',
    );
    assert.strictEqual(
      occurrences(html, /aria-controls="sec-/),
      OPERATION_GROUPS.length,
      'a toggle does not name the region it controls',
    );
  });
});

describe('the divider ahead of the publish group', () => {
  it('is one rule with a margin, on the one group that declares the separation, in both shapes', () => {
    // The row of box-drawing characters a tree needed is gone: a document can
    // draw a rule. The group declares the separation, so both shapes separate
    // the same one.
    const separated = OPERATION_GROUPS.filter((group) => group.separated).map((g) => g.id);
    assert.deepStrictEqual(separated, ['publish'], 'the group model separates a different group');
    for (const layout of BOTH) {
      const html = operationsBodyHtml(body({ layout }));
      assert.strictEqual(
        occurrences(html, /group group-separated/), 1,
        `the ${layout} shape draws a number of dividers other than one`,
      );
      assert.ok(
        html.includes('class="group group-separated" role="group" aria-labelledby="grp-publish"'),
        `the ${layout} shape separates the wrong group`,
      );
      assert.strictEqual(
        occurrences(html, /─/), 0,
        `the ${layout} shape still stands a row of characters in for a divider`,
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
