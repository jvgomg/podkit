---
id: TASK-319
title: m-18 hardware sweep B' — Linux re-validation after TASK-317 fixes land
status: To Do
assignee: []
created_date: '2026-05-09 20:32'
labels:
  - device-capability-architecture
  - hardware-validation
  - manual-sweep
  - linux
  - follow-up
milestone: m-18
dependencies: []
priority: medium
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Successor to TASK-313 (m-18 hardware sweep B — linka). Re-runs the Linux hardware-validation sweep after the TASK-317.11/.12/.13/.14/.15 fixes land, with broader iPod coverage and explicit Echo Mini coverage.

TASK-313 closed with §1 done end-to-end (repo setup + build) and the rest deferred behind structural fixes. This task picks up where it left off and tests:

1. **The fixes** — verify each TASK-317 sub-task's claimed behaviour on real hardware on linka. AC pointers to the originating sub-tasks for traceability.
2. **More iPods** — expand from nano 4G + nano 3G coverage to as much of the macOS sweep inventory as is portable to linka.
3. **Echo Mini** — TASK-313 didn't cover mass-storage on Linux at all. Echo Mini auto-detect, add, doctor, sync --dry-run all need real-hardware Linux verification.

## Setup state inherited from TASK-313

linka is already provisioned for podkit work:

- Tailscale SSH passwordless: `ssh james@linka`.
- bun 1.3.13 installed at `~/.bun/bin/bun`.
- node v24.15.0 via nvm at `~/.nvm/versions/node/v24.15.0/bin/node`.
- System deps installed: `build-essential libgpod-dev ffmpeg libglib2.0-dev libplist-dev libgdk-pixbuf2.0-dev pkg-config`.
- Repo cloned at `~/podkit/`. Re-sync from the developer's local checkout via `rsync` if main has moved.
- james is in `plugdev`; not in `disk` or `root`. SSH session does not get systemd-logind uaccess for /dev/bus/usb.

So the first session step is just an rsync + `bun install && bun run build --filter podkit`.

## Hardware to bring to linka

In rough priority order (so the session degrades gracefully if not all are portable):

- **iPod nano 3G** (8GB Black, FAT32, USB inquiry works) — primary test device, was last session's working setup.
- **iPod nano 2G** (4GB Green, FAT32, SCSI-only) — exercises the SCSI fallback path that nano 3G doesn't.
- **iPod mini 2G** (4GB Pink, FAT32, SCSI-only, pre-2006 SysInfo) — different identity-cascade path (ModelNumStr canonical).
- **iPod nano 4G** (8GB Black, HFS+) — primary HFS+ refusal verification target.
- **iPod nano 7G #1 or #2** (FAT32 / HFS+, hashAB unsupported) — exercises unsupported-generation cascade (TASK-317.03) on Linux.
- **iPod 5G TERAPOD** (FAT32, SCSI-only, manual-mount) — heaviest sysinfo-extended payload (9693 bytes), longer SCSI window. Bring if portable; skip if not.
- **Echo Mini** — mass-storage auto-detect path on Linux, never tested. Bring this for sure.
- **iPhone/iPad** — unsupported-iOS messaging on Linux (probably surfaces differently than macOS because Linux can't see iOS devices as block devices at all). Optional.

## Per-fix verification ACs

Each AC links back to the originating TASK-317 sub-task. Pre-flight: confirm the sub-task is marked Done or its PR has merged before running its verification step.

### TASK-317.11 (discovery reconciliation)

- `podkit device scan` on linka with nano 3G mounted produces **exactly one entry** for the iPod. Multiple `device scan` runs in succession remain consistent.
- Plug nano 3G + nano 2G simultaneously: scan shows two entries, one per device, no double-counts.
- Replug cycle (unplug + replug nano 3G ten times across a session) does not produce phantom or double entries.

### TASK-317.12 (HFS+ refusal)

- `podkit device add` on linka against nano 4G (HFS+) refuses with the documented message and exit code non-zero.
- `podkit device scan` on linka against nano 4G renders the device with the `Filesystem not supported on Linux` warning, no destructive remediation.
- `podkit device add` on linka against nano 3G (FAT32) succeeds (regression).
- macOS regression: nano 4G adds and syncs cleanly (this task triggers a manual macOS spot-check; full re-sweep not required).

### TASK-317.13 (udev rule USB scope)

- Pre-state: rule uninstalled, `dd if=/dev/bus/usb/<bus>/<dev>` and `dd if=/dev/sg<N>` both EACCES.
- `podkit doctor --repair udev-rule` installs successfully (sudo prompt, rule file written, reload + trigger).
- Post-replug: both `/dev/bus/usb/<bus>/<dev>` and `/dev/sg<N>` accessible to plugdev (or via uaccess) for the operator user without sudo.
- `podkit doctor --repair sysinfo-extended -d <nano-3g>` succeeds via USB inquiry path, no sudo, in an SSH session.
- Re-test on a SCSI-only iPod (nano 2G or mini 2G) to confirm SCSI fallback still works post-rule-install.

### TASK-317.14 (orchestrator error reporting)

- Pre-state: rule uninstalled, both transports EACCES. `podkit doctor --repair sysinfo-extended -d <nano-3g>` produces the documented multi-line output naming USB and SCSI with their EACCES paths and the remediation hint.
- `-vv` and `-vvv` add detail; default output already informative.
- Verify on a permission-granted path that a non-error output also describes which transport actually succeeded.

### TASK-317.15 (defensive error handling for missing volumeUuid)

- linka + nano 3G (FAT32): real UUID `968A-2063` stored, output prints it. Unchanged from today.
- linka + nano 4G (HFS+): refused via TASK-317.12 first; if hit before .12 lands, this task's catch-all refuses cleanly.
- Confirmed: synthetic `manual-...` volumeUuids not generated for any device.

### Echo Mini coverage (new — never run on Linux)

- `podkit device scan` with Echo Mini plugged in: identifies the device correctly (vendor 0x071b product 0x3203), surfaces clearly, mount-state path works.
- `podkit device add -d echo --type echo-mini --path <mount>` succeeds.
- `podkit doctor -d echo` runs the mass-storage check pipeline; no iPod-specific firmware checks fire on a non-iPod device.
- `podkit sync -d echo --dry-run` produces a coherent plan respecting the preset (no video, AAC transcoding, album-artist browsing).
- Eject works.

## Capture format

Updates to:
- `documents/test-devices.md` — linka rows for each iPod tested + new Echo Mini Linux row.
- `documents/sysinfo-captures/` — any new fixtures captured during the sweep.
- This task's notes — UX wins/issues observed during the re-test.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Each AC pointers back to the relevant TASK-317 sub-task; the parent close-out verifies the inventory rows and Echo Mini coverage.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Pre-flight on linka: rsync + `bun install && bun run build --filter podkit` clean. Smoke `node packages/podkit-cli/dist/main.js --version` prints non-empty version.
- [ ] #2 TASK-317.11 verified on linka: nano 3G alone, nano 3G + nano 2G simultaneously, replug cycles — single entry per device, no double-counts, no phantoms.
- [ ] #3 TASK-317.12 verified on linka: nano 4G HFS+ refused at add and warned at scan with the documented messaging. nano 3G FAT32 regression intact.
- [ ] #4 TASK-317.13 verified on linka: rule install + replug grants both USB and SCSI access without sudo from an SSH session. Repair succeeds via USB on nano 3G; SCSI fallback succeeds on nano 2G or mini 2G.
- [ ] #5 TASK-317.14 verified on linka: pre-rule-install error naming both transports + remediation hint reproduced; post-rule-install success path describes which transport succeeded.
- [ ] #6 TASK-317.15 verified on linka: no synthetic volumeUuids generated; FAT32 identity stored cleanly; defensive refusal for any non-HFS+ missing-UUID case.
- [ ] #7 Echo Mini end-to-end on Linux: scan + add + doctor + sync --dry-run + eject. Mass-storage preset capabilities respected.
- [ ] #8 Per-iPod routine A–H from TASK-313 §3 completed for at least nano 3G + nano 2G + nano 4G (refused) + Echo Mini. iPod 5G TERAPOD + nano 7G + iPhone covered if portable to linka.
- [ ] #9 Timing comparison vs macOS: USB inquiry + SCSI inquiry + repair sysinfo-extended wall-clock recorded for at least nano 3G and nano 2G; compared against TASK-312 baselines.
- [ ] #10 `documents/test-devices.md` updated with all linka observations from this re-sweep.
- [ ] #11 Final summary written naming any new findings + linking to fixes that landed since TASK-313.
<!-- AC:END -->
