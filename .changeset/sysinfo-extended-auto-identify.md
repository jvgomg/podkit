---
"podkit": minor
"@podkit/core": minor
"@podkit/libgpod-node": minor
---

Automated iPod device identification via SysInfoExtended.

Modern iPods (post-2006) ship without a populated `SysInfo` file after iTunes restore. Without it, libgpod treats the device as generic — artwork breaks, ALAC support is unknown, and database checksums fail on Classic 6/7G and Nano 3G+. podkit now reads SysInfoExtended directly from iPod firmware over USB during `device add`, so first-time setup works with no manual tooling.

**User-visible:**
- `podkit device add` identifies the exact model (e.g. "iPod nano 8GB Black (3rd Generation)") with no input
- `podkit doctor` detects missing SysInfoExtended and offers `--repair sysinfo-extended`
- `podkit sync` works correctly on first run with full capability detection
- Hash72 (Nano 5G) and HashAB (Nano 6G) devices get clear limitation messages
- SysInfoExtended write is gated on user confirmation during `device add`

**Core (`@podkit/core`):**
- Unified iPod model registry — single table, both `0x120x`/`0x126x` USB ID ranges, 190+ serial-suffix → model mappings, checksum-type classification per generation
- `ensureSysInfoExtended()` orchestrator: check existing → USB read → validate XML → write
- USB discovery now exposes `serialNumber`, `busNumber`, `deviceAddress`; `resolveUsbDeviceFromPath()` on macOS + Linux
- Readiness pipeline: checksum-aware severity (hash58+ devices fail without SysInfoExtended; pre-checksum devices warn)
- `READINESS_RULES` declarative array replaces ad-hoc `determineLevel()` logic
- New `sysinfo-extended` diagnostic check
- Recognizes `P` / `F` model prefixes in SysInfo

**libgpod-node (`@podkit/libgpod-node`):**
- `readSysInfoExtendedFromUsb()` N-API binding, resolved via `dlsym` at runtime so it loads gracefully on systems where libgpod lacks the symbol
- Prebuild patches upstream libgpod 0.8.3 to move `itdb_usb.c` from `tools/` into the library; libusb 1.0.27 built from source on all 6 platforms
- `--whole-archive` / `-force_load` linker flags preserve the dlsym symbol in the `.node` binary

**CLI (`podkit`):**
- `device add` attempts SysInfoExtended read after mount, before DB init; enriches model name in summary
- `doctor` adds suggested-actions section, drops destructive sysinfo guidance
- `device scan` and `doctor` show clearer SysInfo readout
