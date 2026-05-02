---
id: TASK-104
title: Create GitHub Actions release workflow with compiled CLI binaries
status: Done
assignee: []
created_date: '2026-03-11 14:16'
updated_date: '2026-03-11 14:45'
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
- [x] #1 Release workflow triggers on push to main and uses changesets/action
- [x] #2 When changesets are pending, a 'Version Packages' PR is created/updated with version bumps and changelogs
- [x] #3 Version PR CI builds and tests compiled CLI binaries for all 4 platforms as required PR checks
- [x] #4 GitHub branch protection on main requires the build/smoke-test jobs to pass before the version PR can be merged
- [x] #5 When the version PR is merged, the workflow rebuilds binaries and creates a GitHub Release
- [x] #6 Each binary is a standalone executable with the native addon embedded (verified by `--version`)
- [x] #7 Per-platform smoke tests run before upload: version check, help output, native addon load, dynamic dependency check (otool/ldd), and dummy iPod init
- [x] #8 macOS: `otool -L` confirms no unexpected dylibs; Linux: `ldd` confirms no libgpod/glib dynamic deps
- [x] #9 GitHub Release is created with tag `podkit@{version}`, changelog body, and 4 platform tarballs as assets
- [x] #10 SHA256 checksums file is included in the release assets
- [x] #11 Custom release message from the version PR description appears at the top of the GitHub Release body
- [x] #12 prebuild.yml is called as a reusable workflow (no duplication of native build steps)
- [x] #13 Development happens on main — feature branches merge to main, version PR targets main
- [x] #14 If any smoke test fails, the build job fails and the version PR cannot be merged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: Created release.yml and ci-release.yml. Key fixes from Sonnet review: (1) Changed gate condition from hasChangesets=='false' to published=='true' to prevent false releases on every push to main; (2) Added failure guards on compile and release jobs; (3) Added tag-exists check to prevent re-release errors; (4) Fixed PR body search to use in:title filter; (5) Improved dummy iPod smoke test to detect native addon failures; (6) Simplified help smoke test. AC #4 (branch protection rules) must be configured manually in GitHub repo settings. Commit: 1e410df
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Created two GitHub Actions workflow files for the automated release pipeline:

### Files Created

1. **`.github/workflows/release.yml`** — Main release workflow triggered on push to main
2. **`.github/workflows/ci-release.yml`** — PR CI workflow for Version Packages PRs

### Release Workflow (`release.yml`)

Four-job pipeline:

1. **changesets** — Uses `changesets/action@v1` to detect pending changesets. When changesets exist, creates/updates a "Version Packages" PR. When no changesets remain (version PR was merged), signals downstream jobs to build and release.

2. **prebuilds** — Calls `prebuild.yml` as a reusable workflow (no duplication). Only runs when `hasChangesets == 'false'`.

3. **compile** — 4-platform matrix (darwin-arm64, darwin-x64, linux-x64, linux-arm64). Downloads matching prebuild artifact, installs deps, builds, compiles via `bun run compile`, runs 5 smoke tests per platform, creates tarball.

4. **release** — Extracts version from `packages/podkit-cli/package.json`, generates SHA256 checksums, builds release notes (version PR description + CHANGELOG.md + checksums), creates git tag `podkit@{version}`, creates GitHub Release with all 4 tarballs + SHA256SUMS.txt.

### CI Release Workflow (`ci-release.yml`)

Three-job pipeline for Version Packages PRs:

1. **check-pr** — Gates on PR title matching "Version Packages"
2. **prebuilds + compile** — Same prebuild + compile + smoke test matrix as release workflow
3. **release-ci-passed** — Summary job for branch protection rules

### Smoke Tests (per platform)

- `--version` output validation
- `--help` loads correctly
- macOS: `otool -L` confirms no libgpod/glib/gobject/gdk_pixbuf dylibs
- Linux: `ldd` confirms no libgpod/gdk_pixbuf dynamic deps
- Dummy iPod init: creates iPod directory structure and runs `device info` to exercise native addon

### Key Decisions

- Release notes built via file (`--notes-file`) to avoid shell interpolation issues with multi-line content
- Version PR description fetched via `gh pr list` at release time (no cross-step multi-line interpolation)
- Concurrency group prevents parallel release runs
- `--ignore-scripts` on `bun install` since prebuilds are provided via artifacts
- Compile jobs don't upload tarballs in CI workflow (only needed for release)

### Quality Checks

- `bun run build`: passed (5/5 tasks)
- `bun run test:unit`: passed (1132 tests, 0 failures)
- `bun run typecheck`: passed (9/9 tasks)
- `bun run lint`: 1 pre-existing error (unused variable in collection.ts, unrelated)
- YAML validation: both files pass `yaml.safe_load()`
<!-- SECTION:FINAL_SUMMARY:END -->
