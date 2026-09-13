---
id: TASK-514
title: Decouple build target architecture from host architecture
status: To Do
assignee: []
created_date: '2026-09-13 18:33'
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
- [ ] #1 targetArch() resolves from the selected substrate, with host arch only as the no-substrate default; vmArch() is gone
- [ ] #2 Target arch is a declared input of every task producing a linux binary, so a foreign-arch cache hit is impossible
- [ ] #3 Artifact arch is asserted equal to substrate arch before transfer, with a named error
- [ ] #4 A build host is selected over the same link as a substrate, and may be a remote machine or localhost
- [ ] #5 An amd64 build host can be driven from an arm64 macOS host end to end
- [ ] #6 musl builds use the same build-host mechanism as glibc, via an Alpine container on the build host
- [ ] #7 The device substrate still receives artifacts only — no source tree, no host mount
- [ ] #8 test:vm passes on macOS with an arm64 substrate and with an amd64 substrate
<!-- AC:END -->
