// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// This module is the one home of what the kind of window decides about adding a
// folder to it: whether the add puts the window on a new workspace, and what the
// add costs the reader.
//
// 🔴 IT IMPORTS NOTHING, AND THAT IS WHY IT IS A MODULE OF ITS OWN. Two modules
// draw a line offering an add — the Project folder row's chooser and the Aggrega
// workspace row's chooser — and the first already imports the second. Held in
// either of them, the grading would make the two import each other; held here,
// each imports it and neither needs the other.

// WindowKind is what the editor says about a window that decides what adding a
// folder to it costs.
//
// Both are facts the editor reports rather than conclusions drawn here; what
// they cost is concluded in one place below, so the reading and the conclusion
// cannot drift apart unseen.
export interface WindowKind {
  // onWorkspaceFile is whether the window is open on a workspace file, saved or
  // untitled, rather than on a single folder or on nothing at all.
  onWorkspaceFile: boolean;
  // remote is whether the window works on another machine through a remote
  // connection, a container or another host.
  remote: boolean;
}

// WINDOW_RELOADS is how an entry's second line names a reload, whichever entry it
// is: the open entry's always, and an add's where the window is remote. Written
// once so no two entries can come to name one consequence in two ways.
export const WINDOW_RELOADS = 'The window reloads.';

// addingMakesNewWorkspace reports whether adding a folder to this kind of window
// puts the window on a workspace it was not on before.
//
// 🔴 IT IS THE ONE CONCLUSION DRAWN FROM THE WINDOW'S KIND ABOUT WHAT AN ADD
// DOES, AND TWO THINGS FOLLOW FROM IT: what every line offering an add says the
// add costs, and which memory an answer given before the add is written into. A
// window open on a workspace file takes another folder in place and keeps its
// memory. A window open on one folder, or on none, is turned into a new
// workspace, and the editor opens that workspace's memory empty rather than
// carrying the old one across. Drawn twice, a line could name one of those
// while the answer went where the other is true.
export function addingMakesNewWorkspace(windowKind: WindowKind): boolean {
  return !windowKind.onWorkspaceFile;
}

// withAddingCost ends a line saying what taking an entry does with what the add
// it ends in costs, in this kind of window, where it costs something.
//
// 🔴 IT IS THE ONE HOME OF THAT COST FOR EVERY ENTRY WHOSE TAKING ENDS IN AN ADD.
// The Project folder row's add entry and the Aggrega workspace row's last entry
// both end with a folder added to the window, so an add made through either
// costs the same; each composes its line here rather than writing the cost
// itself, so the two cannot come to name different costs for one act.
//
// 🔴 THE COST IS THE EDITOR'S, AND THIS MIRRORS HOW THE EDITOR DECIDES IT. A
// window open on a workspace file takes another folder in place. A window open
// on one folder, or on none, is turned into a workspace to take it, and entering
// a workspace stops every extension and starts them again — which, in a remote
// window, the editor does by reloading the window. A second line promising only
// the reach would be accurate and would still surprise every reader whose window
// reloaded under them.
//
// Where there is no cost the line names none, rather than reassuring the reader
// that nothing restarts: that would be one more sentence that could stop being
// true.
export function withAddingCost(line: string, windowKind: WindowKind): string {
  if (!addingMakesNewWorkspace(windowKind)) { return line; }
  const cost = windowKind.remote ? WINDOW_RELOADS : 'Extensions restart.';
  return `${line} ${cost}`;
}
