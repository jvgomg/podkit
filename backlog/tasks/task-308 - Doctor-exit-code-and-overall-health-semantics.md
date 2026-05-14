---
id: TASK-308
title: Doctor exit code and overall-health semantics
status: To Do
assignee: []
created_date: '2026-05-08 07:24'
updated_date: '2026-05-14 19:23'
labels:
  - testing
  - doctor
  - exit-codes
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-333
  - TASK-322.05.01
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pin down what flips doctor's exit code and the `healthy` boolean. Today's behaviour: `healthy = readinessHealthy && (every device-and-system check is pass|skip)`. That means a single `warn` from any check is enough to flip exit code to 1, which has bitten us multiple times (inquiry-methods warn on macOS without libusb, video-encoder warn on macOS with only h264_videotoolbox).

This ticket is partly test coverage and partly a forcing function for a design decision: should `warn` count as healthy or not? Either is defensible, but the answer must be consistent and documented. Once decided, lock in the behaviour with tests.

For every test, run `podkit doctor --device <fixture> --json` (with and without `--no-system` as the matrix demands) and assert on `exit code`, `healthy`, and the count of issues reported in the human output.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` and `systemStates` from `@podkit/device-testing`; inject fakes via `DevicePersona` and `SystemState` registries to produce each (healthy/warn/fail) × (system/device) combination
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the runner restores the appropriate `SystemState` snapshot (e.g. `base-no-ffmpeg`) before the test group runs
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture

### m-19 harness integration (Phase 1 foundations)

Use the test harness landed in TASK-321 (Phase 1):

- **Fixtures** live in `@podkit/device-testing` — `DevicePersona` for device-facing state, `SystemState` for host-environment state. See `agents/device-testing.md` and `packages/device-testing/README.md`.
- **Tier 1** unit tests inject `SubprocessRunner` (from `@podkit/device-types`) and `TestRuntime` fakes wired up against persona/state fixtures. Default runner is `defaultSubprocessRunner` from `@podkit/core`; tests substitute `ReplaySubprocessRunner` from `@podkit/device-testing`.
- **Tier 3** integration tests run inside the `lima-test-vm` runner (lands in TASK-322.04) against synthesised USB gadgets.
- **Native subprocess tests** follow the `*.darwin.test.ts` / `*.linux.test.ts` tagging convention — see `agents/testing.md` §"Per-OS Test Tagging".
- Capture fresh subprocess fixtures with `PODKIT_SNAPSHOT_CAPTURE=1 PODKIT_SNAPSHOT_DIR=<dir>`; replay with `PODKIT_SNAPSHOT_REPLAY=1 PODKIT_SNAPSHOT_DIR=<dir>`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DECISION: document whether warn counts toward healthy (current: warn breaks healthy). Decision recorded in an ADR or in agents/testing.md before implementing tests
- [ ] #2 Readiness ready + all device checks pass + all system checks pass → healthy=true, exit 0
- [ ] #3 Readiness ready + one device check fails (e.g. corrupt artwork) + system pass → healthy=false, exit 1, issue count includes that fail
- [ ] #4 Readiness ready + one device check warns (e.g. orphan-files) + system pass → behaviour matches the documented decision (currently: healthy=false, exit 1)
- [ ] #5 Readiness ready + system check warns (e.g. inquiry-methods libusb missing) + device pass → behaviour matches the documented decision; with --no-system the same fixture produces healthy=true exit 0
- [ ] #6 Readiness fails (e.g. mount fail) → healthy=false, exit 1, regardless of any check results (DB checks were skipped)
- [ ] #7 Readiness ready + every check skips → healthy=true, exit 0 (skip is not a failure)
- [ ] #8 When report is unavailable (database open failed during diagnostics) and readiness was ready: behaviour is well-defined (currently dbHealthy=false unless dbAvailable was unset)
- [ ] #9 Issue count in human output equals the number of fail entries (warn is or is not counted depending on the decision; assert consistency)
- [ ] #10 Mass-storage device with no orphans + --no-system → healthy=true, exit 0
- [ ] #11 Mass-storage device with orphans → healthy=false, exit 1 (warn counts) OR healthy=true with warn surfaced (warn doesn't count) — must match decision
- [ ] #12 Repair commands: success=true → exit 0; success=false → exit 1; --dry-run with success=true → exit 0
- [ ] #13 JSON output's healthy boolean exactly mirrors the exit code (healthy=true iff exit 0) for diagnostics mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** Once TASK-333 lands, the warn-counts-as-unhealthy decision must apply consistently to `--scope system` (system-checks-only doctor invocations). Add exit-code assertions for the new mode to the existing matrix. TASK-322.05.01 closes the descriptor handshake so device-scope assertions against synthesised personas work end-to-end.
<!-- SECTION:NOTES:END -->
