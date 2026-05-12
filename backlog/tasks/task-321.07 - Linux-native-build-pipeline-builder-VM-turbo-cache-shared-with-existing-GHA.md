---
id: TASK-321.07
title: Refactor native build tooling for shared local + CI use
status: To Do
assignee: []
created_date: '2026-05-12 08:17'
updated_date: '2026-05-12 11:53'
labels:
  - testing
  - vm-coverage
  - foundation
  - build
  - native
milestone: m-19
dependencies:
  - TASK-321.01
parent_task_id: TASK-321
priority: high
ordinal: 270
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor the native build tooling so the Lima builder VM and existing GHA workflows share a single implementation — no duplicate native-build code. Both the libgpod-node native addon and the standalone podkit binary statically link libgpod, matching the quality of homebrew and Docker distributions.

**Two build outputs:**
1. `@podkit/libgpod-node` linux-x64 native prebuild (glibc, for Debian test VM) — libgpod statically linked into the .node addon so it is self-contained; no runtime libgpod.so dependency
2. podkit standalone binary via `bun build --compile --target=bun-linux-x64` bundling the above prebuild — statically links libgpod; `ldd /usr/local/bin/podkit` shows only stable system libraries (glibc, libpthread, etc.)

**gpod-tool is a test-time dependency only.** It is produced by `@podkit/gpod-testing` and installed in the test VM for test scripts to populate iPod databases. It is NOT bundled into the podkit binary and NOT required to build podkit.

**Builder Lima VM** (`tools/device-testing/lima/builder.yaml`):
- Debian 12.10 (exact point release pinned) with full dev toolchain (Bun, Node, build-essential, libglib2.0-dev, etc.)
- Used by the turbo build tasks and by developers who need a reproducible Linux build environment on macOS

**Turbo tasks:**
- `build:linux-prebuild` — builds the libgpod-node linux-x64 .node file inside the builder VM; output cached by turbo against `packages/libgpod-node/native/**`, `packages/libgpod-node/binding.gyp`, `tools/prebuild/**`
- `build:linux-binary` — runs `bun build --compile --target=bun-linux-x64` inside the builder VM; output cached by turbo against the full source set

**Critical constraint: no duplicate build logic with existing GHA.**

Existing native-build infrastructure (audited 2026-05-12):
- `.github/workflows/prebuild.yml` — builds `@podkit/libgpod-node` prebuilds across darwin-arm64, darwin-x64, linux-x64 (glibc), linux-arm64 (glibc), linux-x64-musl (Alpine), linux-arm64-musl (Alpine). All variants call `bash tools/prebuild/build-static-deps.sh` then `npx prebuildify --napi --strip`. musl variants run inside `alpine:3.21` containers.
- `.github/workflows/build-platform.yml` — builds the full standalone binary (prebuild + `bun build --compile`) for darwin-arm64, darwin-x64, linux-x64-musl, linux-arm64-musl. Linux builds also run inside `alpine:3.21` containers.
- `tools/prebuild/build-static-deps.sh` — the shared script that builds all static C dependencies (libgpod, gdk-pixbuf, glib, libplist, etc.). Already shared between `prebuild.yml` and `build-platform.yml` — this is the established pattern.
- `packages/libgpod-node/` — `binding.gyp` + `native/` C++ bindings. Prebuild step is `npx prebuildify --napi --strip`.

**Required refactor:** The builder VM must invoke `build-static-deps.sh` and `prebuildify` via the same mechanism as the GHA workflow. Options: (a) extract a thin glibc-specific wrapper `tools/prebuild/build-linux-glibc.sh` that both the Lima yaml provisioning and a new GHA job invoke, OR (b) expose the turbo `build:linux-prebuild` task from the GHA workflow itself (invoke `bunx turbo run build:linux-prebuild` in CI). Either way: one source of truth.

The musl variant (Alpine/Docker) continues via GHA Alpine containers as before — no regression intended. The builder VM covers glibc/Debian only.

**ABI verification:** A 30-min ABI spike must verify that the cross-compiled Linux binary loads cleanly on a stock Debian 12.10 test VM with no unresolved symbols — i.e., `ldd /usr/local/bin/podkit` in the test VM shows only glibc and libpthread, confirming libgpod is fully statically linked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tools/device-testing/lima/builder.yaml exists (Debian 12 with dev toolchain: Bun, Node, build-essential, libglib2.0-dev, libgdk-pixbuf-2.0-dev, libplist-dev)
- [ ] #2 Turbo task build:linux-prebuild exists; produces @podkit/libgpod-node linux-x64 glibc prebuild inside the builder VM; turbo caches the output against packages/libgpod-node/native/**, packages/libgpod-node/binding.gyp, tools/prebuild/**
- [ ] #3 Turbo task build:linux-binary exists; produces podkit standalone binary via `bun build --compile --target=bun-linux-x64`; turbo caches the output against the full source set
- [ ] #4 Builder VM provisioning and the new turbo tasks share the same build-static-deps.sh script (or a thin wrapper around it) that .github/workflows/prebuild.yml already uses — no duplicated native build commands
- [ ] #5 Existing GHA prebuild.yml workflow is updated/extended to optionally invoke the shared script via the turbo task (or the turbo task invokes the GHA-compatible script) — one source of truth confirmed by code review
- [ ] #6 musl variant (Alpine/Docker) continues to build correctly via the existing GHA Alpine container path (no regression)
- [ ] #7 README in tools/device-testing/lima/ explains the builder/test-vm split and the build pipeline
- [ ] #8 A developer on macOS can run `mise run device-testing:build-linux` (or equivalent) to produce the linux binary via the builder VM without touching any GHA infrastructure
- [ ] #9 libgpod is statically linked into the podkit standalone binary; verified by `ldd /usr/local/bin/podkit` in the test VM showing no libgpod runtime dependency
- [ ] #10 libgpod-node native addon is self-contained (statically links libgpod) — same as podkit-docker pattern; no runtime libgpod.so required
- [ ] #11 Existing .github/workflows/prebuild.yml and build-platform.yml are refactored to invoke the same shared script or turbo task that the Lima builder VM uses — no duplicate native-build implementations
- [ ] #12 A 30-min ABI spike verifies the cross-compiled Linux glibc binary loads on stock Debian 12.10 test VM with no unresolved symbols (`ldd /usr/local/bin/podkit` shows only stable system libs)
<!-- AC:END -->
