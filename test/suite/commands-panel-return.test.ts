// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.
//
// The Commands panel comes back into sight showing what is true when it comes
// back: the Aggrega workspace the language server is attached to and the Release
// selected, however they changed while it was out of sight or just before it
// went.
//
// WHAT THE EDITOR DOES, WHICH THESE SPECS STAND ON. The panel's context is not
// retained while it is hidden, so the editor lets its document go when it is
// hidden — another side-bar view shown, the pane collapsed, the side bar closed —
// and, when it is shown again, draws a new document from the last one the
// extension assigned. It does not ask the extension to resolve the view again,
// and a body posted while the panel was hidden reached no document. That is what
// the stand-in view below records: every document assigned, every body posted,
// and a visibility that moves when the spec hides or shows it. What the panel
// shows on its return is the last document assigned.
//
// The provider is driven through the surface the extension drives it through:
// activateOperations registers it, the editor resolves it, and a refresh reaches
// it from the selection's own change listener, which is how an attach announces
// itself. Nothing is pressed and no editor runs here.

import * as assert from 'assert';

import type { SelectionState } from '../../src/release-selection';
import type { SelectorCandidates } from '../../src/selector-rows';
import { loadAgainstEditorStub } from '../helpers/editor-stub';
import { selectorValuesIn } from '../helpers/selector-values';

// The editor host stood in for: what the module reads as it loads, and what
// registering and resolving the panel reach.
const registered: { provider: unknown } = { provider: null };
const editorHostStub = {
  window: {
    registerWebviewViewProvider: (_id: string, provider: unknown) => {
      registered.provider = provider;
      return { dispose: () => undefined };
    },
  },
  workspace: {
    getConfiguration: () => ({ get: (): undefined => undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  commands: { registerCommand: () => ({ dispose: () => undefined }) },
  Uri: { joinPath: (...parts: unknown[]) => ({ parts }) },
  env: { language: 'en' },
  ProgressLocation: { Notification: 15, Window: 10 },
};

type ActivateOperations = (context: unknown, deps: unknown) => { refresh(): void };

const { activateOperations } = loadAgainstEditorStub<{ activateOperations: ActivateOperations }>(
  editorHostStub, 'operations',
);

// StandInView is the editor's side of one webview view, as far as these specs
// read it.
class StandInView {
  visible = true;
  readonly assigned: string[] = [];
  readonly posted: { type?: string; html?: string }[] = [];
  private readonly visibility: (() => void)[] = [];
  readonly webview: Record<string, unknown>;
  constructor() {
    const assigned = this.assigned;
    const posted = this.posted;
    this.webview = {
      options: {},
      cspSource: 'stand-in',
      asWebviewUri: () => ({ toString: () => 'stand-in-resource' }),
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
      postMessage: async (message: { type?: string; html?: string }): Promise<boolean> => {
        posted.push(message);
        return true;
      },
      set html(document: string) { assigned.push(document); },
      get html(): string { return assigned[assigned.length - 1] ?? ''; },
    };
  }
  onDidDispose = (): { dispose(): void } => ({ dispose: () => undefined });
  onDidChangeVisibility = (listener: () => void): { dispose(): void } => {
    this.visibility.push(listener);
    return { dispose: () => undefined };
  };
  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.visibility) { listener(); }
  }
  // drawnOnReturn is the document the editor draws when the panel is shown again.
  drawnOnReturn(): string {
    return this.assigned[this.assigned.length - 1] ?? '';
  }
}

const OPENED = '/work/demo/services/api';
const ROOT = '/work/demo';
const SELECTED: SelectionState = { kind: 'selected', release: 'releases/prod.yaml', absolute: '/work/demo/releases/prod.yaml' };
// What the three rows read once the server is attached at ROOT with SELECTED: the
// folder open, the workspace root, and the Release as a request carries it.
const ATTACHED_VALUES = ['api', 'demo', 'releases/prod.yaml'];

// panelBefore resolves the panel while no language server has attached yet —
// the moment an editor opened with the Aggrega side bar showing draws it — and
// answers the view, and attach, which attaches the server and announces it the
// way the selection announces a change.
function panelBefore(): { shown: StandInView; attach: () => void } {
  let anchored: string | null = null;
  let selection: SelectionState = { kind: 'unknown' };
  const selectionListeners: (() => void)[] = [];
  const deps = {
    getWorkspaceRoot: () => anchored,
    getAnchoredWorkspaceRoot: () => anchored,
    getOpenedProjectFolder: () => OPENED,
    getChosenProjectFolder: () => OPENED,
    selectionState: () => selection,
    selectorCandidates: (): SelectorCandidates => ({
      projectFolders: 1,
      aggregaWorkspaces: 1,
      releases: selection.kind === 'selected' ? 1 : null,
    }),
    selectedRelease: () => (selection.kind === 'selected' ? selection.release : null),
    onSelectionChange: (listener: () => void) => { selectionListeners.push(listener); },
    onReady: () => undefined,
    onLayoutChange: () => undefined,
    layout: () => 'buttons',
    output: { appendLine: () => undefined },
  };
  registered.provider = null;
  activateOperations({ subscriptions: [], extensionUri: {} }, deps);
  const provider = registered.provider as {
    resolveWebviewView(view: unknown, context: unknown, token: unknown): void;
  } | null;
  assert.ok(provider, 'activating the operations did not register the Commands panel');
  const shown = new StandInView();
  provider.resolveWebviewView(shown, { state: undefined }, {});
  assert.notDeepStrictEqual(
    selectorValuesIn(shown.drawnOnReturn()), ATTACHED_VALUES,
    'the panel was first drawn already attached, so nothing below would be about a change',
  );
  return {
    shown,
    attach: () => {
      anchored = ROOT;
      selection = SELECTED;
      for (const listener of selectionListeners) { listener(); }
    },
  };
}

describe('the Commands panel coming back into sight', () => {
  it('shows the workspace and Release the server attached to while the panel was out of sight', () => {
    const { shown, attach } = panelBefore();
    shown.setVisible(false);
    attach();
    shown.setVisible(true);
    assert.deepStrictEqual(
      selectorValuesIn(shown.drawnOnReturn()), ATTACHED_VALUES,
      'the panel came back drawing the rows as they stood before the server attached',
    );
  });

  it('shows what changed while it was in sight, after it has been hidden and shown', () => {
    const { shown, attach } = panelBefore();
    attach();
    assert.deepStrictEqual(
      selectorValuesIn(shown.posted[shown.posted.length - 1]?.html ?? ''), ATTACHED_VALUES,
      'the open panel was not handed the attached rows',
    );
    shown.setVisible(false);
    shown.setVisible(true);
    assert.deepStrictEqual(
      selectorValuesIn(shown.drawnOnReturn()), ATTACHED_VALUES,
      'the panel came back drawing the rows it was first drawn with, not the ones it showed when hidden',
    );
  });

  it('hands an open panel its new body and keeps its document', () => {
    // A new document draws from the top and loses the reader's place and any
    // open menu, so a panel in sight is updated in place.
    const { shown, attach } = panelBefore();
    const documents = shown.assigned.length;
    attach();
    assert.strictEqual(
      shown.assigned.length, documents,
      'the open panel was given a new document rather than its new body',
    );
    assert.strictEqual(shown.posted[shown.posted.length - 1]?.type, 'panel');
  });
});
