---
id: TASK-317.12
title: Refuse HFS+ iPods on Linux at `device add`; warn at `device scan`
status: To Do
assignee: []
created_date: '2026-05-09 20:30'
labels:
  - device-capability-architecture
  - linux
  - ux
  - policy
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Decision

iPods formatted as HFS+ are **not supported on Linux** by podkit. Refuse them cleanly at `device add` time and warn the user at `device scan`, with a docs link explaining why and how to reformat to FAT32 if they want podkit to manage the device.

This is a **policy decision**, not an implementation gap. The friction surfaces compound: (a) Linux kernel hfsplus driver refuses RW on journaled HFS+ volumes (default for iPod-formatted HFS+), so sync can't write; (b) udev/blkid don't surface a filesystem UUID for HFS+ on Linux, breaking podkit's volumeUuid identity model and forcing a synthetic-UUID fallback that's broken; (c) the udisksctl mount path naming is generic (`/media/$USER/disk`) because no label is read. Each of these has a partial fix; together they mean Linux + HFS+ is a second-class experience no matter how much we patch.

Refusing cleanly with a docs link is structurally cleaner than supporting all three friction points, and it sharpens podkit's Linux story to "FAT32 iPods, supported well."

## Concrete repro from session 2026-05-09 (linka, nano 4G HFS+)

- `lsblk -o NAME,UUID,LABEL,FSTYPE` on `sdc2` (the iPod's HFS+ partition): UUID and LABEL both blank.
- `udisksctl mount -b /dev/sdc2` mounts at `/media/james/disk` (generic name, no label).
- Mount mode is **read-only** by default: `mount | grep /media/james/disk` shows `(ro,nosuid,nodev,relatime,umask=22,uid=1000,gid=1000,nls=utf8,uhelper=udisks2)`.
- `podkit device add --path /media/james/disk -d ipodnano` succeeds but stores `volumeUuid = "manual-L21lZGlhL2phbWVz"` — base64 of `/media/james` (truncated parent dir). Synthetic; collision-prone; doesn't survive replug.
- `podkit doctor -d ipodnano` fails to find the device by its synthetic UUID.

The user's library content is at risk because none of these failure modes are visible to a casual user — they look like working commands until something breaks downstream.

## What "refuse" looks like

### `podkit device add` against an HFS+ iPod on Linux

Refuse with a clear message:

```
Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.

To use this iPod with podkit on Linux, reformat it to FAT32. See:
  https://docs.podkit.app/devices/linux-filesystems

(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)
```

Exit code non-zero. Structured `--json` error preserves the same code (e.g. `unsupported-filesystem-on-linux`) so scripted callers can handle it.

### `podkit device scan` against an HFS+ iPod on Linux

Surface the device in the scan output, but with the right framing:

```
iPod nano 8GB Black (4th Generation)  /dev/sdc2 (HFS+)

  ⚠ Filesystem not supported on Linux
    HFS+ iPods are supported on macOS but not on Linux.
    Reformat to FAT32 to use this iPod with podkit on Linux.
    See: https://docs.podkit.app/devices/linux-filesystems
```

Other readiness-stage checks are skipped with a clear reason (not "previous check failed" — the wording matters).

### Docs

- New page (or section): "Linux: supported iPod filesystems."
- Explains: FAT32 supported, HFS+ refused, why (kernel HFS+ RW limitations + identity surface), how to reformat (point at iPod Reset Utility / Rockbox / disk utilities — outside podkit's scope to walk through).
- Link from the refusal messages above.

## Cross-references

- **TASK-317.11** (discovery reconciliation) — refusing HFS+ removes most of the friction this task was originally framed around. .11's scope shrinks accordingly.
- **TASK-317.13** (udev rule USB scope) — orthogonal; HFS+ refusal doesn't change permission story.
- **TASK-317.15** (defensive error handling for missing volumeUuid) — supplementary safety net for any post-refusal edge case where a FAT32 iPod somehow doesn't surface a UUID.

## Hardware test plan

- linka + nano 4G (HFS+): `device scan` → warning shown, no destructive remediation. `device add --path` → refused with the message above.
- linka + nano 3G (FAT32): no change in behaviour; existing FAT32 path still works.
- linka + nano 7G #2 (HFS+): same refusal as nano 4G. Cross-checks the unsupported-generation messaging from TASK-317.03 doesn't get crossed up with this filesystem-level refusal.
- macOS regression: HFS+ iPods continue to work cleanly. The refusal is Linux-platform-gated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `podkit device add` against an HFS+ iPod on Linux refuses with a clear message naming the filesystem, explaining the limitation, pointing at a docs link, and noting that macOS supports HFS+. Exit code non-zero. Structured JSON error code (e.g. `unsupported-filesystem-on-linux`) for scripted callers.
- [ ] #2 `podkit device scan` against an HFS+ iPod on Linux renders the device with a clear `Filesystem not supported on Linux` warning instead of running readiness stages. Wording matches the description. No destructive remediation suggested.
- [ ] #3 Docs page (or clearly-anchored section) at the linked URL covers: FAT32 supported, HFS+ refused on Linux, why (RW + identity), pointer to external tools for reformatting. Title + URL stable enough that the in-CLI link won't break.
- [ ] #4 macOS behaviour unchanged: HFS+ iPods continue to add/scan/sync as today. The refusal is gated to `process.platform === 'linux'`.
- [ ] #5 Real-hardware verification: linka + nano 4G (HFS+) refused at add and warned at scan; linka + nano 3G (FAT32) works as before; macOS regression on the full m-18 inventory unchanged. Documented in TASK-313 successor / Linux re-sweep task.
- [ ] #6 Tests added: unit tests for the platform-gated refusal logic; integration test that exercises a Linux-platform mock with an HFS+ filesystem fixture and asserts on the message wording + exit code.
<!-- AC:END -->
