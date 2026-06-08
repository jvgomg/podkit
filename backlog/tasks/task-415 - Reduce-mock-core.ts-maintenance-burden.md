---
id: TASK-415
title: Reduce mock-core.ts maintenance burden
status: To Do
assignee: []
created_date: '2026-06-08 10:05'
labels:
  - refactor
  - demo
  - developer-experience
  - investigation
dependencies: []
references:
  - packages/demo/src/mock-core.ts
  - packages/demo/src/mock-core.check.ts
  - packages/podkit-core/src/index.ts
priority: low
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`packages/demo/src/mock-core.ts` mirrors every typed-error class + every public function/type that `@podkit/core` exports. The static check at `mock-core.check.ts` enforces parity at compile time — but the mirror is **manually maintained**. Every new typed error in `errors.ts` or `mass-storage-tag-writer.ts` requires a manual edit to `mock-core.ts`.

Current state: 6 typed errors mirrored (`CategorizedSyncError`, `DatabaseWriteError`, `InsufficientSpaceAfterCleanup`, `TagWriteError`, `SidecarWriteError`, `PictureWriteError`, `MoveError`) plus large surface of types/functions/constants. Every contributor adding a new export to `@podkit/core` has to remember to update `mock-core.ts` (otherwise the demo build fails — but the contributor doesn't always notice, so the burden silently grows).

## Scope

Investigation task: explore options for reducing the burden. NOT a fix task — surface tradeoffs + recommend.

Options to consider:

1. **Auto-generate `mock-core.ts` from `@podkit/core`'s `index.ts`** via a build-time script. Pros: zero manual mirror. Cons: build-step complexity; the demo needs to STUB some functions (e.g. file I/O, FFmpeg invocation), so a pure passthrough isn't enough — need a stub-resolver.

2. **Replace the static `mock-core.check.ts` with a runtime test** that imports both packages and asserts symbol parity. Pros: no codegen, simpler. Cons: still manual to add; just catches drift at test-time not type-time. Same shape as today, slightly different surface.

3. **Restructure the demo to consume `@podkit/core` directly** + inject stubs at boundaries (file system, FFmpeg, network). Pros: no mirror needed at all. Cons: probably requires architectural changes to `@podkit/core` to make boundaries injectable (may already be done via SubprocessRunner — investigate).

4. **Keep manual but add a contributor checklist** in CLAUDE.md / a template hook that warns when index.ts changes. Pros: minimal change. Cons: doesn't actually reduce burden, just makes it visible.

5. **Status quo**. Maybe the current static check IS the right shape; the manual edit is a feature (forces conscious "do I need this in the demo?" thinking). Document the rationale.

## Deliverables

- Read the existing demo + mock-core setup to ground the options.
- Survey 2-3 similar patterns in other workspaces (if any).
- Recommend an option with rationale.
- File follow-up tasks for the recommended path (don't implement the fix in this task — it's investigative).

## Why low priority

The burden grows linearly with `@podkit/core` exports. Not blocking anything today. Worth thinking about before it bites.

## Reference

- `packages/demo/src/mock-core.ts` — the mirror
- `packages/demo/src/mock-core.check.ts` — the static parity check
- `packages/podkit-core/src/index.ts` — the source of truth surface
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 #1 Survey of current mock-core surface + the manual-mirror burden documented (count of mirrored exports, frequency of updates required, contributor pain points)
- [ ] #2 #2 At least 3 options considered with pros/cons
- [ ] #3 #3 Recommendation made with rationale
- [ ] #4 #4 Follow-up task(s) filed for the recommended path if implementation is non-trivial
<!-- AC:END -->
