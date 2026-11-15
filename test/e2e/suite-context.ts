// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { readManifest } from '../helpers/manifest';
import { Checks, need } from './checks';
import { ScratchHome } from './cli';
import { UiDriver } from './drivers';
import { scratchHomeOf } from './editor';
import { Inputs } from './inputs';
import { DiagnosticEntry, ProbeClient } from './probe-client';
import { readCmdline } from './processes';
import { relaunch, Relaunched, Scenario } from './scenario';
import {
  commandsPanel, documentWith, drawnTreeRows, openTabs, OutputLog, QuickInput, RUNNING, scrollTreeToTop, toastWindowPassed, until, waitQuickInput, waitStatus,
} from './workbench';

// What every check body of the suite reaches: the launched editor, the probe,
// the inputs, the output channel, and the scenario's contained home.

export interface Manifest {
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    configuration: { title: string; properties: Record<string, { description?: string; markdownDescription?: string; default?: unknown }> };
  };
}

export interface SuiteContext {
  s: Scenario;
  d: UiDriver;
  probe: ProbeClient;
  inputs: Inputs;
  checks: Checks;
  out: OutputLog;
  home: ScratchHome;
  cliLog: string;
  folder: string;
  // manifest is the launched copy's manifest as an editor showing English draws
  // it, so a plant on the copy's text moves what a check calls declared.
  manifest: Manifest;
  // shots is where the captures a person is asked to judge are written.
  shots: string;
}

export function makeContext(s: Scenario, inputs: Inputs, checks: Checks): SuiteContext {
  need(s.driver !== null, 'no UI driver is attached to the editor');
  const shots = path.join(s.root.dir, 'captures');
  fs.mkdirSync(shots, { recursive: true });
  return {
    s, d: s.driver, probe: s.probe, inputs, checks,
    out: new OutputLog(s.root.userData),
    home: scratchHomeOf(s.root),
    cliLog: path.join(s.root.logs, 'cli.log'),
    folder: s.folder,
    manifest: readManifest(s.root.extensionCopy) as Manifest,
    shots,
  };
}

// commandTitle is a command's title as the manifest declares it.
export function commandTitle(m: Manifest, command: string): string {
  const c = m.contributes.commands.find((x) => x.command === command);
  if (!c) { throw new Error(`the manifest declares no command ${command}`); }
  return c.title;
}

// run asks the probe to run a command and waits for its result.
export function run<T = unknown>(ctx: SuiteContext, command: string, args: unknown[] = [], timeoutMs = 30000): Promise<T> {
  return ctx.probe.request<T>('command.run', { command, args }, timeoutMs);
}

// send runs a command without waiting for it to finish. A command that asks
// the reader something — a notification with a button, a picker — finishes only
// once it is answered, so waiting for it would hold the probe until the check
// answered it.
export async function send(ctx: SuiteContext, command: string, args: unknown[] = []): Promise<void> {
  await ctx.probe.request('command.run', { command, args }, 1500).catch(() => undefined);
}

// answerInput waits for the question `asked` says is drawn, types `text` into it
// and accepts it. An empty text accepts the question as it stands.
export async function answerInput(ctx: SuiteContext, what: string, asked: (q: QuickInput) => boolean, text: string): Promise<void> {
  await waitQuickInput(ctx.d, what, asked, 30000);
  if (text !== '') { await ctx.d.type(text); }
  await ctx.d.press('Enter');
}

// IMPORT_COMMAND is the import's command, which the explorer runs with the file
// or the folder it was opened on.
export const IMPORT_COMMAND = 'aggrega.op.import';

// ImportAnswers is what importing a clicked file answers: the destination and the
// target, an empty text choosing none of either, and how each of the three
// questions is recognised as drawn. The options are accepted as they stand, with
// neither ticked.
export interface ImportAnswers {
  outputDir: string;
  target: string;
  asked: { destination: (q: QuickInput) => boolean; options: (q: QuickInput) => boolean; target: (q: QuickInput) => boolean };
}

// importClickedFile imports `source` as the explorer's own entry does, the
// source carried by the invocation, and answers the questions that follow it:
// the destination, the options, then the target. It returns once the target is
// accepted; how the import ends is the caller's to wait for.
export async function importClickedFile(ctx: SuiteContext, source: string, answers: ImportAnswers): Promise<void> {
  await send(ctx, IMPORT_COMMAND, [{ $file: source }]);
  await answerInput(ctx, 'the import\'s destination', answers.asked.destination, answers.outputDir);
  await waitQuickInput(ctx.d, 'the import\'s options', answers.asked.options, 30000);
  await ctx.d.press('Enter');
  await answerInput(ctx, 'the import\'s target', answers.asked.target, answers.target);
}

// Server is the language server's process as the operating system reports it.
export interface Server { pid: number; cmd: string; cwd: string; exe: string }

export function languageServers(ctx: SuiteContext): Server[] {
  ctx.s.table.snapshot();
  const bin = ctx.inputs.compiler.path;
  return ctx.s.table.alive()
    .filter((r) => r.cmd === `${bin} serve` || r.cmd.startsWith(`${bin} serve `))
    .map((r) => {
      let cwd = '';
      let exe = '';
      try { cwd = fs.readlinkSync(`/proc/${r.pid}/cwd`); } catch { cwd = ''; }
      try { exe = fs.readlinkSync(`/proc/${r.pid}/exe`); } catch { exe = ''; }
      return { pid: r.pid, cmd: readCmdline(r.pid) || r.cmd, cwd, exe };
    });
}

function serversOtherThan(ctx: SuiteContext, notPid?: number): Server[] {
  return languageServers(ctx).filter((x) => x.pid !== notPid);
}

// serverNow is the one language server running, other than `notPid`, as the
// process table stands, or null where there is not exactly one: the reading
// theServer waits on, for a caller that waits on something else as well.
export function serverNow(ctx: SuiteContext, notPid?: number): Server | null {
  const v = serversOtherThan(ctx, notPid);
  return v.length === 1 ? v[0] : null;
}

// theServer is the one language server this window started.
export async function theServer(ctx: SuiteContext, boundMs = 30000, notPid?: number): Promise<Server> {
  const found = await until(`one language server running${notPid ? ` other than ${notPid}` : ''}`, boundMs, async () => serversOtherThan(ctx, notPid), (v) => v.length === 1);
  return found[0];
}

// ready waits for the state every check starts from: the language server
// running, the welcome page the extension opens at start drawn (so it does not
// open later over whatever a check has in front), and the Aggrega side bar
// showing the Commands panel.
export async function ready(ctx: SuiteContext): Promise<void> {
  await waitStatus(ctx.d, RUNNING, 90000);
  await documentWith(ctx.d, 'the welcome page the extension opens at start', `!!document.querySelector('.version-entry')`, 30000);
  await run(ctx, 'workbench.view.extension.aggrega');
  await commandsPanel(ctx.d);
}

// ---- documents ---------------------------------------------------------------

export interface DocumentState { path: string; isDirty: boolean; text?: string; lineCount: number }

export async function open(ctx: SuiteContext, file: string): Promise<DocumentState> {
  await ctx.probe.request('document.open', { path: file });
  const active = await ctx.probe.request<DocumentState & { text: string } | null>('editor.active');
  need(active !== null && active.path === file, `${file} did not become the active editor`);
  return active;
}

// Line is one line of a document: where it is and exactly what it reads.
export interface Line { index: number; text: string }

// lineOf finds the one line of `file`, opened in the editor, whose content is
// `text` once its indentation is set aside; a line that is not there exactly
// once is refused, so an edit cannot land on a line nobody meant.
export async function lineOf(ctx: SuiteContext, file: string, text: string): Promise<Line> {
  const doc = await open(ctx, file);
  return lineIn(file, (doc.text ?? '').split('\n'), text);
}

// lineIn finds that line among the lines of `file` a caller already holds, and
// names the file when it refuses.
export function lineIn(file: string, lines: readonly string[], text: string): Line {
  const at = lines.map((l, i) => (l.trim() === text.trim() ? i : -1)).filter((i) => i !== -1);
  need(at.length === 1, `${path.basename(file)} holds the line "${text.trim()}" ${at.length} times, not once`);
  return { index: at[0], text: lines[at[0]] };
}

// deleteLine removes one line of an open document without saving it, and
// returns it so it can be put back.
export async function deleteLine(ctx: SuiteContext, file: string, text: string): Promise<Line> {
  const line = await lineOf(ctx, file, text);
  await ctx.probe.request('document.edit', { path: file, start: { line: line.index, character: 0 }, end: { line: line.index + 1, character: 0 }, text: '' });
  return line;
}

// putBack writes a deleted line back where it was, without saving.
export async function putBack(ctx: SuiteContext, file: string, line: Line): Promise<void> {
  await open(ctx, file);
  await ctx.probe.request('document.edit', { path: file, start: { line: line.index, character: 0 }, text: `${line.text}\n` });
}

export async function save(ctx: SuiteContext, file: string): Promise<void> {
  const r = await ctx.probe.request<{ saved: boolean }>('document.save', { path: file });
  need(r.saved, `${file} could not be saved`);
}

// closeAllEditors closes every editor and waits for the stage a check acts from:
// no tab drawn, and the editor's notification window passed since the last
// notification drawn (`toastWindowPassed`), so a notification the next action
// raises is drawn rather than only listed.
export async function closeAllEditors(ctx: SuiteContext): Promise<void> {
  await run(ctx, 'workbench.action.closeAllEditors');
  await until('every editor\'s tab gone', 5000, () => openTabs(ctx.d), (n) => n === 0);
  await toastWindowPassed(ctx.d);
}

// closeActiveTab closes the editor in front and waits for its tab to be gone,
// and for the editor's notification window to pass, as closeAllEditors does.
export async function closeActiveTab(ctx: SuiteContext): Promise<void> {
  const before = await openTabs(ctx.d);
  await run(ctx, 'workbench.action.closeActiveEditor');
  await until('the tab in front closing', 5000, () => openTabs(ctx.d), (n) => n < before);
  await toastWindowPassed(ctx.d);
}

// ---- diagnostics -------------------------------------------------------------

export async function diagnostics(ctx: SuiteContext, file: string): Promise<DiagnosticEntry[]> {
  const listed = await ctx.probe.request<{ path: string; diagnostics: DiagnosticEntry[] }[]>('diagnostics.list', { path: file });
  return listed.length === 0 ? [] : listed[0].diagnostics;
}

export function describeDiagnostics(file: string, ds: DiagnosticEntry[]): string {
  return ds.length === 0
    ? `${path.basename(file)}: none`
    : ds.map((d) => `${path.basename(file)}:${d.range.start.line + 1} [${d.source ?? 'no source'}${d.code ? ` ${d.code}` : ''}] ${d.message.split('\n')[0]}`).join('; ');
}

// catalogPanelAtItsHead puts the Catalog panel back at the head of its list, as
// a person does with Home in it: its focus on the first row and the list
// scrolled to its start, read back as the panel's first row being drawn. A check
// that pressed a row further down leaves the focus there, and the panel brings
// the focused row back into sight each time it reads its list again, so
// scrolling alone would not stay done.
export async function catalogPanelAtItsHead(ctx: SuiteContext, firstRow: string): Promise<boolean> {
  await run(ctx, 'aggrega.workspaceCatalog.focus');
  await run(ctx, 'list.focusFirst').catch(() => undefined);
  await scrollTreeToTop(ctx.d, 'Catalog');
  return until(`the Catalog panel drawing "${firstRow}" first`, 10000, () => drawnTreeRows(ctx.d, 'Catalog'), (v) => v !== null && v.length > 0 && v[0].label === firstRow).then(() => true, () => false);
}

// reopen closes the editor and opens it again on the same profile and folder,
// as a person closes the window and opens it again, and points the context at
// the new one. The observers go in before the extension draws anything.
export async function reopen(ctx: SuiteContext, observers: readonly string[] = []): Promise<Relaunched> {
  const r = await relaunch(ctx.s, ctx.inputs, observers);
  need(ctx.s.driver !== null, 'no UI driver is attached to the editor opened again');
  ctx.d = ctx.s.driver;
  ctx.probe = ctx.s.probe;
  return r;
}

// capture writes a screenshot for a person to judge.
export async function capture(ctx: SuiteContext, name: string): Promise<string> {
  const file = path.join(ctx.shots, `${name}.png`);
  await ctx.d.screenshot(file);
  return file;
}
