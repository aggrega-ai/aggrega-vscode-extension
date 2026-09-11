// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  IMPORT_OUTPUT_DIR,
  IMPORT_SOURCE_PROMPT,
  IMPORT_SOURCE_TITLE,
  IMPORT_SUBJECT,
  ImportParams,
  ImportResult,
  diagnosticLine,
  importDetail,
  importLines,
  importOpeningLine,
  importOutcome,
  importRequest,
  runImport,
  writtenLine,
} from '../../src/import-request';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import {
  EXTENSION_ROOT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  readSourceTree,
} from '../helpers/launch-census';

// This spec drives the whole import decision with no transport, no editor and no
// process: every sentence a reader meets is read back here, and every request this
// side would send is recorded rather than sent.
//
// 🔴 EVERY EXPECTED SENTENCE BELOW IS AN INDEPENDENT LITERAL. Composing an
// expectation from the module's own helpers would put the implementation on both
// sides of the comparison, and such a test proves the two agree while accepting
// any wording at all — including one that lost the compiler's words.

// A recorded transport. It answers with whatever it was given and keeps every
// request and every signal, so what was sent is a measurement rather than an
// inference.
function recorder(answer: ImportResult | unknown): {
  deps: { importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult> };
  sent: ImportParams[];
  signals: Array<CancellationSignal | undefined>;
} {
  const sent: ImportParams[] = [];
  const signals: Array<CancellationSignal | undefined> = [];
  return {
    sent,
    signals,
    deps: {
      importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult> {
        sent.push(params);
        signals.push(signal);
        if (answer instanceof Error || (answer && typeof (answer as { code?: unknown }).code === 'number')) {
          return Promise.reject(answer);
        }
        return Promise.resolve(answer as ImportResult);
      },
    },
  };
}

// A completed import of a recognised source, as the compiler answers it.
const DRAFTED: ImportResult = {
  format: 'langflow',
  outputDir: '/work/project',
  written: ['aggregate.yaml', 'components/api.yaml', 'release.yaml'],
  files: [
    { path: 'aggregate.yaml', content: 'kind: Aggregate\n' },
    { path: 'components/api.yaml', content: 'kind: Component\n' },
    { path: 'release.yaml', content: 'kind: Release\n' },
  ],
  diagnostics: [],
  halted: false,
};

// The compiler's own refusal sentence for a source it could not read, quoted from
// the request surface's own wording. It is a literal here on purpose: the point of
// the assertions using it is that this side does not re-word it.
const REFUSAL_CODE = -32602;
const COMPILER_REFUSAL =
  'import: the source format of /home/reader/Downloads/flow.json was not recognised from its '
  + 'shape; send format to name it explicitly (for example langflow or flowise)';

// --- what the request carries --------------------------------------------

describe('the import request carries the source and the destination', () => {
  it('carries exactly the two fields, and nothing a later call site could fill', () => {
    // 🔴 A KEY-SET EQUALITY RATHER THAN A PRESENCE CHECK. The operation also
    // accepts an explicit format and a switch returning the drafts as content
    // instead of writing them; a presence check on source and destination would
    // pass with either of those added, and each changes what the operation does.
    assert.deepStrictEqual(
      Object.keys(importRequest('/home/reader/Downloads/flow.json')).sort(),
      ['outputDir', 'source'],
    );
  });

  it('passes the source through verbatim, including an absolute one', () => {
    // The compiler reads a source the reader selected from wherever it sits, so an
    // absolute path outside the open folder is the case this operation exists to
    // serve rather than an edge of it. Nothing here relativises or rewrites it.
    assert.deepStrictEqual(
      importRequest('/home/reader/Downloads/flow.json'),
      { source: '/home/reader/Downloads/flow.json', outputDir: '.' },
    );
  });

  it('names the workspace root as the destination, as a relative value', () => {
    // 🔴 THE EXPECTATION IS THE LITERAL, NOT THE CONSTANT. Asserting the request's
    // destination equals the module's own constant would pass whatever that
    // constant became, including an absolute path the compiler refuses for a
    // written destination.
    assert.strictEqual(IMPORT_OUTPUT_DIR, '.');
    assert.strictEqual(importRequest('./flow.json').outputDir, '.');
  });

  it('trims the source the reader typed, so a stray space is not a different file', () => {
    assert.strictEqual(importRequest('  ./flow.json  ').source, './flow.json');
  });

  it('refuses a source that names nothing, before anything is sent', () => {
    // The guard is reached rather than restated, and what matters is that it fires
    // BEFORE a request: a refusal after sending would have asked the compiler to
    // read a file the reader never named.
    for (const blank of ['', '   ', '\t']) {
      assert.throws(() => importRequest(blank), /takes the source to import/);
    }
  });

  it('sends exactly one request, carrying exactly what was composed', async () => {
    // 🔴 A COUNT AND AN EQUALITY. "A request was sent" passes when two are sent,
    // and two sends for one operation is the second execution path this whole
    // change removes.
    const r = recorder(DRAFTED);
    await runImport(r.deps, '/home/reader/Downloads/flow.json');
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.sent, [
      { source: '/home/reader/Downloads/flow.json', outputDir: '.' },
    ]);
  });

  it('sends nothing at all when the source names nothing, and says so', async () => {
    // The refusal is REPORTED rather than thrown past the reader: the guard runs
    // where a failed answer is composed, so a reader who dismissed nothing but
    // typed nothing is told what the operation needed. The count is the half that
    // matters — nothing reached the compiler.
    const r = recorder(DRAFTED);
    const report = await runImport(r.deps, '  ');
    assert.strictEqual(r.sent.length, 0, 'a blank source reached the compiler');
    assert.deepStrictEqual(report.outcome, {
      kind: 'failed',
      message: 'aggrega import takes the source to import, and none was given',
    });
    assert.deepStrictEqual(report.lines, []);
  });
});

// --- the stop ------------------------------------------------------------

describe('the import offers a stop, and the stop reaches the request', () => {
  it('takes a stop, and keeps taking one', () => {
    // 🔴 THE ARITY IS THE ASSERTION. The operations beside this one deliberately
    // take no signal, because their shared work accepts no cancellation and a stop
    // would only stop this side waiting. This one is the opposite case and the
    // arity records it, so removing the parameter has to be argued rather than
    // slipped in.
    assert.strictEqual(runImport.length, 3);
  });

  it("hands the reader's own signal to the request, not one of its own", async () => {
    // An IDENTITY comparison rather than a "a signal arrived" check: a module that
    // manufactured its own signal would satisfy the weaker reading while the
    // reader's cancel reached nothing.
    const signal: CancellationSignal = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() { /* nothing to release */ } }),
    };
    const r = recorder(DRAFTED);
    await runImport(r.deps, './flow.json', signal);
    assert.strictEqual(r.signals.length, 1);
    assert.strictEqual(r.signals[0], signal);
  });

  it('reports an import the reader stopped as stopped, never as broken', async () => {
    // The reader who stopped it must not be told it failed. The classification is
    // by the thrown value's TYPE rather than by its message, so it cannot quietly
    // stop working when a sentence is reworded — which is why the fixture is the
    // real rejection rather than an error wearing its name.
    const r = recorder(new OperationCancelled(IMPORT_SUBJECT));
    const report = await runImport(r.deps, './flow.json');
    assert.strictEqual(report.outcome.kind, 'cancelled');
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      'The import stopped at your request.',
    );
  });

  it('puts nothing on the channel for a run that never answered', async () => {
    // A stopped or refused import answered with nothing, so there are no
    // diagnostics and no written files to report. A line composed anyway would be
    // this surface inventing a result.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, './flow.json');
    assert.deepStrictEqual(report.lines, []);
  });
});

// --- what the reader is left with ----------------------------------------

describe('the ending is composed from the answer', () => {
  it('names what was drafted, what it was recognised as, and where it went', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome(DRAFTED)),
      'The import drafted 3 files, recognised as langflow, in /work/project.',
    );
  });

  it('says one file rather than 1 files', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome({ ...DRAFTED, written: ['aggregate.yaml'] })),
      'The import drafted 1 file, recognised as langflow, in /work/project.',
    );
  });

  it('reports an import that drafted nothing as a result, not as a silence', () => {
    // An import that produced no files is an answer, and leaving it unsaid makes it
    // read exactly like an operation that never ran. The destination is not named,
    // because nothing reached it.
    const line = terminalLine(IMPORT_SUBJECT, importOutcome({ ...DRAFTED, written: [] }));
    assert.strictEqual(
      line,
      'The import drafted no files, recognised as langflow, and nothing was written.',
    );
    assert.ok(
      !line.includes('/work/project'),
      'a directory nothing was written to is named, which answers a question the reader did '
      + 'not ask',
    );
  });

  it('reads the format off the ANSWER, not off anything this side assumed', () => {
    // The compiler recognises the format from the source's own shape and this side
    // sends none, so the answer is the only place the fact exists. A reader whose
    // source was read as something other than they expected learns it here — which
    // the command line never tells them.
    assert.strictEqual(
      importDetail({ ...DRAFTED, format: 'flowise' }),
      'drafted 3 files, recognised as flowise, in /work/project.',
    );
  });

  it('reads the destination off the ANSWER, so it is where the drafts landed', () => {
    assert.strictEqual(
      importDetail({ ...DRAFTED, outputDir: '/elsewhere/opened' }),
      'drafted 3 files, recognised as langflow, in /elsewhere/opened.',
    );
  });
});

describe('a partial import is reported as one that did not complete', () => {
  const PARTIAL: ImportResult = {
    ...DRAFTED,
    written: ['aggregate.yaml'],
    diagnostics: [
      { severity: 'halt', message: 'no mapping for node type CustomAgent', code: 'unmapped-node' },
      { severity: 'warning', message: 'the edge from A to B names no socket' },
    ],
    halted: true,
  };

  it('is a failure rather than a completion, which is what the command reports', () => {
    // 🔴 THE KIND IS THE ASSERTION. The answer arrives normally — a partial import
    // is not a transport error — so a client reading only "did the request throw"
    // would report a source as converted when part of it was not. The command line
    // exits non-zero for the same run.
    assert.strictEqual(importOutcome(PARTIAL).kind, 'failed');
  });

  it('says it was partial, counts the problems, and says what was nonetheless written', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome(PARTIAL)),
      'The import did not complete: the importer could not convert all of the source, '
      + 'recognised as langflow — 2 problems listed above. The 1 file it could draft was '
      + 'written to /work/project.',
    );
  });

  it('says nothing was written when nothing was', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome({ ...PARTIAL, written: [] })),
      'The import did not complete: the importer could not convert the source, recognised as '
      + 'langflow — 2 problems listed above. Nothing was written.',
    );
  });

  it('says one problem rather than 1 problems', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome({
        ...PARTIAL,
        diagnostics: [PARTIAL.diagnostics[0]],
      })),
      'The import did not complete: the importer could not convert all of the source, '
      + 'recognised as langflow — 1 problem listed above. The 1 file it could draft was '
      + 'written to /work/project.',
    );
  });

  it('still puts every diagnostic on the channel, because that is the useful output', async () => {
    // An import that could not convert everything still drafted what it could, and
    // its diagnostics are what a reader acts on. Reporting the failure without them
    // would discard exactly what makes the failure actionable.
    const r = recorder(PARTIAL);
    const report = await runImport(r.deps, './flow.json');
    assert.strictEqual(report.outcome.kind, 'failed');
    assert.deepStrictEqual(report.lines, [
      '  halt (unmapped-node): no mapping for node type CustomAgent',
      '  warning: the edge from A to B names no socket',
      '  wrote aggregate.yaml',
    ]);
  });
});

// --- the channel ---------------------------------------------------------

describe("the channel carries the importer's own words", () => {
  it("renders a diagnostic in the command line's own order and wording", () => {
    // The severity then the message, which is what the command line prints for the
    // same diagnostic, so a reader who has seen one account of an import recognises
    // the other.
    assert.strictEqual(
      diagnosticLine({ severity: 'warning', message: 'the edge from A to B names no socket' }),
      '  warning: the edge from A to B names no socket',
    );
  });

  it('adds a code the command line drops, and leaves the message unaltered', () => {
    // 🔴 ADDITIVE, AND THE ASSERTION IS THE WHOLE LINE. The importer assigns a code
    // that the command line never prints; carrying it is a gain. What must not
    // happen is the message being re-worded around it, and only a whole-line
    // equality can see that.
    assert.strictEqual(
      diagnosticLine({
        severity: 'halt',
        message: 'no mapping for node type CustomAgent',
        code: 'unmapped-node',
      }),
      '  halt (unmapped-node): no mapping for node type CustomAgent',
    );
  });

  it("reports a written file in the command line's own words", () => {
    assert.strictEqual(writtenLine('components/api.yaml'), '  wrote components/api.yaml');
  });

  it('puts the diagnostics before what was written, and both in the answer order', () => {
    // An array equality rather than a set of presence checks: the order is what a
    // reader scrolling the channel depends on, and a presence check cannot see it.
    assert.deepStrictEqual(
      importLines({
        ...DRAFTED,
        written: ['a.yaml', 'b.yaml'],
        diagnostics: [
          { severity: 'warning', message: 'first' },
          { severity: 'warning', message: 'second' },
        ],
      }),
      [
        '  warning: first',
        '  warning: second',
        '  wrote a.yaml',
        '  wrote b.yaml',
      ],
    );
  });

  it('contributes no diagnostic line for an import that objected to nothing', () => {
    // A COUNT. A clean import channel is the list of what it drafted and nothing
    // else, and the count is what expresses that: a check for the absence of one
    // particular sentence would pass whatever else appeared.
    assert.strictEqual(importLines(DRAFTED).length, 3);
    assert.deepStrictEqual(importLines(DRAFTED), [
      '  wrote aggregate.yaml',
      '  wrote components/api.yaml',
      '  wrote release.yaml',
    ]);
  });

  it('opens with the source the reader gave, which the answer does not carry back', () => {
    assert.strictEqual(
      importOpeningLine('/home/reader/Downloads/flow.json'),
      '\nImport of /home/reader/Downloads/flow.json.',
    );
  });

  it('asks for the source in the words it always has', () => {
    // The prompt accepts a path or a reference because the compiler accepts either.
    // Narrowing the question would narrow the operation to less than it performs.
    assert.strictEqual(IMPORT_SOURCE_PROMPT, 'Path or reference of the source to import');
    assert.strictEqual(IMPORT_SOURCE_TITLE, 'Aggrega: import source');
  });
});

// --- the compiler diagnostic, unaltered ----------------------------------

describe('a refusal reaches the reader as the compiler wrote it', () => {
  it('renders the refusal exactly, character for character, prefix included', async () => {
    // 🔴 THE WHOLE LINE AS AN EQUALITY. The extension's one rendering home prefixes
    // a transport refusal with its code, and that prefix is ADDITIVE — the
    // compiler's sentence follows it unaltered. Asserting only that the sentence
    // appears somewhere would pass a line that wrapped it in a message of this
    // surface's own.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, '/home/reader/Downloads/flow.json');
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      'The import did not complete: code=-32602 import: the source format of '
      + '/home/reader/Downloads/flow.json was not recognised from its shape; send format to '
      + 'name it explicitly (for example langflow or flowise)',
    );
  });

  it('composes the same line from its three parts, so a reflow fails structurally', async () => {
    // The second half of the assertion above, and it is the one that survives a
    // rewording of the compiler's own sentence: the line must be the subject, then
    // the code prefix, then the compiler's text — with nothing of this surface's
    // interleaved.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, '/home/reader/Downloads/flow.json');
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      `${IMPORT_SUBJECT} did not complete: code=${REFUSAL_CODE} ${COMPILER_REFUSAL}`,
    );
  });

  it('keeps the two facts the refusal named, which a wrapper message would discard', async () => {
    // The load-bearing halves of the compiler's sentence: the file it could not
    // recognise, and the remedy naming what to send instead. A reader acts on both.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, '/home/reader/Downloads/flow.json');
    const line = terminalLine(IMPORT_SUBJECT, report.outcome);
    assert.ok(line.includes('/home/reader/Downloads/flow.json'));
    assert.ok(line.includes('send format to name it explicitly'));
    assert.ok(
      !line.includes('[object Object]'),
      'a refusal rendered as [object Object] loses the whole diagnostic',
    );
  });

  it('carries the message of a transport failure that is a real error', async () => {
    // Not every failure is a refusal: a request sent while no server is running
    // throws an ordinary error, and its sentence names the state to fix.
    const r = recorder(new Error('the Aggrega language server is not running'));
    const report = await runImport(r.deps, './flow.json');
    assert.deepStrictEqual(report.outcome, {
      kind: 'failed',
      message: 'the Aggrega language server is not running',
    });
  });

  it('reports a source the compiler refused as a failure, never as a completion', async () => {
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, './flow.json');
    assert.strictEqual(report.outcome.kind, 'failed');
  });
});

// --- one execution path --------------------------------------------------

describe('the import reaches the compiler without a launch', () => {
  it('fires on a module that does launch, so every zero below is an absence', () => {
    // 🔴 THE POSITIVE CONTROL, AND IT IS THE HALF THAT MAKES A ZERO MEAN ANYTHING.
    // A pattern that has stopped matching reports every module clean, so a census
    // without a control cannot tell an absence from a dead instrument.
    assertCensusInstrumentFires((value, message) => assert.ok(value, message));
  });

  it('gives the module that decides an import no way to start a process', () => {
    assert.strictEqual(launchFacilityCount('src/import-request.ts'), 0);
  });

  it('gives that module no way to reach a process or an editor at all', () => {
    // Read as the WHOLE import list, so a module added to it has to be looked at —
    // including one that could start a process and one that would carry the editor
    // in, which is what keeps the import decision readable without a host.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/import-request.ts'), 'utf8');
    const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      imported.sort(),
      ['./cancellation', './operation-groups', './operation-outcome'],
    );
  });

  it('leaves the operations panel with one watched run and no launch of its own', () => {
    // 🔴 A COUNT PER HELPER, NOT A PRESENCE. The panel still calls the WATCHABLE
    // wrapper once, for the dependency resolution, and that wrapper calls the
    // streaming helper internally — so what is claimed here is that the panel makes
    // no launch of its own and exactly one watched run, and only counts express it.
    //
    // The one survivor carries its reason at its own call site: the resolution's
    // closure walk resolves each entity through a catalog lookup that takes no
    // context, so a request's stop cannot reach the registry fetch inside it while
    // ending the process can. An operations-panel launch appearing anywhere else,
    // or this one disappearing without that changing, fails here.
    const sources = new Map(readSourceTree());
    const subject = sources.get('operations.ts') ?? '';
    const helpers = ['runCli', 'runCliJson', 'runWatchableCli'];
    const countIn = (source: string, helper: string): number => (
      source.match(new RegExp(`(?:^|[^a-zA-Z.])${helper}\\s*(?:<[^<>]*>)?\\s*\\(`, 'gm')) ?? []
    ).length;

    assert.deepStrictEqual(
      helpers.map((helper) => [helper, countIn(subject, helper)]),
      [['runCli', 0], ['runCliJson', 0], ['runWatchableCli', 1]],
      'the operations panel gained or lost a command-backed run; a launch of its own is a '
      + 'second execution path, and a lost watched run is an operation that cannot be stopped',
    );
  });

  it('sends the import from exactly one place', () => {
    // One question with two senders is two execution paths. The method name is the
    // compiler's identifier, read from the surface that sends it rather than
    // restated as a constant this side owns.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const senders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /'aggrega\/import'/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(
      senders,
      ['extension.ts'],
      `aggrega/import is sent from ${senders.length} place(s)`,
    );
  });

  it('composes no argument list for the import, so it cannot be launched', () => {
    // 🔴 THE OLD PATTERN, SWEPT FOR RATHER THAN ASSUMED GONE. A retired composer
    // left standing with no caller is a launch waiting to be reached, and it would
    // be invisible to every assertion above: the request would still be sent from
    // one place, and the panel would still hold no launch.
    //
    // 🔴 THE SWEEP IS TREE-WIDE RATHER THAN CONFINED TO THE MODULE THAT ONCE
    // DECLARED THE COMPOSITIONS, AND THAT IS A REPAIR RATHER THAN A WIDENING. That
    // module now declares no composer at all, so a sweep of it alone returns zero
    // whatever it is asked — and would keep returning zero if a composer were
    // written into any other module. A census whose corpus has emptied reports
    // every absence as clean.
    const sources = readSourceTree();
    const holders = sources
      .filter(([, source]) => /function\s+importArgs\b/.test(source))
      .map(([file]) => file);
    assert.deepStrictEqual(
      holders,
      [],
      'importArgs still composes a command line for an operation that is now a request',
    );
    // The positive control for this sweep: the SAME pattern shape, over the SAME
    // corpus, finds the composers that legitimately remain.
    //
    // 🔴 IT IS AN EQUALITY AGAINST A SET WRITTEN HERE RATHER THAN A COUNT DERIVED
    // FROM THE WALK, so the expectation cannot agree with whatever the walk found.
    // Each member is accounted for: the per-entity checks, the plugin catalog
    // generation and the dependency resolution are operations still invoked as
    // commands for reasons recorded at their own call sites, and the transport's
    // own composer is the arguments the language server itself is started with —
    // a launch that is never retired rather than an operation. A member
    // disappearing means either that operation moved (repoint this control) or the
    // pattern stopped matching (the absence above would have passed vacuously);
    // both are worth a failing test.
    const surviving = sources
      .flatMap(([file, source]) => (
        /function\s+[A-Za-z]+Args\b/.test(source) ? [file] : []
      ))
      .sort();
    assert.deepStrictEqual(
      surviving,
      ['catalog-entity-operations.ts', 'daemon.ts', 'operation-groups.ts', 'plugins-run.ts'],
      'the composer pattern no longer matches the composers that provably exist, so the absence '
      + 'above would pass vacuously',
    );
  });

  it('leaves the retired composer named nowhere in the source tree', () => {
    // A tree-wide COUNT rather than a check of the one module that declares the
    // compositions: a call left behind elsewhere would not compile, but a name
    // surviving in a comment would read as though the composition were the path.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const holders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bimportArgs\b/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(holders, []);
  });
});
