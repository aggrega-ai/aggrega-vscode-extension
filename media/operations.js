// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The Commands panel's script. It forwards a press, swaps in the body the
// extension composed, moves the roving tab stop, opens and closes the menus a
// control offers beside itself, and remembers where the reader was. It composes
// no markup of its own, because the layout has one home and it is not this file.
//
// WHAT A MENU HERE HAS TO DO, AND WHY IT IS ALL WRITTEN OUT. The editor's own
// modal chooser supplied keyboard navigation, filtering as you type, focus
// trapping, dismissal, and the semantics a screen reader reads — none of which
// comes free to a menu drawn in a document. So each is written here, and none of
// it is provable without a running editor: what this file does is walked by
// hand. The composed document is what a test can read back, and it carries every
// attribute this file keys on.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const panel = document.getElementById('panel');

  // Which groups the reader has closed, which control they were on, and how far
  // they had scrolled. Closed rather than open is what is recorded, so an empty
  // list is the default shape: a reader who has closed nothing and a panel drawn
  // before anything was recorded are the same panel.
  const state = { collapsed: [], focused: null, scrollTop: 0 };
  const restored = vscode.getState();
  if (restored && Array.isArray(restored.collapsed)) {
    state.collapsed = restored.collapsed.filter((id) => typeof id === 'string');
  }
  if (restored && typeof restored.focused === 'string') {
    state.focused = restored.focused;
  }
  if (restored && typeof restored.scrollTop === 'number') {
    state.scrollTop = restored.scrollTop;
  }

  // The extension holds a copy of this so it can compose a re-drawing already in
  // the shape the reader left. Recording it here and posting it there are one
  // act: a record kept only on this side would leave the extension composing the
  // default and this side correcting it afterwards, and the frame in between is
  // the flicker the arrangement exists to remove.
  function remember() {
    vscode.setState({
      collapsed: state.collapsed,
      focused: state.focused,
      scrollTop: state.scrollTop,
    });
    vscode.postMessage({
      type: 'state',
      collapsed: state.collapsed,
      focused: state.focused,
      scrollTop: state.scrollTop,
    });
  }

  // controlsIn reports the controls a roving container's arrow keys move
  // between. A disabled control is left out because it cannot hold focus, so
  // stopping on one would strand the reader on a control that never receives the
  // keystroke.
  function controlsIn(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll('[data-focus-key]:not([disabled])'),
    );
  }

  // moveRoving puts the tab stop on one control and takes it off the rest, so
  // the container costs one tab stop however many controls it holds.
  function moveRoving(container, target) {
    if (!target) { return; }
    controlsIn(container).forEach((control) => {
      control.setAttribute('tabindex', control === target ? '0' : '-1');
    });
    target.focus();
    state.focused = target.dataset.focusKey || null;
    remember();
  }

  // --- the menu a control offers beside itself ----------------------------

  // The menu currently open, the control that opened it, and what the reader
  // has typed to narrow it. All three are one state: a menu is open for exactly
  // one control at a time, because a second open menu would leave two lists
  // claiming the keystrokes.
  let openMenu = null;
  let openedBy = null;
  let typed = '';

  // optionsIn reports everything in a menu the arrow keys walk and the filter
  // narrows. It covers a menu's CHOICES and its SETTINGS alike, because the
  // whole keyboard contract — the arrow keys, the ends, the dismiss key,
  // narrowing as the reader types — is owed to both: a menu whose entries the
  // arrow keys did not reach would be a menu only a pointer can use.
  //
  // What separates the two is what a press DOES, which the press handler reads
  // off the entry itself, and not whether the keys reach it.
  function optionsIn(menu) {
    return Array.prototype.slice.call(menu.querySelectorAll('[data-option], [data-dial]'));
  }

  // dialsSetIn reports which of a menu's settings are on, read from the document
  // rather than from a record kept here.
  //
  // 🔴 THE DOCUMENT IS THE ONE HOME OF THAT STATE, and holding a copy on this
  // side is the divergence to avoid: the extension composes the body — including
  // on the first drawing after the reader re-opens a panel it had put away — so
  // a variable here would start empty in front of a document that already said
  // otherwise, and the next press would post a set that silently turned an
  // adjustment back off.
  function dialsSetIn(menu) {
    return optionsIn(menu)
      .filter((entry) => entry.dataset.dial !== undefined
        && entry.getAttribute('aria-checked') === 'true')
      .map((entry) => entry.dataset.dial);
  }

  // shownOptionsIn reports the choices the reader can currently reach. A choice
  // the filter has put away is hidden, so it leaves the accessibility tree and
  // the arrow keys skip it — rather than being dimmed and still walked, which
  // would make the filter cosmetic.
  function shownOptionsIn(menu) {
    return optionsIn(menu).filter((option) => !option.hidden);
  }

  function statusOf(menu) {
    return menu.querySelector('[data-menu-status]');
  }

  // holdsDials reports whether a menu's entries are SETTINGS rather than
  // choices, read off the document the extension composed.
  //
  // 🔴 IT IS THE ONE HOME OF THAT QUESTION. Both the filter and the placement
  // turn on it, and a second reading of the attribute would go on agreeing with
  // this one right up until either behaviour was changed — at which point
  // nothing would report that the two had parted company.
  function holdsDials(menu) {
    return menu.dataset.menuDials !== undefined;
  }

  // narrows reports whether typing filters this menu.
  //
  // A menu of SETTINGS is not narrowed, and the absence is deliberate rather
  // than unimplemented. It holds a short set that is read whole, so there is no
  // long list for a filter to be worth having over — and it carries no status
  // line, so a filter here could put the only setting away with nothing saying
  // why. The arrow keys, the ends and the dismiss key are unaffected: those are
  // owed to every menu, and a menu only a pointer could use would be worse than
  // no menu.
  function narrows(menu) {
    return !holdsDials(menu);
  }

  function say(menu, text) {
    const status = statusOf(menu);
    if (!status) { return; }
    status.textContent = text;
    status.hidden = text === '';
  }

  // placeBeside puts the menu under the control that opened it, and above it
  // where there is no room below. Across, it hangs a menu of settings from the
  // right of its control and a menu of choices from the left, for the reason
  // given at the line that chooses between them.
  //
  // The position is measured at the moment of opening and is deliberately not
  // maintained: the panel scrolls and the reader resizes it, and re-measuring
  // on either would be a menu that follows the button around while the reader
  // is reading it. Both of those close the menu instead, which is what a menu
  // anchored to a control that has moved should do.
  function placeBeside(menu, control) {
    if (!control) { return; }
    const at = control.getBoundingClientRect();
    // Measured while shown, because a hidden element has no size to read.
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    const room = window.innerHeight - at.bottom;
    const top = room < height && at.top > height ? at.top - height : at.bottom;
    // 🔴 A MENU OF SETTINGS LINES UP ITS RIGHT EDGE WITH THE RIGHT EDGE OF THE
    // CARET THAT OPENS IT, and reaches back across the button it adjusts. The
    // caret is a chevron a few characters wide sitting at the right of the
    // control it belongs to, so a menu starting where the caret starts would
    // stand out to the right of everything it is about — a panel of adjustments
    // drawn beside the button rather than under it. Hanging it from the right
    // puts it over the button whose next press the settings apply to, which is
    // what says the two belong together.
    //
    // A menu of choices keeps the left edges. Its control is the operation's own
    // full-width button, so the left edges already agree with what the reader
    // pressed and there is nothing narrow to hang from.
    const from = holdsDials(menu) ? at.right - width : at.left;
    // Kept inside the panel's own width. The flow wraps, so a control near the
    // right edge of a narrow panel would otherwise open a menu the reader
    // cannot see the end of. It also catches a menu wider than the room to the
    // left of its caret, which would otherwise start off the near edge.
    const left = Math.max(0, Math.min(from, window.innerWidth - width));
    menu.style.top = Math.max(0, top) + 'px';
    menu.style.left = left + 'px';
  }

  // closeMenu puts the menu away and RETURNS FOCUS TO THE CONTROL THAT OPENED
  // IT. Returning focus is the part that matters: a menu that closed leaving
  // focus nowhere would drop a keyboard reader out of the panel entirely, with
  // nothing to say where they now are.
  function closeMenu() {
    if (!openMenu) { return; }
    const menu = openMenu;
    const control = openedBy;
    openMenu = null;
    openedBy = null;
    typed = '';
    menu.hidden = true;
    optionsIn(menu).forEach((option) => { option.hidden = false; });
    // A fetched menu goes back to the line it was composed with, so re-opening
    // it says it is reading again rather than showing the answer to a read that
    // has since been superseded.
    if (menu.dataset.menuFetched !== undefined) {
      optionsIn(menu).forEach((option) => { option.remove(); });
      say(menu, menu.dataset.menuPending || '');
    } else {
      say(menu, '');
    }
    if (control) {
      control.setAttribute('aria-expanded', 'false');
      control.focus();
    }
  }

  function openMenuFor(control) {
    const menu = document.getElementById(control.getAttribute('aria-controls') || '');
    if (!menu) { return; }
    // Whatever was open is put away first, so the keystrokes have one owner.
    closeMenu();
    openMenu = menu;
    openedBy = control;
    typed = '';
    menu.hidden = false;
    control.setAttribute('aria-expanded', 'true');
    placeBeside(menu, control);
    // A menu whose options are the workspace's asks for them now. Its composed
    // line already says it is reading, so the reader is never looking at an
    // empty list wondering whether that is the answer.
    if (menu.dataset.menuFetched !== undefined) {
      vscode.postMessage({ type: 'menu', command: menu.dataset.menuCommand });
    }
    const first = shownOptionsIn(menu)[0];
    // Focus moves into the menu where there is something to move onto. While a
    // fetched menu is still reading there is not, so focus stays on the
    // control — and the keystrokes are still the menu's, because the handler
    // reads the open menu rather than where the focus happens to be.
    if (first) { first.focus(); }
  }

  // narrow filters the menu by what the reader has typed.
  //
  // 🔴 THIS IS THE ONE THING THE MODAL CHOOSER GAVE AWAY THAT COSTS REAL
  // USABILITY ON A LONG LIST, so it is written rather than left out: a workspace
  // with many entities is exactly the case the two fetched menus meet. The match
  // is a substring over everything the choice draws — its name and its second
  // line — so a fragment from the middle of a name finds it, which is what the
  // chooser did. It is not a prefix jump, which finds only what a reader can
  // already spell from the start.
  //
  // The count is announced rather than merely drawn, because a reader who
  // cannot see the list shrinking has no other way to know the typing landed.
  function narrow(menu) {
    const query = typed.toLowerCase();
    const all = optionsIn(menu);
    all.forEach((option) => {
      option.hidden = query !== '' && (option.textContent || '').toLowerCase().indexOf(query) === -1;
    });
    const shown = shownOptionsIn(menu);
    if (query === '') {
      say(menu, '');
    } else {
      say(menu, shown.length + ' of ' + all.length + ' matching “' + typed + '”');
    }
    // Focus follows the filter rather than being stranded on a choice that has
    // just been put away.
    if (shown.length > 0 && shown.indexOf(document.activeElement) === -1) {
      shown[0].focus();
    }
    placeBeside(menu, openedBy);
  }

  // focusAt puts focus on one choice by position, clamped to the choices still
  // shown. Ends are addressed through this rather than through a step of
  // enormous size: from the control itself — which is where focus sits while a
  // fetched menu is reading — there is no current position to step from, and a
  // step would have to guess an end, which is how the first key press lands on
  // the wrong one.
  function focusAt(menu, index) {
    const shown = shownOptionsIn(menu);
    if (shown.length === 0) { return; }
    shown[Math.min(Math.max(index, 0), shown.length - 1)].focus();
  }

  function moveWithin(menu, step) {
    const shown = shownOptionsIn(menu);
    if (shown.length === 0) { return; }
    const at = shown.indexOf(document.activeElement);
    // From the control itself, the first press lands on the near end of the
    // list in the direction of travel rather than one past it.
    focusAt(menu, at === -1 ? (step > 0 ? 0 : shown.length - 1) : at + step);
  }

  // menuKey handles a keystroke while a menu is open, and reports whether it
  // took it. Everything it takes is stopped here: the workbench forwards every
  // keystroke from this document, so a key this menu acts on must not also
  // reach a keybinding.
  function menuKey(event) {
    if (!openMenu) { return false; }
    const menu = openMenu;
    // ESCAPE ALWAYS CLOSES, whether or not the reader has typed something. A
    // reader who presses it wants out of the menu, and an Escape that only
    // cleared a filter would leave them pressing it twice to leave — with no
    // way to tell which press they were on. Backspace is what unwinds the
    // typing.
    if (event.key === 'Escape') { closeMenu(); return true; }
    if (event.key === 'ArrowDown') { moveWithin(menu, 1); return true; }
    if (event.key === 'ArrowUp') { moveWithin(menu, -1); return true; }
    if (event.key === 'Home') { focusAt(menu, 0); return true; }
    if (event.key === 'End') { focusAt(menu, shownOptionsIn(menu).length - 1); return true; }
    if (event.key === 'Backspace') {
      if (!narrows(menu) || typed === '') { return false; }
      typed = typed.slice(0, -1);
      narrow(menu);
      return true;
    }
    // Tab leaves the menu rather than being trapped in it. The menu closes and
    // the keystroke is left alone, so focus goes wherever Tab would have taken
    // it from the control — which keeps the panel's one tab stop the panel's
    // one tab stop.
    if (event.key === 'Tab') { closeMenu(); return false; }
    // A single printable character narrows. Modifier combinations are left
    // alone: they are the reader's own keybindings, not typing.
    //
    // SPACE IS NOT ONE OF THEM. It is the platform's second activation key on a
    // button, so a choice under focus is taken by it, and taking that away to
    // spend it on filtering would remove a way of confirming that costs nothing
    // and that a reader may already rely on. The match is a substring, so a
    // multi-word choice is still reachable by a single word inside it — which is
    // what a space would have been used for. The alternative considered and
    // refused was letting a space continue a filter already begun and activate
    // otherwise: that is one key meaning two things depending on state the
    // reader cannot see, which is the fault this file rejects for the dismiss
    // key as well.
    if (narrows(menu)
      && event.key !== ' '
      && event.key.length === 1
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typed += event.key;
      narrow(menu);
      return true;
    }
    return false;
  }

  function toggleSection(group, open) {
    const closed = state.collapsed.filter((id) => id !== group);
    if (!open) { closed.push(group); }
    state.collapsed = closed;
    const head = panel.querySelector('[data-toggle="' + group + '"]');
    const body = document.getElementById('sec-' + group);
    if (head) {
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      const chevron = head.querySelector('.codicon');
      if (chevron) {
        chevron.classList.toggle('codicon-chevron-down', open);
        chevron.classList.toggle('codicon-chevron-right', !open);
      }
    }
    if (body) {
      // Hidden rather than merely invisible, so a closed group leaves the
      // accessibility tree instead of staying in it as content the reader cannot
      // see or reach.
      body.hidden = !open;
    }
    remember();
  }

  // A press is forwarded by the command it names rather than by where it sits,
  // so a control does here exactly what the same command does anywhere else in
  // the extension.
  panel.addEventListener('click', (event) => {
    // 🔴 A SETTING IS TURNED AND THE MENU STAYS OPEN, which is the whole
    // difference between a setting and a choice and is why it is answered
    // before one. A reader adjusting two of them would otherwise have to
    // re-open the menu between them, and nothing has run yet either way: these
    // reach the compiler on the next press of the button beside them, as
    // parameters of that one request.
    //
    // The two things that DO close this menu are the two a reader would expect:
    // pressing the button it belongs to, and pressing the caret again. Both are
    // below. Nothing else here closes it, and a third way would be a dismissal
    // the reader did not ask for.
    const dial = event.target.closest('[data-dial]');
    if (dial) {
      const menu = dial.closest('[data-menu-dials]');
      const on = dial.getAttribute('aria-checked') !== 'true';
      dial.setAttribute('aria-checked', on ? 'true' : 'false');
      const mark = dial.querySelector('.codicon');
      if (mark) {
        mark.classList.toggle('codicon-check', on);
        mark.classList.toggle('codicon-blank', !on);
      }
      // Posted so the extension composes the next drawing already carrying the
      // reader's setting, and so the press of the button beside it carries the
      // same set this document shows. It is NOT written into this document's
      // remembered state: an adjustment surviving a window reload would hand a
      // reader a registry reach and a lockfile write on a later build without
      // their seeing why they asked for it.
      if (menu) { vscode.postMessage({ type: 'dials', set: dialsSetIn(menu) }); }
      return;
    }
    // A choice is answered next, because it is the innermost remaining thing a
    // press can land on. It carries no command of its own — the command is on
    // the menu — so the operation and the answer leave together as one press.
    const option = event.target.closest('[data-option]');
    if (option) {
      const menu = option.closest('[data-menu-command]');
      closeMenu();
      if (menu) {
        vscode.postMessage({
          type: 'run',
          command: menu.dataset.menuCommand,
          option: option.dataset.option,
        });
      }
      return;
    }
    // The caret beside a button opens that button's adjustments, and pressing it
    // again puts them away — which is what a reader expects of anything that
    // opened on a press. It carries no command, so it is answered here rather
    // than falling through to the branch that runs one.
    const caret = event.target.closest('[data-dials]');
    if (caret) {
      if (openedBy === caret) { closeMenu(); } else { openMenuFor(caret); }
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      closeMenu();
      toggleSection(toggle.dataset.toggle, toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const control = event.target.closest('[data-command]');
    if (!control || control.disabled) { closeMenu(); return; }
    // A control that offers a choice opens it rather than running. Pressing the
    // same control again closes it, which is what a reader expects of anything
    // that opened on a press.
    if (control.dataset.menu !== undefined) {
      if (openedBy === control) { closeMenu(); } else { openMenuFor(control); }
      return;
    }
    closeMenu();
    vscode.postMessage({ type: 'run', command: control.dataset.command });
  });

  // CLICKING ANYWHERE ELSE CLOSES THE MENU. The listener is on the document
  // rather than on the panel, because "anywhere else" includes the padding
  // around the panel's own content — a press there is still the reader
  // dismissing the menu. It runs after the panel's own handler, so a press on a
  // choice or on the control that opened the menu has already been dealt with.
  document.addEventListener('click', (event) => {
    if (!openMenu) { return; }
    if (openMenu.contains(event.target)) { return; }
    if (openedBy && openedBy.contains(event.target)) { return; }
    closeMenu();
  });

  // The reader's place follows the control they last put focus on, whether they
  // arrived by keyboard or by pointer.
  panel.addEventListener('focusin', (event) => {
    const control = event.target.closest('[data-focus-key]');
    if (!control) { return; }
    const key = control.dataset.focusKey || null;
    if (key === state.focused) { return; }
    state.focused = key;
    remember();
  });

  panel.addEventListener('keydown', (event) => {
    // AN OPEN MENU OWNS THE KEYSTROKES, and it is asked first rather than after
    // the roving walk. Focus may still be on the control that opened it — that
    // is the case while a fetched menu is reading — so a handler keyed on where
    // the focus sits would let an arrow key walk the flow underneath an open
    // menu instead of walking the menu.
    if (menuKey(event)) {
      event.preventDefault();
      return;
    }
    const control = event.target.closest('[data-focus-key]');
    if (!control) { return; }
    const container = control.closest('[data-roving]');
    if (!container) { return; }
    const vertical = container.dataset.orientation === 'vertical';

    // In the section shape the sideways keys open and close a group, as they do
    // in a tree, rather than moving between controls.
    if (vertical && control.dataset.toggle !== undefined) {
      if (event.key === 'ArrowRight' && control.getAttribute('aria-expanded') !== 'true') {
        toggleSection(control.dataset.toggle, true);
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowLeft' && control.getAttribute('aria-expanded') === 'true') {
        toggleSection(control.dataset.toggle, false);
        event.preventDefault();
        return;
      }
    }

    const controls = controlsIn(container);
    const at = controls.indexOf(control);
    if (at === -1) { return; }
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    let target = null;
    if (event.key === next) { target = controls[Math.min(at + 1, controls.length - 1)]; }
    if (event.key === previous) { target = controls[Math.max(at - 1, 0)]; }
    if (event.key === 'Home') { target = controls[0]; }
    if (event.key === 'End') { target = controls[controls.length - 1]; }
    if (!target) { return; }
    // The workbench forwards every keystroke from this document, so a key this
    // panel acts on is stopped here rather than also reaching a keybinding.
    event.preventDefault();
    moveRoving(container, target);
  });

  // A scroll gesture fires many events, and each one would otherwise send the
  // extension a message. What matters is where the reader ended up, so the
  // recording is collapsed to one call after the scrolling stops.
  let scrollSettling = null;
  window.addEventListener('scroll', () => {
    // A menu is anchored to where its control was when it opened, so scrolling
    // it out from under the menu is the moment to put the menu away rather than
    // to re-measure it — a menu that chased its control around while the reader
    // was reading it would be worse than one that closed.
    closeMenu();
    state.scrollTop = window.scrollY;
    if (scrollSettling !== null) { clearTimeout(scrollSettling); }
    scrollSettling = setTimeout(() => { scrollSettling = null; remember(); }, 150);
  });

  // The flow re-wraps at whatever width the reader drags the panel to, which
  // moves every control. An open menu is put away for the same reason a scroll
  // puts it away.
  window.addEventListener('resize', () => { closeMenu(); });

  // The extension re-composes the body whenever what it draws may have moved —
  // the shape, the three rows, or whether an entry can run — and posts it here.
  //
  // Replacing the fragment destroys focus, and this panel re-draws underneath a
  // reader rather than only when they ask: the control they were on is noted
  // before the swap and focus is returned to the matching one after. Focus is
  // returned ONLY where this document held it, so a re-drawing prompted by
  // something elsewhere in the editor does not take focus away from wherever the
  // reader actually is.
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) { return; }

    // The answer to a fetched menu's request. It is applied only while that
    // same menu is still the open one: a reader who closed it and pressed
    // something else has moved on, and filling a closed menu would leave an
    // answer waiting behind a control the reader is no longer at.
    if (message.type === 'menu-options') {
      if (!openMenu || openMenu.dataset.menuCommand !== message.command) { return; }
      const menu = openMenu;
      optionsIn(menu).forEach((option) => { option.remove(); });
      say(menu, '');
      (message.options || []).forEach((option) => {
        const button = document.createElement('button');
        button.className = 'op-menu-option';
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('tabindex', '-1');
        button.dataset.option = option.value;
        button.title = option.detail ? option.label + ' — ' + option.detail : option.label;
        const label = document.createElement('span');
        label.className = 'op-menu-label';
        // Assigned as text, never as markup: these are an author's own entity
        // names and paths, and neither is this document's to interpret.
        label.textContent = option.label;
        button.appendChild(label);
        if (option.detail) {
          const detail = document.createElement('span');
          detail.className = 'op-menu-detail';
          detail.textContent = option.detail;
          button.appendChild(detail);
        }
        menu.appendChild(button);
      });
      // Whatever the reader typed while the read was in flight still applies,
      // so their narrowing is not thrown away by the answer arriving.
      narrow(menu);
      const first = shownOptionsIn(menu)[0];
      if (first) { first.focus(); }
      return;
    }

    // The read had nothing to offer, or refused. The menu closes and the
    // extension's own message is what tells the reader why — one sentence for
    // that state rather than a second wording of it inside the menu.
    if (message.type === 'menu-refused') {
      if (openMenu && openMenu.dataset.menuCommand === message.command) { closeMenu(); }
      return;
    }

    if (message.type !== 'panel') { return; }
    // The body is about to be replaced, so every menu in it is about to stop
    // existing. It is closed first, which is what puts focus back on a control
    // the swap can then match by key.
    closeMenu();
    const active = document.activeElement;
    const held = panel.contains(active) ? active.closest('[data-focus-key]') : null;
    const key = held ? held.dataset.focusKey : null;
    panel.innerHTML = message.html;
    if (typeof message.scrollTop === 'number') {
      window.scrollTo(0, message.scrollTop);
    }
    if (key === null || key === undefined) { return; }
    const returning = panel.querySelector('[data-focus-key="' + key + '"]:not([disabled])');
    if (returning) { returning.focus(); }
  });

  // The flow re-wraps itself at whatever width the reader drags the panel to,
  // and it does that in the browser's own layout — so nothing here observes a
  // resize or waits for the icon font. There is no measurement to re-take.

  if (state.scrollTop > 0) {
    window.scrollTo(0, state.scrollTop);
  }
})();
