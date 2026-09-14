// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { OPERATION_GROUPS, OperationsLayout } from '../../src/operation-groups';
import { OperationsBody, operationsBodyHtml } from '../../src/operations-render';
import { NOTHING_MET, STEP_IDS, StepId, stepStandings } from '../../src/get-started-steps';
import { selectorRows } from '../../src/selector-rows';
import { welcomeDocumentHtml } from '../../src/welcome-render';

// The `hidden` attribute is how every panel here puts something away: a closed
// menu, a choice the reader's typing has narrowed out, a collapsed group, a
// collapsed explanation. The attribute suppresses drawing through ONE rule, the
// browser's own `[hidden] { display: none }` — and any `display` a stylesheet in
// this repository declares outranks that rule whatever its specificity, because
// a page's own stylesheet always beats the browser's built-in one.
//
// So an element given a layout of its own is marked closed and drawn anyway. A
// test that reads the composed markup cannot see this: the markup carries the
// attribute, and the attribute is correct. The cascade is where it is lost.
//
// This check therefore reads the stylesheets rather than the markup. It DERIVES
// which classes the scripts put away through the `hidden` property — never a
// list written here, which is what would go stale when the eighth menu arrives —
// and requires of every one of them either no `display` of its own, or a paired
// `[hidden]` rule that sets `display: none`.

const MEDIA = path.join(__dirname, '..', '..', '..', 'media');

// --- what the derivation understands -------------------------------------
//
// The receiver of a `hidden` assignment is resolved back to the selector it was
// obtained from. The forms below are the ones these scripts use. 🔴 A receiver
// matching none of them FAILS THIS TEST BY NAME rather than being skipped: a
// resolver that silently drops what it does not recognise would shrink the
// derived set as the code grows, and a shrinking set is the vacuous green this
// check exists to prevent.

interface Assignment {
  readonly file: string;
  readonly line: number;
  readonly receiver: string;
}

// hiddenAssignments finds every place a script sets the `hidden` PROPERTY.
//
// The property is the whole subject here. An element hidden by a CSS class that
// happens to be called `hidden` is a different mechanism with no browser rule
// behind it, and is deliberately out of scope.
function hiddenAssignments(file: string, source: string): Assignment[] {
  const found: Assignment[] = [];
  source.split('\n').forEach((text, index) => {
    const pattern = /([A-Za-z_$][\w$]*)\.hidden\s*=[^=]/g;
    let match = pattern.exec(text);
    while (match !== null) {
      found.push({ file, line: index + 1, receiver: match[1] });
      match = pattern.exec(text);
    }
  });
  return found;
}

// selectorsFor resolves one identifier to the selectors its value can hold.
//
// It walks assignments and `forEach` bindings, following a local helper into its
// `return` and a bare identifier into its own assignments. The visited set is
// what makes a mutable module variable resolvable at all: the open-menu variable
// is assigned from a lookup in one function and re-read into a local in another,
// which is a cycle a naive walk would not survive.
function selectorsFor(
  identifier: string,
  source: string,
  visited: Set<string>,
): { selectors: string[]; idRoutes: string[] } {
  if (visited.has(identifier)) { return { selectors: [], idRoutes: [] }; }
  visited.add(identifier);

  const selectors: string[] = [];
  const idRoutes: string[] = [];
  const origins: string[] = [];

  // `x = <expr>` — a declaration or a later assignment. Both matter: a module
  // variable declared null and assigned later is the shape the open menu uses.
  const assigned = new RegExp(
    `(?:const|let|var)?\\s*\\b${identifier}\\s*=\\s*([^;\\n]+)`,
    'g',
  );
  let match = assigned.exec(source);
  while (match !== null) {
    origins.push(match[1]);
    match = assigned.exec(source);
  }

  // `<expr>.forEach((x) => …)` — the identifier is each element of <expr>.
  const iterated = new RegExp(
    `([A-Za-z_$][\\w$]*(?:\\([^()]*\\))?)\\s*\\.forEach\\(\\s*(?:function\\s*)?\\(?\\s*${identifier}\\b`,
    'g',
  );
  match = iterated.exec(source);
  while (match !== null) {
    origins.push(match[1]);
    match = iterated.exec(source);
  }

  for (const origin of origins) {
    // A selector literal, which may be a comma-separated list.
    const queried = /querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)/g;
    let hit = queried.exec(origin);
    while (hit !== null) {
      hit[1].split(',').forEach((one) => selectors.push(one.trim()));
      hit = queried.exec(origin);
    }

    // An id lookup. Two routes appear: an id composed from a literal prefix,
    // and an id read from an `aria-controls` attribute.
    const byId = /getElementById\(\s*([^)]*)\)/g;
    hit = byId.exec(origin);
    while (hit !== null) {
      const argument = hit[1];
      const prefix = /['"]([\w-]+-)['"]\s*\+/.exec(argument);
      if (prefix) {
        idRoutes.push(`prefix:${prefix[1]}`);
      } else if (argument.includes('aria-controls')) {
        idRoutes.push('aria-controls');
      } else {
        idRoutes.push(`unresolved:${argument.trim()}`);
      }
      hit = byId.exec(origin);
    }

    // A local helper — follow it into its `return`.
    const called = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(origin);
    if (called && !['getElementById', 'querySelector', 'querySelectorAll'].includes(called[1])) {
      const body = new RegExp(`function\\s+${called[1]}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source);
      if (body) {
        const returned = /return\s+([\s\S]*?);/.exec(body[1]);
        if (returned) {
          const inner = /querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)/g;
          let deep = inner.exec(returned[1]);
          while (deep !== null) {
            deep[1].split(',').forEach((one) => selectors.push(one.trim()));
            deep = inner.exec(returned[1]);
          }
        }
      }
    }

    // A bare identifier — follow it.
    const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(origin);
    if (bare) {
      const deeper = selectorsFor(bare[1], source, visited);
      selectors.push(...deeper.selectors);
      idRoutes.push(...deeper.idRoutes);
    }
  }

  return { selectors, idRoutes };
}

// --- the markup a selector is resolved against ---------------------------

interface Element {
  readonly id: string | null;
  readonly classes: readonly string[];
  readonly attributes: string;
}

// elementsIn indexes every tag in a composed document. The markup is composed by
// this repository's own renderers rather than written here, so the index is what
// a reader is actually shown.
function elementsIn(html: string): Element[] {
  const found: Element[] = [];
  const tag = /<([a-z]+)\s+([^>]*)>/g;
  let match = tag.exec(html);
  while (match !== null) {
    const attributes = match[2];
    const cls = /class="([^"]*)"/.exec(attributes);
    const id = /\sid="([^"]*)"/.exec(attributes);
    found.push({
      id: id ? id[1] : null,
      classes: cls ? cls[1].split(/\s+/).filter((c) => c !== '') : [],
      attributes,
    });
    match = tag.exec(html);
  }
  return found;
}

// classesMatching resolves one selector to the classes its elements carry.
//
// Only the two selector shapes these scripts use are resolved: an attribute
// selector, and a class selector. Anything else fails the test by name for the
// same reason an unresolved receiver does.
function classesMatching(selector: string, elements: Element[]): string[] {
  const attribute = /^\[([\w-]+)\]$/.exec(selector);
  if (attribute) {
    return elements
      .filter((el) => new RegExp(`(?:^|\\s)${attribute[1]}(?:[=\\s]|$)`).test(el.attributes))
      .flatMap((el) => el.classes);
  }
  const cls = /^\.([\w-]+)$/.exec(selector);
  if (cls) { return elements.some((el) => el.classes.includes(cls[1])) ? [cls[1]] : []; }
  return [`UNRESOLVED-SELECTOR:${selector}`];
}

// classesForIdRoute resolves an id-shaped lookup to the classes it can reach.
//
// 🔴 BOUND, stated because an unstated bound reads as precision: the
// `aria-controls` route resolves to EVERY element the document points at with
// that attribute, which can be broader than the controls one call site handles.
// The over-approximation is deliberate and its direction is the safe one — a
// broader set makes this check stricter, so the failure mode is a loud false
// alarm rather than a silent miss.
function classesForIdRoute(route: string, html: string, elements: Element[]): string[] {
  if (route === 'aria-controls') {
    const targets = new Set<string>();
    const pattern = /aria-controls="([^"]*)"/g;
    let match = pattern.exec(html);
    while (match !== null) { targets.add(match[1]); match = pattern.exec(html); }
    return elements.filter((el) => el.id !== null && targets.has(el.id)).flatMap((el) => el.classes);
  }
  const prefix = /^prefix:(.+)$/.exec(route);
  if (prefix) {
    return elements
      .filter((el) => el.id !== null && el.id.startsWith(prefix[1]))
      .flatMap((el) => el.classes);
  }
  return [`UNRESOLVED-ID-ROUTE:${route}`];
}

// --- the stylesheets ------------------------------------------------------

interface Rule {
  readonly file: string;
  readonly selectors: readonly string[];
  readonly body: string;
}

// rulesIn reads the flat rules out of a stylesheet. These stylesheets carry no
// at-rule of any kind — measured, not assumed — so there is no nesting to walk.
function rulesIn(file: string, css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match !== null) {
    found.push({
      file,
      selectors: match[1].split(',').map((s) => s.trim()).filter((s) => s !== ''),
      body: match[2],
    });
    match = pattern.exec(withoutComments);
  }
  return found;
}

// subjectOf reports the compound selector a rule actually applies to — its last
// part. A rule reading `.op-menu-dial .op-menu-detail` styles the detail, not
// the dial, so the dial must not be judged by it.
function subjectOf(selector: string): string {
  const parts = selector.split(/\s+|>|\+|~/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

function declaresDisplay(rule: Rule): boolean {
  return /(?:^|;|\s)display\s*:/.test(rule.body);
}

function displayValue(rule: Rule): string | null {
  const match = /(?:^|;|\s)display\s*:\s*([^;]+)/.exec(rule.body);
  return match ? match[1].trim() : null;
}

// --- the derivation, run once --------------------------------------------

// EVERY_LAYOUT is a Record over the arrangement type, so the type checker
// requires an entry for each one. A new arrangement therefore fails to compile
// here rather than being quietly left out of the index — which is exactly the
// hole that has to stay closed: the group body is composed in ONE of the two
// arrangements only, so a check that indexes a single arrangement resolves that
// element to nothing and reports a smaller set, with nothing to say anything is
// missing.
const EVERY_LAYOUT: Record<OperationsLayout, true> = { buttons: true, sections: true };

function operationsHtml(): string {
  const anchored = '/work/demo';
  const base: Omit<OperationsBody, 'layout'> = {
    selectors: selectorRows(anchored, anchored, {
      kind: 'selected',
      release: 'releases/prod.yaml',
      absolute: '/work/demo/releases/prod.yaml',
    }),
    unavailable: {},
    collapsed: [],
    focused: null,
    dials: [],
  };
  // Every arrangement, each with every group open and then every group
  // collapsed, so an element the renderer emits in only one of those states is
  // still in the index. The collapsed set is read off the layout rather than
  // written here.
  const collapsed = OPERATION_GROUPS.map((g) => g.id);
  return (Object.keys(EVERY_LAYOUT) as OperationsLayout[])
    .flatMap((layout) => [
      operationsBodyHtml({ ...base, layout }),
      operationsBodyHtml({ ...base, layout, collapsed }),
    ])
    .join('\n');
}

function welcomeHtml(): string {
  const standings = stepStandings(NOTHING_MET);
  const open = welcomeDocumentHtml({
    nonce: 'test-nonce',
    styleUri: 'vscode-resource://media/welcome.css',
    scriptUri: 'vscode-resource://media/welcome.js',
    cspSource: 'vscode-resource:',
    standings,
    collapsed: [],
    opensWithEditor: true,
  });
  const closed = welcomeDocumentHtml({
    nonce: 'test-nonce',
    styleUri: 'vscode-resource://media/welcome.css',
    scriptUri: 'vscode-resource://media/welcome.js',
    cspSource: 'vscode-resource:',
    standings,
    collapsed: STEP_IDS as readonly StepId[],
    opensWithEditor: true,
  });
  return open + closed;
}

// documentFor pairs a script with the document it runs in, so a selector is
// resolved against the markup that script actually meets.
function documentFor(script: string): string {
  if (script === 'welcome.js') { return welcomeHtml(); }
  return operationsHtml();
}

interface Derived {
  readonly classes: Set<string>;
  readonly unresolved: string[];
  readonly perAssignment: { assignment: Assignment; classes: string[] }[];
}

function derive(): Derived {
  const classes = new Set<string>();
  const unresolved: string[] = [];
  const perAssignment: { assignment: Assignment; classes: string[] }[] = [];

  const scripts = readdirSync(MEDIA).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.length > 0, 'no panel scripts were found, so nothing was searched');

  for (const script of scripts) {
    const source = readFileSync(path.join(MEDIA, script), 'utf8');
    const assignments = hiddenAssignments(script, source);
    if (assignments.length === 0) { continue; }

    const html = documentFor(script);
    const elements = elementsIn(html);

    for (const assignment of assignments) {
      const { selectors, idRoutes } = selectorsFor(assignment.receiver, source, new Set());
      if (selectors.length === 0 && idRoutes.length === 0) {
        unresolved.push(
          `${assignment.file}:${assignment.line} — the receiver "${assignment.receiver}" `
          + 'was not resolved to a selector by any form this check understands',
        );
        continue;
      }
      const reached = [
        ...selectors.flatMap((s) => classesMatching(s, elements)),
        ...idRoutes.flatMap((r) => classesForIdRoute(r, html, elements)),
      ];
      for (const cls of reached) {
        if (cls.startsWith('UNRESOLVED')) {
          unresolved.push(`${assignment.file}:${assignment.line} — ${cls}`);
        } else {
          classes.add(cls);
        }
      }
      perAssignment.push({ assignment, classes: [...new Set(reached)] });
    }
  }

  return { classes, unresolved, perAssignment };
}

function allRules(): Rule[] {
  return readdirSync(MEDIA)
    .filter((f) => f.endsWith('.css'))
    .flatMap((f) => rulesIn(f, readFileSync(path.join(MEDIA, f), 'utf8')));
}

describe('a class the panels put away through the hidden attribute is not drawn', () => {
  it('resolves every hidden assignment in every panel script', () => {
    const { unresolved, perAssignment } = derive();
    assert.deepStrictEqual(
      unresolved,
      [],
      'a hidden assignment was not resolved to a class. This check cannot judge what '
      + 'it cannot resolve, so an unresolved receiver is a failure rather than a skip — '
      + 'teach the resolver the new form, or the derived set shrinks silently as the '
      + 'panels grow',
    );
    assert.ok(
      perAssignment.length > 0,
      'no hidden assignment was found in any panel script, which would make every '
      + 'assertion below vacuous',
    );
  });

  it('derives a non-empty set of classes put away through the attribute', () => {
    // 🔴 REFUSAL ON AN EMPTY DERIVATION. An empty set satisfies the rule below
    // for free, so a derivation that silently stopped working would leave this
    // suite green while checking nothing at all.
    const { classes, perAssignment } = derive();
    assert.ok(
      classes.size > 0,
      'the derivation produced no classes, so the cascade rule below would pass '
      + 'vacuously — the derivation itself is broken',
    );
    // The census is PRINTED rather than only asserted, because a check whose
    // scope nobody can see is one nobody can weigh against what it caught. A
    // reader comparing two runs sees the set grow when a panel grows.
    /* eslint-disable no-console */
    console.log(
      `      derived ${classes.size} class(es) from ${perAssignment.length} `
      + `assignment(s): ${[...classes].sort().join(', ')}`,
    );
    /* eslint-enable no-console */
  });

  it('declares no display of its own, or pairs it with a hidden rule that removes it', () => {
    // THE CRITERION, stated here because a count without one is unfalsifiable:
    // for every class the panel scripts put away through the `hidden` property,
    // either no rule whose subject is that class declares `display`, or some
    // rule whose subject is that class together with `[hidden]` sets
    // `display: none`.
    const { classes } = derive();
    const rules = allRules();
    const offenders: string[] = [];

    for (const cls of [...classes].sort()) {
      const subjects = rules.filter((r) => r.selectors.some((s) => {
        const subject = subjectOf(s);
        return subject.startsWith(`.${cls}`)
          && /^(?:\[|:|$)/.test(subject.slice(cls.length + 1));
      }));
      const layout = subjects.filter((r) => r.selectors.some((s) => {
        const subject = subjectOf(s);
        return subject === `.${cls}`;
      }) && declaresDisplay(r));
      if (layout.length === 0) { continue; }

      const paired = subjects.filter((r) => r.selectors.some(
        (s) => subjectOf(s) === `.${cls}[hidden]`,
      ) && displayValue(r) === 'none');

      if (paired.length === 0) {
        offenders.push(
          `.${cls} declares "display: ${displayValue(layout[0])}" in `
          + `${layout[0].file} but no ".${cls}[hidden]" rule removes it, so an element `
          + 'of that class is marked closed and drawn anyway',
        );
      }
    }

    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });
});
