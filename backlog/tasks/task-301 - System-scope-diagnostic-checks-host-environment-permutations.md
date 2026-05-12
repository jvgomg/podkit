---
id: TASK-301
title: 'System-scope diagnostic checks: host environment permutations'
status: To Do
assignee: []
created_date: '2026-05-08 07:21'
updated_date: '2026-05-12 11:55'
labels:
  - testing
  - doctor
  - vm-coverage
milestone: m-19
dependencies: []
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
