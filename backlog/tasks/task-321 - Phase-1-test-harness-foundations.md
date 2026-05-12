---
id: TASK-321
title: 'Phase 1: test harness foundations'
status: To Do
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-12 12:11'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
priority: high
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for the foundational package and conventions that the VM test harness depends on. Delivers the **shared infrastructure** consumed by both Tier 1 (native unit tests with injectable transports) and Tier 3 (Linux VM with real USB synthesis).

Scope is foundation-only — no test implementation here. Test implementation lives in TASK-301–311 (already in m-19) and Phase 3 integration tasks (TASK-322.*).

Subtasks deliver:
- `packages/device-testing/` — single package consolidating `DevicePersona`, `SystemState`, `TestRuntime` interface + `local-linux` runner, and the subprocess snapshot framework
- 3 starter `DevicePersona` captures from real hardware
- Initial `SystemState` registry (5–6 entries: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs)
- Per-OS test tagging convention (`*.darwin.test.ts` / `*.linux.test.ts`)
- Linux native build pipeline: builder Lima VM + turbo-cached `build:linux-prebuild` and `build:linux-binary` tasks, sharing native-build implementation with existing GHA (`prebuild.yml`, `tools/prebuild/build-static-deps.sh`) — no duplicate build code

Depends on TASK-290 (ADRs accepted) for schema/architecture decisions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All Phase 1 subtasks are Done
- [ ] #2 `packages/device-testing/` exists as a single package exporting DevicePersona, SystemState, TestRuntime, runners, and snapshot framework
- [ ] #3 5+ SystemState entries in registry, each with expected doctor-system-output
- [ ] #4 TestRuntime interface + working local-linux runner that executes test commands natively when host is Linux
- [ ] #5 Subprocess snapshot framework supports capture and replay against fixture JSON files; injection points wired into existing subprocess call sites
- [ ] #6 Per-OS test tagging convention is documented in agents/testing.md and the Bun runner skips mismatched-OS tests cleanly
- [ ] #7 Builder Lima VM yaml exists (`tools/device-testing/lima/builder.yaml`) and turbo tasks `build:linux-prebuild` and `build:linux-binary` produce cached artefacts
- [ ] #8 Existing GHA `prebuild.yml` refactored so the builder VM and CI share native-build implementation; no duplicated build commands
- [ ] #9 A trivial smoke test imports a persona from device-testing and runs it through an injected transport in a Tier 1 unit test
- [ ] #10 3 starter DevicePersona captures committed (ipod-video-5g-fresh, ipod-nano-7g-populated, echo-mini-empty) with provenance.md
- [ ] #11 agents/testing.md updated to include a section on the three-tier test stack and when each tier runs
- [ ] #12 agents/device-testing.md exists and covers the DevicePersona schema, human-in-the-loop capture flow, SystemState registry, runner ops, and tagging convention
- [ ] #13 TASK-301..TASK-311 descriptions each include a note referencing @podkit/device-testing, DevicePersona, SystemState, and the lima-test-vm runner so implementers pick up the new stack
<!-- AC:END -->
