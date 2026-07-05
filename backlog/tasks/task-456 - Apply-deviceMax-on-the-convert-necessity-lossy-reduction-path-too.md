---
id: TASK-456
title: Apply deviceMax on the convert-necessity lossy-reduction path too
status: Done
assignee: []
created_date: '2026-07-04 23:29'
updated_date: '2026-07-05 14:03'
labels:
  - sync
  - transcoding
  - device-types
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
priority: low
ordinal: 207000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`resolveLossyReduction` (`packages/podkit-core/src/sync/engine/lossy-reduction.ts`) consults `deviceMax` (the optional `DeviceCapabilities.maxAudioBitrate` ceiling) only on the **preserve-necessity** row. The **convert-necessity** row returns `min(source, cap)` and ignores `deviceMax`, so if a device ever declares a `maxAudioBitrate` below the quality-preset cap, a forced cross-codec transcode under `convert` could exceed the device's stated ceiling.

Harmless today — no device profile populates `maxAudioBitrate` yet (the seam is wired ahead of the data, per ADR-023). Close this when the first device sets the field: include `deviceMax` in the convert-necessity `min(...)`, and scope/clarify the `maxAudioBitrate` doc comment accordingly.

Surfaced during the ADR-023 lossy-reduction redesign (TASK-453.05 review, finding N9).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (Sonnet). Scope widened from the literal ask (convert-necessity only) to make `deviceMax` a **consistent hard device ceiling** — the correct, complete fix per the project principle "device constraints enforced regardless of transfer mode / reduction axis".

Change (`resolveLossyReduction`, `lossy-reduction.ts`): introduced `effectiveCap = deviceMax !== undefined ? min(cap, deviceMax) : cap` and `overDeviceMax = deviceMax !== undefined && source > deviceMax`. Now:
- device-native + preserve → copy, OR reduce to effectiveCap iff `source > deviceMax` (device can't hold it);
- device-native + convert → reduce iff `overDeviceMax || source > effectiveCap×(1+tol)` → effectiveCap;
- necessity + convert → `min(source, effectiveCap)` (was `min(source, cap)` — the N9 gap);
- necessity + preserve → `min(qualityMatched, effectiveCap)`.

Behaviour-preserving when deviceMax is absent (every device today): effectiveCap===cap, overDeviceMax===false → byte-identical. The invariants matrix (run without deviceMax) confirms it. Strict `>` boundary: a source exactly AT deviceMax is copied.

Docs updated: the `resolveLossyReduction` table/docstring, `DeviceCapabilities.maxAudioBitrate` and `QualityTarget.deviceMax` comments (were stale — "preserve-necessity only"), and the ADR-023 §3 table (now uses `cap* = min(cap, deviceMax)` with a TASK-456 note).

Tests: seam unit cases for convert-necessity clamp, device-native convert clamp, preserve forced-reduce, at-boundary copy; integration cases through `classifyDeviceBound` for device-bound convert clamp AND preserve forced-reduce (the old "deviceMax inert on the device bound" test was inverted — it now clamps).

Review: implementation logic, the `>` boundary, and the preserve scope-expansion all confirmed correct; the two BLOCKERs (stale public-API docstrings) + should-fixes (ADR table, integration test) + nit (at-boundary) all applied.

Gate: core unit 9/9, seam tests 90/0, typecheck/lint/build 42/42. No e2e impact (no device populates maxAudioBitrate).
<!-- SECTION:NOTES:END -->
