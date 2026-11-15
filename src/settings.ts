// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';
import * as l10n from './l10n';
import { DEFAULT_OPERATIONS_LAYOUT, OperationsLayout } from './operation-groups';
import type { PanelActionPress } from './panel-actions';
import { BINARY_PATH_SETTING, OPEN_BINARY_PATH_SETTING_ACTION } from './start-failure';

export interface Settings {
  binaryPath: string;
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

// USER_HOME_VARIABLE is the editor's own spelling for the home folder inside a
// setting's value, which this extension honours in the setting naming the
// compiler alongside the shell's `~`.
export const USER_HOME_VARIABLE = '${userHome}';

// resolveBinaryPath turns the setting naming the compiler into the path the
// extension looks for and starts: `${userHome}` anywhere in it becomes the home
// folder, and a leading `~/` — or `~\` on Windows — names a file under the home
// folder. A bare `~` is the home folder itself, as a shell reads it. Every other
// value is answered as written: a plain name such as `aggrega`, which is looked
// up on PATH; an absolute or relative path; and `~name/…`, which names another
// account's home that nothing here can read.
//
// 🔴 IT IS APPLIED ONCE, WHERE THE SETTING IS READ, AND NOWHERE ELSE. The language
// server's start, the commands run beside it, the download and the change of
// version all receive the path from that one read, so each looks for and names
// the same file — and a failure to start names the path that was actually tried
// rather than the `~` the reader typed. Nothing hands a `~` to the operating
// system, which does not expand it.
//
// The home folder and the platform are handed in, so the resolution can be
// driven for any machine; the reader passes those of the machine the extension
// runs on, which in a window opened on a remote machine is that machine. An
// empty home leaves the value as written rather than turning `~/x` into a path
// at the root of the file system.
export function resolveBinaryPath(configured: string, home: string, platform: string): string {
  if (home === '') { return configured; }
  const expanded = configured.split(USER_HOME_VARIABLE).join(home);
  if (expanded === '~') { return home; }
  const windows = platform === 'win32';
  if (expanded.startsWith('~/') || (windows && expanded.startsWith('~\\'))) {
    return (windows ? path.win32 : path.posix).join(home, expanded.slice(2));
  }
  return expanded;
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

// USER_ONLY_SCOPES are the two editor scopes that confine a setting to a
// person's own settings, and this is where the reason for using one lives —
// package.json is strict JSON and can carry no comment beside the declaration
// itself.
//
// The two are `application` (the user settings file alone) and `machine` (the
// user settings or a remote host's settings). Every other scope the editor
// offers admits a project's own settings, which is precisely what these must not.
//
// WHY EVERY PREFERENCE THIS EXTENSION DECLARES IS ONE OF THESE, so that nobody
// later "fixes" it back: every dial here describes the reader's own environment
// or their own reading habits — where their binary is, how long to wait before
// revalidating, how many respawns to tolerate, whether to show values that would
// be readable over their shoulder, how they want a panel drawn. None of them is
// a property of the project being edited. Left unscoped, each takes the editor's
// default, which is settable per workspace: a preference about how one person's
// editor behaves could then be committed to a repository and inherited, silently,
// by everyone who clones it — and the dial where that matters most is the one
// deciding which compiler binary runs. The accepted consequence is that a project
// can no longer pin any of them for whoever opens it.
//
// WHY `machine` RATHER THAN `application`, which is the narrower of the two:
// both make a repository unable to pin a preference, which is the whole point.
// `application` additionally forbids a per-host value, and that is not something
// anything here asks for — this extension resolves and spawns the compiler binary
// on whichever host it runs on, so a reader working both locally and inside a
// container needs a different path in each, and the remote settings file is where
// that belongs. Both scopes are listed because the property the manifest must
// satisfy is "confined to the reader", not "spelled machine".
export const USER_ONLY_SCOPES = ['application', 'machine'] as const;

// SETTINGS_SCOPE is the one scope every property in the configuration
// contribution carries. One scope for all of them, not per-dial judgement: a key
// whose scope cannot be read from where it sits is a surface a reader has to
// test rather than read, and one dial behaving differently from the rest is
// exactly that.
//
// The manifest is declarative data the editor reads, so nothing here can generate
// the value into it. This declaration and the manifest are held in step by a
// conformance assertion instead: the suite parses the manifest and requires every
// declared property to carry this one scope, so a manifest edit that drifted from
// this constant fails rather than agreeing until it matters.
export const SETTINGS_SCOPE: (typeof USER_ONLY_SCOPES)[number] = 'machine';

// SETTINGS_COMMAND is the one entry point to the extension's preferences. It is
// the cog at the top right of the Commands panel, and it opens the editor's own
// settings filtered to this extension — never a settings surface of this
// extension's own, which would be a second place the same preference could be
// written, disagreeing with the first as soon as anyone edited a settings file by
// hand.
export const SETTINGS_COMMAND = 'aggrega.settings.open';

// EXTENSION_ID is how the editor addresses this extension: the publisher and the
// name, joined by a dot, exactly as the manifest declares them.
//
// It is a literal because the two surfaces that need it — looking the extension
// up, and narrowing the settings page to it — both take the composed id as an
// argument and have nothing to compose it from. One literal rather than one per
// caller, and it does not drift silently: the suite reads publisher and name out
// of the manifest and requires them to compose to exactly this, so renaming
// either fails rather than leaving a lookup that returns nothing and a settings
// page that opens empty.
export const EXTENSION_ID = 'aggrega-ai.aggrega';

// extensionSettingsQuery builds the filter that narrows the editor's settings to
// one extension's own preferences.
//
// The id is a parameter rather than read from the constant above, so the shape of
// the filter is provable on its own — a test can hand it any id and read back the
// query, which is the part that could be got wrong.
export function extensionSettingsQuery(extensionId: string): string {
  return `@ext:${extensionId}`;
}

// OPEN_SETTINGS_COMMAND is the editor's own command opening its settings screen
// on a search, which is how every surface here takes a reader to a setting.
export const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings';

// settingQuery builds the filter that narrows the editor's settings to the one
// setting a key names, so the screen opens on that setting and nothing beside it.
export function settingQuery(key: string): string {
  return `@id:${key}`;
}

// binaryPathSettingPress is what pressing "Open binary path setting" runs: the
// settings screen narrowed to the setting naming the compiler. It is the one
// composition of that act, so a notification's button and a list panel's row
// that offer it open the same screen.
export function binaryPathSettingPress(): PanelActionPress {
  return {
    command: OPEN_SETTINGS_COMMAND,
    title: OPEN_BINARY_PATH_SETTING_ACTION,
    arguments: [settingQuery(BINARY_PATH_SETTING)],
  };
}

// BUILD_ON_INSPECT_MENU_LABEL is the toggle's entry in the quick-action menu. It
// is the same in both states so the menu dispatches on one label; which way
// selecting it would flip the setting is carried in the description beside it.
//
// It names what the setting runs while a graph is inspected in the command line's
// own words for it: the flag's help calls it the artifact-rendering stage, and
// says it adds the advisories a build raises while rendering and none of the
// checks a build halts on. Every surface naming the setting — the command's
// title, this entry, the confirmation and the setting's description — names it
// the same way, so a reader meets one thing under one name. The description also
// carries the help's qualifier, because a reader who turns the setting on to see
// in the editor what a build would refuse is told there that it does not.
//
// The name is a noun inside each of those sentences, so each spells it in its own
// message, where a translation gives it the article and case the sentence needs;
// a change to the name is a change to every message spelling it, this one first.
export const BUILD_ON_INSPECT_MENU_LABEL = l10n.t('Run the artifact-rendering stage while inspecting');

// buildOnInspectMenuDescription reads the setting's current value and says what
// selecting the entry does next. Phrased as the action rather than the state,
// because a menu entry is chosen for what it will do.
export function buildOnInspectMenuDescription(current: boolean): string {
  return current ? l10n.t('Currently on — turn it off') : l10n.t('Currently off — turn it on');
}

// buildOnInspectConfirmation is the message shown once the toggle has written
// the setting. It names the consequence a user cannot otherwise see: the flag is
// read when the language server starts, so a server already running keeps its
// previous behaviour until it restarts.
//
// Each sentence spells the stage BUILD_ON_INSPECT_MENU_LABEL names inside its own
// message, the stage being its subject.
export function buildOnInspectConfirmation(next: boolean): string {
  const outcome = next
    ? l10n.t('Aggrega: the artifact-rendering stage will run while inspecting a graph.')
    : l10n.t('Aggrega: the artifact-rendering stage will not run while inspecting a graph.');
  return `${outcome} ${l10n.t('The language server reads this setting when it starts, so restart it to apply the change.')}`;
}
