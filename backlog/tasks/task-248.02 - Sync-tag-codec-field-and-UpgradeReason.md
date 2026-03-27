---
id: TASK-248.02
title: Sync tag codec field and UpgradeReason
status: To Do
assignee: []
created_date: '2026-03-27 10:41'
labels:
  - feature
  - transcoding
dependencies: []
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend sync tags with a `codec` field and add `'codec-changed'` to `UpgradeReason`. This is independent of the resolver and can be built in parallel.

See PRD: doc-024, sections "Sync tag codec field" and "UpgradeReason for codec changes."

**Sync tags:** Add `codec` field to `SyncTagData` (e.g., `[podkit:v1 quality=high encoding=vbr codec=aac]`). Update parser and serializer. Legacy tags without `codec`: `quality=lossless` → assume ALAC; other qualities → assume AAC for transcoded tracks; source codec for direct copies.

**UpgradeReason:** Add `'codec-changed'` to `UpgradeReason` type (not just `UpdateReason` — codec changes require file replacement, and `SyncOperation` for upgrades requires an `UpgradeReason`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sync tag parser reads `codec` field from tags like `[podkit:v1 quality=high encoding=vbr codec=aac]`
- [ ] #2 Sync tag serializer writes `codec` field when present
- [ ] #3 Legacy tags without `codec` field parse successfully — `quality=lossless` infers ALAC, other qualities infer AAC
- [ ] #4 Direct-copy tracks without `codec` field infer source file's codec
- [ ] #5 `'codec-changed'` exists as an `UpgradeReason` variant
- [ ] #6 Unit tests cover parsing, serialization, and legacy inference for all cases
<!-- AC:END -->
