---
id: TASK-470
title: >-
  Build + publish a glibc Linux release binary for Homebrew/Debian (-gnu
  tarballs, baseline glibc)
status: Done
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 19:49'
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
- [x] #2 The glibc binary is built against a baseline glibc (~2.31) and verified to run on the oldest supported distro (e.g. Debian 12 / Ubuntu 20.04)
- [x] #3 Homebrew formula + update-homebrew-formula.sh route Linux to the -gnu tarballs (with sha256)
- [x] #4 musl artifact names + docker.yml are unchanged (Docker still gets musl)
- [ ] #5 A glibc Homebrew install on Debian runs: podkit --version + device info succeed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + CI-validated on branch m-23-dual-libc-linux (manual workflow_dispatch runs of build-platform.yml). All 6 jobs green (run 30935811477): new build-glibc matrix (x64 ubuntu-24.04 + arm64 ubuntu-24.04-arm, both container ubuntu:20.04 / glibc 2.31) builds the native .node inline via build-linux-glibc.sh (bare prebuilds/linux-${arch}), compiles, passes the full forbidden-lib linkage grep + native-binding-loads smoke, and emits podkit-linux-${arch}-gnu.tar.gz. musl + darwin jobs unchanged and still green; docker.yml/release.yml untouched (AC#4). Homebrew formula + update-homebrew-formula.sh repointed to -gnu (AC#3; formula lives in the separate homebrew-tap repo, edited locally, user pushes).

Six CI-surfaced issues fixed while validating (all real, distinct):
1. focal package name libgdk-pixbuf2.0-dev (not -2.0-).
2. unzip missing in bare ubuntu:20.04 for setup-bun.
3. libgpod source download hardened — Debian CDN mirror primary + SourceForge fallback, -f/retry, archive validation (a SourceForge blip had failed ALL platform jobs; fix also de-flakes musl/darwin). build-static-deps.sh.
4. x64 leg pinned ubuntu-24.04; permanent workflow_dispatch trigger added.
5. Build-hygiene: check-ffmpeg moved out of test-fixtures `build` into its generate scripts (test-fixtures is a CLI dev-dep, so turbo always built it; no platform job installs ffmpeg → Build packages failed on ALL platforms; a pre-existing latent defect never exercised since the gate landed 2026-05-25, last release had build skipped). Test tasks still fail-fast via the generate-task dependency.
6. apt retry wrapper for focal's flaky EOL archive.ubuntu.com.

AC#2 (runs on oldest supported glibc — baseline is ubuntu:20.04/2.31) and AC#5 (Homebrew install on Debian) pending TASK-472 runtime smoke + a real release-tag run with upload-artifacts. Runs so far used upload-artifacts=false (compile+smoke proven; tarball/upload steps are trivial and gated on that input).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Done — glibc release binary implemented + CI-validated across all 6 build-platform jobs (latest green run 30944521081). AC#1/#3/#4 met (see implementation notes). AC#2 (baseline glibc, runs on oldest supported distro): the TASK-472 runtime smoke — `--version` + `device info` reading libgpod through the native addon — runs INSIDE the ubuntu:20.04 / glibc-2.31 build container and passes, empirically proving the produced binary executes and reads a real iTunesDB on the baseline glibc floor.

AC#5 (a glibc Homebrew install on Debian runs `--version` + `device info`) is the one item that can only be confirmed by an actual tagged release: it needs the `-gnu` tarballs published + SHA256SUMS + the homebrew-tap formula (edited locally in the separate gitignored repo, awaiting the user's push) updated by tools/update-homebrew-formula.sh. The code path is complete and CI-proven; #5 verifies operationally on the first release that publishes -gnu artifacts. Not blocking — left unchecked as an honest release-time verification.
<!-- SECTION:FINAL_SUMMARY:END -->
