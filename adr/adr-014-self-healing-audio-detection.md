---
title: "ADR-014: Self-Healing Audio Change Detection"
description: Master design for detecting audio content changes (corruption fixes, re-encodes) without false-positives on metadata edits.
sidebar:
  order: 15
---

# ADR-014: Self-Healing Audio Change Detection

## Status

**Proposed** (2026-05-07)

This is the master ADR for audio content change detection. Implementation is split across two slice ADRs that can ship independently:

- [ADR-015: Audio-Stream Checksum Sync Tag](adr-015-audio-stream-checksum-sync-tag.md) — sync-tag schema, hashing pipeline, `--check-audio` UX
- [ADR-016: Track Query Language for Scoped Sync](adr-016-track-query-language.md) — beets-style selection language for scoping any sync operation

## Context

[ADR-009](adr-009-self-healing-sync.md) introduced self-healing sync via metadata-based change detection. For matched tracks, the differ compares fields like format, bitrate, artwork presence, and tag values to decide whether to upgrade. [ADR-012](adr-012-artwork-change-detection.md) extended this with content-hashing for artwork, stored in the iTunesDB sync tag as `art=XXXXXXXX`. Both decisions deliberately rejected file hashing and modification-time tracking as automatic re-sync triggers.

This leaves a documented gap that ADR-009 itself acknowledges: "Metadata comparison can't detect every change (e.g., a re-mastered file with identical bitrate/format)."

The motivating scenario: a user replaces a corrupt audio file with a fixed copy of the same track. Same artist, album, title; same format and bitrate; same embedded tags. The differ matches, the upgrade detector finds nothing, the device keeps the corrupt version. The user has no way to fix this without removing and re-adding the track — losing play counts, ratings, and playlist membership in the process.

### The metadata-edit false-positive problem

The naive fix is to track the source file's size or modification time and re-sync when it changes. This is what most file-sync tools do. It's wrong for podkit because **editing embedded tags rewrites the file**: a FLAC `VORBIS_COMMENT` block, an MP3 `ID3v2` header, or an M4A `udta` atom is part of the file. Editing a misspelled artist name changes both `size` and `mtime`, even though the audio content is identical.

Today, the metadata-edit case is handled correctly and cheaply by the existing `metadata-correction` upgrade reason in ADR-009 — the differ compares parsed metadata fields and updates only the iTunesDB row, never re-transferring audio. Layering size/mtime on top would corrupt that path: every metadata edit would look like a content change and trigger a full transcode/re-upload.

So we have a forced choice. Of the three properties — **cheap, automatic, accurate** — we can have any two:

| Cheap | Automatic | Accurate | Approach |
|---|---|---|---|
| ✓ | ✓ | ✗ | Size / mtime — false positives on metadata edits |
| ✓ | ✗ | ✓ | Manual force selection — user explicitly identifies what to re-sync |
| ✗ | ✓ | ✓ | Audio-stream hash — extracts only audio packets, ignores tag blocks |

This ADR adopts the second and third approaches together: an opt-in `--check-audio` verification mode using audio-stream-only hashing (accurate, not cheap), backed by a query language that lets users scope any sync operation including the manual case (cheap, not automatic). The default sync remains cheap and metadata-only, unchanged from ADR-009.

## Decision Drivers

- Detect byte-level audio content changes (corruption fix, re-encode, replacement)
- **Do NOT trigger re-sync on metadata-only edits** — preserve ADR-009's cheap `metadata-correction` path
- Work across adapters with different capabilities (directory has `stat`; Subsonic does not, but exposes mtime via HTTP `Last-Modified` headers)
- Work for transcoded tracks (FLAC → AAC) where iPod-side bytes have no relationship to source bytes
- Reuse the sync-tag mechanism established by ADR-012 — no persistent local sync state (per ADR-009)
- Opt-in cost — verification scans must not be the default
- Compose with the existing `--force-sync-tags` populate UX, not replace it

## Options Considered

### A. Metadata-only detection (status quo per ADR-009)

Reject. Documented gap. Doesn't catch the corruption-fix scenario the user reported.

### B. File size as automatic re-sync trigger

Reject. False positive on every metadata edit (tag block changes file size).

### C. File size + mtime as automatic re-sync trigger

Reject. Same false-positive problem. mtime catches more changes than size alone but is no more discriminating between "audio changed" and "tags changed."

### D. Full file hash as automatic trigger

Reject. Same false-positive problem (tag block is part of the file). Plus expensive on every sync.

### E. Audio-stream-only hash (accepted, opt-in)

Hash only the audio stream packets, ignoring tag/metadata blocks. FFmpeg can extract these by passing `-map 0:a -c copy` — only the audio elementary stream flows out, container headers and tag blocks are skipped. This is the only signal that's true to the question "did the audio content change?"

Cost: requires reading the audio bytes. For local files this is fast (sequential disk read + a small hash compute); for Subsonic it requires a full file download per track. For this reason the verification path is opt-in via `--check-audio`. On the **add** path the cost is essentially free because we already pipe bytes through FFmpeg for transcode/copy, and a hash can be teed off the same stream.

### F. Server-side content hash

Reject. Confirmed unavailable. No vanilla Subsonic, OpenSubsonic, or Navidrome extension exposes a per-file hash, ETag, or audio-stream digest. See `agents/subsonic-api.md`.

### G. Manual force replacement only (no automatic detection)

Partial. Kept as part of the solution via the query language ([ADR-016](adr-016-track-query-language.md)) so users can scope any sync — including verification — but not relied on as the sole answer. A user with bit-rotted files they don't know about needs the verification path.

### H. Persistent local sync-state cache

Reject. ADR-009 explicitly rejected this and the rationale still holds: state on disk needs cross-machine coordination, lifecycle management, and recovery semantics. Sync state lives on the device in the iTunesDB sync tag (per ADR-012); we extend that mechanism rather than introducing a parallel one.

## Decision

Adopt **audio-stream-only hashing** as the source of truth for audio content change detection. The implementation has the following load-bearing properties.

### 1. Hash the audio stream, not the file

The hash is computed from the audio elementary stream (the audio packets in the container), not the file bytes. This is what makes the signal immune to metadata edits. Implementation in [ADR-015 §2](adr-015-audio-stream-checksum-sync-tag.md).

### 2. Sync-tag storage extension

Three new optional sync-tag fields, mirroring the `art=` pattern from ADR-012:

- `aud=XXXXXXXX` — audio-stream hash (truncated to 32 bits, 8-char lowercase hex)
- `mt=NNNN` — source modification time (epoch seconds at last hash)
- `sz=NNNN` — source size in bytes at last hash

Schema details and length budget in [ADR-015 §1](adr-015-audio-stream-checksum-sync-tag.md).

### 3. Per-adapter capability via optional `CollectionTrack` fields

Adapters declare what they can populate by setting (or not setting) optional fields on `CollectionTrack`:

- `sourceSize?: number`
- `sourceMtime?: number` (epoch seconds)
- `sourceAudioHash?: string`

Absence means "this adapter does not provide this signal." This matches the existing `artworkHash?` pattern. The optimization layer queries these fields per-track and uses only what is available. **A track synced from one adapter and later considered against another with fewer capabilities degrades gracefully:** missing fields drop out of the comparison, and absence falls through to "must hash to know."

### 4. mt/sz are optimization, never the source of truth

The mtime and size signals exist solely to short-circuit the expensive path. When both are present and unchanged from the stored sync tag, we **skip** hashing for that track. When either is changed (or absent), we hash. **mt and sz never independently trigger a re-sync.** Only the audio-stream hash does.

This is the line that prevents the metadata-edit false-positive: a metadata edit changes mt and sz, which causes us to *re-hash*, which produces an unchanged audio-stream hash, which means we **do not** re-upload audio. We update the stored mt/sz to match the new file (so the next check is fast again) and route any changed metadata fields through the existing cheap `metadata-correction` path.

### 5. Subsonic mtime via the HTTP `Last-Modified` header

The Subsonic JSON API does not expose mtime, but Navidrome and Gonic both serve files via Go's `http.ServeContent` / `http.ServeFile`, which sets `Last-Modified` automatically from the file's filesystem mtime. A `HEAD /rest/download?id=…` request retrieves it cheaply. See [ADR-015 §4](adr-015-audio-stream-checksum-sync-tag.md) and `agents/subsonic-api.md` for the full details and caveats (reverse proxies, scanner lag, transcoded streams).

### 6. Opt-in verification via `--check-audio`, baseline population via `--force-sync-tags --check-audio`

`--check-audio` is the verification opt-in. When passed, the sync engine compares stored `aud=` against newly-computed hashes for matched tracks, using the (mt, sz) pre-filter to skip work where possible. Mismatches trigger an `audio-content-changed` upgrade.

Combined with the existing `--force-sync-tags` (which populates sync-tag baselines without re-uploading audio), `--force-sync-tags --check-audio` populates `aud=`/`mt=`/`sz=` for tracks that have no baseline yet. This is the same shape as ADR-012's `--force-sync-tags --check-artwork`.

### 7. `--force-recheck` to bypass the pre-filter

For users worried about bit-rot specifically (where mtime is unchanged but the bytes have flipped), a `--force-recheck` flag bypasses the (mt, sz) optimization and always re-hashes. Use sparingly; expensive.

### 8. Refresh mt/sz on no-op verify

When a `--check-audio` run hashes a file and finds it matches the stored `aud=`, we update the stored `mt=` and `sz=` to the current source values regardless. This way the *next* `--check-audio` skips the expensive path even though the user touched the file (e.g. via a metadata edit that we already routed through `metadata-correction`).

Without this, a one-time tag edit would force re-hashing forever after.

### 9. New upgrade reason: `audio-content-changed`

Operation: file replacement (transcode or copy + update-metadata), same shape as `quality-upgrade`. Preserves play counts, ratings, and playlist membership per ADR-009.

### 10. Optional scoping via the query language (ADR-016)

The query language can scope any sync operation, including `--check-audio`. `podkit sync --check-audio "artist:radiohead"` verifies only Radiohead. The query is decoupled from `--check-audio` — it's an independent positional argument that scopes whatever sync operation is happening.

## Consequences

### Positive

- Corruption fixes, re-encodes, and bit-rot are detectable
- Metadata-edit false positives are eliminated — embedded tag edits do not trigger audio re-uploads
- Works for transcoded tracks: we hash the source's audio stream, not the iPod's transcoded bytes
- Reuses ADR-012's sync-tag mechanism — no new infrastructure
- Per-adapter capabilities degrade gracefully: a track from a low-capability adapter just skips the optimization
- Default sync is unchanged — no regression in cost for users who don't opt in
- Plays cleanly with the query language (ADR-016) for partial verification scans

### Negative

- `--check-audio` is opt-in; users must run it to benefit
- Initial baseline population on Subsonic is slow (one full download per track without an existing `aud=`)
- Adapter contract grows by three optional `CollectionTrack` fields
- A new upgrade reason and a new CLI flag expand the surface area

### Open / Deferred

- **Hash algorithm wording inconsistency.** ADR-012 specifies "SHA-256 truncated to 32 bits" but `packages/podkit-core/src/adapters/interface.ts:81` comments "xxHash truncated to 32 bits." ADR-015 standardises on SHA-256 truncated to 32 bits for both audio and (going forward) artwork; the interface comment will be corrected.
- **Sync-tag length budget.** Total length of `art=… aud=… mt=… sz=…` (~47 chars in pure-hex form) needs to be verified against the iTunesDB field's actual capacity before implementation. Falls back to base36 numeric encoding if tight (`mt=` shrinks to ~7 chars, `sz=` to ~7 chars for sub-78GB files).

## Related Decisions

- [ADR-009](adr-009-self-healing-sync.md): Self-Healing Sync — extends the upgrade-detection mechanism
- [ADR-012](adr-012-artwork-change-detection.md): Artwork Change Detection — parallel content-hashing pattern; same sync-tag storage
- [ADR-015](adr-015-audio-stream-checksum-sync-tag.md): Audio-Stream Checksum Sync Tag — implementation slice
- [ADR-016](adr-016-track-query-language.md): Track Query Language for Scoped Sync — companion slice (independent shipping order)

## References

- `agents/subsonic-api.md` — change-detection signals available per adapter, including the `Last-Modified` finding
- Beets query language — https://beets.readthedocs.io/en/stable/reference/query.html
- FFmpeg `-map 0:a -c copy` (audio-stream extraction) — https://ffmpeg.org/ffmpeg.html#Stream-selection
