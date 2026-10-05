# What the end-to-end suite leaves to a person

The end-to-end suite decides most of what the extension draws and does, in a local editor
window it starts with no display. This page is for what it leaves to a person, in three parts.

## The judgements the suite prepares

Some checks stop at a state and leave the verdict to a person: whether a sentence directs its
reader, whether a mark reads strongly enough, whether a trade reads right. Each states what it
brings the editor to and the question it asks. To list them, with the scenario that reaches each,
without launching anything:

```bash
node out/test/e2e/run.js checklist
```

A run reports each of them as **for a person**, with its question, a capture of the state it
stopped at wherever there is one to capture, and the text drawn there, so a judgement costs a look
rather than a walk. To reach one again, run its scenario alone with `suite --only <scenario>`.

## The checks the suite never runs

The same listing ends with the checks whose state no run can build, each with the reason, and a
run reports each of them as **not run**. Where you can build the state a check names, walk it by
hand and judge it by the check's expectation.

## What no check reaches

Each entry names the checks that bring the editor nearest to the state. Run their scenario with
`--only`, or open the same kind of folder yourself, and pick up from there.

### A remote window

The suite's editor is a local window. Two things differ in a remote window, one working on a
container or another machine:

- **Where a preference lands.** Every preference the extension declares is declared for the
  machine. In a remote window, set one from the settings screen and expect it in the Remote
  settings file, where the editor keeps a setting declared for the machine, and in no workspace
  file; and with no value for the Commands panel's shape in any scope, the Remote file included,
  expect the panel's default shape. Nearest: `gateway` /
  `settings.build-on-inspect-toggle-is-kept-in-the-user-settings`, beside the judgement
  `settings.build-on-inspect-toggle-in-a-remote-window`, which asks this with nothing to capture;
  `gateway-commands-panel` / `settings.preference-is-the-users-and-a-workspace-value-is-ignored`,
  `commands-panel.default-shape-is-one-flow-with-no-group-titles`.
- **What adding a folder costs.** A window open on one folder takes a second one by becoming a
  workspace, which reloads a remote window where a local one restarts its extensions, and each
  entry offering an add names that cost on its second line. In a remote window on one folder,
  expect those lines to end `The window reloads.`, and an add to reload the window and come back
  in the state the local checks read. Nearest: `project-folder-adds` /
  `project-folder.chooser-offers-two-ways-to-reach-another`,
  `workspace-row.last-entry-names-what-the-add-costs-here`,
  `project-folder.add-from-one-folder-comes-back-working-from-it`,
  `workspace-row.last-entry-carries-the-workspace-chosen`; `two-workspaces-context-rows` /
  `two-workspaces.editor-add-leaves-the-choice-to-the-reader`.

### Your own client, fonts and width

The suite's editor runs with no display, at one window size and with the fonts installed where it
runs. Every capture the listing asks about was taken there, so where a judgement turns on a width,
a glyph or a colour, look in your own client too. Three readings have no judgement of their own:

- **The Commands panel's height.** `gateway-commands-panel` /
  `commands-panel.height-at-the-default-width` checks that the panel, at the side bar's default
  width, is at least as tall as everything it draws, and reports each pane's height with a capture.
  Whether it reads at a glance at the width you keep your side bar is yours to say.
- **The configuration table at your font size.** `gateway-configuration-report` /
  `config-panel.table-earns-its-place-in-each-theme` captures the table in three themes; whether
  its column widths hold up at your editor's font size is read in your client.
- **The setting column in a narrow table.** `gateway-docked-configuration` /
  `config-panel.setting-column-reads-at-its-measure` checks that every setting path breaks only
  after `_` or `.` and that the column holds its measure; whether it reads well there is yours to
  say.

### Dialogs your operating system draws

The suite's editor draws its own dialogs and folder pickers inside the window, where they can be
read: its settings set `window.dialogStyle` to `custom` and `files.simpleDialog.enable` on. With the
editor's defaults your operating system draws them instead. With those settings at their defaults,
open each of these and expect the message, the paths and the buttons the checks read, and a cancel
that changes nothing:

- the dialog raised when the Aggrega workspace in use is a folder above the one you opened:
  `workspace-above-interruption` / `workspace-above.dialog-says-only-the-two-paths`;
- the folder dialogs the Project folder row opens: `project-folder-adds` /
  `project-folder.open-dialog-names-its-act-lists-folders-and-cancels-quietly`,
  `project-folder.add-dialog-names-its-act-and-cancels-quietly`.

### A screen reader

The suite reads what the editor gives assistive technology, each control's accessible name and what
is hidden from it, and not what a screen reader then says. With one running, expect:

- the warning mark on the Aggrega workspace row, while the workspace sits above the folder you
  opened, read as the sentence it stands for rather than as a word for its shape:
  `workspace-above-interruption` /
  `workspace-above.continue-here-closes-the-dialog-and-leaves-the-mark`;
- each welcome-page step's standing read as its words alone, the mark beside it silent:
  `welcome-page-mixed-workspace` / `welcome-page.standings-read-met-and-to-do`.

### The Aggrega workspace row's open control and warning mark

Both are drawn only while the Aggrega workspace in use sits outside the folder opened. The checks
that sweep the Commands panel's width, read its icons and walk its tab stops run in a folder that is
its own workspace, where neither is drawn. In a folder beneath its workspace, expect the row to stay
one line at every width, the mark to keep its place after the value and the open control its place
at the row's right edge; the open control to draw its folder icon and the mark its warning sign; and
Tab to stop on the open control as a control of its own. Nearest: `workspace-above-interruption` /
`workspace-above.continue-here-closes-the-dialog-and-leaves-the-mark`, which draws both, beside
`gateway-commands-panel` / `commands-panel.flow-wraps-at-every-width-cutting-nothing-short`,
`commands-panel.icons-drawn-from-the-font-the-extension-ships` and
`commands-panel.tab-reaches-each-row-control-then-the-operations-once`.

### A cache file another process holds open

Windows refuses to remove a file another process holds open, and a cache clean-up then leaves it
in place. The suite runs where an open file is removed like any other, so the language server never
names one there and no check reads what the editor says about it. On Windows, hold a cache file
open from another process and run **Cache…** prune, a trim with a
cap below what the compiled-module cache holds, and clear. Expect the Aggrega output channel to name
each entry a prune or a trim left in place, with its class, how far it is shared, its size and
`open in another process`, and to give, under each cache an emptying reached, how many files it left
there and their size; and expect each ending to say how many were left in place because another
process has them open, to run the operation again once that process has finished, and where the
channel says which. Nearest: `gateway-cache` /
`cache.prune-with-nothing-held-open-says-nothing-of-it`,
`cache.trim-that-removes-with-nothing-held-open-says-nothing-of-it`,
`cache.clear-with-nothing-held-open-says-nothing-of-it`.

### What needs the network or an input the suite is not given

- **Seeding the official hub on a machine with no configuration file.** The welcome page's
  `Seed the official hub` registers the public hub with its signature trust policy, writing the
  global file. The suite seeds only a registry it starts itself, and presses this control only where
  a global file is already there and the seeding declines. On a machine with no global file, press
  it and expect it to end naming the file it wrote, as the seeding of a named registry does.
  Nearest: `welcome-page-empty-folder` / `welcome-page.seed-a-named-registry-writes-the-global-file`,
  `welcome-page.seeding-the-hub-over-a-file-is-refused-in-the-compilers-words`.
- **Removing a `cli` plugin.** Its consent names the global configuration shared across every
  workspace on the machine, where every other type's names the project's own, and nothing the suite
  is given provides a `cli` plugin for the compiler to describe. With one configured, remove it from
  the Plugins panel and read the consent. Nearest: `configured-plugins-removal` /
  `plugins-panel.removal-consents-naming-the-project-file-and-removes-only-once-given`.
- **An older editor.** The suite drives one editor build, and the extension accepts older ones down
  to the version its manifest names. In an older editor, press the configuration panel's switch
  between its two shapes and expect it to work there too. Nearest: `gateway-configuration-report` /
  `config-panel.shape-switch-sits-below-the-summary-and-draws-each-setting-in-full`.
