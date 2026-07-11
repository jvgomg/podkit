---
id: TASK-464
title: >-
  Local musl (Alpine) binary build — mirror the Debian builder for Docker-image
  parity
status: Done
assignee: []
created_date: '2026-07-11 16:23'
updated_date: '2026-07-11 17:09'
labels:
  - docker
  - build
  - vm
  - ci
  - musl
milestone: m-22
dependencies: []
references:
  - test-packages/device-testing/lima/podkit-linux-builder.yaml
  - test-packages/device-testing/scripts/build-linux-binary.sh
  - test-packages/device-testing/scripts/build-linux-prebuild.sh
  - tools/prebuild/build-linux-glibc.sh
  - tools/prebuild/build-static-deps.sh
  - packages/podkit-cli/scripts/compile.sh
  - .github/workflows/prebuild.yml
  - .github/workflows/build-platform.yml
  - test-packages/device-testing/src/runners/lima-docker-image.ts
  - turbo.json
priority: high
ordinal: 224000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

The podkit Docker image is `FROM alpine:3.21` (musl). Tier-5 (TASK-451) runs podkit *inside that container*, so it needs musl-linked `podkit` + `podkit-daemon` binaries. Today the local build pipeline only produces glibc binaries (Debian `podkit-linux-builder` VM), which cannot start in Alpine. CI builds musl binaries in Alpine containers; this task brings that ability local, mirroring the Debian builder pattern so local == CI == image. See [[project_local_build_parity.md]].

## Good news (already solved)
- `tools/prebuild/build-static-deps.sh` is ALREADY musl-aware (detects musl via `ldd /bin/sh`, builds static libintl for musl).
- `packages/podkit-cli/scripts/compile.sh` is ALREADY musl-aware (tries `${platform}-${arch}-musl` prebuild first; arm64 usb prebuild has no libc split). No compile.sh change needed for arm64 musl.

## Plan (mirror the glibc path)
1. `test-packages/device-testing/lima/podkit-musl-builder.yaml` (NEW) — Alpine 3.21 builder VM mirroring `podkit-linux-builder.yaml`; apk list = union of the CI musl jobs (build-base, cmake, meson, ninja, glib-dev+static, libplist-dev+static, sqlite/xml2/png/jpeg/tiff/zlib/gettext -dev+static, intltool, autoconf, automake, libtool, gtk-doc, perl-xml-parser, linux-headers, eudev-dev, pkgconf, nodejs, npm) + system-wide Bun. Dedicated builder (NOT the test VM) per ADR-016 (don't conflate builder+test roles).
2. `tools/prebuild/build-linux-musl.sh` (NEW) — sibling of build-linux-glibc.sh (which hard-rejects musl); asserts musl, runs build-static-deps.sh + prebuildify, then `mv prebuilds/linux-${arch} prebuilds/linux-${arch}-musl` (the CI naming step), ldd verify.
3. `test-packages/device-testing/scripts/build-musl-prebuild.sh` (NEW) — host driver mirroring build-linux-prebuild.sh (VM=podkit-musl-builder).
4. `test-packages/device-testing/scripts/build-musl-binary.sh` (NEW) — host driver mirroring build-linux-binary.sh; compiles CLI+debug+daemon natively in the Alpine VM (no cross-compile — CI doesn't either), copies back `-musl`-suffixed: `podkit-linux-<arch>-musl`, `podkit-debug-linux-<arch>-musl`, `podkit-daemon-linux-<arch>-musl`.
5. `turbo.json` + `test-packages/device-testing/package.json` (MODIFY) — add `build:musl-prebuild` / `build:musl-binary` tasks + scripts; DISJOINT output globs so `podkit-linux-*` (glibc) and `*-musl` don't collide in the cache.
6. `lima-test-vm.ts` + `lima-docker-image.ts` (MODIFY) — add musl binary resolvers; `buildPodkitImageInVm` selects musl binaries UNCONDITIONALLY (the image is always Alpine — glibc binaries are never valid inside it). This is the correctness fix that makes the locally-built image run.

## Risks
- First `build-static-deps.sh` on musl is slow (~10-15 min) then cached in `$HOME/.cache/podkit-static-deps`.
- apk list completeness is the most likely first-run failure (koffi builds from source via cmake; usb builds libusb from source on arm64 musl — need cmake, linux-headers, eudev-dev, build-base).
- Bun-on-musl is experimental but CI proves it works; builder must fail loudly (not the test VM's `|| echo WARN` mask).
- Alpine 3.21 vs the test VM's 3.23 — pin builder to 3.21 to match the image/CI; document if only 3.23 Lima image is available.

Effort: ~1-1.5 days (near-copies of proven glibc siblings).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit-musl-builder.yaml (Alpine 3.21.7 aarch64) + build-linux-musl.sh + build-musl-prebuild.sh + build-musl-binary.sh created, mirroring the Debian builder
- [x] #2 musl libgpod-node prebuild built + statically linked + copied to prebuilds/linux-arm64-musl/
- [x] #3 podkit-linux-arm64-musl + podkit-debug-linux-arm64-musl + podkit-daemon-linux-arm64-musl produced; file shows interpreter /lib/ld-musl-aarch64.so.1
- [x] #4 RUNTIME PROOF: podkit --version runs inside Alpine 3.21 -> 0.6.0 exit 0
- [x] #5 apk gap fixed: ffmpeg (+flac) added to the builder yaml (test-fixtures check-ffmpeg gate)
- [x] #6 items 5-6 REMAINING: turbo tasks build:musl-prebuild/build:musl-binary + disjoint output globs; runner picks musl binaries for the Alpine image
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ALL items done (1-6). Item 5 (turbo): added @podkit/device-testing#build:musl-prebuild + build:musl-binary tasks (mirror the glibc ones, musl inputs/outputs) + package.json scripts; fixed the glob collision by adding !podkit-*-linux-*-musl negations to the glibc build:linux-binary outputs so glibc/musl caches stay disjoint. Turbo dry-run confirms the task + dependsOn chain resolve. Item 6 (runner): lima-docker-image.ts selects musl binaries unconditionally via new resolveDefaultPodkitMuslBinary/resolveDefaultDaemonLinuxMuslBinary in lima-test-vm.ts. Proven end-to-end: built the real alpine:3.21 image from these musl binaries and ran podkit in it (device add + SIE write, AC#1/#2 of TASK-451). Complete pending user commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Brought the local Alpine/musl binary build in-house, mirroring the Debian glibc builder, so the production podkit Docker image (FROM alpine:3.21) can be built and run entirely on a dev machine. Committed in 8f53be0a.

New: podkit-musl-builder Lima VM (Alpine 3.21.7 aarch64), tools/prebuild/build-linux-musl.sh (musl sibling of build-linux-glibc.sh), build-musl-prebuild.sh + build-musl-binary.sh (host drivers mirroring the glibc ones), turbo build:musl-prebuild/build:musl-binary tasks (+ package.json scripts) with disjoint -musl output globs. compile.sh and build-static-deps.sh needed no changes (already musl-aware). apk gap fixed: ffmpeg+flac added to the builder yaml (test-fixtures check-ffmpeg gate).

Proven: musl podkit/podkit-daemon binaries produced (interpreter /lib/ld-musl-aarch64.so.1) and run in Alpine 3.21; the real alpine:3.21 image built from them runs podkit end-to-end (device add + real sync) in TASK-451.

Invoke: `bun run build:musl-binary --filter @podkit/device-testing` (or the turbo task). First run is slow (~10-15 min static-deps build, then cached at ~/.cache/podkit-static-deps-musl). arm64-only today (mirrors the local VM arch); x64-musl is a CI concern. Pre-commit review (sonnet): ship-with-nits; the one real nit (dead vmName option on resolvePersonaDeviceNodes) was fixed before commit.
<!-- SECTION:FINAL_SUMMARY:END -->
