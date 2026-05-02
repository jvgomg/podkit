---
id: TASK-171
title: >-
  Partition-to-disk name stripping fails on Synology (usb*p*) and NVMe (nvme*p*)
  devices
status: Done
assignee: []
created_date: '2026-03-19 20:09'
updated_date: '2026-03-19 21:16'
labels:
  - bug
  - daemon
  - synology
  - linux
milestone: 'M3: Production Ready (v1.0.0)'
dependencies: []
references:
  - packages/podkit-daemon/src/device-poller.ts
  - packages/podkit-core/src/device/platforms/linux.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The regex used to strip partition suffixes from block device names (`/\d+$/`) doesn't handle device naming conventions where the base name ends in a digit and partitions use a `p` separator.

### Affected code

- `packages/podkit-daemon/src/device-poller.ts:118` — `partitionName.replace(/\d+$/, '')`
- `packages/podkit-core/src/device/platforms/linux.ts:164` — `blockDeviceName.replace(/\d+$/, '')`

### Examples

| Device | Partition | Current result | Expected result |
|--------|-----------|---------------|-----------------|
| `sdb` | `sdb1` | `sdb` | `sdb` |
| `usb1` | `usb1p2` | `usb1p` | `usb1` |
| `nvme0n1` | `nvme0n1p2` | `nvme0n1p` | `nvme0n1` |
| `mmcblk0` | `mmcblk0p1` | `mmcblk0p` | `mmcblk0` |

### Impact

On Synology NAS (and any system using non-standard block device names), the daemon cannot find the Apple vendor ID (05ac) via sysfs because it looks up `/sys/block/usb1p/device` instead of `/sys/block/usb1/device`. This means the daemon never detects the iPod.

### Fix

Use a smarter regex that handles the `pN` suffix when the base name ends in a digit. Standard Linux convention: if the device name ends in a digit, partitions use `p` as separator.

```typescript
// Strip partition suffix: sdb1→sdb, usb1p2→usb1, nvme0n1p2→nvme0n1
const baseName = partitionName.replace(/p?\d+$/, '');
```

Or more precisely, to avoid stripping too aggressively:
```typescript
function stripPartitionSuffix(name: string): string {
  // nvme0n1p2 → nvme0n1, usb1p2 → usb1, sdb1 → sdb
  return name.replace(/(?<=\d)p\d+$/, '').replace(/(?<!\dp)\d+$/, '');
}
```

### Discovered during

Synology NAS validation (TASK-165). Synology DSM uses `/dev/usb1`, `/dev/usb1p1`, `/dev/usb1p2` for USB mass storage devices instead of the standard `/dev/sdX` naming.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Partition name stripping correctly handles usb1p2 → usb1
- [x] #2 Partition name stripping correctly handles nvme0n1p2 → nvme0n1
- [x] #3 Partition name stripping correctly handles mmcblk0p1 → mmcblk0
- [x] #4 Standard sdb1 → sdb still works
- [x] #5 Both device-poller.ts and linux.ts use the same shared helper
- [ ] #6 Daemon detects iPod on Synology NAS with /dev/usb* device names
- [x] #7 Unit tests cover all naming conventions
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created a shared `stripPartitionSuffix()` helper in `packages/podkit-core/src/device/platforms/linux.ts` that handles both Linux partition naming conventions:

1. **Standard SCSI/IDE/virtio** (`sd*`, `hd*`, `vd*`, `xvd*`, `dasd*`): strips trailing digit suffix (e.g. `sdb1` → `sdb`)
2. **NVMe/eMMC/Synology USB**: strips `pN` suffix when base name ends in digit (e.g. `nvme0n1p2` → `nvme0n1`, `usb1p2` → `usb1`, `mmcblk0p1` → `mmcblk0`)

Uses known-prefix matching for the standard convention to avoid accidentally stripping digits from bare disk names like `mmcblk0` or `nvme0n1`.

Both `findUsbIdentity()` in core and `readUsbVendorId()` in the daemon now use this shared helper. Added `@podkit/core` as a dependency of `@podkit/daemon` to enable the import.

8 unit tests added covering all naming conventions plus bare disk name passthrough. All existing tests continue to pass (158 core, 54 daemon).

Changeset added as patch for `@podkit/core`.

Note: AC #6 (daemon detects iPod on Synology NAS) requires hardware validation on a Synology device — not verifiable in this change.
<!-- SECTION:FINAL_SUMMARY:END -->
