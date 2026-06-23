---
id: TASK-432.01
title: device rename — database (master-playlist) name
status: Done
assignee: []
created_date: '2026-06-22 22:30'
updated_date: '2026-06-22 23:19'
labels:
  - device
  - cli
  - rename
  - libgpod
  - core
dependencies: []
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/libgpod-node/src/database.ts
  - packages/libgpod-node/src/__tests__/device-name.integration.test.ts
  - packages/podkit-core/src/ipod/database.ts
  - packages/podkit-core/src/device/apply-device-name.ts
  - packages/podkit-core/src/device/apply-device-name.test.ts
  - packages/podkit-core/src/device/index.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/device/rename.ts
  - packages/podkit-cli/src/commands/device/index.ts
  - packages/podkit-cli/src/commands/device/output-types.ts
  - packages/podkit-cli/src/commands/device/error-codes.ts
  - packages/podkit-cli/src/handler-deps.ts
  - packages/podkit-cli/src/test-utils/fake-ipod.ts
  - packages/podkit-cli/src/commands/device-rename.unit.test.ts
  - .changeset/device-rename-command.md
parent_task_id: TASK-432
ordinal: 166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 1 of doc-048. Deliver `podkit device rename [device] <name> --no-disk` end-to-end: rename the iPod's case-correct name (the iTunesDB master-playlist name).

Adds a sanctioned libgpod-node `Database.setDeviceName(name)` that writes the master-playlist name via the native binding, bypassing the existing `IpodPlaylist.rename()` "cannot rename master playlist" guard (the generic playlist guard stays in place — only this explicit method may rename master). Introduces the `applyDeviceName` core orchestrator seam (DB side only at this stage; the disk side arrives in the next slice). New CLI `rename` command with `[N/y]` confirmation (`-y` to skip).

Demoable: after `device rename "New Name" --no-disk`, `device info` and the iPod UI show the new name.

PRD: doc-048. Blocked by: none — can start immediately.
User stories: 7, 8 (partial), 9 (partial), 14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `Database.setDeviceName(name)` writes the master-playlist name and the change survives save/reopen
- [x] #2 Generic `IpodPlaylist.rename()` still throws on the master playlist (guard retained)
- [x] #3 `applyDeviceName` orchestrator exists with a DB-side path
- [x] #4 `podkit device rename <name> --no-disk` renames the device's DB name end-to-end
- [x] #5 `rename` prompts `[N/y]` and `-y/--yes` skips it
- [x] #6 Integration test: master-playlist name written + re-read on a real temp iPod
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the four bottom-up layers of doc-048 slice 1.

1. libgpod-node (`packages/libgpod-node/src/database.ts`): added `Database.setDeviceName(name): Playlist`. Fetches the master playlist via the existing `getMasterPlaylist()` and writes its name through the native `setPlaylistName(master.id, name)` binding. No guard here — this is the legitimate low-level writer. Integration test confirms the name persists across save() + reopen and preserves case.

2. podkit-core (`packages/podkit-core/src/ipod/database.ts`): added `IpodDatabase.setDeviceName(name): void` delegating to libgpod's `Database.setDeviceName`, mapping failures to IpodError(DATABASE_CORRUPT). The generic `IpodPlaylist.rename()` master guard in `playlist.ts:127-133` is untouched and still throws (verified by the existing playlist.test.ts case + full suite).

3. Core orchestrator (`packages/podkit-core/src/device/apply-device-name.ts`): new `applyDeviceName({ db, mountPath, name, disk=true, database=true })` returning `{ name, databaseUpdated, diskUpdated, mountPath }`. Only the DB branch is implemented (setDeviceName + save). The disk branch and config re-resolution are documented no-op stubs with the load-bearing ordering comment (DB name first, disk label LAST because relabeling moves the OS mountpoint, then re-resolve path/refresh config). Interface designed so slices .02/.03 extend the result + the disk/database switch without reshaping the signature. Narrow `IpodDatabaseNameWriter` seam lets tests inject a fake. Exported from `device/index.ts` and the core public `index.ts`.

4. CLI (`packages/podkit-cli/src/commands/device/rename.ts`): mirrors clear.ts/reset.ts flow (resolveDeviceArg -> iPod-only gate -> resolveDevicePath{requireMounted:true} -> open db -> confirmNo unless -y -> applyDeviceName -> out.result). Command is `rename <name>` with `--no-disk`, `--no-database`, `-y/--yes`. Both-flags-disabled is rejected up front (NOTHING_TO_RENAME); empty name rejected (NAME_REQUIRED); rename failure -> RENAME_FAILED. Registered in device/index.ts; added DeviceRenameOutput to output-types.ts and RENAME_FAILED/NOTHING_TO_RENAME/NAME_REQUIRED to error-codes.ts. Added optional `setDeviceName` to IpodAdapterStub (handler-deps.ts) and the makeFakeIpodAdapter default (test-utils/fake-ipod.ts).

DEVIATION: brief specified `rename [device] <name>` (positional device). Commander assigns a single positional to the optional `[device]` first, so the primary case `rename "New Name"` fails with missingArgument (verified empirically). To keep the demoable path working and match every sibling command (add/remove select the device via global `-d`), the command is `rename <name>` with the device chosen by the global `-d` flag (handled by the existing resolveDeviceArg, same as clear/reset). Functionally equivalent.

Completions are generated from the Commander tree, so registering the subcommand is sufficient — no static list to edit.

Tests: libgpod integration (device-name.integration.test.ts, 3 pass), core unit (apply-device-name.test.ts, 5 pass: db path, set-before-save order, database:false skip, default-on, disk no-op), CLI unit (device-rename.unit.test.ts, 3 pass: both-flags-error, empty-name-error, --no-disk happy path asserting setDeviceName+save+close).

Changeset: .changeset/device-rename-command.md (minor for @podkit/libgpod-node, @podkit/core, podkit).

Team-lead review pass: reviewer found no blockers and confirmed the applyDeviceName seam is extensible for .02/.03 without reshaping. Review fixes applied: setDeviceName failure now SAVE_FAILED (was DATABASE_CORRUPT); libgpod setDeviceName delegates to renamePlaylist (no double-open) and returns void; added IpodDatabase.setDeviceName unit tests (closed-db + error-wrap), rename --no-database + confirmation-cancel unit tests, rename structural tests in device.test.ts. Fixed cross-package demo mock-core (added applyDeviceName mock). Full gate green: typecheck 36/36, unit tests 0 fail, lint 0/0.

Note for slice .02: reviewer recommends making mountpoint re-resolution injectable (resolveMountPath(oldPath,newLabel)) rather than calling fs directly, to keep applyDeviceName testable when the disk branch lands.
<!-- SECTION:NOTES:END -->
