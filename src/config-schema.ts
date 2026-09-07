// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The configuration surface is GENERATED from the configuration schema, and this
// module is the whole of that generation. It holds no list of settings, no
// labels, no descriptions, no defaults and no bounds: every one of those is read
// out of the schema the compiler answered with, so a setting added to the schema
// appears on the surface with nothing edited here.
//
// THAT IS THE POINT OF THIS FILE, and it is a single-sourcing requirement rather
// than a convenience. A hand-written settings list would agree with the schema on
// the day it was written and disagree silently afterwards — the symptom being a
// setting the compiler honours that the surface never offers, which nothing
// reports. So the only knowledge encoded here is how a JSON Schema declaration
// maps onto a control, which is a property of the schema language and not of any
// particular setting.
//
// It holds no editor type, so the whole derivation is assertable without an
// extension host.

// ControlKind is the shape of control a schema declaration calls for.
//
// It is derived from the declaration and never from the setting's name: the
// compiler is blind to what a setting means, and so is this. A declaration whose
// shape none of these covers is reported as Unsupported rather than guessed at,
// because drawing a text box for a shape that is not text would invite a value
// the schema refuses.
export type ControlKind =
  | 'toggle'
  | 'number'
  | 'choice'
  | 'text'
  | 'text-list'
  | 'collection'
  | 'map'
  | 'unsupported';

// ConfigControl is one settable declaration, with everything needed to draw it
// and everything needed to refuse a value the schema would.
//
// path is the structural path from the document root, spelled as its segments —
// the same breadcrumb vocabulary the compiler's position-reporting surfaces take,
// so a path composed here addresses a document in the language the compiler
// already speaks. A collection's item fields carry the collection's own path
// followed by the item marker, because an entry's position is not known until
// there is an entry.
export interface ConfigControl {
  path: string[];
  label: string;
  description: string;
  kind: ControlKind;
  // hasDefault distinguishes "the schema declares no default" from "the schema
  // declares a default that happens to be false, zero or empty". Reading
  // defaultValue alone cannot tell those apart, and the difference is what a
  // reader is being shown when a setting has no provenance.
  hasDefault: boolean;
  defaultValue?: unknown;
  choices?: string[];
  minimum?: number;
  maximum?: number;
  // itemFields describes one entry of a collection, so a reader sees what an
  // entry is made of. It is empty for every other kind.
  itemFields?: ConfigControl[];
}

// ConfigSection is a declaration that carries properties of its own: it groups
// rather than holds a value.
export interface ConfigSection {
  path: string[];
  label: string;
  description: string;
  controls: ConfigControl[];
  sections: ConfigSection[];
}

// ConfigSurface is the whole generated surface: the settings declared at the
// document root, and the groups beneath it.
export interface ConfigSurface {
  controls: ConfigControl[];
  sections: ConfigSection[];
}

// The subset of JSON Schema this reads. It is deliberately partial — the reader
// is a schema the compiler authored, not an arbitrary one — and every keyword
// named here is one the configuration schema actually uses.
interface SchemaNode {
  $ref?: string;
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: boolean | SchemaNode;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  $defs?: Record<string, SchemaNode>;
}

// ITEM_MARKER stands in a path for "one entry of this collection", where the
// entry's own index is not decided until an entry exists. It is spelled as a
// marker rather than as an index so a path carrying one is recognisably not yet
// addressable, instead of silently addressing entry zero.
export const ITEM_MARKER = '[]';

// MAP_KEY_MARKER stands in a path for "one entry of this keyed collection",
// whose key the reader supplies.
export const MAP_KEY_MARKER = '<key>';

// configSurface derives the whole surface from a configuration schema document.
//
// The schema arrives as an unknown because it comes off the wire. A document this
// cannot read yields an empty surface rather than a partial one: half a
// configuration surface is worse than none, because a reader cannot tell which
// half is missing.
export function configSurface(schema: unknown): ConfigSurface {
  const root = asNode(schema);
  if (!root || !root.properties) { return { controls: [], sections: [] }; }
  const defs = root.$defs ?? {};
  return walk(root, [], defs);
}

// walk turns one node's properties into controls and sections.
//
// A declaration carrying properties of its own becomes a section and is
// descended into; everything else becomes a control. The test is the declaration's
// own structure, so a group added to the schema nests here without this function
// learning its name.
function walk(node: SchemaNode, path: string[], defs: Record<string, SchemaNode>): ConfigSurface {
  const controls: ConfigControl[] = [];
  const sections: ConfigSection[] = [];

  for (const [name, declared] of Object.entries(node.properties ?? {})) {
    const resolved = deref(declared, defs);
    const here = [...path, name];
    // The description is read from the declaration first and the referenced
    // definition second. A declaration that references a shared definition may
    // describe what this particular use of it means, and that sentence is more
    // specific than the definition's own — so where both exist the local one is
    // what a reader is shown.
    const description = text(declared.description) ?? text(resolved.description) ?? '';

    if (resolved.properties) {
      const nested = walk(resolved, here, defs);
      sections.push({
        path: here,
        label: labelFor(name),
        description,
        controls: nested.controls,
        sections: nested.sections,
      });
      continue;
    }
    controls.push(control(here, name, description, declared, resolved, defs));
  }

  return { controls, sections };
}

// control derives one control from a declaration.
function control(
  path: string[],
  name: string,
  description: string,
  declared: SchemaNode,
  resolved: SchemaNode,
  defs: Record<string, SchemaNode>,
): ConfigControl {
  const kind = kindOf(resolved, defs);
  // A default declared on the local use of a shared definition overrides the
  // definition's own, for the same reason a local description does.
  const hasDefault = 'default' in declared || 'default' in resolved;
  const base: ConfigControl = {
    path,
    label: labelFor(name),
    description,
    kind,
    hasDefault,
  };
  if (hasDefault) {
    base.defaultValue = 'default' in declared ? declared.default : resolved.default;
  }
  if (kind === 'choice') {
    base.choices = (resolved.enum ?? []).map((v) => String(v));
  }
  if (kind === 'number') {
    if (typeof resolved.minimum === 'number') { base.minimum = resolved.minimum; }
    if (typeof resolved.maximum === 'number') { base.maximum = resolved.maximum; }
  }
  if (kind === 'collection') {
    const item = deref(resolved.items ?? {}, defs);
    base.itemFields = entryFields(item, [...path, ITEM_MARKER], defs);
  }
  if (kind === 'map') {
    const entry = typeof resolved.additionalProperties === 'object'
      ? deref(resolved.additionalProperties, defs)
      : {};
    base.itemFields = entryFields(entry, [...path, MAP_KEY_MARKER], defs);
  }
  return base;
}

// entryFields describes one entry of a collection as a flat list of its fields.
//
// An entry is one row, so a group inside it has no place to be drawn as a group —
// its members are shown instead, and NOTHING a schema declares disappears from
// the surface. Each field keeps its own full path, group segment included,
// because the path is where the field actually sits in the document: flattening
// the drawing must not flatten the address.
function entryFields(
  entry: SchemaNode,
  path: string[],
  defs: Record<string, SchemaNode>,
): ConfigControl[] {
  const walked = walk(entry, path, defs);
  return [...walked.controls, ...walked.sections.flatMap(flatten)];
}

// flatten yields every control a section holds, at any depth.
function flatten(section: ConfigSection): ConfigControl[] {
  return [
    ...section.controls,
    ...section.sections.flatMap(flatten),
  ];
}

// kindOf reads the control shape off a resolved declaration.
//
// An enumeration is a choice whatever its type, because the admissible values are
// the whole of what may be written. Order matters here: a string carrying an enum
// is a choice rather than a text box, and testing the enum first is what makes
// that so.
function kindOf(node: SchemaNode, defs: Record<string, SchemaNode>): ControlKind {
  if (Array.isArray(node.enum) && node.enum.length > 0) { return 'choice'; }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case 'boolean':
      return 'toggle';
    case 'integer':
    case 'number':
      return 'number';
    case 'string':
      return 'text';
    case 'array': {
      const item = deref(node.items ?? {}, defs);
      const itemType = Array.isArray(item.type) ? item.type[0] : item.type;
      if (itemType === 'string') { return 'text-list'; }
      if (item.properties) { return 'collection'; }
      return 'unsupported';
    }
    case 'object':
      // An object with no properties of its own is either a keyed collection or
      // an open bag of caller-defined keys. The first is drawable as entries; the
      // second is not something a generated control can offer, because the schema
      // says nothing about what belongs in it.
      if (typeof node.additionalProperties === 'object') { return 'map'; }
      return 'unsupported';
    default:
      return 'unsupported';
  }
}

// labelFor derives a control's label from the key the author types.
//
// It is DERIVED and never looked up, which is the whole reason this function
// exists rather than a table beside it: a table would have to gain a row for
// every setting added to the schema, and a setting whose row nobody added would
// draw with no label at all. Underscores are the schema's own word separator, so
// splitting on them and capitalising the first word yields the key back in prose
// without inventing a name for it.
export function labelFor(key: string): string {
  const words = key.split('_').filter((w) => w.length > 0);
  if (words.length === 0) { return key; }
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

// deref follows a reference into the schema's own definitions.
//
// A reference chain is followed to its end, and a cycle stops rather than
// recursing: a schema that referenced itself would otherwise take the surface
// down instead of drawing what it could.
function deref(node: SchemaNode, defs: Record<string, SchemaNode>): SchemaNode {
  let current = node;
  const seen = new Set<string>();
  while (current && typeof current.$ref === 'string') {
    const key = current.$ref.replace(/^#\/\$defs\//, '');
    if (seen.has(key)) { return current; }
    seen.add(key);
    const next = defs[key];
    if (!next) { return current; }
    current = next;
  }
  return current ?? {};
}

// asNode reads a schema document off the wire, or reports that it is not one.
function asNode(value: unknown): SchemaNode | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { return null; }
  return value as SchemaNode;
}

// text returns a non-empty string, or nothing.
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// everyControl yields every control on the surface, at any depth, including the
// fields of a collection's entry.
//
// It is the counterpart to the walk above: a caller that must reason about the
// whole surface — counting what is drawn, joining provenance onto it, checking
// that its own handling accounts for every shape — reads the set from here rather
// than re-walking the tree. A second walk is a second answer to the same
// question, and the two would agree until either was edited.
// The recursion through a control's own entry fields is what makes "at any
// depth" true rather than nearly true: the configuration schema carries a list
// of entries whose entries are themselves lists — the identities trusted on one
// registry — so a single step into an entry's fields would silently stop one
// level short of a real declaration. A count taken from a set with that hole
// reads as complete.
export function everyControl(surface: ConfigSurface): ConfigControl[] {
  const fromSections = (section: ConfigSection): ConfigControl[] => [
    ...section.controls,
    ...section.sections.flatMap(fromSections),
  ];
  const withEntries = (control: ConfigControl): ConfigControl[] => [
    control,
    ...(control.itemFields ?? []).flatMap(withEntries),
  ];
  const direct = [...surface.controls, ...surface.sections.flatMap(fromSections)];
  return direct.flatMap(withEntries);
}

// dottedPath spells a control's path the way the compiler's own configuration
// report spells a setting's name, so the two join without either side
// re-deriving the other's spelling.
export function dottedPath(path: string[]): string {
  return path.join('.');
}
