---
id: US-16
title: Subsonic curation, local files
priority: P1
status: open
scope: contingent
theme: cross-source
last-updated: 2026-05-11
addressed-by:
  features: [cross-source-playlists, track-identity]
  principles: [track-identity-foundation]
  open-questions: [source-collection-decoupling, normalization-aggressiveness]
  spikes: []
---

# US-16 — Subsonic curation, local files

> Maintain "Commute Mix" as a playlist in Subsonic, but sync the actual
> track files from a local directory.

## Detail

User curates in Subsonic (because that's where their UI is) but wants to
sync from local files (because they're higher quality, or they're
offline, or they don't want to re-transcode). The playlist *definition*
comes from Subsonic; the playlist's *tracks* are matched against the
local source.

This requires cross-source track-identity matching: each entry in the
Subsonic playlist must be identified to a track in the local source.

## Acceptance signal

```toml
[collections.commute]
filter.playlist = { name = "Commute Mix", source = "navidrome" }

[devices.terapod]
music.source = "local-music"
music.collection = "commute"
```

Sync produces a device whose music is the local files corresponding to
the Subsonic playlist's entries. Diagnostics surface any entries that
couldn't be matched against the local source.

## Scope: contingent

This story is in scope only if
[source-collection-decoupling](../open-questions/source-collection-decoupling.md)
resolves toward portable collections, *and* the cross-source playlists
feature is built. Either rejection drops this story.

## Notes

This is the foundational motivation for the
[track-identity-foundation](../principles/track-identity-foundation.md)
principle and the eventual track-identity sub-PRD.
