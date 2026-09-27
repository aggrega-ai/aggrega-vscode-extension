// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The language server's lifecycle, as a reader reads it.
//
// WHY THIS EXISTS AT ALL. A command the editor greys tells a reader that
// something is unavailable and nothing whatever about why, because no editor
// surface shows a tooltip on a disabled control. A reader who cannot find out
// why concludes the extension is broken. This is the surface that carries the
// reason, and it doubles as the place to act on it — which is why it must be
// visible in exactly the state the rest of the surface goes quiet in.
//
// This module reaches for no editor runtime, so what a reader is shown — which
// standing each lifecycle position produces, the words on the item, its colour,
// and which action the click offers — is assertable without an extension host.
// The surface the indicator writes into is passed in for exactly that reason: a
// test hands it a recorder and reads back what an operator would have seen.

import type * as vscode from 'vscode';
import { DaemonState } from './daemon';
import { COMPILER_ANSWERABLE_CONTEXT_KEY } from './readiness';

// The commands whose availability this state decides, named once here so the
// manifest and the code that registers them cannot drift onto different
// spellings. Every one of them is registered when the extension activates; what
// the manifest declares is which of them the editor greys, and greying is what
// availability is expressed by. A command that exists only once a language
// server has attached is missing in the one situation that needs it most.
export const RESTART_COMMAND = 'aggrega.server.restart';
export const LIFECYCLE_ACTIONS_COMMAND = 'aggrega.server.lifecycleActions';
export const STATUS_BAR_MENU_COMMAND = 'aggrega.statusBar.openMenu';
export const TOGGLE_BUILD_ON_INSPECT_COMMAND = 'aggrega.server.toggleBuildOnInspect';

// RESTART_SERVER_ACTION is the button a notification carries when what it
// reports takes effect only once the language server starts again — a preference
// the server reads at start, or a configuration file changed since it started.
// Pressing it runs RESTART_COMMAND. One label, so the same act reads the same
// wherever it is offered.
export const RESTART_SERVER_ACTION = 'Restart server';

// enablementClause is the exact condition string a gated command carries in the
// manifest. This is the one home for it: the manifest is declarative data the
// editor reads and nothing here can generate into it, so the two are held
// together by a conformance assertion reading the manifest back against this
// function. Without that, a command could carry a condition naming a key
// nothing sets, and the symptom would be an entry greyed for ever.
export function enablementClause(): string {
  return COMPILER_ANSWERABLE_CONTEXT_KEY;
}

// GATED_ON_ANSWERABLE names the commands the editor greys while the compiler
// cannot be asked.
//
// The quick-action menu is here because its subject is a running language
// server: it offers a restart of the server, the pending-restart controls, the
// server's log, and the folder that server anchored to. With nothing running it
// is a list of actions about something that does not exist.
export const GATED_ON_ANSWERABLE: readonly string[] = [STATUS_BAR_MENU_COMMAND];

// NEVER_GATED names the commands that stay invocable whatever the compiler is
// doing, and each is here for its own reason rather than by default.
//
// The restart is the plain case: starting is what it does, so gating it on
// something being started would withhold it in the only situation that needs
// it. The lifecycle actions are the same command reached from the indicator,
// and offering a start is half of what they offer.
//
// The build-analysis toggle is the one worth stating, because the obvious move
// is to gate it with the rest and the obvious move is wrong. It writes a
// preference through the editor's own configuration API and touches neither the
// language server nor the workspace root, so its invocation succeeds in every
// state — and the server reads that preference when it STARTS, which makes a
// stopped server the most useful moment to set it. Greying it would be the
// mirror of drawing a control that cannot succeed: a control that would have
// worked, refused, with the same lesson for the reader and none of the benefit.
export const NEVER_GATED: readonly string[] = [
  RESTART_COMMAND,
  LIFECYCLE_ACTIONS_COMMAND,
  TOGGLE_BUILD_ON_INSPECT_COMMAND,
];

// DaemonStanding is what a reader is shown. There are three, and they are
// FEWER than the lifecycle has positions: a reader acts on "it is up", "it is
// coming up" and "it is not up", and the finer distinctions inside those are
// the client's business rather than theirs.
//
// The reduction is a decision this module makes and states, not a state machine
// of its own. Every standing is derived from the one lifecycle enum below; a
// second enum tracked in parallel would agree with the daemon until the day it
// did not, and nothing would report the disagreement.
export type DaemonStanding = 'running' | 'starting' | 'notRunning';

// daemonStanding maps a lifecycle position — or the absence of a client
// altogether — onto what a reader is shown.
//
// THE ABSENT CLIENT IS NOT A SIXTH LIFECYCLE POSITION, and it is the commonest
// case in the situation this surface exists for. Before a workspace is anchored
// no client is constructed at all, and stopping one drops it; in both, there is
// no lifecycle to read. It reads as not running because that is what it is.
//
// The two mappings that are decisions rather than restatements:
//
// RESTARTING READS AS STARTING, on what a restart does rather than on what the
// word suggests. A restart terminates the child and then takes the ordinary
// spawn path, so the position is the leading edge of a start already under way
// and it ends in Running. The one behavioural difference is that a request made
// while restarting is refused where one made while starting is queued — a
// difference in what happens to a request, not in what a reader should do,
// which in both cases is wait. Showing it as not running would flash the alarm
// colour through every restart, which teaches a reader that the colour means
// nothing.
//
// STOPPING READS AS NOT RUNNING, for the mirror reason. Stopping rejects
// everything in flight and terminates; nothing is coming back, and a request
// made in it is refused exactly as one made after it is. Grouping it with
// starting would promise a server on its way up while it is on its way out.
export function daemonStanding(state: DaemonState | null): DaemonStanding {
  if (state === null) {
    return 'notRunning';
  }
  switch (state) {
    case DaemonState.Running:
      return 'running';
    case DaemonState.Starting:
    case DaemonState.Restarting:
      return 'starting';
    case DaemonState.Stopping:
    case DaemonState.Stopped:
      return 'notRunning';
  }
}

// DaemonReading is what the welcome page's last line reads. It is the three
// standings and one more: a server whose most recent attempt to start failed,
// with none running since.
//
// 🔴 THE FOURTH READING IS THE PAGE'S AND NOT THE INDICATOR'S, and the
// difference is what each surface is for. The indicator's colour is what a
// reader acts on, and the act is the same whether the server stopped or never
// came up — start it — so a fourth standing would put a difference into the
// colour that the colour cannot carry. The page's line is where a reader looks
// to find out what happened, and there a failed start and a stopped server are
// different news, which a reader needs told apart before going to look for why.
export type DaemonReading = DaemonStanding | 'failedToStart';

// daemonReading maps a lifecycle position, and whether the most recent attempt
// to start failed, onto what the welcome page's last line reads.
//
// It is built on daemonStanding rather than beside it, so the three standings
// the two surfaces share are decided in one place. A failed start refines only
// the not-running standing: a server starting again after a failure is
// starting, and one that reached running has by definition started.
export function daemonReading(
  state: DaemonState | null,
  lastStartFailed: boolean,
): DaemonReading {
  const standing = daemonStanding(state);
  return standing === 'notRunning' && lastStartFailed ? 'failedToStart' : standing;
}

// DAEMON_STANDING_WORDS is what each standing is called in words, on every
// surface that names it.
//
// 🔴 THE WORDS HAVE THIS ONE HOME, and the indicator's label and the welcome
// page's line are both composed from it. A reader who is told a server is "not
// running" in one place and something else in another has to work out whether
// the two are the same state.
export const DAEMON_STANDING_WORDS: Record<DaemonStanding, string> = {
  running: 'running',
  starting: 'starting',
  notRunning: 'not running',
};

// DAEMON_READING_WORDS is what each of the welcome page's four readings is
// called: the three standings in their own words, and the words the
// notification raised for a failed start already uses.
export const DAEMON_READING_WORDS: Record<DaemonReading, string> = {
  ...DAEMON_STANDING_WORDS,
  failedToStart: 'failed to start',
};

// DAEMON_STANDING_ICON is the glyph beside each standing on the indicator.
const DAEMON_STANDING_ICON: Record<DaemonStanding, string> = {
  running: '$(check)',
  starting: '$(sync~spin)',
  notRunning: '$(error)',
};

function standingLabel(standing: DaemonStanding): string {
  return `${DAEMON_STANDING_ICON[standing]} Aggrega: ${DAEMON_STANDING_WORDS[standing]}`;
}

// DAEMON_STANDING_LABEL is what the indicator reads, per standing. The icon
// carries the standing at a glance and the words carry it for a reader who does
// not read icons; neither stands alone.
export const DAEMON_STANDING_LABEL: Record<DaemonStanding, string> = {
  running: standingLabel('running'),
  starting: standingLabel('starting'),
  notRunning: standingLabel('notRunning'),
};

// DAEMON_STANDING_IS_ALARMING reports whether a standing is drawn in the
// editor's error colour. One standing is, and it is the one a reader has to
// act on.
export const DAEMON_STANDING_IS_ALARMING: Record<DaemonStanding, boolean> = {
  running: false,
  starting: false,
  notRunning: true,
};

// DaemonStandingAction is what the click offers. There are two, and which one
// is offered is decided by the standing rather than left to the reader to work
// out: a reader with nothing running is offered a start, and one with something
// running is offered a restart.
export type DaemonStandingAction = 'start' | 'restart';

// DAEMON_ACTION_LABEL names each action as the reader sees it offered.
export const DAEMON_ACTION_LABEL: Record<DaemonStandingAction, string> = {
  start: 'Start',
  restart: 'Restart',
};

// DAEMON_ACTION_DETAIL says what each action does, beside its name.
export const DAEMON_ACTION_DETAIL: Record<DaemonStandingAction, string> = {
  start: 'Start the Aggrega language server',
  restart: 'Stop the Aggrega language server and start a fresh one',
};

// DAEMON_ACTION_PLACEHOLDER heads the offer the indicator opens on click.
//
// The offer is made rather than the action fired. A status bar is a place a
// pointer passes over, and restarting a language server on a stray click is a
// surprise; naming the act first is also what tells a reader which of the two
// they are about to do.
export const DAEMON_ACTION_PLACEHOLDER = 'Aggrega: the language server';

// DaemonStatusItemLike is the slice of the editor's status-bar item the
// indicator drives. Its field types mirror the editor item's own, so a real
// item satisfies it unchanged.
export interface DaemonStatusItemLike {
  text: string;
  tooltip: vscode.StatusBarItem['tooltip'];
  command: vscode.StatusBarItem['command'];
  backgroundColor: vscode.StatusBarItem['backgroundColor'];
  show(): void;
  hide(): void;
  dispose(): unknown;
}

// DaemonStatusDeps supplies the lifecycle position, whether a workspace is
// anchored at all, and the surface the indicator writes into.
export interface DaemonStatusDeps {
  // getDaemonState reports the language server's lifecycle position, or null
  // where no client exists — which is not a lifecycle position but the absence
  // of one, and is the state a window anchoring nothing stays in.
  getDaemonState(): DaemonState | null;
  // isWorkspaceAnchored decides which of the two readings of "not running" the
  // tooltip gives: nothing to attach to, or something to attach to that is not
  // attached.
  isWorkspaceAnchored(): boolean;
  createStatusBarItem(): DaemonStatusItemLike;
  // alarmBackground is the editor's error background. The editor accepts only
  // two backgrounds on a status-bar item and this is the red one; it is passed
  // in rather than named here so the indicator can be driven without an editor.
  alarmBackground(): vscode.StatusBarItem['backgroundColor'];
}

// DaemonStatusBar is the handle the extension holds to re-render the indicator.
export interface DaemonStatusBar {
  refresh(): void;
}

// createDaemonStatusBar builds the indicator that reports whether the language
// server is running, and offers to start or restart it.
//
// It is ALWAYS VISIBLE, and that is the property that makes it worth having.
// Every other surface here reports what a running compiler answered; this one
// reports that there is nothing answering — which is exactly the state a reader
// needs told, and the state in which every other surface has gone quiet. It is
// also the only place the reason a greyed command cannot run is written down,
// because no editor surface shows a tooltip on a disabled control.
export function createDaemonStatusBar(deps: DaemonStatusDeps): DaemonStatusBar {
  const item = deps.createStatusBarItem();
  item.command = LIFECYCLE_ACTIONS_COMMAND;

  const refresh = (): void => {
    const standing = daemonStanding(deps.getDaemonState());
    item.text = DAEMON_STANDING_LABEL[standing];
    item.tooltip = daemonStandingTooltip(standing, deps.isWorkspaceAnchored());
    // Cleared rather than left standing on the way back out of the alarming
    // standing: a colour that is only ever set stays red through the recovery
    // it was raised for.
    item.backgroundColor = DAEMON_STANDING_IS_ALARMING[standing]
      ? deps.alarmBackground()
      : undefined;
    item.show();
  };

  refresh();
  return { refresh };
}

// daemonStandingAction reports which action the click offers.
//
// A start is offered only where there is nothing to restart. A server that is
// starting is offered a restart rather than a start, because it has already
// started: offering to start it again would name an act that is not the one
// that would happen.
export function daemonStandingAction(standing: DaemonStanding): DaemonStandingAction {
  return standing === 'notRunning' ? 'start' : 'restart';
}

// daemonStandingTooltip is the explanation the greyed commands cannot give.
//
// The not-running standing has two readings and the reader needs to know
// which. A workspace nothing anchors has no root for a server to attach to,
// which is a different situation from a server that could run here and is not
// running — the first is answered by pointing the editor at a folder, the
// second by starting it. Both are still ONE standing: the distinction is a
// sentence, not a fourth state, and a fourth state would put a difference into
// the colour that the colour cannot carry.
export function daemonStandingTooltip(
  standing: DaemonStanding,
  workspaceAnchored: boolean,
): string {
  switch (standing) {
    case 'running':
      return 'The Aggrega language server is running. Click to restart it.';
    case 'starting':
      return 'The Aggrega language server is starting. It answers what is asked of it once it is up.';
    case 'notRunning':
      return workspaceAnchored
        ? 'The Aggrega language server is not running, so the operations that ask it a question are unavailable. Click to start it.'
        : 'No folder in this window is one Aggrega recognises as a workspace, so there is nothing for the language server to attach to. Click to look again.';
  }
}
