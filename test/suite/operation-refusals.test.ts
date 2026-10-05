// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OperationCancelled } from '../../src/cancellation';
import { ConvertedShape, DIAGNOSTIC_SOURCE_FALLBACK } from '../../src/diagnostics-shape';
import { DaemonErrorContext, handleDaemonError, refusalEntry } from '../../src/error-surfaces';
import {
  RefusalFiling,
  RefusalSink,
  Settled,
  createOperationRefusals,
  filingsForAnswer,
} from '../../src/operation-refusals';
import { ERR_ENTITY_NOT_RESOLVABLE, ERR_LOCKFILE_ABSENT, ERR_SHUTTING_DOWN, JsonRpcError } from '../../src/types';
import { assignmentsTo, callArguments, functionBody } from '../helpers/anchoring-census';
import { EXTENSION_ROOT, readSourceTree } from '../helpers/launch-census';

// What the refusal of a build, a preview or a graph leaves in the Problems panel,
// and for how long: one Release's answers replace one another, a refusal for a
// dependency that does not resolve stands on the document it is about until the
// Release is answered without it, and a request that never answered changes
// nothing. The decision is driven here with no editor; how the extension hands
// it every answer, and where it keeps a document's own refusals instead, is read
// off the source, since the modules holding that wiring import the editor.

const RELEASE = 'release.yaml';
const OTHER_RELEASE = 'envs/staging.yaml';

// The words the language server answers a Build with when a Manifest maps a type
// to a Recipe no catalog holds, as the pinned server words them.
const UNRESOLVED = 'resolve: no entity in the catalog matches this URI: entity "no-such-recipe:1.0.0" (referenced from manifest.spec.mappings.features.type.core/secret-value:1.0.0)';

function refused(code: number, data?: JsonRpcError['data']): Settled {
  return { thrown: data === undefined ? { code, message: UNRESOLVED } : { code, message: UNRESOLVED, data } };
}

// Problems is a stand-in for the collection: what each document shows, and how
// often it was cleared.
class Problems implements RefusalSink {
  readonly shown = new Map<string, ConvertedShape[]>();
  clears = 0;
  set(document: string, entries: ConvertedShape[]): void { this.shown.set(document, entries); }
  delete(document: string): void { this.shown.delete(document); }
  clear(): void { this.shown.clear(); this.clears += 1; }
  reading(): Record<string, string[]> {
    return Object.fromEntries([...this.shown].sort(([a], [b]) => a.localeCompare(b)).map(([d, es]) => [d, es.map((e) => `${e.startLine + 1}:${e.startChar + 1} ${e.message}`)]));
  }
}

function entry(message: string, line = 1): ConvertedShape {
  return { startLine: line - 1, startChar: 0, endLine: line - 1, endChar: 0, severity: 'error', message, source: DIAGNOSTIC_SOURCE_FALLBACK };
}

describe('what one answer for a Release files', () => {
  it('files the refusal of a dependency that does not resolve on the document it names, in the words and at the place the routing gives it', () => {
    const settled = refused(ERR_ENTITY_NOT_RESOLVABLE, { file: 'manifest.yaml', line: 12, column: 7 });
    const err = (settled as { thrown: JsonRpcError }).thrown;
    assert.deepStrictEqual(filingsForAnswer(settled, RELEASE), [{ document: 'manifest.yaml', entry: refusalEntry(err) }]);
    assert.strictEqual(refusalEntry(err)!.startLine, 11);
  });

  it('files it on the lockfile the refusal names where it names no document, and on the Release where it names neither', () => {
    assert.deepStrictEqual(
      [
        filingsForAnswer(refused(ERR_ENTITY_NOT_RESOLVABLE, { lockfile: 'release.lock' }), RELEASE)?.map((f) => f.document),
        filingsForAnswer(refused(ERR_ENTITY_NOT_RESOLVABLE), RELEASE)?.map((f) => f.document),
        filingsForAnswer(refused(ERR_ENTITY_NOT_RESOLVABLE, { file: '' }), RELEASE)?.map((f) => f.document),
      ],
      [['release.lock'], [RELEASE], [RELEASE]],
    );
  });

  it('files nothing for an answer that completed, or a refusal whose surface is not an entry, so what stood leaves', () => {
    assert.deepStrictEqual(
      [
        filingsForAnswer({ answered: { files: [] } }, RELEASE),
        filingsForAnswer({ answered: undefined }, RELEASE),
        filingsForAnswer(refused(ERR_LOCKFILE_ABSENT, { lockfile: 'release.lock', release: RELEASE }), RELEASE),
        filingsForAnswer(refused(-32603, { file: 'recipe.yaml', line: 14, column: 3 }), RELEASE),
      ],
      [[], [], [], []],
    );
  });

  it('replaces nothing for a request that never answered: one the reader stopped, or one whose server went', () => {
    assert.deepStrictEqual(
      [
        filingsForAnswer({ thrown: new OperationCancelled('The build') }, RELEASE),
        filingsForAnswer({ thrown: new Error('daemon restarted') }, RELEASE),
        filingsForAnswer({ thrown: 'not an answer at all' }, RELEASE),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('decides the same entry a document\'s own request is filed as', () => {
    // One home for "which refusal is an entry, and what it reads": the operation's
    // filing and the per-code routing of a document's own request agree because
    // both read it there.
    const err: JsonRpcError = { code: ERR_ENTITY_NOT_RESOLVABLE, message: UNRESOLVED, data: { file: 'aggregate.yaml', line: 3, column: 5, end_line: 3, end_column: 9 } };
    const published: ConvertedShape[][] = [];
    const ctx = { uri: { toString: () => 'file:///aggregate.yaml' }, whoAsked: 'nobody', publishShape: (_u: unknown, shapes: ConvertedShape[]) => { published.push(shapes); } } as unknown as DaemonErrorContext;
    assert.strictEqual(handleDaemonError(err, ctx), 'surfaced');
    assert.deepStrictEqual(published, [[filingsForAnswer({ thrown: err }, RELEASE)![0].entry]]);
  });
});

describe('what the Problems panel shows across a Release\'s answers', () => {
  const answer = (refusals: ReturnType<typeof createOperationRefusals>, release: string, settled: Settled): void => {
    const filings = filingsForAnswer(settled, release);
    if (filings !== undefined) { refusals.replace(release, filings); }
  };

  it('keeps a refusal until the Release is answered without it, through a request that never answered', () => {
    const problems = new Problems();
    const refusals = createOperationRefusals(problems);
    answer(refusals, RELEASE, refused(ERR_ENTITY_NOT_RESOLVABLE));
    const afterRefusal = problems.reading();
    answer(refusals, RELEASE, { thrown: new OperationCancelled('The build') });
    const afterStop = problems.reading();
    answer(refusals, RELEASE, refused(ERR_ENTITY_NOT_RESOLVABLE));
    const afterSecondRefusal = problems.reading();
    answer(refusals, RELEASE, { answered: {} });
    assert.deepStrictEqual(
      { afterRefusal, afterStop, afterSecondRefusal, afterCompletion: problems.reading(), holds: refusals.holds(RELEASE) },
      {
        afterRefusal: { [RELEASE]: [`1:1 ${UNRESOLVED}`] },
        afterStop: { [RELEASE]: [`1:1 ${UNRESOLVED}`] },
        afterSecondRefusal: { [RELEASE]: [`1:1 ${UNRESOLVED}`] },
        afterCompletion: {},
        holds: false,
      },
    );
  });

  it('keeps a refusal through a refusal from a server shutting down, which says nothing about the Release', () => {
    // As the server words it: every request it is sent once it is shutting down
    // is refused with these words, before it is read.
    const shuttingDown: Settled = { thrown: { code: ERR_SHUTTING_DOWN, message: 'daemon shutting down' } };
    const problems = new Problems();
    const refusals = createOperationRefusals(problems);
    answer(refusals, RELEASE, refused(ERR_ENTITY_NOT_RESOLVABLE));
    const filed = filingsForAnswer(shuttingDown, RELEASE);
    answer(refusals, RELEASE, shuttingDown);
    assert.deepStrictEqual(
      { filed, reading: problems.reading(), holds: refusals.holds(RELEASE) },
      { filed: undefined, reading: { [RELEASE]: [`1:1 ${UNRESOLVED}`] }, holds: true },
    );
  });

  it('takes the entry away when the Release is refused for something else, and moves it when the refusal names another document', () => {
    const problems = new Problems();
    const refusals = createOperationRefusals(problems);
    answer(refusals, RELEASE, refused(ERR_ENTITY_NOT_RESOLVABLE));
    answer(refusals, RELEASE, refused(ERR_ENTITY_NOT_RESOLVABLE, { file: 'manifest.yaml', line: 4, column: 3 }));
    const moved = problems.reading();
    answer(refusals, RELEASE, refused(ERR_LOCKFILE_ABSENT, { lockfile: 'release.lock', release: RELEASE }));
    assert.deepStrictEqual({ moved, afterAnotherRefusal: problems.reading() }, {
      moved: { 'manifest.yaml': [`4:3 ${UNRESOLVED}`] },
      afterAnotherRefusal: {},
    });
  });

  it('keeps one Release\'s entries when another Release is answered, and shows an entry two Releases filed alike once', () => {
    const problems = new Problems();
    const refusals = createOperationRefusals(problems);
    refusals.replace(RELEASE, [{ document: 'manifest.yaml', entry: entry('shared', 2) }, { document: RELEASE, entry: entry('own') }]);
    refusals.replace(OTHER_RELEASE, [{ document: 'manifest.yaml', entry: entry('shared', 2) }, { document: 'manifest.yaml', entry: entry('other', 5) }]);
    const both = problems.reading();
    refusals.replace(RELEASE, []);
    const otherOnly = problems.reading();
    refusals.replace(OTHER_RELEASE, []);
    assert.deepStrictEqual({ both, otherOnly, none: problems.reading() }, {
      both: { 'manifest.yaml': ['2:1 shared', '5:1 other'], [RELEASE]: ['1:1 own'] },
      otherOnly: { 'manifest.yaml': ['2:1 shared', '5:1 other'] },
      none: {},
    });
  });

  it('forgets every entry when a new language server starts, and keeps nothing to bring back', () => {
    const problems = new Problems();
    const refusals = createOperationRefusals(problems);
    const filed: RefusalFiling[] = [{ document: 'manifest.yaml', entry: entry('one') }];
    refusals.replace(RELEASE, filed);
    refusals.replace(OTHER_RELEASE, [{ document: OTHER_RELEASE, entry: entry('two') }]);
    refusals.clear();
    const cleared = { reading: problems.reading(), clears: problems.clears, holds: [refusals.holds('manifest.yaml'), refusals.holds(OTHER_RELEASE)] };
    // A later answer for one Release shows that Release's entries and nothing the
    // stopped server's answers filed for the other.
    refusals.replace(RELEASE, filed);
    assert.deepStrictEqual({ cleared, after: problems.reading() }, {
      cleared: { reading: {}, clears: 1, holds: [false, false] },
      after: { 'manifest.yaml': ['1:1 one'] },
    });
  });
});

describe('the extension hands the replacement every answer, and keeps a document\'s own refusals apart', () => {
  const EXTENSION = 'src/extension.ts';
  const METHODS = ['aggrega/build', 'aggrega/buildPreview', 'aggrega/irGraph'];

  // closingParen returns the offset of the parenthesis closing the one at open.
  const closingParen = (source: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') { depth += 1; }
      if (source[i] === ')') { depth -= 1; if (depth === 0) { return i; } }
    }
    throw new Error(`unbalanced ( at offset ${open}`);
  };

  it('sends every build, preview and graph request in the source through answeredFor', () => {
    const sites: Array<{ file: string; method: string; line: number; through: boolean }> = [];
    for (const [file, source] of readSourceTree()) {
      const wrappers = [...source.matchAll(/(?:^|[^A-Za-z0-9_$.])answeredFor\s*\(/g)].map((m) => {
        const open = source.indexOf('(', m.index! + m[0].length - 1);
        return [open, closingParen(source, open)] as const;
      });
      for (const m of source.matchAll(/'(aggrega\/(?:build|buildPreview|irGraph))'/g)) {
        sites.push({
          file,
          method: m[1],
          line: source.slice(0, m.index).split('\n').length,
          through: wrappers.some(([open, close]) => m.index! > open && m.index! < close),
        });
      }
    }
    // The census fires: every one of the three methods is sent from somewhere.
    assert.deepStrictEqual([...new Set(sites.map((s) => s.method))].sort(), METHODS);
    assert.deepStrictEqual(sites.filter((s) => !s.through), [], 'a request of one of the three methods is sent without its answer reaching the replacement');
  });

  it('keeps the replacement in a collection of its own, outside the per-layer registry', () => {
    assert.deepStrictEqual(assignmentsTo(EXTENSION, 'operationRefusals'), ['operationRefusalsIn(refusals)']);
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, EXTENSION), 'utf8');
    assert.ok(
      source.includes('const refusals = vscode.languages.createDiagnosticCollection(OPERATION_REFUSALS_COLLECTION);'),
      'the refusals of a build, a preview or a graph are not kept in a collection created for them',
    );
  });

  it('files a document\'s own refusal in the document-validation layer\'s collection, and an operation\'s nowhere but the replacement', () => {
    // The document's own requests — its validation, a hover, a completion — route
    // through a context bound to that layer's collection.
    const context = functionBody(EXTENSION, 'function buildErrorContext(');
    assert.ok(context.includes('const collection = diagnosticCollections.for(DIAGNOSTIC_SOURCE_FALLBACK);'), 'a document\'s own refusal is not filed beside its validation findings');
    assert.deepStrictEqual(callArguments(EXTENSION, 'buildErrorContext'), [
      ['doc.uri', "'nobody'"],
      ['doc.uri', "'nobody'"],
      ['vscode.Uri.file(absolute)', 'whoAsked'],
      ['uri: vscode.Uri', 'whoAsked: WhoAsked'],
    ]);
    // The one context built for an operation is built after a refusal whose
    // surface is an entry has been answered as surfaced, so its entry is never
    // filed there.
    const report = functionBody(EXTENSION, 'function reportDaemonError(');
    const shortCircuit = report.indexOf("if (refusalEntry(err)) {\n    return 'surfaced';\n  }");
    assert.ok(shortCircuit >= 0, 'an operation\'s refusal whose surface is an entry is routed on to the document\'s own collection');
    assert.ok(shortCircuit < report.indexOf('buildErrorContext('), 'the context an operation\'s refusal is routed through is built before its entry is set aside');
    // The ending files through the replacement.
    const filing = functionBody(EXTENSION, 'function fileOperationAnswer(');
    assert.ok(filing.includes('filingsForAnswer(settled, release)') && filing.includes('operationRefusals.replace(release,'), 'an answer is not filed through the replacement');
  });

  it('has a new server forget the refusals, and counts them as findings standing on a file', () => {
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, EXTENSION), 'utf8');
    const stands = /findingStands: \(file\) =>([\s\S]*?),\n\s*selectedRelease,/.exec(source);
    assert.ok(stands !== null, 'the finding-stands reading was not found');
    assert.ok(stands[1].includes('holdsFindings(diagnosticCollections, vscode.Uri.file(file))'), 'a finding in a layer no longer counts');
    assert.ok(stands[1].includes('operationRefusals.holds(vscode.Uri.file(file).toString())'), 'a refusal of a build, a preview or a graph does not count as a finding standing on the file');
    const holders = callArguments(EXTENSION, 'createServerTurnover')[0]?.[0] ?? '';
    assert.ok(holders.includes('...(operationRefusals ? [operationRefusals] : [])'), 'a new language server leaves the stopped one\'s refusals standing');
  });
});
