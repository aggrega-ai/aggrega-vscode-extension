// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// This module composes the configuration panel's document and holds no editor
// type, so what a reader is shown is assertable without an extension host: every
// setting the schema declares drawn with the label and the description the schema
// carries, the value in force where the compiler reported one, the file that
// produced it where the compiler could say, the declared default where it could
// not, and the bounds a value is held to.
//
// 🔴 EVERY WORD DRAWN HERE COMES FROM THE SCHEMA OR THE COMPILER'S REPORT. There
// is no label, no description and no default written in this file. The only text
// composed here is what the surface itself says — the headings for the reader's
// own orientation, and the sentence explaining a setting whose origin the report
// does not cover. That division is what a reader can rely on: a setting's meaning
// is the schema's statement of it, not this surface's paraphrase.

import { escapeHtml } from './html';
import { ConfigControl } from './config-schema';
import {
  ConfigPanelModel,
  ConfigRow,
  ConfigSectionRows,
  describeProvenance,
} from './config-model';

// PANEL_TITLE is what a reader's assistive technology announces for the document.
const PANEL_TITLE = 'Aggrega configuration';

// configPanelBodyHtml draws the whole surface.
export function configPanelBodyHtml(model: ConfigPanelModel): string {
  return [
    summaryHtml(model),
    ...model.rows.map(rowHtml),
    ...model.sections.map((section) => sectionHtml(section, 2)),
  ].join('\n');
}

// summaryHtml draws what the surface can and cannot say, before any setting.
//
// The coverage sentence is drawn rather than left implicit because it is the
// reader's warning about the rest of the page: with the compiler's report
// covering part of the configuration, a reader who did not know that would read
// every unattributed setting as one nothing has ever set.
function summaryHtml(model: ConfigPanelModel): string {
  const layers = model.layers.length > 0
    ? `<ul class="config-layers">${model.layers.map((l) => `<li><code>${escapeHtml(l)}</code></li>`).join('')}</ul>`
    : '<p class="config-note">No configuration file contributed: every setting is at its built-in default.</p>';

  return `<section class="config-summary" aria-label="What this page reports">
  <h2>Where these values come from</h2>
  <p class="config-note">Files that contributed, lowest precedence first:</p>
  ${layers}
  <p class="config-note">${escapeHtml(coverageSentence(model))}</p>
</section>`;
}

// coverageSentence states the report's reach in the reader's own terms.
//
// The two numbers are counted from the model rather than written here, so the
// sentence stays true as the schema and the report each change. It says settings
// SHOWN rather than settings declared, because that is what the count counts: a
// reader can check it against the page in front of them, where a claim about the
// schema would have to be taken on trust.
export function coverageSentence(model: ConfigPanelModel): string {
  return `The configuration report attributes ${model.attributed} of the ${model.drawn} `
    + 'settings shown here. A setting it does not cover is shown with its declared '
    + 'default and no source, which is what the report says about it rather than a gap on this page.';
}

// sectionHtml draws one group, at the heading depth its nesting calls for.
function sectionHtml(section: ConfigSectionRows, depth: number): string {
  const level = Math.min(depth, 6);
  const description = section.description.length > 0
    ? `<p class="config-description">${escapeHtml(section.description)}</p>`
    : '';
  return `<section class="config-group" aria-label="${escapeHtml(section.label)}">
  <h${level}><code>${escapeHtml(section.path.join('.'))}</code> ${escapeHtml(section.label)}</h${level}>
  ${description}
  ${section.rows.map(rowHtml).join('\n')}
  ${section.sections.map((child) => sectionHtml(child, depth + 1)).join('\n')}
</section>`;
}

// rowHtml draws one setting.
//
// The order is fixed and it is the order a reader needs: what the setting is,
// what it means, what is in force, and where that came from. The reach is drawn
// last and only where the product has something to say about it, because a note
// on every row would train a reader to stop reading them.
function rowHtml(row: ConfigRow): string {
  const control = row.control;
  const parts = [
    `<dt><code>${escapeHtml(control.path.join('.'))}</code></dt>`,
    `<dd class="config-setting">`,
    `<p class="config-label">${escapeHtml(control.label)}</p>`,
    `<p class="config-description">${escapeHtml(control.description)}</p>`,
    `<p class="config-shape">${escapeHtml(shapeSentence(control))}</p>`,
    `<p class="config-value">${escapeHtml(valueSentence(row))}</p>`,
    `<p class="config-source">${escapeHtml(`Source: ${describeProvenance(row.provenance)}`)}</p>`,
  ];
  if (row.scope.reach === 'machine') {
    parts.push(`<p class="config-reach" role="note">${escapeHtml(`Machine-wide: ${row.scope.evidence}`)}</p>`);
  }
  parts.push('</dd>');
  return `<dl class="config-row">${parts.join('')}</dl>`;
}

// valueSentence says what is in force.
//
// A setting the report covers is shown as the report rendered it. A setting it
// does not cover is shown as its declared default, SAID TO BE the default rather
// than presented as a current reading — the difference matters, because the
// second would be this surface asserting something the compiler never reported.
export function valueSentence(row: ConfigRow): string {
  if (row.value !== undefined) { return `In force: ${row.value}`; }
  if (row.control.hasDefault) {
    return `Declared default: ${renderDefault(row.control.defaultValue)}`;
  }
  return 'No value reported and no default declared.';
}

// shapeSentence says what the setting takes, from the declaration alone.
//
// The admissible values and the bounds are the schema's, so a reader is told what
// the compiler will accept rather than what this surface happens to allow.
export function shapeSentence(control: ConfigControl): string {
  switch (control.kind) {
    case 'toggle':
      return 'Takes: true or false.';
    case 'number': {
      const bounds: string[] = [];
      if (control.minimum !== undefined) { bounds.push(`at least ${control.minimum}`); }
      if (control.maximum !== undefined) { bounds.push(`at most ${control.maximum}`); }
      return bounds.length > 0
        ? `Takes: a whole number, ${bounds.join(' and ')}.`
        : 'Takes: a whole number.';
    }
    case 'choice':
      return `Takes one of: ${(control.choices ?? []).join(', ')}.`;
    case 'text':
      return 'Takes: text.';
    case 'text-list':
      return 'Takes: a list of text entries, one per line.';
    case 'collection':
      return `Takes: a list of entries, each carrying ${fieldList(control)}.`;
    case 'map':
      return `Takes: entries the reader names, each carrying ${fieldList(control)}.`;
    default:
      return 'Takes: a shape this page does not draw a control for.';
  }
}

// fieldList names an entry's own fields, from the schema's declaration of them.
function fieldList(control: ConfigControl): string {
  const names = (control.itemFields ?? []).map((f) => f.path[f.path.length - 1]);
  if (names.length === 0) { return 'no declared fields'; }
  return names.join(', ');
}

// renderDefault spells a declared default without interpreting it.
//
// A list and an object are spelled in the schema's own notation rather than in
// prose, so a reader comparing the page against the file sees the same thing in
// both.
function renderDefault(value: unknown): string {
  if (value === null) { return 'null'; }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

// ConfigDocumentOptions are the per-installation resources the document needs.
export interface ConfigDocumentOptions {
  model: ConfigPanelModel;
  nonce: string;
  styleUri: string;
  cspSource: string;
}

// configDocumentHtml composes the whole document.
//
// The content policy admits this installation's own stylesheet and nothing else:
// the page runs no script, so no script source is allowed at all. A page that
// only reports needs none, and the narrowest policy that works is the one that
// cannot later admit something by accident.
export function configDocumentHtml(opts: ConfigDocumentOptions): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${opts.cspSource}`,
    `font-src ${opts.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${opts.styleUri}" rel="stylesheet">
  <title>${escapeHtml(PANEL_TITLE)}</title>
</head>
<body>
  <main id="config" class="config" aria-label="${escapeHtml(PANEL_TITLE)}">
  <h1>${escapeHtml(PANEL_TITLE)}</h1>
${configPanelBodyHtml(opts.model)}
  </main>
</body>
</html>`;
}
