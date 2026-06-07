---
id: TASK-394
title: >-
  OGG/vorbis optimized-copy regression — FFmpeg code 1 on passthrough (TASK-380
  finding)
status: Done
assignee: []
created_date: '2026-06-06 18:03'
updated_date: '2026-06-07 10:18'
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
modified_files:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
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
- [x] #1 Root cause documented (regression of TASK-358.01, or fresh gap, with the actual FFmpeg error captured)
- [x] #2 Fix lands in `packages/podkit-core/src/transcode/` (or wherever the optimized-copy FFmpeg invocation lives)
- [x] #3 Test pins OGG → embedded-vorbis device round-trip without code-1
- [x] #4 doc-039 §'Mass-storage sync gaps' updated to reflect closure
- [x] #5 TASK-380 matrix re-runs and the previously-blocked `embedded-vorbis × ogg × prefer-copy × *` cells flip GREEN (or skip with a different rationale)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Resolution: closed obsolete — phantom bug caused by a stale VM binary.**

## Reproduction

Manually ran the optimized-copy invocation that `getOptimizedCopyFormat(track.fileType='ogg')` → `buildOptimizedCopyArgs(... 'vorbis')` synthesises, against an OGG/vorbis source with an embedded `METADATA_BLOCK_PICTURE` cover, inside the device-harness VM (Debian 12, FFmpeg 5.1):

```
ffmpeg -i src.ogg -c:a copy -map_metadata 0 -map_metadata 0:s:0 -vn -f ogg -y -progress pipe:1 src.out.ogg
# exit=0
```

Then ran `podkit sync` end-to-end against an `embedded-vorbis`-shape generic mass-storage device (`supportedAudioCodecs = ["vorbis","mp3","aac"]`, `artworkSources = ["embedded"]`) with `quality=max`, `lossless=["source"]`, OGG source. Exit=0 across all five failure-mode variants (track-readonly / album-readonly / cover-collision / manifest-dir-readonly / move-parent-readonly). No "FFmpeg optimized-copy failed with code 1".

## Root cause

The TASK-394 observation was made against a VM binary built 2026-05-26 — i.e. **before TASK-358.01 landed**. TASK-358.01 had already extended `OptimizedCopyFormat` with `'vorbis'`, routed `getOptimizedCopyFormat(fileType='ogg')` to it, and mapped it to FFmpeg `-f ogg` (rather than falling through to `-f ipod`, which is what produced the "extension is not .m4a nor .m4v" code-1 failure the task describes). That fix was on `main` the whole time; the VM just wasn't running it.

The fix for the false-RED class itself shipped as **TASK-380 Phase E** (commit `fa6b2502` — VM build-staleness detection + binary refresh, Turborepo-driven `@podkit/device-testing#vm:install` + `@podkit/device-testing#vm:doctor`). With the fresh binary, the OGG passthrough succeeds end-to-end on `embedded-vorbis × ogg × prefer-copy × *` cells, exactly as TASK-358.01 intended.

## Fix applied

None to production code — the bug doesn't exist on `main`. The doc-039 §"Mass-storage sync gaps" entry was stale (the case for it being open had been closed by TASK-358.01); updated to reflect closure, with a pointer back to TASK-358.01 and a note that TASK-394 was the false-RED re-observation.

## Verification

- `bun test packages/podkit-core/src/transcode/ffmpeg.test.ts -t vorbis` → 2/2 pass (the contract `buildOptimizedCopyArgs(..., 'vorbis')` → `-f ogg -vn -c:a copy` is pinned).
- Manual end-to-end repro inside the VM: all five embedded-vorbis × ogg × prefer-copy × * pre-seed first syncs succeed (exit=0), with the file landing at `Music/Test Artist/Test Album/01 - Track 1.ogg` and a valid OGG stream.
- `bun test test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts -t embedded-vorbis` → embedded-vorbis × ogg × prefer-copy cells now run end-to-end (no longer blocked at pre-seed; the cells that do fail fail for a different reason — `track-readonly` chmod 0444 not blocking podkit's atomic-rewrite tag write — which is unrelated to OGG/vorbis and not in scope here).

## Matrix cell verification

The two TASK-380 cells "blocked at pre-seed" (`embedded-vorbis × ogg × prefer-copy × * × track-readonly` and the corresponding `transcode-aac` / `album-readonly` / `manifest-dir-readonly` cells in the fan-out) now reach observation. The pre-seed first sync succeeds for every one of them. Cells still fail on a separate axis (in-place tag write bypassing chmod 0444 via atomic-rewrite), but the OGG/vorbis pre-seed path itself is observable and correct.

## Surprise — flagged to the team lead

The save-failure matrix surfaces **9 `track-readonly` cells failing across all shapes (embedded / embedded-vorbis / sidecar-mixed / ipod-noart / ipod-artwork)**, not just the OGG/vorbis ones. The failure pattern is identical: chmod 0444 on the landed audio file does **not** trigger the expected EACCES; podkit's tag-write path silently rewrites the file (mode flips back to 0644, file body changes by a byte or two). This suggests podkit's in-place tag write is doing an atomic delete-rename rather than an `open(O_RDWR)`, which makes the existing `TagWriteError` envelope effectively unreachable via chmod-on-file alone. The TASK-380 finalSummary's claim that the matrix runs at "23 pass / 42 skip / 2 fail" doesn't match the current state ("16 pass / 44 skip / 7 fail" on my run). Recommend a follow-up task to either: (a) revisit the `track-readonly` fault design (chmod the *parent dir* 0555 + chattr +i the file, so atomic rename fails), or (b) re-pin the `predictChmodFault(track-readonly)` expectation since the atomic-rewrite semantics changed the observable behaviour. Out of scope for TASK-394.

## ACs

- #1 Root cause documented (false-RED against a stale May-26 VM binary; TASK-358.01's fix was already on `main`; TASK-380 Phase E / commit `fa6b2502` shipped the build-staleness detection that closed the false-RED class).
- #2 No fix needed in `packages/podkit-core/src/transcode/` — the contract is already correct.
- #3 Test pinning vorbis optimized-copy already exists (`ffmpeg.test.ts` "uses -f ogg for vorbis format (OGG/Vorbis stream-copy)" + "strips artwork for vorbis even with artworkResize (OGG cannot embed MJPEG)").
- #4 doc-039 §"Mass-storage sync gaps" updated — gap #1 marked closed by TASK-358.01, with a note that TASK-394 was the false-RED re-observation.
- #5 TASK-380 cells previously "blocked at pre-seed" now reach observation. The separate `track-readonly` divergence flagged above for follow-up triage.
<!-- SECTION:FINAL_SUMMARY:END -->
