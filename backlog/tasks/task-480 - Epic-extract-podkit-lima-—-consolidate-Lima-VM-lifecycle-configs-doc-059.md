---
id: TASK-480
title: 'Epic: extract @podkit/lima — consolidate Lima VM lifecycle + configs (doc-059)'
status: In Progress
assignee: []
created_date: '2026-08-23 13:30'
labels:
  - testing
  - ci
  - vm
  - refactor
  - epic
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - backlog/drafts/vm-harness-decisions.md
  - backlog/drafts/vm-harness-implementation-plan.md
  - backlog/drafts/vm-harness-package-design.md
  - adr/adr-016
priority: high
ordinal: 254000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Master/epic for doc-059. Extract a first-class `@podkit/lima` package (in `packages/lima/`) that owns Lima VM lifecycle + a single cross-process lock + a typed VM config registry + baseline/drift/recover + transport, with `@podkit/device-testing` refactored to consume it. Root cause: no single owner of VM lifecycle → duplicated start logic in ~7 places, split configs, no cross-process coordination (the `harness:setup` hostagent race).

Design + binding decisions: **doc-059** and `backlog/drafts/vm-harness-decisions.md` (D1–D15 + post-review resolutions + must-fixes MF1–4). Implement in the phase subtasks, not here.

Subtasks (dependency order):
- P0 — serialize builder-VM start (race fix). **DONE**, commit e67f69ef (shipped standalone).
- P1 — extract the `@podkit/lima` core (registry + `podkit-vm` CLI + `proper-lockfile` lock + `SubprocessRunner` re-home + re-export shim). Blocked by nothing.
- P2 — consolidate configs into the registry + rename instances + `computeBaselineHash` signature change (MF3). Blocked by P1.
- P3 — thin host build scripts + `run-tests.sh` onto `podkit-vm`; atomic lock cutover (MF4); retire `vm-builder-lock.sh`. Blocked by P1.
- P4 — virtual-iPod + abi-verify registry entries; docs + new ADR reconciling ADR-016. Blocked by P1 (P2 for configs).

Reconciles with ADR-016 (builder/test VM separation preserved; only orchestration + config centralized). Preserves the release path and the CI-native `tools/prebuild/*` recipe path. Each phase is independently shippable and best run as its own checkpointed pass.
<!-- SECTION:DESCRIPTION:END -->
