---
"@podkit/core": minor
"podkit": minor
---

Add Linux device manager support for mount, eject, and device detection. podkit now supports `podkit mount`, `podkit eject`, and `podkit device add` on Debian, Ubuntu, Alpine, and other Linux distributions. Uses `lsblk` for device enumeration, `udisksctl` for unprivileged mount/eject (with fallback to `mount`/`umount`), and USB identity from `/sys` for iPod auto-detection. iFlash adapter detection works on Linux via block size and capacity signals.
