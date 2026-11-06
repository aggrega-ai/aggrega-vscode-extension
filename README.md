# Aggrega VS Code extension

This repository holds the [Aggrega](https://aggrega.ai) extension for Visual Studio Code.

It brings language support for Aggrega YAML into the editor — diagnostics as you edit, hover, completion, Go to Definition and Find References, backed by the `aggrega` daemon (`aggrega serve`) — with a welcome page that walks you through what it needs, panels that run the compiler's operations and list your catalog, registries and plugins, and an interactive topology graph of the Release you select.

Install the "Aggrega" extension from the Visual Studio Marketplace or Open VSX. The [Aggrega documentation](https://aggrega.ai/docs/) covers installing the compiler and authoring with it.

The full guide to the extension — what it needs, the welcome page, its panels and the topology graph, and every setting and command — is [Use Aggrega in Visual Studio Code](https://aggrega.ai/docs/authoring/editor/) in the Aggrega documentation.

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

The end-to-end suite drives the real editor with this extension and a real
`aggrega` language server loaded into it. What it needs, how to run it and
what each scenario checks are in [`test/e2e/README.md`](test/e2e/README.md).

## License

The Aggrega extension for VS Code is released under the Apache License, Version 2.0; the full text is in the
`LICENSE` file.

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

