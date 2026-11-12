// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { need } from './checks';
import { boundaryTitle, contains, NONE_DECLARED, rect, shownDrawing, subsystemTitle } from './graph-drawing';
import { findGraphPanel, pressNode, readPanel, settledPanel, showGraph } from './graph-panel';
import { referenceAnswer } from './reference';
import { ready, SuiteContext } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { closeGraphPanel } from './suite-graph-drawing';
import { MAY_ATTACH_TITLE, PENDING, RELEASE } from './suite-graph-panel';

// The checks run in a folder that reads no catalog but its own, whose one
// Feature applies to no component the folder deploys, and whose Aggregate and
// Release declare no grouping: how the drawing titles the two boxes holding
// nodes nobody grouped, and what the list of what may attach reads when no
// Feature's declared applicability matches.

export const PROBES_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'graph.undeclared-groupings-titled-by-kind-in-words',
  'may-attach.nothing-matching-reads-as-an-empty-state',
] as const;

const NODES = ['probe-a', 'probe-b'];

// The sentence a list naming nothing reads, held here as written, and the words
// of the three sentences that answer a different question than the one the
// panel asks and so are never to be drawn here.
const NOTHING_MATCHES = 'No Feature\'s declared applicability matches the labels on this node.';
const OTHER_EMPTY_WORDS = ['finalised labels', 'that document declares', 'the labels this answer was computed over'];
const OVERCLAIM = /nothing can attach|cannot attach|no feature can/i;

export async function probesChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  await contextRowsCheck(ctx);
  await c.run('graph.undeclared-groupings-titled-by-kind-in-words', {
    expected: `with no boundary and no subsystem declared, the drawing draws one boundary box titled "${boundaryTitle(NONE_DECLARED)}" holding one subsystem box titled "${subsystemTitle(NONE_DECLARED)}", which holds every node's card — the two titles told apart by the kind in a word, never by the glyph alone`,
    plant: 'in the scratch copy, media/graph-model.js made to read past the compiler\'s mark on a grouping it synthesized, titling the grouping with the name the compiler gave it',
  }, async () => {
    const d = await shownDrawing(await showGraph(ctx));
    const boundaries = d.containers.filter((k) => k.kind === 'boundary');
    const subsystems = d.containers.filter((k) => k.kind === 'subsystem');
    const outer = boundaries[0];
    const inner = subsystems[0];
    const nested = boundaries.length === 1 && subsystems.length === 1 && contains(outer.box, inner.box);
    const held = inner !== undefined && d.nodes.length > 0 && d.nodes.every((n) => contains(inner.box, n.card));
    const titled = outer?.title === boundaryTitle(NONE_DECLARED) && inner?.title === subsystemTitle(NONE_DECLARED);
    const worded = outer !== undefined && inner !== undefined && outer.title.replace(/^\S+\s/, '') !== inner.title.replace(/^\S+\s/, '');
    return {
      passed: nested && held && titled && worded,
      seen: `boundaries ${JSON.stringify(boundaries.map((k) => `${k.title} ${rect(k.box)}`))}; subsystems ${JSON.stringify(subsystems.map((k) => `${k.title} ${rect(k.box)}`))}; ${nested ? 'one inside the other' : 'not one subsystem inside one boundary'}; ${held ? `holding all ${d.nodes.length} cards` : 'not holding every card'}; the titles ${worded ? 'differ beyond the glyph' : 'differ by the glyph alone'}`,
    };
  });
  // The check after this one opens the panel with its own press, so the panel
  // this check opened is closed first.
  if ((await findGraphPanel(ctx)) !== null) { await closeGraphPanel(ctx); }
  await c.run('may-attach.nothing-matching-reads-as-an-empty-state', {
    expected: `pressing each of ${NODES.join(' and ')}, for which the language server's own answer over a reference copy names no Feature, draws under "${MAY_ATTACH_TITLE}" exactly "${NOTHING_MATCHES}" once the answer arrives — not a blank, not the waiting sentence left standing, no words claiming that nothing can attach, and none of the sentences mentioning ${OTHER_EMPTY_WORDS.map((w) => `"${w}"`).join(', ')}`,
    plant: 'in the scratch copy, media/candidates-model.js made to word an empty answer computed over a node of the drawn graph as matching "this node\'s finalised labels"',
  }, async () => {
    const doc = await showGraph(ctx);
    const seen: string[] = [];
    let passed = true;
    for (const node of NODES) {
      const a = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: reference, method: 'aggrega/attachCandidates', params: { graphNode: node, release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(a.ok, `the language server gave no answer about what may attach to ${node}: ${a.ok ? '' : a.error.message}`);
      const answer = a.result as { labelSource?: string; candidates?: unknown[] };
      need((answer.candidates ?? []).length === 0, `the language server names ${JSON.stringify(answer.candidates)} as able to attach to ${node}, so the empty state is not what a press meets`);
      await pressNode(ctx, doc, node);
      const p = await settledPanel(doc, node, PENDING, 30000).catch(() => readPanel(doc));
      const note = p?.candidates?.note ?? null;
      const others = OTHER_EMPTY_WORDS.filter((w) => (p?.candidates?.body ?? '').includes(w));
      const ok = p !== null && p.candidates?.title === MAY_ATTACH_TITLE && note === NOTHING_MATCHES && (p.candidates?.rows.length ?? 0) === 0 && others.length === 0 && !OVERCLAIM.test(p.candidates?.body ?? '');
      passed = passed && ok;
      seen.push(`${node}: the list reads ${JSON.stringify(p?.candidates?.body ?? null)}${others.length > 0 ? `, a sentence mentioning ${JSON.stringify(others)}` : ''}; the language server answers ${JSON.stringify(answer)}`);
    }
    return { passed, seen: seen.join('; ') };
  });
}
