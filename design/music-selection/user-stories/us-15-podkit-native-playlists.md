---
id: US-15
title: Podkit-native playlists
priority: P3
status: deferred
scope: in
theme: playlists
last-updated: 2026-05-11
addressed-by:
  features: [cross-source-playlists]
  principles: []
  open-questions: []
  spikes: []
---

# US-15 — Podkit-native playlists

> Define playlists in podkit itself (not in any external source) to
> enhance syncing rules.

## Detail

Some users don't want to maintain playlists in Subsonic or as M3U files
on disk — they want podkit to be the home of their playlist definitions.
This might be a CLI surface (`podkit playlist create ...`) or a config
section, or both.

The playlists become available everywhere a source-provided playlist
would be: as filter constraints, as materialised device playlists.

## Acceptance signal

(Shape TBD; one possible form:)

```toml
[playlists.commute]
content = "music"
tracks = [
  { artist = "Artist", title = "Track 1" },
  { artist = "Artist", title = "Track 2" },
]
```

Or via CLI: `podkit playlist add commute "Artist - Track 1"`. The
playlist is then referenceable as `filter.playlist = "commute"` or in a
collection's `playlists` list.

## Notes

Deferred — UC3 from the playlist-support captured use cases. Belongs in
the [cross-source-playlists](../features/cross-source-playlists.md) WIP
PRD because podkit-native playlists are conceptually a "source" of
playlist definitions divorced from any music source — i.e., they
inherit cross-source resolution machinery.
