---
id: US-04
title: Multi-content-type device
priority: P1
status: open
scope: in
theme: multi-content-type
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections, per-content-type-collections]
  principles: [content-type-is-explicit]
  open-questions: []
  spikes: []
---

# US-04 — Multi-content-type device

> Sync music + TV + movies onto a single iPod, each from its own source,
> each with its own collection.

## Detail

User has an iPod 5G or Classic that supports music *and* video. They want
to sync curated music alongside specific TV shows and a handful of movies.
Each content type has its own source and its own collection of rules.
Content type is declared on the source — no auto-detection.

## Acceptance signal

```toml
[sources.music]
path = "/Volumes/Media/music"
content = "music"

[sources.tv]
path = "/Volumes/Media/tv-shows"
content = "tv"

[sources.movies]
path = "/Volumes/Media/movies"
content = "movies"

[devices.terapod]
music.source = "music"
music.collection = "my-music"
tv.source = "tv"
tv.collection = "favorite-shows"
movies.source = "movies"
```

Sync produces a device with all three content types organised correctly.

## Notes

Obsoletes doc-007's video split mechanism — the same goal is achieved
via [content-type-is-explicit](../principles/content-type-is-explicit.md)
applied to per-content-type collections.
