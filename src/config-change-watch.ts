// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';
import type { TimerLike } from './binary-restart';
import { describeError } from './error-text';

// What a change to a configuration file means while a language server is
// running, decided without an editor.
//
// The language server resolves the workspace's configuration once, when it
// starts, and answers every request after that under the configuration as it was
// then. The command line has no such gap, because each invocation is a new
// process that resolves afresh. So a change to a file the running server read is
// a change the editor goes on ignoring until the server is started again, and
// this module is what notices it and says so.
//
// 🔴 THE FILES WATCHED ARE THE FILES THE RUNNING SERVER SAYS IT READ, AND NO
// OTHERS. The set comes from the server's own report of the layers that
// contributed to its configuration, re-read every time a server becomes
// answerable. A list of candidate paths composed here — the global file, each
// directory's file from the root down — would be a second copy of the resolver's
// cascade, and it would agree with the resolver until the day one of them moved.
// The consequence is a stated bound rather than a gap: a file that did not exist
// when the server started contributed nothing, so it is not in the report, it is
// not watched, and creating one raises nothing. The next start reads it.
//
// 🔴 A WRITE THE EXTENSION ITSELF ASKED FOR RAISES NO WARNING, IN WHICHEVER ORDER
// ITS PIECES ARRIVE. The reader asked for that change, so it is applied by
// restarting the server instead of by asking them to confirm a restart. The
// answer to the write and the editor's report of the file changing arrive in
// either order, and the report can even arrive after the restart has re-armed the
// watch. Two facts cover every order: a pending mark taken before the write is
// sent and held until the restarted server's watch is in place, during which a
// change is deferred rather than judged; and a baseline of each watched file,
// read when the watch is armed, so a report whose content equals what the running
// server read is no change at all.

// watchedConfigurationFiles returns the reported layers that name a file, in the
// order the server reported them and each once.
//
// A configuration file is reported as its absolute path, an environment
// variable as its name behind an `env:` prefix, and a command-line flag as it was
// typed. Only the file is absolute, so the test is "absolute path" rather than a
// list of the shapes that are not files — a new non-file shape is then excluded
// without this having to learn its spelling. The one file the test leaves out is
// a global configuration named by a relative `AGGREGA_CONFIG`, which is reported
// relative to the server's own working directory; it goes unwatched, like a file
// that did not exist when the server started. Anything that is not a string is
// not a layer and is skipped.
export function watchedConfigurationFiles(layers: unknown): string[] {
  if (!Array.isArray(layers)) { return []; }
  const files: string[] = [];
  for (const entry of layers) {
    if (typeof entry !== 'string') { continue; }
    if (!path.isAbsolute(entry)) { continue; }
    if (!files.includes(entry)) { files.push(entry); }
  }
  return files;
}

// writtenFile reads the file a configuration write landed in off its answer's
// scope, or null where the answer names none.
//
// It is read off the answer rather than off the request, because the file a
// write lands in is resolved by the compiler and not by the surface that asked.
export function writtenFile(scope: { configFile?: string } | null | undefined): string | null {
  const file = scope?.configFile;
  return typeof file === 'string' && file !== '' ? file : null;
}

// AppliedWrite is a configuration write's own answer together with whether the
// language server running once the write is over has read what it wrote.
//
// 🔴 inEffect IS DECIDED WHERE THE RESTART IS DECIDED, AND NOWHERE ELSE. The
// surface that raises the write's ending reads it rather than working out for
// itself whether a restart ran or worked: a second reading of that question would
// agree with the watch until the day one of the two moved, and the sentence it
// governs would then tell a reader a change is in force that the server never
// read.
export interface AppliedWrite<T> {
  answer: T;
  inEffect: boolean;
}

// ConfigurationWriter is how a surface that writes a configuration file itself
// hands the write to the watch, so the write is followed by the restart and
// raises no warning. written reports the file the write landed in, or null where
// it wrote nothing.
export type ConfigurationWriter = <T>(
  write: () => Promise<T>,
  written: (result: T) => string | null,
) => Promise<AppliedWrite<T>>;

// configurationChangedWarning is what the reader is told when a file the running
// server read has changed on disk: which file, and why the change is not yet in
// force. The action beside it is the restart.
export function configurationChangedWarning(file: string): string {
  return `Aggrega: ${file} changed. The language server reads its configuration when it starts, `
    + 'so restart it to pick up the change.';
}

// ownWriteRestartTitle is what the reader sees while the server is restarted
// after a write the extension made, and ownWriteRestartLine is what the output
// channel keeps once it has.
//
// The restart says what it is doing once, while it does it, and not again when it
// is done: the operation that wrote the file already ends in its own sentence
// naming that file, and a second notification for one act is a notification a
// reader learns to dismiss unread.
export function ownWriteRestartTitle(file: string): string {
  return `Aggrega: restarting the language server so it reads ${file}`;
}

export function ownWriteRestartLine(file: string): string {
  return `restarted the language server so it reads ${file}, which the change just made wrote.`;
}

// IN_EFFECT_SENTENCE is what the ending of a configuration write the extension
// made says once the language server running afterwards has read that write.
//
// It is one sentence added to the ending the operation already raises, never a
// notification of its own: the reader asked for one change and is told about it
// once, and the restart that put it in force has already said what it was doing
// while it did it. Where the restart failed, or nothing was running to restart,
// the sentence is not said, because the change is then on disk and not in force.
export const IN_EFFECT_SENTENCE = 'The change is now in effect: the running language server has read it.';

// endingInEffect is the ending of a configuration write, with the sentence above
// added where the write is in effect and nothing added where it is not.
//
// An ending can close on the compiler's own words, which do not always end a
// sentence — a reason carried verbatim from a registry's answer, say — so the
// ending is closed with a full stop before the sentence is added where it does
// not already end in one. Nothing else in the ending is touched.
export function endingInEffect(detail: string, inEffect: boolean): string {
  if (!inEffect) { return detail; }
  const closed = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  return `${closed} ${IN_EFFECT_SENTENCE}`;
}

// watchingLine and deferredChangeLine are what the output channel is told about
// the watch itself, which is where a reader looks when a warning they expected
// did not come: which files are watched, and a change that was held back because
// the extension was writing configuration at the time.
export function watchingLine(files: readonly string[]): string {
  return files.length === 0
    ? 'the language server read no configuration file, so no configuration change is watched for.'
    : `watching the configuration files the language server read: ${files.join(', ')}.`;
}

export function deferredChangeLine(file: string): string {
  return `${file} changed while the extension was writing configuration; `
    + 'the change is judged once the language server has read that write.';
}

// ConfigurationWatchDeps is everything the watch reaches outside itself. Each is
// passed in so a test drives every order of events with no editor and no server.
export interface ConfigurationWatchDeps {
  // readLayers asks the running server which configuration layers contributed.
  readLayers(): Promise<unknown>;
  // watchFile reports every change, deletion and re-creation of one file.
  watchFile(file: string, onEvent: () => void): { dispose(): void };
  // readContent reads a watched file as it stands, or null where it is absent.
  readContent(file: string): Promise<string | null>;
  // warn raises the warning for one file and resolves once it is closed,
  // whichever way the reader closed it. Its action is the editor's to run.
  warn(file: string): Promise<void>;
  // restartForWrite replaces the running server after a write the extension
  // made, naming the file that write landed in, and answers whether a server is
  // running afterwards — which is whether the restart put the write in force.
  restartForWrite(file: string): Promise<boolean>;
  // isServerRunning reports whether a server is answering right now.
  isServerRunning(): boolean;
  timer: Pick<TimerLike, 'setTimeout' | 'clearTimeout'>;
  // settleMs is how long a file must go unchanged before its change is judged,
  // which is what collapses the several writes of one save into one warning.
  settleMs(): number;
  log(line: string): void;
}

// ConfigurationWatch is the watch itself.
export interface ConfigurationWatch {
  // reload re-reads the running server's layers and re-arms the watch over the
  // files they name. It is called each time a server becomes answerable, so a
  // server that loaded a different set is watched over the new one.
  reload(): Promise<void>;
  // disarm stops watching, for a server that was taken down deliberately.
  disarm(): void;
  // ownWrite runs a configuration write the extension is making, then restarts
  // the server so it reads what was written — unless a server started after the
  // write began, which has read it already. No warning is raised for it. It
  // answers the write's own answer and whether the server running afterwards has
  // read the write.
  ownWrite: ConfigurationWriter;
  // watched is the set armed now, in the order the server reported it.
  watched(): string[];
  // idle resolves once every judgement already due has been made.
  idle(): Promise<void>;
}

interface WatchedFile {
  // baseline is the content the watch was armed over: what the running server
  // read, as near as the editor can observe it.
  baseline: string | null;
  // lastSeen is the content last judged, so a report that changes nothing — a
  // save of identical bytes, the tail of a burst — is not a change.
  lastSeen: string | null;
  // open records a warning on screen for this file, so a further change is not
  // raised again until that one is closed.
  open: boolean;
}

// createConfigurationWatch builds the watch over the supplied dependencies.
export function createConfigurationWatch(deps: ConfigurationWatchDeps): ConfigurationWatch {
  // generation identifies the armed set. Everything scheduled against an older
  // one is dropped when it comes due, so a report about a set the watch has since
  // replaced changes nothing.
  let generation = 0;
  // reloads counts the re-arms begun, which is how an own write learns that a
  // server started after it began — one that has therefore read what it wrote.
  let reloads = 0;
  let files = new Map<string, WatchedFile>();
  let watchers: Array<{ dispose(): void }> = [];
  const timers = new Map<string, unknown>();
  let pendingWrites = 0;
  const deferred = new Set<string>();

  // Every judgement and every re-arm runs through one chain, so no two of them
  // interleave around a read of the disk and each sees the state the one before
  // it left.
  let chain: Promise<void> = Promise.resolve();
  let loading: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    chain = chain.then(task).catch((err: unknown) => {
      deps.log(`the configuration files could not be watched: ${describeError(err)}`);
    });
    return chain;
  };

  const clearTimers = (): void => {
    for (const handle of timers.values()) { deps.timer.clearTimeout(handle); }
    timers.clear();
  };

  const dropWatchers = (): void => {
    for (const watcher of watchers) { watcher.dispose(); }
    watchers = [];
    clearTimers();
  };

  const judge = async (file: string, armed: number): Promise<void> => {
    if (armed !== generation) { return; }
    const entry = files.get(file);
    if (!entry) { return; }
    if (pendingWrites > 0) { deferred.add(file); return; }
    if (!deps.isServerRunning()) { return; }
    const content = await deps.readContent(file);
    if (armed !== generation) { return; }
    // A write of the extension's own may have begun while the disk was read, and
    // what was read may already be it.
    if (pendingWrites > 0) { deferred.add(file); return; }
    if (content === entry.lastSeen) { return; }
    entry.lastSeen = content;
    if (content === entry.baseline || entry.open) { return; }
    entry.open = true;
    void deps.warn(file).then(() => {
      if (armed === generation) { entry.open = false; }
    });
  };

  const onEvent = (file: string, armed: number): void => {
    if (armed !== generation) { return; }
    if (pendingWrites > 0) { deps.log(deferredChangeLine(file)); }
    const previous = timers.get(file);
    if (previous !== undefined) { deps.timer.clearTimeout(previous); }
    timers.set(file, deps.timer.setTimeout(() => {
      timers.delete(file);
      void enqueue(() => judge(file, armed));
    }, deps.settleMs()));
  };

  const reload = (): Promise<void> => {
    generation += 1;
    reloads += 1;
    const armed = generation;
    loading = enqueue(async () => {
      if (armed !== generation) { return; }
      dropWatchers();
      files = new Map();
      const layers = await deps.readLayers();
      if (armed !== generation) { return; }
      const next = new Map<string, WatchedFile>();
      for (const file of watchedConfigurationFiles(layers)) {
        const baseline = await deps.readContent(file);
        next.set(file, { baseline, lastSeen: baseline, open: false });
      }
      if (armed !== generation) { return; }
      files = next;
      for (const file of next.keys()) {
        watchers.push(deps.watchFile(file, () => onEvent(file, armed)));
      }
      deps.log(watchingLine([...next.keys()]));
    });
    return loading;
  };

  const disarm = (): void => {
    generation += 1;
    dropWatchers();
    files = new Map();
    deferred.clear();
  };

  const ownWrite = async <T>(
    write: () => Promise<T>,
    written: (result: T) => string | null,
  ): Promise<AppliedWrite<T>> => {
    pendingWrites += 1;
    const reloadsBefore = reloads;
    try {
      const result = await write();
      const file = written(result);
      let inEffect = false;
      if (file !== null) {
        if (reloads !== reloadsBefore) {
          // A server that started after the write began has read it already, and
          // restarting it again would be a second restart for one change. Any
          // server running now started no earlier than that one.
          inEffect = deps.isServerRunning();
        } else if (deps.isServerRunning()) {
          inEffect = await deps.restartForWrite(file);
        }
        await loading;
      }
      return { answer: result, inEffect };
    } finally {
      pendingWrites -= 1;
      if (pendingWrites === 0) {
        // What arrived while the write was pending is judged now, against the
        // baselines in force: a re-armed watch's where the server was restarted,
        // so the write itself reads as no change, and the old ones where nothing
        // was restarted, so a change nobody applied is still reported.
        const due = [...deferred];
        deferred.clear();
        const armed = generation;
        for (const file of due) { void enqueue(() => judge(file, armed)); }
      }
    }
  };

  return {
    reload,
    disarm,
    ownWrite,
    watched: () => [...files.keys()],
    idle: () => chain,
  };
}
