---
id: TASK-317.05
title: 'CLI flag UX nits: doctor system-only flag + device remove positional'
status: To Do
assignee: []
created_date: '2026-05-09 15:21'
updated_date: '2026-05-09 20:29'
labels:
  - cli
  - ux
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: low
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two small CLI ergonomics issues surfaced during the m-18 sweep. Combined because both are flag-shape tweaks with no overlap with the bigger refactors and no real-hardware validation needed.

## Bug 1: `doctor` has no clean way to run system-only checks

`podkit doctor` with no arguments resolves to the default device (e.g., `terapod`) and fails with `Device with UUID ... not found` if it isn't connected. The hardware-sweep playbook expected a `--no-device` flag for "run system-scope checks only, ignore device state". That flag does not exist; the related flag `--no-system` is the inverse (skip system, run device-only).

Add a `--no-device` flag (or rename to `--system-only` if the semantic is clearer). When supplied, `doctor` runs only the system-scope checks (FFmpeg, SCSI transport, kext presence, etc.) and exits without attempting to resolve a device.

Alternative: change the default behavior so `doctor` with no args + no default-device-connected runs system-only. Pick whichever is least surprising; document the choice in the help text.

## Bug 2: `device remove <name>` rejects the positional argument

`podkit device remove sallys-ipod` fails with `error: too many arguments for 'remove'. Expected 0 arguments but got 1.` The command takes the device via the program-level `-d` flag (`podkit device remove -d sallys-ipod --confirm`), which is non-obvious. The error message doesn't suggest the `-d` flag.

Two options:
- Accept the positional argument too — most CLI patterns allow `<command> <name>` without requiring a flag.
- Improve the error: when a positional is rejected, hint that the device is specified via `-d` at the program level.

Same pattern likely applies to `device add` (positional `<name>` rejected — works as `-d <name>`).

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. No real-hardware verification needed; CLI-only changes verified via unit/integration tests of the command parsing surface.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 `podkit doctor --no-device` (or chosen flag name) runs system-scope checks only and exits 0 when all pass, regardless of any default-device state. Documented in `--help`.
- [ ] #2 `podkit doctor` with no args + no connected default device gives a useful message (either auto-falls-back to system-only, or prints a specific error suggesting `--no-device`).
- [ ] #3 `podkit device remove <name>` either accepts the positional, or rejects it with an error that explicitly suggests `-d <name>`. Same handling for `device add`.
- [ ] #4 Unit/integration tests added for the new flag handling and the improved error wording.
- [ ] #5 `podkit doctor --help` and `podkit device remove --help` reflect the new behavior.
- [ ] #6 No real-hardware verification required; mark this AC as 'N/A — CLI-only change'.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Linux reproduction of Bug 2 confirmed on linka (2026-05-09) during TASK-313: `podkit device add --path /media/james/disk` errors with `Missing required --device flag. Usage: podkit device add -d <name>` — same wording, same omission of the `-d` hint as the macOS reproduction. So the fix lands cross-platform: same code path. No additional Linux-specific work needed.
<!-- SECTION:NOTES:END -->
