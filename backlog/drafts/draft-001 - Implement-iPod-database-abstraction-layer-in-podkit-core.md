---
id: DRAFT-001
title: Implement iPod database abstraction layer in podkit-core
status: Draft
assignee: []
created_date: '2026-02-25 18:26'
updated_date: '2026-02-25 18:26'
labels:
  - podkit-core
  - podkit-cli
  - refactor
dependencies:
  - TASK-043
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Implement the iPod database abstraction layer designed in TASK-043, so that `podkit-cli` only depends on `@podkit/core`.

## Prerequisites

- TASK-043 must be completed with an approved specification

## Scope

Based on the spec from TASK-043, implement:

1. **New abstractions in podkit-core** - Classes/functions for iPod operations
2. **Update podkit-core exports** - Export the new public API
3. **Update podkit-cli** - Migrate from direct libgpod-node usage to podkit-core API
4. **Remove CLI's libgpod-node dependency** - Update package.json
5. **Update tests** - Ensure all tests pass with the new architecture

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CLI only imports from `@podkit/core` (no direct `@podkit/libgpod-node` imports)
- [ ] #2 `bun run build` passes
- [ ] #3 All tests pass
- [ ] #4 CLI functionality unchanged (sync, status, list commands work)
- [ ] #5 libgpod-node details (TrackHandle, etc.) are not exposed to CLI
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
