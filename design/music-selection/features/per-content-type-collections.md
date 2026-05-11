---
slug: per-content-type-collections
title: Per-content-type collections (TV/movies)
tier: 1
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-04, US-10, US-21, US-22]
depends-on:
  features: [sources-and-collections, selector-pipeline]
depended-on-by-features: [audiobook-content-type, podcast-content-type]
gated-by:
  open-questions: []
informed-by-spikes: []
---

# Per-content-type collections (TV/movies)

> **Status: not drafted.** Reserves the feature slug. Obsoletes doc-007
> ("Video Collection Split — TV Shows & Movies").

## Scope (at a glance)

Add first-class content types beyond `music`: starting with `tv` and
`movies`. Each content type has:

- Its own filter primitive vocabulary (shows, episodes-per-show,
  prefer-unwatched for TV; year, director for movies; etc.).
- Its own CLI display / drill-down (separate from music).
- Its own per-device block on devices (`tv.source`, `tv.collection`).

Content type is declared explicitly on sources
(see [content-type-is-explicit](../principles/content-type-is-explicit.md)),
not auto-detected. Replaces doc-007's section-based approach
(`[tv.X]` / `[movies.X]`) with the unified `[collections.X] content =
"..."` model.

## Why this is Tier 1

Visible-to-users feature that delivers a real curation upgrade for
non-music content.

## Notes for the eventual draft

- doc-007 has substantial content (CLI design, display fields,
  fixtures); the new sub-PRD should reuse that thinking even though
  the config-schema approach changes.
- Audiobook and podcast content types (US-21, US-22) inherit this
  feature's machinery and add their own primitives later.
