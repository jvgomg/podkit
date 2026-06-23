---
id: TASK-432.04
title: device reset — full factory wipe
status: Done
assignee: []
created_date: '2026-06-22 22:31'
updated_date: '2026-06-23 08:23'
labels:
  - device
  - cli
  - reset
  - core
dependencies:
  - TASK-432.02
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/podkit-core/src/device/sweep-device-content.ts
  - packages/podkit-core/src/device/sweep-device-content.test.ts
  - packages/podkit-core/src/device/index.ts
  - packages/podkit-core/src/device/apply-device-name.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/device/reset.ts
  - packages/podkit-cli/src/commands/device/output-types.ts
  - packages/podkit-cli/src/commands/device/error-codes.ts
  - packages/podkit-cli/src/commands/device/shared.ts
  - packages/podkit-cli/src/handler-deps.ts
  - packages/podkit-cli/src/test-utils/fake-ipod.ts
  - packages/podkit-cli/src/commands/device-reset.unit.test.ts
  - packages/podkit-cli/src/commands/device-ipod-ops.behavior.test.ts
  - packages/demo/src/mock-core.ts
  - .changeset/factory-reset-device.md
parent_task_id: TASK-432
ordinal: 169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 4 of doc-048. Turn `podkit device reset` into a true one-shot factory reset, reusing the `applyDeviceName` seam from slices 1-2.

New `sweepDeviceContent(mountPath, { music, artwork })` module: brute-force delete `iPod_Control/Music/*` and artwork `.ithmb` files directly on disk (catches orphans the old per-track delete missed). Reset flow, in order: (1) read the current master-playlist name, ERROR if none found (direct user to `init`); (2) `name = --name ?? current`; (3) recreate empty DB via `initializeIpod({ name })`; (4) `sweepDeviceContent`; (5) `applyDeviceName` disk-label side (applied last). `[N/y]` confirmation (`-y` skips), `-n/--dry-run` preview. No `--no-*` flags — reset is all-or-nothing; partial wipes stay on `clear`/`reset-artwork`.

Demoable: one `device reset` leaves an empty DB, no leftover audio files, no artwork, name preserved, disk label consistent.

PRD: doc-048. Blocked by: task-432.02.
User stories: 1, 2, 3, 4, 5, 6, 12, 13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `sweepDeviceContent` removes audio files and `.ithmb` (incl. orphans); `{music, artwork}` toggles work; integration-tested on a temp dir
- [x] #2 `device reset` recreates an empty DB, sweeps content+artwork, and leaves no orphaned audio files
- [x] #3 Reset preserves the current device name by default; `--name` overrides it
- [x] #4 Reset errors with a pointer to `init` when no current name can be read
- [x] #5 Disk label is made consistent with the name and applied last
- [x] #6 `[N/y]` confirmation with `-y` skip and `-n/--dry-run` preview
- [x] #7 No `--no-*` flags on reset
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (uncommitted, main repo dir).

Core — new `sweepDeviceContent(mountPath, { music, artwork })` in packages/podkit-core/src/device/sweep-device-content.ts: brute-force on-disk deletion of audio under iPod_Control/Music/F* and artwork .ithmb + ArtworkDB. Walks disk (not the DB) so orphan files are removed too. Safety guard `assertSweepableMountPath` rejects empty/root/bare-/Volumes paths and any path without an existing iPod_Control dir; throws typed `SweepContentError` (codes INVALID_MOUNT_PATH | NOT_AN_IPOD). Music F-dir skeleton is preserved (only files inside removed). No console.* — returns a summary {musicFilesRemoved, artworkFilesRemoved, bytesFreed, musicSwept, artworkSwept}. Exported from device/index.ts + core index.ts.

apply-device-name.ts — made `db` optional in ApplyDeviceNameInput so the disk-only branch (database:false) works with no db handle; added a misuse guard that throws if database branch is requested without a db. reset reuses this disk branch instead of duplicating relabel/config-refresh logic.

CLI — rewrote packages/podkit-cli/src/commands/device/reset.ts to the doc-048 flow: open existing DB + read master-playlist name → NOT_INITIALIZED error (new code, points to `device init --name`) if no DB / no readable name (AC#4) → effectiveName = --name ?? current → initializeIpod({ name }) → sweepDeviceContent(music+artwork) → applyDeviceName({ database:false, disk:true, refreshConfig: makeDeviceConfigRefresh({warn: out.warn}) }) applied LAST. `--name` option added; `-y` skip; `-n/--dry-run` previews and performs NO open-for-write/recreate/sweep/relabel; no --no-* flags. DeviceResetOutput extended (name, musicFilesRemoved, artworkFilesRemoved, bytesFreed, diskLabel, diskWarning). Added getMasterPlaylist() to IpodAdapterStub + fake-ipod helper; added sweepDeviceContent override to DeviceOpDeps.

Demo — mock-core.ts gained sweepDeviceContent + SweepContentError so mock-core.check.ts (full typecheck) stays green.

Tests (temp fixtures/mocks only, never /Volumes/*): sweep-device-content.test.ts (8 cases incl. orphan removal, toggles, all 4 safety-guard rejections); device-reset.unit.test.ts (5 cases: carry-over name + DB recreate + sweep + disk-only applyDeviceName, --name override, AC#4 NOT_INITIALIZED→init, confirm-cancel no-mutation, dry-run no-mutation); updated device-ipod-ops.behavior.test.ts reset case from old "no-DB dry-run success" to new NOT_INITIALIZED error.

Quality gates: `bun run typecheck` (full, incl @podkit/demo) PASS; `bun run lint` PASS; `bun run test:unit --filter @podkit/core` 3240 pass / 0 fail; `bun run test:unit --filter podkit` 1771 pass / 0 fail; new sweep + reset tests pass. Did NOT run build/e2e/harness per task constraints. Changeset: .changeset/factory-reset-device.md (@podkit/core minor + podkit minor).

Deviations: misuse guard in applyDeviceName throws a plain Error (not VolumeLabelError) since its code union doesn't model programmer-misuse; this is an internal invariant, not a user-facing domain error.

Team-lead review pass: reviewer rated sweep safety tight (resolve() before all guards; rejects empty/'/'/'/Volumes'/relative+no-iPod_Control; Dirent.isDirectory doesn't follow symlinks; unlink on a symlink removes only the link; deletion scoped to Music/F*/ + Artwork/*.ithmb/ArtworkDB) and dry-run clean (short-circuits before all 3 mutations). Review fixes applied by team lead: (B-1) initializeIpod handle now closed in a finally (was leaked if device.modelName access threw mid-reset); (S-3) demo mock SweepContentError.code narrowed to the real union; added tests: (B-2) DB-present-but-empty-name -> NOT_INITIALIZED, (S-1) dry-run asserts read handle opened+closed and no recreate handle, (S-2) relative-path sweep refused as NOT_AN_IPOD. Full gate green: typecheck 36/36, lint 0/0, core 3246 / 0 fail, CLI 13/13, sweep 9 + reset 6 pass. macOS verified via fakes/temp dirs only — no /Volumes real-device access. Reset reuses applyDeviceName disk-only branch (database:false); name baked in at initializeIpod; relabel last; config refresh wired with warn sink.
<!-- SECTION:NOTES:END -->
