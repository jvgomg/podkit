---
id: TASK-265
title: Read-only SysInfo parser and model table (subset of TASK-120)
status: Done
assignee: []
created_date: '2026-04-03 19:45'
updated_date: '2026-04-03 20:33'
labels:
  - parser
  - device
milestone: m-17
dependencies:
  - TASK-114
references:
  - doc-003
  - TASK-120
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the SysInfo text parser and model lookup table needed for the virtual iPod to identify what device it's emulating. This is a focused subset of TASK-120 — just enough for read-only device identification.

**SysInfo parser (`device/sysinfo.ts`):**
- Parse `iPod_Control/Device/SysInfo` text file (key-value pairs, one per line)
- Extract: ModelNumStr, FirewireGuid
- Model number parsing quirk: strip leading letter (e.g., "MA147" → lookup "A147")

**Model table (`device/models.ts`):**
- Port the complete `ipod_info_table` from libgpod (~200 entries)
- Each entry: modelNumber, capacityGb, model enum, generation enum, musicDirs count
- 32 generation enum values

**Capability queries (read-only subset):**
- `getModelInfo(modelNumber)` — lookup model details
- `supportsArtwork(generation)` — needed for artwork display in UI
- `supportsVideo(generation)` — needed to show/hide video menu
- `getDisplayName(model)` — human-readable model name for the UI chrome

**NOT in scope (deferred to TASK-120):**
- Write-related capabilities (hash type selection, sparse artwork detection)
- Serial number fallback
- Cover art format lists for write operations
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SysInfo text file parsed correctly
- [x] #2 Model number lookup works for all ~200 entries
- [x] #3 32 generation enum values defined
- [x] #4 supportsArtwork and supportsVideo return correct values
- [x] #5 Human-readable model names available for UI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
195-entry model table ported from libgpod itdb_device.c. 33 generation enum values (one extra vs spec — UNKNOWN_NEW). SysInfo parser handles CRLF, case-insensitive keys, whitespace trimming. 123 tests passing.
<!-- SECTION:NOTES:END -->
