// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { escapeHtml } from './html';
import * as l10n from './l10n';

// GraphDocumentOptions carries the addresses the editor resolves for the graph
// panel's own resources. They are plain strings so this module keeps no editor
// type, and the caller passes what the webview gave it.
export interface GraphDocumentOptions {
  nonce: string;
  cspSource: string;
  elkUri: string;
  modelUri: string;
  attachmentsUri: string;
  candidatesUri: string;
  scriptUri: string;
  styleUri: string;
  // document is the language the panel's words are in and the direction it reads
  // in. Absent, the document declares English, left to right.
  document?: l10n.DocumentLanguage;
}

// graphDocumentHtml builds the webview document: a strict CSP allowing only the
// nonce'd inline bootstrap plus the five local scripts (elk bundle + the
// layout model + the attachment projection + the candidate projection + the
// graph renderer). Its own words are looked up and escaped, so a translation is
// written into the document as text.
//
// The drawing is always left to right: the layout runs left to right and a
// mirrored canvas would draw edges against it. The panel, the legend and the
// toolbar around it follow the document's direction.
export function graphDocumentHtml(opts: GraphDocumentOptions): string {
  const { lang, dir } = opts.document ?? { lang: 'en', dir: 'ltr' };
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource}`,
    `style-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}' ${opts.cspSource}`,
  ].join('; ');
  const { nonce, elkUri, modelUri, attachmentsUri, candidatesUri, scriptUri, styleUri } = opts;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${escapeHtml(l10n.t('Aggrega Graph'))}</title>
</head>
<body>
  <div id="status" class="status">${escapeHtml(l10n.t('Select a Release to render its topology.'))}</div>
  <svg id="canvas" dir="ltr" xmlns="http://www.w3.org/2000/svg"></svg>
  <!-- The layout has to size every box around the text it will hold, and it
       runs before any of the graph is in the document. This text element is in
       the document from the start, parked off to the side of the viewport, so
       there is somewhere to measure a string before there is a graph to draw.
       It is moved out of sight rather than hidden: an element the browser does
       not lay out reports no text advance at all. -->
  <svg id="measure" class="measure" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <text id="measure-text"></text>
  </svg>
  <aside id="legend" class="legend hidden"></aside>
  <aside id="panel" class="panel hidden">
    <header class="panel-head">
      <span id="panel-title" class="panel-title"></span>
      <button id="panel-close" class="panel-close" title="${escapeHtml(l10n.t('Close'))}">✕</button>
    </header>
    <div id="panel-body" class="panel-body"></div>
  </aside>
  <script nonce="${nonce}" src="${elkUri}"></script>
  <script nonce="${nonce}" src="${modelUri}"></script>
  <script nonce="${nonce}" src="${attachmentsUri}"></script>
  <script nonce="${nonce}" src="${candidatesUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
