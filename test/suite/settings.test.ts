// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  BUILD_ON_INSPECT_KEY,
  BUILD_ON_INSPECT_MENU_LABEL,
  DEFAULT_SETTINGS,
  SERVER_CONFIG_SECTION,
  buildOnInspectConfirmation,
  buildOnInspectMenuDescription,
  scopeForSettingWrite,
  settingsFromObject,
} from '../../src/settings';
import { buildServeArgs } from '../../src/daemon';

describe('settings', () => {
  it('exposes the documented defaults', () => {
    assert.strictEqual(DEFAULT_SETTINGS.binaryPath, 'aggrega');
    assert.strictEqual(DEFAULT_SETTINGS.autoRevalidate, false);
    assert.strictEqual(DEFAULT_SETTINGS.buildOnInspect, false);
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
    it('omits --build-on-inspect by default (dial off)', () => {
      const args = buildServeArgs(settingsFromObject({}));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('omits --build-on-inspect when buildOnInspect is false', () => {
      const args = buildServeArgs(settingsFromObject({ buildOnInspect: false }));
      assert.deepStrictEqual(args, ['serve']);
    });

    it('appends --build-on-inspect only when buildOnInspect is true', () => {
      const args = buildServeArgs(settingsFromObject({ buildOnInspect: true }));
      assert.deepStrictEqual(args, ['serve', '--build-on-inspect']);
    });

    // The flag the daemon rejects must never be reachable. A settings object is
    // the only thing buildServeArgs reads, so an object carrying the superseded
    // key and nothing else is exactly the shape a fallback read would resurrect
    // the flag from.
    it('never emits a flag the daemon does not accept', () => {
      const withSupersededKey = settingsFromObject(
        { renderDiagnostics: true } as unknown as Partial<typeof DEFAULT_SETTINGS>,
      );
      const args = buildServeArgs(withSupersededKey);
      assert.deepStrictEqual(args, ['serve']);
      assert.ok(
        !args.some(a => a === '--render-diagnostics'),
        'the superseded flag must not reach the daemon argv',
      );
    });

    // Both spawn shapes, asserted as whole arrays so an extra argument fails
    // rather than passing a substring check.
    it('produces exactly one of two argv shapes', () => {
      assert.deepStrictEqual(
        buildServeArgs(settingsFromObject({ buildOnInspect: false })),
        ['serve'],
      );
      assert.deepStrictEqual(
        buildServeArgs(settingsFromObject({ buildOnInspect: true })),
        ['serve', '--build-on-inspect'],
      );
    });
  });

  describe('the setting the toggle writes', () => {
    it('names one section and one key, shared by the reader and the writer', () => {
      assert.strictEqual(SERVER_CONFIG_SECTION, 'aggrega.server');
      assert.strictEqual(BUILD_ON_INSPECT_KEY, 'buildOnInspect');
    });

    it('writes the innermost layer that already holds a value', () => {
      assert.strictEqual(
        scopeForSettingWrite(
          { workspaceFolderValue: false, workspaceValue: true, globalValue: true },
          true,
        ),
        'workspaceFolder',
      );
      assert.strictEqual(
        scopeForSettingWrite({ workspaceValue: false, globalValue: true }, true),
        'workspace',
      );
      assert.strictEqual(scopeForSettingWrite({ globalValue: true }, true), 'global');
    });

    it('treats an explicit false as a value, not as absence', () => {
      assert.strictEqual(scopeForSettingWrite({ globalValue: false }, true), 'global');
    });

    it('falls back to the workspace only when one is open', () => {
      assert.strictEqual(scopeForSettingWrite(undefined, true), 'workspace');
      assert.strictEqual(scopeForSettingWrite(undefined, false), 'global');
      assert.strictEqual(scopeForSettingWrite({}, false), 'global');
    });
  });

  describe('what the toggle shows the user', () => {
    it('keeps one menu label across both states so the menu dispatches on it', () => {
      assert.strictEqual(BUILD_ON_INSPECT_MENU_LABEL, "Run the build's analysis while inspecting");
    });

    it('says which way selecting the entry would flip the setting', () => {
      assert.strictEqual(buildOnInspectMenuDescription(false), 'Currently off — turn it on');
      assert.strictEqual(buildOnInspectMenuDescription(true), 'Currently on — turn it off');
      assert.notStrictEqual(
        buildOnInspectMenuDescription(true),
        buildOnInspectMenuDescription(false),
      );
    });

    it('states the outcome and that a restart applies it', () => {
      const on = buildOnInspectConfirmation(true);
      const off = buildOnInspectConfirmation(false);
      assert.ok(on.includes('will run while inspecting a graph'), on);
      assert.ok(off.includes('will not run while inspecting a graph'), off);
      for (const message of [on, off]) {
        assert.ok(
          message.includes('restart it to apply the change'),
          `the restart consequence must be stated: ${message}`,
        );
      }
    });
  });
});
