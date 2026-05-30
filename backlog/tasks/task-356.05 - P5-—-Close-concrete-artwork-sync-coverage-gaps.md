---
id: TASK-356.05
title: P5 — Close concrete artwork/sync coverage gaps
status: Done
assignee: []
created_date: '2026-05-28 08:00'
updated_date: '2026-05-29 17:50'
labels:
  - testing
  - e2e
  - matrix
  - artwork
  - coverage
dependencies:
  - TASK-356.02
  - TASK-356.04
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
parent_task_id: TASK-356
priority: low
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-039 §"Concrete test gaps to close". Real missing cells that become expressible once the axes from P2 (transcode-vs-copy) and P4 (device, transfer mode) exist.

## Gaps

1. **Transfer mode × artwork** — `optimized` strips embedded art on database-artwork devices; `portable` preserves it. Currently absent from the artwork matrix.
2. **artwork-removed transition** — the change matrix covers added/updated but never the source-loses-art case.
3. **Artwork resize** — embedded-art devices resize; iPod has `artworkMaxResolution`. Not asserted anywhere.
4. **Compilation / album-artist × album-cache** — the album cache keys on `(artist, album)`; various-artist compilations risk collision or split. Directly relevant to the TASK-355.03 cache rework. Needs a compilation fixture (album where tracks have differing artists but a shared albumArtist / compilation flag).

Each gap is a small set of new cells on the existing harness, not new machinery. Depends on P2 (transcode-vs-copy axis) and P4 (device + transfer axes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 transfer-mode × artwork cells assert optimized strips / portable preserves embedded art on DB-artwork devices
- [x] #2 artwork-removed transition covered in the change matrix
- [x] #3 artwork resize asserted against device artworkMaxResolution
- [x] #4 compilation / various-artist fixture added; album-cache behaviour asserted for shared-album differing-artist tracks
- [x] #5 All new cells green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
#2 artwork-removed: added multi-format-embedded-stripped fixture (embedded tags, no art) + a `transition` axis (updated|removed) on the change matrix. Finding: removal fires `upgrade-artwork:artwork-removed` on BOTH passes (hash-free) because hasArtwork is a metadata field compared by self-healing (ADR-009); an update only fires `artwork-updated` under --check-artwork (needs the byte hash). 32 cells green.

#4 compilation: added multi-format-compilation fixture (distinct per-track artist `VA <FMT>`, shared album/album_artist/compilation; art embedded only in anchors FLAC/ALAC/MP3/AAC/AIFF, WAV/OGG/Opus bare). New art-matrix-compilation.test.ts (iPod-only, 16 cells, green). Finding: the album cache keys on (artist,album) (album-cache.ts getAlbumKey + pipeline.ts buildAlbumCandidates), so a compilation's differing-artist tracks each form a single-element candidate group → it's a SPLIT not a collision: bare tracks inherit NO sibling cover (anchors=hasArtwork true, WAV/OGG/Opus=false). Pins the deliberate TASK-355.03 keying.

P5a + #1: added musicRoot() to SyncTarget (iPod=iPod_Control/Music, mass-storage=musicDir) + matrix/device-artwork.ts probeFileArtwork (independent ffprobe → attached_pic presence + WxH + METADATA_BLOCK_PICTURE). reference-model.fileArtworkSurvives (capability-driven: embedded device always keeps/resizes; iPod database: portable keeps, optimized strips all, fast keeps copy/strips transcode). New art-matrix-transfer.test.ts (iPod, transcode-aac pipeline, 24 cells, green) asserts the DB-vs-file gap: dbHasArtwork always true while fileHasArt follows strip rules. Confirms iPod files retain artist/title tags (probe matches) and doc-012 strip behavior is live.

#3 resize: added multi-format-embedded-hires fixture (1024px cover, distinct artist) via a coverSize generator option. reference-model.expectedFileArtworkSize (embedded device = min(source,max); database device = source unchanged). New art-matrix-resize.test.ts (generic + iPod, portable, 5 anchor formats, 10 cells, green). Asserts: generic downscales file cover 1024->500 (=artworkMaxResolution); iPod leaves FILE at 1024 (database-art) and resizes only the iTunesDB thumbnail. Added probeIpodDbArtwork (matrix/device-artwork.ts, via @podkit/ipod-db parseArtworkDatabase+IpodReader, independent of libgpod C writer) reading ArtworkDB thumbnail dims; iPod cells assert dbArtWithinMax (largest thumbnail <= 320 AND < source; empirically 200/100). Added @podkit/ipod-db dep to e2e-tests.

Follow-up hardening (post-initial-Done, all green; full host suite 31/31 + Docker/Navidrome matrix re-run green): (1) change matrix now applies each detected change for real + a 3rd dry-run asserts convergence — removal does NOT churn-loop (convergesAfterApply). (2) compilation no-collision is now PROVEN not inferred: each anchor carries a distinct cover colour, probeIpodDbArtworkColor decodes the iTunesDB thumbnail and classifies the sampled colour back to the track's own cover. (Note: file-level hashing would bypass the cache — the file cover comes from the source; the DB thumbnail is the cache's output.) (3) resize matrix swept across all 3 transfer modes (30 cells): embedded device file=max every mode; iPod DB thumbnail<=max every mode, file at source where it survives. New reader: probeIpodDbArtworkColor; generator gained coverColorFor (per-track distinct covers). Sidecar audit (separate): TASK-142 cross-referenced with directory-adapter-no-sidecar evidence; TASK-356.06 created for Navidrome sidecar permutation testing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
P5 closed all four concrete artwork/sync coverage gaps from doc-039 §"Concrete test gaps to close". Test-only; no production code changed.

## New observation machinery (P5a)
- `SyncTarget.musicRoot()` (iPod = iPod_Control/Music; mass-storage = preset musicDir) on all three target impls.
- `matrix/device-artwork.ts`: `probeFileArtwork(musicRoot)` ffprobes device files for attached-picture presence + WxH (+ METADATA_BLOCK_PICTURE), matching by file artist/title tags (works on either backend); `probeIpodDbArtwork(mount)` reads iTunesDB ArtworkDB thumbnail sizes via `@podkit/ipod-db`. Both independent of podkit's libgpod write path. Added `@podkit/ipod-db` dep to e2e-tests.
- reference-model: `fileArtworkSurvives(action, mode, sourceHadArt, caps)` and `expectedFileArtworkSize(sourceSize, caps)` — capability-driven, no name branches.

## Matrices (all green, host)
- #1 transfer×artwork — `art-matrix-transfer.test.ts` (iPod, 24 cells): DB keeps cover (`dbHasArtwork` always true) while the file is stripped per mode (portable keeps / optimized strips all / fast keeps copy, strips transcode — doc-012). The strip is invisible to the plan and to hasArtwork; needed the file reader.
- #2 artwork-removed — `art-matrix-change.test.ts` `transition` axis (32 cells): removal fires `artwork-removed` hash-free on both passes (metadata hasArtwork comparison, ADR-009); an update needs --check-artwork.
- #3 resize — `art-matrix-resize.test.ts` (generic+iPod, 10 cells, hires 1024px fixture): generic downscales the file cover to artworkMaxResolution (500); iPod leaves the file at source and resizes only the iTunesDB thumbnail (asserted ≤320 via probeIpodDbArtwork).
- #4 compilation — `art-matrix-compilation.test.ts` (iPod, 16 cells): the album cache's (artist,album) key makes various-artist compilations SPLIT (bare tracks orphaned) not collide — anchors get art, bare WAV/OGG/Opus do not. Pins TASK-355.03's deliberate keying.

## Fixtures added
multi-format-embedded-stripped, multi-format-compilation, multi-format-embedded-hires. Generator gained per-track artistFor, shared album/albumArtist/compilation, per-track embedTrack, and coverSize options (all defaulted; existing fixtures unchanged).

## Verification
Full host e2e suite: 31 files passed, 0 failed (6m15s). typecheck + oxlint clean. Docker (Subsonic/Navidrome) matrix NOT re-run — needs Docker; artwork-rules changes left predictSubsonic/observeStaticArtwork untouched.

## Follow-ups identified (not blocking)
- Removal idempotency: the change matrix asserts the dry-run op fires once, not that a real removal sync converges over 3 syncs (possible churn-loop risk, unverified).
- #4 proves no-collision by code-reading the (artist,album) key, not by art-byte identity; could add art hashing to probeFileArtwork.
- #3 excludes WAV/OGG/Opus (uncertain post-transcode art dims) and echo-mini (max 127 — best downscale demo, blocked by the OGG-abort bug, TASK-358.01).
- `fileArtworkSurvives` has no explicit sidecar branch (rockbox falls through to the database branch; untested).
- Known limitation pinned (not a bug): a compilation track carrying no embedded art gets no cover, because the (artist,album) key denies it a differing-artist sibling's cover — a product decision, surfaced via the bare-track cells.
<!-- SECTION:FINAL_SUMMARY:END -->
