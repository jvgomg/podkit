---
id: TASK-480.02
title: >-
  P1 — extract @podkit/lima core (registry + podkit-vm CLI + lock + runner
  re-home + shim)
status: Done
assignee: []
created_date: '2026-08-23 13:31'
updated_date: '2026-08-23 18:31'
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
- [x] #1 `@podkit/lima` exists in packages/lima/ (private), builds + typechecks, and depends ONLY on @podkit/device-types (never @podkit/core, directly or transitively)
- [x] #2 Typed VmDefinition registry + `podkit-vm` CLI (all listed verbs) with a single proper-lockfile-based advisory lock as the one lock code path; lock is liveness-aware, stale-reclaiming, never auto-stops a shared VM, no reference-counting
- [x] #3 The cut is applied and cycle-free: substrate (limactl wrapper, instanceStatus + arch/path/musl resolvers, lima-docker-image runner, baseline-hash, transport) in lima; domain (personas/system-states/apply-state/daemon-gadget/vm/ + runtime factory + sidecar/backing/daemon runners) stays in device-testing; no core→device-testing import
- [x] #4 Default SubprocessRunner impl moved to @podkit/device-types and re-exported from @podkit/core; all existing @podkit/core consumers of it build + pass unchanged
- [x] #5 @podkit/device-testing re-export shim is COMPLETE (incl. TransferBinaryOpts/Result types): @podkit/e2e-vm-tests import sites and repo typecheck are unaffected
- [x] #6 Substrate logic (registry, ensure*, lock, recover, baseline/drift) is unit-tested via the injected SubprocessRunner seam with scripted limactl outputs (no real VMs), plus one real-process integration test of lock mutual exclusion
- [x] #7 No turbo ensure-nodes are introduced (coordination is the shared lock only)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
P1 landed. `@podkit/lima` created at **test-packages/lima/** (maintainer moved placement from packages/ mid-flight; name stays `@podkit/lima`, private).

PACKAGE LAYOUT (test-packages/lima/src):
- limactl.ts (moved from device-testing lima-limactl.ts) — runLimactl/limactlError/shellQuote/LimactlResult; imports SubprocessRunner from @podkit/device-types.
- paths.ts — repoRoot anchored on the `test-packages/lima/` marker.
- registry.ts — typed `VmDefinition[]` (id, instanceName, yamlPath abs, category device|builder|test-runner|demo|abi, archRelevance agnostic|glibc|musl, trackedForBaseline) for all 7 VMs with CURRENT names + current yaml paths (renames/yaml-move are P2); getVm(id|instance)/listVms()/deviceVm(); LIMA_DEVICE_HARNESS_VM_NAME.
- instance-status.ts — instanceStatus + InstanceStatus (moved from lima-test-vm.ts).
- binary-paths.ts — vmArch + the 7 arch/path/musl resolvers (moved from lima-test-vm.ts).
- baseline-hash.ts (moved) — computeBaselineHash kept its (packageRoot) signature; MF3 signature change is P2.
- transport.ts (NEW generic primitives) — runInVm/copyOut/stageSourceTree (rsync-into-/tmp mirroring the build wrappers, exit-24 tolerated). Wrappers NOT rewritten this phase.
- lock.ts (NEW) — single proper-lockfile advisory lock: acquireVmLock/withVmLock/isVmLocked/lockPathFor. realpath:false synthetic path keyed per instance; live holder refreshes mtime (never aborts a slow cold-create), stale-reclaims after staleMs (default 30s), retries wait out a slow holder. Never stops a VM, no ref-counting.
- lifecycle.ts (NEW) — status/ensureExists/ensureRunning/stop/destroy/recover. Every create/start path runs the status read INSIDE withVmLock (atomic check-then-act). recover = destroy → ensureRunning → provision hook → reseal hook (device-specific hooks are caller-supplied callbacks; substrate owns only the mechanics).
- docker-image.ts (moved from lima-docker-image.ts) — imports rewired to ./limactl, ./paths, ./registry (LIMA name), ./binary-paths (musl resolvers).
- cli.ts — `podkit-vm` bin (bin→src/cli.ts, run by bun). Verbs ensure|status|stop|destroy|recover|shell fully implemented (funnel through the lock via lifecycle); doctor = generic baseline-drift check for tracked VMs (derives the device-testing package root from the registry yamlPath — no code coupling); install/recover expose generic mechanics and defer device-specific binary/persona staging + baseline reseal to the device-testing harness (harness.ts NOT rebuilt).
- index.ts barrel; bunfig.toml excludes *.integration.test.ts from default `bun test`.

THE CUT (cycle-free; grep confirms lima imports ONLY @podkit/device-types — never @podkit/core or @podkit/device-testing). lima-test-vm-binary.ts judgment call: KEPT in device-testing (its STAYS listing + it stages the podkit/gpod binaries, a device concern) — introduced fresh generic transport in lima instead. Personas/system-states/vm/ fixtures/runtime factory + sidecar/backing/systemd/state runners all stay.

DEVICE-TESTING REFACTOR:
- Added @podkit/lima dep + `--external @podkit/lima` to its build.
- lima-test-vm.ts: deleted the moved defs; imports LIMA_DEVICE_HARNESS_VM_NAME + instanceStatus + all 7 resolvers from @podkit/lima and RE-EXPORTS them so `./runners/lima-test-vm.js` import sites (harness/vm-doctor/vm-install/preflight/persona-fixture/mount-persona/e2e) are unchanged. Factory + sidecar/backing/daemon composition + run impl stay.
- lima-limactl.ts + baseline-hash.ts → thin forwarding shims re-exporting @podkit/lima (keeps ~8 internal importers + harness/vm-doctor unchanged).
- lima-docker-image.ts + .test.ts DELETED (moved); src/index.ts docker group re-exported from @podkit/lima.
- src/index.ts is the COMPLETE re-export shim: TransferBinaryOpts/Result, the 7 resolvers, instanceStatus, LIMA name, docker group, subprocess all still importable from @podkit/device-testing. Repo-wide typecheck + @podkit/e2e-vm-tests typecheck green prove completeness.

TESTS (scripted-SubprocessRunner seam, prior-art pattern): registry, instance-status (NDJSON), binary-paths, baseline-hash (hash/drift/throw), lifecycle (ensure*/stop/destroy/recover argv+decisions, lock real but keyed to per-test tmp), transport, docker-image (ported), lock (single-proc). Plus lock.integration.test.ts — real two-process mutual exclusion: serialization (non-overlapping windows), live-holder-blocks-zero-retry (ELOCKED), stale reclaim after SIGKILL (waits ≥ staleMs). 53 unit + 3 integration pass.

DEPENDENCY HAZARD (judgment call for review): `bun install` (needed for proper-lockfile) re-resolves every `"latest"` bun-types/@types/bun specifier to the just-released 1.4.0, whose ambient `*.xml` typing breaks device-testing personas repo-wide (TS2322 Document vs string) — a latent trap any bun install now triggers, not specific to this work. Fixed minimally with a root package.json `overrides` pinning bun-types/@types/bun to 1.3.14 (the version the repo was actually on). Flagged so the team lead can instead choose to upgrade bun-types + fix personas separately.

GATES (all PASS): build --filter lima+device-testing; repo-wide typecheck (38/38); e2e-vm-tests typecheck; oxlint clean (0/0); prettier clean; bun test lima 53 unit + 3 integration; turbo test:unit lima+device-testing+core. NOT run per instructions: test:vm / quality (composed VM run — left for the team lead).

Team-lead review (Sonnet) verdict: SHIP — no must-fix. Independently verified: cycle-free (lima imports only @podkit/device-types + proper-lockfile + node builtins; zero core/device-testing imports), shim complete AGAINST ACTUAL @podkit/e2e-vm-tests import sites (not just typecheck), lock correct (proper-lockfile update:5000/stale:30000 — a live holder's slow cold-create is never reclaimed; status read inside withVmLock; never auto-stops; no ref-counting) with real cross-process proof (3 integration tests), no turbo ensure-nodes added (turbo.json diff empty), scripts/harness.ts untouched (nothing that worked can regress). Gates re-run by reviewer: repo typecheck 38/38, oxlint 0/0, bun test 56/56.

Nits actioned by team lead: deleted the 3 dead `return;` after process.exit() in lock.integration.worker.ts (TS7027, harmless). Filed a follow-up task to unpin bun-types/@types/bun (the 1.3.14 override). Left as-is (match documented intent): stop/destroy not lock-guarded (lock guards start paths by design), and the routine bun.lock signal-exit hoisting from adding proper-lockfile.

Remaining before checkpoint: team lead runs full VM-green (bun run quality) on the final code. Not committed (held for maintainer checkpoint).

VM-GREEN (team-lead verification) — found + fixed one real regression that only the VM surfaces caught (validating the full-VM-green requirement):

Regression: the FunctionFS daemon (@podkit/device-testing-daemon, a COMPILED single-file bun binary) crashed on startup with `limaPackageRoot: could not anchor on '/test-packages/lima/' in /$bunfs/root/dummy-hcd-daemon-linux-arm64`. Root cause: lima's registry.ts resolved each `yamlPath` EAGERLY at module load via repoRoot()→limaPackageRoot(), which anchors on the source-tree `test-packages/lima/` marker in import.meta.url. The device-testing barrel re-exports the registry (P1 shim), the daemon bundles that barrel, and in the bunfs binary the marker doesn't exist → throw → gadget never enumerates → 8 persona tests timed out. Unit tests/typecheck/review all passed because they run from SOURCE where the marker exists.

Fix (team lead, registry.ts): entries now hold a pure relative-path string; `yamlPath` is a lazy getter resolving via repoRoot() only ON ACCESS. Importing lima is now side-effect-free — verified: ALL repoRoot()/limaPackageRoot() call sites in lima are inside function bodies, none at module scope. Documented the why (daemon-bundling footgun) in a comment. Builds + tsc + oxlint + 8/8 registry tests green.

VM-green after fix (ran the P1-impact surfaces directly, bypassing an UNRELATED pre-existing host-e2e failure): test:vm device-testing 38/0 + e2e-vm-tests 194/0 (232 pass, 0 fail, 22/22 tasks); docker-dist 6/0 (the moved lima-docker-image runner) + docker-loopback 3/0 (26/26 tasks). No anchor errors.

Pre-existing failure (NOT P1, confirmed): full `bun run quality` phase-1 host e2e `device init/reset > modelName /Video/i` returns 'Invalid' — caused by committed TASK-479 commit 947ee3cd (2026-08-18) which removed the fabricated MA147 iPod-Video identity; the e2e assertion (dated 2026-06-23) wasn't updated (that's task-479.12/.13). This has been red on main since Aug 18, independent of P1. Because it short-circuits phase-1 qa, the P1-impact surfaces were run directly instead.
<!-- SECTION:NOTES:END -->
