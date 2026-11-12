// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { DaemonState } from './daemon';

// What a language server says reaches the Problems view through collections the
// extension keeps for as long as it runs — one for each layer the server pushes or
// answers, and the conventions check's own — so they outlive the server that
// filled them. A server that stops cannot take back what it said, and the server
// started after it does not know what was said: its handshake assumes the client
// in front of it holds an empty problem list, and it reports only what its own
// requests compute. A finding the stopped server published and the new one never
// computes would otherwise stand for as long as the window does — after a move to
// another workspace, one from a workspace the editor is no longer working in.
//
// So whenever a new server comes up — a restart, a respawn after a crash, a move
// to another workspace, a start from stopped — everything the stopped server said
// is forgotten, and the open documents are validated again as soon as the new one
// can answer. The Problems view then starts from what the new server says. The
// cost is a brief blink while the open documents are validated again, and a
// finding no request of the new server has computed yet — a build advisory with no
// graph open, a drift warning on a lockfile, a conventions finding — is gone until
// one does.
//
// This module decides when and what; the extension hands it every position its
// one lifecycle listener is told of, and readiness's rising edge, and names the
// collections. It takes no editor type, so the decision can be driven against real
// server processes with no editor running.

// ServerWordHolder is anything holding findings a language server supplied. An
// editor diagnostic collection is one as it stands.
export interface ServerWordHolder {
  clear(): void;
}

// ServerTurnoverDeps is what the turnover acts on.
export interface ServerTurnoverDeps {
  // holders names every collection holding what a language server said. It is
  // read at the moment of the clear rather than once, because a collection is
  // created the first time a layer is seen, which can be during the life of the
  // server being replaced.
  holders(): Iterable<ServerWordHolder>;
  // revalidate validates every open document again.
  revalidate(): void;
}

// ServerTurnover is handed the two moments a new server is made of.
export interface ServerTurnover {
  // moved is handed every position the client moves to.
  moved(next: DaemonState): void;
  // answerable is called each time the compiler becomes answerable once more.
  answerable(): void;
}

// beginsANewServer reports whether a move to `next` is the beginning of a new
// server process.
//
// 🔴 STARTING, AND NEVER RUNNING. Every attempt to start a process — the first
// start, a restart and a respawn alike — moves the client to Starting before the
// process is spawned, so nothing the new server says can arrive ahead of it. Running
// is too late: the client reads every message in one read of the server's output
// before the handshake's answer is acted on, so a finding the new server sends in
// the same read as that answer is filed before the client reads Running, and a clear
// made there would erase the new server's own word along with the old one's.
export function beginsANewServer(next: DaemonState): boolean {
  return next === DaemonState.Starting;
}

// createServerTurnover builds the turnover over the holders and the validation
// it is given.
export function createServerTurnover(deps: ServerTurnoverDeps): ServerTurnover {
  return {
    moved: (next) => {
      if (!beginsANewServer(next)) { return; }
      for (const holder of deps.holders()) { holder.clear(); }
    },
    answerable: () => { deps.revalidate(); },
  };
}
