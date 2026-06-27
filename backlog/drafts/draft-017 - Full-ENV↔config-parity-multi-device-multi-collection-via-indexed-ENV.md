---
id: DRAFT-017
title: 'Full ENV↔config parity: multi-device + multi-collection via indexed ENV'
status: Draft
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - config
  - docker
  - env
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
priority: low
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Beyond-scope for the alignment release. Stated direction: anything expressible in config.toml should be expressible via ENV. The single-device happy path (iPod + single mass-storage) lands in the alignment release; this task is the full parity — lists of devices and lists of collections via an indexed ENV convention (e.g. `PODKIT_DEVICE_1_*`, `PODKIT_COLLECTION_1_*`).

Needs a design for the indexed/array ENV convention before implementation. Draft until pulled into a release.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Indexed ENV convention designed for device lists and collection lists
- [ ] #2 Everything configurable via config.toml is configurable via ENV
- [ ] #3 Single-device happy path remains the documented common case
<!-- AC:END -->
