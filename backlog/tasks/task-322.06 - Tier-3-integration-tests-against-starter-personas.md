---
id: TASK-322.06
title: Tier 3 integration tests against starter personas
status: To Do
assignee: []
created_date: '2026-05-12 09:35'
updated_date: '2026-05-12 12:10'
labels:
  - testing
  - vm-coverage
  - tier-3
  - integration
milestone: m-19
dependencies:
  - TASK-322.01
  - TASK-322.02
  - TASK-322.03
  - TASK-322.04
  - TASK-322.05
  - TASK-321.01
  - TASK-321.02
parent_task_id: TASK-322
priority: high
ordinal: 460
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the first Tier 3 integration tests against the 3 starter personas from TASK-321.02.

For each persona, the test:
1. Applies a `SystemState` (typically `healthy` for these baseline tests; later doctor-coverage tests use other states)
2. Boots the test VM (or restores a snapshot)
3. Starts the FunctionFS daemon (TASK-322.05) with the persona
4. From within the test VM, runs `/usr/local/bin/podkit device scan --json` and `/usr/local/bin/podkit doctor --json`
5. Asserts the JSON output matches the persona's `expectedCapabilities` + `expectedDoctorOutput`
6. Tears down the synthetic device + reverts the snapshot

**Test files** live in `packages/device-testing/src/tier3/` (or `packages/e2e-tests/src/tier3/` if it fits better with existing e2e patterns). Tagged so the harness skips them when no Linux runner is available.

**Personas in scope:** `ipod-video-5g-fresh`, `ipod-nano-7g-populated`, `echo-mini-empty` (the 3 starter personas from TASK-321.02 — cover SCSI-fallback inquiry, USB-inquiry, and mass-storage paths respectively).

**Scope of this task**: just the 3 starter personas. Each persona = at least one happy-path test. Combinatorial doctor matrix (TASK-307–311) and persona expansion (TASK-324) bring further coverage.

**Test grouping:** tests are organised by required `SystemState`. All baseline persona tests use the `healthy` state — they form one group. Snapshot restore (`base-healthy`) happens once for the group, then all persona tests run in sequence. This grouping pattern is documented in the test file headers as the standard convention for Tier 3 tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 3 Tier 3 tests exist, one per starter persona, all green on a mac dev host with Lima installed
- [ ] #2 Each test exercises `podkit device scan --json` and `podkit doctor --json` against the synthesized device
- [ ] #3 Assertions check against the persona's expectedCapabilities and expectedDoctorOutput fields — no inline goldens
- [ ] #4 Tests skip cleanly with a single-line warning when no Linux runner is available
- [ ] #5 Test wall time per persona under 10 seconds (VM warm); under 60 seconds (VM cold-start including snapshot restore)
- [ ] #6 Cache hit (no source change) skips test execution via turbo
- [ ] #7 Persona list covers ipod-video-5g-fresh, ipod-nano-7g-populated, and echo-mini-empty
- [ ] #8 Tests are grouped by required SystemState; snapshot restore happens once per group, not per test
- [ ] #9 Test file headers document the grouping convention as the standard for Tier 3 tests
<!-- AC:END -->
