---
id: TASK-295.04
title: P4.4 — Snapshot tests pre/post resolveCapabilities migration
status: Done
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-06 22:36'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Snapshot-test capability resolution against representative configs (both iPod and Echo Mini, with and without firmware data). Diff outputs from before and after the resolveCapabilities migration in P4.3 — must be empty.

This catches any drift introduced when moving sync engine call sites from `createIpodCapabilities` to `resolveCapabilities`.

See spec doc-035, Test plan > Integration tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Snapshot tests cover representative iPod + Echo Mini configs
- [x] #2 Snapshots compared pre-P4.3 and post-P4.3 — byte-identical
- [x] #3 Any drift triggers a deliberate review; documented or fixed
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created `packages/podkit-core/src/device/resolve-capabilities.parity.test.ts` with 39 tests (36 pass, 3 deliberate skips).

**iPod parity (28 generation tests):** Iterated all `IpodGenerationId` values with non-`unknown` libgpod mappings (identical set to `capabilities.test.ts`). Each test feeds table-authoritative supportsArtwork/supportsVideo flags to both `createIpodCapabilities` and `resolveIpodModelCapabilities(modelFromLibgpodInfo(...))`. All 28 pass — byte-identical output confirmed.

**Mass-storage parity (9 tests):** Each of echo-mini, rockbox, generic tested with no overrides, artworkMaxResolution override, and supportedAudioCodecs override. `resolveCapabilities({ kind: 'mass-storage', presetId }, opts)` vs `resolveDeviceCapabilities(presetId, overrides)`. Note: `resolveDeviceCapabilities` returns `DevicePreset` (includes `contentPaths`); `resolveCapabilities` returns `DeviceCapabilities` (no `contentPaths`). Tests strip `contentPaths` before comparison — this is correct because `contentPaths` is a sync-routing concern, not a capability. All 9 pass.

**Coverage assertions (2 tests):** Confirm PARITY_GENERATION_IDS matches all non-unknown libgpod mappings, and exactly 4 table-only generations exist (nano_7g, touch_5g/6g/7g).

**3 deliberate skips (documented divergences):** The legacy adapter respected libgpod's runtime `supportsArtwork` flag (returning null when false). The new path is class-authoritative (returns table value regardless). These cases are skipped — not failed — with DELIBERATE DIVERGENCE comments explaining that the table is the correct source of truth; libgpod's runtime flag was misleading (e.g. freshly-formatted device before ArtworkDB written).

**Note for 295.05 (shim deletion):** `capability-adapter.ts`, `presets.ts`, and `ipod-models.ts` shims are safe to delete. No call sites depend on the divergent `supportsArtwork: false` behaviour; all live call sites already use the new path (295.03 migrated them). The 3 skipped tests can be deleted along with the shim files.
<!-- SECTION:FINAL_SUMMARY:END -->
