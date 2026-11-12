// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import { irGraphRequest } from '../../src/graph-payload';
import { showsSensitiveValues } from '../../src/settings';
import { blockAfter, callsOf, sourceOf } from '../helpers/graph-refresh-census';

// What the topology view asks the language server for. The language server
// withholds the values a Feature declares sensitive unless the request asks for
// them, so the request is where the reader's setting first takes effect: it asks
// for those values while the setting is on, and says nothing about them while it
// is off.
//
// The composition is driven directly. The places that send it import the editor
// and cannot be loaded here, so what is held of them is read from their source:
// the one reading of the setting a drawing takes and the request built from it,
// and the two other places an irGraph request leaves from.

const RELEASE = 'release-compose.yaml';
const GRAPH_VIEW = 'src/graph-view.ts';
const EXTENSION = 'src/extension.ts';

describe('the request a drawing of the topology sends', () => {
  it('asks for the values a Feature declares sensitive while the setting is on', () => {
    assert.deepStrictEqual(irGraphRequest(RELEASE, true), { release: RELEASE, unredacted: true });
  });

  it('leaves the field out while the setting is off, rather than sending false', () => {
    const request = irGraphRequest(RELEASE, false);
    // The key's absence, not a value equal to undefined or false: a request
    // carrying the key at all would be a request a reader of the wire takes for
    // one that asked.
    assert.deepStrictEqual(Object.keys(request), ['release']);
    assert.ok(!Object.prototype.hasOwnProperty.call(request, 'unredacted'), 'the request carries an unredacted key');
    assert.strictEqual(JSON.stringify(request), JSON.stringify({ release: RELEASE }));
  });

  it('asks for the values only where the setting reads as the boolean true', () => {
    // Every configured value the setting's own reading takes as off, and the
    // reading itself, so the two cannot come to disagree about what on means.
    for (const configured of [undefined, null, false, 'true', 'yes', 1, {}, [], 0, '']) {
      const request = irGraphRequest(RELEASE, showsSensitiveValues(configured));
      assert.deepStrictEqual(Object.keys(request), ['release'], `configured ${JSON.stringify(configured)} asked for the values`);
    }
    assert.deepStrictEqual(irGraphRequest(RELEASE, showsSensitiveValues(true)), { release: RELEASE, unredacted: true });
    // And a value that is not a boolean reaching the composition directly, past
    // the type it is declared with: only true asks.
    for (const notBoolean of ['yes', 1, {}]) {
      const request = irGraphRequest(RELEASE, notBoolean as unknown as boolean);
      assert.deepStrictEqual(Object.keys(request), ['release'], `${JSON.stringify(notBoolean)} asked for the values`);
    }
  });
});

describe('where an irGraph request leaves from', () => {
  it('reads the setting once per drawing, before the request, and sends what that reading composed', () => {
    // Its parameters carry a brace of their own, so the body is found from the
    // end of the signature rather than from the name.
    const source = sourceOf(GRAPH_VIEW);
    const at = source.indexOf('async function renderGraph(');
    const block = at < 0 ? null : blockAfter(source.slice(at), '): Promise<void> {');
    assert.ok(block !== null, `renderGraph was not found in ${GRAPH_VIEW}, so every reading below is about a block that does not exist`);
    // The needle on the extraction: a brace match that stopped short would report
    // a clean reading over a fragment, so the block must reach the failure report
    // the real function ends with.
    assert.ok(
      block.includes('reportGraphFailure(err, release, whoAsked'),
      'the extracted renderGraph block does not reach the failure report it ends with, so the brace match is wrong',
    );
    assert.strictEqual(
      callsOf(block, 'deps.showsSensitiveValues()'), 1,
      'a drawing reads the setting more than once, or not at all: two readings can disagree, and the request, the redaction and the panel would then be told different things',
    );
    const read = block.indexOf('const showsSensitiveValues = deps.showsSensitiveValues();');
    const composed = block.indexOf('const request = irGraphRequest(release, showsSensitiveValues);');
    const firstSend = block.indexOf('deps.requestIrGraph(');
    assert.ok(read >= 0 && composed > read, 'the request is not composed from the drawing\'s one reading of the setting');
    assert.ok(firstSend > composed, 'the request is sent before the setting is read, so the reading cannot decide it');
    assert.strictEqual(callsOf(block, 'deps.requestIrGraph('), 2, 'the drawing sends the irGraph request from other than its quiet and its asked-for branch');
    assert.strictEqual(
      callsOf(block, 'deps.requestIrGraph(request)') + callsOf(block, 'deps.requestIrGraph(request, signal)'), 2,
      'a branch of the drawing sends a request other than the one composed from its reading of the setting',
    );
    assert.ok(block.includes('redact(answer, showsSensitiveValues)'), 'the redaction is not decided by the same reading');
    assert.ok(block.includes('asked: !opts.quiet, showsSensitiveValues });'), 'the panel is not told the same reading');
  });

  it('asks for the graph withheld when nothing is drawn from the answer, whatever the setting says', () => {
    const block = blockAfter(sourceOf(EXTENSION), 'async function requestGraphWithoutDrawing(');
    assert.ok(block !== null, `the graph asked for without drawing was not found in ${EXTENSION}`);
    assert.ok(
      block.includes('outputChannel?.appendLine('),
      'the extracted block does not reach the channel line it ends with, so the brace match is wrong',
    );
    assert.ok(block.includes('const params: IrGraphParams = { release };'), 'the request is not the Release alone, typed as the published request');
    assert.ok(block.includes("client.request<unknown>('aggrega/irGraph', params)"), 'what is sent is not the request composed above it');
    for (const token of ['unredacted', 'showsSensitiveValues', 'showSensitiveValues', 'getSettings', 'irGraphRequest']) {
      assert.ok(!block.includes(token), `the request sent for a graph nobody draws reads ${token}, so the setting can reach it`);
    }
  });

  it('sends the drawing\'s request exactly as the view composed it', () => {
    const block = blockAfter(sourceOf(EXTENSION), 'requestIrGraph: async (request: IrGraphRequest');
    assert.ok(block !== null, `the view's irGraph dependency was not found in ${EXTENSION}`);
    assert.ok(block.includes('return result.graph;'), 'the extracted block does not reach the return it ends with, so the brace match is wrong');
    assert.ok(/'aggrega\/irGraph',\s*request,\s*signal,/.test(block), 'the dependency sends something other than the request it was handed');
    for (const token of ['unredacted', 'showsSensitiveValues', 'showSensitiveValues', 'getSettings']) {
      assert.ok(!block.includes(token), `the dependency reads ${token}, a second reading the view's request does not carry`);
    }
  });
});
