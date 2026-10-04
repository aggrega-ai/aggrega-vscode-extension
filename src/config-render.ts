// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// This module composes the configuration panel's document and holds no editor
// type, so what a reader is shown is assertable without an extension host: every
// setting the schema declares drawn with the name derived from its key and the
// description the schema carries, the value in force where the compiler reported
// one, the file that produced it where the compiler could say, the declared
// default where it could not, and the bounds a value is held to.
//
// 🔴 EVERY WORD DRAWN HERE ABOUT A SETTING COMES FROM THE SCHEMA OR THE
// COMPILER'S REPORT. There is no name, no description and no default written in
// this file. The only text composed here is what the surface itself says — the
// headings, the caption and the mark it explains for the reader's own
// orientation, the word "none" where no value is in force, the sentences saying
// what the report leaves unattributed and what it gives for a list and its
// companion, the rule for the Global marker, and the notification raised when the
// surface cannot be drawn. That division is what a reader can rely on: a
// setting's meaning is the schema's statement of it, not this surface's
// paraphrase.

import { escapeHtml } from './html';
import { ConfigControl, dottedPath } from './config-schema';
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
  ValueMark,
  describeProvenance,
  effectiveValue,
  everyRow,
  sourceLabel,
  valueMark,
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
      ...reachRuleHtml(model),
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
// The coverage sentence is drawn rather than left implicit where the compiler's
// report leaves a setting unattributed, because it is the reader's warning about
// the rest of the page: a reader who did not know that would read such a setting
// as one nothing has ever set. Where the report attributes every row, there is
// nothing to warn of and no sentence is drawn.
function summaryHtml(model: ConfigPanelModel): string {
  const layers = model.layers.length > 0
    ? `<ul class="config-layers">${model.layers.map((l) => `<li><code>${escapeHtml(l)}</code></li>`).join('')}</ul>`
    : '<p class="config-note">No configuration file contributed: every setting is at its built-in default.</p>';
  const coverage = coverageSentence(model);

  return `<section class="config-summary" aria-label="What this page reports">
  <h2>Where these values come from</h2>
  <p class="config-note">Files that contributed, lowest precedence first:</p>
  ${layers}
  ${coverage === null ? '' : `<p class="config-note">${escapeHtml(coverage)}</p>`}
</section>`;
}

// coverageSentence names the settings shown here that the compiler's report
// leaves unattributed, and why each is drawn as it is — or answers null where
// the report attributes every one, so a page with nothing to warn of draws no
// warning.
//
// It names each setting rather than counting them, because a count tells the
// reader that something is missing without telling them what. Where the report
// attributes none at all — one that could not be read — the sentence says so in
// one clause rather than listing every setting on the page.
export function coverageSentence(model: ConfigPanelModel): string | null {
  const rows = everyRow(model);
  const unattributed = rows.filter((row) => row.provenance.kind === 'unattributed');
  if (unattributed.length === 0) { return null; }
  if (unattributed.length === rows.length) {
    return 'The configuration report attributes none of the settings shown here, so each is shown '
      + 'with its declared default and no source.';
  }
  const named = wordList(unattributed.map((row) => dottedPath(row.control.path)));
  return unattributed.length === 1
    ? `The configuration report carries no row for ${named}, so it is shown with its declared default and no source.`
    : `The configuration report carries no row for ${named}, so each is shown with its declared default and no source.`;
}

// wordList joins names as a sentence lists them: "a", "a and b", "a, b and c".
function wordList(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// TABLE_COLUMNS are the table's labelled headings, in the order a reader reads
// them, and LAST_COLUMN the heading of the column after them.
//
// The order is the order the questions arrive in: which setting, what it is
// called, what applies now, what it would accept, where the applying value came
// from, and what it means. ONE column says what applies now, rather than one for
// what the reader set, one for the declared default and one for what applies:
// the three repeated one value on nearly every row, and the one thing they told
// apart — whether the value is the declared default — is the mark the value
// carries where it is not. The last column draws its heading like every other,
// so a reader sees what the circle under it opens.
const TABLE_COLUMNS = ['Setting', 'Name', 'Value', 'Takes', 'Source'];
const LAST_COLUMN = 'Description';

// VALUE_MARK is the mark beside a value that is not its declared default, and
// TABLE_CAPTION the table's caption: what it lists, how it is arranged, and what
// that mark means — said once, here, rather than on every marked row.
const VALUE_MARK = '●';
const TABLE_CAPTION = 'Every setting the configuration schema declares, beneath the group it belongs to. '
  + `A value marked ${VALUE_MARK} is set in a file or the environment, or is not its declared default.`;

// NONE is what a setting with no value in force says, rather than drawing
// nothing: an empty cell reads as a surface that failed to fill it. An empty list
// is a value, and is drawn as the `[]` the report gives.
const NONE = 'none';

// COLUMN_GRIP_CLASS marks a labelled heading as the grip its column is resized
// by. The stylesheet makes an element carrying it resizable by dragging, so the
// panel offers resizing with no script at all; the last heading names its column
// but does not carry it, because that column holds a single small control.
export const COLUMN_GRIP_CLASS = 'config-column-grip';

// GLOBAL is the word a setting that belongs to the machine rather than to one
// project is marked with — on its row in the table, and opening its note in the
// per-setting shape — so the two shapes call it the same.
const GLOBAL = 'Global';

// configTableHtml draws every setting as one row of one table, beneath a heading
// row for the group it belongs to.
//
// 🔴 THE ROW SET IS THE MODEL'S OWN ROWS, at every group depth and in the
// model's order, and the table MARKS ITS GROUPS. Each group holding settings of
// its own is a body of the table opening with a heading row — its path under the
// Setting column, its name beside it — and its settings beneath; the settings at
// the top level, in no group, come first under no heading. A name such as
// "Required" or "Issuer" means nothing without its group, and the heading is what
// gives it one without lengthening every row. The heading row's first cell stands
// in the Setting column and is held at the left edge with it, so the header row
// and that column stay in view as they do over the settings themselves. Reading
// the model's rows rather than re-walking the schema is what keeps the coverage
// sentence true of this presentation as well as the other.
//
// Each labelled heading cell is its column's grip rather than holding one,
// because the table holds a column to a width set on one of its cells and not
// to one set on anything inside a cell; the grip's rule in the stylesheet
// carries the whole reason.
export function configTableHtml(model: ConfigPanelModel): string {
  const head = [
    ...TABLE_COLUMNS.map((column) => `<th scope="col" class="${COLUMN_GRIP_CLASS}">${escapeHtml(column)}</th>`),
    `<th scope="col">${escapeHtml(LAST_COLUMN)}</th>`,
  ].join('');
  const bodies = [
    ...(model.rows.length > 0 ? [`<tbody>${model.rows.map(tableRowHtml).join('')}</tbody>`] : []),
    ...model.sections.flatMap(groupBodiesHtml),
  ];
  return `<table class="config-table">
  <caption><span class="config-caption">${escapeHtml(TABLE_CAPTION)}</span></caption>
  <thead><tr>${head}</tr></thead>
  ${bodies.join('\n  ')}
</table>`;
}

// groupBodiesHtml draws one group as a body of the table — its heading row, then
// its own settings — and the groups inside it after it, each its own body. A
// group holding no setting of its own draws no heading: the groups inside it
// carry its path at the head of theirs. The heading's name spans every column
// after the Setting one, so the row reads as one band.
function groupBodiesHtml(section: ConfigSectionRows): string[] {
  const own = section.rows.length === 0 ? [] : [`<tbody>`
    + `<tr class="config-group-row">`
    + `<th scope="rowgroup" class="config-cell-path">${pathHtml(section.path)}</th>`
    + `<td class="config-group-name" colspan="${TABLE_COLUMNS.length}">${escapeHtml(section.label)}</td>`
    + `</tr>${section.rows.map(tableRowHtml).join('')}</tbody>`];
  return [...own, ...section.sections.flatMap(groupBodiesHtml)];
}

// tableRowHtml draws one setting as one row.
//
// Every cell says something. The value cell draws "none" where no value is in
// force, rather than an empty cell a reader cannot tell from one that failed to
// fill; and a list's companion, folded into the list's row, is named under the
// list's own path so a reader looking for it finds it there.
function tableRowHtml(row: ConfigRow): string {
  const control = row.control;
  const companions = row.companions.map((c) => `<span class="config-companion">+ ${pathHtml(c.path)}</span>`);
  const cells = [
    `<td class="config-cell-path">${pathHtml(control.path)}${companions.join('')}</td>`,
    `<td class="config-cell-name"><span class="config-name">${escapeHtml(row.name)}</span>${globalMarkHtml(row)}</td>`,
    `<td class="config-cell-value">${valueCellHtml(row)}</td>`,
    `<td class="config-cell-takes">${breakableHtml(shapePhrase(control), FIELD_BREAKS)}</td>`,
    `<td class="config-cell-source">${breakableHtml(sourceLabel(row.provenance), VALUE_BREAKS)}</td>`,
    `<td class="config-cell-info">${infoHtml(row)}</td>`,
  ];
  return `<tr>${cells.join('')}</tr>`;
}

// PATH_BREAKS, VALUE_BREAKS and FIELD_BREAKS are the characters after which a
// setting path, a value or a file path, and a field name may break across lines.
//
// 🔴 NOTHING ON THE TABLE BREAKS INSIDE A WORD. A setting path is a run of words
// joined by `_` and `.`, a value or a file path one joined by `.`, `/` and `_`,
// and the document marks a place to break after each of those and nowhere else
// inside a word — so "default_registry" wraps as "default_" and "registry", never
// as "default_regist" and "ry". The stylesheet breaks a word nowhere else, so a
// column is never narrower than its longest unbroken run.
const PATH_BREAKS = '_.';
const VALUE_BREAKS = '/._';
const FIELD_BREAKS = '_';

// pathHtml draws a setting path as code, marked to break only after `_` or `.`.
function pathHtml(path: string[]): string {
  return `<code class="config-path">${breakableHtml(dottedPath(path), PATH_BREAKS)}</code>`;
}

// breakableHtml escapes `text` and marks a place to break after each character of
// it that `after` names. The mark is an element rather than a character, so a
// value copied out of the page is the value as written.
function breakableHtml(text: string, after: string): string {
  const chars = [...text];
  return chars.map((ch, i) => (after.includes(ch) && i < chars.length - 1 ? `${escapeHtml(ch)}<wbr>` : escapeHtml(ch))).join('');
}

// globalMarkHtml draws the one word marking a setting that belongs to the
// machine rather than to one project, with the reason on hover. A row the
// product says nothing about the reach of draws nothing, so the word keeps its
// weight instead of appearing on every row.
function globalMarkHtml(row: ConfigRow): string {
  if (row.scope.reach !== 'machine') { return ''; }
  return ` <span class="config-global" title="${escapeHtml(row.scope.evidence)}">${escapeHtml(GLOBAL)}</span>`;
}

// valueCellHtml draws what applies to a setting now, in the one value column.
//
// 🔴 A DECLARED DEFAULT IS MARKED AS THE DECLARATION IT IS. The compiler
// reported no reading for such a setting, so putting the bare value here would
// have this surface assert a reading nobody took — the one thing the honest
// drawing of an uncovered setting exists to prevent. The marker is words rather
// than styling, because styling is not read aloud and is not carried into a
// copied cell. A value the report gives carries the mark where valueMark says it
// is not the declared default; the mark's own words say why, for a reader who
// hovers it and for one who hears it.
function valueCellHtml(row: ConfigRow): string {
  const effective = effectiveValue(row);
  switch (effective.kind) {
    case 'reported': {
      const mark = valueMark(row);
      const value = effective.value === ''
        ? `<span class="config-none">${escapeHtml(NONE)}</span>`
        : breakableHtml(effective.value, VALUE_BREAKS);
      return `${mark === null ? '' : markHtml(mark, row.control)}<span class="config-value-text">${value}</span>`;
    }
    case 'declared-default':
      return `<span class="config-value-text">${breakableHtml(`${renderDefault(effective.value)} (declared default)`, VALUE_BREAKS)}</span>`;
    default:
      return `<span class="config-value-text"><span class="config-none">${escapeHtml(`${NONE} (no default declared)`)}</span></span>`;
  }
}

// MARK_WORDS say why a value carries the mark.
const MARK_WORDS: Readonly<Record<ValueMark, string>> = {
  'file': 'Set in a file',
  'environment': 'Set in the environment',
  'not-the-default': 'Not its declared default',
};

// markHtml draws the mark beside a value, named in words for a reader who hovers
// it and for one who hears it, together with the default the value replaces.
function markHtml(mark: ValueMark, control: ConfigControl): string {
  const declared = control.hasDefault
    ? `its declared default is ${renderDefault(control.defaultValue)}`
    : 'the schema declares no default';
  const words = escapeHtml(`${MARK_WORDS[mark]}; ${declared}.`);
  return `<span class="config-mark" role="img" aria-label="${words}" title="${words}">${VALUE_MARK}</span>`;
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
// the only way to offer both without a script: the paragraph draws its code as
// code, and the hover, which can carry no markup, carries the same words. A row
// a companion is folded into carries the companion's own sentence after the
// list's, and what the report gives for the two.
function infoHtml(row: ConfigRow): string {
  const control = row.control;
  const described = escapeHtml(plainText(control.description));
  const named = escapeHtml(`What ${dottedPath(control.path)} means`);
  return `<details class="config-info">`
    + `<summary aria-label="${named}" title="${described}">i</summary>`
    + `<p class="config-description">${codeHtml(control.description)}</p>`
    + companionsHtml(row)
    + `</details>`;
}

// companionsHtml draws, for a row a companion is folded into, each companion's
// own sentence and what the report gives for the list and its companions.
function companionsHtml(row: ConfigRow): string {
  if (row.companions.length === 0) { return ''; }
  return `${row.companions.map(companionSentenceHtml).join('')}${foldHtml(row)}`;
}

// companionSentenceHtml draws a companion's own sentence, opened by its path so
// a reader can tell it from the list's.
function companionSentenceHtml(companion: ConfigControl): string {
  return `<p class="config-description"><code>${escapeHtml(dottedPath(companion.path))}</code>: ${codeHtml(companion.description)}</p>`;
}

// foldHtml draws the fold sentence for a row a companion is folded into.
function foldHtml(row: ConfigRow): string {
  return `<p class="config-fold">${escapeHtml(foldSentence(row))}</p>`;
}

// foldSentence says what the compiler's report gives for a list and the
// companions folded into it, and what it does not.
//
// 🔴 IT SAYS NO MORE THAN THE REPORT DOES. The report gives the list and its
// companion as one value under one source and does not say which entries the
// companion added, so neither does this: a split drawn here would be one the
// compiler never reported.
export function foldSentence(row: ConfigRow): string {
  const named = wordList(row.companions.map((c) => dottedPath(c.path)));
  const all = row.companions.length === 1 ? 'both' : 'each';
  return `The configuration report gives this list and ${named} as one value, holding the entries of ${all} `
    + `under one source; it does not say which of them ${named} added.`;
}

// CodeSpan is one run of a schema sentence: words, or code the sentence writes
// between backticks.
interface CodeSpan { text: string; code: boolean }

// codeSpans splits a schema sentence into its words and the code it writes
// between backticks. A backtick with no partner after it is a backtick, and is
// kept as one.
function codeSpans(sentence: string): CodeSpan[] {
  const parts = sentence.split('`');
  const paired = parts.length % 2 === 1 ? parts.length : parts.length - 1;
  const spans = parts.slice(0, paired).map((text, i) => ({ text, code: i % 2 === 1 }));
  return paired < parts.length ? [...spans, { text: `\`${parts[paired]}`, code: false }] : spans;
}

// codeHtml draws a schema sentence with each run it writes between backticks
// drawn as code, in both shapes. Every run is escaped as it is drawn, so a
// sentence reaches the document as the characters it is and never as markup.
export function codeHtml(sentence: string): string {
  return codeSpans(sentence).map((s) => (s.code ? `<code>${escapeHtml(s.text)}</code>` : escapeHtml(s.text))).join('');
}

// plainText is a schema sentence as words alone, its code runs kept and their
// backticks dropped, for a place that can carry no markup.
export function plainText(sentence: string): string {
  return codeSpans(sentence).map((s) => s.text).join('');
}

// sectionHtml draws one group, at the heading depth its nesting calls for.
function sectionHtml(section: ConfigSectionRows, depth: number): string {
  const level = Math.min(depth, 6);
  const description = section.description.length > 0
    ? `<p class="config-description">${codeHtml(section.description)}</p>`
    : '';
  return `<section class="config-group" aria-label="${escapeHtml(section.label)}">
  <h${level}><code>${escapeHtml(dottedPath(section.path))}</code> ${escapeHtml(section.label)}</h${level}>
  ${description}
  ${section.rows.map(rowHtml).join('\n')}
  ${section.sections.map((child) => sectionHtml(child, depth + 1)).join('\n')}
</section>`;
}

// REACH_RULE states, once, at the head of the per-setting shape, which settings
// carry the Global marker and its note.
const REACH_RULE = `A setting marked ${GLOBAL} belongs to this machine rather than to one project, `
  + 'and the note on it says why.';

// reachRuleHtml draws the rule for the Global marker where a setting on the page
// carries it, and nothing where none does.
function reachRuleHtml(model: ConfigPanelModel): string[] {
  return everyRow(model).some((row) => row.scope.reach === 'machine')
    ? [`<p class="config-reach-rule">${escapeHtml(REACH_RULE)}</p>`]
    : [];
}

// rowHtml draws one setting.
//
// The order is fixed and it is the order a reader needs: what the setting is,
// what it means, what is in force, and where that came from. A companion folded
// into the setting is named beside its path and its sentence beside the
// setting's own. The reach is drawn last and only where the product has
// something to say about it, because a note on every row would train a reader to
// stop reading them.
function rowHtml(row: ConfigRow): string {
  const control = row.control;
  const parts = [
    `<dt><code>${escapeHtml(dottedPath(control.path))}</code></dt>`,
    ...row.companions.map((c) => `<dt><code>${escapeHtml(dottedPath(c.path))}</code></dt>`),
    `<dd class="config-setting">`,
    `<p class="config-label">${escapeHtml(row.name)}</p>`,
    `<p class="config-description">${codeHtml(control.description)}</p>`,
    ...row.companions.map(companionSentenceHtml),
    `<p class="config-shape">${escapeHtml(shapeSentence(control))}</p>`,
    `<p class="config-value">${escapeHtml(valueSentence(row))}</p>`,
    ...(row.companions.length > 0 ? [foldHtml(row)] : []),
    `<p class="config-source">${escapeHtml(`Source: ${describeProvenance(row.provenance)}`)}</p>`,
  ];
  if (row.scope.reach === 'machine') {
    parts.push(`<p class="config-reach" role="note">${escapeHtml(`${GLOBAL}: ${row.scope.evidence}`)}</p>`);
  }
  parts.push('</dd>');
  return `<dl class="config-row">${parts.join('')}</dl>`;
}

// valueSentence says what is in force.
//
// A setting the report covers is shown as the report rendered it, and as "none"
// where the report gives no value at all. A setting it does not cover is shown as
// its declared default, SAID TO BE the default rather than presented as a current
// reading — the difference matters, because the second would be this surface
// asserting something the compiler never reported. Which of the two a setting
// is, is decided in the model, so every presentation draws the same standing for
// the same setting.
export function valueSentence(row: ConfigRow): string {
  const effective = effectiveValue(row);
  switch (effective.kind) {
    case 'reported':
      return `In force: ${effective.value === '' ? NONE : effective.value}`;
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
      return `named entries, each carrying ${fieldList(control)}`;
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
