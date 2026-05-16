---
id: TASK-317.13
title: 'udev rule covers USB subsystem too, not just SCSI'
status: Done
assignee: []
created_date: '2026-05-09 20:30'
updated_date: '2026-05-16 11:18'
labels:
  - linux
  - udev
  - permissions
  - ux
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The podkit udev rule (`/etc/udev/rules.d/91-podkit-ipod-scsi.rules`) only matches `SUBSYSTEM=="scsi_generic"`. It grants `/dev/sg*` access to plugdev members and tags with `uaccess`. **It does not touch `/dev/bus/usb/...` permissions.**

This means:

- USB inquiry (libusb-based) hits `/dev/bus/usb/<bus>/<dev>` directly, which on a fresh Linux install is mode `0664 root:root`. systemd-logind's `uaccess` grants this only to **active console seats** — not SSH sessions, not headless boxes, not Docker containers, not CI runners.
- Even after the user installs the podkit udev rule via `podkit doctor --repair udev-rule` and replugs, USB inquiry still fails with EACCES.
- Today this gets swallowed into a generic "Could not read device identity from USB" with no specifics (separately tracked by TASK-317.14).

## Repro on linka 2026-05-09

```
james@linka:~$ ls -la /dev/bus/usb/001/016
crw-rw-r-- 1 root root 189, 15 May  9 20:53 /dev/bus/usb/001/016

james@linka:~$ groups | grep -E "disk|cdrom|plugdev"
james cdrom floppy sudo audio dip video plugdev users netdev docker

james@linka:~$ podkit doctor --repair sysinfo-extended -d nano3g
Repairing sysinfo-extended: Read device identity from iPod firmware via USB...

Could not read device identity from USB
```

james is in `plugdev`. The podkit SCSI rule was uninstalled (irrelevant to USB anyway). `/dev/bus/usb/001/016` is `0664 root:root` — james gets `r` only; libusb `O_RDWR` open fails.

Re-running the same command under sudo succeeds end-to-end (USB inquiry works; SysInfoExtended written). So the orchestrator code is healthy; pure permissions issue.

## Fix shape

Extend the rule template at `packages/podkit-cli/share/91-podkit-ipod-scsi.rules` (and the in-source `UDEV_RULE_CONTENT` in `packages/podkit-core/src/diagnostics/checks/udev-rule.ts`) to add a second match clause covering `SUBSYSTEM=="usb"`, scoped to Apple vendor (`ATTR{idVendor}=="05ac"` for USB devices, vs `ATTRS{idVendor}` for SCSI generic), with the same `MODE="0660"`, `GROUP="plugdev"`, `TAG+="uaccess"`.

Filename note: with USB scope added, the rule isn't "SCSI" any more. Rename to `91-podkit-ipod.rules` (single rule for both subsystems) or split into two rules (`91-podkit-ipod-scsi.rules` + `91-podkit-ipod-usb.rules`). Pick whichever is easier to install/uninstall and document. Either way, the in-source canonical content needs updating, and the install/uninstall paths in the doctor `--repair udev-rule` action need to handle the rename.

## Validation conditions

After install + replug:
- `/dev/bus/usb/<bus>/<dev>` for any Apple-vendor USB device (PID range 0x05ac:0x12xx) is mode `0660 root:plugdev` with `uaccess` tag.
- `dd if=/dev/bus/usb/<bus>/<dev> of=/dev/null bs=1 count=1` succeeds for the operator user without sudo (read access).
- `podkit doctor --repair sysinfo-extended -d <name>` succeeds via USB inquiry path (no sudo) on linka SSH session.
- Existing SCSI access continues to work (`/dev/sg*` for the matching device still permission-granted).

## Cross-references

- **TASK-317.14** — orchestrator error reporting must name USB EACCES properly so future users hitting this surface understand why; this task fixes the permission side, .14 fixes the messaging side. Both are needed.
- **TASK-313 §2** — original udev UX walkthrough was blocked by exactly this gap (could not reach the EACCES-recovery flow because the USB path also fails). Re-runs after this fix lands as part of the Linux re-sweep.

## Hardware test plan

- linka + nano 3G FAT32 (USB inquiry-capable): primary device. SSH session, no graphical login, plugdev member.
- linka + nano 4G HFS+: regression check that USB inquiry works there too (independent of the HFS+ refusal in TASK-317.12 — `device scan` USB-inquiry side still runs).
- macOS regression: udev rules are Linux-only; verify nothing about the install or repair flow regressed cross-platform.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 udev rule template grants `MODE=0660 GROUP=plugdev TAG+=uaccess` for both `SUBSYSTEM==scsi_generic` AND `SUBSYSTEM==usb` matches scoped to Apple vendor (05ac). Rule file is updated in `packages/podkit-cli/share/` and the in-source canonical content in `udev-rule.ts` matches.
- [ ] #2 After `podkit doctor --repair udev-rule` install + replug on linka, `/dev/bus/usb/<bus>/<dev>` for the connected iPod is `0660 root:plugdev` with uaccess tag. Verified via `ls -la`.
- [ ] #3 After install + replug, `podkit doctor --repair sysinfo-extended -d <name>` succeeds via USB inquiry path (no sudo) in an SSH session on linka.
- [ ] #4 Rename or split the rule file as appropriate; the install + uninstall paths in `--repair udev-rule` handle the rename cleanly (no leftover stale rules from previous installs).
- [ ] #5 Real-hardware: linka + nano 3G (FAT32) primary; linka + nano 4G (HFS+) regression for USB-inquiry side; macOS regression confirms install/repair flow unchanged cross-platform.
- [ ] #6 Tests added: unit tests for the rule content, integration test for the install path, snapshot test for the rule file content.
<!-- AC:END -->
