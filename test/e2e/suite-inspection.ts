// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { buildValidateParams } from '../../src/validate-request';
import { need } from './checks';
import { WebviewDocument } from './drivers';
import { referenceAnswer } from './reference';
import {
  catalogPanelAtItsHead, closeAllEditors, commandTitle, deleteLine, diagnostics, Line, open, putBack, run, save, SuiteContext,
} from './suite-context';
import {
  commandsPanel, holds, pressOperation, pressToastButton, pressTreeRowAction, Toast, toastsSince, toasts, until, waitToast,
} from './workbench';

// The checks run on an inspection the compiler refuses because of the document
// that declares the entity: the Feature's version line removed and the file
// saved, so the catalog skips it at load. Both places a reader inspects from —
// the Catalog panel row's own action and the Commands panel's Inspect — end in
// one notification saying so in plain words, followed by the compiler's own
// sentence for the same request, with a button that opens that document; the
// output channel carries the same sentence; and the Problems panel holds, on that
// document, the one entry its validation filed and nothing more.

export const INSPECTION_CHECKS = [
  'inspect.catalog-row-refused-for-its-document-names-it-and-opens-it',
  'inspect.commands-panel-refused-for-its-document-ends-as-the-row-does',
] as const;

const ENTITY = 'local/nightly-backup';
const RELEASE = 'release-compose.yaml';

// The words a reader is to meet are held here as written, so a change of wording
// in the extension is a change these checks report rather than follow: the
// sentence's opening, the button it offers, and the titles of the two waits an
// inspection runs behind, which are progress rather than an ending.
const LEAD = `${ENTITY} cannot be inspected because of the document that declares it: `;
const OPEN_ACTION = 'Open document';
const PROGRESS = [`Aggrega: inspecting ${ENTITY}`, 'Aggrega: reading the workspace entity index'];
const CATALOG_FIRST_ROW = 'Search catalog';

const isEnding = (t: Toast): boolean => !PROGRESS.some((p) => t.message.startsWith(p));

// Ending is how one inspection ended, as the reader met it.
interface Ending { endings: Toast[]; channel: boolean; seen: string }

// readEnding waits for the inspection's ending after `toastMark` and `mark`,
// watches 2 s more for a second one, and reads whether the channel carries `want`.
async function readEnding(ctx: SuiteContext, toastMark: number, mark: { file: string | null; length: number }, want: string): Promise<Ending> {
  await waitToast(ctx.d, 'the inspection ending in a notification', toastMark, isEnding, 30000);
  await holds(2000, async () => (await toastsSince(ctx.d, toastMark)).filter(isEnding), (ts) => ts.length <= 1);
  const endings = (await toastsSince(ctx.d, toastMark)).filter(isEnding);
  const channel = await ctx.out.waitFor('the channel carrying the sentence', mark, (t) => t.split('\n').includes(want), 10000).then(() => true, () => false);
  const shown = endings.map((t) => `${JSON.stringify(t.message.slice(0, 160))}${t.message.length > 160 ? '…' : ''} (${t.severity}, buttons ${JSON.stringify(t.buttons)})`);
  return { endings, channel, seen: `${endings.length} notification(s) ending it: ${shown.join('; ')}; the channel ${channel ? 'carries the same sentence' : 'does not carry the sentence'}` };
}

// endsAsWanted reads whether an ending is the one notification the checks
// expect: the sentence exactly, raised as an error, offering the one button.
function endsAsWanted(e: Ending, want: string): boolean {
  return e.endings.length === 1 && e.endings[0].message === want && e.endings[0].severity === 'error'
    && JSON.stringify(e.endings[0].buttons) === JSON.stringify([OPEN_ACTION]) && e.channel;
}

// shownOptions reads the choices the open Inspect menu draws, as their labels.
function shownOptions(panel: WebviewDocument): Promise<string[]> {
  return panel.evaluate<string[]>(`[...document.querySelectorAll('.op-menu[data-menu-command="aggrega.op.inspect"]:not([hidden]) .op-menu-option')]
    .filter((o) => !o.hidden).map((o) => ((o.querySelector('.op-menu-label') || {}).innerText || '').trim())`);
}

// inspectFromCommandsPanel presses the Commands panel's Inspect and chooses the
// entity from the menu it opens, narrowing the menu by typing as a reader does
// on a long list.
async function inspectFromCommandsPanel(ctx: SuiteContext): Promise<string> {
  await run(ctx, 'workbench.view.extension.aggrega');
  const panel = await commandsPanel(ctx.d);
  await pressOperation(ctx.d, panel, 'aggrega.op.inspect');
  const offered = await until(`the Inspect menu offering ${ENTITY}`, 20000, () => shownOptions(panel), (v) => v.includes(ENTITY));
  await ctx.d.type('nightly-backup');
  const narrowed = await until(`the Inspect menu narrowed to ${ENTITY}`, 5000, () => shownOptions(panel), (v) => v.length === 1 && v[0] === ENTITY);
  await ctx.d.press('Enter');
  return `the menu offered ${offered.length} entities; typing narrowed it to ${JSON.stringify(narrowed)} and Enter chose it`;
}

interface Active { path: string; isUntitled?: boolean; languageId?: string; text?: string; selection?: { start: { line: number; character: number } } }

export async function inspectionChecks(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const feature = path.join(ctx.folder, 'catalog', 'feature', 'local', 'nightly-backup', '1.0.0', 'feature.yaml');
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const rowAction = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.inspect');
  const whole = fs.readFileSync(feature, 'utf8');
  let removed: Line | null = null;
  let want = '';
  let complaint = '';
  let rowEnding = '';

  // problemsNamingIt reads the Problems panel's entries on the Feature, and the
  // entries on any other file that name the entity.
  const problemsNamingIt = async (): Promise<{ onFeature: string[]; elsewhere: string[] }> => {
    const listed = await ctx.probe.request<{ path: string; diagnostics: { message: string; source: string | null; code: string | null }[] }[]>('diagnostics.list');
    const onFeature = listed.filter((e) => e.path === feature).flatMap((e) => e.diagnostics.map((d) => `${d.source ?? 'no source'} ${d.code ?? ''} ${d.message}`));
    const elsewhere = listed.filter((e) => e.path !== feature).flatMap((e) => e.diagnostics.filter((d) => d.message.includes(ENTITY)).map((d) => `${path.basename(e.path)}: ${d.message.split('\n')[0].slice(0, 120)}`));
    return { onFeature, elsewhere };
  };

  await c.run('inspect.catalog-row-refused-for-its-document-names-it-and-opens-it', {
    expected: `with the Feature's version line removed and the file saved, the Catalog panel row "${ENTITY}"'s own "${rowAction}" action ends in one error notification reading "${LEAD}" followed by the compiler's own message for the same request asked outside the editor, offering "${OPEN_ACTION}" and nothing else; the output channel carries the same sentence; pressing "${OPEN_ACTION}" opens the Feature's document with the cursor at its start, the answer naming no line; and the Problems panel then holds one entry on it, the complaint its validation files in the compiler's words`,
    plant: 'in the scratch copy, out/src/inspection-request.js with the branch that reads the declaring document taken out, so the refusal ends as an operation that did not complete',
  }, async () => {
    // The compiler's own answers for the same document, broken the same way, in
    // the reference copy of the folder.
    const referenceFeature = path.join(referenceFolder, path.relative(ctx.folder, feature));
    const referenceWhole = fs.readFileSync(referenceFeature, 'utf8');
    const broken = referenceWhole.split('\n').filter((l) => l.trim() !== 'version: 1.0.0').join('\n');
    need(broken.split('\n').length === referenceWhole.split('\n').length - 1, 'the Feature does not carry its version line exactly once');
    fs.writeFileSync(referenceFeature, broken);
    const inspected = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/entityDefinition', params: { name: ENTITY }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    const validated = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceFeature, broken, RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    fs.writeFileSync(referenceFeature, referenceWhole);
    need(!inspected.ok && inspected.error.code === 1004 && typeof (inspected.error.data as { file?: unknown } | null)?.file === 'string',
      `the compiler's own answer is not a refusal naming the declaring document: ${JSON.stringify(inspected).slice(0, 300)}`);
    want = `${LEAD}${inspected.ok ? '' : inspected.error.message}`;
    const ref = validated.ok ? ((validated.result as { diagnostics?: { message: string }[] }).diagnostics ?? []) : [];
    need(ref.length === 1, `the compiler's own validation of the broken Feature answers ${ref.length} findings, not one`);
    complaint = ref[0].message;

    // The same break, made as an author makes it and saved.
    removed = await deleteLine(ctx, feature, 'version: 1.0.0');
    await save(ctx, feature);
    await until('the complaint being filed on the saved Feature', 20000, () => diagnostics(ctx, feature), (v) => v.some((d) => d.source === 'aggrega'));
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressTreeRowAction(ctx.d, 'Catalog', ENTITY, rowAction);
    const e = await readEnding(ctx, toastMark, mark, want);
    rowEnding = e.endings[0]?.message ?? '';
    const pressed = e.endings.length > 0 && await pressToastButton(ctx.d, e.endings[0].message.slice(0, 40), OPEN_ACTION);
    const active = await until('the declaring document opening', 10000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && v.path === feature)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const at = active?.selection?.start;
    const opened = active?.path === feature && at?.line === 0 && at?.character === 0;
    const problems = await until('the Problems panel holding the complaint on the reopened Feature', 15000, problemsNamingIt, (v) => v.onFeature.length > 0).catch(problemsNamingIt);
    const one = problems.onFeature.length === 1 && problems.onFeature[0] === `aggrega E0215 ${complaint}`;
    return {
      passed: endsAsWanted(e, want) && pressed && opened && one,
      seen: `${e.seen}; "${OPEN_ACTION}" ${pressed ? 'pressed' : 'not drawn to press'}, and the active editor is ${active?.path ?? 'none'}${at ? ` at line ${at.line + 1}, column ${at.character + 1}` : ''}; the Problems panel on the Feature: ${JSON.stringify(problems.onFeature)}; elsewhere naming it: ${JSON.stringify(problems.elsewhere)}; the compiler's sentence: ${JSON.stringify(want.slice(LEAD.length, LEAD.length + 200))}`,
      evidence: { want, endings: e.endings, active, problems },
    };
  });

  await c.run('inspect.commands-panel-refused-for-its-document-ends-as-the-row-does', {
    expected: `with the Feature still broken and open behind the Aggregate, the Commands panel's Inspect, choosing "${ENTITY}" from its menu, ends in the same one notification the row's action ended in — "${LEAD}" followed by the compiler's message, an error offering "${OPEN_ACTION}" alone — with the same sentence in the channel; "${OPEN_ACTION}" brings the Feature's document in front; the Problems panel still holds its one entry; and once the version line is put back and saved, the same Inspect opens the entity's definition as a new document with no notification ending it`,
    plant: 'in the scratch copy, out/src/operations.js with the Commands panel composing an inspection of its own that ends as an operation that did not complete; or out/src/inspection-request.js with the branch that reads the declaring document taken out',
  }, async () => {
    need(removed !== null && want !== '', 'the Feature was not broken above, so there is no refusal to meet');
    await open(ctx, aggregate);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const chose = await inspectFromCommandsPanel(ctx);
    const e = await readEnding(ctx, toastMark, mark, want);
    const same = e.endings.length === 1 && e.endings[0].message === rowEnding;
    const pressed = e.endings.length > 0 && await pressToastButton(ctx.d, e.endings[0].message.slice(0, 40), OPEN_ACTION);
    const active = await until('the declaring document coming in front', 10000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && v.path === feature)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const problems = await problemsNamingIt();
    const one = problems.onFeature.length === 1 && problems.onFeature[0] === `aggrega E0215 ${complaint}`;

    // The Feature put back, and the same press then answering.
    await putBack(ctx, feature, removed as Line);
    await save(ctx, feature);
    removed = null;
    const cleared = await until('the complaint clearing once the line is back', 20000, () => diagnostics(ctx, feature), (v) => !v.some((d) => d.source === 'aggrega')).then(() => true, () => false);
    const afterMark = (await toasts(ctx.d)).length;
    await inspectFromCommandsPanel(ctx);
    const definition = await until('the definition opening as a new document', 20000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && v.isUntitled === true)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const answered = definition?.isUntitled === true && (definition.text ?? '').includes(`"name": "${ENTITY}"`);
    const quiet = (await toastsSince(ctx.d, afterMark)).filter(isEnding).map((t) => t.message.slice(0, 120));
    if (definition?.isUntitled) { await run(ctx, 'workbench.action.revertAndCloseActiveEditor').catch(() => undefined); }
    return {
      passed: endsAsWanted(e, want) && same && pressed && active?.path === feature && one && cleared && answered && quiet.length === 0,
      seen: `${chose}; ${e.seen}; ${same ? 'the same words the row\'s action ended in' : `the row's action ended in ${JSON.stringify(rowEnding.slice(0, 160))}`}; "${OPEN_ACTION}" ${pressed ? 'pressed' : 'not drawn to press'}, the active editor ${active?.path ?? 'none'}; the Problems panel on the Feature: ${JSON.stringify(problems.onFeature)}; with the line put back the complaint ${cleared ? 'cleared' : 'stayed'}, and Inspect ${answered ? `opened a new ${definition?.languageId ?? ''} document naming ${ENTITY}` : `left ${definition?.path ?? 'nothing'} in front`}${quiet.length > 0 ? `, ending in ${JSON.stringify(quiet)}` : ' with no notification ending it'}`,
      evidence: { endings: e.endings, active, problems, definition: definition?.text?.slice(0, 400) },
    };
  });

  // Whatever the checks above reached, the Feature is left as it was found, and
  // the Catalog panel scrolled back to its head, where the checks after these
  // read it.
  if (removed !== null || fs.readFileSync(feature, 'utf8') !== whole) {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.action.files.revert').catch(() => undefined);
    fs.writeFileSync(feature, whole);
  }
  await closeAllEditors(ctx);
  await catalogPanelAtItsHead(ctx, CATALOG_FIRST_ROW).catch(() => false);
}
