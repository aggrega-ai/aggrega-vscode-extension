// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import { panelControlCommand } from '../../src/panel-control';

// The guard holds no editor type, so what would be run for a given press is
// read back directly: a test sends the shapes a panel could send and asserts
// which of them reach a command.

function log(): { lines: string[]; appendLine(text: string): void } {
  const lines: string[] = [];
  return { lines, appendLine: (text: string) => { lines.push(text); } };
}

const OFFERED = ['aggrega.op.build', 'aggrega.release.select'];

describe('what a press on a panel this extension draws is allowed to run', () => {
  it('runs a command the panel\'s own content offers', () => {
    const channel = log();
    assert.deepStrictEqual(
      panelControlCommand({ type: 'run', command: 'aggrega.op.build' }, OFFERED, 'operations', channel),
      { command: 'aggrega.op.build', option: null },
      'an ordinary press did not reach its command, or invented an answer nobody gave',
    );
    assert.deepStrictEqual(channel.lines, [], 'an accepted press was reported as a refusal');
  });

  it('carries the answer a control that offered a choice came back with', () => {
    // A control that presents its choices beside itself sends the choice in the
    // same press. It travels as text and is judged by whoever consumes it: what
    // a given control's answers may be is a property of that control, and a
    // check written into this guard would be a second statement of a set that
    // lives with the operation.
    const channel = log();
    assert.deepStrictEqual(
      panelControlCommand(
        { type: 'run', command: 'aggrega.op.build', option: 'prune' },
        OFFERED,
        'operations',
        channel,
      ),
      { command: 'aggrega.op.build', option: 'prune' },
    );
    assert.deepStrictEqual(channel.lines, []);
  });

  it('reports no answer where the press carried none it could read', () => {
    // The distinction the consumers rest on: no answer means nobody has chosen,
    // and the operation then asks its own question — which is exactly what an
    // invocation from the editor's own command index looks like. So an
    // unreadable answer must read as ABSENT rather than as an empty one, or an
    // operation would take silence for a choice.
    const unreadable: unknown[] = [undefined, null, 7, {}, [], true];
    for (const option of unreadable) {
      const channel = log();
      assert.deepStrictEqual(
        panelControlCommand(
          { type: 'run', command: 'aggrega.op.build', option },
          OFFERED,
          'operations',
          channel,
        ),
        { command: 'aggrega.op.build', option: null },
        `${JSON.stringify(option) ?? 'undefined'} was taken as an answer`,
      );
    }
    // A negative control on the loop: a real answer IS carried through, so the
    // nulls above measure what was sent rather than a field nothing ever fills.
    const channel = log();
    assert.strictEqual(
      panelControlCommand(
        { type: 'run', command: 'aggrega.op.build', option: 'status' },
        OFFERED,
        'operations',
        channel,
      )?.option,
      'status',
    );
  });

  it('refuses a command no control offers, and says which panel asked', () => {
    // The panel is this extension's own document under a content policy that
    // admits only its own script, so this is not a defence against a page that
    // has been tampered with — it is the guarantee that a panel's reach stays
    // exactly what it draws.
    const channel = log();
    assert.strictEqual(
      panelControlCommand(
        { type: 'run', command: 'workbench.action.reloadWindow' },
        OFFERED,
        'operations',
        channel,
      ),
      null,
    );
    assert.deepStrictEqual(channel.lines, [
      'operations: the panel asked for workbench.action.reloadWindow, which none of its controls offers.',
    ]);
  });

  it('ignores every message that is not a press, without reporting one', () => {
    // The same channel carries the panel's own state, so a message this guard
    // is not for must pass through it silently rather than being logged as an
    // attempt to run something.
    const shapes: unknown[] = [
      undefined,
      null,
      'aggrega.op.build',
      42,
      {},
      { type: 'state', collapsed: ['publish'] },
      { type: 'run' },
      { type: 'run', command: 7 },
      { command: 'aggrega.op.build' },
    ];
    for (const shape of shapes) {
      const channel = log();
      assert.strictEqual(
        panelControlCommand(shape, OFFERED, 'operations', channel), null,
        `${JSON.stringify(shape)} was taken as a press`,
      );
      assert.deepStrictEqual(
        channel.lines, [],
        `${JSON.stringify(shape)} was reported as a refused press rather than ignored`,
      );
    }
  });

  it('offers nothing at all when the surface offers nothing', () => {
    // A negative control: with an empty offer every press is refused, so the
    // acceptance above measures the check rather than the shape of the message.
    const channel = log();
    assert.strictEqual(
      panelControlCommand({ type: 'run', command: 'aggrega.op.build' }, [], 'operations', channel),
      null,
    );
    assert.strictEqual(channel.lines.length, 1);
  });
});
