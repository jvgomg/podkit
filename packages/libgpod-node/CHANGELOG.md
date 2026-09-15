# @podkit/libgpod-node

## 0.2.0

### Minor Changes

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit device rename` command and `setDeviceName` API

  The new `podkit device rename <name>` command renames an iPod. The case-correct device name is the iTunesDB master-playlist name, so renaming writes that name. Use `--no-disk` for a database-only rename (the OS volume-label branch lands in a follow-up); `--no-database` to relabel the disk only; `-y/--yes` to skip the confirmation prompt. Passing both `--no-disk` and `--no-database` is rejected as a no-op.

  New APIs:
  - `@podkit/libgpod-node`: `Database.setDeviceName(name)` writes the master-playlist name (the legitimate low-level writer; no guard). The name persists across `save()` + reopen.
  - `@podkit/core`: `IpodDatabase.setDeviceName(name)` — the only sanctioned way to rename the master playlist (the generic `IpodPlaylist.rename()` guard still refuses it). Plus `applyDeviceName(...)`, an orchestrator that writes the database name first and (in a later slice) the disk label last, since relabeling moves the OS mountpoint.

- [`22dddf4`](https://github.com/jvgomg/podkit/commit/22dddf4803f4cfd7b004d80dffd83878a68b10f2) Thanks [@jvgomg](https://github.com/jvgomg)! - Add standalone Device class for capability queries without opening a database
  - `Device.fromMountPoint(path)` — reads SysInfo from filesystem, determines capabilities
  - `Device.fromModelNumber(num)` — cached lookup from model number string, no filesystem needed
  - Exposes `supportsArtwork`, `supportsVideo`, `supportsPhoto`, `supportsPodcast`, `generation`, `modelNumber`, `modelName`, `capacity`
  - Add `ArtworkFormat` type (reserved for future artwork dimension exposure)

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - `device init`, `device reset` and `device add` no longer stamp a fabricated iPod Video identity onto the device.

  Initialising an iPod database writes the model number it is given to `iPod_Control/Device/SysInfo` as `ModelNumStr`. That value defaulted to `MA147` — an iPod Video 60GB — and every podkit caller took the default. So `podkit device reset` on _any_ iPod left it claiming to be an iPod Video, with no backup and no marking, and podkit then read its own fabrication back as evidence of what the device was: it fed the identity cascade, and it silently satisfied the empty-identity refusal on a later `device add`.

  The default is gone. podkit now passes the model number its identity cascade resolved from the device, and when the cascade resolves none, initialisation writes no SysInfo at all rather than inventing one. A device with unresolved identity keeps whatever identity it already had.

  Two consequences of initialising without a model number, both of which podkit now handles:
  - The database layer writes a playback database (`iTunesSD`) for _any_ device it is given no model number for, in the `bdhs` format of an iPod shuffle 3G/4G. podkit deletes that file after initialising: a playback database for a device nothing has identified, in a format nothing has confirmed the hardware reads, is worse than none. A device that already had one keeps it. Initialising an iPod shuffle whose model number is unknown is now refused outright, pointing at `podkit doctor --repair sysinfo-extended` — that reads the device's own serial from firmware, which resolves the model number.
  - `iPod_Control/Artwork` and `Photos/Thumbs` are no longer pre-created, because the database layer only creates them for a device whose model it knows. Both are created on demand by whatever writes to them, so nothing changes in practice.

  Breaking for `@podkit/libgpod-node` consumers: `Database.initializeIpod()` (and `initializeIpodSync()`) no longer default `options.model` to `MA147`. Callers that relied on that default — including anything creating synthetic test iPods — must pass `model` explicitly.

- [#59](https://github.com/jvgomg/podkit/pull/59) [`1ec30ac`](https://github.com/jvgomg/podkit/commit/1ec30acca1109178012db3913a60967a2087fb5b) Thanks [@jvgomg](https://github.com/jvgomg)! - Automated iPod device identification via SysInfoExtended.

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

- [`4598f8f`](https://github.com/jvgomg/podkit/commit/4598f8f3347cf40b94fdf1585215e5b0f54d9cf6) Thanks [@jvgomg](https://github.com/jvgomg)! - USB firmware inquiry consolidated into @podkit/ipod-firmware (P2 — m-18 device-capability architecture).

  **Breaking change in `@podkit/libgpod-node`:** The `readSysInfoExtendedFromUsb` function has been removed from the package's public exports. All in-tree callers were already routed through `@podkit/ipod-firmware` since P1 — only external consumers of `@podkit/libgpod-node` who called this function directly are affected.

  `@podkit/ipod-firmware` now owns the complete firmware inquiry surface: SCSI (Linux SG_IO + macOS IOKit) and USB (direct libusb-1.0 via koffi FFI). The P1 transitional shim that delegated USB reads to libgpod-node has been replaced by a native TypeScript implementation. No API change is visible to callers of `@podkit/ipod-firmware`.

  `@podkit/libgpod-node` no longer requires libusb at build or runtime. Distro packagers can now build the native binding without `libusb-1.0-0-dev` (Debian/Ubuntu), `libusb-devel` (Fedora/RHEL), or equivalent system packages. The `itdb_usb.c` patch, the `dlsym` shim, and the libusb pkg-config dependency have all been removed from the binding.

  No user-facing CLI behaviour changes. `podkit doctor` inquiry checks, `podkit device scan`, and all sync paths behave identically to P1.

### Patch Changes

- [`600d4c8`](https://github.com/jvgomg/podkit/commit/600d4c8ac4fd2ab76131e10f38bb88d6798fa3d9) Thanks [@jvgomg](https://github.com/jvgomg)! - Build libgpod with a real `--without-libusb` opt-out so libusb can never be linked into the binding.

  libgpod 0.8.3's `configure` unconditionally probes for `libusb-1.0` via pkg-config and links it whenever present, even though the only consumer — `itdb_read_sysinfo_extended_from_usb()` — has no callers (podkit reads SysInfoExtended over USB through `@podkit/ipod-firmware` instead). The static prebuild was already libusb-free because it builds only `src/`, but the configure step still detected libusb on macOS via Homebrew.

  The prebuild and macOS dev builds now patch `configure.ac` to add an `AC_ARG_WITH([libusb])` guard and pass `--without-libusb`, guaranteeing libusb is excluded from every libgpod build we control. No API or runtime behaviour change — the binding remains database-operations only.

- [`6000868`](https://github.com/jvgomg/podkit/commit/6000868830d9437a6fff3c1a77adb254d9579fe7) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `doctor --repair sysinfo-extended` showing unhelpful "Could not read device identity from USB" with no detail. The native USB binding now throws descriptive errors (e.g. "USB control transfer failed (bus 3, device 4)") instead of returning null silently. Also fix all doctor repair intro messages — they incorrectly said "Repairing X for N tracks" even for non-track operations like SysInfoExtended and orphan cleanup. Intro messages now use each repair's own description.

## 0.1.0

### Minor Changes

- [`e4485a1`](https://github.com/jvgomg/podkit/commit/e4485a1c1884a3893f58141d2044e6b16c108789) Thanks [@jvgomg](https://github.com/jvgomg)! - Add self-healing sync for changed and upgraded source files. Sync now detects when a source file has improved — format upgrade (MP3 replaced with FLAC), quality upgrade (higher bitrate), artwork added, Sound Check values changed, or metadata corrected — and upgrades the iPod track in place, preserving play counts, star ratings, and playlist membership.

  Upgrades happen by default as part of normal sync. Use `--skip-upgrades` or the `skipUpgrades` config option to disable file-replacement upgrades when short on time or space. The `skipUpgrades` setting follows the standard resolution order (CLI flag → device config → global config → default).

  Add `replaceTrackFile()` to `@podkit/libgpod-node` for replacing a track's audio file while preserving the database entry. The old file is deleted and libgpod generates a fresh path with the correct extension for the new format, ensuring the iPod firmware uses the right decoder.

  Add `hasArtwork` field to `CollectionTrack` — populated by the directory adapter (from embedded pictures) and Subsonic adapter (from cover art metadata).

  Fix copied tracks (MP3, M4A) not having their bitrate recorded in the iPod database, which is needed for quality-upgrade detection.

  **Breaking:** `ConflictTrack` type and `SyncDiff.conflicts` array removed from `@podkit/core` — metadata conflicts are now handled as `metadata-correction` upgrades.

- [`d40371f`](https://github.com/jvgomg/podkit/commit/d40371f876bc9008641b08f26c0087e137cfc871) Thanks [@jvgomg](https://github.com/jvgomg)! - Add Sound Check (volume normalization) support. podkit now reads ReplayGain and iTunNORM tags from source files and writes the Sound Check value to the iPod database during sync, enabling automatic volume normalization on playback. The dry-run output shows how many tracks have normalization data, and a new `soundcheck` field is available in `device music` and `collection music` commands via `--fields`.

## 0.0.1

### Patch Changes

- [`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release with CLI for syncing music collections to iPod devices. Includes directory and Subsonic source adapters, FLAC-to-AAC transcoding, metadata and artwork transfer, and video sync support.
