---
id: TASK-248.01
title: Codec metadata table and config schema
status: Done
assignee: []
created_date: '2026-03-27 10:41'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies: []
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the shared codec metadata constant and add the `[codec]` config section. This is the foundation that all other tasks depend on.

See PRD: doc-024, sections "Codec metadata table" and "Config shape."

**Codec metadata table:** Single shared constant mapping each codec (AAC, ALAC, Opus, MP3, FLAC) to container metadata — extension, FFmpeg format flag, filetype label, sample rate, type (lossy/lossless). WAV/AIFF are not included (valid sources but not transcoding targets). This constant is the source of truth consumed by all downstream modules.

**Config schema:** Add `[codec]` section at global level and `[devices.*.codec]` at device level. Both `lossy` and `lossless` accept a string or array of strings. Additive change — no config version bump needed. Existing configs without `[codec]` use defaults. Update `encoding` field docstrings from "AAC transcoding" to codec-generic. Document default stacks in example config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Codec metadata table exists as a shared constant with entries for AAC, ALAC, Opus, MP3, FLAC — each with extension, FFmpeg format flag, filetype label, sample rate, and type
- [x] #2 Config types accept `[codec]` section with `lossy` and `lossless` fields at global and per-device levels
- [x] #3 Single string values are normalized to arrays during config loading
- [x] #4 Config validation rejects unknown codec identifiers
- [x] #5 Existing configs without `[codec]` section load successfully using default stacks
- [x] #6 Example config documents the default codec stacks with explanations of each codec
- [x] #7 `encoding` field docstrings and CLI help text updated to say codec-generic (not AAC-specific)
- [x] #8 Config loader and writer tests pass for new schema
<!-- AC:END -->
