---
id: US-08
title: Strict gate (intersect mode)
priority: P2
status: open
scope: in
theme: playlists
last-updated: 2026-05-11
addressed-by:
  features: [device-playlists-write, selector-pipeline]
  principles: [playlist-roles-separated]
  open-questions: []
  spikes: []
---

# US-08 — Strict gate (intersect mode)

> Sync only tracks that are in named playlists. Nothing else. The
> constraining filter acts as a strict gate.

## Detail

Some users treat their device as a tightly-curated artefact — only tracks
that appear in at least one of their named playlists should be on it. No
"pool" of extras, no surprises. This is the inverse of
[US-05](us-05-curated-playlists-plus-pool.md)'s additive default.

## Acceptance signal

```toml
[collections.strict]
filter.playlist = "Approved"
playlists = ["Workout Mix", "Road Trip"]
playlist-mode = "intersect"
```

Result: device contains the intersection of "Approved" and the named
playlists' tracks. A track in "Workout Mix" that isn't also in "Approved"
is dropped with a warning.

## Notes

Same machinery as US-05, different mode flag. Most users will use the
default (union); intersect is the escape hatch for strict curators.
