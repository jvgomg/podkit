---
id: TASK-458.01
title: >-
  Access-tier model + device info — replace supported boolean with {access,
  verified}
status: Done
assignee: []
created_date: '2026-07-05 14:23'
updated_date: '2026-07-05 16:21'
labels:
  - device-capability
  - read-only
  - model
milestone: m-18
dependencies: []
parent_task_id: TASK-458
ordinal: 210000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Foundational slice for doc-056 / ADR-024. Replace `IpodGeneration.supported: boolean` with a `GenerationSupport` record `{ access: 'syncable'|'read-only'|'none'; verified: 'hardware'|'inferred'; note? }`. Add pure `resolveGenerationSupport(generation)` and `getSupportMatrix()` (the serializable export every other surface consumes). Clean break (minor bump) — migrate ALL readers of `supported` to `access`, no deprecation shim. Surface access + confidence in `device info` output.

This is the spine; slices 2–7 depend on it. Keep the model migration atomic — a half-migrated `supported`/`access` tree is the failure mode to avoid.

Generation assignments per ADR-024 §2: shuffle_3g/4g → read-only/hardware; nano_6g → read-only/inferred; nano_7g + iOS + not-in-table → none/inferred; existing syncable generations → syncable (hardware where tested, else inferred).

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `IpodGeneration.supported` is gone; a `GenerationSupport {access, verified, note?}` record replaces it and all readers are migrated
- [x] #2 `resolveGenerationSupport` and `getSupportMatrix()` are pure and exported from @podkit/devices-ipod
- [x] #3 shuffle_3g/4g resolve to read-only/hardware; nano_6g to read-only/inferred; iOS+nano_7g to none/inferred
- [x] #4 `device info` shows the access tier and confidence (e.g. "read-only, hardware-verified")
- [x] #5 Unit tests cover the notable generations' {access, verified} and the exported matrix shape
- [x] #6 Typecheck + build green across all packages that read the old flag
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed on feat/device-access-tiers (commit bf3496cd; ADR/corpus in d6e6ec13).

- devices-ipod/types.ts: added DeviceAccess, SupportVerification, GenerationSupport, SupportMatrixRow; replaced `supported: boolean` with `support: GenerationSupport`.
- tables/generations.ts: all entries carry a support record. shuffle_4g=read-only/hardware; shuffle_3g + nano_6g=read-only/inferred; nano_7g + all iOS=none/inferred; all previously-supported=syncable/inferred.
- support.ts (new): pure resolveGenerationSupport() + getSupportMatrix(), exported from index.ts.
- Behavior-preserving migration of all IpodGeneration.supported readers → `support.access !== 'syncable'` (identity.ts, resolve.ts). IpodClassification.supported and DeviceValidationResult.supported are distinct fields, correctly untouched (discovery reclassification is slice 458.02).
- podkit-cli device info: additive "Support: <access> (<confidence>)" line.
- Fixed NANO_6G_REASON (was "cannot read or write" → "cannot write; read untested") and the ADR shuffle_3g provenance row (reviewer catches).

Gates: bun run test:unit --filter @podkit/devices-ipod → 375 pass / 0 fail; build + typecheck green across devices-ipod, device-types, podkit-cli, demo.

Deferred (noted for follow-up): syncable generations all default verified:'inferred' — contributors upgrade known-hardware-tested gens later (ADR §2). device info intentionally omits the support note (too long for a summary row; the note surfaces in the read-only error in slices 03/04).
<!-- SECTION:NOTES:END -->
