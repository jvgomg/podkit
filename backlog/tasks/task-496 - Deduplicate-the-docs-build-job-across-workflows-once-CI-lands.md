---
id: TASK-496
title: Deduplicate the docs-build job across workflows once CI lands
status: To Do
assignee: []
created_date: '2026-09-08 18:03'
labels:
  - ci
  - testing
dependencies:
  - TASK-495
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
priority: low
type: chore
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliberately deferred out of task-495 to keep that PR off the release path. **Do not lose this** — task-495 deletes `pr-checks.yml`, which leaves the duplication half-cleaned.

The bun+docs preamble is duplicated **verbatim, explanatory comment included**, in three places:

- `.github/workflows/pr-checks.yml` — deleted by task-495
- `.github/workflows/verify-release.yml` (the `docs` job)
- `.github/workflows/deploy-docs.yml`

Each is: checkout → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile --ignore-scripts` → `bunx turbo run build --filter=@podkit/devices-ipod` → `cd packages/docs-site && bun run build`. The 5-line comment explaining why only `@podkit/devices-ipod` is built appears word-for-word in `verify-release.yml:91-94` and `deploy-docs.yml:33-37`.

**The `verify-release.yml` docs job is redundant after task-495.** Version Packages PRs fire `pull_request`, so the new `ci.yml` covers them, and `@podkit/docs-site#build` is already in turbo's graph (it has no test scripts, but turbo materialises the task node and runs `build` as a dependency of the phantom `test:unit`/`test:integration`). Removing it also requires updating `release-ci-passed`'s `needs` and its result checks — that coupling to the release path is why this was split out.

`deploy-docs.yml` is triggered by `push: docs-live` and has no equivalent coverage, so it must keep doing its own build.

**Also revisit here:** a `.github/actions/setup-podkit` composite action was considered for task-495 and rejected — after that work there is only one full caller, so it would be indirection with no reuse. Reconsider when a second job genuinely needs the native toolchain (most likely `usb-synth` on CI, deferred by ADR-028 §6, or sharding `test:e2e`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The docs job is removed from verify-release.yml and release-ci-passed's needs/result checks are updated to match
- [ ] #2 A Version Packages PR is verified to still get a docs build via the new CI workflow
- [ ] #3 deploy-docs.yml still builds the docs site on push to docs-live
- [ ] #4 The decision on whether a setup-podkit composite action is now warranted is recorded either way
<!-- AC:END -->
