// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type { TimerLike } from './binary-restart';
import { debounceEach } from './debounce';

// When an open document's text is sent to the language server, and what a press
// of the Catalog panel's Refresh waits for before it reads the list, decided
// without an editor.
//
// The language server learns what an unsaved buffer says from the validation the
// editor sends for it and from nothing else: a validation carries the document's
// text, and the entity index the Catalog panel lists reads the last text the
// server was sent for a document, where that text parses, ahead of the bytes on
// disk. So what the list reports for an open document follows the last of its
// validations the server has answered.
//
// 🔴 EACH DOCUMENT WAITS OUT ITS OWN PAUSE IN TYPING. A change is validated once
// the document it was made to has gone the window without another change, and a
// change to another document neither cancels that nor takes its place. With one
// window shared by every document, a change to a second document inside the
// first one's window would leave the first one's latest text unsent until it
// changed again, and the language server would go on answering for the text
// before it.
//
// 🔴 A PRESS OF THE CATALOG PANEL'S REFRESH READS THE BUFFERS AS THEY STAND AT
// THE PRESS. Every validation still waiting out a pause is sent at once, and the
// list is asked for only once every validation sent so far — those and any
// already in flight — has been answered. The server records what a validation
// carried where the index reads it before it answers, so the list read after the
// last answer names what each open document said at the press, however soon
// after a keystroke or an undo the press came. A validation sent after the press
// is not waited for: a reader typing on would otherwise hold the read back for as
// long as they typed.
//
// A refused validation settles as an answered one does, and so does one that
// sends nothing — no server running, or a document that is not YAML — so a press
// is never held by a request that will not be answered. The editor's client
// settles every request still waiting when its server stops, restarts or exits.
//
// Nothing here follows typing on its own. The list is read when a press asks for
// it, and the other readers of the list keep their own timing.

// DocumentValidationsDeps is everything the validations reach outside themselves.
// Each is passed in so a test drives every sequence of changes, answers and
// presses with no editor and no server.
export interface DocumentValidationsDeps<D> {
  // key names a document, so changes to one document are told from changes to
  // another.
  key(doc: D): string;
  // validate sends one document's validation, with its text as it stands when it
  // is sent. It settles once the language server has answered or refused it, and
  // at once where nothing is sent.
  validate(doc: D): Promise<void>;
  timer: Pick<TimerLike, 'setTimeout' | 'clearTimeout'>;
  // pauseMs is how long a document must go without a change before its
  // validation is sent, read at each change.
  pauseMs(): number;
}

// DocumentValidations is what the editor's side calls with each document event,
// and what a press of the Catalog panel's Refresh waits on.
export interface DocumentValidations<D> {
  // send validates a document now: one opening, or each open document swept
  // after a server becomes answerable or the selection moves.
  send(doc: D): void;
  // changed takes every change to an open document's text.
  changed(doc: D): void;
  // answered sends at once every validation still waiting out a pause in typing,
  // and settles once every validation sent so far has been answered or refused.
  answered(): Promise<void>;
}

// createDocumentValidations builds the validations of every open document.
export function createDocumentValidations<D>(deps: DocumentValidationsDeps<D>): DocumentValidations<D> {
  // unanswered holds each validation sent and not yet settled, removed as it
  // settles.
  const unanswered = new Set<Promise<void>>();
  const send = (doc: D): void => {
    const settled = deps.validate(doc).then(() => undefined, () => undefined);
    unanswered.add(settled);
    void settled.then(() => { unanswered.delete(settled); });
  };
  const pauses = debounceEach(send, deps.key, deps.pauseMs, deps.timer);
  return {
    send,
    changed: (doc: D): void => { pauses.call(doc); },
    answered: (): Promise<void> => {
      pauses.flush();
      return Promise.all([...unanswered]).then(() => undefined);
    },
  };
}

// readAfterValidations is a press of the Catalog panel's Refresh: the list is
// read once answered has settled, which is when every open document's text as it
// stood at the press has been answered for.
export async function readAfterValidations(answered: () => Promise<void>, read: () => void): Promise<void> {
  await answered();
  read();
}
