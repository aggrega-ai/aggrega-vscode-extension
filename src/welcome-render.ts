// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  STEP_CONTENT,
  STEP_IDS,
  StepDetail,
  StepId,
  WELCOME_DESCRIPTION,
  WELCOME_GREETING,
  WELCOME_PANEL_TITLE,
} from './get-started-steps';
import { escapeHtml } from './html';

// This module composes the welcome panel's document and holds no editor types,
// so what a reader is shown is assertable without an extension host — the
// greeting and the description arriving verbatim, a step's mark following its
// condition in both directions, and every control naming the command it runs.
//
// THE PANEL'S BODY IS COMPOSED HERE AND NOWHERE ELSE, including on refresh. The
// alternative — posting the standings and letting the panel's script build the
// same markup a second time — would put one layout in two languages, and the
// copy is what drifts. The script this composes for is a dozen lines that swap
// in a fragment and forward a press.

// inlineHtml applies the three inline markers the step content is written in —
// a code span, bold, and italic — and no others.
//
// It is deliberately not a markup parser. The panel needs exactly these three,
// a parser would be a second implementation of something the editor already has
// for documents, and the escaping above has already run, so the substitutions
// below can only ever wrap text that is already inert.
export function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// detailHtml renders one block of a step's explanation.
function detailHtml(block: StepDetail): string {
  if ('bullets' in block) {
    const items = block.bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join('');
    return `<ul class="step-bullets">${items}</ul>`;
  }
  return `<p>${inlineHtml(block.paragraph)}</p>`;
}

// MET_LABEL and UNMET_LABEL are what a step's standing reads as in words.
//
// The mark is drawn as a glyph and repeated here as text rather than left to
// the glyph alone: a reader using a screen reader is told the standing, and a
// tick with no words beside it is the kind of mark whose meaning has to be
// guessed at.
export const MET_LABEL = 'Met';
export const UNMET_LABEL = 'Outstanding';

// initiallyCollapsedStepIds decides which sections a panel opens closed: the
// ones whose condition is already satisfied.
//
// The panel's job is to show what is still needed. A satisfied step is context,
// so it earns its title and its two ways forward and nothing more; an
// outstanding one needs its explanation in front of the reader.
//
// 🔴 IT IS READ ONCE, WHEN THE PANEL IS CREATED, AND IT IS NOT A LIVE BINDING.
// Its answer is held beside the panel and handed to the composition as its OWN
// argument, separate from the standings — and that separation is the whole
// mechanism, not a matter of taste. A step becoming satisfied while the reader
// is reading it must not fold up under their cursor, and the panel is
// re-composed on events the reader never initiated. So the standing is
// recomputed on every composition and the arrangement is not recomputed at all.
//
// Closed rather than open is what the result names, matching the other panel
// this extension draws: an empty answer is a panel with every section open,
// which is the shape a reader who has satisfied nothing meets.
export function initiallyCollapsedStepIds(standings: Record<StepId, boolean>): StepId[] {
  return STEP_IDS.filter((id) => standings[id]);
}

// toggleLabel names one section's caret for a reader who reaches it without
// seeing it.
//
// It names the REGION the caret governs and says nothing about the direction:
// whether the region is open is carried by the control's own expansion state,
// which is where a screen reader reads it from, and a name that also said
// "expand" would be a second copy of that state — wrong half the time.
export function toggleLabel(title: string): string {
  return `Explanation: ${title}`;
}

// stepsHtml composes the four steps against the standings given, arranged as
// the collapsed set given.
//
// THE TWO ARGUMENTS ARE SEPARATE AND NEITHER IS DERIVED FROM THE OTHER. The
// standings are recomputed and passed afresh on every refresh, so a step whose
// condition has lapsed is drawn as outstanding again and nothing here remembers
// a previous standing — that is what makes the mark reversible rather than a
// one-way tick. The arrangement arrives from the caller, which read it once when
// the panel was created and has changed it only where the reader pressed a
// caret. Deriving the arrangement from `met` here instead would look like the
// same thing and would break both halves: every refresh would fold a
// newly-satisfied step away under the reader, and every refresh would also
// discard whatever the reader had toggled, because the composed list replaces
// the previous one whole.
export function stepsHtml(
  standings: Record<StepId, boolean>,
  collapsed: readonly StepId[],
): string {
  return STEP_CONTENT.map((step) => {
    const met = standings[step.id];
    const open = !collapsed.includes(step.id);
    const proseId = `step-prose-${escapeHtml(step.id)}`;
    const controls = step.actions
      .map(
        (action) =>
          `<button class="step-action" type="button" data-command="${escapeHtml(action.command)}">${escapeHtml(action.label)}</button>`,
      )
      .join('');
    // The prose is one region rather than two siblings so that one control
    // governs it and one identifier addresses it. THE ACTIONS SIT OUTSIDE IT,
    // and that is the shape rather than an accident: a closed section keeps both
    // ways forward and hides only the explanation, because a reader who has
    // understood a step still wants to act on it without reading it again.
    return `<section class="step ${met ? 'step-met' : 'step-unmet'}" data-step="${escapeHtml(step.id)}">
  <h2 class="step-head">
    <span class="step-mark" aria-hidden="true">${met ? '&check;' : '&#9675;'}</span>
    <span class="step-title">${escapeHtml(step.title)}</span>
    <span class="step-standing">${met ? MET_LABEL : UNMET_LABEL}</span>
    <button class="step-toggle" type="button" aria-expanded="${open}" aria-controls="${proseId}" aria-label="${escapeHtml(toggleLabel(step.title))}" data-toggle="${escapeHtml(step.id)}"></button>
  </h2>
  <div class="step-prose" id="${proseId}"${open ? '' : ' hidden'}>
    <p class="step-summary">${inlineHtml(step.summary)}</p>
    <div class="step-detail">${step.detail.map(detailHtml).join('')}</div>
  </div>
  <div class="step-actions">${controls}</div>
</section>`;
  }).join('\n');
}

// WelcomeDocumentOptions carries the addresses the editor resolves for a panel's
// own resources. They are plain strings so this module keeps no editor types,
// and the caller passes what the webview gave it.
export interface WelcomeDocumentOptions {
  nonce: string;
  styleUri: string;
  scriptUri: string;
  cspSource: string;
  standings: Record<StepId, boolean>;
  // collapsed names the sections the panel opens closed, which for a panel
  // being created is what the standings read at that moment decide. It is
  // carried separately from the standings above for the reason stepsHtml
  // states, and the two must not be collapsed into one value.
  collapsed: readonly StepId[];
}

// welcomeDocumentHtml composes the whole panel.
//
// The greeting and the description are escaped and otherwise untouched — no
// inline markers are applied to them and nothing is wrapped or trimmed — so the
// product's own account of itself reaches the panel exactly as it is written.
//
// 🔴 NOTHING HERE LINKS TO THE EDITOR'S OWN WELCOME PAGE. No route back, no
// breadcrumb, no header pointing at it. A reader who opened Aggrega's panel is
// not partway through someone else's flow, and offering a way "back" to a page
// they never came from would say they are.
export function welcomeDocumentHtml(opts: WelcomeDocumentOptions): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource}`,
    `style-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${opts.styleUri}" rel="stylesheet">
  <title>${escapeHtml(WELCOME_PANEL_TITLE)}</title>
</head>
<body>
  <main class="welcome">
    <h1 class="welcome-greeting">${escapeHtml(WELCOME_GREETING)}</h1>
    <p class="welcome-description">${escapeHtml(WELCOME_DESCRIPTION)}</p>
    <div id="steps" class="steps">${stepsHtml(opts.standings, opts.collapsed)}</div>
  </main>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
