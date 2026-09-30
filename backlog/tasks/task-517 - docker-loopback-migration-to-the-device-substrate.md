---
id: TASK-517
title: docker-loopback migration to the device substrate
status: Done
assignee: []
created_date: '2026-09-13 21:57'
updated_date: '2026-09-30 21:17'
labels:
  - testing
  - infrastructure
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-494
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
modified_files:
  - test-packages/device-testing/scripts/substrate-contract.sh
  - test-packages/device-testing/src/runners/shipped-image.ts
  - test-packages/device-testing/src/runners/shipped-image.test.ts
  - test-packages/device-testing/src/index.ts
  - test-packages/device-testing/src/preflight.ts
  - test-packages/device-testing/src/capabilities.ts
  - test-packages/device-testing/scripts/run-mirror-body.ts
  - test-packages/e2e-vm-tests/src/vm-docker-loopback/harness.ts
  - >-
    test-packages/e2e-vm-tests/src/vm-docker-loopback/device-add-trust-disk.docker-loopback.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - test-packages/e2e-vm-tests/package.json
  - test-packages/e2e-vm-tests/bunfig.toml
  - test-packages/e2e-tests/package.json
  - test-packages/lima/src/index.ts
  - test-packages/lima/README.md
  - turbo.json
  - package.json
  - docs/architecture/testing/taxonomy.md
  - docs/agents/docker.md
  - docs/agents/testing.md
priority: medium
type: task
ordinal: 273500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-494, where it was an acceptance criterion that turned out to be a task in its own right.

ADR-028 §4 splits the two Docker surfaces by privilege: the unprivileged Navidrome sidecar stays local, while `test:e2e:docker-loopback` — which runs `--privileged` and `mknod`s 64 loop devices — goes to the substrate. TASK-494 delivered the substrate abstraction but not this migration, and the reason is worth recording rather than rediscovering.

**It is not a re-homing of one test file.** `docker-loopback` lives in `@podkit/e2e-tests`, runs the **musl** image against the **host** container runtime, builds it via `ensurePodkitImageOnHost`, and pulls the whole host-oriented `src/docker/` tree — registry, labels, orphan cleaner — along with it. The substrate ships **nerdctl + containerd** rather than Docker, and its image path (`ensurePodkitImageInVm`) builds a different, **glibc** artifact.

So migrating means re-homing four things across a package boundary: the image provenance (which libc, built where, by which runtime), the privileged-container invocation, the 64 `mknod`s, and the fixture transfer. Done carelessly it breaks a macOS path that is green today.

Until this lands, `docs/architecture/testing/taxonomy.md` says where `docker-loopback` actually runs rather than where ADR-028 intends it to — deliberately, because a taxonomy documenting an unperformed migration is worse than one admitting the gap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docker-loopback runs on the device substrate rather than the host container runtime
- [x] #2 The libc and image provenance of the artifact it exercises is explicit and correct for the substrate's runtime
- [x] #3 The privileged invocation and the 64 loop-device mknods work under the substrate's container runtime
- [x] #4 The macOS path that is green today is still green, or its removal is a deliberate documented decision
- [x] #5 taxonomy.md is updated to describe where the cell actually runs once it moves
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

- **Contract:** `podman` joins `SUBSTRATE_PACKAGES`. Bookworm apt, pulls no -dev/toolchain package (doctor verified). Rootful, because the cell needs `--privileged`.
- **Image build/pull** moved from `@podkit/lima/src/docker-image.ts` (raw `limactl`, `imageArch` defaulting to arm64) to `device-testing/src/runners/shipped-image.ts` over `SubstrateLink`. Runtime is a required parameter (`podman` | `nerdctl`, services per runtime in one table). Image arch = the run's target arch, and the build refuses when the link's `uname -m` disagrees. `imageArch`, `vmName`, `subprocess` options dropped. `SUBSTRATE_CONTRACT_RUNTIME` exported.
- **Cell** moved to `e2e-vm-tests/src/vm-docker-loopback/` (`vm-docker-image` · `local-dir` · `loopback-fat`). Harness drives `sudo podman` over the link. Sweeps leaked containers (by label) and leaked loop devices (by backing-file prefix `/tmp/podkit-loopback-`) before start and after stop. The duplicated SysInfoExtended fixture is replaced by `ipodNano3gBlack.sysInfoExtendedXml`. The host-Docker path (`ensurePodkitImageOnHost`, `podkit-image.ts`) is deleted.
- **Gate:** turbo task depends on `build:musl-binary` + `vm:doctor` (not `vm:install`). Root `test:e2e:docker-loopback` goes through the turbo wrapper, so it takes the run lock. Mirror body runs phase 2's two cells sequentially (both attach loop devices in one kernel).
- docker-dist passes `runtime: 'nerdctl'` and is otherwise untouched (TASK-530).

## Verified (Linux dev host → remote amd64 substrate `deviceRemote`)

- Contract applied, `substrate-doctor` PASS, `harness:seal` resealed + retook `podkit-provisioned` snapshot.
- `vm:doctor` correctly failed the run on the pre-seal drift.
- `bun run test:e2e:docker-loopback` 3/3 pass (twice, the second after review fixes). No containers or loop devices left after.
- A planted leaked labelled container + attached loop was swept by the next run.
- Built image: musl, x86_64, current CLI version.
- Unit 424/424 (device-testing), lima 194, `bun run test` 69/69 tasks, typecheck 40/40, lint clean.

## Not verified — why AC #4 is unticked

The host-Docker macOS path is removed deliberately and documented in taxonomy.md §4 ("empty by decision"). The **replacement** macOS path has not been run:
- Lima `podman` loopback run: the Mac's `podkit-device` needs `bun run harness:setup` to pick up podman first. `vm:doctor` will demand it.
- docker-dist on Lima, now via the limactl `SubstrateLink` instead of raw `limactl`.

## Follow-ups

TASK-530 (docker-dist → podman), TASK-531 (retire host-arch musl build; still-stale `required-arches.ts` header, `.env.example`, `vm-build-orchestration.md`), TASK-532 (capability probe is Lima-only, so a remote-substrate run reports this cell uncovered).

## AC #4 — verified on the Mac (2026-09-30)

- `harness:setup` picked up podman (4.3.1) on `podkit-device`. The VM was then recreated with Lima's containerd disabled (TASK-530), so it has **no** nerdctl/containerd.
- `PODKIT_SUBSTRATE=device bun run test:e2e:docker-loopback`: 3/3 pass. No containers or loop devices left behind.
- docker-dist on Lima over the limactl SubstrateLink, now on podman: 6/6 pass.
- On the first attempt the test task ignored the command-line `PODKIT_SUBSTRATE=device`. Turbo's strict env mode dropped it, so the test re-read `.env.local` (`deviceRemote`), while `vm:doctor` had checked Lima. Both shipped-image tasks now declare `PODKIT_SUBSTRATE`/`PODKIT_TARGET_ARCH`. The fix is in TASK-531's commit.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-29 21:43
---
Premises corrected before starting (agreed with the user):

- The in-substrate image is **not** glibc: `buildPodkitImageInVm` already stages the musl binaries into the same `alpine:3.21` Dockerfile. Provenance differs only in architecture (host's vs substrate's) and build location.
- `buildPodkitImageInVm`/`pullPodkitImageInVm` were never ported onto `SubstrateLink` — they call `runLimactl` directly and default `imageArch` to arm64.
- The remote substrate has **no** container runtime. nerdctl on the Lima VM is Lima's default containerd feature, not the substrate contract.

Plan: declare `podman` in the substrate contract (bookworm apt, no -dev/toolchain deps); port image build/pull onto SubstrateLink parameterised by runtime and arch; move the cell to `@podkit/e2e-vm-tests` as `vm-docker-image` · `local-dir` · `loopback-fat`; docker-dist stays on nerdctl (follow-up). Retiring the host-arch musl build (TASK-524) is a follow-up.
---
<!-- COMMENTS:END -->
