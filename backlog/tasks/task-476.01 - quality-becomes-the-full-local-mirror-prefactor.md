---
id: TASK-476.01
title: quality becomes the full local mirror (prefactor)
status: Done
assignee: []
created_date: '2026-08-06 18:21'
updated_date: '2026-08-06 22:21'
labels:
  - testing
  - ci
  - docker
  - vm
  - ready-for-agent
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
  - package.json
  - turbo.json
  - agents/testing.md
modified_files:
  - package.json
parent_task_id: TASK-476
ordinal: 237000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** `bun run quality` runs the full shipped-surface set against **locally built** assets — the same surfaces `quality:rc` will run against CI assets. Today `quality` (`turbo run qa`) omits the shipped-image surfaces and runs the host e2e against the bundle proxy. Make `quality` the local mirror: add `docker-dist` + `docker-loopback`, point the host e2e at the locally compiled binary, and run the two-phase (VM-serialized) body so `test:vm` and `docker-dist` don't collide on the shared harness VM. Absorb the former local-rebuild `quality:rc` (it ceases to be its own command; the CI `quality:rc` is added in ticket 4).

Establishes the single two-phase "mirror body" both commands will share, parameterised only by the override env values. See doc-058 (Implementation Decisions → "Two mirror commands", "Two-phase execution").

**Blocked by:** None — can start immediately.

**Domain notes:** local-only gate (never runs in GitHub CI); hard-requires Docker Desktop + the Lima harness VM. Do not change the release path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `bun run quality` runs the standard DAG PLUS docker-dist + docker-loopback, in two phases (standard DAG first, then the shipped-image surfaces), so the shared harness VM is never driven by test:vm and docker-dist concurrently
- [x] #2 quality's host e2e runs the locally compiled binary (via the existing PODKIT_CLI_BINARY seam), not the dist bundle proxy
- [x] #3 The former standalone local-rebuild quality:rc command is removed/absorbed (no third quality command remains)
- [x] #4 A full `bun run quality` is green locally against local builds
- [x] #5 The GitHub release path and CI (test:unit, verify-release) are unaffected; quality remains local-only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root package.json only. Promoted the former standalone `quality:rc` body into `quality` and removed the standalone `quality:rc` line (no third command remains). Turbo.json, workflows, release path, and package sources untouched.

Final `quality` script value:
    PODKIT_CLI_BINARY="$PWD/packages/podkit-cli/bin/podkit" bash -c 'turbo run qa "$@" && turbo run test:e2e:docker-dist test:e2e:docker-loopback "$@"' bash

Two-phase mirror body: phase 1 `turbo run qa` (standard DAG, includes test:vm), then phase 2 `turbo run test:e2e:docker-dist test:e2e:docker-loopback` — sequential `&&` so test:vm and docker-dist never drive the shared harness VM concurrently. Host e2e runs the locally compiled binary via the existing PODKIT_CLI_BINARY seam.

Flag passthrough preserved: the trailing literal `bash` token becomes $0, so any args bun appends after the script land in "$@" and are forwarded to BOTH turbo invocations. Verified empirically:
- `bun run quality -- --dry-run` → expanded to `... bash --dry-run`; turbo printed a plan without executing (dry-run reached turbo, proving passthrough).
- `bun run quality --force --dry-run` → expanded to `... bash --force --dry-run`; turbo produced a valid plan (both flags reached turbo).

DAG evidence (turbo --dry=json):
- Phase 1 (qa): 323 tasks, 24 `#test:vm` tasks incl. the real `@podkit/e2e-vm-tests#test:vm`; ZERO docker-dist/docker-loopback tasks.
- Phase 2: exactly `@podkit/e2e-vm-tests#test:e2e:docker-dist` and `@podkit/e2e-tests#test:e2e:docker-loopback`.
- Global Passed Through Env Vars shows PODKIT_CLI_BINARY (with a value hash), confirming the compiled-binary seam is forwarded through turbo's strict env filter.

AC#4 (full green run) NOT achieved — blocked by an environmental VM-harness failure independent of this change:
- Two full `bun run quality` runs both failed in phase 1's `@podkit/e2e-vm-tests#test:vm`. Run 1: 164 pass / 2 skip / 2 fail (doctor-scope-refactor.e2e.test.ts hook timeout 88s + save-failure-matrix.e2e.test.ts hook timeout 60s). Run 2: doctor-scope-refactor PASSED, save-failure-matrix FAILED again (60s hook timeout). Both failures are `beforeEach/afterEach hook timed out`, not assertion failures. Phase 2 never ran because the `&&` short-circuited on phase-1 failure.
- Triage: this is NOT caused by the script change. My change only reorders/orchestrates the identical `turbo run qa`/test:vm. Proven environmental: (a) save-failure-matrix reproduces the exact 60000ms beforeAll hook timeout when run as a single isolated file on a freshly-cleaned harness (dangling podkit-daemon killed, stale mounts cleared) with host load 2.3 and VM load 0.54; (b) the test file is unmodified since before the last "quality:rc green end-to-end" commit; (c) it hits ~60000ms exactly every run = a hard wedge on one matrix cell's VM operation (its beforeAll iterates the full SAVE_FAIL_CELLS matrix provisioning near-full mounts within VM_COLD_TIMEOUT_MS=60000). Fixing that VM test (raise the budget / split the matrix / unwedge the near-full-mount provisioning) is orthogonal to this package.json-only task. No masking or `|| true` was added.
- Note: during this session the working tree also contains sibling-epic changes made by concurrent agents in this shared workspace (.github/workflows/* for 476.03, test-packages/device-testing/src/index.ts additive rc-build exports for 476.02); those are additive/unrelated and do not affect test:vm behaviour.

Team-lead status: CODE COMPLETE, one AC gated externally.

Final `quality` (root package.json): `PODKIT_CLI_BINARY="$PWD/packages/podkit-cli/bin/podkit" bash -c 'turbo run qa "$@" && turbo run test:e2e:docker-dist test:e2e:docker-loopback "$@"' bash` (trailing `bash` = $0 so bun-appended args land in $@ and forward to both phases). Standalone `quality:rc` line removed (TASK-476.04 re-adds a CI-fetching one).

Verified (AC#1,#2,#3,#5 checked): dry-run shows phase 1 = qa DAG incl. the real @podkit/e2e-vm-tests#test:vm and ZERO docker surfaces; phase 2 = exactly docker-dist + docker-loopback; PODKIT_CLI_BINARY appears in turbo's passed-through env; `-- --dry-run` and `--force --dry-run` both reach turbo (passthrough intact).

AC#4 (full `bun run quality` green) NOT met — BLOCKED by a pre-existing/environmental VM-test wedge, not by this change: `save-failure-matrix.e2e.test.ts` beforeAll hits its 60s VM_COLD_TIMEOUT_MS in phase-1 test:vm (reproduces isolated on a clean harness; file unmodified; our change only reorders identical turbo calls). Filed as **TASK-477** (high, m-22). AC#4 will close once 477 is fixed and a full `bun run quality` runs green. Two full runs observed: 13m15s (2 fail) and 7m57s warm (save-failure-matrix still fails; doctor-scope-refactor passed on rerun — harness running slow).

Note: TASK-476.04 refactors this same `quality` line to delegate to a shared two-phase 'mirror body' runner (doc-058's single-shared-body goal) that quality:rc also calls — so the final package.json `quality` string may change to invoke that shared runner; passthrough contract preserved + re-validated there.

AC#4 CLOSED: full `bun run quality` verified GREEN end-to-end after the TASK-477 fixes (save-failure-matrix observe budget + runDoctor resilience). QUALITY_EXIT=0; phase 1 (qa incl. test:vm) 94/94 tasks, e2e-vm-tests test:vm 194 pass/0 fail; phase 2 (docker-dist + docker-loopback) 25/25 tasks, 6/0 + 3/0. All five ACs met and committed. Done.
<!-- SECTION:NOTES:END -->
