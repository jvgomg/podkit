# Test Device Inventory

Hardware devices available for testing podkit's device identification and sync functionality. This document is updated as devices are tested and new data is captured.

Last updated: 2026-05-23 (TASK-324 Phase 5 AC #1, #5, #6 — two state-variant personas added: `ipod-video-5g-corrupt-db`, `echo-mini-populated`; four Sony NW personas swept to canonical `'unsupported'` readiness shape; physical inventory unchanged)

## Synthesised personas (no hardware)

In addition to the hardware-captured personas documented below, five
synthesised personas live in `test-packages/device-testing/src/personas/` and
exercise paths that cannot be tested from physical inventory alone:

| Persona ID | Created | Purpose |
|------------|---------|---------|
| `ipod-shuffle-not-supported` | 2026-05-15 | Apple unsupported-PID rejection (shuffle 3G `0x05ac:0x1302`). User does not own a shuffle — pure synthesis from `packages/devices-ipod/src/tables/unsupported.ts`. |
| `non-ipod-usb-disk` | 2026-05-15 | Non-Apple vendor-no-preset rejection (SanDisk Cruzer Blade `0x0781:0x5567`). Pairs with the SanDisk entry added to `UNSUPPORTED_VENDORS` in `packages/devices-mass-storage/src/unsupported.ts`. |
| `malformed-sysinfo` | 2026-05-15 | SIE-parser error path. Real iPod 5G Video USB identity + deliberately-truncated SIE XML (`head -c 500` of the iPod 5G fixture). |
| `ipod-video-5g-corrupt-db` | 2026-05-23 | iTunesDB parser error path. Same USB identity + SIE XML as `ipod-video-5g-iflash-1tb`; FAT32 backing seeded with a 512-byte truncated iTunesDB (`mhbd` magic + zeros, `headerLen = 0`). `parseDatabase` throws "mhbd header too small". |
| `echo-mini-populated` | 2026-05-23 | Echo Mini in populated state. Same USB identity as `echo-mini`; FAT32 backing seeded with 5 synthetic `track-0N.mp3` files (64-byte `0xAA` blobs) in `Music/`. Exercises sync-target detection on a device with existing content. |

Each persona has a `provenance.md` documenting its synthesis recipe. See
the `Source: synthesised (no hardware)` header on those files.

## Device Collection

### iPod nano 2nd Generation (4GB Green)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | PARTY IPOD | Filesystem |
| USB Product ID | `0x1205` | USB enumeration |
| Generation | nano_2g | ipod-models.ts lookup |
| Model number | A487 | Serial suffix lookup (VQH) |
| Display name | iPod nano 4GB Green (2nd Generation) | Serial suffix lookup |
| Capacity | 4 GB | USB enumeration / diskutil |
| Checksum type | none | Generation table |
| FireWire GUID | `000A27001A0647CB` | USB serial descriptor |
| Apple serial | `YM7275YSVQH` | SCSI inquiry |
| FamilyID | 9 | SCSI inquiry |
| Firmware | 1.1.3 | SCSI inquiry |
| Volume format | FAT32 | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-02):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor |
| Filesystem identity | Degraded | SysInfo exists but is 0 bytes (post-2006 device). SysInfoExtended absent. |
| SCSI inquiry | Works | 26 VPD subpages, 6,280 bytes XML. Full identity + capabilities. |
| USB inquiry | Fails | Device does not respond to vendor control transfer. |
| libgpod identification | Fails | Reports "Invalid" — no SysInfo or SysInfoExtended to read. |

**SysInfoExtended highlights:** Audio codecs (AAC, MP3, ALAC, AIFF, WAV). Artwork: 176x132 (format 1023), 41x37 (format 1032). Album art: 42x42 (format 1031), 100x100 (format 1027). No video codec support. 32MB RAM.

**XML capture:** `documents/sysinfo-captures/nano-2g-4gb-green.xml`

---

### iPod nano 3rd Generation (8GB Black)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | IPOD | Filesystem |
| USB Product ID | `0x1262` | USB enumeration |
| Generation | nano_3g | ipod-models.ts lookup |
| Apple serial | `XXXXXXXXEED6` | SysInfoExtended |
| FireWire GUID | `000A27001BC8EED6` | USB serial descriptor |
| FamilyID | unknown — not yet recorded from SysInfoExtended | SysInfoExtended |
| Volume format | FAT32 | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-09):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor |
| Filesystem identity | Partial | SysInfo is 0 bytes (post-2006); SysInfoExtended initially absent — written via repair. |
| SCSI inquiry | Not tested separately | USB success short-circuited the cascade. |
| USB inquiry | **Works** | 12,131 bytes XML. **No per-read crypto blob** — content byte-stable across reads. |
| libgpod identification | N/A | Cascade now derives identity from firmware inquiry, not libgpod. |

**KEY FINDING — USB inquiry boundary:** nano 3G supports USB inquiry. This refines the prior research summary ("USB preferred for 5G+") — pre-5G iPod 5G fails, but nano 3G (post-iPod 5G) succeeds. The boundary is between iPod 5G and nano 3G, not between iPod 5G and nano 4G.

**SysInfoExtended highlights:** Audio + video codec support. Artwork formats 1055/1060/1061. ~63% the size of nano 4G's SIE (12,131 vs 14,297 bytes).

**XML capture:** `documents/sysinfo-captures/nano-3g-8gb-black.xml`

**Repair timing:** ~2.28s wall-clock (single run, name-mode). USB success path. Note: comparable wall-clock to SCSI-fallback iPods (~2.3s) — name-mode `findIpodDevices` discovery dominates the timing, not the firmware transport.

---

### iPod nano 4th Generation (8GB Black)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | James' iPod | Filesystem |
| USB Product ID | `0x1263` | USB enumeration |
| Generation | nano_4g | ipod-models.ts lookup |
| Model number | B754 | SysInfoExtended / libgpod |
| Display name | iPod nano 8GB Black (4th Generation) | Serial suffix lookup (3R0) |
| Capacity | 8 GB | USB enumeration / diskutil |
| Checksum type | hash58 | Generation table |
| FireWire GUID | `000A27001DCECFB5` | USB serial descriptor |
| Apple serial | `5U851AEH3R0` | SCSI inquiry |
| FamilyID | 15 | SCSI inquiry |
| Firmware | 1.0.4 | SCSI inquiry |
| Volume format | HFS+ (Journaled) | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-02):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor |
| Filesystem identity | Works | SysInfo is 0 bytes (post-2006), but SysInfoExtended present (14,297 bytes, from previous repair). |
| SCSI inquiry | Works | 58 VPD subpages, 14,296 bytes XML. |
| USB inquiry | Works | 14,297 bytes XML. Content identical to SCSI except volume format ("Unknown") and a per-read cryptographic blob. |
| libgpod identification | Works | Correctly identifies as nano_4, model B754, Nano (Black) via SysInfoExtended. |

**Model lookup consistency:** All three lookup paths agree — USB (nano_4g), serial suffix (8GB Black, B754), SysInfo (8GB Black, B754).

**SysInfoExtended highlights:** Audio codecs (AAC, MP3, ALAC, AIFF, WAV). Video codecs (H.264 Baseline L3.0, MPEG-4, H.264LC — max 720x480). Artwork: 320x240, 240x320, 640x480 (JPEG), 80x80, 64x64. Album art: 128x128, 80x80, 240x240, 50x50. Genius support. Games (Klondike, Maze, Vortex). 32MB RAM. Max 65,534 tracks. Sparse artwork support.

**XML capture:** `documents/sysinfo-captures/nano-4g-8gb-black.xml`

---

### iPod nano 7th Generation (16GB)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | IPOD | Filesystem |
| USB Product ID | `0x1267` | USB enumeration |
| Generation | nano_7g | ipod-models.ts lookup |
| Model number | unknown | Serial suffix `FJQ1` not in lookup table |
| Display name | iPod nano 16GB Space Gray (7th Generation) | Serial suffix lookup (JQ1 → E971) |
| Capacity | 16 GB | USB enumeration / diskutil |
| Checksum type | hashAB | Generation table (corrected this session) |
| FireWire GUID | `000A270024A23E9E` | USB serial descriptor |
| Apple serial | `DCYN72R8FJQ1` | SCSI inquiry |
| FamilyID | 18 | SCSI inquiry |
| DBVersion | 5 | SCSI inquiry |
| SQLiteDB | true | SCSI inquiry |
| Firmware | 1.0.4 (build 37A40005) | SCSI inquiry |
| Volume format | FAT32 | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-02):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor |
| Filesystem identity | Fails | No SysInfo file at all. No SysInfoExtended. |
| SCSI inquiry | Works | 14 VPD subpages, 3,330 bytes XML. Core identity only. |
| USB inquiry | Works | **47,100 bytes XML** — 14x more data than SCSI. Includes codecs, artwork, SQLite schema commands. |
| libgpod identification | Fails | Reports "Invalid" — no filesystem identity, unknown generation enum. |

**SCSI vs USB difference:** Dramatic on this device. SCSI returns 69 keys (identity, basic features). USB returns 288 keys — 219 extra including AudioCodecs, VideoCodecs, AlbumArt, ImageSpecifications, SQLCommands (full SQLite schema for iTunesDB), Genius support, Bluetooth, Pedometer, Nike VoiceKit, subtitle/accessibility support.

**Notes:** Post-libgpod generation. Serial suffix FJQ1 not in podkit's serial-to-model table — nano 7G models are likely missing from the serial suffix mapping. Bluetooth directory present in Device folder. 64MB RAM (double the nano 4G).

**XML captures:** `documents/sysinfo-captures/nano-7g-16gb-scsi.xml`, `documents/sysinfo-captures/nano-7g-16gb-usb.xml`

---

### iPod nano 7th Generation #2 (16GB Blue)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | iPod (lowercase) | Filesystem |
| USB Product ID | `0x1267` | USB enumeration |
| Generation | nano_7g | ipod-models.ts lookup |
| Model number | D477 | Serial suffix lookup (0GP — added this session) |
| Display name | iPod nano 16GB Blue (7th Generation) | Serial suffix lookup |
| Capacity | 16 GB | USB enumeration / diskutil |
| Checksum type | hashAB | Generation table |
| FireWire GUID | `000A270024565D97` | USB serial descriptor |
| Apple serial | `DCYL44J8F0GP` | SysInfoExtended (firmware inquiry) |
| FamilyID | 18 | SysInfoExtended |
| Volume format | **HFS+** (Journaled) | Filesystem (different from #1's FAT32) |
| Modifications | None | |

**Inquiry results (tested 2026-05-09):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor |
| Filesystem identity | Fails | No SysInfo, no SysInfoExtended on disk in fresh state. |
| SCSI inquiry | Not tested (USB short-circuit) | |
| USB inquiry | **Works** | 47,000 bytes XML — same payload size as nano 7G #1. |
| `device add` | **Refused** | New safety gate refuses unsupported generations (hashAB). User direction: should warn-but-allow (queued as backlog). |
| `doctor --repair sysinfo-extended` | Fails on fresh device | "Failed to open database: Couldn't find an iPod database" — chicken-and-egg gating. Worked around via direct firmware probe. |

**Serial-suffix lookup table addition (this session):** `0GP: 'D477'` added to `tables/serials.ts`. Variant resolved as "iPod nano 16GB Blue (7th Generation)".

**Diff vs nano 7G #1 (Space Gray):** Per-read crypto blob, FireWireGUID, Apple serial, volume format (HFS+ vs FAT32). Otherwise content-identical — confirms nano 7G data structure consistency across units.

**XML capture:** `documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml`

---

### FiiO Snowsky Echo Mini (mass-storage DAP)

Not an iPod, but in the inventory because it exercises podkit's mass-storage preset framework — the user-extensible device-type path alongside iPod.

| Field | Value | Source |
|-------|-------|--------|
| Volume name(s) | `ECHO MINI` (firmware partition, empty) + `Echo SD` (126 GB SD card) | Filesystem |
| USB Product ID | `0x3203` | USB enumeration |
| USB Vendor ID | `0x071b` | USB enumeration |
| USB Manufacturer | `ECHO MINI` | USB descriptor |
| USB Serial | `USBV1.00` (generic — shared across all units) | USB descriptor |
| Preset id | `echo-mini` | `packages/devices-mass-storage/src/presets/built-in.ts` |
| Capacity | 126.42 GB SD card (varies by inserted card) | Filesystem |
| Volume format | ExFAT (SD card) | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-09):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Vendor + product matches `usb-hints.ts` entry → preset auto-detect resolves to `echo-mini`. |
| Filesystem identity | n/a | Mass-storage devices have no SysInfo / SysInfoExtended files. |
| SCSI / USB inquiry | n/a | Identity comes from the preset, not firmware. |
| `device add` (auto-detect) | Partial | `device add -d <name>` (no `--type`) detects the device and SUGGESTS the explicit form — does not auto-fill. Has small UX bugs (see TASK-317.03 follow-up notes). |
| `device add --type echo-mini --path` | Works | Adds device cleanly with preset capabilities. |
| `doctor` | Works (with caveats) | All checks pass, but the output structure miscategorizes system-scope checks as device-scope (TASK-317.08). |
| `sync --dry-run` | Works | Cleanest sync output of any device tested — respects preset (`Clean artists: skipped (device supports Album Artist browsing)`, `Skipping video: device does not support video playback`). |

**Preset capabilities (built-in `echo-mini`):**

```ts
{
  artworkSources: ['embedded'],
  artworkMaxResolution: 127,
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav'],
  supportsVideo: false,
  audioNormalization: 'none',
  supportsAlbumArtistBrowsing: true,
  contentPaths: { musicDir: '', moviesDir: 'Video/Movies', tvShowsDir: 'Video/Shows' },
}
```

**Notable observations:**

- Two mountable volumes from a single physical device. Only `/Volumes/Echo SD` is the sync target; `/Volumes/ECHO MINI` is the firmware partition. The wizard work in TASK-262 should surface both volumes to the user.
- USB serial is generic (`USBV1.00`) — cannot be used to disambiguate between physically distinct Echo Mini units. Volume UUID per filesystem must be the matching key for "is this the same device I added before?".
- The `Type: Echo Mini` line in `device info` will become `FiiO Snowsky Echo Mini (echo-mini)` once TASK-317.07 lands.

**No XML capture** — mass-storage devices have no SysInfoExtended.

---

### iPod touch 5th Generation (iOS)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | (none — iOS does not expose mass storage) | n/a |
| USB Product ID | `0x12aa` | USB enumeration |
| Generation | iPod touch 5th generation | unsupported.ts lookup |
| Apple serial | `637fea3cca37ff292e9cd4b26b1d411dfce06fd8` | USB serial descriptor (iOS UDID format, 40-char hex) |
| Capacity | (not reported via mass storage) | |
| Volume format | n/a | |
| Modifications | None | |

**Inquiry results (tested 2026-05-09):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, vendor, UDID-style serial |
| Filesystem identity | n/a | iOS does not expose mass storage; no `/Volumes/` mount |
| SCSI inquiry | n/a | |
| USB inquiry | n/a — device is iOS, not classic iPod | |
| `device scan` | Detects + correctly labels as unsupported | Reason: "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode." |
| `device add` | **Fails generically** | Output: "No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path." `device add` is disk-scan-based; iOS device never reaches the unsupported-PID gate. The friendly explanation visible in `device scan` never surfaces here. |

**UX observations:**

- Unsupported-device messaging itself is well-worded (avoids implementation jargon).
- BUT the message only appears via `device scan`, not `device add` — most users running `device add` first get a confusing generic error.
- Even in `device scan`, the entry is headed "Unknown iPod (USB only)" despite podkit having the data to display "iPod touch (5th generation)" in the header.
- These reinforce the planned unsupported-device UX redesign (backlog).

**No XML capture** — iOS does not expose SysInfoExtended.

---

### iPod mini 2nd Generation (4GB Pink)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | SALLYS IPOD | Filesystem |
| USB Product ID | `0x1205` | USB enumeration |
| Generation | mini_2g | SysInfo ModelNumStr lookup |
| Model number | 9804 | SysInfo (P9804) |
| Display name | iPod mini 4GB Pink (2nd Generation) | SysInfo lookup |
| Capacity | 4 GB | SysInfo |
| Checksum type | none | Generation table |
| FireWire GUID | `000A270014198517` | USB serial descriptor / SysInfo |
| Apple serial | `JQ5141TFS4G` | SysInfo (pszSerialNumber) |
| FamilyID | 3 | SCSI inquiry |
| Firmware | 1.3 (build 2.5) | SysInfo |
| Volume format | FAT32 | Filesystem |
| Modifications | None | |

**Inquiry results (tested 2026-05-02):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor. **Bug: 0x1205 maps to nano_1g, not mini.** |
| Filesystem identity | Works | SysInfo fully populated (pre-2006 device). No SysInfoExtended on disk. |
| SCSI inquiry | Works | 10 VPD subpages, 2,413 bytes XML. Smallest capture — no artwork, no video. |
| USB inquiry | Fails | Device does not respond to vendor control transfer. |
| libgpod identification | Works | Correctly identifies via SysInfo as mini_2, model 9804, Mini (Pink). |

**Pre-2006 SysInfo confirmation:** This device has a fully populated SysInfo written by the firmware — ModelNumStr, serial, FireWireGuid, board name, firmware versions, family ID. Confirms the mid-2006 cutoff research.

**USB product ID bug:** `0x1205` is mapped to `nano_1g` in podkit's USB product ID table, but this device is a mini 2G. The product ID may be shared between mini 2G and nano 1G, or the table entry is simply wrong. system_profiler reports the device name as "iPod mini". This needs investigation.

**Serial suffix not in table:** `S4G` — the mini predates the serial-to-model mapping system used by later iPods.

**XML capture:** `documents/sysinfo-captures/mini-2g.xml`

---

### iPod 5th Generation Video (iFlash 1TB mod)

| Field | Value | Source |
|-------|-------|--------|
| Volume name | TERAPOD | Filesystem |
| USB Product ID | `0x1209` | USB enumeration |
| Generation | video_5_5g | Serial suffix lookup (V9M) |
| Model number | A446 | Serial suffix lookup |
| Display name | iPod Video 30GB Black (5.5th Generation) | Serial suffix lookup |
| Capacity | 1 TB (iFlash mod) / originally 30 GB | USB enumeration vs serial lookup |
| Checksum type | none | Generation table |
| FireWire GUID | `000A27001605D1A0` | USB serial descriptor |
| Apple serial | `9C642MEFV9M` | SCSI inquiry |
| FamilyID | 6 | SCSI inquiry |
| Firmware | 1.3 (build 6.3) | SCSI inquiry |
| Volume format | FAT32 | Filesystem |
| Mount point | `/private/tmp/podkit-TERAPOD` | Manual mount required |
| Modifications | iFlash adapter replacing original HDD with 1TB flash storage |

**Inquiry results (tested 2026-05-02):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Product ID, serial, vendor. |
| Filesystem identity | Partial | SysInfo has `ModelNumStr: MA147` (may be manually written, conflicts with serial). No SysInfoExtended. |
| SCSI inquiry | Works | 40 VPD subpages, 9,693 bytes XML. Full identity + video codecs. |
| USB inquiry | Fails | Device does not respond to vendor control transfer. Consistent with research (iPod 5G not supported). |
| libgpod identification | Works | Identifies via SysInfo as video_1, model A147, Video (Black). |

**Identity discrepancy across sources:**

| Source | Generation | Model | Capacity |
|--------|-----------|-------|----------|
| USB product ID (0x1209) | classic_6g | — | — |
| Serial suffix (V9M) | video_5_5g | A446 | 30GB |
| SysInfo ModelNumStr (MA147) | video_5g | A147 | 60GB |
| Firmware (SCSI) | — | — | — |

The USB product ID 0x1209 is shared across Video 5G, 5.5G, and Classic 6G — podkit maps it to classic_6g which is wrong for this device. The SysInfo says MA147 (Video 60GB 5th Gen) but the serial identifies it as a 30GB 5.5G — the SysInfo was likely written manually or by a previous tool with incorrect data. The serial number from firmware is the most trustworthy source.

**iFlash mod impact:** SCSI inquiry works perfectly — reads from iPod firmware, unaffected by storage replacement. The 1TB iFlash capacity is visible to the OS but not reflected in firmware identity.

**Video codecs from firmware:** H.264 Baseline L1.3 (peak 768kbps, max resolution 76800 pixels ≈ 320x240), H.264LC Baseline L3.0 (max 640x480), MPEG-4 (max 2500kbps). Album art: 100x100 (format 1028), 200x200 (format 1029) — matches podkit's `IPOD_ARTWORK_FORMATS.video` exactly.

**XML capture:** `documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml`

---

### Sony Walkman NWZ-E384 (8GB)

Non-iPod, non-Echo. Added 2026-05-13 as a candidate device for the mass-storage preset framework (no podkit preset registered yet). Full device profile + format/feature analysis in [`devices/sony-walkman-nwz-e380.md`](../devices/sony-walkman-nwz-e380.md).

| Field | Value | Source |
|-------|-------|--------|
| Volume name | WALKMAN | Filesystem |
| USB Vendor ID | `0x054c` | USB enumeration (Sony Corporation) |
| USB Product ID | `0x0882` | USB enumeration |
| USB Vendor Name (descriptor) | `SONY` | ioreg `USB Vendor Name` |
| USB Product Name (descriptor) | `WALKMAN` | ioreg `USB Product Name` |
| Series | NWZ-E380 Series (E383 / E384 / E385) | `/capability_00.xml` `<Model>` |
| Model | NWZ-E384 | Manufacturer marking + 8 GB SKU |
| Marketing name | WALKMAN NWZ-E380 Series | `/default-capability.xml` `<marketingname>` |
| Firmware version | 1.00 (PROD.1.00.2000) | `/DeviceInfo.txt` + `/default-capability.xml` |
| USB Serial Number | `10431991572055` | ioreg (real per-unit serial) |
| Capacity | 7.71 GB (7,713,849,344 bytes) | Filesystem |
| Volume format | FAT32 | Filesystem |
| Partition scheme | MBR (2048-byte sectors) | fdisk |
| Display | 160×128 px | `/capability_00.xml` `<Display>` |
| Sync transport | USB Mass Storage (also MTP-capable per XML) | macOS mounts as mass storage |
| Modifications | None | |

**Inquiry results (tested 2026-05-13):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Vendor + product matches Sony; no `usb-hints.ts` entry → no preset auto-detect. |
| Filesystem identity | Works | Authoritative signal is `/capability_00.xml` `<Model>NWZ-E380 Series</Model>` + `.E380` marker files in every content directory. |
| SCSI / USB inquiry | n/a | Not an iPod; no SysInfoExtended. |
| `device add` | **Unsupported today** | No Sony preset in `packages/devices-mass-storage/src/presets/built-in.ts`. Would need: usb-hints entry + preset definition. |

**Content database:** Sony's binary `STDB*` format —

- `STDBDATA.DAT` (4 MiB pre-allocated) + `STDBDATA.IDX` — record store + index
- `STDBSTR.DAT` (4 MiB pre-allocated) + `STDBSTR.IDX` — string heap + index
- High-entropy bytes after a short header in `STDBSTR.DAT` — may be obfuscated/compressed. Format is undocumented; the device rebuilds the DB on every unplug, so writing the DB is not required for sync.

**Supported audio formats (per `/capability_00.xml` + `/default-capability.xml`):**

| Codec | Container | Extension | Status |
|-------|-----------|-----------|--------|
| MP3 | — | `.mp3` | Preferred |
| AAC | MP4 | `.mp4`, `.m4a` | Supported |
| WMA | WMV | `.wma` | Supported (WMDRM-capable) |
| WAV | — | `.wav` | Supported (PCM) |
| 3GPP | — | `.3gp` | Supported (per default-capability.xml only) |

No FLAC / ALAC / Vorbis / Opus support — predates Sony's lossless adoption on the entry Walkmans.

**Supported video formats:** WMV (VC1MP + VC1SP codecs), 160×128 max, 30 fps max, 768 kbps video / 256 kbps audio.

**Filesystem layout (per `/capability_00.xml` `<FileSystem>` paths):**

| Content type | Path | Depth |
|--------------|------|-------|
| camera       | `\DCIM\`    | 6 |
| image        | `\PICTURE\` | 6 |
| video        | `\VIDEO\`   | 6 |
| sound        | `\MUSIC\`   | 7 |

`PICTURES/` (plural) also exists with a `.E380` marker but is not declared in `<FileSystem>` — likely a Sony PC-app convention; use `PICTURE/`.

**Persona capture:** `test-packages/device-testing/src/personas/sony-nwz-e384/` (Mac session complete; Linux capture deferred — pattern confirmed by sibling personas this session).

**Implementation notes (for future Sony preset work):** see `devices/sony-walkman-nwz-e380.md` § "Implementation Notes" — proposed `sony-walkman-e380` preset, marker-file preservation, capability-XML reconciliation.

---

### Sony Walkman NW-A1000 (6GB HDD)

Heritage SonicStage-era HDD Walkman (2005). Added 2026-05-13 to catalog the OpenMG/ATRAC content-layer constraints. Full device profile in [`devices/sony-walkman-nw-a-series.md`](../devices/sony-walkman-nw-a-series.md).

| Field | Value | Source |
|-------|-------|--------|
| Volume name | NO NAME (FAT32 default — not rebranded) | Filesystem |
| USB Vendor ID | `0x054c` | USB enumeration (Sony Corporation) |
| USB Product ID | `0x026a` | USB enumeration |
| USB Vendor Name (descriptor) | `Sony` (mixed case) | ioreg |
| USB Product Name (descriptor) | `HDD WALKMAN` | ioreg |
| USB Serial Number | **none — `iSerialNumber = 0`** | ioreg (pre-NWZ Sony pattern) |
| Volume UUID | `9AED81A8-CDE2-3ED2-B01E-1E0FEB8898B9` | diskutil |
| Series | NW-A HDD generation (A1000 / A1100 / A1200 / A3000) | community |
| Model | NW-A1000 | manufacturer marking |
| Firmware version | 1.00 (bcdDevice 0x0100) | ioreg |
| Capacity | 5.98 GB (5,982,523,904 bytes) | Filesystem |
| Volume format | FAT32-LBA (MBR partition type `0x0C`) | fdisk |
| Partition scheme | MBR (512-byte sectors) | fdisk |
| Storage medium | spinning HDD | manufacturer spec |
| Sync transport | USB Mass Storage (content layer requires SonicStage) | macOS mount |
| Modifications | None | |

**Inquiry results (tested 2026-05-13):**

| Method | Result | Notes |
|--------|--------|-------|
| USB enumeration | Works | Vendor + product; **no serial** in descriptor. |
| Filesystem identity | Works | Definitive signal is presence of `/OMGAUDIO/` + OpenMG database magic bytes (`GTLT` / `GTIF` / `GPIF` / `CNIF` / `GTCL`). |
| SCSI / USB inquiry | n/a | Not an iPod. |
| `device add` | **Unsupported today** | No preset; content layer requires OpenMG/ATRAC authoring (SonicStage). |

**OpenMG database files (magic bytes captured in persona `raw/headers-omgaudio-dat.hex`):**

| File | Magic | Purpose |
|------|-------|---------|
| `00GTRLST.DAT` | `GTLT` | Group/track list (master index) |
| `01TREE*.DAT` (37 files) | `GTFB` chunks | Browse-tree structure |
| `02TREINF.DAT` | `GTIF` | Tree info |
| `03GINF*.DAT` (37 files) | `GPIF` | Group info |
| `04CNTINF.DAT` (972 KiB) | `CNIF` | Canonical content table |
| `05CIDLST.DAT` | — | Content-ID list |
| `07GTCHLG.DAT` | `GTCL` | DRM challenge log |
| `A_WM/*.DAT` | — | Walkman-specific extensions (artist link, user event log, etc.) |
| `CONNECT/*.DAT` | — | SonicStage CONNECT remnants |
| `10F00/…/10F05/*.OMA` | `ea3` v3 | EA3-wrapped ATRAC3plus audio (DRM-bound) |

**Supported audio formats:** ATRAC3 (66/105/132 kbps), ATRAC3plus (48–320 kbps), PCM-WAV, **MP3-in-EA3-wrapper only** (plain MP3 is not indexed without SonicStage re-wrapping).

**Critical limitation:** Stock firmware accepts content only via SonicStage (Windows, discontinued 2008). Files dropped into `OMGAUDIO/` without matching database entries are invisible to the device's library. Firmware v2.0+ adds a "USB Mass Storage Mode" toggle for folder-only MP3 browsing — **the unit captured here is v1.00 (no MSM mode)**.

**Persona capture:** `test-packages/device-testing/src/personas/sony-nw-a1000/` (Mac session complete; Linux capture deferred — pattern confirmed by sibling personas this session). **Privacy note in provenance** — the captured database-file hexdumps include user music metadata in cleartext UTF-16LE; review before committing to a public branch.

**Implementation notes (three viable paths):** detect-and-reject with friendly SonicStage warning / MSM-mode preset (requires firmware v2.0+) / full OpenMG writer (out of scope). See `devices/sony-walkman-nw-a-series.md` § "Implementation Notes".

---

### Sony Walkman NW-A3000 (20GB HDD)

Sibling of NW-A1000 in the SonicStage-era HDD Walkman line. Added 2026-05-13. Same family profile applies — see [`devices/sony-walkman-nw-a-series.md`](../devices/sony-walkman-nw-a-series.md). This entry captures the **per-model deltas** vs NW-A1000.

| Field | NW-A1000 | NW-A3000 | Source |
|-------|----------|----------|--------|
| Volume name | NO NAME | NO NAME | Filesystem |
| USB Vendor ID | `0x054c` | `0x054c` | ioreg |
| **USB Product ID** | **`0x026a`** | **`0x0269`** | ioreg — distinct per model |
| USB descriptor strings | `Sony` / `HDD WALKMAN` | `Sony` / `HDD WALKMAN` | ioreg |
| USB Serial Number | none (`iSerialNumber = 0`) | none (`iSerialNumber = 0`) | ioreg |
| Volume UUID | `9AED81A8-CDE2-3ED2-B01E-1E0FEB8898B9` | `3C8EA1A5-706B-351A-9415-160C9DA2948D` | diskutil |
| Firmware (bcdDevice) | `0x0100` (1.00) | `0x0100` (1.00) | ioreg |
| Capacity | 5.98 GB | 19.55 GB | diskutil |
| Partition scheme | MBR, FAT32-LBA (`0x0C`), 512 B sectors | same | fdisk |
| MBR padding | ~32 KiB | ~32 KiB | fdisk |
| **OpenMG DB version** | **v1.1** (`01 01 00 00`) | **v2.0** (`02 00 00 00`) | magic bytes at offset 4–7 of GTLT/GTIF/CNIF |
| EKB files (DRM keys) | none | `0001001D.DAT` (v29) + `00010021.DAT` (v33) | OMGAUDIO/ root |
| SRCIDLST | absent | `SRCIDLST.DAT` + `SRCIDLST.BAK` (32 KiB each) | OMGAUDIO/ root |
| `30GRCT/` directory | absent | present (empty here) | OMGAUDIO/ |
| `A_WM/ARDETECT.DAT` | absent | present (`MCKF` magic, factory 2006-01-28) | A_WM/ |
| Latest content mtime | 2008-04-24 | 2012-11-23 | filesystem |

**Critical correction landed this session:** the initial commit of `devices/sony-walkman-nw-a-series.md` assumed NW-A HDD models share PID `0x026a`. **They do not.** Each model has a distinct USB product ID. The device profile now lists per-model PIDs.

**New magic bytes documented (per `raw/headers-omgaudio-dat.hex`):**

| Magic | File(s) | Purpose |
|-------|---------|---------|
| `EKB ` (with trailing space) | `0001XXXX.DAT` (filename hex = EKB version) | Encrypted Key Block — OpenMG DRM key material |
| `MCKF` / `MCKB` chunks | `A_WM/ARDETECT.DAT`, `A_WM/C2DETECT.DAT` | DRM-handshake challenge records |
| (header `00 01 00 80 …`) | `SRCIDLST.DAT` + `.BAK` | Source ID List (content origin tracking) |

**Persona capture:** `test-packages/device-testing/src/personas/sony-nw-a3000/` (Mac session complete; Linux capture deferred — pattern confirmed by sibling personas this session). Privacy notice on captured database hexdumps inherits from `sony-nw-a1000`.

---

### Sony Walkman NW-A1200 (8GB HDD)

Third NW-A HDD unit. Added 2026-05-13. **Same hardware as NW-A1000 — only the HDD capacity differs.** All other table-level "differences" below are host-side state (which sync software last touched it, which Windows host indexed it), not hardware properties. See [`devices/sony-walkman-nw-a-series.md`](../devices/sony-walkman-nw-a-series.md) for the family profile.

| Field | NW-A1000 | NW-A1200 | NW-A3000 | Source |
|-------|----------|----------|----------|--------|
| **USB Product ID** | **`0x026a`** | **`0x026a` (shared with A1000)** | **`0x0269`** | ioreg |
| USB descriptor strings | `Sony` / `HDD WALKMAN` | same | same | ioreg |
| USB Serial | none | none | none | ioreg |
| Volume UUID | `9AED81A8-…` | `B0D74B8F-…` | `3C8EA1A5-…` | diskutil |
| Capacity | 5.98 GB | 7.84 GB (8 GB SKU) | 19.55 GB | diskutil |
| Firmware (bcdDevice) | 1.00 | 1.00 | 1.00 | ioreg |
| Partition (MBR/FAT32-LBA, 512 B sectors) | yes | yes | yes | fdisk |
| **OpenMG DB version** | **v1.1** | **v2.0** | **v2.0** | DAT-file version word |
| EKB files (`0001001D.DAT` / `00010021.DAT`) | absent | present (v29 + v33) | present (v29 + v33) | OMGAUDIO/ |
| `SRCIDLST.DAT` + `.BAK` | absent | present | present | OMGAUDIO/ |
| `30GRCT/` | absent | present (empty) | present (empty) | OMGAUDIO/ |
| `A_WM/ARDETECT.DAT` factory date | absent | **2005-12-31** | 2006-01-28 | filesystem mtime |
| `MEDIAGO/MediaGo.xml` | absent | **present** (Media Go marker) | absent | filesystem root |
| `System Volume Information/` | absent | **present** (Windows host artefact) | absent | filesystem root |
| Last DB rebuild mtime | 2008-04-24 | 2021-11-12 | 2010-11-23 (+ 2012 ACTIVITY) | filesystem mtime |
| Last-sync software (inferred) | SonicStage | **Media Go** | SonicStage | DB version + MEDIAGO/ presence |

**Refinements landed this session:**

- **NW-A1000 and NW-A1200 are the same hardware.** Confirmed firsthand: identical USB descriptors (vendor, product, firmware bcdDevice, descriptor strings), identical chassis, only HDD capacity differs (6 GB vs 8 GB). From a host-software perspective they're one device. A1200 needs no separate preset — whatever supports A1000 supports it.
- **NW-A3000 is a different hardware platform.** Distinct PID (`0x0269`); larger HDD; same OpenMG content layer.
- **DB version, `MEDIAGO/`, Windows artefacts are host-side state — not hardware.** A1200's v2.0 / MEDIAGO/ / System Volume Info reflect only that its host happened to be a Windows machine running Media Go through 2021. A1000's "absences" reflect only that its host stopped using it around 2008 with SonicStage 4.x. Either device could end up in either state after a sync.
- **`MEDIAGO/MediaGo.xml` documents Media Go's device-handshake schema** — useful as a Media-Go-touched-this-unit marker, but does not differentiate hardware.

**New magic bytes / artefacts** (per `raw/` captures): `MediaGo.xml` (XML, schema v1, Media Go classification), `IndexerVolumeGuid` (Windows binary GUID, 76 bytes), `WPSettings.dat` (Windows Properties, 12 bytes).

**Persona capture:** `test-packages/device-testing/src/personas/sony-nw-a1200/` (Mac session complete; Linux capture deferred — pattern confirmed by sibling personas this session). **Privacy notices in provenance** — captured `MediaGo.xml` contains a per-unit device UUID; review before public commit.

---

### Sony Walkman NW-HD5 (20GB HDD)

Sony's original "Network Walkman" line — predates the NW-A rebrand (2004–2005). Distinct product line from NW-A despite sharing the OpenMG content layer. Added 2026-05-13. Full device profile in [`devices/sony-walkman-nw-hd-series.md`](../devices/sony-walkman-nw-hd-series.md).

| Field | NW-HD5 | NW-A series (for contrast) | Source |
|-------|--------|----------------------------|--------|
| **USB Product Name** | **`ATRAC HDD`** | `HDD WALKMAN` | ioreg — definitive product-line marker |
| Media subtree `_name` | `ATRAC HDD PA` | `HDD WALKMAN` | system_profiler |
| **USB Product ID** | **`0x0233`** | `0x026a` / `0x0269` | ioreg |
| USB Vendor ID | `0x054c` | `0x054c` | ioreg |
| USB Serial | none | none | ioreg |
| Volume UUID | `A243C550-F56E-3048-BC31-1EA5D7939C71` | per-unit | diskutil |
| Capacity | 19.55 GB | varies | diskutil |
| Firmware (bcdDevice) | 1.00 | 1.00 | ioreg |
| Partition (MBR/FAT32-LBA, 512 B sectors) | yes | yes | fdisk |
| **`A_WM/` directory** | **absent** | present (Walkman extensions) | filesystem |
| **`CONNECT/` directory** | **absent** | present | filesystem |
| **`30GRCT/` directory** | **absent** | present on A1200/A3000 | filesystem |
| **`MEDIAGO/` directory** | **absent** | present on A1200 only | filesystem |
| **`MACLIST0.DAT` + `.BAK`** | **present (32 KiB each, encrypted)** | **absent** | filesystem |
| **`20PXX/` artwork folders** | **present (separate JPG files)** | **absent — NW-A embeds in EA3** | filesystem |
| `01TREE` numbering | `01–04, 0A, 0B–0F (.BAK), 10–14, 22` (16 trees) | `01–15, 22, 2D–37` (27 trees) | OMGAUDIO/ |
| `.BAK` tree backups | present (5 files) | absent | filesystem |
| OpenMG DB version | v1.1 | v1.1 or v2.0 | DAT version word |
| EKB files | only `00010021.DAT` (v33) | varies (v29 + v33 or none) | filesystem |
| Era | 2004–2005 (Network Walkman) | 2005–2008+ (Walkman rebrand) | manufacturer history |
| Last active sync | 2009-03-04 | varies | filesystem mtime |

**Generational difference vs NW-A:** SonicStage writes `20PXX/` directories of separate JPG album-artwork files for NW-HD (filename pattern `1G<6-hex-chars><suffix>.JPG`); NW-A abandoned this scheme. Note however that **none of the HDD-era Sony Walkmans (NW-HD, NW-A) render album art on the device — they all have monochrome displays**. The `20PXX/` JPGs are consumed only by SonicStage's PC-side UI. Only the later NWZ generation (colour LCD) renders artwork on-device. Implication for any future Sony preset / OpenMG writer: **skip artwork emission for NW-HD and NW-A entirely**.

**Additional DRM gate vs NW-A:** `MACLIST0.DAT` + `.BAK` carry per-track Message Authentication Codes — encrypted records (no plaintext magic) that DRM checks at playback. Modifying `.OMA` without updating the MAC will likely cause playback to fail. Not present on NW-A.

**Persona capture:** `test-packages/device-testing/src/personas/sony-nw-hd5/` (Mac session complete; Linux capture deferred — pattern confirmed by sibling personas this session).

**Implementation note:** same `detect-and-reject` recommendation as NW-A. USB hints entry would be `0x054c:0x0233 → 'sony-nw-hd-network-walkman'`. If support is ever attempted, NW-HD needs both the separate-JPG artwork emission and MACLIST0 generation on top of NW-A's OpenMG writer requirements — substantially harder than NW-A.

## Generation Coverage Analysis

### Checksum types

| Type | Devices in collection | Coverage |
|------|----------------------|----------|
| none | nano 2G, mini 2G, iPod 5.5G | 3 devices |
| hash58 | nano 4G | 1 device |
| hash72 | (none) | Gap — would need nano 5G |
| hashAB | nano 7G | 1 device (podkit hashAB support not yet implemented) |

### Inquiry method coverage (all confirmed)

| Method | Working | Failing |
|--------|---------|---------|
| SCSI inquiry | nano 2G, nano 4G, nano 7G, mini 2G, iPod 5.5G | (none in collection) |
| USB inquiry | **nano 3G**, nano 4G, nano 7G | nano 2G, mini 2G, iPod 5.5G |

SCSI inquiry works on all 6 supported devices. USB inquiry works on **nano 3G + nano 4G + nano 7G** and fails on the three older ones (nano 2G, mini 2G, iPod 5.5G). The boundary sits between iPod 5.5G (USB fails) and nano 3G (USB works) — refined this session from the prior assumption that USB started at nano 4G.

### USB product ID bugs discovered

| Product ID | podkit maps to | Actual device | Issue |
|-----------|---------------|---------------|-------|
| `0x1205` | nano_1g | iPod mini 2G | Wrong generation. May be shared ID or wrong table entry. |
| `0x1209` | classic_6g | iPod Video 5.5G | Shared across Video 5G, 5.5G, Classic 6G. Maps to wrong generation for this device. |

### Notable gaps

- **No hash72 device.** The nano 5G is the only generation using hash72 checksums.
- **No iPod Classic 6G.** Uses hash58 but is a distinct hardware platform.
- **No nano 1G.** Would test oldest nano SCSI support and resolve the 0x1205 product ID ambiguity.
- **No nano 6G.** Uses hashAB like nano 7G; useful for confirming pre-7G hashAB hardware.

### What the collection validated

- SCSI inquiry works across the full span: mini 2G (2005) through nano 7G (2012) — 7 years of hardware
- USB inquiry boundary refined this session: fails on mini 2G, nano 2G, iPod 5.5G; **works on nano 3G**, nano 4G, nano 7G. Boundary sits between iPod 5.5G and nano 3G.
- USB inquiry returns dramatically more data on nano 7G (14x more than SCSI) — confirms 5G+ extra fields research
- iFlash hardware modification does not affect firmware inquiry
- Pre-2006 vs post-2006 SysInfo behaviour confirmed: mini 2G has full SysInfo, all others have empty/absent
- Serial suffix lookup table extended this session: `S4G` → mini 2G 4GB Pink (`9804`); `0GP` → nano 7G 16GB Blue (`D477`). Coverage gaps remain for unmapped suffixes.
- Identity discrepancies exist when USB product IDs are shared across generations (0x1209 across 5G/5.5G/Classic 6G, 0x1205 between mini 2G and nano 1G)
- nano 7G's USB-derived SysInfoExtended is byte-stable across reads except for a per-read crypto blob; nano 3G's SIE has no crypto blob and is fully deterministic
- HFS+ vs FAT32 volume format does not affect firmware inquiry (validated across nano 4G HFS+ + nano 7G #2 HFS+ and nano 2G + nano 7G #1 + others on FAT32)
