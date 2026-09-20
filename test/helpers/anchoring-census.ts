// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { EXTENSION_ROOT } from './launch-census';

// This helper is the one home of the anchoring census: which of the window's two
// facts each wiring site routes.
//
// 🔴 IT EXISTS BECAUSE THE SITES IT MEASURES CANNOT BE DRIVEN HERE. The modules
// holding them import the editor, which does not start in a headless run, so the
// wiring between "which value is computed" and "which surface receives it" is
// reachable by no spec that calls a function. What IS reachable is the source
// itself, and reading it is what keeps the routing a measured claim rather than
// an unwitnessed one. The behavioural half — that the value routed here is the
// value that reaches the wire — is driven separately against a real client.
//
// The readings below are EQUALITIES rather than presences, for the reason the
// launch census states about its own: a presence passes while any one of several
// sites survives, and a total cannot say which site a value sits at. An equality
// is also its own control — a reading whose extraction stopped working returns an
// empty list, and an empty list is not the recorded shape, so the comparison
// refuses it and names what it expected.

function sourceOf(relativePath: string): string {
  return fs.readFileSync(path.join(EXTENSION_ROOT, relativePath), 'utf8');
}

// balancedFrom returns the substring running from the opening bracket at `open`
// to its matching close, exclusive of both.
//
// It is a scan rather than a pattern because the arguments being read span
// lines and carry nested calls of their own, and a regular expression that
// stopped at the first close parenthesis would report a call's first argument as
// its whole argument list — a reading that is wrong in exactly the direction
// that passes.
function balancedFrom(source: string, open: number, openCh: string, closeCh: string): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === openCh) { depth += 1; continue; }
    if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) { return source.slice(open + 1, i); }
    }
  }
  throw new Error(`unbalanced ${openCh} at offset ${open}`);
}

// splitTopLevel splits an argument list on the commas that belong to it,
// ignoring commas nested inside a call, an object literal or an array.
function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if (ch === '(' || ch === '{' || ch === '[') { depth += 1; }
    if (ch === ')' || ch === '}' || ch === ']') { depth -= 1; }
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim() !== '') { out.push(current); }
  return out.map(normalise).filter((a) => a !== '');
}

// normalise reduces one argument expression to its text with comments and
// line breaks removed, so a reading is about which value is passed rather than
// about how the call happens to be laid out.
function normalise(expression: string): string {
  return expression
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// callArguments reports the argument expressions of every direct call of one
// callee in one module, in source order.
export function callArguments(relativePath: string, callee: string): string[][] {
  const source = sourceOf(relativePath);
  const calls: string[][] = [];
  const marker = new RegExp(`(?:^|[^A-Za-z0-9_$.])${callee.replace(/\./g, '\\.')}\\s*\\(`, 'g');
  for (const match of source.matchAll(marker)) {
    const open = source.indexOf('(', match.index + match[0].length - 1);
    calls.push(splitTopLevel(balancedFrom(source, open, '(', ')')));
  }
  return calls;
}

// functionBody returns the body of the function whose declaration begins with
// `header`, so a reading can be scoped to one function rather than to a module.
export function functionBody(relativePath: string, header: string): string {
  const source = sourceOf(relativePath);
  const at = source.indexOf(header);
  if (at < 0) {
    throw new Error(`no function beginning "${header}" in ${relativePath}`);
  }
  return balancedFrom(source, source.indexOf('{', at + header.length), '{', '}');
}

// ANCHORING_FACTS is the pair of fields the window's anchoring carries. Naming
// them as a closed set is what makes "each site routes one of them" a claim
// about the pair rather than about whichever spelling a site happened to use.
export const ANCHORING_FACTS: readonly string[] = ['openedFolder', 'workspaceRoot'];

// anchoringAssignments reports which module-level value each field of the
// window's anchoring is assigned to, as [target, field] pairs.
//
// It is the reading that catches a COLLAPSE — the two targets taking one field —
// which is the change that makes a window opened on a subdirectory report its
// two rows as one place.
export function anchoringAssignments(relativePath: string): Array<[string, string]> {
  const source = sourceOf(relativePath);
  const pattern = /^\s*([A-Za-z_$][\w$]*)\s*=\s*anchoring\.([\w$]+)\s*;/gm;
  return [...source.matchAll(pattern)]
    .map((m) => [m[1], m[2]] as [string, string])
    .sort();
}

// assignmentsTo reports every expression assigned to one module-level value, in
// source order.
//
// 🔴 IT EXISTS BECAUSE AN ABSENCE READING OVER ONE TOKEN IS NOT A CLAIM ABOUT
// WHERE A VALUE CAME FROM. Asserting that a function does not mention the
// anchoring passes while the same fact arrives through a module-level value the
// anchoring had already been assigned to — measured by planting exactly that and
// watching the reading stay green. An equality over every right-hand side cannot
// be evaded that way: a second assignment is a second entry whatever it names.
//
// A declaration is not an assignment here. The pattern requires the name to open
// its line, and a declaration opens with its binding keyword — so the initial
// value a module-level value is declared with is deliberately out of scope,
// because what this measures is what later writes to it.
export function assignmentsTo(relativePath: string, target: string): string[] {
  const source = sourceOf(relativePath);
  const pattern = new RegExp(`^[ \\t]*${target}\\s*=\\s*([^;]+);`, 'gm');
  return [...source.matchAll(pattern)].map((m) => normalise(m[1]));
}

// nulledIn reports which module-level values one function sets to null, so the
// claim that the window's two facts are dropped together is measured rather than
// assumed.
export function nulledIn(relativePath: string, header: string): string[] {
  const body = functionBody(relativePath, header);
  return [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*=\s*null\s*;/gm)]
    .map((m) => m[1])
    .sort();
}
