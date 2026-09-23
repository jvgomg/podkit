---
id: TASK-524
title: 'Build every architecture a run needs, not just the one it targets'
status: In Progress
assignee: []
created_date: '2026-09-23 21:52'
updated_date: '2026-09-23 22:07'
labels:
  - testing
  - infrastructure
  - build
milestone: m-20
dependencies:
  - TASK-514
references:
  - docs/architecture/testing/vm-build-orchestration.md
  - test-packages/device-testing/src/build-jobs/jobs.ts
  - test-packages/e2e-tests/src/docker/podkit-image.ts
priority: medium
ordinal: 294000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`PODKIT_TARGET_ARCH` is a single value, but a quality run has **two** architecture roles, not one.

Most surfaces want the substrate's architecture — `test:vm` and `test:e2e:docker-dist` both run on the box the substrate provides. One surface does not: `test:e2e:docker-loopback` builds and runs a podkit image on *this machine's* Docker, so it wants the host's architecture, and `nativeImageArch()` is written that way on purpose.

Those two are siblings inside one turbo invocation, and the musl build produces exactly one architecture per run. When host and substrate architectures agree — which is every setup that has ever existed — nothing notices. When they differ, which TASK-514 made reachable, no value of the variable satisfies both and the run is internally unsatisfiable: whichever surface loses looks for a musl binary the run did not build.

This is the one cell that stops an arm64 Mac from switching freely between a local Lima substrate and the remote amd64 one. Everything else about that switch already works and is proven on hardware; this is what remains.

The rule the build should follow is "produce every architecture this run needs" rather than "produce the architecture this run targets". Both build hosts required already exist and selection already resolves them correctly without changes — an arm64 Mac driving an amd64 substrate has `builderRemote` for amd64 musl and the local `builderMusl` VM for arm64 musl. The artifact filenames already carry the architecture, so both sets can coexist and the existing output globs already match them.

Note for whoever picks this up: a fully green `quality` on the cross-architecture setup also needs TASK-523, which is unrelated to this and about the substrate's mass-storage LUNs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A run whose host architecture differs from the selected substrate's produces musl artifacts for both architectures, each built on a build host capable of producing it
- [x] #2 A run whose host and substrate architectures agree produces exactly one set of musl artifacts, starting no build host it would not have started before
- [x] #3 `test:e2e:docker-loopback` and `test:e2e:docker-dist` both find the musl binaries they need in a single cross-architecture run
- [x] #4 Host architecture is part of the cache key of every task whose required outputs depend on it, so two dev hosts of different architectures sharing one substrate cannot replay each other's artifacts
- [x] #5 The set of architectures a run resolves as required is covered by unit tests, including the same-arch and cross-arch cases
- [x] #6 `.env.example` and docs/architecture/testing/vm-build-orchestration.md state the "every architecture the run needs" rule, and the interim note telling the reader to run the two docker tasks separately is gone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed in 2e4d3b45.

**The rule.** New `test-packages/substrate/src/required-arches.ts`:
`resolveRequiredArches({libc, targetArch, hostArch})` returns one
requirement per architecture the run must produce. glibc → the target's
alone (every glibc consumer is inside the substrate, so widening it would
start a second build host for artifacts with no reader). musl → the
target's, plus the host's when they differ. The target is always first, so
a run that cannot build for the substrate fails before spending minutes on
the host's set. `requiredArches(libc, env)` is the env-reading wrapper,
mirroring the existing `resolveTargetArch`/`targetArch` split.

**The driver.** `build-artifacts.ts` makes one pass per requirement. All
passes are *planned* first — build-host selection for each, then the
artifact paths they will write — so a missing build host for the second
architecture fails in a second rather than after the first has compiled.
`selectBuildHost` gained an optional `arch` so each pass selects its own
box; nothing else in selection changed.

**Per-pass artifact paths.** `jobs.ts` resolves every host path through the
new `envForTargetArch(ctx.arch)` rather than the ambient environment, so a
pass cannot name another pass's files. `assertDistinctArtifactPaths`
refuses a two-architecture run whose passes collapse onto one path — which
is what an absolute `PODKIT_*_BINARY` override does, since every resolver
honours it ahead of the architecture, and the second pass would silently
overwrite the first.

**Cache key.** `PODKIT_HOST_ARCH` (new, stamped by `scripts/turbo.ts`
alongside the target) joins the `env` of `build:musl-prebuild` and
`build:musl-binary` only — those are the two tasks whose output set is a
function of the host. Without it two dev hosts of different architectures
sharing one substrate hash identically while producing different sets.

**Announcement.** The "not provisioned the same way as the selected
substrate" notice is suppressed on the host-docker pass: there it is the
expected state, and its remedy (pin `PODKIT_BUILD_HOST`) would break the
other pass. The requirement's own reason is logged instead.

**Verification.** `bun run test` (69 tasks), typecheck and lint green; 11
new unit tests for the resolver (same-arch, cross-arch, glibc-untouched,
alias normalisation, unsupported arch) and 4 for the jobs table. Cross-arch
build-host selection verified by simulation on an arm64 host with
`PODKIT_SUBSTRATE=deviceRemote`: x64 → builderRemote (Alpine container),
arm64 → builderMusl, distinct staging directories.

**Not yet executed:** a real `quality` run on the cross-architecture setup.
That needs the amd64 substrate reachable and, per this task's own note,
TASK-523 for the substrate's mass-storage LUNs.
<!-- SECTION:NOTES:END -->
