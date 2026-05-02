# Test Device Inventory

Hardware iPods available for testing podkit's device identification and sync functionality. This document is updated as devices are tested and new data is captured.

Last updated: 2026-05-02 (all 5 devices inventoried)

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
| Model number | TBD | Serial suffix FJQ1 not in lookup table |
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
| USB inquiry | nano 4G, nano 7G | nano 2G, mini 2G, iPod 5.5G |

SCSI inquiry works on all 5 devices. USB inquiry works on the two newer devices (nano 4G, 7G) and fails on the three older ones.

### USB product ID bugs discovered

| Product ID | podkit maps to | Actual device | Issue |
|-----------|---------------|---------------|-------|
| `0x1205` | nano_1g | iPod mini 2G | Wrong generation. May be shared ID or wrong table entry. |
| `0x1209` | classic_6g | iPod Video 5.5G | Shared across Video 5G, 5.5G, Classic 6G. Maps to wrong generation for this device. |

### Notable gaps

- **No hash72 device.** The nano 5G is the only generation using hash72 checksums.
- **No iPod Classic 6G.** Uses hash58 but is a distinct hardware platform.
- **No nano 3G.** Would confirm USB inquiry lower boundary.
- **No nano 1G.** Would test oldest nano SCSI support and resolve the 0x1205 product ID ambiguity.

### What the collection validated

- SCSI inquiry works across the full span: mini 2G (2005) through nano 7G (2012) — 7 years of hardware
- USB inquiry boundary confirmed: fails on mini 2G, nano 2G, iPod 5.5G; works on nano 4G, nano 7G
- USB inquiry returns dramatically more data on nano 7G (14x more than SCSI) — confirms 5G+ extra fields research
- iFlash hardware modification does not affect firmware inquiry
- Pre-2006 vs post-2006 SysInfo behaviour confirmed: mini 2G has full SysInfo, all others have empty/absent
- Serial suffix lookup works for nano 2G, nano 4G, iPod 5.5G; fails for mini 2G and nano 7G (not in table)
- Identity discrepancies exist when USB product IDs are shared across generations (0x1209, 0x1205)
