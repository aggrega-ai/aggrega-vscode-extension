// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import {
  ConfigPresentation,
  PRESENTATION_MEMENTO_KEY,
  PRESENTATION_TOGGLE_COMMAND,
  configDocumentHtml,
} from './config-render';
import { ConfigPanelModel, configPanelModel, readEffectiveConfiguration } from './config-model';
import { makeNonce } from './html';

// This module is the whole editor-coupled boundary of the configuration surface:
// it asks the compiler its two questions, hands both answers to the composition,
// and hosts the document. Every decision about what the surface says is made in
// the modules it calls, which depend on no editor type and are therefore
// directly assertable.
//
// The panel is a single instance revealed rather than reopened, because it is a
// report: a second copy of it would be two readings of one workspace, and a
// reader comparing them could not tell which was current.

// CONFIG_SCHEMA_KIND is the token the compiler answers the workspace
// configuration schema under. It is the schema's own file stem, which is the
// vocabulary the schema request takes.
export const CONFIG_SCHEMA_KIND = 'aggrega-config';

// DEFAULT_PRESENTATION is the shape a reader who has never chosen gets.
const DEFAULT_PRESENTATION: ConfigPresentation = 'table';

// ConfigPanelDeps are the two questions this surface asks and the channel a
// failure is reported through.
//
// Both answers come from the compiler rather than from the workspace's files. The
// schema is asked for rather than read from a path beside the installation
// because an extension cannot rely on a compiler checkout being present; and the
// resolved configuration is asked for because a second reading of the cascade
// would resolve one the compiler is not using, and would disagree silently in
// exactly the workspaces where reporting it matters.
export interface ConfigPanelDeps {
  // getSchema asks the compiler for a kind's schema. The answer is the schema
  // the running binary holds, so the surface is generated from the contract in
  // force rather than from whichever copy is installed elsewhere.
  getSchema(kind: string): Promise<unknown>;
  effectiveConfiguration(): Promise<unknown>;
  output: vscode.OutputChannel;
}

// SchemaResponse is the shape the schema request answers with. Only the schema
// half is read here: this surface names a kind, so the enumeration half — which
// answers a request that named none — cannot arrive.
interface SchemaResponse {
  schema?: unknown;
}

// activateConfigPanel registers the configuration surface.
//
// The panel is created on demand and re-asked on every opening, so a reader who
// changed a file and came back is shown the configuration as it now resolves
// rather than as it did when the panel was first drawn.
export function activateConfigPanel(
  context: vscode.ExtensionContext,
  deps: ConfigPanelDeps,
): void {
  let panel: vscode.WebviewPanel | null = null;
  // The model last drawn is held so that changing presentation redraws the
  // configuration the reader is looking at rather than asking the compiler
  // again. A reader who asked to change how the page is shaped did not ask for
  // its values to move, and re-asking could answer differently — which would
  // read as the switch having changed a setting.
  let drawn: ConfigPanelModel | null = null;

  const presentation = (): ConfigPresentation => {
    const stored = context.globalState.get<string>(PRESENTATION_MEMENTO_KEY);
    return stored === 'table' || stored === 'expanded' ? stored : DEFAULT_PRESENTATION;
  };

  const compose = (target: vscode.WebviewPanel, model: ConfigPanelModel): void => {
    target.webview.html = configDocumentHtml({
      model,
      presentation: presentation(),
      nonce: makeNonce(),
      styleUri: target.webview
        .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'config.css'))
        .toString(),
      cspSource: target.webview.cspSource,
    });
  };

  const draw = async (target: vscode.WebviewPanel): Promise<void> => {
    // The schema is the surface: without it there is nothing to draw, so a
    // failure to obtain one is reported and the panel is left saying so rather
    // than drawn empty. The configuration report is not the surface — it is what
    // the surface can say about the values — so a failure to obtain THAT draws
    // every setting as unattributed, which is exactly what an absent report
    // means.
    const response = await deps.getSchema(CONFIG_SCHEMA_KIND) as SchemaResponse | null;
    const schema = response && typeof response === 'object' ? response.schema : null;

    let effective = null;
    try {
      effective = readEffectiveConfiguration(await deps.effectiveConfiguration());
    } catch (err) {
      deps.output.appendLine(
        'Aggrega configuration: the resolved-configuration report could not be read, so every '
        + `setting is shown with its declared default and no source. ${describe(err)}`,
      );
    }

    drawn = configPanelModel(schema, effective);
    compose(target, drawn);
  };

  context.subscriptions.push(
    // Changing presentation is a control on the document rather than a
    // capability of the extension, so it is registered — a link in the document
    // can only reach a registered command — and deliberately not contributed to
    // the editor's command index. What that index answers is whether a
    // capability exists at all, and an entry there would offer to reshape a
    // panel that may not be open, which is an entry whose invocation cannot
    // succeed.
    vscode.commands.registerCommand(PRESENTATION_TOGGLE_COMMAND, async () => {
      const next: ConfigPresentation = presentation() === 'table' ? 'expanded' : 'table';
      await context.globalState.update(PRESENTATION_MEMENTO_KEY, next);
      if (!panel) { return; }
      // Where a model has been drawn, the same one is recomposed in the new
      // shape. Where none has — the panel exists but its first draw failed —
      // the questions are asked, because there is nothing to recompose.
      if (drawn) { compose(panel, drawn); return; }
      await draw(panel);
    }),
    vscode.commands.registerCommand('aggrega.config.open', async () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Active);
        // A revealed panel is re-asked as well, so revealing and opening report
        // the same configuration rather than the reveal showing an older reading.
        await draw(panel);
        return;
      }
      const created = vscode.window.createWebviewPanel(
        'aggrega.config',
        'Aggrega configuration',
        vscode.ViewColumn.Active,
        {
          // The document runs no script: it reports, and its one control is a
          // link the editor resolves rather than something the page handles.
          // Leaving scripts disabled is what makes that structural rather than a
          // property of the markup as it stands today.
          enableScripts: false,
          // The one command the document may reach is named rather than command
          // links being allowed wholesale. The narrower form costs nothing and
          // means a link added to this document later cannot run anything
          // without the allowance being widened deliberately.
          enableCommandUris: [PRESENTATION_TOGGLE_COMMAND],
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        },
      );
      panel = created;
      created.onDidDispose(() => {
        panel = null;
        drawn = null;
      }, null, context.subscriptions);
      try {
        await draw(created);
      } catch (err) {
        created.dispose();
        panel = null;
        void vscode.window.showErrorMessage(
          `The configuration surface could not be drawn: ${describe(err)}`,
        );
      }
    }),
  );
}

// describe renders a failure for a channel without assuming its shape.
function describe(err: unknown): string {
  if (err instanceof Error) { return err.message; }
  return String(err);
}
