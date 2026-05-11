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

A tier-ordered plan for sequencing music-selection work into shippable
chunks. **Tentative** — both the sub-PRD inventory and the tier ordering will
firm up as features get drafted and open questions are resolved.

Each tier is independently shippable: completing tier N delivers user-facing
value without requiring tier N+1 to be done. Later tiers depend on earlier
tiers, but earlier tiers do not depend on later ones.

## Tier 0 — Foundation

The baseline that everything else sits on. Without these three, no later
tier is meaningful.

| Sub-PRD                              | Status        | Depends on                                |
|--------------------------------------|---------------|-------------------------------------------|
| Sources & Collections architecture   | not drafted   | Resolution of source/collection-decoupling open question |
| Selector pipeline core               | not drafted   | Sources & Collections                     |
| File-size estimation accuracy        | not drafted   | Estimation spike                          |

Foundational because:
- Sources & Collections defines the config grammar everything else uses.
- The selector pipeline turns intent into action; without it, "selection" is
  still naive.
- Estimation accuracy gates whether capacity-fit can ever be reliable.

## Tier 1 — Curation surface

Visible-to-users curation primitives.

| Sub-PRD                                  | Status        | Depends on |
|------------------------------------------|---------------|------------|
| Per-content-type collections (TV/movies) | not drafted   | Tier 0; obsoletes doc-007 |
| Device playlists (write side)            | not drafted   | Tier 0     |

Tier 1 is what users *feel*: they can finally curate properly and see playlists
on the device.

## Tier 2 — Track identity foundation

Single foundational piece that unlocks everything in Tier 3.

| Sub-PRD                  | Status        | Depends on |
|--------------------------|---------------|------------|
| Track identity matching  | not drafted   | Tier 0     |

Track identity is its own primitive; it has consumers beyond music selection
(self-healing sync, source/device matching, future dedup), but the
music-selection workspace is its first heavy user.

## Tier 3 — Cross-source and on-device awareness

Higher-end features that depend on identity matching.

| Sub-PRD                                       | Status        | Depends on |
|-----------------------------------------------|---------------|------------|
| Cross-source playlists (existing WIP PRD)     | parked        | Tier 2     |
| Device state read + OTG protection            | not drafted   | Tier 2; libgpod-node / ipod-db read capability |

Cross-source playlists is intentionally parked until the cross-source
question (whether we support it at all) is answered — see open question.

## Tier 4 — Smarts (later)

| Sub-PRD                          | Status        | Depends on |
|----------------------------------|---------------|------------|
| Smart / rotational selection     | not drafted   | Tier 3 (needs play counts) |
| Audiobook content type           | not drafted   | Tier 0/1   |
| Podcast content type             | not drafted   | Tier 0/1; possibly Tier 2 for episode identity |

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

- Whether **per-content-type collections** (Tier 1) actually requires the full
  Sources & Collections architecture (Tier 0), or could ship with a thinner
  scope. If it could, the tier boundary is wrong.
- Whether **device playlists (write)** can usefully ship before
  per-content-type collections. They're independent in principle.
- Whether **OTG protection** can be partially implemented in Tier 1 with a
  conservative "warn, don't act" default, with full Tier 3 implementation
  later. This would derisk Tier 1 device playlist write.

These are the kind of questions that get resolved when each sub-PRD is
drafted in detail.

## Updating this roadmap

The roadmap is **continually refined**. Status of each sub-PRD is mirrored in
[`features/README.md`](features/README.md) — when the two disagree, the
features index is the source of truth.

Add new sub-PRDs to the appropriate tier as they are identified. Move them
between tiers if dependency analysis reveals different sequencing. Re-order
within a tier freely.
