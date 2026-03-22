---
id: TASK-186.15
title: Remove unused ContentTypeHandler registry from public API
status: Done
assignee: []
created_date: '2026-03-22 12:57'
updated_date: '2026-03-22 20:43'
labels:
  - cleanup
  - tech-debt
dependencies: []
references:
  - packages/podkit-core/src/sync/content-type.ts
parent_task_id: TASK-186
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal\n\nRemove the handler registry functions (`registerHandler`, `getHandler`, `getAllHandlers`, `clearHandlers`) from `packages/podkit-core/src/sync/content-type.ts` and the public API exports in `packages/podkit-core/src/index.ts`.\n\n## Background\n\nThe handler registry was built for a plugin-style dispatch pattern, but it is never used anywhere in the codebase. Handlers are always created directly via factory functions (`createMusicHandler()`, `createVideoHandler()`), and the CLI uses the `ContentTypePresenter` pattern for dispatch.\n\nDuring the TASK-186 Phase 3 review (2026-03-22), the decision was made to remove the registry as YAGNI rather than adding tests for dead code. If a plugin system is needed in the future, it should be designed properly for that use case.\n\n## What to do\n\n1. Remove `registerHandler`, `getHandler`, `getAllHandlers`, `clearHandlers` functions and the module-level `Map` from `packages/podkit-core/src/sync/content-type.ts`\n2. Remove the corresponding exports from `packages/podkit-core/src/index.ts`\n3. Search for any references to these functions in tests or other code and remove them\n4. Run `bun run build` and `bun run test --filter '@podkit/core'` to verify\n\n## Decision rationale\n\n- Registry functions are exported but have zero callers in production or test code\n- The factory pattern (`createMusicHandler()`, `createVideoHandler()`) is what's actually used\n- The CLI's `ContentTypePresenter` pattern handles content-type dispatch\n- Adding tests for unused code increases maintenance burden without value"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Registry functions (registerHandler, getHandler, getAllHandlers, clearHandlers) removed from content-type.ts
- [x] #2 Registry exports removed from index.ts
- [x] #3 No remaining references to registry functions in the codebase
- [x] #4 Build and tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision history\n\nThis task was originally \"Add tests for ContentTypeHandler registry\". During the TASK-186 Phase 3 session (2026-03-22), the decision was made to remove the registry instead of testing it, since it has zero callers in production or test code. Task repurposed accordingly."

## Completed (2026-03-22)

Removed handler registry from content-type.ts (Map + 4 functions), index.ts exports, and demo mock. No callers existed.
<!-- SECTION:NOTES:END -->
