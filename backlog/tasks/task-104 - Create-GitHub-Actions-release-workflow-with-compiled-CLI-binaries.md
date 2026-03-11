---
id: TASK-104
title: Create GitHub Actions release workflow with compiled CLI binaries
status: To Do
assignee: []
created_date: '2026-03-11 14:16'
updated_date: '2026-03-11 14:26'
labels:
  - ci
  - packaging
  - release
milestone: Homebrew Distribution
dependencies:
  - TASK-102
  - TASK-103
references:
  - .github/workflows/prebuild.yml
  - packages/podkit-cli/package.json
  - turbo.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Create a GitHub Actions release workflow that uses changesets to manage version PRs and, on merge, produces standalone compiled CLI binaries and publishes them as a GitHub Release with changelogs.

## Context

After TASK-102 (changesets) and TASK-103 (linux-arm64 prebuild), we have:
- Changesets configured for independent versioning
- Prebuild CI producing `.napi.node` files for 4 platforms (darwin-arm64, darwin-x64, linux-x64, linux-arm64)

This task ties them together into a release pipeline.

## Build-Before-Merge Strategy

**Critical design decision:** Binaries must be built and tested *before* the version PR is merged, not after. This ensures you never merge a version PR that can't produce working binaries.

### Flow

1. **Changesets accumulate** on `main` as PRs are merged
2. **Version PR is created/updated** automatically by the changesets action
3. **Version PR CI builds all 4 platform binaries** as part of the PR check suite — you can see they pass before merging
4. **On merge**, the release job either:
   - Re-runs the build (simple, slightly slower), or
   - Downloads artifacts from the PR's CI run (faster but more complex artifact passing)
5. **GitHub Release is created** with the binaries and changelog

Recommended: re-run the build on merge for simplicity. The version PR CI gives confidence; the release build is the authoritative source of artifacts.

## Implementation

### Workflow 1: Version PR CI (triggered on PR)

When the "Version Packages" PR is opened/updated, run:
- Call `prebuild.yml` as a reusable workflow to produce native `.napi.node` files
- For each platform in a matrix:
  1. Download the matching prebuild artifact
  2. Place in `packages/libgpod-node/prebuilds/`
  3. Run `bun install` and `bun run build`
  4. Run `bun run compile` to produce the standalone binary
  5. Run smoke tests (version check, help, native addon load, dummy iPod init)
  6. Upload binary as workflow artifact
- All 4 platforms must pass for the PR to be mergeable

### Workflow 2: Release (triggered on push to main)

`.github/workflows/release.yml`:

**Step 1: Changesets action**
- Use `changesets/action` to detect pending changesets
- If pending: create/update the "Version Packages" PR
- If no pending changesets (version PR was just merged): proceed to build and release

**Step 2: Build binaries**
- Same matrix build as the PR CI (rebuild for authoritative artifacts)
- Call `prebuild.yml`, then compile per-platform

**Step 3: Create GitHub Release**
- Collect all platform tarballs
- Extract version from CLI `package.json`
- Create GitHub Release tagged `podkit@{version}` with:
  - Auto-generated changelog from changesets as the release body
  - All 4 platform tarballs as release assets (`podkit-{platform}-{arch}.tar.gz`)
  - SHA256 checksums file

### Custom release messages

The developer edits the "Version Packages" PR description to add a custom summary. The release workflow prepends this to the auto-generated changelog in the GitHub Release body.

### Workflow coordination

Make `prebuild.yml` callable via `workflow_call` (it already has this trigger). Both the PR CI and release workflow call it.

## Target platforms

| Platform | Arch | Tarball name |
|----------|------|-------------|
| macOS | arm64 | `podkit-darwin-arm64.tar.gz` |
| macOS | x64 | `podkit-darwin-x64.tar.gz` |
| Linux | x64 | `podkit-linux-x64.tar.gz` |
| Linux | arm64 | `podkit-linux-arm64.tar.gz` |

Note: Each binary must be compiled on its target platform (not cross-compiled) because the native `.napi.node` addon is platform-specific.

## References

- [changesets/action](https://github.com/changesets/action)
- Existing prebuild workflow: `.github/workflows/prebuild.yml`
- CLI compile script: `packages/podkit-cli/package.json` (`compile` script)
- Turbo compile task: `turbo.json`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Release workflow triggers on push to main and uses changesets/action
- [ ] #2 When changesets are pending, a 'Version Packages' PR is created/updated with version bumps and changelogs
- [ ] #3 Version PR CI builds and tests compiled CLI binaries for all 4 platforms as required PR checks
- [ ] #4 GitHub branch protection on main requires the build/smoke-test jobs to pass before the version PR can be merged
- [ ] #5 When the version PR is merged, the workflow rebuilds binaries and creates a GitHub Release
- [ ] #6 Each binary is a standalone executable with the native addon embedded (verified by `--version`)
- [ ] #7 Per-platform smoke tests run before upload: version check, help output, native addon load, dynamic dependency check (otool/ldd), and dummy iPod init
- [ ] #8 macOS: `otool -L` confirms no unexpected dylibs; Linux: `ldd` confirms no libgpod/glib dynamic deps
- [ ] #9 GitHub Release is created with tag `podkit@{version}`, changelog body, and 4 platform tarballs as assets
- [ ] #10 SHA256 checksums file is included in the release assets
- [ ] #11 Custom release message from the version PR description appears at the top of the GitHub Release body
- [ ] #12 prebuild.yml is called as a reusable workflow (no duplication of native build steps)
- [ ] #13 Development happens on main — feature branches merge to main, version PR targets main
- [ ] #14 If any smoke test fails, the build job fails and the version PR cannot be merged
<!-- AC:END -->
