---
id: TASK-405
title: Debug build pipeline with compile-time-stripped dev hooks
status: To Do
assignee: []
created_date: '2026-06-07 16:54'
labels:
  - enhancement
  - testing
  - build
  - follow-up
  - infrastructure
dependencies: []
references:
  - packages/podkit-cli/package.json
  - packages/podkit-cli/scripts/compile.sh
  - documents/architecture/conventions.md
  - test-packages/e2e-tests/src/helpers/
  - test-packages/e2e-shared/src/
priority: low
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Some e2e scenarios — notably TASK-400's SIGKILL round-trip for the pre-sync sweep — require deterministic pausing of the `podkit` CLI at a known state (e.g. after a `.podkit-tmp` is created but before its `rename` completes). The race window is microseconds for track copies, so polling-from-the-outside is inherently flaky.

The cleanest fix is a pause primitive in `podkit-core` that waits for an external signal. The pollution concern: we do not want test scaffold in the production binary.

**Solution: compile-time-stripped dev hooks.** The hook surface lives in source behind `__PODKIT_DEV_HOOKS__` (esbuild `--define`). The production `compile` task defines it `false` → the body is dead-code-eliminated by the bundler/JIT, zero footprint. A new `compile:debug` task defines it `true` → hooks are active, binary is usable by tests that need them.

This task delivers the foundational infrastructure. First consumer: TASK-400.

## Scope

1. **Hook primitive in podkit-core** (`packages/podkit-core/src/dev/hooks.ts`):
   - `devPause(key: string): Promise<void>` — when hooks active, blocks until a `SIGUSR1` is received carrying the matching key (via env-passed marker file or signal payload). When inactive, no-op.
   - Single primitive only. Future hooks added through the same surface. No env-reads scattered through unrelated modules.

2. **esbuild define plumbing**:
   - Add `__PODKIT_DEV_HOOKS__` to `packages/podkit-cli/scripts/compile.sh` defines, value driven by env var (`PODKIT_DEV_HOOKS=1` toggles to `true`, default `false`).
   - Same flag added to the dev `build` script in `packages/podkit-cli/package.json` for library consumers.
   - TypeScript: `declare const __PODKIT_DEV_HOOKS__: boolean;` in a single `.d.ts` so it's typed everywhere.

3. **New turbo task `podkit-cli#compile:debug`**:
   - Same script as `compile`, env var flipped.
   - Output: `bin/podkit-debug` (side-by-side with `bin/podkit`).
   - Independent turbo cache key (different output, different env input).

4. **e2e binary selector**:
   - Extend the CLI runner in `test-packages/e2e-shared/` so individual tests can opt into the debug binary: `setupCliRunner({ binary: 'debug' })` (default stays `'production'`).
   - `e2e-tests` and `e2e-vm-tests` declare `dependsOn: ["^compile", "^compile:debug"]` so both binaries are built before tests run.

5. **Production-cleanliness smoke test**:
   - Unit/integration test that builds the production binary and asserts `strings bin/podkit | grep PODKIT_DEV_HOOKS` returns nothing (or the equivalent — the symbol must be absent from the final binary).
   - Runs in CI as a quick guard against accidental hook leakage.

6. **Architecture doc** — new file `documents/architecture/dev-builds.md`:
   - Purpose: why a separate debug binary exists, what it solves
   - Pattern: `__PODKIT_DEV_HOOKS__` compile-time strip; `devPause(key)`; signal-based resume
   - Boundaries: hooks may carry test seams + dev observability ONLY. Never feature flags, prod toggles, billing gates, or any user-facing toggle
   - Build pipeline: turbo tasks, esbuild defines, output paths
   - e2e wiring: opt-in via test helper, when to choose debug vs production
   - Adding a new hook: recipe + checklist (add to `dev/hooks.ts`, document the key in dev-builds.md, add a smoke test, update e2e helpers if needed)
   - Production guarantees: the smoke-test recipe + how to extend it
   - Open items: what's not covered yet

## Out of scope

- The TASK-400 SIGKILL e2e itself (separate task, consumes this work).
- Generalizing hooks beyond `devPause(key)` — other primitives added as their first consumer arrives.
- Distribution of the debug binary outside of CI/dev (it is not for users).

## Acceptance

- Hook surface lives in `packages/podkit-core/src/dev/hooks.ts`; `devPause` is a no-op when `__PODKIT_DEV_HOOKS__` is `false`.
- Production binary (`bun run compile`) contains no `__PODKIT_DEV_HOOKS__` references or `devPause` body — verified by smoke test.
- `bunx turbo run podkit-cli#compile:debug` produces `bin/podkit-debug` with hooks active.
- e2e CLI runner exposes a `binary: 'debug' | 'production'` option (default `production`).
- New file `documents/architecture/dev-builds.md` covers all eight architecture-doc sections.
- `conventions.md` cross-references `dev-builds.md` under "Test seams".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 devPause(key) primitive added in packages/podkit-core/src/dev/hooks.ts
- [ ] #2 __PODKIT_DEV_HOOKS__ define plumbed through compile.sh + build script + .d.ts
- [ ] #3 New turbo task podkit-cli#compile:debug produces bin/podkit-debug with hooks active
- [ ] #4 Production binary smoke-test asserts __PODKIT_DEV_HOOKS__ symbol absent from final artifact
- [ ] #5 e2e CLI runner supports `{ binary: 'debug' | 'production' }` opt-in (default production)
- [ ] #6 e2e-tests + e2e-vm-tests turbo deps include both compile + compile:debug
- [ ] #7 documents/architecture/dev-builds.md created with full eight-section coverage
- [ ] #8 documents/architecture/conventions.md cross-references dev-builds.md under test seams
<!-- AC:END -->
