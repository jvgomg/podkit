---
id: doc-059
title: >-
  RFC: @podkit/lima — consolidate Lima VM lifecycle + configs into a first-class
  package
type: specification
created_date: '2026-08-23 13:30'
tags:
  - testing
  - ci
  - vm
  - refactor
  - m-22
  - rfc
  - ready-for-agent
---
> Binding decisions live in `backlog/drafts/vm-harness-decisions.md` (D1–D15 + post-review
> resolutions + must-fixes MF1–4). Supporting: `vm-harness-package-design.md` (proposal),
> `vm-harness-implementation-plan.md` (phased plan — note its P0 section is superseded, see MF1/MF2).
> Reconciles with ADR-016 (builder/test VM separation — preserved; only orchestration + config are
> centralized). Milestone m-22.

## Problem Statement

podkit's VM-based testing and build machinery — seven Lima VMs on macOS (a device-synthesis harness,
two per-libc builder VMs, two per-libc Linux test runners, the virtual-iPod demo, and a manual
ABI-check VM) — is a de-facto first-class dependency of the repo, but it is spread loosely with no
single owner. The same "check status → start/create/recreate a VM" logic is re-implemented in ~7
places (TypeScript runners + shell build wrappers + the Linux test runner), the VM config YAMLs are
split across two directories, and instance names are spelled three different ways (TS consts, shell
env defaults, mise literals). There is **no cross-process coordination anywhere**: two independent
turbo tasks can start the same shared builder VM concurrently and crash it ("another hostagent may
already be running" — the intermittent `harness:setup` failure), and the device-harness VM's
concurrency is serialized only by hand (the `quality` vs `quality:rc` split). The root cause is
missing ownership, not any single bug.

## Solution

Extract a new first-class package, **`@podkit/lima`** (in `packages/lima/`), that owns the Lima
**substrate**: the `limactl` wrapper, a typed **VM registry** that is the single source of truth for
all VM configs and instance names, idempotent `ensure*`/`recover` lifecycle primitives, a **single
cross-process advisory lock** (via `proper-lockfile`) exposed through one `podkit-vm` CLI so every
start path funnels through one lock, generic in-VM transport (`runInVm`/`stageSourceTree`/`copyOut`),
and baseline-hash + drift checking. `@podkit/device-testing` is refactored to **consume** the
substrate while keeping everything domain-coupled (personas, system-states, `apply-state.sh`, the
FunctionFS daemon-gadget synthesis, `vm/` fixtures). The scattered YAMLs move into the registry with
consistent instance names; the host build wrappers and the Linux test runner become thin callers of
`podkit-vm`; and the sleep-corruption recovery (destroy → recreate → re-seal baseline) becomes a
first-class `recover` operation. Coordination is **single-layer**: the shared lock only — there are no
turbo ensure-nodes (a `cache:false` ensure node would boot the VM even on cache hits). The release
path, ADR-016's builder/test VM separation, and the CI-native `tools/prebuild/*` recipe path are all
preserved unchanged.

## User Stories

1. As a maintainer, I want one command that idempotently ensures a given VM exists and is running, so
   that every start path shares one implementation instead of seven copies.
2. As a maintainer running `harness:setup`, I want two concurrent turbo tasks to never start the same
   builder VM at once, so that setup stops crashing intermittently on the hostagent pidfile.
3. As a maintainer, I want a single cross-process advisory lock guarding every VM start, so that
   coordination is guaranteed regardless of whether the caller is turbo, a shell script, or TS.
4. As a maintainer, I want that lock to preserve lazy VM start, so that a fully-cached build never
   boots a builder VM it doesn't need.
5. As a maintainer, I want the lock to be liveness-aware and reclaim a stale lock whose owner has
   died, so that a crashed process never wedges the builders permanently.
6. As a maintainer, I want the lock to wait out a legitimately slow cold VM create rather than time
   out while the holder is alive, so that a 10-minute first-boot isn't aborted.
7. As a maintainer, I want one typed VM registry as the single source of truth for every VM's config
   and instance name, so that names stop being spelled three different ways across the tree.
8. As a maintainer, I want all VM config YAMLs owned by one package, so that I stop hunting across two
   directories to find or edit a VM definition.
9. As a maintainer, I want consistent instance names discriminated by their true axis (libc for
   build/test VMs), so that `podkit-builder-glibc`/`podkit-builder-musl` replace the inconsistent
   `podkit-linux-builder`/`podkit-musl-builder`.
10. As a maintainer, I want the device-synthesis VM renamed to `podkit-device`, so that the retired
    "harness" word stops overloading both the VM and the tooling.
11. As a maintainer, I want `bun run vm:*` developer commands (`vm:up`/`vm:down`/`vm:status`/
    `vm:recover`/`vm:shell`) replacing `harness:*`, so that the command surface is generic across all
    VMs, not named for one.
12. As a maintainer whose Lima VM was corrupted by a mac sleep, I want a first-class `recover`
    operation that destroys, recreates, and re-seals the baseline, so that recovery is one command
    instead of a remembered sequence.
13. As a maintainer, I want `vm:doctor` drift-checking to keep working after the config YAML and
    `apply-state.sh` end up in different packages, so that baseline drift is still detected rather
    than hard-crashing on a missing file.
14. As a maintainer, I want the host build wrappers (glibc/musl prebuild + binary + gpod-tool) to be
    thin callers of `podkit-vm` for ensure + source-staging, so that the duplicated status/start/rsync
    logic collapses to one place.
15. As a maintainer, I want the in-VM per-libc build **recipes** (`tools/prebuild/*`) to stay free of
    any `@podkit/lima` dependency, so that CI (which runs them directly with no Lima) is unaffected
    and ADR-016's "one recipe, two callers" holds.
16. As a maintainer, I want `@podkit/lima` to depend only on `@podkit/device-types` (never
    `@podkit/core`), so that the lean substrate never drags native `@podkit/libgpod-node` or metadata
    libraries.
17. As a maintainer, I want the default `SubprocessRunner` implementation re-homed next to its
    interface in `@podkit/device-types` (re-exported from `@podkit/core`), so that `@podkit/lima` can
    use it without a `lima→core` edge and existing core consumers are unaffected.
18. As a maintainer, I want `@podkit/device-testing`'s public import surface preserved via a
    re-export shim, so that `@podkit/e2e-vm-tests` and typecheck don't churn when runners move.
19. As a maintainer, I want the Linux test runner (`mise run test:linux`) to route its VM ensure
    through `podkit-vm`, so that even that path shares the one lock and registry.
20. As a maintainer, I want the virtual-iPod VM's config folded into the registry while its `vipod:*`
    lifecycle and in-VM server stay put, so that config is unified without pulling the demo's bespoke
    lifecycle into scope.
21. As a maintainer, I want the manual ABI-check VM kept as a manual on-demand registry entry, so that
    the documented `ldd` capability survives without being auto-wired into CI.
22. As a maintainer, I want each phase (extract → consolidate configs → thin scripts → tidy edges) to
    be independently shippable and verifiable, so that I can review and land the work incrementally.
23. As a maintainer, I want the lock cutover from the shipped bash lock to the `proper-lockfile` CLI
    lock to be atomic per VM, so that a half-migrated state can't reintroduce the very race we fixed.
24. As a maintainer, I want the lifecycle/lock/registry logic unit-tested with scripted `limactl`
    outputs and no real VMs, so that the one piece of real logic is fast and deterministic to test.
25. As a maintainer, I want one real-process integration test of the lock's mutual exclusion, so that
    the property the scripted seam can't verify is still covered.
26. As a maintainer, I want a new ADR reconciling this consolidation with ADR-016, so that the record
    shows separation was preserved and only orchestration + config were centralized.
27. As a contributor reading the docs, I want `agents/device-testing.md`, both `lima/README.md`s, and
    the vm-build-orchestration architecture doc updated to the new package + names, so that the docs
    match reality.
28. As a maintainer, I want the release path, release tags, and the CI `prebuild.yml` path to be
    provably unaffected, so that this refactor carries no release-time risk.

## Implementation Decisions

The binding decisions are D1–D15 + post-review resolutions in
`backlog/drafts/vm-harness-decisions.md`. Summary of the decision-rich points:

- **New package `@podkit/lima` in `packages/lima/`** (private). Owns: the `limactl` wrapper; a typed
  `VmDefinition[]` **registry** (id, instanceName, yaml-asset path, category, arch-relevance,
  tracked-for-baseline) over co-located declarative Lima YAML; idempotent `ensure*`/`status`/`stop`/
  `destroy`/`recover`; a `proper-lockfile`-based advisory lock exposed through one `podkit-vm` CLI;
  generic transport (`runInVm`/`stageSourceTree`/`copyOut`); and baseline-hash + drift + `recover`.
- **The cut.** `@podkit/lima` takes the pure-Lima substrate (limactl wrapper, `instanceStatus` +
  arch/path/musl resolvers, the `lima-docker-image` runner, `baseline-hash`, transport).
  `@podkit/device-testing` keeps everything domain-coupled (personas, system-states, `apply-state.sh`,
  the FunctionFS daemon-gadget, `vm/` fixtures, the runtime factory + sidecar/backing/daemon runners).
  Dividing line: references personas/system-states or imports `@podkit/core` → stays; pure Lima
  mechanics → core. Verified cycle-free by the plan review.
- **Dependency invariant.** `@podkit/lima` depends only on `@podkit/device-types`. The default
  `SubprocessRunner` impl moves from `@podkit/core` to `@podkit/device-types` (next to its interface),
  re-exported from `@podkit/core` for existing consumers.
- **Coordination is single-layer: the shared lock only.** No turbo `ensure:<instance>` nodes (a
  `cache:false` ensure node boots VMs on cache hits). The lock preserves lazy start; is liveness-aware
  + stale-reclaiming; never auto-stops a shared VM; no reference-counting.
- **Config registry** is the single source of truth; instance names renamed to a consistent scheme
  (device-synthesis → `podkit-device`; builders → `podkit-builder-{glibc,musl}`; test runners →
  `podkit-test-{glibc,musl}`; demo + abi-verify kept), all under the `podkit-` prefix.
- **`computeBaselineHash` must change signature** from a single `packageRoot` to an explicit absolute
  tracked-file list (or two roots), because after consolidation the tracked YAML lives in
  `@podkit/lima` and `apply-state.sh` stays in `@podkit/device-testing`; both callers update; the
  declaration order is preserved for hash stability. (Otherwise `vm:doctor` hard-crashes on a missing
  file — this is a mandatory P2 change, not "one-time drift".)
- **Lock cutover is atomic per VM.** The shipped bash lock (`vm-builder-lock.sh`, mkdir + owner-PID)
  and the `proper-lockfile` CLI lock do not interoperate; all starters of a given VM flip to the CLI
  in one step, and the bash lock's removal point is explicit.
- **Naming taxonomy.** `podkit-vm` CLI (verbs `ensure|status|stop|destroy|recover|install|doctor|
  shell`); `bun run vm:*` replaces `harness:*`; test-suite task names (`test:vm`,
  `test:e2e:docker-dist`) kept; `mise run test:linux` kept but its ensure routes through `podkit-vm`.
- **Build-tooling boundary.** `tools/prebuild/*` recipes stay put and never import `@podkit/lima`;
  only the host wrappers thin onto the CLI. The release path and CI `prebuild.yml` are untouched.
- **P0 (already shipped, commit e67f69ef):** a shared `vm-builder-lock.sh` serializes the reported
  glibc-builder start race between the two `dependsOn:[]` tasks; it is the prototype of the P1 lock
  and stays authoritative until P1's atomic cutover.

## Testing Decisions

- **What a good test is here.** Assert external behavior, not implementation. The one piece of real
  new logic — the registry/lifecycle/lock/recover/drift decisions — is unit-tested by feeding scripted
  `limactl` outputs through the injected `SubprocessRunner` seam and asserting the decision/argv, with
  no real `limactl`, network, or VM. Do not assert on how commands were shelled beyond the decision.
- **Single seam, highest point.** Route every `limactl` call through the injected `SubprocessRunner`
  DI seam (as the existing runners already do) so the whole substrate is unit-testable with scripted
  outputs.
- **The one exception.** The advisory lock's actual two-process mutual exclusion cannot be verified at
  the SubprocessRunner seam — cover it with a small real-process integration test (two processes
  contend for one lock; assert serialization, stale reclaim, and that a live holder blocks a
  contender). The shipped P0 bash lock was validated this way already.
- **Modules tested.** The `@podkit/lima` registry + `ensure*`/lock/`recover`/baseline-drift decision
  logic (scripted-runner unit tests); the lock (one real-process integration test). No new tests for
  the YAML configs (validated by yamllint + a live VM run) or the package scripts (validated by
  running them); the composed system is covered by existing `test:vm` and `quality`/`quality:rc`.
- **Prior art.** The scripted-`SubprocessRunner` runner tests (`lima-docker-image.test.ts`,
  `lima-test-vm-*.test.ts`, `lima-test-vm-systemd.test.ts`) and the `resolve-rc-build.test.ts`
  discovery/preflight tests — all inject a fake command runner and assert argv/decisions with no real
  subprocess. Follow that structure.

## Out of Scope

- **Merging any VMs.** ADR-016's builder/test separation is preserved; only orchestration + config are
  centralized.
- **Pulling the virtual-iPod demo's full lifecycle into `@podkit/lima`.** Only its config joins the
  registry; `vipod:*` and the in-VM server stay put.
- **Automating the ABI-check VM into a CI gate.** It stays a manual on-demand registry entry.
- **Unifying the device-sync advisory lock (`pid-file.ts`) with the VM lock.** Different context
  (FAT32/exFAT device mass storage); it stays a separate lock, by choice.
- **Retiring the `quality` vs `quality:rc` manual VM serialization** via the device-instance lock — a
  noted D2 follow-on, not this work.
- **A second VM backend.** `@podkit/lima` is Lima-on-macOS; no abstraction for a hypothetical other
  backend.

## Further Notes

- P0 is already merged (`e67f69ef`); the epic's P0 subtask exists for traceability and should be
  closed as done. The implementation-plan draft's P0 section predates the shipped lock and is
  superseded by MF1/MF2 in the decisions doc.
- Phasing: **P1** extract the package (+CLI +lock +runner re-home +re-export shim); **P2** consolidate
  configs + rename instances + the `computeBaselineHash` signature change; **P3** thin the host
  scripts + `run-tests.sh` onto `podkit-vm` with an atomic lock cutover, retiring `vm-builder-lock.sh`;
  **P4** virtual-iPod + abi-verify registry entries, docs, and the new ADR. Each phase is independently
  shippable and best executed as its own checkpointed pass.
- P2 incurs a one-time turbo cache-invalidation + VM re-provision from the config path moves +
  instance renames — expected and bounded.
