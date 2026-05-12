---
id: TASK-263
title: E2E test coverage for mass-storage album artist paths and relocate
status: Done
assignee: []
created_date: '2026-03-31 17:45'
updated_date: '2026-05-12 20:16'
labels:
  - testing
  - mass-storage
dependencies: []
references:
  - packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts
  - packages/podkit-core/src/device/mass-storage-utils.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
modified_files:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/defaults.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/loader.test.ts
  - packages/podkit-cli/src/commands/open-device.ts
  - packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The album-artist path template and self-healing relocate features (added alongside the albumArtist directory fix) lack E2E test coverage. The unit tests cover the mechanics, but E2E tests should verify the full sync flow on a mass-storage device.

### What to test

1. **Compilation album grouping** — sync a collection with compilation tracks (different `artist`, same `albumArtist` = "Various Artists") to a mass-storage device. Assert all tracks end up in the same `Various Artists/{album}/` directory rather than being scattered across per-artist directories.

2. **Self-healing relocate on metadata change** — sync a track, then change the source's `albumArtist` and re-sync. Assert the file moves to the new directory via relocate (not delete+re-add), the old directory is cleaned up, and the track's audio data is unchanged.

3. **Path template change** — sync tracks with the default template, then open the adapter with a custom `pathTemplate` and re-sync. Assert files are relocated to paths matching the new template.

4. **Featured artist tracks** — sync a track where `artist` = "Artist feat. Guest" and `albumArtist` = "Artist". Assert the directory uses "Artist", not "Artist feat. Guest".

### Context

These scenarios were identified during code review of the album-artist path template implementation. The existing mass-storage E2E tests (`mass-storage-sync.e2e.test.ts`) cover basic sync flow but don't exercise albumArtist-based paths or the relocate mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 E2E coverage of compilation grouping under albumArtist directory
- [x] #2 E2E coverage of self-healing relocate on source albumArtist metadata change
- [x] #3 E2E coverage of pathTemplate change between syncs triggering relocate
- [x] #4 pathTemplate exposed via per-device config, deviceDefaults, and PODKIT_PATH_TEMPLATE env
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Scope adjustments

- Dropped the originally-listed "featured artist" scenario; it is already covered by unit tests in `packages/podkit-core/src/device/mass-storage-adapter.test.ts:262–391` (default template falls back through albumArtist → artist correctly) so duplicating it as an E2E gives no extra signal.
- Kept the other three scenarios — compilation grouping, relocate-on-metadata-change, custom pathTemplate — and exposed missing functionality required for the third.

## Missing functionality fixed

`MassStorageAdapterOptions.pathTemplate` existed in core but had no CLI surface. Added:

- `[devices.<name>] pathTemplate` in TOML
- `deviceDefaults.pathTemplate` (global default)
- `PODKIT_PATH_TEMPLATE` env var
- Validation: template must contain `{title}` and `{ext}`, must not be empty, and is rejected on iPod devices alongside the other mass-storage-only fields
- Plumbed from per-device → global deviceDefaults → adapter in `open-device.ts`

## E2E coverage added

In `packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts`:

1. Compilation grouping — three FLAC sources with different `artist` values but shared `albumArtist = "Various Artists"` end up in `Various Artists/Best of 2026/`; per-artist directories never appear.
2. Self-healing relocate — sync, retag source `ALBUMARTIST`, re-sync. File moves to the new directory via `fs.rename` (byte size unchanged, extension preserved), the origin directory is empty/removed, and a follow-up sync transfers 0 bytes (no re-transcode).
3. Custom pathTemplate — sync with default template, rewrite config to `Library/{albumArtist}/{album}/{title}{ext}`, re-sync. File is relocated to the new layout including the bare `{title}{ext}` filename without the `01 - ` track-number prefix.

## Known limitation surfaced (not in scope to fix)

`MassStorageAdapter.updateTrack` only persists comment / artwork / ReplayGain writes to disk — albumArtist (and other Vorbis tags) update in-memory only. The relocate test documents this: after retagging the source, the file moves correctly but the underlying tags are not rewritten, so each subsequent sync re-detects a metadata diff that resolves to a zero-byte `update-metadata` op. Worth a follow-up task if/when mass-storage tag-rewrite becomes desirable; not blocking this work.

## Tests

- `bun test packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts` — 14/14 pass (11 prior + 3 new)
- `bun run test:unit --filter podkit --filter @podkit/core` — 2438 pass / 1 skip / 0 fail (loader gains 6 new tests for pathTemplate validation + env parsing)
<!-- SECTION:FINAL_SUMMARY:END -->
