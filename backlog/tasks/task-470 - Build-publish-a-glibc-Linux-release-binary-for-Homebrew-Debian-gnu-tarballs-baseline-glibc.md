---
id: TASK-470
title: >-
  Build + publish a glibc Linux release binary for Homebrew/Debian (-gnu
  tarballs, baseline glibc)
status: In Progress
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 16:28'
labels:
  - build
  - release
  - homebrew
  - ci
milestone: m-23
dependencies:
  - TASK-469
references:
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - .github/workflows/build-platform.yml
  - .github/workflows/release.yml
  - homebrew-tap/Formula/podkit.rb
  - tools/update-homebrew-formula.sh
priority: high
ordinal: 230000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The release ships musl-only, so glibc Homebrew users get a binary that can't execute (`interpreter /lib/ld-musl-*.so.1`). Add a **glibc** Linux CLI binary to the release and route Homebrew + the Debian tarball to it.

Net-new work: `prebuild.yml`'s glibc job builds only a `.node` prebuild and isn't wired to release tags (`podkit@x.y.z`); the release path is `release.yml → build-platform.yml`, which has no glibc CLI job. Add a glibc compile+tarball job to `build-platform.yml` that stages the glibc `.node` into `prebuilds/linux-${ARCH}` and runs `bun run compile`.

- **Baseline glibc**: build in a glibc ~2.31 `container:` (`ubuntu:20.04`-class / manylinux_2_31) on `ubuntu-latest` (stock old runners are retired). The effective floor is `max(container, Bun's embedded-runtime glibc floor ≈ 2.31)`; **verify the produced binary runs on the oldest supported distro empirically**, don't assume the container lowers it.
- **Naming**: keep musl artifacts at their current bare names (`podkit-linux-{x64,arm64}.tar.gz`) — `docker.yml:34-44` downloads those into the Alpine image; give the NEW glibc artifacts a `-gnu` suffix (`podkit-linux-{x64,arm64}-gnu.tar.gz`). `release.yml:226` globs `podkit-*.tar.gz`, so glibc tarballs + SHA256SUMS flow to the release automatically.
- **Homebrew**: repoint `homebrew-tap/Formula/podkit.rb:22,26` Linux URLs to the `-gnu` tarballs; add `SHA_LINUX_{X64,ARM64}_GNU` `get_sha256` lookups + `awk` URL-match branches to `tools/update-homebrew-formula.sh:48-78`.

Depends on TASK-469 (libc-explicit prebuild selection) so the glibc job embeds the glibc `.node`. Docker/Alpine unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 build-platform.yml produces glibc podkit-linux-{x64,arm64}-gnu.tar.gz alongside the musl bare-name tarballs, for the release
- [ ] #2 The glibc binary is built against a baseline glibc (~2.31) and verified to run on the oldest supported distro (e.g. Debian 12 / Ubuntu 20.04)
- [x] #3 Homebrew formula + update-homebrew-formula.sh route Linux to the -gnu tarballs (with sha256)
- [x] #4 musl artifact names + docker.yml are unchanged (Docker still gets musl)
- [ ] #5 A glibc Homebrew install on Debian runs: podkit --version + device info succeed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch m-23-dual-libc-linux (uncommitted working tree).

Files changed:
- .github/workflows/build-platform.yml — added `build-glibc` job (matrix arch: x64 on ubuntu-latest, arm64 on ubuntu-24.04-arm; both `container: ubuntu:20.04` for glibc 2.31 baseline). Builds the bare `prebuilds/linux-${arch}` .node inline via `tools/prebuild/build-linux-glibc.sh` (SKIP_STATIC_DEPS gated on static cache hit), then `bun run compile`. Full forbidden-lib grep in smoke tests + isolated native-binding-load check. Emits `podkit-linux-${arch}-gnu.tar.gz`, artifact `podkit-linux-${arch}-gnu`, gated on inputs.upload-artifacts. Distinct `-gnu` prebuild + static-deps cache keys (2.31 baseline must not reuse prebuild.yml's 24.04-built .a). ubuntu:20.04's apt meson/ninja/cmake too old → installed via pip. Musl + darwin jobs left byte-identical (Docker depends on bare musl names).
- tools/prebuild/build-linux-glibc.sh — fixed stale header comment that claimed build-platform.yml never calls this script; it now does (the release glibc binary).
- homebrew-tap/Formula/podkit.rb — repointed both on_linux URLs to `-gnu` tarballs (UNCOMMITTED, separate gitignored repo; user pushes it).
- tools/update-homebrew-formula.sh — renamed Linux sha lookups to SHA_LINUX_{X64,ARM64}_GNU → `-gnu` tarballs; awk url-match branches now target `podkit-linux-{arch}-gnu` with bare-linux branches removed (bare name is a substring of -gnu and would double-fire).

Unchanged (verified): release.yml (globs podkit-*), docker.yml (downloads bare musl names). No glibc daemon (CLI only).

Local verification: actionlint (build-platform.yml) clean; shellcheck (update-homebrew-formula.sh, build-linux-glibc.sh) clean; awk dry-run end-to-end confirms each sha lands on the correct url line with no substring double-fire.

AC #2 (baseline-runs on Debian 12 / Ubuntu 20.04) and AC #5 (glibc Homebrew install on Debian runs --version + device info) require the actual CI build + release run to confirm — cannot be validated locally (glibc container build is not runnable here).

CI watch-list (things that may fail on first real run):
1. ubuntu:20.04 (focal) is EOL — `apt-get update` may fail if focal moved to old-releases.ubuntu.com. If so, switch base to debian:11-slim (also glibc 2.31) or point apt at old-releases.
2. JS actions (checkout/cache/setup-node/setup-bun) inside ubuntu:20.04 container on the arm64 runner (ubuntu-24.04-arm) — glibc container so should work (unlike Alpine/musl), but unproven for this repo.
3. Bun's glibc floor — Bun officially supports Ubuntu 20.04 (glibc 2.31), so should be fine, but `bun-version: latest` could bump the floor.
4. cmake added to the pip install (deviation from the task's "meson ninja" list) because focal's cmake 3.16 is likely too old for libxml2 2.12 / recent CMakeLists; watch the static-deps build if this regresses.
5. Effective glibc floor is max(container, Bun runtime) — the produced binary's interpreter/floor must be checked empirically (ties into TASK-471).
<!-- SECTION:NOTES:END -->
