// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { DIAGNOSTIC_SOURCE_BUILD, DIAGNOSTIC_SOURCE_FALLBACK } from '../../src/diagnostics-shape';
import { ClosableLayers, clearClosedDocument, closeKeeps } from '../../src/document-close';
import { callArguments, functionBody } from '../helpers/anchoring-census';

// What a document's close takes out of the Problems panel.
//
// The registry here is a stand-in with the per-layer registry's shape: each layer
// a set of the documents it holds an entry for. The layers are the ones a
// language server names on the wire — its document validation's, a build's, and
// its conventions check's — so the reading is of the rule over the layers that
// exist, not over names made up for the test.

const CONVENTIONS = 'aggrega-lint';

function registry(layers: string[], documents: string[]): ClosableLayers<string> & { reading(): Record<string, string[]> } {
  const held = new Map(layers.map((layer) => [layer, new Set(documents)]));
  return {
    for: (source) => ({ delete: (uri) => { held.get(source)!.delete(uri); } }),
    known: () => [...held.keys()],
    reading: () => Object.fromEntries([...held].map(([layer, set]) => [layer, [...set].sort()])),
  };
}

describe('a document\'s close', () => {
  it('takes the document out of every layer but the build\'s, and leaves every other document', () => {
    const layers = registry([DIAGNOSTIC_SOURCE_FALLBACK, DIAGNOSTIC_SOURCE_BUILD, CONVENTIONS], ['closed.yaml', 'open.yaml']);
    clearClosedDocument(layers, 'closed.yaml');
    assert.deepStrictEqual(layers.reading(), {
      [DIAGNOSTIC_SOURCE_FALLBACK]: ['open.yaml'],
      [DIAGNOSTIC_SOURCE_BUILD]: ['closed.yaml', 'open.yaml'],
      [CONVENTIONS]: ['open.yaml'],
    });
  });

  it('keeps the build\'s layer and no other', () => {
    assert.deepStrictEqual(
      [DIAGNOSTIC_SOURCE_FALLBACK, DIAGNOSTIC_SOURCE_BUILD, CONVENTIONS, 'a-layer-a-later-server-names'].map((s) => [s, closeKeeps(s)]),
      [[DIAGNOSTIC_SOURCE_FALLBACK, false], [DIAGNOSTIC_SOURCE_BUILD, true], [CONVENTIONS, false], ['a-layer-a-later-server-names', false]],
    );
  });

  describe('the extension wires it to the editor\'s close and to nothing else', () => {
    const EXTENSION = 'src/extension.ts';

    it('clears a closed YAML document through the rule, over the per-layer registry alone', () => {
      assert.deepStrictEqual(callArguments(EXTENSION, 'clearClosedDocument'), [['diagnosticCollections', 'doc.uri']]);
      const close = functionBody(EXTENSION, 'function registerCloseHandler(');
      assert.ok(close.includes('clearClosedDocument(diagnosticCollections, doc.uri)'), 'the close does not go through the rule');
      // The refusals of a build, a preview or a graph are kept outside that
      // registry, and the close does not reach them by another way.
      assert.ok(!close.includes('operationRefusals'), 'the close reaches the refusals of a build, a preview or a graph');
    });
  });
});
