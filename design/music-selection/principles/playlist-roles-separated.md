---
status: agreed
last-updated: 2026-05-11
links:
  - collections-are-content-sets.md
  - source-capabilities.md
  - ../features/README.md
---

# Playlists have two roles, kept formally distinct

> **Principle.** A playlist reference can be used as a **selection
> constraint** (filter input) or as **content** (a named playlist
> materialised on the device). These are two distinct roles with two
> distinct config slots. The same playlist can play both roles, but the
> config makes the double duty explicit.

## Why

Conflating the two roles produces ambiguity:

- "Sync the Commute Mix playlist" — does that mean "use Commute Mix to
  decide which tracks are eligible" or "create a playlist named Commute Mix
  on the device"? Both are valid intents.
- Selection logic and device output have different downstream consumers.
  The selector needs to know "what tracks pass the filter"; the device
  writer needs to know "what playlists to write and what tracks to put in
  them."
- Capacity behaviour differs: a constraint playlist's tracks may be evicted
  to fit; a materialised device playlist's tracks may be pinned (must-have).

Keeping the roles in separate config slots makes intent unambiguous and
keeps the selector / writer contracts clean.

## What the principle implies

- **Constraint role** lives in `filter.playlist` inside a collection. The
  named playlist defines the *pool* of eligible tracks.
- **Content role** lives in `playlists` (a list) at the collection level.
  Each entry names a playlist that should appear on the device with its
  tracks.
- A user wanting a playlist for both roles names it in both slots — there is
  no "shared field" sugar that does both implicitly.
- The selector pipeline reads both: the constraint role gates the pool; the
  content role contributes pinned tracks (see
  [collections-are-content-sets](collections-are-content-sets.md) for the
  pin > pool ordering).

## What the principle does not say

- It does not specify *where* playlists are resolved from — that's the
  source-capabilities question. The same playlist name might resolve from
  Subsonic, from M3U files, or from podkit-native definitions.
- It does not specify *how* tracks not in the constraining pool but in a
  materialised playlist get treated. That's the pin-overrides-pool semantic,
  with `union` (default) and `intersect` modes — covered in the device
  playlist write feature.

## Discussion / origin

The user explicitly demanded the separation in the session of 2026-05-11:
*"I would like a clear separation between a playlist being part of
collection constraint and playlists being part of the content a user is
syncing."*

Before that turn, the design was conflating the two by treating "playlists
on the device" as just another way of expressing "what to sync." Forcing the
separation cleaned up several knock-on questions (capacity behaviour,
pin/pool ordering, override semantics).

## Implementation notes

- Two distinct fields in the collection schema: `filter.playlist` (singular,
  the pool gate) and `playlists` (list, content to materialise).
- `playlist-mode` (`union` / `intersect`) is a collection-level scalar that
  governs how `playlists` interacts with `filter.playlist`.
- Both roles share the same source resolution mechanism (whatever the
  source-capabilities approach ends up being).
