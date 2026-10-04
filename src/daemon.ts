// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  RequestId,
  RequestMethod,
  ServerEncoding,
  ServerInitMetadata,
} from './types';
import { Settings } from './settings';
import { extractServerInitMetadata } from './init-metadata';
import { CancellationSignal, OperationCancelled } from './cancellation';
import { DaemonState } from './daemon-state';
import { StartFailure, startFailureReason, startFailureWords } from './start-failure';

// buildServeArgs assembles the argv for `aggrega serve` from the
// effective settings. The --build-on-inspect flag is appended only when
// buildOnInspect is true; left off, the daemon applies its own default
// (the build's analysis is not run while inspecting a graph), which is
// also what the serve.build_on_inspect config key sets.
export function buildServeArgs(settings: Settings): string[] {
  const args = ['serve'];
  if (settings.buildOnInspect) {
    args.push('--build-on-inspect');
  }
  return args;
}

// frameMessage encodes one JSON-RPC body for the wire: the JSON payload behind
// the Content-Length header the daemon reads.
//
// It is the single home for that encoding. Three messages leave this client — a
// request, the shutdown notification, and the cancel notification — and all
// three are framed here rather than each composing the header for itself.
// Copies of a wire format agree until one of them is changed, and the ones that
// were not changed keep compiling; expressing it once means a change to the
// framing is a change to the framing everywhere.
//
// It is exported so a test can read back exactly the bytes a send produces,
// which is what makes a claim about what reached the compiler assertable
// without a compiler.
export function frameMessage(body: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, payload]);
}

// isNotification distinguishes JSON-RPC 2.0 server-push
// notifications (no id field) from responses (id present). The
// daemon emits aggrega/publishDiagnostics as a notification when
// diagnostic state changes; the dispatcher routes by method via
// the Daemon class's EventEmitter.
function isNotification(msg: JsonRpcResponse | JsonRpcNotification): msg is JsonRpcNotification {
  return !('id' in msg) || (msg as { id?: unknown }).id === undefined;
}

// DaemonState is declared in its own module, and offered here too because this is
// where every consumer of the client already imports from.
export { DaemonState };

// INITIALIZE_TIMEOUT_MS bounds the wait for aggrega/initialize. A
// daemon that misses the window is treated as deadlocked. The budget is
// generous because a legitimately slow first response (a large workspace,
// a cold cache) is not a deadlock and must not be mistaken for one.
const INITIALIZE_TIMEOUT_MS = 30000;

// SHUTDOWN_DRAIN_GRACE_MS bounds how long stop() waits after the FIRST
// aggrega/shutdown (drain) before escalating. The first shutdown stops
// the daemon accepting new work and lets in-flight work finish; the
// daemon then exits on its own. A daemon with no in-flight work exits
// almost immediately.
//
// Exported because a caller that wants to know whether a workload is long
// enough to outlast the drain would otherwise carry its own copy of this
// number, and a copy agrees until this one is retuned.
export const SHUTDOWN_DRAIN_GRACE_MS = 3000;

// SHUTDOWN_ABORT_GRACE_MS bounds the wait after the SECOND aggrega/shutdown
// (abort) before escalating to SIGTERM. The abort cancels in-flight work,
// which returns at its next phase boundary within the daemon's own drain
// budget; this grace covers that budget plus a margin.
const SHUTDOWN_ABORT_GRACE_MS = 2500;

// SIGTERM_GRACE_MS bounds the wait between SIGTERM and SIGKILL. Total
// stop() worst case: DRAIN + ABORT + SIGTERM + SIGKILL ≈ 3 + 2.5 + 2 =
// 7.5 seconds, reached only when the daemon ignores both shutdowns.
const SIGTERM_GRACE_MS = 2000;

// STARTUP_QUEUE_LIMIT caps the requests queued while the subprocess
// is starting. Excess requests fail with a queue-overflow error.
const STARTUP_QUEUE_LIMIT = 100;

// ShutdownNarration is what terminateSubprocess reports as it walks the
// graceful-then-forced ladder: one line for each request it makes of the daemon
// and one for each way the daemon can leave. A reader watching a slow shutdown
// sees which step is taking the time and whether the daemon answered at all.
//
// It is the single home for those lines, and it is exported for the same reason
// frameMessage is: a caller that wants to know which step a shutdown reached
// would otherwise match against its own copy of the wording, and a copy keeps
// matching nothing quietly once the wording changes. Reading the step back is
// what makes a claim about how a daemon stopped assertable without timing it.
export const ShutdownNarration = {
  // The first request: stop accepting work, finish what is in flight, exit.
  cooperativeRequest: 'asking the daemon to exit cooperatively',
  // The daemon answered that first request within its grace window.
  cooperativeExit: 'the daemon exited cooperatively',
  // The grace window closed with the daemon still working, so it is asked
  // again — this time to give up the work rather than finish it.
  abandonRequest: 'the daemon is still working; asking it to abandon in-flight work',
  // The daemon answered the second request.
  abandonedExit: 'the daemon exited after abandoning in-flight work',
  // No cooperative answer is coming, or none was asked for: the process is
  // taken down by the operating system instead.
  osTermination: 'the daemon is still running; terminating it at the operating-system level',
  // Even that was not honored within its grace window.
  forcedTermination: 'the daemon did not stop; forcing termination',
} as const;

// RespawnNarration is what the client writes to the output channel while it
// supervises a language server that ended without being asked to: that it
// ended and how, each restart and where it stands against the bound, a restart
// that did not come up and why, and that the server is left stopped once the
// bound is spent. A reader looking at the channel after a crash reads what
// happened in these words, and the notification raised at the end is the only
// other thing they are shown.
//
// It is the single home for those lines, exported for the reason
// ShutdownNarration is: a test reads the sequence back against these words
// rather than against a copy of them.
export const RespawnNarration = {
  // The server ended while nothing had asked it to.
  ended: (code: number | null, signal: NodeJS.Signals | null): string =>
    `the language server stopped unexpectedly: ${exitWords(code, signal)}`,
  // It is started again; `made` counts this restart among those made within
  // the window.
  restarting: (made: number, limit: number, windowSeconds: number): string =>
    `starting the language server again: restart ${made} of ${limit} allowed within ${windowSeconds} seconds`,
  // A server started again ended, or failed, before it answered.
  restartFailed: (reason: string): string =>
    `the language server started again did not come up: ${reason}`,
  // The bound is spent, so nothing starts the server again by itself.
  boundSpent: (limit: number, windowSeconds: number): string =>
    `not starting the language server again: it has been started again ${limit} ${limit === 1 ? 'time' : 'times'} within ${windowSeconds} seconds, as many as aggrega.server.respawnAttempts allows`,
} as const;

// StartNarration is what the client writes to the output channel when an attempt
// to start a language server fails — the first start, a restart, or a restart
// after an unexpected exit alike, since all three are the one attempt below. It
// says what is wrong in the words the notification for the same failure uses,
// so the channel and the notification can be read against each other.
//
// It is the single home for that line, exported for the reason the narrations
// above are.
export const StartNarration = {
  failed: (failure: StartFailure): string =>
    `the language server did not start: ${startFailureReason(failure)}`,
} as const;

// exitWords says how a subprocess ended, in the terms the operating system
// reported it.
function exitWords(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) { return `it was ended by ${signal}`; }
  if (code !== null) { return `it exited with code ${code}`; }
  return 'it exited';
}

// RespawnTracker counts the respawns made within a sliding window and reports
// whether one more is permitted. A respawn is recorded when it is made, and the
// limit is tested before making it, so a limit of N permits N respawns within
// the window — which is what the respawn setting states.
export class RespawnTracker {
  private attempts: number[] = [];

  constructor(
    private readonly attemptLimit: number,
    private readonly windowMs: number,
  ) {}

  // shouldRespawn returns true when the count of attempts inside
  // the sliding window is below the configured limit.
  shouldRespawn(now: number = Date.now()): boolean {
    this.prune(now);
    return this.attempts.length < this.attemptLimit;
  }

  recordAttempt(now: number = Date.now()): void {
    this.prune(now);
    this.attempts.push(now);
  }

  reset(): void {
    this.attempts = [];
  }

  // attemptCount exposes the current count within the window for
  // tests and diagnostics.
  attemptCount(now: number = Date.now()): number {
    this.prune(now);
    return this.attempts.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.attempts = this.attempts.filter(t => t > cutoff);
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: JsonRpcError | Error) => void;
}

interface QueuedRequest {
  method: RequestMethod;
  params: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: JsonRpcError | Error) => void;
  // signal travels with the queued call so a request stopped while the daemon
  // was still starting is stopped, and one that survives to dispatch keeps the
  // ability to be stopped afterwards.
  signal?: CancellationSignal;
  // queuedSubscription unregisters the while-queued cancel listener. The
  // drained request registers its own against the id it is finally given, so
  // this one is released at drain rather than left to fire against a queue the
  // entry has left.
  queuedSubscription?: { dispose(): void };
}

// DaemonEvents documents the events emitted by Daemon.
export interface DaemonEvents {
  stateChange: (next: DaemonState, prev: DaemonState) => void;
  // Raised once the respawn bound is spent: the server has ended unasked after
  // as many respawns within the window as the bound allows, so nothing starts
  // it again by itself.
  stoppedResponding: () => void;
  // Raised for every end nobody asked for, whether the server was running or
  // still in its handshake.
  unexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

// Daemon owns one aggrega serve subprocess. The class is event-
// emitting; consumers subscribe to stateChange / stoppedResponding
// / unexpectedExit for lifecycle observation.
export class Daemon extends EventEmitter {
  private state: DaemonState = DaemonState.Stopped;
  private proc: ChildProcessWithoutNullStreams | null = null;
  // Keyed by the published identifier type rather than by number. Every id this
  // client allocates is a number, but an answer carries back whatever the
  // request named, and the protocol admits a string there — so keying on the
  // published type is what keeps the lookup honest about what may arrive.
  private pending = new Map<RequestId, PendingRequest>();
  private startupQueue: QueuedRequest[] = [];
  private nextId = 1;
  private serverEncoding: ServerEncoding = 'utf-16';
  private serverInitMetadata: ServerInitMetadata | null = null;
  // What the running process has written that does not yet make a whole message.
  // attach says why it belongs to that one process and no other.
  private readBuffer = Buffer.alloc(0);
  private respawnTracker: RespawnTracker;
  private workspaceRoot: string | null = null;
  // The compiler the running subprocess was started from, recorded at the spawn
  // rather than read from the settings on demand. getLaunchedBinaryPath says why
  // those are not the same value.
  private launchedBinaryPath: string | null = null;
  // The most recent attempt to start a subprocess, where it ended in failure:
  // what it failed with and the path it tried. lastStartFailed says what it
  // covers and when it moves.
  private startFailure: StartFailure | null = null;
  // generation advances with every stop and restart asked of this client. An
  // attempt to start, and a run of automatic restarts, each remember the
  // generation they began in, and one that ends after it has moved was
  // superseded by the act that moved it: that act owns the teardown and the
  // position that follows, so the superseded work counts and reports nothing.
  private generation = 0;

  constructor(
    private settings: Settings,
    private readonly log: (msg: string) => void = () => undefined,
  ) {
    super();
    this.respawnTracker = new RespawnTracker(
      settings.respawnAttempts,
      settings.respawnWindowSeconds * 1000,
    );
  }

  getState(): DaemonState { return this.state; }
  getServerEncoding(): ServerEncoding { return this.serverEncoding; }

  // getLaunchedBinaryPath returns the compiler the running subprocess was
  // started from, or null where there is no running subprocess to report on.
  //
  // The answer is gated on the subprocess rather than on the recorded path
  // alone, so a daemon that has stopped reports nothing rather than reporting
  // the binary it used to run — a surface asking what is in use must not be
  // handed the answer to what WAS.
  //
  // 🔴 IT IS NOT THE CONFIGURED PATH, AND THE TWO GENUINELY DIVERGE. The
  // configured path is read once, at the moment a subprocess is created;
  // afterwards the preference can move while this subprocess goes on running the
  // binary it was started from. A preference change only SCHEDULES a restart,
  // over a grace window the reader may cancel outright — so between the change
  // and a restart that may never happen, the configured path names a compiler
  // nothing is running. Anything reporting on the compiler in use therefore asks
  // this rather than the settings, or it reports on a binary that is not serving
  // the reader's requests.
  getLaunchedBinaryPath(): string | null {
    return this.proc === null ? null : this.launchedBinaryPath;
  }

  // lastStartFailed reports whether this client's most recent attempt to start a
  // subprocess ended in failure.
  //
  // 🔴 IT IS RECORDED HERE, WHERE EVERY ATTEMPT IS MADE, RATHER THAN WHERE A
  // CALLER CATCHES ONE. A start is attempted from three places — the first
  // start, a restart, and the respawn after an unexpected exit — and all three
  // run the one spawn-and-handshake below. The respawn's failure is caught inside
  // this class, where it leads to another respawn or to the stopped-responding
  // event, so a record kept by the callers that catch would miss exactly the
  // attempt no caller hears about.
  //
  // It is cleared when an attempt begins rather than when one succeeds, so it
  // answers for the MOST RECENT attempt, and a server that reached Running
  // cleared it on the way there. An attempt abandoned by a deliberate stop or
  // restart did not fail and is not recorded as having failed. It is set before
  // the state leaves Starting, so a listener told of the next position already
  // reads it.
  lastStartFailed(): boolean {
    return this.startFailure !== null;
  }

  // lastStartFailure is that failure itself — what the attempt failed with and
  // the path it tried to start — or null where the most recent attempt did not
  // fail. It is recorded and cleared exactly when lastStartFailed moves, so a
  // surface saying why a server is not running says it about the same attempt
  // the welcome page says failed.
  lastStartFailure(): StartFailure | null {
    return this.startFailure;
  }

  // getServerInitMetadata returns the workspaceRoot + configSource
  // fields the daemon reported in its aggrega/initialize response, with
  // the optional ones it also reported, or null when the handshake has not
  // completed or the response omitted them.
  getServerInitMetadata(): ServerInitMetadata | null { return this.serverInitMetadata; }

  /**
   * Test-only factory that constructs a Daemon with an
   * externally-spawned subprocess already attached, bypassing the
   * usual start() + spawn() + initialize-handshake flow. Used by
   * tests that need to exercise the daemon's termination path
   * against a stub subprocess (which cannot satisfy the real
   * aggrega/initialize handshake).
   *
   * The factory transitions the daemon to Running via the normal
   * setState path so stateChange listeners fire as they would in
   * production. The subprocess is attached by the same attach() a
   * spawned one is, so its output is read, and its exit handled, as
   * a spawned subprocess's would be.
   *
   * The double-underscore prefix and @internal tag mark this as a
   * test seam; production callers MUST NOT invoke it. Project lint
   * rules may ban __-prefixed identifiers in non-test paths.
   *
   * @internal
   */
  static __forTesting(
    settings: Settings,
    proc: ChildProcessWithoutNullStreams,
  ): Daemon {
    const d = new Daemon(settings);
    d.attach(proc);
    d.setState(DaemonState.Running);
    return d;
  }

  async start(workspaceRoot: string): Promise<void> {
    if (this.state !== DaemonState.Stopped) {
      throw new Error(`cannot start: state is ${this.state}`);
    }
    this.workspaceRoot = workspaceRoot;
    await this.spawnAndInitialize();
  }

  async stop(): Promise<void> {
    this.generation++;
    if (this.state === DaemonState.Stopped) {
      return;
    }
    this.setState(DaemonState.Stopping);
    this.rejectPending(new Error('daemon shutting down'));
    await this.terminateSubprocess(/*cooperative=*/ true);
    this.setState(DaemonState.Stopped);
  }

  // restart replaces the subprocess with a fresh one. It is asked for, so the
  // end of the subprocess it replaces is not counted against the respawn bound,
  // and the count starts again from nothing.
  async restart(): Promise<void> {
    this.generation++;
    this.setState(DaemonState.Restarting);
    this.rejectPending(new Error('daemon restarted'));
    await this.terminateSubprocess();
    this.respawnTracker.reset();
    await this.spawnAndInitialize();
  }

  // request dispatches a JSON-RPC call. In Running the call dispatches
  // directly. In Starting it queues, because the server is on its way to
  // answering and the caller's question stays valid. In Stopped, Stopping and
  // Restarting it rejects: restarting is not a slower form of starting, since
  // the process the queued call would have been dispatched to is the one being
  // replaced, so the caller is told to ask again rather than left holding a
  // promise against a server that no longer exists.
  //
  // A caller that may need to stop the call passes a signal. Stopping is the
  // $/cancelRequest notification naming the id this call was sent under, and
  // that id never leaves this class: it is allocated here, held here, and
  // written back here. Surfacing it to the caller instead would put the wire
  // format in a second place and make a second send path the obvious next step,
  // and it is the send that has to be right — a caller that merely stopped
  // waiting would leave the compiler working.
  request<T>(method: RequestMethod, params: unknown, signal?: CancellationSignal): Promise<T> {
    params = this.withWorkspaceRoot(params);
    return new Promise<T>((resolve, reject) => {
      const wrappedResolve = (v: unknown) => resolve(v as T);
      const wrappedReject = (r: JsonRpcError | Error) => reject(r);
      // Already stopped before anything was sent — a reader can press cancel
      // while a picker ahead of the call is still open. Nothing is in flight,
      // so there is nothing to notify the compiler about.
      if (signal?.isCancellationRequested) {
        reject(new OperationCancelled(method));
        return;
      }
      switch (this.state) {
        case DaemonState.Stopped:
        case DaemonState.Stopping:
          reject(new Error(`daemon is ${this.state}`));
          return;
        case DaemonState.Starting: {
          if (this.startupQueue.length >= STARTUP_QUEUE_LIMIT) {
            reject(new Error('daemon startup queue overflow'));
            return;
          }
          const queued: QueuedRequest = {
            method,
            params,
            resolve: wrappedResolve,
            reject: wrappedReject,
            signal,
          };
          this.startupQueue.push(queued);
          // A call waiting on a starting daemon has no id yet, so there is no
          // notification to send: stopping it means never sending it. The
          // listener drops the entry from the queue, and does nothing when the
          // entry has already drained, because the dispatched call registers
          // its own listener against the id it was given.
          if (signal) {
            queued.queuedSubscription = signal.onCancellationRequested(() => {
              const at = this.startupQueue.indexOf(queued);
              if (at < 0) { return; }
              this.startupQueue.splice(at, 1);
              queued.queuedSubscription?.dispose();
              wrappedReject(new OperationCancelled(method));
            });
          }
          return;
        }
        case DaemonState.Restarting:
          reject(new Error('daemon is restarting; retry after restart completes'));
          return;
        case DaemonState.Running:
          this.dispatch(method, params, wrappedResolve, wrappedReject, signal);
          return;
      }
    });
  }

  // withWorkspaceRoot names the workspace every request acts on.
  //
  // The compiler holds no workspace: it answers each request against the one
  // that request names, so the workspace is a parameter and not something the
  // server remembers between calls. This is the single place it is added, which
  // is why no caller passes it — a per-call-site parameter is one every future
  // call site has to remember, and forgetting it is a refused request rather
  // than a wrong answer, but a refused request in an editor is still a broken
  // feature.
  //
  // It is added for every method rather than for a chosen subset, and that is
  // deliberate. A handful of methods answer from the compiled-in schema set and
  // read no workspace at all; a subset here would be this extension's own copy
  // of which those are, and such a copy agrees on the day it is written and
  // stops agreeing the day the set changes — silently, because the extra field
  // is simply not read. So the field always travels and the methods that do not
  // read it ignore it.
  //
  // A window with no folder open has no workspace to name, so nothing is added
  // and the request is refused naming the parameter. That is the honest outcome:
  // there is no workspace for the answer to be about.
  private withWorkspaceRoot(params: unknown): unknown {
    if (this.workspaceRoot === null) {
      return params;
    }
    if (params === undefined || params === null) {
      return { workspaceRoot: this.workspaceRoot };
    }
    if (typeof params !== 'object' || Array.isArray(params)) {
      // A caller sent something that is not a parameter object. Pass it through
      // untouched rather than reshaping it: the server's own refusal names what
      // it expected, which is a better report than one invented here.
      return params;
    }
    return { workspaceRoot: this.workspaceRoot, ...(params as Record<string, unknown>) };
  }

  updateSettings(next: Settings): void {
    this.settings = next;
    this.respawnTracker = new RespawnTracker(
      next.respawnAttempts,
      next.respawnWindowSeconds * 1000,
    );
  }

  // spawnAndInitialize is the one attempt to start a subprocess, and the one
  // place its outcome is decided: it resolves with the server Running, or it
  // rejects, having recorded the failure and settled the position — except
  // where a stop or restart asked for meanwhile ended it, which owns both.
  // What follows a failure is the caller's: the automatic restart counts it and
  // tries again while the bound allows, and a start or restart someone awaits
  // reports it to them.
  private async spawnAndInitialize(): Promise<void> {
    const generation = this.generation;
    this.startFailure = null;
    this.setState(DaemonState.Starting);
    const launching = this.settings.binaryPath;
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(launching, buildServeArgs(this.settings), {
        cwd: this.workspaceRoot ?? undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.startFailure = { reason: err, binaryPath: launching };
      this.log(StartNarration.failed(this.startFailure));
      this.setState(DaemonState.Stopped);
      throw err;
    }
    this.launchedBinaryPath = launching;
    this.attach(proc);

    try {
      await this.initializeHandshake();
    } catch (err) {
      // A stop or restart asked for while the handshake was open is what ended
      // it. The attempt did not fail, and the act that ended it owns the
      // teardown and the position after it.
      if (generation !== this.generation) {
        throw err;
      }
      this.startFailure = { reason: err, binaryPath: launching };
      this.log(StartNarration.failed(this.startFailure));
      // The encoding goes back to the one assumed before any server answers, so
      // nothing reads positions in an encoding no running server negotiated.
      this.serverEncoding = 'utf-16';
      // Move to Stopping before killing the child so its 'exit' event is
      // absorbed by handleExit's deliberate-teardown guard as the teardown it
      // is, rather than reported as a server that ended unasked. Nothing is
      // counted against the respawn bound here: the automatic restart that
      // awaits this attempt counts it, once, where it decides what follows.
      this.setState(DaemonState.Stopping);
      await this.terminateSubprocess();
      // A stop or restart asked for during the teardown owns the position after
      // it, and a restart may already have started the next attempt, whose
      // position this must not overwrite.
      if (generation === this.generation) {
        this.setState(DaemonState.Stopped);
      }
      throw err;
    }
    this.setState(DaemonState.Running);
    this.drainStartupQueue();
  }

  // attach makes `proc` the subprocess this client runs, and wires what it writes
  // and how it ends.
  //
  // 🔴 ONLY THE SUBPROCESS THE CLIENT RUNS IS READ, AND IT IS READ FROM AN EMPTY
  // BUFFER. A subprocess's output can go on arriving after its exit is reported:
  // the pipe may still hold some of it, and a process it handed its output to can
  // go on writing. By then the client may run the subprocess that replaced it, and
  // a message read from the old output would be taken for the new server's — a
  // finding published after the new server began, as though the new server had
  // said it. Nothing waits on the old output any more, since its requests were
  // refused as it was replaced, so it is dropped, from the moment the subprocess
  // stops being the one this client runs. And a message the old subprocess left
  // unfinished is discarded rather than completed with the new one's bytes, which
  // would swallow the new server's answer to the handshake and fail a start that
  // had succeeded.
  //
  // 🔴 HOW A SUBPROCESS ENDS, AND AN ERROR IT RAISES, ARE HANDLED ONLY WHILE IT IS
  // THE ONE THIS CLIENT RUNS, for the same reason. A teardown stops waiting a moment
  // after SIGKILL whether or not the end has been reported, and a restart then
  // starts the next subprocess at once, so the end of the one let go of can arrive
  // once another runs, or once a stop has settled the client. Taken for the current
  // subprocess's, it would drop the client's hold on the new one, fail the
  // handshake under way and leave that process running with nothing to stop it — or,
  // after a stop, report a crash and start a server nobody asked for. The act that
  // let the old subprocess go owns its teardown and the position after it, so what
  // that subprocess reports afterwards is dropped like its output.
  //
  // Error output is logged whichever subprocess wrote it: a server's account
  // of why it ended is written as it ends, often once it has been replaced, and a
  // line in the output channel is read by a person, never taken for the running
  // server's answer.
  //
  // It is the one place a subprocess is wired, for one this client spawns and one a
  // test attaches alike, so the two cannot come to read differently.
  private attach(proc: ChildProcessWithoutNullStreams): void {
    this.proc = proc;
    this.readBuffer = Buffer.alloc(0);
    // whileCurrent hands an event on only while `proc` is the subprocess this
    // client runs: the one test every event the client acts on passes through.
    const whileCurrent = <A extends unknown[]>(handle: (...args: A) => void) => (...args: A): void => {
      if (proc === this.proc) { handle(...args); }
    };
    proc.stdout.on('data', whileCurrent((chunk: Buffer) => this.handleStdoutChunk(chunk)));
    proc.stderr.on('data', (chunk: Buffer) => {
      this.log(`[aggrega serve stderr] ${chunk.toString('utf8').trimEnd()}`);
    });
    proc.on('exit', whileCurrent((code: number | null, signal: NodeJS.Signals | null) => this.handleExit(code, signal)));
    proc.on('error', whileCurrent((err: Error) => this.handleSpawnError(err)));
  }

  // initializeHandshake negotiates the position encoding and DECLARES the
  // workspace this client wants diagnostics pushed for.
  //
  // The declaration is what makes an editor's problem list update while somebody
  // types. The compiler pushes for the declared workspace and no other one, so a
  // question asked about somewhere else — by an assistant sharing this server,
  // say — answers on its own reply and never lands in this window's problems
  // view.
  //
  // 🔴 WHAT IS DECLARED IS THE AGGREGA WORKSPACE ROOT, NEVER THE FOLDER THE
  // EDITOR HAPPENS TO HAVE OPEN, AND THE COMPILER GIVES NO SECOND CHANCE AT IT.
  // It PINS to the root it is handed rather than climbing from it, so a
  // declaration naming a subfolder puts that workspace's own declared settings
  // and catalog locations outside the cascade for the whole life of the
  // connection — and the answer says so, reporting a configuration read from
  // nowhere in the workspace and naming no workspace marker at all. The caller
  // climbs to the root before starting the client, and it is that value which
  // arrives here and which every request then names.
  //
  // A window with no folder open declares nothing, which the compiler reads as
  // its own launch workspace. Nothing else in the handshake changes.
  private async initializeHandshake(): Promise<void> {
    const id = this.nextId++;
    const params: Record<string, unknown> = {
      capabilities: { general: { positionEncodings: ['utf-8', 'utf-16'] } },
    };
    if (this.workspaceRoot !== null) {
      params.workspaceRoot = this.workspaceRoot;
    }
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: 'aggrega/initialize',
      params,
    };
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('initialize timeout'));
      }, INITIALIZE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.writeMessage(req);
    });
    const encoding = extractServerEncoding(result);
    if (encoding === null) {
      this.log('initialize response missing capabilities.positionEncoding; defaulting to UTF-16');
      this.serverEncoding = 'utf-16';
    } else {
      this.serverEncoding = encoding;
    }
    this.serverInitMetadata = extractServerInitMetadata(result);
  }

  private dispatch(
    method: RequestMethod,
    params: unknown,
    resolve: (v: unknown) => void,
    reject: (r: JsonRpcError | Error) => void,
    signal?: CancellationSignal,
  ): void {
    if (!this.proc) {
      reject(new Error('no subprocess'));
      return;
    }
    if (signal?.isCancellationRequested) {
      reject(new OperationCancelled(method));
      return;
    }
    const id = this.nextId++;
    let subscription: { dispose(): void } | null = null;
    this.pending.set(id, {
      resolve: v => { subscription?.dispose(); resolve(v); },
      reject: r => { subscription?.dispose(); reject(r); },
    });
    this.writeMessage({ jsonrpc: '2.0', id, method, params });
    if (!signal) { return; }
    subscription = signal.onCancellationRequested(() => {
      subscription?.dispose();
      // Only a request still in flight is this client's to stop. delete
      // reporting false means the answer already arrived and settled the
      // promise, so there is nothing to cancel and nothing to settle.
      if (!this.pending.delete(id)) { return; }
      // The notification goes first and the promise settles second, because
      // the notification is what actually stops the compiler. A settle with no
      // notification leaves the daemon working on an answer nobody is waiting
      // for, which is indistinguishable to the reader from having stopped it.
      this.writeCancelRequest(id);
      // The daemon emits no response frame for a request it cancelled, so
      // nothing will arrive to settle this promise later. Settling here is not
      // giving up early — it is the only settlement there will be.
      reject(new OperationCancelled(method));
    });
  }

  private drainStartupQueue(): void {
    const queue = this.startupQueue;
    this.startupQueue = [];
    for (const q of queue) {
      // The while-queued listener is released before dispatch registers the
      // one that knows the id, so a stop reaches exactly one of them.
      q.queuedSubscription?.dispose();
      this.dispatch(q.method, q.params, q.resolve, q.reject, q.signal);
    }
  }

  private writeMessage(body: JsonRpcRequest): void {
    if (!this.proc) { return; }
    this.proc.stdin.write(frameMessage(body));
  }

  // writeCancelRequest emits one $/cancelRequest notification naming the
  // in-flight request to stop.
  //
  // The daemon tracks every id-bearing request while it runs and cancels the
  // one this notification names, so stopping an operation is this message and
  // not the client giving up on the answer: abandoning the promise alone would
  // leave the compiler working while the reader believed they had stopped it.
  //
  // The id is the one this client allocated for that request, written back in
  // the same JSON encoding it was sent in, so the daemon resolves it to the
  // request it is about.
  //
  // Returns false when there is no subprocess or stdin is unwritable, so a
  // caller can report that the compiler was never told rather than reporting a
  // stop that did not happen.
  private writeCancelRequest(id: number): boolean {
    if (!this.proc) { return false; }
    try {
      this.proc.stdin.write(
        frameMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    while (true) {
      const headerEnd = this.readBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) { return; }
      const header = this.readBuffer.subarray(0, headerEnd).toString('ascii');
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) {
        this.log(`malformed JSON-RPC header: ${header}`);
        this.readBuffer = Buffer.alloc(0);
        return;
      }
      const length = parseInt(m[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.readBuffer.byteLength < bodyStart + length) { return; }
      const body = this.readBuffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.readBuffer = this.readBuffer.subarray(bodyStart + length);
      try {
        const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcNotification;
        if (isNotification(parsed)) {
          this.emit(`notification:${parsed.method}`, parsed.params);
        } else {
          this.handleResponse(parsed as JsonRpcResponse);
        }
      } catch (err) {
        this.log(`failed to parse JSON-RPC body: ${(err as Error).message}`);
      }
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const p = this.pending.get(msg.id);
    // An answer nothing is waiting for is dropped without a word. It arrives
    // when the request it answers was settled on this side first — refused by a
    // stop or a restart, or given up on when its wait ran out — and that
    // settlement is where a reader was told what became of it; the request's
    // number tells a reader nothing more.
    if (!p) {
      return;
    }
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(msg.error);
      return;
    }
    p.resolve(msg.result);
  }

  // handleSpawnError handles the subprocess 'error' event. The event fires
  // asynchronously when the subprocess cannot be spawned or has fatally
  // failed — most commonly ENOENT when binaryPath does not resolve to an
  // executable. Node does not throw this synchronously from spawn(), so the
  // try/catch around spawn() never sees it; without a listener the event is
  // re-thrown as an uncaught exception that crashes the host process. This
  // handler is the listener: it rejects every in-flight and queued request
  // with the concrete spawn error so an awaiting initialize handshake fails
  // fast with a clear cause rather than hanging to its timeout, and it starts
  // nothing itself. State settles through the awaiting spawnAndInitialize's
  // failure path, and whatever follows is that attempt's caller's: an automatic
  // restart that cannot spawn is counted like any other that did not come up,
  // so a missing or unexecutable binary ends at the respawn bound rather than
  // looping. A stray error after the daemon is already stopping is a no-op
  // beyond clearing pending work, and one raised by a subprocess the client has
  // already let go of never reaches here (attach drops it), so it cannot clear the
  // work of the subprocess running now.
  //
  // It writes nothing to the channel itself. The error is handed on unchanged,
  // and where it lands is where it is worded: an attempt to start says why it
  // failed, in the words a reader acts on, and a request it refuses ends in that
  // request's own line. A line here as well would say the same failure twice,
  // the second time in the runtime's terms.
  private handleSpawnError(err: Error): void {
    this.rejectPending(err);
  }

  // handleExit handles the subprocess 'exit' event.
  //
  // 🔴 AN EXIT HAS ONE OWNER. An exit during a teardown this client made is
  // that teardown's. An exit while an attempt is still in its handshake is that
  // attempt's: the rejection below fails the handshake, and the attempt's caller
  // decides what follows — so nothing is started from here, since a second
  // attempt started beside the failing one would be torn down by that attempt's
  // own failure path and left waiting on a handshake nobody answers. Only an exit
  // of a server that was running is supervised from here. An exit of a subprocess
  // the client has already let go of is the act's that let it go, and attach drops
  // it before it reaches here.
  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.proc = null;
    if (this.state === DaemonState.Stopping || this.state === DaemonState.Restarting) {
      return;
    }
    this.log(RespawnNarration.ended(code, signal));
    this.rejectPending(new Error(RespawnNarration.ended(code, signal)));
    this.emit('unexpectedExit', code, signal);
    if (this.state === DaemonState.Starting) {
      return;
    }
    this.respawn();
  }

  // respawn starts a fresh subprocess after one ended without being asked to,
  // while the respawn bound allows, and once it is spent leaves the client
  // stopped and raises stoppedResponding.
  //
  // 🔴 EVERY END IS COUNTED THE SAME WAY, WHENEVER IT COMES. A server started
  // again that ends before it answers — as it starts, or during its handshake —
  // fails the attempt that started it, and that failure comes back here as one
  // more end rather than stopping the run of restarts: a restart that ended in
  // silence would leave a reader with nothing running and nothing saying so.
  // The bound is what ends the run under a server that dies every time it
  // starts, so it is tested before each restart and each restart is recorded as
  // it is made.
  //
  // A stop or restart asked for while a restart is under way supersedes it, and
  // the run ends there, counting and reporting nothing.
  private respawn(): void {
    const { respawnAttempts: limit, respawnWindowSeconds: windowSeconds } = this.settings;
    if (!this.respawnTracker.shouldRespawn()) {
      this.log(RespawnNarration.boundSpent(limit, windowSeconds));
      this.setState(DaemonState.Stopped);
      this.emit('stoppedResponding');
      return;
    }
    this.respawnTracker.recordAttempt();
    this.log(RespawnNarration.restarting(this.respawnTracker.attemptCount(), limit, windowSeconds));
    this.setState(DaemonState.Stopped);
    const generation = this.generation;
    this.spawnAndInitialize().then(undefined, (err: Error) => {
      if (generation !== this.generation) {
        return;
      }
      this.log(RespawnNarration.restartFailed(startFailureWords(
        this.startFailure ?? { reason: err, binaryPath: this.settings.binaryPath },
      )));
      this.respawn();
    });
  }

  private rejectPending(reason: Error): void {
    for (const p of this.pending.values()) {
      p.reject(reason);
    }
    this.pending.clear();
    for (const q of this.startupQueue) {
      q.reject(reason);
    }
    this.startupQueue = [];
  }

  private async terminateSubprocess(cooperative = false): Promise<void> {
    const proc = this.proc;
    if (!proc) { return; }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      this.proc = null;
      return;
    }

    // Cooperative escalation is graceful-then-force: DRAIN, then ABORT,
    // then SIGTERM, then SIGKILL. It is skipped entirely on restart() and
    // the initialize-failure path, where cooperative shutdown does not
    // help an unhealthy daemon.
    if (cooperative) {
      // DRAIN. Send the first aggrega/shutdown and wait
      // SHUTDOWN_DRAIN_GRACE_MS. The daemon stops accepting new work, lets
      // in-flight work finish, then exits on its own — the later steps are
      // skipped when it does.
      //
      // Each step reports itself through ShutdownNarration, and the request is
      // reported only once it was actually written: an unwritable stdin falls
      // through to the next step, and narrating a request that never left would
      // make the daemon look unresponsive to something nobody asked it.
      if (this.writeShutdown(proc)) {
        this.log(ShutdownNarration.cooperativeRequest);
        if (await waitForExit(proc, SHUTDOWN_DRAIN_GRACE_MS)) {
          this.log(ShutdownNarration.cooperativeExit);
          this.proc = null;
          return;
        }
      }

      // ABORT. The drain did not complete in time; send a second
      // aggrega/shutdown, which cancels in-flight work, and wait
      // SHUTDOWN_ABORT_GRACE_MS for the daemon to exit.
      if (this.writeShutdown(proc)) {
        this.log(ShutdownNarration.abandonRequest);
        if (await waitForExit(proc, SHUTDOWN_ABORT_GRACE_MS)) {
          this.log(ShutdownNarration.abandonedExit);
          this.proc = null;
          return;
        }
      }
    }

    // SIGTERM with SIGTERM_GRACE_MS budget, then SIGKILL. Reached either
    // because both cooperative requests went unanswered, or because the caller
    // asked for no cooperative attempt at all — restart and the
    // initialize-failure path, where asking an unhealthy daemon nicely helps
    // nobody. The line is worded to be true of both.
    this.log(ShutdownNarration.osTermination);
    await new Promise<void>(resolve => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      proc.once('exit', done);
      proc.kill('SIGTERM');
      // Windows: SIGTERM is emulated via TerminateProcess; the grace
      // window collapses to immediate termination. POSIX honors the
      // grace window before SIGKILL escalates.
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          this.log(ShutdownNarration.forcedTermination);
          proc.kill('SIGKILL');
        }
        setTimeout(done, 100);
      }, SIGTERM_GRACE_MS);
    });
    this.proc = null;
  }

  // writeShutdown emits one aggrega/shutdown notification on the
  // subprocess's stdin. Returns false when stdin is already closed or
  // otherwise unwritable, so the caller can fall through to the next
  // escalation phase. Two of these in sequence drive the daemon's
  // drain-then-abort shutdown: the first drains, the second aborts.
  private writeShutdown(proc: ChildProcessWithoutNullStreams): boolean {
    try {
      proc.stdin.write(frameMessage({ jsonrpc: '2.0', method: 'aggrega/shutdown' }));
      return true;
    } catch {
      return false;
    }
  }

  private setState(next: DaemonState): void {
    const prev = this.state;
    if (prev === next) { return; }
    this.state = next;
    this.emit('stateChange', next, prev);
  }
}

// extractServerEncoding reads capabilities.positionEncoding from an
// aggrega/initialize result. Returns null on a missing or malformed
// field; the caller defaults to UTF-16.
function extractServerEncoding(result: unknown): ServerEncoding | null {
  if (!result || typeof result !== 'object') { return null; }
  const caps = (result as { capabilities?: unknown }).capabilities;
  if (!caps || typeof caps !== 'object') { return null; }
  const pe = (caps as { positionEncoding?: unknown }).positionEncoding;
  if (pe === 'utf-8' || pe === 'utf-16') { return pe; }
  return null;
}


// waitForExit resolves true when the child process exits within
// timeoutMs, false on timeout. Used by terminateSubprocess's
// cooperative phase to bound the wait for an aggrega/shutdown
// initiated exit before escalating to SIGTERM.
function waitForExit(
  proc: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const settle = (exited: boolean) => {
      if (settled) { return; }
      settled = true;
      proc.removeListener('exit', onExit);
      clearTimeout(timer);
      resolve(exited);
    };
    const onExit = () => settle(true);
    proc.once('exit', onExit);
    const timer = setTimeout(() => settle(false), timeoutMs);
  });
}
