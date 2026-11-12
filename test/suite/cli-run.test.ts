// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

import { CliChild, exitRefusal, runCliProcess } from '../../src/cli-run';
import { terminalLine } from '../../src/operation-outcome';

// These assertions hold what a reader is told when an operation run as a command
// is refused. The cheap wrong ending passes everything else in this suite: a
// sentence naming only the exit status reads as a correct failure, and it is
// exactly the one that leaves the reader with nothing to act on, because the
// reason the compiler gave is on its error stream and nowhere else.

// A refusal the compiler writes on one line, as the single-entity validation
// writes one, and one it writes as a code line with indented detail beneath it.
const ONE_LINE = 'kind "Aggregate" in "aggregate.yaml" is not a single-entity validation target; '
  + 'the kinds this scope accepts are Component, Feature, Recipe, FeatureRecipe, Workload and Plugin';
const WITH_DETAIL = '[E0215]\n  document envelope validation failed: 1 placeholder still owed in drafts/component.yaml.\n'
  + '    5:3: metadata.version takes a semantic version, such as 1.0.0';

// fakeChild is a child the test drives by hand: what it writes, on which
// stream, in which reads, and how it closes.
function fakeChild(): CliChild & EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill() { return true; },
    exitCode: null,
    signalCode: null,
  }) as unknown as CliChild & EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
}

describe('the ending of a refused command-run operation carries the compiler\'s words', () => {
  it('names the status and then the compiler\'s sentence, unchanged', () => {
    assert.strictEqual(
      exitRefusal({ code: 1, stderr: `${ONE_LINE}\n` }),
      `the compiler exited with status 1: ${ONE_LINE}`,
    );
  });

  it('keeps every line of a refusal written with detail beneath it, indentation included', () => {
    assert.strictEqual(
      exitRefusal({ code: 1, stderr: `${WITH_DETAIL}\n` }),
      `the compiler exited with status 1: ${WITH_DETAIL}`,
    );
  });

  it('drops only the blank lines around the words, and keeps one between them', () => {
    assert.strictEqual(
      exitRefusal({ code: 3, stderr: '\n  \nfirst\n\n  second  \n\n' }),
      'the compiler exited with status 3: first\n\n  second  ',
    );
  });

  it('reports the status alone where the compiler wrote nothing to its error stream', () => {
    assert.strictEqual(exitRefusal({ code: 2, stderr: '' }), 'the compiler exited with status 2.');
    assert.strictEqual(exitRefusal({ code: 2, stderr: ' \n\t\n' }), 'the compiler exited with status 2.');
  });

  it('says the status is unknown where the child reported none', () => {
    assert.strictEqual(exitRefusal({ code: null, stderr: 'ended\n' }), 'the compiler exited with status unknown: ended');
  });

  it('reads, as the ending a reader is shown, the operation, the status and the compiler\'s sentence', () => {
    assert.strictEqual(
      terminalLine('The check', { kind: 'failed', message: exitRefusal({ code: 1, stderr: `${ONE_LINE}\n` }) }),
      `The check did not complete: the compiler exited with status 1: ${ONE_LINE}`,
    );
  });
});

describe('a run nobody stopped settles on its status and its error stream', () => {
  it('carries what the child wrote to its error stream and not what it wrote to its output', async () => {
    const child = fakeChild();
    const streamed: string[] = [];
    const pending = runCliProcess(
      { spawn: () => child, append: (t) => streamed.push(t), appendLine: () => undefined },
      'The check',
    );
    child.stdout.emit('data', Buffer.from('Entity: drafts/component.yaml\nKind:   Component\n'));
    child.stderr.emit('data', Buffer.from(`${ONE_LINE}\n`));
    child.emit('close', 1);
    const exit = await pending;
    assert.deepStrictEqual(exit, { code: 1, stderr: `${ONE_LINE}\n` });
    // The channel still receives both streams as they arrive.
    assert.deepStrictEqual(streamed, ['Entity: drafts/component.yaml\nKind:   Component\n', `${ONE_LINE}\n`]);
  });

  it('decodes a character the operating system split across two reads as one character', async () => {
    const child = fakeChild();
    const pending = runCliProcess(
      { spawn: () => child, append: () => undefined, appendLine: () => undefined },
      'The check',
    );
    const bytes = Buffer.from('refused — see the entity\n', 'utf8');
    const cut = bytes.indexOf(Buffer.from('—', 'utf8')) + 1;
    child.stderr.emit('data', bytes.subarray(0, cut));
    child.stderr.emit('data', bytes.subarray(cut));
    child.emit('close', 1);
    assert.strictEqual((await pending).stderr, 'refused — see the entity\n');
  });

  it('carries a REAL child\'s error stream, apart from its output', async () => {
    // A real process rather than a stub, so the two streams are the ones the
    // operating system keeps apart rather than two emitters this test names.
    const script = "process.stdout.write('report\\n'); process.stderr.write('kind \"Aggregate\" is refused\\n'); process.exitCode = 4;";
    const exit = await runCliProcess(
      {
        spawn: () => spawn(process.execPath, ['-e', script]) as unknown as CliChild,
        append: () => undefined,
        appendLine: () => undefined,
      },
      'The check',
    );
    assert.deepStrictEqual(exit, { code: 4, stderr: 'kind "Aggregate" is refused\n' });
    assert.strictEqual(exitRefusal(exit), 'the compiler exited with status 4: kind "Aggregate" is refused');
  });
});
