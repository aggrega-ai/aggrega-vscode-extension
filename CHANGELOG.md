# Changelog

All notable changes to the Aggrega VS Code extension are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — initial scaffold

- Subprocess lifecycle for `aggrega serve` with bounded crash recovery.
- LSP-to-JSON-RPC translation for diagnostics, go-to-definition, references, implementation, hover, completion.
- Cache-miss handling with notification and silent-revalidate modes.
- Debounced validate-on-change with reactive delay (configuration changes take effect without extension restart).
- Restart-language-server command.
- Pure-Node integration tests that build `aggrega` on demand from the sibling `aggrega-cli` checkout and exercise the daemon class against a real subprocess.
