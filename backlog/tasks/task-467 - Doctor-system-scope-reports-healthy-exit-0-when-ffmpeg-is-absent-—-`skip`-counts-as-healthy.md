---
id: TASK-467
title: >-
  Doctor system-scope reports healthy (exit 0) when ffmpeg is absent — `skip`
  counts as healthy
status: Done
assignee: []
created_date: '2026-07-12 17:07'
updated_date: '2026-10-03 22:35'
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
- [x] #1 Decide skip-vs-warn for the ffmpeg-absent codec-encoders/video-encoder checks, with documented rationale (conventions.md or an ADR note)
- [x] #2 If changed to warn: update the checks AND the no-ffmpeg SystemState fixture (overallStatus->warn, expectedExitCode->2) + any golden expectations
- [x] #3 Doctor exit-code semantics for skip-vs-warn documented so future checks pick the right status deliberately
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decision (with user): neither skip nor warn on the encoder checks — add a dedicated system-scope `ffmpeg` check that **fails** when `ffmpeg -version` cannot spawn or exits non-zero (FFmpeg is the runtime dependency). `codec-encoders` / `video-encoder` keep `skip` on a missing binary via a shared `FFMPEG_MISSING_SKIP` owned by the ffmpeg check; they now `warn` when FFmpeg runs but encoder detection fails (otherwise that failure would be reported nowhere). video-encoder probes the same `ffmpeg` binary as the transcoder (dropped its lone `FFMPEG_PATH` read).

Rule documented in docs/architecture/conventions.md §13 (skip = not applicable, or prerequisite reported by another check; warn vs fail guidance), cross-linked from docs/agents/testing.md exit-code section.

Fixtures: `ffmpeg: pass` added to all 9 SystemStates + healthy golden; `no-ffmpeg` → overallStatus fail, exit 2. KNOWN_SYSTEM_CHECK_IDS, scope-matrix, system-scope-matrix updated. Docs-site doctor + cli-commands pages, ADR-017 state table, system-states README updated. Changeset: podkit + @podkit/core minor.

Not run: VM cross-check (`test:vm`) — the no-ffmpeg fixture expectation is unverified against a live VM.
<!-- SECTION:FINAL_SUMMARY:END -->
