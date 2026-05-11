---
slug: selector-pipeline
title: Selector pipeline
tier: 0
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-01, US-05, US-06, US-08, US-09, US-18, US-23, US-24, US-25]
depends-on:
  features: [sources-and-collections]
depended-on-by-features: [per-content-type-collections, device-playlists-write, smart-selection]
gated-by:
  open-questions: [pinned-set-exceeds-capacity]
informed-by-spikes: []
---

# Selector pipeline

> **Status: not drafted.** Reserves the feature slug. The eventual
> sub-PRD will define the runtime selection algorithm and its capacity /
> pin / eviction semantics.

## Scope (at a glance)

The selector pipeline runs at sync time. It takes:

- A collection (intent — filter rules, materialised playlists,
  playlist-mode).
- Device state (reality — what's currently on the device, play counts,
  on-device playlists).
- Device capacity (constraint).

And produces:

- The effective track set for sync.
- Per-track decisions (add / keep / remove / protect) with reasoning.

Key stages: filter resolution → pin set materialisation → pool resolution
→ capacity-fit → eviction policy → plan.

Pin > pool ordering is a fundamental rule (pinned tracks take capacity
priority over pool tracks).

## Why this is Tier 0

Selection is currently naive ("everything until full"). This feature
introduces the structured, predictable selection that every user-facing
selection story relies on.

## Notes for the eventual draft

- Closely related spec:
  [`../specs/config-schema.md`](../specs/config-schema.md) (input
  vocabulary) and the planned `selector-semantics.md` (the algorithm
  itself).
- Pinned-set-exceeds-capacity is the main blocking open question; the
  pipeline's over-budget UX hinges on its resolution.
- The dry-run and pre-flight UX (US-23, US-24) need plan output rich
  enough to explain decisions.
