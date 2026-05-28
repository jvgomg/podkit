---
id: TASK-358
title: Mass-storage sync bugs surfaced by the e2e device-axis matrix
status: To Do
assignee: []
created_date: '2026-05-28 21:12'
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
