---
id: TASK-480.01
title: P0 — serialize Lima builder-VM start (race fix)
status: Done
assignee: []
created_date: '2026-08-23 13:30'
updated_date: '2026-08-23 13:32'
labels:
  - testing
  - ci
  - vm
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - test-packages/device-testing/scripts/vm-builder-lock.sh
parent_task_id: TASK-480
priority: high
ordinal: 255000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Shipped standalone (commit e67f69ef). Serializes the `harness:setup`/`vm:install` hostagent race: `device-testing#build:linux-prebuild` and `gpod-testing#build:linux-binary` are both `dependsOn:[]` and each may start the shared `podkit-linux-builder` VM (either can be a cache-miss while the other is a cache-hit, so neither can be sole starter). Added `vm-builder-lock.sh` (mkdir-atomic, owning-shell-PID liveness, stale-reclaiming) wrapping the lazy check-then-start in both scripts, status read inside the lock. Preserves lazy start (no VM boot on cached builds) — which the originally-approved turbo ensure-node would have broken (see D13 amendment). Prototype for the P1 `podkit-vm` lock; stays authoritative until P1's atomic cutover (MF4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Concurrent glibc-builder starts are serialized by a shared cross-process lock (verified: concurrent acquirers serialize, stale locks reclaim, a live holder blocks a contender)
- [x] #2 Lazy start preserved: no builder VM boot on fully-cached builds
- [x] #3 No turbo-DAG change; the two dependsOn:[] scripts share one lock keyed by VM name
<!-- AC:END -->
