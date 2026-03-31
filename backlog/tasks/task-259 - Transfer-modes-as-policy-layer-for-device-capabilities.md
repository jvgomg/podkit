---
id: TASK-259
title: Transfer modes as policy layer for device capabilities
status: To Do
assignee: []
created_date: '2026-03-31 12:56'
labels:
  - enhancement
  - architecture
milestone: m-14
dependencies: []
references:
  - packages/podkit-core/src/sync/music/classifier.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transfer modes should be the policy layer that interacts with device capabilities to make decisions about artwork, audio normalization, and other metadata. Currently they only affect artwork stripping behaviour and don't interact with normalization at all. Discovered during Echo Mini E2E validation (TASK-226).

**Desired behaviour:**

- **fast:** Audio normalization data copied on first sync and not updated if source changes. Artwork resized to device limits.
- **optimized:** Audio normalization stripped on first sync (or stripped when switching to this mode). Artwork resized to device limits.  
- **portable:** Audio normalization preserved and updated on subsequent syncs. Artwork resized to device limits with a warning that the device only supports embedded artwork and resolution cannot be preserved for portability.

**Additional improvements:**
- `--force-transfer-mode` should just rewrite sync tags in-place when the file output would be byte-identical (no need to re-run FFmpeg)
- Portable mode warning should say "preserves as much metadata as possible but artwork will be resized down" instead of the current wording
- Future: transfer modes should also govern lyrics data handling
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Transfer modes interact with audioNormalization device capability to strip/preserve/update ReplayGain tags appropriately
- [ ] #2 --force-transfer-mode rewrites sync tags in-place when file output would be identical (no FFmpeg re-run)
- [ ] #3 Portable mode warning uses clearer wording about metadata preservation vs artwork constraints
- [ ] #4 Each transfer mode behaviour is documented and tested for mass-storage devices
<!-- AC:END -->
