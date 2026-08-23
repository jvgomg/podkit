---
id: TASK-480.04
title: >-
  P3 — thin host build scripts + run-tests.sh onto podkit-vm; atomic lock
  cutover (MF4)
status: Done
assignee: []
created_date: '2026-08-23 13:31'
updated_date: '2026-08-23 23:51'
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
- [x] #1 The 5 build wrappers + run-tests.sh call `podkit-vm` for ensure + source-staging; the duplicated status/start/rsync logic is removed and the rsync-exclude lists reconciled
- [x] #2 Lock cutover is atomic per VM: no window where two starters of the same VM use different (non-interoperating) locks
- [x] #3 vm-builder-lock.sh is retired at an explicit point; nothing still references it
- [x] #4 tools/prebuild/* recipes are unchanged and import nothing from @podkit/lima; CI `prebuild.yml` path is unaffected (verify no new Lima/@podkit/lima coupling)
- [x] #5 `bun run vm:*` commands replace `harness:*`; a full `harness:setup`/`vm:up` + build path is green
- [x] #6 A cold host with zero existing Lima instances completes `bun run harness:setup` in a single invocation — no task aborts because another task had not yet created a builder VM
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

## Outcome

All six callers thinned onto the CLI; ~-680/+658 lines, wrappers 30-60% smaller.

**Invocation form.** `bun "$REPO_ROOT/test-packages/lima/src/cli.ts" <verb>` everywhere (a `PODKIT_VM` array in each shell script), chosen over `bun run --cwd`: one process instead of two, and no dependence on bun's script resolution from a turbo task's cwd. Proven from all three working directories callers actually have. Root gains `vm:up|down|destroy|status|recover|shell`; `harness:setup`/`install`/`status` stay, since they do device work the substrate deliberately does not (binary staging, systemd unit, baseline seal).

**Exclude reconciliation.** Union of the five build wrappers became `DEFAULT_STAGE_EXCLUDES`, which callers extend rather than replace, so a caller can only prune more. Real drift was fixed: gpod-tool had been shipping `ipod-db/fixtures/databases` and `tools/libgpod-macos/build` into the builder, and glibc-binary was shipping host macOS node-gyp intermediates. `packages/libgpod-node/prebuilds` is deliberately NOT in the floor — the prebuild wrappers exclude it, the binary wrappers must carry it in for `compile.sh` to embed; pinned by a test. `run-tests.sh` keeps its aggressive prunes as a separate array: they would break the build wrappers, which need every workspace present for `bun install --frozen-lockfile`.

**Lock cutover.** Atomic by construction — after this change zero processes take the bash lock, because it is deleted. `lima-test-vm.ts prepare()` was moved onto the shared lock in the same change so that adding `vm:up` as a new device starter did not split the device group.

## Three defects found while implementing

1. **`stageSourceTree` had never been executed and was broken.** It emitted `set -o pipefail` into `sh -c`; the guests' `/bin/sh` is dash (busybox ash on Alpine), which rejects it outright — exit 2 before rsync ran. P1 shipped it untested because the wrappers it was written to replace used `bash -c`. Would have broken every VM build on first adoption.
2. **The lock's retry budget was a tenth of its documented value.** `factor: 1` pins every delay at `minTimeout`, making `maxTimeout` dead config: 600 x 200ms = 2 minutes, not the "multi-minute cold VM create" the comment claimed. A second starter therefore gave up while the first was still provisioning — which is how the first cold-host attempt failed, with `Lock file is already being held`. Now ~30 minutes, and safe because it is bounded by liveness: a dead holder stops refreshing and is reclaimed within the staleness window. `lockRetryBudgetMs()` makes the budget an assertable number, pinned by tests.
3. **The streaming runner's timeout was advisory.** It settled on `'close'`, which fires only once the child's stdio pipes shut — and a grandchild inherits them, so a forking `sh -c` deferred rejection until the grandchild exited. It now settles on the timer and escalates SIGTERM to SIGKILL. **Only the Linux test VM caught this**: macOS's `sh` execs where dash forks, so four macOS verification passes missed it.

Output streaming was added for `limactl start|create` because routing them through the buffered `execFile` runner would have swallowed the entire cold-create log, making a ten-minute provision indistinguishable from a hang.

## Verification

- **Cold host, one invocation (AC#6):** destroyed `podkit-builder-glibc`, ran `harness:setup` -> exit 0. `build:linux-prebuild` waited on the lock while `gpod-testing#build:linux-binary` cold-created the VM. This is the exact scenario that failed during P2.
- `test:vm` **232/0**; docker dist+loopback **9/0**
- `mise run test:linux:debian` **63/63 tasks, 0 failures** on a cold-created `podkit-test-glibc` — the last unexercised wrapper and the fifth renamed instance
- lint 0/0, typecheck 38/38, build 21/21; `@podkit/lima` 105 tests locally, 102 in-VM
- Prebuild artifacts: glibc `.node` byte-identical before/after. The musl artifact changed once then stayed stable across two `--force` runs; musl's exclude set was unchanged by this work, and `bun.lock` (a declared input) moved in the preceding dependency commit, which is the likely cause.
- D8 holds: `grep` finds no `@podkit/lima` or `podkit-vm` in `tools/prebuild/`, and `prebuild.yml` has an empty diff
- Lock serialisation re-proven with two concurrent starters; `vm-builder-lock.sh` deleted with no remaining references

**Not fixed, filed as TASK-484:** `gpod-testing#build:linux-binary` and `device-testing#build:linux-binary` still `rsync --delete` into the same `/tmp/podkit-builder-src` concurrently. This caused a real exit-23 failure during P2. The VM lock does not cover it — it guards starts, not staging.
<!-- SECTION:NOTES:END -->
