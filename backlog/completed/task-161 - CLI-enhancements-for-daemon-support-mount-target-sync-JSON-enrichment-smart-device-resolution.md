---
id: TASK-161
title: >-
  CLI enhancements for daemon support (mount --target, sync JSON enrichment,
  smart device resolution)
status: Done
assignee: []
created_date: '2026-03-18 23:55'
updated_date: '2026-03-19 13:42'
labels:
  - cli
  - daemon
dependencies: []
references:
  - packages/podkit-cli/src/commands/mount.ts
  - packages/podkit-cli/src/commands/eject.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-cli/src/resolvers/device.ts
documentation:
  - backlog/documents/doc-004.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CLI enhancements that the daemon (doc-004) needs to function, but are also independently valuable for all users.

### 1. Mount command: add `--target` flag
Allow specifying the mount point path (e.g., `podkit mount --disk /dev/sdb2 --target /ipod`). Currently the mount point is auto-generated as `/tmp/podkit-<volumeName>`. The daemon needs to mount to a fixed `/ipod` path inside the container.

### 2. Sync dry-run JSON: album/artist/video aggregation
Add aggregate counts to the dry-run JSON plan output: album count, artist count, and for video syncs: movie count, TV show count, episode count. The daemon uses these to build rich notification summaries like "Adding 47 tracks (12 albums by 5 artists)" without parsing track name strings. The current JSON only has `tracksToAdd`, `tracksToRemove`, etc.

### 3. Smart device resolution (UUID auto-matching)
Make the CLI device-aware so it can automatically match a connected/mounted iPod to a configured device by UUID:

**Scenario A: `podkit sync` (no --device flag)**
1. CLI asks DeviceManager for connected iPods
2. Matches by UUID against configured devices
3. One match → use it (device-specific settings applied)
4. Multiple matches → error asking user to specify
5. One iPod connected, no config match → use global settings with hint to configure
6. No iPod → error (same as today)

**Scenario B: `podkit sync --device /path` (path)**
1. CLI reads UUID of filesystem at that path
2. Matches against configured devices by UUID
3. Match found → apply that device's settings
4. No match → use global settings

**Scenario C: `podkit sync --device nano` (name)**
Unchanged — works as today.

**Safety check: `--device <name>` with path resolution**
If the user specifies a named device and the CLI resolves it to a path (e.g. via mount), but the iPod at that path has a different UUID than configured for that device name → error. Prevents accidentally syncing wrong config to wrong iPod.

This enhancement is critical for the daemon: the daemon just calls `podkit sync --device /ipod --json` and the CLI handles UUID matching transparently.

### 4. Eject JSON verification
Verify that `podkit eject --json` already returns structured JSON (audit suggests it does via EjectOutput). If so, no work needed here.

See PRD doc-004 (Docker Daemon Mode) for the full context.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mount command accepts --target <path> flag that specifies the mount point directory
- [x] #2 Mount command creates the target directory if it doesn't exist
- [x] #3 Mount command returns the target path in JSON output (mountPoint field)
- [x] #4 Sync dry-run JSON plan includes albumCount and artistCount fields (derived from tracks in plan)
- [x] #5 Sync dry-run JSON plan includes videoSummary with movieCount, showCount, episodeCount when video operations are present
- [x] #6 When --device is a path, CLI reads the mounted filesystem UUID and matches against configured devices to apply device-specific settings
- [x] #7 When --device is omitted, CLI auto-detects connected iPods and matches to configured devices by UUID
- [x] #8 When multiple configured devices are connected and --device is omitted, CLI errors asking user to specify
- [x] #9 When --device is a named device but the iPod at the resolved path has a different UUID, CLI errors with a clear mismatch message
- [x] #10 Existing mount/eject/sync behavior is unchanged when new flags are not used and no configured devices have UUIDs
- [x] #11 Core DeviceManager gains a method to read filesystem UUID from a mount path
- [x] #12 Tests cover mount --target, sync JSON enrichment, and UUID auto-matching scenarios
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Sub-task ordering
1. Mount --target (independent, small)
2. Sync JSON enrichment (independent, moderate)
3. Smart device resolution (complex, core + CLI)
4. Eject JSON verification (likely no-op)

### Smart device resolution — architecture notes

**Current flow:**
```
parseCliDeviceArg() → resolveEffectiveDevice() → getDeviceIdentity() → resolveDevicePath()
```

**Key existing building blocks:**
- `DeviceManager.findIpodDevices()` — returns connected iPods with UUIDs (both platforms)
- `DeviceManager.findByVolumeUuid()` — finds device by UUID
- `resolveDevicePath()` already validates UUID mismatch when both cliPath and volumeUuid are provided
- `PlatformDeviceInfo.volumeUuid` — available on both macOS and Linux

**Changes needed:**

1. **Core: `getUuidForMountPoint(path)`** — New DeviceManager method. Linux: `findmnt --output UUID --noheadings --target <path>` or lsblk. macOS: `diskutil info <mountpoint>` → parse Volume UUID.

2. **CLI resolver: Scenario A (no --device flag)**
   - New function `autoDetectDevice(manager, config)` 
   - Calls `manager.findIpodDevices()` to get connected iPods
   - Builds UUID→deviceName map from `config.devices`
   - Matches detected UUIDs against map
   - Returns matched ResolvedDevice or error
   - Hook into `resolveEffectiveDevice()` as fallback when no --device and no default

3. **CLI resolver: Scenario B (--device is path)**
   - In `resolveDevicePath()`, after getting cliPath, call `manager.getUuidForMountPoint(cliPath)`
   - Build UUID→deviceName map from config
   - If match found, return with device-specific config applied
   - If no match, continue with global settings (current behavior)

4. **CLI resolver: Scenario C (safety — already partially exists)**
   - Existing mismatch check in `resolveDevicePath()` when both cliPath and volumeUuid are provided
   - Verify this is robust and covers all paths

**Key design decision:** The UUID→config matching should return a new `source` value (e.g., `'auto-matched'`) in `DevicePathResult` so commands can log "Matched iPod at /ipod to configured device 'nano'" for transparency.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

### 1. Mount --target (done)
- `packages/podkit-cli/src/commands/mount.ts` — new --target option
- `packages/podkit-cli/src/commands/device.ts` — same for device mount subcommand
- `packages/podkit-core/src/device/platforms/linux.ts` — skips udisksctl when explicit target
- `packages/podkit-core/src/device/platforms/macos.ts` — uses `diskutil mount -mountPoint`
- Review fix: already-mounted device returns error when target differs

### 2. Sync JSON enrichment (done)
- `albumCount` and `artistCount` on `SyncOutput.plan` (uses `albumArtist || artist`)
- `videoSummary` with `movieCount`, `showCount`, `episodeCount`
- Both omitted (undefined) when no tracks/videos to add (consistent convention)
- Test file: `sync-aggregation.test.ts` (11 tests)

### 3. Smart device resolution (done)
- **Scenario A:** `autoDetectDevice()` in resolver — auto-detects connected iPods and matches to config by UUID
- **Scenario B:** `matchPathToConfigDevice()` — reads UUID at path and matches to config
- **Scenario C:** Existing UUID mismatch check verified robust
- `getUuidForMountPoint()` added to DeviceManager (Linux + macOS)
- `deriveSettings()` refactor in sync.ts — re-derives effective settings on auto-match
- `DevicePathResult.matchedDevice` and `hint` fields for caller communication
- Test file: `device.test.ts` (11 new tests)

### 4. Eject JSON verification (no-op)
- Already has full `EjectOutput` JSON support via `out.result<EjectOutput>()`

### Review findings addressed
- Video JSON output emitted in caller loop (TASK-160 review bug)
- videoSummary omitted when no videos to add (consistency)
- Lint fixes: unused import, const vs let, underscore prefix
<!-- SECTION:NOTES:END -->
