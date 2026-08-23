---
id: TASK-480.03
title: >-
  P2 — consolidate VM configs into the registry + rename instances + fix
  computeBaselineHash (MF3)
status: To Do
assignee: []
created_date: '2026-08-23 13:31'
labels:
  - testing
  - ci
  - vm
  - refactor
  - ready-for-agent
milestone: m-22
dependencies:
  - TASK-480.02
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - backlog/drafts/vm-harness-decisions.md
parent_task_id: TASK-480
priority: high
ordinal: 257000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** move all VM config YAMLs into the `@podkit/lima` registry as the single source of truth, rename instances to the consistent scheme, and change `computeBaselineHash`'s signature so `vm:doctor` survives the cross-package split.

Per D10/D12 + MF3: relocate the 7 YAMLs from `tools/lima/` + `test-packages/device-testing/lima/` into `packages/lima/vms/` behind the typed registry. Rename Lima instances (keep the `podkit-` prefix): device-synthesis `podkit-device-harness`→`podkit-device`; builders `podkit-linux-builder`→`podkit-builder-glibc`, `podkit-musl-builder`→`podkit-builder-musl`; test runners `podkit-tests-debian-glibc`→`podkit-test-glibc`, `podkit-tests-alpine-musl`→`podkit-test-musl`; `podkit-virtual-ipod` + `podkit-abi-verify` kept. Repoint every turbo `inputs` glob + instance-name literal.

**MF3 (mandatory, not optional):** after the split the device VM's tracked YAML lives in `@podkit/lima` and `apply-state.sh` stays in `@podkit/device-testing`. `computeBaselineHash(packageRoot)` currently joins BOTH tracked files under ONE root and throws on a missing file → `vm:doctor` hard-crashes. Change the signature to an explicit absolute tracked-file list (or `(coreRoot, deviceTestingRoot)`), update both callers, and preserve declaration order for hash stability.

**Blocked by:** P1. **Domain notes:** one-time turbo cache-invalidation + VM re-provision from the path moves + renames is expected and bounded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 7 VM YAMLs live in packages/lima/vms/ behind the typed registry (single source of truth); tools/lima/ + device-testing/lima/ no longer hold VM configs
- [ ] #2 Instances renamed per the D12 scheme (podkit- prefix kept); registry ids are clean TS identifiers
- [ ] #3 Every turbo `inputs` glob + instance-name literal that referenced an old path/name is repointed
- [ ] #4 computeBaselineHash signature changed to explicit absolute tracked-file paths; both callers (harness + vm-doctor) updated; declaration order preserved; `bunx turbo run @podkit/device-testing#vm:doctor` no longer crashes and correctly detects drift
- [ ] #5 After a one-time re-provision, `harness:setup` + a full `test:vm` are green against the renamed/registry-owned VMs
<!-- AC:END -->
