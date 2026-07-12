---
id: TASK-467
title: >-
  Doctor system-scope reports healthy (exit 0) when ffmpeg is absent — `skip`
  counts as healthy
status: To Do
assignee: []
created_date: '2026-07-12 17:07'
labels:
  - diagnostics
  - doctor
dependencies: []
references:
  - packages/podkit-core/src/diagnostics/index.ts
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
  - test-packages/device-testing/src/system-states/no-ffmpeg.ts
priority: medium
ordinal: 227000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `codec-encoders` and `video-encoder` system-scope doctor checks return `status: 'skip'` (summary "FFmpeg not available") when ffmpeg is missing from PATH. Doctor's `healthy` bit is `checks.every(status === 'pass' || status === 'skip')` (`packages/podkit-core/src/diagnostics/index.ts` ~L203), and `runSystemOnlyDoctor` sets exit 2 only when `!healthy` (`packages/podkit-cli/src/commands/doctor.ts` ~L1119). Consequently `podkit doctor --scope system` on a host with no ffmpeg exits **0** / status `ok` — the missing-transcoder condition is invisible at the exit code and surfaces only in the per-check summary rows.

This was previously masked on the device-harness VM: until the inquiry-methods check went USB-first, its baseline `warn` made the `no-ffmpeg` SystemState coincidentally exit 2. Surfaced while re-pinning the SystemState fixtures after that inquiry-methods change (all 9 states now collapse to the healthy baseline at system scope, including `no-ffmpeg`).

Decision needed: should ffmpeg-absent surface as `warn` (a host that cannot transcode is arguably a real issue doctor should flag at the exit code) rather than `skip`? Or is `skip` correct because system-scope doctor without a device should not fail on optional tooling? Note `skip` is used elsewhere as a legitimate not-applicable outcome, so any change should be principled, not local.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decide skip-vs-warn for the ffmpeg-absent codec-encoders/video-encoder checks, with documented rationale (conventions.md or an ADR note)
- [ ] #2 If changed to warn: update the checks AND the no-ffmpeg SystemState fixture (overallStatus->warn, expectedExitCode->2) + any golden expectations
- [ ] #3 Doctor exit-code semantics for skip-vs-warn documented so future checks pick the right status deliberately
<!-- AC:END -->
