---
id: TASK-524
title: 'Build every architecture a run needs, not just the one it targets'
status: To Do
assignee: []
created_date: '2026-09-23 21:52'
updated_date: '2026-09-23 21:52'
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
- [ ] #1 A run whose host architecture differs from the selected substrate's produces musl artifacts for both architectures, each built on a build host capable of producing it
- [ ] #2 A run whose host and substrate architectures agree produces exactly one set of musl artifacts, starting no build host it would not have started before
- [ ] #3 `test:e2e:docker-loopback` and `test:e2e:docker-dist` both find the musl binaries they need in a single cross-architecture run
- [ ] #4 Host architecture is part of the cache key of every task whose required outputs depend on it, so two dev hosts of different architectures sharing one substrate cannot replay each other's artifacts
- [ ] #5 The set of architectures a run resolves as required is covered by unit tests, including the same-arch and cross-arch cases
- [ ] #6 `.env.example` and docs/architecture/testing/vm-build-orchestration.md state the "every architecture the run needs" rule, and the interim note telling the reader to run the two docker tasks separately is gone
<!-- AC:END -->
