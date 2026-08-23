---
id: TASK-480.04
title: >-
  P3 — thin host build scripts + run-tests.sh onto podkit-vm; atomic lock
  cutover (MF4)
status: To Do
assignee: []
created_date: '2026-08-23 13:31'
updated_date: '2026-08-23 20:26'
labels:
  - testing
  - ci
  - vm
  - refactor
  - ready-for-agent
milestone: m-22
dependencies:
  - TASK-480.02
references:
  - >-
    backlog/docs/doc-059 -
    RFC-podkit-lima-—-consolidate-Lima-VM-lifecycle-configs-into-a-first-class-package.md
  - backlog/drafts/vm-harness-decisions.md
  - test-packages/device-testing/scripts/vm-builder-lock.sh
parent_task_id: TASK-480
priority: medium
ordinal: 258000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** collapse the duplicated host-side VM-orchestration logic by making the build wrappers and the Linux test runner thin callers of `podkit-vm`, and cut over from the P0 bash lock to the CLI lock atomically.

Per D8/D11 + MF4: thin `build-linux-prebuild.sh`, `build-linux-binary.sh`, `build-musl-prebuild.sh`, `build-musl-binary.sh`, `build-gpod-tool-linux.sh`, and `run-tests.sh` so their ensure + source-staging go through `podkit-vm ensure` + the unified `stageSourceTree` (reconcile the drifted rsync-exclude lists). The in-VM `tools/prebuild/*` **recipes stay untouched and must not import `@podkit/lima`** (CI runs them directly). 

**MF4 (critical):** the shipped `vm-builder-lock.sh` (mkdir + owner-PID at `${TMPDIR}/podkit-vmlock-<VM>`) and the `proper-lockfile` CLI lock do NOT interoperate. Migrate ALL starters of a given VM to the CLI lock in ONE atomic step (or have the CLI lock reuse the bash path/algorithm during transition) — a half-migrated state reintroduces the P0 race. Retire `vm-builder-lock.sh` at an explicit point once its scripts flip together.

**Blocked by:** P1. **Domain notes:** replace `bun run harness:*` with `bun run vm:*` wrappers over `podkit-vm`; keep test-suite task names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The 5 build wrappers + run-tests.sh call `podkit-vm` for ensure + source-staging; the duplicated status/start/rsync logic is removed and the rsync-exclude lists reconciled
- [ ] #2 Lock cutover is atomic per VM: no window where two starters of the same VM use different (non-interoperating) locks
- [ ] #3 vm-builder-lock.sh is retired at an explicit point; nothing still references it
- [ ] #4 tools/prebuild/* recipes are unchanged and import nothing from @podkit/lima; CI `prebuild.yml` path is unaffected (verify no new Lima/@podkit/lima coupling)
- [ ] #5 `bun run vm:*` commands replace `harness:*`; a full `harness:setup`/`vm:up` + build path is green
- [ ] #6 A cold host with zero existing Lima instances completes `bun run harness:setup` in a single invocation — no task aborts because another task had not yet created a builder VM
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Cold-start ordering gap — observed live during the P2 re-provision, and a concrete case this task must fix.**

`test-packages/device-testing/scripts/build-gpod-tool-linux.sh` (lines ~37-42) refuses to *create* the glibc builder VM: on `state=NotFound` it hard-errors with "Run `bunx turbo run @podkit/device-testing#build:linux-prebuild` first" and exits 1. It only starts an already-existing *Stopped* instance. Meanwhile `@podkit/gpod-testing#build:linux-binary` and `@podkit/device-testing#build:linux-prebuild` have no ordering edge between them in `turbo.json`, so turbo schedules them in parallel.

Consequence: on any host where the glibc builder instance does not exist at all, `bun run harness:setup` fails within ~250ms — gpod-tool checks status, finds NotFound, and aborts the whole turbo run before prebuild has created the VM. The P0 lock does not help here: it correctly serialises the check-then-start, but gpod-tool's branch for "VM absent" is to error rather than to create, so mutual exclusion has nothing to protect.

This is pre-existing (not introduced by P2) and was simply invisible on developer machines where `podkit-linux-builder` already existed — the `NotFound` branch never fired. The P2 rename to `podkit-builder-glibc` made every host cold, which surfaced it. Workaround while it stands: run `build:linux-prebuild` once by hand before `harness:setup`.

This is precisely what D8/P3 is for. When these wrappers are thinned onto `bunx podkit-vm ensure <instance>`, `ensure` creates-or-starts, so the "someone else must have made it first" contract disappears and both tasks become legitimate starters (which D13 already argues they must be, since turbo caching means either can independently be a cache-miss). Worth an explicit acceptance criterion: **a cold host with zero Lima instances must complete `harness:setup` in one invocation.**

**Plan open item #3 resolved: `bunx podkit-vm` does NOT work in this repo — the P3 plan text must be revised before implementation.**

Verified empirically on 2026-08-23: `bunx podkit-vm status device` fails with `GET https://registry.npmjs.org/podkit-vm - 404` — bunx falls through to the npm registry because the workspace bin is not linked. There is no `node_modules/@podkit` directory at all (Bun resolves workspace dependencies without symlinking them into `node_modules`), and `node_modules/.bin` contains only genuine npm package bins (changeset, husky, lint-staged, manypkg, oxlint). Declaring `"bin": { "podkit-vm": "./src/cli.ts" }` in a private workspace package buys nothing on its own.

The implementation plan's P3 section specifies `bunx podkit-vm ensure <instance>` in roughly seven places (the per-script strip/replace table, the D8 invariant paragraph, and the risks section, which even flags 'podkit-vm not on PATH' as a risk to verify). Taken literally, every one of those call sites would fail.

The repo's established convention for reaching a workspace script is `bun run --cwd <package> <script>` — see the ten `harness:*` entries in the root `package.json`. So P3 should either:
- add a `podkit-vm` script to `test-packages/lima/package.json` and call `bun run --cwd test-packages/lima podkit-vm <verb> <instance>`, or
- invoke the entry point directly: `bun test-packages/lima/src/cli.ts <verb> <instance>` (confirmed working — `bun test-packages/lima/src/cli.ts status device` prints `running`).

Whichever is chosen, the shell wrappers need a repo-root-relative path since they run from varying working directories.

Related: `cli.ts` gained an `import.meta.main` guard so the module can be imported by tests without executing. Direct invocation was re-verified after that change and still works correctly.
<!-- SECTION:NOTES:END -->
