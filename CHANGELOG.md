# Changelog

All notable changes to the Aggrega VS Code extension are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Multi-marker workspace discovery: the extension recognizes the workspace root and Release candidates the way the daemon does (workspace marker, precedence, CWD fallback), and picks the anchored folder when a window has multiple roots. The status-bar tooltip shows the active workspace marker.
- Release-candidate detection and root discovery are delegated to the daemon rather than a client-side basename glob, with a cross-language parity test guarding the two implementations against drift.
- Per-code diagnostic surfaces with structured error data for precise positioning: diagnostic squiggles span the reported source tokens when the daemon returns end positions, instead of marking a single point.
- Per-file invalidation granularity for `aggrega/invalidate`, wired to editor `didClose`.
- Lockfile awareness at edit time, integrating `aggrega pull --verify` so the editor surfaces the same lockfile verdict a build gives.
- A quick-action menu, automatic daemon restart, a daemon version check, and time-based toast debouncing.
- A `server.buildOnInspect` setting, forwarded to the daemon as `--build-on-inspect`, with a command and a quick-action-menu entry that toggle it without opening settings JSON.
- Problems-panel grouping by the compiler layer that raised each finding, read from the daemon's own report rather than assigned by the extension.
- An end-to-end suite that launches the editor with no display, loads the extension and a real `aggrega` language server into it and checks what the editor shows and does, beside specs that build `aggrega` on demand from the sibling checkout and exercise the daemon client against a real daemon, including cooperative-shutdown-under-load coverage.

### Changed

- Daemon shutdown escalates cooperatively — drain, then abort, then force-kill — so in-flight requests settle before the subprocess is terminated.

### Fixed

- The daemon `initialize` handshake tolerates a slow first response: the timeout is raised and the client no longer respawns repeatedly (respawn storms) after an initialize failure.
- Subprocess spawn errors are handled rather than surfacing as unhandled failures; test fixture provisioning is deterministic.
- The daemon version check tolerates `v`-less and dev build-metadata version forms.
- Diagnostics no longer rely on color alone to convey severity.

## [0.1.0] — initial scaffold

- Subprocess lifecycle for `aggrega serve` with bounded crash recovery.
- LSP-to-JSON-RPC translation for diagnostics, go-to-definition, references, implementation, hover, completion.
- Cache-miss handling with notification and silent-revalidate modes.
- Debounced validate-on-change with reactive delay (configuration changes take effect without extension restart).
- Restart-language-server command.
- Pure-Node integration tests that build `aggrega` on demand from the sibling `aggrega-cli` checkout and exercise the daemon class against a real subprocess.
