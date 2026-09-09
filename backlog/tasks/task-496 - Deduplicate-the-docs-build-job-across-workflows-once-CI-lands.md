---
id: TASK-496
title: Audit and consolidate the workflows the CI backstop now supersedes
status: To Do
assignee: []
created_date: '2026-09-08 18:03'
updated_date: '2026-09-09 19:23'
labels:
  - ci
  - testing
dependencies:
  - TASK-495
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
priority: medium
type: chore
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Now that `ci.yml` exists (task-495), several workflows overlap it or duplicate each other. Deliberately deferred out of that PR to keep it off the release path — **do not lose this**: task-495 already deleted `pr-checks.yml`, which leaves the duplication half-cleaned.

Work through the eight workflows and decide, for each, whether it is superseded, overlapping, or still load-bearing.

## Standing decision from the owner (2026-09-09): `main` is never protected

**Do not add branch protection or a required-checks ruleset to `main`, and do not propose it again.** Changes land on `main` freely and directly — no PR requirement, no required `CI Status`. This is settled, and it reverses a suggestion made while closing task-501.

Two things follow from it, and they are the real work here:

1. **`main`'s health must be *visible*, because it is not enforced.** With direct pushes allowed, a red `main` is possible and nothing blocks it. Someone must be able to answer "is `main` green right now?" quickly and without guessing — a badge, a documented one-liner, or whatever the audit concludes. This is the substitute for protection, not a nice-to-have alongside it.
2. **The release path *is* gated, and that gate has to be real.** A `Release checks` ruleset is already active on the default branch requiring exactly one context, `Release CI Status`. Confirm it actually blocks a Version Packages PR from merging red — the push that landed task-499/501 reported `Required status check "Release CI Status" is expected` and went through anyway, so its current enforcement against a direct push is, at best, unverified. Whether that is bypass-by-admin, a rule that only binds PR merges, or a hole is exactly what needs establishing.

The distinction to hold onto: **`main` is unguarded on purpose; a release is not.** Everything below should be read against that.

## Known overlaps

**1. `verify-release.yml`'s `docs` job is redundant.** Version Packages PRs fire `pull_request`, so `ci.yml` covers them, and `@podkit/docs-site#build` is already in turbo's graph (docs-site has no test script, but turbo materialises the task node and runs its `build` as a dependency). Removing it also means updating `release-ci-passed`'s `needs` and its result checks — that coupling to the release path is exactly why it was split out.

**2. The bun+docs preamble is triplicated verbatim, comment included** — it was in `pr-checks.yml` (now deleted), `verify-release.yml`'s `docs` job, and `deploy-docs.yml`. Each is: checkout → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile --ignore-scripts` → `bunx turbo run build --filter=@podkit/devices-ipod` → `cd packages/docs-site && bun run build`. The 5-line comment explaining why only `@podkit/devices-ipod` is built appears word-for-word in `verify-release.yml:91-94` and `deploy-docs.yml:33-37`. `deploy-docs.yml` is triggered by `push: docs-live` and has no equivalent coverage, so it must keep building the site itself.

**3. `.github/actions/setup-podkit` was considered for task-495 and rejected** — after that work there was only one full caller, so it would have been indirection with no reuse. Re-decide here: the calculus changes if `usb-synth` on CI (deferred by ADR-028 §6) or e2e sharding creates a second caller.

## Also worth deciding here

- **`build-platform.yml` is 820 lines** with 6+ copies of the libc verification gates (`readelf -d` NEEDED, `readelf -l` interpreter, `ldd`/`otool -L`) and four divergent `actions/cache` key families. Not superseded by `ci.yml`, but it is the largest duplication in the repo and the natural next target.
- **Hygiene the audit will surface:** no action is SHA-pinned, there is no `dependabot.yml`, and every workflow but `ci.yml` uses `bun-version: latest` while `mise.toml` pins `1.3.13`. Decide whether to fix here or split out.
- **`e2e-stress.yml`** (added under task-501) runs a 12-sample flake-rate matrix on `push` to `stress/**`. It duplicates `ci.yml`'s setup preamble by design — it deliberately omits the turbo cache — so fold it into the setup-composite-action decision above rather than the dedupe sweep.

Scope this pragmatically — the goal is that no workflow runs work `ci.yml` already does, not a rewrite of the release pipeline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every workflow is classified as superseded by ci.yml, overlapping, or still load-bearing, with the reasoning recorded
- [ ] #2 The docs job is removed from verify-release.yml and release-ci-passed's needs/result checks are updated to match
- [ ] #3 A Version Packages PR is verified to still get a docs build via ci.yml
- [ ] #4 deploy-docs.yml still builds the docs site on push to docs-live
- [ ] #5 No workflow duplicates work ci.yml already performs
- [ ] #6 The decision on whether a setup-podkit composite action is now warranted is recorded either way, covering e2e-stress.yml as a second caller
- [ ] #7 `main` is confirmed to have no branch protection and no required-checks ruleset, and the standing decision not to add one is recorded where a future contributor will find it (not only in this task)
- [ ] #8 The release gate is verified to actually block: a Version Packages PR cannot merge with `Release CI Status` red, established by testing or by reading the ruleset's bypass configuration rather than assumed
- [ ] #9 It is established whether the `Release checks` ruleset binds direct pushes to main at all — the task-499/501 push reported the check as expected and succeeded anyway — and the answer is recorded
- [ ] #10 There is a documented, quick way to see whether `main` is currently green, since nothing enforces that it is
<!-- AC:END -->
