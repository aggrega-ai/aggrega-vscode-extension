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

// DaemonState is the lifecycle position of the Daemon subprocess.
// Request dispatch consults state to decide whether to dispatch
// directly, queue for later drain, or reject the request.
export enum DaemonState {
  Stopped = 'Stopped',
  Starting = 'Starting',
  Running = 'Running',
  Restarting = 'Restarting',
  Stopping = 'Stopping',
}

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

// RespawnTracker counts unexpected exits within a sliding window
// and reports whether a fresh respawn attempt is permitted.
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
  stoppedResponding: () => void;
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
  private readBuffer = Buffer.alloc(0);
  private respawnTracker: RespawnTracker;
  private workspaceRoot: string | null = null;

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

  // getServerInitMetadata returns the workspaceRoot + configSource
  // fields the daemon reported in its aggrega/initialize response,
  // or null when the handshake has not completed or the response
  // omitted them.
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
   * production. The subprocess's stdout / stderr / exit handlers
   * are wired identically to spawnAndInitialize() so handleExit
   * runs on subprocess termination and lifecycle observation stays
   * coherent.
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
    d.proc = proc;
    proc.stdout.on('data', (chunk: Buffer) => d.handleStdoutChunk(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      d.log(`[aggrega serve stderr] ${chunk.toString('utf8').trimEnd()}`);
    });
    proc.on('exit', (code, signal) => d.handleExit(code, signal));
    proc.on('error', err => d.handleSpawnError(err));
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
    if (this.state === DaemonState.Stopped) {
      return;
    }
    this.setState(DaemonState.Stopping);
    this.rejectPending(new Error('daemon shutting down'));
    await this.terminateSubprocess(/*cooperative=*/ true);
    this.setState(DaemonState.Stopped);
  }

  async restart(): Promise<void> {
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

  private async spawnAndInitialize(): Promise<void> {
    this.setState(DaemonState.Starting);
    try {
      this.proc = spawn(this.settings.binaryPath, buildServeArgs(this.settings), {
        cwd: this.workspaceRoot ?? undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.setState(DaemonState.Stopped);
      throw err;
    }
    this.proc.stdout.on('data', (chunk: Buffer) => this.handleStdoutChunk(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.log(`[aggrega serve stderr] ${chunk.toString('utf8').trimEnd()}`);
    });
    this.proc.on('exit', (code, signal) => this.handleExit(code, signal));
    this.proc.on('error', err => this.handleSpawnError(err));

    try {
      await this.initializeHandshake();
    } catch (err) {
      this.log(`initialize failed: ${(err as Error).message}; falling back to UTF-16`);
      this.serverEncoding = 'utf-16';
      // Move to Stopping before killing the child so its 'exit' event is
      // absorbed by handleExit's deliberate-teardown guard rather than
      // treated as an unexpected exit. Without this the SIGTERM/SIGKILL
      // below would fire handleExit while state was still Starting/Stopped,
      // which respawns immediately — each respawn re-pays startup and can
      // storm. The attempt is recorded once here so the caller-driven retry
      // still honors the RespawnTracker backoff.
      this.setState(DaemonState.Stopping);
      await this.terminateSubprocess();
      this.respawnTracker.recordAttempt();
      this.setState(DaemonState.Stopped);
      throw err;
    }
    this.setState(DaemonState.Running);
    this.drainStartupQueue();
  }

  // initializeHandshake negotiates the position encoding and DECLARES the
  // workspace this client wants diagnostics pushed for.
  //
  // The declaration is what makes an editor's problem list update while somebody
  // types. The compiler pushes for the declared workspace and no other one, so a
  // question asked about somewhere else — by an assistant sharing this server,
  // say — answers on its own reply and never lands in this window's problems
  // view. Declaring the folder this window has open is therefore exactly right,
  // and it is the same value every request then names.
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
    if (!p) {
      this.log(`response with unknown id ${msg.id}`);
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
  // fast with a clear cause rather than hanging to its timeout, and it does
  // not respawn (a missing or unexecutable binary would respawn-loop). State
  // settles through the awaiting spawnAndInitialize's failure path; a stray
  // error after the daemon is already stopping is a no-op beyond clearing
  // pending work.
  private handleSpawnError(err: Error): void {
    this.log(`subprocess error: ${err.message}`);
    this.rejectPending(err);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.proc = null;
    if (this.state === DaemonState.Stopping || this.state === DaemonState.Restarting) {
      return;
    }
    this.rejectPending(new Error(`daemon exited (code=${code}, signal=${signal})`));
    this.emit('unexpectedExit', code, signal);
    this.respawnTracker.recordAttempt();
    if (!this.respawnTracker.shouldRespawn()) {
      this.setState(DaemonState.Stopped);
      this.emit('stoppedResponding');
      return;
    }
    this.setState(DaemonState.Stopped);
    this.spawnAndInitialize().catch(err => {
      this.log(`respawn failed: ${(err as Error).message}`);
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
