---
"@podkit/core": patch
"podkit": patch
---

Fully detach USB device on eject so iPod disappears from Disk Utility (macOS) and system (Linux/Docker)

Previously, eject only unmounted the volume but left the physical disk device attached. On macOS, the iPod would still appear in Disk Utility after ejecting. On Linux, the USB device could remain visible.

Now eject resolves the whole-disk identifier and fully detaches the USB device:
- macOS: `diskutil eject` targets the whole disk (e.g., `disk5`) instead of the volume
- Linux: `udisksctl power-off` targets the whole disk (e.g., `/dev/sda`) and is also called after the `umount` fallback path
