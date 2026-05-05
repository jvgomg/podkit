---
id: TASK-292.07
title: P1.7 — FirmwareCapabilities extraction from plist tree
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 15:01'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `firmware/extract.ts` in `@podkit/ipod-firmware`. Takes a parsed plist value tree (from P1.2) and produces a structured `FirmwareCapabilities` object containing audio codecs, video codecs, artwork formats, album art formats, FamilyID, DBVersion, firmware version, RAM, etc.

Identity fields (firewireGuid, serialNumber) are also extracted here. The `FirmwareCapabilities` is the firmware-overlay input consumed by `@podkit/devices-ipod`'s `getCapabilities` in P3.

See spec doc-032, Scope > firmware/extract.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 extractFromPlist(plistValue) returns ParsedFirmware with firewireGuid, serialNumber, and capabilities subset
- [x] #2 Audio codecs extracted with sample rates, bit depths where present
- [x] #3 Artwork formats extracted with format ID, width, height, pixel format
- [x] #4 Album art formats extracted similarly
- [x] #5 Video codecs extracted (when present) with profile, level, max resolution, max bitrate
- [x] #6 FamilyID, DBVersion, firmware version, RAM size extracted
- [x] #7 Returns null gracefully when required identity fields missing
- [x] #8 Unit tests against captured XML from all 5 inventory devices
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Apple plist key names discovered (only documentation that exists for these): FireWireGUID (always string, never integer despite 64-bit value), SerialNumber, FamilyID, VisibleBuildID (firmware version — BuildID/BuildVersion are internal), RAM (megabytes — converted to bytes in output), DBVersion (optional, absent on mini 2G and iPod 5G), AudioCodecs (dict keyed by name with MaximumSampleRate/MaximumBitDepth), VideoCodecs (Profile flat on 5G, nested in Profiles sub-dict on nano 4G), ImageSpecifications/ImageSpecifications2 (nano 7G USB falls back to v2), AlbumArt/AlbumArt2 (same fallback), PixelFormat (8-char hex four-CC, decoded to ASCII e.g. 0x4C353635 → "L565"). bigintToFireWireGuid helper exported for 292.09's consistency check, which compares the SysInfoExtended string GUID against the raw 64-bit integer GUID decoded from the USB serial descriptor. 157 tests / 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implementation complete. All ACs satisfied.

**Files written:**
- `packages/ipod-firmware/src/firmware/extract.ts` (~240 LOC)
- `packages/ipod-firmware/src/firmware/extract.test.ts` (~320 LOC, 63 new tests)
- `packages/ipod-firmware/src/index.ts` — added export for `extractFromPlist`, `bigintToFireWireGuid`

**Apple plist key names discovered across generations:**
- Identity: `FireWireGUID` (string, pre-formatted hex — NOT integer), `SerialNumber` (string)
- FamilyID: `FamilyID` (integer, always present)
- DBVersion: `DBVersion` (integer, absent on mini 2G and iPod 5G)
- Firmware version: `VisibleBuildID` (human-readable, e.g. "1.0.4"); `BuildID`/`BuildVersion` are internal Apple identifiers
- RAM: `RAM` (integer, in **megabytes** — multiply × 1,048,576 to get bytes)
- Audio codecs: `AudioCodecs` dict keyed by codec name (AIFF, MP3, WAV, AAC, AppleLossless, Audible). Sub-dict: `MaximumSampleRate` (Hz), `MaximumBitDepth` (bits, absent on MP3/AAC)
- Video codecs: `VideoCodecs` dict keyed by codec name (H.264, MPEG4, H.264LC). Sub-dict: `Profile` (string, may be nested inside a `Profiles` sub-dict on nano 4G vs flat on iPod 5G), `Level` (int), `MaximumAverageBitRate` (kbps), `MaximumWidth`/`MaximumHeight`
- Artwork: `ImageSpecifications` array; nano 7G USB uses `ImageSpecifications2` when primary is empty
- Album art: `AlbumArt` array; nano 7G USB uses `AlbumArt2`
- Each image entry: `FormatId`, `RenderWidth`, `RenderHeight`, `PixelFormat` (8-char hex four-CC, decoded to ASCII e.g. "4C353635" → "L565")

**Notable findings:**
- `FireWireGUID` is always a `<string>` in SysInfoExtended (pre-formatted by firmware) — not an `<integer>`. `bigintToFireWireGuid` helper is still exported for callers receiving a raw integer from SCSI VPD page binary decode.
- nano 7G SCSI capture has no AudioCodecs, VideoCodecs, or artwork — USB capture has all of them (14× more data). Extractor handles both gracefully.
- mini 2G has no ImageSpecifications or AlbumArt keys at all.
- `PixelFormat` decoded from Apple hex four-CC to ASCII string.

**Gates:** typecheck ✓, tests 157/157 ✓ (63 new), lint 0 errors ✓, build ✓
<!-- SECTION:FINAL_SUMMARY:END -->
