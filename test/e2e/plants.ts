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

const CONTEXT_ROW_LABEL = {
  file: 'out/src/selector-levels.js',
  find: "    project: 'Project folder',",
  replace: "    project: 'Project directory',",
  says: 'the first context row is labelled "Project directory"',
} as const;

const REFRESH_GRAPH = '        refreshGraphView();\n';

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
    name: 'options-control-named-build-options', scenario: 'workspace-above', checks: ['build-options.control-is-named-build-options', 'build-options.name-carries-no-count'], moves: 'green', target: 'extension',
    file: RENDER,
    find: '        ? `${op.label} adjustments`\n        : `${op.label} adjustments, ${open} on`;',
    replace: '        ? `${op.label} options`\n        : `${op.label} options`;',
    says: 'the control beside Build is named "Build options", with no count of how many are on',
  },
  {
    name: 'options-menu-named', scenario: 'workspace-above', checks: ['build-options.menu-opens-below-the-chevron-aligned-right'], moves: 'green', target: 'extension',
    file: 'out/src/operation-menus.js',
    find: "const BUILD_DIALS_MENU_LABEL = 'Adjustments for the next build';",
    replace: "const BUILD_DIALS_MENU_LABEL = 'Options for the next build';",
    says: 'the menu beside Build is named "Options for the next build"',
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
    name: 'respawn-bound-counts-the-bound', scenario: 'storefront-killed-server', checks: ['language-server.stopped-responding-after-the-respawn-bound'], moves: 'green', target: 'extension',
    file: DAEMON, find: '        return this.attempts.length < this.attemptLimit;', replace: '        return this.attempts.length <= this.attemptLimit;',
    says: 'a respawn is allowed while the attempts recorded in the window are at most the bound, so a bound of N allows N restarts',
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
