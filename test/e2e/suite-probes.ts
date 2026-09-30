// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { need } from './checks';
import { pressNode, readPanel, settledPanel, showGraph } from './graph-panel';
import { referenceAnswer } from './reference';
import { ready, SuiteContext } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { MAY_ATTACH_TITLE, PENDING, RELEASE } from './suite-graph-panel';

// The checks run in a folder that reads no catalog but its own, whose one
// Feature applies to no component the folder deploys: what the list of what may
// attach reads when no Feature's declared applicability matches.

export const PROBES_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
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
