## A workspace Aggrega recognises

Every Aggrega operation runs against a **workspace root** — one folder that the
compiler treats as the top of your project. It is where catalog directories are
resolved from, where rendered artifacts are written, and what every path in a
request is interpreted relative to.

Aggrega finds that folder by climbing. Starting at the folder you opened it looks
upward for any of:

- a `.aggrega-config.yaml` carrying a top-level `workspace:` block,
- an `.aggrega` directory,
- an `aggregate`, `release` or `manifest` YAML file.

A `.aggrega-config.yaml` **without** a `workspace:` block does not anchor a root.
Settings can live in a configuration file anywhere, and a file that only carries
settings must not turn every directory above it into a project root.

Because discovery climbs rather than descends, the root may legitimately sit
*above* the folder you opened. The **Workspace** row at the top of the Operations
panel always names the folder that was actually anchored, so when it differs from
what you opened you can see why.

**Create a workspace configuration** writes the smallest file that anchors a
root, in the folder you have open. **Use a folder that already has one** offers
the folders beneath you that Aggrega already recognises, and adds the one you
choose so the compiler anchors there.
