---
slug: audiobook-content-type
title: Audiobook content type
tier: 4
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-21]
depends-on:
  features: [sources-and-collections, per-content-type-collections]
depended-on-by-features: []
gated-by:
  open-questions: []
informed-by-spikes: []
---

# Audiobook content type

> **Status: not drafted.** Reserves the feature slug.

## Scope (at a glance)

Add `audiobook` as a first-class content type, parallel to `music`,
`tv`, `movies`. Includes:

- Source content typing: `content = "audiobook"`.
- Audiobook-specific filter primitives: `state = "unfinished"`,
  `series`, `author`, etc.
- Bookmark / progress integration via
  [device-state-read](device-state-read.md).
- CLI display tailored to audiobook hierarchy.

## Notes for the eventual draft

- Inherits the machinery from
  [per-content-type-collections](per-content-type-collections.md).
- Audiobook progress on iPods has known weak points; sub-PRD may need
  a research spike on device-side bookmark support.
