---
id: TASK-496
title: Audit and consolidate the workflows the CI backstop now supersedes
status: To Do
assignee: []
created_date: '2026-09-08 18:03'
updated_date: '2026-09-08 19:40'
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
Now that `ci.yml` exists (task-495), several workflows overlap it or duplicate each other. Deliberately deferred out of that PR to keep it off the release path — **do not lose this**: task-495 already deleted `pr-checks.yml`, which leaves the duplication half-cleaned.

Work through the eight workflows and decide, for each, whether it is superseded, overlapping, or still load-bearing.

## Known overlaps

**1. `verify-release.yml`'s `docs` job is redundant.** Version Packages PRs fire `pull_request`, so `ci.yml` covers them, and `@podkit/docs-site#build` is already in turbo's graph (docs-site has no test script, but turbo materialises the task node and runs its `build` as a dependency). Removing it also means updating `release-ci-passed`'s `needs` and its result checks — that coupling to the release path is exactly why it was split out.

**2. The bun+docs preamble is triplicated verbatim, comment included** — it was in `pr-checks.yml` (now deleted), `verify-release.yml`'s `docs` job, and `deploy-docs.yml`. Each is: checkout → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile --ignore-scripts` → `bunx turbo run build --filter=@podkit/devices-ipod` → `cd packages/docs-site && bun run build`. The 5-line comment explaining why only `@podkit/devices-ipod` is built appears word-for-word in `verify-release.yml:91-94` and `deploy-docs.yml:33-37`. `deploy-docs.yml` is triggered by `push: docs-live` and has no equivalent coverage, so it must keep building the site itself.

**3. `.github/actions/setup-podkit` was considered for task-495 and rejected** — after that work there was only one full caller, so it would have been indirection with no reuse. Re-decide here: the calculus changes if `usb-synth` on CI (deferred by ADR-028 §6) or e2e sharding creates a second caller.

## Also worth deciding here

- **Required checks.** The `Release checks` ruleset on the default branch currently requires exactly one context, `Release CI Status`. `CI Status` should join it once the backstop has proven itself — decide whether both belong, or whether `Release CI Status` is now redundant for non-release PRs given it self-gates on the PR title.
- **`build-platform.yml` is 820 lines** with 6+ copies of the libc verification gates (`readelf -d` NEEDED, `readelf -l` interpreter, `ldd`/`otool -L`) and four divergent `actions/cache` key families. Not superseded by `ci.yml`, but it is the largest duplication in the repo and the natural next target.
- **Hygiene the audit will surface:** no action is SHA-pinned, there is no `dependabot.yml`, and every workflow but `ci.yml` uses `bun-version: latest` while `mise.toml` pins `1.3.13`. Decide whether to fix here or split out.

Scope this pragmatically — the goal is that no workflow runs work `ci.yml` already does, not a rewrite of the release pipeline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every workflow is classified as superseded by ci.yml, overlapping, or still load-bearing, with the reasoning recorded
- [ ] #2 The docs job is removed from verify-release.yml and release-ci-passed's needs/result checks are updated to match
- [ ] #3 A Version Packages PR is verified to still get a docs build via ci.yml
- [ ] #4 deploy-docs.yml still builds the docs site on push to docs-live
- [ ] #5 No workflow duplicates work ci.yml already performs
- [ ] #6 The decision on whether a setup-podkit composite action is now warranted is recorded either way
- [ ] #7 A decision is recorded on which checks the Release checks ruleset should require now that CI Status exists
<!-- AC:END -->
