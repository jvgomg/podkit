---
slug: sources-and-collections
title: Sources & Collections architecture
tier: 0
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-01, US-02, US-03, US-04, US-06, US-09, US-11, US-14, US-26]
depends-on:
  features: []
depended-on-by-features: [selector-pipeline, per-content-type-collections, device-playlists-write, cross-source-playlists, device-state-read, audiobook-content-type, podcast-content-type]
gated-by:
  open-questions: [source-collection-decoupling, filter-overrides-merge-rules, playlist-files-convention, collection-extends-mechanism]
informed-by-spikes: []
---

# Sources & Collections architecture

> **Status: not drafted.** This file reserves the feature slug and tracks
> the user stories, gating questions, and dependencies that the
> sub-PRD will need to address when drafted.

## Scope (at a glance)

The foundational config-grammar feature. Defines:

- The `[sources.<name>]` block: type, content, capabilities, type-specific
  fields.
- The `[collections.<name>]` block: filter rules, playlist references,
  materialised playlists, playlist mode.
- The `[devices.<name>]` per-content-type block: source binding,
  collection reference, inline overrides.
- The relationships between the three (source ↔ collection ↔ device).

See [`../specs/config-schema.md`](../specs/config-schema.md) for the
intended end-state of the TOML schema.

## Why this is Tier 0

Every other feature relies on this grammar. Without it, none of the
selection, playlist, or capacity logic has a config surface to read.

## Notes for the eventual draft

- Multiple gating open questions — the draft can't fully nail down the
  collection / device schema until those resolve.
- The breaking config change drives US-26 (migration friendliness); the
  draft should include the migration spec, even if mechanics live in
  doc-006.
- Watch for terminology drift; cite
  [`../specs/terminology.md`](../specs/terminology.md) rather than
  redefining terms.
