---
id: TASK-436.08
title: Display resolved default collections in device info + device list
status: To Do
assignee: []
created_date: '2026-06-24 15:21'
labels:
  - cli
  - collections
dependencies:
  - TASK-436.06
parent_task_id: TASK-436
ordinal: 189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surface the resolved per-device default collections in `podkit device info` and `podkit device list` (text and JSON), rendered through the existing provenance/`formatResolved` machinery.

Provenance rendering per content type:
- explicit name → plain (e.g. `main`)
- inherited from the global default → bracketed (e.g. `[shows]`)
- explicit none (`false`) → `none`
- nothing set and no global default → `—`

JSON output extends (does not rename) existing source/provenance fields, exposing the resolved default collection and its `source`.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 16, 17, 18, 19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 device info shows resolved default music + video collections with provenance (name / [inherited] / none / —)
- [ ] #2 device list shows the resolved default collections
- [ ] #3 JSON output for both includes the resolved default collection and its source, extending (not renaming) existing fields
- [ ] #4 Unit tests cover rendering of all four provenance states in text and JSON
<!-- AC:END -->
