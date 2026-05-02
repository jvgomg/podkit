# iPod Device Identification

A living document covering the iPod device identification problem space: strategies, platform implementations, device compatibility, and architectural direction.

Last updated: 2026-05-02 (research phase complete)

## Problem Statement

podkit needs to identify connected iPod devices to determine their capabilities: supported audio/video codecs, artwork format dimensions, checksum requirements, and transfer constraints. The level of identification detail affects what podkit can do:

- **Generation-level** (e.g., "nano 2G") is enough for basic sync with no checksums.
- **Model-level** (e.g., "nano 4GB Green 2nd Gen", model A487) gives exact capabilities and a display name.
- **Full firmware identity** (serial, FireWire GUID, FamilyID, codec specs, artwork formats) enables checksum generation, artwork at correct dimensions, and video transcoding to device-specific constraints.

Different iPod generations, operating systems, and usage contexts provide different levels of identification detail. This document maps out what data is available, how to get it, and where the gaps are.

## Identification Strategies

There are four strategies for identifying an iPod, divided into two categories:

**Passive strategies** read data that is already exposed without any Apple-specific protocol:

- **USB Enumeration** — standard USB descriptors
- **Filesystem Identity** — files on the iPod's mounted partition

**Active strategies** query the iPod's firmware for device capability data:

- **SCSI Inquiry** — SCSI VPD page 0xC0
- **USB Inquiry** — Apple vendor USB control transfer (preferred for 5G+)

### USB Enumeration

**What it reads:** Standard USB device descriptors — vendor ID, product ID, serial number string, device class.

**Data provided:**

| Field | Example | Notes |
|-------|---------|-------|
| USB Product ID | `0x1260` | Maps to generation (nano 2G) |
| USB Serial | `000A27001A0647CB` | This IS the FireWire GUID |
| Vendor ID | `0x05ac` | Always Apple for iPods |

**Fidelity:** Generation-level only. Gives the iPod family (nano 2G, Classic 6G) but not the specific variant (color, capacity, model number). Does not provide codec capabilities, artwork formats, or the Apple serial number needed for model-variant lookup.

**Device support:** Every USB iPod exposes these descriptors. Universal.

**Platform support:** Universal. macOS via `system_profiler`/IOKit, Linux via sysfs (`/sys/bus/usb/devices/`).

**Current podkit implementation:** Fully implemented. USB discovery resolves product ID to generation via lookup table in `ipod-models.ts`. Used by `podkit device scan` and as the initial identification step in all device operations. The USB serial is used as the FireWire GUID for matching against other data sources.

### Filesystem Identity

**What it reads:** Files on the iPod's mounted FAT32/HFS+ partition.

**Files:**

| File | Path | Format | Content |
|------|------|--------|---------|
| SysInfo | `iPod_Control/Device/SysInfo` | Key-value text | `ModelNumStr` — model number (e.g., "MA487") |
| SysInfoExtended | `iPod_Control/Device/SysInfoExtended` | Apple plist XML | Full device identity and capabilities |

**Fidelity:** Depends on which files are present:

- **SysInfo alone** gives exact model variant (color, capacity) via ModelNumStr lookup. This is what libgpod uses for device identification.
- **SysInfoExtended** gives the full firmware identity: serial number, FireWire GUID, FamilyID, audio codecs, artwork format specifications with pixel dimensions, video codec constraints, and more.

**Device support and important caveat:** These files are written to the user-writable partition, not stored in firmware.

**SysInfo write behaviour (researched):** There is a generational divide at mid-2006:

| Era | Generations | SysInfo on format? |
|-----|-----------|-------------------|
| Pre mid-2006 | iPod 1G-4G, iPod Photo, mini 1G-2G, nano 1G | Firmware writes populated SysInfo with ModelNumStr, serial, etc. |
| Post mid-2006 | nano 2G+, iPod 5.5G+, shuffle 2G+ | Firmware creates the file but **leaves it empty (0 bytes)** |

For post-2006 devices, **iTunes** (or the libgpod HAL callout on Linux) is responsible for populating both files. iTunes reads SysInfoExtended from firmware via SCSI/USB inquiry and writes it to disk. The plain SysInfo ModelNumStr is also populated during this process.

Additionally, the firmware on post-2006 iPods will **overwrite SysInfo on normal boot** — writing it manually requires the iPod to be in disk mode, not normal mode.

This means:

- A freshly formatted post-2006 iPod will always have an empty SysInfo file.
- SysInfoExtended is only present if something previously read it from firmware and wrote it to disk.
- These files can be deleted, corrupted, or stale.
- For post-2006 iPods, SysInfoExtended is the **primary identification mechanism**, not SysInfo. The plain SysInfo ModelNumStr is a legacy fallback.

Sources: KDE/Amarok iPod wiki, iPodLinux SysInfo documentation, dstaley/ipod-sysinfo repo, libgpod `itdb_device.c` fallback chain.

**Platform support:** Universal — just filesystem reads.

**Current podkit implementation:** Fully implemented. libgpod reads both files on database open to determine device capabilities, preferring SysInfoExtended when present and falling back to SysInfo. `sysinfo-extended.ts` reads and parses SysInfoExtended. The `podkit doctor --repair sysinfo-extended` command writes SysInfoExtended to disk after reading it from firmware via USB inquiry.

**libgpod dependency:** podkit currently depends on libgpod for database operations, and libgpod reads device identity exclusively from filesystem files. This means filesystem identity is currently a hard requirement for sync, regardless of what other strategies provide. In a future without libgpod, this constraint could be relaxed — podkit could use firmware-reported capabilities directly without needing them written to disk first.

### SCSI Inquiry

**What it reads:** SysInfoExtended XML from iPod firmware via SCSI Vital Product Data (VPD) page 0xC0.

**How it works:** The iPod's firmware exposes device identity and capability data through SCSI inquiry pages. Page 0xC0 returns an index of available subpages (typically 0xC2-0xDB). Each subpage contains a chunk of the SysInfoExtended XML. Reading all subpages and concatenating produces the complete XML document.

**Data provided:** The full SysInfoExtended XML, identical to what gets written to `iPod_Control/Device/SysInfoExtended`. This includes:

- Device identity: FireWire GUID, serial number, FamilyID
- Audio codec support: AAC, MP3, ALAC, AIFF, WAV with sample rate and bit depth limits
- Artwork format specifications: format IDs, pixel dimensions, pixel format, crop and alignment settings
- Album art and chapter image specifications
- Video codec constraints (on video-capable models): H.264 profiles/levels, resolution limits, bit rate caps
- Device metadata: firmware version, RAM, volume format, supported features

**Fidelity:** Maximum. This is the device's own report of its capabilities, read directly from firmware. It is the authoritative source for artwork dimensions and codec support — more reliable than hardcoded generation tables.

**Device support (researched):** Based on hardware-tested data from the dstaley/ipod-sysinfo repository:

| Model | SCSI Inquiry |
|-------|-------------|
| iPod 1G-2G | Unknown (FireWire-era, likely unsupported) |
| iPod 3G | **No** (has plain-text SysInfo only) |
| iPod 4G / Photo | **Yes** |
| iPod 5G (Video) | **Yes** |
| iPod Classic (6G) | **Yes** |
| iPod mini 1G-2G | **Yes** |
| iPod nano 1G-7G (all) | **Yes** |
| iPod shuffle 1G-4G (all) | **Yes** |
| iPod Touch / iPhone | **No** (not mass storage devices) |

SCSI inquiry has broad support — it works on everything from iPod 4G onwards, all minis, all nanos, and all shuffles. The only disk-mode iPod that doesn't support it is the 3G.

**Comparison with USB inquiry:** Both methods return the same SysInfoExtended XML. However, for **nano 5G and later**, USB inquiry returns **additional fields** not present in the SCSI response (the dstaley repo has separate SCSI and USB captures confirming this). SCSI does have one advantage: it correctly reports the current volume format (HFS+/FAT32), while USB reports "Unknown" for this field. Verified by comparing output from both methods on a nano 4G.

**Platform implementations:**

**macOS — IOKit SCSITaskUserClient:**
Direct SCSI commands work as a regular user (no sudo) through the IOKit framework. macOS ships a dedicated `com.apple.driver.iPodSBC` kernel extension that handles iPod SCSI communication. The approach:

1. Find the `com_apple_driver_iPodSBCNub` IOKit service
2. Create a `SCSITaskDeviceInterface` via the IOKit plugin system
3. Obtain exclusive device access
4. Send SCSI INQUIRY commands for VPD pages 0xC0, 0xC2-0xDB
5. Concatenate page data to reconstruct the XML

This was verified working on macOS 15 Sequoia (Darwin 24.6.0) with an iPod nano 2G — a device where USB inquiry fails. No entitlements or special permissions required.

**Heuristic for macOS support:** Check `test -d /System/Library/Extensions/iPodDriver.kext`. This is a read-only system volume check — no root, no device connection needed. If the kext exists, macOS can perform SCSI inquiry on iPods. The kext has been present since at least the early iTunes era and is still shipped in macOS 15.

**macOS — plist cache (secondary source):**
macOS caches device identity data from previous connections in `~/Library/Preferences/com.apple.iPod.plist`. This plist is keyed by FireWire GUID and contains serial number, FamilyID, firmware version, and other fields. It persists across disconnections — useful when the device is not currently connected. However, it contains a subset of SysInfoExtended (no artwork specs, no codec details). Whether this is worth implementing as a fallback is an **open question** — direct SCSI inquiry covers the connected-device case, which is the case that matters for sync and repair.

**Linux — SG_IO ioctl:**
SCSI passthrough is available through the kernel's SG_IO ioctl on `/dev/sgN` or directly on the block device `/dev/sdN`. This is a kernel interface available on any Linux system with USB mass storage support — no additional packages required. libgpod's `ipod-scsi.c` uses the `sgutils` library (`sg_ll_inquiry`), but sgutils is just a wrapper around SG_IO — the same commands can be issued directly without the library dependency.

**Current podkit implementation:** Not implemented. This is the primary opportunity for improving device identification. The macOS IOKit approach has been prototyped and verified (see Information Sources below).

### USB Inquiry

**What it reads:** SysInfoExtended XML from iPod firmware via an Apple vendor-specific USB control transfer.

**How it works:** Uses libusb to send a USB control transfer with:
- Request type: vendor, device-to-host
- Request: `0x40`
- Value: `0x02` (read SysInfoExtended)
- Index: page number (0, 1, 2, ...)

Reads 4096-byte chunks, incrementing the page index until a short read signals end-of-data. The concatenated result is the SysInfoExtended XML.

**Data provided:** The same SysInfoExtended XML as SCSI inquiry, with minor differences: the volume format field reports "Unknown" instead of the actual format, and a cryptographic data blob varies per-read. All identity and capability fields are identical.

**Fidelity:** Maximum (same as SCSI inquiry, minus volume format detection).

**Device support (researched):** Based on hardware-tested data from the dstaley/ipod-sysinfo repository:

| Model | USB Inquiry | Extra fields vs SCSI? |
|-------|------------|----------------------|
| iPod 1G-2G | Unknown (likely no) | — |
| iPod 3G | **No** | — |
| iPod 4G / Photo | **No** | — |
| iPod 5G (Video) | **No** | — |
| iPod Classic (6G) | **Yes** | No |
| iPod mini 1G-2G | **No** | — |
| iPod nano 1G-2G | **No** | — |
| iPod nano 3G-4G | **Yes** | No |
| iPod nano 5G-7G | **Yes** | **Yes** (additional fields) |
| iPod shuffle 1G-2G | **No** | — |
| iPod shuffle 3G-4G | **Yes** | No |
| iPod Touch / iPhone | **No** (use libimobiledevice) | — |

The USB method was added to libgpod specifically because the **nano 5G returned incomplete data via SCSI** (missing artwork format information). However, the USB vendor control transfer itself works on devices back to the nano 3G and Classic 6G. The libgpod comment "useful for Nano5G" reflects that USB was **required** for nano 5G, not that it was introduced for it.

**Platform support:** Cross-platform via libusb. Works on macOS and Linux.

**Current podkit implementation:** Implemented in the native C++ binding (`gpod_binding.cc`) via runtime dlsym resolution of `itdb_read_sysinfo_extended_from_usb` from libgpod. Exposed as `readSysInfoExtendedFromUsb()` in `@podkit/libgpod-node`. Used by `ensureSysInfoExtended()` and the `podkit doctor --repair sysinfo-extended` command.

The binding throws descriptive errors (as of the fix in this session) rather than returning null silently:
- `"libgpod was compiled without USB support (libusb not linked)"` — when libgpod lacks libusb
- `"USB control transfer failed (bus N, device N) — ..."` — when the device doesn't respond

## Strategy Comparison

| Quality | USB Enumeration | Filesystem Identity | SCSI Inquiry | USB Inquiry |
|---------|----------------|-------------------|--------------|-------------|
| **Category** | Passive | Passive | Active | Active |
| **Fidelity** | Generation | Model variant+ | Full firmware | Full firmware |
| **Identity fields** | Product ID, FireWire GUID | ModelNumStr, serial, FamilyID | All | All |
| **Artwork specs** | No | Only in SysInfoExtended | Yes | Yes |
| **Codec specs** | No | Only in SysInfoExtended | Yes | Yes |
| **Video constraints** | No | Only in SysInfoExtended | Yes | Yes |
| **Checksum data** | FireWire GUID only | Serial, GUID, FamilyID | All | All |
| **Device must be connected** | Yes | Mounted | Yes | Yes |
| **Works on formatted iPod** | Yes | May be empty | Yes | Yes |
| **Oldest iPod supported** | All USB iPods | All (if files present) | iPod 4G (2004) | nano 3G / Classic 6G (2007) |
| **macOS** | system_profiler / IOKit | Filesystem | IOKit (no root) | libusb |
| **Linux** | sysfs | Filesystem | SG_IO ioctl (no packages) | libusb |

## Generation Tables: Authority vs. Fallback

podkit maintains hardcoded generation tables in `ipod-models.ts` that map USB product IDs, model numbers, and serial suffixes to device capabilities. These tables currently serve as the **authority** for device identification.

With active inquiry strategies providing firmware-reported capabilities, the role of these tables shifts:

**Tables remain authoritative for:**
- **Checksum type** — not directly named in SysInfoExtended, but the `DBVersion` field maps to checksum type (e.g., DBVersion 5 = hashAB). Generation tables remain the primary lookup, but firmware data could verify it.
- **Display names** — "iPod nano 4GB Green (2nd Generation)" comes from serial suffix lookup, not firmware.
- **Unsupported device detection** — rejecting nano 6G, iPod Touch, Shuffle 3G/4G at scan time, before any firmware query.
- **Offline capability queries** — "what formats does a nano 3G support?" without a device connected. Useful for documentation, dry-run validation, the virtual iPod, and pre-transcoding.

**Tables become a fallback for:**
- **Artwork format dimensions** — firmware reports exact specs with pixel format, crop, and alignment.
- **Audio/video codec support** — firmware reports supported codecs with sample rate, bit rate, and resolution limits.
- **Device feature flags** — podcast support, photo support, chapter images, etc.

The architectural direction is toward treating firmware-reported data as the authority when available, and tables as a supplement for data that firmware doesn't report (checksum type, display names) or a fallback when no device is present.

**Offline use case:** Some operations benefit from knowing device capabilities without a device connected — for example, pre-transcoding video files for an iPod that will be connected later. This requires either cached firmware data or the generation tables. The design question is whether to cache the generation ID (and derive capabilities from tables) or cache the full SysInfoExtended data (and derive capabilities from firmware). This is an **open question** with implications for how device configuration is stored.

## Usage Contexts

Different podkit commands compose these strategies differently:

**`podkit sync`** — Currently only uses filesystem identity (libgpod reads SysInfo/SysInfoExtended from the mounted partition). This is a hard constraint of the libgpod dependency. USB enumeration runs during device discovery to find and validate the device.

**`podkit device scan`** — Uses USB enumeration to discover connected iPods and identify them at generation level. Could benefit from active inquiry to provide richer device information in the scan output.

**`podkit device info`** — Uses USB enumeration and filesystem identity. Could use active inquiry for consistency checking and richer output.

**`podkit doctor`** — The repair context where active inquiry matters most. `--repair sysinfo-extended` currently uses USB inquiry to read firmware data and write it to the filesystem, bridging active inquiry to filesystem identity. This is the write-back loop: active inquiry populates the filesystem so that libgpod can use it at sync time.

**Future `podkit doctor` checks:**
- Verify that filesystem identity matches firmware-reported data (detect stale/corrupt files).
- Report which inquiry methods are available on the current system (iPodDriver.kext present? libusb linked?).
- Warn when a device is identified at generation level but could be identified more precisely.

## Inquiry Method Selection

When active inquiry is needed, podkit should prefer **USB inquiry first, then fall back to SCSI inquiry**. This matches libgpod's actual priority order (`generic-callout.c` tries USB first) and is justified because:

- For nano 5G-7G, USB inquiry returns **additional fields** not present in the SCSI response
- USB inquiry is cross-platform via libusb with no OS-specific code paths
- SCSI inquiry has broader device support (works back to iPod 4G) and correctly reports volume format

The selection logic:

1. Attempt USB inquiry (more complete data on 5G+, cross-platform)
2. Fall back to SCSI inquiry if USB fails (covers older devices: iPod 4G/5G, mini, nano 1G-2G)
3. Fall back to USB enumeration if both fail (generation-level identification)

For devices that support both methods, the difference is minor. The important thing is that the fallback chain covers the full range of iPod generations.

## Information Sources

This document was developed from the following sources:

### libgpod source code

Location: `tools/libgpod-macos/build/libgpod-0.8.3/`

The primary source for understanding the three inquiry backends:

- `src/itdb_usb.c` — USB vendor control transfer implementation. Uses libusb to send request 0x40, value 0x02. Reads 4096-byte chunks.
- `tools/ipod-scsi.c` — SCSI inquiry implementation. Uses sgutils (`sg_ll_inquiry`) to read VPD page 0xC0 subpages.
- `tools/ipod-lockdown.c` — libimobiledevice backend for iOS devices.
- `tools/read-sysinfoextended.c` — CLI tool that ties all three backends together. Contains the comment "useful for Nano5G for example" about the USB path, which is the primary evidence for the USB inquiry device boundary.
- `tools/generic-callout.c` — The udev/HAL callout showing the priority order: USB first, SCSI fallback. Both feed into `itdb_sysinfo_extended_parse_from_xml()`.
- `src/itdb_device.c` — Model lookup tables, serial-to-model mapping.

### podkit codebase

- `packages/podkit-core/src/device/ipod-models.ts` — USB product ID table, model number table, serial suffix table, generation metadata, checksum type mapping.
- `packages/libgpod-node/native/gpod_binding.cc` — The N-API binding for `readSysInfoExtendedFromUsb`, showing the dlsym runtime resolution.
- `packages/podkit-core/src/device/sysinfo-extended.ts` — The orchestrator for reading/writing SysInfoExtended.
- `packages/podkit-core/src/device/usb-discovery.ts` — USB device discovery and unsupported device detection.

### Live device testing (2026-05-02)

Two iPods were tested during the development of this document:

**iPod nano 2nd Generation (4GB Green, model A487)**
- USB Product ID: `0x1260`
- FireWire GUID: `000A27001A0647CB`
- Serial: `YM7275YSVQH` (suffix VQH)
- SCSI inquiry: **works** (26 VPD subpages, 6,279 bytes XML)
- USB inquiry: **fails** (device does not respond to vendor control transfer)
- SysInfo: empty (0 bytes)
- SysInfoExtended: not present
- Checksum type: none

**iPod nano 4th Generation (8GB, model unknown)**
- USB Product ID: `0x1263`
- FireWire GUID: `000A27001DCECFB5`
- Serial: `5U851AEH3R0`
- SCSI inquiry: **works** (58 VPD subpages, 14,296 bytes XML)
- USB inquiry: **works** (14,297 bytes XML — identical content, differs only in volume format field and a per-read cryptographic blob)
- Checksum type: hash58

### macOS system APIs

- `system_profiler SPUSBDataType` — USB device enumeration (product ID, vendor, serial, bus/device address).
- `ioreg -r -c IOSCSIPeripheralDeviceNub` — IOKit registry showing the `com_apple_driver_iPodSBC` driver and `SCSITaskDeviceCategory: iPodUserClientDevice`.
- `plutil -p ~/Library/Preferences/com.apple.iPod.plist` — Cached device identity from previous connections.
- `kextfind -b com.apple.driver.iPodSBCDriver` — Checks if the iPod SCSI driver is installed.
- IOKit `SCSITaskUserClient` — Verified that regular-user SCSI command passthrough works on macOS 15 via a C test program using IOKit framework APIs.

### Web resources (discovered during research phase)

- **dstaley/ipod-sysinfo** (https://github.com/dstaley/ipod-sysinfo) — Hardware-tested SysInfoExtended collection with SCSI/USB compatibility table for every iPod generation. Includes separate SCSI and USB captures for devices that support both. The most authoritative source for inquiry method boundaries.
- **dstaley/ipod-read-sysinfo-extended-macos** (https://github.com/dstaley/ipod-read-sysinfo-extended-macos) — Rust tool for reading SysInfoExtended via USB vendor control transfer on macOS.
- **dstaley/hashab** (https://github.com/dstaley/hashab) — hashAB implementation, confirms it's used on nano 6G and 7G.
- **KDE/Amarok iPod wiki** (https://community.kde.org/Amarok/Archives/MediaDeviceIPod) — Documents the empty SysInfo behaviour for post-mid-2006 iPods.
- **iPodLinux SysInfo page** (https://seshan.xyz/flow/files/ipodlinux/SysInfo.html) — SysInfo file format documentation, DiskMode requirement, firmware overwrite behaviour.
- **iPodLinux Device Information** (https://seshan.xyz/flow/files/ipodlinux/Device_Information/index.html) — SCSI inquiry VPD page 0xC0 documentation.
- **Detecting iPods Programmatically** (https://www.flyaga.info/da/detecting-ipods-programmatically-part-2/) — iPodSCSICodePages method (note: some claims about iPod 3G SCSI support contradict hardware testing).
- **ipod_manager** (foobar2000 plugin by reupen) — Working nano 7G support using iTunesCrypt.dll for hashAB with variable-length UUID support.
- **iOpenPod** (https://github.com/TheRealSavi/iOpenPod) — Working nano 7G support using SQLiteDB_Writer + hashAB via WebAssembly.

### General source areas for future investigation

- **libgpod source** (`tools/libgpod-macos/build/libgpod-0.8.3/`) — the most complete reference for iPod communication protocols. Files in `src/` and `tools/` contain device tables, protocol implementations, and conditional compilation flags that reveal what was supported when.
- **Linux USB device ID database** (linux-usb.org) — canonical mapping of Apple USB product IDs to device names.
- **IOKit headers** (`/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/IOKit.framework/`) — macOS SCSI passthrough APIs.
- **Linux kernel SCSI documentation** (`Documentation/scsi/` in kernel source) — SG_IO ioctl interface.
- **Apple's iPod tech specs pages** — model numbers, capacities, release dates.
- **gtkpod/libgpod mailing list archives** (SourceForge) — community reports of device compatibility issues, especially post-libgpod-0.8.3 devices.

## Research Findings (resolved)

The following questions were investigated during the research phase (2026-05-02).

**SysInfo write behaviour — RESOLVED.** Mid-2006 is the cutoff. iPod 1G-4G, mini, and nano 1G write populated SysInfo. Nano 2G and all subsequent generations write empty SysInfo (0 bytes). iTunes or the libgpod HAL callout populates the files on these newer devices. See Filesystem Identity section for details.

**SCSI inquiry device boundary — RESOLVED.** Hardware-tested data from dstaley/ipod-sysinfo confirms: works on iPod 4G+, all minis, all nanos, all shuffles. Does NOT work on iPod 1G-3G. See SCSI Inquiry section for full table.

**USB inquiry device boundary — RESOLVED.** Hardware-tested data confirms: works on nano 3G+, Classic 6G, shuffle 3G-4G. Does NOT work on iPod 3G-5G, mini, nano 1G-2G, shuffle 1G-2G. For nano 5G-7G, USB returns extra fields not in SCSI. See USB Inquiry section for full table.

**Inquiry method selection — RESOLVED.** USB first, SCSI fallback. This matches libgpod's order and provides more complete data for newer devices. See Inquiry Method Selection section.

**iPod nano 7G — RESOLVED.** Uses standard iTunesCDB + SQLite databases with **hashAB** checksums (not 'none' as podkit currently states). Both SCSI and USB inquiry work. DBVersion 5, FamilyID 18, 8-byte FireWireGUID. libgpod doesn't work out of box (missing generation enum), but third-party tools (ipod_manager, iOpenPod) have working support. See nano 7G notes in Generation Table Audit section.

**Generation table audit — RESOLVED.** Two bugs found: B867 is a Shuffle 3G misclassified as nano 4G; iPod Touch 1G-3G checksum should be hash72 not none. Several missing model numbers identified. Artwork format tables for nano 4G use nano 1G/2G formats as fallback. See Generation Table Audit section.

## Generation Table Audit

Comparison of podkit's `ipod-models.ts` against libgpod's `itdb_device.c` and firmware-reported SysInfoExtended data. Conducted 2026-05-02.

### Bugs

| Severity | Issue | Location |
|----------|-------|----------|
| **High** | B867 classified as `nano_4g` — should be `shuffle_3g` (4GB Silver Shuffle 3rd Gen) | ipod-models.ts ~line 815 |
| **High** | iPod Touch 1G-3G `checksumType: 'none'` — should be `hash72` (libgpod confirms `CHECKSUM_HASH72`) | ipod-models.ts ~lines 129-131 |
| **High** | iPod nano 7G `checksumType: 'none'` — should be `hashAB` (DBVersion 5, confirmed by dstaley/hashab and ipod_manager) | ipod-models.ts line 108 |

### Missing model numbers

| Model | Device | Source |
|-------|--------|--------|
| A452 | iPod Video U2 30GB (5th Gen) | libgpod itdb_device.c |
| C043 | iPod nano 8GB Yellow (5th Gen) | libgpod itdb_device.c |
| B533 | iPod touch 2G 32GB | libgpod itdb_device.c |
| E436 | HP iPod 40GB (4th Gen) | libgpod itdb_device.c |

### Artwork format discrepancies

**Nano 4G:** podkit's `IPOD_ARTWORK_FORMATS.nano` uses nano 1G/2G formats (42x42, 100x100). The nano 4G firmware reports different formats: 128x128, 240x240, 80x80, 50x50. libgpod has separate `ipod_nano4g_cover_art_info` with the correct formats. podkit relies on libgpod for actual format selection at sync time, so this is an informational discrepancy in the fallback tables, not a sync-time bug.

**Video transcoding:** Nano 4G firmware reports H.264 Baseline L3.0 at max 720x480 / 10Mbps. podkit's nano video profile caps at 320x240 / 768kbps. This is a deliberate match-to-screen-resolution choice but means quality loss when playing via TV-out.

### Checksum types for test devices (all verified)

| Device | podkit | libgpod | Match? |
|--------|--------|---------|--------|
| nano 2G | none | CHECKSUM_NONE | Yes |
| nano 4G | hash58 | CHECKSUM_HASH58 | Yes |
| nano 7G | none | N/A (post-libgpod) | **No** — should be hashAB (DBVersion 5) |
| mini 2G | none | CHECKSUM_NONE | Yes |
| iPod 5G | none | CHECKSUM_NONE | Yes |

## Open Questions

### For the living document (no immediate action planned)

**Rockbox device compatibility.**
Rockbox replaces the iPod firmware entirely, which could affect whether SCSI and USB inquiry return data (or return different data). Rockbox devices should be tested across generations to understand the impact on identification strategies. No Rockbox port exists for nano 7G.

**macOS plist cache as a fallback.**
`~/Library/Preferences/com.apple.iPod.plist` caches device identity from previous connections. It contains a subset of SysInfoExtended (serial, FamilyID, firmware version — but no artwork specs or codec details). Whether this is worth implementing depends on whether there's a use case for identifying a device that was previously connected but isn't currently. Direct SCSI inquiry covers the connected-device case.

**macOS iPodDriver.kext longevity.**
The iPod SCSI driver (`com.apple.driver.iPodSBCDriver`, version 1.7.0, copyright 2001-2012) is still shipped in macOS 15 as a kernel extension. Apple has been migrating from kexts to DriverKit extensions. If the kext is removed in a future macOS, the IOKit SCSI inquiry path would break. The heuristic (`test -d /System/Library/Extensions/iPodDriver.kext`) would correctly detect this.

**iPod 1G-2G inquiry support.**
These FireWire-era devices are untested for both SCSI and USB inquiry. Given that the iPod 3G (the first USB-primary model) supports neither method, 1G-2G likely also lack support. Low priority — these devices use no checksums and have minimal capability requirements.

**Nano 6G vs 7G.**
Both use DBVersion 5, SQLiteDB, hashAB checksums, and 8-byte FireWireGUIDs. The nano 6G is currently unsupported with reason "different database format" — but the research suggests the format is actually the same as the 7G (iTunesCDB + SQLite). The difference may be more about the hashAB implementation and 8-byte UUID handling than the database structure itself. Worth investigating whether nano 6G support is feasible with the same approach as nano 7G.

### For milestone tasks (actionable work)

**Implement SCSI inquiry in podkit.**
The macOS IOKit approach is prototyped and verified. Linux SG_IO is understood. The implementation question is where this code lives — in the native C++ binding alongside libusb code, as a separate native module, or as platform-specific TypeScript using FFI. This needs an architecture decision.

**Add device inquiry checks to `podkit doctor`.**
Report which inquiry methods are available on the current system. Check for iPodDriver.kext on macOS. Verify libusb availability. Warn if no active inquiry method is available for the connected device.

**Systematic testing with real iPod collection.**
Document the available test devices with generation, model, serial, and which codepaths they exercise. Identify gaps in generation coverage. Build a test matrix of device x inquiry method x platform. Consider capturing SysInfoExtended XML from each device as test fixtures.

**Device capability architecture.**
Design the interface between hardcoded generation knowledge (checksum type, display names) and firmware-reported capabilities (artwork formats, codecs). This should be clean, composable code — not generation tables with firmware data bolted on. Consider a layered model: generation tables provide the base, firmware data overrides where available.

**Offline capability caching.**
Determine what needs to be cached for offline operations like pre-transcoding. Options: cache just the generation ID (derive from tables), cache SysInfoExtended XML (derive from firmware), or cache a normalised capability structure. This interacts with how device configuration is stored.

**VM and USB gadget testing.**
The virtual iPod system (Lima VM + USB gadget) could be extended to test device identification codepaths. A mocked USB gadget could respond to SCSI inquiry and USB vendor transfers with known SysInfoExtended XML, enabling automated testing without real hardware.

**UX for device identification failures.**
When podkit cannot fully identify a device, the user experience should be clear: what was detected, what's missing, what the impact is, and how to resolve it. The current "Could not read device identity from USB" error (now improved with specific error messages) is one example. The broader UX for degraded identification needs design.

**Update documentation site with real device testing data.**
Once systematic testing is complete, the public docs should include verified device compatibility information — which iPod models work with podkit, what identification methods were tested, and any known limitations.
