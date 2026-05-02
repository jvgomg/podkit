---
id: TASK-110
title: Validate release pipeline with first v0.1.0 release
status: Done
assignee: []
created_date: '2026-03-11 14:26'
updated_date: '2026-03-11 18:02'
labels:
  - release
  - packaging
  - homebrew
milestone: Homebrew Distribution
dependencies:
  - TASK-104
  - TASK-106
  - TASK-107
references:
  - packages/podkit-cli/package.json
  - packages/podkit-core/package.json
  - packages/libgpod-node/package.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Execute the first end-to-end release of podkit v0.1.0 through the entire pipeline, validating that every step works: changeset → version PR → CI builds → GitHub Release → Homebrew formula update → `brew install` → working CLI.

## Context

This is the final validation task for the Homebrew Distribution milestone. All infrastructure tasks (TASK-102 through TASK-109) build the pipeline — this task proves it works.

### Versioning Decision

podkit is in beta. We use `0.x.y` semver to signal this:
- `0.1.0` is the first release
- `0.` prefix universally means "not yet stable" across npm, Homebrew, and GitHub
- When ready for stable, bump to `1.0.0`

### First Release Content

A lot of development predates changesets, so the first release can't be auto-generated from changeset history. The first release needs a **hand-written release summary** covering what podkit is and what's included in v0.1.0:

- Music sync to iPod (FLAC→AAC transcoding, metadata, artwork)
- Video sync (H.264/M4V transcoding)
- Directory and Subsonic collection sources
- Multi-collection and multi-device configuration
- Device management (init, reset, eject, mount)
- Transforms (ftintitle)

This summary goes in the version PR description and becomes the GitHub Release body.

## Implementation

### 1. Set initial versions

Update all publishable package versions from `0.0.0` to `0.1.0`:
- `packages/podkit-cli/package.json` → `0.1.0`
- `packages/podkit-core/package.json` → `0.1.0`
- `packages/libgpod-node/package.json` → `0.1.0`

### 2. Create the first changeset

```bash
bunx changeset
```
Select all packages, minor bump, write the v0.1.0 release summary.

Alternatively, since this is the inaugural release, manually set versions and write a hand-crafted CHANGELOG.md entry, then let changesets manage from v0.1.1 onwards.

### 3. Push and verify the version PR

- Push the changeset to main
- Verify the "Version Packages" PR is created
- Edit the PR description with the hand-written release summary
- Verify CI builds all 4 platform binaries and smoke tests pass
- Verify the PR is mergeable (all checks green)

### 4. Merge and verify the release

- Merge the version PR
- Verify GitHub Release is created with:
  - Correct tag (`podkit@0.1.0`)
  - Release summary at the top
  - All 4 platform tarballs attached
  - SHA256 checksums file

### 5. Verify Homebrew formula update

- Check that `homebrew-podkit` received a commit with updated version and SHAs
- Run `brew tap jvgomg/podkit && brew install podkit`
- Verify `podkit --version` outputs `0.1.0`
- Run `podkit --help` to confirm full functionality
- Run `brew test podkit`

### 6. Verify on a clean machine (if possible)

Ideally test on a machine that has never had podkit's development dependencies:
- Only FFmpeg installed (via Homebrew)
- `brew install jvgomg/podkit/podkit`
- `podkit --version` → `0.1.0`

## Notes

- This task is manual/interactive — it validates the automated pipeline by exercising it
- Document any issues encountered and fix them before marking the milestone complete
- If any step fails, fix the underlying task and re-run
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All publishable packages have version 0.1.0 set
- [x] #2 First changeset is created and pushed to main
- [x] #3 Version PR is created automatically with correct version bumps
- [x] #4 CI builds pass on all 4 platforms with smoke tests green
- [x] #5 Merging the version PR creates a GitHub Release tagged `podkit@0.1.0`
- [x] #6 GitHub Release has hand-written release summary, 4 platform tarballs, and checksums
- [x] #7 Homebrew formula in `jvgomg/homebrew-podkit` is updated automatically with new version and SHAs
- [x] #8 `brew install jvgomg/podkit/podkit` installs a working binary on macOS
- [x] #9 `podkit --version` outputs `0.1.0` from the Homebrew-installed binary
- [x] #10 The full pipeline from changeset to `brew install` works without manual intervention (beyond merging the PR)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validated with v0.0.2 and v0.0.3 releases (not v0.1.0 as originally planned). Pipeline works end-to-end: changeset → Version Packages PR → CI verification → merge → prebuild + compile (with cache) → GitHub Release → Homebrew formula auto-update → `brew install`/`brew upgrade` delivers working binary. Key fixes during validation: (1) replaced changesets `published` output with custom commit message detection; (2) added workflow_dispatch trigger; (3) fixed --version to inject from package.json at build time via --define; (4) streamlined pipeline with prebuild auto-detect, actions/cache, and merged build-platform.yml workflow.
<!-- SECTION:NOTES:END -->
