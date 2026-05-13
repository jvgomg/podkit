---
id: US-28
title: Fresh unwatched movies
priority: P2
status: open
scope: in
theme: multi-content-type
last-updated: 2026-05-11
addressed-by:
  features: [per-content-type-collections, device-state-read]
  principles: [content-type-is-explicit]
  open-questions: []
  spikes: []
---

# US-28 — Fresh unwatched movies

> Sync a rolling set of unwatched movies, rotated as they are watched.
> The device-as-queue model for movies.

## Detail

The movie equivalent of [US-10 (TV recent unwatched)](us-10-tv-recent-unwatched.md).
User has a movies source and wants their iPod to be a "to watch"
collection of movies that haven't been watched yet (or recently
enough). When they watch one on the device, the next sync rotates a new
one in.

## Acceptance signal

```toml
[collections.movie-queue]
filter.unwatched = true
filter.max = 10
filter.prefer-recently-added = true

[devices.classic]
movies.source = "movies"
movies.collection = "movie-queue"
```

Result: device contains up to 10 unwatched movies. After watching one,
the next sync replaces it with the next recently-added unwatched movie.

## Notes

The "unwatched" predicate depends on
[device state read](../features/device-state-read.md) for played
state. Without it, the filter falls back to a heuristic (e.g., least
recently added, or always treat as unwatched).

Sibling to US-10 (TV) — same mental model, different content type.
Both inform what filter primitives the movies collection schema
should support.
