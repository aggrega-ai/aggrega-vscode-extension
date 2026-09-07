// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PRESENTATION_MEMENTO_KEY,
  PRESENTATION_TOGGLE_COMMAND,
  configPanelBodyHtml,
  configTableHtml,
  shapePhrase,
  shapeSentence,
} from '../../src/config-render';
import {
  DEFAULTS_SOURCE,
  Provenance,
  configPanelModel,
  describeProvenance,
  effectiveValue,
  everyRow,
  setValue,
  sourceLabel,
} from '../../src/config-model';
import { ConfigControl } from '../../src/config-schema';

// The fixture is SYNTHETIC, for the same two reasons the generator's own
// fixtures are: the subject is the table rather than any one schema, and reading
// the real configuration schema would make every assertion depend on a sibling
// checkout being present.
//
// It carries one setting a file puts in force, one an environment variable does,
// one the report attributes to the built-in defaults, one the report does not
// cover at all, one carrying no default, one enumerated, one bounded, and one
// nested a group deep — because those are the cases the cells say different
// things about.
const SCHEMA = {
  type: 'object',
  properties: {
    offline: { type: 'boolean', description: 'whether the build contacts a registry', default: false },
    auto_pull: { type: 'boolean', description: 'whether inputs are fetched on demand', default: true },
    default_registry: { type: 'string', description: 'the registry resolved through', default: 'hub' },
    artifact_cache_dir: { type: 'string', description: 'where artifacts are cached', default: '.aggrega/cache' },
    no_default_here: { type: 'string', description: 'a setting the schema gives no fallback' },
    a_choice: {
      type: 'string',
      description: 'an enumerated setting',
      enum: ['first', 'second'],
    },
    parse_cache: {
      type: 'object',
      description: 'the parse cache',
      properties: {
        max_bytes: { type: 'integer', description: 'the cap on the cache', default: 2048, minimum: 0, maximum: 99 },
      },
    },
  },
};

const REPORT = {
  layers: ['/ws/.aggrega-config.yaml', 'env:AGGREGA_AUTO_PULL'],
  settings: [
    { field: 'offline', value: 'true', source: '/ws/.aggrega-config.yaml' },
    { field: 'auto_pull', value: 'false', source: 'env:AGGREGA_AUTO_PULL' },
    { field: 'default_registry', value: 'hub', source: DEFAULTS_SOURCE },
  ],
};

// expectedLabel derives a label from a key INDEPENDENTLY of the source.
//
// 🔴 THE INDEPENDENCE IS THE WHOLE VALUE OF THIS FUNCTION, and it is a
// deliberate near-duplicate of the source's own derivation. Measured on this
// surface: an assertion comparing the table's name cell against the source's own
// `labelFor` accepted a hand-written label planted inside that derivation,
// because the plant sat on BOTH SIDES of the comparison. Comparing against a
// second, independently written derivation is what makes the assertion capable
// of failing.
//
// It is deliberately NOT imported from the generator's own spec and deliberately
// NOT unified with the source: unifying either way restores exactly that
// blindness.
function expectedLabel(key: string): string {
  const words = key.split('_').filter((w) => w.length > 0);
  if (words.length === 0) { return key; }
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// cellsOf reads one row of the drawn table back as its cells, so an assertion
// can name the column it is about rather than searching the whole document.
function cellsOf(html: string, path: string): string[] {
  const rows = html.split('<tr>');
  const wanted = rows.find((row) => row.includes(`<code>${path}</code>`));
  assert.ok(wanted, `no row for ${path}; the table draws ${rows.length - 1} rows`);
  return Array.from(wanted.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((m) => m[1]);
}

// text strips the markup a cell carries, leaving what a reader reads.
function text(cell: string): string {
  return cell.replace(/<[^>]*>/g, '').trim();
}

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

describe('every setting drawn as one row of one table', () => {
  const model = configPanelModel(SCHEMA, REPORT);
  const html = configTableHtml(model);

  it('draws one row per drawn setting, and exactly the rows the coverage sentence counts', () => {
    // 🔴 The row set is the MODEL's own rows, not a re-walk of the schema's
    // controls. The two are different sets, and the coverage sentence is
    // composed from the model's count — so a presentation drawing the other set
    // would make that sentence false of itself while leaving it true of the
    // other, and nothing would report it.
    const drawn = Array.from(html.matchAll(/<tr>/g)).length - 1;
    assert.strictEqual(
      drawn,
      model.drawn,
      'the table draws a different number of rows than the coverage sentence claims',
    );
    assert.strictEqual(everyRow(model).length, model.drawn);
    // A setting nested inside a group is as real to a reader as a top-level
    // one, and the table is flat, so it is a row of its own.
    assert.ok(html.includes('<code>parse_cache.max_bytes</code>'), 'a nested setting is not drawn');
  });

  it('spells the first column as the setting a reader would type', () => {
    // This is the column a reader searches by, so it carries the literal path
    // and not a prettified rendering of it.
    assert.strictEqual(text(cellsOf(html, 'parse_cache.max_bytes')[0]), 'parse_cache.max_bytes');
    assert.strictEqual(text(cellsOf(html, 'offline')[0]), 'offline');
  });

  // 🔴 THIS IS THE ASSERTION PROTECTING THE SINGLE SOURCING OF THE NAME COLUMN.
  //
  // The comparison is against this file's OWN derivation, never the source's, so
  // a hand-written name planted inside the source's derivation cannot hide
  // behind being on both sides of the comparison.
  it('derives the name column from the key, never from a table of names', () => {
    for (const row of everyRow(model)) {
      const path = row.control.path.join('.');
      const key = row.control.path[row.control.path.length - 1];
      assert.strictEqual(
        text(cellsOf(html, path)[1]),
        expectedLabel(key),
        `the name drawn at ${path} is not derived from its key`,
      );
    }
  });

  it('fills the set column only where the reader put the value in force', () => {
    // A file and an environment variable are both the reader having set
    // something. A built-in default is not, and neither is a setting the report
    // does not mention — so both of those leave the cell empty, and that
    // emptiness is the information.
    assert.strictEqual(text(cellsOf(html, 'offline')[2]), 'true');
    assert.strictEqual(text(cellsOf(html, 'auto_pull')[2]), 'false');
    assert.strictEqual(
      text(cellsOf(html, 'default_registry')[2]),
      '',
      'a built-in default was drawn as though the reader had set it',
    );
    assert.strictEqual(
      text(cellsOf(html, 'artifact_cache_dir')[2]),
      '',
      'a setting the report does not cover was drawn as though the reader had set it',
    );
  });

  it('draws the default column from the schema, and nothing where none is declared', () => {
    assert.strictEqual(text(cellsOf(html, 'parse_cache.max_bytes')[3]), '2048');
    assert.strictEqual(text(cellsOf(html, 'offline')[3]), 'false');
    assert.strictEqual(
      text(cellsOf(html, 'no_default_here')[3]),
      '',
      'a setting the schema gives no fallback was drawn with one',
    );
  });

  it('marks an effective value the compiler never reported as the declaration it is', () => {
    // 🔴 Putting the bare value here would have this surface assert a reading
    // the compiler never took, which is the one thing the honest drawing of an
    // uncovered setting exists to prevent.
    assert.strictEqual(text(cellsOf(html, 'offline')[4]), 'true');
    const uncovered = text(cellsOf(html, 'artifact_cache_dir')[4]);
    assert.ok(uncovered.includes('.aggrega/cache'), uncovered);
    assert.ok(
      uncovered.includes('declared default'),
      `an unreported value was drawn as a reading: ${uncovered}`,
    );
    // Neither a reading nor a declared fallback leaves nothing to show.
    assert.strictEqual(text(cellsOf(html, 'no_default_here')[4]), '');
  });

  it('says what each setting accepts, with the schema\'s own bounds and values', () => {
    assert.strictEqual(text(cellsOf(html, 'offline')[5]), 'true or false');
    assert.strictEqual(text(cellsOf(html, 'a_choice')[5]), 'one of: first, second');
    assert.strictEqual(
      text(cellsOf(html, 'parse_cache.max_bytes')[5]),
      'a whole number, at least 0 and at most 99',
    );
  });

  it('names the source, and says so rather than blanking where there is none', () => {
    assert.strictEqual(text(cellsOf(html, 'offline')[6]), '/ws/.aggrega-config.yaml');
    assert.strictEqual(text(cellsOf(html, 'auto_pull')[6]), 'environment: AGGREGA_AUTO_PULL');
    assert.strictEqual(text(cellsOf(html, 'default_registry')[6]), 'built-in default');
    // 🔴 The ordinary case: the report covers a minority of what the schema
    // declares, so a blank here would read as a surface that failed to fill it.
    assert.strictEqual(text(cellsOf(html, 'artifact_cache_dir')[6]), 'not reported');
    // And it names no file: an invented source would send a reader looking in a
    // file that never mentioned the setting.
    assert.ok(
      !cellsOf(html, 'artifact_cache_dir')[6].includes('.aggrega-config.yaml'),
      'an uncovered setting was drawn as though a file produced it',
    );
  });

  it('puts the schema\'s own description behind an affordance rather than inline', () => {
    // The description is the longest thing about a setting, so drawing it in a
    // cell would make every row as tall as a paragraph — which is the whole of
    // what a table buys being spent.
    const info = cellsOf(html, 'offline')[7];
    assert.ok(info.includes('<details'), 'the description is not behind an affordance');
    assert.ok(info.includes('whether the build contacts a registry'), 'the description is not carried');
    // Every declaration carries a description, so the affordance is never empty.
    for (const row of everyRow(model)) {
      const cell = cellsOf(html, row.control.path.join('.'))[7];
      assert.ok(
        cell.includes(row.control.description),
        `${row.control.path.join('.')} draws no description behind its affordance`,
      );
    }
  });

  it('offers the affordance to a reader who hovers and to one who presses', () => {
    const info = cellsOf(html, 'offline')[7];
    assert.ok(info.includes('<summary'), 'there is nothing to press');
    assert.ok(info.includes('title="whether the build contacts a registry"'), 'there is nothing to hover');
    // The glyph is a single letter, and the control carries a name for a reader
    // who cannot see that it is one.
    assert.ok(info.includes('aria-label="What offline means"'), info);
  });

  it('renders authored text as text in every cell', () => {
    // Every word in the table comes from the schema or the compiler's report, so
    // a description carrying markup must arrive as the characters it is.
    const risky = configTableHtml(configPanelModel({
      type: 'object',
      properties: {
        risky: { type: 'string', description: '<script>alert(1)</script> & "quoted"', default: '<b>x</b>' },
      },
    }, null));
    assert.ok(!risky.includes('<script>'), 'a description reached the document as markup');
    assert.ok(!risky.includes('<b>x</b>'), 'a declared default reached the document as markup');
    assert.ok(risky.includes('&lt;script&gt;'), 'the description was not rendered as text');
    assert.ok(risky.includes('&amp;'), 'an ampersand was not rendered as text');
    // The hover carries the same sentence, and it sits in an attribute — so a
    // quotation mark in it must not close that attribute early.
    assert.ok(risky.includes('&quot;quoted&quot;'), 'a quotation mark was not rendered as text');
  });

  it('is a table a reader using a screen reader can navigate', () => {
    assert.ok(html.includes('<caption>'), 'the table carries no caption');
    // A header cell scoped to its column is what lets a screen reader announce
    // which column a cell belongs to while moving across a row.
    const headers = Array.from(html.matchAll(/<th scope="col">/g)).length;
    assert.strictEqual(headers, 8, 'a column carries no scoped header');
  });
});

describe('the two presentations of one model', () => {
  const model = configPanelModel(SCHEMA, REPORT);

  it('draws the table by default and the per-setting blocks on request', () => {
    const table = configPanelBodyHtml(model, 'table');
    const expanded = configPanelBodyHtml(model, 'expanded');
    assert.ok(table.includes('<table'), 'the table presentation draws no table');
    assert.ok(!table.includes('class="config-row"'), 'the table presentation also draws the blocks');
    assert.ok(expanded.includes('class="config-row"'), 'the expanded presentation draws no blocks');
    assert.ok(!expanded.includes('<table'), 'the expanded presentation also draws the table');
  });

  it('says what the page reports in both, and draws the same settings in both', () => {
    // The coverage sentence is composed from the model's counts, so it must be
    // true of whichever presentation is drawn.
    for (const presentation of ['table', 'expanded'] as const) {
      const html = configPanelBodyHtml(model, presentation);
      assert.ok(
        html.includes(`${model.attributed} of the ${model.drawn}`),
        `the coverage sentence is missing from the ${presentation} presentation`,
      );
      for (const row of everyRow(model)) {
        assert.ok(
          html.includes(`<code>${row.control.path.join('.')}</code>`),
          `${row.control.path.join('.')} is not drawn in the ${presentation} presentation`,
        );
      }
    }
  });

  it('offers the other presentation, immediately after what the page can report', () => {
    for (const presentation of ['table', 'expanded'] as const) {
      const html = configPanelBodyHtml(model, presentation);
      const afterSummary = html.indexOf('</section>');
      const control = html.indexOf('class="config-switch"');
      assert.ok(control > afterSummary, 'the control does not follow the box saying what is reported');
      // 🔴 It reaches the command through a link the editor resolves. The
      // document runs no script and admits no script source, so a control that
      // needed one would mean giving that up.
      assert.ok(
        html.includes(`href="command:${PRESENTATION_TOGGLE_COMMAND}"`),
        'the control does not reach its command',
      );
      assert.ok(!html.includes('onclick'), 'the control is scripted');
      assert.ok(!html.includes('<script'), 'the document carries a script');
    }
  });

  it('offers whichever presentation the reader is not already in', () => {
    // The offer states what pressing will do rather than restating the shape a
    // reader can already see, so it must differ between the two.
    const fromTable = configPanelBodyHtml(model, 'table');
    const fromExpanded = configPanelBodyHtml(model, 'expanded');
    const offer = (html: string): string => {
      const match = html.match(/class="config-switch-control"[^>]*>([^<]*)</);
      assert.ok(match, 'no offer is drawn');
      return match[1];
    };
    assert.notStrictEqual(offer(fromTable), offer(fromExpanded));
    assert.ok(offer(fromTable).length > 0 && offer(fromExpanded).length > 0);
  });
});

describe('the reader\'s choice of presentation', () => {
  // The manifest is parsed rather than pattern-matched: what is asserted is a
  // property of the declared properties, and only a parse can see that.
  const MANIFEST = path.resolve(__dirname, '../../../package.json');

  function declaredPreferences(): string[] {
    const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    return Object.keys(pkg.contributes.configuration.properties);
  }

  // 🔴 THIS IS WHAT MAKES "KEPT OUT OF THE CONFIGURATION THIS PANEL REPORTS"
  // CHECKABLE RATHER THAN MERELY INTENDED. The panel reports the compiler's
  // configuration; a preference about how to read the panel appearing in a list
  // the panel itself reports would leave a reader unable to tell the two
  // surfaces apart.
  it('is not a declared preference, so it cannot appear on a settings surface', () => {
    const declared = declaredPreferences();
    assert.ok(
      declared.length > 0,
      'the manifest declares no preferences at all — the assertions below would pass over an empty set',
    );
    assert.ok(
      !declared.includes(PRESENTATION_MEMENTO_KEY),
      `${PRESENTATION_MEMENTO_KEY} is declared as a preference, so it appears on the settings surface`,
    );
    // Broader than the one key, because the guarantee is about the namespace
    // rather than about today's spelling: nothing the configuration panel keeps
    // for itself may be declared, however it comes to be named.
    const leaked = declared.filter((key) => key.startsWith('aggrega.config.'));
    assert.deepStrictEqual(
      leaked,
      [],
      `the configuration panel's own state is declared as a preference: ${leaked.join(', ')}`,
    );
  });
});

describe('the derivations both presentations read', () => {
  it('composes the sentence from the phrase, so the two cannot disagree', () => {
    // The phrase is the one home of what a setting accepts. A presentation with
    // room for a sentence and one with room for a phrase must not come to say
    // different things about the same declaration, so the sentence is built from
    // the phrase rather than derived a second time.
    for (const kind of ['toggle', 'number', 'text', 'text-list', 'collection', 'map', 'unsupported'] as const) {
      const c = control({ kind });
      assert.strictEqual(shapeSentence(c), `Takes: ${shapePhrase(c)}.`, kind);
    }
    // An enumeration's phrase carries its own preposition, so the sentence
    // supplies no second colon.
    const choice = control({ kind: 'choice', choices: ['first', 'second'] });
    assert.strictEqual(shapePhrase(choice), 'one of: first, second');
    assert.strictEqual(shapeSentence(choice), 'Takes one of: first, second.');
  });

  it('renders every provenance case in both lengths, and neither blanks', () => {
    // The four cases are decided once and rendered twice. Both renderings must
    // be exhaustive: a case one of them did not cover would draw an empty cell
    // where the fact is that there is something to say.
    const cases: Provenance[] = [
      { kind: 'file', path: '/ws/.aggrega-config.yaml' },
      { kind: 'environment', variable: 'AGGREGA_OFFLINE' },
      { kind: 'defaults' },
      { kind: 'unattributed' },
    ];
    for (const provenance of cases) {
      assert.ok(sourceLabel(provenance).length > 0, `${provenance.kind} renders as nothing in a cell`);
      assert.ok(
        describeProvenance(provenance).length > 0,
        `${provenance.kind} renders as nothing in a sentence`,
      );
    }
  });

  it('decides what applies once, for every presentation', () => {
    const reported = effectiveValue({
      control: control({ hasDefault: true, defaultValue: 'fallback' }),
      value: 'in force',
      provenance: { kind: 'file', path: '/ws/f.yaml' },
      scope: { reach: 'unclassified', evidence: '' },
    });
    assert.deepStrictEqual(reported, { kind: 'reported', value: 'in force' });

    const fallback = effectiveValue({
      control: control({ hasDefault: true, defaultValue: 'fallback' }),
      provenance: { kind: 'unattributed' },
      scope: { reach: 'unclassified', evidence: '' },
    });
    assert.deepStrictEqual(fallback, { kind: 'declared-default', value: 'fallback' });

    const neither = effectiveValue({
      control: control({ hasDefault: false }),
      provenance: { kind: 'unattributed' },
      scope: { reach: 'unclassified', evidence: '' },
    });
    assert.deepStrictEqual(neither, { kind: 'none' });
  });

  it('holds a built-in default to be something nobody set', () => {
    const row = {
      control: control({}),
      value: 'hub',
      provenance: { kind: 'defaults' } as Provenance,
      scope: { reach: 'unclassified' as const, evidence: '' },
    };
    assert.strictEqual(setValue(row), undefined);
    assert.strictEqual(
      setValue({ ...row, provenance: { kind: 'file', path: '/ws/f.yaml' } }),
      'hub',
    );
    assert.strictEqual(
      setValue({ ...row, provenance: { kind: 'environment', variable: 'X' } }),
      'hub',
    );
    assert.strictEqual(setValue({ ...row, provenance: { kind: 'unattributed' }, value: undefined }), undefined);
  });
});
