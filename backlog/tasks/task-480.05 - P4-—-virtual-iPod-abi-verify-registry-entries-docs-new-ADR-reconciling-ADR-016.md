---
id: TASK-480.05
title: >-
  P4 — virtual-iPod + abi-verify registry entries; docs + new ADR reconciling
  ADR-016
status: To Do
assignee: []
created_date: '2026-08-23 13:32'
labels:
  - testing
  - ci
  - vm
  - docs
  - ready-for-agent
milestone: m-22
dependencies:
  - TASK-480.02
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - adr/adr-016
  - documents/architecture/testing/vm-build-orchestration.md
  - agents/device-testing.md
parent_task_id: TASK-480
priority: medium
ordinal: 259000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** fold the two remaining VMs' configs into the registry, update the docs, and file the ADR that reconciles this consolidation with ADR-016.

Per D4/D9 + user stories 20/21/26/27: add `podkit-virtual-ipod` to the registry as a `demo` category entry (leave the `vipod:*` lifecycle tasks and the in-VM `@podkit/virtual-ipod-server` app untouched); keep `podkit-abi-verify` as a **manual on-demand** registry entry (documented, not CI-wired). Update `agents/device-testing.md`, both `lima/README.md` files, and `documents/architecture/testing/vm-build-orchestration.md` to the new `@podkit/lima` package + `podkit-vm` CLI + renamed instances + single-layer-lock coordination. File a new ADR recording that ADR-016's builder/test VM separation is **preserved** (no VMs merged) and only orchestration + config were centralized.

**Blocked by:** P1 (registry); config entries depend on P2's registry being in place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit-virtual-ipod config is a `demo` registry entry; vipod:* + the in-VM server are unchanged
- [ ] #2 podkit-abi-verify is a manual on-demand registry entry (not auto-wired into CI); its documented ldd capability is preserved
- [ ] #3 agents/device-testing.md, both lima/README.md, and vm-build-orchestration.md are updated to @podkit/lima + podkit-vm + renamed instances + single-layer lock
- [ ] #4 A new ADR reconciles with ADR-016: separation preserved, no VMs merged, only orchestration + config centralized
<!-- AC:END -->
