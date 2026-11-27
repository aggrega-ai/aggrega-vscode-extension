# Changelog

All notable changes to the Aggrega VS Code extension are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.10.5] - 2026-11-27

## [0.10.4] - 2026-11-26

## [0.10.3] - 2026-11-24

### Added

- The extension's own words show in Thai when VS Code's display language is Thai.

## [0.10.2] - 2026-11-22

## [0.10.1] - 2026-11-21

### Added

- The extension's own words show in Traditional Chinese when VS Code runs in Traditional Chinese.
- The extension's own words show in Arabic when VS Code's display language is Arabic.

### Fixed

- The extension's panels declare the language their words are in, so screen readers read them in it.
- The extension drives the 0.10 compilers: Select Compiler Version offers them and a download installs the newest 0.10 release.

## [0.10.0] - 2026-11-19

### Added

- The extension's own words show in Hindi when VS Code runs in Hindi.
- The command "Aggrega: Show Compiler Third-Party Licenses" opens the third-party notices of the configured compiler.

## [0.9.3] - 2026-11-17

## [0.9.2] - 2026-11-15

### Added

- A Draft button in the Aggrega panels' and the Explorer's title bars drafts an entity, an example, a quickstart or an import.
- The compiler picker shows compilers newer than the extension's supported range as not selectable, and says to upgrade the extension.
- A relative `aggrega.server.binaryPath` is resolved against the first workspace folder.
- The publication and signature lines the editor writes, and the cache names, are translated into all 15 languages.

### Fixed

- The welcome page marks the compiler step done once the configured compiler runs, even before an Aggrega folder is open.

## [0.9.1] - 2026-11-15

### Fixed

- `aggrega.server.binaryPath` accepts a path starting with `~/` (`~\` on Windows) or containing `${userHome}`, and a failed start names the path it tried.
- The Commands panel shows the attached workspace and Release after it has been hidden, and choosing the workspace already in use says so.

## [0.9.0] - 2026-11-15

### Added

- Multi-marker workspace discovery: the extension recognizes the workspace root and Release candidates the way the daemon does (workspace marker, precedence, CWD fallback), and picks the anchored folder when a window has multiple roots. The status-bar tooltip shows the active workspace marker.
- Release-candidate detection and root discovery are delegated to the daemon rather than a client-side basename glob.
- Per-code diagnostic surfaces with structured error data for precise positioning: diagnostic squiggles span the reported source tokens when the daemon returns end positions, instead of marking a single point.
- Per-file invalidation granularity for `aggrega/invalidate`, wired to editor `didClose`.
- Lockfile awareness at edit time, integrating `aggrega pull --verify` so the editor surfaces the same lockfile verdict a build gives.
- A quick-action menu, automatic daemon restart, a daemon version check, and time-based toast debouncing.
- A `server.buildOnInspect` setting, forwarded to the daemon as `--build-on-inspect`, with a command and a quick-action-menu entry that toggle it without opening settings JSON.
- Problems-panel grouping by the compiler layer that raised each finding, read from the daemon's own report rather than assigned by the extension.
- A Plugins panel whose rows name each plugin's type, version and readiness, keep a plugin the compiler could not resolve or describe on a row of its own with the compiler's message, and carry its configuration key, capabilities, input kinds, boundary and exports in the tooltip.
- A published-catalog search narrowed from one filter list — free text, entity kinds, a label selector, plugin capabilities, a plugin socket and a result cap — that reads each registry's local index and copies a matched reference.
- The import's output channel shows how the importer mapped each source node, after its diagnostics and before the files it wrote: one line per node, in the words `aggrega import` prints on standard error — `mapped <node id> (<node type>) to <target> as a <mode>, <tier> at <score>` — with every value the importer's own, so an author sees where an import guessed without opening the drafts.
- Importing a directory: the import asks for the path of the file or the directory to import and hands a directory to the language server exactly as typed, as it does a file. The compiler reads a directory into the files of it the importer's declared file patterns select, each named by its path inside the directory, and never follows a link inside it out of it.
- The import chooses its source with the open dialog, offers destination, Preview, Sync and target, and asks for an unsettled format.
- An Explorer right-click entry, Import into Aggrega, imports the clicked file or folder without asking for the source.

### Changed

- The import leaves the destination to the compiler's default, and its ending no longer counts the import record as a draft.
- The palette's import command is now Aggrega: Import into Aggrega, the title its Explorer entry shows.
- Daemon shutdown escalates cooperatively — drain, then abort, then force-kill — so in-flight requests settle before the subprocess is terminated.

### Fixed

- The daemon `initialize` handshake tolerates a slow first response: the timeout is raised and the client no longer respawns repeatedly (respawn storms) after an initialize failure.
- Subprocess spawn errors are handled rather than surfacing as unhandled failures.
- The daemon version check tolerates `v`-less and dev build-metadata version forms.
- Diagnostics no longer rely on color alone to convey severity.

## [0.1.0]

- Subprocess lifecycle for `aggrega serve` with bounded crash recovery.
- LSP-to-JSON-RPC translation for diagnostics, go-to-definition, references, implementation, hover, completion.
- Cache-miss handling with notification and silent-revalidate modes.
- Debounced validate-on-change with reactive delay (configuration changes take effect without extension restart).
- Restart-language-server command.
