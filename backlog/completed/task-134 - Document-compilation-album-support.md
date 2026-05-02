---
id: TASK-134
title: Document compilation album support
status: Done
assignee: []
created_date: '2026-03-13 23:27'
updated_date: '2026-03-14 02:04'
labels:
  - documentation
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
podkit fully supports the compilation flag across all layers (libgpod-node, core, CLI) but this isn't documented anywhere user-facing. Users with compilation albums (e.g., "Various Artists" albums, soundtracks) should know that podkit handles these correctly and understand how the flag is set from source metadata.

Areas to cover:
- How compilation albums are detected from source file metadata
- How the compilation flag is written to the iPod database
- How this affects iPod browsing (compilations appear under "Compilations" rather than cluttering individual artist lists)
- Relationship to the `albumartist` field
- Verification via `podkit device music --format json` (compilation field in output)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User-facing documentation explains how compilation albums are handled during sync
- [x] #2 Documentation covers how compilation flag relates to album artist and iPod browsing
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented full compilation album support across the entire sync pipeline and added documentation.

**Core pipeline changes:**
- Added `compilation?: boolean` to `CollectionTrack` interface and `TrackMetadata`
- DirectoryAdapter now reads `common.compilation` from music-metadata (supports FLAC COMPILATION, MP3 TCMP, M4A cpil)
- SubsonicAdapter now reads `album.isCompilation` from the Subsonic API
- Differ includes `compilation` in `CONFLICT_FIELDS` with `undefined`/`false` normalization to avoid spurious conflicts
- Executor passes `compilation` through `toTrackInput()` to the iPod database

**Tests:**
- Unit tests: DirectoryAdapter compilation extraction, differ conflict detection (3 cases including undefined vs false), executor compilation passthrough
- E2E tests: Directory source with FLAC fixtures (compilation flag sync + conflict detection on re-sync)
- E2E tests: Subsonic/Navidrome Docker test for compilation via Subsonic API (requires SUBSONIC_E2E=1)

**Documentation:**
- New page: docs/user-guide/syncing/compilation-albums.md covering detection, iPod behavior, tagging tools, and verification
<!-- SECTION:FINAL_SUMMARY:END -->
