---
id: TASK-294.01
title: P3.1 — Bootstrap @podkit/devices-ipod; refactor ipod-models content
status: Done
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-05 18:14'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the `@podkit/devices-ipod` package skeleton. Move the content of `podkit-core/device/ipod-models.ts` (2,013 lines) into the new package, refactored into the file structure from spec doc-034:

- tables/generations.ts, usb-ids.ts, serials.ts, model-numbers.ts, artwork-formats.ts, libgpod-mapping.ts
- lookups.ts (consolidated lookup functions)
- identity.ts (identify() facade replacing resolveIpodModel)

Types (ChecksumType, IpodGeneration, IpodGenerationId, IpodModel, IpodModelVariant) move with the data. IpodGenerationId becomes a literal-plus-runtime union.

See spec doc-034, Scope > New package: @podkit/devices-ipod.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/devices-ipod/ exists with package.json, build script, test runner
- [x] #2 ipod-models.ts content fully migrated; tables organised by lookup-axis
- [x] #3 lookups.ts exports lookupByUsbId, lookupBySerial, lookupByModelNumber, lookupGenerationInfo
- [x] #4 identity.ts exports identify(input) facade replacing resolveIpodModel
- [x] #5 Existing ipod-models tests run against the new module structure and pass
- [x] #6 IpodGenerationId is a literal-plus-runtime union (const array + literal type + string companion)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

Created `packages/devices-ipod/` with the full file structure from spec doc-034.

### File structure produced

| File | Lines |
|------|-------|
| `src/types.ts` | 104 |
| `src/tables/generations.ts` | 70 |
| `src/tables/usb-ids.ts` | 75 |
| `src/tables/model-numbers.ts` | 1114 |
| `src/tables/serials.ts` | 333 |
| `src/tables/libgpod-mapping.ts` | 82 |
| `src/tables/artwork-formats.ts` | 20 |
| `src/lookups.ts` | 202 |
| `src/identity.ts` | 112 |
| `src/index.ts` | 66 |
| `src/lookups.test.ts` | 501 |
| `src/identity.test.ts` | 166 |

### Key decisions

1. **IpodGenerationId**: Implemented as `IPOD_GENERATION_IDS as const` array + literal type + `IpodGenerationIdLike` companion per spec. All 29 generation IDs present.

2. **LEGACY_MODEL_OVERRIDES**: Refactored from inline generation-inference logic to a typed `Record<string, { displayName; generation }>` — cleaner and removes the implicit string-matching hack from the original.

3. **identity.ts return type**: Returns `IpodModel` (rich lookup result) rather than `@podkit/device-types` `IpodIdentity` (which requires firmware fields `firewireGuid`/`serialNumber`/`familyId` not available at table-lookup time). Flagged for alignment in TASK-294.02/294.03.

4. **libgpod-mapping.ts**: Defines `LibgpodGenerationName` as a local string union rather than importing from `@podkit/libgpod-node`, keeping the package libgpod-free at runtime. The type mirrors the libgpod-node enum exactly.

5. **backward-compat aliases**: `lookupIpodModel`, `lookupIpodModelByNumber`, `lookupIpodModelBySerial`, `getGenerationInfo`, `resolveIpodModel` all exported with `@deprecated` JSDoc — existing call sites in core continue to compile and callers of the new API use the cleaner `lookupByUsbId` / `lookupBySerial` / `lookupByModelNumber` / `lookupGenerationInfo` / `identify` names.

6. **Old ipod-models.ts untouched**: Core still imports from `./ipod-models.js`. The shim lands in TASK-294.12.

### Gate results

- `bun install`: pass
- `bun run --cwd packages/devices-ipod test`: 112 pass, 0 fail
- `bun run typecheck`: 25/25 tasks successful (full turbo)
- `bun run --cwd packages/podkit-core test:unit`: 2509 pass, 1 skip, 0 fail
- `bun run lint`: 0 errors (14 pre-existing warnings, none in devices-ipod)
- `bun run build --filter @podkit/devices-ipod`: 2 tasks successful, 39.97 KB bundle
<!-- SECTION:FINAL_SUMMARY:END -->
