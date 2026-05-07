---
title: "ADR-015: Audio-Stream Checksum Sync Tag"
description: Implementation of audio content change detection via audio-stream hashing, mtime/size optimization, and sync-tag storage.
sidebar:
  order: 16
---

# ADR-015: Audio-Stream Checksum Sync Tag

## Status

**Proposed** (2026-05-07)

Implementation slice of [ADR-014](adr-014-self-healing-audio-detection.md). Can ship independently of [ADR-016](adr-016-track-query-language.md) — `--check-audio` applies to all matched tracks when no query is given.

## Context

[ADR-014](adr-014-self-healing-audio-detection.md) establishes audio-stream-only hashing as the source of truth for audio content change detection, with mtime and size as optional optimization signals. This ADR locks in the implementation surface: sync-tag schema, hashing pipeline, adapter capability fields, CLI UX, and upgrade-engine integration.

The shape mirrors [ADR-012](adr-012-artwork-change-detection.md) deliberately: an opt-in scan flag (`--check-audio` parallels `--check-artwork`), progressive sync-tag writes during normal operations, and a baseline-population path via `--force-sync-tags`.

## Decision Drivers

- Match ADR-012's hash format and sync-tag conventions for consistency
- Compose with the existing `--force-sync-tags` UX, don't replace it
- Cheap on the add path (hash teed off the existing FFmpeg pipeline)
- Per-track capability declaration so adapters with partial support degrade gracefully
- Backward compatible: tracks without the new fields continue to work

## Decisions

### 1. Sync-tag schema

Extend the iTunesDB sync tag (per ADR-012) with three optional fields:

| Tag | Meaning | Format | Source |
|---|---|---|---|
| `art=XXXXXXXX` | Artwork hash (existing) | 8-char lowercase hex (32 bits) | ADR-012 |
| `aud=XXXXXXXX` | Audio-stream hash | 8-char lowercase hex (32 bits) | This ADR |
| `mt=NNNN` | Source mtime at last hash | epoch seconds, decimal | This ADR |
| `sz=NNNN` | Source size at last hash | bytes, decimal | This ADR |

Tags are written progressively during normal sync operations (on add, on upgrade) and are not gated behind any flag, matching ADR-012 §3 ("Always-on writes").

**Length budget verification.** Pure-hex layout for the full tag (`art=… aud=… mt=… sz=…`) is approximately 47 characters. The iTunesDB sync field's actual capacity must be verified before implementation. If tight, switch numeric fields to base36 (`mt` shrinks from ~10 to ~7 chars; `sz` shrinks from up to 11 to ~7 chars for sub-78GB files). Hex is preferred for readability when budget allows.

### 2. Audio-stream hash pipeline

Hash the audio elementary stream, not the file:

```
ffmpeg -i <source> -map 0:a -c copy -f data - | sha256
```

`-map 0:a` selects only audio streams. `-c copy` passes packets through without re-encoding. `-f data -` writes raw packet bytes to stdout. The byte stream is then hashed with SHA-256 and truncated to the first 32 bits (8 hex chars), matching ADR-012's `art=` format.

**Why SHA-256:** matches ADR-012 for a single hash convention across the sync tag. Performance is not a concern at this hash length and library size — SHA-256 of a 50 MB FLAC takes ~10 ms on commodity hardware, dominated by the FFmpeg demux not the hash.

**Why audio-stream extraction (not file hash):** see ADR-014 §1. This is what makes the signal immune to metadata edits. A FLAC `VORBIS_COMMENT` block, MP3 `ID3v2` header, or M4A `udta` atom is part of the file but not part of the audio stream — `-c copy` skips them.

**On the add path:** the byte stream is already flowing through FFmpeg for transcode/copy. The hash is teed off the same stream — essentially free. The hashing logic lives in `packages/podkit-core/src/sync/music/pipeline.ts` alongside the existing transfer code.

**On the verify path** (`--check-audio`): if the source is a local file, FFmpeg reads it directly. If the source is Subsonic, the adapter fetches the bytes via `/rest/download?id=…` and pipes them through FFmpeg. The download endpoint is preferred over `/rest/stream` to avoid server-side transcoding.

### 3. Adapter capability surface

Extend `CollectionTrack` (`packages/podkit-core/src/adapters/interface.ts`) with three optional fields:

```ts
interface CollectionTrack {
  // ... existing fields ...

  /** Source file size in bytes. Populated by adapters that expose this signal. */
  sourceSize?: number;

  /** Source modification time (epoch seconds). Populated by adapters that expose this signal. */
  sourceMtime?: number;

  /** Audio-stream hash (8-char lowercase hex). Populated by adapters that compute this; otherwise computed by the sync pipeline on demand. */
  sourceAudioHash?: string;
}
```

Adapters populate what they can. `undefined` means "this adapter does not provide this signal" — the optimization layer treats absence as a miss and falls through to hashing.

**Capability matrix at time of writing:**

| Adapter | `sourceSize` | `sourceMtime` | `sourceAudioHash` |
|---|---|---|---|
| Directory | ✓ via `stat.size` | ✓ via `stat.mtimeMs / 1000` | ✗ (computed by pipeline on demand) |
| Subsonic | ✓ via `Child.size` | ✓ via `HEAD /rest/download?id=… `→ `Last-Modified` (Navidrome / Gonic) | ✗ (computed by pipeline on demand) |

`sourceAudioHash` is intentionally not populated by adapters today. The pipeline computes it from the byte stream during transfer or verify. Reserved for future adapter-level optimization (e.g. an adapter cache).

### 4. Subsonic mtime via `Last-Modified`

The Subsonic JSON API does not expose mtime on `Child` or any related schema. Navidrome and Gonic both serve files via Go's `http.ServeContent` / `http.ServeFile`, which automatically sets the `Last-Modified` HTTP header from the file's filesystem mtime. A HEAD request retrieves it without transferring the body:

```
HEAD /rest/download?id=<song-id>&u=…&t=…&s=…&v=1.16.1&c=podkit
→ Last-Modified: Wed, 06 May 2026 10:00:00 GMT
```

The adapter parses the header and stores `Math.floor(date.getTime() / 1000)` as `sourceMtime`. See `agents/subsonic-api.md` for the full mechanism.

**Caveats:**

- **Reverse proxies may strip the header.** nginx, Caddy, and Cloudflare all do this in some configurations. If the header is absent, the adapter leaves `sourceMtime` undefined; the optimization layer falls through to hashing. No silent failure.
- **Navidrome scanner gates the value.** `MediaFile.UpdatedAt` only refreshes after Navidrome's scanner runs. A recently-replaced file may show stale mtime until the next scan completes. This is upstream behavior; we accept it.
- **Use `/rest/download` not `/rest/stream`.** Transcoded streams take a non-seekable code path that does not set `Last-Modified`. `/rest/download` serves the original file unconditionally.

When `--check-audio` is active and the adapter actually fetches the file (because the (mt, sz) optimization missed), it sends `If-Modified-Since` so the server can short-circuit with `304 Not Modified` if nothing changed since the last sync. This is a separate bandwidth win on top of the change-detection signal.

### 5. CLI UX

Three modes, composing the new flag with the existing `--force-sync-tags`:

| Command | Behavior |
|---|---|
| `podkit sync` | Unchanged from today (metadata-based detection only — ADR-009 + ADR-012 paths) |
| `podkit sync --check-audio` | For matched tracks: run the (mt, sz) optimization; on miss, fetch and re-hash. Mismatches trigger `audio-content-changed` upgrade. Hash matches refresh stored mt/sz. |
| `podkit sync --check-audio --force-recheck` | Same, but bypass the (mt, sz) optimization. Always fetch and re-hash. |
| `podkit sync --force-sync-tags --check-audio` | Populate `aud=`/`mt=`/`sz=` for all tracks that lack baselines, without re-transferring audio. Establishes baselines. Mirrors ADR-012's existing baseline-population flow. |

The flag plumbing follows the existing pattern in `packages/podkit-cli/src/main.ts` and the `checkArtwork` config plumbing in `packages/podkit-core/src/adapters/directory.ts:40`.

**Default-fallback ordering** for `checkAudio` and `forceRecheck`, matching ADR-009 §"Config and Resolution Order":

1. CLI flag (`--check-audio` / `--force-recheck`)
2. Device-level config
3. Global config
4. Default: `false`

### 6. Hash on add (always-on)

When a track is added or upgraded via file replacement, the audio-stream hash is computed during the source-read phase and written to the sync tag alongside `mt=` and `sz=`. This is unconditional — not gated behind `--check-audio` — because the bytes are already flowing through the pipeline and the marginal cost is a SHA-256 hash compute (~10 ms per track).

This matches ADR-012 §3 "Progressive writes" for artwork.

### 7. Refresh mt/sz on no-op verify

When `--check-audio` runs and finds the audio hash matches the stored `aud=`, the stored `mt=` and `sz=` are updated to the current source values regardless. This ensures the *next* `--check-audio` skips the expensive path even if the mtime drifted (e.g. from a metadata edit that was independently routed through the existing `metadata-correction` upgrade reason).

Without this refresh, a one-time tag edit would force re-hashing forever after — defeating the optimization.

### 8. New upgrade reason: `audio-content-changed`

Add to the upgrade reason enum in `packages/podkit-core/src/sync/engine/upgrades.ts`:

```ts
type UpgradeReason =
  | 'format-upgrade'
  | 'quality-upgrade'
  | 'artwork-added'
  | 'artwork-updated'
  | 'artwork-removed'
  | 'soundcheck-update'
  | 'metadata-correction'
  | 'audio-content-changed';   // new
```

Operation: file replacement (transcode or copy + update-metadata), identical to the `quality-upgrade` path. Preserves play counts, ratings, and playlist membership per ADR-009 §"In-Place Track Upgrade".

### 9. Failure handling

If FFmpeg fails to demux or hash a source file (e.g. the source is itself corrupt enough not to parse), log a warning and **do not write `aud=`** to the sync tag. The next `--check-audio` run will retry. Silent skip would risk masking real corruption from the user.

### 10. Sync-tag consistency model

Extending ADR-012 §7:

| Display | Meaning |
|---|---|
| ✓ | Sync tag present and audio hash matches stored value (or adapter does not support hashing for this track) |
| ◐ | Sync tag present but missing `aud=` — baseline not yet established |
| ✗ | No sync tag at all |

A track without `aud=` is consistent only in the "baseline pending" sense; running `--force-sync-tags --check-audio` resolves it.

## Consequences

### Positive

- Solves the corruption-fix scenario without false positives on metadata edits
- Free on the add path — opt-in for verification
- Per-adapter capability gracefully degrades; missing fields fall through to hashing
- Backward compatible: tracks without `aud=`/`mt=`/`sz=` continue to work; populated lazily
- Composes cleanly with `--force-sync-tags` (existing baseline-population UX)
- Composes cleanly with the query language (ADR-016) for partial verification scans

### Negative

- Initial `--force-sync-tags --check-audio` is slow on Subsonic — N full-file fetches
- New CLI flags (`--check-audio`, `--force-recheck`) and a new upgrade reason expand the surface area
- Adapter contract grows by three optional `CollectionTrack` fields
- FFmpeg pipeline complexity — hash teeing must be wired into the existing transfer code without breaking transcode/copy paths

## Related Decisions

- [ADR-014](adr-014-self-healing-audio-detection.md): master design
- [ADR-012](adr-012-artwork-change-detection.md): sync-tag pattern, baseline population via `--force-sync-tags`
- [ADR-009](adr-009-self-healing-sync.md): upgrade-reason mechanism, in-place upgrade preserving play counts

## References

- `agents/subsonic-api.md` — `Last-Modified` mechanism, caveats, and confirmed availability on Navidrome / Gonic
- FFmpeg stream selection — https://ffmpeg.org/ffmpeg.html#Stream-selection
- Existing artwork hash implementation — `packages/podkit-core/src/sync/engine/upgrades.ts` (lines 265–298) and `packages/podkit-core/src/sync/music/pipeline.ts` (line 2022 onward)
- Existing `checkArtwork` plumbing — `packages/podkit-core/src/adapters/directory.ts:40`
