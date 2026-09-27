// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CheckResult, Checks, EnoughReported, tally } from './checks';
import { ScratchHome } from './cli';
import { createScenarioRoot, ScenarioRoot } from './editor';
import { FixtureError, FixtureProof, placeFolder, placeWorkspaceAbove, proveMissing, proveUnreachable, UNREACHABLE_HOST, writeLockfile } from './fixtures';
import { Inputs, REPO_ROOT } from './inputs';
import { applyPlant, Plant } from './plants';
import { aboveChecks, ABOVE_CHECKS } from './suite-above';
import { ProcessTable } from './processes';
import { populateRegistry, ScratchRegistry, startRegistry } from './registry';
import { bringUp, DisplayReading, Scenario, ScenarioEnd, tearDown } from './scenario';
import { makeContext, SuiteContext } from './suite-context';
import { gatewayChecks, GATEWAY_CHECKS } from './suite-gateway';
import { KILLED_CHECKS, KILLED_SETTINGS, killedChecks } from './suite-killed';
import { registryChecks, REGISTRY_CHECKS } from './suite-registry';
import { storefrontChecks, STOREFRONT_CHECKS } from './suite-storefront';

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
};

// ScenarioResult is one scenario as the report states it.
interface ScenarioResult {
  name: string;
  folder: string | null;
  settingsChanged: Record<string, unknown>;
  fixtures: FixtureProof[];
  results: CheckResult[];
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
        const table = new ProcessTable(path.join(root.dir, 'registry-processes.json'));
        const fixtures = [
          placeFolder(inputs.extension.dir, 'storefront', folder, inputs.catalog.dir),
          await writeLockfile(bin, folder, 'release-compose.yaml', home, log),
          await proveUnreachable(),
        ];
        const registry = await startRegistry(inputs.registryServer.path, path.join(root.dir, 'registry'), home, table)
          .catch(async (err: unknown) => { await stopTable(table); throw err; });
        fixtures.push(registry.proof);
        const prepared: Prepared = { folder, fixtures, extra: { registry, table } };
        try {
          const population = await populateRegistry({ binary: bin, registry, catalog: inputs.catalog.dir, folder, dir: path.join(root.dir, 'registry'), home, log, alsoRegister: [UNREACHABLE_HOST] });
          fixtures.push(population.proof);
        } catch (err) {
          await stopTable(table);
          throw err;
        }
        return prepared;
      },
      body: (ctx, p) => registryChecks(ctx, p.extra?.registry as ScratchRegistry),
      cleanup: async (p) => { if (p?.extra?.table) { await stopTable(p.extra.table as ProcessTable); } },
    },
  ];
}

// stopTable stops what a process table recorded, by identity.
async function stopTable(table: ProcessTable): Promise<void> {
  await table.teardown({ closeBoundMs: 0, termBoundMs: 5000, killBoundMs: 2000 });
}

async function runScenario(plan: ScenarioPlan, inputs: Inputs, runDir: string, driverName: string, plant: Plant | null): Promise<ScenarioResult> {
  const t0 = Date.now();
  const result: ScenarioResult = { name: plan.name, folder: null, settingsChanged: plan.settings ?? {}, fixtures: [], results: [], bringUpMs: null, wallMs: 0, teardown: null, display: null };
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
    s = await bringUp(plan.name, inputs, runDir, driverName, { root, folder: prepared.folder, settings: plan.settings, beforeLaunch });
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
  result.wallMs = Date.now() - t0;
  return result;
}

function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

function line(r: CheckResult): string[] {
  const tag = r.verdict === 'failed' ? 'FAILED' : r.verdict;
  const out = [`  [${tag}] ${r.name} (${r.elapsedMs} ms)`];
  if (r.expected !== '') { out.push(`      expected: ${r.verdict === 'failed' ? r.expected : clip(r.expected, 400)}`); }
  if (r.verdict === 'failed') {
    out.push(`      seen: ${r.seen}`);
  } else if (r.verdict === 'not run') {
    out.push(`      not run: ${r.reason ?? ''}`);
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
    for (const f of s.fixtures) { summary.push(`  fixture ${f.built ? 'built' : 'NOT BUILT'}: ${f.fixture} — ${f.proof}`); }
    if (s.planted) { summary.push(`  planted: ${s.planted}`); }
    if (s.stopped) { summary.push(`  stopped: ${s.stopped.split('\n')[0]}`); }
    for (const r of s.results) { summary.push(...line(r)); }
  }
  summary.push('', `checks: ${t.passed} passed, ${t.failed} failed, ${t['not run']} not run, ${t['for a person']} for a person; not run is not counted as passed`, `wall clock ${Date.now() - t0} ms`);
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
    : t.failed === 0 && t['not run'] === 0 && fixturesFailed.length === 0;
  return { data, summary, allPassed };
}
