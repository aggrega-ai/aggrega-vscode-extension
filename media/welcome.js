// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The welcome panel's script. It swaps in the step list the extension composed
// and forwards a press; it composes no markup of its own, because the layout has
// one home and it is not this file.
(function () {
  const vscode = acquireVsCodeApi();
  const steps = document.getElementById('steps');

  // A press is forwarded by the command it names rather than by the step it sits
  // in, so a control does here exactly what the same command does anywhere else
  // in the extension.
  steps.addEventListener('click', (event) => {
    const control = event.target.closest('[data-command]');
    if (!control) { return; }
    vscode.postMessage({ type: 'run', command: control.dataset.command });
  });

  // The extension re-composes the list whenever a condition may have moved, in
  // either direction, and posts it here. Replacing the fragment is all this does
  // — a step that has stopped being met arrives already drawn as outstanding.
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'steps') { return; }
    steps.innerHTML = message.html;
  });
})();
