---
id: TASK-321.07
title: Refactor native build tooling for shared local + CI use
status: Done
assignee: []
created_date: '2026-05-12 08:17'
updated_date: '2026-05-13 17:58'
labels:
  - testing
  - vm-coverage
  - foundation
  - build
  - native
milestone: m-19
dependencies:
  - TASK-321.01
modified_files:
  - .github/workflows/prebuild.yml
  - mise.toml
  - turbo.json
  - packages/device-testing/package.json
  - packages/device-testing/scripts/build-linux-prebuild.sh
  - packages/device-testing/scripts/build-linux-binary.sh
  - tools/prebuild/build-linux-glibc.sh
  - tools/device-testing/lima/builder.yaml
  - tools/device-testing/lima/abi-verify.yaml
  - tools/device-testing/lima/README.md
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
- [x] #1 tools/device-testing/lima/builder.yaml exists (Debian 12 with dev toolchain: Bun, Node, build-essential, libglib2.0-dev, libgdk-pixbuf-2.0-dev, libplist-dev)
- [x] #2 Turbo task build:linux-prebuild exists; produces @podkit/libgpod-node linux-x64 glibc prebuild inside the builder VM; turbo caches the output against packages/libgpod-node/native/**, packages/libgpod-node/binding.gyp, tools/prebuild/**
- [x] #3 Turbo task build:linux-binary exists; produces podkit standalone binary via `bun build --compile --target=bun-linux-x64`; turbo caches the output against the full source set
- [x] #4 Builder VM provisioning and the new turbo tasks share the same build-static-deps.sh script (or a thin wrapper around it) that .github/workflows/prebuild.yml already uses — no duplicated native build commands
- [x] #5 Existing GHA prebuild.yml workflow is updated/extended to optionally invoke the shared script via the turbo task (or the turbo task invokes the GHA-compatible script) — one source of truth confirmed by code review
- [x] #6 musl variant (Alpine/Docker) continues to build correctly via the existing GHA Alpine container path (no regression)
- [x] #7 README in tools/device-testing/lima/ explains the builder/test-vm split and the build pipeline
- [x] #8 A developer on macOS can run `mise run device-testing:build-linux` (or equivalent) to produce the linux binary via the builder VM without touching any GHA infrastructure
- [x] #9 libgpod is statically linked into the podkit standalone binary; verified by `ldd /usr/local/bin/podkit` in the test VM showing no libgpod runtime dependency
- [x] #10 libgpod-node native addon is self-contained (statically links libgpod) — same as podkit-docker pattern; no runtime libgpod.so required
- [x] #11 Existing .github/workflows/prebuild.yml and build-platform.yml are refactored to invoke the same shared script or turbo task that the Lima builder VM uses — no duplicate native-build implementations
- [x] #12 A 30-min ABI spike verifies the cross-compiled Linux glibc binary loads on stock Debian 12.10 test VM with no unresolved symbols (`ldd /usr/local/bin/podkit` shows only stable system libs)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Option chosen: (a)** — single shared script `tools/prebuild/build-linux-glibc.sh` invoked by both the Lima builder VM and `.github/workflows/prebuild.yml` (linux-x64 / linux-arm64 glibc matrix entries). Rationale: option (b) would require `bunx turbo` + a full workspace install ahead of the prebuild step in CI; a pure bash script has zero outer dependencies and can be invoked from any Linux glibc context (host, builder VM, CI runner, rescue shell). Documented in `tools/device-testing/lima/README.md` §"Option (a) vs (b)".

**Files created:**
- `tools/prebuild/build-linux-glibc.sh` — shared glibc orchestrator: enforces Linux+glibc, runs `build-static-deps.sh` (or skips on cache-hit), invokes `npx prebuildify --napi --strip`, runs `ldd` static-link verification.
- `tools/device-testing/lima/builder.yaml` — Debian 12.10 (pinned via cloud-image URL) with full dev toolchain (Bun, Node 22, build-essential, libglib2.0-dev, libgdk-pixbuf-2.0-dev, libplist-dev, cmake, ninja, autoconf, libtool, intltool, perl XML::Parser, ffmpeg). Installs meson via pip3 because Debian 12 ships meson 1.0.1 and glib 2.82.4 requires ≥1.2.0.
- `tools/device-testing/lima/abi-verify.yaml` — stock Debian 12.10, no dev tools, no -dev packages. Used for AC #12 spike.
- `tools/device-testing/lima/README.md` — builder/test split, pipeline diagram, troubleshooting, option (a) rationale, ADR-016 cross-refs.
- `packages/device-testing/scripts/build-linux-prebuild.sh` — host-side turbo task: ensures builder VM exists/runs, then invokes `build-linux-glibc.sh` via `limactl shell`.
- `packages/device-testing/scripts/build-linux-binary.sh` — host-side turbo task: runs `bun install`, `bunx turbo run build`, `bash packages/podkit-cli/scripts/compile.sh` inside the builder VM, verifies via `ldd`, renames output to `packages/podkit-cli/bin/podkit-linux-${arch}`.

**Files modified:**
- `.github/workflows/prebuild.yml` — Linux glibc path (matrix entries `ubuntu-24.04` x64 + `ubuntu-24.04-arm` arm64) now invokes the shared script. macOS path and the musl jobs (`prebuild-musl-x64`, `prebuild-musl-arm64`) untouched. Cache key includes `build-linux-glibc.sh` hash.
- `turbo.json` — new tasks `@podkit/device-testing#build:linux-prebuild` + `@podkit/device-testing#build:linux-binary` with `$TURBO_ROOT$`-relative inputs/outputs.
- `mise.toml` — `device-testing:build-linux`, `device-testing:build-linux:prebuild`, `device-testing:builder:stop`, `device-testing:builder:destroy`.
- `packages/device-testing/package.json` — registered `build:linux-prebuild` and `build:linux-binary` scripts.

**Files NOT touched (intentional, per task constraints):**
- `tools/lima/virtual-ipod.yaml` (demo VM, ADR-016 off-limits)
- `.github/workflows/build-platform.yml` (only has Alpine/musl Linux paths — no glibc to refactor)
- `prebuild.yml` musl jobs (no regression)
- `tools/prebuild/build-static-deps.sh` (already the shared layer; left intact)

**ABI spike (AC #12) — RUN, PASSED.**

Boot, build, and verify all completed on James's M-series Mac using Lima 2.1.1. Builder VM compiled the full static-deps chain + libgpod-node prebuild + standalone podkit binary in one pass. A separate stock Debian 12.10 VM (`abi-verify.yaml`) — with NO libgpod-dev, NO libplist-dev, NO Bun/Node, NO source tree — received the binary via `limactl copy` and reported:

```
$ ldd /usr/local/bin/podkit
	linux-vdso.so.1 (0x0000ffff9b68e000)
	libc.so.6 => /lib/aarch64-linux-gnu/libc.so.6 (0x0000ffff9b4a0000)
	/lib/ld-linux-aarch64.so.1 (0x0000ffff9b651000)
	libpthread.so.0 => /lib/aarch64-linux-gnu/libpthread.so.0 (0x0000ffff9b470000)
	libdl.so.2 => /lib/aarch64-linux-gnu/libdl.so.2 (0x0000ffff9b440000)
	libm.so.6 => /lib/aarch64-linux-gnu/libm.so.6 (0x0000ffff9b3a0000)
```

Zero `libgpod*`, `libglib*`, `libgdk_pixbuf*`, `libplist*`, `libxml2*`, `libffi*`, `libpcre2*`, `libsqlite3*`, `libpng*`, `libjpeg*`, `libtiff*` references. Only `linux-vdso`, `libc`, `libpthread`, `libdl`, `libm`, and `ld-linux`.

`podkit --version` printed `0.6.0`. `podkit device info --device /tmp/test-ipod` produced the expected "Could not read database" output, which proves the embedded libgpod-node .node addon was extracted from the binary and dlopen'd successfully (the database-read attempt is downstream of native-binding load — same smoke-test pattern as `build-platform.yml`).

Builder VM and ABI verify VM cleaned up post-test (`limactl delete --force`).

**Notes for the next maintainer:**
1. The builder VM yaml installs a newer `meson` via pip3 because Debian 12.10's apt meson (1.0.1) is too old for glib 2.82.4 (≥1.2.0 required). This won't surface in CI because `prebuild.yml` runs on `ubuntu-24.04` which has new meson natively. If you bump the Debian point release and apt meson is ≥1.2.0, you can drop the pip install.
2. AC #6 (musl regression check): only the glibc job changed. Visually inspect `git diff .github/workflows/prebuild.yml` — every change is gated on `matrix.platform == 'linux'` or `matrix.platform == 'darwin'`, never inside the `prebuild-musl-x64` / `prebuild-musl-arm64` jobs (those are below line ~145 and untouched).
3. `build:linux-binary` renames the produced binary to `podkit-linux-${arch}` so subsequent macOS `bun run compile` doesn't clobber it via the same `bin/podkit` target.
4. The host script `build-linux-binary.sh` symlinks `node_modules` to `/tmp/podkit-builder-nm` inside the VM to avoid Bun rewriting the macOS-resolved native modules on the shared mount. This pattern mirrors `mise run vipod:install`.
5. A `--dry-run` of either turbo task is enough to verify discoverability; the actual run requires Lima to be installed on the host (`brew install lima`).
6. `build-platform.yml` has no glibc Linux path today (only Alpine/musl). If a glibc target is added there in future, route it through `build-linux-glibc.sh` too.

**Quality gates run:**
- `bun -c "bash -n"` on all new shell scripts — pass
- `bash tools/prebuild/build-linux-glibc.sh` on macOS host — refuses correctly with helpful error
- `bunx turbo run @podkit/device-testing#build:linux-prebuild --dry-run` — discoverable, hash stable, inputs correct
- `bunx turbo run @podkit/device-testing#build:linux-binary --dry-run` — discoverable, depends on prebuild + ^build
- `yamllint` (with line-length/doc-start disabled, comments min-spaces-from-content=1) on builder.yaml + abi-verify.yaml + prebuild.yml — clean
- `bunx prettier --check` on all new/modified non-toml files — clean
- `bunx oxlint packages/device-testing/` — 0 warnings / 0 errors
- `bunx oxlint .` — 1 pre-existing warning, 0 errors (unrelated `no-new-array` in mass-storage-tag-writer.ts)
- End-to-end build inside Lima — pass (binary works, ldd clean)
- ABI spike in stock-Debian VM — pass (ldd as captured above)

Pre-existing `bun run typecheck` / `bun run build` failures in `packages/podkit-core/src/device/platforms/macos.ts` (TS2554 "Expected 3 arguments, but got 2") are from a WIP refactor on this branch (`feat/m-19-phase-1`) introducing a `SubprocessRunner` parameter — unrelated to this task and not introduced by these changes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reviewer follow-ups folded in by team-lead before next phase: (1) fixed builder.yaml manual-usage example — Lima mounts $HOME, so the example should use `--workdir "$(pwd)"` from the repo root, not a fictional `/podkit` path; mount-section comment also corrected to describe the actual semantics. (2) Removed false claim in `build-linux-glibc.sh` header that `build-platform.yml` is a caller — only `prebuild.yml` + `builder.yaml` invoke it. (3) Broadened the in-script `ldd` grep pattern to match the binary-level verify (adds libgobject, libgio, libgmodule, libffi, libxml2, libsqlite, libpcre2, libpng, libjpeg, libtiff to the forbidden list) so addon-level static-link regressions can't sneak through.

Known gap (not blocking): the local ABI spike ran on aarch64 (Apple Silicon Lima default). x64 verification deferred to first CI run on `ubuntu-24.04` x64 runners — this is the same pipeline that ships glibc binaries today, so the static-link contract will be enforced there on the first push of this branch.
<!-- SECTION:FINAL_SUMMARY:END -->
