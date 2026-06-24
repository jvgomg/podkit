---
id: TASK-436
title: Per-device default collections + collection-resolution consolidation
status: Done
assignee: []
created_date: '2026-06-24 15:19'
updated_date: '2026-06-24 17:16'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All 10 subtasks complete and committed on branch feat/per-device-default-collections (6 feature/refactor commits + 1 planning commit, off main after FF-merging the archive branch). Phase 1 (refactors .01-.04) behavior-neutral, Phase 2 (.05-.09 + follow-up .10) the feature. Each batch worker-implemented → self-review → Sonnet review → team-lead adjudication → commit. Final state: podkit unit 1902 pass/0 fail, typecheck+lint clean, capstone e2e 2 pass. One accepted behavior change surfaced + signed off at the Phase 1 checkpoint: collection-config error precedence (now device-first) — .10 restored offline validation for the device-independent -c flag case; the no-flag/global case stays device-dependent/late by design. NOT run in this environment: full host e2e suite (test:e2e) and VM tests — see team-lead handoff.
<!-- SECTION:NOTES:END -->
