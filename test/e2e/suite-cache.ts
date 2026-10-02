// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { need } from './checks';
import { readEnviron } from './processes';
import { referenceAnswer } from './reference';
import { closeAllEditors, ready, run, send, SuiteContext, theServer } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import {
  commandsPanel, Dialog, dialog, holds, paletteRows, pickQuickInputRow, pressDialogButton, pressIn, pressOperation, quickInput, Toast, toasts, toastsSince,
  until, waitQuickInput, waitToast,
} from './workbench';

// The checks run in the gateway folder on the four cache operations: what each
// asks before it removes anything and which caches it says it reaches, how each
// ends in the compiler's own figures, that none runs a process or offers a stop,
// that a size the report prints is one the trim accepts — and that every one of
// them reached only this scenario's own caches, under its scratch home, while the
// store this machine's own home holds lost nothing.

export const CACHE_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'cache.palette-asks-which-operation-as-a-list',
  'cache.status-reports-the-compilers-figures-on-the-channel-alone',
  'cache.sizes-are-written-in-the-units-a-cap-is-read-in',
  'cache.dismissed-cap-prompt-runs-nothing',
  'cache.unreadable-cap-comes-back-in-the-compilers-words',
  'cache.a-size-the-report-shows-is-accepted-as-the-cap',
  'cache.trim-to-a-cap-trims-or-says-it-was-within',
  'cache.prune-ends-in-what-it-removed-and-kept',
  'cache.declined-clear-sends-nothing-and-says-so',
  'cache.clear-completes-and-says-what-it-emptied',
  'cache.each-removal-confirms-first-naming-the-caches-it-reaches',
  'cache.operations-write-no-dollar-line-and-draw-no-progress-or-cancel',
  'cache.operations-reach-only-this-scenarios-caches',
] as const;

// The words a reader is to meet, held as the playbook quotes them, so a change of
// wording in the extension is a change these checks report rather than follow.
const OPERATIONS = ['status', 'prune', 'evict', 'clear'];
const PALETTE_PLACEHOLDER = 'Aggrega: choose a cache operation';
const STATUS_OPENING = 'Cache report. Nothing is removed.';
const STATUS_ENDING = /^The cache report listed (\d+) entr(?:y|ies) holding (.+)\.$/;
const TRIM_TITLE = 'Aggrega: trim the compiled-module cache';
const TRIM_PROMPT = 'Size cap to trim down to — a byte quantity such as 5GiB or 512MiB, or a byte count';
// EDITOR_INPUT_HINT is what the editor itself draws after the words of any
// prompt, naming the keys that answer and dismiss it.
const EDITOR_INPUT_HINT = / \(Press 'Enter' to confirm or 'Escape' to cancel\)$/;
const TRIM_WITHIN = /^The trim removed nothing: the cache held (.+), already within the (.+) cap\.$/;
const TRIM_REMOVED = /^The trim removed (\d+) entr(?:y|ies) and reclaimed (.+)\.$/;
const TRIM_REFUSED = 'The trim did not complete: ';
const PRUNE_ENDING = /^The prune removed (\d+) entr(?:y|ies) and reclaimed (.+)\.$/;
const CLEAR_ENDING = /^The cache wipe emptied (\d+) caches? and reclaimed (.+)\. They repopulate on the next build\.$/;
const CLEAR_DECLINED = 'Aggrega: clear cancelled. Nothing was removed.';
const PRUNE_DECLINED = 'Aggrega: prune cancelled. Nothing was removed.';
const REACHED_BEYOND = 'Reached beyond this workspace, shared by every project on this machine: ';

// What each removal asks first, as the playbook quotes it; the prune's detail is
// quoted only as naming both scopes, so those two phrases are what is read.
const ASKED = {
  prune: { message: 'Remove cache entries no lockfile references?', button: 'Remove unreferenced entries', detail: null as string | null, names: ["this workspace's own", 'every project on this machine'] },
  evict: {
    message: 'Trim the compiled-module cache to the size cap?', button: 'Trim to the cap',
    detail: "This reaches the compiled-module cache, which every project on this machine shares. Nothing under this workspace's own cache directory is touched. What is removed is rebuilt on the next build that needs it.",
    names: [] as string[],
  },
  clear: {
    message: 'Empty every cache?', button: 'Empty every cache',
    detail: "This empties this workspace's own entity, source-artifact, external-input and docs-bundle caches, and the compiled-module cache and the plugin-describe cache, which every project on this machine shares. The caches repopulate on the next build.",
    names: [] as string[],
  },
};

// A size as the compiler writes one: a figure and a binary unit.
const BINARY_SIZE = /^\d+(?:\.\d+)? (?:B|KiB|MiB|GiB|TiB)$/;

// storeFiles lists every file under a cache directory with its size, lock files
// aside — a lock file is touched by a reading as well as by a removal, so it says
// nothing about what the cache holds.
function storeFiles(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string, rel: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(path.join(d, e.name), r); continue; }
      if (e.isFile() && !e.name.endsWith('.lock')) {
        try { out.set(r, fs.statSync(path.join(d, e.name)).size); } catch { /* gone in between */ }
      }
    }
  };
  walk(dir, '');
  return out;
}

function sameFiles(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

// modulesIn counts the compiled modules a store holds.
function modulesIn(files: Map<string, number>): number {
  return [...files.keys()].filter((f) => f.startsWith('wasm-compile/') && !f.endsWith('.json')).length;
}

// Asked is what one removal's confirmation drew, and whether anything happened
// while it was up.
interface Asked { op: string; dialog: Dialog | null; quiet: boolean }

export async function cacheChecks(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  // This scenario's own caches, under its scratch home, and the store this
  // machine's own home holds, which is only ever listed.
  const scenarioStore = path.join(ctx.s.root.home, '.cache', 'aggrega');
  const machineStore = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'aggrega');
  await ready(ctx);
  await contextRowsCheck(ctx);
  const machineBefore = storeFiles(machineStore);
  const scenarioAtStart = storeFiles(scenarioStore);
  const asked: Asked[] = [];
  const firstOpMark = ctx.out.mark();
  const firstToastMark = (await toasts(ctx.d)).length;

  // openCache presses Cache… on the Commands panel and takes `op` from the menu it
  // opens beside the button.
  const openCache = async (op: string): Promise<void> => {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    const panel = await commandsPanel(ctx.d);
    await pressOperation(ctx.d, panel, 'aggrega.op.cache');
    const option = `.op-menu[data-menu-command="aggrega.op.cache"] .op-menu-option[data-option="${op}"]`;
    await until(`the cache menu offering ${op}`, 5000, () => panel.evaluate<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(option)}); return !!e && e.getBoundingClientRect().height > 0; })()`), (v) => v);
    await pressIn(ctx.d, panel, option);
  };

  // confirmation waits for a removal's confirmation, reads it, watches for 1.5 s
  // that nothing reached the channel or the store while it is up, and answers it.
  const confirmation = async (op: string, answer: string | null): Promise<Dialog | null> => {
    const mark = ctx.out.mark();
    const store = storeFiles(scenarioStore);
    const d = await until(`the ${op} confirmation`, 10000, () => dialog(ctx.d), (v) => v !== null).catch(() => null);
    const quiet = await holds(1500, async () => ({ said: ctx.out.since(mark), store: storeFiles(scenarioStore) }), (v) => v.said.trim() === '' && sameFiles(v.store, store));
    asked.push({ op, dialog: d, quiet: quiet.held });
    if (d !== null) {
      if (answer === null) { await ctx.d.press('Escape'); } else { await pressDialogButton(ctx.d, answer); }
      await until('the confirmation closing', 5000, () => dialog(ctx.d), (v) => v === null).catch(() => undefined);
    }
    return d;
  };

  // focusPrompt waits for the drawn prompt to hold the focus, and presses into it
  // where it does not come to.
  const focusPrompt = async (): Promise<void> => {
    const focused = `(() => { const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0); const i = w ? w.querySelector('.quick-input-box input') : null; return !!i && document.activeElement === i; })()`;
    const has = await until('the prompt holding the focus', 3000, () => ctx.d.workbench<boolean>(focused), (v) => v).then(() => true, () => false);
    if (!has) { await pressIn(ctx.d, null, '.quick-input-widget .quick-input-box input'); }
  };

  // trimInput answers the trim's size prompt with `cap`, typed as a person types.
  //
  // The prompt is typed into only once it holds the focus — a prompt opened by a
  // press in a panel can be drawn a moment before the focus reaches it, and keys
  // sent in that moment go to the panel — and it is answered only once it reads
  // what was typed.
  const trimInput = async (cap: string): Promise<{ title: string; prompt: string }> => {
    const q = await waitQuickInput(ctx.d, 'the size cap prompt', (x) => x.title === TRIM_TITLE, 10000);
    const prompt = await ctx.d.workbench<string>(`(() => { const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0); return w ? ((w.querySelector('.quick-input-message') || {}).innerText || '').trim() : ''; })()`);
    await focusPrompt();
    if (cap !== '') { await ctx.d.type(cap); }
    await waitQuickInput(ctx.d, 'the size cap prompt reading what was typed', (x) => x.title === TRIM_TITLE && x.value === cap, 5000);
    await ctx.d.press('Enter');
    return { title: q.title, prompt };
  };

  // ending waits for the notification an operation ends in.
  const ending = (what: string, mark: number, match: (t: Toast) => boolean): Promise<Toast | null> => waitToast(ctx.d, what, mark, match, 30000).catch(() => null);

  // ---- the palette's route ----
  const manifestEntry = ctx.manifest.contributes.commands.find((x) => x.command === 'aggrega.op.cache');
  const paletteTitle = manifestEntry ? `${manifestEntry.category ? `${manifestEntry.category}: ` : ''}${manifestEntry.title}` : '';
  await c.run('cache.palette-asks-which-operation-as-a-list', {
    expected: `"${paletteTitle}" (the manifest's category and title for aggrega.op.cache), taken from the command palette, opens a list whose placeholder reads "${PALETTE_PLACEHOLDER}", offering ${OPERATIONS.join(', ')} in that order, each with the line saying what it reaches; Escape closes it and nothing reaches the channel`,
    plant: 'in the scratch copy, out/src/operations.js with the list\'s placeholder reworded',
  }, async () => {
    need(paletteTitle !== '', 'the manifest declares no aggrega.op.cache');
    const mark = ctx.out.mark();
    const rows = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), paletteTitle);
    need(rows.rows.some((r) => r.label === paletteTitle), `the palette offers no "${paletteTitle}" for it: ${JSON.stringify(rows.rows.map((r) => r.label))}`);
    await pickQuickInputRow(ctx.d, paletteTitle);
    const q = await waitQuickInput(ctx.d, 'the list of cache operations', (x) => x.placeholder === PALETTE_PLACEHOLDER || (x.rows.length > 0 && x.rows[0].label === 'status'), 10000);
    await ctx.d.press('Escape');
    await until('the list closing', 5000, () => quickInput(ctx.d), (x) => x === null).catch(() => undefined);
    const quiet = await holds(1500, async () => ctx.out.since(mark), (t) => t.trim() === '');
    const labels = q.rows.map((r) => r.label);
    const described = q.rows.every((r) => r.description !== '');
    return {
      passed: q.placeholder === PALETTE_PLACEHOLDER && JSON.stringify(labels) === JSON.stringify(OPERATIONS) && described && quiet.held,
      seen: `placeholder "${q.placeholder}", rows ${JSON.stringify(q.rows.map((r) => `${r.label} — ${r.description}`))}; after Escape the channel ${quiet.held ? 'gained nothing' : 'gained text'}`,
    };
  });

  // ---- status ----
  let reportSizes: string[] = [];
  let totalSize = '';
  await c.run('cache.status-reports-the-compilers-figures-on-the-channel-alone', {
    expected: `status, taken from the menu beside Cache…, asks nothing and removes nothing: no confirmation is drawn and no notification is raised (watched for 3 s; the same observer records the notification a declined prune raises right after, in the same check), and the channel opens the report with "${STATUS_OPENING}", names each cache the language server's own answer to the same request names, and ends "The cache report listed <n> entries holding <size>." with the answer's own count and size`,
    plant: 'in the scratch copy, out/src/operations.js with the report\'s closing line counting one entry more than the answer',
  }, async () => {
    const ref = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/cacheStatus', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(ref.ok, `the language server's own answer to the report could not be read: ${ref.ok ? '' : ref.error.message}`);
    const answer = ref.result as { totalCount: number; totalSizeText: string; classes?: { name: string }[] | null };
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('status');
    const text = await ctx.out.waitFor('the report ending', mark, (t) => t.split('\n').some((l) => STATUS_ENDING.test(l)), 30000).catch(() => ctx.out.since(mark));
    const quiet = await holds(3000, async () => ({ d: await dialog(ctx.d), t: (await toastsSince(ctx.d, toastMark)).length }), (v) => v.d === null && v.t === 0);
    // The control: a prune asked for and declined raises a notification, which
    // the same observer must record.
    const controlMark = (await toasts(ctx.d)).length;
    await openCache('prune');
    await confirmation('prune', null);
    const control = await ending('the declined prune\'s notification', controlMark, (t) => t.message === PRUNE_DECLINED);
    need(control !== null, 'its positive control did not fire: the notification a declined prune raises was not recorded, so the reading is not shown to see one');
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l === STATUS_OPENING);
    const end = lines.find((l) => STATUS_ENDING.test(l)) ?? '';
    const m = STATUS_ENDING.exec(end);
    const classes = (answer.classes ?? []).map((x) => x.name);
    const named = classes.filter((n) => lines.some((l) => l.startsWith(`  ${n} (`)));
    // Every size the report printed, for the checks after this one.
    reportSizes = lines.filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim().split(/ {2,}/)[1] ?? '').map((s) => s.split(' — ')[0]).filter((s) => s !== '');
    totalSize = m ? m[2] : '';
    return {
      passed: at !== -1 && m !== null && Number(m[1]) === answer.totalCount && m[2] === answer.totalSizeText && named.length === classes.length && classes.length > 0 && quiet.held,
      seen: `the channel ${at !== -1 ? `opens "${STATUS_OPENING}"` : 'does not open the report'}, names ${named.length} of the ${classes.length} caches the answer names (${JSON.stringify(classes)}), and ends ${JSON.stringify(end)}; the answer: ${answer.totalCount} entries holding ${answer.totalSizeText}; ${quiet.held ? 'no confirmation and no notification for 3 s' : `then ${JSON.stringify(quiet.broke)}`}; the control recorded "${control.message}"`,
      evidence: { report: lines.slice(Math.max(at, 0), Math.max(at, 0) + 30) },
    };
  });
  await c.run('cache.sizes-are-written-in-the-units-a-cap-is-read-in', {
    expected: 'every size the report prints — each entry\'s and the total — is a binary-unit quantity such as "512.0 MiB" or "1.0 GiB", never a raw byte count or a figure in "bytes"',
    plant: 'in the scratch copy, out/src/operations.js with each entry\'s size printed as its byte count',
  }, async () => {
    need(totalSize !== '', 'the report printed no total size to read');
    const all = [...reportSizes, totalSize];
    const off = all.filter((s) => !BINARY_SIZE.test(s) || /bytes/.test(s));
    return { passed: off.length === 0 && reportSizes.length > 0, seen: `${all.length} sizes read: ${JSON.stringify(all)}${off.length > 0 ? `; not in binary units: ${JSON.stringify(off)}` : ''}` };
  });

  // ---- the trim ----
  await c.run('cache.dismissed-cap-prompt-runs-nothing', {
    expected: `evict asks for a size cap first, in a prompt titled "${TRIM_TITLE}" reading "${TRIM_PROMPT}"; dismissing it with Escape runs nothing — no confirmation, no notification, nothing on the channel and nothing removed from the store (watched for 3 s)`,
    plant: 'in the scratch copy, out/src/operations.js with a dismissed prompt taken as a blank answer',
  }, async () => {
    const store = storeFiles(scenarioStore);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('evict');
    const q = await waitQuickInput(ctx.d, 'the size cap prompt', (x) => x.title === TRIM_TITLE, 10000);
    const prompt = await ctx.d.workbench<string>(`(() => { const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0); return w ? ((w.querySelector('.quick-input-message') || {}).innerText || '').trim() : ''; })()`);
    await focusPrompt();
    await ctx.d.press('Escape');
    await until('the prompt closing', 5000, () => quickInput(ctx.d), (x) => x === null).catch(() => undefined);
    const quiet = await holds(3000, async () => ({ d: await dialog(ctx.d), t: (await toastsSince(ctx.d, toastMark)).length, said: ctx.out.since(mark).trim(), same: sameFiles(storeFiles(scenarioStore), store) }), (v) => v.d === null && v.t === 0 && v.said === '' && v.same);
    // The editor draws its own hint for the two keys after a prompt's words.
    const words = prompt.replace(EDITOR_INPUT_HINT, '');
    return { passed: q.title === TRIM_TITLE && words === TRIM_PROMPT && quiet.held, seen: `prompt titled "${q.title}" reading ${JSON.stringify(prompt)}; after Escape ${quiet.held ? 'nothing for 3 s' : JSON.stringify(quiet.broke)}` };
  });

  await c.run('cache.unreadable-cap-comes-back-in-the-compilers-words', {
    expected: `a blank answer and the answer "lots" to the size cap prompt, each confirmed, end in an error notification "${TRIM_REFUSED}code=<code> <message>" whose code and message are the language server's own refusal of the same request asked outside the editor, and the channel ends on the same line; nothing is removed`,
    plant: 'in the scratch copy, out/src/error-surfaces.js with a refusal\'s message cut to its first clause',
  }, async () => {
    const seen: string[] = [];
    let all = true;
    for (const cap of ['', 'lots']) {
      const ref = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/cacheEvict', params: { maxSize: cap }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(!ref.ok, `the language server accepted ${JSON.stringify(cap)} as a size cap outside the editor, so there is no refusal to carry: ${JSON.stringify(ref).slice(0, 200)}`);
      const want = `${TRIM_REFUSED}code=${String(ref.error.code)} ${ref.error.message}`;
      const store = storeFiles(scenarioStore);
      const mark = ctx.out.mark();
      const toastMark = (await toasts(ctx.d)).length;
      await openCache('evict');
      await trimInput(cap);
      await confirmation('evict', ASKED.evict.button);
      const told = await ending('the refused trim\'s notification', toastMark, (t) => t.message.startsWith(TRIM_REFUSED));
      const channel = await ctx.out.waitFor('the refused trim on the channel', mark, (t) => t.split('\n').includes(want), 10000).then(() => true, () => false);
      const kept = sameFiles(storeFiles(scenarioStore), store);
      const ok = told !== null && told.message === want && told.severity === 'error' && channel && kept;
      all = all && ok;
      seen.push(`${JSON.stringify(cap)}: ${told === null ? 'no refusal notification' : `"${told.message}" (${told.severity}, buttons ${JSON.stringify(told.buttons)})`}; the channel ${channel ? 'ends on the same line' : 'does not carry the line'}; the store ${kept ? 'unchanged' : 'changed'}; the server's own: ${JSON.stringify(want)}`);
    }
    return { passed: all, seen: seen.join('; ') };
  });

  await c.run('cache.a-size-the-report-shows-is-accepted-as-the-cap', {
    expected: 'the report\'s total size, typed exactly as the report prints it into the size cap prompt and confirmed, is accepted: the trim ends in a sentence of what it did — it removed entries, or the cache was already within the cap — and not in a refusal',
    plant: 'in the scratch copy, out/src/operations.js with the report\'s total size printed with its unit spelled out',
  }, async () => {
    need(totalSize !== '', 'the report printed no total size to type');
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('evict');
    await trimInput(totalSize);
    await confirmation('evict', ASKED.evict.button);
    const told = await ending('the trim\'s notification', toastMark, (t) => t.message.startsWith('The trim '));
    const accepted = told !== null && (TRIM_WITHIN.test(told.message) || TRIM_REMOVED.test(told.message));
    return { passed: accepted, seen: `typed ${JSON.stringify(totalSize)}; ${told === null ? 'no notification' : `"${told.message}" (${told.severity})`}` };
  });

  await c.run('cache.trim-to-a-cap-trims-or-says-it-was-within', {
    expected: 'evict answered "512MiB" and confirmed ends in a notification that it trimmed — "The trim removed <n> entries and reclaimed <size>." — or "The trim removed nothing: the cache held <size>, already within the <cap> cap."; the channel carries the same sentence',
    plant: 'in the scratch copy, out/src/operations.js with a trim already within its cap ending without what the cache held or what the cap was',
  }, async () => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('evict');
    await trimInput('512MiB');
    await confirmation('evict', ASKED.evict.button);
    const told = await ending('the trim\'s notification', toastMark, (t) => t.message.startsWith('The trim '));
    const said = await ctx.out.waitFor('the trim on the channel', mark, (t) => told !== null && t.split('\n').includes(told.message), 10000).then(() => true, () => false);
    const within = told !== null ? TRIM_WITHIN.exec(told.message) : null;
    const removed = told !== null ? TRIM_REMOVED.exec(told.message) : null;
    const withinConsistent = within === null || BINARY_SIZE.test(within[1]);
    return { passed: (within !== null || removed !== null) && withinConsistent && said, seen: `${told === null ? 'no notification' : `"${told.message}"`}; the channel ${said ? 'carries it' : 'does not carry it'}` };
  });

  // ---- prune ----
  await c.run('cache.prune-ends-in-what-it-removed-and-kept', {
    expected: 'prune confirmed ends in a notification "The prune removed <n> entries and reclaimed <size>."; the channel opens "Removing cache entries no lockfile references.", says how many entries it kept as still referenced, and says how far it reached',
    plant: 'in the scratch copy, out/src/operations.js with the prune\'s line for what it kept left out',
  }, async () => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('prune');
    await confirmation('prune', ASKED.prune.button);
    const told = await ending('the prune\'s notification', toastMark, (t) => t.message.startsWith('The prune '));
    const text = await ctx.out.waitFor('the prune on the channel', mark, (t) => told !== null && t.split('\n').includes(told.message), 10000).catch(() => ctx.out.since(mark));
    const lines = text.split('\n');
    const opens = lines.includes('Removing cache entries no lockfile references.');
    const kept = lines.some((l) => /^ {2}kept, still referenced: \d+ entr(y|ies)$/.test(l));
    const reach = lines.some((l) => l.startsWith(`  ${REACHED_BEYOND}`) || l === '  Nothing shared with other projects on this machine was reached.');
    return { passed: told !== null && PRUNE_ENDING.test(told.message) && opens && kept && reach, seen: `${told === null ? 'no notification' : `"${told.message}"`}; the channel ${JSON.stringify(lines.filter((l) => l.trim() !== '').slice(0, 8))}` };
  });

  // ---- clear, declined and then taken ----
  await c.run('cache.declined-clear-sends-nothing-and-says-so', {
    expected: `clear, taken from the menu beside Cache… and its confirmation dismissed with Escape, raises "${CLEAR_DECLINED}", writes nothing to the channel, and removes nothing from the store`,
    plant: 'in the scratch copy, out/src/operations.js with a declined confirmation taken as consent',
  }, async () => {
    const store = storeFiles(scenarioStore);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('clear');
    const d = await confirmation('clear', null);
    need(d !== null, 'clear drew no confirmation to dismiss');
    const told = await ending('the declined clear\'s notification', toastMark, (t) => t.message.startsWith('Aggrega: clear') || t.message.startsWith('The cache wipe'));
    // Nothing said and nothing removed, at every reading over a stated window from
    // the notification.
    const quiet = await holds(1500, async () => ({ said: ctx.out.since(mark).trim(), kept: sameFiles(storeFiles(scenarioStore), store) }), (v) => v.said === '' && v.kept);
    const said = quiet.held ? ctx.out.since(mark).trim() : (quiet.broke as { said: string }).said;
    const kept = quiet.held && sameFiles(storeFiles(scenarioStore), store);
    return { passed: told !== null && told.message === CLEAR_DECLINED && said === '' && kept, seen: `${told === null ? 'no notification' : `"${told.message}"`}; the channel gained ${JSON.stringify(said.slice(0, 200))}; the store ${kept ? 'unchanged' : 'changed'}` };
  });

  let emptied = false;
  await c.run('cache.clear-completes-and-says-what-it-emptied', {
    expected: 'clear confirmed completes: the channel opens "Emptying every cache this session addresses.", lists each cache emptied, and says how far it reached with "Reached beyond this workspace, shared by every project on this machine: <the caches>."; a notification reads "The cache wipe emptied <n> caches and reclaimed <size>. They repopulate on the next build.", <n> being the caches the channel lists; and the store under the scenario\'s home holds no compiled module afterwards, where it held some before',
    plant: 'in the scratch copy, out/src/operations.js with the wipe\'s count in its notification one more than the caches it emptied',
  }, async () => {
    const before = modulesIn(storeFiles(scenarioStore));
    need(before > 0, 'the scenario\'s store holds no compiled module before the wipe, so emptying it cannot be observed');
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await openCache('clear');
    await confirmation('clear', ASKED.clear.button);
    const told = await ending('the wipe\'s notification', toastMark, (t) => t.message.startsWith('The cache wipe'));
    const text = await ctx.out.waitFor('the wipe on the channel', mark, (t) => told !== null && t.split('\n').includes(told.message), 10000).catch(() => ctx.out.since(mark));
    const lines = text.split('\n');
    const listed = lines.filter((l) => /^ {2}emptied \S/.test(l));
    const reach = lines.find((l) => l.startsWith(`  ${REACHED_BEYOND}`)) ?? '';
    const m = told !== null ? CLEAR_ENDING.exec(told.message) : null;
    const after = modulesIn(storeFiles(scenarioStore));
    emptied = after === 0;
    return {
      passed: lines.includes('Emptying every cache this session addresses.') && listed.length > 0 && reach !== '' && m !== null && Number(m[1]) === listed.length && emptied,
      seen: `${told === null ? 'no notification' : `"${told.message}"`}; the channel lists ${JSON.stringify(listed.map((l) => l.trim()))} and ${reach ? JSON.stringify(reach.trim()) : 'no line of how far it reached'}; compiled modules in the scenario's store: ${before} before, ${after} after`,
    };
  });

  await c.run('cache.each-removal-confirms-first-naming-the-caches-it-reaches', {
    expected: `each of prune, evict and clear draws its confirmation before anything reaches the channel or the store, and each names what it reaches: prune "${ASKED.prune.message}" naming this workspace's caches and those every project on this machine shares, with "${ASKED.prune.button}"; evict "${ASKED.evict.message}" with the detail "${ASKED.evict.detail}" and "${ASKED.evict.button}"; clear "${ASKED.clear.message}" with the detail "${ASKED.clear.detail}" and "${ASKED.clear.button}"; status draws none`,
    plant: 'in the scratch copy, out/src/operation-groups.js with the trim\'s confirmation naming both scopes, as the other two do',
  }, async () => {
    need(asked.length > 0, 'no removal was asked for in this scenario');
    const judged = asked.map((a) => {
      const want = ASKED[a.op as keyof typeof ASKED];
      const d = a.dialog;
      const ok = d !== null && a.quiet && d.message === want.message && d.buttons.includes(want.button)
        && (want.detail === null ? want.names.every((n) => d.detail.includes(n)) : d.detail === want.detail);
      return { ok, line: `${a.op}: ${d === null ? 'no confirmation drawn' : `"${d.message}" / ${JSON.stringify(d.detail)} / ${JSON.stringify(d.buttons)}`}${a.quiet ? '' : ', and something reached the channel or the store while it was up'}` };
    });
    const ops = new Set(asked.map((a) => a.op));
    return { passed: judged.every((j) => j.ok) && ['prune', 'evict', 'clear'].every((o) => ops.has(o)), seen: [...new Set(judged.map((j) => j.line))].join('; ') };
  });

  await c.run('cache.operations-write-no-dollar-line-and-draw-no-progress-or-cancel', {
    expected: 'from the first cache operation to the last, the channel carries no line beginning "$" and no notification drawn carries a Cancel button; in the same scenario, Pull on the Commands panel writes its "$" line and draws its progress with a Cancel button, which shows both readings fire',
    plant: 'in the scratch copy, out/src/operations.js with the cache operations run behind a progress notification with a Cancel button',
  }, async () => {
    const text = ctx.out.since(firstOpMark);
    const dollars = text.split('\n').filter((l) => l.startsWith('$ '));
    const cancels = (await toastsSince(ctx.d, firstToastMark)).filter((t) => t.buttons.includes('Cancel')).map((t) => t.message);
    // The control.
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
    const pulled = await ctx.out.waitFor('the pull ending', mark, (t) => /^The pull /m.test(t), 120000).catch(() => ctx.out.since(mark));
    const controlDollar = pulled.split('\n').some((l) => l.startsWith(`$ ${bin} pull `));
    const controlCancel = (await toastsSince(ctx.d, toastMark)).some((t) => t.buttons.includes('Cancel'));
    need(controlDollar && controlCancel, `its positive control did not fire: Pull ${controlDollar ? 'wrote' : 'did not write'} a "$" line and ${controlCancel ? 'drew' : 'did not draw'} a notification with a Cancel button`);
    return { passed: dollars.length === 0 && cancels.length === 0, seen: `"$" lines during the cache operations: ${dollars.length === 0 ? 'none' : JSON.stringify(dollars)}; notifications with a Cancel button: ${cancels.length === 0 ? 'none' : JSON.stringify(cancels)}; the control's Pull wrote its "$" line and drew its progress with Cancel` };
  });

  await c.run('cache.operations-reach-only-this-scenarios-caches', {
    expected: `the language server runs with HOME and XDG_CACHE_HOME inside the scenario's scratch root (${ctx.s.root.dir}); every "Workspace:" line the cache operations wrote names the folder the window opened; the wipe emptied the store under the scenario's home, where it held compiled modules before; and the store this machine's own home holds (${machineStore}) holds every file it held before the first cache operation, listed and never written`,
    plant: 'in the scratch copy, out/src/operations.js with each cache answer\'s "Workspace:" line naming the folder above the workspace root',
  }, async () => {
    need(machineBefore.size > 0, `${machineStore} held nothing before the first cache operation, so that nothing of it was removed cannot be shown`);
    const srv = await theServer(ctx);
    const env = readEnviron(srv.pid);
    const inside = (p: string | undefined): boolean => p !== undefined && (p === ctx.s.root.dir || p.startsWith(`${ctx.s.root.dir}${path.sep}`));
    const workspaceLines = ctx.out.since(firstOpMark).split('\n').filter((l) => l.startsWith('  Workspace: ')).map((l) => l.slice('  Workspace: '.length));
    const right = workspaceLines.length > 0 && workspaceLines.every((l) => l === ctx.folder);
    const machineAfter = storeFiles(machineStore);
    const missing = [...machineBefore.keys()].filter((k) => !machineAfter.has(k));
    const added = [...machineAfter.keys()].filter((k) => !machineBefore.has(k));
    need(emptied, 'the wipe did not empty the scenario\'s own store, so where it reached is not shown');
    return {
      passed: inside(env.HOME) && inside(env.XDG_CACHE_HOME) && right && missing.length === 0 && modulesIn(scenarioAtStart) > 0,
      seen: `the server's HOME ${env.HOME}, XDG_CACHE_HOME ${env.XDG_CACHE_HOME}; "Workspace:" lines ${JSON.stringify([...new Set(workspaceLines)])}; the scenario's store held ${modulesIn(scenarioAtStart)} compiled module(s) at the start and none after the wipe; ${machineStore} held ${machineBefore.size} file(s) before and ${machineAfter.size} after, ${missing.length === 0 ? 'none of them gone' : `missing ${JSON.stringify(missing.slice(0, 10))}`}${added.length > 0 ? `, ${added.length} added, which the runner does not attribute` : ''}`,
    };
  });
}
