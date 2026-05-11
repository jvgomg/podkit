---
slug: track-identity
title: Track identity matching
tier: 2
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-16, US-17, US-25]
depends-on:
  features: []
depended-on-by-features: [cross-source-playlists, device-state-read, podcast-content-type]
gated-by:
  open-questions: [normalization-aggressiveness]
informed-by-spikes: []
---

# Track identity matching

> **Status: not drafted.** Reserves the feature slug for the
> foundational identity primitive.

## Scope (at a glance)

A shared primitive used by features that need to answer "is this the
same track?" across sources or between source and device. Includes:

- `TrackIdentity` data type (MBID, normalised artist/album/title,
  duration).
- Matching cascade: MBID → exact tag → fuzzy tag → duration tiebreak →
  no-match.
- Normalisation rules (configurable; default tuned to balance
  false-positive / false-negative risk).
- Source-adapter contract: every adapter exposes "produce identity for
  these tracks" and "find tracks matching this identity."
- Caching strategy for expensive identity derivation (directory sources
  need tag reads).

## Why this is Tier 2

Foundational primitive for several Tier 3 features. Builds on Tier 0
adapter infrastructure but is not itself a user-facing feature — it's a
shared piece of plumbing.

## Notes for the eventual draft

- See [track-identity-foundation](../principles/track-identity-foundation.md)
  for the rationale.
- The eventual `specs/track-identity.md` spec captures the matching
  rules in normative form.
- Self-healing sync (ADR-009, out of this workspace's scope) is a
  consumer; the design should acknowledge its existing requirements.
- Normalisation aggressiveness is the main open question; spike work
  may be needed to characterise real-world tag dirtiness.
