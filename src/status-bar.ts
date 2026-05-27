// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';

// STATUS_BAR_PRIORITY positions the Aggrega indicator on the right
// side of the status bar at the typical "language indicator" tier.
const STATUS_BAR_PRIORITY = 100;

// createAggregaStatusBar registers a status bar item that surfaces
// the daemon's reported workspaceRoot + configSource. The item is
// visible only when the daemon is in Running state; every other
// state (Stopped, Starting, Restarting, Stopping) hides it rather
// than displaying a partial-state label.
//
// The caller pushes the returned item onto context.subscriptions so
// VS Code disposes it on deactivation. The function also installs a
// stateChange listener on the daemon and returns; that listener is
// the load-bearing update path.
export function createAggregaStatusBar(
  context: vscode.ExtensionContext,
  daemon: Daemon,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
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
    item.text = `Aggrega: ${metadata.configSource}`;
    item.tooltip = metadata.workspaceMarker
      ? `${metadata.workspaceRoot} (anchored by ${metadata.workspaceMarker})`
      : metadata.workspaceRoot;
    item.show();
  };

  daemon.on('stateChange', refresh);
  refresh();
  return item;
}
