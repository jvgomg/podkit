---
status: deferred
last-updated: 2026-05-11
importance: low (today)
user-stories-addressed: []
gates-features: []
informed-by-spikes: []
links:
  - ../principles/collections-are-content-sets.md
---

# Should one device be able to draw music from multiple sources?

> **The question.** The current model has one source per content type per
> device — one music source, one TV source, etc. Should a single device be
> able to draw music from *multiple* music sources, combined?

## Why this matters

Some user setups push toward multi-source per content type:

- User has a local directory of cherished/high-quality music *and* a
  Subsonic server with broader (sometimes-streamed) catalog. They want
  some of each on the iPod.
- User has a "long-term archive" source and a "new arrivals" source; both
  should feed the device but with different selection rules.

The 1:1 constraint is simpler but rules these out.

## Why it's deferred

- No clear user demand yet. We have not seen this requested.
- The architectural cost is non-trivial: track-identity dedup, conflict
  resolution (which source wins for the same logical track), per-source
  capacity allocation, ordering when materialising playlists.
- The current 1:1 model is implementable cleanly and covers all known user
  stories (US-01..US-22 are all 1:1 per content type).

## What would resolve this

A real user story that 1:1 cannot serve, *plus* a willingness to absorb
the additional complexity. Until then this stays deferred.

## Implementation notes (for future use)

If we ever do this, the shape might look like:

```toml
[devices.terapod]
music.sources = [
  { name = "local-music", priority = 1 },
  { name = "navidrome", priority = 2 },
]
music.collection = "my-music"
```

The selector would build a unified track inventory from all sources,
resolve dedup via track identity, and let collection filters apply across
the union. Conflicts (same track in multiple sources) would resolve by
priority. The materialised playlist mechanism would have to choose a
"home" source per track for any source-specific operations.

This is hand-wavy. The real design lives in the future if and when this
becomes a real need.

## Related

- Collections-are-content-sets principle (would need to absorb multi-source
  resolution as part of "applying" the collection).
- Track-identity-foundation principle (mandatory for dedup).
