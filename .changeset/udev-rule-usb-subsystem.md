---
"podkit": patch
"@podkit/core": patch
---

Extend the podkit udev rule to grant Apple-vendor USB device access (`/dev/bus/usb/<bus>/<dev>`) in addition to the existing SCSI generic (`/dev/sg*`) coverage. Linux libusb-based firmware inquiry now works without sudo from SSH sessions, headless boxes, Docker containers, and CI — the SSH-session permission gap previously closed only the SCSI half. `podkit doctor --repair udev-rule` installs the extended rule and cleans up any legacy filename from previous installs.
