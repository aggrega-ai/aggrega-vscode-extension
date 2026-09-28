// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  ListPanelId,
  PANEL_ACTIONS,
  PanelActionDef,
  PanelActionId,
  commandIdFor,
  operationHint,
  panelActionReason,
} from './operation-groups';
import { PluginNode, PluginsRunDeps, pluginNodes } from './plugins-run';
import { RegistriesRunDeps, RegistryNode, registryNodes } from './registries-run';
import {
  WorkspaceCatalogNode,
  WorkspaceCatalogRunDeps,
  workspaceCatalogNodes,
} from './workspace-catalog-run';

// This module composes what each list panel's root holds: the operations acting
// on what that panel lists, first, and then the list itself.
//
// It imports no editor type, so every row a reader is shown — its label, its
// hover, what pressing it runs, and the reason it gives where it cannot run — is
// assertable without an extension host. The views map a row onto a tree item and
// decide nothing.

// PanelActionPress is what activating a row runs. It carries no argument, so an
// operation that asks a question asks it exactly as it does when invoked from
// the editor's own command index.
export interface PanelActionPress {
  command: string;
  // title is required by the editor on a binding and drawn nowhere on the row;
  // it reaches a reader only through the editor's own command surfaces, and it is
  // the operation's name.
  title: string;
}

// PanelActionRow is one operation drawn at the head of a list panel, with every
// string already decided.
export interface PanelActionRow {
  id: PanelActionId;
  label: string;
  // icon is a theme-icon id, so the row follows the reader's theme.
  icon: string;
  // description is the dimmed line beside the label: the reason the operation
  // cannot run, or empty where it can. It is drawn rather than left to the hover
  // because a tree row has no disabled state to show a reader it will not run —
  // so the one visible sign that it will not is the sentence saying why.
  description: string;
  // tooltip is the same hover the operation's control would carry anywhere.
  tooltip: string;
  // press is what activating the row runs, or null where the operation cannot
  // run. A row that cannot run binds nothing, as a disabled button runs nothing.
  press: PanelActionPress | null;
}

// PanelActionNode is one such row as a node of a list panel's tree.
export interface PanelActionNode {
  kind: 'action';
  row: PanelActionRow;
}

// rowForAction shapes one operation's row. Its availability is the Commands
// panel's own decision, asked through the one entry point for a list panel, and
// its hover is the one every control for that operation carries.
function rowForAction(action: PanelActionDef, workspaceAnchored: boolean): PanelActionRow {
  const reason = panelActionReason(action.id, workspaceAnchored);
  return {
    id: action.id,
    label: action.label,
    icon: action.icon,
    description: reason ?? '',
    tooltip: operationHint(action, reason),
    press: reason === null ? { command: commandIdFor(action), title: action.label } : null,
  };
}

// panelActionNodes shapes the head of one list panel, in the order it is drawn.
export function panelActionNodes(panel: ListPanelId, workspaceAnchored: boolean): PanelActionNode[] {
  return PANEL_ACTIONS[panel].map((action) => ({
    kind: 'action' as const,
    row: rowForAction(action, workspaceAnchored),
  }));
}

// RegistriesPanelNode, CatalogPanelNode and PluginsPanelNode are what each list
// panel's tree renders: an operation at its head, or a node of its list.
export type RegistriesPanelNode = PanelActionNode | RegistryNode;
export type CatalogPanelNode = PanelActionNode | WorkspaceCatalogNode;
export type PluginsPanelNode = PanelActionNode | PluginNode;

// RootReading is the one dependency the head and the list share.
interface RootReading {
  getWorkspaceRoot(): string | null;
}

// headedBy composes one panel's root: the operations at its head, then its list.
//
// 🔴 THE ANCHORED FOLDER IS READ ONCE, AND THE LIST IS HANDED THAT READING. The
// head's availability and the list's own "nothing anchored" row answer one
// question, so a panel whose head said an operation could run while its list said
// there was no workspace would be two readings disagreeing — which a second read
// could produce, and a single one cannot.
//
// The head is drawn in EVERY state the list can be in, its message rows
// included: the first thing a reader facing an empty list wants is the operation
// that fills it, and a head that came and went with the list's state would move
// every row beneath it as that state changed.
async function headedBy<Deps extends RootReading, Node>(
  panel: ListPanelId,
  deps: Deps,
  list: (deps: Deps) => Promise<Node[]>,
): Promise<Array<PanelActionNode | Node>> {
  const root = deps.getWorkspaceRoot();
  const listed = await list({ ...deps, getWorkspaceRoot: () => root });
  return [...panelActionNodes(panel, root !== null), ...listed];
}

// registriesPanelNodes is the Registries panel's root.
export function registriesPanelNodes(deps: RegistriesRunDeps): Promise<RegistriesPanelNode[]> {
  return headedBy('registries', deps, registryNodes);
}

// catalogPanelNodes is the Catalog panel's root.
export function catalogPanelNodes(deps: WorkspaceCatalogRunDeps): Promise<CatalogPanelNode[]> {
  return headedBy('catalog', deps, workspaceCatalogNodes);
}

// pluginsPanelNodes is the Plugins panel's root.
export function pluginsPanelNodes(deps: PluginsRunDeps): Promise<PluginsPanelNode[]> {
  return headedBy('plugins', deps, pluginNodes);
}
