// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import {
  PANEL_SETTING_LABEL,
  STEP_CONTENT,
  STEP_IDS,
  StepDetail,
  StepId,
  StepReading,
  StepValue,
  WELCOME_DESCRIPTION,
  WELCOME_GREETING,
  WELCOME_PANEL_TITLE,
  panelSettingCommand,
} from './get-started-steps';
import { DAEMON_READING_WORDS, DaemonReading } from './daemon-status';
import { escapeHtml } from './html';
import * as l10n from './l10n';
import { VERSION_ABSENT, versionKnown } from './version-words';

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
//
// 🔴 THE UNMET WORD NAMES A JOB FOR THE READER AND NOTHING ELSE, and that rules
// out one obvious-looking choice. "Outstanding" also means excellent, so on a
// list of standings it can read as praise for the step rather than as work left
// — and the glyph beside it is hidden from assistive technology, so this word is
// the only channel a reader using a screen reader gets. Spoken aloud, the
// ambiguity is the whole of the problem.
export const MET_LABEL = l10n.t('Met');
export const UNMET_LABEL = l10n.t('To do');

// initiallyCollapsedStepIds decides which sections a panel opens closed: the
// ones whose condition is already satisfied.
//
// The panel's job is to show what is still needed. A satisfied step is context,
// so it earns its title and its ways forward and nothing more; one still to
// do needs its explanation in front of the reader.
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
export function initiallyCollapsedStepIds(
  readings: Record<StepId, StepReading>,
): StepId[] {
  return STEP_IDS.filter((id) => readings[id].met);
}

// toggleLabel names one section's caret for a reader who reaches it without
// seeing it.
//
// It names the REGION the caret governs and says nothing about the direction:
// whether the region is open is carried by the control's own expansion state,
// which is where a screen reader reads it from, and a name that also said
// "expand" would be a second copy of that state — wrong half the time.
export function toggleLabel(title: string): string {
  return l10n.t('Explanation: {0}', title);
}

// VALUE_LEAD_IN introduces a chosen value, so the line says what it is rather
// than standing as a bare token under a heading.
//
// 🔴 IT IS DELIBERATELY QUIETER THAN WHAT IT INTRODUCES, and the stylesheet is
// where that is declared. The value outranks the guidance around it on purpose;
// a lead-in set at the same size and weight would compete with the very thing
// it is there to point at, so it is drawn smaller, at ordinary weight, in the
// page's own descriptive colour.
//
// The words standing where a value would be take no lead-in. They are whole
// sentences rather than tokens, and introducing a sentence with a label reads
// as a label applied to the wrong kind of thing.
//
// The words end at their colon. The gap between them and the value is layout,
// so the markup puts it there, inside the lead-in's own span, and a translation
// carries no space of its own.
export const VALUE_LEAD_IN = l10n.t('Selected:');

// VALUE_LEAD_CLASS addresses the lead-in so the stylesheet can set it apart
// from the value it introduces. It is named here because this is where the
// lead-in is composed.
const VALUE_LEAD_CLASS = 'step-value-lead';

// stepValueHtml draws what one step currently stands at, at one of the two
// positions a step carries it.
//
// 🔴 THE VALUE IS COMPOSED AT BOTH POSITIONS EVERY TIME AND THE STYLESHEET
// SHOWS ONE, WHICH IS THE WHOLE SHAPE OF THIS RATHER THAN AN OPTIMISATION. A
// section opens and closes in the document itself: the panel's script moves the
// caret's expansion state and puts the explanation away, and the extension is
// told afterwards so that the NEXT composition arrives in the reader's shape.
// So a copy this composition put away would stay put away through a press the
// extension never hears about, and the reader who folded a section would find
// the value gone from it — which looks exactly like the value being absent.
// Composing both and letting the one record of the state decide which is drawn
// cannot come out of step, because there is nothing here to keep in step. It is
// the same move the caret's own direction makes.
//
// The hidden copy is removed by `display: none` rather than by an attribute, so
// it leaves the accessibility tree with it and a reader using a screen reader
// is told the value once.
function stepValueHtml(value: StepValue, position: 'folded' | 'open'): string {
  const chosen = 'chosen' in value;
  const classes = ['step-value', `step-value-${position}`];
  if (!chosen) { classes.push('step-value-absent'); }
  const lead = chosen
    ? `<span class="${VALUE_LEAD_CLASS}">${escapeHtml(VALUE_LEAD_IN)} </span>`
    : '';
  const text = chosen ? value.chosen : value.absent;
  return `<p class="${classes.join(' ')}">${lead}${escapeHtml(text)}</p>`;
}

// stepsHtml composes the four steps against the readings given, arranged as
// the collapsed set given.
//
// THE TWO ARGUMENTS ARE SEPARATE AND NEITHER IS DERIVED FROM THE OTHER. The
// readings are recomputed and passed afresh on every refresh, so a step whose
// condition has lapsed is drawn as still to do again and nothing here remembers
// a previous standing — that is what makes the mark reversible rather than a
// one-way tick. The arrangement arrives from the caller, which read it once when
// the panel was created and has changed it only where the reader pressed a
// caret. Deriving the arrangement from `met` here instead would look like the
// same thing and would break both halves: every refresh would fold a
// newly-satisfied step away under the reader, and every refresh would also
// discard whatever the reader had toggled, because the composed list replaces
// the previous one whole.
export function stepsHtml(
  readings: Record<StepId, StepReading>,
  collapsed: readonly StepId[],
): string {
  return STEP_CONTENT.map((step) => {
    const { met, value } = readings[step.id];
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
    // and that is the shape rather than an accident: a closed section keeps every
    // way forward and hides only the explanation, because a reader who has
    // understood a step still wants to act on it without reading it again.
    //
    // THE VALUE SITS AT TWO POSITIONS AND EACH IS CHOSEN FOR THE STATE IT IS
    // READ IN. Inside the explanation it is last, immediately above the ways
    // forward, so it is the final thing read before pressing one of them rather
    // than something lost above a wall of guidance. Outside it — between the
    // explanation and the ways forward — it falls directly under the heading
    // whenever the explanation is folded away, which is where a reader who has
    // put the guidance away is looking. The copy for the folded state sits after
    // the explanation rather than before it because the stylesheet has to reach
    // it from the explanation's own state, and a stylesheet reads forwards.
    return `<section class="step ${met ? 'step-met' : 'step-unmet'}" data-step="${escapeHtml(step.id)}">
  <h2 class="step-head">
    <span class="step-mark" aria-hidden="true">${met ? '&check;' : '&#9675;'}</span>
    <span class="step-title">${escapeHtml(step.title)}</span>
    <span class="step-standing">${escapeHtml(met ? MET_LABEL : UNMET_LABEL)}</span>
    <button class="step-toggle" type="button" aria-expanded="${open}" aria-controls="${proseId}" aria-label="${escapeHtml(toggleLabel(step.title))}" data-toggle="${escapeHtml(step.id)}"></button>
  </h2>
  <div class="step-prose" id="${proseId}"${open ? '' : ' hidden'}>
    <p class="step-summary">${inlineHtml(step.summary)}</p>
    <div class="step-detail">${step.detail.map(detailHtml).join('')}</div>
    ${stepValueHtml(value, 'open')}
  </div>
  ${stepValueHtml(value, 'folded')}
  <div class="step-actions">${controls}</div>
</section>`;
  }).join('\n');
}

// PANEL_SETTING_CONTROL_ID addresses the tick at the foot so its words can be
// bound to it.
//
// 🔴 THE ACCESSIBLE NAME COMES FROM THAT BINDING AND FROM NOTHING ELSE. A label
// bound to the control names it for every reader at once and makes the words
// themselves a place to press. A name declared on the control instead would be a
// second copy of the same words, and the copy is the one left behind when the
// words move — so the words have one home and the binding is what carries them.
const PANEL_SETTING_CONTROL_ID = 'welcome-on-startup';

// dismissHtml composes the control at the foot that decides whether the panel
// opens with the editor.
//
// IT SITS OUTSIDE THE STEP LIST, and that placement is the whole reason it can
// exist at all: the steps are the conditions and nothing else, so a control
// belonging to none of them has nowhere to sit AMONG them — but the foot of the
// page is not among them. It is drawn as its own region so that one control
// governs one decision, and so the region can be re-composed on its own when
// the preference moves without the step list being re-drawn around it.
//
// 🔴 IT IS A TICK RATHER THAN A BUTTON, SO THE STATE IS SHOWN AND NOT INFERRED.
// The words name the preference and stay put; what the standing decides is
// whether the box is ticked, and which command a press runs. The tick and the
// command are read from the same preference in the same breath, so the control
// cannot report one state and move the other.
//
// The ticked state is an attribute rather than a class of its own, because that
// attribute is where a screen reader reads the state from — a class would be a
// second record of one fact, wrong for one reader whenever the two came apart.
export function dismissHtml(opensWithEditor: boolean): string {
  const ticked = opensWithEditor ? ' checked' : '';
  return `<input class="dismiss-checkbox" type="checkbox" id="${PANEL_SETTING_CONTROL_ID}"${ticked} data-command="${escapeHtml(panelSettingCommand(opensWithEditor))}"><label class="dismiss-label" for="${PANEL_SETTING_CONTROL_ID}">${escapeHtml(PANEL_SETTING_LABEL)}</label>`;
}

// VersionStandings is what the page reports about the two pieces of software a
// reader is actually running.
//
// 🔴 NEITHER FIELD HAS A DEFAULT AND NEITHER IS HELD IN THE SOURCE. Both are
// readings taken at the moment the page is composed — one from the build stamp the
// running copy of the extension carries, the other from asking the compiler that
// is running. A constant would be a second copy of a value that moves with every
// build, tied to nothing that moves it, and a copy that is wrong is worse than a
// reading that is absent.
//
// `null` means the reading was not obtained, which is a different statement from
// any particular version and is drawn as one.
export interface VersionStandings {
  extension: string | null;
  compiler: string | null;
}

// EXTENSION_VERSION_LABEL and COMPILER_VERSION_LABEL name the two readings.
//
// Each label is a word the page already uses for the thing it names, so a reader
// meets no new vocabulary at the foot of a page they came to for an
// introduction.
export const EXTENSION_VERSION_LABEL = l10n.t('Extension');
export const COMPILER_VERSION_LABEL = l10n.t('Compiler');

// versionValueHtml draws the value of one version reading: the value as it was
// read, or the words for a reading not obtained, marked as absent. An empty value
// names no build, so it is drawn as the absence it is.
//
// It is the one place a version's value is drawn, so the readings at the foot and
// the language server's line say "not reported" in the same words and the same
// mark.
function versionValueHtml(value: string | null): string {
  const known = versionKnown(value);
  const valueClass = known ? 'version-value' : 'version-value version-value-absent';
  return `<span class="${valueClass}">${escapeHtml(known ? value : VERSION_ABSENT)}</span>`;
}

// versionsHtml composes the region reporting both versions.
//
// Each reading is drawn as its label and its value, and a missing reading keeps
// its label: a row that vanished would leave a reader unable to tell a version
// they failed to notice from one the page never had.
export function versionsHtml(versions: VersionStandings): string {
  const entry = (label: string, value: string | null): string =>
    `<span class="version-entry">${escapeHtml(label)} ${versionValueHtml(value)}</span>`;
  return entry(EXTENSION_VERSION_LABEL, versions.extension)
    + entry(COMPILER_VERSION_LABEL, versions.compiler);
}

// ServerReading is what the page's last line is drawn from: what the language
// server's lifecycle reads as, and the version the running server reported
// about itself in its answer when the extension connected to it.
//
// version is null where the server reported none. It is drawn only while the
// server runs, because it describes a running process and a server that is not
// running has no version to report.
export interface ServerReading {
  reading: DaemonReading;
  version: string | null;
}

// SERVER_LABEL names the language server on the page's last line, the way the
// rest of the extension names it.
export const SERVER_LABEL = l10n.t('Language server');

// serverHtml composes the page's last line: whether the language server is
// running, in the words the rest of the extension uses for its states, and,
// while it runs, the version it reports about itself.
//
// 🔴 THE VERSION IS WHAT THE RUNNING SERVER SAID ABOUT ITSELF, NEVER WHAT THE
// BINARY SAYS. The server names its own build in its answer when the extension
// connects, and that is the value drawn here. The Compiler reading above is a
// different fact — what the binary the server was started from says when asked —
// and the two genuinely differ when that file is replaced in place while the
// process started from it runs on, so each is shown as what it is and neither
// stands in for the other. A server whose answer carries no version is drawn in
// the absent reading's own words rather than borrowing the binary's, so a reader
// meets one phrase for "not reported" wherever the page uses it.
//
// No failure reason is drawn. The output channel carries it, as does the
// notification a failed first start or restart raises, and the page is not
// where a diagnosis belongs.
export function serverHtml(server: ServerReading): string {
  const version = server.reading === 'running' ? `, ${versionValueHtml(server.version)}` : '';
  return `<span class="version-entry">${escapeHtml(SERVER_LABEL)} ${escapeHtml(DAEMON_READING_WORDS[server.reading])}${version}</span>`;
}

// WelcomeDocumentOptions carries the addresses the editor resolves for a panel's
// own resources. They are plain strings so this module keeps no editor types,
// and the caller passes what the webview gave it.
export interface WelcomeDocumentOptions {
  nonce: string;
  styleUri: string;
  scriptUri: string;
  cspSource: string;
  readings: Record<StepId, StepReading>;
  // collapsed names the sections the panel opens closed, which for a panel
  // being created is what the readings taken at that moment decide. It is
  // carried separately from the readings above for the reason stepsHtml
  // states, and the two must not be collapsed into one value.
  collapsed: readonly StepId[];
  // opensWithEditor is the preference as it stands, which is what the foot
  // control is composed from. It is passed in rather than read here because
  // this module holds no editor types, and it is a live reading rather than a
  // remembered one for the reason dismissHtml states.
  opensWithEditor: boolean;
  // versions is what the two pieces of software report about themselves, read
  // afresh by the caller for the same reason the standings are.
  versions: VersionStandings;
  // server is what the language server's lifecycle reads as at the moment of
  // composing, and the version the running server reported, for the page's
  // last line.
  server: ServerReading;
  // document is the language the panel's words are in and the direction it reads
  // in. Absent, the document declares English, left to right.
  document?: l10n.DocumentLanguage;
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
//
// The versions and the language server's line sit last, below the foot control,
// because they are context rather than anything to act on — and because the two
// things above them are what the page is for. They are on this page rather than
// behind a control of their own: one affordance already brings a reader here,
// and a second one whose whole answer is a few short strings would be a surface
// to learn for something that fits on the one they are already looking at. The
// server's line is the very last, and a region of its own, because it moves on
// the language server's lifecycle and nothing else.
export function welcomeDocumentHtml(opts: WelcomeDocumentOptions): string {
  const { lang, dir } = opts.document ?? { lang: 'en', dir: 'ltr' };
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource}`,
    `style-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">
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
    <div id="steps" class="steps">${stepsHtml(opts.readings, opts.collapsed)}</div>
    <div id="dismiss" class="welcome-dismiss">${dismissHtml(opts.opensWithEditor)}</div>
    <p id="versions" class="welcome-versions">${versionsHtml(opts.versions)}</p>
    <p id="server" class="welcome-versions welcome-server">${serverHtml(opts.server)}</p>
  </main>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
