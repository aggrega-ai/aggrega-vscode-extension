// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// Readiness is the extension's one answer to "can the compiler be asked yet".
//
// A view renders when the editor reveals it, which is a moment the language
// server's lifecycle knows nothing about. At a cold open every view is
// registered and drawn before the workspace root is resolved and before the
// server has answered, so each one honestly reports that it has nothing. This
// state is what tells them otherwise; without it a reader would be left pressing
// Refresh to obtain data that should have arrived on its own.
//
// THIS MODULE IS THE ONE HOME FOR THAT QUESTION AND A SECOND SUBSCRIBER TO THE
// SERVER'S LIFECYCLE IS NOT TO BE ADDED. A surface that polled, retried on a
// timer, or watched the lifecycle for itself would be a second answer to one
// question, and the surface written after it would derive a third. Surfaces
// take the signal as a dependency instead, which is why RendersOnReady is part
// of a view's dependency contract rather than something a view opts into: a
// view added later cannot be constructed without being handed the signal.

// ReadinessDeps supplies the two facts a surface actually needs before it can
// ask anything. Both are read through the getters their owners already expose,
// rather than recorded here when they change: a copy held in this module would
// be a second home for each fact, and it would disagree with what a view sees
// the moment either moved without telling it.
export interface ReadinessDeps {
  // getWorkspaceRoot reports the anchored workspace root, or null before one is
  // resolved. It is a readiness fact in its own right and not merely a daemon
  // concern: the operations that run the binary as a subprocess need somewhere
  // to run it, and they are registered long before a root is known.
  getWorkspaceRoot(): string | null;
  // isLanguageServerRunning reports whether the server can be asked. A server
  // that is starting is not yet answerable even though it will be shortly, and
  // one that is restarting refuses outright, so both read as not ready.
  isLanguageServerRunning(): boolean;
}

// RendersOnReady is the dependency a surface declares in order to render from
// the readiness signal. It is a separate interface so every surface's own
// dependency set can extend it and the registration is spelled out once.
export interface RendersOnReady {
  // onReady registers a listener fired when the compiler becomes answerable,
  // and again whenever it becomes answerable once more — which is what makes a
  // restart repopulate the views with nobody pressing anything.
  //
  // A listener registered while it is already answerable fires immediately, so
  // subscribing is safe at any point and no surface has to reason about whether
  // it was built early enough to catch the transition.
  onReady(listener: () => void): void;
}

// Readiness is the state itself: what a surface reads, and the one call that
// re-evaluates it.
export interface Readiness extends RendersOnReady {
  // isReady reports whether the compiler can be asked right now.
  isReady(): boolean;
  // reassess re-reads both facts and announces the answer if it has just become
  // yes. It is called from the single place that observes the server's
  // lifecycle; nothing else needs to call it, and a surface calling it would be
  // asking the question on its own schedule, which is the shape this state
  // exists to remove.
  reassess(): void;
}

// createReadiness builds the readiness state over the supplied facts.
export function createReadiness(deps: ReadinessDeps): Readiness {
  const listeners: Array<() => void> = [];

  const evaluate = (): boolean =>
    deps.getWorkspaceRoot() !== null && deps.isLanguageServerRunning();

  let ready = evaluate();

  return {
    isReady: () => ready,

    reassess: (): void => {
      const next = evaluate();
      const becameReady = next && !ready;
      ready = next;
      // Only the rising edge is announced, and only when it is a change: a
      // burst of lifecycle events that leaves the answer where it was gives a
      // view nothing new to draw, and re-drawing on each one would re-ask the
      // compiler for an answer it has already given.
      //
      // The falling edge announces nothing on purpose. It is a transient state
      // in the ordinary case — a restart passes straight through it — and a
      // view redrawing there would replace content the reader can still read
      // with a row that is superseded moments later. A surface keeps what it
      // has until there is a better answer.
      if (!becameReady) { return; }
      for (const listener of listeners) {
        listener();
      }
    },

    onReady: (listener: () => void): void => {
      listeners.push(listener);
      if (ready) {
        listener();
      }
    },
  };
}
