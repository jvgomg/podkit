---
id: TASK-431.05
title: Artwork — in-package ArtworkDecoder + embed + cover.png
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 16:39'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the in-package `ArtworkDecoder` (port, don't import, ipod-db's artwork logic): parse the dumped `ArtworkDB`, match the largest thumbnail to a track by `dbid`, read bytes from the matching `F*.ithmb`, and decode the stored pixel format (RGB565 / RGB555 / RGB888) to RGBA, cropping padding. Add `RgbaToPng` (pngjs). Embed the PNG into each track's tags (via node-taglib-sharp) and also write `cover.png` into each album folder. Tracks with no artwork are skipped (no placeholder).

Spec: doc-047 (Reading the dump — artwork carve-out; ArtworkDecoder; RgbaToPng).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ArtworkDecoder decodes the largest thumbnail to RGBA from the dumped ArtworkDB + .ithmb, matched by dbid
- [x] #2 Decoded artwork is PNG-encoded, embedded in track tags, and written as cover.png per album folder
- [x] #3 Tracks without artwork are skipped with no placeholder
- [x] #4 ArtworkDecoder integration-tested against fixture ArtworkDB/.ithmb across ≥2 pixel formats; RgbaToPng unit-tested
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ported the iPod artwork-decode stack into `packages/ipod-archive/src/artwork/` (no `@podkit/ipod-db` import; reimplemented from its `artworkdb/` reference):

- `pixel-formats.ts` — RGB565 / RGB555 / RGB888 → RGBA decoders + `getDecoder`/`getBytesPerPixel` (Ipod casing → `decodeRgb565` etc). 1068 decoded as RGB565 (libgpod safety default); `getBytesPerPixel` kept consistent with `getDecoder` (returns 2 for 1068).
- `ithmb.ts` — `extractThumbnail(ithmbData, thumbnail)`: bounds-checked offset read + right/bottom padding crop. Pure (bytes in, RGBA out).
- `types.ts` — `ArtworkDatabase`/`ArtworkImage`/`ArtworkThumbnail`/`DecodedImage` (image-list subset only).
- `artwork-db.ts` — little-endian mh-record parser (mhfd → mhsd type 1 → mhli → mhii → mhod type 2 → mhni, + optional mhod type-3 filename). Own tiny `ArtworkReader` (no ipod-db dep). 64-bit `songId` read at mhii+0x14 → `sourceId` (bigint). Typed `IpodArchiveError('ARTWORK_DB_MALFORMED')` (new code) on bad header / truncation.
- `artwork-decoder.ts` — `createArtworkDecoder(ipodRoot) → { coverRgba(dbid: bigint) }`. Parses ArtworkDB once, indexes largest-area thumbnail per `sourceId`, resolves + memoises the `F<formatId>_*.ithmb` (prefers the colon-path filename, else scans by formatId), decodes on demand. Degrades to an all-null decoder when ArtworkDB is absent/unreadable/empty; per-lookup null on unknown dbid or missing ithmb.
- `rgba-to-png.ts` — `rgbaToPng({width,height,data})` via `pngjs` `PNG.sync.write` (added `pngjs`/`@types/pngjs`; `--external pngjs` in build).

Wiring:
- `tag-writer.ts` — `meta.cover` now embedded as `PictureType.FrontCover` via `Picture.fromData(ByteVector.fromByteArray(...))`. Audio stays lossless; the "no fields → byte-identical copy" invariant preserved (`hasWritableFields` gates the taglib open; cover counts).
- `run-transform.ts` — builds the decoder from `ipodRoot`; per track: `coverRgba(dbid)` → `rgbaToPng` → embed via `meta.cover` AND write `cover.png` once per album folder (deduped on archive-relative dirname; the `coveredAlbumDirs.add` happens only after a successful write so a transient failure can retry). cover.png only for the Music tree; podcasts/video are embedding-only by design. Tracks with no decodable art → new `TransformResult.noArtwork` bucket (skipped silently, surfaced for the report stage). Artwork decode/encode/sidecar errors never abort the run.
- CLI: `device/archive.ts` + `output-types.ts` surface `noArtworkCount` in the transform-stage envelope; CLI unit test updated.

Fixture sourcing: ALL artwork fixtures are SYNTHESISED in-code (no real iPod user data). Integration test (`artwork/artwork-decoder.integration.test.ts`) hand-builds a valid ArtworkDB (mhfd/mhsd/mhli/mhii/mhod/mhni) + matching `.ithmb` from the documented record layout, seeds a dump via `@podkit/gpod-testing` + libgpod tracks, reads back the assigned dbids, and asserts: largest-thumbnail selection across RGB565 + RGB555; null for unknown dbid; no-ArtworkDB degradation; end-to-end embed (read back front-cover picture bytes) + one cover.png per album (deduped) + `noArtwork` bucketing. No coverage gap on the decode core — pixel formats, ithmb crop, RgbaToPng round-trip, and the binary parser all have dedicated unit tests.

Quality gates (all pass): `bun install`; `bun run build --filter @podkit/ipod-archive --filter podkit`; typecheck both (turbo); `bun run lint` (0/0); `bun run test:unit --filter @podkit/ipod-archive` (126 pass); `bun run test:integration --filter @podkit/ipod-archive` (23 pass); CLI `test:unit --filter podkit` (1734 pass).

Note: during integration, libgpod's own native parser emits a harmless stderr WARNING ("Unexpected image type in mhni: 1057") when `Database.open` walks the synthetic ArtworkDB it doesn't recognise — it does not affect the in-package decoder or any assertion.
<!-- SECTION:NOTES:END -->
