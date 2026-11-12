// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// This helper is the one home of reading a panel's stylesheet rule by rule, so
// every spec asserting what a panel is drawn through reads a rule the same way.
// A second copy of the parse would agree on the day it was written and would
// then be the only one some spec consulted.
//
// These stylesheets carry no at-rule of any kind, so a rule is a selector list
// and a flat body, and there is no nesting to walk.

// cssRuleBody returns the body of the rule whose selector list names exactly
// the selector given, or null where no rule does.
//
// 🔴 EXACTLY, NOT AS A SUBSTRING. A rule for `.step-value-absent` contains the
// text of `.step-value`, so a substring match would read one rule's body as the
// other's and an assertion about the value's own treatment would pass on a rule
// about something else. Comments are dropped first, because these stylesheets
// carry their reasoning in prose that names selectors.
export function cssRuleBody(css: string, selector: string): string | null {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) { return match[2]; }
  }
  return null;
}

// declarationOf returns the value one rule body declares for one property, or
// null where it declares none.
//
// 🔴 THE PROPERTY IS MATCHED WHOLE. `flex` is how `flex-wrap` and
// `flex-direction` begin, so a match on the name's text would read one
// declaration's value as another's — and an assertion that an item never
// shrinks would pass on a rule that says nothing about shrinking.
export function declarationOf(body: string, property: string): string | null {
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) { continue; }
    if (declaration.slice(0, colon).trim() === property) {
      return declaration.slice(colon + 1).trim();
    }
  }
  return null;
}
