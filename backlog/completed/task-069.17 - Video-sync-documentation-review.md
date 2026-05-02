---
id: TASK-069.17
title: Video sync documentation review
status: Done
assignee: []
created_date: '2026-03-08 16:05'
updated_date: '2026-03-08 17:44'
labels:
  - video
  - phase-5
  - documentation
dependencies: []
documentation:
  - docs/VIDEO-TRANSCODING.md
  - docs/adr/ADR-006-video-transcoding.md
parent_task_id: TASK-069
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final review and updates to documentation to ensure it matches the implementation.

Update VIDEO-TRANSCODING.md, ADR-006, and any other affected docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VIDEO-TRANSCODING.md reflects actual CLI usage
- [x] #2 VIDEO-TRANSCODING.md has accurate preset/bitrate tables
- [x] #3 ADR-006 status updated to Accepted
- [x] #4 AGENTS.md documentation map includes video docs
- [x] #5 docs/README.md index updated
- [x] #6 CLI --help output matches documentation
- [x] #7 Any implementation deviations from ADR documented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Documentation review complete. Updated VIDEO-TRANSCODING.md with CLI usage, ADR-006 status to Accepted, AGENTS.md doc map, docs/README.md index.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Video Sync Documentation Review Complete

### Changes Made

**VIDEO-TRANSCODING.md:**
- Updated CLI Usage section to document `podkit video-sync` command (instead of `podkit sync --type video`)
- Added comprehensive Command Options table matching actual CLI
- Added Examples section with common use cases
- Added Global Options section
- Updated Passthrough and Dry Run sections with accurate output examples
- Fixed debugging example to use correct command

**ADR-006-video-transcoding.md:**
- Changed status from "Proposed" to "Accepted"
- Added Implementation Notes section documenting:
  - CLI implemented as separate `video-sync` command
  - Quality presets, device profiles, source quality capping working as designed
  - Current limitations (dry-run only, no Plex/NFO adapters yet)

**AGENTS.md:**
- Added ADR-006 (Video transcoding) to Key Technical Decisions table
- VIDEO-TRANSCODING.md was already in Documentation Map (no change needed)

**docs/README.md:**
- Updated ADR-006 status from "Proposed" to "Accepted"
- VIDEO-TRANSCODING.md was already in index (no change needed)

### Verified

- CLI `--help` output matches documentation exactly
- All referenced documentation files exist (no broken links)
- Quality preset values match implementation in `packages/podkit-core/src/video/types.ts`
- Device profile specifications match implementation
<!-- SECTION:FINAL_SUMMARY:END -->
