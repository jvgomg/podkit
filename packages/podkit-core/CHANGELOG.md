# @podkit/core

## 0.7.0

### Minor Changes

- [#58](https://github.com/jvgomg/podkit/pull/58) [`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c) Thanks [@jvgomg](https://github.com/jvgomg)! - Add capability-gated clean artists transform

  Devices now declare whether they use Album Artist for browse navigation via `supportsAlbumArtistBrowsing`. When enabled globally, the `cleanArtists` transform is automatically suppressed on devices that support Album Artist browsing (Rockbox, Echo Mini, generic) and auto-applied on devices that don't (iPod). Per-device overrides still take priority.

  The dry-run summary shows when the transform is skipped (`Clean artists: skipped (device supports Album Artist browsing)`), and warns when it's force-enabled on a capable device. Both `sync --dry-run` and `device info` surface these in text and JSON output.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix mass-storage directory structure to use album artist instead of track artist, and add template-based path system with self-healing relocate.

  **Bug fix:** Mass-storage devices (Echo Mini, Rockbox) now use `albumArtist` for directory grouping, falling back to `artist` when absent. Previously, compilation/various-artist albums had their tracks scattered across separate artist directories instead of being grouped together under the album artist.

  **Path templates:** File paths are now generated from a configurable template string (`{albumArtist}/{album}/{trackNumber} - {title}{ext}` by default). This lays the groundwork for user-customisable folder structures in a future release.

  **Self-healing relocate:** When source metadata changes (e.g. album artist corrected) or the path template changes, the next sync detects the path mismatch and moves files to their correct location via `fs.rename()` — no re-copying of audio data. Relocate operations appear in dry-run output and are tracked as a new `relocate` operation type.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`89ff40c`](https://github.com/jvgomg/podkit/commit/89ff40c2adedd9fec38ae5ad0eb89b75525642f2) Thanks [@jvgomg](https://github.com/jvgomg)! - Add audioNormalization device capability for device-appropriate Sound Check / ReplayGain handling

  Devices now declare their normalization support: 'soundcheck' (iPod), 'replaygain' (Rockbox), or 'none' (Echo Mini, generic). Devices with no normalization support skip soundcheck upgrade detection entirely, and the dry-run output hides or relabels the normalization line accordingly. Configurable via `audioNormalization` in device config.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`c5c0236`](https://github.com/jvgomg/podkit/commit/c5c0236c232cc3fa086fd3937b0e2fbe0f326185) Thanks [@jvgomg](https://github.com/jvgomg)! - Refactor audio normalization from iPod-centric Sound Check to a generic `AudioNormalization` type, and add ReplayGain album gain/peak support

  **Normalization refactoring:**
  - Introduce `AudioNormalization` type that preserves source format fidelity (ReplayGain dB, iTunNORM soundcheck integers) without unnecessary round-trip conversions
  - Replace scattered `soundcheck`, `soundcheckSource`, `replayGainTrackGain`, `replayGainTrackPeak` fields on `CollectionTrack` with a single `normalization` field
  - Replace `soundcheck`, `replayGainTrackGain`, `replayGainTrackPeak` fields on `DeviceTrackInput` with `normalization`
  - Conversions now happen at device boundaries: iPod adapter reads soundcheck integers, mass-storage adapter reads dB values directly
  - Upgrade detection compares in dB space with 0.1 dB epsilon tolerance, eliminating false positives from integer rounding
  - Metadata update diffs show human-readable dB values (e.g., `normalization: -7.5 dB → -6.2 dB`) instead of opaque integers

  **Album gain/peak support (TASK-253):**
  - Extract `albumGain` and `albumPeak` from local file metadata and Subsonic API
  - Write `REPLAYGAIN_ALBUM_GAIN` and `REPLAYGAIN_ALBUM_PEAK` via FFmpeg metadata flags during transcode
  - Write album gain/peak via node-taglib-sharp tag writer for M4A files
  - Thread album data through the full sync pipeline for mass-storage devices (Rockbox, etc.)

  **Breaking changes:**
  - `CollectionTrack` shape: four normalization fields replaced by single `normalization?: AudioNormalization`
  - `SoundCheckSource` type removed, replaced by `NormalizationSource`
  - Upgrade reason `'soundcheck-update'` renamed to `'normalization-update'` in JSON output
  - `soundCheckTracks` stat renamed to `normalizedTracks`

- [#58](https://github.com/jvgomg/podkit/pull/58) [`513173d`](https://github.com/jvgomg/podkit/commit/513173d1832bf9ca2894214e97d9d65cf02c52a5) Thanks [@jvgomg](https://github.com/jvgomg)! - Add configurable codec preference system for multi-device audio format support

  Users can now configure an ordered list of preferred audio codecs globally and per-device. The system walks the list top-to-bottom, selecting the first codec that is both supported by the target device and has an available FFmpeg encoder. This replaces the hardcoded AAC-only transcoding pipeline.
  - **Default lossy stack:** opus → aac → mp3 (Rockbox devices get Opus automatically, iPods fall through to AAC)
  - **Default lossless stack:** source → flac → alac (lossless files are kept in their original format when possible)
  - **Quality presets are codec-aware:** "high" delivers perceptually equivalent quality regardless of codec (e.g., Opus 160 kbps ≈ AAC 256 kbps)
  - **Codec change detection:** changing your codec preference re-transcodes affected tracks on the next sync
  - **`podkit device info`** shows your codec preference list with supported/unsupported codecs marked
  - **`podkit sync --dry-run`** shows which codec will be used and any codec changes
  - **`podkit doctor`** warns when FFmpeg is missing an encoder for a preferred codec

  Configure via `config.toml`:

  ```toml
  [codec]
  lossy = ["opus", "aac", "mp3"]
  lossless = ["source", "flac", "alac"]

  [devices.myipod.codec]
  lossy = "aac"
  ```

  No configuration is required — existing setups work unchanged with sensible defaults.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device-aware diagnostics framework to `podkit doctor`. The doctor command now handles mass-storage devices gracefully instead of crashing when pointed at a non-iPod device. Diagnostic checks declare which device types they apply to, and the runner filters them automatically. JSON output now includes a `deviceType` field.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device readiness diagnostic system
  - New 6-stage readiness pipeline (USB → Partition → Filesystem → Mount → SysInfo → Database) that checks every stage of device health
  - OS error code interpreter translates errno values into actionable explanations
  - USB discovery finds iPods even without disk representation (unpartitioned/uninitialized devices)
  - Enhanced SysInfo validation detects missing, corrupt, or unrecognized model files
  - Diagnostics framework now handles missing database gracefully (checks skip instead of crashing)

- [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit doctor --repair artwork-reset` to clear all artwork from an iPod without needing a source collection. This is a fast alternative to a full rebuild — useful when your source collection isn't available or you just want to clear corrupted artwork quickly.

  Rename `--repair artwork-integrity` to `--repair artwork-rebuild` to better describe what the repair does. The old name no longer works.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`94c85d2`](https://github.com/jvgomg/podkit/commit/94c85d2a9d6c85875432a0ebecab540a9ebd67d7) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `--delete` to only remove managed files on mass-storage devices, and add orphan file detection via `podkit doctor`.

  **Bug fix:** `--delete` previously removed all unmatched files on mass-storage devices, including user-placed files. It now only removes files that podkit manages (tracked in `.podkit/state.json`), matching iPod behavior where only database tracks are candidates for deletion.

  **Collision detection:** Sync now detects when a planned file write would collide with an existing unmanaged file and reports the conflict before writing. Works in both normal sync and `--dry-run` mode.

  **New diagnostic check:** `podkit doctor` now runs health checks on mass-storage devices. The `orphan-files-mass-storage` check detects unmanaged files in content directories and can clean them up via `podkit doctor --repair orphan-files-mass-storage`.

  **Other improvements:**
  - State manifest (`.podkit/state.json`) is now written without pretty-printing to reduce file size on device storage
  - Shell completions now include valid repair IDs for the `--repair` option

- [#58](https://github.com/jvgomg/podkit/pull/58) [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d) Thanks [@jvgomg](https://github.com/jvgomg)! - Add mass-storage device support for non-iPod portable music players.

  **Supported device types:** Echo Mini, Rockbox, and generic mass-storage DAPs. iPod support is unchanged.

  **New in CLI (`podkit`):**
  - `podkit device add --type <type>` registers mass-storage devices by type and mount path
  - `podkit device info/music/video` work with mass-storage devices via `DeviceAdapter` interface
  - `podkit device scan` shows configured path-based devices alongside auto-detected iPods
  - `podkit sync` routes to the correct adapter (iPod or mass-storage) based on device config
  - Video sync now uses capabilities-based gating instead of iPod-only checks
  - Safety gates on `device init/reset/clear` (iPod-only commands) for mass-storage devices
  - Mount and eject commands show device-appropriate messaging
  - Config validation rejects capability overrides on iPod devices (capabilities are auto-detected from generation)
  - Shared `openDevice()` function eliminates duplicated device-opening logic across commands

  **New in core (`@podkit/core`):**
  - `DeviceAdapter` interface — generic abstraction over device databases (iPod, mass-storage)
  - `MassStorageAdapter` — filesystem-based track management with `.podkit/state.json` manifest
  - `IpodDeviceAdapter` — thin wrapper making `IpodDatabase` implement `DeviceAdapter`
  - Device capability presets for Echo Mini, Rockbox, and generic devices
  - `resolveDeviceCapabilities()` merges preset defaults with user config overrides
  - `DeviceTrack` type used throughout sync engine (replaces `IPodTrack` casts in execution paths)
  - Configurable content path prefixes (`musicDir`, `moviesDir`, `tvShowsDir`) with device-type defaults
  - Device presets include default content paths (Echo Mini: root for music; generic/Rockbox: `Music/`, `Video/Movies/`, `Video/Shows/`)
  - Manifest v2 stores active content paths; files automatically moved when prefixes change
  - Root path support (`/`, `.`, or empty string all normalize to device root)
  - Content path duplicate validation (no two content types can share the same prefix)
  - Video scanning support for mass-storage devices (.m4v, .mp4, .mov, .avi, .mkv)

  **New in daemon (`@podkit/daemon`):**
  - Mass-storage device polling via `PODKIT_MASS_STORAGE_PATHS` env var (colon/comma separated)
  - Second `DevicePoller` + `SyncOrchestrator` pair for mass-storage devices
  - No-op mount/eject runners (mass-storage devices are externally managed)
  - Graceful shutdown handles both iPod and mass-storage sync pipelines

  **Configuration:**

  ```toml
  [devices.echo]
  type = "echo-mini"
  path = "/Volumes/ECHO"

  # Optional capability overrides (mass-storage only)
  artworkMaxResolution = 800
  supportedAudioCodecs = ["aac", "mp3", "flac"]

  # Optional content path overrides (mass-storage only)
  musicDir = "/"           # Place music at device root
  moviesDir = "Films"      # Custom movies directory
  tvShowsDir = "TV Shows"  # Custom TV shows directory
  ```

  **Environment variables for content paths:**
  - `PODKIT_MUSIC_DIR` — global default music directory
  - `PODKIT_MOVIES_DIR` — global default movies directory
  - `PODKIT_TV_SHOWS_DIR` — global default TV shows directory

- [#58](https://github.com/jvgomg/podkit/pull/58) [`208e482`](https://github.com/jvgomg/podkit/commit/208e482db9730064a25e53e03121bdcfcbea6341) Thanks [@jvgomg](https://github.com/jvgomg)! - Embed artwork in OGG/Opus files for mass-storage devices with `artworkSources: ['embedded']`.

  FFmpeg's OGG muxer cannot write image streams (upstream tickets [#4448](https://github.com/jvgomg/podkit/issues/4448), [#9044](https://github.com/jvgomg/podkit/issues/9044), open since 2015), so OGG output was previously stripped of artwork with `-vn`. Mass-storage devices relying on embedded artwork showed no cover art for Opus tracks.

  **What changed:**
  - After FFmpeg produces an OGG file (with artwork stripped), the pipeline post-processes it via node-taglib-sharp to embed artwork as a `METADATA_BLOCK_PICTURE` Vorbis comment
  - Artwork is resized to the device's `artworkMaxResolution` before embedding, matching the behavior of other formats where FFmpeg handles resize during transcode
  - Resize results are cached per-album to avoid redundant FFmpeg image-processing spawns
  - New `TagWriter.writePicture()` method and `resizeArtwork()` utility
  - Pending picture writes follow the same deferred flush pattern as comment and ReplayGain tag writes (queued by `updateTrack`, flushed by `save()`)

- [#58](https://github.com/jvgomg/podkit/pull/58) [`bb96778`](https://github.com/jvgomg/podkit/commit/bb96778dde9063267188b2b83535ec279cd5c550) Thanks [@jvgomg](https://github.com/jvgomg)! - Write ReplayGain tags to transcoded files for mass-storage devices with `audioNormalization: 'replaygain'` (e.g., Rockbox).

  Previously, ReplayGain data was only stored as iPod soundcheck values in the iTunes database. Mass-storage devices read volume normalization from file tags, but FLAC→AAC transcoding strips ReplayGain metadata. Tracks on Rockbox devices played without normalization.

  **What changed:**
  - ReplayGain tags (`REPLAYGAIN_TRACK_GAIN`, `REPLAYGAIN_TRACK_PEAK`) are injected via FFmpeg `-metadata` flags during transcoding for MP3, FLAC, and OGG/Opus output
  - M4A files (where FFmpeg can't write ReplayGain metadata) get tags written via node-taglib-sharp after transfer
  - Raw ReplayGain dB/peak values are preserved from collection sources (Subsonic API, local files) through the sync pipeline, avoiding precision loss from soundcheck integer conversion
  - Device scan reads ReplayGain from file tags so the sync engine can detect when normalization data changes and needs updating
  - Direct-copy operations skip tag writing since source files already have correct tags
  - `soundcheckToReplayGainDb()` reverse conversion function added for back-converting when raw values aren't available

  **Bug fix:** `IpodTrackImpl` used `data.soundcheck || undefined` which coerced a valid soundcheck of `0` to `undefined`. Changed to `data.soundcheck ?? undefined`.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd) Thanks [@jvgomg](https://github.com/jvgomg)! - Refactor sync engine to be fully content-type-agnostic with per-handler operation types.

  **Breaking:** `createMusicHandler()` and `createVideoHandler()` now take a config object at construction instead of using `setTransformsConfig()`/`setExecutionConfig()`. Removed `HandlerDiffOptions`, `HandlerPlanOptions`, `MusicExecutionConfig` types. Renamed `MusicExecutor` to `MusicPipeline`. Removed legacy planner functions (`createMusicPlan`, `planVideoSync` and related helpers).

  **New:** `MusicSyncConfig`, `VideoSyncConfig`, `MusicTrackClassifier`, `VideoTrackClassifier`, `MusicOperationFactory`, `MusicOperation`, `VideoOperation`, `BaseOperation` types. Handlers now own their operation types via `TOp` type parameter on `ContentTypeHandler`.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`c9c268e`](https://github.com/jvgomg/podkit/commit/c9c268ea4b25b39543e5c53a1928e72b4c31e0c8) Thanks [@jvgomg](https://github.com/jvgomg)! - Internalize raw sync tag functions (`parseSyncTag`, `formatSyncTag`, `writeSyncTag`) from the public API. Sync tag reads now use the typed `DeviceTrack.syncTag` field, and writes use `DeviceAdapter.writeSyncTag()` or the new `update-sync-tag` operation type. Adds `SyncTagUpdate` type and `syncTagsEqual` to the public API.

- [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df) Thanks [@jvgomg](https://github.com/jvgomg)! - Add three-tier transfer mode system controlling how files are prepared for the device.

  **Transfer modes:**
  - `fast` (default): optimizes for sync speed — direct-copies compatible files, strips artwork from transcodes
  - `optimized`: strips embedded artwork from all file types (including MP3, M4A, ALAC copies) via FFmpeg stream-copy, reducing storage usage without re-encoding
  - `portable`: preserves embedded artwork in all files for use outside the iPod ecosystem

  **Configuration:**
  - `transferMode` config option (global and per-device)
  - `--transfer-mode` CLI flag
  - `PODKIT_TRANSFER_MODE` environment variable

  **Selective re-processing:**
  - `--force-transfer-mode` flag re-processes only tracks whose transfer mode doesn't match the current setting
  - `PODKIT_FORCE_TRANSFER_MODE` environment variable
  - Works on all file types including direct copies (unlike `--force-transcode` which only affects transcoded tracks)

  **Device inspection:**
  - `podkit device music` and `podkit device video` stats show transfer mode distribution
  - Missing transfer field flagged alongside missing artwork hash in sync tag summary
  - New `syncTagTransfer` field available in `--tracks --fields` for querying transfer mode data
  - Dry-run output shows configured transfer mode

  **Under the hood:**
  - Granular operation types: `add-direct-copy`, `add-optimized-copy`, `add-transcode` (and upgrade equivalents)
  - Sync tags written to all tracks including direct copies (`quality=copy`)
  - `DeviceCapabilities` abstraction for device-aware sync decisions
  - Sync tag field `transfer=` tracks which mode was used per track

### Patch Changes

- [#58](https://github.com/jvgomg/podkit/pull/58) [`3db3d88`](https://github.com/jvgomg/podkit/commit/3db3d887ae2cd19d01ba2c1f00b8682e783fac84) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix multiple bugs discovered during end-to-end Echo Mini hardware validation

  **Sync pipeline:**
  - Create temp directory for optimized-copy operations (not just transcodes), fixing "No such file or directory" FFmpeg failures on mass-storage devices
  - Capture last 1000 chars of FFmpeg stderr (instead of first 500) so actual errors aren't swallowed by the version banner

  **Device preset content paths:**
  - Pass device preset content paths to adapter even when no user overrides exist, fixing Echo Mini's `musicDir: ''` being ignored and files landing in `Music/` instead of device root

  **Artwork:**
  - Read embedded artwork during mass-storage device scan (`skipCovers: false`) so artwork presence is correctly detected, preventing false `artwork-added` upgrades on every sync
  - Force `yuvj420p` (4:2:0) pixel format in artwork scale filter — JPEG with 4:4:4 chroma subsampling does not display on the Echo Mini

  **Sync tag and preset detection:**
  - Treat `quality=copy` sync tags as in-sync when the classifier would also route the source as a copy, preventing false preset-upgrade detection on FLAC-capable mass-storage devices
  - Route lossless sources to transcode (not copy) when quality preset is non-lossless, even if the device natively supports the source codec (e.g., FLAC device with quality=high should produce AAC)

- [#58](https://github.com/jvgomg/podkit/pull/58) [`7ebb7c5`](https://github.com/jvgomg/podkit/commit/7ebb7c5c0e1c7c3d549196347029d9ce660fcb8b) Thanks [@jvgomg](https://github.com/jvgomg)! - Use configurable device label in eject messages instead of hardcoded 'iPod'

## 0.6.0

### Minor Changes

- [`d19d6e3`](https://github.com/jvgomg/podkit/commit/d19d6e305cd864d188f3de377873b5a44df7e02f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit doctor` command for running diagnostic checks on an iPod, and `podkit device reset-artwork` for wiping artwork and clearing sync tags. `podkit doctor` runs all checks and reports problems; `podkit doctor --repair artwork-integrity -c <collection>` repairs by check ID using the source collection. @podkit/core exports `resetArtworkDatabase` and `rebuildArtworkDatabase` primitives, and a diagnostic framework in the `diagnostics/` module built on a `DiagnosticCheck` interface (check + repair pattern). Includes a binary ArtworkDB parser and integrity checker.

- [`2873f14`](https://github.com/jvgomg/podkit/commit/2873f14aad6493d2d7dafbe344e8b5db0abc3551) Thanks [@jvgomg](https://github.com/jvgomg)! - Add graceful shutdown handling for sync and doctor commands

  Pressing Ctrl+C during `podkit sync` now triggers a graceful shutdown: the current operation finishes, all completed tracks are saved to the iPod database, and the process exits cleanly with code 130. Previously, Ctrl+C killed the process immediately, potentially leaving orphaned files and unsaved work.
  - Sync: first Ctrl+C drains the current operation and saves; second Ctrl+C force-quits
  - Doctor: repair operations save partial progress on interrupt
  - Incremental saves: the database is now saved every 50 completed tracks during sync, reducing data loss from force-quits or crashes
  - New `podkit doctor` check: detects orphaned files on the iPod (files not referenced by the database) with optional cleanup via `--repair orphan-files`

- [`66560a9`](https://github.com/jvgomg/podkit/commit/66560a9158c777f2f25ca24c047204afa78f187e) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify sync pipeline: CLI presenter pattern, naming symmetry, tests, and cleanup (TASK-186)
  - Add ContentTypePresenter pattern for content-type-agnostic CLI sync orchestration
  - Rename music-specific symbols with Music prefix (computeDiff→computeMusicDiff, DefaultSyncExecutor→MusicExecutor, etc.)
  - Rename generic pipeline from Unified prefix to Sync prefix (UnifiedDiffer→SyncDiffer, UnifiedPlanner→SyncPlanner, UnifiedExecutor→SyncExecutor)
  - Remove unused handler registry (registerHandler, getHandler, getAllHandlers, clearHandlers)
  - Remove dead video pipeline code (PlaceholderVideoSyncExecutor, createVideoExecutor)
  - Fix TranscodeProgress.speed type inconsistency (string→number)
  - Add 'space-constraint' to SyncWarningType union
  - Add completedCount to ExecutorProgress
  - Add 47 new tests for VideoHandler, MusicHandler, and SyncExecutor
  - All old symbol names preserved as backward-compatible aliases

- [`7624265`](https://github.com/jvgomg/podkit/commit/762426537af1d3d7b29c6d6e1f878abd5c0474eb) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify sync pipeline with ContentTypeHandler pattern
  - Add generic `ContentTypeHandler<TSource, TDevice>` interface for media-type-specific sync logic
  - Add `MusicHandler` and `VideoHandler` implementations
  - Add `UnifiedDiffer`, `UnifiedPlanner`, and `UnifiedExecutor` generic pipeline components
  - Add shared error categorization and retry logic (`error-handling.ts`)
  - Add handler registry for looking up handlers by type string
  - Video sync now routes through the unified pipeline in the CLI
  - Video executor supports self-healing upgrades (preset-change, metadata-correction)
  - Video executor categorizes errors and supports configurable per-category retries
  - Fix album artwork cache incorrectly sharing artwork between tracks with and without artwork
  - Generic `CollectionAdapter<TItem, TFilter>` interface replaces separate music/video adapter contracts

### Patch Changes

- [`8e11397`](https://github.com/jvgomg/podkit/commit/8e11397501861930cf0827913003f8afe2afd943) Thanks [@jvgomg](https://github.com/jvgomg)! - Add album-level artwork cache to sync executor, reducing redundant artwork extractions by ~10x (one extraction per album instead of per track). The cache is shared with the doctor repair routine via a new `AlbumArtworkCache` abstraction.

- [`8fdf618`](https://github.com/jvgomg/podkit/commit/8fdf618d95f3fad88f3738baf03dbda313a5a2d5) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix infinite metadata update loop when source collection contains duplicate tracks

  When a source collection had multiple entries with the same (artist, title, album) but different track numbers, each duplicate would generate a separate metadata-correction operation against the same iPod track. After applying one update, the next sync would see the other duplicate's metadata as a diff — causing an endless update cycle.

  The diff engine now skips duplicate source tracks that match an already-claimed iPod track. The first source entry wins; subsequent duplicates are ignored.

- [`3f56a1b`](https://github.com/jvgomg/podkit/commit/3f56a1b063f821e7a0d399a497521358331577a6) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix video sync deleting and re-adding episodes with episode number 0 (e.g., S01E00)

  The `||` operator treated episode/season number `0` as falsy, converting it to `undefined`. This broke diff key matching for episode 0, causing every sync to delete and re-add the video. Changed to `??` (nullish coalescing) which only converts `null`/`undefined`, preserving `0` as a valid value.

- [`120a7b1`](https://github.com/jvgomg/podkit/commit/120a7b1a8899ed48515bd98ce731231e94d3409f) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix track removal leaving orphan files on iPod. When removing tracks during sync (both music and video), the audio/video file was deleted from the iPod database but left on disk, accumulating orphan files over time. `track.remove()` now deletes the file by default. Pass `{ keepFile: true }` to preserve the file on disk.

- [`143e314`](https://github.com/jvgomg/podkit/commit/143e31442a40489390d45d74ee953facdc243706) Thanks [@jvgomg](https://github.com/jvgomg)! - Fully detach USB device on eject so iPod disappears from Disk Utility (macOS) and system (Linux/Docker)

  Previously, eject only unmounted the volume but left the physical disk device attached. On macOS, the iPod would still appear in Disk Utility after ejecting. On Linux, the USB device could remain visible.

  Now eject resolves the whole-disk identifier and fully detaches the USB device:
  - macOS: `diskutil eject` targets the whole disk (e.g., `disk5`) instead of the volume
  - Linux: `udisksctl power-off` targets the whole disk (e.g., `/dev/sda`) and is also called after the `umount` fallback path

- [`632f360`](https://github.com/jvgomg/podkit/commit/632f3605370dbb50b0be5ffada0460f1aa9792d7) Thanks [@jvgomg](https://github.com/jvgomg)! - Add incremental database saves during video sync, saving every 10 completed transfers by default. Reduces data loss if the process is interrupted during a large video sync.

## 0.5.1

### Patch Changes

- [`2e7ba81`](https://github.com/jvgomg/podkit/commit/2e7ba81085166b47ab08d07bb739f04d3d9e46d1) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix iPod detection on Synology NAS and NVMe-based systems where block device names use non-standard partition suffixes

- [`e1b0fbc`](https://github.com/jvgomg/podkit/commit/e1b0fbc679dca9516011a211adad255b9deb140f) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix Subsonic connection failures hanging indefinitely instead of failing with a clear error message

## 0.5.0

### Minor Changes

- [`0019607`](https://github.com/jvgomg/podkit/commit/00196072d68bdbf8a7dabb64fb53dc968aebfdbb) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `--force-metadata` flag to rewrite metadata on all synced tracks without re-transcoding or re-transferring files

### Patch Changes

- [`8dddd29`](https://github.com/jvgomg/podkit/commit/8dddd2945071f3aac3c018cc05138ef51386529c) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve iPod eject reliability with automatic retry and filesystem sync
  - Use `diskutil eject` instead of `diskutil unmount` on macOS for proper removable-media handling (unmounts + detaches the disk)
  - Flush filesystem buffers before ejecting to ensure all writes are persisted
  - Automatically retry eject up to 3 times when the device is temporarily busy (common on macOS when Finder/Spotlight holds a reference)
  - Show progress output during retry so you know what's happening
  - On Linux, return busy errors from udisksctl immediately so the retry wrapper can handle them instead of silently falling through

## 0.4.0

### Minor Changes

- [#38](https://github.com/jvgomg/podkit/pull/38) [`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add Linux device manager support for mount, eject, and device detection. podkit now supports `podkit mount`, `podkit eject`, and `podkit device add` on Debian, Ubuntu, Alpine, and other Linux distributions. Uses `lsblk` for device enumeration, `udisksctl` for unprivileged mount/eject (with fallback to `mount`/`umount`), and USB identity from `/sys` for iPod auto-detection. iFlash adapter detection works on Linux via block size and capacity signals.

- [#38](https://github.com/jvgomg/podkit/pull/38) [`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve video filename parsing and add show language transform for video sync

  **Filename parsing improvements:**
  - Add anime fansub filename pattern support (`[Group]_Show_Name_EP_(codec)_[CRC].ext`)
  - Prefer folder-based series titles over filename-only parsing for richer metadata
  - Strip scene release cruft (quality tags, codecs, release groups) from episode titles
  - Detect language and edition tags from filenames and folder paths
  - Add `language` and `edition` optional fields to `CollectionVideo`

  **Show language transform:**
  - Add configurable `showLanguage` transform that reformats language markers in video series titles (e.g., `(JPN)` → `(Japanese)`)
  - Enabled by default with abbreviated format — configure via config file, per-device overrides, or `PODKIT_SHOW_LANGUAGE*` env vars
  - Changing language display preferences causes metadata-only updates, not file re-transfers (dual-key matching in video differ)

  **CLI:**
  - Add `showLanguage` config support (boolean shorthand or `[showLanguage]` table with `format` and `expand` options)
  - Add per-device `showLanguage` overrides
  - Show transform info in `--dry-run` output
  - Add `@podkit/libgpod-node` as explicit dependency for reliable native binding resolution in worktrees

### Patch Changes

- [`21ab79a`](https://github.com/jvgomg/podkit/commit/21ab79a2a52dd698b0d9d83304cad5ee9fee91f0) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix video episode titles showing series name instead of episode ID

  TV show episodes without an explicit episode title in the filename (e.g., `Show - S01E01.mkv`) now display as `S01E01` on iPod instead of repeating the series name. Episodes with titles show as `S01E01 - Episode Title`.

## 0.3.0

### Minor Changes

- [`2a4799b`](https://github.com/jvgomg/podkit/commit/2a4799b3be06bfe4789f7c28121aa28838374a0e) Thanks [@jvgomg](https://github.com/jvgomg)! - Add artwork change detection with `--check-artwork` flag. When enabled, podkit detects when album artwork has changed in your source collection and updates the artwork on your iPod without re-transferring audio files. Artwork fingerprints are written progressively during normal syncs, building baselines automatically over time. Sync tag display now shows consistency breakdown in device info and track listings. For directory sources, artwork added and removed is also detected automatically. Subsonic sources support artwork change detection but not artwork added/removed detection due to limitations in the Subsonic API.

- [`0aff870`](https://github.com/jvgomg/podkit/commit/0aff870acee8b2d5dc7c7af0e14b134fb22b1fba) Thanks [@jvgomg](https://github.com/jvgomg)! - Rename `ftintitle` transform to `cleanArtists` with a simpler config format

  **Breaking change** (minor bump — not yet v1): The `[transforms.ftintitle]` config section has been replaced with a top-level `cleanArtists` key. This is a cleaner, more intuitive name that communicates the feature's value. The new format supports both a simple boolean (`cleanArtists = true`) and a table form with options (`[cleanArtists]`). Per-device overrides use `cleanArtists = false` or `[devices.<name>.cleanArtists]`. Environment variables `PODKIT_CLEAN_ARTISTS`, `PODKIT_CLEAN_ARTISTS_DROP`, `PODKIT_CLEAN_ARTISTS_FORMAT`, and `PODKIT_CLEAN_ARTISTS_IGNORE` are now supported. The `FtInTitleConfig` type is renamed to `CleanArtistsConfig` and `DEFAULT_FTINTITLE_CONFIG` to `DEFAULT_CLEAN_ARTISTS_CONFIG`.

- [`e47456a`](https://github.com/jvgomg/podkit/commit/e47456a635e7890c90266c6f37c3618c81ba001f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add compilation album support to sync pipeline and CLI display. Compilation metadata from source files (FLAC, MP3, M4A) and Subsonic servers is now correctly written to the iPod database, ensuring compilation albums appear under "Compilations" on the iPod. The `device music` and `collection music` commands show compilation counts in stats, mark compilation albums in `--albums` view, and support a `compilation` field for `--fields`.

- [`2912138`](https://github.com/jvgomg/podkit/commit/29121384f1dc96a9736ae29d9045b746df3dd27d) Thanks [@jvgomg](https://github.com/jvgomg)! - Detect quality preset changes and re-transcode existing tracks. When you change your audio or video quality preset (e.g., `low` to `high`), podkit now detects that existing transcoded content doesn't match the new target bitrate and re-transcodes it on the next sync. Both upgrade and downgrade directions are supported.

  Audio preset changes appear as `preset-upgrade` or `preset-downgrade` in the sync plan, preserving play counts, star ratings, and playlist membership. Video preset changes remove and re-add the video at the new quality. Use `--skip-upgrades` to suppress audio preset re-transcoding.

  Fix inverted `aac_at` encoder quality mapping on macOS — the AudioToolbox AAC encoder uses a 0-14 scale where 0 is highest quality, but the code mapped it backwards. This caused VBR presets to encode at the wrong quality level (e.g., "high" produced ~44 kbps instead of ~256 kbps). Now uses empirically-measured bitrate-to-quality mapping.

  Fix video transcoding storing source file bitrate instead of transcoded output bitrate in the iPod database, which is needed for video preset change detection.

- [`41e8894`](https://github.com/jvgomg/podkit/commit/41e8894a105ada28e532d5f1391d046b13e4e760) Thanks [@jvgomg](https://github.com/jvgomg)! - Redesign quality presets to be device-aware with 4 tiers: `max`, `high`, `medium`, `low`.

  The `max` preset automatically selects ALAC (lossless) on devices that support it (Classic, Video 5G/5.5G, Nano 3G-5G) and falls back to high-quality AAC on other devices. The `high` preset (VBR ~256 kbps) is the new default.

  Add `encoding` config option to choose between VBR (default) and CBR encoding, available globally or per-device. Add `customBitrate` option (64-320 kbps) to override the preset target, and `bitrateTolerance` option to tune preset change detection sensitivity.

  Introduce sync tags — metadata stored in the iPod track's comment field that record what transcode settings produced each file. Sync tags enable exact preset change detection, eliminating false re-transcoding caused by VBR bitrate variance. Tags are written automatically to newly transcoded tracks and can be added to existing tracks with `--force-sync-tags`. Tracks without sync tags fall back to percentage-based bitrate tolerance detection (30% for VBR, 10% for CBR).

  Add `--force-transcode` flag to re-transcode all lossless-source tracks while preserving play counts, ratings, and playlist membership.

  Cap transcoding bitrate for incompatible lossy sources (OGG, Opus) at the source file's bitrate to avoid creating larger files with no quality benefit.

  Show sync tag presence in `podkit device info`, `podkit device music`, and track listings.

  **Breaking:** Quality presets are now `max`, `high`, `medium`, `low`. The `encoding` option replaces CBR preset variants. The `lossyQuality` config option is removed.

- [`e4485a1`](https://github.com/jvgomg/podkit/commit/e4485a1c1884a3893f58141d2044e6b16c108789) Thanks [@jvgomg](https://github.com/jvgomg)! - Add self-healing sync for changed and upgraded source files. Sync now detects when a source file has improved — format upgrade (MP3 replaced with FLAC), quality upgrade (higher bitrate), artwork added, Sound Check values changed, or metadata corrected — and upgrades the iPod track in place, preserving play counts, star ratings, and playlist membership.

  Upgrades happen by default as part of normal sync. Use `--skip-upgrades` or the `skipUpgrades` config option to disable file-replacement upgrades when short on time or space. The `skipUpgrades` setting follows the standard resolution order (CLI flag → device config → global config → default).

  Add `replaceTrackFile()` to `@podkit/libgpod-node` for replacing a track's audio file while preserving the database entry. The old file is deleted and libgpod generates a fresh path with the correct extension for the new format, ensuring the iPod firmware uses the right decoder.

  Add `hasArtwork` field to `CollectionTrack` — populated by the directory adapter (from embedded pictures) and Subsonic adapter (from cover art metadata).

  Fix copied tracks (MP3, M4A) not having their bitrate recorded in the iPod database, which is needed for quality-upgrade detection.

  **Breaking:** `ConflictTrack` type and `SyncDiff.conflicts` array removed from `@podkit/core` — metadata conflicts are now handled as `metadata-correction` upgrades.

- [`d40371f`](https://github.com/jvgomg/podkit/commit/d40371f876bc9008641b08f26c0087e137cfc871) Thanks [@jvgomg](https://github.com/jvgomg)! - Add Sound Check (volume normalization) support. podkit now reads ReplayGain and iTunNORM tags from source files and writes the Sound Check value to the iPod database during sync, enabling automatic volume normalization on playback. The dry-run output shows how many tracks have normalization data, and a new `soundcheck` field is available in `device music` and `collection music` commands via `--fields`.

- [`4c683ab`](https://github.com/jvgomg/podkit/commit/4c683abe203c56ae09030f04d8089df53a40cf6a) Thanks [@jvgomg](https://github.com/jvgomg)! - Add Sound Check source tracking, tips pattern, and verbose mode enhancements. Sound Check stats now show percentage format (e.g., "620 (95%)"). When coverage is partial, a tip nudges users to add normalization tags. Verbose mode (`-v`) shows adapter source info and a breakdown of Sound Check tag formats (iTunNORM, ReplayGain track/album). Adapters now expose `adapterType` and `soundcheckSource` for richer diagnostics.

- [`2db9672`](https://github.com/jvgomg/podkit/commit/2db96727b1c8d2b2f036265be9600011a4781e04) Thanks [@jvgomg](https://github.com/jvgomg)! - Add artwork presence detection for Subsonic sources. podkit now detects when artwork is added to or removed from tracks on Subsonic servers, enabling artwork-added and artwork-removed upgrade operations that previously only worked with directory sources. Navidrome's placeholder artwork images are automatically detected and filtered.

### Patch Changes

- [`53a2fd3`](https://github.com/jvgomg/podkit/commit/53a2fd39734604e8159fc5645538ea6a4af65c4d) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve mount command error output when elevated privileges are required. Instead of immediately failing with a generic sudo error, podkit now attempts `diskutil mount` first (which doesn't need sudo) and only prompts for sudo when the fallback `mount -t msdos` path is needed. When sudo is required, the error message includes device details, iFlash detection evidence explaining why macOS refuses to automount, and a tip linking to the macOS mounting troubleshooting guide.

- [`65339b0`](https://github.com/jvgomg/podkit/commit/65339b02bbb0b413de5a365355b1e237ee4a7e53) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve sync throughput for remote sources (Subsonic) by pipelining file downloads ahead of transcoding. Previously, each track was downloaded and then transcoded sequentially, leaving the network idle during CPU work. The executor now uses a three-stage pipeline (download → transcode → transfer) so network I/O overlaps with FFmpeg encoding. Local directory sources are unaffected.

- [`41ebcde`](https://github.com/jvgomg/podkit/commit/41ebcde52d40864bc13b7e1cf08b55bae2c99c6c) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve Sound Check support: extract ReplayGain data from Subsonic/Navidrome servers via the OpenSubsonic API, show Sound Check coverage in the stats summary for `device music` and `collection music`, and error when `--fields` is used without `--tracks`.

- [`867986e`](https://github.com/jvgomg/podkit/commit/867986e936e2673612832f2b51b26c1bd65ad808) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix video sync time estimates being ~20x too high by using realistic hardware and software transcoding speed factors

- Updated dependencies [[`e4485a1`](https://github.com/jvgomg/podkit/commit/e4485a1c1884a3893f58141d2044e6b16c108789), [`d40371f`](https://github.com/jvgomg/podkit/commit/d40371f876bc9008641b08f26c0087e137cfc871)]:
  - @podkit/libgpod-node@0.1.0

## 0.2.0

### Minor Changes

- [`d3b8eb2`](https://github.com/jvgomg/podkit/commit/d3b8eb25fc2f453689a5d2e38eb6acb9fe70b1e1) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve `podkit device add` to detect and handle unmounted iPods, including iFlash-modified devices that macOS refuses to automount.
  - Scans for both mounted and unmounted iPods — no longer requires the device to be pre-mounted
  - Assesses unmounted devices before attempting to mount: reads block size and capacity from diskutil, queries USB product ID via system_profiler, and resolves it to a model name (e.g. "iPod Classic 6th generation")
  - Confirms iFlash adapters via two independent signals: 2048-byte block size (iFlash emulates optical media sectors) and capacity exceeding the original iPod Classic maximum of 160 GB
  - Attempts `diskutil mount` first (no elevated privileges required); falls back to `mount -t msdos` for large FAT32 volumes that macOS refuses to mount through its normal mechanisms
  - When sudo is required, explains exactly why with per-signal detail and shows the exact command to run (`sudo podkit device add <name>`)
  - Exports `DeviceAssessment`, `IFlashAssessment`, `IFlashEvidence`, and `UsbDeviceInfo` types from `@podkit/core`

## 0.1.0

### Minor Changes

- [`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device validation and capability communication
  - Detect unsupported devices (iPod Touch, iPhone, iPad, buttonless Shuffles, Nano 6th gen) with clear error messages explaining why they won't work
  - Warn when iPod model cannot be identified, with instructions to fix SysInfo
  - Show device capability indicators (+/-) in `podkit device info` output
  - Block `podkit device add` for unsupported devices and show capabilities during confirmation
  - Add sync pre-flight checks that block unsupported devices and warn about incompatible content types
  - Include structured capabilities and validation data in JSON output

## 0.0.1

### Patch Changes

- [`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release with CLI for syncing music collections to iPod devices. Includes directory and Subsonic source adapters, FLAC-to-AAC transcoding, metadata and artwork transfer, and video sync support.

- Updated dependencies [[`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653)]:
  - @podkit/libgpod-node@0.0.1
