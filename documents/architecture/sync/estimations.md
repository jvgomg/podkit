---
title: 'sync: estimations'
description: How podkit predicts plan sizes and times — the per-operation estimators, their typical-bitrate model, the M4A/M4V container overhead, the consumers (free-space gate, UI display, free-space envelope), and the drift sources that mean these are predictions, not measurements.
sidebar:
  order: 22
---

How podkit turns a list of planned operations into "this sync will need
~X MB and take ~Y seconds." Used by the free-space pre-flight to refuse
syncs that won't fit, by the dry-run UI to tell the user what to
expect, and by progress-display heuristics.

These are **predictions**, not measurements. The estimators take cheap
inputs (typical bitrate × duration, with small constants for container
overhead) and produce a number the planner treats as authoritative.
Drift between estimate and actual is documented + handled, not hidden.

Cross-cutting rules (typed errors, no `console.warn` in core,
sink-not-stderr) live in [conventions](../conventions.md). For what
happens when the estimate is wrong and the sync hits ENOSPC, see
[`save-transactions.md`](./save-transactions.md#free-space-contract--execute-time).
For where these estimates are consumed by the free-space gate, see
[`planning.md`](./planning.md#free-space-contract--plan-time).

---

## 1. Map

Two things get estimated per operation: **size in bytes** (used by the
free-space gate) and **time in seconds** (used by the UI). The
estimators are content-type-specific (music vs video) and live next to
each content type's planner:

```
                   handler.estimateSize(op)         handler.estimateTime(op)
                          │                                │
            ┌─────────────┴──────────────┐    ┌───────────┴──────────┐
            ▼                            ▼    ▼                      ▼
  calculateMusicOperationSize  calculateVideoOperationSize  estimateTransferTime
  (sync/music/planner.ts)      (sync/video/planner.ts)      (sync/engine/estimation.ts)
            │                            │                      ▲
            ├─ estimateCopySize          ├─ inline bitrate ×    │ shared by both
            │  ├─ estimateTranscodedSize │  duration math       │ content types
            │  └─ typical bitrate table  │                      │
            └─ estimateTranscodedSize    │                      │
               (audio overload)          │                      │
                                                                │
            estimateTranscodeTime (video transcode) ────────────┘
```

Estimates aggregate at the planner: `SyncPlan.estimatedSize` is the
sum of `handler.estimateSize(op)` across `plan.operations`; the same
shape for `estimatedTime`. The aggregate is what `willFit` and the
dry-run UI consume.

Estimations does **not** own:

- The free-space envelope math itself — that's
  [`planning.md` §2 "Free-space contract — plan-time"](./planning.md#free-space-contract--plan-time).
- The post-sweep recompute (ADR-018) — that's
  [`save-transactions.md` §2 "Free-space contract — execute-time"](./save-transactions.md#free-space-contract--execute-time).
- Per-operation execution — that's
  [`save-transactions.md`](./save-transactions.md).

---

## 2. Primitives

### Shared: `estimateTransferTime(sizeBytes)` → seconds

Located in `sync/engine/estimation.ts`. Single transfer-speed constant
(`USB_TRANSFER_SPEED_BYTES_PER_SEC = 2.5 MB/s`) derived from observed
USB 2.0 iPod throughput. Both content types route through this for
the transfer-time component of every operation that writes a file.

Pipeline execution overlaps transcoding with USB transfer; transfer
is the bottleneck on every supported device. So the estimate is just
size/2.5MBps, not size/(transcode+transfer).

### Music: `calculateMusicOperationSize(operation)` → bytes

Located in `sync/music/planner.ts:385-423`. Dispatches per operation
type:

| Operation                                           | Size formula                                              |
|-----------------------------------------------------|-----------------------------------------------------------|
| `add-transcode` / `upgrade-transcode`               | `estimateTranscodedSize(duration, preset.bitrate)`        |
| `add-direct-copy` / `add-optimized-copy`            | `estimateCopySize(source)`                                |
| `upgrade-direct-copy` / `upgrade-optimized-copy`    | `estimateCopySize(source)`                                |
| `upgrade-artwork` (reason: `'artwork-updated'`)     | `200 * 1024` (flat 200 KiB for artwork only)              |
| `upgrade-artwork` (reason: `'artwork-removed'`)     | `0` (metadata-only)                                       |
| `remove` / `update-metadata` / `update-sync-tag` / `relocate` | `0` (no new bytes consumed) |

`estimatedSize` is **gross, not net.** An `upgrade-*` operation
contributes the full estimated bytes without subtracting the old
file it replaces. A `remove` operation contributes zero rather than
a negative number. Both choices are intentionally conservative — the
goal is to refuse the sync when it can't fit, not to optimise.

### Music: `estimateTranscodedSize(durationMs, bitrateKbps)`

```
audioBytes = (durationMs / 1000) × (bitrateKbps × 1000 / 8)
          = duration_in_seconds × bytes_per_second
return ceil(audioBytes + M4A_CONTAINER_OVERHEAD_BYTES)
```

`M4A_CONTAINER_OVERHEAD_BYTES = 2048` accounts for the M4A moov/ftyp
boxes. The same helper is used for every audio output regardless of
container (mp3, opus, flac) — overhead is a slight overestimate for
non-M4A outputs but never by more than ~2 KiB.

### Music: `estimateCopySize(track)` → bytes — and its typical-bitrate table

For copy operations, the planner doesn't stat the source file or
probe its actual bitrate. It looks up a *typical* bitrate per format
and runs the same formula as `estimateTranscodedSize`:

| Format        | Typical bitrate | Rationale                              |
|---------------|-----------------|----------------------------------------|
| `mp3`         | 256 kbps        | High-quality MP3 mid-point             |
| `m4a` / `aac` | 256 kbps        | iTunes-quality AAC default             |
| `alac`        | 900 kbps        | ALAC at CD quality                     |
| `flac`        | 900 kbps        | FLAC at CD quality                     |
| `ogg` / `opus`| 192 kbps        | Opus / Vorbis sweet spot               |
| `wav` / `aiff`| 1411 kbps       | 16-bit/44.1 kHz uncompressed stereo    |

If `track.duration` is missing, falls back to
`estimateTranscodedSize(240_000, 256)` — a 4-minute 256 kbps
estimate (~7.5 MiB).

This typical-bitrate model is the **largest drift source** in the
estimator surface. A 320 kbps mp3 estimated at 256 kbps
underestimates by 25%. TASK-412's `enospc-estimate-drift` cell
exercises this gap concretely — see §6.

### Video: `calculateVideoOperationSize(operation)` → bytes

Located in `sync/video/planner.ts:80-113`. Inlines the bitrate ×
duration math per operation type:

| Operation              | Size formula                                                    |
|------------------------|-----------------------------------------------------------------|
| `video-transcode`      | `(duration × (targetVideoBitrate + targetAudioBitrate)) × 1000 / 8` |
| `video-copy`           | `duration × 2_000_000 / 8` (~2 Mbps typical-bitrate estimate)   |
| `video-upgrade`        | Same as transcode if `settings` present, else as copy           |
| `video-remove` / `video-update-metadata` | `0`                                            |

`duration` defaults to 3600 seconds (1 hour) if missing.

**Inconsistency** with the music side: the video `calculateVideoOperationSize`
does NOT add container overhead. The dedicated helpers
`estimateTranscodedSize` (video) and `estimatePassthroughSize` exist
in the same file and DO add `M4V_CONTAINER_OVERHEAD_BYTES = 4096`,
but `calculateVideoOperationSize` doesn't call them. Drift between
helper and consumer; see §6.

### Video: `calculateVideoOperationTime(operation)` → seconds

For transcode + upgrade-with-settings: `max(transcodeTime, transferTime)`
because the pipeline overlaps them. `transcodeTime` is
`duration / TRANSCODE_SPEED_FACTOR_HARDWARE (25×)` assuming Apple
Silicon VideoToolbox is available; falls back to `5×` for software
(x264). Copy + passthrough-upgrade use transfer-time only. Remove +
update-metadata return 0.1 seconds (effectively instant).

---

## 3. Responsibility boundaries

| Owner | Responsibility |
|---|---|
| `calculateMusicOperationSize` / `calculateVideoOperationSize` | Per-operation byte estimate. Stateless, deterministic. Don't read the filesystem. |
| `estimateCopySize` (music only) | Format → typical-bitrate lookup + delegation to `estimateTranscodedSize`. |
| `estimateTranscodedSize` (music) | Single source of truth for `audioBytes + container overhead` math. |
| `estimateTransferTime` (shared) | Size → time conversion via fixed USB throughput constant. |
| `handler.estimateSize(op)` / `handler.estimateTime(op)` | Per-handler facade — delegates to the appropriate calculator. |
| `SyncPlanner.plan()` | Aggregates per-operation estimates into `plan.estimatedSize` + `plan.estimatedTime`. |
| `genericSyncCollection` (CLI) | Consumes the aggregate to gate via `willFit` + render in the dry-run UI. |

Two invariants the layout enforces:

- **No filesystem access at estimate time.** Every estimator works
  from `track.duration` + format/preset, not from `stat`. This keeps
  planning cheap even for large libraries and prevents network-mount
  latency from blocking the planner.
- **Pessimistic, not pessimal.** Estimates skew slightly high
  (container overhead always added, gross-not-net for upgrades) so
  the free-space gate refuses borderline syncs. Wildly-wrong (10×+)
  drift is treated as a bug; see §6.

---

## 4. Conventions for new contributors

1. **Adding a new source format** means three edits:
   - `AudioFileType` union in `types.ts`.
   - `EXTENSION_TO_TYPE` map in `adapters/directory.ts`.
   - **`estimateCopySize` typical-bitrate table** in
     `sync/music/planner.ts`. Use a conservative midpoint for the
     format; biased slightly high beats biased slightly low (see §3
     invariant).

2. **Adding a new transcode target codec** means adding it to
   `CODEC_METADATA` (`transcode/codecs.ts`). The estimator side is
   automatic: `add-transcode` uses `operation.preset.bitrate` directly,
   so any new preset's bitrate flows through `estimateTranscodedSize`
   without further edits.

3. **Don't stat the source file from inside an estimator.** The
   no-filesystem-access invariant from §3 is load-bearing for planning
   performance. If actual source size is needed (estimate-drift
   mitigation, etc.), do the stat ONCE in the adapter at scan time
   and stash the result on `CollectionTrack`; the estimator then
   reads the stashed bytes.

4. **Don't change the typical-bitrate table without measuring.**
   The table is a 5-year-old set of guesses that has held up in
   practice. Real source-bitrate distributions vary by library; if
   you can measure your library, you can tune. Otherwise, leave it.

5. **Container overhead is shared between music + video despite the
   constant names.** `M4A_CONTAINER_OVERHEAD_BYTES = 2048` and
   `M4V_CONTAINER_OVERHEAD_BYTES = 4096` are tiny by design — they
   don't matter for sub-100KiB tracks, dwarfed by audio bytes for
   normal tracks. Don't tune them.

---

## 5. Scope boundaries

- **Free-space envelope math** — not here; see
  [`planning.md` §2 "Free-space contract — plan-time"](./planning.md#free-space-contract--plan-time)
  for `willFit`, `effectiveFreeSpace`, and the
  `debrisCleanup.totalBytes` envelope addition.
- **Mid-sync ENOSPC handling** — not here; see
  [`save-transactions.md` §2 "Free-space contract — execute-time"](./save-transactions.md#free-space-contract--execute-time)
  for per-track typed errors and the ADR-018 post-sweep recompute.
- **Transcoder progress reporting** — that's the FFmpeg progress
  parser in `transcode/ffmpeg.ts`. Estimations doesn't drive the
  progress bar; that's measured, not estimated.
- **Artwork bytes** — `upgrade-artwork (artwork-updated)` is the
  only operation that adds artwork-only bytes (flat 200 KiB
  estimate). Track-add operations bake artwork into the audio file
  body or the `cover.jpg` sidecar; those bytes are counted in the
  audio/sidecar write, not separately.
- **ipod-firmware-controlled storage overhead** — iPod database
  files (`iTunesDB`, `ArtworkDB`), playlist files, etc. take some
  bytes that aren't in any per-operation estimate. Currently absorbed
  into the conservative-overestimate bias from §3 invariant 2. If it
  ever bites, a separate `SyncPlan.metadataOverheadBytes` field would
  be the place to add it.

---

## 6. Open work

- **Estimate-drift mitigation (TASK-378 follow-up, not yet filed).**
  `estimateCopySize`'s typical-bitrate table can drift ~25% from
  reality for unusual sources (320 kbps mp3 estimated at 256, etc.).
  TASK-412's `enospc-estimate-drift` matrix cell pins the gap
  concretely. Two paths to close it:
  - (a) Stat source files at scan time and stash actual bytes on
    `CollectionTrack`; estimator reads stashed bytes for `*-direct-copy`
    operations. Closes the gap for direct-copy; doesn't help
    transcode (target file doesn't exist yet).
  - (b) Probe the source's actual bitrate via a quick header read
    (1-2 KiB) at scan time; pass to `estimateCopySize` instead of
    the typical-bitrate table. More accurate but adds I/O per
    source file at scan.

  Worth filing as a separate task once the trade-offs are decided.

- **Video estimator helper-vs-consumer drift.**
  `calculateVideoOperationSize` (the consumer used by
  `VideoHandler.estimateSize`) inlines the bitrate × duration math
  and does NOT call `estimateTranscodedSize` or
  `estimatePassthroughSize` (the dedicated helpers in the same
  file). The helpers add `M4V_CONTAINER_OVERHEAD_BYTES = 4096` but
  the consumer doesn't. Drift is small (~4 KiB per video, dwarfed
  by video bytes) but the inconsistency is a footgun. Either route
  the consumer through the helpers, or delete the unused helpers.

- **No actual-bitrate probe for Subsonic sources.** Subsonic tracks
  carry `bitRate` in the song response (kbps reported by the
  server). `estimateCopySize` currently ignores it and uses the
  typical-bitrate table. Small fix: prefer `track.bitRate` when
  present.

---

## 7. References

- **Code:**
  - `packages/podkit-core/src/sync/engine/estimation.ts` —
    `estimateTransferTime` + `USB_TRANSFER_SPEED_BYTES_PER_SEC`.
  - `packages/podkit-core/src/sync/music/planner.ts:265-423` —
    `estimateTranscodedSize`, `estimateCopySize`,
    `calculateMusicOperationSize`, the typical-bitrate table.
  - `packages/podkit-core/src/sync/music/handler.ts:841-851` —
    `MusicHandler.estimateSize` / `estimateTime` facades.
  - `packages/podkit-core/src/sync/video/planner.ts` —
    `calculateVideoOperationSize` / `calculateVideoOperationTime`
    plus the unused `estimateTranscodedSize` /
    `estimatePassthroughSize` helpers.
  - `packages/podkit-core/src/sync/video/handler.ts:367-373` —
    `VideoHandler.estimateSize` / `estimateTime` facades.
  - `packages/podkit-core/src/sync/engine/planner.ts:139-146` —
    where the aggregate `plan.estimatedSize` + `plan.estimatedTime`
    are summed.
- **Companion architecture docs:**
  - [`planning.md`](./planning.md) — where these estimates are
    consumed by the free-space gate.
  - [`save-transactions.md`](./save-transactions.md) — what happens
    when the estimate is wrong and ENOSPC fires.
- **Companion journals:**
  - `backlog/docs/doc-041` — save-transaction rough-edges (still
    active for parts of the free-space surface in flux).
- **Related decisions:**
  - [ADR-018](../../../adr/adr-018-free-space-pre-flight-strategy.md)
    — the post-sweep recompute that handles estimate drift on the
    execute side.
