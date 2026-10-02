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
// own orientation, the sentence explaining a setting whose origin the report
// does not cover, and the notification raised when the surface cannot be drawn.
// That division is what a reader can rely on: a setting's meaning is the schema's
// statement of it, not this surface's paraphrase.

import { escapeHtml } from './html';
import { ConfigControl } from './config-schema';
import {
  DAEMON_ACTION_LABEL,
  DAEMON_STANDING_WORDS,
  DaemonStanding,
  RESTART_COMMAND,
  daemonStandingAction,
} from './daemon-status';
import { describeError } from './error-surfaces';
import {
  ConfigPanelModel,
  ConfigRow,
  ConfigSectionRows,
  describeProvenance,
  effectiveValue,
  everyRow,
  setValue,
  sourceLabel,
} from './config-model';

// PANEL_TITLE is what a reader's assistive technology announces for the document.
const PANEL_TITLE = 'Aggrega configuration';

// ConfigPresentation is which of the two shapes the settings are drawn in.
//
// The two are interchangeable readings of one model and neither is a subset of
// the other: the table puts every setting on one line so a reader can scan and
// compare them, and the expanded shape gives each setting the room to carry the
// schema's own paragraph about it and the note saying how far a change would
// reach. A reader switches by what they came to do.
export type ConfigPresentation = 'table' | 'expanded';

// PRESENTATION_TOGGLE_COMMAND is the command the in-document control runs.
//
// It sits here, beside the composition that writes the link, so the identifier
// has ONE home: the boundary that registers the command and the boundary that
// admits it to the document both read it from here rather than each spelling it.
// A second spelling would be a link pointing at nothing, and it would fail
// silently — a webview reports no error for a command it is not allowed to run.
export const PRESENTATION_TOGGLE_COMMAND = 'aggrega.config.togglePresentation';

// PRESENTATION_MEMENTO_KEY is where the reader's last-used presentation is kept.
//
// 🔴 IT NAMES STORAGE THE EXTENSION HOLDS AND DELIBERATELY NOT A DECLARED
// PREFERENCE. This panel reports the configuration, so a preference about how to
// read the panel appearing in the very list of configuration the panel reports
// would leave a reader unable to tell the two surfaces apart. Storage the
// extension holds is invisible on every settings surface, which is the strongest
// available form of keeping it out.
//
// It sits in this module rather than beside the code that reads it for the
// reason every decision on this surface sits here: this module holds no editor
// type, so the key is readable by an assertion with no extension host running,
// and the guarantee above can therefore be checked rather than merely intended.
export const PRESENTATION_MEMENTO_KEY = 'aggrega.config.presentation';

// CONFIG_UNREAD_LEAD opens the notification a press of Show config ends in when
// the configuration cannot be read.
export const CONFIG_UNREAD_LEAD = 'The configuration surface could not be drawn';

// ConfigUnreadAction is the one act that notification offers: the words on its
// button and the command pressing the button runs.
export interface ConfigUnreadAction {
  label: string;
  command: string;
}

// ConfigUnreadNotice is what a reader is told when the configuration cannot be
// read, and the act offered beside it where there is one.
export interface ConfigUnreadNotice {
  message: string;
  action: ConfigUnreadAction | null;
}

// configUnreadNotice decides what a press of Show config ends in when the
// configuration cannot be read. It is one decision for every press: a panel
// opened by it and one already open, pressed on the Commands panel or run from
// the command palette.
//
// 🔴 WHETHER THE LANGUAGE SERVER IS RUNNING IS READ FROM ITS LIFECYCLE, NEVER
// FROM THE REFUSAL'S WORDS. The standing passed in is the one the status bar
// shows, taken as the refusal arrived. A refusal's sentence belongs to whoever
// raised it, and matching it would stop offering the start the day it was
// worded otherwise, with nothing failing. Where the server is not running, or is
// starting, the notification says so in the words the status bar uses for that
// standing. Where nothing is running it offers the act the status bar offers for
// it, under the same label and through the same command; a server starting is
// offered nothing, because it answers once it is up. A refusal with the server
// running is told in its own words with nothing offered, because a start is not
// its answer.
export function configUnreadNotice(standing: DaemonStanding, err: unknown): ConfigUnreadNotice {
  if (standing === 'running') {
    return { message: `${CONFIG_UNREAD_LEAD}: ${describeError(err)}`, action: null };
  }
  return {
    message: `${CONFIG_UNREAD_LEAD}: the Aggrega language server is ${DAEMON_STANDING_WORDS[standing]}`,
    action: standing === 'notRunning'
      ? { label: DAEMON_ACTION_LABEL[daemonStandingAction(standing)], command: RESTART_COMMAND }
      : null,
  };
}

// configPanelBodyHtml draws the whole surface in the presentation asked for.
//
// The control that changes presentation sits immediately after the box saying
// what the page can and cannot report, and before the settings themselves: a
// reader deciding how to read the page has read what the page is by then, and
// has not yet started on what they came for.
export function configPanelBodyHtml(
  model: ConfigPanelModel,
  presentation: ConfigPresentation,
): string {
  const settings = presentation === 'table'
    ? [configTableHtml(model)]
    : [
      ...model.rows.map(rowHtml),
      ...model.sections.map((section) => sectionHtml(section, 2)),
    ];
  return [
    summaryHtml(model),
    presentationSwitchHtml(presentation),
    ...settings,
  ].join('\n');
}

// presentationSwitchHtml draws the control that changes presentation.
//
// It offers whichever shape the reader is not already in and says what pressing
// will do, rather than restating the shape they can already see — the offer
// implies the current state, so naming both would spend a line saying one thing
// twice.
//
// 🔴 IT IS A LINK TO A COMMAND RATHER THAN A SCRIPTED CONTROL, AND THAT IS THE
// POINT. This document runs no script and admits no script source at all,
// because it reports; a presentation control is not a reason to give that up. A
// link the editor resolves to a command needs no script, is reachable by
// keyboard as any link is, and leaves the content policy exactly as narrow as it
// was.
function presentationSwitchHtml(presentation: ConfigPresentation): string {
  const label = presentation === 'table'
    ? 'Show each setting in full'
    : 'Show every setting in one table';
  return `<p class="config-switch">`
    + `<a class="config-switch-control" href="command:${escapeHtml(PRESENTATION_TOGGLE_COMMAND)}">`
    + `${escapeHtml(label)}</a></p>`;
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

// TABLE_COLUMNS are the table's headings, in the order a reader reads them.
//
// The order is the order the questions arrive in: which setting, what it is
// called, what the reader set, what it falls back to, what applies now, what it
// would accept, and where the applying value came from. The last column carries
// the affordance rather than a heading of its own, so its header names the
// column for assistive technology and draws nothing.
const TABLE_COLUMNS = ['Setting', 'Name', 'Set', 'Default', 'Effective', 'Takes', 'Source'];

// COLUMN_GRIP_CLASS marks a labelled heading as the grip its column is resized
// by. The stylesheet makes an element carrying it resizable by dragging, so the
// panel offers resizing with no script at all; the unlabelled last heading does
// not carry it, because that column holds a single small control.
export const COLUMN_GRIP_CLASS = 'config-column-grip';

// configTableHtml draws every setting as one row of one table.
//
// 🔴 THE ROW SET IS THE MODEL'S OWN ROWS, at every group depth, and the table is
// FLAT. The grouping is already carried by the setting path in the first column,
// so interleaving group headings would spend rows on information the rows
// already carry — and a table broken up by headings is not one a reader can scan
// down a column of. Reading the model's rows rather than re-walking the schema
// is what keeps the coverage sentence true of this presentation as well as the
// other.
//
// Each labelled heading cell is its column's grip rather than holding one,
// because the table holds a column to a width set on one of its cells and not
// to one set on anything inside a cell; the grip's rule in the stylesheet
// carries the whole reason.
export function configTableHtml(model: ConfigPanelModel): string {
  const head = TABLE_COLUMNS
    .map((column) => `<th scope="col" class="${COLUMN_GRIP_CLASS}">${escapeHtml(column)}</th>`)
    .join('');
  const body = everyRow(model).map(tableRowHtml).join('');
  return `<table class="config-table">
  <caption>Every setting the configuration schema declares</caption>
  <thead><tr>${head}`
    + `<th scope="col"><span class="config-offscreen">What it means</span></th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

// tableRowHtml draws one setting as one row.
//
// An empty cell is left empty deliberately in the two columns where emptiness is
// an answer: nothing under Set means the reader has not put this setting in
// force anywhere, and nothing under Default means the schema declares no
// fallback. Filling either with a placeholder would turn an answer into noise.
function tableRowHtml(row: ConfigRow): string {
  const control = row.control;
  const cells = [
    `<td class="config-cell-path"><code>${escapeHtml(control.path.join('.'))}</code></td>`,
    `<td>${escapeHtml(control.label)}</td>`,
    `<td class="config-cell-value">${escapeHtml(setValue(row) ?? '')}</td>`,
    `<td class="config-cell-value">${escapeHtml(defaultCell(control))}</td>`,
    `<td class="config-cell-value">${escapeHtml(effectiveCell(row))}</td>`,
    `<td class="config-cell-takes">${escapeHtml(shapePhrase(control))}</td>`,
    `<td class="config-cell-source">${escapeHtml(sourceLabel(row.provenance))}</td>`,
    `<td class="config-cell-info">${infoHtml(control)}</td>`,
  ];
  return `<tr>${cells.join('')}</tr>`;
}

// defaultCell spells what the schema declares the setting falls back to.
//
// A declaration with no default yields nothing rather than a word standing in
// for one: the schema declaring no fallback and the schema declaring an empty
// one are different facts, and only the second has anything to show.
function defaultCell(control: ConfigControl): string {
  return control.hasDefault ? renderDefault(control.defaultValue) : '';
}

// effectiveCell spells what applies to a setting now.
//
// 🔴 A DECLARED DEFAULT IS MARKED AS THE DECLARATION IT IS. The compiler
// reported no reading for such a setting, so putting the bare value here would
// have this surface assert a reading nobody took — the one thing the honest
// drawing of an uncovered setting exists to prevent. The marker is words rather
// than styling, because styling is not read aloud and is not carried into a
// copied cell.
function effectiveCell(row: ConfigRow): string {
  const effective = effectiveValue(row);
  switch (effective.kind) {
    case 'reported':
      return effective.value;
    case 'declared-default':
      return `${renderDefault(effective.value)} (declared default)`;
    default:
      return '';
  }
}

// infoHtml draws the affordance carrying the setting's own description.
//
// 🔴 IT EXISTS SO THE TABLE STAYS NARROW. The schema's sentence about a setting
// is the longest thing about it and drawing it inline would make every row as
// tall as a paragraph, which is the whole of what a table buys being spent.
//
// It opens on a press with no script at all, and the same sentence is on the
// control for a reader who hovers instead. The sentence appearing twice in the
// markup is one sentence from one source rendered for two affordances, which is
// the only way to offer both without a script.
function infoHtml(control: ConfigControl): string {
  const described = escapeHtml(control.description);
  const named = escapeHtml(`What ${control.path.join('.')} means`);
  return `<details class="config-info">`
    + `<summary aria-label="${named}" title="${described}">i</summary>`
    + `<p class="config-description">${described}</p>`
    + `</details>`;
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
    parts.push(`<p class="config-reach" role="note">${escapeHtml(`Global: ${row.scope.evidence}`)}</p>`);
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
// Which of the two a setting is, is decided in the model, so every presentation
// draws the same standing for the same setting.
export function valueSentence(row: ConfigRow): string {
  const effective = effectiveValue(row);
  switch (effective.kind) {
    case 'reported':
      return `In force: ${effective.value}`;
    case 'declared-default':
      return `Declared default: ${renderDefault(effective.value)}`;
    default:
      return 'No value reported and no default declared.';
  }
}

// shapePhrase names what a setting accepts, in the space one cell of a row gives
// it: its type, and the admissible values or the bounds where the schema
// declares them.
//
// It is the ONE home of that derivation. The sentence below is composed from it
// rather than deriving it a second time, so a presentation with room for a
// sentence and one with room for a phrase cannot come to say different things
// about what the same declaration accepts.
//
// The admissible values and the bounds are the schema's, so a reader is told what
// the compiler will accept rather than what this surface happens to allow.
export function shapePhrase(control: ConfigControl): string {
  switch (control.kind) {
    case 'toggle':
      return 'true or false';
    case 'number': {
      const bounds: string[] = [];
      if (control.minimum !== undefined) { bounds.push(`at least ${control.minimum}`); }
      if (control.maximum !== undefined) { bounds.push(`at most ${control.maximum}`); }
      return bounds.length > 0
        ? `a whole number, ${bounds.join(' and ')}`
        : 'a whole number';
    }
    case 'choice':
      return `one of: ${(control.choices ?? []).join(', ')}`;
    case 'text':
      return 'text';
    case 'text-list':
      return 'a list of text entries, one per line';
    case 'collection':
      return `a list of entries, each carrying ${fieldList(control)}`;
    case 'map':
      return `entries the reader names, each carrying ${fieldList(control)}`;
    default:
      return 'a shape this page does not draw a control for';
  }
}

// shapeSentence says what the setting takes, as a sentence.
//
// An enumeration's phrase already carries its own preposition, because the
// admissible values are a set the reader picks one from rather than a shape the
// value has — so the sentence supplies no colon of its own for that case and
// reads as one sentence instead of two clauses.
export function shapeSentence(control: ConfigControl): string {
  const phrase = shapePhrase(control);
  return control.kind === 'choice' ? `Takes ${phrase}.` : `Takes: ${phrase}.`;
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
// both. It is exported because every presentation spells a default, and a second
// spelling would show the same declaration two ways on two pages of one panel.
export function renderDefault(value: unknown): string {
  if (value === null) { return 'null'; }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

// ConfigDocumentOptions are the per-installation resources the document needs.
export interface ConfigDocumentOptions {
  model: ConfigPanelModel;
  // presentation is which shape the settings are drawn in. It is passed in
  // rather than defaulted here, so the one place that remembers the reader's
  // choice is the only place that decides it.
  presentation: ConfigPresentation;
  nonce: string;
  styleUri: string;
  cspSource: string;
}

// configDocumentHtml composes the whole document.
//
// The content policy admits this installation's own stylesheet and nothing else:
// the page runs no script, so no script source is allowed at all. A page that
// only reports needs none, and the narrowest policy that works is the one that
// cannot later admit something by accident. The one control on the page that
// reaches a command is a link the editor resolves, and the column grips are
// headings the editor itself resizes under the pointer; neither needs a script
// source or any widening of the policy — which is why the policy below is
// unchanged by their presence.
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
${configPanelBodyHtml(opts.model, opts.presentation)}
  </main>
</body>
</html>`;
}
