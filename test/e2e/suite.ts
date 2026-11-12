// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CheckResult, Checks, EnoughReported, sealDeclarations, suitePassed, tally } from './checks';
import { makeScratchHome, ScratchHome } from './cli';
import { createScenarioRoot, ScenarioRoot } from './editor';
import {
  copyLockfile, FixtureError, FixtureProof, MYSQL_EXAMPLE, placeDocsExample, placeEmptyBeneathWorkspace, placeFolder, placeOwnCatalogs, placeSecondAggregate,
  placeSelectionReadings, placeUnanchored, placeWorkspaceAbove, proveMissing, proveUnreachable, readTree, Tree, UNREACHABLE_HOST, writeLockfile,
} from './fixtures';
import { Inputs, REPO_ROOT } from './inputs';
import { placeLayouts, POSTGRES_EXAMPLE, proveNothingAbove } from './layouts';
import { LEVEL_OBSERVERS } from './levels';
import { applyPlant, Plant } from './plants';
import { aboveChecks, ABOVE_CHECKS } from './suite-above';
import { ABOVE_DIALOG_CHECKS, ABOVE_DIALOG_FIRST, ABOVE_DIALOG_LAYOUTS, aboveDialogChecks } from './suite-above-dialog';
import { BENEATH_CHECKS, beneathChecks } from './suite-beneath';
import { DISCOVERY_CHECKS, DISCOVERY_FIRST, DISCOVERY_LAYOUTS, discoveryChecks } from './suite-discovery';
import { FOLDER_ADDS_CHECKS, FOLDER_ADDS_FIRST, FOLDER_ADDS_LAYOUTS, folderAddsChecks, NOT_A_FOLDER } from './suite-folder-adds';
import { CACHE_CHECKS, cacheChecks } from './suite-cache';
import {
  INVALID_CHECKS, invalidConfigurationChecks, LEADING_OUT_CHECKS, leadingOutChecks, LINKED_INSIDE_CHECKS, linkedInsideChecks, placeConfigurationLeadingOut,
  placeConfigurationLinkedInside, placeInvalidConfiguration,
} from './suite-configuration-actions';
import { DEFAULT_RELEASE_CHECKS, defaultReleaseChecks, placeThirdRelease } from './suite-default-release';
import { COMMANDS_PANEL_CHECKS, commandsPanelChecks } from './suite-commands-panel';
import { DOCKED_CONFIGURATION_CHECKS, dockedConfigurationChecks } from './suite-docked-configuration';
import { DOCKED_MENUS_CHECKS, dockedMenusChecks } from './suite-docked-menus';
import { NO_RELEASE_CHECKS, noReleaseChecks } from './suite-no-release';
import { EMPTY_WORKSPACE_CHECKS, emptyWorkspaceChecks } from './suite-empty-workspace';
import { ENDINGS_CHECKS, endingsChecks, WATCH_AND_STOP_CHECKS, watchAndStopChecks } from './suite-endings';
import { AUTHORING_RELEASE_CHECKS, authoringReleaseChecks, NO_WORKSPACE_CHECKS, noWorkspaceChecks } from './suite-first-day';
import { ProcessTable } from './processes';
import { populateRegistry, registerAsDefault, ScratchRegistry, startRegistry, startStubRegistries, StubRegistries } from './registry';
import { bringUp, DisplayReading, Scenario, ScenarioEnd, tearDown } from './scenario';
import { makeContext, SuiteContext } from './suite-context';
import { gatewayChecks, GATEWAY_CHECKS } from './suite-gateway';
import {
  FLEET_CHECKS, fleetChecks, GRAPH_DRAWING_CHECKS, graphDrawingChecks, GRAPH_IDLE_CHECKS, GRAPH_IDLE_SETTINGS, graphIdleChecks, NESTED_BOUNDARY_CHECKS, nestBoundaries,
  nestedBoundaryChecks,
} from './suite-graph-drawing';
import { GRAPH_PANEL_CHECKS, graphPanelChecks, RELEASE } from './suite-graph-panel';
import { KILLED_CHECKS, KILLED_SETTINGS, killedChecks } from './suite-killed';
import { LEVELS_CHECKS, levelsChecks } from './suite-levels';
import { OFFLINE_RELEASES, OWN_CATALOGS_CHECKS, ownCatalogsChecks } from './suite-own-catalogs';
import { PROBES_CHECKS, probesChecks } from './suite-probes';
import { GRAPH_RELEASE, SELECTED_RELEASE_CHECKS, selectedReleaseChecks } from './suite-selected-release';
import { READINESS_CHECKS, readinessChecks } from './suite-readiness';
import { registryChecks, REGISTRY_CHECKS } from './suite-registry';
import { storefrontChecks, STOREFRONT_CHECKS } from './suite-storefront';
import { TOP_LEVEL_ATTACH_CHECKS, topLevelAttachChecks } from './suite-top-level-attach';
import { TWO_WORKSPACES_CHECKS, twoWorkspacesChecks } from './suite-two-workspaces';
import { CONFIGURED_HOST, WELCOME_CONFIGURED_CHECKS, welcomeConfiguredChecks } from './suite-welcome-configured';
import { WELCOME_EMPTY_FOLDER_CHECKS, welcomeEmptyFolderChecks } from './suite-welcome-empty-folder';
import { WELCOME_MIXED_CHECKS, welcomeMixedChecks } from './suite-welcome-mixed';
import { placeNotABinary, placeSecondCompiler, registerWithNoTrust, SecondCompiler } from './welcome';
import { RanOut, ranOutMark, ranOutSince } from './workbench';
import { CONFIGURED_PLUGINS_CHECKS, configuredPluginsChecks } from './suite-configured-plugins';
import { Generation, INSPECTION_BY_NAME_CHECKS, inspectionByNameChecks, LIST_PANEL_OPERATIONS_CHECKS, listPanelOperationsChecks, nameDefaultOnly, placeGeneration } from './suite-list-panels';
import {
  CONFIGURATION_FROM_THE_ENVIRONMENT_CHECKS, CONFIGURATION_REPORT_CHECKS, configurationFromTheEnvironmentChecks, configurationReportChecks, NOTHING_CONFIGURED_CHECKS,
  nothingConfiguredChecks, OFFLINE, OFFLINE_IN_THE_ENVIRONMENT, proveNoGlobalFile, proveNothingSetIn, setListThroughItsCompanion,
} from './suite-configuration-report';
import { YML_RELEASE } from './suite-discovery';

// The suite: the checks of which build is under test, of the build-analysis
// setting and the two diagnostic layers it separates, and of the capabilities
// walked end to end — each scenario launched fresh over fixtures proven before
// anything rests on them.

export interface SuiteReport { data: unknown; summary: string[]; allPassed: boolean }

// SCENARIO_CHECKS names every scenario and the checks it runs, in order.
export const SCENARIO_CHECKS: Readonly<Record<string, readonly string[]>> = {
  'gateway': GATEWAY_CHECKS,
  'storefront': STOREFRONT_CHECKS,
  'workspace-above': ABOVE_CHECKS,
  'storefront-killed-server': KILLED_CHECKS,
  'storefront-with-registries': REGISTRY_CHECKS,
  'releases-with-own-catalogs': OWN_CATALOGS_CHECKS,
  'releases-with-own-catalogs-selected-release': SELECTED_RELEASE_CHECKS,
  'storefront-graph-panel': GRAPH_PANEL_CHECKS,
  'probes-nothing-may-attach': PROBES_CHECKS,
  'gateway-top-level-attach': TOP_LEVEL_ATTACH_CHECKS,
  'storefront-graph-drawing': GRAPH_DRAWING_CHECKS,
  'storefront-graph-idle': GRAPH_IDLE_CHECKS,
  'fleet-graph-first-fit': FLEET_CHECKS,
  'storefront-graph-nested-boundaries': NESTED_BOUNDARY_CHECKS,
  'gateway-readiness': READINESS_CHECKS,
  'gateway-cache': CACHE_CHECKS,
  'empty-workspace': EMPTY_WORKSPACE_CHECKS,
  'no-workspace-first-day': NO_WORKSPACE_CHECKS,
  'workspace-above-authoring-release': AUTHORING_RELEASE_CHECKS,
  'gateway-endings': ENDINGS_CHECKS,
  'mysql-watch-and-stop': WATCH_AND_STOP_CHECKS,
  'two-releases-context-rows': LEVELS_CHECKS,
  'two-workspaces-context-rows': TWO_WORKSPACES_CHECKS,
  'project-folder-adds': FOLDER_ADDS_CHECKS,
  'workspace-discovery-layouts': DISCOVERY_CHECKS,
  'release-beneath-a-workspace-root': BENEATH_CHECKS,
  'workspace-above-interruption': ABOVE_DIALOG_CHECKS,
  'three-releases-default-release': DEFAULT_RELEASE_CHECKS,
  'configuration-file-leading-out': LEADING_OUT_CHECKS,
  'configuration-file-invalid': INVALID_CHECKS,
  'configuration-file-linked-inside': LINKED_INSIDE_CHECKS,
  'welcome-page-empty-folder': WELCOME_EMPTY_FOLDER_CHECKS,
  'welcome-page-configured-workspace': WELCOME_CONFIGURED_CHECKS,
  'welcome-page-mixed-workspace': WELCOME_MIXED_CHECKS,
  'gateway-commands-panel': COMMANDS_PANEL_CHECKS,
  'mysql-commands-panel-no-release': NO_RELEASE_CHECKS,
  'gateway-docked-menus': DOCKED_MENUS_CHECKS,
  'gateway-docked-configuration': DOCKED_CONFIGURATION_CHECKS,
  'gateway-list-panel-operations': LIST_PANEL_OPERATIONS_CHECKS,
  'mysql-inspection-by-name': INSPECTION_BY_NAME_CHECKS,
  'configured-plugins-removal': CONFIGURED_PLUGINS_CHECKS,
  'gateway-configuration-report': CONFIGURATION_REPORT_CHECKS,
  'gateway-configuration-from-the-environment': CONFIGURATION_FROM_THE_ENVIRONMENT_CHECKS,
  'nothing-configured-configuration-report': NOTHING_CONFIGURED_CHECKS,
};

// ScenarioResult is one scenario as the report states it.
interface ScenarioResult {
  name: string;
  folder: string | null;
  settingsChanged: Record<string, unknown>;
  environmentAdded: Readonly<Record<string, string>>;
  fixtures: FixtureProof[];
  results: CheckResult[];
  // ranOutOutsideChecks lists the waits that ran to their cap during the scenario
  // but in none of its checks: in bring-up, in the steps between checks, at the end.
  ranOutOutsideChecks: RanOut[];
  bringUpMs: number | null;
  wallMs: number;
  teardown: ScenarioEnd | null;
  display: DisplayReading | null;
  planted?: string;
  stopped?: string;
}

// PlantOutcome is what a plant run shows for each check the plant was made for.
interface PlantOutcome { check: string; verdict: string; moved: boolean }

// Prepared is what a scenario's preparation built before the launch.
interface Prepared { folder: string; fixtures: FixtureProof[]; extra?: Record<string, unknown> }

// ScenarioPlan is one scenario: its fixtures, the settings it changes, and its
// checks, named ahead so a fixture that cannot be built still reports each of
// them as not run.
interface ScenarioPlan {
  name: string;
  checks: readonly string[];
  settings?: Record<string, unknown>;
  // observers are installed in the workbench as soon as it is reachable, for a
  // scenario whose checks read what the editor drew while the extension started.
  observers?: readonly string[];
  // environment is what the scenario adds to the editor's environment, for a
  // scenario whose checks read what a variable set there does.
  environment?: Readonly<Record<string, string>>;
  prepare: (root: ScenarioRoot, home: ScratchHome, log: string) => Promise<Prepared>;
  body: (ctx: SuiteContext, prepared: Prepared) => Promise<void>;
  // cleanup stops what the preparation started beside the editor.
  cleanup?: (prepared: Prepared | null) => Promise<void>;
}

function plans(inputs: Inputs): ScenarioPlan[] {
  const bin = inputs.compiler.path;
  return [
    {
      name: 'gateway',
      checks: GATEWAY_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const reference = path.join(root.dir, 'reference', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'gateway', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures, extra: { reference } };
      },
      body: (ctx, p) => gatewayChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'storefront',
      checks: STOREFRONT_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const reference = path.join(root.dir, 'reference', 'storefront');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'storefront', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
          await proveUnreachable(),
          proveMissing(path.join(root.dir, 'no-such-compiler', 'aggrega')),
        ];
        return { folder, fixtures, extra: { reference } };
      },
      body: (ctx, p) => storefrontChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'workspace-above',
      checks: ABOVE_CHECKS,
      prepare: async (root, home, log) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeWorkspaceAbove(docs, path.join(root.dir, 'workspace-above'), inputs.catalog.dir);
        const reference = placeWorkspaceAbove(docs, path.join(root.dir, 'reference', 'workspace-above'), inputs.catalog.dir);
        const fixtures = [layout.proof, await writeLockfile(bin, layout.folder, 'release-compose.yaml', home, log), reference.proof];
        return { folder: layout.folder, fixtures, extra: { root: layout.root, referenceRoot: reference.root } };
      },
      body: (ctx, p) => aboveChecks(ctx, { root: p.extra?.root as string, referenceRoot: p.extra?.referenceRoot as string }),
    },
    {
      name: 'storefront-killed-server',
      checks: KILLED_CHECKS,
      settings: KILLED_SETTINGS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => killedChecks(ctx),
    },
    {
      name: 'storefront-with-registries',
      checks: REGISTRY_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const reference = path.join(root.dir, 'reference', 'storefront');
        const table = new ProcessTable(path.join(root.dir, 'registry-processes.json'));
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'storefront', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
          await proveUnreachable(),
        ];
        const registry = await startRegistry(inputs.registryServer.path, path.join(root.dir, 'registry'), home, table)
          .catch(async (err: unknown) => { await stopTable(table); throw err; });
        fixtures.push(registry.proof);
        try {
          const population = await populateRegistry({ binary: bin, registry, catalog: inputs.catalog.dir, folder, dir: path.join(root.dir, 'registry'), home, log, alsoRegister: [UNREACHABLE_HOST] });
          fixtures.push(population.proof);
          const stubs = await startStubRegistries(path.join(root.dir, 'stub-registries'), home, table);
          fixtures.push(stubs.proof);
          return { folder, fixtures, extra: { registry, stubs, reference, table } };
        } catch (err) {
          await stopTable(table);
          throw err;
        }
      },
      body: (ctx, p) => registryChecks(ctx, p.extra?.registry as ScratchRegistry, p.extra?.stubs as StubRegistries, p.extra?.reference as string),
      cleanup: async (p) => { if (p?.extra?.table) { await stopTable(p.extra.table as ProcessTable); } },
    },
    {
      name: 'releases-with-own-catalogs',
      checks: OWN_CATALOGS_CHECKS,
      prepare: async (root, home, log) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeOwnCatalogs(docs, path.join(root.dir, 'workspace', 'mariadb-adminer'), inputs.catalog.dir);
        const reference = placeOwnCatalogs(docs, path.join(root.dir, 'reference', 'mariadb-adminer'), inputs.catalog.dir);
        const fixtures = [layout.proof, placeSecondAggregate(layout.folder), reference.proof, placeSecondAggregate(reference.folder)];
        for (const release of OFFLINE_RELEASES) {
          fixtures.push(await writeLockfile(bin, layout.folder, release, home, log), copyLockfile(layout.folder, reference.folder, release));
        }
        return { folder: layout.folder, fixtures, extra: { reference: reference.folder } };
      },
      body: (ctx, p) => ownCatalogsChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'releases-with-own-catalogs-selected-release',
      checks: SELECTED_RELEASE_CHECKS,
      prepare: async (root, home, log) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeOwnCatalogs(docs, path.join(root.dir, 'workspace', 'mariadb-adminer'), inputs.catalog.dir);
        const reference = placeOwnCatalogs(docs, path.join(root.dir, 'reference', 'mariadb-adminer'), inputs.catalog.dir);
        const fixtures = [
          layout.proof, placeSelectionReadings(layout.folder),
          reference.proof, placeSelectionReadings(reference.folder),
          await writeLockfile(bin, layout.folder, GRAPH_RELEASE, home, log),
          copyLockfile(layout.folder, reference.folder, GRAPH_RELEASE),
        ];
        return { folder: layout.folder, fixtures, extra: { reference: reference.folder } };
      },
      body: (ctx, p) => selectedReleaseChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'storefront-graph-panel',
      checks: GRAPH_PANEL_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const reference = path.join(root.dir, 'reference', 'storefront');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'storefront', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
          proveMissing(missing),
        ];
        // The folder as the scenario starts it, which its last check compares
        // the folder with.
        return { folder, fixtures, extra: { reference, missing, snapshot: readTree(folder) } };
      },
      body: (ctx, p) => graphPanelChecks(ctx, p.extra?.reference as string, p.extra?.snapshot as Tree, p.extra?.missing as string),
    },
    {
      name: 'probes-nothing-may-attach',
      checks: PROBES_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'probes');
        const reference = path.join(root.dir, 'reference', 'probes');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'probes', folder, null),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'probes', reference, null),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures, extra: { reference } };
      },
      body: (ctx, p) => probesChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'gateway-top-level-attach',
      checks: TOP_LEVEL_ATTACH_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const reference = path.join(root.dir, 'reference', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'gateway', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures, extra: { reference, snapshot: readTree(folder) } };
      },
      body: (ctx, p) => topLevelAttachChecks(ctx, p.extra?.reference as string, p.extra?.snapshot as Tree),
    },
    {
      name: 'storefront-graph-drawing',
      checks: GRAPH_DRAWING_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const reference = path.join(root.dir, 'reference', 'storefront');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'storefront', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures, extra: { reference } };
      },
      body: (ctx, p) => graphDrawingChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'storefront-graph-idle',
      checks: GRAPH_IDLE_CHECKS,
      settings: GRAPH_IDLE_SETTINGS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => graphIdleChecks(ctx),
    },
    {
      name: 'fleet-graph-first-fit',
      checks: FLEET_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'fleet');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'fleet', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => fleetChecks(ctx),
    },
    {
      name: 'storefront-graph-nested-boundaries',
      checks: NESTED_BOUNDARY_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'storefront');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          nestBoundaries(folder),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => nestedBoundaryChecks(ctx),
    },
    {
      name: 'gateway-readiness',
      checks: READINESS_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => readinessChecks(ctx),
    },
    {
      name: 'gateway-cache',
      checks: CACHE_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const reference = path.join(root.dir, 'reference', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'gateway', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
        ];
        return { folder, fixtures, extra: { reference } };
      },
      body: (ctx, p) => cacheChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'empty-workspace',
      checks: EMPTY_WORKSPACE_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'empty-workspace');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const fixtures = [placeFolder(inputs.extension.dir, 'empty-workspace', folder, null), proveMissing(missing)];
        return { folder, fixtures, extra: { missing } };
      },
      body: (ctx, p) => emptyWorkspaceChecks(ctx, p.extra?.missing as string),
    },
    {
      name: 'no-workspace-first-day',
      checks: NO_WORKSPACE_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'unanchored');
        return { folder, fixtures: [await placeUnanchored(folder)] };
      },
      body: (ctx) => noWorkspaceChecks(ctx),
    },
    {
      name: 'workspace-above-authoring-release',
      checks: AUTHORING_RELEASE_CHECKS,
      prepare: async (root) => {
        const top = path.join(root.dir, 'root-above-services');
        const layout = await placeEmptyBeneathWorkspace(top, path.join('services', 'docs'));
        return { folder: layout.folder, fixtures: [layout.proof], extra: { root: top } };
      },
      body: (ctx, p) => authoringReleaseChecks(ctx, p.extra?.root as string),
    },
    {
      name: 'gateway-endings',
      checks: ENDINGS_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const reference = path.join(root.dir, 'reference', 'gateway');
        const table = new ProcessTable(path.join(root.dir, 'registry-processes.json'));
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'gateway', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
        ];
        const registry = await startRegistry(inputs.registryServer.path, path.join(root.dir, 'registry'), home, table)
          .catch(async (err: unknown) => { await stopTable(table); throw err; });
        fixtures.push(registry.proof);
        try {
          fixtures.push(await registerAsDefault({ binary: bin, registry, folder, home, log }));
          return { folder, fixtures, extra: { registry, reference, table } };
        } catch (err) {
          await stopTable(table);
          throw err;
        }
      },
      body: (ctx, p) => endingsChecks(ctx, p.extra?.reference as string, p.extra?.registry as ScratchRegistry),
      cleanup: async (p) => { if (p?.extra?.table) { await stopTable(p.extra.table as ProcessTable); } },
    },
    {
      name: 'mysql-watch-and-stop',
      checks: WATCH_AND_STOP_CHECKS,
      prepare: async (root, _home, log) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeDocsExample(docs, MYSQL_EXAMPLE, path.join(root.dir, 'workspace', 'mysql-innodb-cluster'), inputs.catalog.dir);
        // The lockfile is written from a home of its own, so the scenario's own
        // compiled-module store starts empty and the editor's first build compiles
        // the providers it renders with: long enough to be stopped part-way.
        const pullHome = makeScratchHome(path.join(root.dir, 'lockfile-home'));
        const fixtures = [layout.proof, await writeLockfile(bin, layout.folder, 'release-single.yaml', pullHome, log)];
        return { folder: layout.folder, fixtures, extra: { releases: layout.releases } };
      },
      body: (ctx, p) => watchAndStopChecks(ctx, p.extra?.releases as string[]),
    },
    {
      name: 'two-releases-context-rows',
      checks: LEVELS_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'two-releases');
        const reference = path.join(root.dir, 'reference', 'two-releases');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir),
          placeFolder(inputs.extension.dir, 'two-releases', reference, inputs.catalog.dir),
          proveNothingAbove(folder),
          proveMissing(missing),
        ];
        return { folder, fixtures, extra: { missing, reference } };
      },
      body: (ctx, p) => levelsChecks(ctx, p.extra?.missing as string, p.extra?.reference as string),
    },
    {
      name: 'two-workspaces-context-rows',
      checks: TWO_WORKSPACES_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const parent = path.join(root.dir, 'workspace');
        const mysql = placeDocsExample(docs, MYSQL_EXAMPLE, path.join(parent, 'mysql-innodb-cluster'), inputs.catalog.dir);
        const postgres = placeDocsExample(docs, POSTGRES_EXAMPLE, path.join(parent, 'postgres-init-config'), inputs.catalog.dir);
        return { folder: mysql.folder, fixtures: [mysql.proof, postgres.proof, proveNothingAbove(parent, true)], extra: { postgres: postgres.folder } };
      },
      body: (ctx, p) => twoWorkspacesChecks(ctx, p.extra?.postgres as string),
    },
    {
      name: 'project-folder-adds',
      checks: FOLDER_ADDS_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const layouts = path.join(root.dir, 'layouts');
        const fixtures = await placeLayouts(layouts, FOLDER_ADDS_LAYOUTS);
        fs.writeFileSync(path.join(layouts, NOT_A_FOLDER), 'A file beside the folders a folder dialog lists.\n');
        return { folder: path.join(layouts, FOLDER_ADDS_FIRST), fixtures, extra: { layouts } };
      },
      body: (ctx, p) => folderAddsChecks(ctx, p.extra?.layouts as string),
    },
    {
      name: 'workspace-discovery-layouts',
      checks: DISCOVERY_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const layouts = path.join(root.dir, 'layouts');
        const fixtures = await placeLayouts(layouts, DISCOVERY_LAYOUTS);
        return { folder: path.join(layouts, DISCOVERY_FIRST), fixtures, extra: { layouts } };
      },
      body: (ctx, p) => discoveryChecks(ctx, p.extra?.layouts as string),
    },
    {
      name: 'release-beneath-a-workspace-root',
      checks: BENEATH_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root, home, log) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeWorkspaceAbove(docs, path.join(root.dir, 'checkout'), inputs.catalog.dir);
        const fixtures = [layout.proof, proveNothingAbove(layout.root)];
        for (const release of fs.readdirSync(layout.folder).filter((f) => /^release.*\.ya?ml$/.test(f)).sort()) {
          fixtures.push(await writeLockfile(bin, layout.folder, release, home, log));
        }
        return { folder: layout.folder, fixtures, extra: { root: layout.root } };
      },
      body: (ctx, p) => beneathChecks(ctx, p.extra?.root as string),
    },
    {
      name: 'workspace-above-interruption',
      checks: ABOVE_DIALOG_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const layouts = path.join(root.dir, 'layouts');
        const fixtures = await placeLayouts(layouts, ABOVE_DIALOG_LAYOUTS);
        return { folder: path.join(layouts, ABOVE_DIALOG_FIRST), fixtures, extra: { layouts } };
      },
      body: (ctx, p) => aboveDialogChecks(ctx, p.extra?.layouts as string),
    },
    {
      name: 'three-releases-default-release',
      checks: DEFAULT_RELEASE_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'three-releases');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir),
          placeThirdRelease(folder),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => defaultReleaseChecks(ctx),
    },
    {
      name: 'configuration-file-leading-out',
      checks: LEADING_OUT_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'two-releases');
        const placed = placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir);
        const leading = placeConfigurationLeadingOut(folder);
        return { folder, fixtures: [placed, leading.proof, proveNothingAbove(folder)], extra: { outside: leading.outside } };
      },
      body: (ctx, p) => leadingOutChecks(ctx, p.extra?.outside as string),
    },
    {
      name: 'configuration-file-invalid',
      checks: INVALID_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'two-releases');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir),
          await placeInvalidConfiguration(bin, folder, home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => invalidConfigurationChecks(ctx),
    },
    {
      name: 'configuration-file-linked-inside',
      checks: LINKED_INSIDE_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'two-releases');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir),
          placeConfigurationLinkedInside(folder),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => linkedInsideChecks(ctx),
    },
    {
      name: 'welcome-page-empty-folder',
      checks: WELCOME_EMPTY_FOLDER_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'empty-folder');
        const fixtures = [await placeUnanchored(folder), proveNothingAbove(folder)];
        // A file outside the folder, opened beside the page to show the page takes
        // nothing away from it.
        const beside = path.join(root.dir, 'beside', 'notes.txt');
        fs.mkdirSync(path.dirname(beside), { recursive: true });
        fs.writeFileSync(beside, 'A file opened beside the welcome page.\n');
        const second = await placeSecondCompiler(bin, path.join(root.dir, 'second-compiler'), home, log);
        fixtures.push(second.proof);
        const table = new ProcessTable(path.join(root.dir, 'registry-processes.json'));
        const registry = await startRegistry(inputs.registryServer.path, path.join(root.dir, 'registry'), home, table)
          .catch(async (err: unknown) => { await stopTable(table); throw err; });
        fixtures.push(registry.proof);
        return { folder, fixtures, extra: { registry, table, second, beside } };
      },
      body: (ctx, p) => welcomeEmptyFolderChecks(ctx, { registry: p.extra?.registry as ScratchRegistry, second: p.extra?.second as SecondCompiler, beside: p.extra?.beside as string }),
      cleanup: async (p) => { if (p?.extra?.table) { await stopTable(p.extra.table as ProcessTable); } },
    },
    {
      name: 'welcome-page-configured-workspace',
      checks: WELCOME_CONFIGURED_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const notABinary = path.join(root.dir, 'not-a-compiler', 'aggrega');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          await registerWithNoTrust(bin, CONFIGURED_HOST, folder, home, log),
          proveMissing(missing),
          placeNotABinary(notABinary),
        ];
        return { folder, fixtures, extra: { missing, notABinary } };
      },
      body: (ctx, p) => welcomeConfiguredChecks(ctx, { missing: p.extra?.missing as string, notABinary: p.extra?.notABinary as string }),
    },
    {
      name: 'welcome-page-mixed-workspace',
      checks: WELCOME_MIXED_CHECKS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'two-releases');
        return { folder, fixtures: [placeFolder(inputs.extension.dir, 'two-releases', folder, inputs.catalog.dir)] };
      },
      body: (ctx) => welcomeMixedChecks(ctx),
    },
    {
      name: 'gateway-commands-panel',
      checks: COMMANDS_PANEL_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const notABinary = path.join(root.dir, 'not-a-compiler', 'aggrega');
        const release = 'release-compose.yaml';
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, release, home, log),
          proveNothingAbove(folder),
          placeNotABinary(notABinary),
        ];
        return { folder, fixtures, extra: { notABinary, release } };
      },
      body: (ctx, p) => commandsPanelChecks(ctx, p.extra?.notABinary as string, p.extra?.release as string),
    },
    {
      name: 'mysql-commands-panel-no-release',
      checks: NO_RELEASE_CHECKS,
      prepare: async (root) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeDocsExample(docs, MYSQL_EXAMPLE, path.join(root.dir, 'workspace', 'mysql-innodb-cluster'), inputs.catalog.dir);
        return { folder: layout.folder, fixtures: [layout.proof, proveNothingAbove(layout.folder)], extra: { releases: layout.releases } };
      },
      body: (ctx, p) => noReleaseChecks(ctx, p.extra?.releases as string[]),
    },
    {
      name: 'gateway-docked-menus',
      checks: DOCKED_MENUS_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => dockedMenusChecks(ctx),
    },
    {
      name: 'gateway-docked-configuration',
      checks: DOCKED_CONFIGURATION_CHECKS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => dockedConfigurationChecks(ctx),
    },
    {
      name: 'gateway-list-panel-operations',
      checks: LIST_PANEL_OPERATIONS_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const reference = path.join(root.dir, 'reference', 'gateway');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const unanchored = path.join(root.dir, 'unanchored');
        const table = new ProcessTable(path.join(root.dir, 'registry-processes.json'));
        const generation = placeGeneration(path.join(root.dir, 'generation'), path.join(root.dir, 'generation-reference'), inputs.catalog.dir);
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          placeFolder(inputs.extension.dir, 'gateway', reference, inputs.catalog.dir),
          await writeLockfile(bin, reference, 'release-compose.yaml', home, log),
          proveNothingAbove(folder),
          proveMissing(missing),
          await placeUnanchored(unanchored),
          generation.proof,
        ];
        const registry = await startRegistry(inputs.registryServer.path, path.join(root.dir, 'registry'), home, table)
          .catch(async (err: unknown) => { await stopTable(table); throw err; });
        fixtures.push(registry.proof);
        try {
          fixtures.push(await nameDefaultOnly(bin, registry, folder, home, log));
          return { folder, fixtures, extra: { registry, reference, missing, unanchored, generation, table } };
        } catch (err) {
          await stopTable(table);
          throw err;
        }
      },
      body: (ctx, p) => listPanelOperationsChecks(ctx, {
        registry: p.extra?.registry as ScratchRegistry, reference: p.extra?.reference as string, missing: p.extra?.missing as string, unanchored: p.extra?.unanchored as string, generation: p.extra?.generation as Generation,
      }),
      cleanup: async (p) => { if (p?.extra?.table) { await stopTable(p.extra.table as ProcessTable); } },
    },
    {
      name: 'mysql-inspection-by-name',
      checks: INSPECTION_BY_NAME_CHECKS,
      prepare: async (root) => {
        const docs = path.resolve(REPO_ROOT, '..');
        const layout = placeDocsExample(docs, MYSQL_EXAMPLE, path.join(root.dir, 'workspace', 'mysql-innodb-cluster'), inputs.catalog.dir);
        const reference = placeDocsExample(docs, MYSQL_EXAMPLE, path.join(root.dir, 'reference', 'mysql-innodb-cluster'), inputs.catalog.dir);
        return { folder: layout.folder, fixtures: [layout.proof, reference.proof, proveNothingAbove(layout.folder)], extra: { reference: reference.folder } };
      },
      body: (ctx, p) => inspectionByNameChecks(ctx, p.extra?.reference as string),
    },
    {
      name: 'configured-plugins-removal',
      checks: CONFIGURED_PLUGINS_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root) => {
        const folder = path.join(root.dir, 'workspace', 'configured-plugins');
        const reference = path.join(root.dir, 'reference', 'configured-plugins');
        const missing = path.join(root.dir, 'no-such-compiler', 'aggrega');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'configured-plugins', folder, inputs.catalog.dir),
          placeFolder(inputs.extension.dir, 'configured-plugins', reference, inputs.catalog.dir),
          proveNothingAbove(folder),
          proveMissing(missing),
        ];
        return { folder, fixtures, extra: { reference, missing } };
      },
      body: (ctx, p) => configuredPluginsChecks(ctx, { reference: p.extra?.reference as string, missing: p.extra?.missing as string }),
    },
    {
      name: 'gateway-configuration-report',
      checks: CONFIGURATION_REPORT_CHECKS,
      observers: LEVEL_OBSERVERS,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const notABinary = path.join(root.dir, 'not-a-compiler', 'aggrega');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          setListThroughItsCompanion(folder),
          await writeLockfile(bin, folder, RELEASE, home, log),
          proveNothingAbove(folder),
          proveNoGlobalFile(home),
          proveNothingSetIn(folder, OFFLINE),
          placeNotABinary(notABinary),
        ];
        return { folder, fixtures, extra: { notABinary } };
      },
      body: (ctx, p) => configurationReportChecks(ctx, p.extra?.notABinary as string),
    },
    {
      name: 'gateway-configuration-from-the-environment',
      checks: CONFIGURATION_FROM_THE_ENVIRONMENT_CHECKS,
      environment: OFFLINE_IN_THE_ENVIRONMENT,
      prepare: async (root, home, log) => {
        const folder = path.join(root.dir, 'workspace', 'gateway');
        const fixtures = [
          placeFolder(inputs.extension.dir, 'gateway', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, RELEASE, home, log),
          proveNothingAbove(folder),
          proveNoGlobalFile(home),
          proveNothingSetIn(folder, OFFLINE),
        ];
        return { folder, fixtures };
      },
      body: (ctx) => configurationFromTheEnvironmentChecks(ctx),
    },
    {
      name: 'nothing-configured-configuration-report',
      checks: NOTHING_CONFIGURED_CHECKS,
      prepare: async (root, home) => {
        const layouts = path.join(root.dir, 'layouts');
        const fixtures = await placeLayouts(layouts, [{ folder: YML_RELEASE.folder, files: YML_RELEASE.files ?? {} }]);
        fixtures.push(proveNoGlobalFile(home));
        return { folder: path.join(layouts, YML_RELEASE.folder), fixtures };
      },
      body: (ctx) => nothingConfiguredChecks(ctx),
    },
  ];
}

// stopTable stops what a process table recorded, by identity.
async function stopTable(table: ProcessTable): Promise<void> {
  await table.teardown({ closeBoundMs: 0, termBoundMs: 5000, killBoundMs: 2000 });
}

async function runScenario(plan: ScenarioPlan, inputs: Inputs, runDir: string, driverName: string, plant: Plant | null): Promise<ScenarioResult> {
  const t0 = Date.now();
  const ranOutAtStart = ranOutMark();
  const result: ScenarioResult = { name: plan.name, folder: null, settingsChanged: plan.settings ?? {}, environmentAdded: plan.environment ?? {}, fixtures: [], results: [], ranOutOutsideChecks: [], bringUpMs: null, wallMs: 0, teardown: null, display: null };
  const checks = new Checks(plan.name, plant === null ? undefined : plant.checks);
  const root = createScenarioRoot(runDir, plan.name);
  const home: ScratchHome = { home: root.home, tmp: root.tmp };
  const log = path.join(root.logs, 'cli.log');
  let prepared: Prepared | null = null;
  let s: Scenario | null = null;
  try {
    prepared = await plan.prepare(root, home, log);
    result.fixtures = prepared.fixtures;
    result.folder = prepared.folder;
    if (plant !== null && plant.target === 'folder') { result.planted = applyPlant(plant, prepared.folder); }
    const beforeLaunch = plant !== null && plant.target === 'extension'
      ? (r: ScenarioRoot): void => { result.planted = applyPlant(plant, r.extensionCopy); }
      : undefined;
    s = await bringUp(plan.name, inputs, runDir, driverName, { root, folder: prepared.folder, settings: plan.settings, beforeLaunch, observers: plan.observers, environment: plan.environment });
    result.bringUpMs = s.bringUpMs;
    result.display = s.display;
    await plan.body(makeContext(s, inputs, checks), prepared);
  } catch (err) {
    if (err instanceof EnoughReported) {
      result.stopped = `the plant run ended here: ${err.message}`;
    } else if (err instanceof FixtureError) {
      result.fixtures.push({ fixture: err.fixture, built: false, proof: err.step });
      result.stopped = `the fixture "${err.fixture}" could not be built: ${err.step}`;
    } else {
      result.stopped = `the scenario stopped: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
    }
  }
  if (s !== null) { result.teardown = await tearDown(s); }
  if (plan.cleanup) { await plan.cleanup(prepared).catch(() => undefined); }
  // Every check the scenario names that did not report is reported as not run,
  // with the reason the scenario stopped.
  const reported = new Set(checks.results.map((r) => r.name));
  for (const name of plan.checks) {
    if (!reported.has(name)) {
      checks.reportUnrun(name, result.stopped ?? 'the scenario ended before this check ran');
    }
  }
  result.results = checks.results;
  const inChecks = new Set(checks.results.flatMap((r) => r.ranOut ?? []));
  result.ranOutOutsideChecks = ranOutSince(ranOutAtStart).filter((w) => !inChecks.has(w));
  result.wallMs = Date.now() - t0;
  return result;
}

function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

// ranOutLine words the waits that ran to their cap, each with its cap, whether
// that cap was a guard or a duration a check states, and its last reading.
function ranOutLine(indent: string, ran: readonly RanOut[]): string {
  return `${indent}waits that ran to their cap: ${ran.map((w) => `${w.what} (${w.capMs} ms, ${w.guarded ? 'a guard' : 'a stated duration'}; last reading ${clip(w.last, 160)})`).join('; ')}`;
}

function line(r: CheckResult): string[] {
  const tag = r.verdict === 'failed' ? 'FAILED' : r.verdict;
  const out = [`  [${tag}] ${r.name} (${r.elapsedMs} ms)`];
  if (r.ranOut !== undefined) { out.push(ranOutLine('      ', r.ranOut)); }
  if (r.expected !== '') { out.push(`      expected: ${r.verdict === 'failed' ? r.expected : clip(r.expected, 400)}`); }
  if (r.verdict === 'failed') {
    out.push(`      seen: ${r.seen}`);
  } else if (r.verdict === 'not run') {
    out.push(`      not run: ${r.reason ?? ''}`);
  } else if (r.verdict === 'cannot run here') {
    out.push(`      cannot run here: ${r.reason ?? ''}`);
  } else if (r.verdict === 'for a person') {
    out.push(`      question: ${r.forPerson?.question ?? ''}`, `      capture: ${r.forPerson?.screenshot ?? 'none'}`, `      drawn: ${clip(r.forPerson?.drawnText ?? '', 400)}`);
  } else {
    out.push(`      seen: ${clip(r.seen, 300)}`);
  }
  return out;
}

// useLine states what one launch used, with how it was read.
function useLine(end: ScenarioEnd): string {
  const u = end.resources;
  const g = (name: string, x: typeof u.editor): string => `${name}: peak ${x.peakRssMb} MB resident (${x.peakPssMb} MB proportional) across ${x.peakProcesses} process(es), ${x.cpuSeconds} CPU-seconds over ${x.processesSeen} process(es)`;
  return `  used: ${g("the editor's process tree", u.editor)}; ${g('its language servers', u.languageServer)}; read ${u.readings} times, every ${u.intervalMs} ms`;
}

function displayLine(d: DisplayReading | null): string {
  if (d === null) { return '  display: not read (the editor did not come up)'; }
  const stated = d.stated.length === 0 ? 'the editor was given no display variable' : `the editor was given ${d.stated.join(', ')}`;
  const server = d.languageServer === null ? 'the language server was not found to read' : d.languageServer.length === 0 ? 'none reached the language server' : `${d.languageServer.join(', ')} reached the language server`;
  return `  display: ${stated}, and ${server}; the editor draws on the headless platform`;
}

// plantOutcomes reads, for each check a plant was made for, whether it moved the
// way the plant says.
function plantOutcomes(plant: Plant, results: CheckResult[]): PlantOutcome[] {
  return plant.checks.map((check) => {
    const r = results.find((x) => x.scenario === plant.scenario && x.name === check);
    const verdict = r?.verdict ?? 'not reported';
    return { check, verdict, moved: plant.moves === 'red' ? verdict === 'failed' : verdict === 'passed' };
  });
}

export async function runSuite(opts: { inputs: Inputs; runDir: string; driverName: string; only?: string[]; plant?: Plant; header: Record<string, string> }): Promise<SuiteReport> {
  const t0 = Date.now();
  sealDeclarations();
  const all = plans(opts.inputs);
  const plant = opts.plant ?? null;
  const only = plant !== null ? [plant.scenario] : opts.only;
  const unknown = (only ?? []).filter((n) => !all.some((p) => p.name === n));
  if (unknown.length > 0) { throw new Error(`unknown scenario ${unknown.join(', ')}; the scenarios are ${all.map((p) => p.name).join(', ')}`); }
  const chosen = only && only.length > 0 ? all.filter((p) => only.includes(p.name)) : all;
  const scenarios: ScenarioResult[] = [];
  for (const plan of chosen) {
    scenarios.push(await runScenario(plan, opts.inputs, opts.runDir, opts.driverName, plant));
  }
  const results = scenarios.flatMap((s) => s.results);
  const t = tally(results);
  const fixturesFailed = scenarios.flatMap((s) => s.fixtures).filter((f) => !f.built);
  const summary = ['suite', ...Object.entries(opts.header).map(([k, v]) => `  ${k}: ${v}`)];
  const outcomes = plant === null ? null : plantOutcomes(plant, results);
  if (plant !== null && outcomes !== null) {
    summary.push(`  plant: ${plant.name} — ${plant.says}; made in the scratch copy of the ${plant.target === 'extension' ? 'extension' : 'folder'} (${plant.file}); it must turn ${plant.checks.join(', ')} ${plant.moves}`);
  }
  for (const s of scenarios) {
    summary.push('', `scenario ${s.name}: ${s.folder ?? 'no folder'}; bring-up ${s.bringUpMs ?? '-'} ms; wall ${s.wallMs} ms; teardown ${s.teardown ? `${s.teardown.elapsedMs} ms, ${s.teardown.stillAlive.length} still alive of ${s.teardown.recorded} recorded` : '-'}`);
    summary.push(displayLine(s.display));
    if (s.teardown) { summary.push(useLine(s.teardown)); }
    if (Object.keys(s.settingsChanged).length > 0) { summary.push(`  settings this scenario changes: ${JSON.stringify(s.settingsChanged)}`); }
    if (Object.keys(s.environmentAdded).length > 0) { summary.push(`  variables this scenario adds to the editor's environment: ${JSON.stringify(s.environmentAdded)}`); }
    for (const f of s.fixtures) { summary.push(`  fixture ${f.built ? 'built' : 'NOT BUILT'}: ${f.fixture} — ${f.proof}`); }
    if (s.planted) { summary.push(`  planted: ${s.planted}`); }
    if (s.stopped) { summary.push(`  stopped: ${s.stopped.split('\n')[0]}`); }
    if (s.ranOutOutsideChecks.length > 0) { summary.push(ranOutLine('  outside the checks, ', s.ranOutOutsideChecks)); }
    for (const r of s.results) { summary.push(...line(r)); }
  }
  summary.push(...cannotRunHereSection(results));
  summary.push('', `checks: ${t.passed} passed, ${t.failed} failed, ${t['not run']} not run, ${t['cannot run here']} cannot run here, ${t['for a person']} for a person; neither not run nor cannot run here is counted as passed; not run fails the suite, and cannot run here does not`, `wall clock ${Date.now() - t0} ms`);
  if (plant !== null && outcomes !== null) {
    const failed = results.filter((r) => r.verdict === 'failed').map((r) => r.name);
    summary.push(
      `plant ${plant.name}: ${outcomes.map((o) => `${o.check} ${o.verdict}, ${o.moved ? `turned ${plant.moves} as the plant must` : `NOT turned ${plant.moves}`}`).join('; ')}`,
      `checks that failed in this run: ${failed.length === 0 ? 'none' : failed.join(', ')}`,
    );
  }
  const data = { header: opts.header, wallMs: Date.now() - t0, tally: t, plant: plant === null ? null : { ...plant, outcomes }, scenarios };
  fs.writeFileSync(path.join(opts.runDir, 'suite.checks.json'), `${JSON.stringify(results, null, 2)}\n`);
  const allPassed = outcomes !== null
    ? outcomes.every((o) => o.moved) && fixturesFailed.length === 0
    : suitePassed(results, fixturesFailed.length);
  return { data, summary, allPassed };
}

// cannotRunHereSection lists, apart from the scenarios' own lines, every check
// that cannot run here, with the reason its declaration states, so the checks a
// passing suite still did not run are read in one place.
export function cannotRunHereSection(results: readonly CheckResult[]): string[] {
  const unreached = results.filter((r) => r.verdict === 'cannot run here');
  if (unreached.length === 0) { return []; }
  return [
    '',
    `cannot run here: ${unreached.length} — each needs a state no run can build, as it was declared before any run; none is counted as passed and none fails the suite; where you can build the state, walk it by hand`,
    ...unreached.flatMap((r) => [`  ${r.scenario} / ${r.name}`, `      cannot run here: ${r.reason ?? ''}`]),
  ];
}
