---
id: TASK-295.02
title: P4.2 — Replace regex extraction with structured plist parser
status: Done
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-06 22:17'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the regex-based identity extraction in `readSysInfoExtended` (P1's legacy path) with the structured plist parser. Existing tests adjusted to reflect richer extraction (parser handles cases the regex couldn't — nested dicts, arrays, integers).

See spec doc-035, Scope > Move SysInfoExtended file I/O > new implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 readSysInfoExtended uses parsePlist + extractFromPlist (no regex)
- [x] #2 Existing extraction-related tests pass; new tests added for richer fields
- [x] #3 Identity extraction (firewireGuid, serialNumber) byte-identical to regex output for all 5 captured XML fixtures
- [x] #4 Capabilities extraction enabled where firmware data was previously ignored
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced regex extraction in `readSysInfoExtended` with structured plist parser.

**Changes:**
- `packages/device-types/src/firmware.ts`: Added `modelNumber?: string` to `ParsedFirmware` (extracted from `ModelNumStr` or `ModelNumber` plist key).
- `packages/ipod-firmware/src/firmware/extract.ts`: Added alternate `FirewireGuid` casing fallback; added `ModelNumStr`/`ModelNumber` extraction into `modelNumber`.
- `packages/ipod-firmware/src/sysinfo/read.ts`: Complete rewrite — all regex deleted. Uses `parsePlist` + `extractFromPlist` for full extraction, falls back to identity-only parsing when `FamilyID` is absent (older plists). `validateXml` and `extractIdentity` re-implemented on top of the plist parser.

**ModelNumStr handling:** Option B — added `modelNumber?: string` to `ParsedFirmware`. Tries `ModelNumStr` then `ModelNumber` plist keys; absent in all 5 real captures (key not present in any SysInfoExtended capture files), present in test fixture (`B261`).

**Alt-casing:** `extractFromPlist` and `extractIdentityFromPlistValue` both try `FireWireGUID` then `FirewireGuid`, preserving the alt-casing test cases.

**Hardware validation:** Ran parser against all 6 capture XMLs. All FireWireGUIDs and SerialNumbers match `documents/test-devices.md` inventory exactly. No live iPod mounted at validation time; TERAPOD dir is a stale temp mount.

**Quality gates:** typecheck clean, ipod-firmware 205/205 pass, podkit-core 2521/2521 pass, lint 0 errors.
<!-- SECTION:FINAL_SUMMARY:END -->
