// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import { ActiveReleaseResponse, ReleaseCandidatesResponse } from './types';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { releaseParamFor } from './workspace';

// SELECTED_RELEASE_STATE_KEY is the editor-local entry the chosen Release is
// remembered under. Editor-local means per editor window: the choice survives
// closing the window and nothing about it is written into the workspace. What a
// workspace starts on for everyone who opens it is a different act with its own
// file, and this is deliberately not that.
export const SELECTED_RELEASE_STATE_KEY = 'aggrega.selectedRelease';

// SELECT_RELEASE_COMMAND is the one command that changes which Release the
// editor is acting on.
//
// It lives beside the choice it opens rather than beside any of the surfaces
// that run it — the status-bar indicator, the Release row, and the welcome
// page's Release step all name it, and a declaration beside one of those would
// make the other two depend on a surface they have nothing to do with. Two
// copies agree until one of them moves, and what they hide while they agree is
// a command registered under one identifier and invoked under another.
export const SELECT_RELEASE_COMMAND = 'aggrega.release.select';

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

// NO_RELEASE_SELECTED_CONTROL_REASON is the reason a control that acts on a
// Release gives for being unavailable while none is selected.
//
// It sits here, beside the state it describes, rather than beside the control:
// several controls need a Release, and a wording written per control would drift
// the moment one of them was reworded. It is an instruction rather than an
// account of the state, because it is read beside a control the reader can
// already see is unavailable — what they cannot see is what to do about it.
export const NO_RELEASE_SELECTED_CONTROL_REASON = 'Select a Release first.';

// ReleaseSelectionDeps supplies the workspace root, the two language-server
// queries the selection is built from, and the editor surfaces it drives.
// Injecting them keeps the selection rule testable without the editor: a test
// supplies recorded answers and reads back the state an operator would see.
// SelectionStore is where the reader's explicit choice is remembered between
// sessions. It is a narrow pair rather than the editor's state object so the
// selection rule stays testable without the editor, and so nothing here can
// reach a key it was not given.
export interface SelectionStore {
  // read returns the remembered selection, workspace-relative, or null.
  read(): string | null;
  // write records a selection, or clears the entry when passed null.
  write(release: string | null): void;
}

export interface ReleaseSelectionDeps {
  getWorkspaceRoot(): string | null;
  // getDaemonWorkspaceRoot reports the folder the language server resolved as
  // its workspace root and named in its handshake, or null when it named none.
  //
  // THIS, NOT THE OPENED FOLDER, IS WHAT A RELEASE PATH IS CONVERTED AGAINST.
  // The server enumerates its candidates over the root it resolved and resolves
  // the request parameter against that same root, so converting against any
  // other folder produces a parameter it refuses for a document it has just
  // offered. The two coincide whenever the opened folder is itself the anchor,
  // and differ whenever the anchor sits above it — which is the ordinary case
  // for a folder opened inside a larger workspace.
  getDaemonWorkspaceRoot(): string | null;
  // store remembers the reader's explicit choice for this editor window.
  store: SelectionStore;
  // requestActiveRelease asks the language server which Release this workspace
  // points at by default. The answer is the server's own reading of the
  // workspace, which is why it is asked for rather than derived here: an input
  // to that reading names a different Release whenever a higher-precedence
  // input won, so consulting one directly would select a Release the compiler
  // would not have chosen. Rejects when the server is not running.
  requestActiveRelease(): Promise<ActiveReleaseResponse>;
  // listReleases returns the workspace's Release candidates as absolute paths,
  // together with the lockfile of each as the language server placed it, and
  // the links its search met inside the workspace leading to directories outside
  // it, which it did not search. Rejects when the server is not running.
  listReleases(): Promise<ReleaseCandidatesResponse>;
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
  // offerableCount reports how many Releases the last enumeration could name in
  // a request, or null where no enumeration has produced an answer.
  //
  // 🔴 NULL IS "NOT READ", NEVER "NONE", and the two must not be folded
  // together: one says this workspace offers nothing to choose and the other
  // says nobody has looked. A reader acts on the first and can only wait on the
  // second, so a surface that drew them alike would send someone hunting for a
  // Release that was never looked for.
  //
  // It is as at the last enumeration rather than as of now. The set is read
  // when a connection resolves the selection and again whenever the reader
  // opens the chooser; nothing watches the folder in between, so a Release
  // written after the last read is found by opening the chooser, which is the
  // act that reads again.
  offerableCount(): number | null;
  // current is the workspace-relative selection, or null when none is in
  // force. This is the value a request parameter takes.
  current(): string | null;
  // lockfile is the absolute path of the selected Release's lockfile, as the
  // language server named it in the answer the selection was taken from, or
  // null where nothing is selected or that answer named none.
  //
  // 🔴 THE PATH IS READ, NEVER DERIVED. Where a Release's lockfile sits is the
  // compiler's rule, and every answer that names a Release to select names its
  // lockfile beside it: the workspace default's answer, and the enumeration the
  // chooser and the re-verification of a remembered choice read. Holding the
  // path from that answer keeps the rule in the compiler alone. Where no answer
  // named a lockfile, none is held and none is followed, rather than one being
  // composed here from the Release's name — a rule restated on this side would
  // agree with the compiler's only until the compiler's rule moved.
  //
  // It is held rather than asked for, because the reader of it decides as a file
  // reaches disk, synchronously, and a request per event would be a round trip to
  // learn a string the selection's own answer already carried.
  lockfile(): string | null;
  // adoptDefault asks the server what this workspace points at and takes that
  // as the selection. The answer is the starting point, and an explicit
  // selection afterwards replaces it.
  adoptDefault(): Promise<void>;
  // restore takes the selection remembered for this editor window, having
  // re-verified that the workspace still offers it, and falls back to the
  // workspace's own default where it does not. This is what a connection runs;
  // adoptDefault is the fallback inside it.
  //
  // The re-verification is the point. A remembered value that no longer
  // resolves fails on first use, at a moment the reader cannot connect to a
  // choice made in a previous session — so it is checked against what the
  // workspace currently offers, and a value that has gone is dropped and said
  // to have been dropped. A silent fallback would be indistinguishable from the
  // selection never having been remembered at all.
  restore(): Promise<void>;
  // choose prompts the reader for a Release and selects it. Returns the
  // workspace-relative selection, or null when nothing was chosen. A choice is
  // remembered for this editor window.
  choose(placeHolder?: string): Promise<string | null>;
  // forget drops the selection in force, so the next connection resolves it
  // again rather than carrying the previous workspace's answer forward. What
  // the reader chose stays remembered: a connection ending says nothing about
  // whether the choice was wrong, and re-verification on the next one is what
  // decides that.
  forget(): void;
  // onChange registers a listener fired whenever the selection changes.
  onChange(listener: () => void): void;
  // onMove registers a listener fired once each time the Release in force —
  // what current() answers — becomes a different one: a Release taken where none
  // was, one replaced by another, or none left where one was. It is handed the
  // Release now in force, or null.
  //
  // It is narrower than onChange on purpose, and that is what it is for. A
  // surface whose content is the language server's answer in the selected
  // Release's terms must ask again when that Release moves and at no other time:
  // the same Release chosen again, or an enumeration that changed only what is on
  // offer, moves nothing the answer depends on, and a second request would redraw
  // a surface with the answer it already shows.
  onMove(listener: (release: string | null) => void): void;
}

// OfferedRelease is one Release an answer named: the workspace-relative form a
// request carries, the absolute path the answer used, and the lockfile the same
// answer named for it, or null where it named none.
interface OfferedRelease {
  release: string;
  absolute: string;
  lockfile: string | null;
}

// createReleaseSelection builds the selection over the supplied dependencies.
export function createReleaseSelection(deps: ReleaseSelectionDeps): ReleaseSelection {
  let state: SelectionState = { kind: 'unknown' };
  // offerable is how many Releases the last enumeration could name, or null
  // where none has produced an answer. It is held beside the selection rather
  // than derived on demand because the surfaces that read it compose
  // synchronously: a count they had to go and ask for would not have arrived by
  // the time they are drawn.
  let offerable: number | null = null;
  // lockfile is the selected Release's lockfile as the answer that named the
  // selection carried it, or null.
  let lockfile: string | null = null;
  const listeners: Array<() => void> = [];
  const moveListeners: Array<(release: string | null) => void> = [];
  // inForce is the Release the move listeners were last told of, so a move is
  // told once and an announcement that moved nothing is told to none of them.
  let inForce: string | null = null;

  const announce = (): void => {
    for (const listener of listeners) {
      listener();
    }
    const now = state.kind === 'selected' ? state.release : null;
    if (now === inForce) { return; }
    inForce = now;
    for (const listener of moveListeners) {
      listener(now);
    }
  };

  // setState moves the selection to a state in which nothing is selected, and
  // select moves it to a Release. The lockfile moves in the same act as the
  // state, and only select can give it a value, so it never describes a Release
  // other than the one selected.
  const setState = (next: Exclude<SelectionState, { kind: 'selected' }>): void => {
    state = next;
    lockfile = null;
    announce();
  };

  const select = (entry: OfferedRelease): void => {
    state = { kind: 'selected', release: entry.release, absolute: entry.absolute };
    lockfile = entry.lockfile;
    announce();
  };

  // setOfferable records what an enumeration found and tells the surfaces.
  //
  // It announces on its own rather than relying on the selection changing,
  // because the two move independently: a reader who opens the chooser and then
  // dismisses it has changed no selection, and the enumeration that opening it
  // performed is exactly the answer the surfaces were missing.
  const setOfferable = (next: number | null): void => {
    if (offerable === next) { return; }
    offerable = next;
    announce();
  };

  // gatherOfferable partitions what the server reports into the Releases this
  // editor can name in a request and the ones it cannot.
  //
  // The partition is made by the acceptance rule itself, against the root the
  // server resolved, so a Release lands in `offerable` exactly when the request
  // derived from it would be accepted. With both sides reading the same root
  // nothing is dropped, and that is the ordinary outcome rather than a
  // coincidence — the server enumerates over the root it resolves against. What
  // remains is the state where it has named no root at all, and there the
  // editor can derive no parameter for anything, so everything is dropped and
  // the reader is told rather than shown an empty list.
  const gatherOfferable = async (): Promise<{
    offerable: OfferedRelease[];
    dropped: string[];
    root: string | null;
    unreadLinkedDirs: string[];
  }> => {
    const answer = await deps.listReleases();
    // The published shape admits null for a workspace holding no Release, and it
    // is read as none. The lockfiles are keyed by each candidate exactly as it is
    // listed; an answer carrying no map names no lockfile for any of them, and
    // none is then followed. The linked directories the server did not search are
    // named relative to its root, in the order its walk met them; an answer
    // carrying no list names none.
    const candidates = answer.releases ?? [];
    const lockfiles: Record<string, string> = answer.lockfiles ?? {};
    const unreadLinkedDirs = answer.unreadLinkedDirs ?? [];
    const root = deps.getDaemonWorkspaceRoot();
    if (root === null) {
      // Nothing can be converted, so this walk established no count. It is
      // recorded as unread rather than as none: a zero here would say the
      // workspace offers nothing, when what happened is that the editor had no
      // folder to name anything relative to.
      setOfferable(null);
      return { offerable: [], dropped: [...candidates], root: null, unreadLinkedDirs };
    }
    const named: OfferedRelease[] = [];
    const dropped: string[] = [];
    for (const absolute of candidates) {
      const release = releaseParamFor(root, absolute);
      if (release === null) {
        dropped.push(absolute);
        continue;
      }
      named.push({ release, absolute, lockfile: lockfiles[absolute] ?? null });
    }
    // What is recorded is what can be CHOSEN, not what was reported. A
    // candidate this editor cannot name in a request is one the chooser will
    // not offer, so counting it would promise a choice that is not there.
    setOfferable(named.length);
    return { offerable: named, dropped, root, unreadLinkedDirs };
  };

  // reportDropped names what could not be offered, with a count and where those
  // files sit. An empty list with no explanation is the failure this exists to
  // prevent: it leaves a reader unable to tell "there are none" from "there are
  // some I cannot offer you", and only the second is something to act on.
  const reportDropped = (dropped: string[], root: string | null): void => {
    if (dropped.length === 0) { return; }
    deps.reportInfo(describeDropped(dropped.length, root));
    for (const absolute of dropped) {
      deps.logLine(`[not offered] ${absolute}`);
    }
  };

  // reportUnreadLinkedDirs names the links the server did not follow, in a line
  // of its own. The editor's file tree follows such a link and shows the Releases
  // behind it, so without this line the chooser would offer fewer Releases than
  // the tree shows and say nothing about why.
  const reportUnreadLinkedDirs = (dirs: readonly string[]): void => {
    const line = describeUnreadLinkedDirs(dirs);
    if (line !== null) { deps.reportInfo(line); }
  };

  const adoptDefault = async (): Promise<void> => {
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
      const daemonRoot = deps.getDaemonWorkspaceRoot();
      const release = daemonRoot === null
        ? null
        : releaseParamFor(daemonRoot, answer.release);
      if (release === null) {
        // The default cannot be named in a request. Reporting it as selected
        // would put a value on every request that the server refuses, so the
        // state says nothing is selected and carries why.
        const reason = describeUnnameable(answer.release, daemonRoot);
        setState({ kind: 'none', reason });
        deps.logLine(`[no Release selected] ${reason}`);
        return;
      }
      select({ release, absolute: answer.release, lockfile: answer.lockfile ?? null });
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
  };

  return {
    state: () => state,

    offerableCount: () => offerable,

    current: () => (state.kind === 'selected' ? state.release : null),

    lockfile: () => lockfile,

    adoptDefault,

    restore: async (): Promise<void> => {
      const remembered = deps.store.read();
      if (remembered === null) {
        // There is nothing to re-verify, and the workspace is enumerated all
        // the same — because whether it offers any Release at all is a fact
        // the surfaces report from the first moment, and one nobody has asked
        // for on this path. Without it a reader who has chosen nothing is told
        // to choose, with no way for the editor to know there is anything to
        // choose from.
        //
        // It runs BEFORE the default is adopted so the announcement that
        // adopting makes carries both facts at once, rather than redrawing the
        // surfaces twice with the count half a step behind.
        try {
          await gatherOfferable();
        } catch {
          // The server is not answering. Nothing is known about what is on
          // offer, and adopting the default below will meet the same silence
          // and say so.
          setOfferable(null);
        }
        await adoptDefault();
        return;
      }
      let gathered;
      try {
        gathered = await gatherOfferable();
      } catch {
        setOfferable(null);
        // The candidates cannot be listed, so the remembered value cannot be
        // re-verified — and an unverified value must not become the selection.
        // It is left in the store rather than dropped: a server that is not
        // answering says nothing about whether the Release is still there, and
        // discarding the reader's choice on that evidence would lose it to a
        // restart.
        setState({ kind: 'unknown' });
        return;
      }
      const match = gathered.offerable.find(c => c.release === remembered);
      if (match) {
        select(match);
        return;
      }
      // Verified and gone. The value is dropped, the reader is told it was
      // dropped, and the workspace's own default takes over — which is what
      // they would have started on had they never chosen at all.
      deps.store.write(null);
      deps.reportInfo(
        `Aggrega: ${remembered} is no longer offered in this workspace, so the previous selection was dropped. Falling back to this workspace's default.`,
      );
      reportDropped(gathered.dropped, gathered.root);
      await adoptDefault();
    },

    choose: async (placeHolder?: string): Promise<string | null> => {
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.reportInfo(
          `Aggrega: no ${SELECTOR_ROW_LABELS.workspace} is in use, so there is no ${SELECTOR_ROW_LABELS.release} to select.`,
        );
        return null;
      }
      let gathered;
      try {
        gathered = await gatherOfferable();
      } catch {
        setOfferable(null);
        deps.reportError(
          'Aggrega: cannot list Releases — the language server is not running. Start it and try again.',
        );
        return null;
      }
      reportDropped(gathered.dropped, gathered.root);
      reportUnreadLinkedDirs(gathered.unreadLinkedDirs);
      if (gathered.offerable.length === 0) {
        // Only when nothing was dropped is this workspace genuinely empty of
        // Releases. Saying so when some were dropped would be the wrong
        // sentence, and it is the one a reader would act on.
        if (gathered.dropped.length === 0) {
          deps.reportInfo('Aggrega: no Release found in this workspace.');
        }
        return null;
      }
      // A sole candidate is still offered rather than taken silently. This is
      // the reader asking to change the selection, and answering a request to
      // choose by choosing for them leaves them unable to tell that the
      // command ran at all.
      const picked = await deps.pickRelease(
        gathered.offerable.map(c => c.absolute),
        placeHolder ?? 'Aggrega: choose the Release to work on',
      );
      if (!picked) { return null; }
      const chosen = gathered.offerable.find(c => c.absolute === picked);
      if (!chosen) { return null; }
      select(chosen);
      deps.store.write(chosen.release);
      return chosen.release;
    },

    forget: () => {
      // What was on offer is dropped with the selection and for the same
      // reason: it was read against the connection that is ending, and the
      // next one may resolve a different folder entirely. Assigned rather than
      // set through the helper because the state change below announces once
      // for both.
      offerable = null;
      setState({ kind: 'unknown' });
    },

    onChange: (listener: () => void): void => {
      listeners.push(listener);
    },

    onMove: (listener: (release: string | null) => void): void => {
      moveListeners.push(listener);
    },
  };
}

// describeDropped is the sentence a reader gets when the editor cannot offer
// Releases the server reported. It carries the count and where those files sit,
// which is what separates "there are none" from "there are some I cannot offer
// you".
function describeDropped(count: number, root: string | null): string {
  const noun = count === 1 ? 'Release' : 'Releases';
  if (root === null) {
    return `Aggrega: ${count} ${noun} cannot be offered — the language server has not reported which folder it anchored to, and a Release is named relative to that folder. Restart the language server to try again. The paths are in the Aggrega output channel.`;
  }
  const verb = count === 1 ? 'sits' : 'sit';
  return `Aggrega: ${count} ${noun} ${verb} outside the ${SELECTOR_ROW_LABELS.workspace} ${root} and cannot be offered, because a Release is named relative to it. The paths are in the Aggrega output channel.`;
}

// describeUnreadLinkedDirs is the line a reader gets when the language server
// met links inside the workspace leading to directories outside it, and did not
// search them, or null where it met none. Each link is named as the server named
// it — relative to the workspace root, in the order its walk met them — and the
// names close the line, so a path is never read as running into the words after
// it.
//
// It says why the Releases behind those links are absent rather than offering
// them: the workspace is what the language server reads, and a link leading out of
// it is not followed.
export function describeUnreadLinkedDirs(dirs: readonly string[]): string | null {
  if (dirs.length === 0) { return null; }
  const which = dirs.length === 1
    ? 'this link are not offered, because it leads'
    : 'these links are not offered, because each leads';
  return `Aggrega: Releases inside ${which} to a directory outside the ${SELECTOR_ROW_LABELS.workspace}: ${dirs.join(', ')}`;
}

// describeUnnameable explains why a Release this workspace points at could not
// be taken as the selection. Both branches name the Aggrega workspace, or its
// absence, because that is the fact the reader needs in order to act.
function describeUnnameable(release: string, root: string | null): string {
  if (root === null) {
    return `the language server has not reported which folder it anchored to, so ${release} cannot be named relative to it`;
  }
  return `${release} sits outside the ${SELECTOR_ROW_LABELS.workspace} ${root}, and a Release is named relative to it`;
}

// describeSelection renders the selection for the two surfaces that display it,
// and the longer explanation both hang off it. Kept apart from the editor so the
// text a reader sees is directly testable.
//
// label and value are two renderings of one state rather than two states, and
// they are computed together so they cannot come to disagree. label is the
// compact form for a surface with a single line and no room to name the field
// it is showing, so it carries the word Release itself. value is for a surface
// that already names the field beside it and has room for a path, so it carries
// the value alone.
//
// 🔴 IT TAKES WHAT IS ON OFFER BECAUSE "NOTHING IS SELECTED" AND "THERE IS
// NOTHING TO SELECT" ARE DIFFERENT STATES A READER ACTS ON DIFFERENTLY. Telling
// someone to choose a Release in a workspace that offers none sends them to a
// control whose only possible answer is an empty list, and the press that
// discovers this is one they have to make to find out. So the empty reading
// carries the way OUT of the state instead of an instruction to act inside it:
// a Release is reached by working in a different Aggrega workspace, or by
// making one here.
//
// offerable is null where no enumeration has produced an answer, and that is a
// third statement rather than a spelling of none — nobody has looked. It is
// reported as what it is and never guessed at in either direction.
//
// The count tells the empty readings apart and does nothing else: the
// explanation says nothing about how many Releases there are to choose
// between, so it stays short enough to read, and the chooser a click opens
// lists them, one or several.
export function describeSelection(
  state: SelectionState,
  offerable: number | null,
): { label: string; value: string; detail: string } {
  switch (state.kind) {
    case 'selected':
      return {
        label: path.basename(state.absolute),
        value: state.release,
        // The closing line stands apart behind a blank line: it is the one line
        // that says what a click does rather than what is selected.
        detail: `Aggrega selected Release: ${state.absolute}\n\nClick to choose a different ${SELECTOR_ROW_LABELS.release}.`,
      };
    case 'none': {
      // The server's own account of why it named no default travels with the
      // state, and it is carried into every reading below: it is the only text
      // that says which of several reasons applied.
      const because = state.reason ? ` ${state.reason}` : '';
      if (offerable === 0) {
        return {
          label: `${SELECTOR_ROW_LABELS.release}: none available`,
          value: 'none available',
          detail:
            `Aggrega: no ${SELECTOR_ROW_LABELS.release} is available in this ${SELECTOR_ROW_LABELS.workspace}.${because}\n`
            + `Work in a different ${SELECTOR_ROW_LABELS.workspace}, or create a ${SELECTOR_ROW_LABELS.release}.`,
        };
      }
      if (offerable === null) {
        return {
          label: `${SELECTOR_ROW_LABELS.release}: none selected`,
          value: 'none selected',
          detail:
            `Aggrega: no ${SELECTOR_ROW_LABELS.release} is selected.${because}\n`
            + `What this ${SELECTOR_ROW_LABELS.workspace} offers has not been read.\n`
            + 'Click to read it and select one.',
        };
      }
      return {
        label: `${SELECTOR_ROW_LABELS.release}: none selected`,
        value: 'none selected',
        detail: `Aggrega: no ${SELECTOR_ROW_LABELS.release} is selected.${because}\nClick to select one.`,
      };
    }
    case 'unknown':
      // What was on offer is not reported here even where a count survives from
      // moments ago: with the server silent, what the reader can act on is the
      // server, and a count would invite a choice nothing can currently answer.
      return {
        label: `${SELECTOR_ROW_LABELS.release}: unavailable`,
        value: 'unavailable',
        detail:
          'Aggrega: the language server is not running, so which Release is selected is unknown.',
      };
  }
}
