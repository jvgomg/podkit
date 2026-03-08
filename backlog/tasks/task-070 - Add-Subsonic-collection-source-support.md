---
id: TASK-070
title: Add Subsonic collection source support
status: To Do
assignee: []
created_date: '2026-03-08 16:15'
labels:
  - feature
  - subsonic
  - adapter
dependencies: []
references:
  - docs/adr/ADR-007-subsonic-collection-source.md
  - docs/adr/ADR-004-collection-sources.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Enable syncing music from Navidrome and other Subsonic-compatible servers to iPods. This implements the design in ADR-007.

## Scope

- Generic Subsonic API support (works with Navidrome, Airsonic, Gonic)
- Track sync only (playlists deferred to future work)
- Fresh catalog fetch each sync (no local caching for MVP)
- Strict error handling (fail sync on any download failure)

## Key Design Decisions

| Aspect | Decision |
|--------|----------|
| File access | Unified `getFileAccess()` returning `{ type: 'path' | 'stream' }` |
| CLI exposure | URL scheme detection: `subsonic://user@server` |
| Auth config | Config file + environment variable overrides |
| Verification | Size check after download |
| Track matching | Use existing normalized (artist, title, album) strategy |

## Dependencies

- `subsonic-api` npm package for API client

## Out of Scope (Future Work)

- Playlist sync (TASK-TBD)
- Local catalog caching
- Multiple server support (see TASK-062)
- Incremental sync

## Subtasks

This parent task is broken into subtasks covering:
1. Interface extension (FileAccess type)
2. DirectoryAdapter update
3. Sync engine stream support
4. SubsonicAdapter implementation
5. CLI integration
6. Unit tests
7. Integration tests (Docker Navidrome)
8. E2E tests
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Users can sync tracks from a Subsonic server to iPod
- [ ] #2 Works with Navidrome, Airsonic, and other Subsonic-compatible servers
- [ ] #3 CLI supports subsonic:// URL scheme for --source
- [ ] #4 Credentials can be configured via config file or environment variables
- [ ] #5 Download failures cause sync to fail with clear error message
- [ ] #6 All subtasks completed with tests passing
<!-- AC:END -->
