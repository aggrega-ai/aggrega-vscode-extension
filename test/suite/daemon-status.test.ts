// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
  createDaemonStatusBar,
  daemonReading,
  daemonStanding,
  daemonStandingAction,
  daemonStandingTooltip,
  enablementClause,
} from '../../src/daemon-status';
import { COMPILER_ANSWERABLE_CONTEXT_KEY } from '../../src/readiness';

// The manifest is read and parsed rather than pattern-matched: what is asserted
// below is a property of the declared contributions, and only a parse can see
// that.
const MANIFEST = path.resolve(__dirname, '../../../package.json');
const README = path.resolve(__dirname, '../../../README.md');

interface CommandEntry { command?: unknown; title?: unknown; enablement?: unknown }
interface MenuEntry { command?: unknown; when?: unknown }

function manifest(): { commands: CommandEntry[]; palette: MenuEntry[] } {
  const pkg = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
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
  // while the palette hides a command behind an enablement clause that is
  // false — so what is asserted here is the clause, and whether the palette
  // then greys rather than hides is the editor's own behaviour, met on the
  // walk. What can be proved here is that the restart is gated by nothing at
  // all.
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

  it('expresses an unavailable command as greyed rather than as absent', () => {
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
        `${id} is greyed while its invocation would have succeeded, which teaches a reader to distrust the surface for nothing`,
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
        `no part of this extension sets ${gate}, so a command carrying it is greyed for ever`,
      );
    }
  });

  // The assertion this replaces required the command gate not to be one of the
  // welcome panel's four step conditions, which the editor published as
  // conditions of its own. Retired rather than adjusted: the panel is drawn by
  // this extension and reads its four standings directly, so no step condition
  // is published to the editor at all and there is none for a gate to collide
  // with. The assertion above — that every declared gate is the one condition
  // this extension publishes — is what now carries that guarantee, and it
  // carries it for every key rather than for four named ones.

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

describe('what the README teaches about the lifecycle indicator', () => {
  // A surface the README does not describe is one a reader meets without
  // having been told what it is, and the README already lists the commands and
  // describes the status bar.
  it('describes the standing the indicator exists to report', () => {
    const readme = fs.readFileSync(README, 'utf8');
    assert.ok(
      readme.includes('not running'),
      'a reader who meets a red indicator has been told nothing about what it means',
    );
  });

  // The title is read from the manifest rather than written here, so a rename
  // that stops at the manifest fails: a reader who finds a command in the
  // README and then searches the palette for that name would find nothing.
  it('teaches the command that starts a language server under its declared title', () => {
    const readme = fs.readFileSync(README, 'utf8');
    const title = String(declared(RESTART_COMMAND)?.title);
    assert.ok(
      readme.includes(`**${title}**`),
      `the README does not name ${RESTART_COMMAND} as the palette shows it (${title})`,
    );
  });
});
