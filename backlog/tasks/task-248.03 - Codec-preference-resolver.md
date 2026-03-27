---
id: TASK-248.03
title: Codec preference resolver
status: To Do
assignee: []
created_date: '2026-03-27 10:41'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.01
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the pure function that resolves a codec preference stack against device capabilities and available encoders.

See PRD: doc-024, section "Codec preference resolution."

Takes three inputs: codec preference config (global merged with device override), device capabilities (`supportedAudioCodecs`), and available encoders (from `TranscoderCapabilities`). Walks the preference list and selects the first codec that is both device-supported and encoder-available. Returns resolved codec with container metadata from the codec metadata table, or a structured error if no match. Silent fallthrough for missing encoders (no error if a lower-preference codec works).

The `source` keyword in the lossless stack is passed through — it is resolved per-track at plan time by the planner, not by the resolver.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resolves first codec from preference list that is both device-supported and encoder-available
- [ ] #2 Falls through silently when top preference's encoder is unavailable
- [ ] #3 Returns structured error when no codec in list is both supported and encodable
- [ ] #4 Merges device-level codec config over global config correctly
- [ ] #5 Device config inherits from global when not overridden
- [ ] #6 Normalizes single string to array
- [ ] #7 Passes through `source` keyword in lossless list without resolving it
- [ ] #8 Uses default stacks when no codec config is provided
- [ ] #9 Returns correct container metadata (extension, format flag, filetype label, sample rate) for each resolved codec
- [ ] #10 Validates codec names and rejects unknown values
- [ ] #11 Unit tests cover all resolution paths including fallthrough, error, merge, and defaults
<!-- AC:END -->
