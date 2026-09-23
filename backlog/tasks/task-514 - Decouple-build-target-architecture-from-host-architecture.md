---
id: TASK-514
title: Decouple build target architecture from host architecture
status: In Progress
assignee: []
created_date: '2026-09-13 18:33'
updated_date: '2026-09-23 19:30'
labels:
  - testing
  - infrastructure
  - build
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-494
references:
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - test-packages/lima/src/binary-paths.ts
priority: high
type: enhancement
ordinal: 274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 4 of doc-060. The slice with the unknown cost — sequenced after TASK-494 so it lands on a stable `SubstrateLink`.

Today `vmArch()` is literally `process.arch` mapped to a filename suffix, and seven resolvers call it. That one function is why an arm64 macOS host cannot produce artifacts for an amd64 substrate — not slowly, but not at all — which in turn is why host and substrate were going to be pinned to the same architecture.

**Replace it with a substrate-derived `targetArch()`**, resolved from what the selected substrate reports, with host arch only as the default when no substrate is selected.

**Make target arch a declared build-task input.** This is the load-bearing detail: the artifact filenames already carry the arch, so the outputs are distinct, but the *cache key* is not — a cached arm64 binary would be served to an amd64 run. That failure is a silently wrong artifact, not an error.

**Assert artifact arch equals substrate arch before transfer**, as the backstop for a cache key that is wrong anyway. Without it the symptom is an exec-format error partway through a test run.

**Builder becomes a role over the same link.** A build host may be a Proxmox builder VM, an existing amd64 machine (the Linux dev box qualifies — it cannot host a substrate but it can build), or localhost. Source staging is rsync over the link, which is what Lima staging already does underneath. The device substrate keeps its no-host-mount invariant and continues to receive artifacts only.

**glibc and musl migrate together.** The build-host role carries `(arch, libc)`; musl on a remote build host means an Alpine container there. Doing glibc now and musl later means shipping a third build path and then deleting it — and musl is the libc the Docker image actually ships, so leaving it behind leaves the shipped artifact least covered.

Expect the cost to concentrate in two places: the turbo cache keying above, and the per-arch native prebuild that `compile.sh` embeds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 targetArch() resolves from the selected substrate, with host arch only as the no-substrate default; vmArch() is gone
- [x] #2 Target arch is a declared input of every task producing a linux binary, so a foreign-arch cache hit is impossible
- [x] #3 Artifact arch is asserted equal to substrate arch before transfer, with a named error
- [ ] #4 A build host is selected over the same link as a substrate, and may be a remote machine or localhost
- [ ] #5 An amd64 build host can be driven from an arm64 macOS host end to end
- [ ] #6 musl builds use the same build-host mechanism as glibc, via an Alpine container on the build host
- [x] #7 The device substrate still receives artifacts only — no source tree, no host mount
- [ ] #8 test:vm passes on macOS with an arm64 substrate and with an amd64 substrate
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Half 2 plan (build host over the link)

1. **`@podkit/substrate/stage-tree.ts`** — lift `DEFAULT_STAGE_EXCLUDES` and the rsync mechanics out of `@podkit/lima`'s transport. Two forms of the same command: in-guest (Lima, host-mounted source) and host-side `rsync -e ssh` (every other link).
2. **`SubstrateLink` gains `copyOut` and `stageTree`.** `copyOut` was deliberately absent because nothing needed it; a builder that produces artifacts the host must collect is that need. `stageTree` is the one operation whose *mechanism* genuinely differs per provisioner, which is why it belongs on the link rather than above it.
3. **Staging-area registry moves to `@podkit/substrate`**, re-exported from `@podkit/lima`, and gains `builderRemote` areas. Same argument as the binary-paths move: a directory on a Proxmox guest is not a Lima fact.
4. **`@podkit/substrate/build-host.ts`** — build-host selection, the mirror of `selection.ts`. `PODKIT_BUILD_HOST` → a builder that can produce `(targetArch, libc)` → error naming the step. This is where half 1's `podkit_assert_target_arch` dead end ("run the build on a <arch> build host") becomes a selection instead of a refusal.
5. **One TypeScript build driver + job table** replacing the five near-identical bash wrappers. Guest script bodies ported verbatim; the Lima argv stays byte-identical and is pinned by unit tests over the recording runner (Seam 1).
6. **musl over ssh = the Alpine container** on the glibc builder, per doc-060. Same driver, same job, one wrapper around the guest command.
7. **`vm:install` stops hard-coding Lima** — it resolves the selected substrate like every other harness entry point. Required for AC #8's second half.
8. Docs: builder playbook ("before the driver exists" is now "the driver"), vm-build-orchestration, `.env.example`, CONTEXT.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split in two. **Half 1 (done):** target architecture stops being derived from host architecture. **Half 2 (open):** a build host reached over the link can produce foreign-arch artifacts — now a Proxmox builder VM per ADR-029 §4 and TASK-520, not an arbitrary second machine.

`binary-paths.ts` moved to `@podkit/substrate`, because the architecture in those filenames is a property of the box the artifact must *start on*, not of the provisioner that made the box. `@podkit/lima` re-exports all seven resolvers, so no call site changed. `vmArch()` is gone rather than re-exported.

**The bootstrapping boundary is the design's load-bearing part.** `targetArch()` is synchronous and never probes — it reads the env var and falls back to the host. Several path resolvers run inside turbo tasks where no link exists, and one runs *before* the command that starts the substrate, so a hidden probe would turn `test:vm` into "fails because the VM is not started". `primeTargetArchFromSubstrate()` is the async half, called once by an entry point that already holds a link.

The env var is the carrier rather than a module-level cache because the consumers are not all in-process: the turbo tasks that compile are child processes, and the same value must both reach them and be hashed into their key. Precedence is configured → substrate → host, and a configured value contradicting the substrate throws rather than picking a winner — both are somebody's deliberate statement, and a build satisfying neither is worse than one that does not start.

**Cache-key coverage was enumerated by `outputs` globs, not by task name.** That found the gap: `@podkit/device-testing-daemon#build` produces `dist/dummy-hcd-daemon-linux-*` and declared no arch at all. Verified by the lead that the daemon task's hash moves with target arch (`714d677593a378ee` vs `d34a06a6bf983b7f`) while its dependencies' hashes correctly do not.

Deliberately excluded: `compile`/`compile:debug` (host-native; the Linux path invokes `compile.sh` inside the builder VM, never through the host turbo task) and `@podkit/libgpod-node#build` (host-native addon; its Linux outputs come from the prebuild tasks).

**The arch assertion reads the ELF `e_machine` field, not the filename** — every failure mode here produces a correctly-*named* file with the wrong bytes in it. It runs *before* the sha256 idempotency check, deliberately: a substrate swapped for one of the other architecture still holds the previous host's binary at the destination, and sha-matching first would skip the install and leave something that cannot start.

Two scope extensions the implementer flagged, both of which I accepted:

1. A turbo wrapper (`test-packages/substrate/scripts/turbo.ts`) materialises the value, because declaring the variable without setting it leaves `test:vm` hashing identically for both architectures — the same wrong key this task exists to fix. Root `test:vm`, `test:e2e:docker-dist` and `quality` route through it.
2. The two cached VM suites declare the arch too. They do not produce a Linux binary, but a cached "these passed" belongs to the architecture it was obtained on.

**Seam left for half 2:** `resolveTargetArch` already takes the substrate's machine type as a parameter, so pointing builds at a builder means calling `primeTargetArchFromSubstrate` with a builder's link. The builder is already addressed by registry id in the build scripts, and the new `podkit_assert_target_arch` guard is exactly where a remote builder becomes legitimate — today it refuses a foreign target and says "run the build on a &lt;arch&gt; build host", which half 2 makes actionable. The cache key is already correct for a foreign target, and the assertion is transport-agnostic.

Flagged, not fixed: `@podkit/libgpod-node#build`'s `prebuilds/**` output glob overlaps the Linux prebuild tasks' outputs. Pre-existing, and only matters with a cross-machine remote cache.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-14 20:16
---
Half 1 landed and verified by the lead: lint clean, typecheck 40/40, unit 44/44, integration 31/31, build 22/22, `test:vm` green. 24 files, 9 arch declarations across the six build tasks, the daemon build and both cached VM suites.

Half 2 is reshaped by the builder decision. It was written as "a build host may be a Proxmox builder VM, an existing amd64 machine, or localhost" — still true as a role, but the *reference* implementation is now a Proxmox builder VM (ADR-029 §4), because the end state has to work for a developer whose only other hardware is a hypervisor. That makes half 2 depend on TASK-520 (builder contract + builder VM) rather than on whatever amd64 box happens to be reachable.

AC #8 as written wants `test:vm` passing against both an arm64 and an amd64 substrate. Only the arm64 half is ticked. The amd64 half is the real acceptance test for the whole decoupling effort, and it needs 520's builder and the substrate's host key trusted — both in progress on the human side.
---
<!-- COMMENTS:END -->
