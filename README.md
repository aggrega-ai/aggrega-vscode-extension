# Aggrega VS Code extension

Language support for Aggrega YAML — validation, navigation, hover, and completion backed by the `aggrega` daemon (`aggrega serve`).

## Prerequisites

- Visual Studio Code 1.85 or newer.
- `aggrega` binary on `PATH`, or its absolute path set in the `aggrega.server.binaryPath` setting.
- A workspace containing a `.aggrega-config.yaml` file (somewhere in the parent chain of the workspace root). The file's contents are optional; its presence anchors workspace-root discovery.

## Features

- **Selected Release** — a status-bar indicator naming the one Release the editor is working on. Everything that acts on a Release — validation, the topology graph, build, preview build and pull — acts on that one, so the Problems panel and the graph always describe the same Release. See [Selecting a Release](#selecting-a-release).
- **Diagnostics** — YAML and schema validation surfaced inline as you edit, checked against the selected Release.
- **Go to Definition** — jump from `extends`, `implements`, `provider`, `uses`, `recipe`, `aggregate`, `manifest` references to their target entity files.
- **Find References / Implementations** — list every reference to or implementation of an entity.
- **Hover** — kind-aware summaries for catalog and release entities.
- **Completion** — context-aware suggestions for entity kinds, API versions, schema keywords, primitives, label values, providers, paths, and intra-document component keys.
- **Aggrega activity-bar view** — an **Operations** panel with one-click compiler operations (validate, build, preview build, lint, pull, push, import, cache), a **Plugins** panel listing the embedded and configured Wasm plugins, a **Registries** panel listing every registry the effective configuration declares, and a **Workspace catalog** panel listing the entities in the open workspace. Validate, build, preview build and lint report into the Problems panel; pull, push, import and cache stream their output to the Aggrega output channel.
- **Registries panel detail** — each row names the registry's host, its alias where one is configured, which registry is the default, whether signatures are required for artifacts pulled from it, and whether a credential for that host is present. Reading the list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it.
- **Topology graph** — renders the selected Release's compiled IR as an interactive graph: boundary and subsystem containers, provenance-styled edges, pan and zoom, click-a-node to select it and double-click to open its source file. Selecting a node opens a panel listing what is attached to it: each attachment's Feature and resolved version, the slot it fills, where it came from, the labels it declares, and the values its author wrote. A value the compiler reports as sensitive is removed before the graph is handed to the view at all, so it is not in the view to be shown — the panel names the field and says why it is withheld, and an attachment whose sensitivity marking is in a shape the panel does not recognise withholds every value rather than guessing at it. `aggrega.graph.showSensitiveValues` turns the withholding off for an author who needs to read back what they wrote, and says on the settings page what that displays. Nodes are laid out in deployment-wave order, so a boundary that declares a `syncWave:` appears ahead of the boundaries that wait on it. Hovering a node names its component and resolved version, its labels, its declared wave, and the catalog entity's own metadata — license, repository, home, keywords and maintainers — showing only the fields the entity actually declares. An open graph re-renders itself when the language server republishes diagnostics, so it follows edits without being reopened. Layout is computed in the view; the compiler ships topology, never coordinates.
- **Plugins panel detail** — each row names the plugin, its socket type and version, and its readiness where the plugin carries one. A plugin the compiler could not resolve or describe is marked and keeps its own row, with the compiler's message in the tooltip, so it is never mistaken for one that is working. The tooltip also names the configuration key an attachment came from, its capabilities, its input kinds, its boundary and its exports — showing only what the listing actually reports.
- **Workspace catalog panel detail** — the entities in the open workspace, grouped under a heading per kind, each row naming the entity and the labels it declares, with its apiVersion, its description and its source file in the tooltip. Clicking a row opens that file. A document declaring no `kind:` or no `metadata.name:` is not listed, which is what keeps the panel an index of entities rather than of files. The list is the language server's own answer, so it names the same entities the compiler reads — unsaved editor buffers included, ahead of the bytes on disk — and it is presented in the order the server sent rather than re-sorted here.
- **Published-catalog search** — search the configured registries for catalog entities and copy a reference to paste into an Aggregate. The search is narrowed from a single list where each facet shows its current value: free text matched against name and description, one or more entity kinds, a label selector (category is a label), one or more plugin capabilities, a plugin socket, and a cap on how many results come back. A facet left alone narrows nothing. Searching reads the local index written by `aggrega registry update` and contacts no network, so a registry whose index has not been built yet reports the compiler's own message naming the step to run.

## Selecting a Release

Most of what the extension does is scoped to a Release: which components resolve, which
lockfile pins apply, and which findings a document draws. The extension therefore works on
**one selected Release at a time**, and it shows you which one in the status bar, next to a
rocket icon.

The selection starts from what your workspace already implies. When the language server
connects, the extension asks it which Release the workspace points at and starts there. That
answer comes from, in order of precedence:

1. `build.authoring_release` in `.aggrega-config.yaml`, the committed setting a whole team shares.
2. `.aggrega/active-release`, a local marker file that is not committed.
3. The single Release in the workspace, when there is exactly one.

**Click the indicator to select a different Release** (or run **Aggrega: Select Release…** from
the Command Palette). The change takes effect immediately — nothing restarts, and every open
YAML file is re-checked against the Release you just picked. Selecting is a per-session
choice: it does not write to your workspace.

When you want a choice to persist, two commands record one, and neither of them changes what
you are working on right now:

- **Aggrega: Set the selected Release as this workspace's default** writes the currently
  selected Release into `.aggrega/active-release`. That file is local to your checkout, so it
  is the right place for a personal default.
- **Aggrega: Set authoring_release in .aggrega-config.yaml…** opens the configuration file so
  you can set `build.authoring_release`. That setting is committed and shared, and it outranks
  the marker file.

If the workspace offers no Release — none configured, no marker, and not exactly one file to
fall back on — the indicator reads **Release: none** and its tooltip says what was looked for.
The full account is written to the Aggrega output channel. Validation still runs in that
state: you get the findings a document answers on its own — whether it parses, and whether its
own shape is admissible — and the checks that need a Release are skipped until you select one.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `aggrega.server.binaryPath` | `aggrega` | Path to the `aggrega` binary. |
| `aggrega.server.autoRevalidate` | `false` | Silent revalidate on cache-miss instead of a notification. |
| `aggrega.server.debounceMs` | `300` | Debounce window for proactive validate-on-change. |
| `aggrega.server.respawnAttempts` | `5` | Max daemon respawn attempts before the stopped-responding notification. |
| `aggrega.server.respawnWindowSeconds` | `180` | Sliding window for counting respawn attempts. |
| `aggrega.server.buildOnInspect` | `false` | Run the build's analysis while inspecting a graph, so the findings `aggrega build` reports also appear as editor problems. Inspecting costs more when it runs; nothing is written to disk. |
| `aggrega.graph.showSensitiveValues` | `false` | Show the values a Feature declares sensitive in the topology graph, displaying a by-value credential in the clear. Left off, those values are removed before the graph is drawn. |

## Commands

- **Aggrega: Select Release…** — choose the Release the editor works on. Takes effect at once and re-checks the open files against it; nothing restarts. Also reachable by clicking the Release indicator in the status bar. See [Selecting a Release](#selecting-a-release).
- **Aggrega: Set the selected Release as this workspace's default** — record the selected Release in `.aggrega/active-release`, so a later session starts on it. Local to your checkout, and it does not change the current selection.
- **Aggrega: Set authoring_release in .aggrega-config.yaml…** — open the configuration file to set `build.authoring_release`, the committed default a team shares. It outranks the marker file.
- **Aggrega: Restart language server** — terminates the current daemon and spawns a fresh one. Resets the respawn-attempt counter.
- **Aggrega: Toggle the build's analysis while inspecting** — flips the `aggrega.server.buildOnInspect` setting in place, so the settings UI always agrees with it, and offers the restart that applies it — the language server reads the setting when it starts. Also reachable from the status-bar quick-action menu, which shows whether the setting is currently on. Findings arrive tagged with the layer that raised them, so the build's analysis groups apart from validation in the Problems panel and clears independently of it.
- **Aggrega: Validate active file / Build / Preview build / Lint / Pull / Push / Import… / Cache…** — run the corresponding compiler operation. Validate, build and preview build use the language server. Build, preview build and pull act on the selected Release rather than asking each time. Build compiles the selected Release with every gate on and writes the artifacts it renders into the workspace's `dist/` directory; preview build runs the same compile and reports what it would have written, leaving the output directory untouched. Both put the findings that carry a document position in the Problems panel, tagged with the layer that raised them, and write the advisories that name no position — a withdrawn pin, an unresolvable parent — to the Aggrega output channel along with the artifact list. Lint checks publishing conventions and places each finding in the Problems panel, tagged with the rule that produced it, so clicking one opens the entity it concerns; a finding the linter located to a file but not to a line sits at the top of that file rather than at a guessed position, and the full human report goes to the Aggrega output channel as well. Pull, push, import and cache run the `aggrega` binary and stream their output to that channel.
- **Aggrega: Show topology graph** — open the topology graph for the selected Release.
- **Aggrega: Search published catalog** — open the filter list, narrow the search by kind, labels, capability, plugin socket or a result cap, then run it and copy a matched reference. Each facet is editable in any order and returns to the list, so the whole filter is readable before it runs. A search that matched nothing names the filter it ran, which is a different answer from an index that could not be read at all — the second reports the compiler's own message and the full text goes to the Aggrega output channel, together with the freshness line naming each registry searched and when its index was last updated.
- **Aggrega: Refresh plugins** — reload the Plugins panel.
- **Aggrega: Refresh registries** — re-read the configured registries. This contacts no registry, so it is cheap to repeat.
- **Aggrega: Refresh workspace catalog** — re-ask the language server which entities the open workspace declares. This reads the workspace the server already has open and contacts no registry, so it is cheap to repeat.

## Build

```bash
npm install
npm run compile
npm test
```

The cross-language workspace-discovery parity test reads its shared cases from
the `aggrega-cli` repository, which must be checked out as a sibling directory
beside this one (`../aggrega-cli`). `aggrega-cli` owns the compiler and the
`aggrega` daemon this extension drives, and the parity test proves the
extension's workspace discovery matches the daemon's. When `aggrega-cli` is not
present (a standalone clone of just this repo), the parity test skips with a
notice and the rest of the suite runs normally.

## Lifecycle

The extension manages the daemon process's full lifecycle. On shutdown — when the editor closes, when the user restarts the language server, or when a configuration change requires a fresh daemon — the extension first asks the daemon to exit cooperatively. If the daemon does not respond within a short grace window, the extension falls back to OS-level termination. The semantics are identical across POSIX and Windows hosts. See `src/daemon.ts` for implementation detail.

## License

Apache-2.0
