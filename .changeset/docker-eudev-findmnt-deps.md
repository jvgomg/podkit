---
"@podkit/docker": patch
---

Image now installs `eudev-libs` and `findmnt` on Alpine.

`eudev-libs` provides `libudev.so.1`, which the bundled `usb` prebuild dynamically links — without it, USB firmware inquiry fails during one-time `device add` setup when `/dev/bus/usb` is passed. `findmnt` is required for mount→device resolution in `device add --path /ipod`; Alpine's `lsblk` package does not include it, and its absence caused device add to fail with a "no readable filesystem UUID" error before USB was ever touched.
