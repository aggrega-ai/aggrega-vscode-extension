// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The welcome panel's script. It swaps in the fragments the extension composed,
// opens and closes a section, and forwards a press; it composes no markup of its
// own, because the layout has one home and it is not this file.
(function () {
  const vscode = acquireVsCodeApi();
  const panel = document.querySelector('main.welcome');
  const steps = document.getElementById('steps');
  const dismiss = document.getElementById('dismiss');

  // remember tells the extension which sections are closed, so the next list it
  // composes arrives already in the shape the reader left rather than in the
  // shape the panel opened in.
  //
  // WHAT IS CLOSED IS READ BACK OUT OF THE DOCUMENT rather than tracked in a
  // variable beside it. The expansion state is already recorded on each caret —
  // it has to be, because that is the attribute a screen reader reads the state
  // from — so a second copy here would be a second home for one fact, and the
  // two would agree until the day they did not.
  //
  // NOTHING IS PERSISTED. The arrangement a panel opens in is decided from the
  // conditions read when it is created, so a closure recorded into storage would
  // outlive the reading that justified it and reopen a panel with a satisfied
  // step folded away that is no longer satisfied.
  function remember() {
    const closed = Array.prototype.slice
      .call(steps.querySelectorAll('[data-toggle][aria-expanded="false"]'))
      .map((toggle) => toggle.getAttribute('data-toggle'));
    vscode.postMessage({ type: 'state', collapsed: closed });
  }

  // toggleStep opens or closes one section's explanation.
  //
  // The two attributes it moves are the only record of the state: the caret's
  // own direction is drawn from its expansion state in the stylesheet rather
  // than swapped here, so a caret cannot come to point the wrong way without the
  // state a screen reader reads being wrong in the same breath.
  //
  // The region is hidden rather than merely made invisible, so a closed
  // explanation leaves the accessibility tree instead of staying in it as text
  // the reader can neither see nor reach. The section's controls are outside
  // that region and are untouched, which is the shape: closing a section keeps
  // both ways forward and hides only the explanation.
  function toggleStep(toggle) {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    const prose = document.getElementById(toggle.getAttribute('aria-controls'));
    if (prose) { prose.hidden = !open; }
    remember();
  }

  // A press is forwarded by the command it names rather than by the step it sits
  // in, so a control does here exactly what the same command does anywhere else
  // in the extension. A caret names no command and is answered first, so it can
  // never be mistaken for one.
  //
  // THE LISTENER IS ON THE PANEL RATHER THAN ON EITHER FRAGMENT, and that is
  // what lets the extension replace a fragment without the presses inside it
  // going dead. The panel draws two regions whose content it swaps — the step
  // list and the control at its foot — and a listener bound to a region is lost
  // with the first replacement of that region. Bound to their common ancestor,
  // which is never replaced, one rule covers every control the panel draws
  // including any region added later.
  panel.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) { toggleStep(toggle); return; }
    const control = event.target.closest('[data-command]');
    if (!control) { return; }
    vscode.postMessage({ type: 'run', command: control.dataset.command });
  });

  // The extension re-composes a region whenever what it draws may have moved and
  // posts it here, naming which region it composed. Replacing the fragment is all
  // this does — a step that has stopped being met arrives already drawn as to do,
  // every section arrives already open or closed as the reader left it, and the
  // foot control arrives already saying what pressing it would now do, because
  // the extension composed each from the reading it had just taken.
  //
  // The two regions are posted separately because they move on different events:
  // a condition changing re-draws the steps and leaves the foot alone, and the
  // preference changing does the reverse.
  //
  // Each region is named in its own branch rather than looked up in a table
  // keyed by the message. A table indexed by an arriving name answers for every
  // name on the object's prototype as well as the two intended, so a message
  // naming one of those would resolve to something that is not a region at all.
  // 🔴 REPLACING THE FOOT DESTROYS WHATEVER IN IT HAD FOCUS, AND THE FOOT IS THE
  // ONE CONTROL HERE THAT IS ORDINARILY OPERATED FROM THE KEYBOARD. Pressing the
  // tick moves the preference, the preference moving re-composes the foot, and
  // the fragment that arrives is a different element from the one the press was
  // made on — so a reader working without a pointer is returned to the top of the
  // document by their own press, every time. Putting the focus back is what makes
  // the tick operable more than once.
  //
  // It is safe to name the control positionally because the foot region holds
  // exactly one, which the step list does not: restoring focus there would need
  // to know WHICH of a dozen controls the reader was on, and a guess would move
  // them somewhere they never went. So the step list is left as it is.
  function replaceFoot(html) {
    const held = dismiss.contains(document.activeElement);
    dismiss.innerHTML = html;
    if (!held) { return; }
    const control = dismiss.querySelector('[data-command]');
    if (control) { control.focus(); }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) { return; }
    if (message.type === 'steps') { steps.innerHTML = message.html; return; }
    if (message.type === 'dismiss') { replaceFoot(message.html); }
  });
})();
