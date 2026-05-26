// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import {
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  ServerEncoding,
} from './types';
import { Settings } from './settings';

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
// daemon that misses the window is treated as deadlocked.
const INITIALIZE_TIMEOUT_MS = 5000;

// SHUTDOWN_GRACE_MS bounds the wait for SIGTERM to take effect
// before SIGKILL.
const SHUTDOWN_GRACE_MS = 5000;

// STARTUP_QUEUE_LIMIT caps the requests queued while the subprocess
// is starting. Excess requests fail with a queue-overflow error.
const STARTUP_QUEUE_LIMIT = 100;

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
  method: string;
  params: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: JsonRpcError | Error) => void;
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
  private pending = new Map<number, PendingRequest>();
  private startupQueue: QueuedRequest[] = [];
  private nextId = 1;
  private serverEncoding: ServerEncoding = 'utf-16';
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
    await this.terminateSubprocess();
    this.setState(DaemonState.Stopped);
  }

  async restart(): Promise<void> {
    this.setState(DaemonState.Restarting);
    this.rejectPending(new Error('daemon restarted'));
    await this.terminateSubprocess();
    this.respawnTracker.reset();
    await this.spawnAndInitialize();
  }

  // request dispatches a JSON-RPC call. In Stopped/Stopping the call
  // rejects immediately; in Starting/Restarting the call queues; in
  // Running the call dispatches directly.
  request<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedResolve = (v: unknown) => resolve(v as T);
      const wrappedReject = (r: JsonRpcError | Error) => reject(r);
      switch (this.state) {
        case DaemonState.Stopped:
        case DaemonState.Stopping:
          reject(new Error(`daemon is ${this.state}`));
          return;
        case DaemonState.Starting:
          if (this.startupQueue.length >= STARTUP_QUEUE_LIMIT) {
            reject(new Error('daemon startup queue overflow'));
            return;
          }
          this.startupQueue.push({ method, params, resolve: wrappedResolve, reject: wrappedReject });
          return;
        case DaemonState.Restarting:
          reject(new Error('daemon is restarting; retry after restart completes'));
          return;
        case DaemonState.Running:
          this.dispatch(method, params, wrappedResolve, wrappedReject);
          return;
      }
    });
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
      this.proc = spawn(this.settings.binaryPath, ['serve'], {
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

    try {
      await this.initializeHandshake();
    } catch (err) {
      this.log(`initialize failed: ${(err as Error).message}; falling back to UTF-16`);
      this.serverEncoding = 'utf-16';
      await this.terminateSubprocess();
      this.respawnTracker.recordAttempt();
      this.setState(DaemonState.Stopped);
      throw err;
    }
    this.setState(DaemonState.Running);
    this.drainStartupQueue();
  }

  private async initializeHandshake(): Promise<void> {
    const id = this.nextId++;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: 'aggrega/initialize',
      params: { capabilities: { general: { positionEncodings: ['utf-8', 'utf-16'] } } },
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
      return;
    }
    this.serverEncoding = encoding;
  }

  private dispatch(
    method: string,
    params: unknown,
    resolve: (v: unknown) => void,
    reject: (r: JsonRpcError | Error) => void,
  ): void {
    if (!this.proc) {
      reject(new Error('no subprocess'));
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, { resolve, reject });
    this.writeMessage({ jsonrpc: '2.0', id, method, params });
  }

  private drainStartupQueue(): void {
    const queue = this.startupQueue;
    this.startupQueue = [];
    for (const q of queue) {
      this.dispatch(q.method, q.params, q.resolve, q.reject);
    }
  }

  private writeMessage(body: JsonRpcRequest): void {
    if (!this.proc) { return; }
    const json = JSON.stringify(body);
    const payload = Buffer.from(json, 'utf8');
    const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'ascii');
    this.proc.stdin.write(Buffer.concat([header, payload]));
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
        const message = JSON.parse(body) as JsonRpcResponse;
        this.handleResponse(message);
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

  private async terminateSubprocess(): Promise<void> {
    const proc = this.proc;
    if (!proc) { return; }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      this.proc = null;
      return;
    }
    await new Promise<void>(resolve => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      proc.once('exit', done);
      proc.kill('SIGTERM');
      // Windows: SIGTERM is emulated via TerminateProcess; the grace
      // window collapses to immediate termination. POSIX honors the
      // 5-second window before SIGKILL escalates.
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGKILL');
        }
        setTimeout(done, 100);
      }, SHUTDOWN_GRACE_MS);
    });
    this.proc = null;
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
