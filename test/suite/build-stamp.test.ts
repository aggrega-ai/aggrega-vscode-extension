// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BUILD_STAMP_SEGMENTS,
  buildStampPath,
  formatBuildStamp,
  parseBuildStamp,
  readBuildStamp,
} from '../../src/build-stamp';
import { EVERYTHING_MET, stepReadings } from '../../src/get-started-steps';
import {
  EXTENSION_VERSION_LABEL,
  VersionStandings,
  welcomeDocumentHtml,
} from '../../src/welcome-render';
import { VERSION_ABSENT } from '../../src/version-words';
import { callArguments, functionBody } from '../helpers/anchoring-census';
import {
  extensionOwnSources,
  gitProvenanceReading,
  gitProvenanceReadings,
  manifestFieldReaders,
  manifestImporters,
} from '../helpers/build-stamp-census';
import { EXTENSION_ROOT, readSourceTree } from '../helpers/launch-census';

// The welcome page's Extension reading is the build's own account of which build
// it is. These specs hold the three things that make that reading true: the
// stamp a compile writes is the stamp the page reads, the page never shows the
// manifest's number in its place, and the value comes from the compiler's recipe
// rather than from anything the extension derives itself.

const readUtf8 = (file: string): string => fs.readFileSync(file, 'utf8');

// withCopy runs one reading against a scratch copy of the extension's layout, so
// what is asserted is the reading of a root the spec built rather than of the
// working tree the spec happens to run in.
function withCopy<T>(populate: (root: string) => void, read: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-build-stamp-'));
  try {
    populate(root);
    return read(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeStamp(root: string, text: string): void {
  const file = buildStampPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// composedPage composes the whole welcome page with the extension's reading
// taken from one copy's stamp, exactly as the running extension hands it over.
function composedPage(extension: string | null): string {
  const versions: VersionStandings = { extension, compiler: null };
  return welcomeDocumentHtml({
    nonce: 'test-nonce',
    styleUri: 'vscode-resource://media/welcome.css',
    scriptUri: 'vscode-resource://media/welcome.js',
    cspSource: 'vscode-resource:',
    readings: stepReadings(EVERYTHING_MET),
    collapsed: [],
    opensWithEditor: true,
    versions,
    server: { reading: 'notRunning', version: null },
  });
}

// extensionEntry is what the composed page shows beside the Extension label, or
// null where the page carries no such entry at all. It is an EQUALITY reading
// rather than a presence: a value that appeared anywhere else on the page must
// not satisfy it.
function extensionEntry(html: string): string | null {
  const entry = new RegExp(
    `<span class="version-entry">${EXTENSION_VERSION_LABEL} <span class="[^"]*">([^<]*)</span></span>`,
  ).exec(html);
  return entry ? entry[1] : null;
}

describe('the welcome page says which build of the extension is running', () => {
  // The shapes are the ones the compiler's recipe produces: a bare commit where
  // the repository carries no tag, a tag with the commits since it, a tag alone,
  // an edited tree, and a tree that could not be asked.
  const SHAPES = ['d3b17b9', '0.7.3-39-g1eb837f2', '9.9.9', 'd3b17b9-dirty', 'dev'];

  it('reads back the value a stamp was written with, from the copy it is pointed at', () => {
    for (const shape of SHAPES) {
      const read = withCopy((root) => writeStamp(root, formatBuildStamp(shape)), (root) => readBuildStamp(root, readUtf8));
      assert.strictEqual(read, shape, `a stamp written as ${shape} read back as ${String(read)}`);
    }
  });

  it('shows the stamped value as the Extension reading on the composed page', () => {
    for (const shape of SHAPES) {
      const html = withCopy(
        (root) => writeStamp(root, formatBuildStamp(shape)),
        (root) => composedPage(readBuildStamp(root, readUtf8)),
      );
      assert.strictEqual(extensionEntry(html), shape);
    }
  });

  // 🔴 A COPY WITHOUT A STAMP IS NOT REPORTED, AND ITS MANIFEST IS NOT READ IN THE
  // STAMP'S PLACE. The copy built here carries a manifest with a version and no
  // stamp, which is exactly the shape in which falling back to the manifest would
  // look helpful — and would show every build made between two releases as the
  // same one.
  it('shows the version as not reported where the copy carries no stamp, never the manifest version', () => {
    const MANIFEST_VERSION = '0.1.0';
    const populate = (root: string): void => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: MANIFEST_VERSION }));
    };
    const read = withCopy(populate, (root) => readBuildStamp(root, readUtf8));
    assert.strictEqual(read, null, `a copy with no stamp read as ${String(read)}`);
    const html = withCopy(populate, (root) => composedPage(readBuildStamp(root, readUtf8)));
    assert.strictEqual(extensionEntry(html), VERSION_ABSENT);
    assert.ok(
      !html.includes(MANIFEST_VERSION),
      'the page carries the manifest\'s version although the copy it describes carries no stamp',
    );
  });

  it('reads nothing from a stamp it would not have written', () => {
    for (const text of ['', 'd3b17b9', '{', 'null', '[]', '{}', '{"version": ""}', '{"version": 7}']) {
      assert.strictEqual(parseBuildStamp(text), null, `the text ${JSON.stringify(text)} read as a build`);
    }
    const html = withCopy((root) => writeStamp(root, '{'), (root) => composedPage(readBuildStamp(root, readUtf8)));
    assert.strictEqual(extensionEntry(html), VERSION_ABSENT);
  });

  // The stamp sits under the compiled output, which the repository ignores and
  // the packaged extension carries apart from its tests.
  it('sits in the compiled output, outside the parts the package leaves out', () => {
    assert.strictEqual(BUILD_STAMP_SEGMENTS[0], 'out');
    assert.ok(
      !['test', 'test-fixtures'].includes(BUILD_STAMP_SEGMENTS[1]),
      'the stamp sits in a part of the compiled output the package leaves out',
    );
  });
});

describe('every compile stamps the build', () => {
  const scripts = (): Record<string, string> =>
    JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')).scripts;

  // The development launch and the packaging tool's prepublish step both run
  // this one script, so its last step is what each of their builds carries.
  it('runs the stamp as the compile\'s last step, and packaging runs the compile', () => {
    const steps = scripts().compile.split('&&').map((step) => step.trim());
    assert.strictEqual(steps[steps.length - 1], 'npm run stamp-build-version');
    assert.strictEqual(scripts()['stamp-build-version'], 'node build/stamp-build-version.js');
    assert.strictEqual(scripts()['vscode:prepublish'], 'npm run compile');
  });

  // 🔴 THE WRITER TAKES THE STAMP'S PLACE AND SHAPE FROM THE READER'S MODULE, AND
  // THE VALUE FROM THE COMPILER'S RECIPE. Either spelled a second time would agree
  // until one of them was edited.
  it('writes where the reader reads, with the value the compiler\'s recipe gives', () => {
    const script = fs.readFileSync(path.join(EXTENSION_ROOT, 'build', 'stamp-build-version.js'), 'utf8');
    assert.ok(script.includes('\'build-stamp.js\''), 'the stamp script no longer loads the reader\'s module');
    assert.ok(script.includes('buildStampPath(root)'), 'the stamp script no longer asks the reader where the stamp sits');
    assert.ok(script.includes('formatBuildStamp(version)'), 'the stamp script no longer asks the reader what the stamp holds');
    assert.ok(
      script.includes('\'../aggrega-cli/scripts/lib/build-version.sh\''),
      'the stamp script no longer names the compiler\'s recipe',
    );
  });
});

describe('the extension\'s reading of its build has one source', () => {
  // 🔴 THE CALIBRATION COMES FIRST. A pattern that has stopped matching reports
  // every module clean, so the neighbouring read of the compatibility range —
  // which provably exists — is what says the absence beside it means anything.
  it('reads no module\'s manifest version in place of the stamp', () => {
    const sources = readSourceTree();
    assert.deepStrictEqual(
      manifestFieldReaders(sources, 'aggregaCompatibility'),
      ['extension.ts'],
      'the instrument no longer finds the manifest read it was calibrated on, so what it reports '
      + 'about the version means nothing',
    );
    assert.deepStrictEqual(
      manifestFieldReaders(sources, 'version'),
      [],
      'a module reads the manifest\'s version, which is the same for every build between two releases',
    );
    assert.deepStrictEqual(manifestImporters(sources), [], 'a module loads the manifest file itself');
  });

  it('hands the page the stamp of the copy the editor loaded', () => {
    const body = functionBody('src/extension.ts', 'async function readRunningVersions(');
    assert.ok(body.includes('readBuildStamp('), 'the page\'s reading no longer comes from the build stamp');
    const calls = callArguments('src/extension.ts', 'readBuildStamp');
    assert.strictEqual(calls.length, 1, `the stamp is read at ${calls.length} sites rather than one`);
    assert.match(calls[0][0], /\.extensionPath$/, `the stamp is read from ${calls[0][0]}, not from the loaded copy`);
  });

  // 🔴 NO SECOND READING OF THE TREE ANYWHERE IN THE EXTENSION. The format of the
  // build's provenance is the compiler's recipe's to decide, and a reading the
  // extension held of its own would be a second home for it. Both controls come
  // first: the pattern has to match the recipe's own questions, and the corpus
  // has to hold every part of the extension it claims to read.
  //
  // The command is held apart from its questions below so that no line of this
  // file matches the pattern: the spec stays inside the corpus it measures.
  it('asks git nothing of its own, in any file the extension authors', () => {
    const tool = 'git';
    const recipeQuestions = [
      `${tool} describe --tags --always --dirty`,
      `${tool} rev-parse --short HEAD`,
      `execFile('${tool}', ['describe', '--tags'])`,
    ];
    for (const question of recipeQuestions) {
      assert.ok(gitProvenanceReading().test(question), `the pattern no longer matches ${question}`);
    }
    const corpus = extensionOwnSources();
    const files = corpus.map(([file]) => file);
    for (const expected of [
      'package.json',
      'src/extension.ts',
      'src/build-stamp.ts',
      'build/copy-vendor-assets.js',
      'build/stamp-build-version.js',
      'scripts/vsix.js',
      '.github/workflows/package-and-publish.yml',
      'test/suite/build-stamp.test.ts',
      'test/helpers/build-stamp-census.ts',
      'test/helpers/launch-census.ts',
    ]) {
      assert.ok(files.includes(expected), `the census does not read ${expected}`);
    }
    const script = corpus.find(([file]) => file === 'build/stamp-build-version.js');
    assert.ok(
      script !== undefined && script[1].includes('build-version.sh'),
      'the census lists the stamp script without reading what it holds',
    );
    assert.deepStrictEqual(
      gitProvenanceReadings(corpus),
      [],
      'these lines ask git about the tree themselves rather than sourcing the compiler\'s recipe',
    );
  });
});
