---
id: TASK-103
title: Add linux-arm64 to native prebuild CI matrix
status: To Do
assignee: []
created_date: '2026-03-11 14:16'
labels:
  - ci
  - packaging
milestone: Homebrew Distribution
dependencies:
  - TASK-100
references:
  - .github/workflows/prebuild.yml
  - tools/prebuild/build-static-deps.sh
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Extend the prebuild CI workflow to produce a statically-linked `.napi.node` binary for linux-arm64, bringing the total supported platforms to four: darwin-arm64, darwin-x64, linux-x64, and linux-arm64.

## Context

The existing `prebuild.yml` workflow (from TASK-100) builds for 3 platforms. Linux ARM64 support is needed for the Homebrew distribution milestone, as Homebrew supports Linux on ARM (e.g., Raspberry Pi, AWS Graviton).

GitHub provides `ubuntu-24.04-arm64` runners (larger runners). The static dependency build script (`tools/prebuild/build-static-deps.sh`) should already work on ARM64 Linux since it builds from source, but this needs verification.

## Implementation

1. Add a new matrix entry to `.github/workflows/prebuild.yml`:
   ```yaml
   - os: ubuntu-24.04-arm64
     arch: arm64
     platform: linux
   ```
2. Verify `tools/prebuild/build-static-deps.sh` works on ARM64 (same source builds, just different arch)
3. Verify `tools/prebuild/get-cflags.sh` and `get-ldflags.sh` work on ARM64
4. Run the workflow and confirm the prebuild artifact contains `prebuilds/linux-arm64/*.napi.node`
5. Verify static linking with `ldd` (no dynamic libgpod/gdk-pixbuf deps)

## Notes

- ARM64 runners may cost more — check GitHub's pricing for larger runners
- The `build-static-deps.sh` cache key includes the script hash, so ARM64 gets its own cache entry automatically
- Unit tests in the prebuild workflow (`bun run test:unit`) will validate the binding works
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prebuild.yml matrix includes linux-arm64 entry using ubuntu-24.04-arm64 runner
- [ ] #2 Static dependency build completes successfully on ARM64
- [ ] #3 Prebuild artifact `prebuilds/linux-arm64/*.napi.node` is produced
- [ ] #4 `ldd` verification confirms no dynamic libgpod or gdk-pixbuf dependencies
- [ ] #5 Unit tests pass against the ARM64 prebuild
- [ ] #6 Combined `prebuilds-all` artifact contains all 4 platform builds
<!-- AC:END -->
