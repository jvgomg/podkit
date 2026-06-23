---
id: TASK-432.02
title: device rename — disk volume label (both layers)
status: Done
assignee: []
created_date: '2026-06-22 22:30'
updated_date: '2026-06-23 00:00'
labels:
  - device
  - cli
  - rename
  - core
  - platform
dependencies:
  - TASK-432.01
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/podkit-core/src/device/label-from-name.ts
  - packages/podkit-core/src/device/label-from-name.test.ts
  - packages/podkit-core/src/device/apply-device-name.ts
  - packages/podkit-core/src/device/apply-device-name.test.ts
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-core/src/device/index.ts
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/macos.test.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-core/src/device/platforms/linux.test.ts
  - packages/podkit-core/src/device/platforms/unsupported.ts
  - packages/podkit-core/src/device/eject.test.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/device/rename.ts
  - packages/podkit-cli/src/commands/device/output-types.ts
  - packages/podkit-cli/src/commands/device-rename.unit.test.ts
  - packages/podkit-cli/src/resolvers/device.test.ts
  - packages/demo/src/mock-core.ts
  - .changeset/device-rename-disk-label.md
parent_task_id: TASK-432
ordinal: 167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 2 of doc-048. Add the disk-label side so `device rename <name>` updates BOTH layers by default.

New pure module `labelFromName(name, fs) -> { label, lossy, warning? }`: FAT32 = uppercase + truncate to 11 chars + strip illegal chars (best-effort, returns a warning describing the resulting label); HFS+ = case-preserved, longer labels allowed. New side-effectful `device.setVolumeLabel(path, label)` in the existing device platform layer, selecting the correct OS tool (macOS `diskutil rename`, Linux FAT `fatlabel`/mtools, HFS+ variant). Completes the `applyDeviceName` orchestrator: write DB name first, write disk label LAST (relabel moves the OS mountpoint, so the device path is re-resolved afterwards). Wire `--no-disk`/`--no-database` into `rename`; both together is a no-op and errors.

Demoable: after `device rename "New Name"`, both the iPod's displayed name and the Finder/Explorer volume label change.

PRD: doc-048. Blocked by: task-432.01.
User stories: 8, 9, 10, 19, 21, 22.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `labelFromName` unit-tested: FAT uppercase/truncate-11/strip-illegal + lossy/warning flag; HFS+ case-preserved
- [x] #2 `device.setVolumeLabel` selects the correct OS tool per filesystem and re-resolves the mountpoint after relabel
- [x] #3 `applyDeviceName` writes DB name first, disk label last
- [x] #4 `device rename <name>` writes both layers by default; FAT lossiness emits a warning of the resulting label
- [x] #5 `--no-disk` / `--no-database` each skip the corresponding layer; both together errors as a no-op
- [x] #6 Integration/mocked-exec test for the relabel path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the disk-label side of `device rename`.

New pure module `label-from-name.ts`:
- `labelFromName(name, fs: 'fat'|'hfs') -> { label, lossy, warning? }`. FAT: strip illegal chars (incl. control chars 0x00-0x1f) + uppercase + truncate to 11 + trimEnd; lossy flag + human warning naming the resulting label. HFS+: strip colon (path separator) + control chars, allow up to 255, preserve case; usually not lossy.
- `classifyVolumeFilesystem(fsString)` maps OS strings (macOS "MS-DOS FAT32"/"Apple_HFS", Linux "vfat"/"hfsplus") onto the family enum. exFAT/APFS/NTFS -> null (refuse rather than mis-truncate). Mapping lives in the platform/detection layer, not the pure label function.

Platform layer (`DeviceManager` interface extended with `detectFilesystem` + `setVolumeLabel`):
- macOS: `detectFilesystem` reads diskutil info "File System Personality"/"Type (Bundle)"; `setVolumeLabel` runs `diskutil rename <path> <label>` (moves the mountpoint).
- Linux: `detectFilesystem` reads `findmnt --target` FSTYPE; `setVolumeLabel` resolves the device node via findmnt then runs `fatlabel` (FAT) or `hfslabel` (HFS+).
- unsupported/windows: detectFilesystem -> null, setVolumeLabel -> throws VolumeLabelError UNSUPPORTED_PLATFORM.
- New typed error `VolumeLabelError` (codes: UNSUPPORTED_FILESYSTEM/UNSUPPORTED_PLATFORM/RELABEL_FAILED/FILESYSTEM_UNRESOLVED). No console.* in core.

Orchestrator `applyDeviceName`:
- Disk branch completed: detect fs -> classify -> labelFromName -> setVolumeLabel -> re-resolve mountpoint. DB branch runs first (structurally, sequential awaits), disk branch last.
- Injectable seams with real defaults (mirrors slice-1 IpodDatabaseNameWriter): `labelWriter` (detectFilesystem+setVolumeLabel) and `resolveMountPath`. Defaults wired from getDeviceManager().
- Result extended with `diskLabel` + `diskWarning`; `mountPath` re-resolved after relabel. Config-refresh (slice .03) seam left intact (resolveMountPath returns the new path; no config write here).

CLI `rename.ts`: surfaces `diskWarning` via `out.warn()` (sink, not console) and carries diskLabel/diskWarning into DeviceRenameOutput JSON. `--no-disk`/`--no-database` flags drive the branches; both-disabled error from slice 1 preserved.

Demo mock-core updated (labelFromName, classifyVolumeFilesystem, VolumeLabelError, manager detectFilesystem/setVolumeLabel, applyDeviceName return shape) so mock-core.check passes.

VERIFIED on macOS: full `bun run typecheck` (36/36 turbo tasks incl. @podkit/demo), `bun run lint` (0 errors, CLI no-stderr check OK), `bun run test:unit --filter @podkit/core --filter podkit` (core 3228 pass / cli 1754 pass / 0 fail). Tests are mocked-exec only (recordingRunner) + injected fakes — NO real-device or hdiutil access.
DEFERRED to Lima VM / CI: real-exec verification of the Linux `fatlabel`/`hfslabel` paths and HFS+ relabel (implemented, not run here per team decision).

Team-lead review pass: no blockers; reviewer confirmed FAT/HFS label rules, platform tool selection (diskutil rename / fatlabel+device-node / hfslabel), spawn-style arg safety, structural DB-first/disk-last ordering, and that the config-refresh seam for .03 is intact. Review fixes applied by team lead: replaced literal NUL+0x1f control bytes in the FAT/HFS illegal-char regexes with \x00-\x1f escapes (were invisible/looked like a bug, broke prettier); fixed the trailing-space truncation test to actually exercise trimEnd ('1234567890 X' -> '1234567890', lossy). Full gate green: typecheck 36/36, lint 0/0, label tests 15/15. macOS path verified via mocked-exec; Linux fatlabel/hfslabel + HFS+ deferred to Lima VM/CI per team decision.
<!-- SECTION:NOTES:END -->
