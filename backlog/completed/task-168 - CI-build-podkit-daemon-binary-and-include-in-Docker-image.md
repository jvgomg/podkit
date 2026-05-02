---
id: TASK-168
title: 'CI: build podkit-daemon binary and include in Docker image'
status: Done
assignee: []
created_date: '2026-03-19 15:59'
updated_date: '2026-03-19 17:30'
labels:
  - ci
  - daemon
  - docker
dependencies: []
references:
  - .github/workflows/release.yml
  - .github/workflows/docker.yml
  - packages/podkit-daemon/package.json
  - docker/Dockerfile
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The daemon binary (`podkit-daemon`) is not built by CI. The Dockerfile expects `bin/${TARGETARCH}/podkit-daemon` but the release workflow only builds the `podkit` CLI binary. Users pulling the Docker image from GHCR won't have the daemon binary.

### What's needed

1. **Release workflow** (`.github/workflows/release.yml`): build `podkit-daemon` alongside `podkit` for all 4 platform targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64). The daemon uses `bun build --compile` (see `packages/podkit-daemon/package.json` compile script).

2. **Docker workflow** (`.github/workflows/docker.yml`): ensure the musl-linked daemon binary is copied into the Docker image. The Dockerfile already has the COPY instruction (`bin/${TARGETARCH}/podkit-daemon`).

3. **turbo.json**: wire the daemon's build/compile tasks into the monorepo pipeline if not already.

4. **`/sys` access in Docker**: verify that `/sys/block/<device>/device/` symlinks resolve correctly inside the container for USB vendor ID detection. Document findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Release workflow builds podkit-daemon binary for Linux platform targets (x64 + arm64)
- [x] #2 Docker image includes both podkit and podkit-daemon binaries
- [x] #3 docker run ghcr.io/jvgomg/podkit daemon starts successfully
- [x] #4 /sys access verification moved to TASK-165 (privilege minimization testing)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Scope refinement

- Daemon is Docker/Linux-only — no need to build for macOS (darwin) targets
- turbo.json already has a generic `compile` task — no changes needed
- Root `compile` script stays filtered to CLI only (local dev concern)
- `/sys` access verification moved to TASK-165 where it belongs (privilege minimization testing ladder)

## CI verification

Full pipeline verified via temporary test workflow (run 23304809967):
- Linux x64: daemon compiled, tarball created and uploaded
- Linux arm64: daemon compiled, tarball created and uploaded
- Docker: daemon artifacts downloaded, extracted, multi-arch image built successfully
- macOS builds unchanged

PR: https://github.com/jvgomg/podkit/pull/41

## Local Docker verification

Downloaded CI artifacts, built Docker image locally, and tested:
- `podkit --version` → 0.4.0
- `podkit --help` → full CLI output
- `daemon` command → starts successfully, logs "podkit-daemon running, waiting for iPod devices..."

All 4 acceptance criteria now verified.
<!-- SECTION:NOTES:END -->
