// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  convertPosition,
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

  it('lspCompletionToCompletion forwards trigger character when provided', () => {
    const out = lspCompletionToCompletion(uri, pos, content, 'utf-8', '/');
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 }, triggerCharacter: '/' });
  });

  it('lspCompletionToCompletion omits trigger character when undefined', () => {
    const out = lspCompletionToCompletion(uri, pos, content, 'utf-8', undefined);
    assert.deepStrictEqual(out, { uri, position: { line: 0, character: 6 } });
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
