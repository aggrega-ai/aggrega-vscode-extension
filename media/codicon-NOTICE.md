# Codicons

The panels this extension draws itself show the editor's own icons, and a
document the editor hosts is given no icon font of its own — so the font and the
stylesheet that names it are served from `media/vendor/`, and without them every
icon on such a panel is silently absent.

Those files are **not carried in this repository**. They are placed in
`media/vendor/` by `build/copy-vendor-assets.js`, from a development dependency,
and they ship in the packaged extension. `npm run compile` runs the copy, as does
packaging.

They are two static files handed to a document — exactly as `aggrega.svg`,
`graph.css` and `welcome.css` are — so nothing imports them at build time or at
run time, and they are not a runtime dependency.

## Provenance

| | |
|---|---|
| Package | `@vscode/codicons` |
| Version | as pinned in `devDependencies` |
| Source | <https://github.com/microsoft/vscode-codicons> |
| Files taken | `dist/codicon.css`, `dist/codicon.ttf`, `LICENSE` |
| Placed at | `media/vendor/codicon.css`, `media/vendor/codicon.ttf`, `media/vendor/codicon-LICENSE.txt` |

The stylesheet refers to the font file beside it by a content hash, so the pair
travels together or loads nothing. That is why the copy step takes both and fails
rather than proceeding when either is missing.

## Licence

The icons are licensed under Creative Commons Attribution 4.0 International
(CC-BY-4.0), as the upstream package declares. The full licence text travels with
the files, at `media/vendor/codicon-LICENSE.txt`. Attribution: the Codicon icon
set, by Microsoft Corporation.

The rest of this extension is Apache-2.0; these files are not, which is why their
licence travels with them rather than being assumed from the repository's.

## Updating

Change the version in `devDependencies`, run `npm install`, then `npm run
compile`. Nothing else names the version, so there is no second place to keep in
step.
