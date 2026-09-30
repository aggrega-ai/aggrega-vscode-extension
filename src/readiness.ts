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

// COMPILER_ANSWERABLE_CONTEXT_KEY is the editor condition this state is
// published under, so a command's availability can be declared in the manifest
// instead of decided inside its handler. A command whose handler registers and
// then returns looks enabled and does nothing, which teaches a reader that the
// command is broken; a command whose condition is false is left out of the
// command palette by the editor, so it is never offered to be pressed.
//
// The key is a PROJECTION of the state below and never a second answer to it:
// its one publisher reads isReady() and publishes nothing else. That is why the
// name lives here rather than beside the manifest — the key and the predicate it
// reports have one home.
//
// It is deliberately not one of the get-started step conditions, which report
// something else: those are four standings of what a workspace still needs,
// while this one reports whether the compiler can be asked right now. The
// nearest of them reads the language server alone, so a command gated on it
// would be offered in a window with no anchored root, where the operations that
// run the binary as a subprocess have nowhere to run.
export const COMPILER_ANSWERABLE_CONTEXT_KEY = 'aggrega.compilerAnswerable';

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
  // onChange registers a listener told the answer on EVERY change of it, both
  // edges, and immediately with the answer as it stands.
  //
  // WHY A SECOND CHANNEL OVER ONE PREDICATE, WHICH IS NOT A SECOND ANSWER. Both
  // channels report isReady() and neither computes anything; what differs is
  // the edge, and the edge is decided by what a consumer does with the answer.
  // A view holds content, so redrawing it when the compiler stops being
  // answerable replaces something the reader can still read with a row
  // superseded moments later — which is why onReady announces the rising edge
  // alone. A gate holds no content: leaving it open while the compiler cannot
  // be asked is exactly the enabled-but-inert control the gate exists to
  // prevent, so it needs the falling edge too.
  //
  // It is not a dependency interface of its own because nothing takes it as
  // one. The single publisher is the extension's activation, which sets the
  // editor condition above from it and does nothing else with it.
  onChange(listener: (answerable: boolean) => void): void;
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
  const changeListeners: Array<(answerable: boolean) => void> = [];

  const evaluate = (): boolean =>
    deps.getWorkspaceRoot() !== null && deps.isLanguageServerRunning();

  let ready = evaluate();

  return {
    isReady: () => ready,

    reassess: (): void => {
      const next = evaluate();
      const becameReady = next && !ready;
      const changed = next !== ready;
      ready = next;
      // Both edges, and only on a change: a burst of lifecycle events that
      // leaves the answer where it was would re-publish a condition the editor
      // already holds.
      if (changed) {
        for (const listener of changeListeners) {
          listener(next);
        }
      }
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

    // Told the answer as it stands on subscription, whichever it is. A gate
    // whose condition was never published is a condition the editor has no
    // value for, and a surface reading one cannot tell that from a published
    // no — so the answer is stated rather than left to be inferred from
    // silence.
    onChange: (listener: (answerable: boolean) => void): void => {
      changeListeners.push(listener);
      listener(ready);
    },
  };
}
