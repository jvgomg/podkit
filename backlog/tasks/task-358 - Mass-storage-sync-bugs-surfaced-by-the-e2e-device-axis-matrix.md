---
id: TASK-358
title: Mass-storage sync bugs surfaced by the e2e device-axis matrix
status: Done
assignee: []
created_date: '2026-05-28 21:12'
updated_date: '2026-05-30 13:27'
labels:
  - bug
  - mass-storage
  - sync
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/matrix/codec-rules.ts
priority: medium
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The device-axis e2e matrices added in TASK-356.04 surfaced three reproducible podkit execution/convergence bugs on mass-storage (USB DAP) devices. None is a test bug — each is currently fenced in the matrices as a typed `skipBug(...)` cell (rendered `[BUG]` in the runner, greppable via `grep -rn 'skipBug(' test-packages/e2e-tests/src`). This umbrella tracks fixing them; as each is fixed, the corresponding `skipBug` fence is removed and the cell starts asserting real behaviour.

Full detail and repro live in **doc-039 §"Mass-storage sync gaps"**. Related prior work: TASK-198 implemented `optimized-copy` FFmpeg args for iPod-canonical formats only (ALAC/MP3/AAC); OGG/vorbis was never covered, which is the root of subtask #1.

Subtasks:
- OGG optimized-copy aborts the whole sync on embedded-art mass-storage devices.
- OGG/Opus transcoded to AAC is re-added on every sync (non-convergence).
- prefer-copy (quality=max) never converges on mass-storage (preset-upgrade loop).
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All three subtasks closed:

- **358.01** — OGG optimized-copy abort. Added `vorbis` variant to `OptimizedCopyFormat`; plumbed `continueOnError` through `ExecutionContext`; fixed several adjacent gaps (caps-leak in `open-device.ts`, `.Audio file` filetype labels, OGG/Opus stream-tag reading in test helpers).
- **358.02** — OGG/Opus → AAC re-add loop. Root cause was metadata loss in transcode (Vorbis comments are stream-level, `-map_metadata 0` only copies global). Centralised `pushSourceMetadataMapping` adds the `0:s:0` chain to every codec builder. Also closes TASK-354.
- **358.03** — prefer-copy preset-upgrade loop. The detector compared the persisted syncTag against a config-wide expected tag; on mass-storage the per-track preset legitimately falls back from `lossless` to `high`. Built the expected tag per-track from `classifier.classify(source)` instead.

The artwork matrix's `skipArtworkCell` is now a no-op `return null` — every cell in the doc-039 device axis asserts real behaviour. The `[BUG]` skips from this umbrella are gone.

Filed during the work: TASK-361 (orphan-detection coverage for adapter-failure debris) — low-priority follow-up surfaced by the `.Audio file` filename bug fix in 358.01.
<!-- SECTION:FINAL_SUMMARY:END -->
