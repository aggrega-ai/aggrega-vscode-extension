// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { DEFAULT_SETTINGS, Settings } from './settings';

// getSettings reads the aggrega.server.* configuration from VS Code.
// Defaults match DEFAULT_SETTINGS when a key is unset. Lives in its
// own file so pure-Node tests can consume the Settings shape without
// pulling the vscode module.
export function getSettings(): Settings {
  const serverCfg = vscode.workspace.getConfiguration('aggrega.server');
  const notificationsCfg = vscode.workspace.getConfiguration('aggrega.notifications');
  return {
    binaryPath: serverCfg.get<string>('binaryPath', DEFAULT_SETTINGS.binaryPath),
    autoRevalidate: serverCfg.get<boolean>('autoRevalidate', DEFAULT_SETTINGS.autoRevalidate),
    debounceMs: serverCfg.get<number>('debounceMs', DEFAULT_SETTINGS.debounceMs),
    respawnAttempts: serverCfg.get<number>('respawnAttempts', DEFAULT_SETTINGS.respawnAttempts),
    respawnWindowSeconds: serverCfg.get<number>('respawnWindowSeconds', DEFAULT_SETTINGS.respawnWindowSeconds),
    restartGraceSeconds: serverCfg.get<number>('restartGraceSeconds', DEFAULT_SETTINGS.restartGraceSeconds),
    toastDebounceMode: notificationsCfg.get<'time' | 'session'>('toastDebounceMode', DEFAULT_SETTINGS.toastDebounceMode),
    toastThrottleSeconds: notificationsCfg.get<number>('toastThrottleSeconds', DEFAULT_SETTINGS.toastThrottleSeconds),
  };
}
