---
id: TASK-101
title: Set up npm publishing with changesets and prebuilt binaries
status: To Do
assignee: []
created_date: '2026-03-10 16:08'
updated_date: '2026-03-11 14:18'
labels:
  - dx
  - packaging
  - ci
  - npm
dependencies:
  - TASK-100
  - TASK-104
  - TASK-107
references:
  - packages/libgpod-node/package.json
  - .github/workflows/prebuild.yml
  - TASK-100
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Set up automated npm publishing using changesets. This task is **deferred until the Homebrew Distribution milestone (m-7) is complete**, as changesets setup and the release workflow are being built there first. This task's scope is now limited to the npm-specific publishing concerns that build on top of that foundation.

## Remaining Scope (post-Homebrew milestone)

Once the Homebrew milestone is done, the following will already exist:
- Changesets CLI configured for the monorepo
- GitHub Actions release workflow producing compiled CLI binaries
- GitHub Releases with changelogs

This task then covers:
1. Adding `npm publish` to the release workflow for `@podkit/core` and `@podkit/libgpod-node`
2. Ensuring prebuilt `.node` binaries are included in the published `@podkit/libgpod-node` npm package
3. Verifying `npm install @podkit/libgpod-node` works on a clean system without native build tools
4. Configuring independent versioning so core-only changes don't require CLI releases

## Reference

- [changesets GitHub Action](https://github.com/changesets/action)
- prebuild workflow: `.github/workflows/prebuild.yml`
- Package files config: `packages/libgpod-node/package.json` (`files` field includes `prebuilds/`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 changesets CLI installed and configured for the monorepo
- [ ] #2 Release workflow uses changesets/action to manage version PRs and npm publish
- [ ] #3 Prebuilt native binaries from prebuild.yml are included in the published npm package
- [ ] #4 npm install @podkit/libgpod-node on a clean system (no libgpod) loads the prebuilt binary successfully
- [ ] #5 CHANGELOG.md is auto-generated from changeset entries
<!-- AC:END -->
