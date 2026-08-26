// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { runCliJson } from './cli-json';
import { replaceLintFindings } from './diagnostics';
import { LintDocument, runLint } from './lint-run';

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

  return {
    run: () =>
      runLint({
        getWorkspaceRoot: deps.getWorkspaceRoot,
        runLintJson: () => runCliJson<LintDocument>(deps, ['lint', '-o', 'json']),
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
      }),
  };
}
