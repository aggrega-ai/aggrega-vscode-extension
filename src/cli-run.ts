// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { CancellationSignal, OperationCancelled } from './cancellation';

// This module owns what it means to run the compiler as a subprocess and be
// able to stop it. It depends on no editor type, so a test drives a real child
// process through it and reads back whether that process actually ended —
// which is the only evidence that stopping stopped anything.

// SIGKILL_GRACE_MS bounds the wait between asking a child to stop and insisting.
//
// The compiler exits promptly on the polite signal; the second one exists for a
// child that is wedged rather than busy. The window mirrors the language
// server's own termination escalation, so a reader who stops an operation waits
// the same time whichever transport it used.
export const SIGKILL_GRACE_MS = 2000;

// CliChild is the slice of a spawned process this module drives. It is declared
// structurally so a test supplies its own, and so nothing here depends on more
// of the runtime's process object than it uses.
export interface CliChild {
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

// CliRunDeps supplies the pieces a run needs: how to start a child, and where
// its output goes. Injecting both is what lets the stopping behaviour be driven
// against a real process with no editor present.
export interface CliRunDeps {
  spawn(): CliChild;
  // append writes streamed output verbatim. The compiler's own text reaches the
  // reader unchanged; nothing here reads or rewrites it.
  append(text: string): void;
  // appendLine writes one line of this surface's own narration — the invocation
  // and the exit — which is the frame around the compiler's output rather than
  // a rewording of it.
  appendLine(text: string): void;
}

// CliExit is how a run nobody stopped ended: the status the child exited with,
// and everything it wrote to its standard error.
//
// The error stream is carried because it is where the command line puts the
// reason it refused, and it is the only place that reason exists once the run is
// over: the status says that the compiler declined and nothing about why.
export interface CliExit {
  code: number | null;
  stderr: string;
}

// exitRefusal is what a reader is told about a run that exited with a status
// other than zero.
//
// The status comes first and the compiler's own words follow it, unchanged, so
// the sentence a reader meets names what to fix rather than only that something
// failed. Only the blank lines around the words are dropped, which the compiler
// writes as line endings rather than as text. A run that wrote nothing to its
// error stream is reported by its status alone, since there is nothing of the
// compiler's to carry and inventing a reason would be worse than naming none.
export function exitRefusal(exit: CliExit): string {
  const status = `the compiler exited with status ${exit.code ?? 'unknown'}`;
  const said = exit.stderr.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
  return said.trim() === '' ? `${status}.` : `${status}: ${said}`;
}

// runCliProcess starts the child, streams its output, and settles on how it
// ended.
//
// It resolves with the exit status and the text of the child's error stream. It
// rejects with the stopped-by-the-reader rejection when the signal fires, and
// with the spawn failure when the child could not be started at all — a value
// the caller reports verbatim, since a binary that does not resolve is a fact
// about the reader's own environment and the runtime's message names it
// precisely.
//
// The error stream is kept as bytes and decoded once the child has closed, so a
// character the operating system split across two reads reaches the reader
// whole. The streamed copy on the channel is untouched by that: it is written as
// each read arrives, which is what lets a reader watch a run in progress.
//
// Stopping is terminating the child, and the child is held for exactly as long
// as that is possible: the handle lives across the whole wait rather than in a
// local the function returns past, which is what makes the operation reachable
// at all once it is running.
export function runCliProcess(
  deps: CliRunDeps,
  what: string,
  signal?: CancellationSignal,
  killGraceMs: number = SIGKILL_GRACE_MS,
): Promise<CliExit> {
  return new Promise<CliExit>((resolve, reject) => {
    if (signal?.isCancellationRequested) {
      reject(new OperationCancelled(what));
      return;
    }

    let child: CliChild;
    try {
      child = deps.spawn();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { dispose(): void } | null = null;
    // finish settles once and releases the cancel listener. It deliberately
    // does NOT touch the escalation timer: settling happens the moment the
    // reader stops the operation, while the child may still be shutting down,
    // and cancelling the timer there would retract the insistent second signal
    // for exactly the wedged child it exists for. The timer is released when
    // the child actually closes.
    const finish = (act: () => void): void => {
      if (settled) { return; }
      settled = true;
      subscription?.dispose();
      act();
    };

    const errorStream: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => deps.append(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => {
      errorStream.push(chunk);
      deps.append(chunk.toString());
    });
    child.on('error', (err: Error) => {
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      finish(() => reject(err));
    });
    child.on('close', (code: number | null) => {
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      // A child stopped on the reader's instruction reaches close too, and the
      // stop already settled this promise — finish makes the first settlement
      // the only one, so the exit of a terminated child never overwrites the
      // stopped-by-the-reader answer with an exit status.
      finish(() => resolve({ code, stderr: Buffer.concat(errorStream).toString('utf8') }));
    });

    if (!signal) { return; }
    subscription = signal.onCancellationRequested(() => {
      if (settled) { return; }
      // The child is asked to stop before the promise settles. Settling first
      // and leaving the process running is exactly the failure this exists to
      // prevent: the reader would be told it stopped while the compiler carried
      // on doing the work.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, killGraceMs);
      }
      // The settlement is separate from the termination and happens after it,
      // so a reader is told the operation stopped only once the child has been
      // told to stop.
      finish(() => reject(new OperationCancelled(what)));
    });
  });
}
