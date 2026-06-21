---
id: TASK-430.03
title: Collapse disguised single-target .find() loops into locate
status: Done
assignee: []
created_date: '2026-06-21 09:27'
updated_date: '2026-06-21 10:54'
labels:
  - device-discovery
  - refactor
milestone: m-18
dependencies:
  - TASK-430.02
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drive-by deepening exposed by the scan/locate seam (doc-045). Several call sites enumerate then `.find()` a single device by known path/uuid — replace each with a direct `locate` call:

- `device/add.ts` HFS+-on-Linux refusal: matches the explicit path against a full enumerate → `locate({ path })`.
- `device/add.ts` post-mount re-fetch (was `findByVolumeUuid` after mount) → `locate({ volumeUuid })`.
- `resolvers/device.ts` `matchPathToConfigDevice`: currently `getUuidForMountPoint` then `findByVolumeUuid` (two enumerations) → a single `locate({ path })` (the returned record already carries the device info; drop the second call).

Kept separate from TASK-430.02 to keep that atomic interface swap reviewable.

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The `add.ts` HFS+ match, `add.ts` post-mount re-fetch, and `matchPathToConfigDevice` use a single `locate` call each — no enumerate-then-find
- [x] #2 `matchPathToConfigDevice` makes one `locate` call instead of two device queries
- [x] #3 Existing behaviour preserved (tests green); subprocess-count reduction observable where tested
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Collapsed by sonnet worker + review. Site 1 (add.ts HFS+ --path refusal): scan()+.find() -> single locate({path}), reads .storage.filesystem; null result = no-match = no refusal (unchanged). Site 2 (add.ts post-mount re-fetch): already a clean locate({volumeUuid}) after 430.02 — no change needed. Site 3 (resolvers/device.ts matchPathToConfigDevice): two locate calls -> one locate({path}), the returned PlatformDeviceInfo reused as deviceInfo; UUID-less (volumeUuid:'') guarded so no spurious config match. Tests: HFS+ --path test asserts 1 locate call; new resolver test asserts exactly ONE locate + deviceInfo reuse (toEqual). Behaviour unchanged. Gates green.
<!-- SECTION:NOTES:END -->
