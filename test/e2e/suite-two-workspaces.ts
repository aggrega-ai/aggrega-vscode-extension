// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import {
  addWithTheEditorsCommand, Chooser, chooser, closeChooser, describePending, describeRows, noChoicePending, nowWorkingFrom, nowWorkingIn, openFolders, PENDING_CHOICE_ACTION, pendingChoiceNotice,
  PLACEHOLDER, projectHover, reloadWindow, rowChooser, rowsNow, serverIn, serversWorking, statusHover, statusItem, takeChooserRow, ToastLedger, waitChooser, waitRows, welcomeWorkspaceValues,
  WELCOME_WORKSPACE_VALUE, WIDEN_ANOTHER, WIDEN_DETAIL, workspaceHover,
} from './levels';
import { languageServers, ready, SuiteContext, theServer } from './suite-context';
import { PAGE_TITLE, pageTabs, WELCOME_PAGE } from './welcome';
import { evaluateWithin, holds, pressToastButton, RUNNING, stated, toasts, toastsSince, until, waitStatus, waitToast } from './workbench';

// The checks run in a window that reaches two Aggrega workspaces, each a folder
// of its own: one opened alone, the other added with the editor's own command. No
// language server starts until the reader chooses which one to work in; choosing,
// and switching, moves every surface that names the workspace; the Project folder
// chosen scopes which workspaces are on offer; and both choices are remembered
// for the window through a reload.

export const TWO_WORKSPACES_CHECKS = [
  'two-workspaces.editor-add-leaves-the-choice-to-the-reader',
  'two-workspaces.choosing-from-the-notice-starts-the-server-there',
  'two-workspaces.workspace-chooser-in-a-two-folder-window',
  'two-workspaces.switching-moves-the-rows-and-the-status-bar',
  'two-workspaces.switching-moves-the-welcome-page',
  'two-workspaces.workspace-chosen-survives-a-reload',
  'two-workspaces.project-folder-choice-scopes-the-workspaces-on-offer',
  'two-workspaces.project-folder-choice-survives-a-reload',
  'two-workspaces.project-hover-with-two-folders-names-no-sole-candidate',
] as const;

// The Releases each workspace holds.
const MYSQL_RELEASES = ['release-replicated.yaml', 'release-single.yaml'];
const POSTGRES_RELEASES = ['release-bare.yaml', 'release-config.yaml'];

// How long a window with two workspaces and no choice is watched for a language
// server starting by itself, and a window that has its choice for the choice
// being offered again.
const NO_SERVER_MS = 4000;
const NO_OFFER_MS = 4000;

// How long the welcome page is given, once a switch has moved the rows, to draw
// the workspace switched to.
const WELCOME_SETTLE_MS = 15000;

// releasesOffered opens the Release row's chooser and answers with the Releases
// it lists, by file.
async function releasesOffered(ctx: SuiteContext): Promise<string[]> {
  const q = await rowChooser(ctx, 'release', { boundMs: 15000 }).catch(() => chooser(ctx.d));
  await closeChooser(ctx.d);
  return (q?.rows ?? []).map((r) => r.label).sort();
}

// workspaceChooser opens the Aggrega workspace row's chooser and answers with it,
// left open.
function workspaceChooser(ctx: SuiteContext): Promise<Chooser> {
  return rowChooser(ctx, 'workspace');
}

// DRAWN_BEFORE_ADD is the key every welcome page's document is marked under just
// before the add, so a page read afterwards says whether it is a document drawn
// before the extensions restarted or one drawn since.
const DRAWN_BEFORE_ADD = '__twoWorkspacesDrawnBeforeAdd';

// PagesDrawn is every welcome page the window holds as read at one moment: each
// page's document, with what its workspace step stands at and whether it carries
// the mark made before the add; the documents that gave no answer, which are not
// read as no page, for the reason welcomePages (welcome.ts) gives; and the tabs
// the editor draws for the page.
interface PagesDrawn { pages: { value: string; drawnBeforeAdd: boolean }[]; unanswered: number; tabs: number }

async function pagesDrawn(ctx: SuiteContext): Promise<PagesDrawn> {
  const reading = `(${WELCOME_PAGE}) ? { value: ${WELCOME_WORKSPACE_VALUE} ?? '', drawnBeforeAdd: window[${JSON.stringify(DRAWN_BEFORE_ADD)}] === true } : null`;
  const pages: PagesDrawn['pages'] = [];
  let unanswered = 0;
  for (const doc of await ctx.d.webviews()) {
    try {
      const page = await evaluateWithin<PagesDrawn['pages'][number] | null>(doc, reading, 2000);
      if (page !== null) { pages.push(page); }
    } catch {
      unanswered++;
    }
  }
  return { pages, unanswered, tabs: (await pageTabs(ctx)).length };
}

// markPagesBeforeAdd marks every welcome page's document the window holds, and
// answers with how many it marked and how many documents gave no answer.
async function markPagesBeforeAdd(ctx: SuiteContext): Promise<{ marked: number; unanswered: number }> {
  let marked = 0;
  let unanswered = 0;
  for (const doc of await ctx.d.webviews()) {
    try {
      if (await evaluateWithin<boolean>(doc, `(${WELCOME_PAGE}) && (window[${JSON.stringify(DRAWN_BEFORE_ADD)}] = true)`, 2000)) { marked++; }
    } catch {
      unanswered++;
    }
  }
  return { marked, unanswered };
}

// describePages words a reading of the welcome pages for a check's report.
function describePages(p: PagesDrawn): string {
  const pages = p.pages.map((x) => `${JSON.stringify(x.value)} (${x.drawnBeforeAdd ? 'the document drawn before the add' : 'a document drawn since'})`);
  return `${p.tabs} tab(s) titled "${PAGE_TITLE}"; ${p.pages.length} page document(s)${pages.length > 0 ? `: ${pages.join(', ')}` : ''}${p.unanswered > 0 ? `; ${p.unanswered} document(s) gave no answer` : ''}`;
}

export async function twoWorkspacesChecks(ctx: SuiteContext, postgres: string): Promise<void> {
  const c = ctx.checks;
  const mysql = ctx.folder;
  const mysqlName = path.basename(mysql);
  const postgresName = path.basename(postgres);
  const ledger = new ToastLedger();
  // The welcome pages drawn before the add, how many of their documents were
  // marked, and the pages the window holds once the add has come back, read
  // beside the verdicts that follow.
  let welcomeBeforeAdd: string[] = [];
  let markedBeforeAdd = { marked: 0, unanswered: 0 };
  let pagesAfterAdd: PagesDrawn | null = null;
  // Whether the choice the add leaves to the reader was read, which is the
  // positive control for the reading of a choice offered again.
  let pendingSeen = false;
  await ready(ctx);

  await c.run('two-workspaces.editor-add-leaves-the-choice-to-the-reader', {
    expected: `with ${mysqlName} open alone and its language server running, ${postgresName} added with the editor's own Add Folder to Workspace — which in this local window restarts the extensions — brings the window back holding both, with the Project folder and Aggrega workspace rows reading "none selected", no language server running for ${NO_SERVER_MS} ms, the status bar offering "${PENDING_CHOICE_ACTION}", and the notification "${pendingChoiceNotice(2)}" with a "${PENDING_CHOICE_ACTION}" button`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with a window reaching two Aggrega workspaces and remembering neither attached to the first',
  }, async () => {
    const running = await theServer(ctx).then(() => true, () => false);
    need(running, 'no language server is running in the window on the one folder, so there is nothing for the add to be read against');
    welcomeBeforeAdd = await welcomeWorkspaceValues(ctx);
    markedBeforeAdd = await markPagesBeforeAdd(ctx);
    const toastMark = (await toasts(ctx.d)).length;
    const change = await addWithTheEditorsCommand(ctx, ledger, postgres);
    const folders = await openFolders(ctx);
    const rows = await waitRows(ctx, 'the rows reading none selected', (r) => r[0]?.value === 'none selected' && r[1]?.value === 'none selected');
    const notice = await waitToast(ctx.d, 'the notice offering the choice', 0, (t) => t.message === pendingChoiceNotice(2), 20000).catch(() => null);
    const item = await until('the status bar offering the choice', 10000, () => statusItem(ctx, (i) => i.text === PENDING_CHOICE_ACTION), (v) => v !== undefined).catch(() => undefined);
    pendingSeen = notice !== null && item !== undefined;
    const noServer = await holds(NO_SERVER_MS, async () => languageServers(ctx).length, (n) => n === 0);
    pagesAfterAdd = await pagesDrawn(ctx);
    const told = (await toastsSince(ctx.d, change.reloaded ? 0 : toastMark)).map((t) => t.message);
    return {
      passed: folders.length === 2 && rows[0]?.value === 'none selected' && rows[1]?.value === 'none selected' && noServer.held && item !== undefined && notice !== null && notice.buttons.includes(PENDING_CHOICE_ACTION),
      seen: `the add ${change.reloaded ? 'reloaded the window' : 'kept the window'} and the extensions ${change.restarted ? 'restarted' : 'did not restart'} (${change.ms} ms); the window holds ${JSON.stringify(folders.map((f) => f.path))}; the rows ${describeRows(rows)}; language servers ${noServer.held ? `none for ${NO_SERVER_MS} ms` : `${noServer.broke} at ${noServer.atMs} ms`}; the status bar ${item ? `offers "${item.text}"` : 'offers no choice'}; the notice ${notice ? `"${notice.message}" with ${JSON.stringify(notice.buttons)}` : 'not drawn'}; notifications ${JSON.stringify(told)}`,
    };
  });

  await c.run('two-workspaces.choosing-from-the-notice-starts-the-server-there', {
    expected: `pressing the notice's "${PENDING_CHOICE_ACTION}" opens the Aggrega workspace chooser; choosing ${mysqlName} there starts a language server working in ${mysql}, the Aggrega workspace row names ${mysqlName}, and the Release row's chooser offers ${MYSQL_RELEASES.join(' and ')}`,
    plant: 'in the scratch copy, out/src/extension.js with the notice\'s button opening nothing',
  }, async () => {
    const pressed = await pressToastButton(ctx.d, pendingChoiceNotice(2), PENDING_CHOICE_ACTION);
    need(pressed, `no notification draws a "${PENDING_CHOICE_ACTION}" button to press`);
    const q = await waitChooser(ctx.d, 'the Aggrega workspace chooser', (x) => x.placeholder === PLACEHOLDER.workspace && x.rows.length > 0, 10000).catch(() => null);
    if (q === null) { return { passed: false, seen: 'pressing the notice\'s button opened no Aggrega workspace chooser' }; }
    await takeChooserRow(ctx.d, mysqlName);
    const srv = await serverIn(ctx, mysql);
    await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
    const rows = await waitRows(ctx, `the Aggrega workspace row naming ${mysqlName}`, (r) => r[1]?.value === mysqlName);
    const offered = await releasesOffered(ctx);
    return {
      passed: srv !== null && rows[1]?.value === mysqlName && JSON.stringify(offered) === JSON.stringify(MYSQL_RELEASES),
      seen: `the chooser listed ${JSON.stringify(q.rows.map((r) => r.label))}; the language server ${srv ? `works in ${srv.cwd}` : `did not start in ${mysql}`}; the rows ${describeRows(rows)}; the Release chooser offers ${JSON.stringify(offered)}`,
    };
  });

  await c.run('two-workspaces.workspace-chooser-in-a-two-folder-window', {
    expected: `in this window on two folders, with no Project folder chosen, the Aggrega workspace row's chooser lists both workspaces — each named by its root's last segment, its full path beside it and "${CONFIG_FILENAME}" beneath — and, last, "${WIDEN_ANOTHER}", whose second line reads "${WIDEN_DETAIL}" and names no cost, since a window already on a workspace takes a folder in place`,
    plant: 'in the scratch copy, out/src/window-kind.js with every window read as one whose add costs a restart',
  }, async () => {
    const q = await workspaceChooser(ctx);
    await closeChooser(ctx.d);
    const want = [[mysqlName, mysql, CONFIG_FILENAME], [postgresName, postgres, CONFIG_FILENAME]];
    const listed = q.rows.slice(0, 2).map((r) => [r.label, r.description, r.detail]).sort((a, b) => a[0].localeCompare(b[0]));
    const last = q.rows[q.rows.length - 1];
    return {
      passed: q.rows.length === 3 && JSON.stringify(listed) === JSON.stringify(want) && last.label === WIDEN_ANOTHER && last.detail === WIDEN_DETAIL,
      seen: `the chooser lists ${JSON.stringify(q.rows.map((r) => [r.label, r.description, r.detail]))}`,
    };
  });

  await c.run('two-workspaces.switching-moves-the-rows-and-the-status-bar', {
    expected: `choosing ${postgresName} on the Aggrega workspace row raises "${nowWorkingIn(postgres)}" and moves the language server to a new process working in ${postgres}, with nothing restarted by hand; then the rows and the status bar name it — the Aggrega workspace row, whose hover reads ${JSON.stringify(workspaceHover(postgres))}, the Release row's chooser offering ${POSTGRES_RELEASES.join(' and ')}, and the status bar's workspace item reading "Aggrega · ${postgresName}" with a hover opening with ${postgres}`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the status bar\'s workspace item naming the first workspace reached whichever is in use',
  }, async () => {
    const before = await theServer(ctx);
    const toastMark = (await toasts(ctx.d)).length;
    await workspaceChooser(ctx);
    await takeChooserRow(ctx.d, postgresName);
    const told = await waitToast(ctx.d, 'the notice naming the move', toastMark, (t) => t.message === nowWorkingIn(postgres), 15000).then(() => true, () => false);
    const srv = await serverIn(ctx, postgres, 30000, before.pid);
    await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
    const rows = await waitRows(ctx, `the Aggrega workspace row naming ${postgresName}`, (r) => r[1]?.value === postgresName);
    const offered = await releasesOffered(ctx);
    const status = await until('the status bar naming the workspace', 15000, () => statusHover(ctx, (i) => i.side === 'right' && i.text.startsWith('Aggrega ·')), (v) => v !== null && v.item.text === `Aggrega · ${postgresName}`).catch(() => statusHover(ctx, (i) => i.side === 'right' && i.text.startsWith('Aggrega')));
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    return {
      passed: told && srv !== null && rows[1]?.value === postgresName && rows[1].title === workspaceHover(postgres) && JSON.stringify(offered) === JSON.stringify(POSTGRES_RELEASES)
        && status !== null && status.item.text === `Aggrega · ${postgresName}` && status.hover.startsWith(postgres),
      seen: `notifications ${JSON.stringify(said)}; the language server ${srv ? `moved to process ${srv.pid} working in ${srv.cwd}` : `did not move to ${postgres}`}; the rows ${describeRows(rows)}, the hover ${JSON.stringify(rows[1]?.title ?? '')}; the Release chooser offers ${JSON.stringify(offered)}; the status bar ${status ? `"${status.item.text}", hover ${JSON.stringify(status.hover)}` : 'draws no workspace item'}`,
    };
  });

  await c.run('two-workspaces.switching-moves-the-welcome-page', {
    expected: `after the switch to ${postgresName}, the window draws exactly one welcome page — one tab titled "${PAGE_TITLE}" over one page document — and its workspace step names ${postgres}, read within ${WELCOME_SETTLE_MS} ms: the page drawn before the add, which the editor keeps in its tab when the extensions restart, is drawn again by the extension that starts after it rather than left open beside a second`,
    plant: 'in the scratch copy, out/src/get-started.js with the welcome page drawn before the extensions restarted left open beside the one drawn in its place',
  }, async () => {
    const one = (p: PagesDrawn): boolean => p.tabs === 1 && p.pages.length === 1 && p.unanswered === 0 && p.pages[0].value.includes(postgres);
    const settled = await until('one welcome page naming the workspace switched to', stated(WELCOME_SETTLE_MS), () => pagesDrawn(ctx), one)
      .then((p) => ({ p, within: true }), async () => ({ p: await pagesDrawn(ctx), within: false }));
    return {
      passed: settled.within && one(settled.p),
      seen: `before the add ${welcomeBeforeAdd.length} welcome page(s) were drawn, reading ${JSON.stringify(welcomeBeforeAdd)}, ${markedBeforeAdd.marked} document(s) marked; once the add came back, ${pagesAfterAdd === null ? 'not read' : describePages(pagesAfterAdd)}; after the switch${settled.within ? '' : `, still after ${WELCOME_SETTLE_MS} ms`}, ${describePages(settled.p)}`,
    };
  });

  await c.run('two-workspaces.workspace-chosen-survives-a-reload', {
    expected: `the window reloaded comes back working in ${postgresName}: the language server working in ${postgres}, the Aggrega workspace row naming it, and no choice offered again — neither "${PENDING_CHOICE_ACTION}" on the status bar nor a notice asking for one — watched for ${NO_OFFER_MS} ms; the same reading read the choice the add left to the reader earlier in this scenario`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the Aggrega workspace chosen not remembered for the window',
  }, async () => {
    need(pendingSeen, 'its positive control did not fire: the choice the add left to the reader was not read, so the reading of a choice offered is not shown to see one');
    const change = await reloadWindow(ctx, ledger);
    await ready(ctx);
    const srv = await serverIn(ctx, postgres);
    const rows = await waitRows(ctx, `the Aggrega workspace row naming ${postgresName}`, (r) => r[1]?.value === postgresName);
    const quiet = await noChoicePending(ctx, 0, NO_OFFER_MS);
    return { passed: change.reloaded && srv !== null && rows[1]?.value === postgresName && quiet.held, seen: `the reload ${change.reloaded ? 'replaced the document' : 'kept the document'}; the language server ${srv !== null ? `works in ${srv.cwd}` : `works in ${serversWorking(ctx)}`}; the rows ${describeRows(rows)}; ${quiet.held ? `no choice offered for ${NO_OFFER_MS} ms` : describePending(quiet.broke)}` };
  });

  await c.run('two-workspaces.project-folder-choice-scopes-the-workspaces-on-offer', {
    expected: `with no Project folder chosen the Aggrega workspace chooser lists both workspaces; choosing ${mysqlName} on the Project folder row raises "${nowWorkingFrom(mysql)}" and "${nowWorkingIn(mysql)}", moves the language server to ${mysql}, and leaves the Aggrega workspace chooser listing only ${mysqlName} and "${WIDEN_ANOTHER}"; choosing ${postgresName} there does the same for ${postgres}`,
    plant: 'in the scratch copy, out/src/extension.js with the Project folder chosen scoping nothing, so every folder the window has open answers for the workspaces on offer',
  }, async () => {
    const both = await workspaceChooser(ctx);
    await closeChooser(ctx.d);
    const rowsBefore = await rowsNow(ctx);
    need(rowsBefore[0]?.value === 'none selected', `the Project folder row reads "${rowsBefore[0]?.value ?? ''}", so there is no unchosen state to start from`);
    const seen: string[] = [`unchosen: ${JSON.stringify(both.rows.map((r) => r.label))}`];
    let passed = both.rows.length === 3;
    for (const [folder, name] of [[mysql, mysqlName], [postgres, postgresName]]) {
      const srvBefore = languageServers(ctx)[0]?.pid;
      const toastMark = (await toasts(ctx.d)).length;
      await rowChooser(ctx, 'project');
      await takeChooserRow(ctx.d, name);
      const from = await waitToast(ctx.d, 'the notice naming the folder', toastMark, (t) => t.message === nowWorkingFrom(folder), 15000).then(() => true, () => false);
      const srv = await serverIn(ctx, folder);
      await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
      const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
      // A move is a new process working in the folder, told with its notice.
      const moved = srv !== null && srv.pid !== srvBefore;
      const q = await workspaceChooser(ctx);
      await closeChooser(ctx.d);
      const labels = q.rows.map((r) => r.label);
      const ok = from && moved && said.includes(nowWorkingIn(folder)) && JSON.stringify(labels) === JSON.stringify([name, WIDEN_ANOTHER]);
      passed = passed && ok;
      seen.push(`${name} chosen: notifications ${JSON.stringify(said)}, the language server ${srv !== null ? `in ${srv.cwd}, ${moved ? `a new process ${srv.pid}` : `the same process ${srv.pid}`}` : `working in ${serversWorking(ctx)}`}, the chooser lists ${JSON.stringify(labels)}`);
    }
    return { passed, seen: seen.join('; ') };
  });

  await c.run('two-workspaces.project-folder-choice-survives-a-reload', {
    expected: `the window reloaded comes back with the Project folder row still naming ${postgresName}`,
    plant: 'in the scratch copy, out/src/project-folder.js with the Project folder chosen not remembered for the window',
  }, async () => {
    const change = await reloadWindow(ctx, ledger);
    await ready(ctx);
    const rows = await waitRows(ctx, `the Project folder row naming ${postgresName}`, (r) => r[0]?.value === postgresName);
    return { passed: change.reloaded && rows[0]?.value === postgresName, seen: `the reload ${change.reloaded ? 'replaced the document' : 'kept the document'}; the rows ${describeRows(rows)}` };
  });

  await c.run('two-workspaces.project-hover-with-two-folders-names-no-sole-candidate', {
    expected: `in this window on two folders, with ${postgresName} chosen, the Project folder row's hover reads ${JSON.stringify(projectHover(postgres, false))} — with no line saying only one Project folder is available`,
    plant: 'in the scratch copy, out/src/selector-rows.js with the sole-candidate line drawn whatever the count',
  }, async () => {
    const rows = await waitRows(ctx, `the Project folder row naming ${postgresName}`, (r) => r[0]?.value === postgresName);
    return { passed: rows[0]?.title === projectHover(postgres, false), seen: `the hover ${JSON.stringify(rows[0]?.title ?? '')}` };
  });
}
