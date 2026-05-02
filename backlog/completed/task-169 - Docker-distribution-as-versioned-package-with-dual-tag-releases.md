---
id: TASK-169
title: Docker distribution as versioned package with dual-tag releases
status: Done
assignee: []
created_date: '2026-03-19 16:39'
updated_date: '2026-03-19 17:30'
labels:
  - docker
  - ci
  - release
  - changesets
dependencies:
  - TASK-168
references:
  - .changeset/config.json
  - .github/workflows/release.yml
  - .github/workflows/docker.yml
  - docker/Dockerfile
  - packages/podkit-daemon/package.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the Docker distribution a proper monorepo package (`@podkit/docker`) with its own version number, depending on `podkit` (CLI) and `@podkit/podkit-daemon`. This enables independent Docker releases when only daemon or Docker config changes.

### Motivation

Currently the release pipeline is entirely CLI-version-driven. If only the daemon or Docker configuration changes, no release happens because the CLI version tag already exists. Docker-only improvements are silently bundled into the next CLI release.

### Design decisions

1. **Dual-tag releases**: CLI releases use `podkit@X.Y.Z` tags, Docker releases use `docker@X.Y.Z` tags. Both can happen independently.
2. **Private packages with changesets**: `@podkit/docker` and `@podkit/podkit-daemon` are private (not published to npm) but changesets tracks and versions them via `privatePackages: { version: true, tag: false }`.
3. **Version cascade**: `updateInternalDependencies: "patch"` ensures that when CLI or daemon bumps, the docker package auto-bumps too — so CLI releases always produce a new Docker image.
4. **Conditional Homebrew**: Homebrew formula only updates when CLI version changes, not for Docker-only releases.
5. **Version inspection**: Users can inspect component versions in running Docker containers via OCI labels and a baked-in versions file.

### Implementation

1. Create `packages/podkit-docker/` with package.json (version 0.1.0, private, depends on podkit + daemon)
2. Move Docker files from `docker/` to `packages/podkit-docker/`
3. Bump daemon version from 0.0.0 to 0.1.0
4. Update `.changeset/config.json` with `privatePackages` setting
5. Refactor `release.yml` for dual-tag support:
   - Detect CLI vs Docker version changes independently
   - CLI changes → GitHub Release + Homebrew + Docker
   - Docker-only changes → Docker build+push only
6. Update `docker.yml` to use Docker package version for image tagging
7. Add version labels/metadata to Docker image
8. Update all file references (AGENTS.md, docs, CI workflows)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 @podkit/docker package exists with version 0.1.0, private, depends on podkit + @podkit/podkit-daemon
- [x] #2 @podkit/podkit-daemon has version 0.1.0 (not 0.0.0)
- [x] #3 changesets config has privatePackages: { version: true, tag: false }
- [ ] #4 CLI-only changeset triggers full release: binaries + Docker + Homebrew
- [ ] #5 Docker/daemon-only changeset triggers Docker-only release (no GitHub Release, no Homebrew)
- [x] #6 Docker image tagged with @podkit/docker version, not CLI version
- [x] #7 Homebrew update is conditional on CLI version changing
- [ ] #8 Users can inspect component versions in running Docker container
- [x] #9 All file references updated (AGENTS.md, docs, CI workflows)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation complete

PR: https://github.com/jvgomg/podkit/pull/42 (depends on #41)

### CI verification

Full pipeline verified via temporary test workflow (run 23307705323):
- All 4 platform builds succeeded (daemon compiled for Linux x64 + arm64)
- Component versions extracted from package.json files
- Docker image built with new Dockerfile path and version build args
- No failures

### Local verification

- typecheck: pass
- lint: pass
- unit tests: pass
- actionlint: no new warnings

### Pending verification

- AC #4 and #5 (CLI-only vs Docker-only release triggers) can only be fully tested after merge when real changesets are processed
- AC #8 (version inspection in container) verified by Dockerfile containing versions.json creation, but not tested in running container yet
<!-- SECTION:NOTES:END -->
