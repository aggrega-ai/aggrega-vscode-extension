// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CONFIG_FILENAME } from '../../src/workspace';
import { Judgement, need } from './checks';
import { AGGREGA_BINARY_SETTING, BASELINE_SETTINGS } from './editor';
import { CHOOSE_FOLDER_PLACEHOLDER, closeChooser, PLACEHOLDER, rowsNow, takeChooserRow } from './levels';
import { capture, ready, run, SuiteContext } from './suite-context';
import { openSettingsOn, settingLabel, settingValue } from './suite-gateway';
import {
  arrangementFolding, arrangementLogged, clearForCapture, describeSteps, drawnValue, folded, frontPage, metSteps, NONE_SELECTED, noPage, observePage, opened, pageFromItsArrival, pageReadings,
  pressCaret, pressHouse, readPage, SELECTED_LEAD, STANDING_MET, STANDING_TO_DO, StepId, stepOf, STEP_IDS, valueStyles, WAYS_THROUGH, wayThroughChooser, WELCOME_SHOW_SETTING, welcomePage,
  welcomePages, WORD_NO_STANDING_READS,
} from './welcome';
import { holds, until } from './workbench';

// The checks run in a folder that is its own Aggrega workspace and holds two
// Releases with no default, in a window no Release has been chosen in and with no
// registry configured, so two of the welcome page's steps are met and two are
// not: the page arriving by itself arranged by what is met, the standings in words
// and the setting that names them, a folded step keeping its ways through and each
// one outlined, what each step stands at and how that is set against the guidance,
// a step satisfied while it is open staying open, a caret the reader pressed
// surviving a refresh, and the page arranging itself afresh when it is opened again.

export const WELCOME_MIXED_CHECKS = [
  'welcome-page.arrives-folded-on-what-is-met',
  'welcome-page.standings-read-met-and-to-do',
  'settings.get-started-show-label-and-description',
  'welcome-page.folded-step-keeps-its-ways-through-drawn-and-outlined',
  'welcome-page.folded-step-control-works',
  'welcome-page.outline-in-three-themes',
  'welcome-page.each-step-names-what-it-stands-at',
  'welcome-page.value-outranks-the-guidance',
  'welcome-page.value-reads-as-more-evident',
  'welcome-page.step-satisfied-while-open-stays-open',
  'welcome-page.caret-pressed-survives-a-refresh',
  'welcome-page.reopened-page-arranges-afresh',
] as const;

const SHOW_SETTING = WELCOME_SHOW_SETTING;
const BINARY_SETTING = AGGREGA_BINARY_SETTING;
const LOCAL = 'release-local.yaml';
const STAGING = 'release-staging.yaml';

// The standings a setting's description names, in the words the step quotes.
const DESCRIBED_STANDINGS = 'marking each one already met, and marking it to do again if it later lapses';

// The themes the outline is captured in: the baseline's, which is a dark one, then a
// light one and a high-contrast one, each by the name this editor build spells it
// with, and the class the page's body carries in it.
export const THEMES: readonly { name: string; bodyClass: string }[] = [
  { name: String(BASELINE_SETTINGS['workbench.colorTheme']), bodyClass: 'vscode-dark' },
  { name: 'Light Modern', bodyClass: 'vscode-light' },
  { name: 'Default High Contrast', bodyClass: 'vscode-high-contrast' },
];

const SETTLE_MS = 3000;

const MET_HERE: readonly StepId[] = ['workspace', 'compiler'];
const UNMET_HERE: readonly StepId[] = ['release', 'registry'];

// writeColourTheme writes the colour theme into the user settings file, as a
// person edits it by hand, replacing the one line naming the theme `from`.
export function writeColourTheme(ctx: SuiteContext, from: string, to: string): void {
  const file = path.join(ctx.s.root.userData, 'User', 'settings.json');
  const text = fs.readFileSync(file, 'utf8');
  const line = `"workbench.colorTheme": ${JSON.stringify(from)}`;
  need(text.split(line).length === 2, `the user settings name the colour theme ${JSON.stringify(from)} ${text.split(line).length - 1} times, not once`);
  fs.writeFileSync(file, text.replace(line, `"workbench.colorTheme": ${JSON.stringify(to)}`));
}

// setTheme writes the colour theme and waits for the page to be drawn in it.
async function setTheme(ctx: SuiteContext, from: string, to: { name: string; bodyClass: string }): Promise<boolean> {
  writeColourTheme(ctx, from, to.name);
  const doc = await welcomePage(ctx);
  return until(`the page drawn in ${to.name}`, 15000, () => doc.evaluate<string>('document.body.className'), (c) => c.split(/\s+/).includes(to.bodyClass)).then(() => true, () => false);
}

const OUTLINE_IN_THREE_THEMES = Judgement.declare('welcome-page.outline-in-three-themes', {
  expected: 'on the folded compiler step, each way through carries an edge that can be seen in a dark theme, a light one and a high-contrast one',
  plant: 'none: whether an edge can be seen is a person\'s judgement of each capture',
  question: `In each of the three captures (${THEMES.map((t) => t.name).join(', ')}), can you see an edge on each of the folded compiler step's two controls, and does each read as something to press rather than as a label?`,
});

const VALUE_MORE_EVIDENT = Judgement.declare('welcome-page.value-reads-as-more-evident', {
  expected: 'the value a step stands at reads as more evident than the wall of explanation around it, and the gap above the ways through looks the same folded and open',
  plant: 'none: how the value reads against the prose is a person\'s judgement',
  question: 'Set the value beside the explanation around it, on the open Release step and on the folded workspace step: does the value read as more evident than the text? Does the gap above the buttons look the same folded and open?',
});

export async function welcomeMixedChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;

  // ---- arriving ----------------------------------------------------------------------------
  const t0 = Date.now();
  await c.run('welcome-page.arrives-folded-on-what-is-met', {
    expected: `in a cold window on a workspace where the workspace and compiler steps are met and the Release and registry steps are not, the page arrives by itself with the met steps folded — the title line, the value and the ways through — and the others open with their explanation; that arrangement is the one at every reading an observer installed in the page's document as it is first found records, from then and over ${SETTLE_MS} ms`,
    plant: 'in the scratch copy, out/src/welcome-render.js with the arrangement inverted, the steps still to do folded',
  }, async () => {
    const arrival = await pageFromItsArrival(ctx, 60000);
    const arrivedMs = Date.now() - t0;
    const first = await readPage(arrival.doc);
    const want = arrangementFolding(MET_HERE);
    const kept = await holds(SETTLE_MS, () => pageReadings(arrival.doc, arrival.key), (log) => log.length > 0 && log.every((x) => arrangementLogged(x) === want));
    const log = await pageReadings(arrival.doc, arrival.key);
    const seenShapes = [...new Set(log.map(arrangementLogged))];
    const metOk = MET_HERE.every((id) => stepOf(first, id).met && folded(first, id) && drawnValue(stepOf(first, id))?.position === 'folded' && stepOf(first, id).actions.every((a) => a.drawn));
    const unmetOk = UNMET_HERE.every((id) => !stepOf(first, id).met && opened(first, id));
    return {
      passed: metOk && unmetOk && kept.held,
      seen: `found ${arrivedMs} ms after the scenario began (bring-up ${ctx.s.bringUpMs} ms), its document ${arrival.documentAgeMs} ms old when the observer went in, ${metSteps(first)}: ${describeSteps(first)}; ${log.length} reading(s) recorded from then, arranged ${JSON.stringify(seenShapes)}${kept.held ? `, over ${SETTLE_MS} ms` : `, one of them other than ${JSON.stringify(want)} ${kept.atMs} ms in`}`,
    };
  });
  await ready(ctx);

  // ---- the standings in words --------------------------------------------------------------
  await c.run('welcome-page.standings-read-met-and-to-do', {
    expected: `at every reading over ${SETTLE_MS} ms, each step's standing is drawn "${STANDING_MET}" on a met step and "${STANDING_TO_DO}" on one still to do, the mark beside it hidden from assistive technology so the words are what a screen reader reads, and "${WORD_NO_STANDING_READS}" is drawn nowhere in the page's words, which each of those readings finds carrying both standings`,
    plant: 'in the scratch copy, out/src/welcome-render.js with a step still to do standing as "Outstanding"',
  }, async () => {
    const doc = await welcomePage(ctx);
    const look = async (): Promise<{ badges: { id: string; met: boolean; badge: string; hidden: boolean }[]; ok: boolean; word: boolean; carried: boolean }> => {
      const page = await readPage(doc);
      const badges = page.steps.map((s) => ({ id: s.id, met: s.met, badge: s.badge, hidden: s.markHidden }));
      // The page's own words — titles, standings, explanations and the foot — and
      // not the values, which are paths and hosts of the reader's and say nothing of
      // a standing.
      const words = [page.heading, ...page.steps.flatMap((s) => [s.title, s.badge, s.guidance]), page.foot.words].join('\n');
      return {
        badges,
        ok: badges.every((b) => b.badge === (b.met ? STANDING_MET : STANDING_TO_DO) && b.hidden) && badges.some((b) => b.met) && badges.some((b) => !b.met),
        word: new RegExp(WORD_NO_STANDING_READS, 'i').test(words),
        carried: words.includes(STANDING_MET) && words.includes(STANDING_TO_DO),
      };
    };
    const first = await look();
    const watched = await holds(SETTLE_MS, look, (v) => v.ok && !v.word && v.carried);
    return { passed: watched.held, seen: `${JSON.stringify(first.badges)}; "${WORD_NO_STANDING_READS}" ${first.word ? 'drawn' : 'drawn nowhere'} in the page's words, which ${first.carried ? 'carry' : 'do not carry'} both standings; ${watched.held ? `the same at each of ${watched.readings} readings over ${SETTLE_MS} ms` : `at ${watched.atMs} ms ${JSON.stringify(watched.broke)}`}` };
  });

  const title = ctx.manifest.contributes.configuration.title;
  const label = settingLabel(title, SHOW_SETTING);
  const declared = ctx.manifest.contributes.configuration.properties[SHOW_SETTING]?.description ?? '';
  await c.run('settings.get-started-show-label-and-description', {
    expected: `searching the settings screen for "getStarted" draws the label "${label}", derived from the key, and the description the manifest declares, which names the two standings ("${DESCRIBED_STANDINGS}") and never "${WORD_NO_STANDING_READS}"`,
    plant: 'in the scratch copy\'s package.json, the description naming a lapsed step outstanding',
  }, async () => {
    const item = await openSettingsOn(ctx, 'getStarted', label);
    await run(ctx, 'workbench.action.closeActiveEditor');
    const word = new RegExp(WORD_NO_STANDING_READS, 'i').test(item.description);
    const named = item.description.includes(DESCRIBED_STANDINGS);
    return {
      passed: item.description === declared && named && !word,
      seen: `label "${item.category}${item.label}"; the description ${item.description === declared ? 'as declared' : `"${item.description}"`}, ${named ? 'naming' : 'not naming'} the two standings in the step's words, "${WORD_NO_STANDING_READS}" ${word ? 'in it' : 'nowhere in it'}`,
    };
  });

  // ---- a folded step ------------------------------------------------------------------------
  await c.run('welcome-page.folded-step-keeps-its-ways-through-drawn-and-outlined', {
    expected: `with the pointer nowhere near the page, each folded step (${MET_HERE.join(', ')}) draws every one of its ways through, each with a visible outline — a solid edge at least one pixel wide in a colour that is not transparent — while its explanation is put away`,
    plant: 'in the scratch copy, media/welcome.css with a folded step\'s ways through put away with its explanation',
  }, async () => {
    await frontPage(ctx);
    await ctx.d.moveTo({ x: 1, y: 1 });
    const page = await readPage(await welcomePage(ctx));
    const read = MET_HERE.map((id) => ({ id, folded: folded(page, id), actions: stepOf(page, id).actions.map((a) => ({ label: a.label, drawn: a.drawn, edge: `${a.borderStyle} ${a.borderWidth}px alpha ${a.borderAlpha}` })) }));
    const ok = MET_HERE.every((id) => folded(page, id) && JSON.stringify(stepOf(page, id).actions.map((a) => a.label)) === JSON.stringify(WAYS_THROUGH[id])
      && stepOf(page, id).actions.every((a) => a.drawn && a.borderStyle === 'solid' && a.borderWidth >= 1 && a.borderAlpha > 0));
    return { passed: ok, seen: JSON.stringify(read) };
  });

  const base = path.basename(ctx.folder);
  await c.run('welcome-page.folded-step-control-works', {
    expected: `pressing "${WAYS_THROUGH.workspace[1]}" on the folded workspace step does what it does open: a chooser under "${CHOOSE_FOLDER_PLACEHOLDER}" offering ${base}, with its marker on its second line`,
    plant: 'in the scratch copy, out/src/get-started.js with the search for folders Aggrega recognises finding none',
  }, async () => {
    need(folded(await readPage(await welcomePage(ctx)), 'workspace'), 'the workspace step is not folded');
    const got = await wayThroughChooser(ctx, 'workspace', WAYS_THROUGH.workspace[1], (x) => x.placeholder !== '').catch(() => null);
    await closeChooser(ctx.d);
    const rows = got === null ? [] : got.chooser.rows.map((r) => `${r.label} / ${r.detail}`);
    return { passed: got !== null && got.chooser.placeholder === CHOOSE_FOLDER_PLACEHOLDER && got.chooser.rows.some((r) => r.label === base && r.detail === CONFIG_FILENAME), seen: got === null ? 'no chooser opened' : `the chooser "${got.chooser.placeholder}" offers ${JSON.stringify(rows)}` };
  });

  await c.forPerson(OUTLINE_IN_THREE_THEMES, async () => {
    const shots: string[] = [];
    const edges: string[] = [];
    let from = THEMES[0].name;
    try {
      for (const theme of THEMES) {
        if (theme.name !== from) {
          const drawn = await setTheme(ctx, from, theme);
          from = theme.name;
          need(drawn, `the page was not drawn in ${theme.name}`);
        }
        await frontPage(ctx);
        const doc = await welcomePage(ctx);
        await doc.evaluate(`(() => { const s = document.querySelector('section.step[data-step="compiler"]'); if (s) { s.scrollIntoView({ block: 'center' }); } return !!s; })()`);
        await ctx.d.moveTo({ x: 1, y: 1 });
        // The value's and the explanation's colours are read beside the edges, since
        // whether the value reads apart from the prose moves with the theme too.
        const colours = await doc.evaluate<string[]>(`[
          ...[...document.querySelectorAll('section.step[data-step="compiler"] button.step-action')].map((b) => { const cs = getComputedStyle(b); return b.innerText.trim() + ': ' + cs.borderTopStyle + ' ' + cs.borderTopWidth + ' ' + cs.borderTopColor + ' on ' + cs.backgroundColor; }),
          'value ' + getComputedStyle(document.querySelector('section.step[data-step="compiler"] .step-value-folded')).color + ', explanation ' + getComputedStyle(document.querySelector('section.step[data-step="compiler"] .step-detail p')).color,
        ]`);
        const left = await clearForCapture(ctx);
        edges.push(`${theme.name}: ${colours.join('; ')}${left}`);
        shots.push(await capture(ctx, `outline-${theme.bodyClass}`));
      }
    } finally {
      if (from !== THEMES[0].name) { await setTheme(ctx, from, THEMES[0]).catch(() => false); }
    }
    return { screenshot: shots.join(', '), drawnText: edges.join(' | ') };
  });

  // ---- what each step stands at --------------------------------------------------------------
  await c.run('welcome-page.each-step-names-what-it-stands-at', {
    expected: `each step draws what it stands at once: under the title on a folded step, and as the explanation's last line above the ways through on an open one; the workspace step "${SELECTED_LEAD}" followed by the full path the Aggrega workspace row's hover opens with, the compiler step "${SELECTED_LEAD}" followed by ${BINARY_SETTING} exactly as the setting holds it, the Release step "${NONE_SELECTED}" with two Releases on offer and none chosen, and the registry step "${NONE_SELECTED}" with none configured`,
    plant: 'in the scratch copy, media/welcome.css with an open step drawing its value at both places',
  }, async () => {
    await frontPage(ctx);
    const page = await readPage(await welcomePage(ctx));
    const rows = await rowsNow(ctx);
    const hover = rows[1]?.title ?? '';
    const root = (hover.split('\n')[0] ?? '').replace(/^Aggrega workspace: /, '');
    const setting = (await settingValue(ctx, BINARY_SETTING)).value;
    const want: Record<StepId, string> = { workspace: `${SELECTED_LEAD}${root}`, compiler: `${SELECTED_LEAD}${String(setting)}`, release: NONE_SELECTED, registry: NONE_SELECTED };
    const placed = STEP_IDS.every((id) => {
      const s = stepOf(page, id);
      const v = drawnValue(s);
      if (v === null || v.text !== want[id]) { return false; }
      return s.open ? v.position === 'open' && s.openValueLast : v.position === 'folded';
    });
    return { passed: root !== '' && root === ctx.folder && placed, seen: `the Aggrega workspace row's hover opens "${hover.split('\n')[0] ?? ''}"; ${describeSteps(page)}` };
  });

  await c.run('welcome-page.value-outranks-the-guidance', {
    expected: `in the baseline theme (${THEMES[0].name}), on every step the value is set larger than the explanation beside it, at a weight of 600 or more and heavier than the explanation, in a different colour from the explanation's; a chosen value is in the fixed-width face with "Selected: " before it set smaller than the value, at ordinary weight and in the explanation's quieter colour; a value not chosen is in italic with nothing before it`,
    plant: 'in the scratch copy, media/welcome.css with the value set at the size and weight of the text around it',
  }, async () => {
    await frontPage(ctx);
    const doc = await welcomePage(ctx);
    const body = await doc.evaluate<string>('document.body.className');
    need(body.split(/\s+/).includes(THEMES[0].bodyClass), `the page is drawn in "${body}", not the baseline theme`);
    const styles = await valueStyles(doc);
    const bad = styles.filter((s) => {
      const v = s.value; const e = s.explanation;
      if (v === null || e === null) { return true; }
      const outranks = v.size > e.size && v.weight >= 600 && v.weight > e.weight && v.colour !== e.colour;
      const chosen = s.lead !== null;
      const lead = chosen ? s.lead !== null && s.lead.size < v.size && s.lead.weight <= 400 && s.lead.colour === e.colour && /monospace/i.test(v.font) && !/monospace/i.test(s.lead.font) : v.italic;
      return !(outranks && lead);
    });
    return { passed: bad.length === 0 && styles.length === STEP_IDS.length, seen: JSON.stringify(styles) };
  });

  await c.forPerson(VALUE_MORE_EVIDENT, async () => {
    await frontPage(ctx);
    const doc = await welcomePage(ctx);
    await doc.evaluate(`(() => { const s = document.querySelector('section.step[data-step="compiler"]'); if (s) { s.scrollIntoView({ block: 'start' }); } return !!s; })()`);
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'value-against-the-guidance'), drawnText: `${describeSteps(await readPage(doc))}${left}` };
  });

  // ---- a step satisfied while it is open --------------------------------------------------------
  let chosen = false;
  await c.run('welcome-page.step-satisfied-while-open-stays-open', {
    expected: `pressing "${WAYS_THROUGH.release[1]}" on the open Release step opens the Release chooser ("${PLACEHOLDER.release}") offering both Releases; taking ${LOCAL} turns the step "${STANDING_MET}" reading "${SELECTED_LEAD}${LOCAL}", the same Release the Release row names, and its explanation stays open at every reading from the choice on and over ${SETTLE_MS} ms after`,
    plant: 'in the scratch copy, out/src/get-started.js with the arrangement decided again from what is met on every refresh',
  }, async () => {
    const doc = await welcomePage(ctx);
    need(opened(await readPage(doc), 'release'), 'the Release step is not open, the state this check starts from');
    const watch = await observePage(doc);
    const got = await wayThroughChooser(ctx, 'release', WAYS_THROUGH.release[1], (x) => x.placeholder === PLACEHOLDER.release && x.rows.length >= 2);
    const offered = got.chooser.rows.map((r) => r.label);
    const at = Date.now();
    await takeChooserRow(ctx.d, LOCAL);
    const met = await until('the Release step reading met', 15000, async () => stepOf(await readPage(doc), 'release'), (s) => s.met).catch(async () => stepOf(await readPage(doc), 'release'));
    const kept = await holds(SETTLE_MS, async () => stepOf(await readPage(doc), 'release').open, (v) => v);
    const log = (await pageReadings(doc, watch)).filter((r) => r.at >= at);
    const everOpen = log.every((r) => r.steps.find((s) => s.id === 'release')?.open === true);
    const row = (await rowsNow(ctx))[2]?.value ?? '';
    chosen = met.met;
    return {
      passed: offered.includes(LOCAL) && offered.includes(STAGING) && met.badge === STANDING_MET && drawnValue(met)?.text === `${SELECTED_LEAD}${LOCAL}` && row === LOCAL && kept.held && everOpen && opened(await readPage(doc), 'release'),
      seen: `the chooser offered ${JSON.stringify(offered)}; the step reads ${met.badge} with ${JSON.stringify(drawnValue(met)?.text ?? null)} and the Release row "${row}"; ${log.length} reading(s) from the choice on, ${everOpen ? 'every one open' : 'not every one open'}; ${kept.held ? `open over ${SETTLE_MS} ms` : `folded ${kept.atMs} ms in`}`,
    };
  });

  await c.run('welcome-page.caret-pressed-survives-a-refresh', {
    expected: `pressing the registry step's caret folds it; choosing ${STAGING} instead then draws the page again — its Release step naming ${STAGING} — and the registry step is still folded, at every reading over ${SETTLE_MS} ms after`,
    plant: 'in the scratch copy, out/src/get-started.js with the caret the reader pressed not recorded, so the page is drawn again in the shape it opened in',
  }, async () => {
    need(chosen, 'no Release was chosen, so the change that draws the page again has nothing to move from');
    const doc = await welcomePage(ctx);
    need(opened(await readPage(doc), 'registry'), 'the registry step is not open, the state this check starts from');
    await pressCaret(ctx, 'registry');
    const shut = await until('the registry step folding', 5000, async () => folded(await readPage(doc), 'registry'), (v) => v).then(() => true, () => false);
    await wayThroughChooser(ctx, 'release', WAYS_THROUGH.release[1], (x) => x.placeholder === PLACEHOLDER.release && x.rows.length >= 2);
    await takeChooserRow(ctx.d, STAGING);
    const redrawn = await until('the page naming the other Release', 15000, async () => drawnValue(stepOf(await readPage(doc), 'release'))?.text ?? '', (t) => t === `${SELECTED_LEAD}${STAGING}`).then(() => true, () => false);
    const kept = await holds(SETTLE_MS, async () => folded(await readPage(doc), 'registry'), (v) => v);
    return {
      passed: shut && redrawn && kept.held,
      seen: `the caret ${shut ? 'folded' : 'did not fold'} the registry step; the page ${redrawn ? `drew the Release step naming ${STAGING}` : `did not come to name ${STAGING}`}; the registry step ${kept.held ? `stayed folded over ${SETTLE_MS} ms` : `opened again ${kept.atMs} ms in`}: ${describeSteps(await readPage(doc))}`,
    };
  });

  await c.run('welcome-page.reopened-page-arranges-afresh', {
    expected: 'with the page\'s tab closed and the page opened again with the house, the new page is arranged afresh from what is met now: the workspace, compiler and Release steps folded, the registry step — folded by the reader before — open',
    plant: 'in the scratch copy, out/src/get-started.js with a page opened again keeping the arrangement the one before it was left in',
  }, async () => {
    need(chosen, 'no Release was chosen, so the arrangement afresh reads the same as the first');
    await frontPage(ctx);
    await run(ctx, 'workbench.action.closeActiveEditor');
    await until('the page closing', 10000, () => welcomePages(ctx), noPage);
    await pressHouse(ctx);
    const page = await readPage(await welcomePage(ctx, 30000));
    const ok = folded(page, 'workspace') && folded(page, 'compiler') && folded(page, 'release') && opened(page, 'registry') && stepOf(page, 'release').met;
    return { passed: ok, seen: describeSteps(page) };
  });
}
