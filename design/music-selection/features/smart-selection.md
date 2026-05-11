---
slug: smart-selection
title: Smart / rotational selection
tier: 4
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: []
depends-on:
  features: [selector-pipeline, device-state-read]
depended-on-by-features: []
gated-by:
  open-questions: []
informed-by-spikes: []
---

# Smart / rotational selection

> **Status: not drafted.** Reserves the feature slug for play-count- and
> rotation-aware selection.

## Scope (at a glance)

Dynamic selection that uses device state (play counts, last-played
timestamps) to make smarter decisions:

- Rotation: prefer tracks that haven't played recently, rotate
  freshness into the pool.
- Re-listen avoidance: down-weight just-listened tracks.
- "Discovery" modes: bias toward less-played tracks.

Configured as selector policies on collections or devices; the
*data* comes from [device-state-read](device-state-read.md).

## Why this is Tier 4

Pure improvement on top of capable foundations. No user stories
explicitly call for it today; comes after the foundational
features have shipped and shaped real usage patterns.

## Notes for the eventual draft

- No user stories yet. If/when this feature is drafted, expect new
  user stories to be added.
- The policy / data split should follow the
  [collections-are-content-sets](../principles/collections-are-content-sets.md)
  pattern — rules in the collection, data on the device.
