---
id: TASK-321.08
title: Agent directives + TASK-301..311 harness sweep
status: To Do
assignee: []
created_date: '2026-05-12 11:55'
labels:
  - testing
  - vm-coverage
  - foundation
  - docs
milestone: m-19
dependencies:
  - TASK-321.01
  - TASK-321.05
parent_task_id: TASK-321
priority: medium
ordinal: 280
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update agent documentation and sweep existing test tasks so all implementers know to use the new harness.

**Part A: Agent documentation**

Update `agents/testing.md` to add a section on the three-tier test stack:
- When to run T1 (always — unit tests with injectable fakes from `@podkit/device-testing`)
- When to run T2 (always — native subprocess tests tagged `*.darwin.test.ts` / `*.linux.test.ts`)
- When to run T3 (on mac hosts with Lima installed — `bun run test` auto-detects; skip with warning if VM unavailable)
- Quick-reference commands for Tier 3 (`mise run device-testing:start-vm`, etc.)
- When to capture a new persona (when touching hardware identification code or adding a new supported device)

Create `agents/device-testing.md` — the canonical reference for agents working on device tests. Cover:
- The three-tier architecture (summary + pointers to ADR-016, ADR-017)
- `DevicePersona` schema overview and how to add a new persona
- Human-in-the-loop capture flow: user plugs in hardware, agent runs capture script, agent commits data + provenance.md
- `SystemState` registry overview and how to add a new state
- `TestRuntime` interface + how to pick a runner (`local-linux` on Linux hosts, `lima-test-vm` on mac)
- Test file tagging convention (`*.darwin.test.ts`, `*.linux.test.ts`, `*.linux.tier3.test.ts`)
- Where T3 test files live and how to write a new T3 test
- Pointer to `packages/device-testing/README.md` for package-level detail

**Part B: TASK-301..311 description sweep**

For each of TASK-301 through TASK-311 (11 tasks), append a short note to the existing description (do not rewrite ACs) that mentions:
- `@podkit/device-testing` is the home for fixtures and runner harness
- `DevicePersona` + `SystemState` registries supply the canonical fixture data
- T1 tests import fakes from the registry; T3 tests run inside the `lima-test-vm` runner
- Test files for native subprocess calls are tagged `*.darwin.test.ts` / `*.linux.test.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 agents/testing.md has a 'Three-tier test stack' section covering when each tier runs and quick-ref commands
- [ ] #2 agents/device-testing.md exists and covers: three-tier architecture, DevicePersona schema + capture flow, SystemState registry, TestRuntime + runner selection, tagging convention, how to write a T3 test
- [ ] #3 All 11 tasks TASK-301..TASK-311 have descriptions updated to reference @podkit/device-testing, DevicePersona, SystemState, and lima-test-vm runner
- [ ] #4 agents/device-testing.md cross-references packages/device-testing/README.md for package-level detail
<!-- AC:END -->
