# Aggrega VS Code extension

Language support for Aggrega YAML — validation, navigation, hover, and completion backed by the `aggrega` daemon (`aggrega serve`).

## Prerequisites

- Visual Studio Code 1.85 or newer.
- `aggrega` binary on `PATH`, or its absolute path set in the `aggrega.server.binaryPath` setting.
- A workspace containing a `.aggrega-config.yaml` file (somewhere in the parent chain of the workspace root). The file's contents are optional; its presence anchors workspace-root discovery.

## Features

- **Selected Release** — a status-bar indicator and a **Release** row at the top of the Operations panel, each naming the one Release the editor is working on. Everything that acts on a Release — validation, the topology graph, build, preview build, pull and acquire inputs — acts on that one, so the Problems panel and the graph always describe the same Release. See [Selecting a Release](#selecting-a-release).
- **Diagnostics** — YAML and schema validation surfaced inline as you edit, checked against the selected Release.
- **Go to Definition** — jump from `extends`, `implements`, `provider`, `uses`, `recipe`, `aggregate`, `manifest` references to their target entity files.
- **Find References / Implementations** — list every reference to or implementation of an entity.
- **Hover** — kind-aware summaries for catalog and release entities.
- **Completion** — context-aware suggestions for entity kinds, API versions, schema keywords, primitives, label values, providers, paths, and intra-document component keys.
- **Aggrega activity-bar view** — four panels in reading order: **Operations**, **Registries**, **Catalog** and **Plugins**, each carrying the buttons for its own area. The Operations panel is headed by two rows naming what the editor is acting on, **Workspace** and **Release**, each opening its own picker. The Workspace row names the folder the language server anchored to, which is what the Release list is computed against — so when it differs from the folder you opened, you can see why the offered Releases are the ones they are. Below those rows the compiler operations are grouped by what you came to do: **Build** (validate, lint, build, preview build, show topology graph), **Dependencies** (pull, acquire inputs), **Author** (draft entity, import, inspect), **Publish** (push, sign, deprecate) and **Configuration** (show effective config, cache). The Publish group is set apart because its operations change what everyone resolving that catalog gets, while the rest act on this machine. Alongside Operations sit a **Registries** panel listing every registry the effective configuration declares, a **Catalog** panel listing the entities in the open workspace, and a **Plugins** panel listing the embedded and configured Wasm plugins. Validate, build, preview build and lint report into the Problems panel; the command-line-backed operations stream their output to the Aggrega output channel.
- **Two shapes for the Operations panel** — `aggrega.operations.layout` chooses between `grouped`, where every heading and every operation is visible at once, and `collapsible`, where each group is a row you open. Both carry the same groups with the same operations; the setting changes how a group is drawn, never which operations exist. Changing it redraws the open panel and restarts nothing.
- **Every operation asks for what it needs before it runs** — an operation is on the panel only when pressing it can succeed. Push, sign and deprecate each ask for their subject first: push offers the entities the open workspace declares, while sign and deprecate ask for a reference to an artifact already in a registry, because that is what those two amend. Deprecate also asks for a severity and a reason, which the command requires and cannot prompt for from inside the editor. Acquire inputs runs against the selected Release, as pull does.
- **Registries panel detail** — each row names the registry's host, its alias where one is configured, which registry is the default, whether signatures are required for artifacts pulled from it, and whether a credential for that host is present. Reading the list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it.
- **Topology graph** — renders the selected Release's compiled IR as an interactive graph: boundary and subsystem containers, provenance-styled edges, pan and zoom, click-a-node to select it and double-click to open its source file. Selecting a node opens a panel listing what is attached to it: each attachment's Feature and resolved version, the slot it fills, where it came from, the labels it declares, and the values its author wrote. Below that, under **May attach**, the panel lists the Features whose declared applicability the labels on that node satisfy, each named with its kind and either the workspace file that declares it or the configured catalog it was resolved from. That list is what those Features declare they apply to, not a decision that attaching one will build — and when it is empty it says that no Feature's declared applicability matches those labels, which is a narrower statement than nothing being attachable. A request the language server could not answer says so in place of the list rather than leaving it blank. A value the compiler reports as sensitive is removed before the graph is handed to the view at all, so it is not in the view to be shown — the panel names the field and says why it is withheld, and an attachment whose sensitivity marking is in a shape the panel does not recognise withholds every value rather than guessing at it. `aggrega.graph.showSensitiveValues` turns the withholding off for an author who needs to read back what they wrote, and says on the settings page what that displays. Nodes are laid out in deployment-wave order, so a boundary that declares a `syncWave:` appears ahead of the boundaries that wait on it. Hovering a node names its component and resolved version, its labels, its declared wave, and the catalog entity's own metadata — license, repository, home, keywords and maintainers — showing only the fields the entity actually declares. An open graph re-renders itself when the language server republishes diagnostics, so it follows edits without being reopened. Layout is computed in the view; the compiler ships topology, never coordinates.
- **Plugins panel detail** — each row names the plugin, its socket type and version, and its readiness where the plugin carries one. A plugin the compiler could not resolve or describe is marked and keeps its own row, with the compiler's message in the tooltip, so it is never mistaken for one that is working. The tooltip also names the configuration key an attachment came from, its capabilities, its input kinds, its boundary and its exports — showing only what the listing actually reports.
- **Catalog panel detail** — the entities in the open workspace, grouped under a heading per kind, each row naming the entity and the labels it declares, with its apiVersion, its description and its source file in the tooltip. Clicking a row opens that file. A document declaring no `kind:` or no `metadata.name:` is not listed, which is what keeps the panel an index of entities rather than of files. The list is the language server's own answer, so it names the same entities the compiler reads — unsaved editor buffers included, ahead of the bytes on disk — and it is presented in the order the server sent rather than re-sorted here.
- **Published-catalog search** — search the configured registries for catalog entities and copy a reference to paste into an Aggregate. The search is narrowed from a single list where each facet shows its current value: free text matched against name and description, one or more entity kinds, a label selector (category is a label), one or more plugin capabilities, a plugin socket, and a cap on how many results come back. A facet left alone narrows nothing. Searching reads the local index written by `aggrega registry update` and contacts no network, so a registry whose index has not been built yet reports the compiler's own message naming the step to run.

## Selecting a Release

Most of what the extension does is scoped to a Release: which components resolve, which
lockfile pins apply, and which findings a document draws. The extension therefore works on
**one selected Release at a time**, and it shows you which one in the status bar, next to a
rocket icon.

A Release you pick is remembered by that editor window. When the language server connects, a
remembered choice is checked against what the workspace still offers and restored when it is
still there; when it has gone, the editor tells you so and falls back to what your workspace
implies, which is where the selection starts when you have chosen nothing in this window. That
answer comes from, in order of precedence:

1. `build.authoring_release` in `.aggrega-config.yaml`, the committed setting a whole team shares.
2. `.aggrega/active-release`, a local marker file that is not committed.
3. The single Release in the workspace, when there is exactly one.

**Click either indicator to select a different Release** (or run **Aggrega: Select Release…**
from the Command Palette). The change takes effect immediately — nothing restarts, and every
open YAML file is re-checked against the Release you just picked. Being remembered is local to
the editor window: choosing **writes nothing into your workspace**.

The Releases on offer are the ones inside the folder the language server anchored to, named
relative to it, because that is the form it accepts. Where a Release cannot be offered, the
editor says how many and where they sit rather than leaving them out silently.

When you want a choice recorded in the workspace itself — so a fresh checkout starts on it —
two commands do that, and neither changes what you are working on right now:

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
- **Aggrega: Validate active file / Build / Preview build / Lint** — run the corresponding compiler operation through the language server. Build, preview build and pull act on the selected Release rather than asking each time. Build compiles the selected Release with every gate on and writes the artifacts it renders into the workspace's `dist/` directory; preview build runs the same compile and reports what it would have written, leaving the output directory untouched. Both put the findings that carry a document position in the Problems panel, tagged with the layer that raised them, and write the advisories that name no position — a withdrawn pin, an unresolvable parent — to the Aggrega output channel along with the artifact list. Lint checks publishing conventions and places each finding in the Problems panel, tagged with the rule that produced it, so clicking one opens the entity it concerns; a finding the linter located to a file but not to a line sits at the top of that file rather than at a guessed position, and the full human report goes to the Aggrega output channel as well.
- **Aggrega: Pull / Acquire inputs** — run the `aggrega` binary against the selected Release and stream its output to the Aggrega output channel. Pull fetches the remote dependencies the workspace declares; acquire inputs pins the external inputs the Release's render consumes and records them in its lockfile, so a later build serves them from the local store.
- **Aggrega: Draft entity…** — ask the language server for a starter document for an entity kind and open it in a new unsaved tab. Nothing is written to disk: the draft is yours to edit, save or discard. A kind the compiler does not recognise comes back with the compiler's own message naming the kinds it does.
- **Aggrega: Inspect…** — choose an entity the open workspace declares and see what it resolves to, opened as a new tab.
- **Aggrega: Import… / Cache…** — run the `aggrega` binary and stream its output to the Aggrega output channel. Import asks for the source first; cache asks which subcommand to run.
- **Aggrega: Push… / Sign… / Deprecate…** — the operations that change what other people resolve. Push asks which of the open workspace's entities to publish, then bundles and publishes it to a configured registry. Sign and deprecate ask for a reference to an artifact already published, because both amend published bytes rather than the workspace: sign attaches a signature, deprecate attaches a signed deprecation marker and asks for the severity — `warning`, `error` or `retracted` — and the reason it records. All three run the `aggrega` binary and stream their output to the Aggrega output channel.
- **Aggrega: Show effective config** — ask the language server for the configuration it resolved and the layer each setting came from, opened as a new tab.
- **Aggrega: Show topology graph** — open the topology graph for the selected Release.
- **Aggrega: Search published catalog** — open the filter list, narrow the search by kind, labels, capability, plugin socket or a result cap, then run it and copy a matched reference. Each facet is editable in any order and returns to the list, so the whole filter is readable before it runs. A search that matched nothing names the filter it ran, which is a different answer from an index that could not be read at all — the second reports the compiler's own message and the full text goes to the Aggrega output channel, together with the freshness line naming each registry searched and when its index was last updated.
- **Aggrega: Refresh plugins** — reload the Plugins panel.
- **Aggrega: Refresh registries** — re-read the configured registries. This contacts no registry, so it is cheap to repeat.
- **Aggrega: Refresh workspace catalog** — re-ask the language server which entities the open workspace declares. This reads the workspace the server already has open and contacts no registry, so it is cheap to repeat. It sits on the Catalog panel, beside the published-catalog search.

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
