// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { RanOut, ranOutMark, ranOutSince, WaitExpired } from './workbench';

// A check, and what it reports.
//
// 🔴 FIVE OUTCOMES, AND NEITHER "NOT RUN" NOR "CANNOT RUN HERE" IS EVER COUNTED AS
// PASSED. A check passes or fails on what it saw against what was expected; it is
// not run where this run could not build or reach its precondition, and it says
// which; it cannot run here where it was declared, before any run, as needing a
// state no run can build, and it carries the reason that declaration states; and
// where the judgement is a person's, the check stops at that state and leaves a
// capture and the drawn text for them, neither passing nor failing it. A check
// skipped and a check that worked are the same shape in a summary and opposite in
// truth.
//
// "Not run" fails the suite: something this run should have built did not hold.
// "Cannot run here" does not: no run could do better, so counting it would keep
// every run red and hide the next real failure behind it. It is a verdict of its
// own rather than "not run" with a mark, so every reader that sorts by verdict —
// the summary's count, a red run's list of what failed or was not run — keeps it
// apart without having to know of the mark.

export type Verdict = 'passed' | 'failed' | 'not run' | 'cannot run here' | 'for a person';

// VERDICTS is every verdict, in the order a summary counts them.
export const VERDICTS: readonly Verdict[] = ['passed', 'failed', 'not run', 'cannot run here', 'for a person'];

// CheckMeta is what a check states before it runs: what it expects, and in
// words the one edit to the scratch copy of the extension or of a fixture that
// must turn it red, so a check nothing can turn red is visible as such. The edit
// itself, the text it replaces and the text it writes, is in the plant catalogue
// (plants.ts), from which a plant run applies it.
export interface CheckMeta {
  expected: string;
  plant: string;
}

export interface CheckResult extends CheckMeta {
  scenario: string;
  name: string;
  verdict: Verdict;
  seen: string;
  reason?: string;
  elapsedMs: number;
  // ranOut lists the waits that ran to their cap while the check ran, where any
  // did; in a check that passed, each is a cap paid for an answer.
  ranOut?: RanOut[];
  evidence?: unknown;
  forPerson?: { question: string; screenshot: string | null; drawnText: string };
}

// A check the suite stops short of deciding is declared once, at module load, so
// that `run.js checklist` lists every one of them without launching anything:
// a Judgement, which a run brings to its state and leaves for a person with what
// it captured; and an Unreachable, whose state no run can build, reported as one
// that cannot run here in every run, with the reason it states. Checks.forPerson
// and Checks.notRun take nothing else, and neither kind can be made but by its
// declare, so a judgement written inline at a check cannot compile and one
// declared inside a running scenario stops it: every such check a scenario
// reaches is in the list.
const declared: (Judgement | Unreachable)[] = [];
let sealed = false;

// DECLARED is carried by every value a declare makes. No other module can name
// it, so an object literal cannot stand in for a declared check — a type with
// public fields alone would accept one, its constructor's privacy aside.
const DECLARED: unique symbol = Symbol('declared at module load');

function register<T extends Judgement | Unreachable>(d: T): T {
  if (sealed) {
    throw new Error(`${d.name} is declared while the suite runs; a check left for a person or never run is declared at module load, where run.js checklist reads it`);
  }
  if (declared.some((x) => x.name === d.name)) { throw new Error(`${d.name} is declared twice`); }
  declared.push(d);
  return d;
}

// Judgement is a check that stops at a state for a person to judge: the state it
// expects to reach, why no plant is made for it, and the question it asks.
export class Judgement implements CheckMeta {
  readonly declared: typeof DECLARED = DECLARED;

  private constructor(readonly name: string, readonly expected: string, readonly plant: string, readonly question: string) {}

  static declare(name: string, meta: CheckMeta & { question: string }): Judgement {
    return register(new Judgement(name, meta.expected, meta.plant, meta.question));
  }
}

// Unreachable is a check whose state no run can build, with the reason.
export class Unreachable implements CheckMeta {
  readonly declared: typeof DECLARED = DECLARED;

  private constructor(readonly name: string, readonly expected: string, readonly plant: string, readonly reason: string) {}

  static declare(name: string, meta: CheckMeta, reason: string): Unreachable {
    return register(new Unreachable(name, meta.expected, meta.plant, reason));
  }
}

// declaredChecks is every Judgement and Unreachable the loaded modules declared,
// in the order they declared them.
export function declaredChecks(): readonly (Judgement | Unreachable)[] {
  return declared;
}

// sealDeclarations ends declaring; the suite calls it as it starts to run.
export function sealDeclarations(): void {
  sealed = true;
}

// withRanOut records on `r` the waits that ran to their cap since `mark`.
function withRanOut(r: CheckResult, mark: number): CheckResult {
  const ran = ranOutSince(mark);
  return ran.length === 0 ? r : { ...r, ranOut: ran };
}

// NotRun stops a check whose precondition does not hold, with the reason.
export class NotRun extends Error {}

// EnoughReported ends a scenario once every check it was asked to watch for has
// reported. A plant run uses it: what a plant is to show is the verdict of the
// checks it was made for, so the checks after them are reported as not run,
// with that reason, rather than run to no purpose.
export class EnoughReported extends Error {}

// need stops the check as not run unless `cond` holds.
export function need(cond: unknown, reason: string): asserts cond {
  if (!cond) { throw new NotRun(reason); }
}

// Outcome is what a check body returns: whether what it saw is what was expected.
export interface Outcome { passed: boolean; seen: string; evidence?: unknown }

// Checks runs one scenario's checks in order and keeps their results.
export class Checks {
  readonly results: CheckResult[] = [];
  private readonly waitingFor: Set<string> | null;

  // endAfter, where given, names the checks after whose results the scenario
  // ends.
  constructor(readonly scenario: string, endAfter?: readonly string[]) {
    this.waitingFor = endAfter === undefined ? null : new Set(endAfter);
  }

  private keep(r: CheckResult): CheckResult {
    this.results.push(r);
    if (this.waitingFor !== null && this.waitingFor.delete(r.name) && this.waitingFor.size === 0) {
      throw new EnoughReported(`every check this run watches for has reported, the last being ${r.name}`);
    }
    return r;
  }

  async run(name: string, meta: CheckMeta, body: () => Promise<Outcome>): Promise<CheckResult> {
    const t0 = Date.now();
    const mark = ranOutMark();
    let r: CheckResult;
    try {
      const o = await body();
      r = { scenario: this.scenario, name, ...meta, verdict: o.passed ? 'passed' : 'failed', seen: o.seen, elapsedMs: Date.now() - t0, evidence: o.evidence };
    } catch (err) {
      if (err instanceof NotRun) {
        r = { scenario: this.scenario, name, ...meta, verdict: 'not run', seen: '', reason: err.message, elapsedMs: Date.now() - t0 };
      } else if (err instanceof WaitExpired) {
        r = { scenario: this.scenario, name, ...meta, verdict: 'failed', seen: `${err.what} did not happen within ${err.boundMs} ms; last reading ${err.last}`, elapsedMs: Date.now() - t0 };
      } else {
        r = { scenario: this.scenario, name, ...meta, verdict: 'failed', seen: `the check stopped: ${err instanceof Error ? err.message : String(err)}`, elapsedMs: Date.now() - t0 };
      }
    }
    return this.keep(withRanOut(r, mark));
  }

  // notRun reports a declared Unreachable as a check that cannot run here, with
  // the reason its declaration states. It is the one way that verdict is made.
  notRun(u: Unreachable): CheckResult {
    return this.keep({ scenario: this.scenario, name: u.name, expected: u.expected, plant: u.plant, verdict: 'cannot run here', seen: '', reason: u.reason, elapsedMs: 0 });
  }

  // reportUnrun reports as not run a check the scenario names that never
  // reported. It ends nothing: it is how a scenario that has already ended
  // accounts for the rest of its checks. A declared Unreachable the scenario
  // stopped before is reported not run like any other: the run stopped, which is
  // this run's failure whatever the check could have done.
  reportUnrun(name: string, reason: string): void {
    this.results.push({ scenario: this.scenario, name, expected: '', plant: '', verdict: 'not run', seen: '', reason, elapsedMs: 0 });
  }

  // forPerson leaves a judgement for a person: a capture of the state the check
  // stopped at and the text drawn there.
  async forPerson(j: Judgement, capture: () => Promise<{ screenshot: string | null; drawnText: string }>): Promise<CheckResult> {
    const t0 = Date.now();
    const mark = ranOutMark();
    let r: CheckResult;
    try {
      const c = await capture();
      r = { scenario: this.scenario, name: j.name, expected: j.expected, plant: j.plant, verdict: 'for a person', seen: 'left for a person to judge', elapsedMs: Date.now() - t0, forPerson: { question: j.question, ...c } };
    } catch (err) {
      r = { scenario: this.scenario, name: j.name, expected: j.expected, plant: j.plant, verdict: 'not run', seen: '', reason: err instanceof NotRun ? err.message : `the state could not be captured: ${err instanceof Error ? err.message : String(err)}`, elapsedMs: Date.now() - t0 };
    }
    return this.keep(withRanOut(r, mark));
  }

  passed(name: string): boolean {
    return this.results.some((r) => r.name === name && r.verdict === 'passed');
  }
}

// tally counts results by verdict.
export function tally(results: readonly { verdict: string }[]): Record<Verdict, number> {
  const t = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const r of results) {
    if ((VERDICTS as readonly string[]).includes(r.verdict)) { t[r.verdict as Verdict]++; }
  }
  return t;
}

// suitePassed is the suite's verdict over its results and the fixtures it could
// not build: no check failed and none was left not run, and every fixture was
// built. A check that cannot run here, or that is left for a person, neither
// passes nor fails it.
export function suitePassed(results: readonly { verdict: string }[], fixturesFailed: number): boolean {
  const t = tally(results);
  return t.failed === 0 && t['not run'] === 0 && fixturesFailed === 0;
}
