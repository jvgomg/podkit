---
id: TASK-480
title: 'Epic: extract @podkit/lima — consolidate Lima VM lifecycle + configs (doc-059)'
status: Done
assignee: []
created_date: '2026-08-23 13:30'
updated_date: '2026-08-24 00:23'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
HANDOFF (Phase A complete). P0 (TASK-480.01) + P1 (TASK-480.02) DONE, committed + pushed to main (P0: e67f69ef; P1: 16a02b0f code + 829a9e86 backlog). `@podkit/lima` now exists at test-packages/lima/ (private), owning the Lima substrate (registry, podkit-vm CLI, proper-lockfile lock, ensure*/recover lifecycle, transport, baseline-hash, docker-image runner); @podkit/device-testing consumes it via a complete re-export shim. Cut is cycle-free (lima deps: @podkit/device-types + proper-lockfile only). VM-green verified: test:vm 232/0, docker-dist+loopback 9/0. Reviewed SHIP.

KEY CONTEXT FOR PHASE B (P2→P3→P4, all blocked only by P1 which is now done):
- Placement is test-packages/lima (D6 amended); instance renames + yaml MOVE are P2 (registry currently holds CURRENT names + points yamlPath at the current on-disk locations under device-testing/lima + tools/lima).
- MF3 (P2, mandatory): computeBaselineHash still has its single (packageRoot) signature; after P2 moves the device yaml into lima it MUST change to explicit tracked-file paths or vm:doctor hard-crashes. Both callers (harness.ts, vm-doctor.ts) update.
- MF4 (P3): the P0 bash lock (vm-builder-lock.sh, mkdir+owner-PID) and the P1 proper-lockfile CLI lock do NOT interoperate — migrate all starters of a given VM to the CLI atomically; retire vm-builder-lock.sh at an explicit point.
- Coordination is single-layer (lock only), NO turbo ensure-nodes (amended D11/D13).
- GOTCHA proven in P1: any lima module that resolves paths at MODULE-LOAD (anchoring on the test-packages/lima marker) crashes the compiled FunctionFS daemon (bunfs has no such path). Keep all repoRoot()/path anchoring inside function bodies / lazy. FULL VM-green is required to catch this class (unit/typecheck/review miss it).
- bun-types/@types/bun pinned to 1.3.14 via root overrides (TASK-481 tracks unpin).

UNRELATED PRE-EXISTING BLOCKER (not this epic): `bun run quality` is red on main since Aug 18 — TASK-479 commit 947ee3cd removed the fabricated MA147 iPod-Video identity but the host e2e `device init/reset > modelName /Video/i` (device.test.ts, dated Jun 23) wasn't updated. Fold that test update into task-479.12/.13. Until then, verify VM work via test:vm + the docker surfaces directly, not full quality.

Binding spec/decisions: doc-059 + backlog/drafts/vm-harness-decisions.md (D1–D15 + post-review resolutions + MF1–MF4). Implementation plan: backlog/drafts/vm-harness-implementation-plan.md (P0/P1 sections superseded; P2–P4 still guide).

## PHASE B COMPLETE (P2 -> P3 -> P4). Epic done.

All five subtasks are Done. Branch `vm-harness-phase-b` (commits `7d01bc7f` .. `e1e0b852`), not yet merged to main.

**P2** — all 7 VM YAMLs moved to `test-packages/lima/vms/` behind the registry; instances renamed per D12; MF3 landed (`computeBaselineHash` now takes an explicit tracked-file list, since the device baseline spans two packages). Verified by destroy + cold re-provision rather than `limactl rename`, so the relocated YAMLs are proven rather than merely moved.

**P3** — the five build wrappers and `run-tests.sh` now call the CLI for lifecycle and `stageSourceTree` for staging; the exclude lists were reconciled onto a shared floor; the lock cutover was atomic (the bash lock is deleted, so no process can take it); `harness:setup` now succeeds on a cold host in one invocation.

**P4** — ADR-027 files the decision and reconciles with ADR-016; the substrate gained its own README; `tools/lima/README.md` was rewritten and `test-packages/device-testing/lima/` deleted; ~30 stale doc references corrected.

## Plan corrections worth carrying forward

The implementation plan was wrong in three places that only surfaced on execution:

1. **`bunx podkit-vm` does not resolve.** No `node_modules/@podkit`, no linked workspace bin — bunx falls through to npm and 404s. The plan specified it in ~7 places. Actual form: `bun "$REPO_ROOT/test-packages/lima/src/cli.ts" <verb>`.
2. **The plan's "assume-running guard" option contradicted D13.** Turbo caching means either builder task can independently be a cache miss, so both need a real start path. Both got `ensure`.
3. **The plan did not account for output buffering.** Routing `limactl start` through the buffered default runner would have swallowed the entire cold-create log, making a ten-minute provision indistinguishable from a hang. A streaming runner was added for `start`/`create` only.

## Latent defects the work exposed

Three bugs that existed before this phase and would have bitten a future contributor:

- **`stageSourceTree` had never been executed** and was broken — `set -o pipefail` into `sh -c`, which dash and busybox ash reject. P1 shipped it green because the wrappers it replaced used `bash -c`.
- **The lock's wait budget was a tenth of its documented value.** `proper-lockfile`'s `factor: 1` pins every retry at `minTimeout`, making `maxTimeout` dead config — 2 minutes, not the "multi-minute cold create" claimed. This is exactly the hazard the decisions doc warned P1 not to inherit from the P0 bash lock. Now ~30 minutes, bounded by liveness.
- **The streaming runner's timeout was advisory** — it settled on `'close'`, which waits for stdio pipes a grandchild inherits. Only the Linux test VM caught this; macOS's `sh` execs where dash forks, so four macOS verification passes missed it.

Also filed: TASK-482 (device-testing unit tests never execute — a preflight `process.exit(0)` kills the run), TASK-483 (VM persona-daemon flakes under `quality`'s parallelism), TASK-484 (two builder tasks `rsync --delete` into the same VM staging dir concurrently — the lock guards starts, not staging).

## Verification

test:vm 232/0; docker dist+loopback 9/0; `mise run test:linux:debian` 63/63 on a cold-created `podkit-test-glibc`; cold-host `harness:setup` in one invocation; lint 0/0, typecheck 38/38, build 21/21; `docs:build` 68 pages with all internal links valid.

Full `bun run quality` remains red on `@podkit/e2e-vm-tests#test:vm` under its own host parallelism — TASK-483, not attributable to this epic. The originally-blocking `/Video/i` host-e2e failure is fixed on this branch.
<!-- SECTION:NOTES:END -->
