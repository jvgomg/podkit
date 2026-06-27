---
'@podkit/libgpod-node': patch
---

Build libgpod with a real `--without-libusb` opt-out so libusb can never be linked into the binding.

libgpod 0.8.3's `configure` unconditionally probes for `libusb-1.0` via pkg-config and links it whenever present, even though the only consumer — `itdb_read_sysinfo_extended_from_usb()` — has no callers (podkit reads SysInfoExtended over USB through `@podkit/ipod-firmware` instead). The static prebuild was already libusb-free because it builds only `src/`, but the configure step still detected libusb on macOS via Homebrew.

The prebuild and macOS dev builds now patch `configure.ac` to add an `AC_ARG_WITH([libusb])` guard and pass `--without-libusb`, guaranteeing libusb is excluded from every libgpod build we control. No API or runtime behaviour change — the binding remains database-operations only.
