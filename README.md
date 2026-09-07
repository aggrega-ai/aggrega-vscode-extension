# Aggrega VS Code extension

Language support for Aggrega YAML — validation, navigation, hover, and completion backed by the `aggrega` daemon (`aggrega serve`).

## Prerequisites

- Visual Studio Code 1.85 or newer.
- `aggrega` binary on `PATH`, or its absolute path set in the `aggrega.server.binaryPath` setting.
- A folder Aggrega recognises as a workspace root, at or above the folder you open. Discovery climbs from the opened folder looking for a `.aggrega-config.yaml` carrying a top-level `workspace:` block, an `.aggrega` directory, or an `aggregate`, `release` or `manifest` YAML file. A `.aggrega-config.yaml` **without** a `workspace:` block does not anchor one — settings can live in a configuration file anywhere, and a bare one must not turn every directory above it into a workspace root.

You do not have to arrange any of that by hand: see [The welcome panel](#the-welcome-panel).

## The welcome panel

**Welcome to Aggrega!** opens in its own editor tab. It says what Aggrega is, then lists what the
extension needs in the workspace you have open:

1. **A workspace Aggrega recognises** — the discovery described under [Prerequisites](#prerequisites).
2. **A compiler this editor can run** — the `aggrega` binary named in `aggrega.server.binaryPath`.
3. **A Release to act on** — building, previewing and the topology graph each act on one Release.
4. **A registry to resolve from** — pulling dependencies and searching the published catalog resolve
   against the registries your configuration names.

Each step explains what the condition is for and how the editor reaches it, so the panel is somewhere
to read about the product rather than only a checklist.

**Each step offers two ways through, and one of them is always "I already have this."** You can
create a workspace configuration or point the editor at a folder that already carries one; use the
compiler on your `PATH` or select a build you have somewhere else; draft a Release or choose one of
yours; seed the official hub or name your own registry. Nothing here is a dead end that hands you a
file dialog and leaves the step outstanding.

**A step you have already met is checked off and asks you nothing.** The panel reads what is true
rather than putting the same questions to everybody, so if you built your configuration from the
command line and then opened the editor, every step arrives ticked.

**A step's mark follows its condition in both directions.** It is marked met when the condition
becomes true, and marked outstanding again if the condition later lapses — a compiler that stops
answering, a Release that is deselected. The panel reads what is true each time it refreshes rather
than remembering what was once true, so it never reports something you have since lost. Where a lapse
matters it is also reported where you are already looking: the status bar carries a compiler that has
stopped answering, and the **Workspace** and **Release** rows at the top of the Operations panel name
the current selection.

The panel is a panel rather than a dialog on purpose: every step asks you to point at something in
your own workspace, and a dialog would be covering the files that hold the answers. It sits in the
editor area rather than in the Aggrega view, so it costs the sidebar no space and can say what the
product is — which a narrow column had no room for. It is Aggrega's own tab, reached and closed on
its own terms, and it offers no route into any other welcome page.

**Aggrega: Stop opening the welcome panel** writes `aggrega.getStarted.show` to your own settings —
never into the repository, so your choice does not travel to whoever else opens it. It stops the
panel opening by itself rather than putting it out of reach. It is not a one-way door either:
**Aggrega: Get started** in the Command Palette turns it back on and opens it.

## Features

- **Welcome panel** — Aggrega's own panel in its own editor tab, saying what Aggrega is and then listing what the extension needs in this workspace, marking what it already has. Each step offers both a way to create the thing and a way to point at one you already have, explains the condition, and a step already met asks you nothing. A step marked met goes back to outstanding if its condition lapses. It costs the Aggrega view no space. See [The welcome panel](#the-welcome-panel).
- **Language server state** — a status-bar indicator on the left, beside the Release indicator, reading **running**, **starting**, or **not running** in red. It is the one surface that is there whatever the compiler is doing, so it is where you find out that nothing is running rather than being left to infer it from surfaces that have gone quiet — and its tooltip says which of the two reasons applies: no folder here is one Aggrega recognises, or there is one and the server is not attached to it. Clicking it offers **Start** when nothing is running and **Restart** when something is, and does the one you choose. See [When the language server is not running](#when-the-language-server-is-not-running).
- **Selected Release** — a status-bar indicator and a **Release** row at the top of the Operations panel, each naming the one Release the editor is working on. Everything that acts on a Release — validation, the topology graph, build, preview build, pull and acquire inputs — acts on that one, so the Problems panel and the graph always describe the same Release. See [Selecting a Release](#selecting-a-release).
- **Diagnostics** — YAML and schema validation surfaced inline as you edit, checked against the selected Release.
- **Go to Definition** — jump from `extends`, `implements`, `provider`, `uses`, `recipe`, `aggregate`, `manifest` references to their target entity files.
- **Find References / Implementations** — list every reference to or implementation of an entity.
- **Hover** — kind-aware summaries for catalog and release entities.
- **Completion** — context-aware suggestions for entity kinds, API versions, schema keywords, primitives, label values, providers, paths, and intra-document component keys.
- **Aggrega activity-bar view** — four panels in reading order: **Operations**, **Registries**, **Catalog** and **Plugins**, each carrying the buttons for its own area. The Operations panel is headed by two rows naming what the editor is acting on, **Workspace** and **Release**, each opening its own picker. The Workspace row names the folder the language server anchored to, which is what the Release list is computed against — so when it differs from the folder you opened, you can see why the offered Releases are the ones they are. Below those rows the compiler operations are grouped by what you came to do: **Build** (validate, lint, build, preview build, show topology graph), **Dependencies** (pull, acquire inputs), **Author** (draft entity, import, inspect), **Publish** (push, sign, deprecate) and **Configuration** (show effective config, cache). The Publish group is set apart because its operations change what everyone resolving that catalog gets, while the rest act on this machine. Alongside Operations sit a **Registries** panel listing every registry the effective configuration declares, a **Catalog** panel listing the entities the workspace can see, and a **Plugins** panel listing the embedded and configured Wasm plugins. Validate, build, preview build and lint report into the Problems panel; the command-line-backed operations stream their output to the Aggrega output channel.
- **One settings surface, reached from a cog** — the Operations panel carries a cog at its top right, and it opens the editor's own settings narrowed to this extension. There is no second settings page of the extension's own, so a preference has one place it lives and one place it is written. Every preference is yours rather than the project's; see [Settings](#settings).
- **Two shapes for the Operations panel** — `aggrega.operations.layout` chooses between `buttons`, the default, where each group is a single row of buttons so every operation is a labelled control you can see and press without opening anything, and `sections`, where each group is a section you open and the panel shows as much as you keep open. Both carry the same groups with the same operations, in the same order; the setting changes how a group is drawn, never which operations exist. In both shapes the **Workspace** and **Release** rows sit above every group, so closing a section never takes away the two facts that say what an operation would apply to. Changing the setting redraws the open panel and restarts nothing. A narrow panel wraps a long row onto a second line rather than truncating a label or hiding operations behind a sideways scroll.
- **Every operation asks for what it needs before it runs** — an operation the panel can see is not runnable stays in place, greyed, and says why: hovering it names what is missing, and a screen reader announces it as unavailable with the same reason. It is not removed, because in a row of buttons removing one moves the others under your pointer, and a press then lands on something other than what was there a moment ago. Two conditions grey a control: the operations that act on a Release need one selected, and the ones that run the `aggrega` binary need an anchored workspace folder to run in. An operation that needs only the language server is not greyed when the server is down — it reports the compiler's own message when pressed, and the status bar is where that state is named. Push, sign and deprecate each ask for their subject first: push offers the entities the open workspace declares, while sign and deprecate ask for a reference to an artifact already in a registry, because that is what those two amend. Deprecate also asks for a severity and a reason, which the command requires and cannot prompt for from inside the editor. Acquire inputs runs against the selected Release, as pull does.
- **Registries panel detail** — each row names the registry's host, its alias where one is configured, which registry is the default, whether signatures are required for artifacts pulled from it, and whether a credential for that host is present. Reading the list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it. The panel's own operations sit in its title bar — add a registry, and build the searchable index for every configured registry — while the operations that act on one registry are on that registry's row: build the index for it alone, remove its stored credential, and remove the registry. Removing a registry and removing a credential each ask you to confirm first, and each says what the change reaches: a registry entry is written to the configuration shared across every workspace on this machine, so dropping one changes what every project resolving through it gets, while a credential is deleted from the shared credential store and the registry entry is left in place. Building the index is the one operation here that reaches the network, so it shows progress and can be stopped; the others do not contact a registry. Signing in to a registry is not offered from the panel, because the command reads a password from a terminal and there is none behind a button — run it from a terminal and press refresh.
- **Topology graph** — renders the selected Release's compiled IR as an interactive graph: boundary and subsystem containers, provenance-styled edges, pan and zoom, click-a-node to select it and double-click to open its source file. Each container's title names its kind as well as its grouping, so the outer box and the inner one read apart even in a workspace that declares neither — where both would otherwise carry the same name. A node's box is sized by measuring the text it draws, both the node's name and the component beneath it, so neither runs past its border however long the component name is. A legend at the lower left names each grouping by the document that declares it — a boundary by the Release, a subsystem by the Aggregate — and the colour bar down a node's leading edge, and says what that colour does not mean: the colours are assigned as each graph is drawn, so they group nodes by type within one graph and the same colour in another graph is not the same type. Selecting a node opens a panel listing what is attached to it: each attachment's Feature and resolved version, the slot it fills, where it came from, the labels it declares, and the values its author wrote. Below that, under **May attach**, the panel lists the Features whose declared applicability the labels on that node satisfy, each named with its kind and either the workspace file that declares it or the configured catalog it was resolved from. That list is what those Features declare they apply to, not a decision that attaching one will build — and when it is empty it says that no Feature's declared applicability matches those labels, which is a narrower statement than nothing being attachable. A request the language server could not answer says so in place of the list rather than leaving it blank. Each row carries an **Attach** control that commits it: the compiler is asked which document declares the selected component and where inside that document such an attachment belongs, and the entry is written there through the editor — so it joins the undo history, lands on the buffer you are looking at rather than on the last version saved to disk, and leaves the comments and formatting around it as you wrote them. Nothing is saved on your behalf; the edit is a change like any other, and the compiler re-validates and redraws the graph as it would after any edit. The attachment is named after the Feature, and attaching a Feature already attached under that name is refused rather than written twice. A component declared inside a subsystem attaches by the same press as one declared at the top level, and for the same reason both work: the graph identifies a component by its position in the compiled topology, that position does not say which keys the component's author wrote, and so the extension asks rather than reconstructing — the answer names the document and the path to the block inside it, and both are carried into the edit as they arrived. Where there is no such place to name — an id the graph does not carry, a node it records no document for, or a component whose own block cannot be named in the document it was authored in — what the panel shows is the reason the compiler gave, not a wording of this extension's own. A value the compiler reports as sensitive is removed before the graph is handed to the view at all, so it is not in the view to be shown — the panel names the field and says why it is withheld, and an attachment whose sensitivity marking is in a shape the panel does not recognise withholds every value rather than guessing at it. `aggrega.graph.showSensitiveValues` turns the withholding off for an author who needs to read back what they wrote, and says on the settings page what that displays. Nodes are laid out in deployment-wave order, so a boundary that declares a `syncWave:` appears ahead of the boundaries that wait on it. Hovering a node names its component and resolved version, its labels, its declared wave, and the catalog entity's own metadata — license, repository, home, keywords and maintainers — showing only the fields the entity actually declares. An open graph re-renders itself when the language server republishes diagnostics, so it follows edits without being reopened. Layout is computed in the view; the compiler ships topology, never coordinates.
- **Plugins panel detail** — each row names the plugin, its type and version, and its readiness where the plugin carries one. A plugin the compiler could not resolve or describe is marked and keeps its own row, with the compiler's message in the tooltip, so it is never mistaken for one that is working. The tooltip also names the configuration key an attachment came from, its capabilities, its input kinds, its boundary and its exports — showing only what the listing actually reports. The panel's own operations sit in its title bar — add a plugin, and generate Plugin catalog entities. Adding asks which type of plugin, then the one further answer that type requires — the capability a `provider` binding serves, or the role a `governance` attachment is bound at — and last the name to search the configured registry for, which must resolve to exactly one plugin of that type; the attachment is written to this project's workspace configuration. Adding is the one operation here that reaches the network, since it searches the registry, so it shows progress and can be stopped. Generating catalog entities asks whether to cover every plugin built into the compiler or one plugin artifact on this machine, then for the authored overlay to merge and the directory to write under, and confirms before writing: each entity is written at a path derived from its plugin's type, name and version, so an entity already there for that same plugin and version is replaced. Removing a plugin is on that plugin's row. It asks you to confirm first and says which configuration file it writes, because that depends on the plugin's type — a `cli` plugin is removed from the configuration shared across every workspace on this machine, every other type from this project's own — and it operates on the configuration text alone, so nothing else on this machine is removed. Removal is offered only on a configured plugin the compiler answered for: a plugin built into the compiler is no configuration entry at all, and an attachment nothing could resolve or describe arrives carrying no type, which the removal needs alongside the reference — so on those rows it is withheld rather than offered as a control that could only report a missing argument. Adding a `cli` plugin is not offered from the panel, because installing one confirms its declared capabilities at a terminal and there is none behind a button — run it from a terminal and press refresh. Syncing a plugin entity's machine-owned records is not offered either: it takes the entity file and the `.wasm` artifact as two paths, and a row names neither.
- **Catalog panel detail** — the entities the workspace can see, grouped under a heading per kind, each row naming the entity and the labels it declares, with its apiVersion and its description in the tooltip. The rows come from two places and each says which. An entity declared by a document in the workspace carries that document's path in its tooltip, and clicking the row opens that file. An entity resolved from one of the catalog directories the `workspace:` block of your configuration names is marked as coming from there and carries no path: the workspace holds no file of its own for it, so the row names where it came from instead of offering a click with nowhere to go. A document declaring no `kind:` or no `metadata.name:` is not listed, which is what keeps the panel an index of entities rather than of files. The list is the language server's own answer, so it names the same entities the compiler reads — unsaved editor buffers included, ahead of the bytes on disk — and it is presented in the order the server sent rather than re-sorted here. Drafting a new entity sits in the panel's title bar, beside the published-catalog search and the refresh, because a new entity belongs where the entities are listed; it asks for the kind and opens the starter document in a tab without writing anything to disk. The operations that act on one entity are on that entity's row. Inspecting what an entity resolves to is offered on every row, and it is the one reachable without opening the row's menu: it is addressed by the entity's name, which every row carries, and it changes nothing. Validating the entity, checking its publishing conventions and publishing it are offered only on a row whose entity is declared by a document in this workspace. Those three commands each take the entity's path, and a row resolved from a configured catalog directory has no path in this workspace to give them, so those operations are withheld from it rather than offered as controls that could only report a missing argument. Publishing asks you to confirm first and says what the change reaches: the entity is bundled and pushed under its own declared version, and anyone pulling that version from that registry resolves what is published. Publishing is also the only one of these that changes anything beyond this machine; the two checks and the inspection write nothing and publish nothing. All four show progress and can be stopped.
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

## When the language server is not running

**Every command this extension contributes is there from the moment it starts, whether or not a
language server is running.** A command that only came into being once one had attached would be
missing from the palette in exactly the window that needs it most — the one where nothing is
running and you are looking for the way to start it.

**The status-bar indicator on the left is where you find out what is going on.** It reads
**running**, **starting**, or **not running** in red, and its tooltip says why: no folder in this
window is one Aggrega recognises, or there is one and the server is not attached to it. Clicking it
offers **Start** or **Restart** — whichever applies — and does it.

That indicator exists because a greyed-out command explains nothing. No editor surface shows a
tooltip on a disabled control, so a command you cannot run tells you only that you cannot run it.
The indicator is where the reason is written down, and it is also where you act on it.

**A command that cannot run is greyed rather than hidden.** **Aggrega: Open status bar menu** is
the one in that position: everything it offers is an action on a running language server. It comes
back the moment one is answering.

**A command that works without one is not greyed**, even though it concerns the server.
**Aggrega: Toggle the build's analysis while inspecting** writes a preference, and the server reads
that preference when it starts — so a stopped server is the most useful moment to set it, not a
reason to withhold it.

## What a command does when you run it

**Every command ends in something you can see.** Nothing succeeds silently, because a command that
says nothing looks exactly like one that never ran.

- **Choosing a Release** changes the two indicators and raises no notification. You can already see
  the result, and a notification for it would only teach you to dismiss notifications unread.
- **Validate and lint** report how many problems they found — **including when they found none.** A
  clean run says so, rather than leaving the Problems panel untouched and you wondering whether the
  command ran.
- **Draft entity, inspect and show effective config** end with the document open in a tab.
- **A long operation shows progress with a Cancel button.** That covers everything that reaches a
  registry, renders or resolves a Release, or walks the catalog: validate, lint, build, preview
  build, the topology graph, pull, acquire inputs, inspect, push, sign and deprecate. Drafting a
  document, importing a file, reporting the effective configuration and maintaining the caches are
  none of those, so they run without one. Cache maintenance additionally cannot be interrupted at
  all — the compiler carries no way to stop one part-way — so it is covered by the confirmation
  beforehand rather than by a button that could only stop the editor waiting.
- **Pressing Cancel stops the compiler**, not just the editor's waiting. Over the language server the
  extension sends the cancellation for the request it issued; over a subprocess it terminates the
  process. Cancellation of a compile takes effect at the compile's own phase boundaries, so a heavy
  phase already under way finishes first — which is why the message says the operation was stopped
  rather than that it stopped instantly. Either way the result is reported as **stopped**, never as a
  failure.
- **A cache operation that removes something asks first, and names the caches it will reach.**
  Emptying and pruning touch this workspace's own caches *and* the compiled-module and plugin-describe
  caches shared by every project on this machine, so those confirmations name both. Trimming touches
  only the shared compiled-module cache, so its confirmation names that one and says the workspace's
  own caches are untouched. Afterwards a message says what was removed; declining says that nothing
  was.
- **Push, sign and deprecate say what is now true for consumers** — that the version you published is
  what others pulling it now resolve, that the signature is there to be verified, that the
  deprecation marker is what resolvers now see.
- **A failure shows the compiler's own message, with a button beside it,** never a re-worded summary
  in place of it. The compiler's message usually names what to run or what to fix, and the **Show
  output** button takes you to the full text in the Aggrega output channel.

## Settings

**The cog at the top right of the Operations panel opens them** — it is the editor's own settings
page, narrowed to this extension, and it is the only settings surface there is. Everything below is
also reachable from the ordinary Settings editor and from your settings file.

**Every one of these settings is yours, not the project's.** Each describes your own environment or
your own reading habits — where your binary is, how long to wait before revalidating, how many
respawns to tolerate, whether to show values that would be readable over your shoulder, how you want
a panel drawn — so each is confined to your user settings, and to your remote settings when you are
working on a remote or containerised host. That last part matters for the binary path in particular:
the compiler runs on whichever host the extension does, so the path can differ between your laptop
and a container, and each host keeps its own value.

The consequence is deliberate: **a repository cannot pin any of these for whoever opens it.** Writing
one into a workspace `.vscode/settings.json` has no effect — the editor marks it as not applicable
there and goes on using your value. If you want a choice recorded in the workspace itself, the two
Release commands under [Selecting a Release](#selecting-a-release) are the ones that do that, and
they write `.aggrega/active-release` or `.aggrega-config.yaml` rather than an editor setting.

| Setting | Default | Purpose |
|---------|---------|---------|
| `aggrega.getStarted.show` | `true` | Whether the [welcome panel](#the-welcome-panel) opens with the editor. **Aggrega: Stop opening the welcome panel** turns it off, which stops it opening rather than removing it; **Aggrega: Get started** turns it back on and opens it. |
| `aggrega.server.binaryPath` | `aggrega` | Path to the `aggrega` binary. |
| `aggrega.server.autoRevalidate` | `false` | Silent revalidate on cache-miss instead of a notification. |
| `aggrega.server.debounceMs` | `300` | Debounce window for proactive validate-on-change. |
| `aggrega.server.respawnAttempts` | `5` | Max daemon respawn attempts before the stopped-responding notification. |
| `aggrega.server.respawnWindowSeconds` | `180` | Sliding window for counting respawn attempts. |
| `aggrega.server.restartGraceSeconds` | `5` | Grace window before the extension automatically restarts the daemon after a `binaryPath` change. The status bar shows a countdown; the quick-action menu offers Restart now and Cancel restart. |
| `aggrega.server.buildOnInspect` | `false` | Run the build's analysis while inspecting a graph, so the findings `aggrega build` reports also appear as editor problems. Inspecting costs more when it runs; nothing is written to disk. |
| `aggrega.graph.showSensitiveValues` | `false` | Show the values a Feature declares sensitive in the topology graph, displaying a by-value credential in the clear. Left off, those values are removed before the graph is drawn. |
| `aggrega.operations.layout` | `buttons` | How the Operations panel draws its groups — `buttons` makes each group a single row of buttons, `sections` makes each group a section you open. Same groups, same operations, same order either way. |
| `aggrega.notifications.toastDebounceMode` | `time` | How a repeated notification for the same error code is held back: `time` re-surfaces it after the throttle window, `session` suppresses repeats until the daemon restarts. |
| `aggrega.notifications.toastThrottleSeconds` | `300` | Seconds between re-surfacings of the same error code. Read only when `toastDebounceMode` is `time`. |

## Commands

- **Aggrega: Get started** — bring the [welcome panel](#the-welcome-panel) back after you have turned it off, and open it. It turns `aggrega.getStarted.show` back on, so turning the panel off is a choice you can undo rather than a door that locks behind you.
- **Aggrega: Stop opening the welcome panel** — stop the [welcome panel](#the-welcome-panel) opening with the editor, by turning `aggrega.getStarted.show` off in your own settings. This stops it arriving unasked rather than putting it out of reach: **Aggrega: Get started** brings it back.
- **Aggrega: Open settings** — open this extension's preferences. Also the cog at the top right of the Operations panel. It opens the editor's own settings page filtered to this extension, so there is one place a preference lives and one place it is written. Distinct from **Show effective config**, which reports what the *compiler* resolved for the workspace rather than what your editor is set to.
- **Aggrega: Select Release…** — choose the Release the editor works on. Takes effect at once and re-checks the open files against it; nothing restarts. Also reachable by clicking the Release indicator in the status bar. See [Selecting a Release](#selecting-a-release).
- **Aggrega: Set the selected Release as this workspace's default** — record the selected Release in `.aggrega/active-release`, so a later session starts on it. Local to your checkout, and it does not change the current selection.
- **Aggrega: Set authoring_release in .aggrega-config.yaml…** — open the configuration file to set `build.authoring_release`, the committed default a team shares. It outranks the marker file.
- **Aggrega: Start or restart the language server** — starts the language server where none is running, and where one is, terminates it and spawns a fresh one, resetting the respawn-attempt counter. It is never greyed: starting is what it does, so withholding it while nothing is running would withhold it in the one situation that needs it. Also reachable by clicking the language-server indicator in the status bar. Where no folder in the window is one Aggrega recognises, it says so rather than appearing to do nothing.
- **Aggrega: Toggle the build's analysis while inspecting** — flips the `aggrega.server.buildOnInspect` setting in place, so the settings UI always agrees with it, and offers the restart that applies it — the language server reads the setting when it starts. Also reachable from the status-bar quick-action menu, which shows whether the setting is currently on. Findings arrive tagged with the layer that raised them, so the build's analysis groups apart from validation in the Problems panel and clears independently of it.
- **Aggrega: Validate active file / Build / Preview build / Lint** — run the corresponding compiler operation through the language server. Build, preview build and pull act on the selected Release rather than asking each time. Build compiles the selected Release with every gate on and writes the artifacts it renders into the workspace's `dist/` directory; preview build runs the same compile and reports what it would have written, leaving the output directory untouched. Both put the findings that carry a document position in the Problems panel, tagged with the layer that raised them, and write the advisories that name no position — a withdrawn pin, an unresolvable parent — to the Aggrega output channel along with the artifact list. Lint checks publishing conventions and places each finding in the Problems panel, tagged with the rule that produced it, so clicking one opens the entity it concerns; a finding the linter located to a file but not to a line sits at the top of that file rather than at a guessed position, and the full human report goes to the Aggrega output channel as well. All four report how many findings they produced, including when the answer is none, so a clean run is distinguishable from a command that did not run; all four show progress with a Cancel button while they work.
- **Aggrega: Pull / Acquire inputs** — run the `aggrega` binary against the selected Release and stream its output to the Aggrega output channel. Pull fetches the remote dependencies the workspace declares; acquire inputs pins the external inputs the Release's render consumes and records them in its lockfile, so a later build serves them from the local store. Both reach a registry, so both show progress with a Cancel button, and both end in a message saying what they did.
- **Aggrega: Draft entity…** — ask the language server for a starter document for an entity kind and open it in a new unsaved tab. Nothing is written to disk: the draft is yours to edit, save or discard. A kind the compiler does not recognise comes back with the compiler's own message naming the kinds it does.
- **Aggrega: Inspect…** — choose an entity the workspace can see and see what it resolves to, opened as a new tab. An inspection is addressed by name, so an entity resolved from a configured catalog directory is offered here as well as one the workspace declares. The resolution runs over the catalog, so it shows progress with a Cancel button.
- **Aggrega: Import…** — run the `aggrega` binary and stream its output to the Aggrega output channel. It asks for the source first, and reads only the file you name — no other files and no network.
- **Aggrega: Cache…** — ask the language server which cache operation to run, then run it. Nothing is spawned, and each answer comes back as a structured result the panel reports: **status** lists every cache, what it holds and how far each one is shared, and removes nothing; **prune** removes the entries no lockfile references and names what it kept, together with anything it had no basis to reclaim and the operation that would; **evict** asks for a size cap first — a byte quantity such as `5GiB` or `512MiB`, or a byte count, read by the same parser the command line uses — and trims the shared compiled-module cache down to it; **clear** empties every cache. The three that remove something ask you to confirm first, and each confirmation names the caches that operation actually reaches: emptying and pruning reach this workspace's own entity, source-artifact, external-input and documentation-bundle caches *and* the compiled-module and plugin-describe caches every project on this machine shares, while trimming reaches only the shared compiled-module cache. Every size these operations report is written in the same vocabulary that cap is read in, so a figure you read off a cache report is one you can type straight into the cap prompt. A cap the compiler cannot read comes back with the compiler's own message naming what a size cap looks like. Cleared and trimmed caches repopulate on the next build that needs them.
- **Aggrega: Push… / Sign… / Deprecate…** — the operations that change what other people resolve. Push asks which of the open workspace's entities to publish, then bundles and publishes it to a configured registry. Sign and deprecate ask for a reference to an artifact already published, because both amend published bytes rather than the workspace: sign attaches a signature, deprecate attaches a signed deprecation marker and asks for the severity — `warning`, `error` or `retracted` — and the reason it records. All three run the `aggrega` binary and stream their output to the Aggrega output channel, all three show progress with a Cancel button, and each ends by saying what consumers now resolve.
- **Aggrega: Show effective config** — ask the language server for the configuration it resolved and the layer each setting came from, opened as a new tab.
- **Aggrega: Show topology graph** — open the topology graph for the selected Release. Drawing it compiles that Release to its topology, so it shows progress with a Cancel button.
- **Aggrega: Search published catalog** — open the filter list, narrow the search by kind, labels, capability, plugin socket or a result cap, then run it and copy a matched reference. Each facet is editable in any order and returns to the list, so the whole filter is readable before it runs. A search that matched nothing names the filter it ran, which is a different answer from an index that could not be read at all — the second reports the compiler's own message and the full text goes to the Aggrega output channel, together with the freshness line naming each registry searched and when its index was last updated.
- **Aggrega: Refresh plugins** — reload the Plugins panel.
- **Aggrega: Refresh registries** — re-read the configured registries. This contacts no registry, so it is cheap to repeat.
- **Aggrega: Refresh workspace catalog** — re-ask the language server which entities the workspace can see. This reads the workspace the server already has open and contacts no registry, so it is cheap to repeat. It sits on the Catalog panel, beside the published-catalog search.

## Build

```bash
npm install
npm run compile
npm test
```

`npm run compile` type-checks and then places the third-party assets the panels
serve into `media/vendor/`, which is why that directory appears after a build and
is not in version control. It fails rather than proceeding when an asset is
missing, because a panel drawn without its icon font shows no icons and says
nothing about it. Packaging runs the same step.

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

Apache-2.0.

The Codicon icon set ships under `media/vendor/` so that the panels this
extension draws itself can show the editor's own icons — a document the editor
hosts is given no icon font of its own. Those files are placed there by the build
from a development dependency rather than carried in this repository, and they
are not Apache-2.0; their provenance and licence are recorded in
[`media/codicon-NOTICE.md`](media/codicon-NOTICE.md).
