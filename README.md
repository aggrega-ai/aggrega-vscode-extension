# Aggrega VS Code extension

Language support for Aggrega YAML — validation, navigation, hover, and completion backed by the `aggrega` daemon (`aggrega serve`).

## Prerequisites

- Visual Studio Code 1.85 or newer, on the desktop. The extension works by starting the `aggrega` program and provides no version a browser can run in its place, so it does not run in editors that run entirely in a web browser, such as vscode.dev and github.dev.
- `aggrega` binary on `PATH`, or its absolute path set in the `aggrega.server.binaryPath` setting.
- A folder Aggrega recognises as a workspace root, at or above the folder you open. Aggrega reads one file at your project root — `.aggrega-config.yaml`, carrying a `workspace:` block — and climbs from the opened folder to find it. Marking the root with a `workspace:` block is the explicit choice and the one to prefer; a project that has never declared one can still be recognised by other markers, which Aggrega's own configuration reference covers along with everything else configuration can do in a larger project.

You do not have to arrange any of that by hand: see [The welcome page](#the-welcome-page).

## The welcome page

**Welcome to Aggrega!** opens in its own editor tab. It says what Aggrega is, then lists what the
extension needs in the workspace you have open:

1. **A workspace Aggrega recognises** — the discovery described under [Prerequisites](#prerequisites).
2. **A compiler this editor can run** — the `aggrega` binary named in `aggrega.server.binaryPath`.
3. **A Release to act on** — building, previewing and the topology graph each act on one Release.
4. **A registry to resolve from** — pulling dependencies and searching the published catalog resolve
   against the registries your configuration names.

Each step explains what the condition is for and how the editor reaches it, so the page is somewhere
to read about the product rather than only a checklist.

**Each step offers more than one way through, and one of them is always "I already have this."** You
can create a workspace configuration or point the editor at a folder that already carries one; use
the compiler on your `PATH` or select a build you have somewhere else; draft a Release or choose one
of yours; seed the official hub, name your own registry, or add one to a configuration you already
have. Nothing here is a dead end that hands you a file dialog and leaves the step still to do.

**A step you have already met is checked off and asks you nothing.** The page reads what is true
rather than putting the same questions to everybody, so if you built your configuration from the
command line and then opened the editor, every step arrives ticked.

**Every step folds, and the page opens showing what is still needed.** A caret at the top right of
each step opens and closes it. A step whose condition is already satisfied opens folded away, and one
that is not opens with its explanation in front of you — so the reading is about the work you still
have rather than the work you have done. **A folded step keeps its title and every one of its
buttons**, and hides only the explanation: once you know what a step is for, you can still act on it
without reading it again.

The arrangement is decided when the page is created and is yours after that. A step that becomes
satisfied while you are reading it updates its mark and **stays open** — it does not fold away under
your cursor — and a caret you press stays where you put it, however many times the page refreshes
around it. Closing and reopening the page reads the conditions again and arranges itself afresh. So
does the page drawn in place of one you had open when your editor restarts its extensions — as it does
when a folder is added to a window open on one folder: the page you had is closed and a new one drawn
in the same group of tabs, whether or not the page is set to open on startup, so the window goes on
holding one page and that page follows the workspace you are in.

**Each step also shows what it currently stands at**, so the page answers *which one* and not only
*whether*: the workspace root, the compiler, the Release and the registries the configuration
declares. The value is set larger and heavier than the explanation around it, because a value drawn
in the same weight as a wall of text is one you have to hunt for. A folded step shows it under the
title, so you can confirm your selection without unfolding anything; an open one shows it at the foot
of the explanation, immediately above the buttons, where it is the last thing read before you act.
A chosen value is introduced by **Selected:**, set smaller and lighter than the value itself so the
label points at the value rather than competing with it.

**Where you have not chosen yet, the step says so in words rather than leaving a blank line**, which
would read as the page having failed to draw — and it distinguishes two states a reader acts on
differently. **None selected.** means there is something to choose and you are on none of it.
**None available.** means there is nothing here to choose from at all, so pressing the step's
"I already have one" could only show you an empty list and what you want is its other way through.
Only the two steps that offer a list can read **None available.** — the workspace and the Release.
A compiler is named and a registry is registered outright, so neither of those steps has a list that
could be empty. The registry step keeps a third reading, **Not read yet.**, for when the compiler
could not be asked: telling you that you have configured none when nothing was able to answer would
say more than the page knows.

**A step's mark follows its condition in both directions.** Each step carries its standing in words
beside the mark — **Met** or **To do** — because the mark itself is a glyph and a glyph alone leaves
its meaning to be guessed at. A step reads **Met** when its condition becomes true and **To do**
again if the condition later lapses — a compiler that stops
answering, a Release that is deselected. The page reads what is true each time it refreshes rather
than remembering what was once true, so it never reports something you have since lost. Where a lapse
matters it is also reported where you are already looking: the status bar carries a compiler that has
stopped answering, and the **Project folder**, **Aggrega workspace** and **Release** rows at the top
of the Commands panel name the current selection.

It is an ordinary editor tab rather than a dialog on purpose: every step asks you to point at
something in your own workspace, and a dialog would be covering the files that hold the answers. It
sits in the editor area rather than in the Aggrega view, so it costs the sidebar no space and can say
what the product is — which a narrow column had no room for. It is Aggrega's own tab, reached and
closed on its own terms, and it offers no route into the editor's own welcome page.

**The page carries that decision at its foot, centred, and the Command Palette carries it too.**
Both move the one setting, `aggrega.getStarted.show`, written to your own settings — never into the
repository, so your choice does not travel to whoever else opens it. The control at the foot is a
checkbox reading **Show Aggrega welcome page on startup**, ticked while the page opens on startup —
so it reports the setting as it stands rather than offering you the act that would change it. Turn it
off in the settings screen and the checkbox follows; press the checkbox and the settings screen
follows. It is one switch in two places rather than two switches. The checkbox keeps the keyboard focus
when it is pressed, so Space ticks and unticks it in turn.

Turning it off stops the page opening on startup rather than putting it out of reach, and it is not
a one-way door: **Aggrega: Get started** in the Command Palette turns it back on and opens it, and
**Aggrega: Stop opening the welcome page on startup** is the palette's own way to the same setting.

**The Commands panel carries a way back to the page, beside the cog.** It is the house icon at the
top right, and its tooltip reads **Open the welcome page** — so getting back to the page is something
you find by looking at the Aggrega view rather than something you have to know to type. It opens the
page and leaves your startup setting exactly where you put it: looking at the page again does not
turn it back on. The palette command is what does that, because turning it back on is a decision
rather than a glance.

**The page reports what you are running, at its foot.** Two version readings sit there: **Extension**, which
build of this extension your editor has loaded, and **Compiler**, what the `aggrega` binary the
language server is running says about itself. The Extension reading is recorded when the extension is
built, from the state of its source at that moment, in the same form the compiler's own build uses
for its version — so a development window, an installed copy and a copy packaged from an edited tree
each say which one they are:

- a release tag alone, such as `0.2.0`, means the build is exactly that release;
- a tag followed by a count and a commit, such as `0.2.0-3-g1a2b3c4`, means a build from commit
  `1a2b3c4`, three commits after that release — and a commit alone, such as `1a2b3c4`, means a build
  from that commit where no release precedes it;
- a `-dirty` suffix on any of these means the build was made from a copy of the source carrying
  changes that had not been committed;
- `dev` means the build was made where the source's history could not be read.

Neither reading is written into the page — both are read when the page is drawn, so a development
build reports itself as one rather than showing nothing, and restarting onto a different compiler
moves the reading. Where a reading cannot be taken — the extension was built without recording which
build it is, nothing is running to ask, or what is running did not answer — the label stays and says
the version was not reported, so an absent reading is never mistaken for one you failed to notice.

**The page's last line says whether the language server is running, and which build it is.** It reads
**Language server running**, **starting**, **not running** or **failed to start**, in the words the
status bar and the notifications use; **failed to start** means the most recent attempt to start it
failed and none has run since. The Aggrega output channel says why, and so does the notification raised
when the first start or a restart fails. While the server runs, the line adds the version the running
server reported about itself when the extension connected to it, written the way the **Compiler**
reading writes a version. The **Compiler** reading above it is a different fact: it is what the binary
the server was started from says when asked, and the two differ when the file at that path is replaced
while the server started from it goes on running, so the page shows both. A language server that
reports no version of its own reads **version not reported** there, rather than borrowing the binary's.
The line and the two readings above it follow the server as it starts, stops, restarts or fails,
without the page being reopened; the steps keep their marks through a restart.

## Features

- **Welcome page** — Aggrega's own page in its own editor tab, saying what Aggrega is and then listing what the extension needs in this workspace, marking each condition **Met** or **To do**. Each step offers a way to create the thing and a way to point at one you already have, explains the condition, and a step already met asks you nothing. A step marked **Met** goes back to **To do** if its condition lapses. A step already met opens folded, so the page opens on the work that remains. Each step also shows what it currently stands at — the workspace root, the compiler, the Release, the registries — set larger and heavier than the guidance, introduced by **Selected:**, under the title when the step is folded and immediately above the buttons when it is open, and saying so in words where you have not chosen yet — **None selected.** where there is something to choose, **None available.** where there is nothing to choose from at all. Its foot carries the checkbox that decides whether it opens on startup, the same switch the settings screen holds, below that the versions of the extension and of the compiler you are running, and last whether the language server is running and which version it reports. A house icon in the Commands panel title bar opens it again at any time. It costs the Aggrega view no space. See [The welcome page](#the-welcome-page).
- **Language server state** — a status-bar indicator on the left, beside the Release indicator, reading **running**, **starting**, or **not running** in red. It is the one surface that is there whatever the compiler is doing, so it is where you find out that nothing is running rather than being left to infer it from surfaces that have gone quiet — and its tooltip says which of the two reasons applies: no folder here is one Aggrega recognises, or there is one and the server is not attached to it. Clicking it offers **Start** when nothing is running and **Restart** when something is, and does the one you choose. See [When the language server is not running](#when-the-language-server-is-not-running).
- **Selected Release** — a status-bar indicator and a **Release** row at the top of the Commands panel, each naming the one Release the editor is working on. Everything that acts on a Release — validation, the topology graph, build, preview build and pull — acts on that one. A graph panel already open keeps the Release it was drawn from when you select another, and showing the graph again draws the newly selected one. The graph, build, preview build and pull read the catalog directories that Release builds against: its own, where your workspace configuration names some for it under `workspace.releases`, and otherwise the workspace's — the same ones `aggrega build --release` reads at a terminal, so one window builds each Release of a workspace against its own catalog with no flag to pass. The Catalog panel, an inspection, the Catalog row's check, hover, completion, Go to Definition, Find References and Find Implementations answer in the selected Release's terms too: where your workspace configuration names catalog directories for each Release, each reads the documents the workspace holds but those in a directory only another Release reads, and the catalog directories the selected Release builds against — so a name several variants declare, one per Release, resolves to the selected Release's. With no Release selected they answer in the workspace's own terms. See [Selecting a Release](#selecting-a-release).
- **Diagnostics** — YAML and schema validation surfaced inline as you edit, and for every open file each time a language server starts, checked against the selected Release.
- **Go to Definition** — jump from `extends`, `implements`, `provider`, `uses`, `recipe`, `aggregate`, `manifest` references to their target entity files.
- **Find References / Implementations** — list every reference to or implementation of an entity.
- **Hover** — kind-aware summaries for catalog and release entities. With a Release selected, the entity a reference names is the one that Release resolves it to: it is looked up through the catalog directories the Release builds against first, then among the documents it reads. With none selected, it is looked up among the documents the Aggrega workspace holds and the ones the language server has validated first, then through the catalog directories your configuration names for the whole workspace, wherever they sit — so a standard-library Component shows its summary either way.
- **Completion** — context-aware suggestions for entity kinds, API versions, schema keywords, primitives, label values, providers, paths, and intra-document component keys.
- **Aggrega activity-bar view** — four panels in reading order: **Commands**, **Registries**, **Catalog** and **Plugins**. The other three list what your configuration and the workspace hold, and each opens with the operations acting on what it lists, as labelled rows at the head of its list; every other operation is a labelled button on the Commands panel, so each operation has one place to look for it. An operation acting on one particular registry, entity or plugin is on that row. The Commands panel is headed by three single-line rows naming what the editor is acting on — **Project folder**, then **Aggrega workspace**, then **Release** — each opening its own picker. The middle row draws its name shortened, as **Agg. worksp.**, so that each row's value has more of the panel's width; its hover names it in full, as **Aggrega workspace**, and so does every message about it. Their values stand in one column, after the widest of the three labels; in a panel too narrow for that label, it is cut short with an ellipsis rather than pushing the panel sideways, and the row's hover still says which it is. They are in that order because each sits inside the one above it, and the arrangement is how that is shown rather than explained. The middle row keeps the product name, shortened or not, because "workspace" on its own already names the set of folders your window has open. The Aggrega workspace row names the folder the language server anchored to, which is what the Release list is computed against; hovering it gives the full path and, when it differs from the folder you opened, names that one too — so you can find out why the offered Releases are the ones they are. Where your window has exactly one folder open, the Project folder row's hover says it is the only one, rather than leaving you to open a list of one, and closes on what clicking the row offers there — opening a folder, or adding one to the window — and where no Release is selected and nothing has yet read what this Aggrega workspace offers, the hover says that instead of guessing at it. Where a level holds none, the hover names the way out of that state rather than telling you to choose: nothing selected and nothing to select read differently, because only the first is a decision waiting on you. A project holding no Aggrega workspace is answered by opening a folder that holds one or by creating one; an Aggrega workspace holding no Release, by working in a different one or by drafting a Release. The Aggrega workspace and Release rows each carry a **+** at the right, beside the row rather than on it: pressing the row chooses among the ones that exist, and pressing the **+** opens the way to make a new one. The Release **+** opens the same drafting flow as **Draft entity** at the head of the Catalog panel, with the kind already settled: it asks for the name and nothing else, and the prompt says it is naming a Release. The Project folder row carries none — bringing a project folder into being is your editor's business rather than Aggrega's. Where your Aggrega workspace is not the folder you opened — it sits above that folder, or inside it — the Aggrega workspace row carries one further control, which opens that workspace as your project folder. It is offered rather than done for you, and its name says what it costs as well as where it goes: opening a folder reloads the window, so the language server and this extension both restart and anything unsaved in the window goes with them. Where the folder you opened is itself the Aggrega workspace there is nothing to open, and the control is not drawn. When a window opens on a folder whose Aggrega workspace sits outside it — neither that folder nor inside it — the editor also says so in a dialog you dismiss before going on: it opens with **Aggrega is using a workspace from outside the folder you opened.** and, beneath that, an `Aggrega workspace:` line and a `Project folder:` line giving the full path of each. Its buttons are **Open workspace (reloads the window)**, which opens the Aggrega workspace as your project folder just as the row's own control does; **Continue here**, which closes the dialog and changes nothing; and **Don't show again for this folder**. Closing the dialog any other way — with Escape, or with its own close control — is the same as **Continue here**. The dialog appears once for a folder in each window, and again if the Aggrega workspace that folder belongs to changes; after **Continue here** it stays away until the window is reloaded or opened again, and then it returns. **Don't show again for this folder** is remembered for that window and restored when you reopen it, so the dialog does not come back for that folder. None of the three dismisses the fact itself: for as long as the workspace sits outside your folder, the Aggrega workspace row carries a warning mark to the right of its value, and hovering the row gives the same headline and the same two paths the dialog shows. An Aggrega workspace inside the folder you opened is not outside it, so it raises no dialog and its row carries no mark and no such headline; hovering the row still names the folder you opened, and the control opening the workspace as your project folder is still drawn. The dialog is drawn by your operating system unless the editor's `window.dialogStyle` setting is `custom`, so by default it follows your desktop's theme rather than the editor's, and no extension can change how it looks; with `window.dialogStyle` set to `custom` the editor draws it in its own theme. Clicking the Aggrega workspace row opens the choice whatever you have attached, including when that is one workspace or none: the picker lists the Aggrega workspaces your Project folder reaches — walking up from it, and looking through everything inside it — each named by its own root, and, last, a way to reach a folder your window does not have open at all: **Choose another folder Aggrega recognises…**, or **Choose a folder Aggrega recognises…** where the picker has no workspace to list. That last entry is there because reaching is bounded by what your window holds: your editor only ever searches the folders you have open, so a workspace sitting somewhere else is reachable by adding its folder and by nothing shorter. The language server starts as soon as walking up has found somewhere to start, without waiting for that search to finish, so a window can attach and only a moment later report that a second workspace is reachable — the list in the picker catches up when the search returns. The Aggrega workspace this window last worked in is taken again straight away too, one you chose inside your Project folder included, because the editor asks that workspace's own marker rather than waiting on the search; only once its marker has gone, or no longer marks a workspace your Project folder reaches, is the choice dropped, and you are told so. Choosing another entry moves the language server there and says so whether it is reached from the same folder as the one in use or from another, and choosing the entry already in use restarts nothing. One Aggrega workspace reached from two open folders at once is one entry and counts as one: discovery climbs, so a root one level up answers for every folder beneath it, and asking which of those folders holds the workspace would be a question with two true answers. Clicking the Project folder row opens the same kind of choice: the folders your window has open, each named by its own path, and, last, two ways to reach one it does not have. **Open folder…** asks for a folder with your editor's folder dialog, whose button reads **Open**, and opens the folder you pick in this window in place of whatever it has open, as your editor's own Open Folder does. That reloads the window, which the entry's description says beforehand, and if the editor cannot open the folder you are told so. **Add folder to this window…** asks the same way, with a button reading **Add**, and adds the folder you pick to the window, after the ones already open, as the folder the editor works from: you picked it on this row, so the row names it rather than asking you again, and the Aggrega workspaces on offer are the ones it reaches. In a window already open on a workspace file the folder joins it in place, and you are told the editor now works from it. A folder the window already has open is not added again, and you are told so; if the editor refuses the folder, you are told that too, and the editor goes on working from the folder it was. Closing either dialog without picking changes nothing. Adding a folder to a window holding a single folder, or none, makes the window a multi-root workspace, which your editor does by restarting its extensions — this one included — or, in a remote window such as a dev container, by reloading the window. Where the welcome page was open as the extensions restart, it is drawn again in its place, so the window still holds one page and it reads the window as it now is. Both **Add folder to this window…** and the Aggrega workspace picker's last entry end in such an add, so where taking either would do that, its description says so beforehand. That workspace is new to your editor and starts without what the window you left remembered, except for the one answer the add itself gave: a folder added through **Add folder to this window…** is the Project folder there, and an Aggrega workspace chosen through the Aggrega workspace picker's last entry, or through the welcome page's **Use a folder that already has one**, is the Aggrega workspace there. The Release you had chosen, and the folders you had asked the dialog not to show again for, stay with the window you left. Which one you choose is remembered for that window and restored when you reopen it, and it decides what the row beneath offers — the Aggrega workspaces on offer are the ones that folder reaches. Reaching is not the same as containing: because discovery climbs, the workspace a folder reaches is often the folder above it, so choosing a subdirectory of your repository still offers the repository's own workspace. With one folder open there is nothing to choose and the row simply names it. With several and none chosen the row reads **none selected**, and the Aggrega workspaces on offer are the ones the whole window reaches. Where that is one, or where one of them is the one this window last worked in, the language server starts there; where there are several and none of them is remembered, it does not start until you choose one, and the status bar's **Choose Aggrega workspace…** and a notification ask you to. A language server that stops or fails to start on its own leaves the Project folder row naming your folder — your workspace is still chosen, and it is the language-server indicator that reports the server. Below those rows the operations are grouped by what you came to do: **Build** (validate, lint, build, preview, graph), **Dependencies** (pull), **Author** (import, inspect), **Publish** (push, sign, deprecate) and **Configuration** (show config, cache). Alongside Commands sit a **Registries** panel, headed by **Add registry** and **Update index** and listing every registry the effective configuration declares; a **Catalog** panel, headed by **Search catalog** and **Draft entity** and listing the entities the workspace can see; and a **Plugins** panel, headed by **Add plugin** and **Generate entities** and listing the embedded and configured Wasm plugins. Those first rows are part of the panel's own list: each is labelled and carries its icon, so it is visible without pointing at anything, pressing it runs the operation, and collapsing the panel folds it away with the rest. They are there whatever the list below them reads — including when it says nothing is configured, which is exactly when adding the first one is what you came for, and when it says no Aggrega workspace is available. Where one cannot run yet, it stays where it is and says why beside its name, in the words the Commands panel uses for the same state, and pressing it runs nothing. Each of those three panels also carries a refresh in its title bar, which re-reads that one list, and nothing else — an operation there would be an unlabelled icon you had to hover to find. Validate, build, preview build and lint report into the Problems panel; the command-line-backed operations stream their output to the Aggrega output channel.
- **One settings surface, reached from a cog** — the Commands panel carries a cog at its top right, and it opens the editor's own settings narrowed to this extension. There is no second settings page of the extension's own, so a preference has one place it lives and one place it is written. Every preference is yours rather than the project's; see [Settings](#settings).
- **Two shapes for the Commands panel** — `aggrega.operations.layout` chooses between `buttons`, the default, where every operation is a labelled button in one continuous flow with no group titles at all, and `sections`, where each group is a section you open under its own title and the panel shows as much as you keep open. Both carry the same groups with the same operations, in the same order; the setting changes how a group is drawn, never which operations exist. In both shapes the **Project folder**, **Aggrega workspace** and **Release** rows sit above every operation, so closing a section never takes away the facts that say what an operation would apply to. In `sections` the caret beside **Build** is a row of its own beneath it, reading **Build options** ahead of its chevron, so it does not read as a section to open. Changing the setting redraws the open panel and restarts nothing. The Commands panel opens with a larger share of the side bar than the three panels beside it — in a window 900 pixels tall, enough to show its whole flow at the side bar's default width; the editor keeps the panels' heights for each workspace from then on, so a workspace whose side bar has been laid out before keeps the heights it had.
- **A button that offers a choice presents it beside itself** — an operation that answers a press by asking which one or which entity to act on presents that choice as a menu beside the button you pressed rather than in a dialog that takes the whole window: **Cache…** offers the four cache operations, and **Inspect** and **Push** offer the entities the workspace can see. The menu opens beneath the button or above it, on whichever side the panel has more room, and is no taller than that room, so it never runs past the panel's edge — a list longer than the room scrolls inside it — and its name, what it is choosing, stays at its head while you scroll. That holds wherever the panel is, docked in a short side bar included. The menu is reached by pressing the button and never by tabbing, so the panel still costs one stop however many menus it holds. Inside it, the arrow keys move between the choices and **Enter** takes the one you are on; **typing narrows the list** — the match is a fragment of a choice's name or of the line beneath it, and the menu says how many are left — **Backspace** unwinds what you typed, **Escape** closes the menu and puts your focus back on the button, and pressing anywhere else — in the panel or anywhere else in the editor — closes it without running anything. The same operations are in the editor's command index, where there is no button for a menu to open beside, so invoked from there each asks its question as a list you pick from.
- **A menu whose choices are asked for says it is reading** — the menus **Inspect** and **Push** open hold nothing until the language server answers which entities the workspace holds, which is a read that shows progress and can be stopped. Both open with a line saying they are reading and fill in when the answer arrives, rather than opening empty: an empty list of choices reads as *there is nothing*, which is a different answer from *wait*. Whatever you typed while the read was in flight still applies once the choices arrive. Where there is nothing to offer — no entity the operation can name — the menu closes and a message says so, the same message you get running the operation from the command index, rather than a menu with nothing in it.
- **Choosing and consenting stay different acts** — a menu is where you say *which*, and it never carries a confirmation. The three cache operations that remove something still put a modal confirmation in front of you after you choose, naming the caches that operation reaches, and generating Plugin entities still confirms before writing. A confirmation earns its interruption: folding one into an inline list would let a stray click empty a cache. The published-catalog search keeps its filter list, which you return to after editing each facet, because a menu is a poor fit for something re-entered after every answer.
- **What separates one group from the next, in each shape** — in the flow, nothing is drawn between one group and the next: the groups decide the order the buttons come in, and the order is all that carries the grouping, so the panel spends no width on a divider. In the sections shape, the **Publish** group carries a rule above it, because its operations change what everyone resolving that catalog gets while the rest act on this machine — a difference in kind, which is worth marking once and has a group box to be marked on.
- **A narrow panel wraps rather than truncating or scrolling sideways** — the flow takes as many lines as the width needs, and no break is fixed in place: widen the panel and the buttons repack onto fewer lines. Each button's label is the operation's name alone, with the explanation on its hover, so a line carries as many operations as it can. Nothing is hidden behind a sideways gesture, and no label is cut short.
- **Every operation asks for what it needs before it runs** — an operation the panel can see is not runnable stays in place, greyed, and says why: hovering it names what is missing, and a screen reader announces it as unavailable with the same reason. It is not removed, because in a flow of buttons removing one moves the others under your pointer, and a press then lands on something other than what was there a moment ago — which is also why the caret beside **Build** stays beside it while Build cannot run, greyed with it, giving the same reason and opening nothing. Two conditions grey a control: the operations that act on a Release need one selected, and the ones that run the `aggrega` binary need an anchored workspace folder to run in. An operation that needs only the language server is not greyed when the server is down — it reports the compiler's own message when pressed, and the status bar is where that state is named. Push, sign and deprecate each ask for their subject first: push offers the entities the Catalog panel lists that have a document in the workspace, while sign and deprecate ask for a reference to an artifact already in a registry, because that is what those two amend. Deprecate also asks for a severity and a reason, which the compiler requires and has no way to ask you for from inside the editor. Pull runs against the selected Release rather than asking for a subject. The operations heading the Registries, Catalog and Plugins panels ask in the same way: adding a registry asks for the host and which configuration file to write it to, adding a plugin asks the two or three questions its type needs, generating Plugin entities asks what to cover and where to write, the published-catalog search opens a filter list you assemble before it runs, and drafting an entity asks for the kind and then a name. Each of them but **Draft entity** needs an anchored workspace folder, so without one each such row says so beside its name and pressing it runs nothing — you are told before you answer anything rather than after. **Draft entity** needs only the language server, so it is never drawn as unable to run.
- **Registries panel detail** — each row names the registry's host, its alias where one is configured, which registry is the default, whether signatures are required for artifacts pulled from it, and whether a credential for that host is present. Reading the list contacts no registry: the credential state reports presence only, so it says a credential exists rather than that the registry would accept it. The operations acting on the whole set are the panel's first two rows — **Add registry**, and **Update index**, which updates the searchable index of every configured registry — while the operations that act on one registry are on that registry's row: update the index for it alone, remove its stored credential, and remove the registry. The panel's own title bar carries only the refresh. Adding a registry and removing one each ask which configuration file to change, offering the global file shared by every project on this machine first, because that is where these two write unless you say otherwise; the other choice is this project's own configuration file. Each of the two ends by naming the file it actually changed and how far that file reaches, read off what the compiler did rather than from what was asked for. The language server reads its configuration when it starts, so each of the two is followed by a restart of the language server, without asking, and the panel and the welcome page's registry step are read again once it is back: the registry you added is listed, or the one you removed is gone, with no reload and no refresh. Once the restarted server has read the change, the ending adds that the change is now in effect; where the restart failed, it does not, because the change is then in the file and not yet in force. Removing a registry and removing a credential each ask you to confirm first, and each says what the change reaches: the confirmation for a registry names the file you chose, so dropping an entry from the global file is described as affecting every project resolving through it and dropping one from this project's own file as affecting no other project, while a credential is deleted from the shared credential store and the registry entry is left in place. Removing a credential offers no choice of file, because the credential store is shared by every project on the machine and has no per-project form to write to. Building the index shows progress and can be stopped, and it is the only one of these offered with a Cancel button. Pressing it ends the walk itself rather than only the editor's waiting, and the build ends by saying it was stopped. Each registry's records are written only once its own walk finishes, so a stopped build leaves indexed the registries whose walks had finished, and the registry it was walking keeps the index it had before, unchanged — so it is a stop rather than an undo. A build that runs to its end names how many entities were indexed from how many registries and the directory the index was written under, which is what says a refresh changes nothing another project on this machine resolves through, and a registry it could not index is named with the compiler's own reason: one it could not reach is said to be not reached — **⟨registry⟩ could not be reached:** ahead of that reason — and one that answered and failed otherwise, such as one whose repository listing repeated itself, which ends that registry's walk rather than being followed round again while the other registries are still indexed, is said to be one that could not be indexed; the closing sentence names the two groups apart. Updating the index of one registry that cannot be reached ends the same way, naming it as not reached. Adding a registry reaches the network too, since it fetches the trust policy the registry advertises, and it is offered without a Cancel button; either way it ends by naming the file it wrote. A registry that could not be reached is named as not reached in that ending, ahead of the compiler's own reason, rather than said to advertise no policy — the official hub included, whose entry then carries its built-in baseline. Where a registry other than the official hub advertises no trust policy or could not be reached — or, with the workspace offline, is refused because none could be fetched — the ending is followed by a question offering to pin one by hand, with exactly what the command line's `--identity` and `--key` take for that case: keyless identities, each written `identity=issuer` and typed one at a time, a public-key file chosen in a file dialog, both, or neither. What you supply is registered again for the same host in the same file, and that ending says what kind of policy the entry now carries without repeating the identities or the file; a malformed identity, or a key file that cannot be read or is not a public key, ends in the compiler's own refusal. The refusal of a file that is not a public key names what the compiler expected and leaves out what the file holds, so a private key chosen by mistake appears neither in the notification nor in the Aggrega output channel. Pressing Escape at any of these prompts, or choosing Neither, pins nothing, and what stands is what the command line leaves when given neither flag. A registry whose advertised policy was pinned, and the official hub on its built-in baseline, are not asked. Removing a registry, removing a credential and reading the list contact no registry. Signing in to a registry is not offered from the panel, because the command reads a password from a terminal and there is none behind a button — run it from a terminal and press refresh.
- **Topology graph** — renders the selected Release's compiled IR as an interactive graph: boundary and subsystem containers, each boundary or subsystem declared inside another drawn inside it, provenance-styled edges, pan and zoom, click-a-node to select it and double-click to open its source file, and click an edge to select the connection it draws. Each container's title names its kind as well as its grouping, so the outer box and the inner one read apart even in a workspace that declares neither — where both would otherwise carry the same name. A grouping nobody declared, which the compiler creates for components a Release or an Aggregate lists at the top level, is titled as declaring none, and its box is drawn apart from a declared grouping's — a dotted, neutral border — so it does not read as a grouping of that name; one you declared keeps its name whatever it is, `default` included. Each edge carries an arrowhead at the end it points to: an edge runs from the consuming component to its target, and the arrowhead is drawn in the edge's own colour and dash. A node's box is sized by measuring the text it draws, both the node's name and the component beneath it, so neither runs past its border however long the component name is. A legend at the lower left names each grouping by the document that declares it — a boundary by the Release, a subsystem by the Aggregate — and, where the drawing has one, the box holding the nodes in none, with what it holds; it says which end of an edge is its target; and it names the colour bar down a node's leading edge and each colour the drawing gives it, beside the `component.aggrega.ai/type` value that colour stands for exactly as the label is written, with a row for nodes carrying no such label where there are any. It says what those colours do not mean: they are assigned as each graph is drawn, so they group nodes by type within one graph and the same colour in another graph is not the same type. The legend stays where it is whatever you do to the drawing, so wherever the drawing is fitted to the panel — its first drawing, and each time you ask for the graph — it is fitted to the part of the panel above the legend: within the panel's whole width and the height left above the legend, centred from side to side, so the legend covers none of the drawing however many rows it carries. In a panel too short to leave any room above the legend, the drawing is fitted to the whole panel. Selecting a node opens a panel listing what is attached to it: each attachment's Feature and resolved version, the slot it fills or that it fills no declared slot, the FeatureRecipe that realizes it, by name and version, when the compiled graph names one, where it came from, the labels it declares, and the values its author wrote. An attachment written on one of the component's connections — under `features:` on a `uses` entry, in the Aggregate or the Release — is not in that list: it is drawn on the connection it belongs to, as the compiled graph records it, and the node's panel says when its connections carry any. Clicking an edge selects the connection it draws and opens the panel on it, titled by the consuming component and its target and naming the socket and the alias, with that connection's attachments drawn as a node's are — each one's Feature and resolved version, the slot it fills, the FeatureRecipe that realizes it when the compiled graph names one, and its values — or a sentence saying nothing is attached to it. Selecting a node clears a selected connection and the other way round; **Escape** or the panel's close button clears either, and a redraw keeps the selection while the rebuilt graph still draws the node, or the connection from the same component through the same socket under the same alias. Below a node's attachments, under **May attach**, the panel lists the Features whose declared applicability that node's labels satisfy on the graph of the Release the panel shows — the Features declared by the documents in the workspace that Release reads, every one but those in a catalog directory only other Releases read, and those held by the catalog directories that Release builds against — each named with its kind and either the workspace file that declares it or the configured catalog it was resolved from. That list is what those Features declare they apply to, not a decision that attaching one will build — and when it is empty it says that no Feature's declared applicability matches those labels, which is a narrower statement than nothing being attachable. A request the language server could not answer says so in place of the list rather than leaving it blank. A Feature declared behind a link leading out of the workspace — a link to a directory outside it, or a link named like a YAML file that leads to a file outside it — is not offered, because the language server reads no entity through such a link, though your editor's file tree shows the Feature. Where the workspace holds such a link, a line under the list, or under the sentence standing in for an empty one, says so: **Features reached through this link are not offered, because it leads outside the Aggrega workspace:** followed by the link's path relative to the workspace — or **Features reached through these links are not offered, because each leads outside the Aggrega workspace:** for several, the links to directories first. It names the links the language server reports in the terms of the Release the panel shows, as the Catalog panel does in the selected Release's. Where that report cannot be read, the list is drawn without the line and the reason is written to the Aggrega output channel; a list that could not be produced carries no line. Each row carries an **Attach** control that commits it: the compiler is asked which document declares the selected component and where inside that document such an attachment belongs, and the entry is written there through the editor — so it joins the undo history, lands on the buffer you are looking at rather than on the last version saved to disk, and leaves the comments and formatting around it as you wrote them. Nothing is saved on your behalf; the edit is a change like any other, and the compiler re-validates it as it would after any edit. The graph redraws when you save, because the topology is compiled from the documents as they stand on disk and an attachment still sitting in the buffer is not yet part of one. The attachment is named after the Feature, and attaching a Feature already attached under that name is refused rather than written twice. A component declared inside a subsystem attaches by the same press as one declared at the top level, and for the same reason both work: the graph identifies a component by its position in the compiled topology, that position does not say which keys the component's author wrote, and so the extension asks rather than reconstructing — the answer names the document and the path to the block inside it, and both are carried into the edit as they arrived. Where there is no such place to name — an id the graph does not carry, a node it records no document for, or a component whose own block cannot be named in the document it was authored in — what the panel shows is the reason the compiler gave, not a wording of this extension's own. A selected connection's panel has a **May attach** section of its own: the slots that connection's socket declares, in the order the component declares them, each with whether it is required, whether what fills it handles sensitive material, the delivery it permits, its selector and its description, and under each slot the Features the language server answers may fill it on that connection — those whose declared applicability the consuming component's labels satisfy and whose own labels satisfy the slot's selector. Where no slot may be filled, the panel says why in the language server's terms — a Feature drew the connection, the socket is one the component does not declare, or the socket declares no slots — and offers nothing to attach. Pressing **Attach** under a slot writes the Feature under the slot's name, a `<slot>:` entry whose `type:` names the Feature, on that connection's entry in the document that drew the connection: the Release for a connection the Release drew, the Aggregate otherwise. A connection selected from its entry in a document, by **Aggrega: Attach a Feature to the connection at the cursor**, is written in that document instead — the Release, for the Release's own entry for a connection the Aggregate drew — and the panel's line under **May attach** then says the Feature is written on that connection's entry in the document the command was run in. The compiler is asked where that entry goes in that document, any part of the path the document does not carry yet is written with it, and the edit lands in the editor as a node's does, unsaved. A slot the graph already shows filled on that connection is refused before anything is asked, and a refusal from the compiler is shown in its own words. A value the compiler reports as sensitive is withheld by the language server from the graph it sends, and withheld again by the extension before the graph is handed to the view at all, so it is not in the view to be shown — the panel names the field and says why it is withheld, and an attachment whose sensitivity marking is in a shape the panel does not recognise withholds every value rather than guessing at it. An attachment drawn on a connection is withheld by exactly the same rule as one drawn on a node, under the same setting. `aggrega.graph.showSensitiveValues` turns the withholding off for an author who needs to read back what they wrote: only while it is on does the graph request ask the language server for those values, and the settings page says what that displays. Nodes are laid out in deployment-wave order, so a boundary that declares a `syncWave:` appears ahead of the boundaries that wait on it. Hovering a node names its component and resolved version, its labels, its declared wave, and the catalog entity's own metadata — license, repository, home, keywords and maintainers — showing only the fields the entity actually declares. An open graph re-renders itself whenever an authored document in the workspace is saved, so it follows your edits without being reopened; it redraws on a save rather than on a keystroke because the topology is compiled from what is on disk. It redraws as well when the selected Release's lockfile is written — by **Aggrega: Pull**, by a build with Auto pull, or by `aggrega pull` in a terminal — because the graph is pinned against that lockfile, and it also redraws when the language server becomes answerable again, so a graph left open across a restart recovers on its own. A redraw you did not ask for leaves your view where you put it: the pan and zoom you had are kept, whether or not the rebuilt topology differs, so a node the rebuilt layout puts where it was stays under the same part of the panel, and one it puts elsewhere — an added component can shift the ones around it — moves within the view you kept rather than taking the view with it. That includes a redraw that lands while the graph is behind another tab, which you come back to as you left it. **Aggrega: Show topology graph** fits the drawing to the panel again, which is the way back to the whole shape after zooming into part of it. A large topology is fitted whole rather than cropped, so a big one arrives small: you see how it is put together, and reach the names by zooming in. Where two or more groupings held in one box lay out taller than they are wide, they are drawn next to one another rather than stacked in one column, so a large topology uses the panel's width and its first fit draws it larger than a single column would let it. A rebuild the compiler refuses keeps the drawing you had rather than blanking it — the topology is still worth reading and still where you were working — and dims it, so a drawing that is no longer current is not mistaken for one that is; the notice above it carries the compiler's own reason. The drawing comes back to full strength as soon as one is built. Layout is computed in the view; the compiler ships topology, never coordinates.
- **Plugins panel detail** — each row names the plugin, its type and version, and its readiness where the plugin carries one. A plugin the compiler could not resolve or describe is marked and keeps its own row, with the compiler's message in the tooltip, so it is never mistaken for one that is working. The tooltip also names the configuration key an attachment came from, its capabilities, its input kinds, its boundary and its exports — showing only what the listing actually reports. The operations acting on the whole set are the panel's first two rows — **Add plugin**, and **Generate entities**, which writes Plugin catalog entities — and the panel's own title bar carries only the refresh. Adding asks which type of plugin, as a list you pick from, then the one further answer that type requires: the capability a `provider` binding serves, or the role a `governance` attachment is bound at, and last the name to search the configured registry for, which must resolve to exactly one plugin of that type; the attachment is written to this project's workspace configuration. Adding is the one operation here that reaches the network, since it searches the registry, so it shows progress and can be stopped. Where a published version of the plugin has been withdrawn, adding ends by saying so rather than leaving it to be found: the versions retracted and not selected, the reason recorded against each, and where the withdrawal records were read from and when they were last updated, showing only what the compiler reports — and where those records could not be read at all it says that instead, carrying the compiler's own reason, which is a different answer from nothing having been withdrawn. Generating catalog entities asks whether to cover every plugin built into the compiler or one plugin artifact on this machine, also as a list you pick from, then for the authored overlay to merge and the directory to write under, and confirms before writing: each entity is written at a path derived from its plugin's type, name and version, so an entity already there for that same plugin and version is replaced. Removing a plugin is on that plugin's row. It asks you to confirm first and says which configuration file it writes, because that depends on the plugin's type — a `cli` plugin is removed from the global configuration shared across every workspace on this machine, every other type from this project's own — and it operates on the configuration text alone, so nothing else on this machine is removed. Removal is offered only on a configured plugin the compiler answered for: a plugin built into the compiler is no configuration entry at all, and an attachment nothing could resolve or describe arrives carrying no type, which the removal needs alongside the reference — so on those rows it is withheld rather than offered as a control that could only report a missing argument. Adding a `cli` plugin is not offered from the panel, because installing one confirms its declared capabilities at a terminal and there is none behind a button — run it from a terminal and press refresh. Syncing a plugin entity's machine-owned records is not offered either: it takes the entity file and the `.wasm` artifact as two paths, and a row names neither.
- **Catalog panel detail** — the entities the workspace can see, grouped under a heading per kind, each row naming the entity and the labels it declares, with its apiVersion and its description in the tooltip. The rows come from two places and each says which. An entity declared by a document in the workspace carries that document's path in its tooltip, and clicking the row opens that file. An entity resolved from a catalog directory — the `catalog/` directory at the workspace root, and the ones your configuration names for the selected Release under `workspace.releases` or, where it names none for it or none is selected, for the whole workspace under `workspace.catalog_dirs` — is marked as coming from there and carries no path: the workspace holds no file of its own for it, so the row names where it came from instead of offering a click with nowhere to go. The list is the selected Release's: a document under a directory your configuration names only for other Releases is left out of it, so where each Release reads a variant of one entity from a directory of its own, the panel lists the selected Release's variant alone. With no Release selected every document in the workspace is listed. A document declaring no `kind:` or no `metadata.name:` is not listed, which is what keeps the panel an index of entities rather than of files. The language server reads no entity through a link leading out of the workspace — a link to a directory outside it, or a link named like a YAML file that leads to a file outside it — so no entity behind one is listed, though your editor's file tree shows it. The one exception is a Release your workspace configuration names, as `build.authoring_release` or as a key of `workspace.releases`, which is read through its link and listed at the link's own place. Where the list leaves such a link out, a row of its own after the list says so: **Entities reached through this link are not listed, because it leads outside the Aggrega workspace:** followed by the link's path relative to the workspace — or **Entities reached through these links are not listed, because each leads outside the Aggrega workspace:** for several, naming the links to directories first and then the links to files. Hovering the row gives the whole sentence, since a long path is cut short in the row. With a Release selected, a link inside a catalog directory only other Releases read is not named, since nothing behind it would be listed for that Release anyway. The list is the language server's own answer, so it names the same entities the compiler reads — unsaved editor buffers included, ahead of the bytes on disk — and it is presented in the order the server sent rather than re-sorted here. The panel reads the list again on its own when the language server becomes answerable, when the selected Release changes, when a `.yaml` document in a folder the window has open is created, changed or deleted on disk — by the editor, a terminal or a checkout alike — and when the editor closes a YAML document. It asks only once the language server has dropped what it held for that file, so a file deleted while it was open in the editor leaves the list rather than being reported from the copy the editor last sent, a document renamed in a buffer and closed without saving is listed again as it stands on disk, and a burst of such changes and closes is one read. The editor closes a document when it lets go of it, which it does not promise to do the moment the document's tab closes, so a row drawn from the text of a document whose tab has closed can stay until the editor does. The panel does not follow your typing on its own. A change still in an unsaved buffer is sent to the language server once you pause typing in that document — each open document waits out its own pause, so typing in one never holds back another — and it shows the next time the list is read after that. Pressing the panel's refresh reads the list for every open document as the editor holds it at the moment you press, however soon after your last keystroke or undo: a change not yet sent is sent at once, and the list is asked for only once the language server has answered for every change sent to it up to the press. A folder deleted whole shows the next time the list is read, or when the refresh is pressed, since the editor may report it as one change to the folder rather than one to each document inside it. Searching the published catalog is this panel's first row, **Search catalog**: it asks for a filter and copies the reference of whatever you pick. Drafting a new entity is its second row, **Draft entity**: it asks for the kind, as a list you pick from, and opens the starter document in a tab without writing anything to disk. This panel's own title bar carries only the refresh. The operations that act on one entity are on that entity's row, and a row offers an operation only where the compiler accepts it for the row's kind. Which kinds each operation accepts is the language server's own answer, read again with the list each time, so the rows follow the compiler you are running rather than a list kept in the extension. Inspecting what an entity resolves to is the one reachable without opening the row's menu: it is addressed by the entity's name, which every row carries, so it is offered on a row whether or not the workspace holds a document for it, wherever the compiler resolves a name to an entity of that kind, and it changes nothing. Validating the entity, checking its publishing conventions and publishing it each take the entity's path, so they are offered only on a row whose entity is declared by a document in this workspace; a row resolved from a configured catalog directory has no path in this workspace to give them, and they are withheld from it rather than offered as controls that could only report a missing argument. Of those three, checking the publishing conventions is offered on every such row. Validating is offered where the compiler checks a document of that kind on its own: an Aggregate, for instance, is checked with the whole catalog when it sits in a catalog directory, and with a Release that deploys it, so its row offers no validation. It checks the entity in the selected Release's terms, as `aggrega validate <path> --release <Release>` does at a terminal, so what the entity refers to — the Component a Recipe implements, a library its schema composes — resolves through the catalog directories that Release builds against; with no Release selected, through the workspace's own. Publishing is offered where a document of that kind is published on its own, which leaves out a Plugin, whose publication also binds its executable, and a Manifest or a Release, neither of which is published. If the language server does not say which operations accept a row's kind, the rows are still listed and a row with a document offers only the conventions check; where the request for that answer fails, its reason is written to the Aggrega output channel. Publishing asks you to confirm first and says what the change reaches: the entity is bundled and pushed under its own declared version, and anyone pulling that version from that registry resolves what is published. Publishing is also the only one of these that changes anything beyond this machine; the two checks and the inspection write nothing and publish nothing. All four show progress and can be stopped.
- **Published-catalog search** — search the configured registries for catalog entities and copy a reference to paste into an Aggregate. The search is narrowed from a single list where each facet shows its current value: free text matched against name and description, one or more entity kinds, a label selector (category is a label), one or more plugin capabilities, a plugin socket, and a cap on how many results come back. A facet left alone narrows nothing. What you set is kept: the next search opens with the filter the last one left, whether it ran, matched nothing or was closed after an edit, so narrowing again is one edit rather than the whole filter entered anew. **Reset search filter**, the row just above **Search**, returns every facet to narrowing nothing and brings you back to the list without searching; its description names the facets it would clear, or says that nothing is set. The filter is held only while the extension runs in that window and is stored nowhere — it is in no setting, so another window searches from its own, and reloading the window, or anything else that restarts the editor's extensions, starts from an empty filter. Searching reads the local index written by `aggrega registry update` — **Update index** in the Registries panel — and contacts no network, so a registry whose index has not been built yet is not searched. The output channel says so on that registry's own line, with **Update index** to build its index, and says an index is stale on a line of its own, with **Update index** to refresh it; a search that matched nothing with such a registry configured names the registries it searched and the ones it did not; and where no configured registry has an index at all, the search reports the compiler's own message naming the step to run.

## Selecting a Release

Most of what the extension does is scoped to a Release: which catalog directories are read,
which components resolve, which lockfile pins apply, and which findings a document draws. The extension therefore works on
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
from the Command Palette). The change takes effect immediately — nothing restarts, every open
YAML file is re-checked against the Release you just picked, and the Catalog panel reads its list
again for it; the same follows when a Release is taken as the language server connects. Being remembered is local to
the editor window: choosing **writes nothing into your workspace**. Where your focus was on the
Commands panel as the chooser opened — on its Release row, or on any of its controls — it goes
back to that control when the chooser closes, whether you chose a Release or dismissed it;
opened from anywhere else, the chooser leaves the panel without the focus.

The Releases on offer are the ones inside the folder the language server anchored to, named
relative to it, because that is the form it accepts. Where a Release cannot be offered, the
editor says how many and where they sit rather than leaving them out silently. The language
server reads no Release through a link out of that folder, so a Release your editor's file tree shows
through a link leading out of it — a link to a directory outside, or to a Release file outside —
is not offered. The one exception is a link to a Release file that the workspace configuration
names, as `build.authoring_release` or as a key of `workspace.releases`: that Release is read
through its link and offered. Opening the chooser says so in a notification of its own, naming
by its path relative to that folder each such link standing where the language server would
otherwise read: the links to directories first, then the links to files. A link whose name
ends in `.yaml` or `.yml` is named whatever the file it leads to holds, because that file is not
read to find out.

When you want a choice recorded in the workspace itself — so a fresh checkout starts on it —
two commands do that, and neither changes what you are working on right now:

- **Aggrega: Set the selected Release as this workspace's default** has the language server
  write the currently selected Release into `.aggrega/active-release`. That file is local to
  your checkout, so it is the right place for a personal default. Where `.aggrega` or the
  marker is a link leading outside the Aggrega workspace, nothing is written, and the
  notification carries the compiler's own words for why.
- **Aggrega: Set authoring_release in .aggrega-config.yaml…** opens the configuration file so
  you can set `build.authoring_release`. That setting is committed and shared, and it outranks
  the marker file. Where the language server reports that the configuration file is a link
  leading outside the Aggrega workspace, the file is not opened, and an error says it leads
  outside the workspace, so Aggrega does not use it; the welcome page's control that creates a
  workspace configuration does the same with a file it finds already there.

If the workspace offers no Release — none configured, no marker, and not exactly one file to
fall back on — the indicator says so, and it says which of two things is true. It reads
**Release: none selected** where there are Releases to choose between and you are on none of
them, and **Release: none available** where the Aggrega workspace offered none at all. The
second is not a state you can answer by choosing, so its tooltip names the ways out of it —
work in a different Aggrega workspace, or create a Release — rather than sending you to a list
that can only come back empty. Where nothing has read the workspace yet, the tooltip says that
rather than reporting a count nobody took. Every one of those readings carries what was looked
for, and the full account is written to the Aggrega output channel. Validation still runs in that
state: you get the findings a document answers on its own — whether it parses, and whether its
own shape is admissible — and the checks that need a Release are skipped until you select one.

## When the language server is not running

**Every command this extension contributes exists from the moment it starts, whether or not a
language server is running**, and only one of them, named below, waits on a server before the
command index lists it. A command that only came into being once one had attached would be missing
from the command index in exactly the window that needs it most — the one where nothing is running
and you are looking for the way to start it.

**The status-bar indicator on the left is where you find out what is going on.** It reads
**running**, **starting**, or **not running** in red, and its tooltip says why: no folder in this
window is one Aggrega recognises, or there is one and the server is not attached to it. Clicking it
offers **Start** or **Restart** — whichever applies — and does it.

That indicator exists because a command that cannot run explains nothing: the command index leaves
it out rather than saying why, and no editor surface shows a tooltip on a disabled control. The
indicator is where the reason is written down, and it is also where you act on it.

**A start that fails says what is wrong with the compiler's path.** Where `aggrega.server.binaryPath`
names nothing, the notification reads **Aggrega language server failed to start: the compiler at
⟨path⟩ was not found.**; where it names a file that cannot be run, it reads **… ⟨path⟩ is not an
executable file.** Both go on to say to set `aggrega.server.binaryPath` to the aggrega binary, and
carry **Open binary path setting**, which opens the settings screen on that one setting, and **Show
output**. Any other failure to start gives the reason it was given, after the same opening, and then
names the compiler that was run and the setting that names it. The Aggrega output channel carries the
same account.

**Validate says the server is not running, and offers the way back.** Pressed while no language
server is running, it answers **Aggrega: the language server is not running.** — followed, where the
last start failed, by why, in the words that failure was reported in — with **Show output**, **Open
binary path setting**, and the status-bar indicator's own **Start**.

**The list panels say the server is not running rather than reporting a failure.** With no language
server running, the Registries and Catalog panels each draw **The Aggrega language server is not
running.** in place of their list, with the indicator's own tooltip, and pressing the row starts the
server. The Plugins panel's list comes from running the compiler as a command rather than from the
language server, so where that command could not be started its row says what is wrong with the path
in the notification's words, and pressing it opens the setting.

**Aggrega: Open status bar menu** is left out of the command index while no language server is
answering: everything it offers is an action on a running language server, and your editor does not
list a command that cannot run there. It comes back the moment one is answering.

**A command that works without one stays in the command index**, even though it concerns the server.
**Aggrega: Toggle the artifact-rendering stage while inspecting** writes a preference, and the server reads
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
- **Draft entity and inspect** end with the document open in a tab. **Show config** ends with a
  panel rather than a document, because what it reports is a list of settings to read down rather
  than a file to keep.
- **A long operation shows progress with a Cancel button.** That covers everything that reaches a
  registry, renders or resolves a Release, walks the catalog, or runs a plugin over your input:
  validate, lint, build, preview build, the topology graph, pull, inspect, push, sign, deprecate and
  import. Drafting a
  document, reporting the effective configuration and maintaining the caches are
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
  own caches are untouched. Afterwards a message says what was removed, and how much was left in
  place because another process has it open where there is any; declining says that nothing was.
- **Push, sign and deprecate say what is now true for consumers** — that the version you published is
  what others pulling it now resolve, that the signature is there to be verified, that the
  deprecation marker is what resolvers now see. Each names the registry it reached and whether
  anything actually left this machine, read off what the compiler did rather than off what was asked
  for, so a publication that landed nothing is never reported as one that did.
- **A failure shows the compiler's own message, with a button beside it,** never a re-worded summary
  in place of it. The compiler's message usually names what to run or what to fix, and the **Show
  output** button takes you to the full text in the Aggrega output channel. An operation that runs the
  `aggrega` binary and is refused names the status the binary exited with and then the words it wrote
  when it refused, unchanged, and the output channel ends with the same sentence, line for line. An
  inspection refused
  because of the document that declares the entity offers **Open document** instead, because that
  document is what the message is about and the channel holds nothing more.

## Settings

**The cog at the top right of the Commands panel opens them** — it is the editor's own settings
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
| `aggrega.getStarted.show` | `true` | Whether the [welcome page](#the-welcome-page) opens on startup. Three surfaces move this one setting and stay in step: the checkbox at the page's own foot, **Aggrega: Stop opening the welcome page on startup**, and **Aggrega: Get started**. Turning it off stops the page opening rather than removing it; turning it back on with **Aggrega: Get started** also opens it. |
| `aggrega.server.binaryPath` | `aggrega` | Path to the `aggrega` binary. |
| `aggrega.server.debounceMs` | `300` | Debounce window for proactive validate-on-change. |
| `aggrega.server.respawnAttempts` | `5` | How many times, within the window below, the language server is started again after it stops without being asked to, before the extension leaves it stopped and raises the stopped-responding notification. A server started again that stops before it has answered counts the same as one that stops while running. See [Lifecycle](#lifecycle). |
| `aggrega.server.respawnWindowSeconds` | `180` | Sliding window, in seconds, over which those restarts are counted. |
| `aggrega.server.restartGraceSeconds` | `5` | Grace window before the extension automatically restarts the daemon after a `binaryPath` change. The status bar shows a countdown; the quick-action menu offers Restart now and Cancel restart. |
| `aggrega.server.buildOnInspect` | `false` | Run the artifact-rendering stage while inspecting a graph, so the advisories `aggrega build` raises while rendering also appear as editor problems. It adds none of the checks a build halts on. Inspecting costs more when it runs; nothing is written to disk. |
| `aggrega.graph.showSensitiveValues` | `false` | Show the values a Feature declares sensitive in the topology graph, displaying a by-value credential in the clear; while it is on, the graph request asks the language server for them. Left off, the language server withholds them from the graph it sends, and they are removed again before the graph is drawn. |
| `aggrega.operations.layout` | `buttons` | How the Commands panel draws its groups — `buttons` puts every operation in one wrapping flow of buttons with nothing drawn between one group and the next, `sections` makes each group a section you open under its own title. Same groups, same operations, same order either way. |
| `aggrega.notifications.toastDebounceMode` | `time` | How often the notice that a Release has no lockfile is shown again for work you did not ask for, such as an open graph redrawn after a save: `time` shows it again once `toastThrottleSeconds` have passed since the last one closed, `session` shows it once until the language server restarts. A Build, a Preview or a graph you open that is refused for a missing lockfile always shows the notice. |
| `aggrega.notifications.toastThrottleSeconds` | `300` | Seconds after the missing-lockfile notice closes before it is shown again for work you did not ask for. Read only when `toastDebounceMode` is `time`. |

## Commands

- **Aggrega: Get started** — bring the [welcome page](#the-welcome-page) back after you have turned it off, and open it. It turns `aggrega.getStarted.show` back on, so turning the page off is a choice you can undo rather than a door that locks behind you. Ticking the checkbox at the page's foot turns the same setting back on and opens nothing: the page is the one you are on, so the checkbox keeps the keyboard focus and Space ticks and unticks it in turn. The house icon in the Commands panel title bar is a different thing: it opens the page and changes no setting, so a glance at the page is never also a decision about startup.
- **Aggrega: Stop opening the welcome page on startup** — stop the [welcome page](#the-welcome-page) opening on startup, by turning `aggrega.getStarted.show` off in your own settings. This stops it arriving unasked rather than putting it out of reach: **Aggrega: Get started** brings it back. Unticking the checkbox at the page's foot runs this same command, so the decision can be taken from where the page is being read as well as from the palette.
- **Aggrega: Open settings** — open this extension's preferences. Also the cog at the top right of the Commands panel. It opens the editor's own settings page filtered to this extension, so there is one place a preference lives and one place it is written. Distinct from **Show config**, which reports what the *compiler* resolved for the workspace rather than what your editor is set to.
- **Aggrega: Select Release…** — choose the Release the editor works on. Takes effect at once, re-checks the open files against it and has the Catalog panel read its list again; nothing restarts. Also reachable by clicking the Release indicator in the status bar. See [Selecting a Release](#selecting-a-release).
- **Aggrega: Set the selected Release as this workspace's default** — record the selected Release in `.aggrega/active-release`, so a later session starts on it. The language server writes the file, and refuses, in its own words, where `.aggrega` or the marker is a link leading outside the Aggrega workspace. Local to your checkout, and it does not change the current selection.
- **Aggrega: Set authoring_release in .aggrega-config.yaml…** — open the configuration file to set `build.authoring_release`, the committed default a team shares. It outranks the marker file. A configuration file the language server reports as a link leading outside the Aggrega workspace is not opened, and an error says why.
- **Aggrega: Start or restart the language server** — starts the language server where none is running, and where one is, terminates it and spawns a fresh one, resetting the respawn-attempt counter. It is never left out of the command palette: starting is what it does, so withholding it while nothing is running would withhold it in the one situation that needs it. Also reachable by clicking the language-server indicator in the status bar. Where no folder in the window is one Aggrega recognises, it says so rather than appearing to do nothing.
- **Aggrega: Toggle the artifact-rendering stage while inspecting** — flips the `aggrega.server.buildOnInspect` setting in place, so the settings UI always agrees with it, and offers the restart that applies it — the language server reads the setting when it starts. Also reachable from the status-bar quick-action menu, which shows whether the setting is currently on. The stage adds the advisories `aggrega build` raises while rendering, and none of the checks a build halts on. Findings arrive tagged with the layer that raised them, so the stage's advisories group apart from validation in the Problems panel and clear independently of it. The restart that applies the change empties the Problems panel and checks the open files again, so with the stage turned off its advisories leave it, and with it turned on they return the next time the graph is drawn.
- **Aggrega: Validate active file / Build / Preview build / Lint** — run the corresponding compiler operation through the language server. Build, preview build and pull act on the selected Release rather than asking each time. Build compiles the selected Release with every gate on and writes the artifacts it renders into a `dist/` directory in your Project folder, so they arrive beside the work you chose to open — or, where no Project folder is chosen or the one chosen is not inside your Aggrega workspace, into the `dist/` directory at the Aggrega workspace's root — and the build's closing line and its notification name the directory it wrote. `aggrega build` run in a terminal writes into the `dist/` directory at the Aggrega workspace's root wherever it is run, so with a Project folder below that root the editor and the terminal write into two different directories; preview build runs the same compile and reports what it would have written, leaving the output directory untouched. On the Commands panel the Build button carries a caret beside it, named **Build options**, opening the options that apply to the next build — **Auto pull** resolves the selected Release's dependencies into the lockfile before rendering, and it is off unless you turn it on, which is the command line's own default for the same choice. While Build cannot run the caret stays where it is, greyed, and pointing at it gives Build's reason; it opens nothing until Build can run. Each option carries a box beside it — empty while it is off, ticked while it is on — so you can read its standing without pressing anything, and the sentence saying what turning it on does appears while you are pointing at the row or have reached it with the arrow keys. Turning an option runs nothing and leaves the list open, so you can turn another; pressing Build — or the caret again — puts the list away. Options last for the session and are written nowhere, so closing the window discards them, and they belong to Build alone: preview build reports what a build would write while writing none of it, and resolving dependencies writes the lockfile, so it takes no options at all. Both put the findings that carry a document position in the Problems panel, tagged with the layer that raised them — a refusal the compiler raises while rendering among them, filed on the document it names, such as the Recipe whose Workload it refused, with its short code opening the page explaining it, while the build or preview ends in the compiler's own words on the output channel and in a notification — and write the advisories that name no position — a withdrawn pin, an unresolvable parent — to the Aggrega output channel along with the artifact list. Closing a file takes its own findings out of the Problems panel and leaves standing what a build, a preview or a graph found in it: those are about the Release rather than about the file you had open, so they stay until the compiler stops reporting them. A Build, a Preview or a graph the compiler refuses because a dependency does not resolve puts that refusal in the Problems panel too — on the document the compiler names, or on the Release where it names none — and it stays through that file's opening and closing, until the next Build, Preview or graph of that Release is answered without it. A build with Auto pull writes, ahead of those, what its dependency resolution did: one line for each reference it pinned, with the version it resolved to, its kind where the compiler names one and, where the compiler reports it, where this run took the reference from, in the word `aggrega pull --detail` prints for it — `fetched-fresh`, `cache-reuse`, `local`, `in-binary` or `external` — and then the summary `aggrega pull` prints at a terminal, `Pull complete:` followed by the lockfile written, named from the workspace root, and counts of what the resolution recorded. Lint checks publishing conventions and places each finding in the Problems panel, so clicking one opens the entity it concerns. Each is tagged with the short code `aggrega lint` prints for the rule that produced it, and the tag opens the page explaining that code; a rule that has no short code is tagged with its own name instead. A finding located to a file but not to a line sits at the top of that file rather than at a guessed position, and every finding is written to the Aggrega output channel as well, beneath the document it concerns, as the line `aggrega lint` prints for it: its severity, the rule's short code, the rule's own identity and the rule's own wording, unchanged. Where your configuration gives its Releases catalog directories of their own under `workspace.releases`, Lint checks the catalog once for each Release, over the directories that Release reads — Releases reading the same directories are checked together — and reports each check on its own: the output channel opens it with the line `aggrega lint` opens it with, naming its Releases and the directories read, and lists its findings beneath; the closing notification states what each check found and over how many entities, for its own Releases; and each Problems entry ends by naming the Releases whose check found it, so a finding in a directory two checks read is listed once for each. All four report how many findings they produced, including when the answer is none, so a clean run is distinguishable from a command that did not run; all four show progress with a Cancel button while they work.
- **Aggrega: Pull** — run the `aggrega` binary against the selected Release and stream its output to the Aggrega output channel. It resolves the catalog and source dependencies the Release declares into the cache and writes the per-Release lockfile, recording in that lockfile the external inputs the Release's render consumes, so a later build serves them from the local store. It reaches a registry, so it shows progress with a Cancel button, and it ends in a message saying what it did. A Build, a Preview or a graph you open that the compiler refuses because the Release has no lockfile ends in one notification, `Aggrega: <release> has no lockfile.` followed by the compiler's own sentence, with a **Pull** button: pressing it runs this command, with the binary the extension is configured with, for the Release the compiler named — or for the selected Release where the compiler named none — and the output channel carries the compiler's sentence in the line the operation ends with. A redraw you did not ask for, such as an open graph redrawn after a save, raises the same notice at most as often as the two `aggrega.notifications` settings allow. Whatever writes the selected Release's lockfile — this command, a build with Auto pull, or `aggrega pull` typed in a terminal — the open files are checked again against it, and a warning that the lockfile has drifted leaves the Problems panel on its own once the write has resolved it: a graph open on that Release is redrawn, which checks the lockfile again, and where no graph shows that Release — none is open, or the one open is still showing a Release you selected before — the extension asks for its graph once without drawing anything. Only the selected Release's lockfile is followed this way, and only inside the folders the window has open; a warning on another Release's lockfile stays until you show that Release's graph.
- **Aggrega: Draft entity…** — choose a kind from the ones the compiler answers for, then ask the language server for a starter document and open it in a new unsaved tab. The kinds are asked for rather than kept in the extension, so the choice follows the compiler you are running: a kind it gains is offered without this extension being changed. You read the name your document will carry, and the draft is asked for by the compiler's own token for that kind — and the prompt that then asks for a name says which kind it is naming, in the same words you just read. Nothing is written to disk: the draft is yours to edit, save or discard. An invocation naming a kind the compiler does not recognise — a keybinding or a recorded workflow can carry one — comes back with the compiler's own message naming the kinds it does. It is also the second row of the Catalog panel, **Draft entity**.
- **Aggrega: Inspect…** — choose an entity the workspace can see and see what it resolves to, opened as a new tab. An inspection is addressed by name, so an entity resolved from a configured catalog directory is offered here as well as one the workspace declares. It resolves in the selected Release's terms, and the entities on offer are the ones the Catalog panel lists for that Release: a name several variants declare, one per Release, resolves to the selected Release's, and a name that Release does not resolve is reported as not resolved, with the compiler's reason, which names that Release's entry under `workspace.releases`. With no Release selected it resolves through the workspace's own catalog directories. Where a document in the workspace declares the entity and the catalog resolved nothing from it — the document breaks its kind's schema, say, or sits outside every catalog directory — the notification says the entity cannot be inspected because of the document that declares it, followed by the compiler's own sentence saying what is wrong, and its **Open document** button opens that document; the Aggrega output channel carries the same sentence. An inspection refused for any other reason ends as any failed operation does. Reading which entities the workspace holds shows progress and can be stopped, and so does the resolution that follows. Pressed on the Commands panel, the entities are offered as a menu beside the button; run from here, they are offered as a list you pick from. The inspection a Catalog panel row offers is this one, and it ends the same way.
- **Aggrega: Import…** — draft Aggrega authoring files from a source another tool wrote. It asks for the source first, and reads only the file you name — no other files and no network. The file may sit anywhere on this machine, because it is a file you pointed at rather than one the workspace holds; the drafts always land in the workspace. It shows progress with a Cancel button, and pressing Cancel stops the conversion rather than only stopping the editor waiting, because the importer runs as a plugin the compiler can unwind mid-run. The ending says what the source was recognised as, how many files were drafted and where they went; the importer's own findings go to the Aggrega output channel, because they name a place in the source file rather than in a document you authored.
- **Aggrega: Cache…** — choose a cache operation, then run it through the language server. Pressed on the Commands panel, the four are offered as a menu beside the button; run from here, they are offered as a list you pick from. Nothing is spawned, and each answer comes back as a structured result the panel reports: **status** lists every cache, what it holds and how far each one is shared, and removes nothing; **prune** removes the entries no lockfile references and names what it kept, together with anything it had no basis to reclaim and the operation that would; **evict** asks for a size cap first — a byte quantity such as `5GiB` or `512MiB`, or a byte count, read by the same parser the command line uses — and trims the shared compiled-module cache down to it; **clear** empties every cache. The three that remove something ask you to confirm first, and each confirmation names the caches that operation actually reaches: emptying and pruning reach this workspace's own entity, source-artifact, external-input and documentation-bundle caches *and* the compiled-module and plugin-describe caches every project on this machine shares, while trimming reaches only the shared compiled-module cache. Every size these operations report is written in the same vocabulary that cap is read in, so a figure you read off a cache report is one you can type straight into the cap prompt. A cap the compiler cannot read comes back with the compiler's own message naming what a size cap looks like. Cleared and trimmed caches repopulate on the next build that needs them. Windows refuses to remove a file another process has open, and a prune, a trim or an emptying then leaves it in place and goes on with the rest rather than failing: the Aggrega output channel names each entry a prune or a trim left, with its class, how far it is shared and its size, and gives, under each cache an emptying reached, how many files it left there and their size; the message the operation ends in says how many were left in place, asks you to run the operation again once that process has finished, and points you at the channel for which. Where nothing was left in place, which is every run on a platform that removes an open file, neither says anything about it.
- **Aggrega: Push… / Sign… / Deprecate…** — the operations that change what other people resolve. Push asks which of the entities the Catalog panel lists to publish — a menu beside the button on the Commands panel, a list you pick from when run from here — then bundles and publishes it to a configured registry. Sign and deprecate ask for a reference to an artifact already published, because both amend published bytes rather than the workspace: sign attaches a signature, deprecate attaches a signed deprecation marker and asks for the severity — `warning`, `error` or `retracted` — and the reason it records. All three go to the language server, all three show progress with a Cancel button that ends the publication rather than only ending the wait, and each ends by naming what the compiler actually did: the reference and version the entity resolved to and the digest that version now points at, the digest each signature commits to, or the marker's own digest. A publication that found the same bytes already published says so rather than reporting as one that landed something. Their findings and the full account go to the Aggrega output channel.
- **Aggrega: Show config** — open a panel listing every setting the configuration schema declares, generated from that schema so the settings, their names, their defaults and what they accept have exactly one home and a new one appears with no change here. The panel opens as a table with **a row per setting**, beneath a heading row for each group of the configuration — `workspace`, `build`, `plugins`, `mcp`, `signing` and the rest — with the settings at the top level first. Each row carries the setting as you would write it in the file, its name in words, its value, what the setting accepts, and where the value came from. The name is derived from the key: an acronym is spelled in capitals, and where two settings' names would read alike, the group each sits in is added, so no two rows share a name. The one value column says what applies now: a value set in a file or the environment, or one that is not the schema's declared default, is marked ●, and pointing at the mark says why and what the declared default is — which is how you find the settings you have changed; a setting with no value in force reads *none*, and an empty list reads `[]`. A list's additive companion — `workspace.catalog_dirs_append` beside `workspace.catalog_dirs`, say — has no row of its own: it is named under its list's path, and the list's row shows the one value and the one source the compiler's report gives the two together, which does not say which entries the companion added. A setting that belongs to the machine rather than to one project — a registry and its signature trust policy, the compiled-module cache, the command-contributing plugin list — is marked **Global** on its row. The setting's own description sits behind a small circle marked *i* in the last column, headed **Description**, which keeps the longest thing a setting carries off the row: press it or hover it to read the description, any code it names drawn as code. A setting path breaks only after `_` or `.`, and a value or a file path only after `/`, `.` or `_` or at a space, so nothing is cut in the middle of a word. The table is still wider than a docked panel and scrolls sideways there, and the setting's own key stays in view while it does, so the value you scroll to always has the setting it belongs to beside it; the caption above the table wraps to the panel's width. Each labelled column heading has a resize corner at its right edge: drag it to widen or narrow that column. Widening a column does not widen the table, so the column follows the pointer while the other columns have room to give and stops once they are all at their narrowest; where the panel is too narrow for the table even at its narrowest — docked in the side bar, say — every column is already there and the corners move nothing. A column stops narrowing at the widest run it cannot wrap — its heading, a word of a setting's name, or the part of a path or a value between two places it may break — and the setting column keeps a minimum width of its own; everything else in a narrowed column wraps inside it rather than running into the next. The panel runs no script, and three limits follow from that: a width you set lasts only until the panel is drawn again, so switching to the other shape, pressing **Show config** again or reopening the panel draws every column afresh at the width the table gives it; a column cannot be fitted to its content on request, by a double-click or otherwise; and the corner is reached with the pointer, not the keyboard. A control above the table switches to a second shape that gives each setting a block of its own, with its description and its reach shown in place and the rule for the **Global** marker stated at its head, and the shape you last used is the one the panel reopens in. Each setting shows the value in force and, where the compiler can say, which file that value came from. The compiler's report attributes each setting, a list's companion on its list's own row; where it names a setting nowhere — a report that could not be read, say — the panel says so rather than implying a source it does not have: such a setting is shown with its declared default, marked as the declaration rather than as a reading, and no source, and the box at the head of the panel names each one. Pressing **Show config** with the panel open brings it to the front and reads the configuration again. Where the configuration cannot be read, the press closes the panel, whether it was open or not, and one notification says why; where the reason is that the language server is not running, the notification offers **Start**, which runs **Aggrega: Start or restart the language server**. **The panel reports; it does not write.** Changing a setting is an edit to the configuration file.
- **Aggrega: Show topology graph** — open the topology graph for the selected Release. Drawing it compiles that Release to its topology, so it shows progress with a Cancel button.
- **Aggrega: Attach a Feature to the connection at the cursor** — attach a Feature to a connection from its entry in your document. It is in the editor's context menu and in the command palette, and only in a document the language server reports as one of the workspace's Aggregates or Releases. It asks the language server which connection's entry the cursor is inside, in the selected Release's terms as the other cursor features are: the entry a component draws a connection with, under the connection's alias, or the entry a Release writes for one. On such an entry it opens the [topology graph](#features) on the selected Release with that connection selected, and you attach from its **May attach** section as after clicking the connection's edge, except that the entry is written in the document you ran the command in. Anywhere else it opens nothing and says why: the cursor is not inside a connection's entry, a Feature drew the connection, or the Release's entry is for a connection its compiled graph does not carry. With no Release selected it offers to select one, as **Aggrega: Show topology graph** does, and a refusal from the language server is shown in its own words. Unsaved changes are sent to the language server first, so the cursor is read against the text you see.
- **Aggrega: Search published catalog** — open the filter list, narrow the search by free text, kind, labels, capability, plugin socket or a result cap, then run it and copy a matched reference. Each facet is editable in any order and returns to the list, so the whole filter is readable before it runs. For as long as the extension runs in the window, the list opens with the filter the last search left, and **Reset search filter**, just above **Search**, clears every facet without searching. A search that matched nothing names the filter it ran and, where a configured registry has no index yet, the registries it searched, then the ones it did not and how to build their index; that is a different answer from an index that could not be read at all — the second reports the compiler's own message and the full text goes to the Aggrega output channel, together with the freshness line naming each registry searched and when its index was last updated. It is also the first row of the Catalog panel, **Search catalog**.
- **Aggrega: Refresh plugins** — reload the Plugins panel.
- **Aggrega: Refresh registries** — re-read the configured registries. This contacts no registry, so it is cheap to repeat.
- **Aggrega: Refresh workspace catalog** — re-ask the language server which entities the workspace can see. This reads the workspace the server already has open and contacts no registry, so it is cheap to repeat. The panel asks again on its own when the language server becomes answerable, when the selected Release changes, after a document is created, changed or deleted on disk, and after the editor closes one, so this is for what none of those covers, such as a change still in an unsaved buffer. It sits in the Catalog panel's title bar, which is the one thing there: it re-reads that list rather than acting on what the list holds, so it belongs to the panel rather than to the workspace.

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

Four of this package's spec files drive the extension against a real `aggrega`
binary, which means building the compiler from that same sibling tree. That
build is off by default, so `npm test` does not pay for it: those specs stand
down and each says which coverage it skipped. Set
`AGGREGA_EDITOR_COMPILER_FIXTURE=1` to build the binary and run them. The
binary is stamped with the sibling tree's own version and commit, as the
compiler's build scripts stamp it, and is built again whenever either moves.

### The end-to-end suite

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

## Lifecycle

The extension manages the daemon process's full lifecycle. When it stops the daemon — the editor closing, the language server moving to a different Aggrega workspace, or no single workspace being left for it to attach to — it first asks the daemon to exit cooperatively, which lets in-flight work finish. If the daemon is still working when that grace window closes, it is asked once more — this time to abandon that work rather than finish it. If it still has not exited, the extension falls back to OS-level termination. A restart — the restart command, a change of `aggrega.server.binaryPath`, or a configuration change the extension made itself — does not ask: it terminates the process at the operating-system level and starts a fresh one. Each of these steps is reported to the Aggrega output channel, so a slow shutdown shows which step is taking the time and whether the daemon answered at all. The semantics are identical across POSIX and Windows hosts. See `src/daemon.ts` for implementation detail.

**A language server that stops without being asked to is started again, a bounded number of times.** When a running server ends, the extension starts a fresh one; if that one ends too — as it starts, before it has answered the extension's opening request, or once it is running — it is started again in turn, up to `aggrega.server.respawnAttempts` restarts within `aggrega.server.respawnWindowSeconds` seconds. The end after the last of them leaves the server stopped and raises **Aggrega language server has stopped responding.**, naming the command that starts it again, and nothing starts it again by itself after that — so a server that dies every time it starts is started again that many times and no more. The Aggrega output channel says each step in words: that the server stopped unexpectedly and how it ended, each restart and how many the setting allows, a restart that did not come up and why, and that it is not being started again. A stop or restart you asked for — the restart command, a change of `aggrega.server.binaryPath`, or a configuration change the extension made itself — is not counted, and a restart starts the count again from nothing. The first start, and a restart you asked for, are not repeated when they fail: each ends in the notification that the language server failed to start, with the reason.

**Every language server starts the Problems panel from what it reports itself.** As a server starts — the first one, a restart however it was asked for, one started again after the last stopped unexpectedly, one moved to another Aggrega workspace, and one started where none was running — the Problems panel is emptied of everything the previous server reported, and every open YAML file is checked against the new one as soon as it answers. A server cannot take back what it reported, and the one started after it does not know what that was, so a finding left standing would be one no running server stands behind — after a move, one about the workspace you left. The findings blink out and back while the open files are checked. A finding that only another request computes stays out until that request runs again: the build's findings come back when the graph is drawn or a build or preview build runs, a lockfile's drift warning when the graph is drawn — both at once where a graph panel is open on that Release, since it is redrawn as the server comes back — and the publishing-conventions findings when you run Lint. A server that stops and is not replaced — its restarts spent, or no Aggrega workspace left to attach to — leaves the Problems panel as it was.

**The language server reads its configuration when it starts, and keeps it until it stops.** The command line reads it afresh on every run, so an edit to `.aggrega-config.yaml` or to `~/.config/aggrega/config.yaml` changes what a terminal does at once and changes nothing in a language server that is already running. So the extension watches the configuration files the running server reports it read — the file paths **Show config** lists among the files that contributed — and when one of them changes on disk, is deleted or comes back, and so no longer matches what the server read, it raises one warning naming the file and saying the language server reads its configuration when it starts, with a **Restart server** button that runs **Aggrega: Start or restart the language server**. Several writes from one save raise one warning. The warning is not raised again for that file while it is on screen, nor after you dismiss it until the file changes again, and a restart starts the watch over from what the restarted server read. A configuration file that did not exist when the server started was not read, so it is not watched and creating one raises nothing; the next start reads it. Which files are being watched is written to the Aggrega output channel each time a server starts.

**A configuration change the extension makes itself is applied by restarting the language server, without asking.** Adding or removing a registry, seeding a registry from the welcome page, adding or removing a plugin, creating the workspace configuration from the welcome page, and **Aggrega: Set authoring_release in .aggrega-config.yaml…** where it has to create the file are each followed by a restart, shown while it runs as a notification naming the file the server is about to read, and none of them raises the warning: you asked for that change. Where creating the workspace configuration starts the language server itself — none was running, or it was running for another folder — that start reads the new file, and no second restart follows. Once a language server that started after the change has read it, the operation's own ending adds one sentence saying the change is now in effect, rather than a second notification; where the restart failed, or no language server was running to read the change, the sentence is left out, because the change is then in the file and not yet in force. Setting `authoring_release` ends by opening the file rather than in a sentence, so it adds nothing.

## License

Apache-2.0.

The Codicon icon set ships under `media/vendor/` so that the panels this
extension draws itself can show the editor's own icons — a document the editor
hosts is given no icon font of its own. Those files are placed there by the build
from a development dependency rather than carried in this repository, and they
are not Apache-2.0; their provenance and licence are recorded in
`media/codicon-NOTICE.md`, beside the files themselves.

<!-- That path is deliberately NOT a relative markdown link. The packaging step
     rewrites every relative link in this file into a link to the file on the
     repository's web page, so a link here would take a reader of the installed
     extension away from the copy beside it, to a page they can open only where they
     can reach that repository. A plain path tells the reader exactly where the
     notice is and needs no URL to resolve. -->

