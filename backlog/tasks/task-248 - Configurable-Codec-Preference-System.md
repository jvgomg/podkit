---
id: TASK-248
title: Configurable Codec Preference System
status: Done
assignee: []
created_date: '2026-03-27 10:40'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies: []
documentation:
  - doc-024
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a configurable codec preference stack that allows podkit to select the optimal audio codec per device, replacing the hardcoded AAC-only transcoding pipeline.

See PRD: doc-024 for full design specification.

**Summary:** Users configure an ordered list of preferred codecs (globally and per-device). The system walks the list top-to-bottom, selecting the first codec that is both device-supported and encoder-available. Default lossy stack: opus → aac → mp3. Default lossless stack: source → flac → alac. Quality presets are orthogonal and map to codec-appropriate bitrates internally.
<!-- SECTION:DESCRIPTION:END -->
