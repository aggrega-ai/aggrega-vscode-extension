// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// The surface a reader sees is the schema's declarations joined against what the
// compiler resolved: each setting drawn from the schema, carrying the value in
// force and the file that produced it where the compiler can say so.
//
// 🔴 THE COMPILER'S REPORT DOES NOT CARRY A ROW FOR EVERY SETTING. It accounts for
// a list's additive companion on the list's own row, which this module mirrors by
// folding the companion into that row; and a report that could not be read, or
// one that names a setting nowhere, leaves a control with nothing to attribute.
// Such a control is drawn as what it is — the declared default, and no claim
// about a source. A surface that implied a source it did not have would be worse
// than one admitting the gap, because a reader acting on an invented source would
// go looking in a file that never mentioned the setting.
//
// It holds no editor type, so the join is assertable without an extension host.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import {
  ConfigControl,
  ConfigSection,
  ConfigSurface,
  ControlKind,
  configSurface,
  distinctNames,
  dottedPath,
} from './config-schema';
import { ConfigScope, configScope } from './config-scope';

// DEFAULTS_SOURCE is the label the compiler attributes a setting to when no
// configuration file, environment variable or flag sets it at all. It is
// recognised so that "nothing set this" can be drawn as what it means rather
// than as a file path the reader would go looking for.
export const DEFAULTS_SOURCE = '(built-in defaults)';

// ENV_SOURCE_PREFIX marks an attribution to an environment variable rather than
// to a file, and carries the variable's own name after it.
export const ENV_SOURCE_PREFIX = 'env:';

// EffectiveSetting is one row of the compiler's configuration report.
export type EffectiveSetting = wire.EffectiveConfigurationSetting;

// EffectiveConfiguration is the compiler's configuration report: the layers that
// contributed, lowest precedence first, and every setting it attributes.
export type EffectiveConfiguration = wire.EffectiveConfigurationResult;

// Provenance is what the surface can honestly say about where a value came from.
//
// The three cases are distinguished because a reader acts on them differently. A
// file they can open; an environment variable they change outside the editor; and
// no attribution at all, which is not a file to look in but a statement that the
// compiler's report does not cover this setting.
export type Provenance =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'environment'; readonly variable: string }
  | { readonly kind: 'defaults' }
  | { readonly kind: 'unattributed' };

// ConfigRow is one drawn control: its declaration, the name it is drawn with, the
// settings folded into it, what is in force, where that came from, and how far a
// change to it would reach.
export interface ConfigRow {
  control: ConfigControl;
  // name is what the row calls the setting: derived from its key, with the key of
  // the group it sits in ahead of it where another row's would read the same.
  // It is decided over every row of the page at once, because whether a name
  // collides is a property of the page rather than of one setting.
  name: string;
  // companions are the settings that add to this one rather than having a row of
  // their own: a list's additive companion, whose entries the compiler's report
  // gives as part of this list's value and under this list's source. Empty for
  // every other row.
  companions: ConfigControl[];
  // value is the effective value the compiler reported, as it reported it. It is
  // absent for an unattributed setting, whose effective value the compiler does
  // not report — the declared default is what the surface has, and it is on the
  // control.
  value?: string;
  provenance: Provenance;
  scope: ConfigScope;
}

// ConfigSectionRows mirrors the schema's own grouping, with each control drawn.
export interface ConfigSectionRows {
  path: string[];
  label: string;
  description: string;
  rows: ConfigRow[];
  sections: ConfigSectionRows[];
}

// ConfigPanelModel is the whole surface, ready to draw.
//
// drawn and attributed are carried because the difference between them is
// something the reader is told rather than something the surface hides: where the
// two differ, the page names the settings the compiler's report leaves
// unattributed.
//
// drawn counts the ROWS on the page, which is deliberately not the same as the
// number of declarations the schema carries: a list of entries is one row naming
// the fields an entry has, because there is no entry yet to draw a field of, and
// a list's additive companion is named on its list's row rather than drawn as a
// row of its own.
export interface ConfigPanelModel {
  layers: string[];
  rows: ConfigRow[];
  sections: ConfigSectionRows[];
  drawn: number;
  attributed: number;
}

// configPanelModel joins a configuration schema against the compiler's report.
//
// The schema decides what is drawn and the report decides what can be said about
// it. A setting the report carries that the schema does not declare is NOT drawn:
// the schema is the statement of what configuration is, and a row with no
// declaration would have no label, no description and no bounds — so it would be
// a name and a value with nothing to tell the reader what either means.
//
// 🔴 A LIST'S ADDITIVE COMPANION IS FOLDED INTO THE LIST'S ROW, AS THE REPORT
// FOLDS IT. The report gives a list and its companion as one value under one
// source and carries no row for the companion, so a row of the companion's own
// could only say "not reported" and the declared default — untrue the moment a
// file sets it. The companion is named on its list's row instead, which is where
// the report states what it contributed.
export function configPanelModel(
  schema: unknown,
  effective: EffectiveConfiguration | null,
): ConfigPanelModel {
  const surface: ConfigSurface = configSurface(schema);
  const reported = new Map<string, EffectiveSetting>();
  for (const setting of effective?.settings ?? []) {
    if (typeof setting?.field === 'string') { reported.set(setting.field, setting); }
  }

  const rowFor = (control: ConfigControl, companions: ConfigControl[]): ConfigRow => {
    const setting = reported.get(dottedPath(control.path));
    return {
      control,
      name: control.label,
      companions,
      ...(setting ? { value: setting.value } : {}),
      provenance: provenanceOf(setting),
      scope: configScope(control),
    };
  };

  // rowsFor draws one group's own controls, each companion folded into its list.
  const rowsFor = (controls: ConfigControl[]): ConfigRow[] => {
    const folded = companionsAmong(controls, reported);
    const into = new Set([...folded.values()].flat());
    return controls.filter((c) => !into.has(c)).map((c) => rowFor(c, folded.get(c) ?? []));
  };

  const sectionFor = (section: ConfigSection): ConfigSectionRows => ({
    path: section.path,
    label: section.label,
    description: section.description,
    rows: rowsFor(section.controls),
    sections: section.sections.map(sectionFor),
  });

  const model: ConfigPanelModel = {
    layers: effective?.layers ?? [],
    rows: rowsFor(surface.controls),
    sections: surface.sections.map(sectionFor),
    drawn: 0,
    attributed: 0,
  };
  const all = everyRow(model);
  distinctNames(all.map((row) => row.control.path)).forEach((name, i) => { all[i].name = name; });
  model.drawn = all.length;
  model.attributed = all.filter((row) => reported.has(dottedPath(row.control.path))).length;
  return model;
}

// COMPANION_SUFFIX ends the key of a list's additive companion:
// `catalog_dirs_append` beside `catalog_dirs` adds entries to that list rather
// than replacing it.
//
// 🔴 THIS IS A RECORDED NEAR-DUPLICATE, AND IT IS FORCED RATHER THAN CHOSEN. The
// configuration schema carries no machine-readable statement that one setting
// adds to another, so the pairing cannot be read off a declaration; it is the
// configuration language's own naming convention, and the compiler's report
// applies that same convention when it folds a companion into its list. What
// keeps the restatement honest is the last condition in companionsAmong: a
// companion the report gives a row of its own is drawn on that row, so the fold
// can never hide an attribution the report makes.
const COMPANION_SUFFIX = '_append';

// LIST_KINDS are the shapes a list and its companion both take.
const LIST_KINDS: ReadonlySet<ControlKind> = new Set<ControlKind>(['text-list', 'collection', 'map']);

// companionsAmong pairs each list among one group's controls with the companions
// that add to it: a list whose key is another list's key followed by
// COMPANION_SUFFIX, in the same group, that the report carries no row for.
function companionsAmong(
  controls: ConfigControl[],
  reported: ReadonlyMap<string, EffectiveSetting>,
): Map<ConfigControl, ConfigControl[]> {
  const keyOf = (c: ConfigControl): string => c.path[c.path.length - 1];
  const byKey = new Map(controls.map((c) => [keyOf(c), c]));
  const folded = new Map<ConfigControl, ConfigControl[]>();
  for (const companion of controls) {
    const key = keyOf(companion);
    if (!key.endsWith(COMPANION_SUFFIX)) { continue; }
    const list = byKey.get(key.slice(0, -COMPANION_SUFFIX.length));
    if (list === undefined || !LIST_KINDS.has(list.kind) || !LIST_KINDS.has(companion.kind)) { continue; }
    if (reported.has(dottedPath(companion.path))) { continue; }
    folded.set(list, [...(folded.get(list) ?? []), companion]);
  }
  return folded;
}

// provenanceOf reads what the compiler said about one setting's origin.
//
// The three attributed spellings are the compiler's own, and they are recognised
// rather than reformatted: a file path is reported unchanged, an environment
// override carries its variable name behind a prefix, and the built-in defaults
// carry a label of their own. A setting the report does not mention is
// unattributed, which is the case the compiler's contract says will occur.
export function provenanceOf(setting: EffectiveSetting | undefined): Provenance {
  if (!setting || typeof setting.source !== 'string' || setting.source.length === 0) {
    return { kind: 'unattributed' };
  }
  if (setting.source === DEFAULTS_SOURCE) { return { kind: 'defaults' }; }
  if (setting.source.startsWith(ENV_SOURCE_PREFIX)) {
    return { kind: 'environment', variable: setting.source.slice(ENV_SOURCE_PREFIX.length) };
  }
  return { kind: 'file', path: setting.source };
}

// readEffectiveConfiguration reads the compiler's report off the wire.
//
// It arrives as an unknown because it comes from a request, and a response this
// cannot read yields null rather than a partly-populated report: the surface
// then draws every setting as unattributed, which is honest, instead of drawing
// some settings as attributed to whatever survived the read.
export function readEffectiveConfiguration(payload: unknown): EffectiveConfiguration | null {
  if (typeof payload !== 'object' || payload === null) { return null; }
  const named = payload as { layers?: unknown; settings?: unknown };
  if (!Array.isArray(named.settings)) { return null; }
  const settings: EffectiveSetting[] = [];
  for (const entry of named.settings) {
    if (typeof entry !== 'object' || entry === null) { continue; }
    const row = entry as { field?: unknown; value?: unknown; source?: unknown };
    if (typeof row.field !== 'string') { continue; }
    settings.push({
      field: row.field,
      value: typeof row.value === 'string' ? row.value : '',
      source: typeof row.source === 'string' ? row.source : '',
    });
  }
  const layers = Array.isArray(named.layers)
    ? named.layers.filter((l): l is string => typeof l === 'string')
    : [];
  return { layers, settings };
}

// describeProvenance renders a provenance as a sentence.
//
// The unattributed case names the gap in the reader's terms rather than leaving
// the cell blank: a blank reads as a surface that failed to fill it, and this is
// a surface reporting that the compiler's report does not cover this setting.
export function describeProvenance(provenance: Provenance): string {
  switch (provenance.kind) {
    case 'file':
      return provenance.path;
    case 'environment':
      return `the environment variable ${provenance.variable}`;
    case 'defaults':
      return 'the built-in default, unchanged by any file';
    default:
      return 'not reported — the configuration report does not cover this setting';
  }
}

// sourceLabel renders a provenance in the space one cell of a row gives it.
//
// It is a SECOND PRESENTATION of the same union rather than a second
// classification, and the distinction is what makes it acceptable: the four
// cases are decided once, in provenanceOf, and both this and describeProvenance
// render what that decided. Neither may add a case, drop one, or disagree about
// which is which — a shorter sentence is all that differs.
//
// The unattributed case says so in words here too. A blank cell in a column
// headed for the source reads as a surface that failed to fill it, where the
// fact is that the report does not reach this setting.
export function sourceLabel(provenance: Provenance): string {
  switch (provenance.kind) {
    case 'file':
      return provenance.path;
    case 'environment':
      return `environment: ${provenance.variable}`;
    case 'defaults':
      return 'built-in default';
    default:
      return 'not reported';
  }
}

// EffectiveValue is what actually applies to a setting now, with the standing of
// that answer carried alongside it rather than folded into a string.
//
// The three cases are held apart because the surface must not present the second
// as the first. A value the report carried is a reading the compiler took; a
// declared default is what the schema says the value falls back to, which the
// compiler never reported for this setting. Rendering them identically would
// assert a reading nobody made.
export type EffectiveValue =
  | { readonly kind: 'reported'; readonly value: string }
  | { readonly kind: 'declared-default'; readonly value: unknown }
  | { readonly kind: 'none' };

// effectiveValue decides what applies to a setting, for every presentation.
//
// This is the ONE home of that decision. Both the per-setting view and the table
// read it, so the two cannot come to disagree about whether a setting's shown
// value is a reading or a fallback — which is the disagreement that would matter,
// because only one of the two answers is something the compiler said.
export function effectiveValue(row: ConfigRow): EffectiveValue {
  if (row.value !== undefined) { return { kind: 'reported', value: row.value }; }
  if (row.control.hasDefault) { return { kind: 'declared-default', value: row.control.defaultValue }; }
  return { kind: 'none' };
}

// ValueMark is why a value in force is marked as other than the declared
// default: a file or the environment set it, or the report gives a value the
// schema does not declare as the default.
export type ValueMark = 'file' | 'environment' | 'not-the-default';

// valueMark decides whether a value in force is marked, and why, for every
// presentation that marks one.
//
// 🔴 A BUILT-IN DEFAULT IS NOT SOMETHING THE READER SET, so a setting the report
// attributes to the defaults is marked only where the value it reports is not the
// one the schema declares, and an unattributed one never is: its value is drawn as
// the declaration it is, which needs no mark. The absence of a mark is the
// information — it says this setting is untouched — and marking every setting
// would leave a reader unable to find the ones they had actually changed.
export function valueMark(row: ConfigRow): ValueMark | null {
  if (row.value === undefined) { return null; }
  const kind = row.provenance.kind;
  if (kind === 'file' || kind === 'environment') { return kind; }
  return row.control.hasDefault && !reportedAsDeclared(row.value, row.control.defaultValue)
    ? 'not-the-default'
    : null;
}

// reportedAsDeclared reports whether a value as the report spells it is the
// default the schema declares.
//
// The two notations are compared only where they agree: a text, a number or a
// toggle is spelled alike in both, and an empty list is `[]` in both. Any other
// declared default has no spelling this can hold the report's against, so it is
// taken as matching — a mark this cannot justify is a claim the page would be
// making on nobody's word.
function reportedAsDeclared(value: string, declared: unknown): boolean {
  if (typeof declared === 'string' || typeof declared === 'number' || typeof declared === 'boolean') {
    return value === String(declared);
  }
  if (Array.isArray(declared) && declared.length === 0) { return value === '[]'; }
  return true;
}

// everyRow yields every drawn row, at every group depth.
//
// It is the row set a presentation draws, and it is deliberately the MODEL's own
// rows rather than a re-walk of the schema's controls. The two are different
// sets — a list of entries is one row naming the fields an entry has, and a
// list's companion is named on its list's row — and the coverage sentence names
// the model's rows the report leaves unattributed. A presentation drawing the
// other set would make that sentence false of itself while leaving it true of the
// other, so both read from here, in this order.
export function everyRow(model: ConfigPanelModel): ConfigRow[] {
  const fromSection = (section: ConfigSectionRows): ConfigRow[] => [
    ...section.rows,
    ...section.sections.flatMap(fromSection),
  ];
  return [...model.rows, ...model.sections.flatMap(fromSection)];
}
