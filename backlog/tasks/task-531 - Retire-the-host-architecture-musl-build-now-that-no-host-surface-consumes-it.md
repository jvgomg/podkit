---
id: TASK-531
title: Retire the host-architecture musl build now that no host surface consumes it
status: Done
assignee: []
created_date: '2026-09-29 21:55'
updated_date: '2026-09-30 21:17'
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
modified_files:
  - test-packages/substrate/src/required-arches.ts
  - test-packages/substrate/src/required-arches.test.ts
  - test-packages/substrate/src/index.ts
  - test-packages/substrate/src/build-host.ts
  - test-packages/substrate/src/target-arch.ts
  - test-packages/substrate/scripts/turbo.ts
  - test-packages/device-testing/scripts/build-artifacts.ts
  - test-packages/device-testing/src/build-jobs/jobs.ts
  - test-packages/device-testing/src/build-jobs/jobs.test.ts
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
- [x] #1 A musl build produces only the target architecture
- [x] #2 PODKIT_HOST_ARCH is gone from the turbo wrapper, turbo.json and .env.example, or kept with a named current consumer
- [x] #3 No doc or comment still says docker-loopback builds on the host's Docker
- [x] #4 A cross-architecture quality run still covers both shipped-image cells
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The musl build now produces only the run's target architecture.

**What changed**
- `required-arches.ts`, its test and its exports are deleted, along with `PODKIT_HOST_ARCH` in the turbo wrapper, `turbo.json` and `.env.example`.
- `build-artifacts.ts` now does a single build per job, so the pass planning, per-pass logging and `assertDistinctArtifactPaths` (plus its tests) are gone.
- `selectBuildHost` lost its `arch` option and always uses the target architecture.
- `vm-build-orchestration.md` §2 is rewritten as "One architecture per run".
- Drive-by fix: `turbo.json` now declares `PODKIT_SUBSTRATE`/`PODKIT_TARGET_ARCH` on `test:e2e:docker-dist` and `test:e2e:docker-loopback`. Without it, strict env mode dropped a command-line substrate override, so the test and its `vm:doctor` targeted different substrates.

**Verified from the arm64 Mac against the amd64 `deviceRemote` substrate**
- The musl build ran once, for `linux-x64` on `builderRemote` in the Alpine container. No arm64 set was built.
- `bun run quality`: every phase-1 task passed in at least one of five runs. Each run lost one unrelated, load-sensitive test in a different suite, none touching this diff: a host binary `$bunfs` native-binding extraction, a `backing-file-content` `prepare()` timeout, `doctor` e2e timeouts, and a save-failure `stageConfig` ssh heredoc.
- Phase 2 was then run the way the mirror runs it. docker-loopback passed 3/3. docker-dist ran 6 tests, 4 passed and 2 failed; both failures are remote-substrate issues unrelated to architecture selection, tracked in TASK-533.
- Both shipped-image cells were built and exercised on the cross-architecture setup.

Also fixed: the TLS-posture guard timed out walking a gitignored 455 MB `graphify-out/`. It now uses `git grep --untracked`, and the `\s` pattern was changed because git's ERE silently never matched it.
<!-- SECTION:FINAL_SUMMARY:END -->
