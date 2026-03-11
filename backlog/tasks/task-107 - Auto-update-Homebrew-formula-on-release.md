---
id: TASK-107
title: Auto-update Homebrew formula on release
status: To Do
assignee: []
created_date: '2026-03-11 14:17'
labels:
  - ci
  - packaging
  - homebrew
milestone: Homebrew Distribution
dependencies:
  - TASK-104
  - TASK-106
references:
  - .github/workflows/release.yml
  - TASK-104
  - TASK-106
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Extend the release workflow to automatically update the Homebrew formula in `jvgomg/homebrew-podkit` after a successful GitHub Release, so users get new versions on `brew upgrade` without manual intervention.

## Context

After TASK-104 creates a GitHub Release with tarballs and TASK-106 creates the tap repo, we need to close the loop: when a release is published, the formula must be updated with the new version, URLs, and SHA256 checksums.

## Implementation

### Add a post-release job to `.github/workflows/release.yml`

After the GitHub Release is created, add a job that:

1. Downloads the SHA256 checksums file from the release
2. Extracts the new version from the release tag (`podkit@1.2.3` → `1.2.3`)
3. Checks out `jvgomg/homebrew-podkit`
4. Updates `Formula/podkit.rb`:
   - `version` field
   - All 4 `sha256` values (one per platform tarball)
   - URL version references (if not using `#{version}` interpolation, though the formula should use interpolation)
5. Commits and pushes to `homebrew-podkit` main branch

### Authentication

The release workflow needs write access to `homebrew-podkit`. Options (in order of preference):
- **Deploy key**: Generate an SSH keypair, add public key as a deploy key on `homebrew-podkit` with write access, store private key as a secret in the main repo
- **GitHub App**: More complex but better for orgs
- **PAT**: Simplest but tied to a user account

### Formula update approach

Either:
- **sed/awk replacement**: Simple text replacement of version and SHA values in the formula file
- **Script**: A small script in the main repo (`tools/update-formula.sh`) that takes version + checksums and rewrites the formula

The script approach is more maintainable and testable.

### Verification

After pushing the formula update, optionally trigger `brew test` in the homebrew-podkit repo via a GitHub Actions workflow there (or just rely on Homebrew's built-in test block running on `brew install`).

## Notes

- This job should only run after the GitHub Release is successfully created
- If the formula update fails, it should not affect the release (the tarballs are already published)
- Consider adding a manual trigger option for re-running the formula update if it fails
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Release workflow includes a post-release job that updates the Homebrew formula
- [ ] #2 Formula version, URLs, and SHA256 checksums are updated automatically
- [ ] #3 Authentication to homebrew-podkit uses a deploy key or equivalent secure mechanism
- [ ] #4 Formula update is committed and pushed to homebrew-podkit main branch
- [ ] #5 The update script/logic is testable independently of the CI workflow
- [ ] #6 Formula update failure does not block or roll back the GitHub Release
- [ ] #7 `brew upgrade podkit` picks up the new version after the formula is updated
<!-- AC:END -->
