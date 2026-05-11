---
slug: device-playlists-write
title: Device playlists (write side)
tier: 1
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-05, US-07, US-08, US-12]
depends-on:
  features: [sources-and-collections, selector-pipeline]
depended-on-by-features: []
gated-by:
  open-questions: [pinned-set-exceeds-capacity]
informed-by-spikes: []
---

# Device playlists (write side)

> **Status: not drafted.** Reserves the feature slug for the
> "materialise collection playlists on the device" feature.

## Scope (at a glance)

A collection's `playlists = [...]` becomes a navigable playlist on the
device after sync. Implements:

- Resolution: collection-named playlists → tracks via the source.
- Materialisation: writes the playlist record into the device DB
  (libgpod or ipod-db, depending on target).
- Pin contribution: pinned tracks feed the selector pipeline's pin
  set.
- `playlist-mode` semantics (`union` / `intersect`).
- Update behaviour on subsequent syncs (renamed, reordered, removed
  playlists).

## What's not in scope here

- Reading device-side playlists (OTG, on-device curation) — that's
  the [device-state-read](device-state-read.md) feature.
- Cross-source playlist resolution — covered by
  [cross-source-playlists](cross-source-playlists.md), which is its own
  WIP PRD.

## Notes for the eventual draft

- Pinned-set-exceeds-capacity gates the over-budget behaviour. Until
  resolved, the sub-PRD documents the policy as TBD with a
  conservative default.
- Order preservation when materialising is a quiet but real
  requirement.
