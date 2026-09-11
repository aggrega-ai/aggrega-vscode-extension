// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { CancellationSignal } from './cancellation';
import { replaceLintFindings } from './diagnostics';
import { LintAnswer, runLint } from './lint-run';
import { withCancellableProgress } from './progress';

// LintRunner is the handle the operation surface holds. Invoking run() checks
// the workspace's publishing conventions and republishes what was found.
export interface LintRunner {
  run(): Promise<void>;
}

// LintDeps is the live extension state the runner reads: the anchored root the
// check runs over, the way to ask the compiler for it, and the shared output
// channel that carries the findings.
export interface LintDeps {
  getWorkspaceRoot(): string | null;
  lint(signal?: CancellationSignal): Promise<LintAnswer>;
  output: vscode.OutputChannel;
}

// activateLint creates the conventions linter's own diagnostic collection and
// returns the runner the lint operation invokes.
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

  // The check walks every catalog entity, so the run is watched and can be
  // stopped — behind the same indicator, with the same button, as every other
  // long operation on the surface.
  //
  // 🔴 THE STOP IS OFFERED BECAUSE THE COMPILER CAN HONOUR ONE, WHICH IS READ OFF
  // THE COMPILER RATHER THAN ASSUMED. The request's own context is what the tree
  // walk and the per-entity loop observe, so a reader's stop abandons the
  // remaining entities rather than only ending this side's wait for an answer.
  // The cost is the reason it matters: the walk covers every entity the
  // configured catalog directories hold, so it grows with the catalog and a
  // reader who started one by mistake has something worth ending.
  return {
    run: () => withCancellableProgress('Aggrega: checking publishing conventions', (signal) =>
      runLint({
        getWorkspaceRoot: deps.getWorkspaceRoot,
        lint: (s) => deps.lint(s),
        sink: { replace: (byFile) => replaceLintFindings(collection, byFile) },
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
      }, signal),
    ),
  };
}
