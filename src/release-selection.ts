// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { ActiveReleaseResponse } from './types';
import { toWorkspaceRelative } from './workspace';

// SelectionState is what the editor knows about the selected Release at a
// moment in time. Every surface that displays the selection renders one of
// these three, so the indicator and any other reader cannot disagree about
// what "no Release" means.
//
// selected carries the workspace-relative path, which is the form every
// request parameter takes, alongside the absolute path a display uses.
// none carries the language server's own account of why the workspace
// offered nothing. unknown is the state before an answer has been obtained —
// the server is not running, so there is nothing to report and nothing to
// guess.
export type SelectionState =
  | { kind: 'selected'; release: string; absolute: string }
  | { kind: 'none'; reason: string }
  | { kind: 'unknown' };

// ReleaseSelectionDeps supplies the workspace root, the two language-server
// queries the selection is built from, and the editor surfaces it drives.
// Injecting them keeps the selection rule testable without the editor: a test
// supplies recorded answers and reads back the state an operator would see.
export interface ReleaseSelectionDeps {
  getWorkspaceRoot(): string | null;
  // requestActiveRelease asks the language server which Release this workspace
  // points at by default. The answer is the server's own reading of the
  // workspace, which is why it is asked for rather than derived here: an input
  // to that reading names a different Release whenever a higher-precedence
  // input won, so consulting one directly would select a Release the compiler
  // would not have chosen. Rejects when the server is not running.
  requestActiveRelease(): Promise<ActiveReleaseResponse>;
  // listReleases returns the workspace's Release candidates as absolute paths.
  listReleases(): Promise<string[]>;
  // pickRelease offers the candidates and returns the chosen absolute path, or
  // undefined when the reader dismissed the prompt.
  pickRelease(candidates: string[], placeHolder: string): Promise<string | undefined>;
  // reportInfo and reportError surface a message to the reader.
  reportInfo(message: string): void;
  reportError(message: string): void;
  // logLine writes one line to the shared output channel.
  logLine(line: string): void;
}

// ReleaseSelection is the editor's single answer to "which Release are we
// talking about". Every surface that acts on a Release reads it here, so the
// editor cannot validate against one Release while drawing another.
//
// The selection lives in this client and travels on each request. The language
// server keeps none of its own, so changing the selection takes effect on the
// next request and never requires a restart.
export interface ReleaseSelection {
  // state reports the current selection without contacting the server.
  state(): SelectionState;
  // current is the workspace-relative selection, or null when none is in
  // force. This is the value a request parameter takes.
  current(): string | null;
  // adoptDefault asks the server what this workspace points at and takes that
  // as the selection. Called once per language-server connection: the answer
  // is the starting point, and an explicit selection afterwards replaces it.
  adoptDefault(): Promise<void>;
  // choose prompts the reader for a Release and selects it. Returns the
  // workspace-relative selection, or null when nothing was chosen.
  choose(placeHolder?: string): Promise<string | null>;
  // adopt takes an absolute path as the selection, for a caller that already
  // has the reader's choice in hand and needs no second prompt.
  adopt(absolutePath: string): void;
  // forget drops the selection, so the next connection resolves a fresh
  // default rather than carrying the previous workspace's answer forward.
  forget(): void;
  // onChange registers a listener fired whenever the selection changes.
  onChange(listener: () => void): void;
}

// createReleaseSelection builds the selection over the supplied dependencies.
export function createReleaseSelection(deps: ReleaseSelectionDeps): ReleaseSelection {
  let state: SelectionState = { kind: 'unknown' };
  const listeners: Array<() => void> = [];

  const announce = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (next: SelectionState): void => {
    state = next;
    announce();
  };

  const selectAbsolute = (root: string, absolute: string): string => {
    // The candidate enumeration and the active-Release answer both report
    // absolute paths, and every request parameter takes a workspace-relative
    // one. Converting here, at the single point a value becomes the selection,
    // is what lets every reader below use it without repeating the rule.
    const release = toWorkspaceRelative(root, absolute);
    setState({ kind: 'selected', release, absolute });
    return release;
  };

  return {
    state: () => state,

    current: () => (state.kind === 'selected' ? state.release : null),

    adoptDefault: async (): Promise<void> => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        setState({ kind: 'unknown' });
        return;
      }
      let answer: ActiveReleaseResponse;
      try {
        answer = await deps.requestActiveRelease();
      } catch {
        // The server is not answering, so there is no default to adopt. The
        // state says the answer is unknown rather than reporting "none",
        // which is a different fact and one this client has not established.
        setState({ kind: 'unknown' });
        return;
      }
      if (answer.release) {
        selectAbsolute(root, answer.release);
        return;
      }
      // No Release to default to. The server's own account of why travels on
      // this answer; the one-line summary is what a compact surface shows and
      // the per-step account goes to the output channel, where there is room
      // for it.
      //
      // Both are passed through exactly as received and neither is parsed:
      // this text is written for a person to read, and its wording and labels
      // follow the workspace reading itself rather than any shape this client
      // could rely on.
      const reason = answer.reason ?? '';
      setState({ kind: 'none', reason });
      if (answer.trace) {
        for (const line of answer.trace.split('\n')) {
          deps.logLine(line);
        }
      } else if (reason) {
        deps.logLine(`[no Release selected] ${reason}`);
      }
    },

    choose: async (placeHolder?: string): Promise<string | null> => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.reportInfo('Aggrega: no anchored workspace, so there is no Release to select.');
        return null;
      }
      let candidates: string[];
      try {
        candidates = await deps.listReleases();
      } catch {
        deps.reportError(
          'Aggrega: cannot list Releases — the language server is not running. Start it and try again.',
        );
        return null;
      }
      if (candidates.length === 0) {
        deps.reportInfo('Aggrega: no Release found in this workspace.');
        return null;
      }
      // A sole candidate is still offered rather than taken silently. This is
      // the reader asking to change the selection, and answering a request to
      // choose by choosing for them leaves them unable to tell that the
      // command ran at all.
      const picked = await deps.pickRelease(
        candidates,
        placeHolder ?? 'Aggrega: choose the Release to work on',
      );
      if (!picked) { return null; }
      return selectAbsolute(root, picked);
    },

    adopt: (absolutePath: string): void => {
      const root = deps.getWorkspaceRoot();
      if (!root) { return; }
      selectAbsolute(root, absolutePath);
    },

    forget: () => setState({ kind: 'unknown' }),

    onChange: (listener: () => void): void => {
      listeners.push(listener);
    },
  };
}

// describeSelection renders the selection as the short label and the longer
// explanation a status surface shows. Kept apart from the editor so the text a
// reader sees is directly testable.
export function describeSelection(state: SelectionState): { label: string; detail: string } {
  switch (state.kind) {
    case 'selected':
      return {
        label: path.basename(state.absolute),
        detail: `Aggrega selected Release: ${state.absolute}\nClick to select a different one`,
      };
    case 'none':
      return {
        label: 'Release: none',
        detail: state.reason
          ? `Aggrega: no Release is selected. ${state.reason}\nClick to select one.`
          : 'Aggrega: no Release is selected. Click to select one.',
      };
    case 'unknown':
      return {
        label: 'Release: unavailable',
        detail:
          'Aggrega: the language server is not running, so which Release is selected is unknown.',
      };
  }
}
