---
title: 'ADR-027: Lima VM Substrate Consolidation (@podkit/lima)'
description: Extract one package that owns every Lima VM config, the lifecycle primitives, and a single cross-process advisory lock serialising VM starts, behind one `podkit-vm` CLI. ADR-016's physical builder/test/device VM separation is preserved unchanged — only orchestration and config ownership are centralised.
sidebar:
  order: 28
---

# ADR-027: Lima VM Substrate Consolidation (`@podkit/lima`)

## Status

**Accepted** (2026-08-24)

Consolidates the orchestration around the VMs introduced by [ADR-016](/developers/adr/adr-016-linux-vm-test-harness); it does **not** revise ADR-016's architecture. See "Reconciliation with ADR-016" below.

## Context

The repo grew to seven Lima VMs — a device-synthesis harness, two per-libc builders, two per-libc Linux test runners, a virtual-iPod demo, and a manual ABI-check VM. Each arrived with its own task, and each brought its own lifecycle code. Nothing owned the substrate, so the same mechanics were re-implemented per caller and drifted:

- **VM configs lived in two trees with no rule for which went where.** The test-runner and demo YAMLs sat under `tools/lima/`; the builder, harness and ABI-verify YAMLs sat under `test-packages/device-testing/lima/`. Both directories also held prose, scripts and READMEs, so "where does a VM config live?" had no answer.

- **Instance names were spelled by hand at every call site** — in TypeScript literals, bash variables, mise task bodies and turbo `inputs` globs. Renaming a VM meant a repo-wide grep with no way to know it was complete.

- **Every caller re-implemented check-then-start.** Build wrappers, the harness script, the Linux test runner and the mise tasks each read `limactl list` and then started the VM if it was not running. Two of them ran concurrently under turbo, and the interleaving crashed Lima's hostagent — a live intermittent build failure, not a theoretical race.

- **Source staging had drifted.** Each wrapper carried its own `rsync --exclude` list. They had diverged, so one wrapper shipped host build intermediates into a VM that its sibling correctly pruned, and only one of them tolerated rsync's benign exit 24.

The failure mode common to all four is that no single place could be corrected. Fixing the race in one wrapper left the others racing; fixing one exclude list left the others stale.

## Decision Drivers

- The start race must be fixed for **every** starter, not the two that happened to collide
- A VM rename must be a one-line edit, not a grep
- ADR-016's builder/test VM separation — and the binary-linkage bug class it catches — must survive untouched
- ADR-016's "one recipe, two callers" invariant for `tools/prebuild/*` must survive untouched: CI runs those scripts directly, with no Lima and no Node
- Lock, lifecycle and registry decisions must be unit-testable without booting a VM
- The substrate must not drag native bindings or metadata libraries into a build script

## Options Considered

### Option A: Fix the race in place, leave everything else

Wrap the two colliding wrappers in a shell lock and stop there.

**Pros:** Minimal. Ships in an afternoon.

**Cons:** Leaves the other start paths unlocked, so a manual invocation or a future caller re-introduces the race. Does nothing for the split config trees, the hand-spelled instance names, or the drifted exclude lists. This was shipped as an interim step precisely because it was cheap, then replaced.

### Option B: A minimum-viable helper module inside `@podkit/device-testing`

Put `ensureRunning` and a lock in the existing harness package and import it from the build wrappers.

**Pros:** No new package.

**Cons:** `@podkit/device-testing` is domain-coupled — personas, system states, the gadget daemon. The build wrappers and the Linux test runner have nothing to do with any of that, and importing the harness to start a builder VM inverts the dependency. It also gives the demo VM's config no honest home.

### Option C: A first-class substrate package (Chosen)

Extract `@podkit/lima`: one package owning the VM registry (all YAMLs), the lifecycle primitives, the advisory lock, generic transport, and a single CLI that shell, TypeScript and mise all call.

**Pros:** One lock code path, one config location, one exclude floor, one place to rename a VM. The domain package keeps the domain.

**Cons:** A new package and a one-time cost: renaming Lima instances forces a destroy and re-provision, and moving the YAMLs invalidates the turbo caches that hash them.

## Decision

**Option C.** Extract `@podkit/lima` at `test-packages/lima/`.

The location is deliberate: this is private test and build infrastructure, so `test-packages/` is the honest home. `packages/` is published-adjacent and would misrepresent it. The package name is independent of the directory.

### What the substrate owns

- **A typed VM registry** (`src/registry.ts`) — the single source of truth for all seven instances. Each entry pairs a clean TypeScript `id` with the concrete `podkit-`-prefixed instance name, a pointer to the YAML, a category and libc relevance. The Lima specs stay **native YAML** in the package's `vms/` directory: readable, `limactl validate`-able, no codegen. Architecture stays a runtime in-VM concern (`uname -m`), never a config axis.

  Callers look VMs up by `id`. Instance names are *derived from* the registry rather than restated, which is what makes a rename one edit. An unknown id throws with the list of known VMs rather than silently no-opping.

- **Idempotent lifecycle primitives** (`src/lifecycle.ts`) — `status`, `ensureExists`, `ensureRunning`, `stop`, `destroy`, `recover`. `ensureRunning` is **start-only**: it creates if missing, starts if stopped, no-ops if running, and *never* stops a VM. There is **no reference counting** — only an explicit `stop` or `destroy` tears a VM down. Shared VMs are long-lived developer infrastructure; a finishing task must not pull one out from under a sibling.

- **One cross-process advisory lock** (`src/lock.ts`) keyed per instance, with the status read taken **inside** the lock so check-then-act is atomic across processes.

- **Generic transport** (`src/transport.ts`) — `runInVm`, `copyOut`, and `stageSourceTree` with a single shared exclude floor that callers may extend but never replace, and one definition of the rsync exit-24 tolerance.

- **`podkit-vm`, the single CLI chokepoint** — verbs `ensure`, `stage`, `status`, `stop`, `destroy`, `recover`, `shell`, `install`, `doctor`. Every start path in the repo funnels through it: TypeScript callers via the library, bash and mise via the binary. Developer-facing `bun run vm:*` scripts are thin wrappers over it.

- **The baseline-hash primitive** and the in-VM hash location.

### What stays in `@podkit/device-testing`

Everything domain-coupled: `DevicePersona` and `SystemState` registries, `apply-state.sh`, the FunctionFS gadget daemon, and the runners that reference those types. The dividing line is mechanical: **references a persona or a system state → domain; pure Lima mechanics → substrate.** In-VM Docker image build/pull has no persona or state coupling, so it is substrate.

`@podkit/lima` depends only on `@podkit/device-types` (for the `SubprocessRunner` interface) — never `@podkit/core`, which would drag native bindings and metadata libraries into every build script.

### Coordination is single-layer: the lock, and nothing else

The original design called for two layers — a turbo `ensure:<vm>` ordering node *plus* the lock. **The ordering node was rejected on investigation**, and the reason is worth recording because it is not obvious:

1. An ensure node is a side effect, so it must be declared `cache: false`. Turbo therefore runs it on **every** invocation — booting the builder VM even when all prebuilds are cache hits. That is a straight regression: slower on the common path, and it fails outright on a sleep-corrupted builder that the run did not otherwise need.

2. No single task can be the sole starter. Because turbo caches per task, `gpod-testing#build:linux-binary` can be a cache miss while `build:linux-prebuild` is a cache hit — so the VM would never be started. Both tasks genuinely need a start path.

The problem is therefore **mutual exclusion on the start, not ordering**. One lock, held by whichever caller gets there first, with everyone else waiting. No turbo DAG change, and lazy start is preserved.

### The lock's contract

**It guards VM starts.** Nothing else. Two builder tasks can still `rsync --delete` into the same VM-local directory concurrently — a separate hazard, tracked separately. Stating the boundary explicitly matters more than the boundary's exact position: the failure mode of a lock is someone assuming it covers more than it does.

**Its wait budget must clear the slowest legitimate hold, not the typical one.** A cold `limactl start` downloads a cloud image and runs cloud-init: five to ten minutes. The contender is usually a sibling turbo task that must simply wait. Giving up early converts "someone else is creating the VM" into a build failure — the exact race the lock exists to prevent. The budget is therefore roughly half an hour.

Waiting that long is safe **only because liveness bounds it**: a live holder refreshes the lockfile mtime on an interval, a dead one stops, and the lock is reclaimed within the staleness window. The budget is a ceiling for a *live* holder, never a penalty for a dead one.

This is not a hypothetical concern. An early revision configured the backoff with `factor: 1`, which pins every retry at `minTimeout` and makes `maxTimeout` dead configuration; the budget silently collapsed to a tenth of its documented value and a second starter gave up two minutes in while the first was still provisioning. The budget is now derived from the backoff constants by a function and pinned by a test, rather than asserted in a comment.

## Reconciliation with ADR-016

**ADR-016's architecture is preserved in full. No VMs were merged.** This ADR centralises orchestration and configuration *ownership*; it does not change what any VM is or what it contains.

### The physical VM separation is intact

`podkit-builder-glibc`, `podkit-builder-musl`, `podkit-device`, `podkit-test-glibc` and `podkit-test-musl` remain **distinct Lima instances with distinct provisioning**. The builders carry the dev toolchain; the device VM and the ABI-verify VM carry no Bun, no Node, no `node_modules`, no source tree and no `-dev` packages. ADR-016's cornerstone guarantee — that dev libraries on the host or in the build environment cannot mask a binary linkage problem, because the environment under test contains only what a real user has — is **untouched**. The binary still moves from builder to test environment as an artefact, never as a shared filesystem.

What changed is only that the five instances (plus the demo and ABI-verify VMs) are now *described* in one registry instead of two directory trees, and *started* through one locked code path instead of five hand-rolled ones.

Consolidating configs into a single directory is not the same as consolidating VMs, and the registry makes the separation more legible than the old split did: the `builder` / `device` / `test-runner` / `demo` / `abi` categories are now explicit metadata rather than a filing convention.

### ADR-016's instance names were renamed

ADR-016 names its VMs `podkit-linux-builder` and `podkit-device-harness`, and its yaml paths under `test-packages/device-testing/lima/`. Those are historical: ADR-016 is a record frozen at its decision time and keeps its original vocabulary. The current mapping is:

| Role | Current instance | ADR-016 called it |
|------|------------------|-------------------|
| Device-synthesis harness | `podkit-device` | `podkit-device-harness` |
| glibc builder | `podkit-builder-glibc` | `podkit-linux-builder` |
| musl builder | `podkit-builder-musl` | — (postdates ADR-016) |
| glibc test runner | `podkit-test-glibc` | — |
| musl test runner | `podkit-test-musl` | — |
| Demo | `podkit-virtual-ipod` | — (referred to only by yaml path) |
| Manual ABI check | `podkit-abi-verify` | — |

All seven YAMLs now live in `test-packages/lima/vms/`, named after their instance.

### "One recipe, two callers" holds

ADR-016 requires a single source of truth for the native build, shared between the Lima builder VM and the GitHub Actions workflows. That invariant is **unchanged and was a hard constraint on this work**:

- `tools/prebuild/*` — the in-VM build *recipes* — are untouched. They import nothing from `@podkit/lima` and have no Node or Bun dependency at their outer layer.
- CI (`prebuild.yml`, `build-platform.yml`) still invokes them **directly as bash, with no Lima involved**.
- Only the **host orchestration wrappers** — the "ensure the builder VM is up, rsync the tree in, run the recipe inside, copy the artefact out" scripts, which is where the race lived — became thin callers of `podkit-vm`.

The boundary is: recipes run *inside* a Linux environment and know nothing about how they got there; wrappers arrange that environment. Only the wrappers were consolidated.

### The demo VM's separation is honoured differently, and just as strictly

ADR-016 declared the virtual-iPod demo VM off-limits, and enforced it by directory (`tools/lima/` for the demo, `test-packages/device-testing/lima/` for test infrastructure). With all configs in one registry, that enforcement moves from filing convention to explicit scope: the demo VM is a `demo`-category **config entry only**. Its lifecycle stays with the `vipod:*` mise tasks and the in-VM `@podkit/virtual-ipod-server`, which are untouched. No test workload starts, stops or provisions it. If it ever grows a `test:vm`-style suite, that decision gets made on its own merits.

Turbo `inputs` reinforce this: VM-suite tasks hash `podkit-device.yaml` by name rather than globbing `vms/**`, so editing the demo VM's config cannot invalidate the test suite's cache.

### `podkit-abi-verify` remains manual and on demand

The stock-Debian `ldd` check ADR-016 describes is a real, documented manual verification. It is now a registry entry — reachable as `podkit-vm ensure abiVerify`, with its allowed and forbidden runtime library lists documented in its YAML header — and it is deliberately **wired into no CI job and no turbo task**. Formalising it into an automated linkage gate is a separate decision; being in the registry does not make it automatic.

## Consequences

### Positive

- **The start race is closed for every starter, present and future.** A new caller that wants a VM calls `podkit-vm ensure` and inherits the lock; there is no unlocked path left to copy.
- **A VM rename is one edit.** Instance names derive from the registry; a typo fails loudly with the list of known ids.
- **One exclude floor.** Callers extend it, never replace it, so a caller can only ever prune more than the floor — never accidentally less.
- **Lazy start is preserved.** Rejecting the turbo ensure node means a fully-cached build still boots no VM.
- **Decisions are unit-testable without a VM.** Every `limactl` call routes through an injected `SubprocessRunner`, so registry, lifecycle, transport, CLI dispatch and lock behaviour are all pinned against scripted output. The lock's actual two-process mutual exclusion — the one thing that cannot be faked — has a real subprocess integration test.
- **The demo VM's config is no longer homeless**, and its off-limits status is explicit rather than implied by directory layout.

### Negative / costs

- **A one-time destroy and re-provision.** Renaming instances and relabelling the baseline-hash inputs means every previously-sealed VM reads as drifted once. Paid deliberately, alongside the rename that already required it.
- **A one-time turbo cache invalidation** for every task that hashes a VM YAML.
- **Another package** in an already-large workspace, and a new `proper-lockfile` dependency. The existing device-sync pid-file lock in `@podkit/core` is deliberately *not* unified with it: different context (FAT32/exFAT device mass storage), different liveness model, chosen on purpose. Two locks, two contexts.
- **The lock's boundary is narrower than it looks.** Concurrent source staging into a shared VM directory is still unguarded. Documented, tracked, not fixed here.

### Constraints this creates for future contributors

- **Nothing in `@podkit/lima` may resolve a repo path at module load.** The package anchors on a marker substring in `import.meta.url`, which works from source and from the bundled output — but not from the compiled FunctionFS daemon, whose `/$bunfs/root/…` paths carry no source-tree marker and which transitively imports the registry. All anchoring must stay lazy, inside function bodies; the registry's `yamlPath` is an accessor for exactly this reason. This is a nasty constraint because nothing cheap catches a violation: unit tests, typecheck, lint and review all pass, and only a real VM run fails. A test pins the accessor.

- **`computeBaselineHash` takes an explicit list of tracked files, not a package root.** The device VM's baseline spans two packages — its YAML here, `apply-state.sh` in `@podkit/device-testing` — so a single-root signature is guaranteed to throw. The substrate owns the hashing primitive; the package that owns the non-YAML inputs composes the list and performs the comparison. Composing it in both places would mean two silently divergent copies.

- **In-VM scripts must be POSIX shell.** The guests' `/bin/sh` is dash on Debian and busybox ash on Alpine, so `set -o pipefail` is unavailable.

## Related Decisions

- [ADR-016](/developers/adr/adr-016-linux-vm-test-harness) — Linux VM test harness. Establishes the builder/test VM separation and the "one recipe, two callers" build invariant, both preserved here.
- [ADR-017](/developers/adr/adr-017-device-persona-fixtures) — Device persona + system state fixtures. The domain layer that stays in `@podkit/device-testing`.
- [ADR-025](/developers/adr/adr-025-canonical-test-taxonomy) — Canonical test taxonomy. Classifies the VM layer these instances serve.
- [ADR-026](/developers/adr/adr-026-dual-libc-linux-distribution) — Dual-libc Linux distribution. The distribution split that the per-libc builder and test-runner pairs serve, and the reason `archRelevance` is a registry field.

## References

- `test-packages/lima/README.md` — the substrate's operator manual: registry, CLI, lock, staging.
- `test-packages/lima/vms/` — all seven Lima configs.
- `tools/lima/README.md` — the cross-libc Linux test-suite runner.
- `documents/architecture/testing/vm-build-orchestration.md` — how `test:vm` guarantees binary freshness and detects baseline drift.
- `tools/prebuild/build-static-deps.sh`, `tools/prebuild/build-linux-glibc.sh` — the shared build recipes, unchanged by this ADR.
