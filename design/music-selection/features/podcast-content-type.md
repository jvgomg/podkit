---
slug: podcast-content-type
title: Podcast content type
tier: 4
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-22]
depends-on:
  features: [sources-and-collections, per-content-type-collections, track-identity]
depended-on-by-features: []
gated-by:
  open-questions: []
informed-by-spikes: []
---

# Podcast content type

> **Status: not drafted.** Reserves the feature slug.

## Scope (at a glance)

Add `podcast` as a first-class content type. Likely includes:

- A new source adapter type (RSS feeds, OPML feed lists).
- Podcast-specific filter primitives: `episodes-per-feed`, `state =
  "unplayed"`, `added-after`.
- Episode identity (feed + episode-guid).
- Rotation-style selection driven by play state.

## Notes for the eventual draft

- Heavier than audiobooks because new adapter machinery is involved.
- A natural testbed for smart-selection (rotation / freshness).
- Episode "track identity" is meaningfully different from music
  identity — feed+GUID is highly stable when available.
