---
id: TASK-498
title: 'Check whether compile:debug is a dead dependency of the VM e2e tasks'
status: To Do
assignee: []
created_date: '2026-09-08 18:03'
labels:
  - testing
  - ci
dependencies: []
references:
  - docs/architecture/dev-builds.md
priority: low
type: chore
ordinal: 277000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from the `turbo.json` cleanup done alongside task-495. Needs a host with the device substrate, which is why it was not done at the time.

`podkit#compile:debug` was removed from `@podkit/e2e-tests#test:e2e` and `#test:e2e:docker` because nothing in the host e2e path can consume `bin/podkit-debug` — verified, zero references to `podkit-debug` or `binary: 'debug'` across all 48 files in `test-packages/e2e-tests/src/`.

`compile:debug` still has two declared consumers: `@podkit/e2e-vm-tests#test:vm` and `#test:e2e:docker-dist`. **Those look dead for the same reason.** The only VM suite that uses a debug binary is `test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts`, and it resolves the **Linux** binary via `resolveDefaultPodkitDebugBinary()` (`bin/podkit-debug-linux-*`) and `/usr/local/bin/podkit-debug` — never the host `bin/podkit-debug` that `podkit#compile:debug` produces.

If confirmed, `compile:debug` may have no remaining consumer at all, at which point whether to delete the task is a separate decision — the debug build is a developer affordance (`PODKIT_DEV_HOOKS`) and may be worth keeping as a manually-invoked task even with no automated caller.

Note the measured stakes are small: `bun --compile` is ~1s, and dropping it from the host e2e tasks saved ~5.7s of a ~293s run. This is a correctness cleanup, not a performance one. Do not spend effort here expecting a speedup — `art-matrix.test.ts` alone accounts for ~215s of that run.

Context in `docs/architecture/dev-builds.md` §8.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Established, with evidence from a substrate-capable host, whether test:vm or test:e2e:docker-dist can consume the host bin/podkit-debug
- [ ] #2 Dead dependencies removed from turbo.json if confirmed dead
- [ ] #3 If compile:debug ends up with no consumer, a decision is recorded on whether to keep it as a manual developer task or delete it
- [ ] #4 dev-builds.md updated to match
<!-- AC:END -->
