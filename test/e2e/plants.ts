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

// The compiled lines deciding whether a registration is followed by the question
// for a trust policy to pin by hand, naming the offline refusal that is, and
// composing the registration request.
const REGISTRY_CONFIGURE = 'out/src/registry-configure.js';
const ASKS_FOR_TRUST = '    return result.trust.notAdvertised === true && !result.trust.pinned && !result.trust.baseline;';
const OFFLINE_REFUSAL_CODE = "exports.OFFLINE_REGISTRATION_WITHOUT_TRUST_POLICY = 'E0310';";
const REGISTRATION_REQUEST = '    const request = { host: checked, ...(0, config_write_scope_1.configWriteOverrides)(destination) };';
// The compiled lines ending a registration that carries what the reader supplied
// by hand, where a refusal becomes the ending the reader is shown.
const BY_HAND_REFUSAL = '(registrationDetail(answer, request), inEffect) };\n    }\n    catch (err) {\n        return (0, operation_outcome_1.outcomeOf)(err);';

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

// The topology graph panel: its drawing, its style and the layout model it draws
// from, the projection of what is attached and of what may attach, the side that
// serves its requests and reports a failed drawing, and the edit an attach
// composes.
const GRAPH_SCRIPT = 'media/graph.js';
const GRAPH_MODEL = 'media/graph-model.js';
const GRAPH_STYLE = 'media/graph.css';
const GRAPH_FAILURE = 'out/src/graph-failure.js';
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
    name: 'undeclared-key-reaches-the-server', scenario: 'gateway', checks: ['language-server.undeclared-setting-key-is-inert'], moves: 'red', target: 'extension',
    file: DAEMON, find: "    const args = ['serve'];",
    replace: "    const args = ['serve', ...(require('vscode').workspace.getConfiguration('aggrega.server').get('renderDiagnostics') ? ['--render-diagnostics'] : [])];",
    says: 'the undeclared key, when set, adds --render-diagnostics to the language server\'s command line',
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
    name: 'validation-offered-whatever-the-kind', scenario: 'storefront', checks: ['catalog-view.each-row-offers-what-the-compiler-accepts-for-its-kind'], moves: 'red', target: 'extension',
    file: 'out/src/catalog-entity-operations.js',
    find: '    if (hasDocument && accepts !== null && accepts.singleEntityValidation) {',
    replace: '    if (hasDocument) {',
    says: 'a Catalog row with a document offers "Validate this entity" whatever the compiler says single-entity validation accepts for the row\'s kind',
  },
  {
    name: 'operations-dropped-from-rows-with-a-document', scenario: 'storefront', checks: ['catalog-view.each-row-offers-what-the-compiler-accepts-for-its-kind'], moves: 'red', target: 'extension',
    file: CATALOG_VIEW,
    find: '        if (context !== null) {\n            item.contextValue = context;',
    replace: '        if (context !== null && node.row.openPath === null) {\n            item.contextValue = context;',
    says: 'a Catalog row with a document carries no value for its operations to be bound to, so its context menu offers none of those the compiler accepts for its kind, while a row with no document keeps its own',
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
  {
    name: 'trust-question-not-asked', scenario: 'storefront-with-registries', checks: ['registration.asks-for-a-trust-policy-where-the-registry-advertises-none'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: ASKS_FOR_TRUST, replace: '    return result.trust.notAdvertised === true && result.trust.pinned;',
    says: 'an answer saying the registry advertises no trust policy is read as one leaving nothing to ask',
  },
  {
    name: 'declined-registration-requires-signatures', scenario: 'storefront-with-registries', checks: ['registration.declined-writes-what-the-command-line-writes'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: REGISTRATION_REQUEST, replace: REGISTRATION_REQUEST.replace('(destination) };', '(destination), requireSignatures: true };'),
    says: 'every registration the extension composes states a signature requirement the reader never asked for',
  },
  {
    name: 'identity-checked-before-sending', scenario: 'storefront-with-registries', checks: ['registration.refuses-a-malformed-identity-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: '        request.identities = [...byHand.identities];',
    replace: '        request.identities = byHand.identities.filter((i) => /^[^=]+=[^=]+$/.test(i));',
    says: 'an identity the extension judges malformed is dropped before the request goes out, so the compiler never refuses it',
  },
  {
    name: 'supplied-key-left-out', scenario: 'storefront-with-registries', checks: ['registration.writes-the-identities-and-key-supplied'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: '        request.keyPath = byHand.keyPath;\n', replace: '',
    says: 'the registration composed from the reader\'s answers leaves out the key file they chose',
  },
  {
    name: 'baseline-followed-by-a-question', scenario: 'storefront-with-registries', checks: ['registration.asks-nothing-after-the-hubs-built-in-baseline'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: ASKS_FOR_TRUST, replace: '    return !result.trust.pinned;',
    says: 'every answer that pinned no advertised policy is followed by the question, the hub on its built-in baseline included',
  },
  {
    name: 'offline-refusal-code-misread', scenario: 'storefront-with-registries', checks: ['registration.asks-for-a-trust-policy-after-the-offline-refusal'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: OFFLINE_REFUSAL_CODE, replace: OFFLINE_REFUSAL_CODE.replace("'E0310'", "'E0311'"),
    says: 'the offline refusal is recognised by a short code it does not carry, so it is followed by no question',
  },
  {
    name: 'refused-key-file-content-shown', scenario: 'storefront-with-registries', checks: ['registration.refuses-a-key-file-that-is-not-a-public-key-without-showing-its-content'], moves: 'red', target: 'extension',
    file: REGISTRY_CONFIGURE, find: BY_HAND_REFUSAL,
    replace: BY_HAND_REFUSAL.replace('    catch (err) {\n', "    catch (err) {\n        if (request.keyPath !== undefined && err && typeof err.message === 'string') { err.message = err.message.replace('<redacted>', JSON.stringify(require('fs').readFileSync(request.keyPath, 'utf8'))); }\n"),
    says: 'the refusal of a registration carrying a key file is shown with that file\'s content in place of the value the compiler withheld',
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
    name: 'graph-posted-without-the-setting', scenario: 'storefront-graph-panel', checks: ['attachments-panel.setting-on-shows-the-value-as-authored'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW,
    find: "        void panel.webview.postMessage({ type: 'render', release, graph, asked: !opts.quiet, showsSensitiveValues });",
    replace: "        void panel.webview.postMessage({ type: 'render', release, graph, asked: !opts.quiet });",
    says: 'the graph is posted to the panel without saying whether the setting was on, so the panel withholds by the declarations a value the sending side sent because the setting is on',
  },
  {
    name: 'panel-drops-the-setting-it-was-posted', scenario: 'storefront-graph-panel', checks: ['attachments-panel.setting-on-shows-the-value-as-authored'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '      renderGraph(msg.graph, !!msg.asked, msg.showsSensitiveValues)', replace: '      renderGraph(msg.graph, !!msg.asked)',
    says: 'the panel draws a graph without the statement it was posted with about the setting, so it projects every graph as though the setting were off',
  },
  {
    name: 'declared-leaves-matched-nowhere', scenario: 'storefront-graph-panel',
    checks: ['attachments-panel.setting-off-again-withholds-the-value', 'attachments-panel.setting-that-is-not-a-boolean-withholds-the-value'], moves: 'red', target: 'extension',
    file: ATTACHMENTS_MODEL, find: '    if (coveredByDeclaration(leaf.path, declared)) { return WITHHELD_DECLARED; }\n', replace: '',
    says: 'no leaf is withheld for a declaration, on the side that sends the graph and on the side that draws it, so a declared-sensitive value is drawn whatever the setting says',
  },
  {
    name: 'any-truthy-setting-read-as-on', scenario: 'storefront-graph-panel', checks: ['attachments-panel.setting-that-is-not-a-boolean-withholds-the-value'], moves: 'red', target: 'extension',
    file: 'out/src/settings.js', find: '    return configured === true;', replace: '    return !!configured;',
    says: 'the one reading of the setting takes any value but false, zero or an empty string as on, so a hand-edited "yes" or 1 sends the graph unredacted and tells the panel the setting is on',
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
    file: GRAPH_FAILURE, find: '    sinks.logLine(`irGraph failed for ${release}: ${message}`);', replace: '    sinks.logLine(`irGraph failed for ${release}: ${String(err)}`);',
    says: 'a failed drawing is written to the channel as the thrown value rendered as a string, which reads "[object Object]" for a refusal the language server answered',
  },
  {
    name: 'declined-attach-reworded', scenario: 'storefront-graph-panel', checks: ['attach.refusal-carries-the-compilers-words'], moves: 'red', target: 'extension',
    file: ATTACHMENT_EDIT, find: 'return attachRefusal((0, error_surfaces_1.describeError)(err));', replace: "return attachRefusal('the request was declined.');",
    says: 'an attach the compiler declines is reported in a sentence of the extension\'s own, dropping the compiler\'s words',
  },
  {
    name: 'refusal-for-an-undrawn-node-dropped', scenario: 'storefront-graph-panel', checks: ['attach.request-for-a-node-the-panel-did-not-draw-is-refused-in-its-words'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    if (nodeId !== selectedId && (attached || nodeGroups.has(nodeId))) { return; }', replace: '    if (nodeId !== selectedId) { return; }',
    says: 'the panel drops every line about an attach whose node is not the one it is showing, the refusal for a node its drawing does not carry included',
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
    name: 'undeclared-grouping-read-as-none-declared', scenario: 'probes-nothing-may-attach', checks: ['graph.undeclared-groupings-titled-by-kind-in-words'], moves: 'green', target: 'extension',
    file: GRAPH_MODEL,
    find: '      const bKey = n.boundary_path || UNGROUPED;\n      const sKey = n.subsystem_path || UNGROUPED;',
    replace: "      const bKey = n.boundary_path && n.boundary_path !== 'default' ? n.boundary_path : UNGROUPED;\n      const sKey = n.subsystem_path && n.subsystem_path !== 'default' ? n.subsystem_path : UNGROUPED;",
    says: 'the drawing reads a grouping the compiler names "default" as one nobody declared, as it reads one the compiler names not at all',
  },
  {
    name: 'empty-answer-worded-as-finalised-labels', scenario: 'probes-nothing-may-attach', checks: ['may-attach.nothing-matching-reads-as-an-empty-state'], moves: 'red', target: 'extension',
    file: CANDIDATES_MODEL,
    find: "      return 'No Feature\\'s declared applicability matches the labels on this node.';",
    replace: "      return 'No Feature\\'s declared applicability matches this node\\'s finalised labels.';",
    says: 'an empty answer computed over a node of the drawn graph reads that nothing matches "this node\'s finalised labels", naming the set the caption calls the labels on this node in words of its own',
  },
  // ---- the gateway folder, a component at the top level ----
  { name: 'context-row-renamed-top-level-attach', scenario: 'gateway-top-level-attach', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'no-container-key-written-top-level', scenario: 'gateway-top-level-attach', checks: ['attach.top-level-component-lands-under-its-components-block'], moves: 'red', target: 'extension', ...NO_CONTAINER_KEYS,
  },
  {
    name: 'saved-after-the-edit-top-level', scenario: 'gateway-top-level-attach', checks: ['attach.nothing-is-saved-and-the-folder-is-as-it-started'], moves: 'red', target: 'extension', ...SAVED_AFTER_EDIT,
  },
  // ---- the storefront folder's drawing, its legend, and when it is drawn again ----
  { name: 'context-row-renamed-graph-drawing', scenario: 'storefront-graph-drawing', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'frame-pushed-right', scenario: 'storefront-graph-drawing', checks: ['graph.first-opening-frames-the-whole-topology'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    view.x = (box.width - w * view.scale) / 2;', replace: '    view.x = box.width - (w * view.scale) / 4;',
    says: 'a drawing is framed pushed to the right of the panel, most of it past the edge',
  },
  {
    name: 'container-title-across-its-middle', scenario: 'storefront-graph-drawing', checks: ['graph.no-two-labels-overlap'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: "    title.setAttribute('y', box.y + 16);", replace: "    title.setAttribute('y', box.y + box.height / 2);",
    says: 'each container\'s title is written across the middle of its box, over what the box holds',
  },
  {
    name: 'card-sized-to-its-id', scenario: 'storefront-graph-drawing', checks: ['graph.component-names-drawn-whole-inside-their-cards'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: '    return Math.max(MIN_NODE_W, Math.ceil(Math.max(idWidth, subWidth)) + NODE_PAD_X);', replace: '    return Math.max(MIN_NODE_W, Math.ceil(idWidth) + NODE_PAD_X);',
    says: 'a card is sized against its id alone, so a component name longer than the card runs past its border',
  },
  {
    name: 'boundary-set-aside', scenario: 'storefront-graph-drawing', checks: ['graph.release-boundaries-drawn-holding-what-they-place'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: '      const bKey = n.boundary_path || UNGROUPED;', replace: '      const bKey = UNGROUPED;',
    says: 'the drawing sets aside the boundary the compiler sends for each node, so every node lands in one box',
  },
  {
    name: 'boxes-placed-unresolved', scenario: 'storefront-graph-drawing',
    checks: ['graph.imported-module-component-drawn-in-its-boundary', 'graph.edge-between-boundaries-runs-from-one-card-to-the-other'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: '        const x = offX + (child.x || 0);', replace: '        const x = child.x || 0;',
    says: 'each box is placed by its position inside its container, unresolved against where the container itself sits',
  },
  {
    name: 'edge-offset-twice', scenario: 'storefront-graph-drawing', checks: ['graph.edge-inside-a-subsystem-stays-inside-it'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: '        .map((p) => ({ x: p.x + o.x, y: p.y + o.y })));', replace: '        .map((p) => ({ x: p.x + 2 * o.x, y: p.y + 2 * o.y })));',
    says: 'an edge\'s geometry is offset twice by the origin of the container it is stated against, so an edge inside a subsystem is drawn out of it',
  },
  {
    name: 'container-box-drawn-a-width-left', scenario: 'storefront-graph-drawing', checks: ['graph.no-edge-crosses-a-container-it-has-no-end-in'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT,
    find: "    rect.setAttribute('x', box.x);\n    rect.setAttribute('y', box.y);\n    rect.setAttribute('width', box.width);\n    rect.setAttribute('height', box.height);\n    rect.setAttribute('rx', '6');",
    replace: "    rect.setAttribute('x', box.x - box.width);\n    rect.setAttribute('y', box.y);\n    rect.setAttribute('width', box.width);\n    rect.setAttribute('height', box.height);\n    rect.setAttribute('rx', '6');",
    says: 'each container\'s box is drawn one width to the left of where it is laid out, so edges run through boxes they have no end in',
  },
  {
    name: 'legend-at-the-upper-right', scenario: 'storefront-graph-drawing', checks: ['legend.lower-left-names-the-groupings-and-the-type-bar-and-bounds-the-colours'], moves: 'red', target: 'extension',
    file: GRAPH_STYLE, find: '  left: 8px;\n  bottom: 8px;', replace: '  right: 8px;\n  top: 8px;',
    says: 'the legend is drawn at the upper right of the panel',
  },
  {
    name: 'legend-note-cut-short', scenario: 'storefront-graph-drawing', checks: ['legend.lower-left-names-the-groupings-and-the-type-bar-and-bounds-the-colours'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: "    + 'met. They group nodes within this graph only: the same colour in another '\n    + 'graph is not the same type.';", replace: "    + 'met.';",
    says: 'the legend\'s note drops the sentence bounding a type colour to the graph it is drawn in',
  },
  {
    name: 'boundary-row-worded-by-position', scenario: 'storefront-graph-drawing', checks: ['legend.grouping-rows-name-the-declaring-document-and-are-drawn-whole'], moves: 'red', target: 'extension',
    file: GRAPH_MODEL, find: "    { swatch: 'boundary', text: 'Boundary — a grouping the Release declares.' },", replace: "    { swatch: 'boundary', text: 'Boundary — the outer grouping.' },",
    says: 'the legend\'s boundary row says where the box sits rather than which document declares it',
  },
  {
    name: 'legend-cut-off', scenario: 'storefront-graph-drawing', checks: ['legend.grouping-rows-name-the-declaring-document-and-are-drawn-whole'], moves: 'red', target: 'extension',
    file: GRAPH_STYLE, find: '  max-width: min(320px, 40vw);', replace: '  max-width: 90px;\n  overflow: hidden;\n  white-space: nowrap;',
    says: 'the legend is held to a width its rows run past, and what runs past is cut off',
  },
  {
    name: 'graph-redrawn-on-typing', scenario: 'storefront-graph-drawing', checks: ['graph.typing-moves-the-problems-panel-and-not-the-drawing'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => debouncedValidate(e.document)));',
    replace: '    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { debouncedValidate(e.document); refreshGraphView(); }));',
    says: 'an open graph is drawn again on every change of a document\'s text, saved or not',
  },
  {
    name: 'graph-not-redrawn-on-disk-change-graph-drawing', scenario: 'storefront-graph-drawing',
    checks: ['graph.typing-moves-the-problems-panel-and-not-the-drawing', 'graph.save-redraws-the-drawing-with-no-press', 'graph.write-from-outside-the-editor-redraws-the-drawing'], moves: 'red', target: 'extension',
    file: EXTENSION, find: REFRESH_GRAPH, replace: '',
    says: 'an open graph is not drawn again when a document changes on disk',
  },
  {
    name: 'every-drawing-framed-afresh', scenario: 'storefront-graph-drawing',
    checks: ['graph.redraw-after-a-save-keeps-the-view-and-the-selection', 'graph.redraw-of-an-addition-keeps-the-view-and-draws-it-once', 'graph.redraw-behind-another-tab-keeps-the-view'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    if (asked) { framed = false; }', replace: '    framed = false;',
    says: 'every drawing is framed afresh, asked for or not, so a redraw nobody pressed for moves the reader\'s view',
  },
  {
    name: 'selection-dropped-on-redraw', scenario: 'storefront-graph-drawing', checks: ['graph.redraw-after-a-save-keeps-the-view-and-the-selection'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    if (wasSelected !== null && nodeGroups.has(wasSelected)) {', replace: '    if (false) {',
    says: 'a redraw drops the selection, even of a node the new drawing still holds',
  },
  {
    name: 'press-keeps-the-frame', scenario: 'storefront-graph-drawing', checks: ['graph.press-frames-the-whole-topology-afresh'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    if (asked) { framed = false; }', replace: '    if (false) { framed = false; }',
    says: 'a drawing once framed is never framed afresh, so a press on Graph leaves the reader where they were',
  },
  {
    name: 'failed-redraw-not-dimmed', scenario: 'storefront-graph-drawing', checks: ['graph.failed-redraw-after-a-save-dims-the-drawing-and-says-so'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: "    canvas.classList.toggle('out-of-date', stale);", replace: "    canvas.classList.toggle('out-of-date', false);",
    says: 'a drawing the compiler could not rebuild is left undimmed under the notice',
  },
  {
    name: 'panel-sent-the-thrown-value', scenario: 'storefront-graph-drawing', checks: ['graph.failed-redraw-after-a-save-dims-the-drawing-and-says-so'], moves: 'red', target: 'extension',
    file: GRAPH_FAILURE, find: '    sinks.notifyPanel(message);', replace: '    sinks.notifyPanel(String(err));',
    says: 'a failed drawing is reported to the panel as the thrown value rendered as a string, which reads "[object Object]" for a refusal the language server answered',
  },
  {
    name: 'press-puts-up-no-notice', scenario: 'storefront-graph-drawing', checks: ['graph.press-on-the-same-fault-ends-in-the-same-presentation'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '      setStatus(`Laying out ${msg.release}…`, false);', replace: '      void 0;',
    says: 'nothing is put up at the panel\'s top while a drawing the reader pressed for is laid out',
  },
  {
    name: 'pressed-failure-sent-without-its-release', scenario: 'storefront-graph-drawing', checks: ['graph.press-on-the-same-fault-ends-in-the-same-presentation'], moves: 'red', target: 'extension',
    file: GRAPH_VIEW, find: "                void panel.webview.postMessage({ type: 'error', release, message });", replace: "                void panel.webview.postMessage({ type: 'error', release: opts.quiet ? release : '', message });",
    says: 'a failure the reader pressed for reaches the panel without the Release it is about, so its notice reads otherwise than a save\'s for the same fault',
  },
  {
    name: 'dimming-left-on', scenario: 'storefront-graph-drawing', checks: ['graph.good-redraw-lifts-the-dimming'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: "    canvas.classList.remove('out-of-date');", replace: '    void 0;',
    says: 'a drawing rebuilt after a failure keeps the dimming the failure put on it',
  },
  {
    name: 'canvas-read-as-drawn', scenario: 'storefront-graph-drawing', checks: ['graph.failure-with-nothing-drawn-claims-no-drawing-out-of-date'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    return canvas.firstChild !== null;', replace: '    return true;',
    says: 'the canvas is read as holding a drawing whether or not it does, so a panel that drew nothing says its drawing is out of date',
  },
  {
    name: 'off-screen-frame-of-its-own-choosing', scenario: 'storefront-graph-drawing', checks: ['graph.first-drawing-behind-another-tab-framed-on-return'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '      const box = readableBox();', replace: '      const box = readableBox() || { width: 300, height: 150 };',
    says: 'a drawing that arrives while the panel is off screen is framed against a size of the panel\'s own choosing',
  },
  // ---- the storefront folder at rest, with the build's analysis on ----
  { name: 'context-row-renamed-graph-idle', scenario: 'storefront-graph-idle', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'graph-redrawn-on-every-push', scenario: 'storefront-graph-idle', checks: ['graph.open-panel-compiles-once-then-rests'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '        (0, diagnostics_1.publishDiagnostics)(diagnosticCollections, uri, params.diagnostics ?? []);',
    replace: '        (0, diagnostics_1.publishDiagnostics)(diagnosticCollections, uri, params.diagnostics ?? []);\n        refreshGraphView();',
    says: 'an open graph is drawn again on every set of findings the compiler pushes, so the panel\'s own request asks for the next one',
  },
  {
    name: 'graph-not-redrawn-on-disk-change-graph-idle', scenario: 'storefront-graph-idle',
    checks: ['graph.open-panel-compiles-once-then-rests', 'problems.misspelled-socket-leaves-once-it-is-put-right'], moves: 'red', target: 'extension',
    file: EXTENSION, find: REFRESH_GRAPH, replace: '',
    says: 'an open graph is not drawn again when a document changes on disk',
  },
  // ---- the folder of a few dozen nodes ----
  { name: 'context-row-renamed-fleet', scenario: 'fleet-graph-first-fit', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'first-fit-held-to-a-smallest-zoom', scenario: 'fleet-graph-first-fit', checks: ['graph.large-topology-arrives-whole-in-its-first-drawing'], moves: 'red', target: 'extension',
    file: GRAPH_SCRIPT, find: '    const scale = Math.min(box.width / (w + 40), box.height / (h + 40), 1.5);', replace: '    const scale = Math.max(0.75, Math.min(box.width / (w + 40), box.height / (h + 40), 1.5));',
    says: 'a fit is held to a smallest zoom, so a topology too large for the panel at that zoom runs past its edges',
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
    name: 'status-bar-menu-listed-with-no-server', scenario: 'no-workspace-first-day', checks: ['palette.status-bar-menu-is-left-out-with-no-server'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        "title": "Aggrega: Open status bar menu",\n        "enablement": "aggrega.compilerAnswerable"',
    replace: '        "title": "Aggrega: Open status bar menu"',
    says: 'the status bar menu command carries no enablement condition, so the palette lists it whether or not a language server answers',
  },
  {
    name: 'status-bar-menu-gated-on-a-condition-nothing-publishes', scenario: 'no-workspace-first-day', checks: ['palette.status-bar-menu-is-listed-once-a-server-answers'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        "title": "Aggrega: Open status bar menu",\n        "enablement": "aggrega.compilerAnswerable"',
    replace: '        "title": "Aggrega: Open status bar menu",\n        "enablement": "aggrega.compilerAnswered"',
    says: 'the status bar menu command is gated on an editor condition the extension never publishes, so it stays unavailable once a language server answers',
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
  // ---- which folder, which Aggrega workspace, which Release: one folder, two Releases ----
  {
    name: 'sole-folder-left-unchosen', scenario: 'two-releases-context-rows', checks: ['context-rows.sole-candidates-taken-without-a-chooser'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: '    if (folders.length === 1) {\n        return folders[0];', replace: '    if (folders.length === 1) {\n        return null;',
    says: 'a window\'s sole open folder is not taken as the Project folder, so the row waits on a choice with nothing to choose between',
  },
  { name: 'context-row-renamed-two-releases', scenario: 'two-releases-context-rows', checks: ['context-rows.three-rows-on-lines-of-their-own'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'create-gap-left-out', scenario: 'two-releases-context-rows', checks: ['context-rows.create-controls-beside-the-workspace-and-release-rows'], moves: 'red', target: 'extension',
    file: RENDER, find: `        ? '<span class="selector-create-gap" aria-hidden="true"></span>'`, replace: "        ? ''",
    says: 'a row without a create control draws no empty space in its place, so its choosing control is wider than the rows beside it',
  },
  {
    name: 'row-labels-given-one-width', scenario: 'two-releases-context-rows', checks: ['context-rows.values-start-in-line'], moves: 'green', target: 'extension',
    file: 'media/operations.css', find: '.selector-label {\n  flex: 0 0 auto;', replace: '.selector-label {\n  flex: 0 0 10rem;',
    says: 'the three rows\' labels are drawn at one width, so the values after them start in line',
  },
  {
    name: 'workspace-chooser-titled-as-the-release-chooser', scenario: 'two-releases-context-rows', checks: ['context-rows.each-row-opens-its-own-chooser'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: 'exports.CHOOSE_ANCHOR_PLACEHOLDER = `Aggrega: choose which ${selector_levels_1.SELECTOR_ROW_LABELS.workspace} the editor works in`;',
    replace: "exports.CHOOSE_ANCHOR_PLACEHOLDER = 'Aggrega: choose the Release to work on';",
    says: 'the Aggrega workspace row\'s chooser carries the Release chooser\'s placeholder, so one placeholder serves two rows',
  },
  {
    name: 'release-create-settles-no-kind', scenario: 'two-releases-context-rows', checks: ['release-row.create-control-asks-only-for-the-name'], moves: 'red', target: 'extension',
    ...draftingWithNoKindSettled(),
  },
  {
    name: 'choice-of-the-workspace-in-use-restarts', scenario: 'two-releases-context-rows', checks: ['context-rows.choosing-where-you-are-restarts-nothing'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '        await ensureDaemonAt(extensionContext, choice.offer.anchored);',
    replace: '        await vscode.commands.executeCommand(daemon_status_1.RESTART_COMMAND);\n        await ensureDaemonAt(extensionContext, choice.offer.anchored);',
    says: 'a choice on the Aggrega workspace row restarts the language server, the workspace already in use included',
  },
  {
    name: 'release-hover-ends-lowercase', scenario: 'two-releases-context-rows', checks: ['context-rows.hovers-promise-a-choice'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: 'Click to choose a different ${selector_levels_1.SELECTOR_ROW_LABELS.release}.`,', replace: 'Click to choose a different release.`,',
    says: 'the Release row\'s hover closes with a lowercase "release."',
  },
  {
    name: 'chosen-release-not-remembered', scenario: 'two-releases-context-rows', checks: ['release-selection.survives-a-window-reload', 'release-selection.survives-closing-and-reopening-the-window'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '            deps.store.write(chosen.release);', replace: '            void 0;',
    says: 'a Release chosen is not remembered for the window, so a reload and a reopen each come back on the workspace\'s default',
  },
  {
    name: 'dropped-release-not-said', scenario: 'two-releases-context-rows', checks: ['release-selection.one-no-longer-offered-falls-back-and-says-so'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js',
    find: "            deps.reportInfo(`Aggrega: ${remembered} is no longer offered in this workspace, so the previous selection was dropped. Falling back to this workspace's default.`);",
    replace: '            void 0;',
    says: 'a remembered Release that is no longer offered is dropped without a word',
  },
  {
    name: 'unanswered-server-read-as-none-selected', scenario: 'two-releases-context-rows', checks: ['release-row.reads-unavailable-with-the-server-stopped'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: "                value: 'unavailable',", replace: "                value: 'none selected',",
    says: 'the Release row reads "none selected" where no language server answers which Release is selected',
  },
  {
    name: 'workspace-hover-promises-a-switch', scenario: 'two-releases-context-rows', checks: ['context-rows.no-surface-refuses-a-sole-candidate-or-promises-a-switch'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: 'exports.CHOOSE_ANCHOR_INVITATION = `Click to choose which ${selector_levels_1.SELECTOR_ROW_LABELS.workspace} the editor works in.`;',
    replace: "exports.CHOOSE_ANCHOR_INVITATION = 'Click to switch the anchored folder.';",
    says: 'the Aggrega workspace row\'s hover closes by promising a switch',
  },
  // ---- two Aggrega workspaces reached in one window ----
  {
    name: 'two-workspaces-attach-to-the-first', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.editor-add-leaves-the-choice-to-the-reader'], moves: 'red', target: 'extension',
    ...severalReachedAttachToTheFirst(),
  },
  {
    name: 'pending-notice-button-opens-nothing', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.choosing-from-the-notice-starts-the-server-there'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    if (choice === action) {\n        void vscode.commands.executeCommand(anchor_picker_1.SWITCH_ANCHOR_COMMAND);',
    replace: '    if (false) {\n        void vscode.commands.executeCommand(anchor_picker_1.SWITCH_ANCHOR_COMMAND);',
    says: 'the notice offering the choice of workspace opens nothing when its button is pressed',
  },
  {
    name: 'every-add-read-as-costing-a-restart', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.workspace-chooser-in-a-two-folder-window'], moves: 'red', target: 'extension',
    ...everyAddReadAsMakingANewWorkspace(),
  },
  {
    name: 'status-item-names-the-first-workspace', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.switching-moves-the-rows-and-the-status-bar'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: '(0, workspace_1.workspaceRootOf)(active), anchored.map', replace: '(0, workspace_1.workspaceRootOf)(anchored[0]), anchored.map',
    says: 'the status bar\'s workspace item names the first workspace reached, whichever is in use',
  },
  {
    name: 'chosen-workspace-not-remembered', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.workspace-chosen-survives-a-reload'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: '    await state.update(exports.STATE_KEY, anchorPath ?? undefined);', replace: '    void 0;',
    says: 'the Aggrega workspace chosen is not remembered for the window',
  },
  {
    name: 'project-folder-scopes-nothing', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.project-folder-choice-scopes-the-workspaces-on-offer'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    return inForce === null ? [...folders] : [inForce];', replace: '    return [...folders];',
    says: 'the Project folder chosen scopes nothing, so every open folder answers for the workspaces on offer',
  },
  {
    name: 'chosen-project-folder-not-remembered', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.project-folder-choice-survives-a-reload'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: '    await state.update(exports.PROJECT_FOLDER_STATE_KEY, folderPath ?? undefined);', replace: '    void 0;',
    says: 'the Project folder chosen is not remembered for the window',
  },
  {
    name: 'sole-folder-line-at-every-count', scenario: 'two-workspaces-context-rows', checks: ['two-workspaces.project-hover-with-two-folders-names-no-sole-candidate'], moves: 'red', target: 'extension',
    file: 'out/src/selector-rows.js', find: '    const sole = candidates === 1 ?', replace: '    const sole = candidates >= 1 ?',
    says: 'the Project folder row\'s hover says only one Project folder is available whatever the count',
  },
  // ---- the Project folder row's opens and adds ----
  {
    name: 'add-entry-labelled-otherwise', scenario: 'project-folder-adds', checks: ['project-folder.chooser-offers-two-ways-to-reach-another'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: "exports.ADD_FOLDER_ENTRY_LABEL = 'Add folder to this window…';", replace: "exports.ADD_FOLDER_ENTRY_LABEL = 'Add folder…';",
    says: 'the Project folder chooser\'s add entry is labelled "Add folder…", which says nothing of which folders it is added beside',
  },
  {
    name: 'widen-detail-names-no-cost', scenario: 'project-folder-adds', checks: ['workspace-row.last-entry-names-what-the-add-costs-here'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: '    return (0, window_kind_1.withAddingCost)(WIDEN_ANCHOR_OFFER_DETAIL, windowKind);', replace: '    return WIDEN_ANCHOR_OFFER_DETAIL;',
    says: 'the Aggrega workspace row\'s last entry is composed without what the add it ends in costs',
  },
  {
    name: 'open-dialog-button-reads-add', scenario: 'project-folder-adds', checks: ['project-folder.open-dialog-names-its-act-lists-folders-and-cancels-quietly'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: "    openLabel: 'Open',", replace: "    openLabel: 'Add',",
    says: 'the open entry\'s dialog names the other act on its button',
  },
  {
    name: 'add-dialog-titled-as-the-open-dialog', scenario: 'project-folder-adds', checks: ['project-folder.add-dialog-names-its-act-and-cancels-quietly'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: "    title: 'Aggrega: select a folder to add to this window',", replace: "    title: 'Aggrega: select a folder to open in this window',",
    says: 'the add entry\'s dialog is titled as the open entry\'s',
  },
  {
    name: 'folder-already-open-handed-to-the-editor', scenario: 'project-folder-adds', checks: ['project-folder.adding-a-folder-already-open-says-so'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: '    if (open.some((f) => f.uri.fsPath === folderPath)) {', replace: '    if (false) {',
    says: 'a folder already open is handed to the editor to add like any other, which refuses it as a decline',
  },
  {
    name: 'add-answer-kept-by-the-window-left', scenario: 'project-folder-adds', checks: ['project-folder.add-from-one-folder-comes-back-working-from-it'], moves: 'red', target: 'extension',
    file: 'out/src/project-folder.js', find: '    if ((0, window_kind_1.addingMakesNewWorkspace)(adding.windowKind)) {\n', replace: '    if (false) {\n',
    says: 'the answer an add gives is written into the window being left rather than carried into the workspace it makes',
  },
  {
    name: 'add-in-place-read-as-a-new-workspace', scenario: 'project-folder-adds', checks: ['project-folder.add-in-place-costs-nothing-and-says-where'], moves: 'red', target: 'extension',
    ...everyAddReadAsMakingANewWorkspace(),
  },
  {
    name: 'open-entry-adds-instead', scenario: 'project-folder-adds', checks: ['project-folder.open-replaces-and-leaves-nothing-behind'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '                openFolder: (folder) => (0, window_folders_1.openFolderInWindow)(folder),',
    replace: '                openFolder: async (folder) => { (0, window_folders_1.appendFolderToWindow)(folder); },',
    says: 'the open entry adds the folder picked beside the ones the window has rather than opening it in their place',
  },
  {
    name: 'no-folder-answered-with-a-chooser', scenario: 'project-folder-adds', checks: ['workspace-row.no-folder-open-answers-with-the-ways-out'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '        if ((vscode.workspace.workspaceFolders ?? []).length === 0) {', replace: '        if (false) {',
    says: 'the Aggrega workspace row answers a window with no folder by opening a chooser',
  },
  {
    name: 'no-folder-read-as-none-chosen', scenario: 'project-folder-adds', checks: ['project-folder.row-in-a-window-with-no-folder'], moves: 'red', target: 'extension',
    file: 'out/src/selector-rows.js', find: '    if (candidates === 0) {\n        // The chooser this row opens carries opening a folder', replace: '    if (candidates === -1) {\n        // The chooser this row opens carries opening a folder',
    says: 'a window with no folder open is read as one with folders open and none chosen',
  },
  {
    name: 'widened-workspace-not-carried', scenario: 'project-folder-adds', checks: ['workspace-row.last-entry-carries-the-workspace-chosen'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: "{ level: 'workspace', path: choice.anchorPath });", replace: "{ level: 'workspace', path: '' });",
    says: 'the workspace picked through the last entry is not carried into the window the add makes',
  },
  // ---- where the markers sit, relative to the folder opened ----
  {
    name: 'nothing-reachable-read-as-none-chosen', scenario: 'workspace-discovery-layouts', checks: ['workspace-row.nothing-reachable-reads-none-available-and-the-ways-out'], moves: 'red', target: 'extension',
    ...nothingReachableReadAsNoneChosen(),
  },
  {
    name: 'release-row-asks-with-no-workspace', scenario: 'workspace-discovery-layouts', checks: ['release-row.no-workspace-in-use-answers-with-the-ways-out'], moves: 'red', target: 'extension',
    file: EXTENSION, find: 'SELECT_RELEASE_COMMAND, async () => {\n        if (!workspaceRootForCommands) {', replace: 'SELECT_RELEASE_COMMAND, async () => {\n        if (false) {',
    says: 'the Release row asks the selection for a chooser whether or not a workspace is in use',
  },
  {
    name: 'widen-label-says-another-always', scenario: 'workspace-discovery-layouts', checks: ['workspace-row.nothing-reachable-offers-only-the-first-folder-entry'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: '    return anchoredCount === 0', replace: '    return anchoredCount === -1',
    says: 'the Aggrega workspace row\'s last entry says "another" with no workspace reached',
  },
  {
    name: 'workspace-create-drafts-a-release', scenario: 'workspace-discovery-layouts', checks: ['workspace-row.create-control-makes-the-folder-the-root'], moves: 'red', target: 'extension',
    file: 'out/src/selector-rows.js', find: '            command: get_started_steps_1.CREATE_WORKSPACE_COMMAND,', replace: '            command: get_started_steps_1.DRAFT_RELEASE_COMMAND,',
    says: 'the Aggrega workspace row\'s create control runs the Release row\'s drafting rather than writing a workspace configuration',
  },
  {
    name: 'look-inside-never-completes', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.a-marker-below-the-folder-is-offered-beside-it'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    if (generation !== folderEvaluation) {', replace: '    if (true) {',
    says: 'the look through what the folder holds never completes the workspaces on offer',
  },
  {
    name: 'workspace-in-use-compared-by-marker', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.choosing-the-workspace-below-moves-there'], moves: 'green', target: 'extension',
    file: EXTENSION, find: '    if (daemon && activeAnchored?.folder.uri.fsPath === anchoring.openedFolder) {', replace: '    if (daemon && activeAnchored?.anchorPath === target.anchorPath) {',
    says: 'the guard against restarting for the workspace already in use compares the markers of the two workspaces, so a second one reached from the same folder is told apart from the first',
  },
  {
    name: 'several-below-attach-to-the-first', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.two-below-wait-for-a-choice'], moves: 'red', target: 'extension',
    ...severalReachedAttachToTheFirst(),
  },
  {
    name: 'remembered-choice-kept-until-the-look-inside', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.a-choice-below-survives-a-reload-unsaid', 'workspace-discovery.one-below-survives-a-reload-unsaid'], moves: 'green', target: 'extension',
    file: EXTENSION, find: '    if (savedAnchor !== null && !anchored.some(a => a.anchorPath === savedAnchor)) {', replace: '    if (false) {',
    says: 'a remembered choice is not dropped on the walk up from the folder alone, so the look inside it can find the workspace again',
  },
  {
    name: 'one-reached-asks-to-choose', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.one-below-is-taken-without-a-press'], moves: 'red', target: 'extension',
    file: 'out/src/anchor-picker.js', find: "        return { kind: 'single', target: anchored[0] };", replace: "        return { kind: 'multiPrompt', anchored: [...anchored] };",
    says: 'a window reaching one Aggrega workspace asks the reader to choose it',
  },
  {
    name: 'yml-release-marks-no-root', scenario: 'workspace-discovery-layouts', checks: ['workspace-discovery.root-marker-spellings-read-as-roots'], moves: 'red', target: 'extension',
    file: 'out/src/workspace.js', find: "const YAML_SUFFIXES = ['.yaml', '.yml'];", replace: "const YAML_SUFFIXES = ['.yaml'];",
    says: 'a Release spelled with .yml marks no root in the editor, though the compiler anchors on it',
  },
  // ---- a documentation example beneath the workspace root ----
  {
    name: 'workspace-row-drawn-unmarked-beneath', scenario: 'release-beneath-a-workspace-root', checks: ['beneath-a-workspace.rows-name-the-folder-and-the-root-above-it'], moves: 'red', target: 'extension',
    ...workspaceRowDrawnUnmarked(),
  },
  {
    name: 'release-row-reads-the-file-alone', scenario: 'release-beneath-a-workspace-root', checks: ['context-rows.release-row-names-the-path-relative-to-the-root'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '                value: state.release,', replace: '                value: path.basename(state.absolute),',
    says: 'the Release row reads the file name alone, as the status bar\'s indicator does',
  },
  {
    name: 'release-named-by-its-file-alone', scenario: 'release-beneath-a-workspace-root', checks: ['beneath-a-workspace.every-offered-release-is-accepted'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '            const release = (0, workspace_1.releaseParamFor)(root, absolute);', replace: '            const release = path.basename(absolute);',
    says: 'each Release offered is sent by its file name alone rather than by its path relative to the root',
  },
  {
    name: 'last-release-left-out-unsaid', scenario: 'release-beneath-a-workspace-root', checks: ['beneath-a-workspace.release-chooser-offers-every-release-file'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '        const candidates = answer.releases ?? [];', replace: '        const candidates = (answer.releases ?? []).slice(0, -1);',
    says: 'the last Release the language server lists is left out of the chooser without a word',
  },
  // ---- the interruption for a workspace above the folder opened ----
  {
    name: 'dialog-labels-the-workspace-bare', scenario: 'workspace-above-interruption', checks: ['workspace-above.dialog-says-only-the-two-paths'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-above.js', find: '        workspace: `${selector_levels_1.SELECTOR_ROW_LABELS.workspace}: ${anchoredRoot}`,', replace: '        workspace: `Workspace: ${anchoredRoot}`,',
    says: 'the dialog labels the workspace\'s line "Workspace:"',
  },
  {
    name: 'workspace-row-drawn-unmarked', scenario: 'workspace-above-interruption', checks: ['workspace-above.continue-here-closes-the-dialog-and-leaves-the-mark'], moves: 'red', target: 'extension',
    ...workspaceRowDrawnUnmarked(),
  },
  {
    name: 'continue-here-silences-the-folder', scenario: 'workspace-above-interruption', checks: ['workspace-above.dialog-returns-in-a-new-window-until-silenced'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-above.js', find: "    if (choice === 'silence') {", replace: "    if (choice === 'silence' || choice === 'continue') {",
    says: '"Continue here" is kept for the folder as "Don\'t show again for this folder" is, so no later window raises the dialog',
  },
  {
    // Escape reaches the action the dialog declares as its close affordance, so it
    // is that declaration, and not the answer read when nothing was pressed, that
    // decides what a dismissal does.
    name: 'escape-read-as-silence', scenario: 'workspace-above-interruption', checks: ['workspace-above.escape-on-the-dialog-is-continue-here'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-above.js',
    find: "            { title: 'Continue here', isCloseAffordance: true, choice: 'continue' },\n            { title: 'Don\\'t show again for this folder', choice: 'silence' },",
    replace: "            { title: 'Continue here', choice: 'continue' },\n            { title: 'Don\\'t show again for this folder', isCloseAffordance: true, choice: 'silence' },",
    says: 'the dialog dismissed with Escape answers as "Don\'t show again for this folder", its close affordance declared there rather than on "Continue here"',
  },
  {
    name: 'one-silence-for-every-folder', scenario: 'workspace-above-interruption', checks: ['workspace-above.silencing-one-folder-leaves-another-warning'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-above.js', find: '    if (readFoldersSilenced(silenced).includes(folder)) {', replace: '    if (readFoldersSilenced(silenced).length > 0) {',
    says: 'silencing one folder silences every folder the window works from',
  },
  {
    name: 'open-control-offered-always', scenario: 'workspace-above-interruption', checks: ['workspace-above.open-control-opens-the-workspace-when-pressed'], moves: 'red', target: 'extension',
    file: 'out/src/selector-rows.js', find: '        offer: differs\n            ? {', replace: '        offer: anchoredRoot !== null\n            ? {',
    says: 'the open control is offered whether or not the workspace sits outside the folder opened',
  },
  {
    name: 'dialog-open-action-opens-nothing', scenario: 'workspace-above-interruption', checks: ['workspace-above.dialog-open-action-opens-the-workspace-when-pressed'], moves: 'red', target: 'extension',
    file: 'out/src/workspace-above.js', find: "    if (choice === 'open') {", replace: '    if (false) {',
    says: 'the dialog\'s opening action opens nothing',
  },
  {
    name: 'interruption-raised-as-a-notification', scenario: 'workspace-above-interruption', checks: ['workspace-above.dialog-drawn-in-the-editors-own-drawing'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '{ modal: true, detail: notice.detail }', replace: '{ modal: false, detail: notice.detail }',
    says: 'the interruption is raised as a notification rather than a dialog',
  },
  // ---- the welcome page, in an empty folder ----
  {
    name: 'welcome-page-off-by-default', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.opens-by-itself-on-a-fresh-profile'], moves: 'red', target: 'extension',
    file: 'package.json', find: '"default": true,', replace: '"default": false,',
    says: 'the preference that opens the page on startup is declared off by default',
  },
  {
    name: 'welcome-page-tab-titled-welcome', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.is-a-tab-of-its-own'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: "exports.WELCOME_PANEL_TITLE = 'Welcome to Aggrega';", replace: "exports.WELCOME_PANEL_TITLE = 'Welcome';",
    says: 'the page\'s tab is titled "Welcome", which names nobody\'s page',
  },
  {
    name: 'empty-folder-read-as-a-workspace-unchosen', scenario: 'welcome-page-empty-folder', checks: ['empty-folder.rows-read-no-workspace-and-no-server-runs'], moves: 'red', target: 'extension',
    ...nothingReachableReadAsNoneChosen(),
  },
  {
    name: 'compiler-step-offers-one-way-through', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.every-step-offers-its-ways-through'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: "            { label: 'Point at a compiler I have', command: exports.LOCATE_COMPILER_COMMAND },\n", replace: '',
    says: 'the compiler step offers one way through, the way to point at a compiler of the reader\'s own left out',
  },
  {
    name: 'foot-words-unbound', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.foot-checkbox-reports-the-preference'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: '<label class="dismiss-label" for="${PANEL_SETTING_CONTROL_ID}">', replace: '<label class="dismiss-label">',
    says: 'the words at the foot are drawn beside the checkbox without being bound to it as its label',
  },
  {
    name: 'nothing-available-read-as-nothing-chosen', scenario: 'welcome-page-empty-folder',
    checks: ['welcome-page.values-say-in-words-that-nothing-is-chosen', 'welcome-page.release-step-reads-none-available-with-no-release'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: '    return candidates === 0 ? exports.VALUE_NONE_AVAILABLE : exports.VALUE_NONE_SELECTED;', replace: '    return candidates === 0 ? exports.VALUE_NONE_SELECTED : exports.VALUE_NONE_AVAILABLE;',
    says: 'a level holding nothing is said to have nothing chosen, and one where nothing is chosen to hold nothing',
  },
  {
    name: 'absent-version-drawn-as-a-value', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.compiler-version-reads-not-reported-with-no-server'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: "    const valueClass = known ? 'version-value' : 'version-value version-value-absent';", replace: "    const valueClass = 'version-value';",
    says: 'a version that was not reported is drawn in the same face as one that was',
  },
  {
    name: 'workspace-step-names-its-row-by-its-label', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.workspace-step-names-the-rows-it-points-at'], moves: 'green', target: 'extension',
    file: 'out/src/get-started-steps.js', find: 'The **Workspace** row at the top of the Commands panel', replace: 'The **Aggrega workspace** row at the top of the Commands panel',
    says: 'the workspace step names the row that says which folder was anchored by the label the row draws',
  },
  {
    name: 'global-file-said-to-keep-credentials-out', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.workspace-step-says-nothing-of-credentials'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: 'It loads automatically when it is there, and nothing breaks when it is not.\',', replace: 'It loads automatically when it is there, and nothing breaks when it is not. It is there so credentials need not be committed.\',',
    says: 'the workspace step says the global file is there so credentials need not be committed',
  },
  {
    name: 'page-links-back-to-the-editors-welcome', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.offers-no-way-back'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: '  <main class="welcome">', replace: '  <main class="welcome"><a class="welcome-back" href="#">Back to the editor\'s welcome page</a>',
    says: 'the page opens with a link back to the editor\'s own welcome page',
  },
  {
    name: 'walkthrough-contributed', scenario: 'welcome-page-empty-folder', checks: ['editor-welcome.carries-no-aggrega-entry'], moves: 'red', target: 'extension',
    file: 'package.json', find: '  "contributes": {\n    "viewsContainers": {',
    replace: '  "contributes": {\n    "walkthroughs": [\n      {\n        "id": "aggrega",\n        "title": "Aggrega",\n        "description": "Getting started with Aggrega",\n        "steps": [\n          { "id": "open", "title": "Open the welcome page", "description": "Open the welcome page.", "media": { "image": "media/aggrega.svg", "altText": "Aggrega" } }\n        ]\n      }\n    ],\n    "viewsContainers": {',
    says: 'the extension contributes a walkthrough to the editor\'s own welcome page',
  },
  {
    name: 'nothing-recognised-offered-as-an-empty-chooser', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.use-a-folder-with-none-recognised-says-so'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js',
    find: "    if (candidates.length === 0) {\n        void vscode.window.showInformationMessage('Aggrega: no folder in this workspace carries anything",
    replace: "    if (false) {\n        void vscode.window.showInformationMessage('Aggrega: no folder in this workspace carries anything",
    says: 'a search that recognised nothing is offered as an empty chooser rather than answered in words',
  },
  {
    name: 'created-configuration-carries-a-list', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.create-writes-the-file-the-step-describes'], moves: 'red', target: 'extension',
    file: 'out/src/workspace.js', find: '    `workspace: {}\\n`;', replace: '    `workspace:\\n  catalog_dirs: []\\n`;',
    says: 'the configuration the control writes carries a list beneath its workspace key rather than the empty block the step names',
  },
  {
    name: 'page-draft-settles-no-kind', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.draft-a-release-asks-only-for-the-name'], moves: 'red', target: 'extension',
    ...draftingWithNoKindSettled(),
  },
  {
    name: 'seeding-registers-another-host', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.seed-a-named-registry-writes-the-global-file'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    const outcome = await (0, config_seeding_1.runSeeding)(deps, host);', replace: "    const outcome = await (0, config_seeding_1.runSeeding)(deps, host === null ? null : 'localhost:1');",
    says: 'seeding a registry the reader names registers another host than the one named',
  },
  {
    name: 'refusal-words-dropped', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.seeding-the-hub-over-a-file-is-refused-in-the-compilers-words'], moves: 'red', target: 'extension',
    file: 'out/src/operation-outcome.js', find: '            return `${what} did not complete: ${outcome.message}`;', replace: '            return `${what} did not complete.`;',
    says: 'a refusal ends in its subject alone, none of the compiler\'s words carried',
  },
  {
    name: 'destinations-offered-project-first', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.add-a-registry-merges-into-the-file'], moves: 'red', target: 'extension',
    file: 'out/src/config-write-scope.js',
    find: "    { value: 'global', label: destinationLabel('global') },\n    { value: 'workspace', label: destinationLabel('workspace') },",
    replace: "    { value: 'workspace', label: destinationLabel('workspace') },\n    { value: 'global', label: destinationLabel('global') },",
    says: 'the choice of file offers the project\'s own file first, so taking the first writes there',
  },
  {
    name: 'page-unread-when-the-server-returns-after-an-add', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.registry-step-follows-an-add-with-no-press'], moves: 'red', target: 'extension',
    ...pageUnreadWhenTheServerReturns(),
  },
  {
    name: 'destination-dismissed-read-as-global', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.add-a-registry-backed-out-writes-nothing'], moves: 'red', target: 'extension',
    file: 'out/src/registries-view.js',
    find: '        const destination = await askWriteDestination(registry_configure_1.REGISTRATION_DESTINATION_PROMPT);\n        if (!destination) {\n            return;\n        }',
    replace: "        const destination = (await askWriteDestination(registry_configure_1.REGISTRATION_DESTINATION_PROMPT)) ?? 'global';",
    says: 'an Escape at the choice of file is read as the global file, so the registration goes ahead',
  },
  {
    name: 'compiler-reading-names-the-manifest-version', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.foot-names-both-versions-on-one-line'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    return { extension: extensionVersion, compiler: reading.version };', replace: '    return { extension: extensionVersion, compiler: ext ? ext.packageJSON.version : null };',
    says: 'the compiler reading at the foot is the extension\'s manifest number',
  },
  {
    name: 'chosen-compiler-written-elsewhere', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.point-at-a-compiler-writes-the-setting'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    await writeBinaryPath(chosen.fsPath);', replace: '    await writeBinaryPath(`${chosen.fsPath}-elsewhere`);',
    says: 'the compiler chosen in the file dialog is written to the setting as another path',
  },
  {
    name: 'compiler-read-from-the-setting', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.compiler-version-follows-a-binary-change'], moves: 'red', target: 'extension',
    file: EXTENSION, find: '    const running = daemon?.getLaunchedBinaryPath() ?? null;', replace: '    const running = (0, settings_vscode_1.getSettings)().binaryPath;',
    says: 'the compiler reading asks the binary the setting names rather than the one the language server was started from',
  },
  {
    name: 'stop-command-left-out-of-the-palette', scenario: 'welcome-page-empty-folder', checks: ['palette.stop-opening-says-how-to-bring-it-back'], moves: 'red', target: 'extension',
    file: 'package.json', find: '      "commandPalette": [\n', replace: '      "commandPalette": [\n        {\n          "command": "aggrega.getStarted.dismiss",\n          "when": "false"\n        },\n',
    says: 'the command that stops the page opening on startup is left out of the command palette',
  },
  {
    name: 'page-opens-whatever-the-preference', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.stays-closed-on-a-reopen-when-off'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '        if (!opensWithEditor()) {\n            return;\n        }\n        const read = await reread();', replace: '        if (false) {\n            return;\n        }\n        const read = await reread();',
    says: 'the page opens on startup whatever the preference says',
  },
  {
    name: 'get-started-leaves-the-preference-off', scenario: 'welcome-page-empty-folder', checks: ['palette.get-started-brings-the-page-back-ticked'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    await setShown(true);\n    try {', replace: '    try {',
    says: 'the palette\'s way back opens the page and leaves the preference off',
  },
  {
    name: 'dismissal-says-nothing', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.foot-checkbox-untick-says-how-to-bring-it-back'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    await setShown(false);\n    void vscode.window.showInformationMessage(get_started_steps_1.DISMISSED_CONFIRMATION);', replace: '    await setShown(false);',
    says: 'turning the page off on startup raises no notification naming the way back',
  },
  {
    name: 'page-revealed-keeping-the-focus', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.foot-checkbox-toggles-from-the-keyboard'], moves: 'green', target: 'extension',
    file: 'out/src/get-started.js', find: '            open.reveal(vscode.ViewColumn.Active);', replace: '            open.reveal(vscode.ViewColumn.Active, true);',
    says: 'a page already open is brought forward leaving the focus where it is',
  },
  {
    name: 'foot-deaf-to-the-preference', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.foot-checkbox-follows-the-settings-screen'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '        if (!event.affectsConfiguration(get_started_steps_1.WELCOME_SHOW_SETTING)) {', replace: '        if (true) {',
    says: 'the foot is not drawn again when the preference moves',
  },
  {
    name: 'foot-runs-the-command-for-the-other-state', scenario: 'welcome-page-empty-folder', checks: ['settings.screen-follows-the-foot-checkbox'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: 'panelSettingCommand)(opensWithEditor))', replace: 'panelSettingCommand)(!opensWithEditor))',
    says: 'the checkbox at the foot runs the command for the state it is not in, so unticking it leaves the preference on',
  },
  {
    name: 'house-turns-the-preference-on', scenario: 'welcome-page-empty-folder', checks: ['commands-panel.house-opens-the-page-and-leaves-the-preference'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: 'vscode.commands.registerCommand(get_started_steps_1.WELCOME_OPEN_COMMAND, () => void openPanel())', replace: 'vscode.commands.registerCommand(get_started_steps_1.WELCOME_OPEN_COMMAND, () => bringBack(openPanel))',
    says: 'the house turns the preference back on as it opens the page',
  },
  {
    name: 'house-reveals-nothing', scenario: 'welcome-page-empty-folder', checks: ['commands-panel.house-brings-the-open-page-to-the-front'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '        if (reveal) {\n            open.reveal(vscode.ViewColumn.Active);\n        }', replace: '        if (false) {\n            open.reveal(vscode.ViewColumn.Active);\n        }',
    says: 'an open page asked for again is refreshed and left behind the tab in front',
  },
  {
    name: 'house-command-listed-in-the-palette', scenario: 'welcome-page-empty-folder', checks: ['palette.house-command-is-not-listed'], moves: 'red', target: 'extension',
    file: 'package.json', find: '          "command": "aggrega.getStarted.open",\n          "when": "false"', replace: '          "command": "aggrega.getStarted.open",\n          "when": "true"',
    says: 'the house\'s command is listed in the command palette',
  },
  {
    name: 'folder-chosen-beneath-kept-as-already-open', scenario: 'welcome-page-empty-folder', checks: ['welcome-page.use-a-folder-takes-one-recognised-beneath'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    if (opened.has(choice.directory)) {', replace: '    if (true) {',
    says: 'a folder chosen beneath the one open is treated as one the window already has open, so it is remembered and never added',
  },
  // ---- the welcome page, in a workspace configured beforehand ----
  {
    name: 'registry-met-only-by-two', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.configured-workspace-arrives-with-every-step-met'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: '            return (facts.registries ?? []).length > 0;', replace: '            return (facts.registries ?? []).length > 1;',
    says: 'the registry step is met only where two registries are named',
  },
  {
    name: 'compiler-step-met-whatever-answers', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.compiler-step-goes-back-to-do-when-the-compiler-stops'], moves: 'red', target: 'extension',
    file: 'out/src/get-started-steps.js', find: '            return facts.compilerAnswering;', replace: '            return true;',
    says: 'the compiler step is met whether or not the compiler answers',
  },
  {
    name: 'panel-arranged-with-nothing-folded', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.arrives-with-only-the-workspace-folded-when-the-compiler-will-not-start'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: '    return get_started_steps_1.STEP_IDS.filter((id) => readings[id].met);', replace: '    return [];',
    says: 'a page is arranged with nothing folded, whatever is met when it is created',
  },
  {
    name: 'way-back-names-nothing-on-the-path', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.compiler-step-comes-back-with-the-compiler-on-path'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    await writeBinaryPath(settings_1.DEFAULT_SETTINGS.binaryPath);', replace: "    await writeBinaryPath('aggrega-not-on-this-path');",
    says: 'the compiler step\'s way back writes a name nothing on the PATH carries',
  },
  {
    name: 'page-unread-when-the-server-returns-after-a-removal', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.registry-step-follows-a-removal-with-no-press'], moves: 'red', target: 'extension',
    ...pageUnreadWhenTheServerReturns(),
  },
  {
    name: 'add-registers-another-host', scenario: 'welcome-page-configured-workspace', checks: ['welcome-page.registry-step-comes-back-with-an-added-registry'], moves: 'red', target: 'extension',
    file: 'out/src/registries-view.js', find: '        const first = await (0, registry_configure_1.runRegistryAdd)(deps, host, destination);', replace: "        const first = await (0, registry_configure_1.runRegistryAdd)(deps, 'localhost:9', destination);",
    says: 'the add registers another host than the one given',
  },
  // ---- the welcome page, in a workspace where some steps are met ----
  {
    name: 'arrangement-inverted', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.arrives-folded-on-what-is-met'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: '    return get_started_steps_1.STEP_IDS.filter((id) => readings[id].met);', replace: '    return get_started_steps_1.STEP_IDS.filter((id) => !readings[id].met);',
    says: 'a page is arranged the wrong way round, the steps still to do folded and the met ones open',
  },
  {
    name: 'unmet-standing-outstanding', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.standings-read-met-and-to-do'], moves: 'red', target: 'extension',
    file: 'out/src/welcome-render.js', find: "exports.UNMET_LABEL = 'To do';", replace: "exports.UNMET_LABEL = 'Outstanding';",
    says: 'a step still to do stands as "Outstanding"',
  },
  {
    name: 'description-names-a-lapse-outstanding', scenario: 'welcome-page-mixed-workspace', checks: ['settings.get-started-show-label-and-description'], moves: 'red', target: 'extension',
    file: 'package.json', find: 'marking it to do again if it later lapses', replace: 'marking it outstanding again if it later lapses',
    says: 'the setting\'s description names a step that lapses outstanding',
  },
  {
    name: 'folded-step-puts-its-ways-through-away', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.folded-step-keeps-its-ways-through-drawn-and-outlined'], moves: 'red', target: 'extension',
    file: 'media/welcome.css', find: '.step-actions {\n  display: flex;', replace: '.step-prose[hidden] ~ .step-actions { display: none; }\n.step-actions {\n  display: flex;',
    says: 'a folded step puts its ways through away with its explanation',
  },
  {
    name: 'search-finds-no-recognised-folder', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.folded-step-control-works'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '    const candidates = await anchoredDirectories();\n    if (candidates.length === 0) {', replace: '    const candidates = [];\n    if (candidates.length === 0) {',
    says: 'the search for folders Aggrega recognises finds none',
  },
  {
    name: 'open-step-draws-its-value-twice', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.each-step-names-what-it-stands-at'], moves: 'red', target: 'extension',
    file: 'media/welcome.css', find: '.step-prose:not([hidden]) + .step-value-folded {\n  display: none;\n}', replace: '.step-prose:not([hidden]) + .step-value-folded {\n}',
    says: 'an open step draws its value at both places, under the title as well as above its ways through',
  },
  {
    name: 'value-set-as-the-text-around-it', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.value-outranks-the-guidance'], moves: 'red', target: 'extension',
    file: 'media/welcome.css', find: '  font-family: var(--vscode-editor-font-family, monospace);\n  font-size: 1.15rem;\n  font-weight: 600;', replace: '  font-family: var(--vscode-editor-font-family, monospace);\n  font-size: inherit;\n  font-weight: inherit;',
    says: 'the value is set at the size and weight of the text around it',
  },
  {
    name: 'arrangement-decided-again-on-every-refresh', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.step-satisfied-while-open-stays-open'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js',
    find: "        panel?.webview.postMessage({ type: 'steps', html: (0, welcome_render_1.stepsHtml)(read, collapsed) });",
    replace: "        panel?.webview.postMessage({ type: 'steps', html: (0, welcome_render_1.stepsHtml)(read, (0, welcome_render_1.initiallyCollapsedStepIds)(read)) });",
    says: 'the arrangement is decided again from what is met each time the page is drawn again',
  },
  {
    name: 'caret-press-not-recorded', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.caret-pressed-survives-a-refresh'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '                collapsed = (0, get_started_steps_1.readCollapsedSteps)(named.collapsed);', replace: '                (0, get_started_steps_1.readCollapsedSteps)(named.collapsed);',
    says: 'a caret the reader pressed is not recorded, so the page is drawn again in the shape it opened in',
  },
  {
    name: 'reopened-page-keeps-the-old-arrangement', scenario: 'welcome-page-mixed-workspace', checks: ['welcome-page.reopened-page-arranges-afresh'], moves: 'red', target: 'extension',
    file: 'out/src/get-started.js', find: '        collapsed = (0, welcome_render_1.initiallyCollapsedStepIds)(read.steps);', replace: '        collapsed = collapsed.length > 0 ? collapsed : (0, welcome_render_1.initiallyCollapsedStepIds)(read.steps);',
    says: 'a page opened again keeps the arrangement the page before it was left in',
  },

  // ---- the gateway folder: the Commands panel and the panels beside it ----
  { name: 'context-row-renamed-commands-panel', scenario: 'gateway-commands-panel', checks: ['commands-panel.context-rows-name-the-opened-folder'], moves: 'red', target: 'extension', ...CONTEXT_ROW_LABEL },
  {
    name: 'catalog-search-on-the-catalog-title-bar', scenario: 'gateway-commands-panel', checks: ['side-bar.panels-in-order-each-list-title-bar-holding-only-its-refresh'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '          "command": "aggrega.workspaceCatalog.refresh",\n          "when": "view == aggrega.workspaceCatalog",\n          "group": "navigation"\n        }\n      ],',
    replace: '          "command": "aggrega.workspaceCatalog.refresh",\n          "when": "view == aggrega.workspaceCatalog",\n          "group": "navigation"\n        },\n        {\n          "command": "aggrega.catalog.searchPublished",\n          "when": "view == aggrega.workspaceCatalog",\n          "group": "navigation"\n        }\n      ],',
    says: 'the published-catalog search is put on the Catalog panel\'s title bar beside its refresh',
  },
  {
    name: 'cog-off-the-commands-title-bar', scenario: 'gateway-commands-panel', checks: ['commands-panel.title-bar-draws-the-house-and-the-cog-at-rest'], moves: 'red', target: 'extension',
    file: 'package.json',
    find: '        {\n          "command": "aggrega.settings.open",\n          "when": "view == aggrega.operations",\n          "group": "navigation"\n        },\n',
    replace: '',
    says: 'the cog is taken off the Commands panel\'s title bar',
  },
  {
    name: 'settings-opened-unnarrowed', scenario: 'gateway-commands-panel', checks: ['commands-panel.cog-opens-the-editors-settings-narrowed-to-this-extension'], moves: 'red', target: 'extension',
    file: 'out/src/settings.js', find: '    return `@ext:${extensionId}`;', replace: "    return '';",
    says: 'the cog opens the editor\'s settings with an empty filter, so they are not narrowed to this extension',
  },
  {
    name: 'other-shape-by-default', scenario: 'gateway-commands-panel', checks: ['commands-panel.default-shape-is-one-flow-with-no-group-titles'], moves: 'red', target: 'extension',
    file: 'package.json', find: '          "default": "buttons",\n          "description": "How the Commands panel draws its groups.', replace: '          "default": "sections",\n          "description": "How the Commands panel draws its groups.',
    says: 'the shape setting is declared with the section shape as its default',
  },
  {
    name: 'show-config-labelled-as-asking', scenario: 'gateway-commands-panel', checks: ['commands-panel.groups-in-order-labels-named-and-explained-on-the-hover'], moves: 'red', target: 'extension',
    file: 'out/src/operation-groups.js',
    find: "                label: 'Show config',\n                detail: 'Every setting the schema declares, with the value in force and where it came from',",
    replace: "                label: 'Show config…',\n                detail: 'Open the configuration panel',",
    says: 'Show config\'s label carries a trailing ellipsis and its hover an explanation other than the one declared for it',
  },
  {
    name: 'show-config-runs-the-seeding', scenario: 'gateway-commands-panel', checks: ['commands-panel.offers-no-seeding-entry-the-welcome-page-carries'], moves: 'red', target: 'extension',
    file: 'out/src/operation-groups.js', find: "                command: 'aggrega.config.open',", replace: "                command: 'aggrega.getStarted.createWorkspace',",
    says: 'the Configuration group\'s Show config runs the seeding of a workspace configuration the welcome page offers',
  },
  {
    name: 'import-icon-given-a-glyph', scenario: 'gateway-commands-panel', checks: ['commands-panel.icons-drawn-from-the-font-the-extension-ships'], moves: 'green', target: 'extension',
    file: 'media/vendor/codicon.css', find: '.codicon-sign-in:before { content: "\\ea6f" }', replace: '.codicon-sign-in:before { content: "\\ea6f" }\n.codicon-arrow-into:before { content: "\\ea6f" }',
    says: 'the icon font\'s stylesheet draws Import\'s declared icon with a glyph the font carries, the one it draws for signing in',
  },
  {
    name: 'row-label-gives-way', scenario: 'gateway-commands-panel', checks: ['commands-panel.flow-wraps-at-every-width-cutting-nothing-short'], moves: 'green', target: 'extension',
    file: 'media/operations.css', find: '.selector-label {\n  flex: 0 0 auto;\n  font-weight: 600;\n}',
    replace: '.selector-label {\n  flex: 0 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-weight: 600;\n}',
    says: 'a row\'s label gives way where the panel is too narrow for it, cut short with an ellipsis, rather than reaching past the panel\'s edge',
  },
  {
    name: 'mark-after-each-group-in-the-flow', scenario: 'gateway-commands-panel', checks: ['commands-panel.nothing-drawn-between-groups-at-any-width'], moves: 'red', target: 'extension',
    file: RENDER,
    find: '            pieces.push(operationEntryHtml(op, group.id, body, rovingKey));\n        }\n    }',
    replace: '            pieces.push(operationEntryHtml(op, group.id, body, rovingKey));\n        }\n        pieces.push(\'<span class="group-mark" aria-hidden="true">·</span>\');\n    }',
    says: 'the flow draws a mark after each group\'s last button',
  },
  {
    name: 'every-operation-a-tab-stop', scenario: 'gateway-commands-panel', checks: ['commands-panel.tab-reaches-each-row-control-then-the-operations-once'], moves: 'red', target: 'extension',
    file: RENDER, find: "    const tabindex = focused ? '0' : '-1';", replace: "    const tabindex = '0';",
    says: 'every operation\'s button is a tab stop of its own',
  },
  {
    name: 'pull-without-its-release', scenario: 'gateway-commands-panel', checks: ['commands-panel.every-entry-runs-or-asks-and-none-fails-on-its-arguments'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '(0, operation_groups_1.releaseScopedArgs)(verb, release), `resolved the dependencies', replace: '[verb], `resolved the dependencies',
    says: 'Pull runs the command line with the Release left out of its arguments',
  },
  {
    name: 'escape-runs-a-cache-listing', scenario: 'gateway-commands-panel', checks: ['commands-panel.asking-entries-ask-for-their-subject-and-backing-out-runs-nothing'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: "    if (event.key === 'Escape') { closeMenu(); return true; }",
    replace: "    if (event.key === 'Escape') { closeMenu(); vscode.postMessage({ type: 'run', command: 'aggrega.op.cache', option: 'status' }); return true; }",
    says: 'Escape on an open menu closes it and runs the cache listing as well',
  },
  {
    name: 'inspect-menu-runs-the-compiler', scenario: 'gateway-commands-panel', checks: ['commands-panel.reading-entries-start-no-compiler-process'], moves: 'red', target: 'extension',
    file: OPERATIONS, find: '    inspect: (deps, remember) => subjectChoices(deps, operation_groups_1.inspectableSubjects, remember),',
    replace: "    inspect: (deps, remember) => { require('child_process').spawn(vscode.workspace.getConfiguration('aggrega.server').get('binaryPath'), ['validate', '--offline'], { cwd: vscode.workspace.workspaceFolders[0].uri.fsPath, stdio: 'ignore' }); return subjectChoices(deps, operation_groups_1.inspectableSubjects, remember); },",
    says: 'the Inspect menu, as it reads its choices, also runs the compiler as a command over the workspace\'s catalog',
  },
  {
    name: 'sections-drawn-without-their-first-operation', scenario: 'gateway-commands-panel', checks: ['commands-panel.sections-shape-keeps-the-groups-and-restarts-nothing'], moves: 'red', target: 'extension',
    file: RENDER, find: '    const controls = group.operations\n        .map(', replace: '    const controls = group.operations.slice(1)\n        .map(',
    says: 'each section is drawn without its group\'s first operation',
  },
  {
    name: 'sections-value-undescribed', scenario: 'gateway-commands-panel', checks: ['settings.layout-values-carry-their-descriptions'], moves: 'red', target: 'extension',
    file: 'package.json', find: '            "Each group is a section you open, under its own title, so the panel shows as much as you keep open."', replace: '            ""',
    says: 'the section shape\'s value is declared with an empty description',
  },
  {
    name: 'no-rule-above-publish', scenario: 'gateway-commands-panel', checks: ['commands-panel.sections-carry-group-titles-and-a-rule-above-publish'], moves: 'red', target: 'extension',
    file: 'media/operations.css', find: '.groups-sections .group-separated {\n  border-top: 1px solid', replace: '.groups-sections .group-separated {\n  border-top: 0px solid',
    says: 'the rule above the publish section is drawn no width',
  },
  {
    name: 'chevron-left-as-drawn', scenario: 'gateway-commands-panel', checks: ['commands-panel.section-chevrons-turn-as-they-open'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: "        chevron.classList.toggle('codicon-chevron-down', open);\n        chevron.classList.toggle('codicon-chevron-right', !open);\n", replace: '',
    says: 'a section\'s chevron is left as it was drawn when the section opens or closes',
  },
  {
    name: 'arrows-pass-over-closed-sections', scenario: 'gateway-commands-panel', checks: ['commands-panel.keyboard-in-sections-opens-and-closes-with-the-arrows'], moves: 'green', target: 'extension',
    file: PANEL_SCRIPT, find: "      container.querySelectorAll('[data-focus-key]:not([disabled])'),\n    );",
    replace: "      container.querySelectorAll('[data-focus-key]:not([disabled])'),\n    ).filter((control) => !control.closest('[hidden]'));",
    says: 'the arrow keys move between the controls a reader can see, passing over those inside a closed section',
  },
  {
    name: 'rows-put-away-with-a-section', scenario: 'gateway-commands-panel', checks: ['commands-panel.context-rows-stay-with-every-section-closed'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: '      body.hidden = !open;\n    }', replace: "      body.hidden = !open;\n      const rows = document.querySelector('.selectors');\n      if (rows) { rows.style.display = open ? '' : 'none'; }\n    }",
    says: 'the three rows are put away whenever a section closes',
  },
  {
    name: 'high-contrast-button-unbordered', scenario: 'gateway-commands-panel', checks: ['commands-panel.follows-the-theme-and-borders-every-control-in-high-contrast'], moves: 'red', target: 'extension',
    file: 'media/operations.css', find: 'body.vscode-high-contrast .op,\n', replace: '',
    says: 'an operation\'s button is given no border of its own in the dark high-contrast theme',
  },
  {
    name: 'shape-a-workspace-may-set', scenario: 'gateway-commands-panel', checks: ['settings.preference-is-the-users-and-a-workspace-value-is-ignored'], moves: 'red', target: 'extension',
    file: 'package.json', find: 'never which operations exist or what they do. Changing it redraws the open panel; nothing restarts.",\n          "scope": "machine"',
    replace: 'never which operations exist or what they do. Changing it redraws the open panel; nothing restarts.",\n          "scope": "window"',
    says: 'the shape setting is declared with a scope a workspace may set',
  },
  {
    name: 'binary-path-says-machine-wide', scenario: 'gateway-commands-panel', checks: ['settings.binary-path-description-names-the-two-files'], moves: 'red', target: 'extension',
    file: 'package.json', find: '`~/.config/aggrega/config.yaml`, the global file on your machine,', replace: '`~/.config/aggrega/config.yaml`, the machine-wide file,',
    says: 'the binary path\'s description calls the file on the machine the machine-wide file',
  },
  {
    name: 'validate-answers-in-other-words', scenario: 'gateway-commands-panel', checks: ['commands-panel.server-only-operations-stay-enabled-with-the-server-stopped'], moves: 'red', target: 'extension',
    file: EXTENSION, find: "        void vscode.window.showWarningMessage('Aggrega: the language server is not running.');", replace: "        void vscode.window.showWarningMessage('Aggrega: nothing to validate against.');",
    says: 'Validate answers in other words when the language server is not running',
  },

  // ---- a documentation example naming no default Release ----
  {
    name: 'unavailable-operation-left-out', scenario: 'mysql-commands-panel-no-release', checks: ['commands-panel.release-operations-greyed-in-place-with-their-reason'], moves: 'red', target: 'extension',
    file: RENDER, find: '            pieces.push(operationEntryHtml(op, group.id, body, rovingKey));',
    replace: '            if ((body.unavailable[op.id] ?? null) === null) { pieces.push(operationEntryHtml(op, group.id, body, rovingKey)); }',
    says: 'an operation that cannot run is left out of the flow rather than greyed in it',
  },
  {
    name: 'arrows-count-greyed-controls', scenario: 'mysql-commands-panel-no-release', checks: ['commands-panel.arrows-skip-greyed-controls'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: "      container.querySelectorAll('[data-focus-key]:not([disabled])'),", replace: "      container.querySelectorAll('[data-focus-key]'),",
    says: 'the arrow keys count a greyed control among the ones they move between',
  },
  {
    name: 'release-choice-restarts-the-server', scenario: 'mysql-commands-panel-no-release', checks: ['commands-panel.choosing-a-release-enables-them-without-a-restart'], moves: 'red', target: 'extension',
    file: 'out/src/release-selection.js', find: '        lockfile = entry.lockfile;\n        announce();\n    };',
    replace: "        lockfile = entry.lockfile;\n        announce();\n        void require('vscode').commands.executeCommand('aggrega.server.restart');\n    };",
    says: 'choosing a Release restarts the language server',
  },

  // ---- the gateway folder: the menus a Commands panel button opens ----
  {
    name: 'menus-at-the-left-margin', scenario: 'gateway-docked-menus', checks: ['commands-panel.menu-hangs-from-its-buttons-left-edge-where-there-is-room'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: '    const from = holdsDials(menu) ? at.right - width : at.left;', replace: '    const from = 0;',
    says: 'every menu is placed at the panel\'s left margin whatever its button',
  },
  {
    name: 'menu-left-past-the-edge', scenario: 'gateway-docked-menus', checks: ['commands-panel.menus-open-against-their-button-docked-a-few-hundred-pixels-wide'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: '    const left = Math.max(0, Math.min(from, window.innerWidth - width));', replace: '    const left = from;',
    says: 'a menu is left where its button\'s left edge puts it, past the panel\'s right edge where it is wider than the room',
  },
  {
    name: 'closing-menu-leaves-its-button-held', scenario: 'gateway-docked-menus', checks: ['commands-panel.held-button-marked-alone-and-cleared-by-every-close'], moves: 'red', target: 'extension',
    file: PANEL_SCRIPT, find: "    if (control) {\n      control.setAttribute('aria-expanded', 'false');\n      control.focus();\n    }", replace: '    if (control) {\n      control.focus();\n    }',
    says: 'a menu closing leaves its button drawn held',
  },
  {
    name: 'held-border-wider', scenario: 'gateway-docked-menus', checks: ['commands-panel.opening-a-menu-moves-nothing'], moves: 'red', target: 'extension',
    file: 'media/operations.css', find: '.op[aria-expanded="true"],\n.op-caret[aria-expanded="true"] {\n  border-color: var(--vscode-focusBorder);',
    replace: '.op[aria-expanded="true"],\n.op-caret[aria-expanded="true"] {\n  border: 3px solid var(--vscode-focusBorder);',
    says: 'the held button\'s border is drawn wider than the one every button keeps',
  },
  {
    name: 'section-held-row-on-no-ground', scenario: 'gateway-docked-menus', checks: ['commands-panel.held-row-marked-in-the-section-shape'], moves: 'red', target: 'extension',
    file: 'media/operations.css', find: '.groups-sections .op-caret[aria-expanded="true"] {\n  background: var(--vscode-list-hoverBackground);', replace: '.groups-sections .op-caret[aria-expanded="true"] {\n  background: none;',
    says: 'the held row is drawn on no ground of its own in the section shape',
  },

  // ---- the gateway folder: the configuration table as narrow as a docked panel ----
  {
    name: 'setting-column-scrolls-away', scenario: 'gateway-docked-configuration', checks: ['config-panel.setting-column-stays-at-the-left-edge-scrolling-fully-right'], moves: 'red', target: 'extension',
    file: 'media/config.css', find: '  position: sticky;\n  left: 0;', replace: '  position: relative;\n  left: 0;',
    says: 'the Setting column scrolls away with the rest of its row',
  },
  {
    name: 'setting-column-paints-no-ground', scenario: 'gateway-docked-configuration', checks: ['config-panel.setting-column-is-solid-over-the-row-passing-under-it'], moves: 'red', target: 'extension',
    file: 'media/config.css', find: '  overflow-wrap: anywhere;\n  background: var(--vscode-editor-background);\n}', replace: '  overflow-wrap: anywhere;\n}',
    says: 'the Setting column\'s cells paint no ground of their own',
  },
  {
    name: 'corner-beneath-the-headings', scenario: 'gateway-docked-configuration', checks: ['config-panel.header-and-corner-hold-scrolling-right-and-down'], moves: 'red', target: 'extension',
    file: 'media/config.css', find: '.config-table th:first-child {\n  z-index: 3;', replace: '.config-table th:first-child {\n  z-index: 1;',
    says: 'the corner is drawn beneath the headings beside it',
  },
  {
    name: 'description-at-a-fixed-measure', scenario: 'gateway-docked-configuration', checks: ['config-panel.description-fully-visible-beside-the-setting-column'], moves: 'red', target: 'extension',
    file: 'media/config.css', find: '  width: min(24rem, calc(100vw - var(--config-key-measure) - 2rem));', replace: '  width: 24rem;',
    says: 'a setting\'s description is held to a fixed measure wider than a docked panel',
  },
  {
    name: 'table-squeezed-to-its-width', scenario: 'gateway-docked-configuration', checks: ['config-panel.table-scrolls-sideways-docked-and-fits-an-editor-pane'], moves: 'red', target: 'extension',
    file: 'media/config.css', find: '.config-table {\n  width: 100%;\n  border-collapse: collapse;', replace: '.config-table {\n  width: 100%;\n  table-layout: fixed;\n  border-collapse: collapse;',
    says: 'the table is laid out to the width it is given, squeezing its columns',
  },
];

// The edits two scenarios' plants make alike, each named once. They are function
// declarations so the catalogue above can spread them though they are written
// after it.
type SharedEdit = Pick<Plant, 'file' | 'find' | 'replace' | 'says'>;

function severalReachedAttachToTheFirst(): SharedEdit {
  return {
    file: 'out/src/anchor-picker.js', find: "    return { kind: 'multiPrompt', anchored: [...anchored] };", replace: "    return { kind: 'single', target: anchored[0] };",
    says: 'a window reaching several Aggrega workspaces and remembering none attaches to the first without asking',
  };
}

function everyAddReadAsMakingANewWorkspace(): SharedEdit {
  return {
    file: 'out/src/window-kind.js', find: '    return !windowKind.onWorkspaceFile;', replace: '    return true;',
    says: 'every window is read as one an add turns into a new workspace, a window already on a workspace included, so its add names a cost it does not have',
  };
}

function workspaceRowDrawnUnmarked(): SharedEdit {
  return {
    file: 'out/src/selector-rows.js', find: '        warning: differs ? workspace_above_1.WORKSPACE_ABOVE_HEADLINE : null,', replace: '        warning: null,',
    says: 'the Aggrega workspace row is drawn without its mark where the workspace sits outside the folder opened',
  };
}

function nothingReachableReadAsNoneChosen(): SharedEdit {
  return {
    file: 'out/src/selector-rows.js', find: '    if (anchoredRoot === null) {\n        if (candidates === 0) {', replace: '    if (anchoredRoot === null) {\n        if (candidates === -1) {',
    says: 'a project reaching no Aggrega workspace is read as one holding several with none chosen',
  };
}

function draftingWithNoKindSettled(): SharedEdit {
  return {
    file: 'out/src/get-started.js', find: "    await vscode.commands.executeCommand('aggrega.op.scaffold', undefined, selector_levels_1.SELECTOR_ROW_LABELS.release);",
    replace: "    await vscode.commands.executeCommand('aggrega.op.scaffold', undefined, undefined);",
    says: 'the drafting of a Release, from the Release row\'s create control and from the welcome page alike, opens with no kind settled, so it asks for a kind before the name',
  };
}

function pageUnreadWhenTheServerReturns(): SharedEdit {
  return {
    file: 'out/src/get-started.js', find: '    deps.onReady(refresh);', replace: '    deps.onReady(() => undefined);',
    says: 'the welcome page is not read again when the language server comes back up, so a change made elsewhere reaches it only when something on the page asks',
  };
}

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
