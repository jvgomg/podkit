---
id: US-10
title: TV recent unwatched
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

# US-10 — TV recent unwatched

> Sync the last N unwatched episodes per show, automatically.

## Detail

User has a TV source and wants the iPod to act as a "to watch" queue. Each
show should contribute its next N unwatched episodes (in airing order).
As they watch and the device reports back playback state, the next sync
rotates new episodes in.

## Acceptance signal

```toml
[collections.queue]
filter.shows = ["Severance", "Mad Men"]
filter.episodes-per-show = 3
filter.prefer-unwatched = true
```

Sync produces a device with 3 unwatched episodes of Severance and 3 of
Mad Men, oldest-unwatched first. After watching one, the next sync
replaces it with the following episode.

## Notes

- TV-specific filter primitives (`shows`, `episodes-per-show`,
  `prefer-unwatched`) live in the collection schema for `content = "tv"`.
- The "prefer-unwatched" behaviour depends on
  [device state read](../features/device-state-read.md) for play state.
  Without that, the filter falls back to "oldest episodes first."
- Lower priority than music stories — most users sync music primarily;
  TV is a meaningful but secondary use case.
