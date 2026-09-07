// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  STEP_CONTENT,
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

// stepsHtml composes the four steps against the standings given.
//
// It is called on every refresh with freshly recomputed standings, so a step
// whose condition has lapsed is drawn as outstanding again. Nothing here
// remembers a previous standing, which is what makes the mark reversible rather
// than a one-way tick.
export function stepsHtml(standings: Record<StepId, boolean>): string {
  return STEP_CONTENT.map((step) => {
    const met = standings[step.id];
    const controls = step.actions
      .map(
        (action) =>
          `<button class="step-action" type="button" data-command="${escapeHtml(action.command)}">${escapeHtml(action.label)}</button>`,
      )
      .join('');
    return `<section class="step ${met ? 'step-met' : 'step-unmet'}" data-step="${escapeHtml(step.id)}">
  <h2 class="step-head">
    <span class="step-mark" aria-hidden="true">${met ? '&check;' : '&#9675;'}</span>
    <span class="step-title">${escapeHtml(step.title)}</span>
    <span class="step-standing">${met ? MET_LABEL : UNMET_LABEL}</span>
  </h2>
  <p class="step-summary">${inlineHtml(step.summary)}</p>
  <div class="step-detail">${step.detail.map(detailHtml).join('')}</div>
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
    <div id="steps" class="steps">${stepsHtml(opts.standings)}</div>
  </main>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
