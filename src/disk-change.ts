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
// topology graph. An authored document also has the Catalog panel read its list
// again, and a lockfile, which declares no entity, does not.
//
// 🔴 THE LIST IS READ AGAIN ONLY ONCE THE LANGUAGE SERVER HAS ANSWERED THE
// INVALIDATION. The list is the compiler's entity index, and the index reads the
// documents the language server holds before it reads the disk: a document the
// editor sent is reported as it was sent, whether or not the file is still
// there. The server answers the invalidation after it has dropped that entry, and
// it may handle two requests at once, so a list asked for any sooner can still
// report a deleted file. A change is followed as a creation and a deletion are,
// since it can rename an entity or change its kind, and a burst of them — a
// checkout, a copy of several files — is one read of the list.
//
// A document the editor closes asks for that read too, and for nothing else. The
// editor tells the language server to drop the text it sent for the document,
// after which the compiler reads that file as it stands on disk; until then the
// list reports the text — an unsaved rename, or a file deleted on disk whose
// text was sent again after its deletion was followed. The read waits for that
// drop exactly as it waits for a watcher's, and it is the same read: one count
// holds both, so a close inside a burst on disk is still one read, after the
// last drop of either. A close changes nothing on disk, so it redraws no graph.
//
// A lockfile also asks for what it alone feeds:
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
  // has changed on disk. It settles once the server has answered, by when the
  // file's entry is dropped, or once the request has failed.
  invalidate(file: string): Promise<void>;
  // invalidateClosed tells the language server that the editor has closed a
  // document, so it drops what it holds for that one file — the text the editor
  // sent and the findings computed from it — and keeps what it holds for the
  // rest of the workspace. It settles as invalidate does.
  invalidateClosed(file: string): Promise<void>;
  // redraw redraws an open topology graph, and does nothing where none is open.
  redraw(): void;
  // refreshCatalog has the Catalog panel read its list again.
  refreshCatalog(): void;
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
  // settleMs is how long a burst must go quiet before what follows it runs: the
  // lockfile unwritten, which collapses the several writes of one pull into one,
  // and the documents unreported with every invalidation answered, which
  // collapses a checkout into one read of the list.
  settleMs(): number;
}

// DiskWatcher is what the handler needs of the editor's file-system watcher: the
// three events it reports, each naming a file.
export interface DiskWatcher {
  onDidCreate(listener: (uri: { fsPath: string }) => unknown): unknown;
  onDidChange(listener: (uri: { fsPath: string }) => unknown): unknown;
  onDidDelete(listener: (uri: { fsPath: string }) => unknown): unknown;
}

// subscribeToWatcher hands every file the watcher reports — created, changed or
// deleted — to report. The three are one call because each is the same fact to
// everything that follows: a file the compiler reads is not what it was.
export function subscribeToWatcher(watcher: DiskWatcher, report: (file: string) => void): void {
  const reported = (uri: { fsPath: string }): void => { report(uri.fsPath); };
  watcher.onDidCreate(reported);
  watcher.onDidChange(reported);
  watcher.onDidDelete(reported);
}

// selectedLockfileOf is the selected Release together with the absolute path of
// its lockfile, or null where there is no Release or no lockfile named for it.
function selectedLockfileOf(deps: DiskChangeDeps): { release: string; lockfile: string } | null {
  const release = deps.selectedRelease();
  const lockfile = deps.selectedLockfile();
  if (release === null || lockfile === null) { return null; }
  return { release, lockfile };
}

// DiskChangeHandler is what the editor's side calls with each file whose content,
// as the compiler reads it, is no longer what it was.
export interface DiskChangeHandler {
  // changedOnDisk takes the path of every file the on-disk watcher reports.
  changedOnDisk(file: string): void;
  // documentClosed takes the path of every YAML document the editor closes.
  documentClosed(file: string): void;
}

// settledEither settles when invalidation does, answered or refused alike.
function settledEither(invalidation: Promise<void>): Promise<void> {
  return invalidation.then(() => undefined, () => undefined);
}

// createDiskChangeHandler builds what the on-disk watcher and the close of a
// document call.
//
// The invalidation and the redraw run on every event on disk, for a lockfile
// exactly as for a document, and the redraw collapses a burst of its own. What
// follows a lockfile waits for the burst to end, for the same reason the redraw
// does — one pull can reach the disk as more than one write, and it is one
// change — and it reads the state again when it runs rather than when the first
// write arrived: the selection may have moved, and a panel may have opened,
// closed or been shown another Release.
//
// The Catalog panel's list is read again once every invalidation sent for a
// document — reported on disk or closed in the editor — has settled and the
// window has passed with no document reported or closed since, so a burst is one
// read and that read follows the last drop of it.
//
// 🔴 A FAILED INVALIDATION SETTLES AS AN ANSWERED ONE DOES. The list read after
// it is no worse than no read at all: at most it reports that one file as the
// server still holds it, and where the request failed because no server could
// take it, the panel says the compiler cannot be asked, or a server started since
// answers from what it has read itself. Waiting on a failed request instead would
// leave the count above zero, and the panel would follow the disk no more. The
// same holds for a request left in flight: the editor's client settles every
// request still waiting when its server stops, restarts or exits.
export function createDiskChangeHandler(deps: DiskChangeDeps): DiskChangeHandler {
  let pending: unknown;
  // unsettled counts the invalidations sent for documents that have not yet
  // settled, and catalogPending is the read of the list waiting out the window.
  let unsettled = 0;
  let catalogPending: unknown;
  const followLockfile = (file: string): void => {
    const selected = selectedLockfileOf(deps);
    if (selected === null || selected.lockfile !== path.resolve(file)) { return; }
    deps.revalidate();
    if (deps.shownRelease() === selected.release || !deps.findingStands(file)) { return; }
    deps.requestGraph(selected.release);
  };
  const holdCatalog = (): void => {
    if (catalogPending !== undefined) { deps.timer.clearTimeout(catalogPending); }
    catalogPending = undefined;
  };
  const documentSettled = (): void => {
    unsettled--;
    if (unsettled > 0) { return; }
    holdCatalog();
    catalogPending = deps.timer.setTimeout(() => {
      catalogPending = undefined;
      deps.refreshCatalog();
    }, deps.settleMs());
  };
  // readListAfter counts one document's invalidation until it settles, and holds
  // back a read already waiting out the window. Both kinds of trigger come through
  // here, which is what makes them one read.
  const readListAfter = (settled: Promise<void>): void => {
    unsettled++;
    holdCatalog();
    void settled.then(documentSettled);
  };
  return {
    changedOnDisk: (file: string): void => {
      const kind = diskChangeKind(file, selectedLockfileOf(deps)?.lockfile ?? null);
      if (kind === null) { return; }
      // Both outcomes are taken, so a refused request is never left unhandled,
      // whichever kind of file it was sent for.
      const settled = settledEither(deps.invalidate(file));
      deps.redraw();
      if (kind === 'document') {
        readListAfter(settled);
        return;
      }
      if (pending !== undefined) { deps.timer.clearTimeout(pending); }
      pending = deps.timer.setTimeout(() => {
        pending = undefined;
        followLockfile(file);
      }, deps.settleMs());
    },
    documentClosed: (file: string): void => {
      readListAfter(settledEither(deps.invalidateClosed(file)));
    },
  };
}
