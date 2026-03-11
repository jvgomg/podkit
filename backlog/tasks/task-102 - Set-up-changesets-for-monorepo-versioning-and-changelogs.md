---
id: TASK-102
title: Set up changesets for monorepo versioning and changelogs
status: To Do
assignee: []
created_date: '2026-03-11 14:15'
labels:
  - dx
  - packaging
  - ci
milestone: Homebrew Distribution
dependencies: []
references:
  - package.json
  - packages/podkit-cli/package.json
  - packages/podkit-core/package.json
  - packages/libgpod-node/package.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Install and configure [changesets](https://github.com/changesets/changesets) to manage versioning and changelog generation across the podkit monorepo. Changesets is the foundation for the entire release pipeline — it determines when versions bump, what changelogs say, and when releases are triggered.

## Context

podkit is a monorepo with independently versionable packages (`@podkit/core`, `@podkit/libgpod-node`, `podkit` CLI). We want independent versioning so a CLI-only change doesn't bump core. However, since CLI depends on core, a core change should also bump CLI (as a patch).

## Implementation

1. Install `@changesets/cli` and `@changesets/changelog-github` as dev dependencies
2. Run `bunx changeset init` to create `.changeset/config.json`
3. Configure for independent versioning (`"fixed": []`, not `"linked"`)
4. Set `"access": "public"` for scoped packages
5. Configure `@changesets/changelog-github` as the changelog generator (requires `repo` field pointing to `jvgomg/podkit`)
6. Add a `changeset` script to root `package.json` for convenience (`bunx changeset`)
7. Add a `version` script (`bunx changeset version`)
8. Create a test changeset and verify `bunx changeset version` correctly bumps versions and generates CHANGELOG.md entries
9. Clean up test changeset after verification

## Key Configuration Decisions

- **Independent versioning**: Each package has its own version. Changesets automatically bumps dependents when a dependency changes.
- **Changelog format**: `@changesets/changelog-github` links PRs and contributors in the changelog.
- **Commit messages**: Changesets defaults to not committing version bumps automatically — the release workflow handles this via a "Version Packages" PR.

## References

- [Changesets intro](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Changesets config options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- Root `package.json`: `/package.json`
- Existing packages: `packages/podkit-cli/package.json`, `packages/podkit-core/package.json`, `packages/libgpod-node/package.json`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 changesets CLI installed as dev dependency and `.changeset/config.json` created with independent versioning
- [ ] #2 Running `bunx changeset` interactively creates a changeset file in `.changeset/`
- [ ] #3 Running `bunx changeset version` bumps package versions in package.json and generates CHANGELOG.md entries
- [ ] #4 When a changeset bumps `@podkit/core`, the CLI package also gets a patch bump as a dependent
- [ ] #5 Changelog entries include links to GitHub PRs and contributors via `@changesets/changelog-github`
- [ ] #6 Root package.json has `changeset` and `version` convenience scripts
<!-- AC:END -->
