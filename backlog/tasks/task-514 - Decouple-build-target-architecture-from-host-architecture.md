---
id: TASK-514
title: Decouple build target architecture from host architecture
status: In Progress
assignee: []
created_date: '2026-09-13 18:33'
updated_date: '2026-09-23 21:29'
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
- [x] #4 A build host is selected over the same link as a substrate, and may be a remote machine or localhost
- [x] #5 An amd64 build host can be driven from an arm64 macOS host end to end
- [x] #6 musl builds use the same build-host mechanism as glibc, via an Alpine container on the build host
- [x] #7 The device substrate still receives artifacts only — no source tree, no host mount
- [x] #8 test:vm passes on macOS with an arm64 substrate and with an amd64 substrate
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

---

## Half 2 landed. Three commits: `96cc47ed`, `644a7414`, `ad1d8fad`.

**Ticked: #4 and #6. Still open: #5 and #8, and both for the same reason — no macOS host was available.** The mechanism they name is proven; the platform they name is not.

### The shape

Five shell wrappers became **one driver plus a job table**. Each wrapper opened the same six steps — check for `limactl`, start a Lima instance, read `uname -m` out of it, look up a staging directory, rsync, run a guest script, copy artifacts back — and every one of those steps named `limactl`. That is what made a foreign build host impossible rather than merely unconfigured: "use a different box" meant writing five more scripts. The guest scripts are ported near-verbatim, including the `ldd` allow-list and the "do not execute the daemon, it is a poller with no fast-exit path" note.

**`SubstrateLink` gained `copyOut` and `stageTree`.** `copyOut` was deliberately absent, and its own doc said why: nothing needed it, and an unused direction is a second implementation to keep correct for free. A build host whose entire purpose is to produce bytes the host collects is that need arriving. `stageTree` is on the link for a sharper reason — it is the **one** operation whose mechanism genuinely differs by provisioner: Lima runs the rsync inside the guest against its own host mount, every other link pushes from the host over ssh. A driver written against the interface is blind to which it got, which is what makes "builder is a role" true rather than aspirational.

**Build-host selection is a separate resolver from substrate selection, not a mode of it.** They answer different questions about boxes whose contracts contradict each other, and the day they share a definition is the day the wrong box can satisfy either. The rule is one question — can this box produce `(arch, libc)` — with a tie-break: among capable builders, the one provisioned like the selected substrate wins. Capability alone settles the headline case (an arm64 Mac has no local builder that can produce amd64); the tie-break settles the case capability *cannot* — an amd64 host driving an amd64 remote substrate, where building locally would produce artifacts on a machine whose glibc floor nobody asserted anything about.

Half 1 left `podkit_assert_target_arch` refusing with *"run the build on a `<arch>` build host"* and naming no such host. That guard is gone; its sentence is now a selection, and when nothing can serve, the error names every candidate **with its reason** — verified by running it: `builderGlibc (rejected: it is a Lima instance on this x64 host, so it produces x64), builderRemote (rejected: it declares x64)`.

### What was actually run, on real hardware

Driven from the amd64 Linux dev box — which has `limactl` on PATH but **no `qemu-img`**, so it cannot host a Lima VM at all — against the Proxmox builder and substrate over plain ssh. A genuinely foreign build host, reached over the link, from a machine that cannot build locally.

| | Result |
|---|---|
| all five build jobs | produce their artifacts; glibc natively, musl in the Alpine container |
| second containerised run | re-stages cleanly (the root-owned-tree trap) |
| `test:vm` end to end | reaches the remote amd64 substrate with amd64 binaries built on the remote amd64 builder |
| e2e-vm suite | **176 pass, 44 skip, 9 fail** |
| musl static-deps cache | 4m51s cold → **41s warm** after the mount fix below |
| lint · typecheck 40/40 · unit · integration · build 22/22 · e2e 37/37 | clean |

The nine failures are **not** the build path and are filed as **TASK-523**: the mass-storage LUN never appears as a `/dev/sd*` node on that substrate. Ruled out by measurement — `substrate-doctor.sh` passes there (24 assertions), the synthesised backing files loop-mount correctly *on the substrate* (`loop0p1: TYPE="hfsplus"`), and 176 cells pass with the same binaries.

### Two defects the review caught that the box then confirmed

**The musl container never saw the caches.** `podman run` mounted only the staged tree, so the job's preamble created `STATIC_DEPS_DIR` inside a `--rm` container, rebuilt the whole static C-dep closure, and threw it away — five minutes a run, with nothing reporting that anything was wasted. Mounting it at the **same path inside and outside** is not cosmetic: `build-static-deps.sh` writes `.pc` files carrying an absolute `prefix=`, so a closure built under one mount point is unusable under another. Proven the hard way — the cache left by TASK-520's hand-run had `prefix=/cache/static-deps-musl` and produced `fatal error: gpod/itdb.h: No such file or directory` from a tree whose headers were plainly there. Now in the playbook.

**The job script relied on uids lining up between two machines.** A containerised job stages as root; whether the tree is then writable by the build user depends on `rsync -a` mapping the sending uid onto a local account. It does on the reference builder, which is why this worked twice before anyone noticed. The script now lands in `/tmp` — writable everywhere by definition — and is `sudo install`ed into place with an explicit mode.

### Scope decisions, stated rather than silent

- **AC #4 says "or localhost" and there is no localhost provisioner.** Deliberate: an `ssh` entry names how a box is *reached* and says nothing about where it is, so a `podkit-builder` alias with `HostName localhost` is a complete answer — same entry, same link, same contract, no in-process special case to keep correct. Documented in `.env.example` and the playbook rather than built.
- **AC #6's container is the remote path only.** The Lima path keeps its second VM, which is what doc-060 says ("musl on a *remote* builder means an Alpine container on that build host") and what macOS has to spare.
- **`PODKIT_SUBSTRATE` joined the cache key of the build tasks and both VM suites**, beyond what AC #2 asked for. Not optional: under turbo's strict env mode an undeclared variable does not reach the task at all, so `vm:install` could not have selected a remote substrate — and a cached "these passed" belongs to the box it was obtained on as much as to the architecture.
- **`vm:doctor` gained an early return** for a substrate that is not baseline-tracked, so a remote-substrate user reads "not baseline-tracked" rather than "the Lima instance is missing" about an instance they never asked for.
- **The plan's "Lima argv stays byte-identical" no longer holds.** `--omit-dir-times` is now on the in-guest rsync too. Deliberate and documented: the builder's staging root is root-owned and world-writable, and a plain `rsync -a` on it transfers the entire payload and *then* fails with exit 23.
- **Declined: per-provisioner capability data on the registry entry** to collapse the three `isLimaVm`/`isSshVm` cascades. The repo's own `createSubstrateLink` defends the exhaustive-switch pattern for the same discriminator, and the three sites ask genuinely different questions (capability, lifecycle, filesystem convention).
- **Declined: a `BuildRun` type** for the `(ctx, selection, link)` trio. A fair Data Clump reading, and the same argument TASK-520 used to decline bundling `(arch, libc)`: a shape guessed ahead of its only caller.

Also taken from the review: `transport.ts` → `link-adapters.ts` (CONTEXT.md reserves "transport" for how the *product* reaches an iPod's firmware, and the file is now unambiguously link code); `FILE_COPY_TIMEOUT_MS` moved beside the link interface rather than restated in the driver; the six copies of the "non-zero exit → link failure or guest refusal" ladder collapsed into one `settleLinkResult` taking the per-link classifier; the in-flight artifact name dot-prefixed so a run killed mid-copy cannot strand a file matching the task's own output glob.

### Residual risk

The driver's six-step orchestration has no unit test. The job table, the link operations and the selection resolver each do; what is uncovered is the glue, and it is covered instead by the real runs above — over the ssh link only. **The Lima half of the driver is exercised by nothing automated on this machine**, which is the same gap #5 and #8 name.

## Closed from an arm64 Mac. Three defects the Linux-driven runs could not see.

`#5` and `#8` needed no new mechanism, as the handoff predicted — but they did need three fixes, every one of them invisible from the amd64 Linux box the earlier halves were driven from.

### What ran

| | Result |
|---|---|
| `test:vm`, Lima arm64 substrate, nothing configured | **194 pass, 44 skip, 0 fail** |
| `test:vm`, `PODKIT_SUBSTRATE=deviceRemote` (amd64 over ssh) | **176 pass, 44 skip, 9 fail** — the same nine, and only those nine |
| lint · typecheck 40/40 · test 69/69 tasks · e2e 37/37 | clean |

The nine are TASK-523's, reproduced byte-for-byte from a different driving host and a different host architecture — and the arm64 substrate has **zero** failures, which settles what 523's note asked: they are substrate behaviour, not architecture. The amd64 half of `#8` is ticked on that basis; `test:vm` still exits 1 there until 523 lands.

Build hosts behaved as designed with nothing configured, both ways: Lima picked `builderGlibc` as the substrate's sibling; the remote run picked `builderRemote` on capability alone and announced the target. The x64 binaries built here sha256-match the ones TASK-520's hand-run produced on the builder.

### 1. The build driver could be scheduled before the package it imports exists

`build:linux-prebuild`, `build:musl-prebuild` and `gpod-testing#build:linux-binary` declared `dependsOn: []`. Half 2 made the driver TypeScript that imports `@podkit/substrate` and `@podkit/lima`, and both resolve to `dist/` — so turbo was free to run the job while those dists were half-written. It did, on a cold tree: `SyntaxError: Export named 'resolveDefaultPodkitDebugMuslBinary' not found` from a module that is plainly correct in source.

Their two `*-binary` siblings were fine all along: `@podkit/device-testing` depends on both packages, so `^build` already ordered them. `@podkit/gpod-testing` depends on neither — it reaches across package boundaries by relative path — so no workspace edge could ever have covered it. The three now name the edge, and the rule is in `vm-build-orchestration.md` §4 rather than only in a comment.

Why it never appeared before: a warm `dist/` hides it completely, and every prior run of this work was on a tree that had one.

### 2. The wrapper stamped the HOST's architecture over the substrate's

The real reason `test:vm` built arm64 for an amd64 substrate. `targetArch()` is env-then-host by design, and the turbo wrapper materialised that into `PODKIT_TARGET_ARCH` — which is `configured` precedence, and therefore **beats the substrate** in every child process. So the wrapper did not merely fail to help: it overrode the entry points that probe the link and would otherwise have been right.

The fix keeps the no-probe invariant the module argues for at length, because an ssh substrate does not have to be *asked*: it **declares** `targetArch` in the registry. `declaredSubstrateMachine()` (new, in `selection.ts`) answers from data already in hand — no link, no round trip, no substrate running — and a Lima substrate correctly declares nothing, since its architecture *is* the host's. Precedence, error text and the ELF assertion at transfer are unchanged; a wrong registry entry still fails loudly there.

### 3. No ssh link could authenticate under turbo

`SSH_AUTH_SOCK` was not in `globalPassThroughEnv`, and turbo's strict env mode does not pass what is not declared. Every ssh-reached substrate and builder got `Permission denied (publickey)` from a host that `ssh podkit-substrate true` reaches from the same shell one line earlier — with the error naming ssh, not turbo. Pass-through rather than `env`: the socket path is a fresh temp path per login and would invalidate every cached task on every reboot.

Invisible on the Linux box because its key is served differently; it is the Mac's 1Password-vs-agent split (already in the builder playbook) meeting a second gate nobody had reason to look for.

### From review

The wrapper's first cut caught **every** selection failure and fell back to the host. That is right for "this machine has nothing configured" and wrong for "configured, and wrong" — a typo'd `PODKIT_SUBSTRATE` would have built for the wrong machine and only been refused several tasks later, by a step that is fine. `SubstrateSelectionError` now carries `unconfigured`, set at exactly the one branch reached because nothing names a substrate, and the wrapper narrows its catch to it. Verified: `PODKIT_SUBSTRATE=deviceRemotee` now exits 1 in about a second, naming the variable and listing the known substrates.

Also from the review, checked and found sound: no other task runs the driver or imports those packages without an ordering edge; no reachable configuration produces a surprising architecture; the three docs match the code.

### Unrelated but needed on the way

The Lima substrate had drifted (the Proxmox commits changed the tracked contract scripts) and `podkit-substrate`'s host key had changed with the VM rebuild — the new keys were verified out-of-band through the PVE guest agent before being trusted, rather than accepted on sight.

### Known limitation, documented rather than fixed

`quality` runs the VM suites (for the substrate) and the host's own Docker suite (for this machine) under one `PODKIT_TARGET_ARCH`. With a cross-architecture substrate selected those two want different answers, and the host-Docker half looks for musl binaries the run did not build. One variable cannot serve both; `.env.example` says so and says to run the halves separately.
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

created: 2026-09-23 20:39
---
## Handoff: what a macOS host still has to prove

#5 and #8 are the only criteria left, and neither needs new code — they need an arm64 Mac.

With a Lima substrate and nothing configured, everything should behave exactly as before: `selectBuildHost` picks `builderGlibc`/`builderMusl` because they are the substrate's siblings and can produce arm64. Pinned by `build-host.test.ts`'s first case, unverified on hardware — and this is the half of the change most worth a careful eye, because the Lima path is the one no automated run here touched.

Then set `PODKIT_SUBSTRATE=deviceRemote` in `.env.local` and run `bun run test:vm`. Expect the driver to announce nothing and route to `builderRemote` on its own: no local Lima builder can produce x64 on that host, so capability decides before the tie-break is consulted. **That run closes #5 and the amd64 half of #8.**

Two things to watch, both cheap and neither yet observed:

1. **`.env.local` has to reach the task.** Bun loads it relative to the working directory, so `bun run --cwd test-packages/…` does *not* pick it up. Go through turbo (`bun run test:vm` from the repo root), which is how the variable enters the environment before turbo hashes it.
2. **The builder has to be running.** Nothing in this repo starts an SSH build host — that is TASK-515. The driver probes and prints what to do; `qm start <vmid>` on the PVE host is the manual equivalent, and the playbook's start-for-a-build / stop-after mode still applies.

Expect the same nine e2e-vm failures TASK-523 covers. They are substrate behaviour rather than architecture, so they should reproduce identically from a Mac — and if they do *not*, that is the most useful data point 523 could get.
---
<!-- COMMENTS:END -->
