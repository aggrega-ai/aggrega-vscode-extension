// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { PublishDiagnosticsParams } from '../../src/types';
import { cliEnvironment, ScratchHome } from './cli';
import { ProcessTable } from './processes';
import { guard } from './workbench';

// The compiler's own answer to a request, taken outside the editor.
//
// Where a check's expectation is partly the server's words, the check holds what
// the editor shows against the server's answer to the same request, and never
// against a sentence typed into the suite: the server's wording is its own to
// change, and what the suite verifies is that the extension carried it untouched.

export type ReferenceAnswer =
  | { ok: true; result: unknown; published?: Publication[] }
  | { ok: false; error: { code: unknown; message: string; data: unknown }; published?: Publication[] };

// Publication is one finding list the server published while the request was
// answered, in the published shape it is sent in: present on the answer only
// where it was asked for.
export type Publication = PublishDiagnosticsParams;

// shortCodeOf is the short code a refusal's data names for the condition the
// refusal reports, or null where it names none.
export function shortCodeOf(data: unknown): string | null {
  const named = (data as { shortCode?: unknown } | null)?.shortCode;
  return typeof named === 'string' && named !== '' ? named : null;
}

// ReferenceRequest is one request the reference child sends, by its method and
// its parameters.
export interface ReferenceRequest { method: string; params: unknown }

// referenceAnswer runs the reference child with the scenario's environment,
// records it and the server it starts in the scenario's process table, and
// returns what the server answered.
//
// first names requests sent to the same server ahead of the one asked, in
// order, whose answers are not returned: a request about a position in a
// document is answered only once the server has validated that document, so the
// validation the editor sends as the document opens is sent first here too.
//
// published asks for the finding lists the server published while it answered
// the request asked, beside the answer.
export function referenceAnswer(opts: {
  binary: string;
  root: string;
  method: string;
  params: unknown;
  first?: ReferenceRequest[];
  buildOnInspect?: boolean;
  published?: boolean;
  home: ScratchHome;
  table: ProcessTable;
  log: string;
  boundMs?: number;
}): Promise<ReferenceAnswer> {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'reference-answer.js');
    const args = [script, opts.binary, opts.root, opts.method, JSON.stringify(opts.params)];
    if (opts.buildOnInspect) { args.push('--build-on-inspect'); }
    if (opts.first !== undefined && opts.first.length > 0) { args.push('--first', JSON.stringify(opts.first)); }
    if (opts.published) { args.push('--published'); }
    const child = spawn(process.execPath, args, { cwd: opts.root, env: cliEnvironment(opts.home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid !== undefined) {
      try { opts.table.addRoot('reference', child.pid); } catch { /* already gone */ }
    }
    let stdout = '';
    let stderr = '';
    const sample = setInterval(() => { opts.table.snapshot(); }, 100);
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    // The bound is a deadlock guard, as every wait's is (workbench.ts `guard`).
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, guard(opts.boundMs ?? 60000));
    child.on('close', () => {
      clearTimeout(timer);
      clearInterval(sample);
      fs.appendFileSync(opts.log, `reference ${opts.method} ${JSON.stringify(opts.params).slice(0, 400)}\n${stdout}${stderr}\n`);
      const line = stdout.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line) as ReferenceAnswer);
      } catch {
        resolve({ ok: false, error: { code: null, message: `the reference child printed no answer: ${stderr.trim().slice(0, 300)}`, data: null } });
      }
    });
  });
}
