// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { BuildNotice, DependencyResolutionReport } from './types';

// This module is the one description of what a build's answer puts on the
// output channel between the line that opens the report and the line that
// closes it: what the build's own dependency resolution did, then the
// advisories that carry no document position, then the files.
//
// It imports no editor type, so the lines are read back by a test with no
// editor running. The two build requests report through it, because their
// answers carry the same advisories in the same shape; only a build that
// resolved its dependencies first carries the resolution's report.

// BuildReport is the part of a build answer the channel reports. Both build
// answers satisfy it: the preview's carries no resolution report, since a
// request that writes nothing cannot have written a lockfile.
export interface BuildReport {
  files: string[] | null;
  notices?: BuildNotice[];
  dependencyResolution?: DependencyResolutionReport;
}

type PinnedReference = NonNullable<DependencyResolutionReport['entities']>[number];

// buildReportLines is every line a build's answer puts on the channel, in the
// order the channel shows them.
//
// 🔴 THE RESOLUTION COMES FIRST BECAUSE IT HAPPENED FIRST. A build asked to
// resolve its dependencies resolves them before it renders, and what it
// rendered depends on what the resolution pinned — so a reader who scrolls
// back from the files reaches the resolution they were rendered against, and
// never the other way round.
export function buildReportLines(report: BuildReport): string[] {
  return [
    ...dependencyResolutionLines(report.dependencyResolution),
    ...(report.notices ?? []).map(noticeLine),
    // A build that wrote nothing answers with null rather than an empty list,
    // and the two say the same thing.
    ...(report.files ?? []).map((file) => `  ${file}`),
  ];
}

// noticeLine renders one advisory that carries no document position: the
// surface that raised it, where the answer names one, and the text as it
// arrived.
function noticeLine(notice: BuildNotice): string {
  return notice.class ? `  ${notice.class}: ${notice.text}` : `  ${notice.text}`;
}

// dependencyResolutionLines lists what a resolution did, from the report the
// answer carries: each reference it pinned, then the lockfile it wrote.
//
// Every value is the report's own, printed as it arrived — the reference as the
// report names it, the version it resolved to, the kind where the report names
// one. Nothing is inferred from a reference's shape: the report carries no
// account of where each reference was found, and a guess at it from the
// spelling would state something the compiler never said.
//
// The closing line is the command line's own summary of a completed
// resolution, in the same words, because the two surfaces perform one
// operation: a reader who has run the same build in a terminal meets the same
// report here. As there, the recorded plugin identities are counted only where
// there are any, since a workspace that attaches none has none to report.
//
// A build that did not resolve its dependencies carries no report, and nothing
// is listed for it.
function dependencyResolutionLines(report: DependencyResolutionReport | undefined): string[] {
  if (report === undefined) { return []; }
  const entities = report.entities ?? [];
  const lines = [...entities, ...(report.libraries ?? []), ...(report.plugins ?? [])].map(pinnedLine);
  const trusted = report.trustedPlugins > 0 ? `, trusted_plugins=${report.trustedPlugins}` : '';
  lines.push(
    `  Pull complete: ${report.lockfile} (entities=${entities.length}, `
    + `source_artifacts=${report.sourceArtifacts}, external_inputs=${report.externalInputs}${trusted})`,
  );
  // A resolution that pinned its dependencies but could not finish discovering
  // the Release's external inputs says so beside the lockfile it wrote, with
  // what stopped it: a summary line alone would read as a complete pin set.
  if (report.incompleteExternalInputs) {
    lines.push(
      '  External inputs were not fully discovered: dependency pins are complete, '
      + `external-input pins may not be: ${report.incompleteExternalInputs}`,
    );
  }
  return lines;
}

// pinnedLine renders one reference the resolution pinned. A reference that
// resolved to no version — the Release's own Aggregate and Manifest are such
// references, pinned by their content — is named without one.
function pinnedLine(ref: PinnedReference): string {
  const version = ref.version ? ` at ${ref.version}` : '';
  const kind = ref.kind ? ` (${ref.kind})` : '';
  return `  pinned ${ref.uri}${version}${kind}`;
}
