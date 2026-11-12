// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import {
  ConfigControl,
  ConfigSection,
  ITEM_MARKER,
  configSurface,
  distinctNames,
  dottedPath,
  everyControl,
  labelFor,
} from '../../src/config-schema';

// The fixtures here are SYNTHETIC and that is deliberate twice over.
//
// The subject of these assertions is the generator, not any one schema: what has
// to hold is that a declaration of a given shape produces a control of a given
// shape, and a fixture written here exercises that directly. Reading the real
// configuration schema instead would make every assertion depend on a sibling
// checkout being present, and would put a second copy of that schema's content
// in the assertions the moment any of them named a real setting.
//
// The fixtures therefore carry the SHAPES the real schema uses — a reference into
// definitions, a group nested three deep, a list of objects, an enumeration, a
// bounded integer — and nothing about what any particular setting means.

// A fixture exercising every shape the generator reads, laid out so that each
// assertion below can name the path it is about.
const FIXTURE = {
  type: 'object',
  properties: {
    a_scalar: { type: 'string', description: 'a string setting', default: 'x' },
    a_flag: { type: 'boolean', description: 'a boolean setting', default: false },
    a_count: {
      type: 'integer',
      description: 'a bounded integer setting',
      default: 4,
      minimum: 2,
      maximum: 9,
    },
    a_choice: {
      type: 'string',
      description: 'an enumerated setting',
      enum: ['first', 'second', 'third'],
    },
    a_text_list: {
      type: 'array',
      items: { type: 'string' },
      description: 'a list of text entries',
      default: [],
    },
    a_group: {
      type: 'object',
      description: 'a group of settings',
      properties: {
        inner_flag: { type: 'boolean', description: 'a setting inside a group', default: true },
        deeper_group: {
          type: 'object',
          description: 'a group inside a group',
          properties: {
            deepest_value: { type: 'integer', description: 'a setting three deep', default: 1 },
          },
        },
      },
    },
    a_collection: {
      type: 'array',
      description: 'a list of entries',
      items: { $ref: '#/$defs/Entry' },
      default: [],
    },
  },
  $defs: {
    Entry: {
      type: 'object',
      properties: {
        entry_name: { type: 'string', description: 'a field of an entry' },
        entry_nested: {
          type: 'object',
          description: 'a group inside an entry',
          properties: {
            entry_deep: { type: 'boolean', description: 'a field inside an entry group' },
          },
        },
      },
    },
  },
};

// expectedLabel derives a label from a key INDEPENDENTLY of the source.
//
// 🔴 THE INDEPENDENCE IS THE WHOLE VALUE OF THIS FUNCTION, and it is a deliberate
// near-duplicate of the source's own derivation. An assertion that compared the
// surface's labels against the source's `labelFor` would share the derivation
// with the thing it is checking, and would therefore accept a hand-written label
// planted inside that derivation — measured: such a plant passed a comparison
// written that way. Comparing against a second, independently written derivation
// is what makes the assertion capable of failing.
//
// It is deliberately NOT exported and deliberately NOT unified with the source's
// version: unifying them would restore exactly the blindness above. The words it
// spells otherwise than the key writes them are written out here too, apart from
// the source's own spellings, for the same reason.
const SPELLED: Record<string, string> = {
  ai: 'AI', cli: 'CLI', id: 'ID', jwks: 'JWKS', mcp: 'MCP', tls: 'TLS', url: 'URL', yaml: 'YAML',
};

function expectedLabel(key: string): string {
  const words = key.split('_').filter((w) => w.length > 0);
  if (words.length === 0) { return key; }
  let name = '';
  words.forEach((word, i) => {
    const spelled = Object.hasOwn(SPELLED, word) ? SPELLED[word] : word;
    const shown = i === 0 ? spelled.charAt(0).toUpperCase() + spelled.slice(1) : spelled;
    // `x` is a prefix: the word after it joins it with a hyphen.
    name = i === 0 ? shown : words[i - 1] === 'x' ? `${name}-${shown}` : `${name} ${shown}`;
  });
  return name;
}

// paths spells every control on a surface, so an assertion can name what it
// expects to be there without walking the tree itself.
function paths(schema: unknown): string[] {
  return everyControl(configSurface(schema)).map((c) => dottedPath(c.path));
}

// controlAt finds one control by its dotted path, and fails naming what it did
// find — a bare undefined tells whoever reads the failure nothing about whether
// the path moved or the walk stopped early.
function controlAt(schema: unknown, wanted: string): ConfigControl {
  const all = everyControl(configSurface(schema));
  const found = all.find((c) => dottedPath(c.path) === wanted);
  assert.ok(
    found,
    `no control at ${wanted}; the surface carries ${all.map((c) => dottedPath(c.path)).join(', ')}`,
  );
  return found;
}

describe('the configuration surface generated from a schema', () => {
  it('walks the schema transitively, through groups, references and list items', () => {
    const drawn = paths(FIXTURE);

    // Each of these is a needle for one traversal step, and each would be
    // absent if the walk stopped at the surface it names.
    assert.ok(drawn.includes('a_scalar'), 'a top-level declaration is not drawn');
    assert.ok(drawn.includes('a_group.inner_flag'), 'a declaration inside a group is not drawn');
    assert.ok(
      drawn.includes('a_group.deeper_group.deepest_value'),
      'a declaration three levels deep is not drawn, so the walk is not transitive',
    );
    assert.ok(
      drawn.includes(`a_collection.${ITEM_MARKER}.entry_name`),
      'a field of a list entry is not drawn, so the walk does not follow items',
    );
    // A group inside a list entry is drawn as its members rather than as a
    // group — an entry is one row — but each member keeps its own full path,
    // group segment included, because that is where the field actually sits.
    assert.ok(
      drawn.includes(`a_collection.${ITEM_MARKER}.entry_nested.entry_deep`),
      'a field inside a group inside a list entry is not drawn',
    );
  });

  it('reaches the fields of a list nested inside another list\'s entry', () => {
    // 🔴 The configuration schema carries exactly this shape — the identities
    // trusted on one registry are a list inside a registry entry, which is
    // itself an entry of a list — so a walk that stepped once into an entry's
    // fields would stop one level short of real declarations. It would do so
    // silently: the set it returned would look complete.
    const nested = {
      type: 'object',
      properties: {
        outer_list: {
          type: 'array',
          description: 'a list of entries',
          items: {
            type: 'object',
            properties: {
              inner_list: {
                type: 'array',
                description: 'a list inside an entry',
                items: {
                  type: 'object',
                  properties: {
                    innermost: { type: 'string', description: 'a field two lists deep' },
                  },
                },
              },
            },
          },
        },
      },
    };
    assert.ok(
      paths(nested).includes(`outer_list.${ITEM_MARKER}.inner_list.${ITEM_MARKER}.innermost`),
      `a field two lists deep is not reached; the surface carries ${paths(nested).join(', ')}`,
    );
  });

  it('follows a reference into the schema\'s own definitions', () => {
    // The entry shape reaches the surface only through the reference: the
    // declaration itself carries no properties at all.
    const entry = controlAt(FIXTURE, `a_collection.${ITEM_MARKER}.entry_name`);
    assert.strictEqual(entry.description, 'a field of an entry');
  });

  it('reads the control shape off the declaration', () => {
    assert.strictEqual(controlAt(FIXTURE, 'a_scalar').kind, 'text');
    assert.strictEqual(controlAt(FIXTURE, 'a_flag').kind, 'toggle');
    assert.strictEqual(controlAt(FIXTURE, 'a_count').kind, 'number');
    assert.strictEqual(controlAt(FIXTURE, 'a_text_list').kind, 'text-list');
    assert.strictEqual(controlAt(FIXTURE, 'a_collection').kind, 'collection');
    // An enumerated string is a choice rather than a text box: the admissible
    // values are the whole of what may be written, so offering free text would
    // invite a value the schema refuses.
    assert.strictEqual(controlAt(FIXTURE, 'a_choice').kind, 'choice');
  });

  it('carries the bounds and the admissible values the schema declares', () => {
    const count = controlAt(FIXTURE, 'a_count');
    assert.strictEqual(count.minimum, 2);
    assert.strictEqual(count.maximum, 9);
    assert.deepStrictEqual(controlAt(FIXTURE, 'a_choice').choices, ['first', 'second', 'third']);
  });

  it('separates a declared default from an absent one', () => {
    // The distinction is not readable from the value: a default of false and no
    // default at all both arrive as a falsy value, and the surface says
    // different things about them.
    const flag = controlAt(FIXTURE, 'a_flag');
    assert.strictEqual(flag.hasDefault, true);
    assert.strictEqual(flag.defaultValue, false);
    assert.strictEqual(controlAt(FIXTURE, 'a_choice').hasDefault, false);
  });

  // 🔴 THIS IS THE ASSERTION PROTECTING THE SINGLE SOURCING.
  //
  // Every label on the surface must be derivable from the key the author types,
  // and every description must be the sentence the schema carries. A label or a
  // description written by hand anywhere in the generator would be a second copy
  // of what the schema states — which is what this refuses.
  //
  // The comparison is against this file's OWN derivation, never the source's, so
  // a hand-written label planted inside the source's derivation cannot hide
  // behind being on both sides of the comparison.
  it('takes every label and every description from the schema, never from itself', () => {
    const surface = configSurface(FIXTURE);
    const check = (path: string[], label: string, description: string): void => {
      const key = path[path.length - 1];
      assert.strictEqual(
        label,
        expectedLabel(key),
        `the label at ${dottedPath(path)} is not derived from its key`,
      );
      assert.ok(
        description.length > 0,
        `the declaration at ${dottedPath(path)} is drawn with no description`,
      );
    };
    const walkSections = (section: ConfigSection): void => {
      check(section.path, section.label, section.description);
      section.controls.forEach((c) => check(c.path, c.label, c.description));
      section.sections.forEach(walkSections);
    };
    surface.controls.forEach((c) => check(c.path, c.label, c.description));
    surface.sections.forEach(walkSections);
    for (const control of everyControl(surface)) {
      check(control.path, control.label, control.description);
    }
  });

  it('holds the derivation itself to a key-by-key comparison, so no key can be special-cased', () => {
    // The assertion above walks a fixture, so it reaches only the keys that
    // fixture declares. This one holds the derivation directly, over the key
    // SHAPES the real schema uses, against a derivation written independently
    // here — so a per-key exception added to the source is refused wherever it
    // was added rather than only where a fixture happens to look.
    const keys = [
      'offline', 'auto_pull', 'default_registry', 'parse_cache', 'max_bytes',
      'allow_dynamic_refs', 'skip_signature_verification', 'a_flag', 'host',
      'trusted_identities', 'compiled_module_cache', 'halt_on_deprecated_severity',
      'yaml_indent', 'cli', 'jwks_file', 'fulcio_url', 'allow_aggrega_ai_prefix',
      'allow_direct_x_aggrega_extensions', 'allow_id_overrides', 'mcp', 'tls', 'x_first',
      '', 'x', 'a__b',
    ];
    for (const key of keys) {
      assert.strictEqual(
        labelFor(key),
        expectedLabel(key),
        `the label for ${JSON.stringify(key)} is not what deriving it from the key gives`,
      );
    }
  });

  it('derives a label from the key rather than looking one up', () => {
    // The derivation is the whole reason no table of labels exists, so it is
    // asserted on the shapes the schema's keys actually take.
    assert.strictEqual(labelFor('offline'), 'Offline');
    assert.strictEqual(labelFor('parse_cache'), 'Parse cache');
    assert.strictEqual(labelFor('allow_dynamic_refs'), 'Allow dynamic refs');
    // A key it cannot split comes back unchanged rather than blank: a control
    // with no label at all is worse than one labelled with its own key.
    assert.strictEqual(labelFor(''), '');
  });

  it('spells an acronym in capitals and joins a prefix to the word after it, by the word and never by the setting', () => {
    // Each written out here, so a spelling dropped from the source or added for
    // one setting alone is refused rather than followed.
    const spelled: [string, string][] = [
      ['yaml_indent', 'YAML indent'],
      ['cli', 'CLI'],
      ['jwks_file', 'JWKS file'],
      ['fulcio_url', 'Fulcio URL'],
      ['allow_aggrega_ai_prefix', 'Allow aggrega AI prefix'],
      ['allow_direct_x_aggrega_extensions', 'Allow direct x-aggrega extensions'],
      ['allow_id_overrides', 'Allow ID overrides'],
      ['mcp', 'MCP'],
      ['tls', 'TLS'],
      // A prefix with no word after it is spelled as the key writes it.
      ['x', 'X'],
    ];
    for (const [key, name] of spelled) {
      assert.strictEqual(labelFor(key), name, `the name derived from ${key}`);
    }
  });

  it('adds the group a setting sits in where two names would read alike, and only there', () => {
    assert.deepStrictEqual(
      distinctNames([
        ['parse_cache', 'max_bytes'],
        ['compiled_module_cache', 'max_bytes'],
        ['mcp', 'listen'],
        ['mcp', 'health', 'listen'],
        ['mcp', 'transport'],
        ['offline'],
        ['build', 'yaml_indent'],
      ]),
      [
        'Parse cache max bytes',
        'Compiled module cache max bytes',
        'MCP listen',
        'Health listen',
        'Transport',
        'Offline',
        'YAML indent',
      ],
    );
  });

  it('reaches further out while names still collide, and leaves a top-level setting its own words', () => {
    assert.deepStrictEqual(
      distinctNames([
        ['a', 'inner', 'cap'],
        ['b', 'inner', 'cap'],
        ['cap'],
      ]),
      ['A inner cap', 'B inner cap', 'Cap'],
    );
  });

  it('gives no two settings of a page the same name where their paths allow it', () => {
    const paths = [
      ['registries'], ['workspace', 'releases'], ['signing', 'required'], ['signing', 'kinds'],
      ['mcp', 'authorization', 'issuer'], ['mcp', 'authorization', 'resource'],
      ['parse_cache', 'max_entries'], ['parse_cache', 'max_bytes'], ['compiled_module_cache', 'max_bytes'],
      ['mcp', 'listen'], ['mcp', 'health', 'listen'], ['plugins', 'cli'],
    ];
    const names = distinctNames(paths);
    assert.strictEqual(new Set(names).size, names.length, `names drawn twice: ${JSON.stringify(names)}`);
  });

  // 🔴 CLAUSE (b) OF THE ACCEPTANCE, PROVEN: a property added to the schema
  // appears with no edit to the generator.
  it('draws a property added to the schema with nothing edited here', () => {
    const before = paths(FIXTURE);
    assert.ok(!before.includes('a_new_setting'), 'the fixture already carries the added property');

    const grown = {
      ...FIXTURE,
      properties: {
        ...FIXTURE.properties,
        a_new_setting: {
          type: 'integer',
          description: 'a setting added after the generator was written',
          default: 7,
          minimum: 1,
        },
      },
    };

    const after = paths(grown);
    assert.ok(after.includes('a_new_setting'), 'a property added to the schema is not drawn');
    assert.strictEqual(after.length, before.length + 1, 'adding one property changed the count by something other than one');

    const added = controlAt(grown, 'a_new_setting');
    assert.strictEqual(added.kind, 'number');
    assert.strictEqual(added.label, 'A new setting');
    assert.strictEqual(added.description, 'a setting added after the generator was written');
    assert.strictEqual(added.minimum, 1);
    assert.strictEqual(added.defaultValue, 7);
  });

  it('draws a group added to the schema, with its members', () => {
    const grown = {
      ...FIXTURE,
      properties: {
        ...FIXTURE.properties,
        a_new_group: {
          type: 'object',
          description: 'a group added after the generator was written',
          properties: {
            new_member: { type: 'boolean', description: 'a member of the added group', default: true },
          },
        },
      },
    };
    assert.ok(
      paths(grown).includes('a_new_group.new_member'),
      'a group added to the schema does not bring its members onto the surface',
    );
  });

  it('reads a document it cannot understand as no surface rather than half of one', () => {
    // Half a configuration surface is worse than none: a reader cannot tell
    // which half is missing, so a value they do not see reads as a setting that
    // does not exist.
    for (const bad of [null, undefined, 42, 'a schema', [], { type: 'object' }]) {
      const surface = configSurface(bad);
      assert.deepStrictEqual(surface.controls, [], `${JSON.stringify(bad)} drew controls`);
      assert.deepStrictEqual(surface.sections, [], `${JSON.stringify(bad)} drew sections`);
    }
  });

  it('stops on a reference cycle rather than recursing', () => {
    const cyclic = {
      type: 'object',
      properties: { looping: { $ref: '#/$defs/Loop' } },
      $defs: { Loop: { $ref: '#/$defs/Loop' } },
    };
    // The point is that it returns at all. A shape it cannot resolve is drawn as
    // one it does not offer a control for, which is honest.
    assert.strictEqual(controlAt(cyclic, 'looping').kind, 'unsupported');
  });

  it('reports a shape it cannot draw rather than guessing at one', () => {
    const opaque = {
      type: 'object',
      properties: {
        free_bag: { type: 'object', description: 'an object with no declared properties' },
        odd_list: { type: 'array', items: { type: 'integer' }, description: 'a list of numbers' },
      },
    };
    assert.strictEqual(controlAt(opaque, 'free_bag').kind, 'unsupported');
    assert.strictEqual(controlAt(opaque, 'odd_list').kind, 'unsupported');
  });

  it('prefers the description on the use of a shared definition over the definition\'s own', () => {
    // A declaration that references a shared shape may say what THIS use of it
    // means, and that sentence is more specific than the shape's own.
    const schema = {
      type: 'object',
      properties: {
        here: { $ref: '#/$defs/Shared', description: 'what this use of the shape means' },
        there: { $ref: '#/$defs/Shared' },
      },
      $defs: { Shared: { type: 'string', description: 'what the shape is in general' } },
    };
    assert.strictEqual(controlAt(schema, 'here').description, 'what this use of the shape means');
    assert.strictEqual(controlAt(schema, 'there').description, 'what the shape is in general');
  });
});
