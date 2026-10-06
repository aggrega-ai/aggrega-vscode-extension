// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { runCompiler, ScratchHome } from './cli';
import { need } from './checks';
import { FixtureError, FixtureProof, readTree } from './fixtures';
import { levelRows, pressRowControl, ROW_COMMAND } from './levels';
import { outsideTheWorkspace, untouched } from './linked-away';
import { referenceAnswer } from './reference';
import { paletteTitle } from './suite-first-day';
import { closeAllEditors, ready, run, send, SuiteContext } from './suite-context';
import { pageNow, pressWayThrough, stepOf, WAYS_THROUGH, WELCOME_OPEN_COMMAND } from './welcome';
import { commandsPanel, documentWith, holds, NOT_RUNNING, paletteRows, pickQuickInputRow, Toast, toasts, until, waitStatus, waitToast } from './workbench';

// The checks run on the two actions that open the workspace's configuration file —
// the command setting the authoring Release, and the control creating a workspace
// configuration, drawn on the welcome page's workspace step and beside the
// Commands panel's Aggrega workspace row — each in a folder of its own, holding the
// suite's two Releases:
//
//   - where the configuration file is a link to a file outside the workspace, which
//     the language server does not read and names among the links it did not read,
//     every way to each action ends in the refusal saying why and opens nothing;
//   - where it is a file the compiler refuses as invalid, which keeps the language
//     server from starting, the command opens it, so it can be repaired;
//   - where it is a link to a file inside the workspace, which the language server
//     reads, the command opens it.
//
// Whether the file leads out is the language server's judgement, so each check
// reads the server's own answer over the folder, or the compiler's own run, beside
// what the editor does.

export const LEADING_OUT_CHECKS = [
  'configuration-file.release-configuration-command-leaves-one-leading-out-unopened',
  'configuration-file.create-workspace-controls-leave-one-leading-out-unopened',
] as const;

export const INVALID_CHECKS = [
  'configuration-file.release-configuration-command-opens-an-invalid-one',
] as const;

export const LINKED_INSIDE_CHECKS = [
  'configuration-file.release-configuration-command-opens-one-linked-inside',
] as const;

const CONFIG = '.aggrega-config.yaml';

// notOpened is the sentence an action ends in where it leaves the file unopened,
// held as the words a reader is to meet: a change of wording in the extension is a
// change these checks report rather than follow. The name in it is the one the
// language server's own answer gives the file.
const notOpened = (name: string): string => `Aggrega: ${name} is not opened, because it leads outside the Aggrega workspace, so Aggrega does not use it.`;

// The file kept outside the workspace, or beside the configuration inside it, that
// a link at the configuration file's place leads to.
const KEPT_AS = 'workspace-configuration.yaml';

// The part added to the folder's configuration to make one the compiler refuses: a
// list where its schema declares a mapping.
const NOT_A_MAPPING = 'build:\n  - not-a-mapping\n';

// INVALID_CODE is the short code the compiler opens its refusal of such a file with.
const INVALID_CODE = '[E0224]';

// ---- the folders ----------------------------------------------------------------

// placeConfigurationLeadingOut moves the folder's configuration file to a directory
// beside the folder, outside the workspace, and leaves a link to it in its place.
// It answers with that directory.
export function placeConfigurationLeadingOut(folder: string): { proof: FixtureProof; outside: string } {
  const fixture = `${CONFIG} of ${path.basename(folder)} a link to a file outside the workspace`;
  const config = path.join(folder, CONFIG);
  const outside = outsideTheWorkspace(folder, 'configuration');
  const kept = path.join(outside, KEPT_AS);
  const text = fs.readFileSync(config, 'utf8');
  fs.mkdirSync(outside, { recursive: true });
  fs.renameSync(config, kept);
  fs.symlinkSync(kept, config, 'file');
  if (!fs.lstatSync(config).isSymbolicLink() || fs.readFileSync(config, 'utf8') !== text || !path.relative(folder, fs.realpathSync(config)).startsWith('..')) {
    throw new FixtureError(fixture, `${config} does not read ${kept}, outside ${folder}, through a link`);
  }
  return { proof: { fixture, built: true, proof: `${config} is a link to ${kept}, outside the folder, and reads the folder's configuration through it` }, outside };
}

// placeConfigurationLinkedInside moves the folder's configuration file into a
// directory of the folder and leaves a link to it, relative, in its place.
export function placeConfigurationLinkedInside(folder: string): FixtureProof {
  const fixture = `${CONFIG} of ${path.basename(folder)} a link to a file inside the workspace`;
  const config = path.join(folder, CONFIG);
  const kept = path.join(folder, 'conf', KEPT_AS);
  const text = fs.readFileSync(config, 'utf8');
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.renameSync(config, kept);
  fs.symlinkSync(path.join('conf', KEPT_AS), config, 'file');
  if (!fs.lstatSync(config).isSymbolicLink() || fs.readFileSync(config, 'utf8') !== text || path.relative(folder, fs.realpathSync(config)) !== path.join('conf', KEPT_AS)) {
    throw new FixtureError(fixture, `${config} does not read ${kept}, inside ${folder}, through a link`);
  }
  return { fixture, built: true, proof: `${config} is a link to ${path.join('conf', KEPT_AS)}, inside the folder, and reads the folder's configuration through it` };
}

// placeInvalidConfiguration adds to the folder's configuration a setting its
// schema refuses, and proves with the compiler's own run that it is refused.
export async function placeInvalidConfiguration(binary: string, folder: string, home: ScratchHome, log: string): Promise<FixtureProof> {
  const fixture = `${CONFIG} of ${path.basename(folder)} one the compiler refuses as invalid`;
  const config = path.join(folder, CONFIG);
  fs.appendFileSync(config, NOT_A_MAPPING);
  const run = await runCompiler(binary, ['config', 'show'], { cwd: folder, home, boundMs: 60000, log });
  if (run.status === 0 || !run.stderr.includes(INVALID_CODE)) {
    throw new FixtureError(fixture, `\`aggrega config show\` in the folder exited ${run.status ?? run.signal} without refusing it as ${INVALID_CODE}: ${run.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  }
  return { fixture, built: true, proof: `${CONFIG} carries "${NOT_A_MAPPING.trim()}"; \`aggrega config show\` in the folder exits ${run.status}, refusing it as ${INVALID_CODE}` };
}

// ---- what the actions open ------------------------------------------------------

// documentsOn lists every document the editor holds, and the active editor's, at
// any of `paths`.
async function documentsOn(ctx: SuiteContext, paths: readonly string[]): Promise<string[]> {
  const held = await ctx.probe.request<{ path: string }[]>('documents.list');
  const active = await ctx.probe.request<{ path: string } | null>('editor.active');
  return [...held.map((d) => d.path), ...(active === null ? [] : [`${active.path} (active)`])].filter((p) => paths.some((x) => p === x || p === `${x} (active)`));
}

// takeFromThePalette runs a command as a reader does, from the command palette.
async function takeFromThePalette(ctx: SuiteContext, title: string): Promise<void> {
  const q = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), title);
  need(q.rows.some((r) => r.label === title), `the command palette does not offer "${title}": ${JSON.stringify(q.rows.map((r) => r.label))}`);
  await pickQuickInputRow(ctx.d, title);
}

// QUIET_MS is how long nothing is to be opened after an action leaves the file
// unopened, read from the action's ending.
const QUIET_MS = 2000;

// ---- a configuration file leading out of the workspace ------------------------------

export async function leadingOutChecks(ctx: SuiteContext, outside: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const config = path.join(ctx.folder, CONFIG);
  const target = fs.realpathSync(config);
  const title = paletteTitle(ctx, 'aggrega.workspace.openAuthoringReleaseConfig');
  await ready(ctx);

  // nameInTheAnswer is the language server's own answer about the file: its name
  // among the links the listing over the folder did not read.
  const nameInTheAnswer = async (): Promise<string> => {
    const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/releaseCandidates', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no Release listing over the folder: ${a.ok ? '' : a.error.message}`);
    const files = (a.result as { unreadLinkedFiles?: string[] | null }).unreadLinkedFiles ?? [];
    const name = files.find((f) => f === CONFIG);
    need(name !== undefined, `the language server's own listing over the folder does not name ${CONFIG} among the links it did not read: ${JSON.stringify(files)}`);
    return name;
  };

  // ending reads one action's ending: the notification it raised, and every
  // document the editor holds on the file or behind its link at each reading over
  // QUIET_MS from then.
  const ending = async (mark: number, want: string): Promise<{ told: Toast | null; opened: string[] }> => {
    const told = await waitToast(ctx.d, 'the action\'s ending', mark, (t) => t.message === want || t.message.startsWith(`Aggrega: ${CONFIG}`), 20000).catch(() => null);
    const quiet = await holds(QUIET_MS, () => documentsOn(ctx, [config, target]), (v) => v.length === 0);
    return { told, opened: quiet.held ? [] : quiet.broke ?? [] };
  };
  const describe = (e: { told: Toast | null; opened: string[] }): string => `${e.told === null ? 'no ending' : `"${e.told.message}" (${e.told.severity})`}; ${e.opened.length === 0 ? `nothing open on ${CONFIG} or behind it over ${QUIET_MS} ms` : `open: ${JSON.stringify(e.opened)}`}`;
  const endedAsRefused = (e: { told: Toast | null; opened: string[] }, want: string): boolean => e.told !== null && e.told.severity === 'error' && e.told.message === want && e.opened.length === 0;
  const keptOutside = (before: ReturnType<typeof readTree>, leadsTo: string): { same: boolean; seen: string } => {
    const kept = untouched(before, outside);
    const link = fs.lstatSync(config).isSymbolicLink() && fs.readlinkSync(config) === leadsTo;
    return { same: kept.same && link, seen: `${kept.seen}; ${CONFIG} ${link ? `still a link to ${leadsTo}` : 'is no longer the link it was'}` };
  };

  await c.run('configuration-file.release-configuration-command-leaves-one-leading-out-unopened', {
    expected: `with ${CONFIG} a link to a file outside the workspace — named by the language server's own Release listing over the folder among the links it did not read — "${title}" taken from the command palette ends in one error notification reading "${notOpened('<that name>')}" and opens nothing: no document on ${CONFIG} or on the file behind it, read over ${QUIET_MS} ms; the file outside keeps its bytes and ${CONFIG} stays the link it was`,
    plant: 'in the scratch copy, out/src/configuration-leading-out.js with a file the language server names as leading out opened like any other',
  }, async () => {
    const before = readTree(outside);
    const leadsTo = fs.readlinkSync(config);
    const want = notOpened(await nameInTheAnswer());
    await closeAllEditors(ctx);
    const mark = (await toasts(ctx.d)).length;
    await takeFromThePalette(ctx, title);
    const e = await ending(mark, want);
    const kept = keptOutside(before, leadsTo);
    return { passed: endedAsRefused(e, want) && kept.same, seen: `${describe(e)}; ${kept.seen}` };
  });

  await c.run('configuration-file.create-workspace-controls-leave-one-leading-out-unopened', {
    expected: `with ${CONFIG} a link to a file outside the workspace, named by the language server's own Release listing over the folder among the links it did not read, "${WAYS_THROUGH.workspace[0]}" pressed on the welcome page's workspace step, and the create control beside the Commands panel's Aggrega workspace row pressed, each where the window draws it, each end in one error notification reading "${notOpened('<that name>')}" and open nothing: no document on ${CONFIG} or on the file behind it, read over ${QUIET_MS} ms after each; the file outside keeps its bytes and ${CONFIG} stays the link it was`,
    plant: 'in the scratch copy, out/src/configuration-leading-out.js with a file the language server names as leading out opened like any other',
  }, async () => {
    const before = readTree(outside);
    const leadsTo = fs.readlinkSync(config);
    const want = notOpened(await nameInTheAnswer());
    // The welcome page, where its workspace step draws the control.
    await closeAllEditors(ctx);
    await run(ctx, WELCOME_OPEN_COMMAND);
    const page = await until('the welcome page drawing its workspace step', 20000, () => pageNow(ctx), (p) => p.steps.some((s) => s.id === 'workspace'));
    const step = stepOf(page, 'workspace');
    const onPage = step.actions.find((a) => a.label === WAYS_THROUGH.workspace[0]);
    need(onPage !== undefined && onPage.drawn, `the welcome page's workspace step (${step.badge}${step.open ? ', open' : ', folded'}) draws no "${WAYS_THROUGH.workspace[0]}" to press: ${JSON.stringify(step.actions.map((a) => `${a.label}${a.drawn ? '' : ' (not drawn)'}`))}`);
    const pageMark = (await toasts(ctx.d)).length;
    await pressWayThrough(ctx, 'workspace', WAYS_THROUGH.workspace[0]);
    const fromPage = await ending(pageMark, want);
    // The Commands panel, where the Aggrega workspace row draws its create control.
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    const rows = await levelRows(await commandsPanel(ctx.d));
    const row = rows.find((r) => r.command === ROW_COMMAND.workspace);
    need(row !== undefined && row.create !== null, `the Commands panel's Aggrega workspace row draws no create control to press: ${JSON.stringify(rows.map((r) => `${r.label} ${r.create ? `+${r.create.command}` : 'no create control'}`))}`);
    const rowMark = (await toasts(ctx.d)).length;
    await pressRowControl(ctx, 'workspace', 'create');
    const fromRow = await ending(rowMark, want);
    const kept = keptOutside(before, leadsTo);
    return {
      passed: endedAsRefused(fromPage, want) && endedAsRefused(fromRow, want) && row.create?.command === onPage.command && kept.same,
      seen: `the welcome page's workspace step reads ${step.badge}, ${step.open ? 'open' : 'folded'}, and draws "${onPage.label}" running ${onPage.command}; pressed: ${describe(fromPage)}. The Aggrega workspace row draws its create control "${row.create?.name ?? ''}" running ${row.create?.command ?? ''}; pressed: ${describe(fromRow)}. ${kept.seen}`,
    };
  });
}

// ---- a configuration file the compiler refuses as invalid ---------------------------

export async function invalidConfigurationChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const config = path.join(ctx.folder, CONFIG);
  const title = paletteTitle(ctx, 'aggrega.workspace.openAuthoringReleaseConfig');
  // The window comes up with no language server: the one it starts exits, refusing
  // the configuration.
  const stopped = await waitStatus(ctx.d, NOT_RUNNING, 90000).then(() => true, () => false);
  await documentWith(ctx.d, 'the welcome page the extension opens at start', `!!document.querySelector('.version-entry')`, 30000).catch(() => undefined);
  await run(ctx, 'workbench.view.extension.aggrega');

  await c.run('configuration-file.release-configuration-command-opens-an-invalid-one', {
    expected: `with ${CONFIG} a file the compiler refuses as invalid — \`aggrega config show\` in the folder refusing it as ${INVALID_CODE} — and no language server running, the one started having exited over it, "${title}" taken from the command palette opens ${CONFIG} in a tab, and its bytes are as they were`,
    plant: 'in the scratch copy, out/src/configuration-leading-out.js with a configuration file left unopened wherever no language server answers to judge it',
  }, async () => {
    need(stopped, `the status bar does not read "${NOT_RUNNING}", so a language server answers over the folder and this is not the state where none can`);
    const refused = await runCompiler(ctx.inputs.compiler.path, ['config', 'show'], { cwd: ctx.folder, home: ctx.home, boundMs: 60000, log: ctx.cliLog });
    need(refused.status !== 0 && refused.stderr.includes(INVALID_CODE), `the compiler's own \`aggrega config show\` in the folder exited ${refused.status ?? refused.signal} without refusing it as ${INVALID_CODE}`);
    const before = fs.readFileSync(config);
    await closeAllEditors(ctx);
    await takeFromThePalette(ctx, title);
    const active = await until(`${CONFIG} opening`, 15000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path === config).catch(() => ctx.probe.request<{ path: string } | null>('editor.active'));
    const kept = fs.readFileSync(config).equals(before);
    await closeAllEditors(ctx);
    return {
      passed: active?.path === config && kept,
      seen: `the compiler refused the file, exiting ${refused.status}: ${JSON.stringify(refused.stderr.trim().split('\n').slice(-1)[0] ?? '')}; the tab in front ${active?.path ?? 'none'}; ${CONFIG} ${kept ? 'unchanged' : 'changed'}`,
    };
  });
}

// ---- a configuration file linked inside the workspace -------------------------------

export async function linkedInsideChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const config = path.join(ctx.folder, CONFIG);
  const title = paletteTitle(ctx, 'aggrega.workspace.openAuthoringReleaseConfig');
  await ready(ctx);

  await c.run('configuration-file.release-configuration-command-opens-one-linked-inside', {
    expected: `with ${CONFIG} a link to a file inside the workspace — which the language server's own Release listing over the folder does not name among the links it did not read — "${title}" taken from the command palette opens ${CONFIG} in a tab, and the file behind the link keeps its bytes`,
    plant: 'in the scratch copy, out/src/configuration-leading-out.js with a configuration file found already there left unopened whether or not the language server names it',
  }, async () => {
    const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/releaseCandidates', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no Release listing over the folder: ${a.ok ? '' : a.error.message}`);
    const files = (a.result as { unreadLinkedFiles?: string[] | null }).unreadLinkedFiles ?? [];
    need(!files.includes(CONFIG), `the language server's own listing over the folder names ${CONFIG} among the links it did not read, so the link does not stay inside it: ${JSON.stringify(files)}`);
    const target = fs.realpathSync(config);
    const before = fs.readFileSync(target);
    await closeAllEditors(ctx);
    const mark = (await toasts(ctx.d)).length;
    await takeFromThePalette(ctx, title);
    const active = await until(`${CONFIG} opening`, 15000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path === config).catch(() => ctx.probe.request<{ path: string } | null>('editor.active'));
    const told = (await toasts(ctx.d)).slice(mark).filter((t) => t.message.startsWith('Aggrega: ')).map((t) => `"${t.message}" (${t.severity})`);
    const kept = fs.readFileSync(target).equals(before);
    await closeAllEditors(ctx);
    return {
      passed: active?.path === config && kept,
      seen: `the listing names the links to files ${JSON.stringify(files)}; the tab in front ${active?.path ?? 'none'}; notifications from Aggrega ${told.length === 0 ? 'none' : told.join(', ')}; the file behind the link, ${target}, ${kept ? 'unchanged' : 'changed'}`,
    };
  });
}
