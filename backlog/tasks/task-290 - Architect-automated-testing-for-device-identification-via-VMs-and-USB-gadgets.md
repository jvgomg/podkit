---
id: TASK-290
title: 'Write ADRs: Linux VM test harness + device persona fixtures'
status: Done
assignee: []
created_date: '2026-05-02 15:45'
updated_date: '2026-05-13 16:55'
labels:
  - testing
  - adr
  - vm-coverage
milestone: m-19
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/test-devices.md
  - tools/lima/virtual-ipod.yaml
  - packages/virtual-ipod-server/src/gadget.ts
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codify the architecture decisions for podkit's VM-based test harness as two ADRs.

**ADR 1 — Linux VM test harness**: three-tier model (unit / native integration / Linux VM), no macOS VM (macOS has no userspace `dummy_hcd` equivalent so mac coverage is native + CI-only), Lima as mac-dev convenience layer, native Linux on **Linux dev hosts and self-hosted CI runners** (GH-hosted `ubuntu-latest` is NOT viable — TASK-320 spike confirmed the Azure-flavor kernel ships without `dummy_hcd`). Docker rejected (containers share kernel; kernel modules unavailable in Docker Desktop's bundled LinuxKit). New packages: `device-harness` (TestRuntime interface), `device-fixtures` (persona registry). The existing Lima `virtual-ipod.yaml` is for the user-facing demo and is off-limits to repurpose; test harness gets its own Lima yaml.

**ADR 2 — Device persona fixtures**: single source of truth for both Tier 1 mocks and Tier 3 USB gadget responses. `DevicePersona` schema bundles USB descriptor, SysInfoExtended XML, canned subprocess outputs (`lsblk`, `system_profiler`, `diskutil`), partition layout, expected capabilities/readiness/doctor outputs. Tier 1 imports as TS objects; Tier 3 serializes to JSON for the FunctionFS daemon to serve.

This is the design gate for the rest of m-19. Implementation tasks in m-19 should reference these ADRs once accepted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ADR file created for Linux VM test harness at adr/adr-XXX-linux-vm-test-harness.md (next available number)
- [x] #2 ADR file created for device persona fixtures at adr/adr-YYY-device-persona-fixtures.md (next available number)
- [x] #3 Both ADRs follow the project's ADR conventions (frontmatter, sections, cross-references) — match style of adr/adr-001, adr/adr-005, adr/adr-014
- [x] #4 ADR 1 documents the three-tier model and explicitly rejects macOS VMs with reasoning
- [x] #5 ADR 1 documents the Lima-primary / Docker-rejected decision with reasoning (kernel module loadability)
- [x] #6 ADR 1 records the TASK-320 spike finding (GH-hosted ubuntu-latest unsuitable; CI Tier 3 requires self-hosted runner or nested VM) and the deferred decision in TASK-323
- [x] #7 ADR 2 documents the DevicePersona schema (illustrative fields) and the shared-source-of-truth rationale
- [x] #8 ADR 2 documents the capture methodology (provenance link to real hardware) and the starter persona set (3 for v1)
- [x] #9 ADRs cross-reference each other and relevant existing ADRs (ADR-005, ADR-014) and docs (doc-028, doc-029, doc-032, doc-033)
- [x] #10 ADRs land on main as a single PR with status 'Proposed' or 'Accepted' per project convention
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ADRs landed and accepted:
- adr-016-linux-vm-test-harness.md (Accepted)
- adr-017-device-persona-fixtures.md (Accepted)

Both committed in 463c0da "m-19: VM test harness plan — ADRs + Phase 1/3/5 backlog scaffold". Status promoted Proposed → Accepted to unblock TASK-321 (Phase 1) and TASK-322 (Phase 3) which depend on TASK-290.

Minor corrections applied in this pass:
- ADR-017 Phase 5 header corrected from "9 additional personas" to "12 additional personas" (table has 12 rows).

Known follow-ups from review (not blocking; deferred):
- ADR-016: builder/test VM split is presented inside Option C rather than as its own comparative decision; "Option III" snapshot strategy named without Options I/II; Decision Driver "no special permissions" conflicts with dummy_hcd needing root; mass-storage resetStrategy default not picked.
- ADR-017: single-package decision contradicts TASK-290 task description (two packages); raw inputs + expected outcomes bundled — coupling not justified; usbDescriptor schema too thin for FunctionFS gadget (no config/interface/endpoint hierarchy); sysInfoExtendedXml collapses USB vs SCSI transport distinction (central adr-014 split).

These improvements can be folded in as the implementing tasks discover them, or revisited if TASK-321/322 implementers hit ambiguity.
<!-- SECTION:FINAL_SUMMARY:END -->
