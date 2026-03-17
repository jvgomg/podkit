# podkit

## 0.3.0

### Minor Changes

- [`2a4799b`](https://github.com/jvgomg/podkit/commit/2a4799b3be06bfe4789f7c28121aa28838374a0e) Thanks [@jvgomg](https://github.com/jvgomg)! - Add artwork change detection with `--check-artwork` flag. When enabled, podkit detects when album artwork has changed in your source collection and updates the artwork on your iPod without re-transferring audio files. Artwork fingerprints are written progressively during normal syncs, building baselines automatically over time. Sync tag display now shows consistency breakdown in device info and track listings. For directory sources, artwork added and removed is also detected automatically. Subsonic sources support artwork change detection but not artwork added/removed detection due to limitations in the Subsonic API.

- [`0aff870`](https://github.com/jvgomg/podkit/commit/0aff870acee8b2d5dc7c7af0e14b134fb22b1fba) Thanks [@jvgomg](https://github.com/jvgomg)! - Rename `ftintitle` transform to `cleanArtists` with a simpler config format

  **Breaking change** (minor bump — not yet v1): The `[transforms.ftintitle]` config section has been replaced with a top-level `cleanArtists` key. This is a cleaner, more intuitive name that communicates the feature's value. The new format supports both a simple boolean (`cleanArtists = true`) and a table form with options (`[cleanArtists]`). Per-device overrides use `cleanArtists = false` or `[devices.<name>.cleanArtists]`. Environment variables `PODKIT_CLEAN_ARTISTS`, `PODKIT_CLEAN_ARTISTS_DROP`, `PODKIT_CLEAN_ARTISTS_FORMAT`, and `PODKIT_CLEAN_ARTISTS_IGNORE` are now supported. The `FtInTitleConfig` type is renamed to `CleanArtistsConfig` and `DEFAULT_FTINTITLE_CONFIG` to `DEFAULT_CLEAN_ARTISTS_CONFIG`.

- [`e47456a`](https://github.com/jvgomg/podkit/commit/e47456a635e7890c90266c6f37c3618c81ba001f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add compilation album support to sync pipeline and CLI display. Compilation metadata from source files (FLAC, MP3, M4A) and Subsonic servers is now correctly written to the iPod database, ensuring compilation albums appear under "Compilations" on the iPod. The `device music` and `collection music` commands show compilation counts in stats, mark compilation albums in `--albums` view, and support a `compilation` field for `--fields`.

- [`e0062b0`](https://github.com/jvgomg/podkit/commit/e0062b0f26057ff954b718873e6d66c4da224c3e) Thanks [@jvgomg](https://github.com/jvgomg)! - Standardize CLI to use named flags instead of positional arguments

  **Breaking change** (minor bump — not ready for v1 yet).

  All device names, collection names, and sync types are now specified with named flags:
  - `-d, --device <name>` for device name (global flag, now with `-d` shorthand)
  - `-c, --collection <name>` for collection name
  - `-t, --type <type>` for sync/collection type (music, video; repeatable)
  - `--path <path>` for paths in `device add` and `collection add`

  Before:

  ```
  podkit sync music -c main
  podkit device add myipod /Volumes/IPOD
  podkit device info myipod
  podkit collection add music main ~/Music
  ```

  After:

  ```
  podkit sync -t music -c main
  podkit device add -d myipod --path /Volumes/IPOD
  podkit device info -d myipod
  podkit collection add -t music -c main --path ~/Music
  ```

- [`55375b8`](https://github.com/jvgomg/podkit/commit/55375b8d4c4ab9e1fecea71497a279720cdee6fa) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `--no-tips` flag and `tips` config option to suppress contextual tips

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

### Patch Changes

- [`d29e6dc`](https://github.com/jvgomg/podkit/commit/d29e6dc1f9b5718b656b7412861739ed4a3159f9) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `device clear` not showing `[y/N]` hint in confirmation prompt

- [`53a2fd3`](https://github.com/jvgomg/podkit/commit/53a2fd39734604e8159fc5645538ea6a4af65c4d) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve mount command error output when elevated privileges are required. Instead of immediately failing with a generic sudo error, podkit now attempts `diskutil mount` first (which doesn't need sudo) and only prompts for sudo when the fallback `mount -t msdos` path is needed. When sudo is required, the error message includes device details, iFlash detection evidence explaining why macOS refuses to automount, and a tip linking to the macOS mounting troubleshooting guide.

- [`41ebcde`](https://github.com/jvgomg/podkit/commit/41ebcde52d40864bc13b7e1cf08b55bae2c99c6c) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve Sound Check support: extract ReplayGain data from Subsonic/Navidrome servers via the OpenSubsonic API, show Sound Check coverage in the stats summary for `device music` and `collection music`, and error when `--fields` is used without `--tracks`.

- [`d7e6efd`](https://github.com/jvgomg/podkit/commit/d7e6efd7db643259d443984b295d5b4768deff6c) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix transcoding progress display wrapping on narrow terminals by adapting output to terminal width

- [`a3f5203`](https://github.com/jvgomg/podkit/commit/a3f520324df0d93d0be9c5b2fa1d462f362acc5e) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `unmount` as an alias for the `eject` command

- Updated dependencies [[`2a4799b`](https://github.com/jvgomg/podkit/commit/2a4799b3be06bfe4789f7c28121aa28838374a0e), [`0aff870`](https://github.com/jvgomg/podkit/commit/0aff870acee8b2d5dc7c7af0e14b134fb22b1fba), [`e47456a`](https://github.com/jvgomg/podkit/commit/e47456a635e7890c90266c6f37c3618c81ba001f), [`53a2fd3`](https://github.com/jvgomg/podkit/commit/53a2fd39734604e8159fc5645538ea6a4af65c4d), [`65339b0`](https://github.com/jvgomg/podkit/commit/65339b02bbb0b413de5a365355b1e237ee4a7e53), [`2912138`](https://github.com/jvgomg/podkit/commit/29121384f1dc96a9736ae29d9045b746df3dd27d), [`41e8894`](https://github.com/jvgomg/podkit/commit/41e8894a105ada28e532d5f1391d046b13e4e760), [`e4485a1`](https://github.com/jvgomg/podkit/commit/e4485a1c1884a3893f58141d2044e6b16c108789), [`41ebcde`](https://github.com/jvgomg/podkit/commit/41ebcde52d40864bc13b7e1cf08b55bae2c99c6c), [`d40371f`](https://github.com/jvgomg/podkit/commit/d40371f876bc9008641b08f26c0087e137cfc871), [`4c683ab`](https://github.com/jvgomg/podkit/commit/4c683abe203c56ae09030f04d8089df53a40cf6a), [`2db9672`](https://github.com/jvgomg/podkit/commit/2db96727b1c8d2b2f036265be9600011a4781e04), [`867986e`](https://github.com/jvgomg/podkit/commit/867986e936e2673612832f2b51b26c1bd65ad808)]:
  - @podkit/core@0.3.0

## 0.2.0

### Minor Changes

- [`d3b8eb2`](https://github.com/jvgomg/podkit/commit/d3b8eb25fc2f453689a5d2e38eb6acb9fe70b1e1) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve `podkit device add` to detect and handle unmounted iPods, including iFlash-modified devices that macOS refuses to automount.
  - Scans for both mounted and unmounted iPods — no longer requires the device to be pre-mounted
  - Assesses unmounted devices before attempting to mount: reads block size and capacity from diskutil, queries USB product ID via system_profiler, and resolves it to a model name (e.g. "iPod Classic 6th generation")
  - Confirms iFlash adapters via two independent signals: 2048-byte block size (iFlash emulates optical media sectors) and capacity exceeding the original iPod Classic maximum of 160 GB
  - Attempts `diskutil mount` first (no elevated privileges required); falls back to `mount -t msdos` for large FAT32 volumes that macOS refuses to mount through its normal mechanisms
  - When sudo is required, explains exactly why with per-signal detail and shows the exact command to run (`sudo podkit device add <name>`)
  - Exports `DeviceAssessment`, `IFlashAssessment`, `IFlashEvidence`, and `UsbDeviceInfo` types from `@podkit/core`

### Patch Changes

- [`f268d71`](https://github.com/jvgomg/podkit/commit/f268d71a83e9fb31eb15d99348a6d8f7e1b02c2b) Thanks [@jvgomg](https://github.com/jvgomg)! - Extract filesystem validation into a shared utility module for improved testability

- [`b3d530f`](https://github.com/jvgomg/podkit/commit/b3d530ff32fc84647f695e46a833ae17d5e6fb02) Thanks [@jvgomg](https://github.com/jvgomg)! - Add support for PODKIT_CONFIG environment variable to set config file path

- Updated dependencies [[`d3b8eb2`](https://github.com/jvgomg/podkit/commit/d3b8eb25fc2f453689a5d2e38eb6acb9fe70b1e1)]:
  - @podkit/core@0.2.0

## 0.1.0

### Minor Changes

- [`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device validation and capability communication
  - Detect unsupported devices (iPod Touch, iPhone, iPad, buttonless Shuffles, Nano 6th gen) with clear error messages explaining why they won't work
  - Warn when iPod model cannot be identified, with instructions to fix SysInfo
  - Show device capability indicators (+/-) in `podkit device info` output
  - Block `podkit device add` for unsupported devices and show capabilities during confirmation
  - Add sync pre-flight checks that block unsupported devices and warn about incompatible content types
  - Include structured capabilities and validation data in JSON output

- [`39e3129`](https://github.com/jvgomg/podkit/commit/39e31298517688bcd3feb98233e584d5ed2e4507) Thanks [@jvgomg](https://github.com/jvgomg)! - Add stats, albums, and artists views to content listing commands
  - `device music`, `device video`, `collection music`, and `collection video` now show summary stats by default (track/album/artist counts and file type breakdown)
  - Add `--tracks` flag to list all tracks (previous default behavior)
  - Add `--albums` flag to list albums with track counts
  - Add `--artists` flag to list artists with album/track counts
  - `--tracks --json` on device commands now includes all iPod metadata fields (play stats, timestamps, video fields, etc.)

### Patch Changes

- Updated dependencies [[`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07)]:
  - @podkit/core@0.1.0

## 0.0.3

### Patch Changes

- [`3c2c3e8`](https://github.com/jvgomg/podkit/commit/3c2c3e8ad1baf7a92fe65c2e3570b9a6a674fa41) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `--version` to show the correct version number instead of 0.0.0

## 0.0.2

### Patch Changes

- [`168a9d2`](https://github.com/jvgomg/podkit/commit/168a9d2577b447cff75c75897c7a834f0ccd7114) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix release pipeline to correctly detect version merges

## 0.0.1

### Patch Changes

- [`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release with CLI for syncing music collections to iPod devices. Includes directory and Subsonic source adapters, FLAC-to-AAC transcoding, metadata and artwork transfer, and video sync support.

- Updated dependencies [[`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653)]:
  - @podkit/core@0.0.1
