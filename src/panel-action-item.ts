// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { PanelActionPress, PanelActionRow } from './panel-actions';

// panelActionItem maps an already-shaped row at the head of a list panel onto a
// tree item. It is the one such mapping, used by all three list panels, and it
// decides nothing: every string, and whether the row runs anything, arrives on
// the row.
//
// The item carries no context value, so none of the operations a list binds to
// its rows can appear on it — its subject is the whole list, not a member of it.
export function panelActionItem(row: PanelActionRow): vscode.TreeItem {
  const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(row.icon);
  item.tooltip = row.tooltip;
  if (row.description !== '') {
    item.description = row.description;
  }
  if (row.press !== null) {
    item.command = commandFor(row.press);
  }
  return item;
}

// PanelMessage is a row a list panel draws in place of its list, saying why
// there is nothing to list: its line, the hover beside it, and what pressing it
// runs where there is something a reader can do about it.
export interface PanelMessage {
  label: string;
  detail?: string;
  press?: PanelActionPress;
}

// panelMessageItem maps such a row onto a tree item. It is the one such mapping,
// used by all three list panels, and like the one above it decides nothing.
//
// The item carries no context value either: a message names no member of the
// list, so none of the operations bound to the list's rows can appear on it.
export function panelMessageItem(node: PanelMessage): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  if (node.detail) {
    item.tooltip = node.detail;
  }
  if (node.press) {
    item.command = commandFor(node.press);
  }
  return item;
}

function commandFor(press: PanelActionPress): vscode.Command {
  return press.arguments
    ? { command: press.command, title: press.title, arguments: [...press.arguments] }
    : { command: press.command, title: press.title };
}
