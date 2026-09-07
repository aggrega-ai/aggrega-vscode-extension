// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { ConfigControl } from '../../src/config-schema';
import { readConfigValue } from '../../src/config-value';

// A control shaped by hand rather than generated, so an assertion can state
// exactly which declaration it is about. What is under test is the enforcement,
// and the enforcement reads the control — so building one directly is the
// narrowest way to exercise it.
function control(over: Partial<ConfigControl>): ConfigControl {
  return {
    path: ['setting'],
    label: 'Setting',
    description: 'a setting',
    kind: 'text',
    hasDefault: false,
    ...over,
  };
}

// accepted reads a verdict, failing with the refusal's own reason when the value
// was refused — a bare assertion on a boolean would hide why.
function accepted(control: ConfigControl, raw: string): unknown {
  const verdict = readConfigValue(control, raw);
  assert.ok(verdict.accepted, `${raw} was refused: ${verdict.accepted ? '' : verdict.reason}`);
  return verdict.value;
}

// refused reads a refusal, failing when the value was accepted.
function refused(control: ConfigControl, raw: string): string {
  const verdict = readConfigValue(control, raw);
  assert.ok(!verdict.accepted, `${raw} was accepted, and the schema does not admit it`);
  return verdict.reason;
}

describe('what a generated control will accept', () => {
  // 🔴 CLAUSE (g) OF THE ACCEPTANCE: the bounds and the enumerations the schema
  // declares are enforced in the control, so a value the schema refuses cannot
  // be composed on this side.
  it('holds a number to the bounds the schema declared', () => {
    const bounded = control({ kind: 'number', minimum: 2, maximum: 9 });

    assert.strictEqual(accepted(bounded, '2'), 2, 'the smallest admissible value is refused');
    assert.strictEqual(accepted(bounded, '9'), 9, 'the largest admissible value is refused');
    assert.strictEqual(accepted(bounded, '5'), 5);

    // The refusal names the bound, so a reader can act on it without opening the
    // schema.
    assert.match(refused(bounded, '1'), /below the smallest value .*2/);
    assert.match(refused(bounded, '10'), /above the largest value .*9/);
  });

  it('leaves a side unbounded where the schema declared no bound', () => {
    const onlyFloor = control({ kind: 'number', minimum: 0 });
    assert.strictEqual(accepted(onlyFloor, '1000000'), 1000000);
    assert.match(refused(onlyFloor, '-1'), /below the smallest value/);
  });

  it('refuses text that is not a whole number, including text a loose parse would take', () => {
    const number = control({ kind: 'number' });
    // The language's own conversion takes several of these: it reads a leading
    // number and discards the rest, so "12abc" would arrive as 12 — a value the
    // reader never typed.
    for (const bad of ['12abc', '1.5', '0x10', '', ' ', 'NaN', '1e3', '--2']) {
      assert.match(
        refused(number, bad),
        /is not a whole number|needs a number/,
        `${JSON.stringify(bad)} was read as a number`,
      );
    }
  });

  it('refuses a number too large to be written exactly', () => {
    // A value beyond exact integer range would be written back as a different
    // number than the reader typed, which is this surface changing their input.
    assert.match(refused(control({ kind: 'number' }), '9007199254740993'), /too large/);
  });

  it('accepts only the values the schema enumerates', () => {
    const choice = control({ kind: 'choice', choices: ['error', 'warn', 'off'] });
    for (const good of ['error', 'warn', 'off']) {
      assert.strictEqual(accepted(choice, good), good);
    }
    // The comparison is against the enumeration itself, so the refusal can list
    // what is admissible.
    const reason = refused(choice, 'quiet');
    assert.match(reason, /error, warn, off/);
    // A near miss and a difference in case are both refused: the enumeration is
    // the whole of what the schema admits, and neither is in it.
    assert.match(refused(choice, 'Error'), /not one of the values/);
    assert.match(refused(choice, 'err'), /not one of the values/);
    assert.match(refused(choice, ''), /not one of the values/);
  });

  it('accepts the two spellings of a toggle and nothing else', () => {
    const toggle = control({ kind: 'toggle' });
    assert.strictEqual(accepted(toggle, 'true'), true);
    assert.strictEqual(accepted(toggle, 'false'), false);
    // The trimming and the case-folding are deliberate: a control hands back
    // what it holds, and the two spellings are the value rather than the
    // formatting.
    assert.strictEqual(accepted(toggle, ' TRUE '), true);
    for (const bad of ['yes', '1', 'on', '', 'truthy']) {
      assert.match(refused(toggle, bad), /is not true or false/, `${bad} was read as a boolean`);
    }
  });

  it('reads a list of text entries one per line, dropping the blank ones', () => {
    const list = control({ kind: 'text-list' });
    assert.deepStrictEqual(accepted(list, 'one\ntwo\nthree'), ['one', 'two', 'three']);
    // A trailing newline means a list of what was typed, not a list with an
    // empty entry on the end.
    assert.deepStrictEqual(accepted(list, 'one\n\n two \n'), ['one', 'two']);
    assert.deepStrictEqual(accepted(list, ''), []);
  });

  it('takes text as it was typed', () => {
    // Text carries no constraint the schema stated, so nothing is imposed here:
    // trimming it would change a value the reader may have meant.
    const text = control({ kind: 'text' });
    assert.strictEqual(accepted(text, '  hub.example.com  '), '  hub.example.com  ');
    assert.strictEqual(accepted(text, ''), '');
  });

  it('refuses to compose a shape it does not offer as one value', () => {
    // A collection and a shape the generator could not read are not composed
    // from one line of text. Refusing rather than guessing is what keeps a
    // control this surface cannot honestly offer from appearing to work.
    for (const kind of ['collection', 'map', 'unsupported'] as const) {
      assert.match(
        refused(control({ kind }), 'anything'),
        /is not a single value this surface composes/,
        `a ${kind} was composed from one line of text`,
      );
    }
  });

  it('names the setting by its path, so two settings with one label are told apart', () => {
    const nested = control({
      path: ['registries', 'signing', 'required'],
      label: 'Required',
      kind: 'toggle',
    });
    assert.match(refused(nested, 'maybe'), /maybe is not true or false/);
    // The path is what a refusal about a bound carries, and a label alone would
    // not say which of two identically-labelled settings it was about.
    const bounded = control({
      path: ['parse_cache', 'max_bytes'],
      label: 'Max bytes',
      kind: 'number',
      maximum: 10,
    });
    assert.match(refused(bounded, '11'), /parse_cache\.max_bytes/);
  });
});
