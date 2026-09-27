// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { DAEMON_STANDING_WORDS } from '../../src/daemon-status';
import { UiDriver } from './drivers';
import { languageServer } from './editor';
import { DiagnosticEntry, Hello, ProbeClient } from './probe-client';
import { ProcessTable } from './processes';

// The proofs the probe owes before any check reads the extension host through it:
// that it loads beside the extension under test, that every request it answers
// does what it says, that what it reports is what the editor draws, and that it
// comes back after a window reload.

export interface ProofResult {
  subject: string;
  passed: boolean;
  elapsedMs: number;
  evidence: unknown;
  error?: string;
}

export interface ProofContext {
  driver: UiDriver;
  probe: ProbeClient;
  folder: string;
  table: ProcessTable;
  compiler: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function proof(subject: string, run: () => Promise<{ passed: boolean; evidence: unknown }>): Promise<ProofResult> {
  const t0 = Date.now();
  try {
    const { passed, evidence } = await run();
    return { subject, passed, elapsedMs: Date.now() - t0, evidence };
  } catch (err) {
    return { subject, passed: false, elapsedMs: Date.now() - t0, evidence: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function until<T>(what: string, boundMs: number, read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const end = Date.now() + boundMs;
  let last: T | undefined;
  let lastError = '';
  while (Date.now() < end) {
    try {
      last = await read();
      if (done(last)) { return last; }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(150);
  }
  throw new Error(`${what} did not happen within ${boundMs} ms (last ${JSON.stringify(last ?? null).slice(0, 300)}${lastError ? `; ${lastError}` : ''})`);
}

const RUNNING = `Aggrega: ${DAEMON_STANDING_WORDS.running}`;

// LIFECYCLE_READING is the status bar's language-server reading, in the words
// the extension composes it from.
const LIFECYCLE_READING = `(() => {
  const words = ${JSON.stringify(Object.values(DAEMON_STANDING_WORDS))};
  return [...document.querySelectorAll('#workbench\\\\.parts\\\\.statusbar .statusbar-item')].map((e) => (e.innerText || '').trim())
    .find((t) => words.some((w) => t === 'Aggrega: ' + w)) || null;
})()`;

// PROBLEMS_ROWS reads the Problems panel's rows as the workbench draws them.
const PROBLEMS_ROWS = `(() => {
  const panel = document.querySelector('.markers-panel');
  if (!panel) { return null; }
  return [...panel.querySelectorAll('.monaco-list-row')].map((r) => ({
    text: (r.innerText || '').replace(/\\s+/g, ' ').trim(),
    aria: r.getAttribute('aria-label') || '',
  }));
})()`;

interface ProblemsRow { text: string; aria: string }

// matchesRow is whether one drawn Problems row states one diagnostic: its message,
// its source and the position the row prints, which counts from one.
function matchesRow(d: DiagnosticEntry, row: ProblemsRow): boolean {
  const where = `[Ln ${d.range.start.line + 1}, Col ${d.range.start.character + 1}]`;
  const firstLine = d.message.split('\n')[0].replace(/\s+/g, ' ').trim();
  // The row prints the message first, then the source, the code and the
  // position; the whole first line is compared, because two findings about one
  // document commonly share a long prefix.
  return row.text.startsWith(firstLine) && row.text.endsWith(where) &&
    (d.source === null || row.text.includes(` ${d.source} `)) && (d.code === null || row.text.includes(` ${d.code} `));
}

export async function runProbeProofs(ctx: ProofContext): Promise<{ proofs: ProofResult[]; hello: Hello }> {
  const proofs: ProofResult[] = [];
  const hello = await ctx.probe.waitHello(10000);
  const faulty = path.join(ctx.folder, 'faulty-component.yaml');
  const scratchFile = path.join(ctx.folder, 'probe-scratch.txt');
  fs.writeFileSync(scratchFile, 'first line\n');

  proofs.push(await proof('the probe answers from a second development path beside the extension under test', async () => {
    const server = await until('the language server starting', 60000, async () => languageServer(ctx.table, ctx.compiler), (v) => v !== null);
    return { passed: hello.instance !== '' && server !== null, evidence: { hello, languageServer: server } };
  }));

  proofs.push(await proof('every request of the closed set answers, and one outside it is refused by name', async () => {
    const r: Record<string, unknown> = {};
    r.folders = await ctx.probe.request('workspace.folders');
    r.open = await ctx.probe.request('document.open', { path: scratchFile });
    r.edit = await ctx.probe.request('document.edit', { path: scratchFile, start: { line: 0, character: 0 }, text: 'edited ' });
    r.activeAfterEdit = await ctx.probe.request('editor.active');
    r.undo = await ctx.probe.request('document.undo', { path: scratchFile });
    r.editAgain = await ctx.probe.request('document.edit', { path: scratchFile, start: { line: 0, character: 0 }, text: 'saved ' });
    r.save = await ctx.probe.request('document.save', { path: scratchFile });
    r.onDisk = fs.readFileSync(scratchFile, 'utf8');
    // The clipboard is read after the editor's own copy put the saved text on it,
    // so the reading is compared with something rather than with nothing.
    await ctx.probe.request('command.run', { command: 'editor.action.selectAll' });
    await ctx.probe.request('command.run', { command: 'editor.action.clipboardCopyAction' });
    r.clipboard = await ctx.probe.request('clipboard.read');
    r.configuration = await ctx.probe.request('configuration.inspect', { key: 'aggrega.server.binaryPath' });
    r.baseline = {
      dialogStyle: await ctx.probe.request('configuration.inspect', { key: 'window.dialogStyle' }),
      simpleDialog: await ctx.probe.request('configuration.inspect', { key: 'files.simpleDialog.enable' }),
    };
    r.command = await ctx.probe.request('command.run', { command: 'workbench.action.terminal.new' });
    r.terminals = await until('the terminal reporting its process', 15000, () => ctx.probe.request<{ name: string; processId?: number }[]>('terminals.list'), (t) => t.length > 0 && typeof t[0].processId === 'number');
    let refused = '';
    try { await ctx.probe.request('extension.internals'); } catch (err) { refused = err instanceof Error ? err.message : String(err); }
    r.refused = refused;
    const edited = r.activeAfterEdit as { text: string; isDirty: boolean };
    const undone = r.undo as { isDirty: boolean };
    const saved = r.save as { saved: boolean; isDirty: boolean };
    const folders = r.folders as { path: string }[];
    const config = r.configuration as { value: string };
    const terminals = r.terminals as { processId?: number }[];
    const passed = folders.length === 1 && folders[0].path === ctx.folder &&
      edited.isDirty && edited.text.startsWith('edited first line') && !undone.isDirty &&
      saved.saved && !saved.isDirty && r.onDisk === 'saved first line\n' && r.clipboard === r.onDisk &&
      typeof config.value === 'string' && config.value === ctx.compiler &&
      terminals.length === 1 && typeof terminals[0].processId === 'number' &&
      refused.includes('extension.internals') && refused.includes('hello');
    return { passed, evidence: r };
  }));

  proofs.push(await proof('a diagnostic the probe lists matches the Problems panel\'s entry', async () => {
    // The extension validates a document when it is opened only once its
    // language server is running, so the document is opened after the status bar
    // says so.
    const running = await until('the status bar reading running', 60000, () => ctx.driver.workbench<string>(LIFECYCLE_READING), (v) => v === RUNNING);
    const opened = await ctx.probe.request('document.open', { path: faulty });
    let listed: { path: string; diagnostics: DiagnosticEntry[] }[];
    try {
      listed = await until('the language server reporting on the faulty entity', 30000,
        () => ctx.probe.request<{ path: string; diagnostics: DiagnosticEntry[] }[]>('diagnostics.list', { path: faulty }),
        (v) => v.length > 0 && v[0].diagnostics.length > 0);
    } catch (err) {
      const everything = await ctx.probe.request('diagnostics.list').catch((e: unknown) => String(e));
      throw new Error(`${err instanceof Error ? err.message : String(err)}; the document opened as ${JSON.stringify(opened)}; every diagnostic the editor holds: ${JSON.stringify(everything).slice(0, 600)}`);
    }
    const diagnostics = listed[0].diagnostics;
    await ctx.probe.request('command.run', { command: 'workbench.actions.view.problems' });
    const rows = await until('the Problems panel drawing a row per diagnostic', 15000, () => ctx.driver.workbench<ProblemsRow[] | null>(PROBLEMS_ROWS),
      (v) => v !== null && diagnostics.every((d) => v.some((row) => matchesRow(d, row))));
    const drawnRows = rows ?? [];
    const pairs = diagnostics.map((d) => ({ diagnostic: d, rows: drawnRows.filter((row) => matchesRow(d, row)) }));
    // Each diagnostic is drawn as exactly one row, and no row stands for two.
    const oneToOne = pairs.every((p) => p.rows.length === 1) && new Set(pairs.map((p) => p.rows[0]?.text)).size === pairs.length;
    // The negative controls: a reported message at a position nobody reported,
    // and a message nobody reported at a reported position, match no drawn row.
    const moved: DiagnosticEntry = { ...diagnostics[0], range: { start: { line: diagnostics[0].range.start.line + 40, character: 0 }, end: { line: diagnostics[0].range.start.line + 40, character: 1 } } };
    const reworded: DiagnosticEntry = { ...diagnostics[0], message: `${diagnostics[0].message} and one more thing` };
    const controls = { moved: drawnRows.filter((row) => matchesRow(moved, row)).length, reworded: drawnRows.filter((row) => matchesRow(reworded, row)).length };
    return { passed: oneToOne && controls.moved === 0 && controls.reworded === 0, evidence: { statusBeforeOpening: running, pairs, rows, controls } };
  }));

  proofs.push(await proof('the probe answers again after a window reload, from a new extension host', async () => {
    const before = await ctx.probe.request<Hello>('hello');
    await ctx.probe.request('command.run', { command: 'workbench.action.reloadWindow' }, 5000).catch(() => undefined);
    const after = await ctx.probe.waitHello(60000, before.instance);
    const folders = await ctx.probe.request<{ path: string }[]>('workspace.folders');
    const active = await ctx.probe.request<{ path: string } | null>('editor.active');
    ctx.table.snapshot();
    // Recorded, not asserted: whether the document the reload restored is
    // validated once the language server is running again, watched over a stated
    // window.
    const windowMs = 10000;
    await until('the status bar reading running after the reload', 60000, () => ctx.driver.workbench<string>(LIFECYCLE_READING), (v) => v === RUNNING);
    let restoredDiagnostics = 0;
    const end = Date.now() + windowMs;
    while (Date.now() < end && restoredDiagnostics === 0) {
      const listed = await ctx.probe.request<{ path: string; diagnostics: DiagnosticEntry[] }[]>('diagnostics.list', { path: faulty });
      restoredDiagnostics = listed.length > 0 ? listed[0].diagnostics.length : 0;
      await sleep(250);
    }
    const passed = after.instance !== before.instance && after.pid !== before.pid && folders.length === 1 && folders[0].path === ctx.folder;
    return { passed, evidence: { before, after, folders, activeEditorAfterReload: active, restoredDocumentDiagnostics: { count: restoredDiagnostics, watchedMs: windowMs } } };
  }));

  return { proofs, hello };
}
