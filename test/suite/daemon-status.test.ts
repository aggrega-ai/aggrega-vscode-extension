// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { DaemonState } from '../../src/daemon';
import {
  DAEMON_ACTION_DETAIL,
  DAEMON_ACTION_LABEL,
  DAEMON_ACTION_PLACEHOLDER,
  DAEMON_READING_WORDS,
  DAEMON_STANDING_IS_ALARMING,
  DAEMON_STANDING_LABEL,
  DAEMON_STANDING_WORDS,
  DaemonReading,
  DaemonStanding,
  DaemonStatusItemLike,
  GATED_ON_ANSWERABLE,
  LIFECYCLE_ACTIONS_COMMAND,
  NEVER_GATED,
  RESTART_COMMAND,
  STATUS_BAR_MENU_COMMAND,
  TOGGLE_BUILD_ON_INSPECT_COMMAND,
  commandTitle,
  createDaemonStatusBar,
  daemonReading,
  daemonStanding,
  daemonStandingAction,
  daemonStandingTooltip,
  enablementClause,
  serverInPlaceMessage,
  stoppedRespondingMessage,
} from '../../src/daemon-status';
import { COMPILER_ANSWERABLE_CONTEXT_KEY } from '../../src/readiness';
import { callArguments } from '../helpers/anchoring-census';
import { editorGuide, editorGuidePresent } from '../helpers/editor-guide';
import { readManifest } from '../helpers/manifest';

interface CommandEntry { command?: unknown; title?: unknown; enablement?: unknown }
interface MenuEntry { command?: unknown; when?: unknown }

// The manifest is read and parsed rather than pattern-matched: what is asserted
// below is a property of the declared contributions, and only a parse can see
// that. It is read with its text in place, as the editor draws it.
function manifest(): { commands: CommandEntry[]; palette: MenuEntry[] } {
  const pkg = readManifest();
  return {
    commands: pkg.contributes.commands,
    palette: pkg.contributes.menus.commandPalette ?? [],
  };
}

function declared(id: string): CommandEntry | undefined {
  return manifest().commands.find((c) => c.command === id);
}

// ALARM stands in for the editor's error background. Its identity is what is
// asserted, not its contents: the question is which standing the indicator
// reaches for it in.
const ALARM = { id: 'statusBarItem.errorBackground' } as unknown as vscode.ThemeColor;

// Recorder is a status-bar item that keeps what was written into it, so a test
// reads back exactly what an operator would have seen.
class Recorder implements DaemonStatusItemLike {
  text = '';
  tooltip: vscode.StatusBarItem['tooltip'] = undefined;
  command: vscode.StatusBarItem['command'] = undefined;
  backgroundColor: vscode.StatusBarItem['backgroundColor'] = undefined;
  shown = 0;
  hidden = 0;
  show(): void { this.shown += 1; }
  hide(): void { this.hidden += 1; }
  dispose(): void { /* nothing to release */ }
}

// Lifecycle holds what the indicator reads, so a test moves it the way the
// extension does: a client appears, passes through its positions, and goes.
class Lifecycle {
  state: DaemonState | null = null;
  anchored = false;
  readonly item = new Recorder();

  bar() {
    return createDaemonStatusBar({
      getDaemonState: () => this.state,
      isWorkspaceAnchored: () => this.anchored,
      createStatusBarItem: () => this.item,
      alarmBackground: () => ALARM,
    });
  }
}

describe('what the language server\'s lifecycle looks like to a reader', () => {
  // The lifecycle carries five positions and a reader is shown three, so the
  // reduction is a decision rather than a restatement. This is that decision
  // written out: every position named, none inferred, and the table checked
  // against the enum so a position added later has nowhere to fall through to.
  const EXPECTED: Record<DaemonState, DaemonStanding> = {
    [DaemonState.Running]: 'running',
    [DaemonState.Starting]: 'starting',
    [DaemonState.Restarting]: 'starting',
    [DaemonState.Stopping]: 'notRunning',
    [DaemonState.Stopped]: 'notRunning',
  };

  it('covers every lifecycle position the client can be in', () => {
    assert.deepStrictEqual(
      Object.keys(EXPECTED).sort(),
      Object.values(DaemonState).sort(),
      'a lifecycle position is unaccounted for, so what a reader is shown in it is nobody\'s decision',
    );
  });

  it('maps each position onto the standing it was decided to carry', () => {
    for (const [state, standing] of Object.entries(EXPECTED)) {
      assert.strictEqual(
        daemonStanding(state as DaemonState),
        standing,
        `${state} no longer reads as ${standing}`,
      );
    }
  });

  // A restart terminates the child and takes the ordinary spawn path, so it
  // ends in Running. Showing it as not running would raise the alarm colour
  // through every restart, which teaches a reader that the colour means
  // nothing.
  it('reads a restart as something coming up rather than something gone', () => {
    assert.strictEqual(daemonStanding(DaemonState.Restarting), daemonStanding(DaemonState.Starting));
    assert.notStrictEqual(daemonStanding(DaemonState.Restarting), daemonStanding(DaemonState.Stopped));
  });

  // Stopping rejects everything in flight and terminates; a request made in it
  // is refused exactly as one made after it is. Grouping it with starting would
  // promise a server on its way up while it is on its way out.
  it('reads a stop in progress as gone rather than as coming up', () => {
    assert.strictEqual(daemonStanding(DaemonState.Stopping), daemonStanding(DaemonState.Stopped));
    assert.notStrictEqual(daemonStanding(DaemonState.Stopping), daemonStanding(DaemonState.Starting));
  });

  // The absence of a client is not a sixth position, and it is the commonest
  // case in the situation this surface exists for: before a workspace is
  // anchored no client is built at all.
  it('reads no client at all as not running', () => {
    assert.strictEqual(daemonStanding(null), 'notRunning');
  });

  it('raises the alarm colour on exactly the standing a reader must act on', () => {
    assert.deepStrictEqual(
      Object.entries(DAEMON_STANDING_IS_ALARMING).filter(([, red]) => red).map(([s]) => s),
      ['notRunning'],
    );
  });

  it('offers a start only where there is nothing to restart', () => {
    assert.strictEqual(daemonStandingAction('notRunning'), 'start');
    assert.strictEqual(daemonStandingAction('starting'), 'restart');
    assert.strictEqual(daemonStandingAction('running'), 'restart');
  });

  // The two readings of "not running" need different answers from the reader —
  // one is met by pointing the editor at a folder, the other by starting the
  // server — and telling them apart is the whole reason this surface carries a
  // sentence rather than only a colour.
  it('says which of the two reasons nothing is running', () => {
    const nothingToAttachTo = daemonStandingTooltip('notRunning', false);
    const notAttached = daemonStandingTooltip('notRunning', true);
    assert.notStrictEqual(
      nothingToAttachTo,
      notAttached,
      'a workspace with nothing to attach to is told the same thing as one whose server is merely down',
    );
    for (const tooltip of [nothingToAttachTo, notAttached]) {
      assert.ok(tooltip.length > 0);
    }
  });

  it('gives every standing words as well as an icon', () => {
    for (const standing of ['running', 'starting', 'notRunning'] as DaemonStanding[]) {
      const label = DAEMON_STANDING_LABEL[standing];
      assert.ok(label.includes('Aggrega'), `${standing} is drawn without naming what it is about`);
      assert.ok(
        label.replace(/\$\([^)]*\)/g, '').trim().length > 0,
        `${standing} is drawn as an icon alone, which says nothing to a reader who does not read icons`,
      );
    }
  });
});

describe('what the welcome page\'s last line reads the lifecycle as', () => {
  // The page's line has four readings where the indicator has three: a failed
  // start is told apart from a server that is merely not running. This is that
  // decision written out for every lifecycle position, and for no client at
  // all, each with the last attempt having failed and not — none inferred, and
  // the table checked against the enum so a position added later has nowhere to
  // fall through to.
  const POSITIONS: (DaemonState | null)[] = [null, ...Object.values(DaemonState)];
  const EXPECTED: Record<string, { failed: DaemonReading; notFailed: DaemonReading }> = {
    none: { failed: 'failedToStart', notFailed: 'notRunning' },
    [DaemonState.Stopped]: { failed: 'failedToStart', notFailed: 'notRunning' },
    [DaemonState.Stopping]: { failed: 'failedToStart', notFailed: 'notRunning' },
    [DaemonState.Starting]: { failed: 'starting', notFailed: 'starting' },
    [DaemonState.Restarting]: { failed: 'starting', notFailed: 'starting' },
    [DaemonState.Running]: { failed: 'running', notFailed: 'running' },
  };

  it('covers every lifecycle position the client can be in, and no client', () => {
    assert.deepStrictEqual(
      Object.keys(EXPECTED).sort(),
      POSITIONS.map((p) => p ?? 'none').sort(),
      'a lifecycle position is unaccounted for, so what the page says in it is nobody\'s decision',
    );
  });

  it('maps each position and each outcome of the last start onto the reading decided for it', () => {
    for (const position of POSITIONS) {
      const row = EXPECTED[position ?? 'none'];
      assert.strictEqual(
        daemonReading(position, true),
        row.failed,
        `${position ?? 'no client'} after a failed start no longer reads as ${row.failed}`,
      );
      assert.strictEqual(
        daemonReading(position, false),
        row.notFailed,
        `${position ?? 'no client'} with no failed start no longer reads as ${row.notFailed}`,
      );
    }
  });

  // 🔴 THE FOURTH READING REFINES ONE STANDING AND NO OTHER. A failed start that
  // is being retried is a server on its way up, and one that reached running has
  // started; only a server that is not running can be one that failed to.
  it('tells a failed start apart from a server that is merely not running', () => {
    assert.notStrictEqual(daemonReading(DaemonState.Stopped, true), daemonReading(DaemonState.Stopped, false));
    for (const position of POSITIONS) {
      const standing = daemonStanding(position);
      const reading = daemonReading(position, true);
      if (standing === 'notRunning') {
        assert.strictEqual(reading, 'failedToStart');
      } else {
        assert.strictEqual(reading, standing, `${position} is refined although it is not a not-running standing`);
      }
    }
  });

  // The words have one home. The indicator's label for each standing ends in
  // the page's word for it, so the two surfaces cannot come to call one state
  // two things; and the words are written out here so a rewording has to be
  // made on purpose.
  it('calls each state by one set of words on the indicator and the page', () => {
    assert.deepStrictEqual(DAEMON_READING_WORDS, {
      running: 'running',
      starting: 'starting',
      notRunning: 'not running',
      failedToStart: 'failed to start',
    });
    for (const standing of Object.keys(DAEMON_STANDING_WORDS) as DaemonStanding[]) {
      assert.strictEqual(DAEMON_READING_WORDS[standing], DAEMON_STANDING_WORDS[standing]);
      assert.ok(
        DAEMON_STANDING_LABEL[standing].endsWith(`Aggrega: ${DAEMON_STANDING_WORDS[standing]}`),
        `the indicator calls ${standing} something other than the page does`,
      );
    }
  });

  // The indicator is unchanged by the page's fourth reading: the same three
  // labels, byte for byte.
  it('leaves the indicator\'s three labels as they were', () => {
    assert.deepStrictEqual(DAEMON_STANDING_LABEL, {
      running: '$(check) Aggrega: running',
      starting: '$(sync~spin) Aggrega: starting',
      notRunning: '$(error) Aggrega: not running',
    });
  });
});

describe('the lifecycle indicator', () => {
  it('is visible in every standing, which is what it is for', () => {
    const lifecycle = new Lifecycle();
    const bar = lifecycle.bar();
    for (const state of [null, ...Object.values(DaemonState)]) {
      lifecycle.state = state;
      bar.refresh();
    }
    assert.strictEqual(
      lifecycle.item.hidden,
      0,
      'the indicator hides in some standing, which is the standing a reader most needs it in',
    );
    assert.strictEqual(lifecycle.item.shown, Object.values(DaemonState).length + 2);
  });

  it('opens the offer on click rather than acting on it', () => {
    const lifecycle = new Lifecycle();
    lifecycle.bar();
    assert.strictEqual(lifecycle.item.command, LIFECYCLE_ACTIONS_COMMAND);
    assert.notStrictEqual(
      lifecycle.item.command,
      RESTART_COMMAND,
      'a status bar is a place a pointer passes over, so the act is named before it happens',
    );
  });

  it('draws the alarm colour when nothing is running and clears it when something is', () => {
    const lifecycle = new Lifecycle();
    const bar = lifecycle.bar();
    assert.strictEqual(lifecycle.item.backgroundColor, ALARM, 'no client reads as not running');

    lifecycle.state = DaemonState.Running;
    bar.refresh();
    assert.strictEqual(
      lifecycle.item.backgroundColor,
      undefined,
      'the alarm colour survives the recovery it was raised for',
    );

    lifecycle.state = DaemonState.Stopped;
    bar.refresh();
    assert.strictEqual(lifecycle.item.backgroundColor, ALARM);
  });

  it('reports what a reader would read, at each standing', () => {
    const lifecycle = new Lifecycle();
    lifecycle.anchored = true;
    const bar = lifecycle.bar();

    lifecycle.state = DaemonState.Stopped;
    bar.refresh();
    assert.strictEqual(lifecycle.item.text, DAEMON_STANDING_LABEL.notRunning);
    assert.strictEqual(lifecycle.item.tooltip, daemonStandingTooltip('notRunning', true));

    lifecycle.state = DaemonState.Starting;
    bar.refresh();
    assert.strictEqual(lifecycle.item.text, DAEMON_STANDING_LABEL.starting);

    lifecycle.state = DaemonState.Running;
    bar.refresh();
    assert.strictEqual(lifecycle.item.text, DAEMON_STANDING_LABEL.running);
    assert.strictEqual(lifecycle.item.tooltip, daemonStandingTooltip('running', true));
  });

  it('follows the anchored workspace, not only the client', () => {
    const lifecycle = new Lifecycle();
    const bar = lifecycle.bar();
    const unanchored = lifecycle.item.tooltip;

    lifecycle.anchored = true;
    bar.refresh();
    assert.notStrictEqual(
      lifecycle.item.tooltip,
      unanchored,
      'the reason nothing is running does not follow the fact it is read from',
    );
  });
});

describe('what the manifest declares about availability', () => {
  // 🔴 THE CLAUSE THIS FILE EXISTS FOR. Registration is assertable and passes
  // while the palette leaves a command out behind an enablement clause that is
  // false — so what is asserted here is the clause, and that the palette then
  // leaves the command out is the editor's own behaviour, read in a running
  // editor by the end-to-end suite. What can be proved here is that the restart
  // is gated by nothing at all.
  it('gates the command that starts a language server on nothing', () => {
    const entry = declared(RESTART_COMMAND);
    assert.ok(entry, `${RESTART_COMMAND} is not declared, so the palette offers no way to start one`);
    assert.strictEqual(
      entry.enablement,
      undefined,
      'the command that starts a language server is gated on something, and the only situation that needs it is the one where that something is false',
    );
  });

  it('declares every command whose availability this state decides', () => {
    for (const id of [...GATED_ON_ANSWERABLE, ...NEVER_GATED]) {
      assert.ok(declared(id), `${id} is not declared, so it is in no palette and derives no activation event`);
    }
  });

  it('gates a command whose subject is a running server on the readiness condition, which leaves it out of the command palette while none answers', () => {
    for (const id of GATED_ON_ANSWERABLE) {
      assert.strictEqual(
        declared(id)?.enablement,
        enablementClause(),
        `${id} does not carry the readiness condition, so its availability is decided somewhere the reader cannot see`,
      );
    }
  });

  it('leaves ungated every command that succeeds whatever the compiler is doing', () => {
    for (const id of NEVER_GATED) {
      assert.strictEqual(
        declared(id)?.enablement,
        undefined,
        `${id} is left out of the command palette while its invocation would have succeeded, so a reader searching for it concludes it does not exist`,
      );
    }
  });

  it('gates no command on a condition nothing publishes', () => {
    const gates = manifest().commands
      .map((c) => c.enablement)
      .filter((e): e is string => typeof e === 'string');
    for (const gate of gates) {
      assert.strictEqual(
        gate,
        COMPILER_ANSWERABLE_CONTEXT_KEY,
        `no part of this extension sets ${gate}, so a command carrying it is left out of the command palette for ever`,
      );
    }
  });

  // No command gate can collide with one of the welcome panel's four step
  // conditions: the panel is drawn by this extension and reads its four
  // standings directly, so no step condition is published to the editor at
  // all. The assertion above — that every declared gate is the one condition
  // this extension publishes — carries that guarantee, and it carries it for
  // every key rather than for four named ones.

  // Two palette entries differing only in wording leave a reader choosing
  // between two names for one act. The offer the indicator opens is the
  // indicator's; the restart keeps its own name in the palette.
  it('keeps one name in the palette for starting a language server', () => {
    const hidden = new Set(
      manifest().palette.filter((m) => m.when === 'false').map((m) => String(m.command)),
    );
    assert.ok(
      hidden.has(LIFECYCLE_ACTIONS_COMMAND),
      `${LIFECYCLE_ACTIONS_COMMAND} sits in the palette beside ${RESTART_COMMAND}, which does the same thing under a different name`,
    );
    assert.ok(
      !hidden.has(RESTART_COMMAND),
      'the command that starts a language server is hidden from the palette, which is where a reader looks for it',
    );
  });

  it('names the offer and both of its actions', () => {
    assert.ok(DAEMON_ACTION_PLACEHOLDER.length > 0);
    for (const action of ['start', 'restart'] as const) {
      assert.ok(DAEMON_ACTION_LABEL[action].length > 0);
      assert.ok(DAEMON_ACTION_DETAIL[action].length > 0);
    }
  });

  it('names the quick-action menu as the one command it gates', () => {
    assert.deepStrictEqual([...GATED_ON_ANSWERABLE], [STATUS_BAR_MENU_COMMAND]);
    assert.ok(NEVER_GATED.includes(TOGGLE_BUILD_ON_INSPECT_COMMAND));
  });
});

describe('the notification raised when the language server stops responding', () => {
  // 🔴 THE SENTENCE IS A LITERAL ON PURPOSE. It is the words a reader is meant to
  // read, naming the command as the palette lists it, and it is held here where
  // an edit to the composition or to the manifest cannot reach it — so a
  // composition that went back to naming a command the manifest does not declare
  // fails, and so does a manifest rename nobody meant.
  const STOPPED_RESPONDING =
    'Aggrega language server has stopped responding. Run "Aggrega: Start or restart the language server" to recover.';

  it('names the command that starts the server again, under the title the manifest declares', () => {
    const pkg = readManifest();
    assert.strictEqual(commandTitle(pkg, RESTART_COMMAND), 'Aggrega: Start or restart the language server');
    assert.strictEqual(stoppedRespondingMessage(commandTitle(pkg, RESTART_COMMAND)), STOPPED_RESPONDING);
  });

  // The title is read rather than held, shown by reading two manifests: the
  // sentence follows the one it is handed.
  it('names the command as the manifest it is handed declares it', () => {
    const renamed = {
      contributes: { commands: [{ command: RESTART_COMMAND, title: 'Aggrega: Bring the language server back' }] },
    };
    assert.strictEqual(
      stoppedRespondingMessage(commandTitle(renamed, RESTART_COMMAND)),
      'Aggrega language server has stopped responding. Run "Aggrega: Bring the language server back" to recover.',
    );
  });

  it('composes the name the palette shows where the entry declares a category', () => {
    const categorised = {
      contributes: {
        commands: [{ command: RESTART_COMMAND, title: 'Start or restart the language server', category: 'Aggrega' }],
      },
    };
    assert.strictEqual(commandTitle(categorised, RESTART_COMMAND), 'Aggrega: Start or restart the language server');
  });

  // 🔴 A COMMAND THE MANIFEST DOES NOT NAME IS NEVER NAMED. Where no title can be
  // read the sentence says the server stopped and names nothing, because a name
  // written in its place is exactly the defect of sending a reader to a command
  // that is not there.
  it('names no command where the manifest declares no title for it', () => {
    const untitled: unknown[] = [
      undefined,
      null,
      42,
      {},
      { contributes: {} },
      { contributes: { commands: [] } },
      { contributes: { commands: [{ command: RESTART_COMMAND }] } },
      { contributes: { commands: [{ command: RESTART_COMMAND, title: '' }] } },
      { contributes: { commands: [{ command: 'aggrega.another', title: 'Aggrega: Another' }] } },
    ];
    for (const manifest of untitled) {
      assert.strictEqual(
        commandTitle(manifest, RESTART_COMMAND),
        null,
        `a title was read out of ${JSON.stringify(manifest)}`,
      );
    }
    assert.strictEqual(stoppedRespondingMessage(null), 'Aggrega language server has stopped responding.');
  });

  // 🔴 THE WIRING IS READ FROM THE SOURCE, BECAUSE IT CANNOT BE DRIVEN HERE. The
  // notification is raised from the module that holds the editor, which does not
  // start in a headless run; what is asserted is that the one place it is raised
  // hands it the title read from the manifest the editor loaded.
  it('is raised with the title read from the loaded manifest, at the one place it is raised', () => {
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'notifyStoppedResponding'),
      [['commandTitle(context.extension.packageJSON, RESTART_COMMAND)']],
    );
  });
});

describe('the notification a start or a restart the reader asked for ends in', () => {
  // The sentences are literals for the reason the stopped-responding one is: they
  // are the words a reader reads, held where an edit to the composition cannot
  // reach them.
  it('names the build the running server reported about itself', () => {
    assert.strictEqual(
      serverInPlaceMessage('started', '0.7.4-11-g20ddd35e'),
      'Aggrega language server started, version 0.7.4-11-g20ddd35e.',
    );
    assert.strictEqual(
      serverInPlaceMessage('restarted', '0.7.4-11-g20ddd35e'),
      'Aggrega language server restarted, version 0.7.4-11-g20ddd35e.',
    );
  });

  it('says the version was not reported where the answer carried none, or an empty one', () => {
    for (const version of [undefined, null, '']) {
      assert.strictEqual(
        serverInPlaceMessage('restarted', version),
        'Aggrega language server restarted, version not reported.',
        `a version was drawn for ${JSON.stringify(version)}`,
      );
    }
    assert.strictEqual(
      serverInPlaceMessage('started', undefined),
      'Aggrega language server started, version not reported.',
    );
  });

  // 🔴 THE WIRING IS READ FROM THE SOURCE, BECAUSE IT CANNOT BE DRIVEN HERE. Both
  // notifications are raised from the module that holds the editor; what is
  // asserted is that each is composed here and hands it the version from the
  // running server's own handshake answer, and from nothing that asks a binary.
  it('is composed at the restart and the start, each handed the handshake answer\'s version', () => {
    assert.deepStrictEqual(
      callArguments('src/extension.ts', 'serverInPlaceMessage'),
      [
        ["'restarted'", 'daemon?.getServerInitMetadata()?.version'],
        ["'started'", 'daemon?.getServerInitMetadata()?.version'],
      ],
    );
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/extension.ts'), 'utf8');
    for (const sentence of ["'Aggrega language server started.'", "'Aggrega language server restarted.'"]) {
      assert.ok(!source.includes(sentence), `the notification is still raised as ${sentence}, with no version`);
    }
  });
});

describe('what the editor guide teaches about the lifecycle indicator', () => {
  // A surface the editor guide does not describe is one a reader meets without
  // having been told what it is, and the editor guide already lists the commands
  // and describes the status bar.
  it('describes the standing the indicator exists to report', function () {
    if (!editorGuidePresent()) {
      // Checked out without the documentation beside it. Reported as pending
      // rather than passed: a silent skip would read as the guide holding.
      this.skip();
      return;
    }
    const guide = editorGuide();
    assert.ok(
      guide.includes('not running'),
      'a reader who meets a red indicator has been told nothing about what it means',
    );
  });

  // The title is read from the manifest rather than written here, so a rename
  // that stops at the manifest fails: a reader who finds a command in the
  // editor guide and then searches the palette for that name would find nothing.
  it('teaches the command that starts a language server under its declared title', function () {
    if (!editorGuidePresent()) {
      this.skip();
      return;
    }
    const guide = editorGuide();
    const title = String(declared(RESTART_COMMAND)?.title);
    assert.ok(
      guide.includes(`**${title}**`),
      `the editor guide does not name ${RESTART_COMMAND} as the palette shows it (${title})`,
    );
  });
});
