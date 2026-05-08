---
id: TASK-308
title: Doctor exit code and overall-health semantics
status: To Do
assignee: []
created_date: '2026-05-08 07:24'
labels:
  - testing
  - doctor
  - exit-codes
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pin down what flips doctor's exit code and the `healthy` boolean. Today's behaviour: `healthy = readinessHealthy && (every device-and-system check is pass|skip)`. That means a single `warn` from any check is enough to flip exit code to 1, which has bitten us multiple times (inquiry-methods warn on macOS without libusb, video-encoder warn on macOS with only h264_videotoolbox).

This ticket is partly test coverage and partly a forcing function for a design decision: should `warn` count as healthy or not? Either is defensible, but the answer must be consistent and documented. Once decided, lock in the behaviour with tests.

For every test, run `podkit doctor --device <fixture> --json` (with and without `--no-system` as the matrix demands) and assert on `exit code`, `healthy`, and the count of issues reported in the human output.
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
