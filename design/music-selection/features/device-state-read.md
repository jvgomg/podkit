---
slug: device-state-read
title: Device state read + OTG protection
tier: 3
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-17, US-25]
depends-on:
  features: [sources-and-collections, track-identity]
depended-on-by-features: [smart-selection]
gated-by:
  open-questions: []
informed-by-spikes: []
---

# Device state read + OTG protection

> **Status: not drafted.** Reserves the feature slug for the read-side
> of device interaction.

## Scope (at a glance)

Read device-side state and feed it into the selector pipeline. Covers:

- Reading on-device playlists (OTG, user-renamed podkit playlists,
  device-curated playlists).
- Reading play counts and timestamps where available.
- Reading audiobook bookmark positions where available.
- Matching device-side tracks back to source identities via the
  [track-identity](track-identity.md) primitive.
- Surfacing the read data to selector policies (OTG protection,
  orphan-track warnings, rotation eligibility).

## Why this is Tier 3

Depends on track-identity (Tier 2) and on read capabilities in
libgpod-node / ipod-db. Without device-side reads, several user-facing
selection behaviours (OTG protection, smart rotation) can't be honest
about what the device contains.

## Notes for the eventual draft

- The libgpod-node / ipod-db reads may not be uniformly available
  across iPod generations; the sub-PRD documents graceful degradation
  where capability is missing.
- OTG-protection-during-eviction is a selector-pipeline *policy* that
  consumes device-state; the policy itself can be declared at the
  collection or device level.
- Read-back of user renames is the messiest case — when a user
  renames a podkit-synced playlist on the device, the next sync needs
  to recognise it.
