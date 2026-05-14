---
id: TASK-301
title: 'System-scope diagnostic checks: host environment permutations'
status: To Do
assignee: []
created_date: '2026-05-08 07:21'
updated_date: '2026-05-14 19:22'
labels:
  - testing
  - doctor
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-322.05.01
  - TASK-333
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the four system-scope diagnostic checks behave correctly across the matrix of host environment states. Today these checks have unit-level coverage with injected probes, but no integration coverage that catches "binary actually runs and produces the expected status" regressions on real hosts. The synthetic-device test infrastructure (planned separately) will provision controllable hosts that let each axis be flipped independently; this ticket lists what to assert for each combination.

Checks in scope:
- `inquiry-methods` — reports SCSI + USB transport availability
- `codec-encoders` — reports presence of FFmpeg audio encoders
- `video-encoder` — reports H.264 encoder availability
- `udev-rule` — reports presence of the iPod udev rule (Linux only)

For every test, run `podkit doctor --device <fixture> --json` and assert on the matching `checks[]` entry: `status`, `summary`, `details`, and `repairable`. Do not assert on overall `healthy` for these tests — the goal is per-check behaviour, not overall doctor exit code (covered by a separate ticket).

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` and `systemStates` from `@podkit/device-testing`; inject fakes via the `DevicePersona` and `SystemState` registries into injectable transports (`UsbBinding`, `SubprocessRunner`, etc.)
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the runner restores the appropriate `SystemState` snapshot before the test group runs
- **T2 (native subprocess):** tests that invoke real `ffmpeg`, `lsblk`, or `system_profiler` are tagged `*.linux.test.ts` or `*.darwin.test.ts` as appropriate
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
- [ ] #1 inquiry-methods returns pass when both SCSI (kext on macOS / /dev/sg* on Linux) and libusb are available
- [ ] #2 inquiry-methods returns warn when only one transport is available; details indicate which one is missing and why
- [ ] #3 inquiry-methods returns fail when neither transport is available; summary names both reasons
- [ ] #4 inquiry-methods on Linux distinguishes /dev/sg* present-but-unreadable (warn, gid hint) from /dev/sg* absent (warn, no nodes)
- [ ] #5 codec-encoders returns pass when AAC, ALAC, and MP3 encoders are available in ffmpeg
- [ ] #6 codec-encoders returns fail when one or more configured codec encoders are missing; details list the missing codecs
- [ ] #7 codec-encoders returns fail when ffmpeg itself is not on PATH; summary makes it obvious
- [ ] #8 video-encoder returns pass when libx264 is available
- [ ] #9 video-encoder returns warn on macOS when only h264_videotoolbox is available (no libx264)
- [ ] #10 video-encoder returns fail when no H.264 encoder is available
- [ ] #11 udev-rule (Linux) returns pass when /etc/udev/rules.d/<podkit-rule> exists with expected contents
- [ ] #12 udev-rule (Linux) returns fail+repairable when the rule file is absent
- [ ] #13 udev-rule (Linux) returns warn when the rule file exists but contents are stale (different vendor/product set)
- [ ] #14 udev-rule (Linux) repair installs the rule and a second doctor run reports pass; dry-run prints the action without writing
- [ ] #15 udev-rule on macOS reports skip (not applicable to platform)
- [ ] #16 All four checks include scope: 'system' in their JSON output
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** Tier-1 unit-test coverage (the injectable-fake path) is independent and can land first. Tier-3 assertions (the `*.linux.tier3.test.ts` files) require TASK-322.05.01 (FunctionFS descriptor handshake) for the synthesised device to enumerate, and TASK-333 (Doctor system-only mode) if the test wants to run doctor without first running `device add`. Do NOT scaffold skipped tests for the blocked paths — split the work so Tier-1 lands now, Tier-3 lands after the dependencies.
<!-- SECTION:NOTES:END -->
