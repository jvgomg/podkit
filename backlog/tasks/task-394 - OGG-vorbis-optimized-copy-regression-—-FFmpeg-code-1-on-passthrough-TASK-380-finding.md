---
id: TASK-394
title: >-
  OGG/vorbis optimized-copy regression — FFmpeg code 1 on passthrough (TASK-380
  finding)
status: To Do
assignee: []
created_date: '2026-06-06 18:03'
labels:
  - bug
  - transcoding
  - ogg
  - mass-storage
  - regression
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - >-
    backlog/tasks/task-380 -
    Save-failure-matrix-test-suite-—-doc-041-§4.3-§7.3.md
priority: medium
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Surfaced by TASK-380 Phase C.2 fan-out (2026-06-06). The save-failure matrix's pre-seed first-sync step for `embedded-vorbis × ogg × prefer-copy × *` cells fails consistently with `FFmpeg optimized-copy failed with code 1`. The OGG-in-OGG passthrough (vorbis source → vorbis destination, remux only) rejects.

doc-039 §"Mass-storage sync gaps" already lists "OGG optimized-copy aborts on embedded-artwork mass-storage devices" (echo-mini). This task may be the SAME bug recurring or a regression of the partial fix from TASK-358.01.

## Repro

```bash
# inside the Lima podkit-device-harness VM
podkit sync --source <ogg-source> --device <ms-generic-mount> --transfer-mode fast --quality max --lossless-stack source
# → exits code 2 with "FFmpeg optimized-copy failed with code 1"
```

`ms-generic` capability shape with `supportedAudioCodecs: ['vorbis', 'mp3', 'aac']` — vorbis is device-native, so source ogg → optimized-copy path (FFmpeg passthrough remux, not a transcode). The passthrough should be trivial; the failure suggests FFmpeg invocation arguments are wrong for the vorbis-in-ogg remux case OR a regression in `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS` handling.

## Investigation needed

1. **Determine: regression or original gap?** Was TASK-358.01 supposed to fix this? Check the commit history for `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS` + the optimized-copy FFmpeg invocation for OGG.
2. **Capture the FFmpeg stderr.** What's the actual code-1 error? May be codec-name mismatch (`vorbis` vs `libvorbis`) or container option missing.
3. **Compare echo-mini gap (doc-039) to this one.** Same root cause or separate?

## Fix

Depends on findings. Likely: adjust the FFmpeg optimized-copy invocation in the transcoder to handle OGG container correctly, OR explicitly exclude vorbis from optimized-copy and force transcode.

## Why filed now

The save-failure matrix surfaced this AND the matrix can't proceed past pre-seed for the affected cells. Two `embedded-vorbis × ogg × *` cells are blocked.

## Acceptance

- Root cause identified (FFmpeg args wrong vs codec exclusion missing vs container option missing).
- Fix lands; OGG sources go through `embedded-vorbis` shape without code-1 failure.
- TASK-380 matrix cells previously blocked at pre-seed now run and observe their predicted outcomes.
- doc-039 §"Mass-storage sync gaps" updated: gap closed (or amended with the actual extent of the issue).
- Test pinning the round-trip OGG → embedded-vorbis device.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause documented (regression of TASK-358.01, or fresh gap, with the actual FFmpeg error captured)
- [ ] #2 Fix lands in `packages/podkit-core/src/transcode/` (or wherever the optimized-copy FFmpeg invocation lives)
- [ ] #3 Test pins OGG → embedded-vorbis device round-trip without code-1
- [ ] #4 doc-039 §'Mass-storage sync gaps' updated to reflect closure
- [ ] #5 TASK-380 matrix re-runs and the previously-blocked `embedded-vorbis × ogg × prefer-copy × *` cells flip GREEN (or skip with a different rationale)
<!-- AC:END -->
