// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { runCliJson } from './cli-json';
import { replaceLintFindings } from './diagnostics';
import { LintDocument, runLint } from './lint-run';
import { withCancellableProgress } from './progress';

// LintRunner is the handle the operation surface holds. Invoking run() lints
// the workspace and republishes the linter's findings.
export interface LintRunner {
  run(): Promise<void>;
}

// LintDeps is the live extension state the runner reads: the anchored root the
// linter runs in, the configured binary path, and the shared output channel
// that carries the product's own report.
export interface LintDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
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

  // The linter walks every catalog entity, so the run is watched and can be
  // stopped — behind the same indicator, with the same button, as every other
  // long operation on the surface.
  //
  // It is invoked as a command for that stop. The walk covers every entity the
  // configured catalog directories hold, so its cost grows with the catalog and a
  // reader who started one by mistake has something worth ending; and it is
  // reached with no cancellation, so the stop exists while it runs as a command
  // and could not be offered honestly over the language server. The signal below
  // is what reaches the walk.
  return {
    run: () => withCancellableProgress('Aggrega: checking publishing conventions', (signal) =>
      runLint({
        getWorkspaceRoot: deps.getWorkspaceRoot,
        runLintJson: (s) => runCliJson<LintDocument>(deps, ['lint', '-o', 'json'], s, 'The lint'),
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
