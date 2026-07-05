// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { DEFAULT_SETTINGS, settingsFromObject } from '../../src/settings';
import { buildServeArgs } from '../../src/daemon';

describe('settings', () => {
  it('exposes the documented defaults', () => {
    assert.strictEqual(DEFAULT_SETTINGS.binaryPath, 'aggrega');
    assert.strictEqual(DEFAULT_SETTINGS.autoRevalidate, false);
    assert.strictEqual(DEFAULT_SETTINGS.renderDiagnostics, false);
    assert.strictEqual(DEFAULT_SETTINGS.debounceMs, 300);
    assert.strictEqual(DEFAULT_SETTINGS.respawnAttempts, 5);
    assert.strictEqual(DEFAULT_SETTINGS.respawnWindowSeconds, 180);
    assert.strictEqual(DEFAULT_SETTINGS.restartGraceSeconds, 5);
    assert.strictEqual(DEFAULT_SETTINGS.toastDebounceMode, 'time');
    assert.strictEqual(DEFAULT_SETTINGS.toastThrottleSeconds, 300);
  });

  it('settingsFromObject overlays the new debounce + restart-grace fields onto defaults', () => {
    const s = settingsFromObject({
      restartGraceSeconds: 10,
      toastDebounceMode: 'session',
      toastThrottleSeconds: 60,
    });
    assert.strictEqual(s.restartGraceSeconds, 10);
    assert.strictEqual(s.toastDebounceMode, 'session');
    assert.strictEqual(s.toastThrottleSeconds, 60);
    assert.strictEqual(s.binaryPath, DEFAULT_SETTINGS.binaryPath);
  });

  it('settingsFromObject overlays values onto defaults', () => {
    const s = settingsFromObject({ debounceMs: 750, autoRevalidate: true });
    assert.strictEqual(s.debounceMs, 750);
    assert.strictEqual(s.autoRevalidate, true);
    assert.strictEqual(s.binaryPath, DEFAULT_SETTINGS.binaryPath);
    assert.strictEqual(s.respawnAttempts, DEFAULT_SETTINGS.respawnAttempts);
  });

  it('settingsFromObject returns a fresh object', () => {
    const s = settingsFromObject({});
    s.debounceMs = 999;
    assert.strictEqual(DEFAULT_SETTINGS.debounceMs, 300);
  });

  describe('buildServeArgs', () => {
    it('omits --render-diagnostics by default (dial off)', () => {
      const args = buildServeArgs(settingsFromObject({}));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('omits --render-diagnostics when renderDiagnostics is false', () => {
      const args = buildServeArgs(settingsFromObject({ renderDiagnostics: false }));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('appends --render-diagnostics only when renderDiagnostics is true', () => {
      const args = buildServeArgs(settingsFromObject({ renderDiagnostics: true }));
      assert.deepStrictEqual(args, ['serve', '--render-diagnostics']);
    });
  });
});
