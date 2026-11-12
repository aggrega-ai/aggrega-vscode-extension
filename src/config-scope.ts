// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// Some settings are shared across every project on the machine by nature, and
// writing one into a single project's file either does nothing or is not what the
// reader meant. This module says which, so a surface can decline to offer such a
// setting as a project-file change instead of offering it and being wrong.
//
// 🔴 THIS IS A RECORDED NEAR-DUPLICATE, AND THE DUPLICATION IS FORCED RATHER THAN
// CHOSEN. The configuration schema carries no machine-readable statement of a
// setting's reach — no annotation, no keyword, nothing a walk of it could read —
// so the classification cannot be derived the way every label, description,
// default and bound on this surface is derived. What it is instead is a
// restatement, here, of a classification the compiler holds in one place of its
// own: which configuration-mutating operations write a setting shared across
// every workspace on the machine, and which write one belonging to a single
// project's build.
//
// Two consequences follow, and both are the point of stating this rather than
// leaving it to be inferred:
//
//   - The set below is DELIBERATELY the narrowest one the evidence supports.
//     Every entry names the evidence that puts it there. A setting the evidence
//     does not reach is reported as unclassified rather than assumed safe to
//     write anywhere, because an assumption in that direction is the one that
//     changes every project on a machine while the reader believes they changed
//     one.
//   - Because the correspondence is to a site that shares no symbol with this
//     one, nothing can fail when the two disagree. This is the copy that would be
//     deleted outright if the schema gained a per-setting statement of reach, and
//     the surface would then derive the reach the way it derives everything else.
//
// It holds no editor type, so the classification is assertable without an
// extension host.

import { ConfigControl } from './config-schema';

// ConfigReach is how far a setting's value carries.
export type ConfigReach = 'machine' | 'project' | 'unclassified';

// ConfigScope is a setting's reach together with why it has that reach.
//
// The evidence travels with the verdict rather than being left in a comment,
// because the surface shows the reader why a setting is not offered as a project
// change — and an unexplained refusal reads as the surface being broken.
export interface ConfigScope {
  reach: ConfigReach;
  // evidence is the reason in the reader's own terms. It is empty for an
  // unclassified setting, which by definition has none.
  evidence: string;
}

// A prefix and the reach it carries, with the evidence for it.
//
// Matching is by path prefix because a group's reach is its members' reach: the
// trust identities inside a registry entry are as machine-wide as the entry, and
// enumerating each of them here would be a list that had to grow whenever the
// schema's registry shape did.
interface ReachRule {
  prefix: string[];
  reach: ConfigReach;
  evidence: string;
}

// MACHINE_WIDE_BY_NATURE are the settings the evidence places on the machine
// rather than in a project.
//
// Each entry's evidence is what the product itself says, not an inference from
// the setting's name. Read them as the whole of what is claimed: the list is
// short because the evidence is short, and lengthening it by analogy is exactly
// the guess this module exists to avoid.
const MACHINE_WIDE_BY_NATURE: ReachRule[] = [
  {
    // A registry and the identities trusted on it are global tooling: the
    // operation that registers one writes the global configuration shared across
    // every workspace on this machine unless told otherwise.
    prefix: ['registries'],
    reach: 'machine',
    evidence: 'A registry and its signature trust policy are global tooling, so '
      + 'registering one changes what every project on this machine resolves through.',
  },
  {
    // A command-contributing plugin installs a command for every project on the
    // machine, so its list is written to the shared file by default.
    prefix: ['plugins', 'cli'],
    reach: 'machine',
    evidence: 'A command-contributing plugin adds its command for every project on this '
      + 'machine, so the list it joins is the shared one.',
  },
  {
    // The compiled-module store is one store per machine, and the schema says so
    // in the setting's own description: a Wasm plugin is compiled once per
    // machine rather than once per build.
    prefix: ['compiled_module_cache'],
    reach: 'machine',
    evidence: 'The compiled-module store is shared by every workspace on this machine, so a '
      + 'cap written for one project would not be the cap in force.',
  },
];

// PROJECT_SCOPED_BY_NATURE are the settings the evidence places in the project's
// own file — settings that are part of how one project builds.
//
// They are stated for the same reason the machine-wide ones are: a surface that
// knew only what to refuse would leave everything else looking equally uncertain,
// and these are the ones the product positively says travel with the project.
const PROJECT_SCOPED_BY_NATURE: ReachRule[] = [
  {
    prefix: ['plugins', 'providers'],
    reach: 'project',
    evidence: 'A provider binding is part of how this project builds, so it travels with the '
      + 'project.',
  },
  {
    prefix: ['plugins', 'governance'],
    reach: 'project',
    evidence: 'A governance attachment shapes this project\'s build, so it travels with the '
      + 'project.',
  },
  {
    prefix: ['plugins', 'linter'],
    reach: 'project',
    evidence: 'A linter attachment shapes this project\'s build, so it travels with the '
      + 'project.',
  },
  {
    prefix: ['plugins', 'importer'],
    reach: 'project',
    evidence: 'An importer attachment shapes this project\'s build, so it travels with the '
      + 'project.',
  },
];

// configScope reports how far a control's setting reaches.
//
// The longest matching prefix wins, so a rule about a nested setting can be
// stated without the rule about its container having to exclude it. A setting no
// rule reaches is unclassified — which is an answer, not a failure to produce
// one.
export function configScope(control: ConfigControl): ConfigScope {
  const path = control.path;
  let best: ReachRule | null = null;
  for (const rule of [...MACHINE_WIDE_BY_NATURE, ...PROJECT_SCOPED_BY_NATURE]) {
    if (!matches(rule.prefix, path)) { continue; }
    if (!best || rule.prefix.length > best.prefix.length) { best = rule; }
  }
  if (!best) { return { reach: 'unclassified', evidence: '' }; }
  return { reach: best.reach, evidence: best.evidence };
}

// matches reports whether prefix addresses path or one of its ancestors.
//
// The comparison is segment by segment rather than on the dotted spelling, so a
// setting whose name begins with another setting's name is not swept in by a
// string prefix that happens to align.
function matches(prefix: string[], path: string[]): boolean {
  if (prefix.length > path.length) { return false; }
  return prefix.every((segment, i) => segment === path[i]);
}

// 🔴 THIS CLASSIFICATION ANSWERS ABOUT A SETTING, NEVER ABOUT AN OPERATION, and
// the distinction is worth stating because the two questions read alike and have
// different answers.
//
// What is classified here is a setting's own reach: whether the value a reader
// edits carries across the machine or belongs to one project's build. Which file
// an operation WRITES is a different question, and the compiler answers it from
// the operation's own nature — a registration is machine-wide tooling and
// defaults to the global file, and yet the compiler accepts being told to write
// the project's file instead. So the registry settings are machine-wide here AND
// a registration may be directed at either file, both at once and without
// contradiction.
//
// A surface deciding whether to offer a destination therefore asks the operation,
// not this module. Reading a setting's reach as an answer to that question would
// withhold a destination the compiler accepts.
