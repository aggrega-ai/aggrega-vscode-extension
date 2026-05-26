// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { DEFAULT_SETTINGS, Settings } from './settings';

// getSettings reads the aggrega.server.* configuration from VS Code.
// Defaults match DEFAULT_SETTINGS when a key is unset. Lives in its
// own file so pure-Node tests can consume the Settings shape without
// pulling the vscode module.
export function getSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('aggrega.server');
  return {
    binaryPath: cfg.get<string>('binaryPath', DEFAULT_SETTINGS.binaryPath),
    autoRevalidate: cfg.get<boolean>('autoRevalidate', DEFAULT_SETTINGS.autoRevalidate),
    debounceMs: cfg.get<number>('debounceMs', DEFAULT_SETTINGS.debounceMs),
    respawnAttempts: cfg.get<number>('respawnAttempts', DEFAULT_SETTINGS.respawnAttempts),
    respawnWindowSeconds: cfg.get<number>('respawnWindowSeconds', DEFAULT_SETTINGS.respawnWindowSeconds),
  };
}
