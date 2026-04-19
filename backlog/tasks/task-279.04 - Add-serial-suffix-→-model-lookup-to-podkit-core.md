---
id: TASK-279.04
title: Add serial suffix → model lookup to podkit-core
status: Done
assignee: []
created_date: '2026-04-19 17:12'
updated_date: '2026-04-19 17:40'
labels:
  - device
dependencies: []
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
parent_task_id: TASK-279
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the serial number suffix → model lookup capability to podkit-core. libgpod identifies exact iPod models (including color and capacity) from the last 3 characters of the device serial number. This mapping needs to be available in podkit-core for display purposes during device add and doctor.

**What to copy from libgpod:**
- The `serial_to_model_mapping` table from `itdb_device.c` (lines 633-743+) — maps 3-char serial suffixes to model numbers (e.g., "YXX" → "B261")
- This combined with the existing model number → display name lookup gives exact identification (e.g., "B261" → "iPod nano 8GB Black (3rd Generation)")

**What to copy from ipod-db:**
- The `MODEL_TABLE` from `packages/ipod-db/src/device/models.ts` has richer data per model (generation, capacity, color via model field like `nano_black`, musicDirs)
- Copy the relevant subset into podkit-core with clear comments noting duplication and referencing ipod-db as future single source of truth

**New unified model registry in podkit-core:**
- Single module with multiple access patterns: by USB product ID, by ModelNumStr, by serial suffix
- Replaces the current separate `IPOD_MODELS` and `SYSINFO_MODEL_NAMES` tables in `ipod-models.ts`
- Include generation-to-checksum-type mapping (none/hash58/hash72/hashAB) for initialization capability detection

**Verified on real hardware:**
- iPod Nano 3G serial `5U8280FNYXX` → suffix "YXX" → model "B261" → "iPod nano 8GB Black (3rd Generation)"

See PRD: doc-029 — "Initialization Capability Mapping" and "Refactoring Opportunities: Model table consolidation" sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Serial suffix lookup function: given 3-char suffix returns model info (generation, capacity, color, display name)
- [x] #2 Checksum type mapping: each generation maps to none/hash58/hash72/hashAB
- [x] #3 Existing lookupIpodModel and lookupIpodModelByNumber functions still work (refactored into unified registry)
- [x] #4 Code copied from ipod-db has clear comments noting duplication and referencing ipod-db as future source of truth
- [x] #5 Unit tests verify known serial suffixes (e.g., YXX → nano 3G black 8GB)
- [x] #6 Unit tests verify checksum type mapping for each generation category
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Unified registry in ipod-models.ts with serial suffix lookup (190+ entries from libgpod), checksum type mapping per generation, and backward-compatible lookupIpodModel/lookupIpodModelByNumber. New types and functions exported from device/index.ts. 68 new tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added to unified ipod-models.ts:\n- Serial suffix -> model lookup (190+ entries from libgpod itdb_device.c lines 633-868)\n- Checksum type mapping for all 27 generation IDs (none/hash58/hash72/hashAB)\n- Model number registry with 150+ entries including generation, capacity, and color\n- lookupIpodModelBySerial, getGenerationInfo, getChecksumType, lookupGenerationByProductId functions\n- Backward-compatible lookupIpodModel and lookupIpodModelByNumber preserved\n- Duplication with ipod-db noted in comments for future consolidation\n- Full test coverage including end-to-end identification pipeline tests
<!-- SECTION:FINAL_SUMMARY:END -->
