// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// Two of the extension's surfaces are documents it draws itself, and both run a
// command when a control in them is pressed. What it MEANS to accept such a
// press has one home here, and the reason it is one home rather than one per
// document is that the rule is a guard: two copies would agree on the day the
// second was written, and a divergence would show up as a document reaching a
// command its own content never offered — which nothing would report.
//
// It holds no editor type, so the rule is assertable without an extension host:
// a test sends the shapes a document could send and reads back what would be
// run. Each surface keeps the invocation itself, because that is where the
// editor is.

// PanelControlLog is where a rejected press is recorded. Narrow to the one call
// so any channel satisfies it.
export interface PanelControlLog {
  appendLine(text: string): void;
}

// PanelControlPress is an accepted press: the command it names, and the choice
// the reader made if the control offered one.
//
// The choice is carried here rather than read separately, because it arrives in
// the same message and is meaningless apart from the command it answers. It is
// null for the ordinary case — a control that runs when pressed — so a caller
// that never offers a choice reads one field and ignores the other.
export interface PanelControlPress {
  command: string;
  // option is the reader's answer where a control presented one beside itself.
  //
  // It is carried through as text and judged by whoever consumes it, not here.
  // What a given control's answers may be is a property of that control, and
  // this guard has no access to it — a check written here would be a second
  // statement of a set that lives with the operation, and the weaker of the two
  // copies is the one that would silently start disagreeing.
  option: string | null;
}

// panelControlCommand reports the press a message names, or null where the
// message is not one to act on.
//
// The command is checked against the commands the surface's own content offers
// before anything runs. Each panel is this extension's own document under a
// content policy that admits only its own script, so this is not a defence
// against a page that has been tampered with — it is the guarantee that a
// panel's reach stays exactly what it draws, so a control cannot be made to
// invoke something the reader was never offered.
//
// surface names the panel in the line a rejection writes, so a reader looking
// at the channel can tell which document asked.
export function panelControlCommand(
  message: unknown,
  offered: string[],
  surface: string,
  log: PanelControlLog,
): PanelControlPress | null {
  const named = typeof message === 'object' && message !== null
    ? (message as { type?: unknown; command?: unknown; option?: unknown })
    : null;
  if (!named || named.type !== 'run' || typeof named.command !== 'string') { return null; }
  if (!offered.includes(named.command)) {
    log.appendLine(
      `${surface}: the panel asked for ${named.command}, which none of its controls offers.`,
    );
    return null;
  }
  return {
    command: named.command,
    option: typeof named.option === 'string' ? named.option : null,
  };
}
