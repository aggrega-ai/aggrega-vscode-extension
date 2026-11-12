// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { readSourceTree } from './launch-census';

// This helper is the one home of the census over what can make the editor work
// in a different folder.
//
// 🔴 WHAT IT MEASURES IS A CONSEQUENCE RATHER THAN A CALL. Opening a folder
// takes the window down and stands it back up: this extension and the language
// server both restart, and anything unsaved in the window is at risk. Nothing
// else this extension does reaches past the window it is drawn in, so the rule
// worth holding is that the act happens on a reader's press and on no other
// path — not that some particular function is called carefully.
//
// 🔴 IT EXISTS BECAUSE THE SITES IT MEASURES CANNOT BE DRIVEN HERE. The module
// that reaches the editor imports the editor, which does not start in a headless
// run, so nothing here can call it. What IS reachable is the source, and reading
// it is what keeps "no path reaches this without a press" a measured claim
// rather than an unwitnessed one. The half that CAN be driven — what the press
// composes — is driven against the pure decision it composes from.
//
// Every reading below is an EQUALITY rather than a presence, for the reason the
// launch census states about its own: a presence passes while any one of several
// sites survives, and a total cannot say which module a site sits in. An
// equality is also its own control — a reading whose extraction stopped working
// returns an empty list, and an empty list is not the recorded shape.

// withoutCommentLines drops the lines that are wholly a comment, so a count of
// where a name is USED is not moved by an edit to the prose about it.
//
// 🔴 IT DROPS WHOLE LINES AND NOTHING ELSE, which is what keeps it from
// damaging a string: a trailing comment after code survives, and so does a `//`
// inside a URL. The modules it reads write every explanation as its own lines
// above the thing explained, so the two behave the same way here — and the
// direction of any error is toward counting more rather than fewer, which fails
// an equality rather than passing one.
function withoutCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

// tokenModules reports every module of the extension that names one token, with
// how many times, in source order.
export function tokenModules(token: string): Array<readonly [string, number]> {
  const found: Array<readonly [string, number]> = [];
  for (const [file, source] of readSourceTree()) {
    const count = withoutCommentLines(source).split(token).length - 1;
    if (count > 0) { found.push([file, count] as const); }
  }
  return found;
}

// callSite is one direct call of a callee: the module it sits in and the
// argument expressions it passes.
export interface CallSite {
  module: string;
  args: string[];
}

// callSites reports every direct call of one callee across the whole source
// tree, in source order.
//
// It walks the WHOLE tree rather than the module that holds a call today, and
// that is the difference between a census and a spot check: a second call
// written into a neighbouring module is exactly the change this claim has to
// survive, and a reading confined to one module cannot see it.
//
// 🔴 THE DECLARATION IS NOT A CALL, and it is excluded by the word in front of
// it rather than by the module it sits in. Excluding the declaring module
// instead would blind the census to a second call written in that same module,
// which is a likelier place for one than anywhere else.
export function callSites(callee: string): CallSite[] {
  const marker = new RegExp(
    `(?:^|[^A-Za-z0-9_$.])${callee.replace(/\./g, '\\.')}\\s*\\(`,
    'g',
  );
  const found: CallSite[] = [];
  for (const [file, raw] of readSourceTree()) {
    const source = withoutCommentLines(raw);
    for (const match of source.matchAll(marker)) {
      const nameAt = source.indexOf(callee, match.index ?? 0);
      if (/\bfunction\s+$/.test(source.slice(0, nameAt))) { continue; }
      const open = source.indexOf('(', nameAt + callee.length);
      found.push({ module: file, args: splitTopLevel(balancedFrom(source, open)) });
    }
  }
  return found;
}

// balancedFrom returns the substring running from the parenthesis at `open` to
// its match, exclusive of both. It is a scan rather than a pattern because an
// argument list spans lines and carries nested calls of its own, and a pattern
// stopping at the first close parenthesis would report a call's first argument
// as its whole argument list — wrong in exactly the direction that passes.
function balancedFrom(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') { depth += 1; continue; }
    if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) { return source.slice(open + 1, i); }
    }
  }
  throw new Error(`unbalanced ( at offset ${open}`);
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
  return out.map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a !== '');
}
