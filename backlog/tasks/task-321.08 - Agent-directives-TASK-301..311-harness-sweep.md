---
id: TASK-321.08
title: Agent directives + TASK-301..311 harness sweep
status: Done
assignee: []
created_date: '2026-05-12 11:55'
updated_date: '2026-05-13 18:06'
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
- [x] #1 agents/testing.md has a 'Three-tier test stack' section covering when each tier runs and quick-ref commands
- [x] #2 agents/device-testing.md exists and covers: three-tier architecture, DevicePersona schema + capture flow, SystemState registry, TestRuntime + runner selection, tagging convention, how to write a T3 test
- [x] #3 All 11 tasks TASK-301..TASK-311 have descriptions updated to reference @podkit/device-testing, DevicePersona, SystemState, and lima-test-vm runner
- [x] #4 agents/device-testing.md cross-references packages/device-testing/README.md for package-level detail
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What shipped

- `agents/testing.md` gained a `## Three-Tier Test Stack` section (~70 lines) placed between the `Per-OS Test Tagging` section (from TASK-321.05) and `Test Task Composition`. Covers T1/T2/T3 scope, when each runs, quick-ref commands, and persona-capture trigger. Cross-refs ADR-016, ADR-017, `agents/device-testing.md`, `packages/device-testing/README.md`.
- New `agents/device-testing.md` (~173 lines, 14 sections). Canonical reference for: package purpose, three-tier architecture summary, DevicePersona schema overview, SystemState registry, TestRuntime + runner selection, test-file tagging recap, subprocess snapshot framework, build pipeline pointer, T3 "where to write tests" placeholder, full cross-reference list.
- TASK-301 through TASK-311 (11 tasks) all received harness-integration sections appended to their descriptions. TASK-301–308 use the canonical block from the brief; TASK-309–311 received tailored variants (309 spotlights `expectedCapabilities`/`expectedDoctorOutput`, 310 reframes around golden-file references, 311 explicitly threads T2 with `lsblkJson` / `systemProfilerJson` per persona).

## Quality gates
- Full workspace `bun run typecheck` — pass (FULL TURBO, 29/29 cached).
- `bun run test:unit --filter @podkit/device-testing` — 81 pass / 2 skip / 0 fail / 109 expects (unchanged baseline).
- `bunx prettier --check agents/testing.md agents/device-testing.md` — clean.
- Sweep verification: `git grep -lE "m-19 harness integration|TASK-321.08 sweep" backlog/tasks/` returns all 11 task files (301–311).

## Constraints respected
- No code changes outside `agents/*.md` + backlog descriptions.
- No ACs were modified on TASK-301..311 — descriptions only.
- Forward-references to `lima-test-vm`, `capture-persona.ts`, and Tier 3 commands are explicitly marked as forthcoming (TASK-322.x).
<!-- SECTION:FINAL_SUMMARY:END -->
