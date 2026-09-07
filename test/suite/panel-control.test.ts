// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
    assert.strictEqual(
      panelControlCommand({ type: 'run', command: 'aggrega.op.build' }, OFFERED, 'operations', channel),
      'aggrega.op.build',
    );
    assert.deepStrictEqual(channel.lines, [], 'an accepted press was reported as a refusal');
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
