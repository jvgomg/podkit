---
'@podkit/libgpod-node': minor
'@podkit/ipod-firmware': minor
'podkit': patch
---

USB firmware inquiry consolidated into @podkit/ipod-firmware (P2 — m-18 device-capability architecture).

**Breaking change in `@podkit/libgpod-node`:** The `readSysInfoExtendedFromUsb` function has been removed from the package's public exports. All in-tree callers were already routed through `@podkit/ipod-firmware` since P1 — only external consumers of `@podkit/libgpod-node` who called this function directly are affected.

`@podkit/ipod-firmware` now owns the complete firmware inquiry surface: SCSI (Linux SG_IO + macOS IOKit) and USB (direct libusb-1.0 via koffi FFI). The P1 transitional shim that delegated USB reads to libgpod-node has been replaced by a native TypeScript implementation. No API change is visible to callers of `@podkit/ipod-firmware`.

`@podkit/libgpod-node` no longer requires libusb at build or runtime. Distro packagers can now build the native binding without `libusb-1.0-0-dev` (Debian/Ubuntu), `libusb-devel` (Fedora/RHEL), or equivalent system packages. The `itdb_usb.c` patch, the `dlsym` shim, and the libusb pkg-config dependency have all been removed from the binding.

No user-facing CLI behaviour changes. `podkit doctor` inquiry checks, `podkit device scan`, and all sync paths behave identically to P1.
