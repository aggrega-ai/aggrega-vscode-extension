// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { EXTENSION_ROOT, readSourceTree } from './launch-census';

// This helper is the one home of the graph-refresh census, so every claim about
// what may and may not redraw the topology is measured by the same instrument. A
// second copy of the pattern would agree on the day it was written and would then
// be the only thing consulted by whichever spec held it.
//
// 🔴 WHAT IT MEASURES IS A CAUSAL RULE, and the rule is worth stating before the
// mechanism: a view that asks the compiler for something must not be refreshed by
// a report the compiler pushes, because that view's own request is what makes the
// compiler push. The refresh asks again, the compiler reports again, and the two
// turn each other for as long as the view stays open — with nobody typing and
// every turn a full pipeline run. Nothing about that depends on the report's
// CONTENT: it is a cycle by construction, so it is closed by construction here,
// at the wiring, rather than by hoping no report ever repeats.

// GRAPH_REFRESH is the call that redraws an open topology graph. The declaration
// binds it with `=`, so a pattern demanding the parenthesis matches the callers
// and not the definition — which is what makes a count of this a count of who
// ASKS for a redraw.
export const GRAPH_REFRESH = 'refreshGraphView(';

// blockAfter returns the brace-matched block that opens at the first `{` after
// anchor, anchor included, or null when anchor does not occur.
//
// 🔴 IT COUNTS BRACES AND KNOWS NOTHING ABOUT STRINGS, so it can over- or
// under-shoot in principle. That is why every claim made with it carries a needle
// naming a statement the real block ends with: a block that stopped short, or ran
// past its own closing brace into a neighbour, fails the needle rather than
// quietly reporting whatever it happened to capture. The needle is not a
// formality here — an absence measured over a block that stopped short is the
// exact false pass this census exists to prevent.
export function blockAfter(source: string, anchor: string): string | null {
  const at = source.indexOf(anchor);
  if (at < 0) { return null; }
  const open = source.indexOf('{', at);
  if (open < 0) { return null; }
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') { depth++; }
    if (source[i] === '}') {
      depth--;
      if (depth === 0) { return source.slice(at, i + 1); }
    }
  }
  return null;
}

// NOTIFICATION_SUBSCRIPTION matches the one way this extension subscribes to a
// message the compiler pushes without being asked.
//
// It is built fresh per call rather than shared, because a global regular
// expression carries a lastIndex and a shared one would make a reading depend on
// the order the specs happened to run in.
function notificationSubscription(): RegExp {
  return /\.on\(\s*['"`]notification:[^'"`]+['"`]/g;
}

// NotificationHandler is one such subscription: the module it sits in, the method
// it subscribes to, and the body it runs.
export interface NotificationHandler {
  module: string;
  method: string;
  body: string;
}

// notificationHandlers reports every server-push subscription in the source tree,
// with its body.
//
// It walks the WHOLE tree rather than the one module that carries a subscription
// today, and that is the difference between a census and a spot check: a second
// subscription written into a neighbouring module is exactly the change this
// claim has to survive, and a reading confined to one module cannot see it.
export function notificationHandlers(): NotificationHandler[] {
  const found: NotificationHandler[] = [];
  for (const [file, source] of readSourceTree()) {
    for (const m of source.matchAll(notificationSubscription())) {
      const method = m[0].slice(m[0].indexOf('notification:') + 'notification:'.length, -1);
      const body = blockAfter(source.slice(m.index ?? 0), m[0]);
      found.push({ module: file, method, body: body ?? '' });
    }
  }
  return found;
}

// sourceOf reads one module of the extension.
export function sourceOf(relativePath: string): string {
  return fs.readFileSync(path.join(EXTENSION_ROOT, relativePath), 'utf8');
}

// graphRefreshCallers reports how many times a redraw is asked for in one module.
export function graphRefreshCallers(source: string): number {
  return source.split(GRAPH_REFRESH).length - 1;
}
