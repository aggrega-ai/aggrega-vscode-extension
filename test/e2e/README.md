# The end-to-end suite

The unit suite never draws an editor. The end-to-end suite does: it launches the
real editor with no display, loads this extension and a real `aggrega` language
server into it, drives the workbench from outside, and checks what the editor
shows and does. It is a runner of its own, run by hand and by nothing else. It
runs on Linux, because it reads the processes it starts from `/proc`.

It compiles nothing and builds no compiler. Everything it tests is handed to it,
and it refuses to start, naming the input, when one is missing or is not what it
claims to be:

- **The compiled extension** — this repository after `npx tsc -p ./` and
  `node build/stamp-build-version.js`. A compiled output older than its source,
  or a build stamp older than the compiled output, is refused.
- **An `aggrega` binary built from a committed revision**, and that commit:
  `--compiler <file> --compiler-commit <sha>`. A binary whose version shows it
  was not built from a committed revision is refused, naming the version it
  reports: one ending `-dirty` or `+dirty`, a build of a working tree with
  uncommitted changes, or `(devel)` or `(unknown)`, a build stamped with no
  revision at all.
- **The standard-library catalog**, the `aggrega-catalog` directory of a git
  checkout: `--catalog <dir>`.
- **A `zot` registry server binary**: `--registry-server <file>`. The suite
  starts its own registry on a free loopback port, with a data directory of its
  own and no authentication, for the checks that need one.
- **The editor build** the runner drives, fetched once into `.vscode-test/` with
  `node out/test/e2e/run.js fetch-editor`.
- **The editor's shared libraries.** Before the first launch the runner runs
  `ldd` on the editor and refuses, naming each library the loader cannot find. No
  display is needed: the editor draws on Chromium's headless platform.
- **A scratch directory**: `--scratch <dir>`. Everything a run writes goes
  beneath it — the editor's profile, a home directory and its configuration
  directories, the copies of the folders the checks open, the registry's data.

```bash
npx tsc -p ./
node build/stamp-build-version.js
node out/test/e2e/run.js suite --scratch <dir> \
  --compiler <aggrega binary> --compiler-commit <commit> \
  --catalog <aggrega-catalog directory> --registry-server <zot binary>
```

`npm run test:e2e -- suite …` runs the same, and npm then writes a debug log of
its own under your home directory, which invoking `node` directly does not.

Each run writes `suite.json` beside a plain summary, `suite.txt`, in a directory
of its own under the scratch directory. The report is headed with the
extension's build stamp, the compiler's version and commit, the editor's version
and the catalog's commit, and gives each check one of four outcomes:

- **passed** or **failed**, with what was seen against what was expected;
- **not run**, with the reason: a precondition that could not be built or
  reached. A check not run is never counted as passed;
- **for a person**, where the question is a judgement: the check stops at the
  state to judge and leaves a capture and the drawn text for someone to look at.

A check waits for the state it asserts and reads it the moment that state
holds, so a busy machine makes a run longer and moves no verdict. The bound on
each wait only guards against a state that never comes: it is ten times what the
state takes on an idle machine, and never more than ten minutes, which is also
how long a check failing on that wait takes to report. A check whose expectation
states a duration of its own — "within 10 s" — compares that duration as
written, and on a machine too busy to meet it that verdict does move; so does a
wait whose outcome the check records rather than judges, which is watched for a
stated time instead. A press on a control drawn in a panel's document, on the
welcome page, on a notification's button, on the topology graph, or on a row or
header of a side-bar view is made once that control stands still with nothing
drawn over it, and counts only where its own event reached it; one that landed
elsewhere is made again, at most three times, and one that never lands stops the
check, naming where each landed. The editor draws at most three notifications in
any 800 ms and lists the rest in its notification centre without drawing them,
so a check acts, after closing its editors, only once none has been drawn for
that long, and the notification it then reads is one the editor drew. A wait
that runs out names the state it waited for, the bound it ran to and the last
thing it read, and the report lists under each check every wait that ran out in
it, with that bound and reading — so a check that passed after waiting a whole
bound out for its answer is visible as one.

Each scenario starts an editor of its own on one folder, and a few then open or
add others in that window as a reader does. Some work in the topology graph
panel:

- `storefront-graph-panel` opens a storefront whose one attachment authors a
  value its Feature declares sensitive. It checks what the attachments panel
  draws for that value with `aggrega.graph.showSensitiveValues` unset, ticked,
  ticked off again and hand-edited to a value that is not a boolean; the list of
  what may attach, the node it follows and the sentence it reads when it cannot
  be listed; that nothing in the panel offers to connect two components;
  attaching a Feature to a component inside a subsystem — taken out again by
  one undo, and landing where an unsaved edit above it puts it — two subsystems
  deep, and through a module the Aggregate imports; and the reasons a failed
  drawing and a refused attach give. One of its checks posts a request into the
  graph panel's own message channel naming a node the drawing does not carry,
  which is a request no press in the panel makes.
- `probes-nothing-may-attach` opens a folder whose only Feature applies to
  nothing it deploys and which declares no grouping: how the drawing titles the
  two boxes holding nodes nobody grouped, and what the list reads when nothing
  matches.
- `gateway-top-level-attach` attaches a Feature to a component declared at the
  top level of its Aggregate.

Nothing these checks attach is saved: each changed document is closed without
saving, and each scenario that attaches ends by checking that every file of the
folder it opened reads byte for byte as it did when the scenario started.

Others read the drawing itself, and when it is drawn again:

- `storefront-graph-drawing` measures the storefront's first drawing — the
  whole topology framed to the panel above its legend, nothing of it drawn
  under the legend, no two labels drawn over one another,
  each component name inside its card, the Release's boundaries and the
  Aggregate's subsystems drawn as declared, the imported module's component in
  its boundary, each edge running between the boxes of its two ends and
  through no other and marked at the end it points to, and the box holding the
  nodes in no subsystem drawn apart from a subsystem — and the legend: where it
  stands, what it says, whether its rows are drawn whole, and that it names each
  type colour drawn. It then edits and saves its own copy of the folder:
  typing moving the Problems panel and not the drawing; a save, and a write from
  outside the editor, each drawing the graph again with nothing pressed; the
  reader's zoom and selection kept through a redraw nobody pressed for, while a
  press frames the whole topology again; a redraw the compiler refuses dimming
  the drawing and saying it is out of date the same way whether a save or a
  press reached it, and a panel that never drew saying only what went wrong;
  and a redraw landing while the panel is behind another tab.
- `storefront-graph-idle` turns `aggrega.server.buildOnInspect` on and misspells one of the
  storefront's sockets by a character, so every compile files an advisory, then
  shows the graph once and watches it for a minute with nothing touched: it is
  not drawn again, and the language server spends less than half the CPU time
  over the minute that the one compile drawing it spent. Putting the spelling
  right and saving then draws it again, spending at least that half, and takes
  the advisory away within half a minute of the save.
- `fleet-graph-first-fit` opens a folder of a few dozen components and checks
  that the first drawing shows the whole shape fitted to the panel above its
  legend, however small that makes its names, using the panel's width rather
  than a narrow column of it, and leaves whether that trade reads right for a
  person to judge.
- `storefront-graph-nested-boundaries` opens a copy of the storefront whose
  Release declares its boundaries one inside another, one of them placing
  nothing itself, and checks that the first drawing draws each boundary inside
  the one it is declared in, titled by its whole path and holding what the
  Release places directly in it.

Others follow what a reader meets as the editor comes up and as the language
server comes and goes, and what each operation ends in:

- `gateway-readiness` closes the editor and opens it again on the same folder,
  and checks that every panel fills with nothing pressed; that a restart refills
  them and draws an open topology graph again at the zoom it had; that each
  list panel's Refresh asks again; how an entity resolved from a configured
  catalog directory is marked, and that pressing it opens nothing; and the
  status bar's reading of the language server beside the Release it is asked
  about.
- `empty-workspace` opens a folder that is a workspace root and holds nothing
  else, and checks that each panel's empty answer reads apart from the row it
  draws with the language server stopped — stopped once by pointing
  `aggrega.server.binaryPath` at a file that does not exist, and once by ending
  the server more often than its respawn bound allows — and what the status
  bar's language-server item says and offers in that state.
- `no-workspace-first-day` opens a folder no workspace marker reaches: the
  commands that must answer with nothing to attach to, that the one that cannot
  run without a server is left out of the command palette until the folder is
  anchored and a server answers, and the welcome page's control that creates a
  workspace configuration, checked again after the editor is closed and opened
  again.
- `workspace-above-authoring-release` opens a folder beneath a workspace root
  and checks which configuration file the Release configuration command opens.
- `gateway-cache` runs the four cache operations from the Commands panel and
  checks each confirmation, each ending, and that every one of them reached only
  the scenario's own caches, under the home directory the runner gave it. One
  trim is given a cap a byte under what the store holds, so that it removes; its
  ending, the prune's and the emptying's are read whole, with every line each
  writes, so that nothing is said of anything left in place where nothing was. The
  compiled-module store under the home directory of whoever runs the suite is
  listed before and after, and never written. Last, the folder's cache directory
  is replaced by a link leading out of the workspace, and the emptying ends in the
  language server's own refusal, with nothing behind the link removed.
- `gateway-endings` drafts a document and publishes an entity to the suite's own
  registry, twice; `mysql-watch-and-stop` chooses a Release, then stops a build
  and a pull part-way and reads the language server's CPU time and the processes
  the extension started, to see that the compiler stopped as well as the editor.

A further group follows which folder, which Aggrega workspace and which Release
the editor works on, and the three rows at the head of the Commands panel that
say so:

- `two-releases-context-rows` opens a folder that is its own workspace and holds
  two Releases with no default: the three rows as drawn, hovered and pressed,
  the Aggrega workspace row's shortened label giving each value more room, and
  the Release row's hover, with none selected, carrying the language server's
  own reason for naming no default as the server gives it; a
  level with one candidate taken with no chooser; choosing where the editor
  already is restarting nothing; and the Release chosen remembered through a
  window reload and a reopen, and said to be dropped once it is no longer
  offered.
- `two-workspaces-context-rows` opens one documentation example, adds a second
  with the editor's own command, and checks that no language server starts until
  the reader chooses between them, that choosing and switching move the rows,
  the status bar and the welcome page — one page, the add having restarted the
  extensions under it — that the Project folder chosen scopes which workspaces
  are on offer, and that both choices survive a reload.
- `project-folder-adds` follows what the Project folder row's chooser can do to
  a window: its two folder dialogs, a folder already open refused, an add from
  one folder that comes back working from the folder added, an add in place, an
  open that replaces what the window had, the rows in a window with no folder,
  and the Aggrega workspace row's last entry carrying the workspace chosen into
  the window it makes.
- `workspace-discovery-layouts` opens, in turn, folders that place a workspace
  marker somewhere different relative to the folder opened — none at all, one
  marker beneath another, markers only below — with a workspace chosen below the
  folder moved to, kept through a reload without a word, and dropped, and said to
  be, once its marker is moved aside; the spellings that mark a root, each
  read on the row as the folder opens and again after a reload; and a workspace
  inside the folder read beside one above it, only the second carrying the mark
  and raising the dialog.
- `release-beneath-a-workspace-root` opens a documentation example beneath a
  root that marks it as the workspace: the rows naming the folder and the root,
  every Release the chooser offers drawn as a topology graph with no refusal and
  one of them built, the chooser offering every Release file the workspace
  holds, and what the chooser says about a link leading out of the workspace —
  nothing while there is none; once the folder holds a link to a directory
  outside the root, a line naming that link as the language server names it;
  and, once it also holds a link to a Release file outside the root, one line
  naming both, the directory first, with nothing offered through either.
- `releases-with-own-catalogs-selected-release` opens a copy of a documentation
  example whose Releases each read a catalog variant of their own, with two
  entities added so a request answered in one Release's terms reads differently
  in another's, and reads each surface answered in the selected Release's terms —
  the Catalog panel's list and the document its row opens, go-to-definition,
  hover, completion, an inspection from the Commands panel and from a Catalog
  row, a Catalog row's check, and the list of what may attach — with no Release
  selected and then with Releases selected in turn, each against the compiler's
  own answer to the same question for the same Release over a second copy. While
  the folder holds no link leading out of the workspace, neither the Catalog
  panel nor the list of what may attach says a word about one; once it holds a
  link to a Feature document outside the workspace, the Catalog panel's last row
  and one line under the list each name that link as the language server's own
  answer over the folder names it, with nothing behind it listed or offered. Then
  paths of the folder are replaced in turn by links leading out of the workspace —
  the build's output directory, the Release's lockfile, the selected Release
  itself and a document beneath a catalog directory it reads — and each refusal
  is read where the editor shows it, in the language server's own words: a
  build's and a graph's on the Release in the Problems panel, carrying the short
  code the refusal names, and in their endings, a pull's in its ending, the
  Catalog panel's in its failure row, and a validation's as a finding carrying its
  short code; nothing behind a link is written or removed.
- `workspace-above-interruption` opens a folder beneath a workspace root it has
  no marker of its own for: the dialog that says so and the mark it leaves on the
  row, the dialog raised again in each new window until the reader asks not to be
  told about that folder, which silences that folder alone, and the two ways to
  open the workspace itself.

Others follow what the editor writes into the workspace itself, and the actions
that open its configuration file:

- `three-releases-default-release` opens a folder holding three Releases and
  naming no default, and records the selected one as the workspace's default
  with **Aggrega: Set the selected Release as this workspace's default** — first
  with the `.aggrega` directory a link to a directory outside the workspace, then
  with the marker a link to a file outside it, then with the marker a link leading
  nowhere, whose far end a write would create outside it. Each ends in the
  language server's own refusal, and the directory outside holds the same files
  with the same bytes before and after. Recorded inside the folder, the marker
  names the selected Release, and once the Release the window remembers is no
  longer offered, the editor closed and opened again starts on the one
  recorded.
- `configuration-file-leading-out` opens a folder whose `.aggrega-config.yaml` is
  a link to a file outside the workspace: the Release configuration command, and
  the control creating a workspace configuration on the welcome page and beside
  the Aggrega workspace row, each say the file is not opened and why, and open
  nothing.
- `configuration-file-invalid` opens a folder whose `.aggrega-config.yaml` the
  compiler refuses, so no language server starts there, and
  `configuration-file-linked-inside` one whose `.aggrega-config.yaml` is a link to
  a file inside the workspace: in each, the Release configuration command opens
  the file.

Another group reads the Commands panel and the panels beside it:

- `gateway-commands-panel` checks the order the container's panels read in and
  what each title bar holds, the house and the cog and the settings screen the
  cog opens; the panel's default shape, its groups, labels and hovers, its icons,
  and how the flow wraps — with nothing drawn between one group and the next — as
  the side bar is dragged narrower and wider, the three rows' values staying in
  line and their labels giving way only where there is no room left; the panel
  at the side bar's default width as tall as its whole flow; the tab
  stops and the arrow keys in both shapes, and a section closed on the tab stop
  handing it to its heading; every entry pressed, the ones that ask for a subject backed out of,
  and the ones that only read starting no compiler process; the section shape
  chosen on the settings screen, with its titles, the rule above the publish
  group, the row beneath Build reading "Build options", its chevrons and the
  three rows with every section closed; the light,
  dark and high-contrast themes; the shape setting kept in the user settings
  rather than a workspace's; the binary path's description; and, with the
  language server stopped, which entries stay enabled.
- `mysql-commands-panel-no-release` opens a documentation example holding two
  Releases and naming no default: the operations that act on a Release drawn in
  place and greyed with their reason, the arrow keys passing over them, a Release
  chosen bringing them back with nothing restarted, and where the focus stands
  once the panel is drawn again — back on the panel's control for a choice made
  from the panel, and left in the editor for one made from there.
- `gateway-docked-menus` opens the menus the Commands panel's buttons offer
  beside themselves, in a side bar wide enough for a menu to hang from its button
  and with the container moved to the secondary side bar a few hundred pixels
  wide: where each menu stands against its button — on the side with more room,
  its bottom edge inside the view — and that it stays left of the panel's scroll
  bar; docked, each menu's name drawn at its head with at least two of its
  choices whole beneath it; the mark the button carries while its menu stands, every way
  that mark clears — a press outside the panel among them — that opening a menu
  moves no button, and the same in the section shape.
- `gateway-docked-configuration` opens the configuration panel's table in an
  editor group as narrow as a side panel: the setting column held at the left
  edge as the rest of each row scrolls under it and solid while it does, the
  corner holding in both directions, a setting's description brought fully into
  view beside the held column, every setting path breaking only after `_` or `.`
  in a column held to its measure under a caption that wraps inside the view,
  and the table scrolling sideways at that width while it fits the editor area's
  own width.

Another group acts on the Registries, Catalog and Plugins panels rather than
reading them:

- `gateway-list-panel-operations` opens the gateway folder with the suite's own
  registry named as the default and no registry configured. It adds that
  registry from the head of the Registries panel — backing out at the host and
  again at the file it asks for — and acts on the registry's row: the operations
  the row offers, the index updated from the row's own action, the stored
  credential removed with no file asked, and the registry removed with the file
  chosen named in its confirmation, each confirmation declined before it is
  given. From the Catalog panel it inspects the folder's Recipe and publishes it
  to that registry, a decline publishing nothing. From the Plugins panel it backs
  out of every question adding a plugin asks, holds the governance roles offered
  against the ones the language server's configuration schema declares, and
  generates Plugin entities for one artifact — declined — and for every plugin
  built into the compiler, comparing what is written with the compiler's own
  generation. It then checks that no row operation is offered on a panel's head
  rows, on the row saying no registry is configured, on the rows drawn with the
  language server stopped, or on the rows drawn in a folder no workspace marker
  reaches.
- `mysql-inspection-by-name` inspects, from its Catalog row, the Aggregate a
  documentation example declares at its root, where its catalog directories do
  not reach it: one notification naming the document as the reason, in the
  language server's own words, with the action that opens it — and, with the
  folder's list of catalog directories emptied and the language server restarted,
  the same ending without the note saying where local entities are read from.
- `configured-plugins-removal` opens a folder whose configuration names a
  plugin the compiler can describe and one it cannot: how each is drawn
  beneath the configured heading; that removal is offered only on the one it
  describes — not on a plugin built into the compiler, a heading, or the row a
  failed listing draws; its confirmation declined and then given; and that the
  command palette offers each list panel's head operations and refresh and none
  of the operations bound to a row.

Another group reads the configuration panel against what the language server
serves:

- `gateway-configuration-report` opens the panel in the gateway folder, its file
  setting its catalog directories through `workspace.catalog_dirs_append`, and
  holds each row against the configuration schema the language server serves
  and its own report of what is in force: every setting a row, nested and listed
  ones included, and each list's companion named on its list's row; the
  coverage sentence drawn only where the report leaves a setting unattributed;
  a heading row over each group; the headings, the last drawn too; the one value
  column, its mark where a file or the environment set the value or it is not
  the declared default, *none* where nothing is in force, and no value broken
  inside a word; the description behind each row's circle, its code drawn as
  code in both shapes; the switch to each setting in full, and the note there on
  the settings shared by every project on the machine alone, with the **Global**
  marker on the same rows of the table and its rule at the head of that shape;
  the names derived from the keys, no two alike; the companion the folder's file
  sets, read on its list's row in both shapes; the shape the panel opens in
  again; and that nothing on it edits a setting. It then puts a setting in force in the
  folder's own file and checks both shapes name that file, and that pressing
  Show config again brings the open panel forward reading the new value, which
  it does not read with nothing pressed; and, with the language server stopped,
  that pressing it leaves no panel standing and says why, offering to start the
  server — with the panel closed, and with it open from the Commands panel and
  from the command palette — and that the start offered starts the server once
  the binary setting is put back. For that check it sets
  `aggrega.server.restartGraceSeconds` far beyond its own wait, so the restart
  putting the binary setting back schedules cannot begin while it reads and the
  start it reads is the press's; it then cancels that restart from the status
  bar menu and takes the grace setting out again, leaving the server running.
  It leaves for a person whether the grouped table, its columns and headings,
  its derived names, the summary box and the Global marker with its rule read
  right, with captures of the table in a dark, a light and a high-contrast
  theme.
- `gateway-configuration-from-the-environment` starts the editor with
  `AGGREGA_OFFLINE=true` in its environment — the report names a variable a
  scenario adds there — and checks both shapes name that variable as the
  setting's source.
- `nothing-configured-configuration-report` opens a folder holding only a
  Release, with no configuration file in it, above it or in the home
  directory's configuration: the summary says no file contributed and draws no
  list of files, and every setting reads at its default.

A last group reads the welcome page as a reader meets it, step by step:

- `welcome-page-empty-folder` starts on a fresh profile, on a machine with no
  global configuration file, in a folder no workspace marker reaches: the page
  arriving by itself in a tab of its own, each step's standing, value and ways
  through, the checkbox and the versions at its foot, and that the editor's own
  welcome page carries nothing of Aggrega's. It then presses each way through in
  turn — creating the workspace configuration, drafting a Release, seeding a
  registry it names, seeding the hub over a file that already exists, adding a
  registry and backing out of an add, pointing at a second compiler, and taking
  a folder beneath that already has a configuration — and turns the page's
  opening on startup off and on again from the palette, the checkbox at its
  foot (pressed, and toggled with Space while it keeps the focus) and the
  settings screen, beside the house icon in the Commands panel title bar, which
  changes no setting.
- `welcome-page-configured-workspace` opens a workspace whose compiler, Release
  and registry are all in place: every step met and folded on arrival, the
  compiler step going back to **To do** when the compiler stops or will not
  start and coming back with the compiler on your PATH, and the registry step
  following a registry removed from the Registries panel with nothing pressed on
  the page, and met again once the page adds it back.
- `welcome-page-mixed-workspace` opens a workspace holding two Releases and no
  registry: steps met folded beside steps still to do, the words each standing
  is read in, the outline of every control in a dark, a light and a
  high-contrast theme, a step's value set against its guidance, a step met while
  open staying open, and the arrangement kept through a refresh and decided
  again when the page is opened again.

The folders these open are built inside the scratch directory, and before any of
them is opened the runner reads every directory above it for anything that marks
a workspace root, refusing the scenario where it finds one: a marker above them
would be found before their own.

The report also gives each scenario's bring-up, wall clock and teardown, each
check's elapsed time, the peak memory and the CPU time of the editor's processes
and of the language server, what it found newer than the run's start in the
places outside the scratch directory a run could write to (another program on the
machine may have written there too, so the report lists what it found rather
than attributing it), and whether any process the run started is still alive. The runner
exits 0 when every check passed, 1 when one failed or was not run, and 2 when it
refused to start.

Other commands and options:

- `--only <scenario,…>` runs some of the scenarios.
- `node out/test/e2e/run.js plants` lists the plants — each one edit to a scratch
  copy of the extension, made to show that a check can fail — and checks each
  one against the compiled extension without launching anything.
  `suite --plant <name>` makes that edit, runs the scenario holding its check,
  and reports whether the check moved the way the plant says.
- `node out/test/e2e/run.js checklist` lists, without launching anything, each
  check a run leaves for a person to judge, with its question, and each check no
  run can reach, with why. `test/e2e/CHECKLIST.md` says what no check reaches —
  a remote window, your own client, native dialogs, a screen reader among it —
  and which checks bring the editor nearest to it.
- `node out/test/e2e/run.js compare <run> <run>` compares two reports, header
  and verdict by verdict.
- `inputs` checks the inputs and prints the report's header without launching
  anything; `calibrate`, `probe` and `teardown-study` exercise the runner's own
  driver, probe and teardown.

The head of `test/e2e/run.ts` lists every command and option.
