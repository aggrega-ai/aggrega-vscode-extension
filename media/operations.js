// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The Operations panel's script. It forwards a press, swaps in the body the
// extension composed, moves the roving tab stop, and remembers where the reader
// was. It composes no markup of its own, because the layout has one home and it
// is not this file.
(function () {
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
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      toggleSection(toggle.dataset.toggle, toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const control = event.target.closest('[data-command]');
    if (!control || control.disabled) { return; }
    vscode.postMessage({ type: 'run', command: control.dataset.command });
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
    state.scrollTop = window.scrollY;
    if (scrollSettling !== null) { clearTimeout(scrollSettling); }
    scrollSettling = setTimeout(() => { scrollSettling = null; remember(); }, 150);
  });

  // The extension re-composes the body whenever what it draws may have moved —
  // the shape, the two rows, or whether an entry can run — and posts it here.
  //
  // Replacing the fragment destroys focus, and this panel re-draws underneath a
  // reader rather than only when they ask: the control they were on is noted
  // before the swap and focus is returned to the matching one after. Focus is
  // returned ONLY where this document held it, so a re-drawing prompted by
  // something elsewhere in the editor does not take focus away from wherever the
  // reader actually is.
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'panel') { return; }
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

  if (state.scrollTop > 0) {
    window.scrollTo(0, state.scrollTop);
  }
})();
