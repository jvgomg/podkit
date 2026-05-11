---
status: tentative
last-updated: 2026-05-11
user-stories-addressed: [US-03, US-14, US-24]
links:
  - playlist-roles-separated.md
  - runtime-mismatches-not-config-errors.md
  - ../open-questions/source-collection-decoupling.md
---

# Sources declare capabilities; collections are portable

> **Principle.** A source declares which kinds of things it can provide
> (music tracks, playlists, etc.). Collections are written against the
> abstract filter language without naming a specific source type. At runtime,
> source adapters fulfill what they can and surface clear diagnostics for
> what they cannot.

## Why

Two real-world cases push toward this:

1. **Same selection rules, different sources.** A user with both a Subsonic
   server and a local directory wants their genre filter to apply to either,
   without writing two collection definitions.
2. **Specialist sources.** A directory of M3U files might be a
   playlist provider but not a music provider. A Subsonic server is both. A
   future cloud service might be just a music provider.

If we hard-code each filter primitive to a specific source type, we
fragment the config and make sources and collections non-portable. If we
let sources declare what they can do and let collections speak the abstract
language, we get composition for free.

## What the principle implies

- A source's schema includes a `capabilities` set (or implicit set derived
  from configuration), e.g., `["music-provider", "playlist-provider"]`.
- A directory source with no `playlists/` subdir doesn't claim
  `playlist-provider` — even though "directory" type *can* provide playlists
  in principle. Capabilities are properties of source instances, not types.
- Filter primitives have an associated capability requirement. `playlist`
  needs `playlist-provider`; `genre` needs `music-provider` and metadata
  access; etc.
- Collections are portable because they don't reference source types — they
  reference filter primitives. Whether a collection actually *resolves*
  against a given source depends on the source's capabilities.
- Mismatches (collection wants `playlist`, active source isn't a
  playlist-provider) are runtime warnings — see
  [runtime-mismatches-not-config-errors](runtime-mismatches-not-config-errors.md).

## What the principle does not say

- It does not say capabilities are the *only* extension mechanism. Sources
  may also have type-specific configuration (URL for Subsonic, path for
  directory). Capabilities describe *what they offer*, not *how they're
  configured*.
- It does not commit to a closed list of capabilities. New capabilities can
  be added as new filter primitives or new content types are introduced.
- It does not assume cross-source playlist resolution is supported. That is
  a separate, parked concern — see the cross-source-playlists feature
  (WIP PRD).

## Tension with source/collection decoupling

This principle assumes collections and sources are decoupled enough for
collections to be portable. The source/collection-decoupling open question
challenges that assumption — if collections end up tightly bound to specific
sources, this principle loses some of its force.

Even if we keep the binding tight, capabilities still have value: a
diagnostic surface that tells the user "this source can't do what your
collection asks" is better than silent partial behaviour, regardless of how
portable collections are in the end.

## Discussion / origin

Emerged in the session of 2026-05-11 when discussing playlist resolution
across source types. Initially I (the assistant) overshot by proposing
"Subsonic-playlist-as-source" as a separate source type; the user pushed
back. The eventual landing was: playlists are filter primitives; sources
implement them per their capabilities.

## Implementation notes

- Source adapters expose a `capabilities()` method returning the set they
  fulfil.
- A `podkit doctor`-style validator can pre-check collection × source
  compatibility ahead of sync, surfacing mismatches before any I/O.
- Adapters may fulfil a capability *partially* (e.g., a directory source
  with simple M3Us provides "playlists" but not "playlists with metadata").
  Whether to model partial fulfilment as separate capabilities or as
  best-effort within a capability is an implementation decision for the
  features that need it.
