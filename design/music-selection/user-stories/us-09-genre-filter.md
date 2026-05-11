---
id: US-09
title: Genre filter
priority: P1
status: open
scope: in
theme: selection-fundamentals
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections, selector-pipeline]
  principles: [collections-are-content-sets]
  open-questions: []
  spikes: []
---

# US-09 — Genre filter

> Sync only tracks of a specific genre (or set of genres) from a source.

## Detail

The simplest possible filter rule: a metadata-based predicate. User wants
a "jazz iPod" or a "kids' music iPod" without writing playlists for it.
Filter rules are the basic vocabulary every collection can use.

## Acceptance signal

```toml
[collections.jazz]
filter.genre = ["Jazz", "Bebop", "Cool Jazz"]

[devices.jazz-pod]
music.source = "music"
music.collection = "jazz"
```

Sync produces a device with only matching tracks.

## Notes

Genre is the obvious first filter primitive. The set of filter primitives
the design needs to support (year, rating, added-after, etc.) is the
remit of the sources-and-collections sub-PRD.
