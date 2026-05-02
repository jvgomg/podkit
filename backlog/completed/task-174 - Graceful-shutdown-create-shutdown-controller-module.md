---
id: TASK-174
title: 'Graceful shutdown: create shutdown controller module'
status: Done
assignee: []
created_date: '2026-03-21 21:18'
updated_date: '2026-03-21 21:21'
labels:
  - graceful-shutdown
dependencies: []
references:
  - packages/e2e-tests/src/docker/signal-handler.ts
  - packages/podkit-cli/src/main.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `packages/podkit-cli/src/shutdown.ts` — a module that manages SIGINT/SIGTERM signal handling via AbortController.

**Behavior:**
- First SIGINT/SIGTERM: abort the controller, print "Graceful shutdown requested. Finishing current operation..." to stderr
- Second SIGINT/SIGTERM: print "Force quit." to stderr, call `process.exit(130)`
- Exposes `signal: AbortSignal` for consumers
- `install()` / `uninstall()` to manage listeners (avoid leaks)
- `isShuttingDown` readonly property

**Reference:** `packages/e2e-tests/src/docker/signal-handler.ts` for pattern inspiration
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 shutdown.ts module exports createShutdownController()
- [x] #2 First signal aborts the AbortController and prints message to stderr
- [x] #3 Second signal calls process.exit(130)
- [x] #4 install() registers handlers, uninstall() removes them
- [x] #5 isShuttingDown property reflects state
- [x] #6 Unit tests cover single signal, double signal, install/uninstall lifecycle
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the graceful shutdown controller module.

**Files created:**
- `packages/podkit-cli/src/shutdown.ts` — ShutdownController interface and `createShutdownController()` factory
- `packages/podkit-cli/src/shutdown.test.ts` — 8 unit tests covering initial state, idempotency, and options

**Behavior:**
- First SIGINT/SIGTERM: aborts the internal AbortController, sets `isShuttingDown = true`, writes message to stderr, calls `onShutdown` callback
- Second signal: writes "Force quit." to stderr and exits with code 130
- `install()`/`uninstall()` are idempotent (guarded by `installed` flag)

**Quality gates:** All 58 podkit-cli tests pass. TypeScript typecheck passes clean.
<!-- SECTION:FINAL_SUMMARY:END -->
