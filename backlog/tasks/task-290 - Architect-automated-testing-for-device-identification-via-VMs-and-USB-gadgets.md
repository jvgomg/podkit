---
id: TASK-290
title: 'Write ADRs: Linux VM test harness + device persona fixtures'
status: To Do
assignee: []
created_date: '2026-05-02 15:45'
updated_date: '2026-05-11 22:57'
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
- [ ] #1 ADR file created for Linux VM test harness at adr/adr-XXX-linux-vm-test-harness.md (next available number)
- [ ] #2 ADR file created for device persona fixtures at adr/adr-YYY-device-persona-fixtures.md (next available number)
- [ ] #3 Both ADRs follow the project's ADR conventions (frontmatter, sections, cross-references) — match style of adr/adr-001, adr/adr-005, adr/adr-014
- [ ] #4 ADR 1 documents the three-tier model and explicitly rejects macOS VMs with reasoning
- [ ] #5 ADR 1 documents the Lima-primary / Docker-rejected decision with reasoning (kernel module loadability)
- [ ] #6 ADR 1 records the TASK-320 spike finding (GH-hosted ubuntu-latest unsuitable; CI Tier 3 requires self-hosted runner or nested VM) and the deferred decision in TASK-323
- [ ] #7 ADR 2 documents the DevicePersona schema (illustrative fields) and the shared-source-of-truth rationale
- [ ] #8 ADR 2 documents the capture methodology (provenance link to real hardware) and the starter persona set (3 for v1)
- [ ] #9 ADRs cross-reference each other and relevant existing ADRs (ADR-005, ADR-014) and docs (doc-028, doc-029, doc-032, doc-033)
- [ ] #10 ADRs land on main as a single PR with status 'Proposed' or 'Accepted' per project convention
<!-- AC:END -->
