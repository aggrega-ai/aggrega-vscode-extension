// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import { NOT_RUNNING_WARNING, notRunningWarning, startFailedMessage } from '../../src/daemon-status';
import { REFUSAL_WITHOUT_WORDS, describeError } from '../../src/error-text';
import { DOWNLOAD_COMPILER_COMMAND, STEP_CONTENT } from '../../src/get-started-steps';
import { binaryPathSettingPress } from '../../src/settings';
import {
  BINARY_PATH_SETTING,
  CHOOSE_ANOTHER_FILE_ACTION,
  DOWNLOAD_COMPILER_ACTION,
  OPEN_BINARY_PATH_SETTING_ACTION,
  isStartFailure,
  startFailureActions,
  startFailureCause,
  startFailureReason,
  startFailureWords,
} from '../../src/start-failure';

// The words a reader is told when the compiler could not be started, held as
// written: a change of wording is a change these assertions report rather than
// follow.

const BINARY = '/home/someone/tools/aggrega';

// startFailed is the runtime's failure to start a program, with the fields the
// runtime attaches to it. Its message is the runtime's own wording, which the
// assertions below hold out of every sentence a reader meets first.
function startFailed(code: string, syscall = `spawn ${BINARY}`): Error {
  return Object.assign(new Error(`spawn ${BINARY} ${code}`), { code, errno: -2, syscall, path: BINARY });
}

describe('start-failure: telling why the compiler could not be started', () => {
  it('reads the cause from the code the runtime attaches, for each code a reader is told apart', () => {
    assert.strictEqual(startFailureCause(startFailed('ENOENT')), 'notFound');
    assert.strictEqual(startFailureCause(startFailed('EACCES')), 'notExecutable');
    assert.strictEqual(startFailureCause(startFailed('ENOTDIR', 'spawn')), 'other');
  });

  it('does not read a program that started and exited as one that could not start', () => {
    // An exit carries its status as a number on the same field, and names no
    // system call; a wait that ran out carries neither.
    assert.strictEqual(isStartFailure(Object.assign(new Error('Command failed'), { code: 1 })), false);
    assert.strictEqual(isStartFailure(new Error('initialize timeout')), false);
    assert.strictEqual(isStartFailure({ code: -32603, message: 'refused' }), false);
    assert.strictEqual(isStartFailure(null), false);
    assert.strictEqual(startFailureCause(new Error('initialize timeout')), 'other');
  });

  it('does not read the cause from the message', () => {
    // A runtime that worded the message differently names the same cause.
    const reworded = Object.assign(new Error('the file could not be found'), { code: 'ENOENT', syscall: `spawn ${BINARY}` });
    assert.strictEqual(startFailureCause(reworded), 'notFound');
    // And a message carrying the code, on a value with no such field, names none.
    assert.strictEqual(startFailureCause(new Error(`spawn ${BINARY} ENOENT`)), 'other');
  });
});

describe('start-failure: the words', () => {
  it('says a path naming nothing was not found, and to set the setting', () => {
    const failure = { reason: startFailed('ENOENT'), binaryPath: BINARY };
    assert.strictEqual(startFailureWords(failure), `the compiler at ${BINARY} was not found`);
    assert.strictEqual(
      startFailureReason(failure),
      `the compiler at ${BINARY} was not found. Set aggrega.server.binaryPath to the aggrega binary.`,
    );
    assert.strictEqual(
      startFailedMessage(failure),
      `Aggrega language server failed to start: the compiler at ${BINARY} was not found. Set aggrega.server.binaryPath to the aggrega binary.`,
    );
  });

  it('says a file that cannot be run is not an executable file, and to set the setting', () => {
    const failure = { reason: startFailed('EACCES'), binaryPath: BINARY };
    assert.strictEqual(startFailureWords(failure), `${BINARY} is not an executable file`);
    assert.strictEqual(
      startFailedMessage(failure),
      `Aggrega language server failed to start: ${BINARY} is not an executable file. Set aggrega.server.binaryPath to the aggrega binary.`,
    );
  });

  it('keeps the runtime\'s own text for every other failure, after a plain sentence, and names the setting', () => {
    const failure = { reason: new Error('initialize timeout'), binaryPath: BINARY };
    assert.strictEqual(startFailureWords(failure), 'initialize timeout');
    assert.strictEqual(
      startFailedMessage(failure),
      `Aggrega language server failed to start: initialize timeout. aggrega.server.binaryPath names the compiler it runs, ${BINARY}.`,
    );
    // A text that already ends a sentence is not given a second stop.
    assert.strictEqual(
      startFailureReason({ reason: new Error('the language server stopped unexpectedly: it exited with code 1.'), binaryPath: BINARY }),
      `the language server stopped unexpectedly: it exited with code 1. aggrega.server.binaryPath names the compiler it runs, ${BINARY}.`,
    );
  });

  it('puts neither the runtime\'s code nor the word spawn first, for the two causes it names', () => {
    for (const code of ['ENOENT', 'EACCES']) {
      const message = startFailedMessage({ reason: startFailed(code), binaryPath: BINARY });
      assert.ok(!message.includes(code), `${code} reached the reader: ${message}`);
      assert.ok(!/\bspawn\b/.test(message), `the word spawn reached the reader: ${message}`);
      assert.ok(message.includes(BINARY_PATH_SETTING), `the setting is not named: ${message}`);
    }
  });
});

describe('start-failure: the warning an operation answers with while no server runs', () => {
  it('says the server is not running and offers the output, the setting and the start', () => {
    assert.deepStrictEqual(notRunningWarning(null, 'notRunning'), {
      message: 'Aggrega: the language server is not running.',
      actions: ['Show output', 'Open binary path setting', 'Start'],
      start: 'Start',
    });
    assert.strictEqual(NOT_RUNNING_WARNING, 'Aggrega: the language server is not running.');
  });

  it('says why, where the last start failed, in the words the failure was reported in', () => {
    const failure = { reason: startFailed('EACCES'), binaryPath: BINARY };
    assert.deepStrictEqual(notRunningWarning(failure, 'notRunning'), {
      message: `Aggrega: the language server is not running. Its last start failed: ${BINARY} is not an executable file. Set aggrega.server.binaryPath to the aggrega binary.`,
      actions: ['Show output', 'Open binary path setting', 'Start'],
      start: 'Start',
    });
  });

  it('names the start or the restart as the status bar names it in the same standing', () => {
    assert.strictEqual(notRunningWarning(null, 'starting').start, 'Restart');
    assert.deepStrictEqual(notRunningWarning(null, 'starting').actions, ['Show output', 'Open binary path setting', 'Restart']);
  });
});

describe('start-failure: the ways forward a failure to start offers', () => {
  // (b) and (d): a path naming nothing — set by the reader or looked up on PATH —
  // has no compiler behind it to replace, so getting one is offered beside
  // choosing another file and opening the setting.
  it('offers to download the compiler, to choose another file and to open the setting, where the path names nothing', () => {
    for (const binaryPath of [BINARY, 'aggrega']) {
      assert.deepStrictEqual(
        startFailureActions({ reason: startFailed('ENOENT'), binaryPath }),
        ['Download the compiler', 'Choose another file', 'Open binary path setting'],
      );
    }
    assert.strictEqual(DOWNLOAD_COMPILER_ACTION, 'Download the compiler');
    assert.strictEqual(CHOOSE_ANOTHER_FILE_ACTION, 'Choose another file');
  });

  // (a): a file is there, so it is the reader's, and an offer to download beside
  // it would read as an offer to replace it.
  it('offers the setting alone where a file is there and every other failure', () => {
    assert.deepStrictEqual(
      startFailureActions({ reason: startFailed('EACCES'), binaryPath: BINARY }),
      ['Open binary path setting'],
    );
    assert.deepStrictEqual(
      startFailureActions({ reason: new Error('initialize timeout'), binaryPath: BINARY }),
      ['Open binary path setting'],
    );
  });

  // The welcome page's compiler step offers the download in the same words, so a
  // reader told about it in one place finds it by the same name in the other.
  it('names the download as the welcome page\'s compiler step does, and runs the same command', () => {
    const compiler = STEP_CONTENT.find((step) => step.id === 'compiler');
    assert.ok(compiler, 'the welcome page has no compiler step');
    const download = compiler.actions.find((action) => action.label === DOWNLOAD_COMPILER_ACTION);
    assert.ok(download, `the compiler step offers no "${DOWNLOAD_COMPILER_ACTION}"`);
    assert.strictEqual(download.command, DOWNLOAD_COMPILER_COMMAND);
    assert.strictEqual(DOWNLOAD_COMPILER_COMMAND, 'aggrega.getStarted.downloadCompiler');
  });
});

describe('start-failure: opening the setting', () => {
  it('opens the editor\'s settings narrowed to the one setting naming the compiler', () => {
    assert.deepStrictEqual(binaryPathSettingPress(), {
      command: 'workbench.action.openSettings',
      title: OPEN_BINARY_PATH_SETTING_ACTION,
      arguments: ['@id:aggrega.server.binaryPath'],
    });
    assert.strictEqual(OPEN_BINARY_PATH_SETTING_ACTION, 'Open binary path setting');
  });
});

describe('describeError: a refusal\'s line', () => {
  it('is the compiler\'s words alone, without the transport\'s code', () => {
    assert.strictEqual(describeError({ code: 1004, message: 'catalog load failed' }), 'catalog load failed');
    assert.strictEqual(describeError({ code: -32602, message: 'E0310: refused' }), 'E0310: refused');
  });

  it('says so where the refusal carried no words', () => {
    assert.strictEqual(describeError({ code: -32603, message: '' }), REFUSAL_WITHOUT_WORDS);
    assert.strictEqual(REFUSAL_WITHOUT_WORDS, 'the language server refused the request without saying why');
  });

  it('is a thrown error\'s own message, and any other value as text', () => {
    assert.strictEqual(describeError(new Error('boom')), 'boom');
    assert.strictEqual(describeError('plain'), 'plain');
  });
});
