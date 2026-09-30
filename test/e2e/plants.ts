// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

// The plants: each one edit to the scratch copy of the extension under test, or
// to a scenario's copy of its folder, and never to the repository.
//
// 🔴 A PLANT SHOWS THAT A CHECK CAN REFUSE, AND A CHECK THAT CANNOT REFUSE PROVES
// NOTHING BY PASSING. A plant that turns a check red shows the check reads the
// thing it names. A check that fails on the product as it stands has refused
// already, and what it has not shown is that it can pass; for such a check the
// catalogue holds, where one exists, a one-edit correction of the behaviour it
// names, which must turn it green — and the product as it stands is then the plant
// that turns it red again.
//
// An edit is refused unless the text it replaces occurs exactly once in its
// file, so a plant can neither land on a line nobody meant nor apply silently to
// a file that has moved on. `run.js plants` checks every plant against the
// compiled extension without launching anything, and `run.js suite --plant
// <name>` runs the plant's scenario with the edit made and reports what moved.

// Plant is one edit and what it must do.
export interface Plant {
  name: string;
  scenario: string;
  // checks are the checks the edit is made for. The plant run ends once each of
  // them has reported.
  checks: readonly string[];
  // moves is what the edit must do to those checks: turn them red, or, for a
  // correction of a check that fails on the product as it stands, turn them
  // green.
  moves: 'red' | 'green';
  // target is the copy the edit is made in: the extension under test, or the
  // folder the scenario opens.
  target: 'extension' | 'folder';
  // file is relative to that copy's root.
  file: string;
  find: string;
  replace: string;
  // says is what the edit does, in words.
  says: string;
}

const DAEMON = 'out/src/daemon.js';
const EXTENSION = 'out/src/extension.js';
const SEARCH_RUN = 'out/src/catalog-search-run.js';
const OPERATIONS = 'out/src/operations.js';
const RENDER = 'out/src/operations-render.js';
const PANEL_SCRIPT = 'media/operations.js';
const REGISTRATION_OUTCOME = 'out/src/registration-outcome.js';
const INDEX_REQUEST = 'out/src/registry-index-request.js';

const CONTEXT_ROW_LABEL = {
  file: 'out/src/selector-levels.js',
  find: "    project: 'Project folder',",
  replace: "    project: 'Project directory',",
  says: 'the first context row is labelled "Project directory"',
} as const;

const REFRESH_GRAPH = '        refreshGraphView();\n';

// The workspace catalog panel's view and its row model, and the language-server
// item's model.
const CATALOG_VIEW = 'out/src/workspace-catalog-view.js';
const CATALOG_RUN = 'out/src/workspace-catalog-run.js';
const DAEMON_STATUS = 'out/src/daemon-status.js';

// The compiled lines composing a build request from the Release selected.
const BUILD_DIALS = 'out/src/build-dials.js';
const BUILD_RELEASE_PARAM = '    const params = {\n        release,\n        [exports.AUTO_PULL_DIAL]: on.includes(exports.AUTO_PULL_DIAL),';

// The compiled line binding a list panel's head row to its command, and the same
// line binding nothing to the row of one operation — as a row that cannot run
// binds nothing, but here with no reason drawn beside it.
const PANEL_ACTIONS_JS = 'out/src/panel-actions.js';
const HEAD_ROW_PRESS = '        press: reason === null ? { command: (0, operation_groups_1.commandIdFor)(action), title: action.label } : null,';
const headRowBoundToNothing = (id: string): { file: string; find: string; replace: string } => ({
  file: PANEL_ACTIONS_JS,
  find: HEAD_ROW_PRESS,
  replace: HEAD_ROW_PRESS.replace('reason === null ?', `reason === null && action.id !== '${id}' ?`),
});

// The topology graph panel: its drawing, the projection of what is attached and
// of what may attach, the side that serves its requests, and the edit an attach
// composes.
const GRAPH_SCRIPT = 'media/graph.js';
const ATTACHMENTS_MODEL = 'media/attachments-model.js';
const CANDIDATES_MODEL = 'media/candidates-model.js';
const GRAPH_VIEW = 'out/src/graph-view.js';
const ATTACHMENT_EDIT = 'out/src/attachment-edit.js';

// The compiled line that inserts an attach's entry into the document.
const ENTRY_INSERT = '        edit.insert(uri, new vscode.Position(at.line, at.character), text);';

// The compiled line writing no container key the document lacks, and the line
// that saves the document after the edit — both reused by the scenarios that
// attach, each of which holds its own plant.
const NO_CONTAINER_KEYS = { file: ATTACHMENT_EDIT, find: 'const missing = insertion.missingContainerKeys ?? [];', replace: 'const missing = [];', says: 'an attach writes no container key the document lacks, so an entry for a component with no features key lands directly under the component\'s own block' } as const;
const SAVED_AFTER_EDIT = {
  file: GRAPH_VIEW,
  find: '        await vscode.window.showTextDocument(doc, { preview: false });',
  replace: '        await doc.save();\n        await vscode.window.showTextDocument(doc, { preview: false });',
  says: 'an attach saves the document it edited, so the entry reaches the file on disk',
} as const;

export const PLANTS: readonly Plant[] = [
  // ---- the gateway folder ----
  {
    name: 'stamp-names-another-build', scenario: 'gateway', checks: ['welcome-page.names-the-extension-build'], moves: 'red', target: 'extension',
    file: 'out/build-version.json', find: '"version": "', replace: '"version": "another-build-',
    says: 'the copy\'s build stamp names another build',
  },
  {
    name: 'server-started-by-file-name', scenario: 'gateway', checks: ['language-server.runs-the-binary-under-test'], moves: 'red', target: 'extension',
    file: DAEMON,
    find: 'this.proc = (0, child_process_1.spawn)(launching, buildServeArgs(this.settings), {',
    replace: "this.proc = (0, child_process_1.spawn)(require('path').basename(launching), buildServeArgs(this.settings), {",
    says: 'the language server is started by the binary\'s file name alone, so what runs is whatever that name finds on the path rather than the configured file',
  },
  { name: 'context-row-renamed', scenario: 'gateway', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'setting-drawn-with-another-description', scenario: 'gateway', checks: ['settings.build-on-inspect-label-is-derived-from-its-key'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        "aggrega.server.buildOnInspect": {\n          "type": "boolean",',
    replace: '        "aggrega.server.buildOnInspect": {\n          "markdownDescription": "A description other than the one the manifest declares.",\n          "type": "boolean",',
    says: 'the setting is given a markdown description, which the settings editor draws in place of the declared one',
  },
  {
    name: 'setting-on-by-default', scenario: 'gateway', checks: ['settings.build-on-inspect-toggle-is-kept-in-the-user-settings'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '          "default": false,\n          "description": "When true, the daemon runs the build\'s analysis while inspecting an IR graph',
    replace: '          "default": true,\n          "description": "When true, the daemon runs the build\'s analysis while inspecting an IR graph',
    says: 'the build-analysis setting is declared on by default',
  },
  {
    name: 'inspection-flag-always', scenario: 'gateway', checks: ['language-server.inspection-flag-follows-the-setting'], moves: 'red', target: 'extension',
    file: DAEMON, find: '    if (settings.buildOnInspect) {', replace: '    if (true) {',
    says: 'the inspection flag is passed to the language server whatever the setting says',
  },
  {
    name: 'restart-clears-the-build-layers', scenario: 'gateway', checks: ['problems.authoring-complaint-and-render-advisory-under-two-sources'], moves: 'green', target: 'extension',
    file: EXTENSION,
    find: '        await daemon.restart();\n        return true;',
    replace: '        await daemon.restart();\n        for (const source of diagnosticCollections?.known() ?? []) { if (source !== diagnostics_shape_1.DIAGNOSTIC_SOURCE_FALLBACK) { diagnosticCollections?.for(source).clear(); } }\n        return true;',
    says: 'a restart of the language server clears every layer of findings but the authored documents\' own, so a layer the restarted server no longer computes does not outlive it',
  },
  {
    name: 'graph-not-redrawn-on-disk-change', scenario: 'gateway', checks: ['problems.render-advisory-clears-on-save-and-not-on-an-unsaved-edit'], moves: 'red', target: 'extension',
    file: EXTENSION, find: REFRESH_GRAPH, replace: '',
    says: 'an open graph is not redrawn when a document changes on disk',
  },
  {
    name: 'graph-shown-on-every-disk-change', scenario: 'gateway', checks: ['problems.render-advisory-does-not-return-without-the-graph'], moves: 'red', target: 'extension',
    file: EXTENSION, find: REFRESH_GRAPH, replace: `${REFRESH_GRAPH}        void vscode.commands.executeCommand('aggrega.graph.show');\n`,
    says: 'the graph is shown, and so the Release compiled, whenever a document changes on disk, whether or not a graph panel is open',
  },
  {
    name: 'lockfile-not-watched', scenario: 'gateway', checks: ['problems.lockfile-drift-clears-after-pull'], moves: 'red', target: 'extension',
    file: 'out/src/disk-change.js',
    find: 'exports.WATCHED_EXTENSIONS = [exports.DOCUMENT_EXTENSION, exports.LOCKFILE_EXTENSION];',
    replace: 'exports.WATCHED_EXTENSIONS = [exports.DOCUMENT_EXTENSION];',
    says: 'the on-disk watcher no longer reports a lockfile, so a pull writing the selected Release\'s lockfile neither redraws an open graph nor asks for one',
  },
  {
    name: 'named-lockfile-ignored', scenario: 'gateway', checks: ['problems.lockfile-drift-clears-after-pull'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '        lockfile: () => lockfile,', replace: '        lockfile: () => null,',
    says: 'the selection answers no lockfile for the selected Release although the language server named one, so a pull writing that lockfile is followed by nothing',
  },
  {
    name: 'retired-key-reaches-the-server', scenario: 'gateway', checks: ['language-server.retired-setting-key-is-inert'], moves: 'red', target: 'extension',
    file: DAEMON, find: "    const args = ['serve'];",
    replace: "    const args = ['serve', ...(require('vscode').workspace.getConfiguration('aggrega.server').get('renderDiagnostics') ? ['--render-diagnostics'] : [])];",
    says: 'the retired key, when set, adds --render-diagnostics to the language server\'s command line',
  },
  // ---- the storefront folder ----
  { name: 'context-row-renamed-storefront', scenario: 'storefront', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'no-respawn', scenario: 'storefront', checks: ['language-server.restarts-after-a-kill'], moves: 'red', target: 'extension',
    file: DAEMON, find: '        if (!this.respawnTracker.shouldRespawn()) {', replace: '        if (true) {',
    says: 'the language server is not started again after an unexpected exit',
  },
  {
    name: 'ranges-one-line-down', scenario: 'storefront', checks: ['problems.authoring-mistake-lands-on-its-line-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: 'out/src/diagnostics-shape.js',
    find: '        startLine: line,\n        startChar: character,\n        endLine: hasEnd ? zeroBasedFromOneBased(d.end_line) : line,',
    replace: '        startLine: line + 1,\n        startChar: character,\n        endLine: hasEnd ? zeroBasedFromOneBased(d.end_line) + 1 : line + 1,',
    says: 'every finding\'s range is moved one line down',
  },
  {
    name: 'message-cut-at-its-note', scenario: 'storefront', checks: ['problems.cascade-names-the-entity-that-broke'], moves: 'red', target: 'extension',
    file: 'out/src/diagnostics-shape.js', find: '        message: d.message,', replace: "        message: d.message.split('; note:')[0],",
    says: 'a finding\'s message is cut at its note, which drops the part naming the file that broke',
  },
  {
    name: 'facet-row-dropped', scenario: 'storefront', checks: ['catalog-search.palette-shows-its-facets'], moves: 'red', target: 'extension',
    file: SEARCH_RUN,
    find: "        {\n            action: 'pluginType',\n            label: 'Plugin type',\n            description: pluginType || exports.ANY_VALUE_LABEL,\n            detail: 'Keep plugins attached at this socket',\n        },\n",
    replace: '',
    says: 'the search palette\'s Plugin type row is dropped',
  },
  {
    name: 'missing-registry-read-as-no-matches', scenario: 'storefront', checks: ['catalog-search.no-registry-answer-says-so'], moves: 'red', target: 'extension',
    file: SEARCH_RUN, find: '    if (doc.registriesConfigured === false) {', replace: '    if (false) {',
    says: 'a search with no registry configured is answered as a search that matched nothing',
  },
  {
    name: 'filter-not-kept', scenario: 'storefront', checks: ['catalog-search.filter-is-kept-until-reset'], moves: 'red', target: 'extension',
    file: 'out/src/catalog-views.js',
    find: '        void searchPublished(deps, kept).then(undefined, (err) => {',
    replace: '        void searchPublished(deps, { filter: (0, catalog_search_run_1.emptyFilter)() }).then(undefined, (err) => {',
    says: 'every search opens on an empty filter, whatever the last one was run with',
  },
  {
    name: 'headings-without-count', scenario: 'storefront', checks: ['catalog-view.lists-the-workspace-entities-by-kind'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-catalog-view.js', find: 'new vscode.TreeItem(`${node.label} (${node.rows.length})`,', replace: 'new vscode.TreeItem(node.label,',
    says: 'the Catalog view\'s kind headings are drawn without their count',
  },
  {
    name: 'refresh-redraws-nothing', scenario: 'storefront', checks: ['catalog-view.new-entity-appears-after-refresh'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-catalog-view.js', find: '    refresh() {\n        this.changed.fire();\n    }', replace: '    refresh() {\n    }',
    says: 'refreshing the Catalog view redraws nothing, so it keeps the rows it first read',
  },
  {
    name: 'deleted-file-not-followed', scenario: 'storefront', checks: ['catalog-view.deleted-entity-row-leaves-at-once'], moves: 'red', target: 'extension',
    file: 'out/src/disk-change.js', find: '            deps.refreshCatalog();\n', replace: '',
    says: 'the Catalog view no longer reads its list again once the language server has dropped a document, whether the file was deleted on disk or closed in the editor, so it keeps a row for a document that is gone until its refresh is pressed',
  },
  {
    name: 'created-file-not-followed', scenario: 'storefront', checks: ['catalog-view.created-file-appears-without-a-press'], moves: 'red', target: 'extension',
    file: 'out/src/disk-change.js', find: '    watcher.onDidCreate(reported);\n', replace: '',
    says: 'the on-disk watcher\'s report of a created file reaches nothing, so a document written into the folder from outside the editor is listed only once refresh is pressed',
  },
  {
    name: 'deleted-closed-file-not-followed', scenario: 'storefront', checks: ['catalog-view.deleted-closed-file-row-leaves-without-a-press'], moves: 'red', target: 'extension',
    file: 'out/src/disk-change.js', find: '    watcher.onDidDelete(reported);\n', replace: '',
    says: 'the on-disk watcher\'s report of a deleted file reaches nothing, so a document no editor holds keeps its row once its file is deleted from outside the editor',
  },
  {
    name: 'refusal-names-only-the-status', scenario: 'storefront', checks: ['catalog-view.refused-validation-ends-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: 'out/src/cli-run.js', find: "    return said.trim() === '' ? `${status}.` : `${status}: ${said}`;", replace: '    return `${status}.`;',
    says: 'an operation run as a command that the compiler refuses ends by naming the exit status alone, dropping the words the compiler wrote to its error stream',
  },
  {
    name: 'list-panel-heads-reversed', scenario: 'storefront',
    checks: [
      'catalog-panel.head-reads-search-catalog-then-draft-entity-and-folds-with-the-panel',
      'registries-panel.head-leads-no-registries-configured-and-folds-with-the-panel',
      'plugins-panel.head-reads-add-plugin-then-generate-entities-and-folds-with-the-panel',
    ],
    moves: 'red', target: 'extension',
    file: PANEL_ACTIONS_JS,
    find: '    return operation_groups_1.PANEL_ACTIONS[panel].map((action) => ({',
    replace: '    return [...operation_groups_1.PANEL_ACTIONS[panel]].reverse().map((action) => ({',
    says: 'every list panel draws the operations at its head in the reverse order',
  },
  {
    name: 'head-dropped-over-a-message', scenario: 'storefront', checks: ['registries-panel.head-leads-no-registries-configured-and-folds-with-the-panel'], moves: 'red', target: 'extension',
    file: PANEL_ACTIONS_JS,
    find: '    return [...panelActionNodes(panel, root !== null), ...listed];',
    replace: "    return [...(listed.some((node) => node.kind === 'message') ? [] : panelActionNodes(panel, root !== null)), ...listed];",
    says: 'a list panel whose list reads a message, such as "No registries configured.", draws no operation above it',
  },
  {
    name: 'draft-row-bound-to-nothing', scenario: 'storefront', checks: ['catalog-panel.draft-entity-asks-for-the-kind'], moves: 'red', target: 'extension',
    ...headRowBoundToNothing('scaffold'),
    says: 'the Draft entity row at the head of the Catalog panel is drawn as able to run and binds no command, so pressing it runs nothing',
  },
  {
    name: 'add-registry-row-bound-to-nothing', scenario: 'storefront', checks: ['registries-panel.add-registry-asks-for-the-host'], moves: 'red', target: 'extension',
    ...headRowBoundToNothing('registryAdd'),
    says: 'the Add registry row at the head of the Registries panel is drawn as able to run and binds no command, so pressing it runs nothing',
  },
  {
    name: 'update-index-row-bound-to-nothing', scenario: 'storefront', checks: ['registries-panel.update-index-starts-the-update'], moves: 'red', target: 'extension',
    ...headRowBoundToNothing('registryIndex'),
    says: 'the Update index row at the head of the Registries panel is drawn as able to run and binds no command, so pressing it runs nothing',
  },
  {
    name: 'draft-left-on-the-commands-panel', scenario: 'storefront', checks: ['commands-panel.holds-none-of-the-list-panels-operations-and-keeps-its-order-and-walk'], moves: 'red', target: 'extension',
    file: 'out/src/operation-groups.js',
    find: "        heading: 'Author',\n        operations: [\n",
    replace: "        heading: 'Author',\n        operations: [\n            {\n                id: 'scaffold',\n                label: 'Draft entity',\n                detail: 'Draft a starter document for an entity kind, opened in a new editor tab',\n                icon: 'new-file',\n            },\n",
    says: 'Draft entity is drawn on the Commands panel, first in its Author group, as well as at the head of the Catalog panel',
  },
  {
    name: 'validation-says-nothing', scenario: 'storefront', checks: ['operations.validate-ends-in-a-sentence'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '        outputChannel?.appendLine(report);\n        void vscode.window.showInformationMessage(report);',
    replace: '        outputChannel?.appendLine(report);',
    says: 'a validation raises no notification when it ends',
  },
  {
    name: 'lint-without-count', scenario: 'storefront', checks: ['operations.lint-ends-in-a-sentence'], moves: 'red', target: 'extension',
    file: 'out/src/lint-run.js',
    find: "        : (typeof checked === 'number' ? ` across ${checked} entities checked` : '');",
    replace: "        : '';",
    says: 'the lint\'s closing sentence omits how many entities were checked',
  },
  {
    name: 'build-notification-miscounts', scenario: 'storefront', checks: ['operations.build-ends-in-words-and-writes-its-files'], moves: 'red', target: 'extension',
    file: OPERATIONS,
    find: 'void vscode.window.showInformationMessage(`Aggrega: built ${release} — ${files.length} file(s) written to',
    replace: 'void vscode.window.showInformationMessage(`Aggrega: built ${release} — ${files.length + 1} file(s) written to',
    says: 'the build\'s notification counts one file more than the build wrote',
  },
  {
    name: 'spawn-error-without-its-path', scenario: 'storefront', checks: ['settings-that-are-wrong.missing-compiler-is-named'], moves: 'red', target: 'extension',
    file: DAEMON,
    find: '        this.log(`subprocess error: ${err.message}`);\n        this.rejectPending(err);',
    replace: "        this.rejectPending(new Error('the language server could not be started'));",
    says: 'a failure to start the binary is reported in a sentence naming no path, and not written to the channel',
  },
  {
    name: 'column-grips-not-resizable', scenario: 'storefront',
    checks: ['config-panel.setting-column-follows-its-grip-and-stops-at-its-floor', 'config-panel.source-column-follows-its-grip-and-keeps-its-paths-inside'],
    moves: 'red', target: 'extension',
    file: 'media/config.css', find: '  resize: horizontal;\n', replace: '',
    says: 'the configuration panel\'s labelled headings are drawn without the resizing rule, so the editor draws no grip to drag',
  },
  {
    name: 'shape-switch-not-allowed-to-run', scenario: 'storefront', checks: ['config-panel.explanation-and-shape-switch-work-beside-the-grips'], moves: 'red', target: 'extension',
    file: 'out/src/config-view.js',
    find: 'enableCommandUris: [config_render_1.PRESENTATION_TOGGLE_COMMAND],',
    replace: 'enableCommandUris: [],',
    says: 'the configuration panel is created allowing no command to run from it, so its switch to the per-setting shape runs nothing',
  },
  {
    name: 'declaring-document-branch-removed', scenario: 'storefront',
    checks: ['inspect.catalog-row-refused-for-its-document-names-it-and-opens-it', 'inspect.commands-panel-refused-for-its-document-ends-as-the-row-does'],
    moves: 'red', target: 'extension',
    file: 'out/src/inspection-request.js',
    find: '    if ((0, error_surfaces_1.isJsonRpcError)(err) && err.code === types_1.ERR_ENTITY_NOT_RESOLVABLE && err.data?.file) {',
    replace: '    if (false) {',
    says: 'an inspection refused because of the document declaring the entity ends as any failed operation does, "The inspection did not complete: code=1004 …" with its "Show output" button',
  },
  {
    name: 'commands-panel-inspects-on-its-own', scenario: 'storefront', checks: ['inspect.commands-panel-refused-for-its-document-ends-as-the-row-does'], moves: 'red', target: 'extension',
    file: OPERATIONS,
    find: '    await (0, inspection_1.inspectEntity)(deps, subject.name);',
    replace: "    try {\n        await (0, open_document_1.openDocument)(JSON.stringify(await deps.entityDefinition(subject.name), null, 2), 'json');\n    }\n    catch (err) {\n        await reportDaemonFailure(deps, err, 'The inspection');\n    }",
    says: 'the Commands panel composes an inspection of its own rather than the one the Catalog panel row runs, ending a refusal as an operation that did not complete',
  },
  {
    name: 'cache-miss-asks-first', scenario: 'storefront', checks: ['language-features.hover-after-a-change-on-disk-answers-without-asking'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '    return (0, cache_miss_1.recoverFromCacheMiss)({',
    replace: "    if ((await vscode.window.showInformationMessage('Aggrega has no cached state for ' + path.basename(doc.uri.fsPath) + '. Revalidate?', 'Revalidate')) !== 'Revalidate') {\n        return null;\n    }\n    return (0, cache_miss_1.recoverFromCacheMiss)({",
    says: 'a language request the language server answers "file not validated" first raises a notification asking "Revalidate?", and the document is validated and the request sent again only once it is pressed',
  },
  // ---- the workspace above the folder ----
  {
    name: 'options-drawn-on-a-disabled-build', scenario: 'workspace-above', checks: ['build-options.control-is-absent-while-build-cannot-run'], moves: 'red', target: 'extension',
    file: RENDER,
    find: "    if ((body.unavailable[op.id] ?? null) !== null) {\n        return '';\n    }\n    const dials = dialsFor(op.id);",
    replace: "    if (false) {\n        return '';\n    }\n    const dials = dialsFor(op.id);",
    says: 'the Build options control is drawn whether or not Build can run',
  },
  {
    name: 'build-sends-no-output-parent', scenario: 'workspace-above', checks: ['build.writes-beneath-the-opened-folder-and-says-where'], moves: 'red', target: 'extension',
    file: 'out/src/workspace.js',
    find: '    return relativeIfInside(workspaceRoot, projectFolder);\n}\n// workspaceSitsAboveFolder',
    replace: '    return null;\n}\n// workspaceSitsAboveFolder',
    says: 'a build is sent without the folder it is to write beneath, so it writes where a build at the workspace root writes',
  },
  {
    name: 'options-control-named-adjustments', scenario: 'workspace-above', checks: ['build-options.control-is-named-build-options', 'build-options.name-carries-no-count'], moves: 'red', target: 'extension',
    file: RENDER,
    find: '    const label = `${op.label} options`;',
    replace: '    const label = `${op.label} adjustments`;',
    says: 'the control beside Build is named "Build adjustments", with nothing ticked and with an option ticked alike',
  },
  {
    name: 'options-menu-named-adjustments', scenario: 'workspace-above', checks: ['build-options.menu-opens-below-the-chevron-aligned-right'], moves: 'red', target: 'extension',
    file: 'out/src/operation-menus.js',
    find: "const BUILD_DIALS_MENU_LABEL = 'Options for the next build';",
    replace: "const BUILD_DIALS_MENU_LABEL = 'Adjustments for the next build';",
    says: 'the menu beside Build is named "Adjustments for the next build"',
  },
  {
    name: 'row-press-closes-the-menu', scenario: 'workspace-above', checks: ['build-options.row-ticks-without-building-and-keeps-the-menu-open'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT,
    find: "      if (menu) { vscode.postMessage({ type: 'dials', set: dialsSetIn(menu) }); }\n      return;",
    replace: "      if (menu) { vscode.postMessage({ type: 'dials', set: dialsSetIn(menu) }); }\n      closeMenu();\n      return;",
    says: 'pressing a row of the Build options menu closes the menu',
  },
  {
    name: 'menu-closes-when-the-panel-loses-focus', scenario: 'workspace-above', checks: ['build-options.menu-closes-on-each-gesture'], moves: 'green', target: 'extension',
    file: PANEL_SCRIPT,
    find: "  document.addEventListener('click', (event) => {\n    if (!openMenu) { return; }",
    replace: "  window.addEventListener('blur', () => { if (openMenu) { closeMenu(); } });\n  document.addEventListener('click', (event) => {\n    if (!openMenu) { return; }",
    says: 'an open menu closes when the panel\'s document loses focus, which a click outside the panel causes',
  },
  {
    name: 'caret-out-of-the-walk', scenario: 'workspace-above', checks: ['build-options.keyboard-reaches-the-chevron-after-build'], moves: 'red', target: 'extension',
    file: RENDER,
    find: 'data-dials="${(0, html_1.escapeHtml)(op.id)}" data-focus-key="${(0, html_1.escapeHtml)(control)}"',
    replace: 'data-dials="${(0, html_1.escapeHtml)(op.id)}"',
    says: 'the chevron beside Build is taken out of the arrow-key walk',
  },
  {
    name: 'auto-pull-on-at-every-start', scenario: 'workspace-above', checks: ['build-options.tick-is-not-kept-across-a-reload'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '    dialsOn = [];', replace: "    dialsOn = ['autoPull'];",
    says: 'every window starts with Auto pull ticked, as a tick kept across a reload would leave it',
  },
  {
    name: 'requested-refusal-held-back', scenario: 'workspace-above', checks: ['build.missing-lockfile-refusal-offers-the-remedy'], moves: 'red', target: 'extension',
    file: 'out/src/error-surfaces.js', find: "    if (ctx.whoAsked === 'reader') {", replace: '    if (false) {',
    says: 'a build the reader pressed that is refused for a missing lockfile is answered as a redraw nobody asked for: an informational notice, held back on the second press',
  },
  {
    name: 'refusal-raised-twice', scenario: 'workspace-above', checks: ['build.missing-lockfile-refusal-offers-the-remedy'], moves: 'red', target: 'extension',
    file: OPERATIONS,
    find: "await (0, cli_operation_1.reportOutcome)(deps, 'The build', outcome, true, { notified: routed === 'notified' });",
    replace: "await (0, cli_operation_1.reportOutcome)(deps, 'The build', outcome, true, { notified: false });",
    says: 'a build refused for a missing lockfile raises its own failure notification beside the notice, two notifications for one fault',
  },
  {
    name: 'notice-pull-typed-into-a-terminal', scenario: 'workspace-above', checks: ['lockfile-notice.pull-runs-the-panels-pull-and-opens-no-terminal'], moves: 'red', target: 'extension',
    file: 'out/src/error-surfaces.js',
    find: '            ctx.pull(release);',
    replace: "            require('vscode').window.createTerminal({ name: 'Aggrega Lockfile' }).sendText('aggrega pull --release \"' + release + '\"', true);",
    says: 'the missing-lockfile notice\'s Pull opens a terminal and types the pull there, so what runs is whatever `aggrega` that terminal finds, with no progress and no ending of the Commands panel\'s Pull',
  },
  {
    name: 'unasked-notice-never-held-back', scenario: 'workspace-above', checks: ['lockfile-notice.saves-with-the-graph-open-raise-it-at-most-once'], moves: 'red', target: 'extension',
    file: 'out/src/error-surfaces.js', find: '    if (!shouldShowNotice(ctx, types_1.ERR_LOCKFILE_ABSENT)) {', replace: '    if (false) {',
    says: 'a refusal for a missing lockfile that nobody asked for — an open graph redrawn after a save — raises its notice every time, however recently it was shown',
  },
  {
    name: 'resolution-not-listed', scenario: 'workspace-above', checks: ['build.auto-pull-fills-the-lockfile-then-builds'], moves: 'red', target: 'extension',
    file: 'out/src/build-report.js',
    find: '        ...dependencyResolutionLines(report.dependencyResolution),\n',
    replace: '',
    says: 'a build that resolved its dependencies first lists nothing about the resolution, going straight from its opening line to its advisories and files',
  },
  {
    name: 'auto-pull-sent-off', scenario: 'workspace-above', checks: ['build.auto-pull-fills-the-lockfile-then-builds'], moves: 'red', target: 'extension',
    file: 'out/src/build-dials.js',
    find: '        [exports.AUTO_PULL_DIAL]: on.includes(exports.AUTO_PULL_DIAL),',
    replace: '        [exports.AUTO_PULL_DIAL]: false,',
    says: 'a build is sent with Auto pull off whatever the box beside it shows',
  },
  {
    name: 'preview-carries-auto-pull', scenario: 'workspace-above', checks: ['preview.never-carries-auto-pull'], moves: 'red', target: 'extension',
    file: 'out/src/build-dials.js',
    find: 'function buildPreviewParams(release) {\n    return { release };',
    replace: 'function buildPreviewParams(release) {\n    return { release, [exports.AUTO_PULL_DIAL]: true };',
    says: 'the preview is sent with Auto pull on',
  },
  {
    name: 'command-line-not-written', scenario: 'workspace-above', checks: ['output-channel.command-run-operations-write-a-dollar-line'], moves: 'red', target: 'extension',
    file: 'out/src/cli-operation.js',
    find: '    out.appendLine(`\\n$ ${bin} ${args.join(\' \')}   (cwd: ${root})`);',
    replace: '',
    says: 'an operation run as a command no longer writes its command line to the channel',
  },
  {
    name: 'build-writes-a-command-line', scenario: 'workspace-above', checks: ['output-channel.server-operations-write-no-dollar-line'], moves: 'red', target: 'extension',
    file: OPERATIONS,
    find: '    out.appendLine(`\\nBuild of ${release}.`);',
    replace: '    out.appendLine(`\\n$ aggrega build --release ${release}\\nBuild of ${release}.`);',
    says: 'a build writes a command line to the channel before its report, as an operation run as a command does',
  },
  // ---- the language server killed from outside ----
  {
    name: 'restart-ending-in-its-handshake-taken-as-deliberate', scenario: 'storefront-killed-server', checks: ['language-server.restarts-after-dying-during-its-handshake'], moves: 'red', target: 'extension',
    file: DAEMON,
    find: '        this.spawnAndInitialize().then(undefined, (err) => {\n            if (generation !== this.generation) {',
    replace: '        this.spawnAndInitialize().then(undefined, (err) => {\n            if (true) {',
    says: 'a server started again that ends before it answers is taken for one stopped on purpose, so nothing starts another, nothing is raised and the channel says nothing more',
  },
  {
    name: 'respawn-bound-one-short', scenario: 'storefront-killed-server', checks: ['language-server.stopped-responding-after-the-respawn-bound'], moves: 'red', target: 'extension',
    file: DAEMON, find: '        return this.attempts.length < this.attemptLimit;', replace: '        return this.attempts.length + 1 < this.attemptLimit;',
    says: 'a respawn is allowed only while one more would still be under the bound, so a bound of N allows N − 1 restarts, as counting the end being handled against the bound does',
  },
  {
    name: 'restart-names-no-version', scenario: 'storefront-killed-server', checks: ['language-server.restart-notification-names-the-running-version'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: "serverInPlaceMessage)('restarted', daemon?.getServerInitMetadata()?.version)",
    replace: "serverInPlaceMessage)('restarted', undefined)",
    says: 'the notification a restart ends in is handed no version, so it says the version was not reported whatever the running server reported',
  },
  {
    name: 'start-names-no-version', scenario: 'storefront-killed-server', checks: ['language-server.start-notification-names-the-running-version'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: "serverInPlaceMessage)('started', daemon?.getServerInitMetadata()?.version)",
    replace: "serverInPlaceMessage)('started', undefined)",
    says: 'the notification a start ends in is handed no version, so it says the version was not reported whatever the server started reported',
  },
  {
    name: 'server-line-misses-a-stop', scenario: 'storefront-killed-server', checks: ['welcome-page.server-line-follows-a-restart-and-a-stop'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js',
    find: "        panel.webview.postMessage({ type: 'server', html: (0, welcome_render_1.serverHtml)(deps.readServerStanding()) });",
    replace: "        const standing = deps.readServerStanding();\n        if (standing.reading !== 'notRunning') {\n            panel.webview.postMessage({ type: 'server', html: (0, welcome_render_1.serverHtml)(standing) });\n        }",
    says: 'the welcome page\'s last line follows every move of the language server but one that reads not running, so a stopped server goes on reading as it read before it stopped',
  },
  {
    name: 'server-line-version-dropped', scenario: 'storefront-killed-server', checks: ['welcome-page.server-line-names-the-version-when-started-again'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '        version: daemon?.getServerInitMetadata()?.version ?? null,',
    replace: '        version: null,',
    says: 'the welcome page is handed no version for the running language server, so its last line says the version was not reported whatever the server reported',
  },
  {
    name: 'failed-start-read-as-not-running', scenario: 'storefront-killed-server', checks: ['welcome-page.server-line-says-a-start-failed'], moves: 'red', target: 'extension',
    file: 'out/src/daemon-status.js',
    find: "    return standing === 'notRunning' && lastStartFailed ? 'failedToStart' : standing;",
    replace: '    return standing;',
    says: 'a language server whose last start failed is read as one that is not running, so the welcome page\'s last line never says a start failed',
  },
  {
    name: 'error-at-activation', scenario: 'storefront-killed-server', checks: ['language-server.starts-without-an-error-notification'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: "    outputChannel = vscode.window.createOutputChannel('Aggrega');\n    context.subscriptions.push(outputChannel);",
    replace: "    outputChannel = vscode.window.createOutputChannel('Aggrega');\n    context.subscriptions.push(outputChannel);\n    void vscode.window.showErrorMessage('Aggrega: an error raised at activation, where none is due.');",
    says: 'an error notification is raised as the extension activates',
  },
  // ---- the storefront folder with registries ----
  {
    name: 'copies-the-name', scenario: 'storefront-with-registries', checks: ['catalog-search.lists-matches-and-copies-a-reference'], moves: 'red', target: 'extension',
    file: 'out/src/catalog-views.js', find: '    await vscode.env.clipboard.writeText(pick.uri);', replace: '    await vscode.env.clipboard.writeText(pick.label);',
    says: 'choosing a match copies its name instead of its reference',
  },
  {
    name: 'rows-mark-the-withdrawn', scenario: 'storefront-with-registries', checks: ['catalog-search.rows-carry-no-withdrawal-marking'], moves: 'red', target: 'extension',
    file: SEARCH_RUN,
    find: "        description: [record.kind, record.version].filter(Boolean).join(' '),",
    replace: "        description: [record.kind, record.version, ...(record.retracted ?? []).map((v) => `retracted ${v}`)].filter(Boolean).join(' '),",
    says: 'a match row names the versions withdrawn beside the one it offers',
  },
  {
    name: 'no-freshness-lines', scenario: 'storefront-with-registries', checks: ['catalog-search.index-freshness-is-named-in-the-channel'], moves: 'red', target: 'extension',
    file: SEARCH_RUN, find: '    for (const line of freshnessReport(doc)) {', replace: '    for (const line of []) {',
    says: 'a search writes nothing to the channel about the indexes it read',
  },
  {
    name: 'no-matches-read-as-no-registries', scenario: 'storefront-with-registries', checks: ['catalog-search.nothing-matched-names-the-filter'], moves: 'red', target: 'extension',
    file: SEARCH_RUN,
    find: '            message: `Aggrega: no catalog matches for ${describeFilter(filter)}.`,',
    replace: '            message: exports.NO_REGISTRIES_MESSAGE,',
    says: 'a search that matched nothing is answered as a search with no registry configured',
  },
  {
    name: 'index-build-never-settles', scenario: 'storefront-with-registries', checks: ['registries-panel.update-index-ends-with-a-registry-whose-listing-repeats'], moves: 'red', target: 'extension',
    file: 'out/src/registries-view.js',
    find: '(title, (signal) => (0, registry_index_request_1.runIndexBuild)(deps, registry, signal));',
    replace: '(title, (signal) => new Promise(() => { void (0, registry_index_request_1.runIndexBuild)(deps, registry, signal); }));',
    says: 'Update index sends the build and runs it behind a progress notification whose work never settles, so the notification stays up after the answer',
  },
  {
    name: 'unindexed-registries-read-as-complete', scenario: 'storefront-with-registries', checks: ['registries-panel.update-index-names-the-registry-whose-listing-repeats-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: INDEX_REQUEST, find: '    if (missed.length > 0) {', replace: '    if (false) {',
    says: 'an index build whose answer names registries it could not index ends as one that completed',
  },
  {
    name: 'every-registry-named-unindexed', scenario: 'storefront-with-registries', checks: ['registries-panel.update-index-reports-the-registry-beside-it-indexed'], moves: 'red', target: 'extension',
    file: INDEX_REQUEST,
    find: '    const missed = hosts.filter((host) => host.error).map((host) => host.host);',
    replace: '    const missed = hosts.map((host) => host.host);',
    says: 'an index build\'s ending names every registry it walked as not indexed, the ones it indexed included',
  },
  {
    name: 'trust-reason-dropped', scenario: 'storefront-with-registries', checks: ['registration.says-an-entry-carries-no-trust-where-none-is-advertised'], moves: 'red', target: 'extension',
    file: REGISTRATION_OUTCOME, find: "    const because = trust.reason ? ` ${trust.reason}` : '';", replace: "    const because = '';",
    says: 'a registration\'s trust clause drops the answer\'s own account of why no advertised policy was taken',
  },
  {
    name: 'baseline-unread', scenario: 'storefront-with-registries', checks: ['registration.says-the-hub-took-its-built-in-baseline-offline'], moves: 'red', target: 'extension',
    file: REGISTRATION_OUTCOME, find: '    if (trust.baseline) {', replace: '    if (false) {',
    says: 'an answer carrying the built-in trust baseline is read as one naming no trust outcome',
  },
  {
    name: 'refusal-short-code-cut', scenario: 'storefront-with-registries', checks: ['registration.refusal-carries-the-servers-words'], moves: 'red', target: 'extension',
    file: 'out/src/error-surfaces.js',
    find: '        return `code=${err.code} ${err.message}`;',
    replace: "        return `code=${err.code} ${err.message.replace(/^E\\d{4}: /, '')}`;",
    says: 'a language-server refusal reaches the reader with the short code it opens with cut off',
  },
  // ---- the Releases with catalog directories of their own ----
  {
    name: 'build-sent-for-the-compose-release', scenario: 'releases-with-own-catalogs', checks: ['build.each-release-matches-the-command-line-from-its-own-catalog'], moves: 'red', target: 'extension',
    file: BUILD_DIALS, find: BUILD_RELEASE_PARAM, replace: BUILD_RELEASE_PARAM.replace('release,', "release: 'release-compose.yaml',"),
    says: 'every build is sent for release-compose.yaml whichever Release is selected, so each writes what that Release reads from its own catalog directory',
  },
  {
    name: 'build-sent-for-the-synthesised-release', scenario: 'releases-with-own-catalogs', checks: ['build.managed-chart-release-matches-the-command-line-from-its-own-catalog'], moves: 'red', target: 'extension',
    file: BUILD_DIALS, find: BUILD_RELEASE_PARAM, replace: BUILD_RELEASE_PARAM.replace('release,', "release: 'release-helm-synth.yaml',"),
    says: 'every build is sent for release-helm-synth.yaml whichever Release is selected, so the managed-chart Release writes the self-contained Kubernetes Release\'s files',
  },
  {
    name: 'workspace-list-removed', scenario: 'releases-with-own-catalogs', checks: ['build.unmapped-release-matches-the-command-line-from-the-workspace-list'], moves: 'red', target: 'folder',
    file: '.aggrega-config.yaml', find: 'workspace:\n  catalog_dirs:\n    - catalog-compose\n  releases:\n', replace: 'workspace:\n  releases:\n',
    says: 'the folder\'s configuration lists no catalog directory for the whole workspace, so a Release its map does not name has none of its own to read',
  },
  {
    name: 'graph-keeps-the-release-it-shows', scenario: 'releases-with-own-catalogs', checks: ['graph.shown-after-the-selection-moves-draws-the-selected-release'], moves: 'red', target: 'extension',
    file: 'out/src/graph-view.js', find: '        const release = deps.selectedRelease();', replace: '        const release = shownRelease ?? deps.selectedRelease();',
    says: 'showing the graph again draws the Release the open panel already shows, whichever Release is selected',
  },
  // ---- the storefront folder with the topology graph open ----
  { name: 'context-row-renamed-graph-panel', scenario: 'storefront-graph-panel', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'sensitive-setting-drawn-with-another-description', scenario: 'storefront-graph-panel', checks: ['settings.show-sensitive-values-label-is-derived-from-its-key'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        "aggrega.graph.showSensitiveValues": {\n          "type": "boolean",',
    replace: '        "aggrega.graph.showSensitiveValues": {\n          "markdownDescription": "A description other than the one the manifest declares.",\n          "type": "boolean",',
    says: 'the setting is given a markdown description, which the settings editor draws in place of the declared one',
  },
  {
    name: 'withheld-drawn-blank', scenario: 'storefront-graph-panel', checks: ['attachments-panel.declared-sensitive-value-is-withheld-by-default'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: "          ? el('dd', 'withheld', attachments.withheldNote(f.withheld))", replace: "          ? el('dd', 'withheld', '')",
    says: 'a withheld value is drawn as a blank where the sentence saying why should be',
  },
  {
    name: 'whole-attachment-withheld', scenario: 'storefront-graph-panel',
    checks: ['attachments-panel.withholds-exactly-what-the-command-line-withholds', 'attachments-panel.undeclared-value-reads-as-authored'], moves: 'red', target: 'extension',
    file: ATTACHMENTS_MODEL,
    find: '    if (!recognisedLeafList(entry.sensitive_payload_leaves)) { return true; }\n    return false;',
    replace: '    if (!recognisedLeafList(entry.sensitive_payload_leaves)) { return true; }\n    return true;',
    says: 'every leaf of an attachment is withheld, the ones no declaration covers included, as a panel that hides the whole attachment would',
  },
  {
    name: 'drawing-side-leaves-withholding-to-the-markers', scenario: 'storefront-graph-panel', checks: ['attachments-panel.setting-on-shows-the-value-as-authored'], moves: 'green', target: 'extension',
    file: ATTACHMENTS_MODEL, find: '    const declared = declaredLeaves(safe, wholly);', replace: '    const declared = [];',
    says: 'the drawing side withholds the leaves the sending side replaced with a marker and matches the declarations no further, so a value the sending side left in place because the setting is on is drawn',
  },
  {
    name: 'declared-leaves-matched-nowhere', scenario: 'storefront-graph-panel',
    checks: ['attachments-panel.setting-off-again-withholds-the-value', 'attachments-panel.setting-that-is-not-a-boolean-withholds-the-value'], moves: 'red', target: 'extension',
    file: ATTACHMENTS_MODEL, find: '    if (coveredByDeclaration(leaf.path, declared)) { return WITHHELD_DECLARED; }\n', replace: '',
    says: 'no leaf is withheld for a declaration, on the side that sends the graph and on the side that draws it, so a declared-sensitive value is drawn whatever the setting says',
  },
  {
    name: 'waiting-drawn-blank', scenario: 'storefront-graph-panel', checks: ['may-attach.section-is-headed-captioned-and-waits-in-words'], moves: 'red', target: 'extension',
    file: CANDIDATES_MODEL, find: "  const PENDING_NOTE = 'Looking for Features that may attach…';", replace: "  const PENDING_NOTE = '';",
    says: 'the list of what may attach draws nothing while its answer is in flight',
  },
  {
    name: 'catalog-origin-unsaid', scenario: 'storefront-graph-panel', checks: ['may-attach.rows-name-each-feature-its-kind-and-where-it-was-read'], moves: 'red', target: 'extension',
    file: CANDIDATES_MODEL, find: "      facts.push({ key: 'from', value: 'the configured catalog' });\n", replace: '',
    says: 'a row for a Feature read from the configured catalog says nothing of where it came from',
  },
  {
    name: 'rows-reversed', scenario: 'storefront-graph-panel', checks: ['may-attach.rows-name-each-feature-its-kind-and-where-it-was-read'], moves: 'red', target: 'extension',
    file: CANDIDATES_MODEL, find: '    const rows = list.map(candidateRow);', replace: '    const rows = list.map(candidateRow).reverse();',
    says: 'the rows are drawn in the reverse of the order the answer names them in',
  },
  {
    name: 'stale-answer-drawn', scenario: 'storefront-graph-panel', checks: ['may-attach.list-follows-the-node-selected-last'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    return requestId === candidatesRequestId && candidatesBodyEl !== null;', replace: '    return candidatesBodyEl !== null;',
    says: 'every answer about what may attach is drawn as it arrives, not only the one for the latest press, so an answer about a node pressed earlier that arrives last is the one left drawn',
  },
  {
    name: 'list-asked-about-the-gateway', scenario: 'storefront-graph-panel', checks: ['may-attach.list-follows-the-node-selected-last'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: '                    void postAttachCandidates(panel, deps, nodeId, shownRelease, requestId);', replace: "                    void postAttachCandidates(panel, deps, 'gateway', shownRelease, requestId);",
    says: 'the list of what may attach is asked about the gateway whatever node was pressed',
  },
  {
    name: 'connect-button-drawn', scenario: 'storefront-graph-panel', checks: ['graph-panel.offers-no-way-to-draw-a-connection'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    panelBodyEl.appendChild(drawCandidatesSection());', replace: "    panelBodyEl.appendChild(drawCandidatesSection());\n    panelBodyEl.appendChild(el('button', 'candidate-attach', 'Connect to…'));",
    says: 'the attachments panel draws a "Connect to…" button below the list of what may attach',
  },
  {
    name: 'no-container-key-written', scenario: 'storefront-graph-panel', checks: ['attach.press-inside-a-subsystem-writes-the-entry-unsaved'], moves: 'red', target: 'extension', ...NO_CONTAINER_KEYS,
  },
  {
    name: 'entry-applied-in-two-edits', scenario: 'storefront-graph-panel', checks: ['attach.one-undo-removes-the-whole-entry'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: ENTRY_INSERT,
    replace: "        { const cut = text.lastIndexOf('\\n'); const tail = new vscode.WorkspaceEdit(); tail.insert(uri, new vscode.Position(at.line, at.character), text.slice(cut)); await vscode.workspace.applyEdit(tail); }\n        edit.insert(uri, new vscode.Position(at.line, at.character), text.slice(0, text.lastIndexOf('\\n')));",
    says: 'an attach applies its entry as two edits, its last line first and the rest before it, so one undo takes out only part of the entry',
  },
  {
    name: 'entry-placed-by-the-line-on-disk', scenario: 'storefront-graph-panel', checks: ['attach.lands-where-the-unsaved-buffer-puts-it'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: ENTRY_INSERT,
    replace: "        edit.insert(uri, new vscode.Position(at.line - (doc.lineCount - require('fs').readFileSync(uri.fsPath, 'utf8').split('\\n').length), at.character), text);",
    says: 'an attach places its entry by the line the reported place has in the file on disk, so lines typed above it and not saved put the entry that many lines too early',
  },
  {
    name: 'entry-indented-a-step-further', scenario: 'storefront-graph-panel', checks: ['attach.two-subsystems-deep-lands-beside-the-existing-attachment'], moves: 'red', target: 'extension',
    file: ATTACHMENT_EDIT, find: "        parts.push(' '.repeat(insertion.entryIndent));", replace: "        parts.push(' '.repeat(insertion.entryIndent + insertion.indentStep));",
    says: 'an attach indents its entry one step further than the answer says, which nests it inside the attachment before it',
  },
  {
    name: 'entry-written-into-the-releases-aggregate', scenario: 'storefront-graph-panel', checks: ['attach.module-component-lands-in-the-modules-document'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: '        const uri = vscode.Uri.file((0, workspace_1.fromWorkspaceRelative)(root, insertion.file));', replace: "        const uri = vscode.Uri.file((0, workspace_1.fromWorkspaceRelative)(root, 'aggregate.yaml'));",
    says: 'an attach edits the Aggregate the Release names whatever document the compiler named for the node',
  },
  {
    name: 'graph-failure-written-as-a-string', scenario: 'storefront-graph-panel',
    checks: ['graph.failed-render-names-its-reason-in-the-panel-and-the-channel', 'graph.failed-render-with-the-server-stopped-names-the-extensions-reason'], moves: 'red', target: 'extension',
    file: 'out/src/graph-failure.js', find: '    sinks.logLine(`irGraph failed for ${release}: ${message}`);', replace: '    sinks.logLine(`irGraph failed for ${release}: ${String(err)}`);',
    says: 'a failed drawing is written to the channel as the thrown value rendered as a string, which reads "[object Object]" for a refusal the language server answered',
  },
  {
    name: 'declined-attach-reworded', scenario: 'storefront-graph-panel', checks: ['attach.refusal-carries-the-compilers-words'], moves: 'red', target: 'extension',
    file: ATTACHMENT_EDIT, find: 'return attachRefusal((0, error_surfaces_1.describeError)(err));', replace: "return attachRefusal('the request was declined.');",
    says: 'an attach the compiler declines is reported in a sentence of the extension\'s own, dropping the compiler\'s words',
  },
  {
    name: 'line-drawn-whatever-node-it-names', scenario: 'storefront-graph-panel', checks: ['attach.request-for-a-node-the-panel-did-not-draw-is-refused-in-its-words'], moves: 'green', target: 'extension',
    file: GRAPH_SCRIPT, find: '    if (attachOutcomeEl === null || nodeId !== selectedId) { return; }', replace: '    if (attachOutcomeEl === null) { return; }',
    says: 'the panel draws the line an attach ends in whatever node the line names, under the list of the node it is showing',
  },
  {
    name: 'refused-list-sends-nothing', scenario: 'storefront-graph-panel', checks: ['may-attach.refusal-says-the-list-is-not-coming-and-why'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: "        void panel.webview.postMessage({ type: 'attachCandidatesError', nodeId, requestId, message });\n", replace: '',
    says: 'a refused list of what may attach sends the panel nothing, so it goes on reading as waiting',
  },
  {
    name: 'saved-after-the-edit', scenario: 'storefront-graph-panel',
    checks: ['attach.press-inside-a-subsystem-writes-the-entry-unsaved', 'attach.nothing-is-saved-and-the-folder-is-as-it-started'], moves: 'red', target: 'extension', ...SAVED_AFTER_EDIT,
  },
  // ---- the folder whose one Feature applies to nothing it deploys ----
  { name: 'context-row-renamed-probes', scenario: 'probes-nothing-may-attach', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'node-labels-read-as-the-labels-on-this-node', scenario: 'probes-nothing-may-attach', checks: ['may-attach.nothing-matching-reads-as-an-empty-state'], moves: 'green', target: 'extension',
    file: CANDIDATES_MODEL, find: '    if (labelSource === LABELS_SUPPLIED) {', replace: '    if (labelSource === LABELS_SUPPLIED || labelSource === LABELS_RESOLVED) {',
    says: 'an empty answer computed over a node\'s finalised labels reads as the sentence for the labels on this node',
  },
  // ---- the gateway folder, a component at the top level ----
  { name: 'context-row-renamed-top-level-attach', scenario: 'gateway-top-level-attach', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'no-container-key-written-top-level', scenario: 'gateway-top-level-attach', checks: ['attach.top-level-component-lands-under-its-components-block'], moves: 'red', target: 'extension', ...NO_CONTAINER_KEYS,
  },
  {
    name: 'saved-after-the-edit-top-level', scenario: 'gateway-top-level-attach', checks: ['attach.nothing-is-saved-and-the-folder-is-as-it-started'], moves: 'red', target: 'extension', ...SAVED_AFTER_EDIT,
  },
  // ---- the gateway folder as the editor comes up and the server comes and goes ----
  { name: 'context-row-renamed-readiness', scenario: 'gateway-readiness', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'catalog-not-asked-when-answerable', scenario: 'gateway-readiness', checks: ['readiness.cold-open-fills-every-panel-with-no-press'], moves: 'red', target: 'extension',
    file: CATALOG_VIEW, find: '    deps.onReady(() => catalog.refresh());', replace: '    void 0;',
    says: 'the Catalog panel does not ask again when the compiler becomes answerable, so it keeps the row it drew before an answer',
  },
  {
    name: 'catalog-origin-note-left-empty', scenario: 'gateway-readiness', checks: ['catalog-view.catalog-resolved-entity-is-marked-and-opens-nothing'], moves: 'red', target: 'extension',
    file: CATALOG_RUN, find: "    const originLabel = entity.origin === exports.ENTITY_ORIGIN_CATALOG ? exports.CATALOG_ORIGIN_LABEL : '';", replace: "    const originLabel = '';",
    says: 'an entity resolved from a configured catalog directory carries no note saying where it came from',
  },
  {
    name: 'catalog-refresh-bound-to-nothing', scenario: 'gateway-readiness', checks: ['list-panels.refresh-asks-again-and-leaves-the-content-as-it-was'], moves: 'red', target: 'extension',
    file: CATALOG_VIEW, find: "vscode.commands.registerCommand('aggrega.workspaceCatalog.refresh', () => catalog.refresh())", replace: "vscode.commands.registerCommand('aggrega.workspaceCatalog.refresh', () => undefined)",
    says: 'the Catalog panel\'s Refresh runs nothing',
  },
  {
    name: 'click-offers-start-whatever-the-standing', scenario: 'gateway-readiness', checks: ['status-bar.lifecycle-item-reads-running-beside-the-release-and-offers-a-restart'], moves: 'red', target: 'extension',
    file: DAEMON_STATUS, find: "    return standing === 'notRunning' ? 'start' : 'restart';", replace: "    return 'start';",
    says: 'the language-server item offers a start whatever the server\'s standing, a running server included',
  },
  {
    name: 'open-graph-not-redrawn-when-the-server-returns', scenario: 'gateway-readiness', checks: ['readiness.restart-refills-every-panel-and-redraws-the-open-graph'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: '    deps.onReady(refresh);', replace: '    void 0;',
    says: 'an open topology graph is not drawn again when the language server becomes answerable again',
  },
  // ---- the gateway folder, the cache operations ----
  { name: 'context-row-renamed-cache', scenario: 'gateway-cache', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'cache-list-placeholder-reworded', scenario: 'gateway-cache', checks: ['cache.palette-asks-which-operation-as-a-list'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: "{ placeHolder: 'Aggrega: choose a cache operation' }", replace: "{ placeHolder: 'Aggrega: pick one' }",
    says: 'the list of cache operations the palette opens is headed with other words',
  },
  {
    name: 'report-counts-one-entry-more', scenario: 'gateway-cache', checks: ['cache.status-reports-the-compilers-figures-on-the-channel-alone'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: "return `listed ${countOf(result.totalCount, 'entry', 'entries')} holding ${result.totalSizeText}.`;", replace: "return `listed ${countOf(result.totalCount + 1, 'entry', 'entries')} holding ${result.totalSizeText}.`;",
    says: 'the cache report\'s closing line counts one entry more than the answer',
  },
  {
    name: 'entry-size-printed-in-bytes', scenario: 'gateway-cache', checks: ['cache.sizes-are-written-in-the-units-a-cap-is-read-in'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: 'out.appendLine(`    ${element.label}  ${element.sizeText}${note}`);', replace: 'out.appendLine(`    ${element.label}  ${element.size} bytes${note}`);',
    says: 'each entry of the cache report prints its size as its byte count',
  },
  {
    name: 'dismissed-prompt-taken-as-blank', scenario: 'gateway-cache', checks: ['cache.dismissed-cap-prompt-runs-nothing'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '        if (answer === undefined) {\n            return;\n        }\n        maxSize = answer;', replace: "        maxSize = answer ?? '';",
    says: 'dismissing the size cap prompt is taken as a blank answer, so the trim goes on to its confirmation',
  },
  {
    name: 'refusal-cut-to-its-first-clause', scenario: 'gateway-cache', checks: ['cache.unreadable-cap-comes-back-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: 'out/src/error-surfaces.js', find: '        return `code=${err.code} ${err.message}`;', replace: "        return `code=${err.code} ${err.message.split(':')[0]}`;",
    says: 'a language-server refusal reaches the reader cut at its first colon, dropping the part saying what a size cap looks like',
  },
  {
    name: 'total-size-printed-in-words', scenario: 'gateway-cache', checks: ['cache.a-size-the-report-shows-is-accepted-as-the-cap'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: 'holding ${result.totalSizeText}.`;', replace: "holding ${result.totalSizeText.replace('iB', 'ibibytes')}.`;",
    says: 'the report\'s total size is printed with its unit spelled out, a figure the trim does not read',
  },
  {
    name: 'within-cap-reported-bare', scenario: 'gateway-cache', checks: ['cache.trim-to-a-cap-trims-or-says-it-was-within'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: 'return `removed nothing: the cache held ${result.totalBeforeText}, already within the ${result.capBytesText} cap.`;', replace: "return 'removed nothing.';",
    says: 'a trim already within its cap ends without saying what the cache held or what the cap was',
  },
  {
    name: 'kept-line-left-out', scenario: 'gateway-cache', checks: ['cache.prune-ends-in-what-it-removed-and-kept'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: "            out.appendLine(`  kept, still referenced: ${countOf(result.retainedCount, 'entry', 'entries')}`);", replace: '',
    says: 'the prune writes nothing about the entries it kept as still referenced',
  },
  {
    name: 'declined-taken-as-consent', scenario: 'gateway-cache', checks: ['cache.declined-clear-sends-nothing-and-says-so'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '        if (consented !== confirmation.confirmLabel) {', replace: '        if (false) {',
    says: 'a declined cache confirmation is taken as consent, so the operation runs',
  },
  {
    name: 'wipe-counts-one-cache-more', scenario: 'gateway-cache', checks: ['cache.clear-completes-and-says-what-it-emptied'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: "return `emptied ${countOf(cleared.length, 'cache', 'caches')}", replace: "return `emptied ${countOf(cleared.length + 1, 'cache', 'caches')}",
    says: 'the wipe\'s notification counts one cache more than it emptied',
  },
  {
    name: 'trim-confirmation-names-both-scopes', scenario: 'gateway-cache', checks: ['cache.each-removal-confirms-first-naming-the-caches-it-reaches'], moves: 'red', target: 'extension',
    file: 'out/src/operation-groups.js',
    find: "scope: `This reaches ${THE_COMPILED_MODULE_CACHE}. Nothing under this workspace's own cache directory is touched. What is removed is rebuilt on the next build that needs it.`,",
    replace: 'scope: `This reaches ${THIS_WORKSPACE_CACHES}, and ${THIS_MACHINE_CACHES}. What is removed is rebuilt on the next build that needs it.`,',
    says: 'the trim\'s confirmation names this workspace\'s caches as well as the shared one, as the other two removals do',
  },
  {
    name: 'cache-behind-a-cancellable-progress', scenario: 'gateway-cache', checks: ['cache.operations-write-no-dollar-line-and-draw-no-progress-or-cancel'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '        const detail = await performCacheOperation(deps, operation, maxSize);',
    replace: "        const detail = await (0, progress_1.withCancellableProgress)('Aggrega: running a cache operation', async () => { await new Promise((r) => setTimeout(r, 1500)); return performCacheOperation(deps, operation, maxSize); });",
    says: 'every cache operation runs behind a progress notification carrying a Cancel button',
  },
  {
    name: 'workspace-line-names-the-parent', scenario: 'gateway-cache', checks: ['cache.operations-reach-only-this-scenarios-caches'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '        out.appendLine(`  Workspace: ${scope.workspaceRoot}`);', replace: "        out.appendLine(`  Workspace: ${require('path').dirname(scope.workspaceRoot)}`);",
    says: 'each cache answer\'s "Workspace:" line names the folder above the workspace root',
  },
  // ---- the folder that is a workspace root and holds nothing else ----
  {
    name: 'empty-index-read-as-a-stopped-server', scenario: 'empty-workspace', checks: ['catalog-view.empty-workspace-reads-no-entities'], moves: 'red', target: 'extension',
    file: CATALOG_RUN, find: "        return [{ kind: 'message', label: exports.EMPTY_LABEL }];", replace: "        return [{ kind: 'message', label: exports.SERVER_STOPPED_LABEL }];",
    says: 'an empty entity index is drawn as a language server that is not running',
  },
  {
    name: 'empty-registry-list-read-as-failed', scenario: 'empty-workspace', checks: ['list-panels.empty-answers-read-as-answers'], moves: 'red', target: 'extension',
    file: 'out/src/registries-run.js', find: "        return [{ kind: 'message', label: exports.EMPTY_LABEL }];", replace: "        return [{ kind: 'message', label: exports.FAILURE_LABEL }];",
    says: 'an empty registry list is drawn as a listing that failed',
  },
  {
    name: 'stopped-server-read-as-empty', scenario: 'empty-workspace', checks: ['list-panels.stopped-server-reads-apart-from-an-empty-answer'], moves: 'red', target: 'extension',
    file: CATALOG_RUN, find: "        return [{ kind: 'message', label: exports.SERVER_STOPPED_LABEL }];", replace: "        return [{ kind: 'message', label: exports.EMPTY_LABEL }];",
    says: 'a language server that is not running is drawn as an empty workspace',
  },
  {
    name: 'not-running-drawn-without-alarm', scenario: 'empty-workspace', checks: ['status-bar.lifecycle-item-reads-not-running-in-red-and-says-why'], moves: 'red', target: 'extension',
    file: DAEMON_STATUS, find: '    notRunning: true,\n};', replace: '    notRunning: false,\n};',
    says: 'the not-running reading is drawn without the error colour',
  },
  {
    name: 'plugins-listed-only-while-running', scenario: 'empty-workspace', checks: ['plugins-panel.answers-with-the-language-server-stopped'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '    (0, plugins_view_1.activatePluginsView)(context, {\n        getWorkspaceRoot: () => workspaceRootForCommands,',
    replace: '    (0, plugins_view_1.activatePluginsView)(context, {\n        getWorkspaceRoot: () => (isLanguageServerRunning() ? workspaceRootForCommands : null),',
    says: 'the Plugins panel is handed a workspace only while the language server is running, so its listing is asked for only then',
  },
  {
    name: 'alarm-never-cleared', scenario: 'empty-workspace', checks: ['status-bar.lifecycle-item-starts-the-server-and-drops-the-red'], moves: 'red', target: 'extension',
    file: DAEMON_STATUS,
    find: '        item.backgroundColor = exports.DAEMON_STANDING_IS_ALARMING[standing]\n            ? deps.alarmBackground()\n            : undefined;',
    replace: '        item.backgroundColor = exports.DAEMON_STANDING_IS_ALARMING[standing]\n            ? deps.alarmBackground()\n            : item.backgroundColor;',
    says: 'the error colour is set on the way into the not-running reading and never cleared',
  },
  // ---- a folder no workspace marker reaches ----
  {
    name: 'restart-hidden-while-nothing-answers', scenario: 'no-workspace-first-day', checks: ['palette.restart-command-is-there-with-no-workspace'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '      "commandPalette": [\n        {\n          "command": "aggrega.getStarted.open",',
    replace: '      "commandPalette": [\n        {\n          "command": "aggrega.server.restart",\n          "when": "aggrega.compilerAnswerable"\n        },\n        {\n          "command": "aggrega.getStarted.open",',
    says: 'the restart command is kept out of the palette while nothing is answerable',
  },
  {
    name: 'restart-silent-with-nothing-anchored', scenario: 'no-workspace-first-day', checks: ['language-server.restart-with-no-workspace-says-there-is-none'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '    if (currentAnchored.length === 0) {\n        void vscode.window.showInformationMessage(workspace_1.NO_ANCHORED_WORKSPACE_MESSAGE);\n    }',
    replace: '    if (currentAnchored.length === 0) {\n    }',
    says: 'the restart command returns without a word where nothing is anchored',
  },
  {
    name: 'toggle-unavailable-while-nothing-answers', scenario: 'no-workspace-first-day', checks: ['palette.build-analysis-toggle-works-with-no-server'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        "command": "aggrega.server.toggleBuildOnInspect",\n        "title": "Aggrega: Toggle the build\'s analysis while inspecting"',
    replace: '        "command": "aggrega.server.toggleBuildOnInspect",\n        "title": "Aggrega: Toggle the build\'s analysis while inspecting",\n        "enablement": "aggrega.compilerAnswerable"',
    says: 'the build-analysis toggle is made unavailable while nothing is answerable',
  },
  {
    name: 'item-says-no-root-as-if-anchored', scenario: 'no-workspace-first-day', checks: ['status-bar.lifecycle-item-says-there-is-nothing-to-attach-to'], moves: 'red', target: 'extension',
    file: DAEMON_STATUS,
    find: "                : 'No folder in this window is one Aggrega recognises as a workspace, so there is nothing for the language server to attach to. Click to look again.';",
    replace: "                : 'The Aggrega language server is not running, so the operations that ask it a question are unavailable. Click to start it.';",
    says: 'the item\'s hover in a window no workspace marker reaches reads as it does in an anchored one',
  },
  {
    name: 'authoring-release-writes-where-nothing-is-anchored', scenario: 'no-workspace-first-day', checks: ['workspace-config.authoring-release-with-no-workspace-says-so-and-writes-nothing'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '        if (!workspaceRootForCommands) {\n            void vscode.window.showInformationMessage(workspace_1.NO_ANCHORED_WORKSPACE_MESSAGE);\n            return;\n        }\n        await (0, release_actions_1.openAuthoringReleaseConfig)(workspaceRootForCommands, configurationWatch.ownWrite);',
    replace: '        if (!workspaceRootForCommands) {\n            await (0, release_actions_1.openAuthoringReleaseConfig)(vscode.workspace.workspaceFolders[0].uri.fsPath, configurationWatch.ownWrite);\n            return;\n        }\n        await (0, release_actions_1.openAuthoringReleaseConfig)(workspaceRootForCommands, configurationWatch.ownWrite);',
    says: 'with nothing anchored, the Release configuration command writes a configuration into the folder opened',
  },
  {
    name: 'anchor-file-without-a-workspace-key', scenario: 'no-workspace-first-day',
    checks: ['welcome-page.create-workspace-configuration-anchors-the-folder', 'welcome-page.created-configuration-still-anchors-after-a-reopen'], moves: 'red', target: 'extension',
    file: 'out/src/workspace.js', find: '    `workspace: {}\\n`;', replace: '    `settings: {}\\n`;',
    says: 'the configuration the welcome page\'s control writes carries no workspace key, so it anchors nothing',
  },
  {
    name: 'existing-configuration-overwritten', scenario: 'no-workspace-first-day', checks: ['welcome-page.create-workspace-configuration-again-opens-it-unchanged'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: "await fs.writeFile(target, workspace_1.WORKSPACE_ANCHOR_CONFIG, { flag: 'wx' });", replace: "await fs.writeFile(target, workspace_1.WORKSPACE_ANCHOR_CONFIG, { flag: 'w' });",
    says: 'the control overwrites a configuration that is already there',
  },
  // ---- an empty folder beneath a workspace root ----
  {
    name: 'authoring-release-opens-the-folders-own', scenario: 'workspace-above-authoring-release', checks: ['workspace-config.authoring-release-opens-the-roots-configuration'], moves: 'red', target: 'extension',
    file: EXTENSION,
    find: '        await (0, release_actions_1.openAuthoringReleaseConfig)(workspaceRootForCommands, configurationWatch.ownWrite);',
    replace: '        await (0, release_actions_1.openAuthoringReleaseConfig)(vscode.workspace.workspaceFolders[0].uri.fsPath, configurationWatch.ownWrite);',
    says: 'the Release configuration command opens the configuration of the folder opened rather than the workspace root\'s',
  },
  // ---- the gateway folder, a draft and a publication ----
  { name: 'context-row-renamed-endings', scenario: 'gateway-endings', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'draft-saved-into-the-folder', scenario: 'gateway-endings', checks: ['draft-entity.ends-with-the-draft-open-unsaved-and-nothing-written'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: "        await (0, open_document_1.openDocument)(result.skeleton, 'yaml');",
    replace: "        require('fs').writeFileSync(require('path').join(deps.getWorkspaceRoot(), 'drafted.yaml'), result.skeleton);\n        await (0, open_document_1.openDocument)(result.skeleton, 'yaml');",
    says: 'a draft is written into the folder before it is shown',
  },
  {
    name: 'reach-left-out-of-a-publication', scenario: 'gateway-endings', checks: ['publication.ends-naming-what-others-now-resolve'], moves: 'red', target: 'extension',
    file: 'out/src/publication-request.js',
    find: '        detail: `published ${result.reference}:${result.tag} as ${result.digest}${signature}.`\n            + ` ${reachPhrase(result.reach)}`,',
    replace: '        detail: `published ${result.reference}:${result.tag} as ${result.digest}${signature}.`,',
    says: 'a publication ends without the sentence saying who now resolves it',
  },
  {
    name: 'already-published-read-as-a-publication', scenario: 'gateway-endings', checks: ['publication.identical-bytes-again-publish-nothing'], moves: 'red', target: 'extension',
    file: 'out/src/publication-request.js', find: '    if (result.alreadyPublished) {\n        return {', replace: '    if (false) {\n        return {',
    says: 'an answer that found the same bytes already published is read as a publication',
  },
  // ---- a documentation example with two Releases, watched and stopped ----
  { name: 'context-row-renamed-watch-and-stop', scenario: 'mysql-watch-and-stop', checks: ['commands-panel.context-rows-name-the-folder-and-no-release'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'selection-raises-a-notification', scenario: 'mysql-watch-and-stop', checks: ['release-selection.choosing-a-release-updates-the-indicator-and-raises-no-notification'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '        outputChannel?.appendLine(`selected Release: ${chosen}`);',
    replace: '        outputChannel?.appendLine(`selected Release: ${chosen}`);\n        void vscode.window.showInformationMessage(`Aggrega: now working on ${chosen}.`);',
    says: 'choosing a Release raises a notification naming it',
  },
  {
    name: 'stop-not-sent-to-the-server', scenario: 'mysql-watch-and-stop', checks: ['operations.build-can-be-watched-and-stopped'], moves: 'red', target: 'extension',
    file: DAEMON, find: '            this.writeCancelRequest(id);', replace: '',
    says: 'a stopped request is abandoned on this side without the language server being told, so the build goes on',
  },
  {
    name: 'pull-not-ended-on-a-stop', scenario: 'mysql-watch-and-stop', checks: ['operations.pull-can-be-watched-and-stopped'], moves: 'red', target: 'extension',
    file: 'out/src/cli-run.js',
    find: "            if (child.exitCode === null && child.signalCode === null) {\n                child.kill('SIGTERM');",
    replace: "            if (false) {\n                child.kill('SIGTERM');",
    says: 'a stopped command is reported stopped without the process being ended, so it runs on',
  },
];

// PlantRefused is a plant that cannot be applied as written.
export class PlantRefused extends Error {}

// plantNamed returns the plant of that name, or refuses naming every plant.
export function plantNamed(name: string): Plant {
  const p = PLANTS.find((x) => x.name === name);
  if (!p) { throw new PlantRefused(`no plant is named ${JSON.stringify(name)}; \`run.js plants\` lists them`); }
  return p;
}

function occurrences(text: string, needle: string): number {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) { n++; }
  return n;
}

// checkPlant reports whether a plant's replaced text occurs exactly once in its
// file under `root`, and how often it does.
export function checkPlant(plant: Plant, root: string): { file: string; found: number } {
  const file = path.join(root, plant.file);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, found: -1 };
  }
  return { file, found: occurrences(text, plant.find) };
}

// applyPlant makes the plant's one edit in the copy under `root`, refusing unless
// the replaced text occurs exactly once, and reads the file back.
export function applyPlant(plant: Plant, root: string): string {
  const { file, found } = checkPlant(plant, root);
  if (found !== 1) {
    throw new PlantRefused(found === -1
      ? `the plant ${plant.name} edits ${file}, which is not there`
      : `the plant ${plant.name} replaces text that occurs ${found} times in ${file}, not once`);
  }
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(plant.find, () => plant.replace));
  const after = fs.readFileSync(file, 'utf8');
  if (occurrences(after, plant.find) !== (plant.replace.includes(plant.find) ? 1 : 0) || (plant.replace !== '' && !after.includes(plant.replace))) {
    throw new PlantRefused(`the plant ${plant.name} did not read back from ${file} as written`);
  }
  return `${plant.name}: ${plant.says}; one edit made in ${file} (${text.length} → ${after.length} bytes)`;
}
