// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { DEFAULT_OPERATIONS_LAYOUT, OperationsLayout } from './operation-groups';

export interface Settings {
  binaryPath: string;
  autoRevalidate: boolean;
  buildOnInspect: boolean;
  debounceMs: number;
  respawnAttempts: number;
  respawnWindowSeconds: number;
  restartGraceSeconds: number;
  toastDebounceMode: 'time' | 'session';
  toastThrottleSeconds: number;
  showSensitiveValues: boolean;
  operationsLayout: OperationsLayout;
}

export const DEFAULT_SETTINGS: Settings = {
  binaryPath: 'aggrega',
  autoRevalidate: false,
  buildOnInspect: false,
  debounceMs: 300,
  respawnAttempts: 5,
  respawnWindowSeconds: 180,
  restartGraceSeconds: 5,
  toastDebounceMode: 'time',
  toastThrottleSeconds: 300,
  showSensitiveValues: false,
  operationsLayout: DEFAULT_OPERATIONS_LAYOUT,
};

// settingsFromObject builds a Settings object by overlaying input
// fields onto DEFAULT_SETTINGS. Used by callers that produce
// Settings outside the VS Code configuration API (tests, the
// vscode-coupled reader in settings-vscode.ts).
export function settingsFromObject(input: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...input };
}

// SERVER_CONFIG_SECTION is the configuration section every aggrega.server.*
// setting is read from and written to. Named once so a reader and a writer
// cannot drift onto different sections.
export const SERVER_CONFIG_SECTION = 'aggrega.server';

// BUILD_ON_INSPECT_KEY is the setting name within SERVER_CONFIG_SECTION. The
// toggle writes it and getSettings reads it, so the two share this constant
// rather than each spelling the key out: a mismatch between them would leave
// the toggle flipping a setting nothing reads, with no error anywhere.
export const BUILD_ON_INSPECT_KEY = 'buildOnInspect';

// GRAPH_CONFIG_SECTION is the configuration section the topology graph's own
// settings are read from.
export const GRAPH_CONFIG_SECTION = 'aggrega.graph';

// SHOW_SENSITIVE_VALUES_KEY is the setting name within GRAPH_CONFIG_SECTION.
export const SHOW_SENSITIVE_VALUES_KEY = 'showSensitiveValues';

// OPERATIONS_CONFIG_SECTION is the configuration section the operation surface's
// own settings are read from.
export const OPERATIONS_CONFIG_SECTION = 'aggrega.operations';

// OPERATIONS_LAYOUT_KEY is the setting name within OPERATIONS_CONFIG_SECTION.
// The reader and the change-listener share this constant rather than each
// spelling the key out: a mismatch would leave the panel drawing one shape and
// never noticing that the reader had asked for the other.
export const OPERATIONS_LAYOUT_KEY = 'layout';

// showsSensitiveValues decides, from whatever the editor reports the setting to
// be, whether the graph shows values a Feature declares sensitive.
//
// Only the boolean true shows them. Every other answer withholds — the setting
// unset, the setting absent, and above all a value in a shape this cannot read,
// which is what a hand-edited settings file can produce. The asymmetry is the
// point: reading an answer this cannot understand as permission would disclose
// credentials on the strength of a typo, while the opposite mistake shows a
// reader "withheld" where they expected a value and is corrected by fixing the
// setting.
export function showsSensitiveValues(configured: unknown): boolean {
  return configured === true;
}

// ConfigScope names the configuration layer a setting write lands in, in the
// vocabulary the editor's own settings surface uses.
export type ConfigScope = 'workspaceFolder' | 'workspace' | 'global';

// ConfigLayers is what the editor reports about where a setting currently has a
// value. Only the layers the toggle can choose between are modelled; a value
// coming from a default or from a language-scoped override is not a layer a
// write should target.
export interface ConfigLayers {
  workspaceFolderValue?: boolean;
  workspaceValue?: boolean;
  globalValue?: boolean;
}

// scopeForSettingWrite picks the layer a toggle writes to.
//
// The rule is write-where-it-already-lives: whichever layer currently holds an
// explicit value is the layer updated, innermost first, so flipping the setting
// changes the value the editor is actually applying instead of writing an outer
// layer that a nearer one keeps overriding. With no explicit value anywhere the
// write goes to the workspace when one is open and to the user's own settings
// otherwise, since a workspace-less window has no workspace layer to write.
export function scopeForSettingWrite(
  layers: ConfigLayers | undefined,
  hasWorkspace: boolean,
): ConfigScope {
  if (layers?.workspaceFolderValue !== undefined) { return 'workspaceFolder'; }
  if (layers?.workspaceValue !== undefined) { return 'workspace'; }
  if (layers?.globalValue !== undefined) { return 'global'; }
  return hasWorkspace ? 'workspace' : 'global';
}

// BUILD_ON_INSPECT_MENU_LABEL is the toggle's entry in the quick-action menu. It
// is the same in both states so the menu dispatches on one label; which way
// selecting it would flip the setting is carried in the description beside it.
export const BUILD_ON_INSPECT_MENU_LABEL = "Run the build's analysis while inspecting";

// buildOnInspectMenuDescription reads the setting's current value and says what
// selecting the entry does next. Phrased as the action rather than the state,
// because a menu entry is chosen for what it will do.
export function buildOnInspectMenuDescription(current: boolean): string {
  return current ? 'Currently on — turn it off' : 'Currently off — turn it on';
}

// buildOnInspectConfirmation is the message shown once the toggle has written
// the setting. It names the consequence a user cannot otherwise see: the flag is
// read when the language server starts, so a server already running keeps its
// previous behaviour until it restarts.
export function buildOnInspectConfirmation(next: boolean): string {
  const outcome = next
    ? "will run while inspecting a graph"
    : "will not run while inspecting a graph";
  return `Aggrega: the build's analysis ${outcome}. The language server reads this setting when it starts, so restart it to apply the change.`;
}
