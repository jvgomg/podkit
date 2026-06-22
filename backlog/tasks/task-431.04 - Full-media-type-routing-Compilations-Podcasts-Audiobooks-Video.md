---
id: TASK-431.04
title: Full media-type routing (Compilations / Podcasts / Audiobooks / Video)
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 16:18'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `ArchivePathPlanner` beyond music to route by libgpod-node `Track.mediaType` (+ season/episode/movieFlag/tvShow): `Music/Compilations/<Album>/` (compilation flag), `Podcasts/<Show>/`, `Audiobooks/<Author?>/`, `Video/Movies/`, `Video/TV Shows/<Show>/Season NN/## Title`, `Video/Music Videos/`.

Spec: doc-047 (Stage 2 directory tree; media-type routing).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tracks route into Music/Compilations, Podcasts, Audiobooks, and Video/{Movies,TV Shows,Music Videos} by media type
- [x] #2 Compilation albums grouped under Music/Compilations/<Album>/
- [x] #3 TV shows nested as Video/TV Shows/<Show>/Season NN/
- [x] #4 ArchivePathPlanner unit tests extended to cover every media-type branch
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended `ArchivePathPlanner` (`packages/ipod-archive/src/archive-path-planner.ts`) to route by media type. Kept pure/IO-free.

MediaType flag values used (from `@podkit/libgpod-node` `MediaType`): Audio=0x0001, Movie=0x0002, Podcast=0x0004, Audiobook=0x0008, MusicVideo=0x0020, TVShow=0x0040. `mediaType` is a bitfield — all checks use bitwise AND via a `hasMediaFlag` helper, never equality.

New `classifyMediaType(track): MediaKind` collapses the bitflags + compilation/movieFlag into one discriminated kind. Documented precedence (most specific first): TVShow → movie (movieFlag OR Movie flag) → MusicVideo → Podcast → Audiobook → compilation (audio) → music. This resolves malformed multi-flag tracks deterministically (e.g. TVShow|Movie → TV show).

Routing (per doc-047 Stage 2 tree):
- Compilation: Music/Compilations/<Album>/<NN> <Title>.<ext> (album-grouped, album-artist NOT in path).
- Podcast: Podcasts/<Show>/<Title>.<ext>, Show = album||artist||"Unknown Podcast", no NN prefix.
- Audiobook: Audiobooks/<Author>/<Title>.<ext>, Author = albumArtist||artist||"Unknown Author".
- Music video: Video/Music Videos/<Title>.<ext>.
- TV show: Video/TV Shows/<Show>/Season <NN>/<EE> <Title>.<ext>; Show = tvShow||album||"Unknown Show"; Season dir omitted when seasonNumber<=0; EE = episodeNumber, falls back to trackNumber, omitted when neither set.
- Movie: Video/Movies/<Title>.<ext>.
- Music/default: unchanged Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>.

All segments still flow through `sanitizePathSegment`; collision→dbid suffix, ext derivation, null ipodPath→null, and Unknown fallbacks reused unchanged.

`PlannerTrack` widened with mediaType/compilation/tvShow/seasonNumber/episodeNumber/movieFlag (matching libgpod-node field names/types); `toPlannerTrack` forwards them. `run-transform.ts` already iterates ALL tracks via `db.getTracks()` with no media-type filter — left untouched (it just uses the returned path). New subdir constants + `classifyMediaType` + `MediaKind` exported from index.ts.

Tests: extended `archive-path-planner.test.ts` with a `classifyMediaType` suite and a planPath case for every branch — compilation, podcast (+show fallbacks), audiobook (+author fallbacks), music video, TV show (season+episode, missing season, episode→trackNumber fallback, both-missing, reserved-char show sanitisation), movie (both via Movie flag and movieFlag), plus bitflag-vs-equality and multi-flag precedence cases. Existing music/collision/sanitisation tests unchanged and still pass.

Quality gates (all pass):
- bun run build --filter @podkit/ipod-archive --filter podkit — 12 tasks successful.
- bunx turbo run typecheck (both packages) — 13 successful.
- bun run lint — 0 warnings/0 errors.
- bun run test:unit --filter @podkit/ipod-archive — 95 pass / 0 fail.
- bun run test:integration --filter @podkit/ipod-archive — 19 pass / 0 fail.

Note: packages/ipod-archive is still entirely untracked in git (stage-1/2 work not yet committed); not committed per instructions.
<!-- SECTION:NOTES:END -->
