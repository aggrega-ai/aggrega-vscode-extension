// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { CancellationSignal } from './cancellation';
import { runCliProcess } from './cli-run';
import {
  OperationOutcome,
  SHOW_OUTPUT_ACTION,
  outcomeOf,
  terminalLine,
} from './operation-outcome';
import { withCancellableProgress } from './progress';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// This module owns what it means to invoke the compiler on behalf of a panel and
// tell the reader how it ended. Every panel that runs a command-line-backed
// operation reaches it, so "the single path for every CLI-backed operation" is a
// property of the extension rather than of one panel: a second panel spawning
// its own child would report differently the first time an invocation failed,
// and nothing would fail while the two agreed.

// CliOperationDeps is what an invocation needs and no more: where to run, what
// to run, and where the output goes. It is declared this narrowly so any panel
// satisfies it structurally — the surface that owns a panel supplies its own
// richer dependency set and passes it here unchanged.
export interface CliOperationDeps {
  // getWorkspaceRoot reports the anchored folder every invocation runs in. A
  // null answer is not an error: it is a run that cannot be composed, and it is
  // reported rather than attempted.
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
}

// reportOutcome is where every operation ends.
//
// The channel always gets the line, because it is the record a reader returns
// to. A notification is raised on top of it in the three cases where the reader
// may not be looking at the channel: a failure, an operation they stopped, and
// an operation whose completion they were told to wait for. Announcing an
// ordinary short success as well would put a notification in front of a reader
// for something they can already see, which is what teaches them to dismiss
// notifications unread — and that habit costs the surfaces carrying real
// findings, not this one.
//
// A failure carries the compiler's own message and an action beside it. The
// button reaches the compiler's full output; it replaces none of its words.
export async function reportOutcome(
  deps: CliOperationDeps,
  what: string,
  outcome: OperationOutcome,
  announce: boolean,
): Promise<void> {
  const line = terminalLine(what, outcome);
  deps.output.appendLine(line);
  if (outcome.kind === 'failed') {
    const choice = await vscode.window.showErrorMessage(line, SHOW_OUTPUT_ACTION);
    if (choice === SHOW_OUTPUT_ACTION) {
      deps.output.show(true);
    }
    return;
  }
  if (outcome.kind === 'cancelled' || announce) {
    void vscode.window.showInformationMessage(line);
  }
}

// runCli spawns `aggrega <args>` in the anchored workspace root and streams its
// output to the shared channel. It is the single path for every CLI-backed
// operation, so a new operation is a thin entry rather than a bespoke spawn.
// The compiler owns the work; this surface only invokes it and surfaces its
// output verbatim — including its own errors, which are more useful to the
// author than a re-worded wrapper message.
//
// It resolves rather than returning immediately, and holds the child for the
// whole run, so an operation that takes a while can be watched and stopped. A
// handle kept in a local the function returns past is unreachable while the
// compiler is running, which is the shape that makes an operation unstoppable.
//
// what is the operation in the reader's terms, used for the line the run ends
// in. A run that could not be started at all — no anchored folder — reports that
// and resolves without having invoked anything.
//
// detail is the sentence a completed run ends in, so a publication can say what
// consumers now resolve rather than merely that it finished; those are
// different facts and only one of them is useful. announce raises a
// notification on an ordinary completion, for the operations a reader is told
// to wait for.
export async function runCli(
  deps: CliOperationDeps,
  what: string,
  args: string[],
  options: { announce?: boolean; detail?: string; signal?: CancellationSignal } = {},
): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const bin = deps.getBinaryPath();
  const out = deps.output;
  out.show(true);
  out.appendLine(`\n$ ${bin} ${args.join(' ')}   (cwd: ${root})`);

  try {
    const code = await runCliProcess(
      {
        spawn: () => spawn(bin, args, { cwd: root }),
        append: (text) => out.append(text),
        appendLine: (text) => out.appendLine(text),
      },
      what,
      options.signal,
    );
    // A non-zero status is the compiler declining to do the work, and the
    // reason is already on the channel in its own words. It is reported as a
    // failure so the remedy button appears beside it; the status itself is
    // named because it is what a reader comparing this run with a command line
    // would see.
    if (code !== 0) {
      await reportOutcome(
        deps,
        what,
        { kind: 'failed', message: `the compiler exited with status ${code ?? 'unknown'}.` },
        true,
      );
      return;
    }
    await reportOutcome(
      deps,
      what,
      { kind: 'ok', detail: options.detail ?? 'completed.' },
      options.announce ?? false,
    );
  } catch (err) {
    await reportOutcome(deps, what, outcomeOf(err), true);
  }
}

// runWatchableCli runs a command-line-backed operation behind the progress
// indicator, so it can be watched and stopped.
//
// The title is what the indicator reads while the work runs; what is how the
// ending is worded. Both are the reader's terms rather than the verb's. It is
// the same presentation the language-server-backed operations use, so a reader
// pressing cancel need not know which transport an operation happens to take.
export async function runWatchableCli(
  deps: CliOperationDeps,
  title: string,
  what: string,
  args: string[],
  detail?: string,
): Promise<void> {
  await withCancellableProgress(title, (signal) =>
    runCli(deps, what, args, { announce: true, detail, signal }),
  );
}
