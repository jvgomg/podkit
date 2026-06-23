---
id: TASK-432.06
title: CLI confirmation/dry-run flag standardization
status: Done
assignee: []
created_date: '2026-06-22 22:31'
updated_date: '2026-06-22 23:19'
labels:
  - cli
  - device
  - ux
dependencies: []
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - packages/podkit-cli/src/commands/device/clear.ts
  - packages/podkit-cli/src/commands/device/remove.ts
  - packages/podkit-cli/src/commands/device/reset.ts
  - packages/podkit-cli/src/commands/device/reset-artwork.ts
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/device/mount.ts
  - packages/podkit-cli/src/commands/mount.ts
  - packages/podkit-cli/src/commands/device-ipod-ops.behavior.test.ts
  - packages/podkit-cli/src/commands/device.test.ts
  - .changeset/cli-flag-standardisation.md
parent_task_id: TASK-432
ordinal: 171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vertical slice 6 of doc-048. Make destructive-command flags consistent across the CLI.

Skip-confirmation becomes `-y, --yes` everywhere: convert `device clear` and `device remove` off `--confirm` (the two outliers found in the audit). `--force` keeps its single meaning — override a safety/readiness block (unchanged on `add`, `init`, `eject`). Add the `-n, --dry-run` short form to the destructive commands currently missing it: `clear`, `reset`, `reset-artwork`, `doctor`, `mount`.

These are breaking CLI changes shipped as a minor bump, no deprecation cycle (per project convention). Independent of the other slices.

PRD: doc-048. Blocked by: none — can start immediately.
User stories: 15, 16.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device clear` and `device remove` use `-y, --yes` (no longer `--confirm`)
- [x] #2 `-y, --yes` skips the prompt consistently across all destructive commands
- [x] #3 `--force` remains override-safety only (add/init/eject unchanged)
- [x] #4 `-n, --dry-run` short form present on clear/reset/reset-artwork/doctor/mount
- [x] #5 A changeset records the breaking flag change (minor bump)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**(a) `--confirm` → `-y, --yes`:** `device/clear.ts` — `ClearOptions.confirm` renamed to `yes`, option declaration changed from `'--confirm'` to `'-y, --yes'`, gating logic `if (!options.confirm` updated to `if (!options.yes`. `device/remove.ts` — same changes; inline action types updated accordingly. `device-ipod-ops.behavior.test.ts` — two `runDeviceClear` call sites that passed `confirm: true` updated to `yes: true`. `device.test.ts` — two structural tests that checked for `--confirm` option updated to check for `--yes`. **(b) `-n, --dry-run` short form:** Added to `device/clear.ts`, `device/reset.ts`, `device/reset-artwork.ts`, `doctor.ts`, `device/mount.ts`, `mount.ts`. **(c) Changeset:** `.changeset/cli-flag-standardisation.md` — minor bump, covers `init --name`, breaking `--confirm` removal, and `-n` additions. Completions are dynamically generated from Commander.js so no static files required.

Review fix: live docs that still showed --confirm were updated to -y/--yes (docs/reference/cli-commands.md, docs/user-guide/devices/clearing.md). Full gate green.
<!-- SECTION:NOTES:END -->
