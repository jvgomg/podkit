---
id: US-27
title: Manual video curation
priority: P2
status: open
scope: in
theme: multi-content-type
last-updated: 2026-05-11
addressed-by:
  features: [per-content-type-collections]
  principles: [content-type-is-explicit]
  open-questions: []
  spikes: []
---

# US-27 — Manual video curation

> Hand-pick specific movies and TV show seasons. No automation, no
> "next unwatched" logic. Just sync exactly what I list.

## Detail

Some users don't want podkit making selection decisions for their video
content. They have a clear idea of *the movies they want* and *the
seasons of the shows they want*. They want to enumerate that
explicitly and have the sync respect it verbatim — nothing more,
nothing less.

## Acceptance signal

```toml
[sources.tv]
path = "/Volumes/Media/tv-shows"
content = "tv"

[sources.movies]
path = "/Volumes/Media/movies"
content = "movies"

[collections.my-shows]
filter.shows = ["The Sopranos", "Mad Men"]
filter.seasons = ["The Sopranos:1-3", "Mad Men:all"]

[collections.my-movies]
filter.titles = ["Lawrence of Arabia", "Heat", "The Big Lebowski"]

[devices.classic]
tv.source = "tv"
tv.collection = "my-shows"
movies.source = "movies"
movies.collection = "my-movies"
```

The sync produces exactly the listed seasons of those shows and exactly
those movies. No auto-rotation, no "next unwatched."

## Notes

Distinguishes from [US-10](us-10-tv-recent-unwatched.md) and
[US-28](us-28-movies-fresh-unwatched.md), which are about *automated*
rotation. Manual curation is the explicit-list flavour of the same
content-type filter primitives.

Per-show / per-season targeting needs a filter primitive shape the
per-content-type-collections sub-PRD will need to define. The exact
syntax (e.g., `"Show:1-3"` vs nested objects) is open.
