---
status: open
last-updated: 2026-05-11
importance: foundational
links:
  - ../principles/source-capabilities.md
  - ../principles/collections-are-content-sets.md
  - ../user-stories.md
  - ../features/README.md
---

# Should sources and collections be decoupled?

> **The fork.** Either collections are *portable* (a collection's filter
> rules can be applied to any source that supports them, and the source can
> be swapped per device or per CLI run) **or** collections are *bound* to a
> specific source (the collection effectively names "this rule set against
> this source," and swapping is not a first-class operation).

## Why this matters

This question shapes the entire conceptual model. The current shaping work
has assumed *decoupled* (collections are portable filter presets), and many
downstream principles and features are written with that assumption baked
in:

- [source-capabilities](../principles/source-capabilities.md) — only
  meaningful if collections can apply across source types.
- The CLI `--source X` swap mechanic — only useful if collections survive
  source changes.
- Cross-source playlist support (parked WIP PRD) — only relevant if
  cross-source is supported in the first place.
- Several user stories (US-03, US-12, US-16) — only achievable if cross-source
  works.

If we decide to *bind* sources to collections, much of the above simplifies
or disappears. The config gets shorter. Some user stories become
unreachable.

## The two positions

### Position A — Decouple (current direction)

Collections are filter presets. Sources are separate. Devices wire them
together.

**Pros:**
- Real cross-source flexibility (US-03, US-16, US-12).
- Sources are reusable across collections without duplication.
- Cleaner separation of concerns (intent vs origin).
- Source-capabilities principle has a natural home.

**Cons:**
- More config concepts for the user to understand.
- Cross-source identity matching (its own sub-PRD) becomes mandatory if we
  want cross-source playlists to work — and even without playlists, the
  selector needs to know how to handle "track X is in source A but not in
  source B."
- The portability promise has to be backed up by a real adapter contract.
  Any source feature that doesn't translate cleanly across adapters becomes
  a sharp edge.

### Position B — Bind

A collection names a specific source as part of its identity. Swapping
sources requires defining a parallel collection.

**Pros:**
- Simpler mental model and simpler config.
- No cross-source identity problem to solve.
- Cross-source playlists become moot (the WIP PRD goes away).
- Source-specific filter primitives (Subsonic playlist references with
  server-internal IDs) live naturally inside their owning collection.

**Cons:**
- Cross-source use cases become awkward — if a user wants the same
  rules against two sources, they duplicate the collection.
- Loses the "swap source at the CLI" ergonomic.
- May fragment the collection vocabulary by source type.

### Possible middle ground

**Position C — Hybrid.** Collections may *optionally* declare a source
binding. Unbound collections are portable; bound collections are
source-specific. Filter primitives that are inherently source-specific
(e.g., Subsonic playlist references) implicitly require a bound source.

This is more complex but might be the realistic answer once we examine the
filter primitives we actually need.

## What we know so far

- The user has flagged that they're *not* committed to decoupling. (Session
  of 2026-05-11.)
- The user described the cross-source case as "kind of rare" and
  acknowledged it has cost.
- The user wants to preserve the conceptual option without prematurely
  committing.
- I (the assistant) have been writing other principles assuming Position A;
  this is documented honestly in those files where relevant.

## What would resolve this

Some combination of:

1. **A clear use-case audit.** How many real users actually want US-03 /
   US-12 / US-16? Is the demand strong enough to justify the cost? Could be
   informed by GitHub Discussions, user surveys, or evidence from existing
   issues.
2. **A concrete cost estimate of cross-source identity matching.** If the
   matching primitive is going to be built anyway (for self-healing sync,
   source/device matching), the marginal cost of supporting cross-source
   playlists is lower. If it's only built for cross-source, the cost is
   higher.
3. **A willingness-to-degrade audit.** Position C is more complex but
   might be the honest answer if some primitives are intrinsically
   source-specific.

## Resolution criteria

Pick one of A / B / C. Update the conceptual model in the master PRD. Adjust
all dependent principles. Either commit to writing cross-source PRDs or
remove them from the inventory.

Until resolution, dependent principles carry status `tentative` to flag
that they are conditional on this answer.
