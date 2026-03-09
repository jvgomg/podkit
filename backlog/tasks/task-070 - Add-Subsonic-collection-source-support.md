---
id: TASK-070
title: Add Subsonic collection source support
status: Done
assignee: []
created_date: '2026-03-08 16:15'
updated_date: '2026-03-09 20:54'
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
- [x] #1 Users can sync tracks from a Subsonic server to iPod
- [x] #2 Works with Navidrome, Airsonic, and other Subsonic-compatible servers
- [x] #3 CLI supports subsonic:// URL scheme for --source
- [x] #4 Credentials can be configured via config file or environment variables
- [x] #5 Download failures cause sync to fail with clear error message
- [x] #6 All subtasks completed with tests passing
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Subsonic collection source support with the following components:

**Core Changes:**
- Added `FileAccess` type (`path` | `stream`) to `CollectionAdapter` interface
- Implemented `SubsonicAdapter` using `subsonic-api` package with pagination, metadata mapping, and lossless detection
- Updated sync executor to handle stream-based file access with temp file downloads
- Added stream utilities for downloading remote files

**CLI Support:**
- Added `subsonic://` URL scheme detection
- Implemented password resolution from environment variables (`SUBSONIC_PASSWORD`, `PODKIT_MUSIC_{NAME}_PASSWORD`)
- Updated sync and collection commands to use new adapter system

**Testing Infrastructure:**
- Unit tests for SubsonicAdapter
- Integration tests with mocked HTTP server (Bun.serve)
- E2E tests with Docker Navidrome container
- Docker container management with automatic cleanup on Ctrl+C, crashes, and orphan detection

**New Commands:**
- `bun run test:e2e:docker` - Run Docker-based E2E tests
- `bun run cleanup:docker` - Clean up orphaned test containers
<!-- SECTION:FINAL_SUMMARY:END -->
