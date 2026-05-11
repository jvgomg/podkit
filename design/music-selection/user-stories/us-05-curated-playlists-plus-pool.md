---
id: US-05
title: Curated playlists plus pool
priority: P0
status: open
scope: in
theme: playlists
last-updated: 2026-05-11
addressed-by:
  features: [device-playlists-write, selector-pipeline]
  principles: [playlist-roles-separated]
  open-questions: [pinned-set-exceeds-capacity]
  spikes: []
---

# US-05 — Curated playlists plus pool

> Sync a handful of named playlists onto the device *and* fill remaining
> capacity from a larger constraining playlist (the pool).

## Detail

User has a few "use case" playlists they want on the device (Workout Mix,
Road Trip, Sleep Sounds) — these are *must-have*. They also have a much
larger general-listening playlist they want to draw from for the rest of
the device's capacity. The named playlists take priority; the pool fills
the rest.

## Acceptance signal

```toml
[collections.my-music]
filter.playlist = "Terapod"          # the pool
playlists = ["Workout Mix", "Road Trip", "Sleep Sounds"]
playlist-mode = "union"              # default

[devices.terapod]
music.source = "navidrome"
music.collection = "my-music"
```

Result: device contains the three named playlists in full, plus as many
additional tracks from the "Terapod" pool as capacity allows.

## Notes

This is the canonical motivation for separating
[playlist roles](../principles/playlist-roles-separated.md) and for the
pin > pool ordering in the selector pipeline.
