---
id: TASK-480.04
title: >-
  P3 — thin host build scripts + run-tests.sh onto podkit-vm; atomic lock
  cutover (MF4)
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
  - test-packages/device-testing/scripts/vm-builder-lock.sh
parent_task_id: TASK-480
priority: medium
ordinal: 258000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** collapse the duplicated host-side VM-orchestration logic by making the build wrappers and the Linux test runner thin callers of `podkit-vm`, and cut over from the P0 bash lock to the CLI lock atomically.

Per D8/D11 + MF4: thin `build-linux-prebuild.sh`, `build-linux-binary.sh`, `build-musl-prebuild.sh`, `build-musl-binary.sh`, `build-gpod-tool-linux.sh`, and `run-tests.sh` so their ensure + source-staging go through `podkit-vm ensure` + the unified `stageSourceTree` (reconcile the drifted rsync-exclude lists). The in-VM `tools/prebuild/*` **recipes stay untouched and must not import `@podkit/lima`** (CI runs them directly). 

**MF4 (critical):** the shipped `vm-builder-lock.sh` (mkdir + owner-PID at `${TMPDIR}/podkit-vmlock-<VM>`) and the `proper-lockfile` CLI lock do NOT interoperate. Migrate ALL starters of a given VM to the CLI lock in ONE atomic step (or have the CLI lock reuse the bash path/algorithm during transition) — a half-migrated state reintroduces the P0 race. Retire `vm-builder-lock.sh` at an explicit point once its scripts flip together.

**Blocked by:** P1. **Domain notes:** replace `bun run harness:*` with `bun run vm:*` wrappers over `podkit-vm`; keep test-suite task names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The 5 build wrappers + run-tests.sh call `podkit-vm` for ensure + source-staging; the duplicated status/start/rsync logic is removed and the rsync-exclude lists reconciled
- [ ] #2 Lock cutover is atomic per VM: no window where two starters of the same VM use different (non-interoperating) locks
- [ ] #3 vm-builder-lock.sh is retired at an explicit point; nothing still references it
- [ ] #4 tools/prebuild/* recipes are unchanged and import nothing from @podkit/lima; CI `prebuild.yml` path is unaffected (verify no new Lima/@podkit/lima coupling)
- [ ] #5 `bun run vm:*` commands replace `harness:*`; a full `harness:setup`/`vm:up` + build path is green
<!-- AC:END -->
