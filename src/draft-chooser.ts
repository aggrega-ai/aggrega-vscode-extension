// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';

import { CliOperationDeps, reportOutcome, runCliIn } from './cli-operation';
import { exitRefusal } from './cli-run';
import * as l10n from './l10n';
import { outcomeOf, terminalLine } from './operation-outcome';
import { withCancellableProgress } from './progress';
import { SpawnFn, readDaemonVersion } from './version-check';
import { openFolderInWindow } from './window-folders';

// This module owns the Draft button: the list of what can be drafted, and the
// run that writes an example into a folder the reader chooses.
//
// Entity and Import reach the commands that already draft an entity and import
// a source, so each keeps one flow. Example and Quickstart run the compiler on
// the command line in the folder the reader picked, because they are offered in
// a window with no Aggrega folder open, where no language server runs.

// DRAFT_COMMAND is the command the Draft button runs.
export const DRAFT_COMMAND = 'aggrega.op.draft';

// QUICKSTART_PREFIX is how a quickstart is told apart among the examples: by
// its name. The examples' level does not identify one, since the starting level
// holds many examples that are not quickstarts.
export const QUICKSTART_PREFIX = 'quickstart-';

// DRAFT_VERB_SINCE is the first compiler release that answers to `draft`; an
// older one takes the same flags under `scaffold`.
const DRAFT_VERB_SINCE = '0.9.2';

// EXAMPLE_LIST_HEADER is the header row the example list opens with, its
// column names separated the way the compiler's columns are at their narrowest.
const EXAMPLE_LIST_HEADER = /^EXAMPLE {2,}LEVEL {2,}DESCRIPTION\s*$/;

// draftVerb names the subcommand a compiler of this version drafts with.
//
// A development build is built from current sources and takes `draft`. A
// version that cannot be read takes `draft` too: the newer verb is the one the
// compiler documents, and a compiler that reports no version is refused by its
// own words either way.
export function draftVerb(version: string | undefined): 'draft' | 'scaffold' {
  if (version === undefined || version === '(devel)') {
    return 'draft';
  }
  const coerced = semver.coerce(version);
  if (coerced === null) {
    return 'draft';
  }
  return semver.gte(coerced, DRAFT_VERB_SINCE) ? 'draft' : 'scaffold';
}

// ExampleRow is one example as the list prints it.
export interface ExampleRow {
  name: string;
  level: string;
  description: string;
}

// parseExampleList reads the table `<verb> --example --list` prints.
//
// The columns are located by where the header's words start, because the
// descriptions hold spaces and the compiler aligns every column to its widest
// entry. Text that does not carry the header is not a list, and the error says
// what was read so the reader can see what the compiler answered instead.
export function parseExampleList(text: string): ExampleRow[] {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => EXAMPLE_LIST_HEADER.test(line));
  if (at < 0) {
    throw new Error(l10n.t(
      'the example list did not carry the header "EXAMPLE  LEVEL  DESCRIPTION"; it read: {0}',
      text.trim(),
    ));
  }
  const header = lines[at];
  const levelAt = header.indexOf('LEVEL');
  const descriptionAt = header.indexOf('DESCRIPTION');
  return lines.slice(at + 1)
    .filter((line) => line.trim() !== '')
    .map((line) => ({
      name: line.slice(0, levelAt).trim(),
      level: line.slice(levelAt, descriptionAt).trim(),
      description: line.slice(descriptionAt).trim(),
    }));
}

// quickstartsOf keeps the examples that are quickstarts.
export function quickstartsOf(rows: ExampleRow[]): ExampleRow[] {
  return rows.filter((row) => row.name.startsWith(QUICKSTART_PREFIX));
}

// DraftChoice names the four things the Draft button drafts.
export type DraftChoice = 'entity' | 'example' | 'quickstart' | 'import';

// DraftChoiceItem is one row of the list the Draft button opens.
export interface DraftChoiceItem extends vscode.QuickPickItem {
  choice: DraftChoice;
}

// draftChoices is the list the Draft button opens, in the order it is shown.
export function draftChoices(): DraftChoiceItem[] {
  return [
    {
      choice: 'entity',
      label: `$(new-file) ${l10n.t('Entity')}`,
      description: l10n.t('A starter document for one entity kind'),
    },
    {
      choice: 'example',
      label: `$(book) ${l10n.t('Example')}`,
      description: l10n.t('A documented example, written into a folder'),
    },
    {
      choice: 'quickstart',
      label: `$(rocket) ${l10n.t('Quickstart')}`,
      description: l10n.t('A quickstart to grow step by step, written into a folder'),
    },
    {
      choice: 'import',
      label: `$(insert) ${l10n.t('Import')}`,
      description: l10n.t('Entities from a foreign source'),
    },
  ];
}

// DraftDeps is what the Draft button reaches: the compiler, the channel its
// transcript goes to, the version read, and the anchored folder where one is
// open — the folder the list is read from, which falls back to the home folder.
export interface DraftDeps extends Pick<CliOperationDeps, 'getBinaryPath' | 'output'> {
  runVersion: SpawnFn;
  getWorkspaceRoot(): string | null;
}

// OPEN_FOLDER_ACTION is the button the success offers.
const OPEN_FOLDER_ACTION = l10n.t('Open Folder');

// runDraft opens the list of choices and runs the one chosen.
export async function runDraft(deps: DraftDeps): Promise<void> {
  const picked = await vscode.window.showQuickPick(draftChoices(), {
    placeHolder: l10n.t('What to draft'),
  });
  if (!picked) { return; }
  switch (picked.choice) {
    case 'entity':
      await vscode.commands.executeCommand('aggrega.op.scaffold');
      return;
    case 'import':
      await vscode.commands.executeCommand('aggrega.op.import');
      return;
    case 'example':
      await draftExample(deps, false);
      return;
    case 'quickstart':
      await draftExample(deps, true);
      return;
  }
}

// draftExample lists the examples, asks for one and for the folder its folder
// goes in, and has the compiler write it there.
//
// The compiler creates `<folder>/<name>` and refuses a folder of that name that
// is not empty, in its own words, so nothing here checks the destination first:
// a check of its own would be a second statement of the compiler's rule.
async function draftExample(deps: DraftDeps, quickstartsOnly: boolean): Promise<void> {
  const reading = await readDaemonVersion({ binaryPath: deps.getBinaryPath(), spawn: deps.runVersion });
  const verb = draftVerb(reading.kind === 'reported' ? reading.version : undefined);

  const listing = l10n.t('The example list');
  let rows: ExampleRow[];
  try {
    const run = await withCancellableProgress(l10n.t('Reading the examples'), (signal) =>
      runCliIn(deps, deps.getWorkspaceRoot() ?? os.homedir(), listing, [verb, '--example', '--list'], signal),
    );
    if (run.code !== 0) {
      await reportOutcome(deps, listing, { kind: 'failed', message: exitRefusal(run) }, true);
      return;
    }
    rows = parseExampleList(run.stdout);
  } catch (err) {
    await reportOutcome(deps, listing, outcomeOf(err), true);
    return;
  }
  if (quickstartsOnly) {
    rows = quickstartsOf(rows);
  }
  if (rows.length === 0) {
    void vscode.window.showInformationMessage(quickstartsOnly
      ? l10n.t('The compiler lists no quickstarts.')
      : l10n.t('The compiler lists no examples.'));
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    rows.map((row) => ({ label: row.name, description: row.level, detail: row.description })),
    {
      placeHolder: quickstartsOnly ? l10n.t('Choose a quickstart') : l10n.t('Choose an example'),
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!chosen) { return; }
  const name = chosen.label;

  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: l10n.t('Write Here'),
    title: l10n.t('Choose where the folder {0} goes', name),
  });
  if (!folders || folders.length === 0) { return; }
  const parent = folders[0].fsPath;

  const what = l10n.t('The example {0}', name);
  try {
    const run = await withCancellableProgress(l10n.t('Writing the example {0}', name), (signal) =>
      runCliIn(deps, parent, what, [verb, '--example', name], signal),
    );
    if (run.code !== 0) {
      await reportOutcome(deps, what, { kind: 'failed', message: exitRefusal(run) }, true);
      return;
    }
  } catch (err) {
    await reportOutcome(deps, what, outcomeOf(err), true);
    return;
  }

  const written = path.join(parent, name);
  const done = { kind: 'ok', detail: l10n.t('is written into {0}.', written) } as const;
  await reportOutcome(deps, what, done, false);
  const choice = await vscode.window.showInformationMessage(terminalLine(what, done), OPEN_FOLDER_ACTION);
  if (choice === OPEN_FOLDER_ACTION) {
    // The editor's refusal to open the folder comes back as a rejection, told
    // here because the command's handler discards what it settles with.
    try {
      await openFolderInWindow(vscode.Uri.file(written));
    } catch (err) {
      await reportOutcome(deps, l10n.t('Opening the folder {0}', written), outcomeOf(err), true);
    }
  }
}
