// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { catalogPanelAtItsHead, closeAllEditors, deleteLine, diagnostics, lineOf, open, run, SuiteContext } from './suite-context';
import { commandsPanel, guard, holds, pressOperation, stated, toasts, toastsSince, treeRows, until, waitToast } from './workbench';

// The check run on a hover the language server can only answer once the document
// is validated again: the document's file changed on disk from outside the editor
// after the language server last read it, which has the on-disk watcher tell the
// server to drop what it held for that file. The editor then validates the
// document and sends the hover again, asking the reader nothing.
//
// The document is held with an unsaved edit while its file changes, so the editor
// keeps its own copy rather than reading the file again and sends no validation
// of its own between the drop and the hover: the hover meets the dropped parse
// rather than a race with a reload. The unsaved edit files a complaint, which is
// how the runner reads that the edit's own validation was answered before the
// file changed. The answer then names the entity the editor holds rather than
// the one on disk, which only a validation of the editor's copy made after the
// drop can give it.

export const CACHE_MISS_CHECKS = [
  'language-features.hover-after-a-change-on-disk-answers-without-asking',
] as const;

const CATALOG_FIRST_ROW = 'Search catalog';
const FILE = 'hover-component.yaml';
const HELD_NAME = 'scratch/hovered';
const DISK_NAME = 'scratch/renamed-on-disk';
const QUIET_MS = 5000;

// What the channel says where a language request met no parse and the recovery
// did not answer, held as written for the same reason the suite holds the words
// a reader meets.
const NOT_ANSWERED = ['cache-miss retry failed:', 'aggrega/hover failed:'];

export async function cacheMissChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const file = path.join(ctx.folder, FILE);
  const source = fs.readFileSync(path.join(ctx.inputs.extension.dir, 'test', 'e2e', 'fixtures', 'gateway', 'scratch-component.yaml'), 'utf8');
  const held = source.replace('name: scratch/unused', `name: ${HELD_NAME}`);
  const onDisk = held.replace(`name: ${HELD_NAME}`, `name: ${DISK_NAME}`);
  await c.run('language-features.hover-after-a-change-on-disk-answers-without-asking', {
    expected: `a Component "${HELD_NAME}" written to the folder's root and opened, hovered on its name, answers naming it; given an unsaved edit that files a complaint, and then its file rewritten from outside the editor to name "${DISK_NAME}" — which the Catalog panel follows once the language server has dropped the file — the same hover answers naming "${HELD_NAME}", the name the editor holds, with no notification drawn from the rewrite until ${QUIET_MS} ms after the answer and nothing in the channel saying the request went unanswered; right after that window, Validate pressed on the Commands panel draws its notification and the same reading records it, so the reading is one that sees a notification when one is raised`,
    plant: 'in the scratch copy, out/src/extension.js with the notification asking "Revalidate?" put back ahead of the validation, answered as a notification nobody presses is',
  }, async () => {
    need(held !== source && onDisk !== held, 'the scratch Component no longer carries the name this check renames');
    need(!fs.existsSync(file), `${FILE} is already in the folder`);
    await closeAllEditors(ctx);
    fs.writeFileSync(file, held);
    await until(`the "${HELD_NAME}" row appearing`, 15000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.label === HELD_NAME));
    const name = await lineOf(ctx, file, `name: ${HELD_NAME}`);
    const at = { line: name.index, character: name.text.indexOf('name: ') + 'name: '.length + 3 };
    const hover = async (): Promise<string | null> => {
      const answer = await run<{ contents?: ({ value?: string } | string)[] }[] | null>(ctx, 'vscode.executeHoverProvider', [{ $file: file }, { $position: at }], 25000).then((r) => r, () => null);
      if (answer === null) { return null; }
      return answer.flatMap((h) => (h.contents ?? []).map((x) => (typeof x === 'string' ? x : x.value ?? ''))).join('\n');
    };
    // The reading's control: the hover answering on the document as opened.
    let last: string | null = null;
    const first = await until('the hover answering on the document as opened', 15000, async () => { last = await hover(); return last; }, (t) => t !== null && t.includes(HELD_NAME)).catch(() => null);
    need(first !== null, `the hover gave no answer naming the Component on the document as opened (at line ${at.line + 1}, column ${at.character + 1}; its last answer ${JSON.stringify(last)}), so there is no answer for a dropped parse to be measured against`);

    // The unsaved edit, and its own validation answered.
    await deleteLine(ctx, file, 'version: 1.0.0');
    await until('the unsaved edit\'s complaint being filed', 20000, () => diagnostics(ctx, file), (v) => v.some((d) => d.source === 'aggrega'));

    // The change on disk, and the language server's drop of the file answered.
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    fs.writeFileSync(file, onDisk);
    const dropped = await until('the Catalog panel reading the file as it is on disk', 15000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.label === DISK_NAME)).then(() => true, () => false);
    need(dropped, `the Catalog panel did not come to read "${DISK_NAME}" within ${guard(15000)} ms, so the language server's drop of the file is not shown to have happened before the hover`);
    const t0 = Date.now();
    const answer = await hover();
    const answeredMs = Date.now() - t0;
    const quiet = await holds(QUIET_MS, async () => toastsSince(ctx.d, toastMark), (ts) => ts.length === 0);
    const drawn = (await toastsSince(ctx.d, toastMark)).map((t) => t.message.slice(0, 120));
    const channel = ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '');
    const unanswered = channel.filter((l) => NOT_ANSWERED.some((w) => l.startsWith(w)));

    // The positive control for that absence, right after its window: a
    // validation pressed on the Commands panel raises its notification, and the
    // same reading records it.
    await open(ctx, file);
    await run(ctx, 'workbench.view.extension.aggrega');
    const controlMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    const control = await waitToast(ctx.d, 'the validation\'s notification', controlMark, (t) => t.message.startsWith(`Aggrega: validated ${FILE}`), 30000).then((t) => t.message, () => '');

    const named = answer !== null && answer.includes(HELD_NAME) && !answer.includes(DISK_NAME);
    return {
      passed: named && quiet.held && unanswered.length === 0 && control !== '',
      seen: `opened, the hover read ${JSON.stringify((first ?? '').split('\n')[0])}; after the rewrite the Catalog panel read "${DISK_NAME}", and the hover ${answer === null ? 'gave no answer within 25000 ms' : `answered in ${answeredMs} ms: ${JSON.stringify(answer.split('\n')[0])}`}; notifications from the rewrite until ${QUIET_MS} ms after: ${quiet.held ? 'none' : JSON.stringify(drawn)}; the channel in that time: ${JSON.stringify(channel.slice(0, 4))}; the control drew ${control === '' ? 'nothing' : JSON.stringify(control)}`,
    };
  });

  // The folder is left as it was found: the unsaved edit dropped, the file gone,
  // and its row out of the Catalog panel.
  if (fs.existsSync(file)) {
    await open(ctx, file).catch(() => undefined);
    await run(ctx, 'workbench.action.revertAndCloseActiveEditor').catch(() => undefined);
    fs.unlinkSync(file);
  }
  await closeAllEditors(ctx);
  // Nothing reads whether the row left, so it is given a stated 15 s rather than
  // a guard, which a run where it stays would wait out.
  await until('the Component\'s row leaving the Catalog panel', stated(15000), () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === HELD_NAME || r.label === DISK_NAME)).catch(() => undefined);
  await catalogPanelAtItsHead(ctx, CATALOG_FIRST_ROW).catch(() => false);
}
