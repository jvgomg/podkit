---
id: TASK-432.05
title: device init --name
status: Done
assignee: []
created_date: '2026-06-22 22:31'
updated_date: '2026-06-22 23:19'
labels:
  - device
  - cli
  - init
dependencies: []
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/podkit-cli/src/commands/device/init.ts
  - packages/podkit-cli/src/handler-deps.ts
  - packages/podkit-cli/src/commands/device-ipod-ops.behavior.test.ts
  - packages/podkit-cli/src/commands/device.test.ts
  - .changeset/cli-flag-standardisation.md
parent_task_id: TASK-432
ordinal: 170000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 5 of doc-048. Add an optional `--name <name>` flag to `podkit device init` so a brand-new (uninitialised) device can be named during initialisation — symmetric with `device reset --name`.

`initializeIpod({ name })` already supports a name, so this threads the CLI flag through to it. Independent of the rename slices.

PRD: doc-048. Blocked by: none — can start immediately.
User stories: 11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device init --name <name>` initialises the device with that master-playlist name
- [x] #2 Without `--name`, init behaviour is unchanged (default name)
- [x] #3 Test covers init with and without `--name`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `--name <name>` option to `initSubcommand` in `init.ts`. `InitOptions` interface extended with `name?: string`. The option string is `'--name <name>'` with description `'name for the device'` — no short form to avoid conflict with `-n` used for dry-run elsewhere. The option is threaded into `IpodDatabase.initializeIpod(devicePath, { name: options.name })` — when omitted, `options.name` is `undefined` and libgpod defaults apply. Updated `IpodDatabaseStub` in `handler-deps.ts` to accept `opts?: { model?: string; name?: string }` on `initializeIpod`. Tests added to `device-ipod-ops.behavior.test.ts`: one asserting `capturedName === 'My iPod'` when `--name` is provided, one asserting `capturedName === undefined` (not just falsy) when omitted. Structural option test added to `device.test.ts`.
<!-- SECTION:NOTES:END -->
