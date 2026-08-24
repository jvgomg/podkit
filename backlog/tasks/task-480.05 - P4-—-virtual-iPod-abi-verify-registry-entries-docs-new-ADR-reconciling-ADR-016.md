---
id: TASK-480.05
title: >-
  P4 — virtual-iPod + abi-verify registry entries; docs + new ADR reconciling
  ADR-016
status: Done
assignee: []
created_date: '2026-08-23 13:32'
updated_date: '2026-08-24 00:11'
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
- [x] #1 podkit-virtual-ipod config is a `demo` registry entry; vipod:* + the in-VM server are unchanged
- [x] #2 podkit-abi-verify is a manual on-demand registry entry (not auto-wired into CI); its documented ldd capability is preserved
- [x] #3 agents/device-testing.md, both lima/README.md, and vm-build-orchestration.md are updated to @podkit/lima + podkit-vm + renamed instances + single-layer lock
- [x] #4 A new ADR reconciles with ADR-016: separation preserved, no VMs merged, only orchestration + config centralized
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

**ADR-027** (`adr/adr-027-lima-vm-substrate-consolidation.md`, Accepted 2026-08-24), added to `adr/index.md`. Records the extraction and reconciles with ADR-016 explicitly: no VMs merged, the five instances remain distinct with distinct provisioning, the ABI-masking guarantee untouched, `tools/prebuild/*` unchanged with CI still running them directly without Lima. Also records why the turbo `ensure` ordering node was rejected (a `cache: false` node boots the VM on cache hits; and neither task can be sole starter because either can independently be a cache miss), so coordination is single-layer. Cross-linked both ways — ADR-016 gained a forward-pointing orchestration note, matching the ADR-001 -> ADR-021 house pattern.

**`test-packages/lima/README.md`** created (332 lines): registry and how to add a VM, `podkit-vm` verbs, the lock's boundary (guards starts, NOT source staging) with its liveness model and wait-budget rationale, the start-only `ensure*` contract, the staging exclude floor, baseline composition, and the two constraints that fail silently — module-load path resolution crashing the compiled daemon, and dash/ash having no `pipefail`.

**`tools/lima/README.md`** rewritten: it documented three VMs that no longer exist and implied the configs lived there. Corrected a VM spec error while in there (musl runner is 2 GiB / 12 GiB).

**`test-packages/device-testing/lima/` deleted.** After the configs moved it held only a signpost README. Content redistributed rather than stranded: build-pipeline material (binary-only invariant, `ldd` rules, gpod-tool sourcing, `PODKIT_HOST_ARCH`) into `agents/device-testing.md`, which already owned the topic and already linked to it; the manual ABI-verify recipe into the substrate README; builder/test/ABI roles into ADR-027. A ~90-line "snapshot lifecycle" section was dropped as dead — ADR-016 records that codepath was deleted in May 2026.

## Registry entries verified (AC#1, AC#2)

`virtualIpod`: category `demo`, YAML moved byte-for-byte (pure `git mv`, zero content diff). Every `vipod:*` mise task is still hand-rolled `limactl` — no lifecycle rerouted, per D9. `@podkit/virtual-ipod-server` untouched. The only related edits are path repointing plus `vipod:install` using `podkit-vm stage`, which is staging consolidation rather than lifecycle.

`abiVerify`: category `abi`, reachable as `podkit-vm ensure abiVerify`. Appears in exactly two files (`registry.ts`, `registry.test.ts`) — no turbo task, no mise task, no CI workflow. Its YAML retains the allowed/forbidden runtime-library lists.

## Stale references corrected beyond the task's scope

The rename was less complete in documentation than the handoff indicated: ~30 stale references across 11 live documents, including files P3 had already partially updated — `AGENTS.md` (yaml paths, the package tree, the Entry Points table), `agents/device-testing.md` (4 yaml paths, 3 instance names), `agents/testing.md`, `agents/docker.md`, `vm-build-orchestration.md` (7), `vm-testing.md` (3), `taxonomy.md`, three persona `provenance.md` files, and two package READMEs.

Deliberately preserved: in-VM guest paths sharing the old string (`/var/lib/podkit-device-harness/…`, the modules-load and modprobe conf files), and the frozen ADR-016/ADR-026 records, which state what was true when decided.

## Verification

`bun run docs:build` — 68 pages, **all internal links valid**, exit 0. Lint 0/0. Both stale-reference greps clean apart from the intended in-VM paths and frozen ADRs.

## Noted, not changed

`adr/index.md`'s table is missing ADR-016, 017, 018, 025 and 026 — a pre-existing gap; only the 027 row was added. The docs site has no ADR sync wiring, so `/developers/adr/…` links in ADRs resolve to nothing published today.
<!-- SECTION:NOTES:END -->
