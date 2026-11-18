// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import {
  SHOW_COMPILER_LICENSES_COMMAND,
  showCompilerLicenses,
} from '../../src/compiler-licenses';
import { readManifest, readManifestEnglish, readRawManifest } from '../helpers/manifest';

interface Recorder {
  spawned: Array<{ binary: string; args: string[] }>;
  opened: Array<{ content: string; language: string }>;
  errors: string[];
}

function recorder(): Recorder {
  return { spawned: [], opened: [], errors: [] };
}

function deps(rec: Recorder, binaryPath: string, spawn: (binary: string, args: string[]) => Promise<string>) {
  return {
    binaryPath,
    run: (binary: string, args: string[]) => {
      rec.spawned.push({ binary, args });
      return spawn(binary, args);
    },
    open: async (content: string, language: string) => {
      rec.opened.push({ content, language });
    },
    showError: (message: string) => {
      rec.errors.push(message);
    },
  };
}

describe('showCompilerLicenses', () => {
  it('asks the configured binary for `version --licenses` and opens its output unchanged as plain text', async () => {
    const rec = recorder();
    const notices = 'First notice\n\n  indented line\r\nlast line without a newline';
    await showCompilerLicenses(deps(rec, '/opt/aggrega/bin/aggrega', async () => notices));
    assert.deepStrictEqual(rec.spawned, [{ binary: '/opt/aggrega/bin/aggrega', args: ['version', '--licenses'] }]);
    assert.deepStrictEqual(rec.opened, [{ content: notices, language: 'plaintext' }]);
    assert.deepStrictEqual(rec.errors, []);
  });

  it('names the binary and the first line of the failure, and opens nothing, when the run fails', async () => {
    const rec = recorder();
    await showCompilerLicenses(
      deps(rec, '/missing/aggrega', async () => {
        throw new Error('Command failed: /missing/aggrega version --licenses\nsecond line of stderr');
      }),
    );
    assert.deepStrictEqual(rec.opened, []);
    assert.strictEqual(rec.errors.length, 1);
    assert.ok(rec.errors[0].includes('/missing/aggrega'), rec.errors[0]);
    assert.ok(rec.errors[0].includes('Command failed: /missing/aggrega version --licenses'), rec.errors[0]);
    assert.ok(!rec.errors[0].includes('second line of stderr'), rec.errors[0]);
  });

  it('shows the first non-empty line of the compiler\'s stderr when the failure carries one', async () => {
    const rec = recorder();
    await showCompilerLicenses(
      deps(rec, '/old/aggrega', async () => {
        throw Object.assign(new Error('Command failed: /old/aggrega version --licenses\nError: unknown flag: --licenses'), {
          stderr: '\n  \nError: unknown flag: --licenses\nUsage: aggrega version [flags]\n',
        });
      }),
    );
    assert.deepStrictEqual(rec.opened, []);
    assert.strictEqual(rec.errors.length, 1);
    assert.ok(rec.errors[0].includes('/old/aggrega'), rec.errors[0]);
    assert.ok(rec.errors[0].includes('Error: unknown flag: --licenses'), rec.errors[0]);
    assert.ok(!rec.errors[0].includes('Command failed'), rec.errors[0]);
    assert.ok(!rec.errors[0].includes('Usage:'), rec.errors[0]);
  });

  it('falls back to the failure\'s first line when its stderr is empty', async () => {
    const rec = recorder();
    await showCompilerLicenses(
      deps(rec, '/old/aggrega', async () => {
        throw Object.assign(new Error('Command failed: /old/aggrega version --licenses'), { stderr: ' \n' });
      }),
    );
    assert.ok(rec.errors[0].includes('Command failed: /old/aggrega version --licenses'), rec.errors[0]);
  });
});

describe('the show-licenses command declaration', () => {
  it('is declared in the manifest with its title key, and the English holds the title', () => {
    assert.strictEqual(SHOW_COMPILER_LICENSES_COMMAND, 'aggrega.compiler.showLicenses');
    const raw = readRawManifest() as { contributes: { commands: Array<{ command: string; title: string }> } };
    const declared = raw.contributes.commands.find((c) => c.command === SHOW_COMPILER_LICENSES_COMMAND);
    assert.ok(declared, 'the command is declared under contributes.commands');
    assert.strictEqual(declared.title, '%command.aggrega.compiler.showLicenses.title%');
    assert.strictEqual(
      readManifestEnglish()['command.aggrega.compiler.showLicenses.title'],
      'Aggrega: Show Compiler Third-Party Licenses',
    );
    const shown = (readManifest() as { contributes: { commands: Array<{ command: string; title: string }> } })
      .contributes.commands.find((c) => c.command === SHOW_COMPILER_LICENSES_COMMAND);
    assert.strictEqual(shown?.title, 'Aggrega: Show Compiler Third-Party Licenses');
  });
});
