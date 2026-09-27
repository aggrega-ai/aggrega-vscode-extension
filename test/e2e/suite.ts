// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CheckResult, Checks, tally } from './checks';
import { ScratchHome } from './cli';
import { createScenarioRoot, ScenarioRoot } from './editor';
import { FixtureError, FixtureProof, placeFolder, placeWorkspaceAbove, proveMissing, proveUnreachable, UNREACHABLE_HOST, writeLockfile } from './fixtures';
import { Inputs, REPO_ROOT } from './inputs';
import { aboveChecks, ABOVE_CHECKS } from './suite-above';
import { ProcessTable, TeardownReport } from './processes';
import { populateRegistry, ScratchRegistry, startRegistry } from './registry';
import { bringUp, Scenario, tearDown } from './scenario';
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

// ScenarioResult is one scenario as the report states it.
interface ScenarioResult {
  name: string;
  folder: string | null;
  settingsChanged: Record<string, unknown>;
  fixtures: FixtureProof[];
  results: CheckResult[];
  bringUpMs: number | null;
  wallMs: number;
  teardown: TeardownReport | null;
  stopped?: string;
}

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

async function runScenario(plan: ScenarioPlan, inputs: Inputs, runDir: string, driverName: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const result: ScenarioResult = { name: plan.name, folder: null, settingsChanged: plan.settings ?? {}, fixtures: [], results: [], bringUpMs: null, wallMs: 0, teardown: null };
  const checks = new Checks(plan.name);
  const root = createScenarioRoot(runDir, plan.name);
  const home: ScratchHome = { home: root.home, tmp: root.tmp };
  const log = path.join(root.logs, 'cli.log');
  let prepared: Prepared | null = null;
  let s: Scenario | null = null;
  try {
    prepared = await plan.prepare(root, home, log);
    result.fixtures = prepared.fixtures;
    result.folder = prepared.folder;
    s = await bringUp(plan.name, inputs, runDir, driverName, { root, folder: prepared.folder, settings: plan.settings });
    result.bringUpMs = s.bringUpMs;
    await plan.body(makeContext(s, inputs, checks), prepared);
  } catch (err) {
    if (err instanceof FixtureError) {
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
      checks.notRun(name, { expected: '', plant: '' }, result.stopped ?? 'the scenario ended before this check ran');
    }
  }
  result.results = checks.results;
  result.wallMs = Date.now() - t0;
  return result;
}

function line(r: CheckResult): string[] {
  const tag = r.verdict === 'failed' ? 'FAILED' : r.verdict;
  const out = [`  [${tag}] ${r.name} (${r.elapsedMs} ms)`];
  if (r.verdict === 'failed') {
    out.push(`      expected: ${r.expected}`, `      seen: ${r.seen}`);
  } else if (r.verdict === 'not run') {
    out.push(`      not run: ${r.reason ?? ''}`);
  } else if (r.verdict === 'for a person') {
    out.push(`      question: ${r.forPerson?.question ?? ''}`, `      capture: ${r.forPerson?.screenshot ?? 'none'}`, `      drawn: ${(r.forPerson?.drawnText ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
  } else {
    out.push(`      seen: ${r.seen.slice(0, 300)}`);
  }
  return out;
}

export async function runSuite(opts: { inputs: Inputs; runDir: string; driverName: string; only?: string[]; header: Record<string, string> }): Promise<SuiteReport> {
  const t0 = Date.now();
  const all = plans(opts.inputs);
  const unknown = (opts.only ?? []).filter((n) => !all.some((p) => p.name === n));
  if (unknown.length > 0) { throw new Error(`unknown scenario ${unknown.join(', ')}; the scenarios are ${all.map((p) => p.name).join(', ')}`); }
  const chosen = opts.only && opts.only.length > 0 ? all.filter((p) => opts.only?.includes(p.name)) : all;
  const scenarios: ScenarioResult[] = [];
  for (const plan of chosen) {
    scenarios.push(await runScenario(plan, opts.inputs, opts.runDir, opts.driverName));
  }
  const results = scenarios.flatMap((s) => s.results);
  const t = tally(results);
  const fixturesFailed = scenarios.flatMap((s) => s.fixtures).filter((f) => !f.built);
  const summary = ['suite', ...Object.entries(opts.header).map(([k, v]) => `  ${k}: ${v}`)];
  for (const s of scenarios) {
    summary.push('', `scenario ${s.name}: ${s.folder ?? 'no folder'}; bring-up ${s.bringUpMs ?? '-'} ms; wall ${s.wallMs} ms; teardown ${s.teardown ? `${s.teardown.elapsedMs} ms, ${s.teardown.stillAlive.length} still alive of ${s.teardown.recorded} recorded` : '-'}`);
    if (Object.keys(s.settingsChanged).length > 0) { summary.push(`  settings this scenario changes: ${JSON.stringify(s.settingsChanged)}`); }
    for (const f of s.fixtures) { summary.push(`  fixture ${f.built ? 'built' : 'NOT BUILT'}: ${f.fixture} — ${f.proof}`); }
    if (s.stopped) { summary.push(`  stopped: ${s.stopped.split('\n')[0]}`); }
    for (const r of s.results) { summary.push(...line(r)); }
  }
  summary.push('', `checks: ${t.passed} passed, ${t.failed} failed, ${t['not run']} not run, ${t['for a person']} for a person; not run is not counted as passed`, `wall clock ${Date.now() - t0} ms`);
  const data = { header: opts.header, wallMs: Date.now() - t0, tally: t, scenarios };
  fs.writeFileSync(path.join(opts.runDir, 'suite.checks.json'), `${JSON.stringify(results, null, 2)}\n`);
  return { data, summary, allPassed: t.failed === 0 && t['not run'] === 0 && fixturesFailed.length === 0 };
}
