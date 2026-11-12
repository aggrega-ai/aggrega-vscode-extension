// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import {
  GRAPH_REFRESH,
  GRAPH_WITHOUT_DRAWING,
  GRAPH_WITHOUT_DRAWING_DECLARATION,
  blockAfter,
  callersOf,
  callsOf,
  graphRefreshCallers,
  notificationHandlers,
  sourceOf,
} from '../helpers/graph-refresh-census';

// What a redraw of the topology may be caused by is a wiring property, and this
// is where it is held. The modules involved import the editor, so the wiring
// cannot be driven from here; what CAN be read is which event each redraw hangs
// off, and that is the whole of the rule.
//
// 🔴 BOTH DIRECTIONS ARE ASSERTED AND NEITHER IS THE POINT ON ITS OWN. A view
// refreshed by a report its own request caused recompiles the workspace until it
// is closed; a view refreshed by nothing at all shows a topology that stopped
// being true, which is the same defect wearing the opposite sign. So the specs
// below check that no compiler push reaches a redraw AND that a document reaching
// disk does — and the same of the graph asked for without drawing, which a
// lockfile reaching disk sends where no open graph shows its Release to redraw.

const EXTENSION = 'src/extension.ts';

describe('what causes an open topology graph to be redrawn', () => {
  it('has exactly one caller, and it is the on-disk document watcher', () => {
    const source = sourceOf(EXTENSION);
    const watcher = blockAfter(source, 'function registerFileWatcher');
    assert.ok(
      watcher !== null,
      'registerFileWatcher was not found in ' + EXTENSION + ', so every reading below is '
      + 'about a block that does not exist',
    );
    // The needle on the extraction itself. A brace match that stopped short
    // would report a clean absence for every claim made over it, so the block is
    // required to reach the statement the real function ends with before
    // anything is concluded from what it contains.
    assert.ok(
      watcher.includes('context.subscriptions.push(watcher)'),
      'the extracted watcher block does not reach the registration it ends with, so the brace '
      + 'match is wrong and nothing measured over it means anything',
    );
    assert.ok(
      watcher.includes(GRAPH_REFRESH),
      'a document reaching disk no longer redraws an open graph — the compiler builds a graph '
      + 'from the documents as they stand on disk, so this is the one event that makes the '
      + 'drawing stale, and a guard that closed the recompile cycle by removing this has '
      + 'replaced one defect with another',
    );
    assert.strictEqual(
      graphRefreshCallers(source), 1,
      'the topology redraw is asked for from somewhere other than the on-disk document watcher; '
      + 'read the call sites and check none of them is driven by something the panel\'s own '
      + 'request produced',
    );
  });

  it('asks for a graph without drawing it from the on-disk watcher and nowhere else', () => {
    const source = sourceOf(EXTENSION);
    const watcher = blockAfter(source, 'function registerFileWatcher');
    assert.ok(
      watcher !== null && watcher.includes('context.subscriptions.push(watcher)'),
      'the watcher block was not extracted whole, so nothing measured over it means anything',
    );
    assert.ok(
      watcher.includes(GRAPH_WITHOUT_DRAWING),
      'a lockfile reaching disk with no graph showing its Release no longer asks for the graph, '
      + 'so a drift warning a pull resolved stays in the Problems panel until somebody presses Graph',
    );
    // The needle on the exclusion below. The declaration is the one occurrence
    // of the pattern that is not a call, so it has to be there, once, for the
    // count with it taken out to be a count of callers.
    assert.strictEqual(
      callsOf(source, GRAPH_WITHOUT_DRAWING_DECLARATION), 1,
      'the graph asked for without drawing is not declared exactly once as a function in '
      + EXTENSION + ', so the caller count below takes out something other than its one declaration',
    );
    assert.strictEqual(
      callersOf(source, GRAPH_WITHOUT_DRAWING, GRAPH_WITHOUT_DRAWING_DECLARATION), 1,
      'the graph is asked for without drawing from somewhere other than the on-disk watcher; '
      + 'that request makes the compiler report as a redraw does, so read the call sites and '
      + 'check none of them is driven by something a request of this panel produced',
    );
  });

  it('is never a message the compiler pushed', () => {
    const handlers = notificationHandlers();
    // The instrument's own control, on the same side of the claim as the
    // subjects: the census has to find a subscription at all, and that
    // subscription's body has to be the real one.
    assert.ok(
      handlers.length > 0,
      'the census found no server-push subscription anywhere in the source tree, so it can no '
      + 'longer tell one that redraws a view from one that does not — every absence it '
      + 'measures would pass vacuously',
    );
    const diagnostics = handlers.find(h => h.method === 'aggrega/publishDiagnostics');
    assert.ok(
      diagnostics !== undefined,
      'the diagnostics push is no longer subscribed to, which is the subscription this rule was '
      + 'written about',
    );
    assert.ok(
      diagnostics.body.includes('publishDiagnostics(diagnosticCollections'),
      'the extracted diagnostics handler does not reach the problem-list publication it ends '
      + 'with, so the brace match is wrong and the absence below would be vacuous',
    );

    for (const handler of handlers) {
      assert.ok(
        !handler.body.includes(GRAPH_WITHOUT_DRAWING),
        `${handler.module} asks for a graph when the compiler pushes ${handler.method}. The graph `
        + 'request is what makes the compiler push, so the two would drive each other and the '
        + 'workspace would recompile continuously with nobody typing.',
      );
      assert.ok(
        !handler.body.includes(GRAPH_REFRESH),
        `${handler.module} redraws the topology when the compiler pushes ${handler.method}. `
        + 'A view that re-asks the compiler must not be refreshed by what the compiler pushes: '
        + 'the view\'s own request is what makes it push, so the two drive each other and the '
        + 'workspace recompiles continuously with nobody typing. Hang the redraw off the event '
        + 'that actually changes what would be drawn instead.',
      );
    }
  });
});
