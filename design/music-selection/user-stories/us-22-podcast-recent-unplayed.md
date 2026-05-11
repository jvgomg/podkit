---
id: US-22
title: Podcast recent unplayed
priority: P3
status: deferred
scope: in
theme: future-content-types
last-updated: 2026-05-11
addressed-by:
  features: [podcast-content-type]
  principles: [content-type-is-explicit]
  open-questions: []
  spikes: []
---

# US-22 — Podcast recent unplayed

> Sync the last N unplayed episodes per podcast feed.

## Detail

Podcast listeners want their device to act as a queue of recent episodes
from their subscribed feeds. Newer episodes should rotate in;
already-played episodes should rotate out (unless they've been
explicitly retained).

## Acceptance signal

```toml
[sources.podcasts]
type = "rss"            # or opml, or directory of feeds
path = "/Users/me/podcasts.opml"
content = "podcast"

[collections.queue]
filter.episodes-per-feed = 5
filter.state = "unplayed"
filter.added-after = "30d"

[devices.terapod]
podcast.source = "podcasts"
podcast.collection = "queue"
```

## Notes

Deferred — needs:
- Podcast source adapter (RSS or OPML-based).
- Podcast content type with feed/episode hierarchy in collections.
- Device state read for play state.

The podcast use case may also drive a richer dynamic-selection model
(rotation, freshness) than music alone needs. Worth considering as a
testbed for smart selection (Tier 4).
