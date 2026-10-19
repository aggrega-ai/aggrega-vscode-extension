// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  FORMAT_REMEDIED_REFUSALS,
  IMPORT_DESTINATION_PROMPT,
  IMPORT_DESTINATION_TITLE,
  IMPORT_FORMAT_PLACEHOLDER,
  IMPORT_FORMAT_TITLE,
  IMPORT_OPTIONS,
  IMPORT_OPTIONS_TITLE,
  IMPORT_RECORD_FILE,
  IMPORT_SOURCE_KINDS,
  IMPORT_SOURCE_PROMPT,
  IMPORT_SOURCE_TITLE,
  IMPORT_SUBJECT,
  IMPORT_TARGET_PROMPT,
  IMPORT_TARGET_TITLE,
  ImportDecision,
  ImportDrift,
  ImportParams,
  ImportQuestions,
  ImportResult,
  ImportSwitches,
  SourceAsks,
  SourceDialog,
  SourceKind,
  askImport,
  chooseSource,
  clickedSource,
  decisionLine,
  diagnosticLine,
  driftLine,
  switchesFrom,
  importDetail,
  importLines,
  importOpeningLine,
  importOutcome,
  importRequest,
  previewLines,
  runImport,
  writtenLine,
} from '../../src/import-request';
import { CancellationSignal, OperationCancelled } from '../../src/cancellation';
import { terminalLine } from '../../src/operation-outcome';
import {
  EXTENSION_ROOT,
  WIRE_CONTRACT,
  assertCensusInstrumentFires,
  launchFacilityCount,
  readSourceTree,
  typeOnlyImports,
  valueImports,
} from '../helpers/launch-census';

// This spec drives the whole import decision with no transport, no editor and no
// process: every sentence a reader meets is read back here, and every request this
// side would send is recorded rather than sent.
//
// 🔴 EVERY EXPECTED SENTENCE BELOW IS AN INDEPENDENT LITERAL. Composing an
// expectation from the module's own helpers would put the implementation on both
// sides of the comparison, and such a test proves the two agree while accepting
// any wording at all — including one that lost the compiler's words.

// A recorded transport. It answers each request with the next of the answers it
// was given — the last one repeated — and keeps every request and every signal, so
// what was sent is a measurement rather than an inference. An answer carrying a
// numeric code, or an Error, is a refusal and is thrown.
function recorder(...answers: Array<ImportResult | unknown>): {
  deps: {
    importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult>;
    nameFormat?(refusal: string): Promise<string | undefined>;
  };
  sent: ImportParams[];
  signals: Array<CancellationSignal | undefined>;
  asked: string[];
  answerFormat(format: string | undefined): void;
} {
  const sent: ImportParams[] = [];
  const signals: Array<CancellationSignal | undefined> = [];
  const asked: string[] = [];
  let format: string | undefined;
  let named = false;
  const deps = {
    importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult> {
      const answer = answers[Math.min(sent.length, answers.length - 1)];
      sent.push(params);
      signals.push(signal);
      if (answer instanceof Error || (answer && typeof (answer as { code?: unknown }).code === 'number')) {
        return Promise.reject(answer);
      }
      return Promise.resolve(answer as ImportResult);
    },
    nameFormat(refusal: string): Promise<string | undefined> {
      asked.push(refusal);
      return Promise.resolve(format);
    },
  };
  return {
    sent,
    signals,
    asked,
    get deps() {
      // Only a recorder told how the reader answers carries the question, so a
      // spec that never names one drives an import with no way to ask.
      return named ? deps : { importSource: deps.importSource };
    },
    answerFormat(f: string | undefined): void { format = f; named = true; },
  };
}

// The reader's answers to the import's questions, recorded in the order asked.
// An answer of undefined is a dismissed question.
function questions(answers: {
  source?: string;
  destination?: string;
  switches?: ImportSwitches;
  target?: string;
}, dismissed: Array<keyof ImportQuestions> = []): { asks: ImportQuestions; order: string[] } {
  const order: string[] = [];
  const answer = <T>(name: keyof ImportQuestions, value: T): Promise<T | undefined> => {
    order.push(name);
    return Promise.resolve(dismissed.includes(name) ? undefined : value);
  };
  return {
    order,
    asks: {
      source: () => answer('source', answers.source ?? ''),
      destination: () => answer('destination', answers.destination ?? ''),
      switches: () => answer('switches', answers.switches ?? { dryRun: false, sync: false }),
      target: () => answer('target', answers.target ?? ''),
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
  drift: [],
  diagnostics: [],
  decisions: [],
  halted: false,
};

// The same import as the compiler answers it today: the record of what the import
// wrote follows the drafts, among the files and among what was written.
const DRAFTED_WITH_RECORD: ImportResult = {
  ...DRAFTED,
  written: ['aggregate.yaml', 'release.yaml', '.aggrega-import.json'],
  files: [
    { path: 'aggregate.yaml', content: 'kind: Aggregate\n' },
    { path: 'release.yaml', content: 'kind: Release\n' },
    { path: '.aggrega-import.json', content: '{}\n' },
  ],
};

// A preview's answer: the files as content, and nothing written.
const PREVIEWED: ImportResult = {
  ...DRAFTED_WITH_RECORD,
  written: [],
};

// The compiler's refusal of a source the signatures of more than one format
// recognise, as the session answers it: the condition named in the data.
const AMBIGUOUS_REFUSAL = {
  code: -32602,
  message: 'E0339: import: more than one importer recognises the source (source /home/reader/flow.json, '
    + 'recognised as langflow, flowise); send format naming the one to read it as',
  data: { code: 'ambiguous-import-format', shortCode: 'E0339' },
};

// The compiler's refusal of a source the signatures of no format recognise, as the
// session answers it: the condition named in the data, the words the session's own.
const UNRECOGNISED_REFUSAL = {
  code: -32602,
  message: 'E0350: import: the source format of /home/reader/mystery.json was not recognised from its shape by the '
    + 'signatures the importers declare; send format to name it explicitly (for example langflow or flowise)',
  data: { code: 'unrecognised-import-format', shortCode: 'E0350' },
};

// The compiler's own refusal sentence for a source it could not read, quoted from
// the request surface's own wording. It is a literal here on purpose: the point of
// the assertions using it is that this side does not re-word it.
const REFUSAL_CODE = -32602;
const COMPILER_REFUSAL =
  'import: the source format of /home/reader/Downloads/flow.json was not recognised from its '
  + 'shape; send format to name it explicitly (for example langflow or flowise)';

// --- what the request carries --------------------------------------------

describe('the import request carries the source and each option chosen, and nothing else', () => {
  it('sends a chosen file as the source and nothing more, so no destination is named', async () => {
    // 🔴 A KEY-SET EQUALITY RATHER THAN A PRESENCE CHECK, over the request as SENT.
    // The operation takes a destination, a format, a target, a preview and a sync;
    // a presence check on the source would pass with any of them added, and each
    // changes what the operation does. An absent destination is the operation's
    // own default, the workspace root.
    //
    // 🔴 PLANTED DEFECT: put back a fixed outputDir of '.' in importRequest
    // (src/import-request.ts) and this case reddens on the key set.
    const r = recorder(DRAFTED);
    await runImport(r.deps, { source: '/home/reader/Downloads/flow.json' });
    assert.deepStrictEqual(r.sent, [{ source: '/home/reader/Downloads/flow.json' }]);
    assert.deepStrictEqual(Object.keys(r.sent[0]), ['source']);
  });

  it('carries a chosen folder through to the request exactly as it carries a file', async () => {
    // A directory is a source in its own right: the compiler reads it into the
    // files its importer's declared file patterns select. So nothing here lists it,
    // expands it into files or appends a separator — a composer that did any of
    // that would be a second answer to which files a directory import reads.
    // 🔴 A COUNT AND AN EQUALITY, over both the composed request and the one sent.
    assert.deepStrictEqual(importRequest({ source: 'charts/demo' }), { source: 'charts/demo' });
    const r = recorder(DRAFTED);
    await runImport(r.deps, { source: '/home/reader/projects/crew' });
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.sent, [{ source: '/home/reader/projects/crew' }]);
  });

  it('passes the source through verbatim, including an absolute one', () => {
    // The compiler reads a source the reader selected from wherever it sits, so an
    // absolute path outside the open folder is the case this operation exists to
    // serve rather than an edge of it. Nothing here relativises or rewrites it.
    assert.deepStrictEqual(
      importRequest({ source: '/home/reader/Downloads/flow.json' }),
      { source: '/home/reader/Downloads/flow.json' },
    );
  });

  it('sends a chosen destination as outputDir, as the reader wrote it', async () => {
    // The destination is the compiler's to resolve and to hold inside the
    // workspace, so it is sent as written, trimmed, and nothing here judges it.
    const r = recorder(DRAFTED);
    await runImport(r.deps, { source: './flow.json', outputDir: '  drafts/flow  ' });
    assert.deepStrictEqual(r.sent, [{ source: './flow.json', outputDir: 'drafts/flow' }]);
  });

  it('sends a preview as dryRun true, and a write sends no dryRun at all', async () => {
    const r = recorder(PREVIEWED, DRAFTED);
    await runImport(r.deps, { source: './flow.json', dryRun: true });
    await runImport(r.deps, { source: './flow.json', dryRun: false });
    assert.deepStrictEqual(r.sent, [{ source: './flow.json', dryRun: true }, { source: './flow.json' }]);
  });

  it('sends a chosen target, and a chosen sync, each only when chosen', async () => {
    const r = recorder(DRAFTED);
    await runImport(r.deps, { source: './flow.json', target: ' compose ' });
    await runImport(r.deps, { source: './flow.json', sync: true });
    await runImport(r.deps, { source: './flow.json', sync: true, dryRun: true });
    assert.deepStrictEqual(r.sent, [
      { source: './flow.json', target: 'compose' },
      { source: './flow.json', sync: true },
      { source: './flow.json', dryRun: true, sync: true },
    ]);
  });

  it('sends no option the reader left blank', () => {
    // An empty text is the reader choosing none, so it is not sent as an empty
    // value: the compiler would read an empty target, say, as one naming nothing.
    assert.deepStrictEqual(
      importRequest({ source: './flow.json', outputDir: '  ', format: '', target: '\t', dryRun: false, sync: false }),
      { source: './flow.json' },
    );
  });

  it('trims the source the reader typed, so a stray space is not a different file', () => {
    assert.strictEqual(importRequest({ source: '  ./flow.json  ' }).source, './flow.json');
  });

  it('refuses a source that names nothing, before anything is sent', () => {
    // The guard is reached rather than restated, and what matters is that it fires
    // BEFORE a request: a refusal after sending would have asked the compiler to
    // read a file the reader never named.
    for (const blank of ['', '   ', '\t']) {
      assert.throws(() => importRequest({ source: blank }), /takes the source to import/);
    }
  });

  it('sends exactly one request, carrying exactly what was composed', async () => {
    // 🔴 A COUNT AND AN EQUALITY. "A request was sent" passes when two are sent,
    // and two sends for one operation is a second execution path.
    const r = recorder(DRAFTED);
    await runImport(r.deps, { source: '/home/reader/Downloads/flow.json' });
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.sent, [{ source: '/home/reader/Downloads/flow.json' }]);
  });

  it('sends nothing at all when the source names nothing, and says so', async () => {
    // The refusal is REPORTED rather than thrown past the reader: the guard runs
    // where a failed answer is composed, so a reader who dismissed nothing but
    // typed nothing is told what the operation needed. The count is the half that
    // matters — nothing reached the compiler.
    const r = recorder(DRAFTED);
    const report = await runImport(r.deps, { source: '  ' });
    assert.strictEqual(r.sent.length, 0, 'a blank source reached the compiler');
    assert.deepStrictEqual(report.outcome, {
      kind: 'failed',
      message: 'aggrega import takes the source to import, and none was given',
    });
    assert.deepStrictEqual(report.lines, []);
  });
});

// --- what the reader is asked ----------------------------------------------

describe('the import asks for each part in order, and each answer sends only what it chose', () => {
  it('asks for the source, the destination, the switches and the target, in that order', async () => {
    // An ARRAY equality over the order the questions were asked, and an equality
    // over the request those answers compose, read back as sent.
    const q = questions({
      source: '/home/reader/Downloads/flow.json',
      destination: 'drafts',
      switches: { dryRun: true, sync: false },
      target: 'helm',
    });
    const choices = await askImport(q.asks, null);
    assert.deepStrictEqual(q.order, ['source', 'destination', 'switches', 'target']);
    assert.ok(choices !== null);
    const r = recorder(PREVIEWED);
    await runImport(r.deps, choices);
    assert.deepStrictEqual(r.sent, [
      { source: '/home/reader/Downloads/flow.json', outputDir: 'drafts', dryRun: true, target: 'helm' },
    ]);
  });

  it('sends only the source where every option was left empty or off', async () => {
    const q = questions({ source: './flow.json' });
    const choices = await askImport(q.asks, null);
    assert.ok(choices !== null);
    const r = recorder(DRAFTED);
    await runImport(r.deps, choices);
    assert.deepStrictEqual(r.sent, [{ source: './flow.json' }]);
  });

  it('ends with nothing sent where the reader dismisses any question', async () => {
    // Each question in turn dismissed: the answer is null and no later question is
    // asked, so a dismissed destination is not mistaken for the workspace root.
    const all: Array<keyof ImportQuestions> = ['source', 'destination', 'switches', 'target'];
    for (const [i, name] of all.entries()) {
      const q = questions({ source: './flow.json' }, [name]);
      assert.strictEqual(await askImport(q.asks, null), null, name);
      assert.deepStrictEqual(q.order, all.slice(0, i + 1), name);
    }
  });

  it('does not ask for the source the explorer already named', async () => {
    // 🔴 THE CLICKED PATH IS THE SOURCE, AND THE SOURCE QUESTION IS NEVER ASKED.
    // PLANTED DEFECT: ask the source question whatever askImport is handed, and the
    // order below gains 'source' and the request names the typed path instead.
    const q = questions({ source: '/somewhere/else.json' });
    const choices = await askImport(q.asks, clickedSource({ scheme: 'file', fsPath: '/work/project/flow.json' }));
    assert.deepStrictEqual(q.order, ['destination', 'switches', 'target']);
    assert.ok(choices !== null);
    const r = recorder(DRAFTED);
    await runImport(r.deps, choices);
    assert.deepStrictEqual(r.sent, [{ source: '/work/project/flow.json' }]);
  });

  it('registers the one import command forwarding what the invocation carried', () => {
    // Read rather than run: the registration happens against an extension host that
    // cannot start here. It is what stands between the explorer's clicked path and
    // the question that would otherwise ask for a source again — and there is one
    // registration, so the explorer, the panel and the palette reach one handler.
    const src = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'operations.ts'), 'utf8');
    assert.strictEqual((src.match(/reg\('import',/g) ?? []).length, 1);
    assert.ok(
      /reg\('import', \(clicked\) => \{ void runImport\(deps, clickedSource\(clicked\)\); \}\);/.test(src),
      'the import command no longer reads its source off the invocation',
    );
  });

  it('places the one import command in the explorer on files and folders, titled Import into Aggrega', () => {
    // Read from the manifest the extension loads rather than from a copy, so the
    // assertion is about what the editor draws. A menu entry carries no title of
    // its own and shows its command's, which is why the command itself carries the
    // explorer's title and the palette reads it under the category.
    // 🔴 PLANTED DEFECT: drop the explorer/context entry, or give it a second
    // command id, and this reddens on the placement; put back "Import…" and it
    // reddens on the title.
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
      contributes: {
        commands: Array<{ command: string; title: string; category?: string }>;
        menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
      };
    };
    const imports = manifest.contributes.commands.filter((c) => c.title === 'Import into Aggrega');
    assert.deepStrictEqual(imports.map((c) => [c.command, c.category]), [['aggrega.op.import', 'Aggrega']]);
    assert.deepStrictEqual(manifest.contributes.menus['explorer/context'], [{
      command: 'aggrega.op.import',
      when: 'resourceScheme == file || resourceScheme == vscode-remote',
      group: 'aggrega@1',
    }]);
    // The explorer entry and the clicked-path reader agree on which locations name
    // a source: each scheme the entry is offered on is one clickedSource reads.
    for (const scheme of ['file', 'vscode-remote']) {
      assert.strictEqual(clickedSource({ scheme, fsPath: '/work/project/flow.json' }), '/work/project/flow.json', scheme);
    }
  });

  it('reads a clicked file or folder off the invocation, and nothing else as one', () => {
    assert.strictEqual(clickedSource({ scheme: 'file', fsPath: '/work/project/crew' }), '/work/project/crew');
    // A remote window's file names the path on the machine the language server
    // reads from.
    assert.strictEqual(
      clickedSource({ scheme: 'vscode-remote', fsPath: '/workspaces/project/flow.json' }),
      '/workspaces/project/flow.json',
    );
    // The panel's press and the command palette carry nothing.
    assert.strictEqual(clickedSource(undefined), null);
    assert.strictEqual(clickedSource(null), null);
    // A location that is not on this machine's file system names no path the
    // compiler could read.
    assert.strictEqual(clickedSource({ scheme: 'untitled', fsPath: 'Untitled-1' }), null);
    assert.strictEqual(clickedSource('/work/project/flow.json'), null);
  });

  it('asks in the words the existing import question uses', () => {
    // Every question is the editor's own input, titled like the source question
    // and saying what an empty answer does.
    assert.strictEqual(IMPORT_DESTINATION_TITLE, 'Aggrega: import destination');
    assert.strictEqual(
      IMPORT_DESTINATION_PROMPT,
      'Folder inside the workspace to draft into, relative to its root. Leave it empty to draft beneath the workspace root',
    );
    assert.strictEqual(IMPORT_TARGET_TITLE, 'Aggrega: import target');
    assert.strictEqual(
      IMPORT_TARGET_PROMPT,
      'Provider capability to draft a Manifest for, such as compose or helm. Leave it empty to draft none',
    );
    assert.strictEqual(IMPORT_FORMAT_TITLE, 'Aggrega: import format');
    assert.strictEqual(IMPORT_FORMAT_PLACEHOLDER, 'The format to read the source as');
  });
});

// --- choosing the source, and the options ----------------------------------

// A recorded pair of the source question's two halves: the kind answered, then
// the dialog answered, each recorded as asked.
function sourceAsks(kind: SourceKind | undefined, dialogAnswer: unknown): {
  asks: SourceAsks;
  dialogs: SourceDialog[];
  kindsAsked: number;
} {
  const record = { dialogs: [] as SourceDialog[], kindsAsked: 0 };
  return {
    get dialogs() { return record.dialogs; },
    get kindsAsked() { return record.kindsAsked; },
    asks: {
      kind: () => { record.kindsAsked++; return Promise.resolve(kind); },
      open: (dialog) => { record.dialogs.push(dialog); return Promise.resolve(dialogAnswer); },
    },
  };
}

describe('the source is chosen as a file or a folder, through the editor own open dialog', () => {
  it('a file chosen opens a dialog selecting files only, and its path is the source sent', async () => {
    // 🔴 PLANTED DEFECT: set canSelectFolders true in sourceDialog for a file and
    // this reddens — on Windows and Linux that dialog selects folders only.
    const s = sourceAsks('file', [{ scheme: 'file', fsPath: '/home/reader/Downloads/flow.json' }]);
    const source = await chooseSource(s.asks);
    assert.deepStrictEqual(s.dialogs, [
      { title: 'Aggrega: import source', canSelectFiles: true, canSelectFolders: false, canSelectMany: false },
    ]);
    assert.strictEqual(source, '/home/reader/Downloads/flow.json');
    const q = questions({ source });
    const choices = await askImport(q.asks, null);
    assert.ok(choices !== null);
    const r = recorder(DRAFTED);
    await runImport(r.deps, choices);
    assert.deepStrictEqual(r.sent, [{ source: '/home/reader/Downloads/flow.json' }]);
  });

  it('a folder chosen opens a dialog selecting folders only, and its path is the source sent', async () => {
    const s = sourceAsks('folder', [{ scheme: 'file', fsPath: '/home/reader/projects/crew' }]);
    const source = await chooseSource(s.asks);
    assert.deepStrictEqual(s.dialogs, [
      { title: 'Aggrega: import source', canSelectFiles: false, canSelectFolders: true, canSelectMany: false },
    ]);
    assert.strictEqual(source, '/home/reader/projects/crew');
  });

  it('a dismissed choice opens no dialog, and ends the import with nothing sent', async () => {
    const s = sourceAsks(undefined, [{ scheme: 'file', fsPath: '/never' }]);
    assert.strictEqual(await chooseSource(s.asks), undefined);
    assert.strictEqual(s.kindsAsked, 1);
    assert.deepStrictEqual(s.dialogs, []);
    const q = questions({}, ['source']);
    assert.strictEqual(await askImport(q.asks, null), null);
    assert.deepStrictEqual(q.order, ['source']);
  });

  it('a dismissed dialog ends the import with nothing sent', async () => {
    for (const answer of [undefined, []]) {
      const s = sourceAsks('file', answer);
      assert.strictEqual(await chooseSource(s.asks), undefined, JSON.stringify(answer));
      assert.strictEqual(s.dialogs.length, 1);
    }
  });

  it('a dialog answer that names no location on the file system is no source', async () => {
    const s = sourceAsks('file', [{ scheme: 'untitled', fsPath: 'Untitled-1' }]);
    assert.strictEqual(await chooseSource(s.asks), undefined);
  });
});

describe('the options question sends a preview and a sync only where ticked', () => {
  it('offers Preview and Sync, each saying what it does', () => {
    assert.strictEqual(IMPORT_OPTIONS_TITLE, 'Aggrega: import options');
    assert.deepStrictEqual(IMPORT_OPTIONS.map((o) => [o.label, o.detail]), [
      ['Preview', 'Show the drafts without writing them'],
      ['Sync', 'Bring what an earlier import drafted up to date with the source'],
    ]);
  });

  it('reads each combination of ticks as the switches it turns on', () => {
    assert.deepStrictEqual(switchesFrom([]), { dryRun: false, sync: false });
    assert.deepStrictEqual(switchesFrom(['Preview']), { dryRun: true, sync: false });
    assert.deepStrictEqual(switchesFrom(['Sync']), { dryRun: false, sync: true });
    assert.deepStrictEqual(switchesFrom(['Preview', 'Sync']), { dryRun: true, sync: true });
    assert.strictEqual(switchesFrom(undefined), undefined);
  });

  it('sends neither field where neither is ticked, and each where it is', async () => {
    // 🔴 PLANTED DEFECT: send dryRun: false for an unticked Preview in importRequest
    // and the first request reddens on its key set.
    const sent: ImportParams[] = [];
    for (const picked of [[], ['Preview'], ['Sync'], ['Preview', 'Sync']]) {
      const switches = switchesFrom(picked);
      assert.ok(switches !== undefined);
      const q = questions({ source: './flow.json', switches });
      const choices = await askImport(q.asks, null);
      assert.ok(choices !== null);
      const r = recorder(PREVIEWED);
      await runImport(r.deps, choices);
      sent.push(...r.sent);
    }
    assert.deepStrictEqual(sent, [
      { source: './flow.json' },
      { source: './flow.json', dryRun: true },
      { source: './flow.json', sync: true },
      { source: './flow.json', dryRun: true, sync: true },
    ]);
    assert.deepStrictEqual(Object.keys(sent[0]), ['source']);
  });

  it('ends with nothing sent where the options question is dismissed', async () => {
    // A dismissed list answers undefined, which switchesFrom carries through as a
    // dismissal rather than as both options off.
    assert.strictEqual(switchesFrom(undefined), undefined);
    const q = questions({ source: './flow.json' }, ['switches']);
    assert.strictEqual(await askImport(q.asks, null), null);
    assert.deepStrictEqual(q.order, ['source', 'destination', 'switches']);
  });
});

// --- a sync's drift ---------------------------------------------------------

// DRIFT_LINE_CASES is the case manifest the drift line is held to on both sides
// of the language boundary, owned by the compiler's tree beside its formatter.
const DRIFT_LINE_CASES = path.resolve(
  __dirname, '..', '..', '..', '..', 'aggrega-cli', 'internal', 'importops', 'testdata', 'drift_line_cases.json',
);

// WANT_DRIFT_LINE_CASES_REVISION is the revision of that manifest THIS side was
// written against, and the spec below refuses any other.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF THE GO SPEC'S OWN PINNED COPY, AND IT MUST NOT
// BE UNIFIED WITH IT, for the reason the decision line's pin gives above.
const WANT_DRIFT_LINE_CASES_REVISION = 1;

describe('a sync puts each drifted part on the channel in the command line words', () => {
  it('renders every manifest drift in the line the command line writes for it', () => {
    // 🔴 AN UNREADABLE MANIFEST FAILS HERE; IT DOES NOT STAND THE SPEC DOWN.
    // PLANTED DEFECT: join the keys without quoting in driftLine and every quoted
    // case reddens.
    let raw: string;
    try {
      raw = fs.readFileSync(DRIFT_LINE_CASES, 'utf8');
    } catch (err) {
      throw new Error(
        `drift-line cases unreadable at ${DRIFT_LINE_CASES} (${String(err)}). The aggrega-cli sibling checkout `
        + 'holds the shared manifest; without it this spec compares nothing.',
      );
    }
    const doc = JSON.parse(raw) as {
      revision?: number;
      cases: Array<{ name: string; drift: ImportDrift; line: string }>;
    };
    assert.strictEqual(doc.revision, WANT_DRIFT_LINE_CASES_REVISION,
      "drift-line manifest revision mismatch; move this pin and the Go spec's own pin together");
    assert.ok(doc.cases.length > 0, 'the manifest holds no drift');
    for (const tc of doc.cases) {
      assert.strictEqual(driftLine(tc.drift), `  ${tc.line}`, `case ${JSON.stringify(tc.name)}`);
    }
  });

  it('puts the drift after the decisions and before the files', async () => {
    const r = recorder({
      ...PREVIEWED,
      files: [{ path: 'aggregate.yaml', content: 'kind: Aggregate\n' }],
      drift: [
        { change: 'changed', file: 'aggregate.yaml', key: ['spec', 'components', 'api'] },
        { change: 'removed', file: 'components/old.yaml', key: [] },
      ],
    });
    const report = await runImport(r.deps, { source: './flow.json', sync: true, dryRun: true });
    assert.deepStrictEqual(report.lines, [
      '  changed spec.components.api in aggregate.yaml',
      '  removed components/old.yaml',
      '  would write aggregate.yaml:',
      '    kind: Aggregate',
    ]);
  });
});

// --- the format, where the compiler cannot settle it -------------------------

describe('a refusal whose remedy is naming the format is answered by a second request carrying it', () => {
  it('asks for the format with the refusal in the compiler words, and sends the request again carrying it', async () => {
    // 🔴 TWO REQUESTS, READ BACK AS SENT: the first as the reader composed it, the
    // second the same request with the format added and nothing else changed.
    // PLANTED DEFECT: drop the retry in runImport and this reddens on the count.
    const r = recorder(AMBIGUOUS_REFUSAL, DRAFTED);
    r.answerFormat(' langflow ');
    const report = await runImport(r.deps, { source: '/home/reader/flow.json', outputDir: 'drafts' });
    assert.deepStrictEqual(r.sent, [
      { source: '/home/reader/flow.json', outputDir: 'drafts' },
      { source: '/home/reader/flow.json', outputDir: 'drafts', format: 'langflow' },
    ]);
    assert.deepStrictEqual(r.asked, [AMBIGUOUS_REFUSAL.message]);
    assert.strictEqual(report.outcome.kind, 'ok');
  });

  it('reads the condition off the refusal data, never off its message', async () => {
    // The same words with no condition in the data are not answered by a second
    // request, and a message merely naming the remedy names no condition.
    // PLANTED DEFECT: match on "send format" in the message instead, and this
    // reddens on the count.
    const r = recorder({ code: AMBIGUOUS_REFUSAL.code, message: AMBIGUOUS_REFUSAL.message }, DRAFTED);
    r.answerFormat('langflow');
    const report = await runImport(r.deps, { source: '/home/reader/flow.json' });
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.asked, []);
    assert.strictEqual(report.outcome.kind, 'failed');
    assert.deepStrictEqual(FORMAT_REMEDIED_REFUSALS, ['unrecognised-import-format', 'ambiguous-import-format']);
  });

  it('answers a source no importer recognises the same way, keyed on its own condition', async () => {
    // 🔴 PLANTED DEFECT: drop 'unrecognised-import-format' from
    // FORMAT_REMEDIED_REFUSALS and this reddens on the count — the refusal reaches
    // the reader with no question asked.
    const r = recorder(UNRECOGNISED_REFUSAL, DRAFTED);
    r.answerFormat('flowise');
    const report = await runImport(r.deps, { source: '/home/reader/mystery.json' });
    assert.deepStrictEqual(r.sent, [
      { source: '/home/reader/mystery.json' },
      { source: '/home/reader/mystery.json', format: 'flowise' },
    ]);
    assert.deepStrictEqual(r.asked, [UNRECOGNISED_REFUSAL.message]);
    assert.strictEqual(report.outcome.kind, 'ok');
  });

  it('reports the refusal as the ending where the reader names no format', async () => {
    for (const named of [undefined, '', '   ']) {
      const r = recorder(AMBIGUOUS_REFUSAL, DRAFTED);
      r.answerFormat(named);
      const report = await runImport(r.deps, { source: '/home/reader/flow.json' });
      assert.strictEqual(r.sent.length, 1, JSON.stringify(named));
      assert.deepStrictEqual(report.outcome, { kind: 'failed', message: AMBIGUOUS_REFUSAL.message });
    }
  });

  it('never asks again for a request that already named a format', async () => {
    const r = recorder(AMBIGUOUS_REFUSAL);
    r.answerFormat('flowise');
    const report = await runImport(r.deps, { source: '/home/reader/flow.json', format: 'langflow' });
    assert.strictEqual(r.sent.length, 1);
    assert.deepStrictEqual(r.asked, []);
    assert.strictEqual(report.outcome.kind, 'failed');
  });

  it('a second refusal of the request carrying the format is the ending', async () => {
    const r = recorder(AMBIGUOUS_REFUSAL, AMBIGUOUS_REFUSAL);
    r.answerFormat('langflow');
    const report = await runImport(r.deps, { source: '/home/reader/flow.json' });
    assert.strictEqual(r.sent.length, 2);
    assert.deepStrictEqual(r.asked, [AMBIGUOUS_REFUSAL.message]);
    assert.strictEqual(report.outcome.kind, 'failed');
  });
});

// --- a preview, and what is counted ----------------------------------------

describe('a preview shows each drafted file and writes nothing', () => {
  it('puts each file it would write on the channel, then its content, after the findings', async () => {
    const r = recorder({
      ...PREVIEWED,
      diagnostics: [{ severity: 'warning', message: 'the edge from A to B names no socket' }],
    });
    const report = await runImport(r.deps, { source: './flow.json', dryRun: true });
    assert.deepStrictEqual(report.lines, [
      '  warning: the edge from A to B names no socket',
      '  would write aggregate.yaml:',
      '    kind: Aggregate',
      '  would write release.yaml:',
      '    kind: Release',
      '  would write .aggrega-import.json:',
      '    {}',
    ]);
  });

  it('ends saying how many drafts it previewed, for where, and that nothing was written', async () => {
    // 🔴 THE COUNT LEAVES THE RECORD OUT: three files, two drafts.
    const r = recorder(PREVIEWED);
    const report = await runImport(r.deps, { source: './flow.json', dryRun: true });
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      'The import previewed 2 files, recognised as langflow, for /work/project, and nothing was written.',
    );
  });

  it('renders a file content line by line, and an empty one as its path alone', () => {
    assert.deepStrictEqual(previewLines({ path: 'a.yaml', content: 'one\ntwo\n' }), [
      '  would write a.yaml:',
      '    one',
      '    two',
    ]);
    assert.deepStrictEqual(previewLines({ path: 'b.yaml', content: '' }), ['  would write b.yaml:']);
  });
});

describe('the drafts are counted without the record of what the import wrote', () => {
  it('counts two drafts where the answer names two drafts and the record', () => {
    // 🔴 PLANTED DEFECT: count every written path in importDetail and this reads
    // "drafted 3 files".
    assert.strictEqual(IMPORT_RECORD_FILE, '.aggrega-import.json');
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome(DRAFTED_WITH_RECORD)),
      'The import drafted 2 files, recognised as langflow, in /work/project.',
    );
  });

  it('still names the record among what reached disk', () => {
    assert.deepStrictEqual(importLines(DRAFTED_WITH_RECORD), [
      '  wrote aggregate.yaml',
      '  wrote release.yaml',
      '  wrote .aggrega-import.json',
    ]);
  });

  it('counts a partial import drafts without the record too', () => {
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, importOutcome({
        ...DRAFTED_WITH_RECORD,
        written: ['aggregate.yaml', '.aggrega-import.json'],
        diagnostics: [{ severity: 'halt', message: 'no mapping for node type CustomAgent' }],
        halted: true,
      })),
      'The import did not complete: the importer could not convert all of the source, recognised as '
      + 'langflow — 1 problem listed above. The 1 file it could draft was written to /work/project.',
    );
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
    await runImport(r.deps, { source: './flow.json' }, signal);
    assert.strictEqual(r.signals.length, 1);
    assert.strictEqual(r.signals[0], signal);
  });

  it('reports an import the reader stopped as stopped, never as broken', async () => {
    // The reader who stopped it must not be told it failed. The classification is
    // by the thrown value's TYPE rather than by its message, so it cannot quietly
    // stop working when a sentence is reworded — which is why the fixture is the
    // real rejection rather than an error wearing its name.
    const r = recorder(new OperationCancelled(IMPORT_SUBJECT));
    const report = await runImport(r.deps, { source: './flow.json' });
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
    const report = await runImport(r.deps, { source: './flow.json' });
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
    // The compiler recognises the format from the source's own shape unless the
    // reader names one, so the answer is where the fact is settled. A reader whose
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
        diagnostics: [(PARTIAL.diagnostics ?? [])[0]],
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
    const report = await runImport(r.deps, { source: './flow.json' });
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

  it('asks for a file or a folder, because the compiler reads either', () => {
    // Narrowing the question to a file would narrow the operation to less than it
    // performs, and offering anything the compiler does not read would invite a
    // value it refuses.
    assert.strictEqual(IMPORT_SOURCE_PROMPT, 'The file or the folder to import');
    assert.strictEqual(IMPORT_SOURCE_TITLE, 'Aggrega: import source');
    assert.deepStrictEqual(IMPORT_SOURCE_KINDS, [
      { label: 'File…', kind: 'file' },
      { label: 'Folder…', kind: 'folder' },
    ]);
  });
});

// --- the mapping decisions ---------------------------------------------------

// DECISION_LINE_CASES is the case manifest the mapping-decision line is held to on
// both sides of the language boundary. The compiler's tree owns it, beside the Go
// formatter it holds; its Langflow entries are the decisions a real import of the
// committed Langflow fixture returns, which the compiler's end-to-end spec requires
// the live session answer to equal.
const DECISION_LINE_CASES = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'aggrega-cli',
  'internal',
  'importops',
  'testdata',
  'decision_line_cases.json',
);

// WANT_DECISION_LINE_CASES_REVISION is the revision of that manifest THIS side was
// written against, and the spec below refuses any other.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF THE GO SPEC'S OWN PINNED COPY, AND IT MUST NOT
// BE UNIFIED WITH IT — not read out of the manifest, not imported, not generated.
// The line is rendered twice across a language boundary on purpose, and two pins
// are what make a green from each side evidence that the side read this revision
// rather than evidence that a comparison agreed. One constant cannot disagree with
// itself, and disagreement is the whole signal.
const WANT_DECISION_LINE_CASES_REVISION = 1;

interface DecisionLineCase {
  name?: string;
  decision: ImportDecision;
  line: string;
}

interface DecisionLineCases {
  revision?: number;
  langflow: DecisionLineCase[];
  shapes: DecisionLineCase[];
}

// 🔴 AN UNREADABLE MANIFEST FAILS HERE; IT DOES NOT STAND THE SPEC DOWN. A side that
// reads nothing and reports success is indistinguishable from one that compared
// every case and agreed, which is how a parity pair rots.
function readDecisionLineCases(): DecisionLineCases {
  let raw: string;
  try {
    raw = fs.readFileSync(DECISION_LINE_CASES, 'utf8');
  } catch (err) {
    throw new Error(
      `decision-line cases unreadable at ${DECISION_LINE_CASES} (${String(err)}). The aggrega-cli sibling `
      + 'checkout holds the shared manifest; without it this spec compares nothing. Check out aggrega-cli '
      + 'beside this repo.',
    );
  }
  const doc = JSON.parse(raw) as DecisionLineCases;
  assert.strictEqual(
    doc.revision,
    WANT_DECISION_LINE_CASES_REVISION,
    `decision-line manifest revision mismatch: this side is pinned to ${WANT_DECISION_LINE_CASES_REVISION}. `
    + "Move this pin and the Go spec's own pin together, and run BOTH sides.",
  );
  assert.ok(doc.langflow.length > 0, 'the manifest holds no Langflow decision');
  assert.ok(doc.shapes.length > 0, 'the manifest holds no shape');
  return doc;
}

describe("the channel carries the importer's mapping decisions", () => {
  it('renders every manifest decision in the line the command line writes for it', () => {
    // 🔴 THE EXPECTED LINE IS THE MANIFEST'S WRITTEN LITERAL, the same one the Go
    // formatter is held to, so the two sides agree because each matches the
    // literal rather than because one was derived from the other. The channel
    // indents every line it writes, so the literal is read indented.
    const cases = readDecisionLineCases();
    for (const tc of [...cases.langflow, ...cases.shapes]) {
      assert.strictEqual(
        decisionLine(tc.decision),
        `  ${tc.line}`,
        `case ${JSON.stringify(tc.name ?? tc.decision.sourceNode.id)}`,
      );
    }
  });

  it("puts the Langflow import's decisions on the channel, after the diagnostics and before what was written", () => {
    // An array equality over the real decisions of the Langflow fixture: every node
    // the importer mapped appears once, in the importer's order, with the choice,
    // tier and score it reported, between the importer's objections and the files
    // that reached disk — the order the command line prints them in.
    //
    // 🔴 PLANTED DEFECT: drop the decisions from importLines (src/import-request.ts)
    // and this case reddens, its three mapped lines missing; render the score with
    // toFixed(4) in decisionLine and the case above reddens on the whole-number and
    // long-score shapes.
    const cases = readDecisionLineCases();
    const lines = importLines({
      ...DRAFTED,
      written: ['aggregate.yaml'],
      diagnostics: [{ severity: 'warning', message: 'the edge from A to B names no socket' }],
      decisions: cases.langflow.map((c) => c.decision),
    });
    assert.deepStrictEqual(lines, [
      '  warning: the edge from A to B names no socket',
      '  mapped OpenAIModel-a1b2 (OpenAIModel) to imported/ai-model/openaimodel as a draft, LOW at 0.3138',
      '  mapped Retrieval-c3d4 (Retrieval) to imported/ai-tool/retrieval as a draft, NONE at 0.0167',
      '  mapped CustomLogic-e5f6 (CustomPythonComponent) to imported/component/custompythoncomponent as a draft, NONE',
      '  wrote aggregate.yaml',
    ]);
  });

  it('carries the node, the choice, the tier and the top score as the importer reported them', () => {
    // Field by field, against independent literals, so a line that re-worded or
    // dropped one fact fails here even where it happened to match a manifest line.
    assert.strictEqual(
      decisionLine({
        sourceNode: { id: 'n1', type: 'OpenAIModel', paramsSummary: 'no parameters' },
        candidates: [
          {
            componentName: 'acme/ai-model/b', score: 0.4, tier: 'LOW',
            signals: { table: 0, category: 0.2, domainLabels: 0.15, shape: 0.05, name: 0 },
          },
          {
            componentName: 'acme/ai-model/a', score: 0.92, tier: 'HIGH',
            signals: { table: 0.5, category: 0.2, domainLabels: 0.15, shape: 0.02, name: 0.05 },
          },
        ],
        chosen: { target: 'acme/ai-model/a', mode: 'reference', tier: 'HIGH' },
      }),
      '  mapped n1 (OpenAIModel) to acme/ai-model/a as a reference, HIGH at 0.92',
    );
    assert.strictEqual(
      decisionLine({ sourceNode: { id: 'n2', type: 'Mystery', paramsSummary: 'no parameters' } }),
      '  made no choice for n2 (Mystery)',
    );
  });

  it('contributes no decision line for an importer that reports none', () => {
    // A COUNT, as for the diagnostics: an empty list adds nothing, and an import
    // whose importer reports no decisions reads as it did before decisions existed.
    assert.deepStrictEqual(importLines({ ...DRAFTED, decisions: [] }), [
      '  wrote aggregate.yaml',
      '  wrote components/api.yaml',
      '  wrote release.yaml',
    ]);
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
    const report = await runImport(r.deps, { source: '/home/reader/Downloads/flow.json' });
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      'The import did not complete: import: the source format of '
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
    const report = await runImport(r.deps, { source: '/home/reader/Downloads/flow.json' });
    assert.strictEqual(
      terminalLine(IMPORT_SUBJECT, report.outcome),
      `${IMPORT_SUBJECT} did not complete: ${COMPILER_REFUSAL}`,
    );
  });

  it('keeps the two facts the refusal named, which a wrapper message would discard', async () => {
    // The load-bearing halves of the compiler's sentence: the file it could not
    // recognise, and the remedy naming what to send instead. A reader acts on both.
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, { source: '/home/reader/Downloads/flow.json' });
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
    const report = await runImport(r.deps, { source: './flow.json' });
    assert.deepStrictEqual(report.outcome, {
      kind: 'failed',
      message: 'the Aggrega language server is not running',
    });
  });

  it('reports a source the compiler refused as a failure, never as a completion', async () => {
    const r = recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL });
    const report = await runImport(r.deps, { source: './flow.json' });
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
    // 🔴 THE VALUE LIST, WHICH IS WHAT THE CLAIM IS ABOUT. The wire shapes come
    // from the published contract rather than being restated here, and they come
    // as declarations alone — erased before anything runs, so the module reaches
    // no code through them. Asserted separately below, because a reading that
    // folded the two together would let a later change from one kind to the other
    // pass unnoticed.
    assert.deepStrictEqual(
      valueImports('src/import-request.ts'),
      ['./cancellation', './error-text', './operation-groups', './operation-outcome'],
    );
    assert.deepStrictEqual(typeOnlyImports('src/import-request.ts'), [WIRE_CONTRACT]);
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
