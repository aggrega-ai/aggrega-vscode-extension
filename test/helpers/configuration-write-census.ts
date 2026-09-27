// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { blockAfter } from './graph-refresh-census';

// This helper is the one home of the configuration-write census: which requests
// the extension sends to the language server hand their write to the watch that
// restarts the server after it. The module that sends them imports the editor, so
// no test can call those requests; what CAN be read is which request sits inside
// the hand-over, and that is the whole of the rule.
//
// 🔴 WHAT IT MEASURES IS A WIRING RULE, stated before the mechanism: the language
// server reads its configuration once, when it starts, so a write the extension
// makes itself is followed by one restart of that server — and the restart is
// reached through the watch, which decides it, never beside it. A write that
// bypasses the hand-over leaves the server answering from the configuration it
// started with, which is the defect this exists for; a request that is not a
// configuration write reaching the hand-over restarts the server for nothing.

// OWN_WRITE is the call that hands a configuration write to the watch.
export const OWN_WRITE = 'configurationWatch.ownWrite(';

// CONFIGURATION_WRITES is every request method that writes a configuration file,
// as the surface stands.
//
// It is a hand-written record compared against a fresh reading of the source, so
// the two sides move independently: a request added to the source that writes a
// configuration file, or one taken out of the hand-over, shows up as a
// difference rather than being accepted by a reading that produced its own
// expectation. Each is here because the compiler's handler for it writes a
// configuration file; the credential removal writes the credential store, which
// no server reads its configuration from, and is not here for that reason.
export const CONFIGURATION_WRITES: readonly string[] = [
  'aggrega/configInit',
  'aggrega/pluginAdd',
  'aggrega/pluginRemove',
  'aggrega/registryAdd',
  'aggrega/registryRemove',
];

// NOT_A_CONFIGURATION_WRITE is the one request that changes state on this
// machine and writes no configuration file, and it is the control on the other
// side of the rule: a reading that found it inside the hand-over would be
// restarting the server after a change the server does not read.
export const NOT_A_CONFIGURATION_WRITE = 'aggrega/logout';

// DIRECT_RESTARTS are the ways a function could restart the language server
// without the watch deciding it: the one restart implementation, the command
// that reaches it, and the transport's own restart.
export const DIRECT_RESTARTS: readonly string[] = [
  'replaceLanguageServer(',
  'RESTART_COMMAND',
  'daemon.restart(',
];

// RequestSite is one request method named in the source: the method, the
// top-level function it is sent from, that function's body, how many times the
// function hands a write to the watch, and whether the method is sent from
// inside that hand-over.
export interface RequestSite {
  method: string;
  fn: string | null;
  body: string;
  ownWrites: number;
  handedOver: boolean;
}

// methodLiteral matches a request method as the extension spells one when it
// sends it. It is built fresh per call, because a global expression carries a
// lastIndex and a shared one would make a reading depend on the order the specs
// happened to run in.
function methodLiteral(): RegExp {
  return /'(aggrega\/[A-Za-z]+)'/g;
}

// topLevelFunction matches a function declared at the head of a line, which is
// how this extension declares every function a request is sent from.
function topLevelFunction(): RegExp {
  return /\n(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
}

// callExtent returns the text of the call that opens at `at` (the index of its
// name) up to its matching close parenthesis, or null where it does not close.
//
// 🔴 IT COUNTS PARENTHESES AND KNOWS NOTHING ABOUT STRINGS, which is why the
// spec asserts, for every site it reads, that the extent reaches the answer
// reader every hand-over ends with; an extent that stopped short fails that
// reading rather than quietly reporting a method as outside the call.
export function callExtent(text: string, at: number): string | null {
  const open = text.indexOf('(', at);
  if (open < 0) { return null; }
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') { depth++; }
    if (text[i] === ')') {
      depth--;
      if (depth === 0) { return text.slice(at, i + 1); }
    }
  }
  return null;
}

// enclosingFunction finds the top-level function whose body holds `index`, or
// null where no declared function holds it.
function enclosingFunction(source: string, index: number): { fn: string; body: string } | null {
  let best: { fn: string; start: number } | null = null;
  for (const m of source.matchAll(topLevelFunction())) {
    const start = m.index ?? 0;
    if (start > index) { break; }
    best = { fn: m[1], start };
  }
  if (best === null) { return null; }
  const body = blockAfter(source.slice(best.start), `function ${best.fn}`);
  if (body === null) { return null; }
  // The block has to reach the method it is said to hold; one that closed
  // before it holds some other function's text.
  const offset = source.indexOf(`function ${best.fn}`, best.start);
  if (offset + body.length <= index) { return null; }
  return { fn: best.fn, body };
}

// requestSites reads every request method named in a source, in the order it is
// named.
export function requestSites(source: string): RequestSite[] {
  const sites: RequestSite[] = [];
  for (const m of source.matchAll(methodLiteral())) {
    const index = m.index ?? 0;
    const found = enclosingFunction(source, index);
    if (found === null) {
      sites.push({ method: m[1], fn: null, body: '', ownWrites: 0, handedOver: false });
      continue;
    }
    const ownWrites = found.body.split(OWN_WRITE).length - 1;
    let handedOver = false;
    for (let at = found.body.indexOf(OWN_WRITE); at >= 0; at = found.body.indexOf(OWN_WRITE, at + 1)) {
      const call = callExtent(found.body, at);
      if (call !== null && call.includes(`'${m[1]}'`)) { handedOver = true; }
    }
    sites.push({ method: m[1], fn: found.fn, body: found.body, ownWrites, handedOver });
  }
  return sites;
}

// literalCount reports how many times one method is named across a set of
// sources, so a second sender of a write in another module is visible.
export function literalCount(sources: ReadonlyArray<readonly [string, string]>, method: string): Array<[string, number]> {
  const counts: Array<[string, number]> = [];
  for (const [file, source] of sources) {
    const n = source.split(`'${method}'`).length - 1;
    if (n > 0) { counts.push([file, n]); }
  }
  return counts;
}
