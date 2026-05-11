---
slug: cross-source-playlists
title: Cross-source playlists (WIP)
tier: 3
status: parked
last-updated: 2026-05-11
user-stories-addressed: [US-15, US-16]
depends-on:
  features: [sources-and-collections, track-identity]
depended-on-by-features: []
gated-by:
  open-questions: [source-collection-decoupling]
informed-by-spikes: []
---

# Cross-source playlists (WIP)

> **Status: parked.** This sub-PRD is deliberately held early-stage
> pending resolution of
> [source-collection-decoupling](../open-questions/source-collection-decoupling.md).
> If that question resolves toward not supporting cross-source, this
> feature is dropped entirely.

## Scope (at a glance)

Resolve playlist references against a source other than the active
music source. Enables:

- Curating in Subsonic, syncing from local files (US-16).
- Standalone playlist-providing sources (US-14 connects via the
  sources-and-collections feature; cross-source extends the model).
- Podkit-native playlists (US-15) — playlists defined inside podkit
  itself.

Built on the [track-identity](track-identity.md) primitive: a playlist
defined in source A is a list of track identities; the active source B
is asked to find tracks matching each identity.

## Why this is parked

Cross-source flexibility may not be worth the cost; the user has
flagged this as an explicit fork. The sub-PRD remains as a placeholder
so the design has a clear "this would live here if we go that way."

## Notes for the eventual draft

- Heavily dependent on the track-identity sub-PRD existing first.
- The user has also flagged this as worthy of its own
  pre-existing-but-distinct WIP PRD even if cross-source survives.
- API surface (pinning playlist sources, CLI overrides) is the most
  contested part of the design.
