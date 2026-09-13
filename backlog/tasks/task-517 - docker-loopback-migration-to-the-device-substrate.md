---
id: TASK-517
title: docker-loopback migration to the device substrate
status: To Do
assignee: []
created_date: '2026-09-13 21:57'
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
- [ ] #1 docker-loopback runs on the device substrate rather than the host container runtime
- [ ] #2 The libc and image provenance of the artifact it exercises is explicit and correct for the substrate's runtime
- [ ] #3 The privileged invocation and the 64 loop-device mknods work under the substrate's container runtime
- [ ] #4 The macOS path that is green today is still green, or its removal is a deliberate documented decision
- [ ] #5 taxonomy.md is updated to describe where the cell actually runs once it moves
<!-- AC:END -->
