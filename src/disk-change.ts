// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import type { TimerLike } from './binary-restart';

// What a file the compiler reads changing ON DISK asks of the editor, decided
// without an editor.
//
// Two kinds of file reach the one on-disk watcher, and the compiler reads both
// off disk rather than out of a buffer. An authored document is what a Release is
// built from. A Release's lockfile is what the Release is pinned against: every
// request that resolves the Release reads it afresh, and a pull writes it —
// pressed on the Commands panel, run by a build with Auto pull, run from the
// notice for a missing lockfile, or typed as `aggrega pull` in a terminal. The
// watcher reports every one of those writes, which is why a single path on disk
// covers every writer rather than each writer having to announce itself.
//
// Either kind drops what the compiler holds for the file and redraws an open
// topology graph. A lockfile also asks for what it alone feeds:
//
// - the open documents are validated again, because validation reads its pins
//   and the withdrawal markers it reports from that lockfile;
// - a drift warning the Problems panel holds on it is settled. Checking a
//   lockfile against what the Release now resolves to is the graph request's
//   work alone — validation neither raises that warning nor clears it — and the
//   redraw of a panel showing the selected Release is that request. Where no
//   panel shows it — none is open, or the one open shows another Release, which
//   a panel keeps when the selection moves and whose redraw checks that other
//   Release's lockfile — the request is sent once for the selected Release and
//   its answer discarded, so the warning moves with nothing drawn. It is sent
//   only where a finding stands on that lockfile, because a request with nothing
//   to settle is a compile nobody needs.
//
// 🔴 A `.lock` FILE IS A LOCKFILE HERE ONLY WHEN IT IS THE SELECTED RELEASE'S,
// AND NEVER BY ITS EXTENSION. The extension belongs to many ecosystems, and an
// Aggrega workspace keeps pin files of its own beside catalog entities as well;
// none of them is a file a graph request settles or a validation reads.
// Correlating with the selected Release is what keeps a foreign lockfile from
// recompiling the workspace, and it is the rule the compiler itself applies when
// it decides which lockfile a request is about. The consequence is a stated
// bound: the lockfile of a Release other than the selected one moves nothing
// here, and a drift warning on it stays until that Release's graph is asked for.
//
// 🔴 WHICH FILE IS THE SELECTED RELEASE'S LOCKFILE IS READ FROM THE LANGUAGE
// SERVER, NEVER WORKED OUT HERE. Where a Release's lockfile sits is the
// compiler's rule, and the answer the selection was taken from names the
// lockfile beside the Release, so the path compared below is the compiler's
// own. Where no answer has named one, no `.lock` file is the selected Release's
// and none is followed: a path composed on this side from the Release's name
// would be a second statement of the compiler's rule, agreeing with it only
// until that rule moved.

// DOCUMENT_EXTENSION and LOCKFILE_EXTENSION name the two kinds of file the
// watcher reports, by extension and without the dot.
export const DOCUMENT_EXTENSION = 'yaml';
export const LOCKFILE_EXTENSION = 'lock';

// WATCHED_EXTENSIONS are the extensions the on-disk watcher reports. The
// watcher's pattern and the reading of every event below are both taken from
// this one list, so a kind cannot be reported without being read, or read
// without being reported.
export const WATCHED_EXTENSIONS: readonly string[] = [DOCUMENT_EXTENSION, LOCKFILE_EXTENSION];

// ON_DISK_PATTERN is the pattern the watcher is created over. It is a plain
// glob, so the editor matches it inside the folders the window has open and
// nowhere else: a document or a lockfile outside every open folder reaches no
// watcher.
export const ON_DISK_PATTERN = `**/*.{${WATCHED_EXTENSIONS.join(',')}}`;

// DiskChangeKind is what one event on disk is about.
export type DiskChangeKind = 'document' | 'lockfile';

// diskChangeKind reads one reported file as an authored document, as the
// selected Release's lockfile, or as neither. selectedLockfile is that lockfile's
// absolute path as the language server named it, or null where no Release is
// selected or no answer has named its lockfile.
export function diskChangeKind(file: string, selectedLockfile: string | null): DiskChangeKind | null {
  const ext = path.extname(file).slice(1);
  if (!WATCHED_EXTENSIONS.includes(ext)) { return null; }
  if (ext === LOCKFILE_EXTENSION) {
    return selectedLockfile !== null && path.resolve(file) === selectedLockfile ? 'lockfile' : null;
  }
  return 'document';
}

// DiskChangeDeps is everything the handler reaches outside itself. Each is
// passed in so a test drives every sequence of events with no editor and no
// server.
export interface DiskChangeDeps {
  // invalidate tells the language server that a file it may hold something for
  // has changed on disk.
  invalidate(file: string): void;
  // redraw redraws an open topology graph, and does nothing where none is open.
  redraw(): void;
  // revalidate validates every open document again.
  revalidate(): void;
  // shownRelease is the Release an open topology graph panel is showing, spelled
  // as selectedRelease spells it, or null where no panel is open.
  shownRelease(): string | null;
  // findingStands reports whether the Problems panel holds a finding the
  // language server published on file.
  findingStands(file: string): boolean;
  // selectedRelease is the selected Release as every request carries it —
  // relative to the workspace root — or null where none is selected.
  selectedRelease(): string | null;
  // selectedLockfile is the absolute path of that Release's lockfile, as the
  // language server named it in the answer the selection was taken from, or
  // null where none is selected or that answer named none.
  selectedLockfile(): string | null;
  // requestGraph sends the graph request for release and discards the answer.
  requestGraph(release: string): void;
  timer: Pick<TimerLike, 'setTimeout' | 'clearTimeout'>;
  // settleMs is how long the lockfile must go unwritten before what follows it
  // runs, which collapses the several writes of one pull into one.
  settleMs(): number;
}

// selectedLockfileOf is the selected Release together with the absolute path of
// its lockfile, or null where there is no Release or no lockfile named for it.
function selectedLockfileOf(deps: DiskChangeDeps): { release: string; lockfile: string } | null {
  const release = deps.selectedRelease();
  const lockfile = deps.selectedLockfile();
  if (release === null || lockfile === null) { return null; }
  return { release, lockfile };
}

// createDiskChangeHandler builds what the on-disk watcher calls with the path of
// every file it reports.
//
// The invalidation and the redraw run on every event, for a lockfile exactly as
// for a document, and the redraw collapses a burst of its own. What follows a
// lockfile waits for the burst to end, for the same reason the redraw does — one
// pull can reach the disk as more than one write, and it is one change — and it
// reads the state again when it runs rather than when the first write arrived:
// the selection may have moved, and a panel may have opened, closed or been
// shown another Release.
export function createDiskChangeHandler(deps: DiskChangeDeps): (file: string) => void {
  let pending: unknown;
  const followLockfile = (file: string): void => {
    const selected = selectedLockfileOf(deps);
    if (selected === null || selected.lockfile !== path.resolve(file)) { return; }
    deps.revalidate();
    if (deps.shownRelease() === selected.release || !deps.findingStands(file)) { return; }
    deps.requestGraph(selected.release);
  };
  return (file: string): void => {
    const kind = diskChangeKind(file, selectedLockfileOf(deps)?.lockfile ?? null);
    if (kind === null) { return; }
    deps.invalidate(file);
    deps.redraw();
    if (kind !== 'lockfile') { return; }
    if (pending !== undefined) { deps.timer.clearTimeout(pending); }
    pending = deps.timer.setTimeout(() => {
      pending = undefined;
      followLockfile(file);
    }, deps.settleMs());
  };
}
