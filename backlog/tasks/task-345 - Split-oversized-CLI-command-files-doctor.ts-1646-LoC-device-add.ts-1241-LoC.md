---
id: TASK-345
title: >-
  Split oversized CLI command files: doctor.ts (1646 LoC) + device/add.ts (1241
  LoC)
status: To Do
assignee: []
created_date: '2026-05-17 10:54'
labels:
  - tech-debt
  - refactor
  - cli
dependencies: []
references:
  - backlog/tasks/task-343 - m-18-follow-up-tech-debt-cleanup-proposals.md
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device/scan.ts
  - packages/podkit-cli/src/commands/device/device-scan-render.ts
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spawned from TASK-343 item 9.

## Problem

Two CLI command files have grown beyond comfortable single-file scope and now mix command-line parsing, business logic, rendering, and JSON output in one place:

- `packages/podkit-cli/src/commands/doctor.ts` — **1646 lines** (was 1290 when TASK-343 was filed; still growing)
- `packages/podkit-cli/src/commands/device/add.ts` — **1241 lines**

This pattern hurts:
- Test focus (one test file per concern is easier than one giant test file)
- Cognitive load (rendering bugs and policy bugs share a namespace)
- AI navigability (large files force broad reads)

## Existing precedent

The codebase already follows the split pattern in places:
- `device/scan.ts` (590 LoC) is paired with `device/device-scan-render.ts` for rendering
- Each device subcommand has a `Deps` shape for dependency injection — keeps the command file thin

## Proposed structure

### `doctor.ts` (target: <500 LoC per resulting file)

Extract into siblings:
- `doctor-readiness.ts` — readiness/scope-resolution helpers
- `doctor-failures.ts` — failure-explanation router (which check failed → which user-facing tip)
- `doctor-render.ts` — text + JSON rendering helpers

### `device/add.ts`

Extract per the same pattern. Specific seams to evaluate during the work:
- USB enumeration + selection logic → `device-add-selection.ts`
- Persistence/config-mutation logic → `device-add-persist.ts`
- Render → `device-add-render.ts`

## Constraints

- **Behavior-preserving refactor only.** No new features, no policy changes.
- Public command export shape stays identical (CLI users + tests should be unaffected).
- All existing tests must pass without modification — if a test needs to change to follow a moved symbol, that's a code-organization issue worth surfacing in the PR.
- No new abstractions beyond the file split — do not introduce wrapper classes or indirection layers.

## Acceptance Criteria

- [ ] `doctor.ts` is < 500 lines
- [ ] `device/add.ts` is < 500 lines
- [ ] Each extracted helper file is < 500 lines
- [ ] All existing tests pass without modification
- [ ] `bun run typecheck`, `bun run test`, `bun run lint` all pass
- [ ] No new public exports added; no behavior changes

## Notes for the picker-up

- This is a pure refactor — land as a single PR.
- Read TASK-343 for surrounding context; this task is the "item 9" spin-off.
- Worth checking whether any of the rendering helpers in `doctor.ts` could share code with `device/device-scan-render.ts` (probably not, but worth a glance).
<!-- SECTION:DESCRIPTION:END -->
