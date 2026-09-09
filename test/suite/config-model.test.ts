// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import {
  DEFAULTS_SOURCE,
  configPanelModel,
  describeProvenance,
  provenanceOf,
  readEffectiveConfiguration,
} from '../../src/config-model';
import { configScope } from '../../src/config-scope';
import { ConfigControl } from '../../src/config-schema';
import { configPanelBodyHtml, coverageSentence, valueSentence } from '../../src/config-render';

// A schema fixture carrying one attributed setting, one unattributed one, and one
// whose reach the product states — the three cases the surface says different
// things about.
const SCHEMA = {
  type: 'object',
  properties: {
    offline: { type: 'boolean', description: 'whether the build contacts a registry', default: false },
    artifact_cache_dir: { type: 'string', description: 'where artifacts are cached', default: '.aggrega/cache' },
    compiled_module_cache: {
      type: 'object',
      description: 'the compiled-module store',
      properties: {
        max_bytes: { type: 'integer', description: 'the cap on the store', default: 1024, minimum: 0 },
      },
    },
    registries: {
      type: 'array',
      description: 'per-registry settings',
      items: {
        type: 'object',
        properties: { host: { type: 'string', description: 'the registry host' } },
      },
      default: [],
    },
  },
};

function control(over: Partial<ConfigControl>): ConfigControl {
  return {
    path: ['setting'],
    label: 'Setting',
    description: 'a setting',
    kind: 'text',
    hasDefault: false,
    ...over,
  };
}

describe('joining a schema against what the compiler resolved', () => {
  it('reads the compiler\'s report off the wire, and an unreadable one as none', () => {
    const read = readEffectiveConfiguration({
      layers: ['/etc/aggrega/config.yaml', 'env:AGGREGA_OFFLINE'],
      settings: [{ field: 'offline', value: 'true', source: 'env:AGGREGA_OFFLINE' }],
    });
    assert.ok(read);
    assert.deepStrictEqual(read.layers, ['/etc/aggrega/config.yaml', 'env:AGGREGA_OFFLINE']);
    assert.strictEqual(read.settings.length, 1);

    // A response this cannot read yields nothing rather than something partly
    // populated: the surface then draws every setting as unattributed, which is
    // honest, instead of attributing the rows that happened to survive.
    for (const bad of [null, undefined, 42, 'a report', { layers: [] }]) {
      assert.strictEqual(readEffectiveConfiguration(bad), null, `${JSON.stringify(bad)} read as a report`);
    }
    // A row without a field cannot be joined against anything, so it is dropped
    // rather than kept as a row nothing matches.
    const partial = readEffectiveConfiguration({ settings: [{ value: 'x', source: 'y' }, { field: 'offline' }] });
    assert.deepStrictEqual(partial?.settings, [{ field: 'offline', value: '', source: '' }]);
  });

  it('tells a file, an environment override and the built-in defaults apart', () => {
    // A reader acts on the three differently: a file they open, a variable they
    // change outside the editor, and a default that no file mentions at all.
    assert.deepStrictEqual(
      provenanceOf({ field: 'f', value: 'v', source: '/ws/.aggrega-config.yaml' }),
      { kind: 'file', path: '/ws/.aggrega-config.yaml' },
    );
    assert.deepStrictEqual(
      provenanceOf({ field: 'f', value: 'v', source: 'env:AGGREGA_OFFLINE' }),
      { kind: 'environment', variable: 'AGGREGA_OFFLINE' },
    );
    assert.deepStrictEqual(
      provenanceOf({ field: 'f', value: 'v', source: DEFAULTS_SOURCE }),
      { kind: 'defaults' },
    );
    assert.deepStrictEqual(provenanceOf(undefined), { kind: 'unattributed' });
    assert.deepStrictEqual(
      provenanceOf({ field: 'f', value: 'v', source: '' }),
      { kind: 'unattributed' },
    );
  });

  // 🔴 A setting with no provenance available is drawn honestly — its declared
  // default, and no invented source.
  it('draws a setting the report does not cover with its default and no source', () => {
    const model = configPanelModel(SCHEMA, {
      layers: ['/ws/.aggrega-config.yaml'],
      settings: [{ field: 'offline', value: 'true', source: '/ws/.aggrega-config.yaml' }],
    });

    const rows = [...model.rows, ...model.sections.flatMap((s) => s.rows)];
    const offline = rows.find((r) => r.control.path.join('.') === 'offline');
    const cacheDir = rows.find((r) => r.control.path.join('.') === 'artifact_cache_dir');
    assert.ok(offline && cacheDir);

    // The attributed one carries the value and the file.
    assert.strictEqual(offline.value, 'true');
    assert.deepStrictEqual(offline.provenance, { kind: 'file', path: '/ws/.aggrega-config.yaml' });
    assert.strictEqual(valueSentence(offline), 'In force: true');

    // The unattributed one carries the DECLARED DEFAULT, said to be the default,
    // and no source at all. Presenting it as a current reading would be this
    // surface asserting something the compiler never reported.
    assert.strictEqual(cacheDir.value, undefined);
    assert.deepStrictEqual(cacheDir.provenance, { kind: 'unattributed' });
    assert.strictEqual(valueSentence(cacheDir), 'Declared default: .aggrega/cache');
    assert.match(describeProvenance(cacheDir.provenance), /does not cover this setting/);
    // And it names no file: an invented source would send a reader looking in a
    // file that never mentioned the setting.
    assert.ok(
      !describeProvenance(cacheDir.provenance).includes('.aggrega-config.yaml'),
      'an unattributed setting was drawn as though a file produced it',
    );
  });

  it('says how much of the configuration the report covers', () => {
    const model = configPanelModel(SCHEMA, {
      layers: [],
      settings: [{ field: 'offline', value: 'true', source: DEFAULTS_SOURCE }],
    });
    assert.strictEqual(model.attributed, 1);
    assert.ok(model.drawn > 1, 'the page draws no more settings than the report attributes');
    // The sentence is composed from the counts rather than written, so it stays
    // true as either moves.
    const sentence = coverageSentence(model);
    assert.ok(sentence.includes(`${model.attributed} of the ${model.drawn}`), sentence);
    // The count counts ROWS, and a row is what a reader can count back. Every
    // row the model carries is included, at every group depth.
    const rows = [...model.rows, ...model.sections.flatMap((s) => s.rows)];
    assert.strictEqual(model.drawn, rows.length, 'the stated count is not the number of rows drawn');
  });

  it('draws no row for a reported setting the schema does not declare', () => {
    // Such a row would have no label, no description and no bounds: a name and a
    // value, with nothing to tell the reader what either means.
    const model = configPanelModel(SCHEMA, {
      layers: [],
      settings: [{ field: 'a_setting_no_schema_declares', value: 'x', source: DEFAULTS_SOURCE }],
    });
    const drawn = [...model.rows, ...model.sections.flatMap((s) => s.rows)]
      .map((r) => r.control.path.join('.'));
    assert.ok(!drawn.includes('a_setting_no_schema_declares'));
    assert.strictEqual(model.attributed, 0);
  });

  it('draws every setting as unattributed when no report could be obtained', () => {
    const model = configPanelModel(SCHEMA, null);
    assert.strictEqual(model.attributed, 0);
    assert.deepStrictEqual(model.layers, []);
    for (const row of [...model.rows, ...model.sections.flatMap((s) => s.rows)]) {
      assert.deepStrictEqual(row.provenance, { kind: 'unattributed' });
    }
  });
});

describe('how far a change to a setting would reach', () => {
  // A setting the product states is machine-wide is reported as machine-wide,
  // with the reason a reader can read travelling beside the verdict.
  //
  // 🔴 THE CLASSIFICATION IS ABOUT A SETTING AND NEVER ABOUT AN OPERATION, which
  // is why nothing here asks whether a write may be directed at a project's
  // file. Those are different questions with different answers: the registry
  // settings are machine-wide, and the compiler still accepts a registration
  // directed at a project's own file. An assertion joining the two would pin a
  // reading that withholds a destination the compiler accepts.
  it('reports a machine-wide setting as machine-wide, with its reason', () => {
    for (const path of [
      ['registries'],
      ['registries', '[]', 'host'],
      ['registries', '[]', 'signing', 'required'],
      ['plugins', 'cli'],
      ['compiled_module_cache', 'max_bytes'],
    ]) {
      const scope = configScope(control({ path }));
      assert.strictEqual(scope.reach, 'machine', `${path.join('.')} is not held to be machine-wide`);
      assert.ok(scope.evidence.length > 0, `${path.join('.')} carries no reason a reader could read`);
    }
  });

  it('reports a setting the product states travels with the project', () => {
    for (const path of [
      ['plugins', 'providers'],
      ['plugins', 'governance'],
      ['plugins', 'linter'],
      ['plugins', 'importer'],
    ]) {
      assert.strictEqual(configScope(control({ path })).reach, 'project', path.join('.'));
    }
  });

  it('reports a setting nobody has classified as unclassified, carrying no reason', () => {
    // Classifying every setting nobody classified would answer on the strength
    // of an absence. The honest answer is that there is no statement about it.
    const scope = configScope(control({ path: ['offline'] }));
    assert.strictEqual(scope.reach, 'unclassified');
    assert.strictEqual(scope.evidence, '', 'an unclassified setting carries evidence it does not have');
  });

  it('matches a path by its segments, not by the spelling of its name', () => {
    // A setting whose name merely begins with a classified setting's name is a
    // different setting, and a string prefix would sweep it in.
    assert.strictEqual(configScope(control({ path: ['registries_elsewhere'] })).reach, 'unclassified');
    assert.strictEqual(configScope(control({ path: ['plugins', 'cli_extra'] })).reach, 'unclassified');
    // Whereas a genuine descendant inherits the container's reach.
    assert.strictEqual(configScope(control({ path: ['plugins', 'cli', '[]', 'uri'] })).reach, 'machine');
  });

  it('exports the classification and nothing built on top of it', () => {
    // 🔴 A COUNT OVER THE MODULE'S OWN EXPORTS, not a presence check on one name.
    // Two answers derived from this classification once existed with nothing in
    // the surface reading them, and a presence check on either would have gone on
    // passing while they sat unreachable. The whole export list is read so that a
    // second derived answer has to be looked at rather than merely added.
    const scope: Record<string, unknown> = require('../../src/config-scope');
    assert.deepStrictEqual(
      Object.keys(scope).sort(),
      ['configScope'],
      'the classification grew or lost an export; anything derived from it needs a reader in '
      + 'the surface, or it is an answer nobody asked for',
    );
  });
});

// Every assertion in this block is about the shape that gives each setting its
// own block, which is why each names that shape explicitly rather than relying
// on whichever shape happens to be the default. The default is the reader's to
// change, so an assertion that took it would be asserting a preference.
describe('the configuration document as a reader sees it', () => {
  it('draws the setting path, the label, the description and the source', () => {
    const html = configPanelBodyHtml(configPanelModel(SCHEMA, {
      layers: ['/ws/.aggrega-config.yaml'],
      settings: [{ field: 'offline', value: 'true', source: '/ws/.aggrega-config.yaml' }],
    }), 'expanded');
    assert.ok(html.includes('offline'), 'the setting path is not drawn');
    assert.ok(html.includes('whether the build contacts a registry'), 'the schema\'s description is not drawn');
    assert.ok(html.includes('In force: true'), 'the value in force is not drawn');
    assert.ok(html.includes('/ws/.aggrega-config.yaml'), 'the file that produced the value is not drawn');
    assert.ok(html.includes('Takes: true or false'), 'what the setting takes is not drawn');
  });

  it('draws the machine-wide warning only on the settings that carry one', () => {
    const html = configPanelBodyHtml(configPanelModel(SCHEMA, null), 'expanded');
    const warnings = Array.from(html.matchAll(/class="config-reach"/g)).length;
    assert.ok(warnings > 0, 'no machine-wide setting is marked, and the fixture carries two');
    // A note on every row would train a reader to stop reading them.
    const rows = Array.from(html.matchAll(/class="config-row"/g)).length;
    assert.ok(warnings < rows, 'every row carries a machine-wide warning');
    assert.ok(html.includes('Global:'), 'the warning does not say what it is about');
  });

  // 🔴 THE SHARED CONFIGURATION FILE IS CALLED GLOBAL, AND THE WORD IT REPLACED
  // MUST NOT COME BACK. Both spellings below are written out HERE AS LITERALS.
  // Importing the label or the evidence from the modules under test would put the
  // same text on both sides of the comparison, so a rename would move both at
  // once and this assertion would pass on whatever the product happened to say.
  //
  // The reach note is ONE SENTENCE COMPOSED FROM TWO FILES — the label lives in
  // the renderer and the reason it introduces lives in the classification — so a
  // check on either alone passes while the composed note reads "Global: … are
  // machine-wide tooling". This reads the composed document for that reason.
  //
  // Only the words a reader SEES are asserted on. The classification's own
  // internal name is unaffected: its reach value is 'machine', and the identifiers
  // holding it keep that vocabulary deliberately.
  it('names the reach global, in the word the reader already knows', () => {
    const html = configPanelBodyHtml(configPanelModel(SCHEMA, null), 'expanded');
    assert.ok(html.includes('Global:'), 'the reach note does not name the reach global');
    for (const withdrawn of ['machine-wide', 'machine wide']) {
      assert.ok(
        !html.toLowerCase().includes(withdrawn),
        `the configuration document still says "${withdrawn}", which is not what this file is called`,
      );
    }
  });

  it('renders authored text as text', () => {
    // Every word on the page comes from the schema or the compiler, so a
    // description carrying markup must arrive as the characters it is.
    const html = configPanelBodyHtml(configPanelModel({
      type: 'object',
      properties: {
        risky: { type: 'string', description: '<script>alert(1)</script> & "quoted"', default: '' },
      },
    }, null), 'expanded');
    assert.ok(!html.includes('<script>'), 'a description reached the document as markup');
    assert.ok(html.includes('&lt;script&gt;'), 'the description was not rendered as text');
    assert.ok(html.includes('&amp;'), 'an ampersand was not rendered as text');
  });

  it('says so when no file contributed, rather than drawing an empty list', () => {
    const html = configPanelBodyHtml(
      configPanelModel(SCHEMA, { layers: [], settings: [] }),
      'expanded',
    );
    assert.match(html, /No configuration file contributed/);
  });
});
