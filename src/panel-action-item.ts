// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { PanelActionRow } from './panel-actions';

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
    item.command = { command: row.press.command, title: row.press.title };
  }
  return item;
}
