---
id: US-06
title: Different selection per device size
priority: P0
status: open
scope: in
theme: multi-device
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections, selector-pipeline]
  principles: [collections-are-content-sets, inline-collections-on-devices]
  open-questions: []
  spikes: []
---

# US-06 — Different selection per device size

> A big iPod (Classic, ~160GB) gets everything from a source; a smaller
> iPod (Nano, ~16GB) gets a curated subset of the same source.

## Detail

User has two devices with very different capacities, both syncing from
the same library. The big one should get the full library (or close to
it). The smaller one should get a curated subset — perhaps a single
playlist, a genre filter, or a "favourites" rating threshold.

## Acceptance signal

```toml
[sources.music]
path = "/Volumes/Music"
content = "music"

[collections.everything]
# no filter rules — whole source

[collections.favourites]
filter.rating = ">= 4"
playlists = ["Favourites"]

[devices.classic]
music.source = "music"
music.collection = "everything"

[devices.nano]
music.source = "music"
music.collection = "favourites"
```

Both devices sync from the same source, with different curation.

## Notes

Distinct from [US-02](us-02-shared-rules-across-devices.md) — that's
about *sharing* rules across devices; this is about *differing* rules per
device while sharing the source.
