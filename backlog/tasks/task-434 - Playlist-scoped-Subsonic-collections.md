---
id: TASK-434
title: Playlist-scoped Subsonic collections
status: Done
assignee: []
created_date: '2026-06-23 19:04'
updated_date: '2026-06-23 21:12'
labels:
  - collections
  - subsonic
  - sync
dependencies: []
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
ordinal: 174000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for implementing playlist-scoped Subsonic/Navidrome music collections, per RFC doc-049 (RFC: Playlist-Scoped Subsonic Collections).

A `subsonic` music collection gains an optional `playlist` field that scopes the synced tracks to a single named server playlist (reusing the same server connection). The constraint is validated before sync, shown in the music listing commands, and covered end-to-end against a real Navidrome container.

Work is sliced into 5 independently-grabbable subtasks (vertical tracer bullets). See each subtask for scope. Full design, decisions, user stories, and testing plan live in doc-049 — do not duplicate; link.

Slices:
1. Core playlist-scoped sync (schema + resolver + adapter)
2. Empty-playlist guard
3. Display surfaces
4. Navidrome harness: playlist seeding
5. e2e:docker tests (blocked by 1-4)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 5 subtasks are Done
- [x] #2 A subsonic collection with `playlist = "<name>"` syncs only that playlist's tracks to the device
- [x] #3 Missing/ambiguous playlist aborts the sync before any transfer with a typed error
- [x] #4 Empty playlist is guarded (interactive confirm; headless abort unless overridden)
- [x] #5 Playlist constraint is visible in collection list, info, and music commands
- [x] #6 e2e:docker tests pass against a real Navidrome container
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Playlist-scoped Subsonic collections — shipped across 5 slices (434.01–434.05), all Done, full tree green (typecheck/lint/build, core+cli unit/integration, e2e:docker 9/9 stable), changeset @podkit/core minor, plus user docs + architecture docs + agent directives updated.

Feature: a `subsonic` music collection carries an optional `playlist` field (by-name, subsonic-only, non-empty); resolved server-side to the playlist's exact entries (ID-based sourcing), validated at sync start (missing→PlaylistNotFoundError / ambiguous→AmbiguousPlaylistError, abort before transfer) and on demand via `collection info`. Empty-playlist guard prevents silent device-wipe (interactive confirm; headless abort unless `--yes` or `allowEmptyPlaylist`). Constraint shown in collection list/info/music.

Identity decision (raised per user): boundary #1 (playlist→sourced tracks) is already ID-strong — exact getPlaylist(id) entries, fetched by Subsonic song id; no metadata round-trip. The metadata (artist/title/album) match key applies only to boundary #2 (device diff), which the user explicitly set aside. No identity refactor needed.

Bug found & fixed during e2e: `allowEmptyPlaylist` config/env override (story 13) was dropped in mergeConfigs — fixed + merge-level regression tests + new conventions.md §12 (add a config key in 3 places). Two pre-existing issues filed: task-435 (sync --json concatenated objects), draft-016 (exit-code 1-vs-2 asymmetry). Nothing committed (user handles commits).
<!-- SECTION:FINAL_SUMMARY:END -->
