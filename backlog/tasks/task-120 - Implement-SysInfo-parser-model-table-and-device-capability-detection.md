---
id: TASK-120
title: 'Implement SysInfo parser, model table, and device capability detection'
status: To Do
assignee: []
created_date: '2026-03-12 10:55'
updated_date: '2026-03-12 11:12'
labels:
  - phase-4
  - device
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-114
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_device.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_device.h
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_sysinfo_extended_parser.c
  - docs/devices/supported-devices.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement device identification from SysInfo files and the complete model capability table.

**SysInfo parser (`device/sysinfo.ts`):**
- Parse `iPod_Control/Device/SysInfo` text file (key-value pairs, one per line)
- Extract: ModelNumStr, FirewireGuid, and other fields
- Model number parsing quirk: strip leading letter (e.g., "MA147" → lookup "A147")

**Note on SysInfoExtended:** The XML/plist-based SysInfoExtended is only used by Touch/iPhone/iPad devices, which are outside podkit's target range. We do NOT need to implement a plist parser. The basic SysInfo text parser + model table provides all device detection needed for our target devices (Classic, Video, Nano 1-5, Mini, Shuffle, older iPods).

If SysInfoExtended is ever needed (e.g., for future Touch support), it can be added as a separate task with a plist parsing dependency.

**Model table (`device/models.ts`):**
Port the complete `ipod_info_table` from libgpod (~200 entries):
```typescript
interface IpodModelInfo {
  modelNumber: string;     // "A147"
  capacityGb: number;      // 60
  model: IpodModel;        // enum
  generation: IpodGeneration; // enum
  musicDirs: number;       // 50 (F00-F49)
}
```

**32 generation enum values:** UNKNOWN through IPAD_1

**Capability detection functions:**
- `supportsArtwork(generation)` — all except Shuffle 1st/2nd
- `supportsVideo(generation)` — Nano 3-5, Video, Classic, Touch, iPhone, iPad
- `supportsSparseArtwork(generation)` — Nano 3+, Classic, Touch, iPhone, iPad
- `supportsSqliteDb(generation)` — Nano 5+, Classic 3, Touch, iPhone, iPad
- `supportsPodcast(generation)` — 4th gen+, all Nano/Video/Classic/Touch/iPhone/iPad
- `getChecksumType(generation)` — NONE, HASH58, HASH72, HASHAB
- `getCoverArtFormats(generation)` — list of {formatId, width, height, pixelFormat}
- `getPhotoFormats(generation)` — list of photo format specs

**Serial number fallback:** Extract model from last 3 chars of serial number using `serial_to_model_mapping` table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SysInfo text parser extracts ModelNumStr and FirewireGuid correctly
- [ ] #2 Model number leading letter stripped before lookup
- [ ] #3 Model table contains all ~200 entries from libgpod ipod_info_table
- [ ] #4 All 32 generation enum values defined
- [ ] #5 All capability detection functions return correct values for every generation
- [ ] #6 Serial number fallback maps last 3 chars to model number
- [ ] #7 Unit tests cover all generations and edge cases
- [ ] #8 Capability results match libgpod for every device generation
- [ ] #9 SysInfoExtended NOT implemented (documented as out of scope for target devices)
<!-- AC:END -->
