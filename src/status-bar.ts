// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';
import {
  CHOOSE_ANCHOR_ACTION,
  CHOOSE_ANCHOR_INVITATION,
  SWITCH_ANCHOR_COMMAND,
  activeWorkspaceLabel,
} from './anchor-picker';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { AnchoredFolder } from './workspace';
import { DaemonStatusItemLike } from './daemon-status';

// STATUS_BAR_PRIORITY positions the Aggrega indicator on the right
// side of the status bar at the typical "language indicator" tier.
const STATUS_BAR_PRIORITY = 100;

// LIFECYCLE_STATUS_BAR_PRIORITY places the lifecycle indicator on the LEFT,
// immediately beside the Release indicator, which is drawn left at 99 — a
// higher priority is drawn further left there, so this puts the two adjacent
// with the lifecycle first. The order is the reading order: whether the
// compiler is up, then which Release it is being asked about, since the second
// means nothing without the first. It shares a number with the priority above
// and not a position: that one is on the other side of the bar.
const LIFECYCLE_STATUS_BAR_PRIORITY = 100;

// AnchorContext carries the active choice and the full list of Aggrega
// workspaces this window reaches, so the status-bar label can render the
// disambiguated form `Aggrega · <basename>` (with parent-disambiguation on
// basename collision). When the window reaches zero or exactly one, this is
// undefined and the single-workspace label applies.
export interface AnchorContext {
  active: AnchoredFolder<vscode.WorkspaceFolder>;
  anchored: AnchoredFolder<vscode.WorkspaceFolder>[];
}

// createAggregaStatusBar registers a status bar item that reports a RUNNING
// language server's identity: the workspace root it anchored to and the
// configuration source it read. That is its whole subject, which is why it is
// visible only while the daemon is in Running state — those fields exist only
// then, and a partial label would name a server that is not there.
//
// It does not report the lifecycle, and must not be extended to: whether a
// language server is running at all is reported by the lifecycle indicator,
// which is visible across the whole lifecycle precisely because the state worth
// reporting most is the one this item hides in. Two items both claiming to
// report the daemon would leave a reader with two answers and no way to tell
// which is the current one.
//
// When anchorContext names 2+ Aggrega workspaces, the label switches to
// `Aggrega · <basename>` (with parent-disambiguation on collision) so
// the user can identify which one the language server is working in.
// Otherwise the label is `Aggrega: <configSource>`.
export function createAggregaStatusBar(
  context: vscode.ExtensionContext,
  daemon: Daemon,
  anchorContext?: AnchorContext,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
  // Clicking the item opens the quick-pick menu wired in
  // extension.ts. The command id is also exposed via package.json's
  // contributes.commands so the Command Palette surfaces it for
  // keyboard-driven operators.
  item.command = 'aggrega.statusBar.openMenu';
  context.subscriptions.push(item);

  const refresh = () => {
    if (daemon.getState() !== DaemonState.Running) {
      item.hide();
      return;
    }
    const metadata = daemon.getServerInitMetadata();
    if (!metadata) {
      // Running but no metadata yet (handshake completed without
      // the optional fields). Hide rather than render a partial label.
      item.hide();
      return;
    }
    if (anchorContext && anchorContext.anchored.length >= 2) {
      item.text = activeWorkspaceLabel(anchorContext.active, anchorContext.anchored);
    } else {
      item.text = `Aggrega: ${metadata.configSource}`;
    }
    item.tooltip = metadata.workspaceMarker
      ? `${metadata.workspaceRoot} (anchored by ${metadata.workspaceMarker})`
      : metadata.workspaceRoot;
    item.show();
  };

  daemon.on('stateChange', refresh);
  refresh();
  return item;
}

// createLifecycleStatusBarItem places the lifecycle indicator. Every decision
// about where a status-bar item of this extension sits is made in this module,
// so the alignment and the priority that position it relative to one another
// are read together rather than from two files.
export function createLifecycleStatusBarItem(
  context: vscode.ExtensionContext,
): DaemonStatusItemLike {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    LIFECYCLE_STATUS_BAR_PRIORITY,
  );
  context.subscriptions.push(item);
  return item;
}

// createPendingChoiceStatusBar registers a status bar item that
// signals "this window reaches 2+ Aggrega workspaces, the user has not
// picked one yet, no language server is running." Clicking the item opens the
// same picker the activation-time toast surfaces.
//
// Returns the item so the caller can dispose / hide it once a choice
// resolves (at which point createAggregaStatusBar takes over).
export function createPendingChoiceStatusBar(
  context: vscode.ExtensionContext,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
  item.text = CHOOSE_ANCHOR_ACTION;
  // The offer is READ from the module that owns the choice rather than written
  // again here, because the selector row and the picker's own placeholder make
  // the same offer: a reader who reaches it from the status bar and a reader
  // who reaches it from the row must not be told two different things about
  // one choice, and three copies kept in step by eye is how they come to be.
  //
  // The count is not given, because this item is created without one and
  // asking for it would put a number here that the list opening underneath is
  // about to state exactly.
  item.tooltip =
    `More than one ${SELECTOR_ROW_LABELS.workspace} is available in this project. `
    + CHOOSE_ANCHOR_INVITATION;
  // The command is read from the module that owns the choice, for the reason the
  // offer above it is: this item and the row that makes the same offer must not
  // come to run two different commands.
  item.command = SWITCH_ANCHOR_COMMAND;
  context.subscriptions.push(item);
  item.show();
  return item;
}
