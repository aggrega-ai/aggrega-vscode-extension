// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  convertPosition,
  hoverResponseToMarkup,
  locationToLspLocation,
  lspCompletionToCompletion,
  lspDefinitionToResolve,
  lspHoverToHover,
  lspImplementationToFindImplementations,
  lspReferencesToFindReferences,
} from '../../src/translator';

describe('convertPosition', () => {
  it('utf-16 to utf-16 is identity', () => {
    const out = convertPosition('hello world', { line: 0, character: 6 }, 'utf-16', 'utf-16');
    assert.deepStrictEqual(out, { line: 0, character: 6 });
  });

  it('utf-16 to utf-8 on ASCII matches the column count', () => {
    const out = convertPosition('hello world', { line: 0, character: 6 }, 'utf-16', 'utf-8');
    assert.deepStrictEqual(out, { line: 0, character: 6 });
  });

  it('utf-16 to utf-8 counts 2-byte sequences for BMP non-ASCII', () => {
    // 'é' = U+00E9, 1 UTF-16 unit, 2 UTF-8 bytes.
    const out = convertPosition('éx', { line: 0, character: 2 }, 'utf-16', 'utf-8');
    assert.deepStrictEqual(out, { line: 0, character: 3 });
  });

  it('utf-16 to utf-8 counts surrogate pairs as 4 bytes', () => {
    // '😀' = U+1F600, surrogate pair (2 UTF-16 units), 4 UTF-8 bytes.
    const out = convertPosition('😀x', { line: 0, character: 3 }, 'utf-16', 'utf-8');
    assert.deepStrictEqual(out, { line: 0, character: 5 });
  });

  it('utf-8 to utf-16 reverses the surrogate-pair conversion', () => {
    const out = convertPosition('😀x', { line: 0, character: 5 }, 'utf-8', 'utf-16');
    assert.deepStrictEqual(out, { line: 0, character: 3 });
  });

  it('honors line indexing across multi-line documents', () => {
    const out = convertPosition('a\nb\nc', { line: 2, character: 1 }, 'utf-16', 'utf-8');
    assert.deepStrictEqual(out, { line: 2, character: 1 });
  });
});

describe('request-direction translators (utf-8 server)', () => {
  const uri = 'file:///workspace/release.yaml';
  const content = 'hello world';
  const pos = { line: 0, character: 6 };

  it('lspDefinitionToResolve threads encoded position', () => {
    const out = lspDefinitionToResolve(uri, pos, content, 'utf-8');
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
  });

  it('lspReferencesToFindReferences mirrors definition shape', () => {
    const out = lspReferencesToFindReferences(uri, pos, content, 'utf-8');
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
  });

  it('lspImplementationToFindImplementations mirrors definition shape', () => {
    const out = lspImplementationToFindImplementations(uri, pos, content, 'utf-8');
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
  });

  it('lspHoverToHover mirrors definition shape', () => {
    const out = lspHoverToHover(uri, pos, content, 'utf-8');
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
  });

  // 🔴 THE TRIGGER CHARACTER TRAVELS INSIDE THE CONTEXT MEMBER, WHICH IS WHERE
  // THE COMPILER READS IT FROM. Carried beside the position instead, it reaches
  // the compiler as a key the request shape does not declare — so it is dropped,
  // the narrowing it exists to drive never runs, and nothing anywhere reports
  // that. The equality is over the whole request rather than over the one member,
  // because a check that the character is present somewhere would pass on exactly
  // the shape that loses it.
  it('lspCompletionToCompletion carries the trigger character where the compiler reads it', () => {
    const out = lspCompletionToCompletion(uri, pos, content, 'utf-8', '/');
    assert.deepStrictEqual(out, {
      uri,
      position: { line: 0, character: 6 },
      context: { triggerKind: 2, triggerCharacter: '/' },
    });
  });

  it('lspCompletionToCompletion omits trigger character when undefined', () => {
    const out = lspCompletionToCompletion(uri, pos, content, 'utf-8', undefined);
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
  });
});

describe('hoverResponseToMarkup', () => {
  // The answer carrying content is an object, and the editor's markdown string
  // accepts only a string: an answer handed to it as it arrives throws inside
  // the provider, so the reader is shown nothing and nothing says why. Each
  // case below asserts the whole reading rather than one member of it.
  it('reads a markdown answer as markdown, with its text as it arrived', () => {
    const value = '**Feature** `local/nightly-backup` `v1.0.0`\n\nA nightly copy of a datastore.';
    assert.deepStrictEqual(
      hoverResponseToMarkup({ contents: { kind: 'markdown', value } }),
      { kind: 'markdown', value },
    );
  });

  it('reads a plaintext answer as plaintext, so no markdown is read into it', () => {
    const value = '**not emphasis** and `not code`';
    assert.deepStrictEqual(
      hoverResponseToMarkup({ contents: { kind: 'plaintext', value } }),
      { kind: 'plaintext', value },
    );
  });

  it('shows nothing for a null contents, and for no answer at all', () => {
    assert.deepStrictEqual(hoverResponseToMarkup({ contents: null }), undefined);
    assert.deepStrictEqual(hoverResponseToMarkup(null), undefined);
  });

  it('shows nothing for an empty value, or one of whitespace alone', () => {
    assert.deepStrictEqual(hoverResponseToMarkup({ contents: { kind: 'markdown', value: '' } }), undefined);
    assert.deepStrictEqual(hoverResponseToMarkup({ contents: { kind: 'plaintext', value: ' \n\t' } }), undefined);
  });

  it('shows nothing for contents in a shape it does not recognise', () => {
    for (const contents of [
      'a bare string',
      ['an', 'array'],
      { kind: 'html', value: '<b>a markup it does not know</b>' },
      { kind: 'markdown' },
      { kind: 'markdown', value: 42 },
      { value: 'no markup named' },
      42,
    ]) {
      assert.deepStrictEqual(hoverResponseToMarkup({ contents }), undefined, JSON.stringify(contents));
    }
  });
});

describe('locationToLspLocation', () => {
  it('passes through unchanged on utf-16 server encoding', () => {
    const loc = {
      uri: 'file:///x.yaml',
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
    };
    const out = locationToLspLocation(loc, '', 'utf-16');
    assert.deepStrictEqual(out, loc);
  });

  it('converts utf-8 ranges back to utf-16 using target content', () => {
    const targetContent = 'éx';
    const loc = {
      uri: 'file:///x.yaml',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    };
    const out = locationToLspLocation(loc, targetContent, 'utf-8');
    assert.deepStrictEqual(out, {
      uri: 'file:///x.yaml',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
    });
  });
});
