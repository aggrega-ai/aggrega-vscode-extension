## A Release to act on

A **Release** is the document that says *this* Aggregate is deployed *here*, with
these parameters fulfilled. It is what turns developer intent into something a
compiler can render.

So most of what this extension does acts on one Release rather than on the
workspace in general: validation, building, previewing a build, the topology
graph, pulling dependencies and acquiring inputs all need to know which one you
mean. The editor asks once and remembers, rather than asking at every command.

The selection is named in two places — a status-bar indicator, and a **Release**
row at the top of the Operations panel — so the Problems panel and the graph
always describe the same Release, and you can see which without pressing
anything.

Two properties of the selection are worth knowing:

- **It is remembered per editor window, not in the repository.** Your choice does
  not travel to whoever else opens the project.
- **It is re-verified when it is restored.** A Release that no longer resolves
  falls back to the workspace's own default, and says so — rather than failing on
  first use, at a moment you cannot connect to a choice made in a previous
  session.

The Releases offered are the ones the language server will accept, named relative
to the folder it anchored to. Recording a workspace's own persisted default is a
separate, explicit act.

**Draft a Release** opens the same drafting flow the Author group uses, asking for
the kind and the name. **Choose a Release I already have** opens the picker over
what this workspace offers.
