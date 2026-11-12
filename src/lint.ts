// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { CancellationSignal } from './cancellation';
import { replaceLintFindings } from './diagnostics';
import {
  CATALOG_WIDE,
  LintAnswer,
  LintRunDeps,
  LintSubject,
  entityLintSubject,
  runLint,
} from './lint-run';
import { withCancellableProgress } from './progress';

// LintRunner is the handle the surfaces that offer this check hold.
//
// The two entries differ only in their subject: run() checks every catalog
// entity the workspace configures, and runEntity() checks one. They share a
// collection rather than having one each, because they answer one question and a
// second layer in the Problems panel would be a thing a reader has to learn in
// order to read what is already there.
export interface LintRunner {
  run(): Promise<void>;
  runEntity(entityPath: string): Promise<void>;
  // clear empties the collection both runs write into. Its findings are a
  // language server's answer, so they go when a new server comes up, with the
  // rest of what the stopped one said.
  clear(): void;
}

// LintDeps is the live extension state the runner reads: the anchored root the
// check runs over, the way to ask the compiler for it, and the shared output
// channel that carries the findings.
export interface LintDeps {
  getWorkspaceRoot(): string | null;
  lint(subject: LintSubject, signal?: CancellationSignal): Promise<LintAnswer>;
  output: vscode.OutputChannel;
}

// activateLint creates the conventions linter's one diagnostic collection and
// returns the runner every surface offering this check invokes.
//
// This module is the whole editor-coupled boundary of the lint surface: it
// constructs the collection and the notifications, and delegates every decision
// to runLint, which depends on no editor type and is therefore directly
// testable. The collection is separate from the language server's on purpose —
// see replaceLintFindings — and joins the extension's disposable registry so it
// is torn down with the extension.
export function activateLint(context: vscode.ExtensionContext, deps: LintDeps): LintRunner {
  const collection = vscode.languages.createDiagnosticCollection('aggrega-lint');
  context.subscriptions.push(collection);

  // One dependency set for both subjects, so the two runs write into one
  // collection and end in one voice. A second set would be a second answer to
  // where a finding lands.
  const runDeps: LintRunDeps = {
    getWorkspaceRoot: deps.getWorkspaceRoot,
    lint: (subject, s) => deps.lint(subject, s),
    sink: { replace: (publication) => replaceLintFindings(collection, publication) },
    log: {
      appendLine: (text) => deps.output.appendLine(text),
      show: () => deps.output.show(true),
    },
    notify: (message, tier) => {
      if (tier === 'error') {
        void vscode.window.showErrorMessage(message);
      } else {
        void vscode.window.showInformationMessage(message);
      }
    },
  };

  // Both runs are watched and can be stopped — behind the same indicator, with
  // the same button, as every other operation on the surface, so a reader need
  // not know which subject costs enough to be worth ending.
  //
  // 🔴 THE STOP IS OFFERED BECAUSE THE COMPILER CAN HONOUR ONE, READ OFF THE
  // COMPILER RATHER THAN ASSUMED, AND WHAT IT REACHES DIFFERS BY SUBJECT. Over
  // the whole catalog the request's own context is what the tree walk and the
  // per-entity loop observe, so a stop abandons the entities not yet reached; the
  // walk grows with the catalog, which is what makes that worth offering. Over one
  // entity the same context is observed once, immediately before the rules are
  // dispatched, so a stop abandons the rules — while a reader who presses it after
  // they have begun ends their own wait only. Offering the button on both is what
  // keeps the two from presenting differently for a difference neither of them
  // can see.
  return {
    run: () => withCancellableProgress('Aggrega: checking publishing conventions', (signal) =>
      runLint(runDeps, CATALOG_WIDE, signal),
    ),
    runEntity: (entityPath) => {
      // Composed before the indicator is drawn, so a row that supplied nothing
      // refuses where it was pressed rather than behind a progress notification
      // that would then have to explain itself.
      const subject = entityLintSubject(entityPath);
      return withCancellableProgress(
        `Aggrega: checking the publishing conventions for ${entityPath}`,
        (signal) => runLint(runDeps, subject, signal),
      );
    },
    clear: () => collection.clear(),
  };
}
