---
status: tentative
last-updated: 2026-05-11
user-stories-addressed: [US-16, US-17, US-25]
links:
  - ../features/README.md
  - ../open-questions/normalization-aggressiveness.md
---

# Track identity is a foundational primitive

> **Principle.** "Is this the same track?" is a problem several podkit
> features need to answer. The answer should come from one shared
> primitive, not be re-implemented per feature.

## Why

The same matching question shows up in at least four contexts:

1. **Cross-source playlists.** A playlist is curated in one source; the
   tracks are synced from another. Each playlist entry must be matched to
   the active source's inventory.
2. **Source ↔ device matching.** When the selector decides what to keep,
   add, or evict, it has to know which source track corresponds to which
   on-device track. Especially relevant for OTG-protection.
3. **Self-healing sync** (ADR-009). Detecting when a source file has changed
   in place ("this is the same logical track, but the file content differs")
   requires identity beyond path/size.
4. **Future dedup** across multiple sources or against device state.

If each feature builds its own matcher, we get inconsistent behaviour and
maintenance pain. A shared primitive — `TrackIdentity` plus a matching
cascade — keeps the logic in one place.

## What the principle implies

- A `TrackIdentity` type lives in core, with fields like `mbid?`, normalised
  `artist`, optional normalised `album`, normalised `title`, and optional
  `duration` for tiebreaks.
- A matching cascade also lives in core: MBID match → exact tag match →
  fuzzy tag match → duration tiebreak → no-match.
- Source adapters produce `TrackIdentity` records on output and accept them
  on input ("find tracks matching this identity"). Adapters fill in what
  they can; missing fields propagate to the matcher.
- Normalisation rules (Unicode, casefold, "feat." handling, parenthetical
  stripping) live in core and are versioned — changing them is a deliberate
  decision because it affects existing matches.

## What the principle does not say

- It does not say identity must be globally unique. Identity is a *matching
  contract*, not a primary key. Two distinct tracks can produce equal
  identity records; the matcher handles ambiguity (typically by warning).
- It does not commit to a specific normalisation aggressiveness. That is an
  open question — see
  [`../open-questions/normalization-aggressiveness.md`](../open-questions/normalization-aggressiveness.md).
- It does not say all features that touch tracks must use it. Internal
  source operations that work with the source's native IDs (Subsonic song
  ID, file path) don't need identity records.

## Discussion / origin

The question of how to match tracks across sources came up while designing
cross-source playlist resolution. As soon as we had a shape for that
matcher, it became obvious it was the same machinery we'd want for the
other contexts above. The user agreed it should be lifted to its own
sub-PRD: *"Track identity probably wants its own PRD or ADR of comparable
weight to the selection PRD itself."*

## Tensions to watch

- **Cost of identity computation.** For directory sources, deriving
  identity means reading file tags. For 5000-track libraries that's real
  I/O. Caching is required (probably keyed by file path + mtime).
- **Identity stability under user actions.** If a user fixes a tag, the
  identity changes. Whether that should be treated as "same track, updated"
  or "different track" is feature-specific. The primitive provides identity;
  the feature decides behaviour.
- **Identity in the absence of metadata.** A bare M3U with no EXTINF and no
  accessible files cannot produce useful identities. We need to surface
  this clearly rather than silently dropping the entries.
