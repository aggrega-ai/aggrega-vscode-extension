## A registry to resolve from

A **registry** is where published catalog content lives — the Components,
Features, Recipes and Plugins your Aggregate refers to but does not itself
contain.

Two things have nothing to resolve against without one:

- **Pulling dependencies**, which fetches what a Release refers to and pins it,
- **Searching the published catalog**, which is how you find an entity to refer
  to in the first place.

Registries are named by your configuration rather than by this extension, and
each one carries its own signature trust policy — whether artifacts pulled from
it must be signed. The **Registries** panel lists every registry the effective
configuration declares, with each one's host, its alias, which is the default,
whether signatures are required, and whether a credential for that host is
present. Reading that list contacts no registry: the credential state reports
presence only, so it says a credential exists rather than that the registry
would accept it.

**Seed the official hub** registers the public hub together with its signature
trust policy, using the compiler's own seeding — so what you get here and what
you would get from the command line are the same configuration. Seeding declines
rather than replacing a configuration that is already there, and says which file
it found; replacing one is something you ask for explicitly at the command line.

**Seed a registry I name** does the same for a host you supply, which is the path
for a private or air-gapped hub.
