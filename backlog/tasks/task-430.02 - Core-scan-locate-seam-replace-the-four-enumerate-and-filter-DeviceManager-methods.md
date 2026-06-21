---
id: TASK-430.02
title: >-
  Core scan/locate seam: replace the four enumerate-and-filter DeviceManager
  methods
status: Done
assignee: []
created_date: '2026-06-21 09:27'
updated_date: '2026-06-21 10:14'
labels:
  - device-discovery
  - core-refactor
milestone: m-18
dependencies:
  - TASK-430.01
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce the core discovery seam from doc-045 (M1) and delete the old methods outright (no backwards-compat shims).

Add to `DeviceManager`:
- `scan(options?: { kinds?: ReadonlyArray<'ipod' | 'mass-storage'> }): Promise<PlatformDeviceInfo[]>` — the one enumerate. `scan()` = old `listDevices`; `scan({ kinds: ['ipod'] })` = old `findIpodDevices`, including the Linux `/sys` USB-fingerprint attach.
- `locate(target: { volumeUuid: string } | { path: string }): Promise<PlatformDeviceInfo | null>` — direct single-target via the cheapest OS query (per the spike: macOS `diskutil info`; Linux `findmnt --target` / `blkid -U`). Returns null when unresolvable; degrades to null (never throws) when a binary is missing. UUID-less volumes (tmpfs/Docker bind/FunctionFS) return a record with `volumeUuid: ''` + valid mountPoint.

**Delete:** `listDevices`, `findIpodDevices`, `findByVolumeUuid`, `getUuidForMountPoint`. Migrate all ~14 production call sites (resolvers/device.ts, commands/mount.ts, device/mount.ts, device/add.ts, device/info.ts, device/list.ts) to scan/locate. Rebase `discoverConnectedDevices` onto `scan({ kinds: ['ipod'] })` (`suggestAddIntents` / `checkReadiness` inherit, no edits). Implemented atomically across all 4 platform classes (macos/linux/windows/unsupported). Retarget device-manager + persona tests.

Note: the disguised single-target `.find()` loop collapses are a separate follow-up (TASK-430.03), not here.

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `DeviceManager` exposes `scan` + `locate`; `listDevices`/`findIpodDevices`/`findByVolumeUuid`/`getUuidForMountPoint` removed from the interface and all 4 platform impls
- [x] #2 All production call sites migrated to `scan`/`locate`; `discoverConnectedDevices` calls `scan({ kinds: ['ipod'] })`
- [x] #3 `locate` issues a single direct OS query (no full enumeration), verified by a mocked-subprocess test
- [x] #4 `scan({ kinds: ['ipod'] })` preserves the Linux `/sys` USB-fingerprint attach, pinned by a test
- [x] #5 `locate` returns null on unresolvable target and on missing binary (no throw)
- [x] #6 lint + typecheck + unit/integration tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by opus worker + sonnet review + team-lead triage. `DeviceManager` now exposes `scan({ kinds? })` + `locate({ volumeUuid | path })`; the four enumerate-and-filter methods deleted from the interface and all 4 platform impls (no shims). macOS `locate` = single `diskutil info <path|uuid>` (spike-confirmed); Linux `locate` = `findmnt --pairs --target` (path) / `/dev/disk/by-uuid` realpath → `blkid -U` fallback → node-scoped `lsblk` (uuid). Both degrade to null (never throw) on missing binary / unresolved target; UUID-less mounted volumes return volumeUuid:'' + valid mountPoint. `scan({kinds:['ipod']})` preserves the Linux /sys USB-fingerprint attach (test-pinned via injectable `usbIdentityResolver` seam); plain `scan()` does not. ~14 call sites migrated; `discoverConnectedDevices` rebased onto `scan({kinds:['ipod']})`; `suggestAddIntents`/`checkReadiness` unchanged.

Review triage: matchPathToConfigDevice double-locate and add.ts HFS+/post-mount enumerate+.find collapses correctly DEFERRED to 430.03 (faithful 1:1 swap is the 430.02 contract). Fixed in triage: strengthened the macOS UUID-less locate test to assert exactly 2 `diskutil info` calls and zero enumerate; documented the unimplemented `mass-storage` kinds filter (interface + both platforms); added the `requireLsblk`-deliberately-omitted note in Linux locate.

Gates: lint 0/0; build 19/19 (tsc); @podkit/core 3183 pass / 5 skip / 0 fail; podkit (CLI) 1606 unit + 67 integration pass.
<!-- SECTION:NOTES:END -->
