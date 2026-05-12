---
id: TASK-321.03
title: 'device-harness package: TestRuntime interface + local-linux runner'
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
labels:
  - testing
  - vm-coverage
  - foundation
  - package-new
milestone: m-19
dependencies:
  - TASK-290
parent_task_id: TASK-321
priority: high
ordinal: 230
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the new `packages/device-harness/` package exposing the `TestRuntime` interface that abstracts where Tier 3 test commands run.

Interface (illustrative):
```ts
interface TestRuntime {
  id: 'local-linux' | 'lima-linux' // more later
  isAvailable(): Promise<boolean>
  prepare(): Promise<void>
  syncRepo(repoRoot: string): Promise<void>
  run(command: string, opts: RunOpts): Promise<RunResult>
  teardown(): Promise<void>
}
```

This task delivers two pieces:
1. The interface + supporting types in `src/runtime.ts`
2. The `local-linux` runner — used when the host is already Linux (CI ubuntu-latest, Linux dev hosts). Just spawns the command in-process. Detects Linux via `process.platform === 'linux'`.

`lima-linux` is **not** delivered here — it's a Phase 3 task. The harness should compile and run with just `local-linux` registered.

Wire a stub Turbo task (`test:vm`) so the harness can be discovered, but leave the task body for Phase 3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/device-harness/ exists with package.json, tsconfig.json, src/index.ts, tests
- [ ] #2 TestRuntime interface exported with the full shape (id, isAvailable, prepare, syncRepo, run, teardown)
- [ ] #3 local-linux runner implemented and tested: isAvailable returns true on Linux, false elsewhere; run spawns the given command and captures stdout/stderr/exit code
- [ ] #4 Runner registry pattern allows additional runners to be registered later without modifying core code
- [ ] #5 Stub turbo `test:vm` task wired in turbo.json (no-op body acceptable for now)
- [ ] #6 README explains the interface and how to add a new runner
<!-- AC:END -->
