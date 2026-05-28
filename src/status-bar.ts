// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';
import { activeFolderLabel } from './anchor-picker';
import { AnchoredFolder } from './workspace';

// STATUS_BAR_PRIORITY positions the Aggrega indicator on the right
// side of the status bar at the typical "language indicator" tier.
const STATUS_BAR_PRIORITY = 100;

// AnchorContext carries the active-anchor and full anchored-folder
// list so the status-bar label can render the multi-anchor disambiguated
// form `Aggrega · <basename>` (with parent-disambiguation on basename
// collision). When the workspace has zero or exactly one anchored
// folder, this is undefined and the single-folder label applies.
export interface AnchorContext {
  active: AnchoredFolder<vscode.WorkspaceFolder>;
  anchored: AnchoredFolder<vscode.WorkspaceFolder>[];
}

// createAggregaStatusBar registers a status bar item that surfaces
// the daemon's reported workspaceRoot + configSource. The item is
// visible only when the daemon is in Running state.
//
// When anchorContext names 2+ anchored folders, the label switches to
// `Aggrega · <basename>` (with parent-disambiguation on collision) so
// the user can identify which folder the daemon is attached to.
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
      item.text = activeFolderLabel(anchorContext.active, anchorContext.anchored);
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

// createPendingChoiceStatusBar registers a status bar item that
// signals "the workspace has 2+ anchored folders, the user has not
// picked one yet, no daemon is running." Clicking the item invokes
// aggrega.workspace.switchAnchor which opens the same picker the
// activation-time toast surfaces.
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
  item.text = 'Aggrega: Choose folder…';
  item.tooltip = 'Multiple Aggrega-anchored folders found. Click to choose which folder the daemon attaches to.';
  item.command = 'aggrega.workspace.switchAnchor';
  context.subscriptions.push(item);
  item.show();
  return item;
}
