---
id: TASK-470
title: >-
  Build + publish a glibc Linux release binary for Homebrew/Debian (-gnu
  tarballs, baseline glibc)
status: To Do
assignee: []
created_date: '2026-08-04 15:16'
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
- [ ] #1 build-platform.yml produces glibc podkit-linux-{x64,arm64}-gnu.tar.gz alongside the musl bare-name tarballs, for the release
- [ ] #2 The glibc binary is built against a baseline glibc (~2.31) and verified to run on the oldest supported distro (e.g. Debian 12 / Ubuntu 20.04)
- [ ] #3 Homebrew formula + update-homebrew-formula.sh route Linux to the -gnu tarballs (with sha256)
- [ ] #4 musl artifact names + docker.yml are unchanged (Docker still gets musl)
- [ ] #5 A glibc Homebrew install on Debian runs: podkit --version + device info succeed
<!-- AC:END -->
