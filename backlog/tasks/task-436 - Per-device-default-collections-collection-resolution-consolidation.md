---
id: TASK-436
title: Per-device default collections + collection-resolution consolidation
status: To Do
assignee: []
created_date: '2026-06-24 15:19'
labels:
  - collections
  - config
  - sync
  - refactor
  - epic
dependencies: []
references:
  - >-
    doc-050 -
    PRD-Per-Device-Default-Collections-Collection-Resolution-Consolidation.md
ordinal: 181000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Epic tracking the implementation of per-device default collections, landed on a consolidated collection/default resolution core.

See PRD: Backlog document **doc-050** ("PRD: Per-Device Default Collections + Collection-Resolution Consolidation").

**Summary:** Add per-device default music/video collections (tri-state `CollectionDefault = string | false`: unset=inherit global, name=use, false=explicit none). Precedence `-c flag > device default > global default > none`. Per-device defaults apply only to devices resolving to a named `[devices.x]` entry (by name, path, or UUID match); raw unconfigured devices fall back to global. Set via extended `podkit device set`; surfaced in `device info` + `device list`.

The feature is mostly a refactor: extract a provenance-carrying, device-aware `resolveEffectiveCollections` from the inline sync resolver, fix its call-site ordering (it currently runs before the matched device is known), finish the half-done `resolveChain` migration in `config/resolve.ts`, and dedup the loader's repeated TOML parse/validate blocks.

**Subtasks** are refactor-first: behavior-neutral consolidation (resolve.ts migration, loader dedup, resolver extraction, ordering fix) lands ahead of the feature slices (types, cascade wiring, write path, display, e2e). CLI-only — no changeset.
<!-- SECTION:DESCRIPTION:END -->
