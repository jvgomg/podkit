---
id: TASK-317.14
title: >-
  Inquiry-orchestrator default error message names all attempted transports +
  their failure reasons
status: To Do
assignee: []
created_date: '2026-05-09 20:31'
labels:
  - diagnostics
  - ux
  - linux
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When the firmware-inquiry orchestrator fails on Linux, the user-facing default error is one generic line: `Could not read device identity from USB`. It names only USB and tells the user nothing about (a) whether SCSI fallback was attempted, (b) why each transport failed, (c) what the user can do about it.

This is a default-UX requirement, not a verbose-only thing. A regular user without `-vvv` and without source-code access has no path forward when this fires.

## Concrete repro from session 2026-05-09 (linka SSH, no podkit udev rule, no sudo)

```
james@linka:~$ podkit doctor --repair sysinfo-extended -d nano3g
Repairing sysinfo-extended: Read device identity from iPod firmware via USB...

Could not read device identity from USB
```

```
james@linka:~$ podkit doctor -vvv --repair sysinfo-extended -d nano3g
Looking for iPod 'nano3g' (UUID: 968A-2063)...
Repairing sysinfo-extended: Read device identity from iPod firmware via USB...

Could not read device identity from USB
```

`-vvv` adds nothing. The orchestrator's per-transport detail (`usb-then-scsi plan, USB → STALL, SCSI fallback succeeds`-style breakdown observed in macOS sweep notes) is invisible to the CLI surface.

In this exact case both transports were blocked: USB by `/dev/bus/usb/001/016` mode `0664 root:root` and the operator not in root group; SCSI by `/dev/sg3` `crw-rw---- root:disk` and operator not in disk group. Both EACCES. Neither surfaced.

## Required default output

When the orchestrator fails, the default (non-verbose) error must:

1. **Name every transport attempted** in the order they were tried (`usb`, then `scsi` if USB failed and SCSI fallback was scheduled).
2. **For each transport, name the failure reason in one line.** EACCES paths surface "Permission denied accessing /dev/sg3" or "Permission denied accessing /dev/bus/usb/001/016" with the actual path. Other errno classes get their own messages.
3. **Surface a remediation hint** at the bottom — for EACCES on `/dev/sg*`, point at `podkit doctor --repair udev-rule`; for EACCES on `/dev/bus/usb/...`, point at the same repair (after TASK-317.13 lands).
4. **Surface "(re-run with -vv for more detail)"** as a footer when verbose is not set.

Example target output for the linka repro above (after this lands):

```
Could not read device identity from USB or SCSI:

  USB:  Permission denied accessing /dev/bus/usb/001/016
  SCSI: Permission denied accessing /dev/sg3

To grant access without sudo, run: podkit doctor --repair udev-rule
(then unplug and replug your iPod)

(re-run with -vv for more detail)
```

## Verbose adds, doesn't replace

`-v` should not be required for the per-transport breakdown above. `-vv` and `-vvv` add increasing detail (libusb specifics, ioctl numbers, raw bytes attempted, etc.). The default output already tells a regular user what failed and what to do.

## Open question to resolve during implementation

Did the orchestrator actually attempt SCSI on this linka run, or did it short-circuit on USB failure without trying SCSI? Today's collapsed message gave no way to know. Read the orchestrator (`packages/ipod-firmware/src/inquiry/orchestrator.ts`) and confirm:

- If yes — the bug is purely surfacing.
- If no — the orchestrator's plan-selection logic also has a bug: USB EACCES should fall through to SCSI (which, for an iPod that supports both, is meaningful coverage). Different transport paths fail for different reasons; we shouldn't deny ourselves the SCSI signal because USB hit a permission wall.

## Cross-references

- **TASK-317.13** (udev rule USB scope) — fixes the underlying permission so the EACCES doesn't fire as often. This task fixes the messaging when it does.
- **TASK-317.02** (doctor repair correctness — false success). Same code area; coordinate with whoever is in there.
- **TASK-313 §2 AC #2** ("EACCES message displayed correctly verbatim") — was blocked today by this surfacing gap. Will re-test as part of Linux re-sweep follow-up.

## Hardware test plan

- **Permission-blocked path** — linka SSH, no podkit udev rule, no sudo. Both USB and SCSI EACCES. Expected: both transports named with their EACCES paths, remediation pointer included.
- **Permission-granted path** — linka SSH, podkit udev rule installed (post-TASK-317.13), no sudo. Expected: success path unchanged.
- **Per-transport plan branching** — exercise an iPod where USB succeeds (nano 3G/4G), one where USB stalls and SCSI succeeds (nano 2G with rule installed), one where USB succeeds + SCSI is unnecessary (nano 3G again). Default output should describe what actually happened on the success path too — terse but informative.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default orchestrator failure output names every transport attempted, with each transport's failure reason on its own line. Verified on linka SSH (no rule, no sudo) where both USB and SCSI EACCES.
- [ ] #2 Failure output includes a remediation hint (e.g. point at `podkit doctor --repair udev-rule` for EACCES) and a `(re-run with -vv for more detail)` footer when verbose is not set.
- [ ] #3 `-vv` adds detail (libusb specifics, ioctl numbers); `-vvv` adds raw payload data. Verbose is additive, not load-bearing on basic UX.
- [ ] #4 Orchestrator plan-selection logic confirmed: USB EACCES falls through to SCSI when SCSI is part of the plan. If currently short-circuiting, fixed; if currently falling through, documented in implementation notes.
- [ ] #5 Real-hardware: linka SSH, four cases verified — (a) both transports EACCES (no rule), (b) success post-rule-install, (c) USB-success path on nano 3G, (d) SCSI-fallback path with rule installed on nano 2G or mini 2G.
- [ ] #6 Tests added: unit tests for the message formatter covering each transport-result combination (success/EACCES/STALL/empty); snapshot tests for default + `-vv` + `-vvv` outputs.
<!-- AC:END -->
