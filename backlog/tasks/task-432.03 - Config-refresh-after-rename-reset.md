---
id: TASK-432.03
title: Config refresh after rename/reset
status: Done
assignee: []
created_date: '2026-06-22 22:30'
updated_date: '2026-06-23 00:20'
labels:
  - device
  - config
  - rename
  - reset
dependencies:
  - TASK-432.02
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/podkit-core/src/device/apply-device-name.ts
  - packages/podkit-core/src/device/apply-device-name.test.ts
  - packages/podkit-core/src/device/index.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/config/device-config-refresh.ts
  - packages/podkit-cli/src/config/device-config-refresh.test.ts
  - packages/podkit-cli/src/config/writer.ts
  - packages/podkit-cli/src/commands/device/rename.ts
  - packages/demo/src/mock-core.ts
  - .changeset/device-rename-config-refresh.md
parent_task_id: TASK-432
ordinal: 168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 3 of doc-048. After a rename or reset changes the volume label, refresh the podkit config's cached `volumeName`/`path` for that device so it keeps matching.

The FAT volume UUID is unchanged by a relabel, so the device's identity key survives — only the cached display name/path go stale. If the device is present in config, update those fields. If there is no config loaded (Docker/headless) or the device isn't in config, the operation still succeeds and simply skips the config update. The user's `-d` alias is left untouched. Wired into the `applyDeviceName` orchestrator so both rename and reset benefit.

PRD: doc-048. Blocked by: task-432.02.
User stories: 17, 18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After rename/reset, a device present in config has its cached volumeName/path refreshed
- [x] #2 No-config (Docker/headless) and device-not-in-config cases succeed and skip the update without error
- [x] #3 The user's `-d` alias is unchanged
- [x] #4 Device matching still resolves the device after the relabel (UUID stable)
- [x] #5 Test covers present / absent / no-config paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via an injected `refreshConfig` seam on `applyDeviceName`.

**Core changes (`@podkit/core`):**
- Added `ConfigRefreshInfo` type and `RefreshConfig` type alias to `apply-device-name.ts`
- Added `refreshConfig?` and `volumeUuid?` fields to `ApplyDeviceNameInput`
- `applyDeviceName` calls `refreshConfig` (if provided) after disk relabel + mountpoint re-resolution, passing `{ volumeUuid, oldPath, newPath, newLabel, name }`. Only called when the disk branch ran.
- Both types exported from `packages/podkit-core/src/device/index.ts` and `packages/podkit-core/src/index.ts`

**CLI changes:**
- New `packages/podkit-cli/src/config/device-config-refresh.ts`: `makeDeviceConfigRefresh({ configPath? })` factory returns a `RefreshConfig` implementation. Matches device by `volumeUuid` (case-insensitive), calls existing `updateDevice()` writer to update `volumeName` and `path` only. All skip paths (no UUID, no config file, no matching entry) are silent.
- `packages/podkit-cli/src/config/writer.ts`: Extended `updateDevice()` to accept `volumeName?` and `path?` fields.
- `packages/podkit-cli/src/commands/device/rename.ts`: Injects `makeDeviceConfigRefresh()` and `volumeUuid` into the `applyDeviceName` call. Test overrides via `deps.refreshConfig`.
- `packages/demo/src/mock-core.ts`: Updated `applyDeviceName` mock signature to include `refreshConfig` and `volumeUuid`.

**Seam is reusable:** `makeDeviceConfigRefresh()` is a standalone factory importable by `reset.ts` in slice .04 without any changes to this slice.

**Tests:**
- 4 new tests in `apply-device-name.test.ts` covering: seam called with correct info, seam not called when disk skipped, no-seam default is safe, volumeUuid=undefined forwarded correctly.
- 10 new tests in `device-config-refresh.test.ts` covering: happy path update, alias unchanged, UUID unchanged, case-insensitive matching, round-trip via loadConfigFile, 4 skip conditions (no UUID, no file, no matching UUID, no devices section), multi-device isolation.

Team-lead review pass: no blockers; reviewer confirmed all skip paths (no-uuid / no-config / not-in-config) are silent and correct, UUID match case-insensitive + guarded, alias/key untouched, core stays free of CLI imports (injected RefreshConfig seam, no-op default), and the factory is reusable by reset (.04). Review fixes applied by team lead: (1) updateDevice now escapes TOML string values via escapeTomlString and uses a function-form .replace() so a `$` in a name isn't treated as a regex replacement token (hardens a latent pre-existing bug; HFS+ names/paths with quotes/backslashes now round-trip safely) + added a special-char round-trip test; (2) makeDeviceConfigRefresh gained an optional warn sink — on a failed config write (relabel already succeeded) it emits a non-fatal warning via out.warn instead of silently leaving the cache stale + added a test; (3) clarified the catch comment to note I/O errors are also swallowed. Full gate green: typecheck 36/36, lint 0/0, config/writer/rename tests 65/65. NOTE for .04: when reset wires makeDeviceConfigRefresh, pass { warn: (m) => out.warn(m) } like rename does.
<!-- SECTION:NOTES:END -->
