## A compiler this editor can run

This extension computes nothing about your architecture itself. It renders the
compiler's own answers — so a compiler it can start is what everything else
here depends on.

Two transports carry those answers, and both run the same binary:

- a **language server**, started once and kept running, which answers
  validation, navigation, hover, completion, the topology graph and the
  workspace catalog;
- **one-shot commands**, run per operation and streamed to the Aggrega output
  channel, which carry publishing, dependency fetching and cache maintenance.

Which binary runs is the `aggrega.server.binaryPath` setting. A plain name is
looked up on your `PATH`; an absolute or relative path is honoured as written.

That setting is yours rather than the project's: it names something about the
machine you are working on, so a repository cannot pin it for whoever clones it.
The consequence is deliberate — a project cannot point this extension at a
checked-in build — and it is what lets you keep one path locally and a different
one inside a container.

The language server's state is reported in the status bar, on the left. It reads
**running**, **starting**, or **not running**, and its tooltip says which of two
reasons applies: nothing here is a folder Aggrega recognises, or there is one and
no server is attached to it. Clicking it offers to start or restart.

**Use the compiler on my PATH** restores the plain name — the path for someone
who installed the compiler after opening the editor. **Point at a compiler I
have** selects a build you keep elsewhere.
