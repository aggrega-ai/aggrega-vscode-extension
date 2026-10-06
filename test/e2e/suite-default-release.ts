// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { FixtureError, FixtureProof, readTree, Tree } from './fixtures';
import { droppedRelease } from './levels';
import { LinkedAway, linkAway, linkAwayLeadingNowhere, outsideTheWorkspace, putBackLinked, untouched } from './linked-away';
import { referenceAnswer } from './reference';
import { paletteTitle } from './suite-first-day';
import { closeAllEditors, ready, reopen, send, SuiteContext, theServer } from './suite-context';
import { selectRelease } from './suite-own-catalogs';
import { drawnAsNotified } from './suite-selected-release';
import { commandsPanel, NOTIFICATION_MESSAGE_CAP, paletteRows, pickQuickInputRow, selectorRows, Toast, toasts, until, waitToast } from './workbench';

// The checks run in a folder holding three Releases and naming no default, on the
// command that records the selected Release as the workspace's default. The
// language server writes the marker that records it, holding the marker and the
// directory it sits in to the workspace; the extension writes nothing itself.
//
// The first three replace, in turn, the directory the marker sits in by a link to a
// directory outside the workspace, the marker by a link to a file outside it, and
// the marker by a link leading nowhere whose far end a write would create outside
// it. Each lists the directory outside before and after — the files it holds and
// their bytes — requires it unchanged, and reads the refusal the reader is shown
// against the language server's own refusal of the same request over the folder in
// the same state; each takes its link away again. The last records the default
// inside the folder and reads that the editor starts on it once the choice it
// remembers for the window no longer stands.

export const DEFAULT_RELEASE_CHECKS = [
  'default-release.refused-where-its-directory-leads-out',
  'default-release.refused-where-the-marker-leads-out',
  'default-release.refused-where-the-marker-leads-nowhere-outside',
  'default-release.recorded-inside-and-started-on-once-the-remembered-choice-is-gone',
] as const;

// The folder's three Releases: the fixture's two, and a third written beside them
// as a copy of the first under a name of its own.
const LOCAL = 'release-local.yaml';
const STAGING = 'release-staging.yaml';
const REVIEW = 'release-review.yaml';

// RECORDED is the Release each check records.
const RECORDED = STAGING;

// The marker and the directory holding it, as the reader's command names them.
const MARKER_DIR = '.aggrega';
const MARKER = path.join(MARKER_DIR, 'active-release');

// The words the command ends in, held as written so a change of wording in the
// extension is a change these checks report rather than follow; the words after
// NOT_WRITTEN are the compiler's, read off its own answer.
const NOT_WRITTEN = `Aggrega: could not write ${MARKER_DIR}/active-release: `;
const recorded = (release: string): string => `Aggrega: ${release} is now this workspace's default Release.`;

// KEPT_OUTSIDE is what a directory outside the workspace holds before a check, and
// MARKER_KEPT_OUTSIDE the marker kept outside behind a link, naming another Release.
const KEPT_OUTSIDE = 'Kept outside the workspace, beside a link no write may follow.\n';
const MARKER_KEPT_OUTSIDE = `${LOCAL}\n`;

// placeThirdRelease writes REVIEW beside the fixture's two Releases, a copy of
// LOCAL under a name of its own, and reads it back.
export function placeThirdRelease(folder: string): FixtureProof {
  const fixture = `a third Release, ${REVIEW}, in ${path.basename(folder)}`;
  const from = fs.readFileSync(path.join(folder, LOCAL), 'utf8');
  const text = from.replace('  name: console-local\n', '  name: console-review\n').replace('./release-local.yaml', `./${REVIEW}`);
  if (text === from || !text.includes('  name: console-review\n')) {
    throw new FixtureError(fixture, `${LOCAL} does not carry the name "console-local" once to write the copy under its own`);
  }
  fs.writeFileSync(path.join(folder, REVIEW), text);
  if (fs.readFileSync(path.join(folder, REVIEW), 'utf8') !== text) { throw new FixtureError(fixture, `${REVIEW} does not read back as written`); }
  const releases = fs.readdirSync(folder).filter((f) => /^release.*\.ya?ml$/.test(f)).sort();
  return { fixture, built: true, proof: `${REVIEW} written as ${LOCAL} named console-review; the folder holds the Releases ${releases.join(', ')}, and its configuration names no default` };
}

// describeTree words a directory's files and their bytes for a check's report.
function describeTree(t: Tree): string {
  return t.size === 0 ? 'no file' : [...t].map(([f, b]) => `${f} (${JSON.stringify(b.toString('utf8'))})`).join(', ');
}

// Layout is one way the marker's place leads out of the workspace: the directory
// outside it is filled, and then the link is placed.
interface Layout { what: string; outsideName: string; fill: (outside: string) => void; place: (folder: string, outside: string) => LinkedAway }

const LAYOUTS: Record<string, Layout> = {
  directory: {
    what: `${MARKER_DIR} a link to a directory outside the workspace`,
    outsideName: 'marker-directory',
    fill: (outside) => { fs.writeFileSync(path.join(outside, 'kept.txt'), KEPT_OUTSIDE); },
    place: (folder, outside) => linkAway(folder, MARKER_DIR, outside),
  },
  marker: {
    what: `${MARKER} a link to a file outside the workspace naming ${LOCAL}`,
    outsideName: 'marker-file',
    fill: (outside) => { fs.writeFileSync(path.join(outside, 'active-release'), MARKER_KEPT_OUTSIDE); },
    place: (folder, outside) => linkAway(folder, MARKER, path.join(outside, 'active-release')),
  },
  nowhere: {
    what: `${MARKER} a link leading nowhere, to a file a write would create in a directory outside the workspace`,
    outsideName: 'marker-nowhere',
    fill: (outside) => { fs.writeFileSync(path.join(outside, 'kept.txt'), KEPT_OUTSIDE); },
    place: (folder, outside) => linkAwayLeadingNowhere(folder, MARKER, path.join(outside, 'active-release')),
  },
};

export async function defaultReleaseChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const title = paletteTitle(ctx, 'aggrega.workspace.createActiveReleaseMarker');
  const marker = path.join(ctx.folder, MARKER);
  await ready(ctx);

  // releaseRow is the value the Commands panel's Release row reads.
  const releaseRow = async (): Promise<string> => (await selectorRows(await commandsPanel(ctx.d))).find((r) => r.label === 'Release')?.value ?? '';
  const selected = async (release: string): Promise<void> => {
    if (await releaseRow() !== release) { await selectRelease(ctx, release); }
  };

  // takeTheCommand runs the command as a reader does, from the command palette,
  // and answers with the notification it ends in: its refusal or its success.
  const takeTheCommand = async (): Promise<Toast | null> => {
    await closeAllEditors(ctx);
    const mark = (await toasts(ctx.d)).length;
    const q = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), title);
    need(q.rows.some((r) => r.label === title), `the command palette does not offer "${title}": ${JSON.stringify(q.rows.map((r) => r.label))}`);
    await pickQuickInputRow(ctx.d, title);
    return waitToast(ctx.d, 'the command\'s ending', mark, (t) => t.message.startsWith(NOT_WRITTEN) || t.message === recorded(RECORDED), 20000).catch(() => null);
  };

  // ---- the marker's place leading out of the workspace ----

  const refusedWhere = (name: string, layout: Layout): Promise<unknown> => c.run(name, {
    expected: `with ${RECORDED} selected on the Release row and ${layout.what}, "${title}" taken from the command palette ends in one error notification reading "${NOT_WRITTEN}" followed by the language server's own refusal of the same request over the folder — drawn as the editor draws a message, its first ${NOTIFICATION_MESSAGE_CAP} characters followed by "..." where it is longer — and the directory outside holds the same files with the same bytes before the command, after the language server's own refusal and after the command, with the link still leading where it led`,
    plant: 'in the scratch copy, out/src/extension.js with the command writing the marker itself before it asks the language server; or out/src/active-release-marker.js with the refusal ending in words of the extension\'s own',
  }, async () => {
    await selected(RECORDED);
    const outside = outsideTheWorkspace(ctx.folder, layout.outsideName);
    fs.mkdirSync(outside, { recursive: true });
    layout.fill(outside);
    const away = layout.place(ctx.folder, outside);
    try {
      const before = readTree(outside);
      const leadsTo = fs.readlinkSync(away.link);
      const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/setActiveRelease', params: { release: RECORDED }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(!ref.ok, `the language server recorded ${RECORDED} over the folder with ${layout.what}, so there is no refusal to carry`);
      need(ref.error.message.includes(away.link), `the language server's refusal does not name ${away.link}: ${ref.error.message.slice(0, 300)}`);
      const byTheServer = untouched(before, outside);
      const want = `${NOT_WRITTEN}${ref.error.message}`;
      const told = await takeTheCommand();
      const kept = untouched(before, outside);
      const linkKept = fs.lstatSync(away.link).isSymbolicLink() && fs.readlinkSync(away.link) === leadsTo;
      const words = told !== null && told.severity === 'error' && drawnAsNotified(told.message, want);
      return {
        passed: words && byTheServer.same && kept.same && linkKept,
        seen: `the language server refused the write (${JSON.stringify((ref.error.data as { shortCode?: string } | null)?.shortCode ?? null)}) "${ref.error.message.slice(0, 240)}"; the notification ${told === null ? 'none ending the command' : `${words ? 'reads that refusal after the extension\'s words, as the editor draws it' : JSON.stringify(told.message.slice(0, 300))} (${told.severity})`}; outside before: ${describeTree(before)}; after the language server's own refusal: ${byTheServer.seen}; after the command: ${describeTree(readTree(outside))} — ${kept.seen}; the link ${linkKept ? `still leads to ${leadsTo}` : 'was changed'}`,
        evidence: { want, told },
      };
    } finally {
      putBackLinked(away);
    }
  });

  await refusedWhere('default-release.refused-where-its-directory-leads-out', LAYOUTS.directory);
  await refusedWhere('default-release.refused-where-the-marker-leads-out', LAYOUTS.marker);
  await refusedWhere('default-release.refused-where-the-marker-leads-nowhere-outside', LAYOUTS.nowhere);

  // ---- the marker recorded inside the workspace ----

  const review = path.join(ctx.folder, REVIEW);
  const aside = `${review}.off`;
  await c.run('default-release.recorded-inside-and-started-on-once-the-remembered-choice-is-gone', {
    expected: `with ${RECORDED} selected on the Release row — the folder holding ${LOCAL}, ${STAGING} and ${REVIEW} and naming no default — "${title}" taken from the command palette raises "${recorded(RECORDED)}", ${MARKER} reads "${RECORDED}" followed by a line break, and the language server's own aggrega/activeRelease over the folder answers ${RECORDED}; then, with ${REVIEW} chosen on the Release row and renamed to ${path.basename(aside)} so it is no longer offered, the editor closed and opened again on the folder — its language server started again, a new process — drops that choice, saying "${droppedRelease(REVIEW)}", and starts on the Release the marker records: the Release row names ${RECORDED}`,
    plant: 'in the scratch copy, out/src/extension.js with the command sent to the language server as the request reading the default rather than the one recording it',
  }, async () => {
    need(!fs.existsSync(marker) && !fs.existsSync(path.join(ctx.folder, MARKER_DIR)), `${MARKER_DIR} is already in the folder, so a marker read afterwards would not show this command wrote it`);
    need(fs.existsSync(review), `${REVIEW} is not in the folder`);
    await selected(RECORDED);
    const told = await takeTheCommand();
    const written = await until(`${MARKER} written`, 10000, async () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null), (v) => v !== null).catch(() => null);
    const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/activeRelease', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    const answered = ref.ok ? (ref.result as { release?: string } | null)?.release ?? null : null;
    // The choice the window remembers, made to stand no longer: a Release chosen
    // on the row is remembered for the window and taken again when it opens,
    // whatever the marker says, so the one chosen here is renamed out of what is
    // offered first. A language server restarted inside the window keeps the
    // selection in force, so what is read is a window opened again.
    await selectRelease(ctx, REVIEW);
    fs.renameSync(review, aside);
    try {
      const before = await theServer(ctx);
      const r = await reopen(ctx);
      need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
      await ready(ctx);
      const next = await theServer(ctx, 30000, before.pid).then((s) => s.pid, () => null);
      const dropped = await waitToast(ctx.d, 'the notice that the remembered choice was dropped', 0, (t) => t.message === droppedRelease(REVIEW), 20000).then(() => true, () => false);
      const row = await until(`the Release row naming ${RECORDED}`, 20000, releaseRow, (v) => v === RECORDED).catch(releaseRow);
      const ok = told !== null && told.severity === 'info' && told.message === recorded(RECORDED) && written === `${RECORDED}\n` && answered === path.join(ctx.folder, RECORDED) && next !== null && dropped && row === RECORDED;
      return {
        passed: ok,
        seen: `the command ended ${told === null ? 'with no notification' : `"${told.message}" (${told.severity})`}; ${MARKER} ${written === null ? 'was not written' : `reads ${JSON.stringify(written)}`}; the language server's own default ${ref.ok ? JSON.stringify(answered) : `refused: ${ref.error.message.slice(0, 200)}`}; opened again in ${r.bringUpMs} ms with its language server ${next === null ? 'the same process or none' : `in process ${next}, not ${before.pid}`}; ${dropped ? 'the remembered choice was said to be dropped' : 'no notice that the remembered choice was dropped'}; the Release row then reads "${row}"`,
      };
    } finally {
      if (!fs.existsSync(review) && fs.existsSync(aside)) { fs.renameSync(aside, review); }
    }
  });
}
