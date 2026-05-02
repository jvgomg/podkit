---
id: TASK-141
title: Subsonic artwork presence detection with placeholder filtering
status: Done
assignee: []
created_date: '2026-03-16 21:12'
updated_date: '2026-03-17 14:58'
labels:
  - enhancement
  - artwork
  - subsonic
  - directory-adapter
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The Subsonic API's `coverArt` field is always populated by Navidrome, even for tracks/albums without actual artwork. Additionally, Navidrome serves a static placeholder image for albums without real artwork. This meant:

- **artwork-added** was never detected for Subsonic sources
- **artwork-removed** was never detected for Subsonic sources
- **artwork-updated** worked correctly via hash comparison with `--check-artwork`

## Solution

At connect time, the adapter probes `getCoverArt` with an empty `id` to detect the server's placeholder image. If the server returns an image (Navidrome does), its hash is stored and used to filter placeholder responses during scanning. Servers that return errors for invalid ids (Gonic) have no placeholder hash, and filtering is a no-op.

This enables all three artwork operations (added, removed, updated) for Subsonic sources, with correct handling of Navidrome's placeholder images.

## Key Research Findings

- **Navidrome**: Always populates `coverArt`, serves static WebP placeholder (69KB) for albums without artwork. Placeholder is byte-for-byte identical whether fetched via empty `id` or a real album without artwork.
- **Gonic**: Only populates `coverArt` when artwork exists, returns error code 70 for missing artwork. No placeholders.
- **Subsonic/OpenSubsonic spec**: No `hasCoverArt` field defined. Behavior for missing artwork is implementation-dependent.

## Related

- TASK-142: Sidecar artwork support and executor adapter fallback (follow-up work)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Subsonic adapter detects artwork presence via getCoverArt (hasArtwork=true/false, not undefined)
- [x] #2 Navidrome placeholder images are detected at connect time and filtered during scanning
- [x] #3 Gonic and other servers that return 404 for missing artwork work correctly without filtering
- [x] #4 artwork-added detected for Subsonic tracks when artwork is added to a previously bare track
- [x] #5 artwork-removed detected for Subsonic tracks when artwork is stripped from source files
- [x] #6 artwork-updated detected via hash comparison when --check-artwork is enabled
- [x] #7 All artwork operations are idempotent (applying then re-scanning shows 0 updates)
- [x] #8 Unit tests cover: presence detection, placeholder filtering, artworkHash gating, caching
- [x] #9 Integration tests cover: mock HTTP server with placeholder probe, Navidrome vs Gonic behavior
- [x] #10 E2E tests cover: artwork-updated, artwork-removed, artwork-added with Docker Navidrome
- [x] #11 ADR-012 updated with placeholder detection design and server compatibility table
- [x] #12 User docs updated: upgrades.md, subsonic.md, config-file.md
- [x] #13 Changeset added for @podkit/core
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 1: Complete

### Solution: Placeholder Hash Detection

At connect time, the adapter probes getCoverArt with an empty `id`. Navidrome returns its static placeholder WebP image (69KB, same image for all albums without artwork). The hash is stored and used to filter responses during scanning. Servers that return errors (Gonic) have no placeholder hash, so filtering is a no-op.

### Key Research Findings

- **Navidrome**: Always populates `coverArt` field, serves placeholder WebP for albums without artwork, returns error code 70 for nonexistent entity IDs. Placeholder is byte-for-byte identical whether fetched via empty `id` or a real album without artwork.
- **Gonic**: Only populates `coverArt` when artwork exists, returns error code 70 for missing artwork. No placeholders.
- **Subsonic/OpenSubsonic spec**: No `hasCoverArt` field defined. Behavior for missing artwork is implementation-dependent.

### Files Changed

- `packages/podkit-core/src/adapters/subsonic.ts` — placeholderHash, detectPlaceholderArtwork(), updated fetchArtworkInfo() and mapSongToTrack()
- `packages/podkit-core/src/adapters/subsonic.test.ts` — 25 artwork unit tests
- `packages/podkit-core/src/adapters/subsonic.integration.test.ts` — 28 integration tests with mock HTTP server
- `packages/e2e-tests/src/features/artwork-change.e2e.test.ts` — 3 Docker Navidrome E2E tests
- `adr/adr-012-artwork-change-detection.md` — Updated decision 4
- `docs/user-guide/syncing/upgrades.md`, `docs/user-guide/collections/subsonic.md`, `docs/reference/config-file.md`

### Phases 2 and 3 remain (lower priority)

- Phase 2: Executor adapter fallback (fetch artwork from adapter when extraction returns null)
- Phase 3: Directory sidecar support (cover.jpg, folder.jpg)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Phase 1 Complete: Subsonic Artwork Presence Detection

### Changes
- Subsonic adapter probes for placeholder artwork at connect time via `getCoverArt` with empty `id`
- `fetchArtworkInfo()` filters responses matching the placeholder hash → `hasArtwork=false`
- Artwork presence detection is always-on; `artworkHash` for change detection remains gated behind `--check-artwork`
- Works correctly with Navidrome (placeholder filtered), Gonic (no placeholder), and unknown servers (falls back to basic validation)

### Test Coverage
- 25 unit tests (presence, placeholder filtering, artworkHash gating, caching)
- 28 integration tests (mock HTTP server, Navidrome vs Gonic behavior)
- 3 E2E Docker Navidrome tests (artwork-updated, artwork-removed, artwork-added — all idempotent)

### Docs
- ADR-012 updated with placeholder detection design and server compatibility table
- upgrades.md, subsonic.md, config-file.md updated
- Changeset: `@podkit/core` minor
<!-- SECTION:FINAL_SUMMARY:END -->
