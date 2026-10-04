// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  COLUMN_GRIP_CLASS,
  PRESENTATION_MEMENTO_KEY,
  PRESENTATION_TOGGLE_COMMAND,
  codeHtml,
  configDocumentHtml,
  configPanelBodyHtml,
  configTableHtml,
  configUnreadNotice,
  plainText,
  shapePhrase,
  shapeSentence,
} from '../../src/config-render';
import {
  DAEMON_ACTION_LABEL,
  RESTART_COMMAND,
  daemonStandingAction,
} from '../../src/daemon-status';
import {
  ConfigRow,
  DEFAULTS_SOURCE,
  Provenance,
  configPanelModel,
  describeProvenance,
  effectiveValue,
  everyRow,
  sourceLabel,
} from '../../src/config-model';
import { ConfigControl } from '../../src/config-schema';
import { blockAfter, sourceOf } from '../helpers/graph-refresh-census';
import { EXTENSION_ROOT } from '../helpers/launch-census';
import { cssRuleBody, declarationOf } from '../helpers/stylesheet';

// The fixture is SYNTHETIC, for the same two reasons the generator's own
// fixtures are: the subject is the table rather than any one schema, and reading
// the real configuration schema would make every assertion depend on a sibling
// checkout being present.
//
// It carries one setting a file puts in force, one an environment variable does,
// one the report attributes to the built-in defaults, one the report does not
// cover at all, one carrying no default, one enumerated, one bounded and nested a
// group deep, one whose leaf repeats in another group, one the machine owns, one
// whose report gives no value, an empty list, and one whose description writes
// code — because those are the cases the cells say different things about.
const SCHEMA = {
  type: 'object',
  properties: {
    offline: { type: 'boolean', description: 'whether the build contacts a registry', default: false },
    auto_pull: { type: 'boolean', description: 'whether inputs are fetched on demand', default: true },
    default_registry: { type: 'string', description: 'the registry resolved through, `hub` by default', default: 'hub' },
    artifact_cache_dir: { type: 'string', description: 'where artifacts are cached', default: '.aggrega/cache' },
    no_default_here: { type: 'string', description: 'a setting the schema gives no fallback' },
    a_choice: {
      type: 'string',
      description: 'an enumerated setting',
      enum: ['first', 'second'],
    },
    a_list: { type: 'array', items: { type: 'string' }, description: 'a list of text entries', default: [] },
    parse_cache: {
      type: 'object',
      description: 'the parse cache',
      properties: {
        max_bytes: { type: 'integer', description: 'the cap on the cache', default: 2048, minimum: 0, maximum: 99 },
      },
    },
    compiled_module_cache: {
      type: 'object',
      description: 'the compiled-module store',
      properties: {
        max_bytes: { type: 'integer', description: 'the cap on the store', default: 4096 },
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
    { field: 'no_default_here', value: '', source: DEFAULTS_SOURCE },
    { field: 'a_list', value: '[]', source: DEFAULTS_SOURCE },
    { field: 'parse_cache.max_bytes', value: '2048', source: DEFAULTS_SOURCE },
    { field: 'compiled_module_cache.max_bytes', value: '4096', source: DEFAULTS_SOURCE },
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
// blindness. The fixture's keys carry no word spelled otherwise than its key
// writes it, so the spelling of such words is the generator's spec's to hold.
function expectedLabel(key: string): string {
  const words = key.split('_').filter((w) => w.length > 0);
  if (words.length === 0) { return key; }
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// expectedName is the name a row is drawn with, derived here as the reader is
// told it is: its key in words, and, where another row's key reads the same, the
// key of the group it sits in ahead of its own.
function expectedName(rowPath: string[], all: string[][]): string {
  const leaf = rowPath[rowPath.length - 1];
  const twin = all.some((other) => other !== rowPath && other[other.length - 1] === leaf);
  return twin && rowPath.length > 1 ? expectedLabel(`${rowPath[rowPath.length - 2]}_${leaf}`) : expectedLabel(leaf);
}

// text strips the markup a cell carries, leaving what a reader reads.
function text(cell: string): string {
  return cell.replace(/<[^>]*>/g, '').trim();
}

// bodyRows reads the drawn table's body back as its rows, the header row left out.
function bodyRows(html: string): string[] {
  return html.slice(html.indexOf('</thead>')).split('<tr').slice(1);
}

// settingRows reads the drawn table back as its setting rows, leaving out the
// heading row of each group.
function settingRows(html: string): string[] {
  return bodyRows(html).filter((row) => row.startsWith('>'));
}

// cellsOf reads one setting's row of the drawn table back as its cells, so an
// assertion can name the column it is about rather than searching the whole
// document. The row is found by the path its first cell draws.
function cellsOf(html: string, path: string): string[] {
  const rows = settingRows(html);
  const wanted = rows.find((row) => {
    const drawn = row.match(/<code class="config-path">([\s\S]*?)<\/code>/);
    return drawn !== null && text(drawn[1]) === path;
  });
  assert.ok(wanted, `no row for ${path}; the table draws ${rows.length} setting rows`);
  return Array.from(wanted.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((m) => m[1]);
}

// The columns, by what each holds.
const PATH = 0;
const NAME = 1;
const VALUE = 2;
const TAKES = 3;
const SOURCE = 4;
const INFO = 5;

// The mark a value carries where it is not the declared default, as drawn.
const MARK = '●';

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

function rowWith(over: Partial<ConfigRow>): ConfigRow {
  return {
    control: control({}),
    name: 'Setting',
    companions: [],
    provenance: { kind: 'unattributed' },
    scope: { reach: 'unclassified', evidence: '' },
    ...over,
  };
}

describe('every setting drawn as one row of one table, beneath its group', () => {
  const model = configPanelModel(SCHEMA, REPORT);
  const html = configTableHtml(model);

  it('draws one row per drawn setting, and exactly the rows the coverage sentence reads', () => {
    // 🔴 The row set is the MODEL's own rows, not a re-walk of the schema's
    // controls. The two are different sets, and the coverage sentence is
    // composed from the model's rows — so a presentation drawing the other set
    // would make that sentence false of itself while leaving it true of the
    // other, and nothing would report it.
    assert.strictEqual(settingRows(html).length, model.drawn, 'the table draws a different number of setting rows than the model holds');
    assert.strictEqual(everyRow(model).length, model.drawn);
    // A setting nested inside a group is as real to a reader as a top-level
    // one, so it is a row of its own.
    assert.ok(text(html).includes('parse_cache.max_bytes'), 'a nested setting is not drawn');
  });

  it('opens each group holding settings with a heading row, and draws the top-level settings first under none', () => {
    const groupRows = bodyRows(html).filter((row) => !row.startsWith('>'));
    assert.deepStrictEqual(
      groupRows.map((row) => text(row.slice(row.indexOf('>') + 1))),
      ['parse_cacheParse cache', 'compiled_module_cacheCompiled module cache'],
      'the group heading rows are not the groups holding settings, in order',
    );
    // Each group is a body of its own, its heading row first and its rows beneath.
    const bodies = Array.from(html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)).map((m) => m[1]);
    assert.strictEqual(bodies.length, 3, 'the top-level settings and the two groups are not three bodies');
    assert.ok(!bodies[0].includes('config-group-row'), 'the top-level settings are drawn under a heading');
    assert.ok(bodies[1].startsWith('<tr class="config-group-row"><th scope="rowgroup" class="config-cell-path">'), bodies[1].slice(0, 120));
    assert.ok(bodies[1].includes('<code class="config-path">parse_<wbr>cache.<wbr>max_<wbr>bytes</code>'), 'the group\'s setting is not beneath its heading');
    // The heading spans the columns after the first, so the row reads as one band.
    assert.ok(bodies[2].includes('<td class="config-group-name" colspan="5">Compiled module cache</td>'), bodies[2].slice(0, 200));
  });

  it('spells the first column as the setting a reader would type, breaking only after `_` or `.`', () => {
    // This is the column a reader searches by, so it carries the literal path
    // and not a prettified rendering of it, with a place to break marked after
    // each separator and nowhere inside a word.
    assert.strictEqual(cellsOf(html, 'parse_cache.max_bytes')[PATH], '<code class="config-path">parse_<wbr>cache.<wbr>max_<wbr>bytes</code>');
    assert.strictEqual(cellsOf(html, 'offline')[PATH], '<code class="config-path">offline</code>');
    assert.strictEqual(cellsOf(html, 'default_registry')[PATH], '<code class="config-path">default_<wbr>registry</code>');
  });

  // 🔴 THIS IS THE ASSERTION PROTECTING THE SINGLE SOURCING OF THE NAME COLUMN.
  //
  // The comparison is against this file's OWN derivation, never the source's, so
  // a hand-written name planted inside the source's derivation cannot hide
  // behind being on both sides of the comparison.
  it('derives the name column from the key, the group added where two names would read alike', () => {
    const all = everyRow(model).map((row) => row.control.path);
    for (const row of everyRow(model)) {
      const path = row.control.path.join('.');
      const name = cellsOf(html, path)[NAME].match(/<span class="config-name">([^<]*)<\/span>/);
      assert.ok(name, `the name drawn at ${path} is not marked as the name`);
      assert.strictEqual(name[1], expectedName(row.control.path, all), `the name drawn at ${path} is not derived from its key`);
    }
    assert.strictEqual(text(cellsOf(html, 'parse_cache.max_bytes')[NAME]), 'Parse cache max bytes');
    const names = everyRow(model).map((row) => row.name);
    assert.strictEqual(new Set(names).size, names.length, `two rows share a name: ${JSON.stringify(names)}`);
  });

  it('draws one value column: what applies now, marked where a file or the environment set it', () => {
    const value = (p: string): string => cellsOf(html, p)[VALUE];
    // A file and an environment variable are both the reader having set
    // something, so both carry the mark, which names why in words.
    assert.strictEqual(
      value('offline'),
      `<span class="config-mark" role="img" aria-label="Set in a file; its declared default is false." title="Set in a file; its declared default is false.">${MARK}</span><span class="config-value-text">true</span>`,
    );
    assert.strictEqual(
      value('auto_pull'),
      `<span class="config-mark" role="img" aria-label="Set in the environment; its declared default is true." title="Set in the environment; its declared default is true.">${MARK}</span><span class="config-value-text">false</span>`,
    );
    // A built-in default that is the declared one carries no mark: its absence
    // is how a reader finds the settings they have not changed.
    assert.strictEqual(value('default_registry'), '<span class="config-value-text">hub</span>');
    assert.strictEqual(value('parse_cache.max_bytes'), '<span class="config-value-text">2048</span>');
  });

  it('draws "none" where no value is in force, and an empty list as the list it is', () => {
    assert.strictEqual(
      cellsOf(html, 'no_default_here')[VALUE],
      '<span class="config-value-text"><span class="config-none">none</span></span>',
      'a setting with no value in force was drawn as something other than "none"',
    );
    assert.strictEqual(cellsOf(html, 'a_list')[VALUE], '<span class="config-value-text">[]</span>');
  });

  it('marks a value the compiler never reported as the declaration it is', () => {
    // 🔴 Putting the bare value here would have this surface assert a reading
    // the compiler never took, which is the one thing the honest drawing of an
    // uncovered setting exists to prevent.
    assert.strictEqual(
      cellsOf(html, 'artifact_cache_dir')[VALUE],
      '<span class="config-value-text">.<wbr>aggrega/<wbr>cache (declared default)</span>',
    );
    // Neither a reading nor a declared fallback says so rather than drawing nothing.
    const neither = configTableHtml(configPanelModel(SCHEMA, null));
    assert.strictEqual(
      cellsOf(neither, 'no_default_here')[VALUE],
      '<span class="config-value-text"><span class="config-none">none (no default declared)</span></span>',
    );
  });

  it('says what each setting accepts, with the schema\'s own bounds and values', () => {
    assert.strictEqual(text(cellsOf(html, 'offline')[TAKES]), 'true or false');
    assert.strictEqual(text(cellsOf(html, 'a_choice')[TAKES]), 'one of: first, second');
    assert.strictEqual(
      text(cellsOf(html, 'parse_cache.max_bytes')[TAKES]),
      'a whole number, at least 0 and at most 99',
    );
  });

  it('names the source, and says so rather than blanking where there is none', () => {
    assert.strictEqual(text(cellsOf(html, 'offline')[SOURCE]), '/ws/.aggrega-config.yaml');
    // A file path breaks only after `/`, `.` or `_`, never inside a word.
    assert.strictEqual(cellsOf(html, 'offline')[SOURCE], '/<wbr>ws/<wbr>.<wbr>aggrega-config.<wbr>yaml');
    assert.strictEqual(text(cellsOf(html, 'auto_pull')[SOURCE]), 'environment: AGGREGA_AUTO_PULL');
    assert.strictEqual(text(cellsOf(html, 'default_registry')[SOURCE]), 'built-in default');
    // 🔴 A setting the report does not mention says so: a blank here would read
    // as a surface that failed to fill it.
    assert.strictEqual(text(cellsOf(html, 'artifact_cache_dir')[SOURCE]), 'not reported');
    // And it names no file: an invented source would send a reader looking in a
    // file that never mentioned the setting.
    assert.ok(
      !cellsOf(html, 'artifact_cache_dir')[SOURCE].includes('.aggrega-config.yaml'),
      'an uncovered setting was drawn as though a file produced it',
    );
  });

  it('marks the row of a setting that belongs to the machine with one word, and no other row', () => {
    const name = (p: string): string => cellsOf(html, p)[NAME];
    assert.ok(
      /^<span class="config-name">Compiled module cache max bytes<\/span> <span class="config-global" title="[^"]+">Global<\/span>$/.test(name('compiled_module_cache.max_bytes')),
      name('compiled_module_cache.max_bytes'),
    );
    for (const row of everyRow(model).filter((r) => r.control.path[0] !== 'compiled_module_cache')) {
      assert.ok(!name(row.control.path.join('.')).includes('Global'), `${row.control.path.join('.')} is marked Global`);
    }
  });

  it('puts the schema\'s own description behind an affordance, drawing its code as code', () => {
    // The description is the longest thing about a setting, so drawing it in a
    // cell would make every row as tall as a paragraph — which is the whole of
    // what a table buys being spent.
    const info = cellsOf(html, 'default_registry')[INFO];
    assert.ok(info.includes('<details'), 'the description is not behind an affordance');
    assert.ok(
      info.includes('<p class="config-description">the registry resolved through, <code>hub</code> by default</p>'),
      `the description does not draw its code as code: ${info}`,
    );
    assert.ok(!text(info).includes('`'), 'a backtick is drawn literally');
    // Every declaration carries a description, so the affordance is never empty.
    for (const row of everyRow(model)) {
      const cell = cellsOf(html, row.control.path.join('.'))[INFO];
      assert.ok(
        cell.includes(codeHtml(row.control.description)),
        `${row.control.path.join('.')} draws no description behind its affordance`,
      );
    }
  });

  it('offers the affordance to a reader who hovers and to one who presses', () => {
    const info = cellsOf(html, 'default_registry')[INFO];
    assert.ok(info.includes('<summary'), 'there is nothing to press');
    // The hover carries no markup, so it carries the same words with the code's
    // backticks dropped.
    assert.ok(info.includes('title="the registry resolved through, hub by default"'), info);
    // The glyph is a single letter, and the control carries a name for a reader
    // who cannot see that it is one.
    assert.ok(info.includes('aria-label="What default_registry means"'), info);
  });

  it('renders authored text as text in every cell', () => {
    // Every word in the table comes from the schema or the compiler's report, so
    // a description carrying markup must arrive as the characters it is — inside
    // a code run as much as outside one.
    const risky = configTableHtml(configPanelModel({
      type: 'object',
      properties: {
        risky: { type: 'string', description: '<script>alert(1)</script> & "quoted" `<b>code</b>`', default: '<b>x</b>' },
      },
    }, null));
    assert.ok(!risky.includes('<script>'), 'a description reached the document as markup');
    assert.ok(!risky.includes('<b>'), 'markup reached the document');
    assert.ok(risky.includes('&lt;script&gt;'), 'the description was not rendered as text');
    assert.ok(risky.includes('<code>&lt;b&gt;code&lt;/b&gt;</code>'), 'a code run was not rendered as text');
    assert.ok(risky.includes('&amp;'), 'an ampersand was not rendered as text');
    // The hover carries the same sentence, and it sits in an attribute — so a
    // quotation mark in it must not close that attribute early.
    assert.ok(risky.includes('&quot;quoted&quot;'), 'a quotation mark was not rendered as text');
  });

  it('is a table a reader using a screen reader can navigate', () => {
    assert.ok(html.includes('<caption><span class="config-caption">'), 'the table carries no caption');
    // A header cell scoped to its column is what lets a screen reader announce
    // which column a cell belongs to while moving across a row. The opening is
    // matched up to the scope, because a labelled heading also carries its grip.
    const headers = Array.from(html.matchAll(/<th scope="col"[ >]/g)).length;
    assert.strictEqual(headers, 6, 'a column carries no scoped header');
    // A group's heading is scoped to the rows of its body.
    assert.strictEqual(Array.from(html.matchAll(/<th scope="rowgroup"/g)).length, 2);
  });

  it('says in its caption what the mark beside a value means', () => {
    const caption = html.match(/<caption><span class="config-caption">([^<]*)<\/span><\/caption>/);
    assert.ok(caption, 'the caption is not drawn');
    assert.strictEqual(
      caption[1],
      `Every setting the configuration schema declares, beneath the group it belongs to. A value marked ${MARK} is set in a file or the environment, or is not its declared default.`,
    );
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
    // The coverage sentence names the model's unattributed rows, so it must be
    // true of whichever presentation is drawn.
    for (const presentation of ['table', 'expanded'] as const) {
      const html = configPanelBodyHtml(model, presentation);
      assert.ok(
        html.includes('The configuration report carries no row for artifact_cache_dir and a_choice, so each is shown'),
        `the coverage sentence is missing from the ${presentation} presentation`,
      );
      for (const row of everyRow(model)) {
        assert.ok(
          text(html).includes(row.control.path.join('.')),
          `${row.control.path.join('.')} is not drawn in the ${presentation} presentation`,
        );
      }
    }
  });

  it('draws each description\'s code as code in both, and no backtick', () => {
    for (const presentation of ['table', 'expanded'] as const) {
      const html = configPanelBodyHtml(model, presentation);
      assert.ok(html.includes('the registry resolved through, <code>hub</code> by default'), presentation);
      assert.ok(!html.includes('`'), `a backtick is drawn in the ${presentation} presentation`);
    }
  });

  it('states the rule for the Global marker once, at the head of the per-setting shape', () => {
    const expanded = configPanelBodyHtml(model, 'expanded');
    const rule = 'A setting marked Global belongs to this machine rather than to one project, and the note on it says why.';
    assert.strictEqual(expanded.split(rule).length - 1, 1, 'the rule is not stated exactly once');
    assert.ok(expanded.indexOf(rule) < expanded.indexOf('class="config-row"'), 'the rule is not at the head of the settings');
    assert.ok(!configPanelBodyHtml(model, 'table').includes(rule), 'the table states the rule its shape does not draw');
    // A page with no setting the machine owns has no marker to explain.
    const none = configPanelBodyHtml(configPanelModel({ type: 'object', properties: { offline: SCHEMA.properties.offline } }, null), 'expanded');
    assert.ok(!none.includes(rule), 'the rule is stated where no setting carries the marker');
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
    // A keyed collection's entries are named, each carrying its fields.
    const map = control({ kind: 'map', itemFields: [control({ path: ['m', '<key>', 'catalog_dirs'] })] });
    assert.strictEqual(shapePhrase(map), 'named entries, each carrying catalog_dirs');
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
    const reported = effectiveValue(rowWith({
      control: control({ hasDefault: true, defaultValue: 'fallback' }),
      value: 'in force',
      provenance: { kind: 'file', path: '/ws/f.yaml' },
    }));
    assert.deepStrictEqual(reported, { kind: 'reported', value: 'in force' });

    const fallback = effectiveValue(rowWith({ control: control({ hasDefault: true, defaultValue: 'fallback' }) }));
    assert.deepStrictEqual(fallback, { kind: 'declared-default', value: 'fallback' });

    const neither = effectiveValue(rowWith({ control: control({ hasDefault: false }) }));
    assert.deepStrictEqual(neither, { kind: 'none' });
  });

  it('draws a schema sentence\'s code as code, and as plain words where no markup can go', () => {
    assert.strictEqual(codeHtml('write `workspace: {}` to mark a root'), 'write <code>workspace: {}</code> to mark a root');
    assert.strictEqual(plainText('write `workspace: {}` to mark a root'), 'write workspace: {} to mark a root');
    // A backtick with no partner is a backtick.
    assert.strictEqual(codeHtml('`a` and a lone ` here'), '<code>a</code> and a lone ` here');
    assert.strictEqual(plainText('`a` and a lone ` here'), 'a and a lone ` here');
    assert.strictEqual(codeHtml('no code at all'), 'no code at all');
  });
});

describe('the columns a reader resizes, in a document that runs no script', () => {
  const model = configPanelModel(SCHEMA, REPORT);
  const CSP_SOURCE = 'vscode-resource:';
  const html = configDocumentHtml({
    model,
    presentation: 'table',
    nonce: 'NONCE',
    styleUri: 'vscode-resource://media/config.css',
    cspSource: CSP_SOURCE,
  });

  // The stylesheet is read from the file the panel links, because whether a
  // heading can be dragged is decided there and nowhere in the markup.
  const css = fs.readFileSync(path.join(EXTENSION_ROOT, 'media', 'config.css'), 'utf8');

  // headings reads the table's header row back as the words each heading
  // carries and its opening tag, in the order drawn.
  function headings(page: string): [string, string][] {
    const head = page.match(/<thead>([\s\S]*?)<\/thead>/);
    assert.ok(head, 'the document draws no table header');
    return Array.from(head[1].matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th>/g))
      .map((m): [string, string] => [text(m[2]), m[1]]);
  }

  it('makes every labelled heading its column\'s grip, and draws the last heading without one', () => {
    // Written out rather than read from the source, so a heading dropped or
    // renamed there changes what is drawn without changing what is expected.
    const labelled = ['Setting', 'Name', 'Value', 'Takes', 'Source'];
    assert.deepStrictEqual(headings(html), [
      ...labelled.map((label): [string, string] => [label, `<th scope="col" class="${COLUMN_GRIP_CLASS}">`]),
      ['Description', '<th scope="col">'],
    ]);
  });

  it('resizes a heading carrying the grip by dragging, and adds nothing to it until then', () => {
    const grip = cssRuleBody(css, `.config-table th.${COLUMN_GRIP_CLASS}`);
    assert.ok(grip !== null, 'the stylesheet has no rule for the grip, so no heading can be dragged');
    assert.strictEqual(
      declarationOf(grip, 'resize'), 'horizontal',
      'a heading carrying the grip cannot be resized sideways',
    );
    // Resizing applies only to an element whose overflow is not visible.
    assert.strictEqual(
      declarationOf(grip, 'overflow'), 'hidden',
      'the grip\'s overflow is not hidden, so the resizing rule may apply to nothing',
    );
    // 🔴 NOTHING THAT TAKES ROOM. With nothing dragged the table must lay out as
    // it would without a grip, so the rule declares no size and no box edge of
    // its own.
    for (const property of ['width', 'min-width', 'max-width', 'padding', 'padding-right', 'margin', 'border', 'border-right']) {
      assert.strictEqual(
        declarationOf(grip, property), null,
        `the grip declares a ${property}, so the table no longer lays out as it does before a drag`,
      );
    }
    // The table is laid out from its content, which is what holds a column to
    // the width a drag sets on its heading. A fixed layout would size every
    // column from the header row alone, dragged or not.
    const table = cssRuleBody(css, '.config-table');
    assert.ok(table !== null, 'the stylesheet has no rule for the table');
    assert.strictEqual(declarationOf(table, 'width'), '100%', 'the rule read is not the table\'s own');
    assert.strictEqual(declarationOf(table, 'table-layout'), null, 'the table no longer lays out from its content');
  });

  it('lets a setting path, a value and a source break only where the document marks a place', () => {
    // 🔴 Nothing is allowed to break anywhere: a break in the middle of a word is
    // what the marked places exist to prevent.
    const path = cssRuleBody(css, '.config-path');
    assert.ok(path !== null, 'the stylesheet has no rule for a setting path');
    assert.strictEqual(declarationOf(path, 'overflow-wrap'), 'normal');
    assert.strictEqual(declarationOf(path, 'word-break'), 'keep-all');
    for (const cell of ['.config-cell-value', '.config-cell-source', '.config-cell-takes']) {
      const body = cssRuleBody(css, cell);
      assert.ok(body !== null, `the stylesheet has no rule for ${cell}`);
      assert.strictEqual(declarationOf(body, 'overflow-wrap'), 'normal', cell);
      assert.strictEqual(declarationOf(body, 'word-break'), 'keep-all', cell);
    }
    const column = cssRuleBody(css, '.config-table td:first-child');
    assert.ok(column !== null, 'the stylesheet has no rule for the Setting column');
    assert.strictEqual(declarationOf(column, 'overflow-wrap'), null, 'the Setting column breaks anywhere');
    // The caption wraps to the panel's own width, less the page's margins.
    const caption = cssRuleBody(css, '.config-caption');
    assert.ok(caption !== null, 'the stylesheet has no rule for the caption');
    assert.strictEqual(declarationOf(caption, 'max-width'), 'min(100%, calc(100vw - 4rem))');
  });

  it('reads the stylesheet the panel loads', () => {
    // The needle on the file read above: the panel links this stylesheet, so
    // what its rules say is what a reader is drawn through.
    const compose = blockAfter(sourceOf('src/config-view.ts'), 'const compose = ');
    assert.ok(
      compose !== null && compose.includes('configDocumentHtml('),
      'the composition of the panel\'s document was not found',
    );
    assert.ok(
      compose.includes(`'media', 'config.css'`),
      'the panel links a different stylesheet from the one read here',
    );
  });

  it('admits no script source, draws no script, and is created with scripts off', () => {
    const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
    assert.ok(policy, 'the document carries no content policy');
    assert.strictEqual(
      policy[1],
      `default-src 'none'; style-src ${CSP_SOURCE}; font-src ${CSP_SOURCE}`,
      'the content policy is not the stylesheet-and-font policy with no script source',
    );
    assert.strictEqual(Array.from(html.matchAll(/<script/g)).length, 0, 'the document carries a script');

    const view = sourceOf('src/config-view.ts');
    const options = blockAfter(view, 'vscode.window.createWebviewPanel(');
    assert.ok(options !== null, 'the panel\'s creation was not found');
    // The needle on the extraction: the options end with the resource roots, so
    // a block that stopped short fails here rather than reporting an absence.
    assert.ok(
      options.includes('localResourceRoots:'),
      'the extracted block is not the whole of the panel\'s options',
    );
    assert.strictEqual(
      options.match(/\benableScripts:\s*([^,\s]+),/)?.[1], 'false',
      'the panel is created with scripts on',
    );
    assert.strictEqual(
      options.match(/\benableCommandUris:\s*(\[[^\]]*\])/)?.[1], '[PRESENTATION_TOGGLE_COMMAND]',
      'the panel admits command links other than the one control\'s',
    );
    // One creation and one statement about scripts in the whole module, so
    // nothing else in it turns them on.
    assert.strictEqual(view.split('createWebviewPanel(').length - 1, 1, 'the module creates a second panel');
    assert.strictEqual(
      view.split('enableScripts').length - 1, 1,
      'the module states whether scripts run somewhere other than the panel\'s creation',
    );
  });
});

describe('what a press ends in when the configuration cannot be read', () => {
  // The words are written out rather than composed from the module's own
  // constants, so a change of wording is reported here rather than followed.
  const NOT_RUNNING_NOTICE = 'The configuration surface could not be drawn: the Aggrega language server is not running';
  const STARTING_NOTICE = 'The configuration surface could not be drawn: the Aggrega language server is starting';

  // Refusals worded every way a reader could meet one: in the words the request
  // helpers use when no server runs, in other words, from the transport, and as
  // something that is not an error at all.
  const REFUSALS: readonly unknown[] = [
    new Error('the Aggrega language server is not running'),
    new Error('daemon is Stopped'),
    { code: -32603, message: 'the schema could not be served' },
    'refused',
  ];

  it('says the server is not running and offers the start the status bar offers, whatever the refusal says', () => {
    for (const err of REFUSALS) {
      const notice = configUnreadNotice('notRunning', err);
      assert.strictEqual(notice.message, NOT_RUNNING_NOTICE, `the notice for ${JSON.stringify(String(err))}`);
      assert.deepStrictEqual(
        notice.action,
        { label: DAEMON_ACTION_LABEL[daemonStandingAction('notRunning')], command: RESTART_COMMAND },
        'the act offered is not the status bar\'s start, through the start-or-restart command',
      );
    }
  });

  it('says the server is starting in the status bar\'s word for it, and offers nothing, whatever the refusal says', () => {
    for (const err of REFUSALS) {
      assert.deepStrictEqual(
        configUnreadNotice('starting', err),
        { message: STARTING_NOTICE, action: null },
        `the notice for ${JSON.stringify(String(err))} with the server starting`,
      );
    }
  });

  it('tells a refusal with the server running in its own words, and offers nothing even where the words say not running', () => {
    assert.deepStrictEqual(
      configUnreadNotice('running', new Error('the Aggrega language server is not running')),
      { message: NOT_RUNNING_NOTICE, action: null },
      'a refusal worded as not running, with the server running, earns the start',
    );
    assert.deepStrictEqual(
      configUnreadNotice('running', new Error('the schema could not be served')),
      { message: 'The configuration surface could not be drawn: the schema could not be served', action: null },
      'a refusal with the server running is not told in its own words',
    );
    // The transport's refusal is told with its code, as every other surface
    // tells one, rather than as an object's name.
    assert.deepStrictEqual(
      configUnreadNotice('running', { code: -32603, message: 'the schema could not be served' }),
      { message: 'The configuration surface could not be drawn: the schema could not be served', action: null },
    );
  });
});
