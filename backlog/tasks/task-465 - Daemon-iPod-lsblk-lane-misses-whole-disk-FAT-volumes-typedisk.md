---
id: TASK-465
title: Daemon iPod (lsblk) lane misses whole-disk FAT volumes (type=disk)
status: Done
assignee: []
created_date: '2026-07-11 20:05'
updated_date: '2026-07-11 21:07'
labels:
  - daemon
  - docker
milestone: m-22
dependencies: []
references:
  - packages/podkit-daemon/src/device-poller.ts
  - test-packages/e2e-vm-tests/src/docker-dist/daemon.docker-dist.test.ts
  - >-
    backlog/tasks/task-458.02 -
    Discovery-reclassification-—-read-only-iPod-correlates-its-mounted-volume.md
priority: low
ordinal: 225000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the Tier-5 daemon steady-state test (TASK-451).

The daemon's iPod auto-detection lane (`packages/podkit-daemon/src/device-poller.ts` `collectPartitions`) keeps only lsblk entries with `type === "part"`. A whole-disk FAT volume (no partition table) presents as `type === "disk"` and is therefore invisible to the lane — the daemon polls "waiting for iPod devices" forever and never syncs it.

Real iPods carry an MBR whose data volume IS a partition, so the lane works against real hardware; this only bites a partition-table-less FAT volume. The Tier-5 test proved this empirically (the synthesized persona backing is a bare `truncate` + `mkfs.vfat` image → `type=disk`), and worked around it by driving the daemon's mass-storage lane instead.

Decide whether to harden the lsblk lane to also accept a whole-disk (`type === "disk"`) vfat volume carrying the Apple USB vendor id in /sys. Low priority — edge case for real hardware — but a real robustness gap. The complementary test-coverage item (ship a partitioned persona backing so the lsblk lane is exercised in Tier 5) is tracked in DRAFT-021.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Hardened the daemon lsblk lane (`packages/podkit-daemon/src/device-poller.ts` `collectPartitions`) to also collect whole-disk FAT volumes: a `type === "disk"` node that carries a filesystem and has no `part` children is now surfaced (a disk WITH partition children is still skipped in favour of its partitions; loop devices are excluded). `isIpodDevice` still gates on vfat + Apple vendor id, so non-iPod whole-disk sticks are rejected. Unit coverage added in `device-poller.test.ts` (whole-disk collected, bare unformatted disk ignored, partition preferred over parent, loop-with-fs excluded).

Proven end-to-end through the shipped image: the daemon now detects a whole-disk-FAT gadget (`iPod detected: sda`), mounts `/dev/sda` in-container (requires `--privileged` — the container mount syscall is filtered even for root; `--device`+`SYS_ADMIN` are insufficient), and syncs by path.

Complementary Tier-5 coverage (DRAFT-021 item) also landed: a new MBR-partitioned persona `ipod-5g-video-mbr-part` (PID 0x120a, MBR + FAT32 `sd?1`, deterministic in-VM synthesis via sfdisk fixed disk-id + loop + `mkfs.vfat --invariant`) exercises the poller's `type: "part"` branch. New `daemon.docker-dist.test.ts` lsblk-lane `it` drives it under `--privileged` and asserts 2 AAC tracks land. Changeset: `.changeset/daemon-whole-disk-fat-detection.md` (@podkit/daemon patch).

RESOLVED (2026-07-11): implemented, not just decided. This is NOT a speculative hardening — it closes a consistency gap. TASK-458.02 (Device-Access-Tiers epic) already established that whole-disk-formatted iPods are real and supported: an iPod shuffle 4g writes its filesystem to a bare whole disk (no partition map), and the macOS/Linux SCAN enumeration path was fixed to surface partitionless whole disks. The daemon's device-poller was a separate detection path that never got that fix (kept lsblk `type=part` only), so the daemon would poll forever against a whole-disk iPod. Fix: device-poller.ts `collectPartitions` now also accepts a whole-disk vfat volume (`type=disk`, has fstype, no `part` children), excludes loop devices, prefers partitions over parent disk; iPod match (vfat + Apple vendor) unchanged. Unit-tested (4 new cases). Changeset `daemon-whole-disk-fat-detection.md` (@podkit/daemon patch). NOTE: the daemon's in-container block-device detection+mounting already requires `privileged: true` (documented agents/docker.md:133) — this change does not alter that. Marked Done.
<!-- SECTION:NOTES:END -->
