---
id: TASK-436.04
title: 'Fix sync call-site ordering: resolve device before collections'
status: Done
assignee: []
created_date: '2026-06-24 15:20'
updated_date: '2026-06-24 16:21'
labels:
  - sync
  - refactor
dependencies:
  - TASK-436.03
parent_task_id: TASK-436
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral correctness-enabling refactor in the sync command.

Today collection resolution runs before the path/UUID-matched device config entry is fully bound, so any device-scoped defaulting would be silently skipped for devices not selected by literal name. Reorder so the target device (including path/UUID matches to a named `[devices.x]` entry) is resolved first, then call `resolveEffectiveCollections` once with the resolved device threaded in. Resolution stays global-only in this slice (the `device` input is passed but the cascade does not yet consult per-device defaults), so behavior is unchanged — this slice only puts the plumbing in the right order.

A raw, unconfigured by-path device must pass `device: undefined` (no config match) so it keeps falling back to global defaults.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 7, 8, 26 (enabling).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Device (incl. path/UUID match to a named config entry) is resolved before collections in the sync command
- [x] #2 resolveEffectiveCollections is called once, after device resolution, with the resolved device passed in
- [x] #3 Raw unconfigured by-path devices resolve with no device context (global-only)
- [x] #4 Sync behavior is unchanged in this slice (still global-only cascade); existing sync tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved the entire "Resolve collections" block (resolveEffectiveCollections call + musicCollections/videoCollections derivation + hasMusicToSync/hasVideoToSync empty-check throw + the source-path-existence validation loop) from BEFORE core-load/device-path resolution to immediately AFTER the `if (resolved.matchedDevice) { ... }` matched-device block in packages/podkit-cli/src/commands/sync.ts. File now: collection block sits between the matched-device block's closing brace and the `resolved.hint` block.

Device-arg threaded into resolveEffectiveCollections:
  device: resolved.matchedDevice
    ? { name: resolved.matchedDevice.name, config: resolved.matchedDevice.config }
    : resolvedDevice
A configured device selected by literal name OR auto-matched by path/UUID now passes its {name, config}; a raw unconfigured by-path device (no matchedDevice, no named resolvedDevice) passes resolvedDevice === undefined → global-only. Shapes verified: MatchedDevice = {name, config: DeviceConfig} (resolvers/device.ts:201), resolvedDevice = {name, config} | undefined, and resolveEffectiveCollections' device param = {name, config: DeviceConfig} (resolvers/effective-collections.ts:78). Cascade remains global-only this slice — `input.device` is still intentionally unused by the resolver, so the SET of resolved collections is unchanged. No edits to resolveEffectiveCollections / config/resolve.ts / config/loader.ts. Error messages/codes unchanged — throws were moved verbatim.

Verification that nothing between old and new location consumes the collection vars: the skipped region (loadCoreOrFail, getDeviceManager, resolveDevicePath/autoDetectDevice → `resolved`, the !resolved.path throw, the matchedDevice block) reads none of allCollections/musicCollections/videoCollections/hasMusicToSync/hasVideoToSync. All downstream consumers (hasMusicToSync codec gate, runCollectionPhase for music+video, dry-run loops, presenters) are far below the new location and still resolve in scope. Typecheck confirms.

Intended error-precedence change (accepted): with the empty-collections throw and source-path-existence throw now AFTER device-path resolution, when BOTH a device-path problem and a collection problem exist, the DEVICE error surfaces first (previously the collection error did). No test asserts the old precedence — verified across unit + e2e. Two generic e2e tests (sync.test.ts "outputs validation errors in JSON" and video-sync.test.ts equivalent) set up no device + no collections and assert only `json?.error` is defined; they now surface the device error first but still pass because the assertion is generic.

Reviewed (Sonnet): no blocking/should-fix. Confirmed nothing in the skipped region consumes the collection vars, the device-arg ternary shape is correct for matched/named/raw cases, and the cascade stays global-only. The intended error-precedence shift is the only behavioral change. NOTE flagged for the human at the Phase 1 checkpoint: `sync --dry-run` with a bad/missing collection path AND no device connected now surfaces a device error before the collection error (offline config validation now requires device resolution first). No existing test exercises that workflow, so nothing breaks — but it is a real UX change pending sign-off.
<!-- SECTION:NOTES:END -->
