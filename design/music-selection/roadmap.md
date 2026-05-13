---
status: tentative
last-updated: 2026-05-11
links:
  - README.md
  - features/README.md
  - open-questions/README.md
  - spikes/README.md
---

# Roadmap

Tier-ordered plan for sequencing music-selection work into shippable
chunks. **Tentative.**

Each tier is independently shippable: completing tier N delivers
user-facing value without requiring tier N+1 to be done. Later tiers
depend on earlier tiers; earlier tiers do not depend on later ones.

**This document is about *sequencing intent*** — what goes together,
what unblocks what, and why. Per-feature data (status, exact
dependencies, summary, user-stories-addressed) lives in each feature's
own stub under [`features/`](features/). When the roadmap and the
feature stubs disagree, the stub wins.

## Tier 0 — Foundation

The baseline. Without these three, no later tier is meaningful.

- [`features/sources-and-collections.md`](features/sources-and-collections.md)
- [`features/selector-pipeline.md`](features/selector-pipeline.md)
- [`features/estimation-accuracy.md`](features/estimation-accuracy.md)

Foundational because:

- Sources & Collections defines the config grammar everything else uses.
- The selector pipeline turns intent into action; without it,
  "selection" is still naive.
- Estimation accuracy gates whether capacity-fit can ever be reliable.

## Tier 1 — Curation surface

Visible-to-users curation primitives.

- [`features/per-content-type-collections.md`](features/per-content-type-collections.md)
- [`features/device-playlists-write.md`](features/device-playlists-write.md)

Tier 1 is what users *feel*: they can finally curate properly and see
playlists on the device.

## Tier 2 — Track identity foundation

Single foundational piece that unlocks everything in Tier 3.

- [`features/track-identity.md`](features/track-identity.md)

Track identity is its own primitive. It has consumers beyond music
selection (self-healing sync, source/device matching, future dedup),
but the music-selection workspace is its first heavy user.

## Tier 3 — Cross-source and on-device awareness

Higher-end features that depend on identity matching.

- [`features/cross-source-playlists.md`](features/cross-source-playlists.md) — parked (WIP)
- [`features/device-state-read.md`](features/device-state-read.md)

Cross-source playlists is intentionally parked until the cross-source
question (whether we support it at all) is answered — see the
[source-collection-decoupling open question](open-questions/source-collection-decoupling.md).

## Tier 4 — Smarts (later)

- [`features/smart-selection.md`](features/smart-selection.md)
- [`features/audiobook-content-type.md`](features/audiobook-content-type.md)
- [`features/podcast-content-type.md`](features/podcast-content-type.md)

## Dependencies — visual

```
Tier 0 ────────┬───────────┬──────────────┐
               │           │              │
Tier 1   per-content-type  device         │
         collections       playlists      │
               │           (write)        │
               │                          │
Tier 2 ────────┴────────── track identity ┤
                                          │
Tier 3   ────────── cross-source playlists│
                    device state read     │
                    OTG protection        │
                                          │
Tier 4   ────────── smart selection       │
                    audiobooks            │
                    podcasts ─────────────┘
```

## Open sequencing questions

- Whether **per-content-type collections** (Tier 1) actually requires
  the full Sources & Collections architecture (Tier 0), or could ship
  with a thinner scope. If it could, the tier boundary is wrong.
- Whether **device playlists (write)** can usefully ship before
  per-content-type collections. They're independent in principle.
- Whether **OTG protection** can be partially implemented in Tier 1
  with a conservative "warn, don't act" default, with full Tier 3
  implementation later. This would derisk Tier 1 device playlist
  write.

These are the kind of questions that get resolved when each sub-PRD
is drafted in detail.

## Updating this roadmap

When a feature moves tier or gets added/removed:

1. Update the feature's own stub file (status, frontmatter).
2. Add / remove / move the bullet under the appropriate tier here.
3. Update the dependency graph if the shape changes.

Per-feature data (status, dependencies, user-stories-addressed) is
**not** mirrored here — the stub is the single source.
