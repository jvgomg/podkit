---
id: TASK-476.02
title: RC-build discovery + preflight decision (seam + unit tests)
status: Done
assignee: []
created_date: '2026-08-06 18:22'
updated_date: '2026-08-06 22:21'
labels:
  - testing
  - ci
  - release
  - ready-for-agent
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
  - test-packages/device-testing/src/runners/lima-docker-image.test.ts
  - test-packages/e2e-tests/src/docker/podkit-image.test.ts
parent_task_id: TASK-476
ordinal: 238000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** a tested, pure decision function that classifies the state of the release-candidate build from injected `gh` command outputs, so `quality:rc` (ticket 4) can preflight and either proceed or fail fast with an actionable message. No real `gh`, no side effects in this ticket — just the decision.

The function locates the most recent release-verification run for the open "Version Packages" PR and returns one of (prototype-precise shape, from doc-058):

```
type RcBuildState =
  | { kind: 'no-version-pr' }
  | { kind: 'build-in-progress'; runId; url }
  | { kind: 'build-failed'; runId; url }
  | { kind: 'ready'; runId; prNumber }
```

Plus the fail-fast-vs-`--wait` policy (default: fail fast on any non-ready state; `--wait` blocks on `build-in-progress`). An explicit run-id override bypasses discovery.

**Blocked by:** None — can start immediately.

**Domain notes:** highest-seam design — the `gh` invocations go through an injected command runner (the existing `SubprocessRunner`-style DI seam) so the classification is unit-tested with scripted outputs, exactly like the scripted-runner tests for the Lima docker-image / host-image runners.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A pure function takes an injected command runner and returns the typed RcBuildState (no-version-pr / build-in-progress / build-failed / ready) plus the chosen run id
- [x] #2 Discovery picks the most recent release-verification run for the open "Version Packages" PR; an explicit run-id override bypasses discovery
- [x] #3 Fail-fast-vs-wait policy is encoded: default fails fast on any non-ready state; --wait is honoured only for build-in-progress
- [x] #4 Unit tests cover all four states + the --wait branch using scripted command-runner outputs, no real gh, following the existing scripted-SubprocessRunner test pattern
- [x] #5 No network / no real subprocess in the tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the pure RC-build classifier as a new module in @podkit/device-testing.

Files:
- test-packages/device-testing/src/rc-build/resolve-rc-build.ts — `resolveRcBuildState(options)` + exported `RcBuildState` union, `ResolveRcBuildOptions`, typed `RcBuildDiscoveryError`, and `VERSION_PR_TITLE`/`WORKFLOW_FILE` constants.
- test-packages/device-testing/src/rc-build/resolve-rc-build.test.ts — 10 tests using a local scripted `SubprocessRunner` (mirrors lima-docker-image.test.ts).

Design:
- Every `gh` call goes through the injected `SubprocessRunner` DI seam (re-exported from ../subprocess.js). No real gh/network/subprocess/fs.
- Discovery: `gh pr list --state open --search 'Version Packages in:title' --json number,title,headRefName` (exact-title filter, since in:title is fuzzy) → if none, `no-version-pr`. Then `gh run list --workflow verify-release.yml --branch <headRefName> --json databaseId,status,conclusion,url,createdAt --limit 20`, newest picked by createdAt (not list order). Then classify.
- Override: `runId` bypasses discovery entirely; `gh run view <id> --json databaseId,status,conclusion,url,createdAt` then classify. On a ready override, prNumber is null (no PR discovered) — the ready variant is `{runId; prNumber: number | null}`, extending the doc-058 shape only to represent the override case honestly (discovery path always yields a real number).
- Classification: status !== 'completed' → build-in-progress; completed && conclusion==='success' → ready; completed && other → build-failed.
- Policy: default fails fast (returns the non-ready state — the caller/ticket-4 turns it into a message). `wait:true` is honoured ONLY for build-in-progress: polls via `gh run view <id>` until completed, re-classifying to ready/failed. Sleep is injectable (`sleep` option, default real setTimeout; `pollIntervalMs` default 5000) so tests inject a recording fake with no timers.
- Typed errors only (RcBuildDiscoveryError) for gh failures / malformed JSON / PR-with-no-run; no console.warn / stray stderr.

Gates run (all PASS): `bun test .../resolve-rc-build.test.ts` (10 pass); `bunx tsc --noEmit` in the package (exit 0); `bunx oxlint --config oxlint.json` on the dir (0 warnings/0 errors); `bunx prettier --check` (clean after --write).

Out of scope (ticket 4): the side-effecting glue — artefact download, env assembly, invoking the two-phase body.

Review follow-up (additive-gap fixes, no behavioral changes):
- Barrel: `src/index.ts` now re-exports the rc-build public surface (`resolveRcBuildState`, `RcBuildState`, `ResolveRcBuildOptions`, `RcBuildDiscoveryError`, `VERSION_PR_TITLE`, `WORKFLOW_FILE`) so downstream packages can import from `@podkit/device-testing` instead of a deep path.
- Error-path test coverage added: gh non-zero exit, malformed JSON stdout, PR-found-but-no-run-yet — all asserted via `RcBuildDiscoveryError`.
- `parseJson` now takes a `shape: 'array' | 'object'` param and rejects a parsed value of the wrong top-level shape (e.g. `null` where an object is expected) with a typed `RcBuildDiscoveryError` instead of letting a raw TypeError leak downstream; covered by a new test (`gh run view` returning `null`).
- Added a test for the run-id-override path landing on `build-failed`, confirming the override shares `classifyRun` with the discovery path.
- Added a one-line comment on the exact-title `.find()` documenting the at-most-one-open-PR assumption.
- Test count: 10 → 15, all passing.

Team-lead review (Sonnet) verdict: SHIP-WITH-NITS. Classifier logic confirmed correct across the full state matrix (queued/waiting/requested→in-progress; completed+null-conclusion→build-failed fail-safe; --wait scoped strictly to build-in-progress; override bypasses discovery via argv assertion; pure seam, no real subprocess/network/fs/timers). Gaps were additive only.

Follow-up fixes applied (Sonnet worker), all scoped to rc-build/ + the barrel:
- Barrel export: test-packages/device-testing/src/index.ts now re-exports resolveRcBuildState, RcBuildDiscoveryError, RcBuildState, ResolveRcBuildOptions, VERSION_PR_TITLE, WORKFLOW_FILE (matches sibling seam-module convention; unblocks 476.04's @podkit/device-testing import).
- parseJson shape guard: rejects null / wrong top-level shape (array-vs-object) with typed RcBuildDiscoveryError instead of leaking a raw TypeError downstream.
- Error-path test coverage added (was zero): gh non-zero exit, malformed JSON, PR-found-but-empty-run-list, wrong-shape (run view→null), plus override+build-failed. Test count 10→15 pass, 31 expects.
- One-line comment documenting the at-most-one-open-'Version Packages'-PR first-match assumption.
Gates re-run: bun test 15 pass, tsc -p device-testing exit 0, oxlint 0/0, prettier clean. No behavior/semantics/gh-shape changes. Full-DAG typecheck is additionally exercised by 476.01's exclusive green run.
<!-- SECTION:NOTES:END -->
