// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// Whether a group boundary in the Commands panel earns its mark is decided
// AFTER the browser has laid the flow out, because it depends on where the line
// breaks fall and nothing knows that until there is a width to break against.
// That makes the rule the one part of this panel a composed-document assertion
// cannot reach at all.
//
// So the rule is a function that takes positions and returns verdicts, and
// these tests hand it positions directly. What they establish is that the rule
// is right; what they cannot establish is that the browser reports the
// positions this assumes, or that the mark then disappears — both need a
// running editor and belong to the walk by hand.
//
// The script is loaded the way the webview loads it, as a script assigning to
// the global, so what is exercised is the file that ships rather than a copy of
// it. Loading it in a sandbox with no document is also the check that its
// document-free half really is document-free: a script that reached for one at
// load would throw here.

interface FlowItem {
  bar: boolean;
  top: number;
}

interface FlowModel {
  drawnBars(items: unknown, slack?: unknown): boolean[];
  LINE_SLACK: number;
}

function loadModel(): FlowModel {
  const file = path.join(__dirname, '..', '..', '..', 'media', 'operations.js');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  assert.strictEqual(
    sandbox.document, undefined,
    'the sandbox has a document, so loading the script here proves nothing about its two halves',
  );
  const model = sandbox.AggregaOperationsFlow as FlowModel | undefined;
  assert.ok(model, `${file} defined no AggregaOperationsFlow global`);
  // The script runs in its own realm, so the array it builds is an instance of
  // that realm's constructor and compares unequal to this one's however
  // identical its contents.
  return {
    drawnBars: (items, slack) => structuredClone(model.drawnBars(items, slack)),
    LINE_SLACK: model.LINE_SLACK,
  };
}

// A line of controls, at a stated top, with a boundary mark wherever `|` sits.
// Written this way because the shape under test is a sequence of positions, and
// a table of them reads as the layout it describes.
function flow(...lines: Array<{ top: number; items: string[] }>): FlowItem[] {
  const built: FlowItem[] = [];
  for (const line of lines) {
    for (const item of line.items) {
      built.push({ bar: item === '|', top: line.top });
    }
  }
  return built;
}

const model = loadModel();

describe('which group boundaries earn a mark, once the flow has been laid out', () => {
  it('draws a mark with a control on the same line on both sides', () => {
    // The whole point of the mark: mid-line, it is the only thing saying one
    // group ended and the next began.
    assert.deepStrictEqual(
      model.drawnBars(flow({ top: 0, items: ['op', 'op', '|', 'op'] }), 1),
      [true],
    );
  });

  it('draws no mark where the wrap put the boundary at the END of a line', () => {
    // The mark fitted on the first line but the next group's first control did
    // not. The break is already the separation, and a mark here would be a
    // stray tick against the panel's trailing edge.
    assert.deepStrictEqual(
      model.drawnBars(flow(
        { top: 0, items: ['op', 'op', '|'] },
        { top: 30, items: ['op', 'op'] },
      ), 1),
      [false],
    );
  });

  it('draws no mark where the wrap put the boundary at the START of a line', () => {
    // The other side of the same break: the mark wrapped down with the group it
    // opens, and now it leads the line instead of dividing one.
    assert.deepStrictEqual(
      model.drawnBars(flow(
        { top: 0, items: ['op', 'op'] },
        { top: 30, items: ['|', 'op', 'op'] },
      ), 1),
      [false],
    );
  });

  it('draws no mark for a boundary that landed alone on a line', () => {
    assert.deepStrictEqual(
      model.drawnBars(flow(
        { top: 0, items: ['op'] },
        { top: 30, items: ['|'] },
        { top: 60, items: ['op'] },
      ), 1),
      [false],
    );
  });

  it('answers each boundary on its own, not the flow as a whole', () => {
    // The case a single verdict for the whole flow would get wrong: at one
    // width some boundaries fall mid-line and others land on an edge, and the
    // answers are per boundary. Fifteen controls over three lines with four
    // boundaries between five groups — the panel's own shape — and two of the
    // four verdicts go each way.
    assert.deepStrictEqual(
      model.drawnBars(flow(
        { top: 0, items: ['op', 'op', 'op', 'op', 'op', '|'] },
        { top: 30, items: ['op', 'op', '|', 'op', 'op', 'op', '|'] },
        { top: 60, items: ['op', 'op', 'op', '|', 'op', 'op'] },
      ), 1),
      [false, true, false, true],
    );
  });

  it('reaches the same answer whatever the mark\'s own position is', () => {
    // The verdict is read off the two CONTROLS beside the mark and never off
    // the mark itself, which is what lets the mark be inset, centred or full
    // height without the rule changing. Asserted by moving the mark's own top
    // far from either line and getting the same answers back.
    //
    // A control between two lines is not a case this can be asked about: a
    // control's position IS which line it is on. The mark's is not, because it
    // can be styled away from the line's top edge.
    const laidOut: FlowItem[] = [
      { bar: false, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 0 },
      { bar: false, top: 30 }, { bar: true, top: 30 }, { bar: false, top: 60 },
    ];
    const expected = [true, false];
    assert.deepStrictEqual(model.drawnBars(laidOut, 1), expected);
    for (const shifted of [-9, 4, 11, 999]) {
      assert.deepStrictEqual(
        model.drawnBars(
          laidOut.map((item) => (item.bar ? { bar: true, top: item.top + shifted } : item)),
          1,
        ),
        expected,
        `the verdict moved when the mark itself moved by ${shifted}`,
      );
    }
  });

  it('absorbs a sub-pixel difference between two controls sharing a line', () => {
    assert.deepStrictEqual(
      model.drawnBars(
        [{ bar: false, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 0.5 }],
        model.LINE_SLACK,
      ),
      [true],
    );
  });

  it('does not merge two lines, whose distance is a whole control', () => {
    // The tolerance is slack on "the same line", never a guess at a line's
    // height. A tolerance that swallowed a line would report every boundary as
    // mid-line and draw a bar against every edge.
    assert.deepStrictEqual(
      model.drawnBars(
        [{ bar: false, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 26 }],
        model.LINE_SLACK,
      ),
      [false],
    );
    assert.ok(
      model.LINE_SLACK >= 0 && model.LINE_SLACK < 26,
      'the tolerance is as large as the distance between two lines, so it cannot tell them apart',
    );
  });

  it('draws no mark that has no control on one side of it', () => {
    // A mark leading or trailing the whole flow, and two marks side by side —
    // which is what an empty group would produce. None of the three separates
    // one control from another, and a doubled bar is visible as a defect.
    assert.deepStrictEqual(
      model.drawnBars([{ bar: true, top: 0 }, { bar: false, top: 0 }], 1),
      [false],
      'a mark leading the flow was drawn',
    );
    assert.deepStrictEqual(
      model.drawnBars([{ bar: false, top: 0 }, { bar: true, top: 0 }], 1),
      [false],
      'a mark trailing the flow was drawn',
    );
    assert.deepStrictEqual(
      model.drawnBars(
        [{ bar: false, top: 0 }, { bar: true, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 0 }],
        1,
      ),
      [false, false],
      'two marks side by side were both drawn, which draws a doubled bar',
    );
  });

  it('draws no mark whose neighbours could not be measured', () => {
    // The safe direction. An unmarked boundary loses a visual cue; a mark drawn
    // against a line edge is the defect the rule exists to prevent.
    for (const unmeasured of [undefined, null, NaN, 'top', {}]) {
      assert.deepStrictEqual(
        model.drawnBars(
          [{ bar: false, top: unmeasured }, { bar: true, top: 0 }, { bar: false, top: 0 }],
          1,
        ),
        [false],
        `a mark was drawn beside a control positioned at ${JSON.stringify(unmeasured)}`,
      );
    }
  });

  it('reports one answer per mark and nothing for a flow with none', () => {
    assert.deepStrictEqual(
      model.drawnBars(flow({ top: 0, items: ['op', 'op', 'op'] }), 1),
      [],
      'a flow with no boundary got an answer about one',
    );
    assert.deepStrictEqual(model.drawnBars([], 1), []);
  });

  it('reads an unusable flow as nothing to draw rather than failing', () => {
    // The measurement is taken from a live document, so this is handed whatever
    // that document turned out to hold. Reporting nothing to draw leaves the
    // panel with unmarked boundaries; throwing would leave the panel's script
    // stopped, and with it the roving tab stop and the press forwarding.
    for (const unusable of [undefined, null, 'items', 7, {}]) {
      assert.deepStrictEqual(
        model.drawnBars(unusable, 1), [],
        `an unusable flow of ${JSON.stringify(unusable)} was not read as nothing to draw`,
      );
    }
    // A missing tolerance reads as none rather than as unbounded: two controls
    // at exactly one top are still on one line.
    assert.deepStrictEqual(
      model.drawnBars([{ bar: false, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 0 }]),
      [true],
    );
    assert.deepStrictEqual(
      model.drawnBars(
        [{ bar: false, top: 0 }, { bar: true, top: 0 }, { bar: false, top: 0.5 }],
        'a lot',
      ),
      [false],
      'an unreadable tolerance was treated as larger than none',
    );
  });
});
