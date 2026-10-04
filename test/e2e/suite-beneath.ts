// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { describeUnreadLinkedDirs } from '../../src/release-selection';
import { NotRun, Unreachable } from './checks';
import { findGraphPanel, graphState, showGraph } from './graph-panel';
import { ABOVE_MESSAGE, aboveDetail, closeChooser, describeRows, rowChooser, statusHover, takeChooserRow, waitRows } from './levels';
import { referenceAnswer, ReferenceAnswer } from './reference';
import { continueHere } from './suite-above';
import { ready, SuiteContext } from './suite-context';
import { commandsPanel, holds, pressOperation, stated, statusItems, toasts, toastsSince, until, waitToast } from './workbench';

// The checks run in a documentation example opened alone beneath a root whose
// configuration marks it as the Aggrega workspace, the folder itself carrying no
// configuration of its own: the two rows naming the folder and the root above it,
// every Release the chooser offers accepted by the graph and the build, the
// chooser offering every Release file the workspace holds, and what the chooser
// says about a link leading out of the workspace — nothing while there is none,
// and the link named once one is placed in the folder.

export const BENEATH_CHECKS = [
  'beneath-a-workspace.rows-name-the-folder-and-the-root-above-it',
  'context-rows.release-row-names-the-path-relative-to-the-root',
  'beneath-a-workspace.every-offered-release-is-accepted',
  'beneath-a-workspace.release-chooser-offers-every-release-file',
  'beneath-a-workspace.release-chooser-names-no-link-where-none-leads-out',
  'beneath-a-workspace.release-chooser-names-the-link-leading-out-of-the-root',
  'beneath-a-workspace.releases-that-cannot-be-offered-are-named',
] as const;

// LINK is the name of the link the scenario places in the folder, leading to a
// directory outside the root that holds a Release; BEHIND_THE_LINK is that
// Release's file name.
const LINK = 'shared-releases';
const BEHIND_THE_LINK = 'release-behind-the-link.yaml';

// LINE_WINDOW_MS is how long an open chooser is watched for a line naming a link
// where none should be drawn.
const LINE_WINDOW_MS = 3000;

// LINK_LINE_HEADS are the words the chooser's line opens with, for one link and
// for several, read off the extension's own composition of the line rather than
// typed here: a notification opening with either is that line, whatever links it
// names. A notification is read with its surrounding space trimmed, so a head is
// too — a line drawn naming nothing ends where its names would start.
const LINK_LINE_HEADS = [['\u0000'], ['\u0000', '\u0000']].map((names) => {
  const line = describeUnreadLinkedDirs(names) ?? '';
  return line.slice(0, line.indexOf('\u0000')).trimEnd();
});

function isLinkLine(message: string): boolean {
  return LINK_LINE_HEADS.some((head) => head !== '' && message.startsWith(head));
}

// linkedDirsIn reads the linked directories the language server's answer names,
// or null where the answer is a refusal or carries no such list.
function linkedDirsIn(a: ReferenceAnswer): string[] | null {
  if (!a.ok) { return null; }
  const dirs = (a.result as { unreadLinkedDirs?: unknown } | null)?.unreadLinkedDirs;
  return Array.isArray(dirs) && dirs.every((d) => typeof d === 'string') ? dirs as string[] : null;
}

// candidatesOver is the language server's own answer to the request the chooser
// is drawn from, over the root, taken outside the editor.
function candidatesOver(ctx: SuiteContext, root: string): Promise<ReferenceAnswer> {
  return referenceAnswer({ binary: ctx.inputs.compiler.path, root, method: 'aggrega/releaseCandidates', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
}

// placeLinkLeadingOut writes a Release into a directory beside the root, outside
// it, and places a link to that directory in the folder, where the editor's file
// tree shows the Release through it. It answers with the link's path and its name
// relative to the root, in the form the language server names a path.
function placeLinkLeadingOut(root: string, folder: string): { link: string; rel: string; behind: string } {
  const outside = path.join(path.dirname(root), 'outside-the-workspace', LINK);
  const link = path.join(folder, LINK);
  try {
    fs.mkdirSync(outside, { recursive: true });
    fs.copyFileSync(path.join(folder, COMPOSE), path.join(outside, BEHIND_THE_LINK));
    fs.symlinkSync(outside, link, 'dir');
  } catch (err) {
    throw new NotRun(`the link leading out of the root could not be placed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const behind = path.join(link, BEHIND_THE_LINK);
  if (!path.relative(root, outside).startsWith('..') || !fs.existsSync(behind)) {
    throw new NotRun(`${outside} is not outside ${root}, or ${behind} does not read through the link`);
  }
  return { link, rel: path.relative(root, link).split(path.sep).join('/'), behind };
}

const COMPOSE = 'release-compose.yaml';

// How long each Release's graph is given to be drawn by its own request.
const GRAPH_BOUND_MS = 60000;

// GRAPH_REFUSED is the line the Aggrega output channel carries each time a graph
// is asked for and refused; the lines it matches are carried into the report as
// they stand.
const GRAPH_REFUSED = /^The topology of .* could not be drawn: /m;

// releaseFilesUnder lists every Release document beneath a directory: each file
// named release…yaml or release…yml, other than a lockfile, whose text declares
// the Release kind.
function releaseFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'dist' && e.name !== '.aggrega') { walk(f); } continue; }
      if (!/^release.*\.ya?ml$/.test(e.name) || /\.lock\.ya?ml$/.test(e.name)) { continue; }
      if (/^kind:\s*Release\s*$/m.test(fs.readFileSync(f, 'utf8'))) { out.push(f); }
    }
  };
  walk(dir);
  return out.sort();
}

const CANNOT_BE_OFFERED = Unreachable.declare('beneath-a-workspace.releases-that-cannot-be-offered-are-named', {
  expected: 'where the chooser offers fewer Releases than the workspace holds, it says how many and where they sit, with their paths on the output channel',
  plant: 'in the scratch copy, out/src/release-selection.js with the sentence naming Releases that cannot be offered left out',
}, 'the sentence is for a language server reading a different root from the one the editor sent it, and no layout built from the runner\'s inputs makes the two disagree: with both reading the same root, every Release is offered; and a Release inside a directory linked from outside the root is not listed by the language server at all — the link is named on a line of its own instead, which the check before this one reads — so it does not reach the sentence either');

export async function beneathChecks(ctx: SuiteContext, root: string): Promise<void> {
  const c = ctx.checks;
  const folder = ctx.folder;
  const folderName = path.basename(folder);
  const rootName = path.basename(root);
  const composeRel = path.relative(root, path.join(folder, COMPOSE));
  const raised = await continueHere(ctx);
  await ready(ctx);

  await c.run('beneath-a-workspace.rows-name-the-folder-and-the-root-above-it', {
    expected: `opening ${folderName} alone beneath ${root}, the interruption says the workspace is outside the folder opened (answered Continue here), the Project folder row reads "${folderName}" and the Aggrega workspace row "${rootName}", carrying the warning mark — the two differ, which is the point — and the status bar's workspace item's hover opens with ${root}, the root the editor sent the language server`,
    plant: 'in the scratch copy, out/src/selector-rows.js with the Aggrega workspace row drawn without its mark',
  }, async () => {
    const rows = await waitRows(ctx, 'the rows naming the folder and the root', (r) => r[0]?.value === folderName && r[1]?.value === rootName);
    const status = await until('the status bar\'s workspace item', 15000, () => statusHover(ctx, (i) => i.side === 'right' && i.text.startsWith('Aggrega')), (v) => v !== null && v.hover !== '').catch(() => null);
    return {
      passed: raised !== null && raised.message === ABOVE_MESSAGE && raised.detail === aboveDetail(root, folder) && rows[0]?.value === folderName && rows[1]?.value === rootName && rows[1].mark !== null && status !== null && status.hover.startsWith(root),
      seen: `the interruption ${raised ? JSON.stringify(raised) : 'not raised'}; the rows ${describeRows(rows)}; the status bar item ${status ? `"${status.item.text}", hover ${JSON.stringify(status.hover)}` : 'not drawn'}`,
    };
  });

  await c.run('context-rows.release-row-names-the-path-relative-to-the-root', {
    expected: `the Release chooser offers ${COMPOSE} with ${composeRel} beside it, and choosing it makes the Release row read its path relative to the root, "${composeRel}", while the status bar's Release indicator reads the file name alone, "${COMPOSE}"`,
    plant: 'in the scratch copy, out/src/release-selection.js with the Release row reading the file name alone',
  }, async () => {
    const q = await rowChooser(ctx, 'release', { boundMs: 15000 });
    const entry = q.rows.find((r) => r.description === composeRel || r.text.includes(composeRel));
    if (entry === undefined) {
      await closeChooser(ctx.d);
      return { passed: false, seen: `the chooser offers no entry beside ${composeRel}: ${JSON.stringify(q.rows.map((r) => [r.label, r.description]))}` };
    }
    await takeChooserRow(ctx.d, entry.label);
    const rows = await waitRows(ctx, `the Release row naming ${composeRel}`, (r) => r[2]?.value === composeRel);
    const indicator = await until('the Release indicator', 10000, () => statusItems(ctx.d), (v) => v.some((i) => i.side === 'left' && i.text === COMPOSE)).then(() => true, () => false);
    return { passed: rows[2]?.value === composeRel && indicator, seen: `the rows ${describeRows(rows)}; the indicator ${indicator ? `reads ${COMPOSE}` : `does not read ${COMPOSE}: ${JSON.stringify((await statusItems(ctx.d)).map((i) => i.text))}`}` };
  });

  await c.run('beneath-a-workspace.every-offered-release-is-accepted', {
    expected: `every Release the chooser offers is named by its file with its path relative to ${root} beside it, and each, chosen in turn and shown as a topology graph, is accepted: the graph panel is given a drawing by that Release's own request, with nodes and no notice at its head, within ${GRAPH_BOUND_MS} ms; then, with ${COMPOSE} chosen, Build completes`,
    plant: 'in the scratch copy, out/src/release-selection.js with each Release offered sent by its file name alone rather than by its path relative to the root',
  }, async () => {
    const q = await rowChooser(ctx, 'release', { boundMs: 15000 });
    await closeChooser(ctx.d);
    const seen: string[] = [];
    let passed = q.rows.length > 0;
    for (const entry of q.rows) {
      const named = entry.description.endsWith(entry.label) && !path.isAbsolute(entry.description) && fs.existsSync(path.join(root, entry.description));
      await rowChooser(ctx, 'release', { boundMs: 15000 });
      await takeChooserRow(ctx.d, entry.label);
      await waitRows(ctx, `the Release row naming ${entry.description}`, (r) => r[2]?.value === entry.description, 15000);
      const mark = ctx.out.mark();
      // A drawing counts only where the canvas is given one after this press: a
      // drawing an earlier Release left stays in place whatever this request does.
      const refused = await showGraph(ctx, stated(GRAPH_BOUND_MS)).then(() => null, async (err: unknown) => {
        // A Graph button that cannot be pressed is a precondition, not a refusal.
        if (err instanceof NotRun) { throw err; }
        const doc = await findGraphPanel(ctx);
        const state = doc === null ? null : await graphState(doc).catch(() => null);
        return `${err instanceof Error ? err.message : String(err)}; the panel's notice ${JSON.stringify(state?.status ?? null)}`;
      });
      const channel = ctx.out.since(mark).split('\n').filter((l) => GRAPH_REFUSED.test(l));
      passed = passed && named && refused === null;
      seen.push(`${entry.label} (${entry.description}): ${named ? 'named relative to the root' : 'not named relative to the root'}, ${refused === null ? 'drawn by its own request' : `not drawn: ${refused}`}${channel.length > 0 ? `; the channel ${JSON.stringify(channel)}` : ''}`);
    }
    const compose = (await rowChooser(ctx, 'release', { boundMs: 15000 })).rows.find((r) => r.label === COMPOSE);
    if (compose === undefined) {
      await closeChooser(ctx.d);
      seen.push(`the chooser offers no ${COMPOSE} to build`);
      return { passed: false, seen: seen.join('; ') };
    }
    await takeChooserRow(ctx.d, COMPOSE);
    await waitRows(ctx, `the Release row naming ${composeRel}`, (r) => r[2]?.value === composeRel, 15000);
    const mark = ctx.out.mark();
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
    const text = await ctx.out.waitFor('the build closing its report', mark, (t) => /^Build completed: /m.test(t) || /^The build did not complete/m.test(t), 180000).catch(() => ctx.out.since(mark));
    const built = /^Build completed: /m.test(text);
    passed = passed && built;
    seen.push(`Build of ${COMPOSE}: ${text.split('\n').find((l) => l.startsWith('Build completed: ') || l.startsWith('The build did not complete')) ?? 'no ending'}`);
    return { passed, seen: seen.join('; ') };
  });

  await c.run('beneath-a-workspace.release-chooser-offers-every-release-file', {
    expected: `the Release chooser offers every Release document beneath ${root}, each by its path relative to the root, and no other`,
    plant: 'in the scratch copy, out/src/release-selection.js with the last Release the language server lists left out of the chooser without a word',
  }, async () => {
    const files = releaseFilesUnder(root);
    const toastMark = (await toasts(ctx.d)).length;
    const q = await rowChooser(ctx, 'release', { boundMs: 15000 });
    await closeChooser(ctx.d);
    const offered = q.rows.map((r) => path.join(root, r.description)).sort();
    const told = (await toastsSince(ctx.d, toastMark)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    return { passed: JSON.stringify(offered) === JSON.stringify(files), seen: `Release documents beneath the root ${JSON.stringify(files.map((f) => path.relative(root, f)))}; offered ${JSON.stringify(q.rows.map((r) => r.description))}; Aggrega notifications drawn since the press ${JSON.stringify(told)}` };
  });

  await c.run('beneath-a-workspace.release-chooser-names-no-link-where-none-leads-out', {
    expected: `with no link in ${root} leading out of it, the language server's own answer to aggrega/releaseCandidates over ${root} names no linked directory, and the Release chooser, opened and watched ${LINE_WINDOW_MS} ms, draws no line naming one`,
    plant: 'in the scratch copy, out/src/release-selection.js with the line naming links drawn where the answer names none',
  }, async () => {
    const named = linkedDirsIn(await candidatesOver(ctx, root));
    const toastMark = (await toasts(ctx.d)).length;
    const q = await rowChooser(ctx, 'release', { boundMs: 15000 });
    const watched = await holds(LINE_WINDOW_MS, () => toastsSince(ctx.d, toastMark), (ts) => !ts.some((t) => isLinkLine(t.message)));
    await closeChooser(ctx.d);
    const told = (await toastsSince(ctx.d, toastMark)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    return {
      passed: named !== null && named.length === 0 && q.rows.length > 0 && watched.held,
      seen: `the language server names ${named === null ? 'no list of linked directories' : JSON.stringify(named)}; the chooser offers ${JSON.stringify(q.rows.map((r) => r.description))}; ${watched.held ? `no line naming a link drawn over ${watched.readings} readings` : `a line naming a link drawn after ${watched.atMs} ms`}; Aggrega notifications drawn since the press ${JSON.stringify(told)}`,
    };
  });

  await c.run('beneath-a-workspace.release-chooser-names-the-link-leading-out-of-the-root', {
    expected: `with ${LINK} placed in the folder as a link to a directory outside ${root} holding ${BEHIND_THE_LINK}, the language server's own answer to aggrega/releaseCandidates over ${root} names that link alone, by its path relative to the root; opening the Release chooser draws the extension's line for exactly the links that answer names, once, in a notification of its own; and the chooser offers every Release document beneath the root, each by its path relative to the root, and nothing behind the link`,
    plant: 'in the scratch copy, out/src/release-selection.js with the line naming links never drawn',
  }, async () => {
    const placed = placeLinkLeadingOut(root, folder);
    const named = linkedDirsIn(await candidatesOver(ctx, root));
    const line = named === null ? null : describeUnreadLinkedDirs(named);
    const files = releaseFilesUnder(root);
    const toastMark = (await toasts(ctx.d)).length;
    const q = await rowChooser(ctx, 'release', { boundMs: 15000 });
    const drawn = line === null ? null : await waitToast(ctx.d, 'the chooser\'s line naming the link', toastMark, (t) => t.message === line.trim(), 10000).catch(() => null);
    await closeChooser(ctx.d);
    const told = (await toastsSince(ctx.d, toastMark)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    const offered = q.rows.map((r) => path.join(root, r.description)).sort();
    const namedTheLink = named !== null && JSON.stringify(named) === JSON.stringify([placed.rel]);
    const once = told.filter(isLinkLine).length === 1;
    const offersWhatTheRootHolds = JSON.stringify(offered) === JSON.stringify(files) && !q.rows.some((r) => r.description.startsWith(`${placed.rel}/`));
    return {
      passed: namedTheLink && drawn !== null && once && offersWhatTheRootHolds,
      seen: `${placed.behind} reads through the link; the language server names ${named === null ? 'no list of linked directories' : JSON.stringify(named)} (the link placed is ${placed.rel}); the line ${drawn === null ? `${JSON.stringify(line)} not drawn` : `drawn: ${JSON.stringify(drawn.message)}`}; Aggrega notifications drawn since the press ${JSON.stringify(told)}; Release documents beneath the root ${JSON.stringify(files.map((f) => path.relative(root, f)))}; offered ${JSON.stringify(q.rows.map((r) => r.description))}`,
    };
  });

  c.notRun(CANNOT_BE_OFFERED);
}
