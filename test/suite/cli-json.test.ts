// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { messageForUnparsedOutput } from '../../src/cli-json';

// The three cases below are the states a structured run can end in with nothing
// parsable on stdout. Each is measured against the product rather than imagined:
// a command asked for JSON can answer a configuration question in prose and exit
// zero, and a command that could not run at all writes its reason to stderr.

describe('cli-json: reporting an unparsable structured run', () => {
  it('stderr wins, because that is where the remediation is written', () => {
    const stderr =
      "aggrega search: no local index found for any configured registry; run 'aggrega registry update'";
    assert.strictEqual(
      messageForUnparsedOutput(['search', '-o', 'json'], '', `${stderr}\n`),
      stderr,
    );
  });

  it('stderr still wins when stdout also has text', () => {
    assert.strictEqual(
      messageForUnparsedOutput(['search', '-o', 'json'], 'partial {', 'the real reason\n'),
      'the real reason',
    );
  });

  it('a prose answer on stdout is surfaced as the product wrote it', () => {
    // Measured: with no registry configured, `search -o json` writes this
    // sentence to stdout and exits zero. Reporting a parse failure instead
    // would hide an answer the reader can act on.
    assert.strictEqual(
      messageForUnparsedOutput(['search', '-o', 'json'], 'No registries configured.\n', ''),
      'No registries configured.',
    );
  });

  it('a multi-line stdout is excerpted, and says so', () => {
    // A reader must never be shown a shortened sentence and read it as whole.
    const message = messageForUnparsedOutput(['x'], 'first line\nsecond line\n', '');
    assert.strictEqual(message, 'first line …');
  });

  it('leading blank lines do not become the excerpt', () => {
    assert.strictEqual(messageForUnparsedOutput(['x'], '\n\n  real text  \n', ''), 'real text');
  });

  it('a very long line is capped, and says so', () => {
    const long = 'x'.repeat(1000);
    const message = messageForUnparsedOutput(['x'], long, '');
    assert.ok(message.length < long.length, 'not capped');
    assert.ok(message.endsWith('…'), message.slice(-20));
  });

  it('two silent streams name the command, so the failure is still attributable', () => {
    assert.strictEqual(
      messageForUnparsedOutput(['plugin', 'list', '-o', 'json'], '', ''),
      '`aggrega plugin list -o json` produced no output.',
    );
  });

  it('whitespace-only streams count as silent', () => {
    assert.strictEqual(
      messageForUnparsedOutput(['x'], '  \n \n', '   \n'),
      '`aggrega x` produced no output.',
    );
  });

  it('nothing about the JSON machinery reaches the reader', () => {
    // The reader asked for a catalog search, not for a parser. A message naming
    // JSON would be a wrapper about this extension's plumbing rather than the
    // product's answer.
    for (const message of [
      messageForUnparsedOutput(['search'], 'No registries configured.', ''),
      messageForUnparsedOutput(['search'], '', 'no local index'),
    ]) {
      assert.ok(!/json/i.test(message), message);
      assert.ok(!/parse/i.test(message), message);
    }
  });
});
