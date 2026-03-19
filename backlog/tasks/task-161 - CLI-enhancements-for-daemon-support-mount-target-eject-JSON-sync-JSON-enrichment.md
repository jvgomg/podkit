---
id: TASK-161
title: >-
  CLI enhancements for daemon support (mount --target, eject JSON, sync JSON
  enrichment)
status: To Do
assignee: []
created_date: '2026-03-18 23:55'
labels:
  - cli
  - daemon
dependencies: []
references:
  - packages/podkit-cli/src/commands/mount.ts
  - packages/podkit-cli/src/commands/eject.ts
  - packages/podkit-cli/src/commands/sync.ts
documentation:
  - backlog/documents/doc-004.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three small, non-breaking CLI enhancements that the daemon (doc-004) needs to function, but are also independently useful:

1. **Mount command: add `--target` flag** — Allow specifying the mount point path (e.g., `podkit mount --disk /dev/sdb2 --target /ipod`). Currently the mount point is auto-generated as `/tmp/podkit-<volumeName>`. The daemon needs to mount to a fixed `/ipod` path inside the container.

2. **Eject command: JSON output** — Ensure `podkit eject --output json` returns structured `EjectOutput` JSON. Currently the eject command only produces text output.

3. **Sync dry-run JSON: album/artist/video aggregation** — Add aggregate counts to the dry-run JSON plan output: album count, artist count, and for video syncs: movie count, TV show count, episode count. The daemon uses these to build rich notification summaries like "Adding 47 tracks (12 albums by 5 artists)" without parsing track name strings. The current JSON only has `tracksToAdd`, `tracksToRemove`, etc.

See PRD doc-004 (Docker Daemon Mode) for the full context on why these are needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Mount command accepts --target <path> flag that specifies the mount point directory
- [ ] #2 Mount command creates the target directory if it doesn't exist
- [ ] #3 Mount command returns the target path in JSON output (mountPoint field)
- [ ] #4 Eject command supports --output json and returns structured JSON with success, device, forced, and error fields
- [ ] #5 Sync dry-run JSON plan includes albumCount and artistCount fields (derived from tracks to add)
- [ ] #6 Sync dry-run JSON plan includes videoSummary with movieCount, showCount, episodeCount when video operations are present
- [ ] #7 Existing mount/eject/sync behavior is unchanged when new flags are not used
- [ ] #8 Tests cover the new flags and JSON output fields
<!-- AC:END -->
