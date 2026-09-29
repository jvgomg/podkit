---
id: TASK-531
title: Retire the host-architecture musl build now that no host surface consumes it
status: To Do
assignee: []
created_date: '2026-09-29 21:55'
labels:
  - testing
  - infrastructure
  - build
milestone: m-20
dependencies:
  - TASK-517
references:
  - test-packages/substrate/src/required-arches.ts
  - test-packages/substrate/scripts/turbo.ts
  - test-packages/device-testing/scripts/build-artifacts.ts
  - turbo.json
  - .env.example
  - docs/architecture/testing/vm-build-orchestration.md
priority: low
type: chore
ordinal: 301000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-517.

TASK-524 made the musl build produce the **host's** architecture in addition to the target's, for one consumer: `test:e2e:docker-loopback`, which built the shipped image on the host's Docker. TASK-517 moved that cell into the substrate, where it builds for the substrate's architecture. So the `host-docker` consumer in `resolveRequiredArches` no longer has a reader. On a cross-architecture setup (an arm64 Mac driving the amd64 remote substrate), every run compiles a second musl set that nothing uses.

Stale references to remove or rewrite, all describing the loopback cell as building on this machine's Docker:
- `test-packages/substrate/src/required-arches.ts` (the module header, the `host-docker` consumer, its reason string; it also cites the deleted `e2e-tests/src/docker/podkit-image.ts`)
- `.env.example` around the `PODKIT_TARGET_ARCH` notes, plus the `PODKIT_HOST_ARCH` paragraph
- `turbo.json`: the `PODKIT_HOST_ARCH` env entries and comments on `build:musl-prebuild` / `build:musl-binary`
- `test-packages/substrate/scripts/turbo.ts`, which publishes `PODKIT_HOST_ARCH`
- `docs/architecture/testing/vm-build-orchestration.md` (~line 110)
- comments in `build-artifacts.ts`, `src/build-jobs/jobs.ts`, `src/build-host.ts`

Deliberately not done in TASK-517: it changes turbo cache keys and build-host selection, and the cross-architecture path can only be verified from the Mac.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A musl build produces only the target architecture
- [ ] #2 PODKIT_HOST_ARCH is gone from the turbo wrapper, turbo.json and .env.example, or kept with a named current consumer
- [ ] #3 No doc or comment still says docker-loopback builds on the host's Docker
- [ ] #4 A cross-architecture quality run still covers both shipped-image cells
<!-- AC:END -->
