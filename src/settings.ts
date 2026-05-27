// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

export interface Settings {
  binaryPath: string;
  autoRevalidate: boolean;
  debounceMs: number;
  respawnAttempts: number;
  respawnWindowSeconds: number;
  restartGraceSeconds: number;
  toastDebounceMode: 'time' | 'session';
  toastThrottleSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  binaryPath: 'aggrega',
  autoRevalidate: false,
  debounceMs: 300,
  respawnAttempts: 5,
  respawnWindowSeconds: 180,
  restartGraceSeconds: 5,
  toastDebounceMode: 'time',
  toastThrottleSeconds: 300,
};

// settingsFromObject builds a Settings object by overlaying input
// fields onto DEFAULT_SETTINGS. Used by callers that produce
// Settings outside the VS Code configuration API (tests, the
// vscode-coupled reader in settings-vscode.ts).
export function settingsFromObject(input: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...input };
}
