// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as os from 'os';
import * as vscode from 'vscode';
import { readLayout } from './operation-groups';
import {
  BUILD_ON_INSPECT_KEY,
  DEFAULT_SETTINGS,
  GRAPH_CONFIG_SECTION,
  OPERATIONS_CONFIG_SECTION,
  OPERATIONS_LAYOUT_KEY,
  SERVER_CONFIG_SECTION,
  SHOW_SENSITIVE_VALUES_KEY,
  Settings,
  resolveBinaryPath,
  showsSensitiveValues,
} from './settings';

// getSettings reads the aggrega.* configuration from VS Code.
// Defaults match DEFAULT_SETTINGS when a key is unset. Lives in its
// own file so pure-Node tests can consume the Settings shape without
// pulling the vscode module.
export function getSettings(): Settings {
  const serverCfg = vscode.workspace.getConfiguration(SERVER_CONFIG_SECTION);
  const notificationsCfg = vscode.workspace.getConfiguration('aggrega.notifications');
  const graphCfg = vscode.workspace.getConfiguration(GRAPH_CONFIG_SECTION);
  const operationsCfg = vscode.workspace.getConfiguration(OPERATIONS_CONFIG_SECTION);
  return {
    // Resolved here, at the one read, so every reader of the setting receives the
    // same path; resolveBinaryPath says why it is applied nowhere else.
    binaryPath: resolveBinaryPath(serverCfg.get<string>('binaryPath', DEFAULT_SETTINGS.binaryPath), os.homedir(), process.platform, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
    buildOnInspect: serverCfg.get<boolean>(BUILD_ON_INSPECT_KEY, DEFAULT_SETTINGS.buildOnInspect),
    debounceMs: serverCfg.get<number>('debounceMs', DEFAULT_SETTINGS.debounceMs),
    respawnAttempts: serverCfg.get<number>('respawnAttempts', DEFAULT_SETTINGS.respawnAttempts),
    respawnWindowSeconds: serverCfg.get<number>('respawnWindowSeconds', DEFAULT_SETTINGS.respawnWindowSeconds),
    restartGraceSeconds: serverCfg.get<number>('restartGraceSeconds', DEFAULT_SETTINGS.restartGraceSeconds),
    toastDebounceMode: notificationsCfg.get<'time' | 'session'>('toastDebounceMode', DEFAULT_SETTINGS.toastDebounceMode),
    toastThrottleSeconds: notificationsCfg.get<number>('toastThrottleSeconds', DEFAULT_SETTINGS.toastThrottleSeconds),
    // Read without a fallback and decided by the predicate rather than by the
    // configuration reader: a value in a shape the reader cannot type-check
    // reaches this as it stands, and only the boolean true shows the values.
    showSensitiveValues: showsSensitiveValues(graphCfg.get(SHOW_SENSITIVE_VALUES_KEY)),
    // Read without a fallback and decided by the reader, for the same reason the
    // line above is: a value in a shape this cannot type-check reaches here as it
    // stands, and anything but the one alternative spelling draws the default
    // shape rather than drawing nothing.
    operationsLayout: readLayout(operationsCfg.get(OPERATIONS_LAYOUT_KEY)),
  };
}
