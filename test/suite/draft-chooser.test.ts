// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.
//
// The Draft button: the four choices it opens, the verb a compiler is asked with,
// the example list it reads, and the run that writes an example into a folder the
// reader chose — which works with no Aggrega folder open, so it runs the compiler
// on the command line in a working directory the caller names.
//
// The flow is RUN with the editor host stood in and a stand-in compiler: a small
// script that answers the three invocations the flow makes the way the compiler
// does. The menus are READ from the manifest on disk.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

import { loadAgainstEditorStub } from '../helpers/editor-stub';
import { readManifest, readRawManifest } from '../helpers/manifest';

type DraftChooser = typeof import('../../src/draft-chooser');
type CliOperation = typeof import('../../src/cli-operation');

// A table as `aggrega draft --example --list` prints it, captured from a compiler
// and cut to four rows: aligned columns, descriptions of many words.
const CAPTURED_LIST = [
  'EXAMPLE                   LEVEL      DESCRIPTION',
  'quickstart-ai             start      A small LangGraph agent, grown in four steps: it starts on a local model.',
  'quickstart-web            start      A small web application that keeps notes in PostgreSQL.',
  'terraform-rds             authoring  A single MariaDB database authored once as developer intent.',
  'cloudformation-rds-stack  advanced   A managed database and the application that reads it.',
  '',
].join('\n');

// --- the editor stand-in ---------------------------------------------------

interface Met {
  quickPicks: { items: Array<{ label: string; description?: string; detail?: string }>; placeHolder?: string }[];
  executed: unknown[][];
  infos: { message: string; actions: string[] }[];
  errors: string[];
  progressTitles: string[];
  dialogs: unknown[];
}

function freshMet(): Met {
  return { quickPicks: [], executed: [], infos: [], errors: [], progressTitles: [], dialogs: [] };
}

// editorStub answers each quick pick with the item whose label the next entry of
// picks names, the folder dialog with folder, and an information message with
// infoAnswer.
function editorStub(met: Met, picks: string[], folder: string | undefined, infoAnswer?: string): unknown {
  return {
    window: {
      showQuickPick: async (items: Array<{ label: string }>, options?: { placeHolder?: string }) => {
        met.quickPicks.push({ items, placeHolder: options?.placeHolder });
        const want = picks.shift();
        return items.find((item) => item.label === want);
      },
      showOpenDialog: async (options: unknown) => {
        met.dialogs.push(options);
        return folder === undefined ? undefined : [{ fsPath: folder }];
      },
      withProgress: async (
        options: { title: string },
        work: (p: unknown, token: unknown) => Promise<unknown>,
      ) => {
        met.progressTitles.push(options.title);
        return work({ report: () => undefined }, {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        });
      },
      showInformationMessage: async (message: string, ...actions: string[]) => {
        met.infos.push({ message, actions });
        return infoAnswer;
      },
      showErrorMessage: async (message: string) => {
        met.errors.push(message);
        return undefined;
      },
    },
    commands: {
      executeCommand: async (...args: unknown[]) => { met.executed.push(args); },
    },
    Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
    ProgressLocation: { Notification: 15 },
  };
}

function channel(): { lines: string[]; append(t: string): void; appendLine(t: string): void; show(): void } {
  const lines: string[] = [];
  return {
    lines,
    append: (t) => { lines.push(t); },
    appendLine: (t) => { lines.push(`${t}\n`); },
    show: () => undefined,
  };
}

// runVersion is the production shape of the version read: run the binary and
// answer with what it printed.
function runVersion(binaryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// fakeCompiler writes a script answering `version -o json` with version, the
// list with CAPTURED_LIST, and an example write the way the compiler does: into
// <cwd>/<name>, refused where that folder exists and is not empty. Every
// invocation's arguments are appended to calls.
function fakeCompiler(dir: string, version: string): { bin: string; calls: string } {
  const bin = path.join(dir, 'aggrega');
  const calls = path.join(dir, 'calls.log');
  const script = `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (args[0] === 'version') {
  process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)} }));
} else if (args.includes('--list')) {
  process.stdout.write(${JSON.stringify(CAPTURED_LIST)});
} else {
  const name = args[args.indexOf('--example') + 1];
  const target = path.join(process.cwd(), name);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    process.stderr.write('the directory ' + target + ' exists and is not empty\\n');
    process.exitCode = 1;
  } else {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'aggregate.yaml'), 'kind: Aggregate\\n');
    process.stdout.write('Wrote the example ' + name + ' into ' + target + ' (1 file)\\n');
  }
}
`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return { bin, calls };
}

function readCalls(calls: string): Array<{ args: string[]; cwd: string }> {
  return fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-draft-'));
}

// --- the pure parts ----------------------------------------------------------

describe('the verb the Draft button asks a compiler with', () => {
  const { draftVerb } = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');

  it('asks a development build and every compiler from 0.9.2 on to draft', () => {
    for (const version of ['(devel)', '0.9.2', '0.9.2-rc.1', '0.10.0']) {
      assert.strictEqual(draftVerb(version), 'draft', version);
    }
  });

  it('asks a compiler older than 0.9.2 to scaffold', () => {
    for (const version of ['0.9.1', '0.9.0', '0.9.1-dirty']) {
      assert.strictEqual(draftVerb(version), 'scaffold', version);
    }
  });

  it('asks a compiler whose version could not be read to draft', () => {
    assert.strictEqual(draftVerb(undefined), 'draft');
    assert.strictEqual(draftVerb('not a version'), 'draft');
  });
});

describe('the example list the compiler prints', () => {
  const { parseExampleList, quickstartsOf } = loadAgainstEditorStub<DraftChooser>(
    editorStub(freshMet(), [], undefined), 'draft-chooser');

  it('reads each row by the header\'s column offsets, descriptions whole', () => {
    assert.deepStrictEqual(parseExampleList(CAPTURED_LIST), [
      { name: 'quickstart-ai', level: 'start', description: 'A small LangGraph agent, grown in four steps: it starts on a local model.' },
      { name: 'quickstart-web', level: 'start', description: 'A small web application that keeps notes in PostgreSQL.' },
      { name: 'terraform-rds', level: 'authoring', description: 'A single MariaDB database authored once as developer intent.' },
      { name: 'cloudformation-rds-stack', level: 'advanced', description: 'A managed database and the application that reads it.' },
    ]);
  });

  it('reads a header with no rows as no examples', () => {
    assert.deepStrictEqual(parseExampleList('EXAMPLE  LEVEL  DESCRIPTION\n'), []);
  });

  it('refuses text without the header, naming what it read', () => {
    assert.throws(
      () => parseExampleList('Error: no documentation is published\n'),
      (err: Error) => err.message.includes('EXAMPLE  LEVEL  DESCRIPTION')
        && err.message.includes('Error: no documentation is published'),
    );
  });

  it('offers as quickstarts only the examples named quickstart-', () => {
    assert.deepStrictEqual(
      quickstartsOf(parseExampleList(CAPTURED_LIST)).map((row) => row.name),
      ['quickstart-ai', 'quickstart-web'],
    );
  });
});

// --- the runner taking a working directory ------------------------------------

describe('a command-line run in a working directory the caller names', () => {
  it('runs in that directory and answers with both streams and the status', async () => {
    const { runCliIn } = loadAgainstEditorStub<CliOperation>(editorStub(freshMet(), [], undefined), 'cli-operation');
    const where = fs.realpathSync(tmp());
    const out = channel();
    const script = "process.stdout.write(process.cwd()); process.stderr.write('warned\\n'); process.exitCode = 3;";
    const run = await runCliIn(
      { getBinaryPath: () => process.execPath, output: out as never },
      where,
      'The run',
      ['-e', script],
    );
    assert.deepStrictEqual(run, { code: 3, stdout: where, stderr: 'warned\n' });
    // The transcript names the command and the directory, and carries the output.
    assert.ok(out.lines.join('').includes(`(cwd: ${where})`), out.lines.join(''));
    assert.ok(out.lines.join('').includes('warned'), out.lines.join(''));
  });
});

// --- the four choices and the flow ----------------------------------------------

describe('the list of choices the Draft button opens', () => {
  it('offers Entity, Example, Quickstart and Import, in that order, each with a line saying what it drafts', async () => {
    const met = freshMet();
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(editorStub(met, [], undefined), 'draft-chooser');
    await runDraft({ getBinaryPath: () => 'aggrega', output: channel() as never, runVersion, getWorkspaceRoot: () => null });
    assert.strictEqual(met.quickPicks.length, 1);
    assert.deepStrictEqual(
      met.quickPicks[0].items.map((item) => item.label.replace(/^\$\([a-z-]+\) /, '')),
      ['Entity', 'Example', 'Quickstart', 'Import'],
    );
    for (const item of met.quickPicks[0].items) {
      assert.match(item.label, /^\$\([a-z-]+\) /, `${item.label} carries no icon`);
      assert.ok(item.description && item.description.length > 0, `${item.label} says nothing about what it drafts`);
    }
    assert.ok(met.quickPicks[0].placeHolder, 'the list carries no placeholder');
    assert.deepStrictEqual(met.executed, [], 'dismissing the list ran something');
  });

  for (const [choice, command] of [['Entity', 'aggrega.op.scaffold'], ['Import', 'aggrega.op.import']] as const) {
    it(`runs ${command} for ${choice}`, async () => {
      const met = freshMet();
      const mod = loadAgainstEditorStub<DraftChooser>(editorStub(met, [], undefined), 'draft-chooser');
      const label = mod.draftChoices().find((c) => c.label.endsWith(` ${choice}`))!.label;
      const met2 = freshMet();
      const { runDraft } = loadAgainstEditorStub<DraftChooser>(editorStub(met2, [label], undefined), 'draft-chooser');
      await runDraft({ getBinaryPath: () => 'aggrega', output: channel() as never, runVersion, getWorkspaceRoot: () => null });
      assert.deepStrictEqual(met2.executed, [[command]]);
    });
  }
});

describe('drafting an example into a folder, with no Aggrega folder open', () => {
  function labelOf(mod: DraftChooser, choice: string): string {
    return mod.draftChoices().find((c) => c.label.endsWith(` ${choice}`))!.label;
  }

  it('lists with the verb the compiler takes, writes into the chosen folder, and offers to open it', async () => {
    const dir = fs.realpathSync(tmp());
    const parent = path.join(dir, 'parent');
    fs.mkdirSync(parent);
    const { bin, calls } = fakeCompiler(dir, '0.9.1');
    const met = freshMet();
    const probe = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(
      editorStub(met, [labelOf(probe, 'Example'), 'terraform-rds'], parent, 'Open Folder'),
      'draft-chooser',
    );
    const out = channel();
    await runDraft({ getBinaryPath: () => bin, output: out as never, runVersion, getWorkspaceRoot: () => null });

    assert.deepStrictEqual(met.errors, []);
    // Every example is offered, with its level and description.
    assert.deepStrictEqual(met.quickPicks[1].items.map((i) => i.label),
      ['quickstart-ai', 'quickstart-web', 'terraform-rds', 'cloudformation-rds-stack']);
    assert.strictEqual(met.quickPicks[1].items[2].description, 'authoring');
    assert.strictEqual(met.quickPicks[1].items[2].detail, 'A single MariaDB database authored once as developer intent.');
    // A compiler older than 0.9.2 is asked to scaffold; the write runs in the chosen folder.
    const made = readCalls(calls);
    assert.deepStrictEqual(made.map((c) => c.args), [
      ['version', '-o', 'json'],
      ['scaffold', '--example', '--list'],
      ['scaffold', '--example', 'terraform-rds'],
    ]);
    assert.strictEqual(made[2].cwd, parent);
    assert.ok(fs.existsSync(path.join(parent, 'terraform-rds', 'aggregate.yaml')));
    // The folder dialog asks for one folder.
    assert.deepStrictEqual(
      [(met.dialogs[0] as { canSelectFolders: boolean }).canSelectFolders,
        (met.dialogs[0] as { canSelectFiles: boolean }).canSelectFiles,
        (met.dialogs[0] as { canSelectMany: boolean }).canSelectMany],
      [true, false, false],
    );
    // The write ran under the progress notification.
    assert.ok(met.progressTitles.some((t) => t.includes('terraform-rds')), met.progressTitles.join(' | '));
    // The success says where, offers Open Folder, and opening it opens that folder.
    const success = met.infos.find((i) => i.actions.includes('Open Folder'));
    assert.ok(success, JSON.stringify(met.infos));
    assert.ok(success.message.includes(path.join(parent, 'terraform-rds')), success.message);
    assert.deepStrictEqual(met.executed, [['vscode.openFolder', { fsPath: path.join(parent, 'terraform-rds'), scheme: 'file' }]]);
    // The compiler's output is kept on the channel.
    assert.ok(out.lines.join('').includes('Wrote the example terraform-rds'), out.lines.join(''));
  });

  it('offers only the quickstarts for Quickstart, and asks a development build to draft', async () => {
    const dir = fs.realpathSync(tmp());
    const { bin, calls } = fakeCompiler(dir, '(devel)');
    const met = freshMet();
    const probe = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(
      editorStub(met, [labelOf(probe, 'Quickstart'), 'quickstart-web'], dir),
      'draft-chooser',
    );
    await runDraft({ getBinaryPath: () => bin, output: channel() as never, runVersion, getWorkspaceRoot: () => null });
    assert.deepStrictEqual(met.quickPicks[1].items.map((i) => i.label), ['quickstart-ai', 'quickstart-web']);
    assert.deepStrictEqual(readCalls(calls).map((c) => c.args).slice(1), [
      ['draft', '--example', '--list'],
      ['draft', '--example', 'quickstart-web'],
    ]);
    assert.ok(fs.existsSync(path.join(dir, 'quickstart-web', 'aggregate.yaml')));
  });

  it('shows the compiler\'s own refusal where the folder is not empty, and opens nothing', async () => {
    const dir = fs.realpathSync(tmp());
    fs.mkdirSync(path.join(dir, 'terraform-rds'));
    fs.writeFileSync(path.join(dir, 'terraform-rds', 'keep.txt'), 'mine');
    const { bin } = fakeCompiler(dir, '0.9.2');
    const met = freshMet();
    const probe = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(
      editorStub(met, [labelOf(probe, 'Example'), 'terraform-rds'], dir, 'Open Folder'),
      'draft-chooser',
    );
    await runDraft({ getBinaryPath: () => bin, output: channel() as never, runVersion, getWorkspaceRoot: () => null });
    assert.strictEqual(met.errors.length, 1);
    assert.ok(
      met.errors[0].includes(`the directory ${path.join(dir, 'terraform-rds')} exists and is not empty`),
      met.errors[0],
    );
    assert.deepStrictEqual(met.executed, []);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'terraform-rds', 'keep.txt'), 'utf8'), 'mine');
  });

  it('tells the reader where the editor refuses to open the written folder', async () => {
    const dir = fs.realpathSync(tmp());
    const { bin } = fakeCompiler(dir, '0.9.2');
    const met = freshMet();
    const probe = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');
    const stub = editorStub(met, [labelOf(probe, 'Example'), 'terraform-rds'], dir, 'Open Folder') as {
      commands: { executeCommand: (...args: unknown[]) => Promise<void> };
    };
    stub.commands.executeCommand = async () => { throw new Error('the folder could not be opened'); };
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(stub, 'draft-chooser');
    await runDraft({ getBinaryPath: () => bin, output: channel() as never, runVersion, getWorkspaceRoot: () => null });
    assert.strictEqual(met.errors.length, 1, JSON.stringify(met.errors));
    assert.ok(met.errors[0].includes('the folder could not be opened'), met.errors[0]);
    assert.ok(met.errors[0].includes(path.join(dir, 'terraform-rds')), met.errors[0]);
  });

  it('writes nothing where the reader closes the folder dialog', async () => {
    const dir = fs.realpathSync(tmp());
    const { bin, calls } = fakeCompiler(dir, '0.9.2');
    const met = freshMet();
    const probe = loadAgainstEditorStub<DraftChooser>(editorStub(freshMet(), [], undefined), 'draft-chooser');
    const { runDraft } = loadAgainstEditorStub<DraftChooser>(
      editorStub(met, [labelOf(probe, 'Example'), 'terraform-rds'], undefined),
      'draft-chooser',
    );
    await runDraft({ getBinaryPath: () => bin, output: channel() as never, runVersion, getWorkspaceRoot: () => null });
    assert.deepStrictEqual(readCalls(calls).map((c) => c.args[c.args.length - 1]), ['json', '--list']);
  });
});

// --- the menus ----------------------------------------------------------------

describe('where the Draft button is drawn', () => {
  const manifest = readManifest();

  // The Explorer draws one view with a folder open and another with none, and
  // the button is in both, since the example choices are for the empty window.
  it('is in the title bar of the four Aggrega panels and of the Explorer, and nowhere else', () => {
    const entries = (manifest.contributes.menus['view/title'] as Array<{ command: string; when: string; group?: string }>)
      .filter((m) => m.command === 'aggrega.op.draft');
    assert.deepStrictEqual(
      entries.map((m) => m.when).sort(),
      [
        'view == aggrega.operations',
        'view == aggrega.plugins',
        'view == aggrega.registries',
        'view == aggrega.workspaceCatalog',
        'view == workbench.explorer.emptyView',
        'view == workbench.explorer.fileView',
      ],
    );
    for (const entry of entries) {
      assert.strictEqual(entry.group, 'navigation', entry.when);
    }
  });

  it('is a declared command titled Draft with the edit icon', () => {
    type Commands = Array<{ command: string; title: string; icon?: string }>;
    const raw = readRawManifest() as { contributes: { commands: Commands } };
    const command = raw.contributes.commands.find((c) => c.command === 'aggrega.op.draft');
    assert.ok(command, 'aggrega.op.draft is not contributed');
    assert.strictEqual(command.title, '%command.aggrega.op.draft.title%');
    assert.strictEqual(command.icon, '$(edit)');
    // As the editor draws it, with its text in place.
    const english = (manifest.contributes.commands as Commands).find((c) => c.command === 'aggrega.op.draft');
    assert.strictEqual(english?.title, 'Draft');
  });
});
