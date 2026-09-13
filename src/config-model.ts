// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The surface a reader sees is the schema's declarations joined against what the
// compiler resolved: each setting drawn from the schema, carrying the value in
// force and the file that produced it where the compiler can say so.
//
// 🔴 THE COMPILER'S ATTRIBUTION IS NARROWER THAN THE SCHEMA, AND IT SAYS SO AS A
// CONTRACT: a setting can be real, documented and carry a default while appearing
// nowhere in the attribution. So a control with nothing to attribute is the
// ORDINARY case here, not a fault, and this module draws it as what it is — the
// declared default, and no claim about a source. A surface that implied a source
// it did not have would be worse than one admitting the gap, because a reader
// acting on an invented source would go looking in a file that never mentioned
// the setting.
//
// It holds no editor type, so the join is assertable without an extension host.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import {
  ConfigControl,
  ConfigSection,
  ConfigSurface,
  configSurface,
  dottedPath,
} from './config-schema';
import { ConfigScope, configScope } from './config-scope';

// DEFAULTS_SOURCE is the label the compiler attributes a setting to when no
// configuration file and no environment override moved it off its built-in
// value. It is recognised so that "nothing changed this" can be drawn as what it
// means rather than as a file path the reader would go looking for.
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

// ConfigRow is one drawn control: its declaration, what is in force, where that
// came from, and how far a change to it would reach.
export interface ConfigRow {
  control: ConfigControl;
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
// something the reader is told rather than something the surface hides: it is the
// measure of how much of the configuration the compiler's report covers.
//
// drawn counts the ROWS on the page, which is deliberately not the same as the
// number of declarations the schema carries: a list of entries is one row naming
// the fields an entry has, because there is no entry yet to draw a field of. The
// count is named for what it counts, so the sentence composed from it says
// something the reader can check against what is in front of them rather than
// something they would have to walk the schema to verify.
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
export function configPanelModel(
  schema: unknown,
  effective: EffectiveConfiguration | null,
): ConfigPanelModel {
  const surface: ConfigSurface = configSurface(schema);
  const reported = new Map<string, EffectiveSetting>();
  for (const setting of effective?.settings ?? []) {
    if (typeof setting?.field === 'string') { reported.set(setting.field, setting); }
  }

  let drawn = 0;
  let attributed = 0;

  const rowFor = (control: ConfigControl): ConfigRow => {
    drawn += 1;
    const setting = reported.get(dottedPath(control.path));
    if (setting) { attributed += 1; }
    return {
      control,
      ...(setting ? { value: setting.value } : {}),
      provenance: provenanceOf(setting),
      scope: configScope(control),
    };
  };

  const sectionFor = (section: ConfigSection): ConfigSectionRows => ({
    path: section.path,
    label: section.label,
    description: section.description,
    rows: section.controls.map(rowFor),
    sections: section.sections.map(sectionFor),
  });

  const rows = surface.controls.map(rowFor);
  const sections = surface.sections.map(sectionFor);

  return {
    layers: effective?.layers ?? [],
    rows,
    sections,
    drawn,
    attributed,
  };
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

// setValue is the value a reader themselves put in force, or nothing.
//
// 🔴 A BUILT-IN DEFAULT IS NOT SOMETHING THE READER SET, so a setting the report
// attributes to the defaults yields nothing here, exactly as an unattributed one
// does. The emptiness is the information: it says this setting is untouched.
// Filling it with the default would make every setting look configured and leave
// a reader unable to find the ones they had actually changed.
export function setValue(row: ConfigRow): string | undefined {
  if (row.value === undefined) { return undefined; }
  const kind = row.provenance.kind;
  if (kind === 'file' || kind === 'environment') { return row.value; }
  return undefined;
}

// everyRow yields every drawn row, at every group depth.
//
// It is the row set a presentation draws, and it is deliberately the MODEL's own
// rows rather than a re-walk of the schema's controls. The two are different
// sets — a list of entries is one row naming the fields an entry has, because
// there is no entry yet to draw a field of — and the coverage sentence is
// composed from the model's count. A presentation drawing the other set would
// make that sentence false of itself while leaving it true of the other, so both
// read from here.
export function everyRow(model: ConfigPanelModel): ConfigRow[] {
  const fromSection = (section: ConfigSectionRows): ConfigRow[] => [
    ...section.rows,
    ...section.sections.flatMap(fromSection),
  ];
  return [...model.rows, ...model.sections.flatMap(fromSection)];
}
