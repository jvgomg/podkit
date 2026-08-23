---
id: TASK-480.03
title: >-
  P2 — consolidate VM configs into the registry + rename instances + fix
  computeBaselineHash (MF3)
status: In Progress
assignee: []
created_date: '2026-08-23 13:31'
updated_date: '2026-08-23 21:45'
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
- [x] #1 All 7 VM YAMLs live in packages/lima/vms/ behind the typed registry (single source of truth); tools/lima/ + device-testing/lima/ no longer hold VM configs
- [x] #2 Instances renamed per the D12 scheme (podkit- prefix kept); registry ids are clean TS identifiers
- [x] #3 Every turbo `inputs` glob + instance-name literal that referenced an old path/name is repointed
- [x] #4 computeBaselineHash signature changed to explicit absolute tracked-file paths; both callers (harness + vm-doctor) updated; declaration order preserved; `bunx turbo run @podkit/device-testing#vm:doctor` no longer crashes and correctly detects drift
- [x] #5 After a one-time re-provision, `harness:setup` + a full `test:vm` are green against the renamed/registry-owned VMs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
LOCATION CORRECTION (supersedes the description): the registry + YAMLs live under **test-packages/lima/** (e.g. test-packages/lima/vms/), NOT packages/lima/. See amended D6 in backlog/drafts/vm-harness-decisions.md.

## Outcome

All 7 VM YAMLs moved to `test-packages/lima/vms/` via `git mv` (history preserved), registry updated, instances renamed per D12, MF3 landed, and every turbo input glob + instance-name literal repointed across ~26 files.

**Registry `id` change beyond the plan:** the virtual-iPod entry's id went `demo` → `virtualIpod` (the implementation plan specifies `virtualIpod`; `id: 'demo'` alongside `category: 'demo'` was redundant). `LIMA_DEVICE_HARNESS_VM_NAME` keeps its exported name as a shim but is now derived from the registry rather than restating a literal.

## MF3 — final shape

```ts
export interface TrackedBaselineFile { label: string; absPath: string }
export function computeBaselineHash(trackedFiles: readonly TrackedBaselineFile[]): BaselineHashResult
```

`@podkit/lima` owns the primitive (list of absolute paths in → one combined digest out); `@podkit/device-testing` owns composition via a new `deviceBaselineFiles()`, because it owns `apply-state.sh`. Order preserved (yaml, then apply-state.sh); the combined hash still folds in `${label}:${sha256}\n` so a reorder stays visible; missing-file still throws, and an empty list now throws too. Labels are basenames derived from the paths rather than repeated literals. Both callers updated; `vm-doctor.ts` also needed `f.relPath` → `f.label` in its drift output, which would otherwise have printed `undefined` for every drifted file.

The combined hash shifted once as a result — expected, and paid alongside the re-provision the renames already required.

## Bunfs hazard

The lazy path-resolution invariant is intact and now **pinned by a test** (`registry.test.ts` asserts `yamlPath` is still a getter, not a value). An independent review traced the FunctionFS daemon's full static-import graph from `device-testing-daemon/src/main.ts` and confirmed no module-load path resolution reaches the compiled bundle; the one eager site (`harness.ts`) is a standalone script nothing imports.

## Verification (real VMs, cold)

Destroy + re-provision was chosen over `limactl rename` so the relocated YAMLs are proven to provision from scratch rather than left unexercised. All four pre-existing instances deleted; `podkit-device`, `podkit-builder-glibc` and `podkit-builder-musl` all cold-created from their new locations.

- `harness:setup` — green; 4 binaries + systemd unit installed, all 4 kernel modules loaded; **baseline sealed across 2 files spanning both packages** (`8c4b4a4b342b…`) — the exact path that would have hard-crashed under the old single-`packageRoot` signature
- `vm:doctor` — `baseline OK (8c4b4a4b342b...; 2 files tracked)`
- `test:vm` — **232 pass / 0 fail** (38 device-testing + 194 e2e-vm-tests), matching the P1 baseline
- `test:e2e:docker-dist` + `docker-loopback` — **9 pass / 0 fail**
- lint 0/0, typecheck 38/38, build 21/21, test:unit 41/41 tasks
- turbo inputs verified from the resolved hashed-input lists (`--dry=json`), not just the declarations, since a glob matching nothing fails silently as a stale cache hit

`test:vm` and `docker-dist` inputs were narrowed from `vms/**` to `podkit-device.yaml`: the old `device-testing/lima/**` glob matched 4 files, whereas `vms/**` now matches all 7, so a virtual-iPod demo yaml edit would have busted the full VM suite's cache. The builder yamls still propagate through the `vm:install → build:linux-binary → build:linux-prebuild` chain, each of which declares its own.

## Two pre-existing defects surfaced (not caused by P2, both filed)

1. **Cold-start ordering** — `build-gpod-tool-linux.sh` refuses to create the glibc builder and aborts the turbo run when it doesn't exist, racing `build:linux-prebuild` which does create it. Invisible while every dev machine already had `podkit-linux-builder`; the rename made every host cold. Recorded on TASK-480.04 with a new acceptance criterion.
2. **`bunx podkit-vm` does not resolve** — no `node_modules/@podkit`, no linked workspace bin; bunx falls through to npm and 404s. This invalidates the P3 plan text, which specifies `bunx podkit-vm` in ~7 places. Recorded on TASK-480.04.

Also filed: TASK-482 (device-testing unit tests never execute) and TASK-483 (VM persona-daemon flakes under `quality`'s parallelism).

## Not green

Full `bun run quality` is still red — `@podkit/e2e-vm-tests#test:vm` fails non-deterministically under the DAG's host-wide parallelism (4 failures on one run, a different 3 on the next; 194/0 standalone). Tracked as TASK-483 and not attributable to this change.

Uncommitted pending maintainer review.
<!-- SECTION:NOTES:END -->
