---
id: TASK-145
title: 'Docker USB auto-mount: detect and mount iPod inside container'
status: To Do
assignee: []
created_date: '2026-03-18 01:01'
updated_date: '2026-03-18 02:24'
labels:
  - docker
  - future
dependencies:
  - TASK-144
references:
  - docker/Dockerfile
  - docker/entrypoint.sh
  - docs/getting-started/docker.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently the Docker docs show a "USB Device Passthrough" example that still requires the host to mount the iPod filesystem first — the USB passthrough does nothing useful. The section has been removed from the docs as misleading.

This task captures the work needed to have the container detect a USB iPod device and mount its filesystem internally, eliminating the need for host-side mounting.

**Scope:** FAT32 iPods only (no HFS+ support needed).

**What's needed:**

1. **Image packages**: Add `dosfstools` to the Alpine image for FAT32 mount support
2. **Privileges**: Container needs `--privileged` or `--cap-add SYS_ADMIN` + `--device /dev/sdX` (or `/dev/bus/usb` for hotplug)
3. **Detection logic**: Entrypoint or helper script that finds the iPod partition — look for a FAT32 partition containing `iPod_Control/` directory
4. **Mount/unmount**: Mount the detected partition to `/ipod`, run podkit, then cleanly unmount
5. **Linux-only**: Docker Desktop on macOS/Windows doesn't pass USB to the Linux VM. This feature only works on native Linux Docker hosts — document this clearly
6. **Error handling**: Clear error messages when no iPod is detected, device is busy, or permissions are insufficient

**Design considerations:**
- For one-shot `sync` usage: detect → mount → sync → unmount → exit
- For daemon mode: udev rules or polling to detect connect/disconnect events (defer to TASK-144)
- The detection heuristic should be conservative — don't mount random USB drives
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Container can detect a connected FAT32 iPod via USB passthrough without host-side mounting
- [ ] #2 iPod filesystem is mounted inside the container and used for sync automatically
- [ ] #3 Clean unmount after sync completes (one-shot mode)
- [ ] #4 Clear error message when no iPod detected or insufficient permissions
- [ ] #5 Docker docs updated with USB auto-mount instructions (Linux-only caveat)
- [ ] #6 Works with --privileged or minimal --cap-add SYS_ADMIN + --device flags
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## USB device discovery

`/dev/bus/usb` gives raw USB bus access (libusb-level) — not useful for mounting filesystems. Users need the block device (`/dev/sdX`) which the kernel creates when the iPod is plugged in.

**Problem:** Block device names aren't stable — `/dev/sdb` can change between plugs depending on other USB devices.

**Options for device discovery:**

1. **Documentation-only** — tell users to run `lsblk -o NAME,SIZE,VENDOR,MODEL,FSTYPE` on the host, find the iPod, pass `--device /dev/sdX:/dev/sdX`. Simple but manual and fragile.

2. **Host-side udev rule** — ship or document a udev rule that creates a stable symlink:
   ```
   ATTRS{idVendor}=="05ac", SYMLINK+="ipod"
   ```
   Users always use `--device /dev/ipod:/dev/ipod`. Set up once, stable across replugs. Best UX for recurring use.

3. **Discovery command** — a `podkit device scan` command that, given `--privileged`, scans block devices for FAT32 partitions containing `iPod_Control/` and prints the device path. Users run it once to find the device, then lock down their compose file to that specific device.

4. **`--privileged` with auto-detect** — container gets access to all devices and scans automatically. Nuclear option, worst security posture, but zero config.

**Recommendation (to finalize when task is worked on):** Likely a combination of udev rule docs (option 2) for the steady-state UX, plus a discovery command (option 3) for initial setup. Avoid requiring `--privileged` at runtime.

## UUID validation for auto-mounted devices

When the container auto-mounts an iPod (future), UUID validation becomes critical — the container may detect multiple USB devices and needs to mount the right one. The `iPod_Control/` heuristic finds iPods, but UUID distinguishes WHICH iPod.

For the multi-device Docker Compose pattern (separate service per iPod), UUID validation prevents the auto-mount from picking the wrong device when multiple iPods are connected simultaneously.
<!-- SECTION:NOTES:END -->
