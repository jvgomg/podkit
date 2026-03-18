---
title: Device Hardware Testing
description: Manual test procedure for validating device operations on real hardware across macOS, Debian, and Alpine.
sidebar:
  order: 7
---

Manual test checklist for validating device mount, eject, detection, and UUID operations on real hardware. Run on macOS, Debian (Lima VM), and Alpine (Lima VM).

## Prerequisites

- A real iPod connected via USB (FAT32 formatted)
- For iFlash tests: an iPod with an iFlash adapter
- Lima VMs provisioned: `mise run lima:test` (creates VMs if needed)

### Platform setup

**macOS:** No extra setup — connect iPod directly.

**Debian VM:** Connect iPod to Mac, then pass the mount point through. Lima shares the macOS filesystem, so if the iPod is mounted at `/Volumes/IPOD` on macOS, it's accessible at the same path inside the VM.

**Alpine VM:** Same as Debian.

:::note
Lima VMs share the host filesystem but do **not** have direct USB access. Device detection via `/sys` and `lsblk` won't work inside Lima VMs because they see the host's virtual block devices, not the physical USB devices. For full Linux hardware testing, use a native Linux machine or a VM with USB passthrough.
:::

## Test Procedure

Run each test on all applicable platforms. Record pass/fail for each.

### 1. Device detection

Verify `podkit device add` can find the connected iPod.

```bash
podkit device add
```

**Expected:** The iPod appears in the device list with its volume name and UUID.

| Platform | Expected behavior |
|----------|------------------|
| macOS | Detected via `diskutil` media type, `iPod_Control` dir, or volume name |
| Linux (native) | Detected via USB identity from `/sys`, `iPod_Control` dir, or volume name |

### 2. UUID lookup

Verify `findByVolumeUuid` resolves the correct device.

```bash
# First, find the UUID
podkit device info

# Then verify lookup works (sync uses this internally)
podkit sync --dry-run -d <device-name>
```

**Expected:** The device is found by UUID and the dry-run shows the correct device path.

### 3. Mount (unmounted device)

Unmount the iPod first, then test mounting via podkit.

```bash
# macOS: unmount without ejecting
diskutil unmount /Volumes/IPOD

# Linux: unmount
udisksctl unmount -b /dev/sdX1
# or
sudo umount /media/user/IPOD
```

Then mount via podkit:

```bash
podkit mount
```

**Expected (with udisks2):** Mounts without root, reports mount point.

**Expected (without udisks2):** Returns `requiresSudo` with the correct `sudo` command.

```bash
# If sudo required:
sudo podkit mount
```

**Expected:** Mounts successfully, reports mount point.

### 4. Mount (already mounted)

Run mount when the iPod is already mounted.

```bash
podkit mount
```

**Expected:** Returns success with the existing mount point (no error, no re-mount).

### 5. Eject

```bash
podkit eject
```

**Expected:** iPod is unmounted. On Linux with udisks2, the device is also powered off.

### 6. Force eject

Open a file on the iPod (e.g., `cat /Volumes/IPOD/iPod_Control/Device/SysInfo &`), then:

```bash
podkit eject --force
```

**Expected:** iPod is unmounted despite the open file handle. On Linux, uses `umount -l` (lazy unmount).

### 7. iFlash detection

Requires an iPod with an iFlash adapter.

```bash
podkit device info
```

**Expected:** Device assessment shows iFlash evidence:
- Block size signal (2048 bytes vs standard 512)
- Capacity signal (if >160 GB)

| Platform | How it's detected |
|----------|------------------|
| macOS | `diskutil info` block size + `system_profiler` USB identity |
| Linux | `lsblk PHY-SEC` block size + `/sys` USB product/vendor IDs |

### 8. Wrong device rejection

Configure a device with a UUID that doesn't match the connected iPod, then try to sync:

```bash
# Edit config to set a wrong UUID for the device
podkit sync -d <device-name> --dry-run
```

**Expected:** Sync refuses with a UUID mismatch error. Does **not** proceed with the sync.

## Results Template

Copy this table and fill in results:

```
| Test | macOS | Debian | Alpine |
|------|-------|--------|--------|
| 1. Device detection | | | |
| 2. UUID lookup | | | |
| 3. Mount (unmounted) | | | |
| 4. Mount (already mounted) | | | |
| 5. Eject | | | |
| 6. Force eject | | | |
| 7. iFlash detection | | | |
| 8. Wrong device rejection | | | |
```

## Notes

- Tests 1, 3, 5, 6, and 7 require native Linux with USB access (not Lima VMs)
- Tests 2, 4, and 8 can be partially validated in Lima VMs if the iPod is mounted on the host
- The Linux device manager uses `lsblk` for enumeration — verify it's installed: `which lsblk`
- On Linux without udisks2, mount/eject will require sudo — this is expected behavior
