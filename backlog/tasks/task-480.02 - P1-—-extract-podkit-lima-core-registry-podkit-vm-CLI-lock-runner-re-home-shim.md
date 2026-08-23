---
id: TASK-480.02
title: >-
  P1 — extract @podkit/lima core (registry + podkit-vm CLI + lock + runner
  re-home + shim)
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
dependencies: []
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - backlog/drafts/vm-harness-decisions.md
  - backlog/drafts/vm-harness-implementation-plan.md
parent_task_id: TASK-480
priority: high
ordinal: 256000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** the new `@podkit/lima` package (in `packages/lima/`, private) owning the Lima substrate, with `@podkit/device-testing` refactored to consume it via a complete re-export shim.

Scope per doc-059 + decisions D5/D6/D7 + resolutions: the typed `VmDefinition[]` registry, the `podkit-vm` CLI (verbs `ensure|status|stop|destroy|recover|install|doctor|shell`) as the single lock chokepoint, a **`proper-lockfile`-based advisory lock** as the one lock code path, idempotent `ensure*`/`recover` lifecycle, generic transport (`runInVm`/`stageSourceTree`/`copyOut`), and `baseline-hash` + drift. The cut: limactl wrapper, `instanceStatus` + arch/path/**musl resolvers**, the `lima-docker-image` runner, `baseline-hash`, and transport move to `@podkit/lima`; personas, system-states, `apply-state.sh`, the FunctionFS daemon-gadget, `vm/` fixtures, the runtime factory + sidecar/backing/daemon runners **stay** in `@podkit/device-testing` (consuming lima). Move the default `SubprocessRunner` impl from `@podkit/core` to `@podkit/device-types` (re-exported from core) so `@podkit/lima` depends only on `@podkit/device-types` (never core). **Coordination is single-layer (the lock only) — do NOT add turbo `ensure:<instance>` nodes** (MF2/amended D13).

**Blocked by:** none. **Domain notes:** the review verified the cut is cycle-free — `lima-docker-image.ts` imports only `LIMA_DEVICE_HARNESS_VM_NAME` + the two musl resolvers from `lima-test-vm.ts`, all of which move to core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `@podkit/lima` exists in packages/lima/ (private), builds + typechecks, and depends ONLY on @podkit/device-types (never @podkit/core, directly or transitively)
- [ ] #2 Typed VmDefinition registry + `podkit-vm` CLI (all listed verbs) with a single proper-lockfile-based advisory lock as the one lock code path; lock is liveness-aware, stale-reclaiming, never auto-stops a shared VM, no reference-counting
- [ ] #3 The cut is applied and cycle-free: substrate (limactl wrapper, instanceStatus + arch/path/musl resolvers, lima-docker-image runner, baseline-hash, transport) in lima; domain (personas/system-states/apply-state/daemon-gadget/vm/ + runtime factory + sidecar/backing/daemon runners) stays in device-testing; no core→device-testing import
- [ ] #4 Default SubprocessRunner impl moved to @podkit/device-types and re-exported from @podkit/core; all existing @podkit/core consumers of it build + pass unchanged
- [ ] #5 @podkit/device-testing re-export shim is COMPLETE (incl. TransferBinaryOpts/Result types): @podkit/e2e-vm-tests import sites and repo typecheck are unaffected
- [ ] #6 Substrate logic (registry, ensure*, lock, recover, baseline/drift) is unit-tested via the injected SubprocessRunner seam with scripted limactl outputs (no real VMs), plus one real-process integration test of lock mutual exclusion
- [ ] #7 No turbo ensure-nodes are introduced (coordination is the shared lock only)
<!-- AC:END -->
