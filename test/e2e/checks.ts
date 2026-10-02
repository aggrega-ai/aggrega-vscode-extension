// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { RanOut, ranOutMark, ranOutSince, WaitExpired } from './workbench';

// A check, and what it reports.
//
// 🔴 FOUR OUTCOMES, AND "NOT RUN" IS NEVER COUNTED AS PASSED. A check passes or
// fails on what it saw against what was expected; it is not run where its
// precondition could not be built or reached, and it says which; and where the
// judgement is a person's, the check stops at that state and leaves a capture and
// the drawn text for them, neither passing nor failing it. A check skipped and a
// check that worked are the same shape in a summary and opposite in truth.

export type Verdict = 'passed' | 'failed' | 'not run' | 'for a person';

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

  notRun(name: string, meta: CheckMeta, reason: string): CheckResult {
    return this.keep({ scenario: this.scenario, name, ...meta, verdict: 'not run', seen: '', reason, elapsedMs: 0 });
  }

  // reportUnrun reports as not run a check the scenario names that never
  // reported. It ends nothing: it is how a scenario that has already ended
  // accounts for the rest of its checks.
  reportUnrun(name: string, reason: string): void {
    this.results.push({ scenario: this.scenario, name, expected: '', plant: '', verdict: 'not run', seen: '', reason, elapsedMs: 0 });
  }

  // forPerson leaves a judgement for a person: a capture of the state the check
  // stopped at and the text drawn there.
  async forPerson(name: string, meta: CheckMeta & { question: string }, capture: () => Promise<{ screenshot: string | null; drawnText: string }>): Promise<CheckResult> {
    const t0 = Date.now();
    const mark = ranOutMark();
    let r: CheckResult;
    try {
      const c = await capture();
      r = { scenario: this.scenario, name, expected: meta.expected, plant: meta.plant, verdict: 'for a person', seen: 'left for a person to judge', elapsedMs: Date.now() - t0, forPerson: { question: meta.question, ...c } };
    } catch (err) {
      r = { scenario: this.scenario, name, expected: meta.expected, plant: meta.plant, verdict: 'not run', seen: '', reason: err instanceof NotRun ? err.message : `the state could not be captured: ${err instanceof Error ? err.message : String(err)}`, elapsedMs: Date.now() - t0 };
    }
    return this.keep(withRanOut(r, mark));
  }

  passed(name: string): boolean {
    return this.results.some((r) => r.name === name && r.verdict === 'passed');
  }
}

// tally counts results by verdict.
export function tally(results: CheckResult[]): Record<Verdict, number> {
  const t: Record<Verdict, number> = { 'passed': 0, 'failed': 0, 'not run': 0, 'for a person': 0 };
  for (const r of results) { t[r.verdict]++; }
  return t;
}
