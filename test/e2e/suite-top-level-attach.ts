// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { changeSince, Tree } from './fixtures';
import { findGraphPanel, graphState, pressAttach, pressNode, readPanel, revealGraphTab, settledPanel, showGraph } from './graph-panel';
import { referenceAnswer } from './reference';
import { open, ready, run, SuiteContext } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { attachedName, checkEntry, closeEverythingUnsaved, PENDING, RELEASE } from './suite-graph-panel';
import { holds, until } from './workbench';

// The checks run in the gateway folder, whose Aggregate declares its components
// at the top level: attaching a Feature to one of them, left unsaved, and the
// folder left byte for byte as the scenario found it.

export const TOP_LEVEL_ATTACH_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'attach.top-level-component-lands-under-its-components-block',
  'attach.nothing-is-saved-and-the-folder-is-as-it-started',
] as const;

const NODE = 'web';

export async function topLevelAttachChecks(ctx: SuiteContext, reference: string, snapshot: Tree): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const original = fs.readFileSync(aggregate, 'utf8');
  await ready(ctx);
  await contextRowsCheck(ctx);
  await c.run('attach.top-level-component-lands-under-its-components-block', {
    expected: `pressing Attach on the first row of ${NODE}'s list, ${NODE} being declared under spec.components with no features key, opens the Aggregate in front with the entry under the container path the language server's own answer names for ${NODE} over a reference copy, a features key written for it and every other line kept; the document is changed and not saved; the panel says "Attached <Feature> to ${NODE} as <name>." and the channel "attached <Feature> to ${NODE} as <name> in <file>"`,
    plant: 'in the scratch copy, out/src/attachment-edit.js made to write no container key the document lacks',
  }, async () => {
    const answer = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/attachmentContainer', params: { graphNode: NODE, release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(answer.ok, `the language server reported no container for ${NODE} over the reference copy: ${answer.ok ? '' : answer.error.message}`);
    const at = answer.result as { file: string; container: string[] };
    need(path.join(ctx.folder, at.file) === aggregate, `the language server places ${NODE}'s attachments in ${at.file}, not the Aggregate`);
    const doc = (await findGraphPanel(ctx)) ?? await showGraph(ctx);
    await pressNode(ctx, doc, NODE);
    const p = await settledPanel(doc, NODE, PENDING);
    const feature = p.candidates?.rows[0]?.name ?? '';
    need(feature !== '', `the list for ${NODE} draws no row`);
    const renders = (await graphState(doc)).renders;
    const mark = ctx.out.mark();
    await pressAttach(ctx, doc, feature);
    const opened = await until('the edited Aggregate in front', 20000, () => ctx.probe.request<{ path: string; isDirty: boolean; text: string } | null>('editor.active'), (d) => d !== null && d.path === aggregate && d.isDirty && d.text !== original)
      .catch(() => ctx.probe.request<{ path: string; isDirty: boolean; text: string } | null>('editor.active'));
    const channel = await ctx.out.waitFor('the attach recorded on the channel', mark, (t) => /^(attached|attaching) /m.test(t), 20000).catch(() => ctx.out.since(mark));
    const line = channel.split('\n').find((l) => /^(attached|attaching) /.test(l)) ?? '';
    await revealGraphTab(ctx);
    const drawn = await until('the panel\'s line about the attach', 10000, () => readPanel(doc), (x) => x !== null && x.outcome !== null).catch(() => readPanel(doc));
    const still = await holds(2000, () => graphState(doc), (s) => s.renders === renders);
    const name = attachedName(drawn?.outcome?.text ?? '', feature, NODE) ?? '';
    const e = checkEntry(original, opened?.path === aggregate ? opened.text : fs.readFileSync(aggregate, 'utf8'), at.container, name, feature);
    const passed = name !== '' && e.ok && opened?.path === aggregate && opened.isDirty && fs.readFileSync(aggregate, 'utf8') === original
      && line === `attached ${feature} to ${NODE} as ${name} in ${at.file}` && still.held;
    // Put back, as a person closes the file without saving it.
    await open(ctx, aggregate);
    await run(ctx, 'workbench.action.files.revert');
    return { passed, seen: `the panel: ${JSON.stringify(drawn?.outcome ?? null)}; the channel: "${line}"; the document in front ${opened?.path ?? 'none'}${opened?.isDirty ? ', changed' : ''}; on disk ${fs.readFileSync(aggregate, 'utf8') === original ? 'unchanged' : 'CHANGED'}; ${e.seen}; the graph ${still.held ? 'was not drawn again' : 'was drawn again'}` };
  });
  await c.run('attach.nothing-is-saved-and-the-folder-is-as-it-started', {
    expected: 'with every editor closed without saving, every file of the folder copy reads byte for byte as it did when the scenario started, and no file is missing or added',
    plant: 'in the scratch copy, out/src/graph-view.js made to save the document after the edit',
  }, async () => {
    const answered = await closeEverythingUnsaved(ctx);
    const change = changeSince(snapshot, ctx.folder);
    const passed = change.changed.length === 0 && change.missing.length === 0 && change.added.length === 0;
    return { passed, seen: `${snapshot.size} file(s) at the start; changed ${JSON.stringify(change.changed)}, missing ${JSON.stringify(change.missing)}, added ${JSON.stringify(change.added)}${answered.length > 0 ? `; closing asked about ${JSON.stringify(answered)} and was answered Don't Save` : ''}` };
  });
}
