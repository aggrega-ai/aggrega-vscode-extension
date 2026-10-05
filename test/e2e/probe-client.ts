// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { until } from './workbench';

// The runner's side of the probe: one JSON request per call, over the loopback
// port the probe was handed.

// Hello is the probe's answer about itself. `instance` changes every time the
// extension host starts it, which is how a reload is told apart from no reload.
export interface Hello {
  pid: number;
  instance: string;
  activatedAt: string;
  editorVersion: string;
}

// DiagnosticEntry is one diagnostic as the probe lists it.
export interface DiagnosticEntry {
  message: string;
  source: string | null;
  code: string | null;
  // codeTarget is where the code leads when pressed, or null where it leads
  // nowhere.
  codeTarget: string | null;
  severity: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export class ProbeClient {
  constructor(readonly port: number) {}

  // request sends one request and returns its result, or throws with the probe's
  // own sentence when it refused or failed.
  async request<T>(op: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json() as { ok: boolean; result?: T; error?: string };
    if (!body.ok) { throw new Error(`probe ${op}: ${body.error ?? `HTTP ${res.status}`}`); }
    return body.result as T;
  }

  // waitHello polls until the probe answers, and returns its answer, for at most
  // the guard of `boundMs` (workbench.ts). With `notInstance` it waits for an
  // answer from a different start of the probe, which is what a reload produces.
  waitHello(boundMs: number, notInstance?: string): Promise<Hello> {
    const what = notInstance === undefined ? 'the probe answering' : `the probe answering from a start other than ${notInstance}`;
    return until(what, boundMs, () => this.request<Hello>('hello', {}, 2000), (hello) => notInstance === undefined || hello.instance !== notInstance, 100);
  }
}
