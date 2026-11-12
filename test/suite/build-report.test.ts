// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import { BuildReport, buildReportLines } from '../../src/build-report';
import { BuildPreviewResponse, BuildResponse, DependencyResolutionReport } from '../../src/types';

// What a build's answer puts on the output channel, read back with no editor
// running: the resolution the build ran first, the advisories that carry no
// document position, and the files — in that order, and each in the answer's own
// values. What no test here can reach is whether the language server sends the
// report at all; the editor suite holds the channel against the server's own
// answer to the same build for that.
//
// 🔴 EVERY EXPECTED LINE IS WRITTEN OUT LITERALLY rather than derived from the
// module under test. A comparison whose expected side is composed by the same
// function it checks agrees with itself whatever that function writes, so a
// report dropped, reordered or reworded on both sides at once would pass.

// RESOLVED is shaped as the language server answers an auto-pull build of a
// Release whose closure reaches every axis the report carries: a reference with a
// kind, one without, one that resolved to no version, a library and a plugin —
// each naming where this run took it from, between them in every word the
// compiler prints for a source.
const RESOLVED: DependencyResolutionReport = {
  lockfile: 'examples/demo/release-compose.lock',
  entities: [
    { uri: 'aggregate', version: '', source: 'external' },
    { uri: 'compose/adminer:1.0.0', version: '1.0.0', kind: 'Recipe', source: 'local' },
    { uri: 'core/devtool/adminer', version: '1.0.0', source: 'fetched-fresh' },
    { uri: 'manifest-compose', version: '', source: 'external' },
  ],
  libraries: [{ uri: 'core/schemas/common:2.0.0', version: '2.0.0', kind: 'SchemaLibrary', source: 'cache-reuse' }],
  plugins: [{ uri: 'provider/compose', version: '0.7.4', kind: 'Plugin', source: 'in-binary' }],
  sourceArtifacts: 1,
  trustedPlugins: 0,
  externalInputs: 2,
};

// RULED_RESOLUTION is what the channel lists for RESOLVED: every pinned reference
// in the report's order — entities, then libraries, then plugins — each closed by
// the answer's word for its source, and then the command line's own summary of a
// completed resolution, whose entity count is the entities alone, as the command
// line counts it.
const RULED_RESOLUTION = [
  '  pinned aggregate, source: external',
  '  pinned compose/adminer:1.0.0 at 1.0.0 (Recipe), source: local',
  '  pinned core/devtool/adminer at 1.0.0, source: fetched-fresh',
  '  pinned manifest-compose, source: external',
  '  pinned core/schemas/common:2.0.0 at 2.0.0 (SchemaLibrary), source: cache-reuse',
  '  pinned provider/compose at 0.7.4 (Plugin), source: in-binary',
  '  Pull complete: examples/demo/release-compose.lock (entities=4, source_artifacts=1, external_inputs=2)',
];

const NOTICES = [
  { class: 'dependency-resolution', text: 'reuse: kept the pin on compose/adminer:1.0.0' },
  { class: '', text: 'an advisory whose surface the server does not name' },
  { class: 'deprecation', text: 'core/devtool/adminer 1.0.0 is deprecated' },
];
const RULED_NOTICES = [
  '  dependency-resolution: reuse: kept the pin on compose/adminer:1.0.0',
  '  an advisory whose surface the server does not name',
  '  deprecation: core/devtool/adminer 1.0.0 is deprecated',
];

const FILES = ['app/compose/docker-compose.yaml', 'app/compose/.env'];
const RULED_FILES = ['  app/compose/docker-compose.yaml', '  app/compose/.env'];

const answer = (over: Partial<BuildResponse>): BuildResponse =>
  ({ outputDirectory: '/tmp/fixture/dist', files: FILES, notices: NOTICES, dependencyResolution: RESOLVED, ...over });

describe('what a build answer puts on the output channel', () => {
  it('🔴 lists the resolution first, then the advisories, then the files', () => {
    // The whole sequence, as an equality. A reading that looked for the
    // resolution's lines anywhere would pass a report that put them after the
    // files, where a reader scrolling back from the files never reaches them.
    assert.deepStrictEqual(
      buildReportLines(answer({})),
      [...RULED_RESOLUTION, ...RULED_NOTICES, ...RULED_FILES],
      'a build that resolved its dependencies first is reported in some other order or other words',
    );
  });

  it('🔴 names no source where the answer names none, and prints a word it has not met as it arrived', () => {
    // A reference whose run recorded no source arrives with no word for it, and
    // its line ends where the reference does: nothing is supplied in the word's
    // place, and an empty word says no more than an absent one. A word outside
    // the ones the compiler prints today is the compiler's to add, so it is shown
    // as the answer spells it rather than dropped.
    const report: DependencyResolutionReport = {
      ...RESOLVED,
      entities: [
        { uri: 'core/devtool/adminer', version: '1.0.0' },
        { uri: 'compose/adminer:1.0.0', version: '1.0.0', kind: 'Recipe', source: '' },
        { uri: 'core/observability/prometheus', version: '1.0.0', source: 'mirrored' },
      ],
      libraries: null,
      plugins: null,
    };
    assert.deepStrictEqual(
      buildReportLines({ files: [], dependencyResolution: report }),
      [
        '  pinned core/devtool/adminer at 1.0.0',
        '  pinned compose/adminer:1.0.0 at 1.0.0 (Recipe)',
        '  pinned core/observability/prometheus at 1.0.0, source: mirrored',
        '  Pull complete: examples/demo/release-compose.lock (entities=3, source_artifacts=1, external_inputs=2)',
      ],
      'a reference the answer names no source for is given one, or a word the answer carries is dropped or reworded',
    );
  });

  it('lists nothing for a resolution where the build ran none', () => {
    // A build that did not resolve carries no report, and the channel says
    // nothing about one: the advisories and the files, and only those.
    assert.deepStrictEqual(
      buildReportLines(answer({ dependencyResolution: undefined })),
      [...RULED_NOTICES, ...RULED_FILES],
      'a build that resolved nothing lists a resolution anyway, or loses a line of its own',
    );
    // A negative control on the absence: the same answer carrying the report
    // lists it, so the reading above measures the report's absence rather than
    // a function that never lists one.
    assert.ok(
      buildReportLines(answer({})).length > RULED_NOTICES.length + RULED_FILES.length,
      'the report is not listed even where the answer carries it, so its absence above proves nothing',
    );
  });

  it('counts the recorded plugin identities only where there are any, as the command line does', () => {
    const lines = buildReportLines(answer({ dependencyResolution: { ...RESOLVED, trustedPlugins: 3 }, notices: [], files: [] }));
    assert.strictEqual(
      lines[lines.length - 1],
      '  Pull complete: examples/demo/release-compose.lock (entities=4, source_artifacts=1, external_inputs=2, trusted_plugins=3)',
      'a resolution that recorded plugin identities does not say how many',
    );
    assert.ok(
      !buildReportLines(answer({})).some((l) => l.includes('trusted_plugins')),
      'a resolution that recorded no plugin identities counts them anyway',
    );
  });

  it('says beside the lockfile when the external inputs were not all discovered, in the answer\'s own words', () => {
    const stopped = 'the discovery render stopped: provider/compose refused the Release';
    const lines = buildReportLines(answer({ dependencyResolution: { ...RESOLVED, incompleteExternalInputs: stopped }, notices: [], files: [] }));
    assert.deepStrictEqual(
      lines.slice(-2),
      [
        '  Pull complete: examples/demo/release-compose.lock (entities=4, source_artifacts=1, external_inputs=2)',
        `  External inputs were not fully discovered: dependency pins are complete, external-input pins may not be: ${stopped}`,
      ],
      'a resolution that could not finish discovering its external inputs reads as a complete pin set',
    );
  });

  it('reads the empty collections the wire sends as null', () => {
    // The wire sends an empty list as null, and the two say the same thing.
    const empty: DependencyResolutionReport = { ...RESOLVED, entities: null, libraries: null, plugins: null };
    assert.deepStrictEqual(
      buildReportLines(answer({ dependencyResolution: empty, notices: undefined, files: null })),
      ['  Pull complete: examples/demo/release-compose.lock (entities=0, source_artifacts=1, external_inputs=2)'],
      'a report with nothing pinned, no advisories and no files is listed as something other than its lockfile',
    );
  });

  it('reports the preview\'s answer through the same routing', () => {
    // Both build requests raise the same advisories in the same shape, so one
    // routing serves both, and the preview's answer carries no resolution
    // because a request that writes nothing wrote no lockfile.
    const preview: BuildPreviewResponse = { files: FILES, notices: NOTICES };
    const report: BuildReport = preview;
    assert.deepStrictEqual(
      buildReportLines(report),
      [...RULED_NOTICES, ...RULED_FILES],
      'the preview\'s answer is reported in some other order or other words',
    );
  });
});
