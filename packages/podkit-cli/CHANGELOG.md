# podkit

## 0.7.0

### Minor Changes

- [#58](https://github.com/jvgomg/podkit/pull/58) [`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c) Thanks [@jvgomg](https://github.com/jvgomg)! - Add capability-gated clean artists transform

  Devices now declare whether they use Album Artist for browse navigation via `supportsAlbumArtistBrowsing`. When enabled globally, the `cleanArtists` transform is automatically suppressed on devices that support Album Artist browsing (Rockbox, Echo Mini, generic) and auto-applied on devices that don't (iPod). Per-device overrides still take priority.

  The dry-run summary shows when the transform is skipped (`Clean artists: skipped (device supports Album Artist browsing)`), and warns when it's force-enabled on a capable device. Both `sync --dry-run` and `device info` surface these in text and JSON output.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix mass-storage directory structure to use album artist instead of track artist, and add template-based path system with self-healing relocate.

  **Bug fix:** Mass-storage devices (Echo Mini, Rockbox) now use `albumArtist` for directory grouping, falling back to `artist` when absent. Previously, compilation/various-artist albums had their tracks scattered across separate artist directories instead of being grouped together under the album artist.

  **Path templates:** File paths are now generated from a configurable template string (`{albumArtist}/{album}/{trackNumber} - {title}{ext}` by default). This lays the groundwork for user-customisable folder structures in a future release.

  **Self-healing relocate:** When source metadata changes (e.g. album artist corrected) or the path template changes, the next sync detects the path mismatch and moves files to their correct location via `fs.rename()` — no re-copying of audio data. Relocate operations appear in dry-run output and are tracked as a new `relocate` operation type.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device archive` now fails loudly when a device's firmware identity could not be captured, instead of silently producing an archive with missing model/serial/capacity/colour fields.

  **Behavior change:** archiving a connected iPod with no on-disk `SysInfoExtended` (every iPod shuffle, and any device whose identity file is missing or corrupt) now requires a successful live firmware capture. If that capture is attempted and does not succeed, the command stops with a typed error instead of quietly degrading. Pass `--force` to proceed anyway — the archive still completes, but records the gap honestly: a note in `README.md` and an `identity_capture_failed` / `identity_capture_failure_reason` pair in `library.sqlite`'s `device` row, rather than leaving the fields blank with no explanation.

  This is not gated when there is no live USB device to correlate with the volume at all (an unsupported platform, or a plain directory passed to `--device <path>` that isn't a currently-attached iPod) — that case degrades exactly as before, since no retry or `--force` would ever change the outcome.

  `library.sqlite`'s schema version moves from 1 to 2 for the new `device` columns.

- [`0aacf17`](https://github.com/jvgomg/podkit/commit/0aacf17ff8de3487816c0604cd7a2db03dd29b0b) Thanks [@jvgomg](https://github.com/jvgomg)! - Add listening stats to iPod archives

  `podkit device archive` now records play/skip history in the archive's `README.md` and `report.json`: total play and skip counts, plus the top 10 played tracks, top 5 played artists, top 10 skipped tracks, and top 6 skipped artists (each line carries its count). Sections are omitted when a device has no play/skip history (e.g. firmware that never recorded it), so music-only or fresh dumps stay clean.

- [`d66c68e`](https://github.com/jvgomg/podkit/commit/d66c68e95ca54906c5f78526fd9362b6b26b83cb) Thanks [@jvgomg](https://github.com/jvgomg)! - iPod archives now record full device identity

  `podkit device archive` derives the archived iPod's identity from standard artifacts and shows it in the archive `README.md` — previously most fields were blank (notably for iPod shuffles):
  - **Name** comes from the iTunesDB master playlist (the iPod's own name), not the truncated disk volume label.
  - **Model, generation, serial, model number, capacity, and colour** resolve from a SysInfoExtended plist via `@podkit/devices-ipod`: the on-disk file when the device carried one, otherwise a sidecar (`podkit-sysinfo-extended.xml`) captured **read-only from firmware** at dump time. This is what makes full identity available offline for devices with no on-disk SysInfo (every iPod shuffle) — without ever writing to the device.
  - iPod shuffle 4th-generation identification data (Late 2012 + Mid 2015 order numbers, serial suffixes, and FamilyID) was added, so shuffles now resolve to their exact colour/capacity variant.
  - The recorded **podkit version** falls back to the CLI package version instead of `unknown` when running outside the packaged binary.
  - The lossless-copy directory is renamed from `raw dump/` to **`raw/`** (dumps with the old layout still load via `--from-dump`).

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

- [`ae995ef`](https://github.com/jvgomg/podkit/commit/ae995ef99174f7381f4eeaeb79cee4e77ddc3136) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify JSON error shape for `device add` and `collection music`/`collection video`

  These commands now emit the same JSON error format on failure:

  ```json
  {
    "success": false,
    "error": "<human-readable message>",
    "code": "<machine-readable tag>",
    "...details": "<command-specific extras>"
  }
  ```

  **Breaking for `collection music` / `collection video` JSON consumers.** The previous shape was `{ "error": true, "message": "..." }`. If you parse JSON output from these commands, update consumers to read `success === false` and `error` (instead of `error === true` and `message`).

  `device add` errors now also include a `code` field (additive, not breaking).

  Underneath: the runners (`runDeviceAdd`, `runCollectionMusic`, `runCollectionVideo`) throw a typed `CliError` and the action wrapper (`runAction`) translates it into structured output + exit code. Tests assert on the captured JSON instead of `process.exitCode` side-effects.

  Per CLI breaking-change convention this is a minor bump. Other commands still emit their existing shapes; that unification will land in a follow-up.

- [`8c6dc1a`](https://github.com/jvgomg/podkit/commit/8c6dc1a3d355efe6542a7f00f8fa05da3225bb42) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify and harden CLI JSON error output across every command (ADR-015)

  ## What changed

  Every CLI command now emits the same canonical JSON shape on failure. The shape, exit codes, and consumer ergonomics all changed in one breaking pass.

  ### Canonical error shape

  ```json
  {
    "success": false,
    "error": "<human-readable message>",
    "code": "<machine-readable tag>",
    "details": { "<command-specific keys>": "..." }
  }
  ```

  `code` is required and machine-readable (e.g. `MOUNT_REQUIRES_SUDO`, `FFMPEG_UNAVAILABLE`). `details` is **nested**, not spread at the top level — so command-specific extras can't accidentally collide with `success`/`error`/`code`.

  ### Exit codes
  - `0` — success
  - `1` — command error (any `CliError` thrown)
  - `2` — ran cleanly but found problems (`doctor` reporting unhealthy device, `sync` reporting partial track failures). Carries a `status` field on the success-shape JSON: `'ok' | 'issues-found' | 'partial-failure'`.
  - `130` — SIGINT (interrupted sync)

  ### Per-command typed error codes

  Every command exports an exhaustive enum of its possible error codes:

  ```ts
  import { MountErrorCodes, type MountErrorCode } from 'podkit/commands/mount';
  // MountErrorCodes.DEVICE_NOT_RESOLVED, MountErrorCodes.MOUNT_REQUIRES_SUDO, etc.
  ```

  A repo-wide barrel is at `packages/podkit-cli/src/commands/error-codes.ts` exporting `PodkitErrorCode` — the union of every code any podkit command may emit.

  ### Discriminated `*Output` types

  Each command's output type is now a discriminated union:

  ```ts
  export type MountOutput = MountSuccess | MountErrorOutput;
  ```

  Consumers narrow with `if (output.success) { ... }`.

  ## Breaking for JSON consumers

  | Old shape                                                      | New shape                                         |
  | -------------------------------------------------------------- | ------------------------------------------------- |
  | `{ error: true, message: "..." }` (collection music/video)     | `{ success: false, error, code, details }`        |
  | `{ success: false, error: "..." }` (no code, top-level extras) | `{ success: false, error, code, details: {...} }` |
  | Per-command extras at top level (e.g. `dryRun`, `device`)      | Now nested under `details`                        |
  | `process.exitCode === 1` for "found issues"                    | Now `2`; `1` is reserved for command errors       |

  Update parsers to:
  1. Branch on `success === false`.
  2. Read `code` for machine-readable tags.
  3. Read `details.X` instead of `output.X` for command-specific extras.
  4. Branch on exit code 2 for "ran cleanly with issues" (sync partial failure, doctor unhealthy).

  ## New ergonomics

  `packages/podkit-cli/src/test-utils/cli-error.ts` and `test-packages/e2e-tests/src/helpers/cli-error.ts` export `expectCliError` for asserting on the canonical shape in one call.

  `OutputContext` now takes an optional `ExitCodeSink` (default: writes `process.exitCode`; tests use `BufferExitCodeSink` to avoid process-global mutation).

  Per CLI breaking-change convention this is a minor bump.

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - CLI flag standardisation and `device init --name` (task-432.05, task-432.06):
  - **`device init --name <name>`** — fresh database can now be named at init time; passes through to `IpodDatabase.initializeIpod({ name })`. Without `--name`, libgpod default applies.
  - **`-y, --yes` everywhere** (breaking: `--confirm` removed). `device clear` and `device remove` previously used `--confirm` to skip the confirmation prompt; they now use `-y, --yes` consistent with the rest of the CLI. Scripts that passed `--confirm` must switch to `--yes`.
  - **`-n, --dry-run` short form** added to: `device clear`, `device reset`, `device reset-artwork`, `device mount`, `mount`, and `doctor`. Commands that already had `-n` or had no `--dry-run` are unchanged.

- [`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af) Thanks [@jvgomg](https://github.com/jvgomg)! - Disambiguate codec from container: `AudioCodec` value `'ogg'` is renamed to `'vorbis'`

  The `AudioCodec` slot previously used `'ogg'` to mean "OGG Vorbis." That conflated the OGG container with the Vorbis stream codec and could not represent Vorbis-in-OGG vs Opus-in-OGG as distinct device capabilities — Echo Mini (which plays Vorbis but hides `.opus` files) could not be modelled accurately. The codec slot now names the audio stream codec; `'vorbis'` replaces `'ogg'` in device presets and config.

  Configs containing `supportedAudioCodecs = ["…", "ogg", "…"]` under `[devices.*]` are migrated automatically by `podkit migrate` (config version 1 → 2). The migration is purely a string substitution inside the `supportedAudioCodecs` array; comments and surrounding formatting are preserved.

  Also lands as type-level groundwork for the future container-aware sync work: `AudioContainer`, `AUDIO_CONTAINERS`, `CODEC_CANONICAL_CONTAINER`, and an optional `DeviceCapabilities.containerConstraints` field. These are declared and exported but not yet read by the planner; they are placeholders for the upcoming Phase 2 work documented in the container-aware sync PRD.

  `DirectoryAdapter` now uses each `.ogg` file's probed stream codec (already populated by `music-metadata`) to distinguish Vorbis, Opus, and OGG-FLAC — same pattern as the existing AAC/ALAC distinction for `.m4a`. `SubsonicAdapter` additionally checks the API's `contentType` field for Opus-in-`.ogg`. The Subsonic check is best-effort because most Subsonic servers report container MIME (`audio/ogg`) regardless of stream codec; deeper probing is deferred until evidence of real-world impact.

  User-facing reference page added at `docs/reference/codec-support.md` explaining the codec/container model and what each `AudioCodec` value means.

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

- [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db) Thanks [@jvgomg](https://github.com/jvgomg)! - Consolidate dual device-discovery frameworks (TASK-427).

  `@podkit/core`'s provider-driven `enumerateConnectedDevices` framework is
  gone. The discriminated `DiscoveredDevice` union returned by
  `discoverConnectedDevices` is now the single discovery surface; every CLI
  command (`device scan`, `device add`, `device info`, `device init`, `doctor`,
  plus the `suggestAddIntents` add-hint helper) consumes it.

  **User-visible win**: `device scan`, `device info`, `device init`, and
  `doctor` now recognise user-defined `[presets.X]` mass-storage DAPs in
  addition to the built-in set — matching what `device add` already did.
  Before the consolidation, only the `device add` scan-fallback consulted
  user presets; the rest of the CLI silently saw only built-ins. Now every
  discovery path threads `mergedPresets(config)` through to
  `classifyUsbDevices`.

  **Library / framework changes**:
  - `enumerateConnectedDevices`, `EnumeratedDevice`, `EnumerateOptions`
    removed from `@podkit/core`. Use `discoverConnectedDevices`.
  - `DeviceProvider` interface + `DiscoveredContext` removed from
    `@podkit/device-types`. The runtime-registered provider list is
    replaced by a per-kind `describeAddIntent(d: DiscoveredDevice)`
    dispatcher in `@podkit/core/discovery`, sibling to `displayFor`.
  - `ipodProvider` / `createIpodProvider` removed from `@podkit/devices-ipod`.
  - `createMassStorageProvider` removed from `@podkit/devices-mass-storage`.
  - `DeviceAddIntent` shape kept (still the CLI hint contract).
  - New `DiscoverConnectedDevicesOptions.massStoragePresets` option threads
    user presets into the classification step.
  - `suggestAddIntents` signature changed: takes
    `DiscoverConnectedDevicesOptions` (deviceManager + optional presets +
    test seams). The `providers: DeviceProvider[]` parameter is gone.

  **Migration**:

  ```ts
  // Before:
  import { suggestAddIntents } from '@podkit/core';
  import { ipodProvider } from '@podkit/devices-ipod';
  import { createMassStorageProvider } from '@podkit/devices-mass-storage';

  const intents = await suggestAddIntents({
    providers: [ipodProvider, createMassStorageProvider(presets)],
  });

  // After:
  import { suggestAddIntents, getDeviceManager } from '@podkit/core';

  const intents = await suggestAddIntents({
    deviceManager: getDeviceManager(),
    massStoragePresets: presets, // optional; defaults to built-ins
  });
  ```

  Closes TASK-427.

- [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b) Thanks [@jvgomg](https://github.com/jvgomg)! - Consolidate the two ways podkit expressed "this device is unsupported" into one canonical shape. `ReadinessUnsupportedReason` moves to `@podkit/device-types` (its natural home), and `resolveIpodModel(bag)` now returns it directly on `IpodModel.unsupportedReason` instead of the bare-string `notSupportedReason`. The bridge functions in `@podkit/core` (`makeUnsupportedReasonFromModel`, `makeUnsupportedReasonFromAssessment`) are removed — consumers read `model.unsupportedReason` directly. Internal refactor; user-facing CLI behaviour is unchanged.

- [`0cc39d3`](https://github.com/jvgomg/podkit/commit/0cc39d3c62343591127d5c79deed2478f8dc4f60) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix track metadata convergence on mass-storage devices and add transfer-mode-aware on-disk tag writes for iPod portable.

  **Bug fix (mass-storage)**: `MassStorageAdapter.updateTrack` previously only wrote `comment`, OGG/Opus artwork, and ReplayGain to disk. All other metadata fields (title, artist, album, albumArtist, genre, year, trackNumber, discNumber, compilation) updated in-memory only — the file's embedded tags on the device were never rewritten. After a relocate or metadata-correction sync the next sync re-detected the same diff every time, looping forever as a zero-byte `update-metadata` op.

  `MassStorageAdapter` now queues every changed textual tag in a single `pendingTagWrites` map and flushes them as one `writeTags(filePath, fields)` call per file via `Promise.allSettled`. Per-file failures are aggregated and re-thrown so the sync executor can categorise them.

  **New behaviour (iPod portable)**: `IpodDeviceAdapter` now mirrors iTunesDB metadata into the on-disk file tags when `transferMode === 'portable'`. This makes files pulled off the iPod self-describing for re-import into a music library. `fast` and `optimized` modes still touch iTunesDB only — the iPod firmware reads metadata from iTunesDB and never falls back to file tags during playback, so paying the tag-rewrite cost in those modes would be wasted work.

  Tag writes are best-effort on iPod portable: failures are surfaced as warnings, not hard errors, because the iTunesDB write (the authoritative store for playback) already succeeded.

  **`addTrack` consistency**: When `transferMode === 'portable'`, both backends now also rewrite tags on first transfer to honour any collection-adapter transforms (e.g. clean-artists, Subsonic-side corrections) that FFmpeg's `-map_metadata 0` would otherwise copy through from the source.

  **On first sync after upgrade**: Existing mass-storage tracks will likely report a `metadata-correction` op on the next sync as stale on-disk tags converge to source values. These are zero-byte writes — no transcoding or transfers happen — but the operation list will look longer than usual for one cycle.

  **Scope notes**:
  - Match-key changes (title, artist, album corrections) still produce a remove+add rather than a metadata update. By design: when those fields change, podkit treats it as a different track.
  - Virtual-iPod (m-17) inherits the iPod behaviour automatically; no changes needed there.

- [`484fb0e`](https://github.com/jvgomg/podkit/commit/484fb0ea63eea297f19217d1acb96163a6754b05) Thanks [@jvgomg](https://github.com/jvgomg)! - Cross-process sync coordination: per-device lock, transcode owner-liveness, phantom auto-prune.

  **Per-device sync lock.** `podkit sync` now acquires a per-device PID-file lock at `.podkit/sync.lock` (mass-storage) or `iPod_Control/.podkit-sync.lock` (iPod) immediately after opening the device. A second concurrent `podkit sync` against the same device exits with the new `LOCK_HELD` code (exit code **4**) and a message naming the holding PID:

  ```
  Error: Another podkit process is already syncing /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it.
  ```

  Crash-safe: the lock file is unlinked in `finally`; if a process is SIGKILLed mid-sync, the next attempt detects the dead PID via liveness probe and takes over cleanly. `podkit sync --dry-run` does **not** take the lock (read-only by design). The daemon (`@podkit/daemon`) detects `LOCK_HELD` from the CLI subprocess and skips that cycle (no retry-spin). Read commands (`device scan`, `device info`, `device music`) are unaffected — writes only.

  **Transcode-tmp owner-liveness.** Each `podkit-transcode-<uuid>/` scratch directory now writes a small `.owner` file at creation. The pre-sync sweep walker reaps dirs whose owner is dead or whose `.owner` is missing; live owners are left alone. This replaces the previous session-start-time floor, which missed the most common interruption case for the long-running daemon: its own prior cycle.

  **Phantom manifest auto-prune.** When the pre-sync sweep detects manifest rows whose backing audio file has vanished (mass-storage devices), it now prunes them atomically as part of the sweep. Previously the sweep emitted an advisory warning recommending `podkit doctor --repair orphan-files`; the advisory now fires only if the auto-prune itself fails. `doctor --repair orphan-files` remains as a backstop and is unchanged.

  **Filesystem support.** The shared liveness primitive uses only `O_CREAT|O_EXCL`, `unlink`, `rename`, `readFile`, `writeFile`, and `process.kill(pid, 0)` — stable across exFAT, FAT32, HFS+, APFS, ext4, and NTFS. We deliberately avoided `flock(2)` because its semantics on FAT-family filesystems (common for iPods) are platform-dependent.

  **Internal API additions** (`@podkit/core`): `acquireLock`, `LockHandle`, `LockHeldError`, `LockContestedError`, `getOwnIdentity`, `readOwnership`, `writeOwnership`, `isAlive`, `PidFileEntry` — all from a new `lib/pid-file.ts` primitive. `DeviceAdapter` gains an optional `prunePhantomManifest?(paths)` method (implemented on mass-storage, intentionally omitted on iPod).

  **Removed internals:** `SESSION_START_MS` constant and `sessionStartMsOverride` plumbing in `pre-sync-sweep.ts` are gone — replaced wholesale by the PID-file liveness probe.

  See `documents/architecture/sync/planning.md` §6 for the cross-process coordination design.

- [`59726b1`](https://github.com/jvgomg/podkit/commit/59726b1f63e54afb02cef85d6f58755677b881ee) Thanks [@jvgomg](https://github.com/jvgomg)! - **Behavioural change:** `podkit device add` now refuses to persist a device when the identity cascade resolves nothing at all — no SysInfoExtended path, no classic SysInfo on disk, and no USB fingerprint. Previously such devices were silently persisted with empty identity, which stranded subsequent commands (`podkit doctor -d <name>`, `podkit sync -d <name>`) that rely on identity to track the device across replug cycles.

  The refusal exits with code `1`, prints an actionable error (`EMPTY_IDENTITY`), and points to three remediation paths:
  - Re-mount the device read-write and check the USB connection, then retry
  - Pass `--no-firmware-inquiry` if you knowingly want to skip the firmware inquiry step
  - Pass the new `--force` flag to add the device anyway with a warning

  Partial-cascade scenarios (SysInfoExtended present but USB fingerprint unresolved, or similar) continue to proceed silently — the warning is reserved for cases where neither SysInfoExtended nor classic SysInfo can be read, which is the genuinely actionable signal.

- [`71df4c6`](https://github.com/jvgomg/podkit/commit/71df4c6c121a79a199cc96073f7bee9d3424e96c) Thanks [@jvgomg](https://github.com/jvgomg)! - `device add` gains explicit verification tiers, and the `--no-firmware-inquiry` flag is renamed.

  **Breaking (CLI):** `--no-firmware-inquiry` is renamed to `--no-verify`. The new flag absorbs its old "skip the SysInfoExtended write" behaviour as a subset and additionally skips the live device cross-check, trusting valid on-disk SysInfo (the "trust-disk" tier — for Docker/headless hosts where SCSI is unavailable but the device is validly mounted). Update any scripts passing `--no-firmware-inquiry`.

  **New flag:** `--no-validate` adds a "config-inject" tier that writes the device config purely from your arguments without reading the device at all (zero device I/O). It requires a complete identity — a `--volume-uuid` (or `--path`) plus `--type`. Use it for offline provisioning, CI, and e2e setup. `--no-validate` structurally implies `--no-verify`.

  **Verify by default:** With no flags, `device add` now runs the full verify tier — it cross-checks the connected device against its on-disk SysInfo using the existing `sysinfo-consistency` / `sysinfo-modelnum-mismatch` diagnostics and refuses on a mismatch, pointing you at `podkit doctor --repair sysinfo-modelnum-mismatch`. Adding a device is your first chance to confirm it is configured correctly, so the default is cautious; the skip-tiers are explicit opt-outs.

  **Behaviour change:** the empty-identity gate is now bypassed only by `--force` (previously `--no-firmware-inquiry` also bypassed it).

  **JSON:** the `device add --format json` success envelope gains a `verification` field (`verified` | `trusted-disk` | `config-only`) reporting which tier ran.

  New `--volume-uuid` / `--volume-name` identity inputs are also accepted, and `--no-verify` / `--no-validate` appear in shell completions.

- [`99cdd9c`](https://github.com/jvgomg/podkit/commit/99cdd9c5a03ee256cac7f488da6a19d39d7bc9ce) Thanks [@jvgomg](https://github.com/jvgomg)! - New `podkit device archive [path]` command — archive a connected iPod into a self-contained, future-proof directory. It runs two stages: a lossless, read-only **raw dump** of the iPod's whitelisted data (each file checksummed into a `shasum -c`-compatible `manifest.sha256`), then a device-free **transform** that reads only the dump and produces a browsable **archive** — a renamed `Music/<AlbumArtist>/<Album>/NN Title.ext` tree (lossless copies with restamped tags + embedded album art), a queryable `library.sqlite` catalogue preserving the irreplaceable iTunesDB listening history (play counts, ratings, last-played, skip counts, date-added), `.m3u8` playlists, a human-readable `README.md` identity card, and a `report.{md,json}` listing everything skipped or failed. The bare invocation runs both stages into one `<deviceName>-<serial>-<timestamp>/` directory holding `raw dump/` + `archive/`; `--dump-only` runs just the raw dump, and `--from-dump <path>` re-runs just the transform against an existing dump without the device present. iPod-only.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device-aware diagnostics framework to `podkit doctor`. The doctor command now handles mass-storage devices gracefully instead of crashing when pointed at a non-iPod device. Diagnostic checks declare which device types they apply to, and the runner filters them automatically. JSON output now includes a `deviceType` field.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538) Thanks [@jvgomg](https://github.com/jvgomg)! - Enhanced device commands with readiness diagnostics
  - `device scan`: verbose readiness output with per-stage checks, USB discovery for unpartitioned devices, config relationship display, `--mount` flag for automatic mounting, `--report` flag for diagnostic reports
  - `podkit doctor`: two-phase diagnostics — readiness checks before database health, graceful handling of devices without databases
  - `device info`: readiness summary line in output
  - `device init`: readiness-aware guidance with stub messages for format/partition operations
  - OS error codes (errno 71, 13, 19, 5) translated to plain-language explanations

- [`7d7a429`](https://github.com/jvgomg/podkit/commit/7d7a4294b81b42f03143edbad62e746633f0e4d9) Thanks [@jvgomg](https://github.com/jvgomg)! - `DeviceConfig.unsupported` (the marker for devices the user added via the warn-allow flow in TASK-317.03) is now a structured object (`{ kind, confirmedAt }`) instead of a bare boolean. The `kind` captures which unsupported-reason class triggered the prompt (iOS device, hashAB nano, mass-storage with no preset, etc.) so a future reader can tell why the device was confirmed. The `confirmedAt` ISO timestamp records when. Legacy `unsupported = true` config entries are silently coerced to the new shape on load.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device info` no longer contradicts itself on iPods libgpod cannot identify.

  libgpod resolves an iPod's generation from its own serial-suffix table and a classic `SysInfo` model number; it has no USB axis at all. On a device outside those tables — an iPod shuffle 2nd gen, for instance — it reports the generation as `unknown`. podkit's own identity cascade resolves such a device correctly from its USB product ID, but only the model _name_ in `device info` was reading from the cascade. Everything else read from libgpod, so the report named the model in its header while the lines below said "not supported on Unknown Generation" and claimed podkit could not sync the device — all while `doctor` passed and `sync` worked.

  The generation, model number, capacity and the "can podkit sync this?" verdict now all come from the model the device open already resolved, so they cannot disagree with each other or with the header. Concretely:
  - The generation label on capability bullets names the identified model, never "Unknown Generation".
  - The only refusal `device info` can raise for an iPod is its generation's own unsupported reason — the same one `sync`, `device add` and `doctor` show, in the same words. A device podkit genuinely cannot identify fails earlier and louder, at open, with `UNKNOWN_IPOD_MODEL`.
  - Validation issues are no longer hidden on read-only devices (shuffle 3G/4G, nano 6G). That suppression existed only to mask this contradiction; the issue shown there now agrees with the read-only framing beside it.
  - `sync` no longer re-validates the device against libgpod's view after opening it. Both refusals it could raise are already settled by the identity cascade before any work starts, so it could only ever produce a false one.

  Breaking for JSON consumers of `device info`:
  - `status.model.generation` (a libgpod generation name such as `nano_3`) is now `status.model.generationId`, an `IpodGenerationId` such as `nano_3g` — matching the vocabulary `readiness.model.generationId` and `device list` already use. The field was renamed rather than re-valued so the change fails loudly.
  - `status.capabilities` is removed. It carried libgpod's per-device flags, which were all `false` on any device libgpod could not identify. Capability truth for a mounted device comes from the generation tables; read `readiness.model` for the identified model.
  - `status.validation.warnings` is removed. Its entries restated `status.capabilities` and shared its source.
  - `status.model.number` and `status.model.capacity` are populated only when the cascade identified the device from a source carrying them (SysInfo or serial). A USB-only identification reports `null` / `0` rather than a guess.

  Text output loses the `Podcasts` capability bullet on iPods, which was the last value read from libgpod's capability view. Podcast support is not modelled in podkit's capability tables.

  Removed from `@podkit/core`: `validateDevice`, `isUnsupportedGeneration`, `formatValidationMessages`, `formatCapabilities`, `buildSyncWarnings`, and the `DeviceValidationResult` / `DeviceIssue` / `DeviceWarning` / `DeviceCapabilitySummary` / `UnsupportedReason` types. They took libgpod's device view as their input and have no replacement taking it — the equivalent verdict lives on the resolved model's `unsupportedReason`.

- [`eb0b215`](https://github.com/jvgomg/podkit/commit/eb0b21527a09c71542f6e860876fdf0e763e3f41) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device info` now distinguishes the "device firmware can play" codec list from the "podkit will write" list on mass-storage devices. When the two disagree (e.g. rockbox declares `wav`/`aiff` but podkit transcodes them before transfer), the capabilities block expands into a `Firmware:` / `Podkit:` sub-block with the gap codecs annotated as transcoded:

  ```
  Capabilities:
    Audio Codecs:
      Firmware:   aac, alac, mp3, flac, vorbis, opus, wav, aiff
      Podkit:     aac, alac, mp3, flac, vorbis, opus
                  (wav, aiff transcoded before transfer)
  ```

  When the two lists agree (echo-mini, generic), the existing single `Audio Codecs:` line is preserved. JSON output gains a `status.massStorageCapabilities.firmwareSupportedAudioCodecs` field, omitted when there is no diff (absence signals the two views are equal). iPod output is unchanged.

- [`d43bda5`](https://github.com/jvgomg/podkit/commit/d43bda54ab20bb7981ecbddfe60ea6a762022101) Thanks [@jvgomg](https://github.com/jvgomg)! - Redesign `podkit device info` output: first-class Capabilities + Settings sections.

  The Settings section now shows every per-device setting as an effective
  resolved value — `[bracketed]` when inherited from global, bare when
  explicitly set on the device, `✗` for unsupported capabilities, `?` for
  unknown — matching the convention `device list` already uses. The old
  `Quality: (not set)` / `Artwork: (not set)` strings (which hid the
  inherited value) and the duplicate `Audio Codecs:` vs `Codecs:` rows are
  gone. Each row carries a `from <provenance>` tail (`from global`, `device
override`, `from preset`) so the reader can see at a glance where the
  value came from.

  The Capabilities section anchors to a display label dispatched from the
  shared `displayFor()` primitive (same one `device scan` and `device add`
  use), so `Capabilities (from echo-mini preset)` / `Capabilities (from
iPod nano 3G)` read consistently across commands. Mass-storage devices
  with per-device capability overrides now surface those overrides as bare
  values directly in the Capabilities section, with preset-inherited fields
  bracketed.

  The header line collapses `Device: <name>` + `Type: <preset>` into a
  single anchored line: `<name> (default)  —  <rich display>`.

  **Breaking JSON-mode change** for `podkit device info --json`:
  - `device.quality`, `device.audioQuality`, `device.videoQuality`, and
    `device.artwork` are removed. Read the same data from the new
    `settings` block instead: `settings.quality.value`, `settings.audio.value`,
    `settings.video.value`, `settings.artwork.value`.
  - The new `settings` block carries provenance for every field
    (`settings.<field>.source`) plus a `settings.capabilities` sub-block
    for mass-storage devices.

  The existing `status.massStorageCapabilities` block is unchanged.

  **Library / CLI internals consolidations**:
  - `formatGlobalResolved` (CLI config-render helper) folded into
    `formatResolved` via a new `{ explicitSources }` option. Two new
    exported constants — `DEFAULT_EXPLICIT_SOURCES`, `GLOBAL_EXPLICIT_SOURCES`
    — name the boundaries the device-row and global-row consumers pass.
  - New `formatResolvedRow` + `formatProvenanceTail` helpers in
    `@podkit-cli/output/resolved-row.ts` shared between `device info` and
    `device list`.
  - New `matchConfiguredDeviceToDiscovered` in `@podkit-cli/commands/device/shared.ts`
    matches a configured `DeviceConfig` to its `DiscoveredDevice` entry
    (volume UUID → mount path → USB serial → preset id).
  - `printCapabilitySummary` gains `sectionTitle` and `resolved` options so
    the mass-storage tabular layout can render preset-inherited values with
    `[bracketed]` markers when a per-device override is present, matching
    the Settings-section vocabulary.

- [`8d017e8`](https://github.com/jvgomg/podkit/commit/8d017e8ede48c98b9a1d1c627b882689c33da61e) Thanks [@jvgomg](https://github.com/jvgomg)! - Redesigned `podkit device list` output with resolved config values and provenance tracking
  - Shows resolved quality, audio, video, and artwork settings per device with inheritance indicators
  - Global config line shows top-level resolved values
  - Connected devices detected automatically and marked with ● prefix
  - Devices sorted by connection status, then default, then alphabetical
  - Values explicitly set on a device shown without brackets; inherited values wrapped in [brackets]
  - Unsupported capabilities shown as ✗, unknown (disconnected iPod) shown as ?
  - TYPE column replaces VOLUME column
  - New config resolution module (`config/resolve.ts`) with `ResolvedValue<T>` provenance tracking
  - `device scan` "Configured devices" section renamed to "Not detected" and now includes iPod devices

- [`6747667`](https://github.com/jvgomg/podkit/commit/6747667049cd793fdb13e3d1bc1092651f8e969c) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve device command output: USB model in scan, SysInfo mismatch detection, summary/issues layout
  - `podkit device scan` now shows the USB-detected iPod model (e.g., "iPod Classic 6th generation (USB)") and always runs USB discovery in parallel with disk scanning
  - `podkit device scan` and `podkit doctor` detect generation mismatches between SysInfo and USB data, warning when the SysInfo file may have been copied from a different device
  - `podkit device info`, `podkit device scan`, and `podkit doctor` now separate compact check summaries from detailed issue explanations — warnings and fix commands appear in a dedicated "Issues" section instead of inline
  - New `lookupGenerationByModelNumber()` function in `@podkit/core` for resolving iPod generation from SysInfo model numbers

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit device rename` command and `setDeviceName` API

  The new `podkit device rename <name>` command renames an iPod. The case-correct device name is the iTunesDB master-playlist name, so renaming writes that name. Use `--no-disk` for a database-only rename (the OS volume-label branch lands in a follow-up); `--no-database` to relabel the disk only; `-y/--yes` to skip the confirmation prompt. Passing both `--no-disk` and `--no-database` is rejected as a no-op.

  New APIs:
  - `@podkit/libgpod-node`: `Database.setDeviceName(name)` writes the master-playlist name (the legitimate low-level writer; no guard). The name persists across `save()` + reopen.
  - `@podkit/core`: `IpodDatabase.setDeviceName(name)` — the only sanctioned way to rename the master playlist (the generic `IpodPlaylist.rename()` guard still refuses it). Plus `applyDeviceName(...)`, an orchestrator that writes the database name first and (in a later slice) the disk label last, since relabeling moves the OS mountpoint.

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - Add config-refresh seam to `applyDeviceName` so the CLI can update cached device info after a disk relabel

  `applyDeviceName` now accepts two new optional fields: `refreshConfig` (a `RefreshConfig` callback) and `volumeUuid`. After the disk relabel and mountpoint re-resolution complete, `refreshConfig` is called with `{ volumeUuid, oldPath, newPath, newLabel, name }`. Core defaults to a no-op, so Docker/headless callers and `--no-disk` runs are unaffected.

  `RefreshConfig` and `ConfigRefreshInfo` are exported from `@podkit/core` so CLI and other consumers can type the seam without importing internal files.

  The CLI wires the seam in `podkit device rename` via a shared `makeDeviceConfigRefresh()` factory. After a rename, the podkit config's cached `volumeName` and `path` for the device (matched by stable `volumeUuid`) are updated so future runs resolve to the new mountpoint without requiring manual config edits. The user's device alias (`-d name`) and all other per-device settings are unchanged.

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - `device rename` now relabels the on-disk volume in addition to the iTunesDB name.

  Renaming an iPod previously only updated the iTunesDB master-playlist name (what the iPod firmware displays). `podkit device rename <name>` now also writes the OS volume label by default, so the Finder/Explorer name matches.
  - New pure `labelFromName(name, fs)` derives the volume label from the device name per filesystem: FAT folds to uppercase, strips illegal characters, and truncates to 11 characters (reporting a `lossy` flag + human warning); HFS+ preserves case and allows long names. Plus `classifyVolumeFilesystem` to map OS filesystem strings onto the rule family.
  - New `DeviceManager.detectFilesystem(path)` and `DeviceManager.setVolumeLabel(path, label)` select the right OS tool (macOS `diskutil rename`; Linux `fatlabel` / `hfslabel`). Failures surface as a typed `VolumeLabelError`.
  - `applyDeviceName` completes its disk branch: writes the DB name first, relabels the volume last (relabeling moves the mountpoint), then re-resolves the mountpoint. The filesystem-detect, relabel, and mountpoint-resolution steps are injectable seams with real defaults.
  - `--no-disk` skips the relabel; `--no-database` skips the iTunesDB name; both together still errors as a no-op. When the FAT label is lossy, the CLI surfaces a warning showing what the on-disk label became.

- [`14458fd`](https://github.com/jvgomg/podkit/commit/14458fd3454629e33c9f4894e899e7f3e47e5cf5) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device scan --format json`: rename `notSupportedReason: string` to `unsupportedReason: ReadinessUnsupportedReason` on USB-only device entries

  The JSON envelope for `device scan` previously carried unsupported-device
  diagnostics as a bare `notSupportedReason` string. It now matches the structured
  `ReadinessUnsupportedReason` shape already used by the readiness pipeline and
  `IpodModel.unsupportedReason`:

  ```json
  {
    "unsupportedReason": {
      "kind": "ios-device",
      "headline": "iPod Touch is not supported by podkit.",
      "docsUrl": "https://jvgomg.github.io/podkit/devices/supported-devices/"
    }
  }
  ```

  Consumers reading `device.notSupportedReason` should read
  `device.unsupportedReason.headline` instead — the same string, just nested
  under the typed payload. The change applies to both USB-only iPod entries
  (touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G) and to vendor-recognised
  mass-storage devices with no matching preset.

  The same rename also lands on the internal `IpodIdentity` and
  `IpodClassification` shapes, but those are not part of the public CLI surface.

- [`01ecedd`](https://github.com/jvgomg/podkit/commit/01ecedde623ff99e94c5cbda75ff9f9c9ecef632) Thanks [@jvgomg](https://github.com/jvgomg)! - New packages: `@podkit/devices-ipod` (canonical home for iPod generation tables, model lookups, and capability synthesis) and `@podkit/devices-mass-storage` (user-extensible DAP preset framework for Echo Mini, Rockbox, generic, and custom devices).

  Echo Mini is now auto-detected at `device add` — when the USB descriptor matches the known VID/PID (`0x071b`/`0x3203`), no `--type echo-mini` flag is required.

  `enumerateConnectedDevices` is now the recommended way to discover and classify USB devices. It accepts a `providers: DeviceProvider[]` array and returns `EnumeratedDevice[]` carrying both the USB connection info and the provider-produced identity.

  `getCapabilities` in `@podkit/devices-ipod` is libgpod-free. Capability synthesis is purely table-and-firmware-driven; the legacy `createIpodCapabilities` adapter that depended on a live libgpod `LibgpodDeviceInfo` struct is deprecated in `@podkit/core`. Parity is verified across all 29 generations (the 4 that were libgpod `unknown` degenerate cases are now correctly populated from the table).

  Internal re-export shims in `@podkit/core` keep all existing call paths compiling for one release. The shims delegate to `@podkit/devices-ipod` and `@podkit/devices-mass-storage` and will be removed in P4.

- [`667d66b`](https://github.com/jvgomg/podkit/commit/667d66b90e0979aaff381968358f2cfc78c8e581) Thanks [@jvgomg](https://github.com/jvgomg)! - Refactor the diagnostic-check scope model from a 2-field shape (`scope: 'system' | 'device'` + `category?: 'readiness' | 'database'`) to a single required 3-way union (`scope: 'system' | 'device-readiness' | 'database-health'`). Compile-time enforcement that every check declares which section it renders into; no more silent fallback when `category` is missing. The user-facing CLI `--scope` flag values are unchanged.

- [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit doctor --repair artwork-reset` to clear all artwork from an iPod without needing a source collection. This is a fast alternative to a full rebuild — useful when your source collection isn't available or you just want to clear corrupted artwork quickly.

  Rename `--repair artwork-integrity` to `--repair artwork-rebuild` to better describe what the repair does. The old name no longer works.

- [`78b0c71`](https://github.com/jvgomg/podkit/commit/78b0c71b9866306aecbb96f2a0e372a86564f2fc) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit doctor` now renders a consistent `System` / `Device Readiness` / `Database Health` section structure across all device types. Previously, mass-storage devices (Echo Mini) collapsed everything into a single `Device Health` bucket and mis-categorised three system-scope checks. The fix audits every check's `scope` tag, adds a `category?: 'readiness' | 'database'` discriminator so device-scope checks can be routed to the right subsection, and skips `iPod Firmware Inquiry Methods` on non-iPod devices.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit doctor` now diagnoses read-only devices instead of refusing to start.

  On a read-only generation (shuffle 3G/4G, nano 6G/7G) doctor printed one line — "this device is read-only" — and exited without running a single check, while `device info`, `device music`, and `device archive` read the same device perfectly well. Refusing to _diagnose_ hardware podkit can read left owners with no health information about a device they can still back up.

  Doctor now declares its intent when it asks the readiness pipeline for a verdict. Diagnosing is a read, so on a read-only device it runs its whole read-only surface:
  - Host checks (codec encoders, FFmpeg, firmware inquiry methods, udev rule).
  - The readiness cascade — USB, partition table, filesystem, mount, SysInfo, database — which previously collapsed to "skipped" rows.
  - Every database-health check: artwork integrity, orphan files, debris files, identity consistency, shuffle playback database.

  A read-only device whose contents are healthy now exits 0; it is no longer an error to own one.

  Repairs are unchanged: `podkit doctor --repair` still refuses on a read-only device, because repairing writes. Where a finding's only remedy is a write, doctor reports the finding in full and replaces the command with an explanation, rather than printing a `--repair` command it would refuse to run. The JSON envelope gains an `access` field carrying the device's tier.

  `checkReadiness()` gains an optional `requiredAccess: 'read' | 'write'` input. It defaults to `'write'`, so sync, `device init`, and `device add` keep refusing read-only devices up front, exactly as before.

- [`14d83e5`](https://github.com/jvgomg/podkit/commit/14d83e5e59eb0a8a801850de775f9fdb4c0e7aa9) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit doctor` gains `--no-system` to skip system-scope checks (FFmpeg encoders, libusb availability, udev rule). System checks remain on by default; pass `--no-system` for device-only diagnostics or in tests where the host environment shouldn't influence the result.

  The `sysinfo-consistency` check is redesigned: a missing `SysInfoExtended` file is now `skip` (not `fail`) since absence is not a failure mode. When the file is present it's compared against the live device on two independent axes — FireWireGUID and model generation — and only fails when at least one axis can be evaluated and disagrees. The check picks up live device data via the new `liveIdentity` field on `DiagnosticContext`, which `runDiagnostics` accepts as part of `RunDiagnosticsInput`.

- [`e0f65f4`](https://github.com/jvgomg/podkit/commit/e0f65f4b0cf4fce28138849b7a85f2c3a7c1a613) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit doctor` repairs now acquire the per-device sync lock before mutating the device.

  Previously, `podkit doctor --repair <id>` would happily run while a `podkit sync` (or daemon-driven sync) was mid-flight against the same device. For mass-storage devices, this meant doctor's `--repair orphan-files` could prune phantom manifest entries from `state.json`, only for sync's eventual `save()` to clobber the prune from in-memory state — silently undoing the user's repair. For iPod devices, concurrent libgpod writes (artwork rebuilds, sysinfo fixes, debris cleanup) could corrupt the iTunesDB.

  The fix: every `--repair` that mutates the device now acquires the same per-device lock that `podkit sync` takes (`.podkit/sync.lock` for mass-storage, `iPod_Control/.podkit-sync.lock` for iPod). On contention, doctor exits with `LOCK_HELD` (exit code **4**) and a message naming the holding PID:

  ```
  Error: Another podkit process is using /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it.
  ```

  Audited and locked: `orphan-files`, `artwork-rebuild`, `artwork-reset`, `debris-files` (iPod), `sysinfo-extended`, `sysinfo-consistency`, `sysinfo-modelnum-mismatch`. System-only repairs that don't touch the device (`udev-rule`, `debris-transcode-tmp`) correctly skip the lock. `--dry-run` repair invocations also skip the lock — dry-run is read-only by design and matches `podkit sync --dry-run`'s policy.

  **Internal:** `resolveSyncLockPath` moved from the CLI to `@podkit/core` (exported from `lib/sync-lock-path.ts`) so doctor and sync share the same implementation. New JSDoc on `pruneManifestRows` documents the lock requirement for any future direct caller. Architecture doc `documents/architecture/sync/planning.md` §6 now enumerates every manifest-writer surface with confirmed lock semantics.

- [`5b0279c`](https://github.com/jvgomg/podkit/commit/5b0279cc620ed5101351494dc1ea4a709791d0db) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit doctor --scope <system|device|all>` for running host-environment checks without a registered device.

  `--scope system` skips device resolution entirely and runs only the system-scope checks (FFmpeg, codec encoders, video encoder, libgpod runtime, SCSI inquiry, udev rule on Linux). Useful before plugging an iPod in for the first time, and required by the m-19 Tier-3 test harness to assert host-state against a captured `SystemState` fixture.

  `--scope device` requires `-d/--device` and runs only device-scope checks. `--scope all` (default) preserves the existing combined output byte-for-byte; the legacy `--no-system` flag still applies in that mode. JSON output under `--scope system` uses a discriminator field (`scope: "system"`) so consumers can distinguish the two envelopes.

- [`4efa15c`](https://github.com/jvgomg/podkit/commit/4efa15c7e42874e9dd88ef2731230d5314d83f20) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify `--repair` IDs across device types and add debris-only diagnostic checks.

  The `podkit doctor --repair` flag now uses one ID per repair regardless of device type. Internally, the framework dispatches the right walker based on the connected device:
  - `--repair orphan-files` — works on both iPod and mass-storage. (Previously `orphan-files` was iPod-only; `orphan-files-mass-storage` was the mass-storage variant.)
  - `--repair debris-files` (new) — cleans podkit's own `.podkit-tmp` and adapter-failure write residue from prior interrupted syncs. Repair is safe-by-design (no confirmation prompt) because every debris file is incomplete by construction.
  - `--repair debris-transcode-tmp` (new) — reaps abandoned `podkit-transcode-*` scratch directories from SIGKILLed prior syncs. Uses an mtime-based safety floor so concurrent sibling processes are never disturbed.

  **Breaking:** `--repair orphan-files-mass-storage` has been **removed**. Users running this flag will see Commander's choices() validation error listing the new public IDs (including `orphan-files`). Migration is mechanical: replace every occurrence with `--repair orphan-files`.

  The orphan check no longer reports debris in its detail output — that's the new `debris-files` check's job. Same FS walk, two checks; no double traversal.

- [`bb98872`](https://github.com/jvgomg/podkit/commit/bb988729b5c271152c6352f9c28e02b533e52df5) Thanks [@jvgomg](https://github.com/jvgomg)! - Ship a glibc Linux binary for Homebrew/Debian alongside the existing musl binary (dual-libc distribution).

  The released Linux binary was previously musl-only, so its program interpreter was `/lib/ld-musl-*.so.1` — which does not exist on a stock glibc host. Every Homebrew-on-Linux (Debian/Ubuntu/Fedora) user therefore got a binary that could not execute (`podkit --version` → `cannot execute: required file not found`). Homebrew and the direct Debian tarball now install a **glibc** binary (`podkit-linux-{x64,arm64}-gnu.tar.gz`, built against a baseline glibc 2.31), while Alpine and the Docker image continue to use the musl binary. Each native dependency (libgpod, glib, gdk-pixbuf, libplist, libxml2, sqlite, …) is statically linked into the addon and this is enforced by fail-closed CI linkage + program-interpreter gates, plus a runtime smoke that reads a real iTunes database through the native libgpod path on both libcs.

- [`e6e36af`](https://github.com/jvgomg/podkit/commit/e6e36afda3069aabc0ce6dbd23926ff12de7eb3c) Thanks [@jvgomg](https://github.com/jvgomg)! - Declare a single mass-storage device entirely via environment variables

  `PODKIT_DEVICE_PATH` (+ optional `PODKIT_DEVICE_TYPE`, default `generic`, and `PODKIT_DEVICE_NAME`, default `default`) declares a mass-storage device with no config file, exactly as a `[devices.<name>]` entry would — and makes it the default device. `PODKIT_DEVICE_TYPE=ipod` is rejected: iPods are auto-detected and need no declaration. In daemon mode the declared path is polled automatically, giving iPod and mass-storage users symmetric ENV-only single-device lanes.

  Path-based syncs (`-d /path`) now also match mass-storage devices declared in config by their `path` — previously matching was volume-UUID-only, which folder-based players without a filesystem UUID could never satisfy — so the declared preset and per-device settings apply.

- [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device reset` is now a true factory reset

  Reset previously only recreated the iTunesDB, leaving the actual audio files in `iPod_Control/Music/` and artwork thumbnails on disk as orphans. It now performs a complete wipe:
  1. Reads the device's current name and recreates an empty database with that name (override with `--name`).
  2. Brute-force removes every audio file under `iPod_Control/Music/F*` and every artwork `.ithmb`/`ArtworkDB` directly on disk — including orphan files no database references (fixing the long-standing leftover-file bug).
  3. Sets the OS volume label to match the device name.

  Reset is all-or-nothing (no `--no-*` flags); partial wipes remain on `device clear` and `device reset-artwork`. Running reset on a device with no existing iTunesDB now errors and points to `podkit device init` for first-time setup. `--dry-run` previews every step without mutating anything.

  A new `sweepDeviceContent(mountPath, { music, artwork })` core primitive performs the on-disk content sweep; it is guarded so it can only ever operate inside a valid `iPod_Control` tree.

- [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4) Thanks [@jvgomg](https://github.com/jvgomg)! - Add SCSI firmware inquiry for iPod identification (P1 — m-18 device-capability architecture).

  `@podkit/device-types` (first published release) provides the canonical shared type definitions — `DeviceCapabilities`, `DeviceIdentity`, `ParsedFirmware`, and `DeviceProvider` — used across the podkit monorepo without circular dependencies.

  `@podkit/ipod-firmware` (first published release) implements iPod firmware inquiry via SCSI (Linux SG_IO + macOS IOKit, using koffi FFI) with USB fallback through the existing libgpod-node binding. Devices that previously failed identification over USB — including iPod mini 2G, nano 2G, and some iPod 5G Video configurations — can now be identified via SCSI. The orchestrator probes available transports at startup, prefers USB when both are available, and falls back to SCSI transparently.

  `@podkit/core` now routes `ensureSysInfoExtended` through the new orchestrator with SCSI fallback, and registers two new `podkit doctor` checks: `inquiry-methods` (reports which transports are available on this host) and `sysinfo-consistency` (validates that the on-disk SysInfo file matches the live firmware read). EACCES errors from SCSI include step-by-step recovery instructions.

  `podkit` CLI gains `--repair udev-rule` in `podkit doctor` to install the Linux udev rule that grants non-root `/dev/sg*` access, and surfaces the new doctor checks in the readiness output.

- [`09c4acd`](https://github.com/jvgomg/podkit/commit/09c4acdec349f200a649b2db15fe05345e380a7b) Thanks [@jvgomg](https://github.com/jvgomg)! - Add canonical IpodModel type for structured device identity
  - Add `IpodModel` interface — canonical representation of identified iPod model with `displayName`, `generationId`, `checksumType`, `color`, `capacityGb`, `modelNumber`, and `source` provenance
  - Add `resolveIpodModel()` factory — builds an `IpodModel` from USB product ID, SysInfo model number, or serial number suffix
  - Add `UsbConnectionInfo` interface — pure USB bus topology data, split from device identity
  - Restructure `UsbDiscoveredDevice` to carry `usb: UsbConnectionInfo` + `model?: IpodModel`
  - Add `usbModel` and `deviceModel` to `ReadinessResult` — USB-derived and SysInfo-derived models kept separate for mismatch detection
  - Update `SysInfoExtendedResult` with structured `model`, `firewireGuid`, `serialNumber` fields
  - Clean `checkSysInfo()` return type — new `SysInfoCheckResult` separates stage result from device model
  - Add `model` to JSON output for `device scan` and `device info` commands
  - `device scan` and `device info` now display richest available model name (color/capacity from SysInfo when available)
  - Remove `UsbDeviceInfo` type (replaced by `UsbConnectionInfo` + `IpodModel`)

- [`30638f5`](https://github.com/jvgomg/podkit/commit/30638f5e1a51dfe935154c62367e530383e13d14) Thanks [@jvgomg](https://github.com/jvgomg)! - Enforce the device bitrate cap on lossy tracks (down direction)

  Lowering a device's quality (a smaller preset, or a lower custom bitrate) now re-encodes the **lossy** tracks already on the device down to the new cap. Previously lossy sources (MP3, AAC) were copied as-is and never capped, so the setting silently did nothing for most libraries — only lossless sources were re-transcoded on a preset change.

  The cap comparison is driven by the bitrate podkit recorded in the track's sync tag, not the unreliable device-database bitrate, so it never guesses: a lossy track podkit never wrote (synced by another tool, or before this feature) has no recorded bitrate and is left alone. After a cap-down re-encode the new bitrate is written back to the sync tag, so syncing again at the same cap is a no-op (idempotent). Works on both iPod and mass-storage devices.

  This release enforces the cap in the down direction only (shrinking over-cap tracks). `--skip-upgrades` still suppresses all file replacement, including cap-down.

  Note: a newly added lossy track whose bitrate is above the cap is still copied as-is on the first sync, then re-encoded down on the next sync — cap enforcement currently applies to tracks already on the device, so a fresh library converges to the cap over two syncs.

- [`c0cc659`](https://github.com/jvgomg/podkit/commit/c0cc659e5b442bcc1a78fddf637fed8f40a407c3) Thanks [@jvgomg](https://github.com/jvgomg)! - Enforce the device bitrate cap on lossy tracks at add time (single-sync convergence)

  A brand-new lossy source (MP3, AAC) whose bitrate is above the device cap is now re-encoded **down to the cap on the first add**, instead of being copied as-is and capped on the next sync. A fresh over-cap library converges to the cap in a single sync rather than over two.

  The on-add cap produces exactly what a later device-bound cap-down would: the resolved lossy codec at the cap, with the cap recorded in the sync tag — so re-syncing at the same cap is a no-op (idempotent). Sources within the source-proximity tolerance of the cap (default 25%), and sources with an unknown bitrate, are still copied verbatim (no needless lossy re-encode). When the reduction axis is `preserve` (`[bitrate].reduce = never`, or `auto` with `fast`/`portable` transfer mode), the source is copied as-is even when above the cap. Works on both iPod and mass-storage devices.

- [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f) Thanks [@jvgomg](https://github.com/jvgomg)! - Replace `[bitrate].sync` policy with down-only lossy reduction (`[bitrate].reduce`)

  This is a clean-break config change (ADR-023). The five-mode `[bitrate].sync` key (`match-cap`, `match-all`, `up-only`, `down-only`, `off`) and the `toleranceUp` / `toleranceDown` fields are **removed**. Using them now produces a config error with a pointer to the replacement.

  ## What changed

  ### New config keys

  ```toml
  [bitrate]
  reduce = "auto"      # auto | always | never  (default: auto)
  tolerance = 0.25     # source-proximity fraction  (default: 0.25)
  ```

  `reduce = "auto"` follows the transfer mode: `optimized` converts (reduces over-cap device-native lossy sources); `fast` and `portable` preserve (copy them as-is). `always` always converts; `never` always preserves.

  `tolerance = 0.25` is the source-proximity damper on the **add path** only — a device-native lossy source is reduced only when `source > cap × (1 + tolerance)`. The default 0.25 means a source within 25% of the cap is copied as-is. The recorded-vs-cap comparison on re-sync always uses tolerance 0 (exact), because the sync tag records what podkit encoded — there is no ffprobe wobble to damp.

  ### New CLI flags
  - `--bitrate-reduce <auto|always|never>` — override `[bitrate].reduce` for one run.
  - `--bitrate-tolerance <fraction>` — override `[bitrate].tolerance` for one run.

  ### New env vars
  - `PODKIT_BITRATE_REDUCE` — override `[bitrate].reduce`.
  - `PODKIT_BITRATE_TOLERANCE` — override `[bitrate].tolerance`.

  ### Lossy reduction is down-only

  Re-encoding a lossy track up cannot recover discarded information, so podkit never does it automatically. When you **raise the cap**, tracks previously reduced to a lower preset sit below the new target and are surfaced as a `below-cap` report:

  ```
  N tracks below your quality target — re-sync with --force-transcode to lift them
  ```

  Use `--force-transcode` to explicitly re-lift them to the current cap.

  Lossy tracks that were never reduced (copied with `quality=copy` in their sync tag) are not surfaced as `below-cap` — they were never capped, so raising the cap is not a meaningful event for them.

  ### Removed: lossy `cap-up` and `source-improved`

  The `cap-up` reason is now lossless-source only (a higher preset or ALAC upgrade). It is never produced for a lossy track. `source-improved` (a lossy source whose bitrate climbed above the device copy triggering an upward re-encode) is removed entirely — a changed source folds into ordinary content-change detection (self-healing).

  ### Report-only signals (unchanged behaviour, new reason)
  - `source-down-suppressed` — source re-ripped to a lower bitrate than the device copy; the better copy is kept and reported.
  - `below-cap` (new) — a previously-reduced track now sits below a raised cap; surfaced so the user can `--force-transcode` to lift it.

  ### Capability seam (`@podkit/device-types`)

  `DeviceCapabilities` gains an optional `maxAudioBitrate` (kbps) field — a device-declared ceiling for lossy audio, consumed by the reduction seam. It is additive and unpopulated (no device profile sets it yet), so behaviour is unchanged; the field exists so a future per-device ceiling is a non-breaking addition.

  ## Migrating

  | Old config                     | New equivalent                                                      |
  | ------------------------------ | ------------------------------------------------------------------- |
  | `[bitrate].sync = "match-cap"` | `[bitrate].reduce = "always"` (convert any over-cap source)         |
  | `[bitrate].sync = "down-only"` | `[bitrate].reduce = "always"` (down-only is the only direction now) |
  | `[bitrate].sync = "off"`       | `[bitrate].reduce = "never"`                                        |
  | `[bitrate].sync = "up-only"`   | No equivalent — upward re-encoding is removed                       |
  | `[bitrate].sync = "match-all"` | No equivalent — following source down is removed                    |
  | `[bitrate].toleranceUp = 0.1`  | `[bitrate].tolerance = 0.1` (single direction)                      |
  | `--bitrate-sync <mode>`        | `--bitrate-reduce <auto\|always\|never>`                            |

  Per the project's minor-bump policy for CLI-breaking changes.

- [`56013ce`](https://github.com/jvgomg/podkit/commit/56013ce78864a9d6fd39455f9628f8a4cd1b638f) Thanks [@jvgomg](https://github.com/jvgomg)! - Keep the better device copy when a source is re-ripped lower, and report it

  When a track's source file is re-ripped (or re-encoded) to a **lower** bitrate than the copy already on the device, podkit no longer follows the source down by default. Re-encoding the device copy down to the worse source would destroy quality for no benefit, so the better existing copy is kept and the situation is surfaced instead of silently acted on.

  This also fixes a latent edge in lossy cap-down: a device copy whose recorded bitrate sits _above_ the cap was re-encoded down to the cap even when the source had since degraded _below_ the cap (e.g. recorded 320, source re-ripped to 100, cap 128) — a lossy-to-lossy upsample of degraded audio. The cap comparison now uses the three-bound model (the effective target is `min(source, cap)`), so when the source can no longer supply the cap the change is suppressed rather than re-encoded.

  Suppressed changes are visible without creating any work:
  - `sync --json` lists each one in the per-collection `qualityChanges[]` array with `reason: "source-down-suppressed"` and `reEncodes: false`, and counts it under `updateBreakdown["quality-change-suppressed"]`.
  - The default text summary shows a per-collection "Source-down suppressed" count; `-v` lists each affected track with its device/source bitrates.
  - The track is never moved into `tracksToUpdate`/`tracksToUpgrade` and no file work runs — a suppressed track is a stable no-op across repeated syncs.

  Suppression is the default and the only behaviour — down-only reduction means podkit never follows a degraded source down automatically. Works on both iPod and mass-storage devices.

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

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - `device init`, `device reset` and `device add` no longer stamp a fabricated iPod Video identity onto the device.

  Initialising an iPod database writes the model number it is given to `iPod_Control/Device/SysInfo` as `ModelNumStr`. That value defaulted to `MA147` — an iPod Video 60GB — and every podkit caller took the default. So `podkit device reset` on _any_ iPod left it claiming to be an iPod Video, with no backup and no marking, and podkit then read its own fabrication back as evidence of what the device was: it fed the identity cascade, and it silently satisfied the empty-identity refusal on a later `device add`.

  The default is gone. podkit now passes the model number its identity cascade resolved from the device, and when the cascade resolves none, initialisation writes no SysInfo at all rather than inventing one. A device with unresolved identity keeps whatever identity it already had.

  Two consequences of initialising without a model number, both of which podkit now handles:
  - The database layer writes a playback database (`iTunesSD`) for _any_ device it is given no model number for, in the `bdhs` format of an iPod shuffle 3G/4G. podkit deletes that file after initialising: a playback database for a device nothing has identified, in a format nothing has confirmed the hardware reads, is worse than none. A device that already had one keeps it. Initialising an iPod shuffle whose model number is unknown is now refused outright, pointing at `podkit doctor --repair sysinfo-extended` — that reads the device's own serial from firmware, which resolves the model number.
  - `iPod_Control/Artwork` and `Photos/Thumbs` are no longer pre-created, because the database layer only creates them for a device whose model it knows. Both are created on demand by whatever writes to them, so nothing changes in practice.

  Breaking for `@podkit/libgpod-node` consumers: `Database.initializeIpod()` (and `initializeIpodSync()`) no longer default `options.model` to `MA147`. Callers that relied on that default — including anything creating synthetic test iPods — must pass `model` explicitly.

- [`34ad4d3`](https://github.com/jvgomg/podkit/commit/34ad4d39104600f1363bd434518b10b3399a652c) Thanks [@jvgomg](https://github.com/jvgomg)! - Expose `pathTemplate` as a per-device config option for mass-storage devices, allowing user-customisable folder structures.

  Configurable via:
  - `[devices.<name>] pathTemplate = "..."` in TOML
  - `PODKIT_PATH_TEMPLATE` env var (applied as a global default for mass-storage devices)

  Variables: `{albumArtist}`, `{artist}`, `{album}`, `{title}`, `{trackNumber}`, `{discNumber}`, `{totalDiscs}`, `{genre}`, `{year}`, `{ext}`. The template must contain `{title}` and `{ext}` and is rejected on iPod devices (iPod paths are managed by libgpod, not by template).

  Changing the template between syncs triggers the existing self-healing relocate flow — existing files are moved via `fs.rename()` to match the new layout, with no re-transcoding. Adds, removes (`--delete`), and template-driven relocates all compose in a single sync operation.

- [`b9a574b`](https://github.com/jvgomg/podkit/commit/b9a574b373be97579315fefb41108e3f2cd0c9a4) Thanks [@jvgomg](https://github.com/jvgomg)! - Add per-device default collections

  Each configured device can now declare its own default music and video collection, so `podkit sync -d <device>` syncs the right collections without passing `-c` every time. Each default is a tri-state: a collection name, `false` to sync nothing of that type by default, or unset to inherit the global `[defaults]`. A per-device default applies whenever the target resolves to a configured device (by name, path, or UUID auto-match); a `-c` flag still overrides everything.

  Set them with `podkit device set -d <device> --default-music <name>` / `--default-video <name>`, opt a type out with `--no-default-music` / `--no-default-video`, or clear back to the global default with `--clear-default-music` / `--clear-default-video`. The resolved defaults (with provenance — explicit, `[inherited]`, `none`, or unset) are shown in `podkit device info` and `podkit device list`, in both text and JSON output.

- [`1f83c68`](https://github.com/jvgomg/podkit/commit/1f83c685753c1ab28be36155eab5e3fa78b83a22) Thanks [@jvgomg](https://github.com/jvgomg)! - Treat encoding-mode flips (CBR↔VBR) and the lossy/lossless boundary as correctness re-encodes, applied even when bitrate syncing is off.

  Switching a device's encoding mode (`vbr` ↔ `cbr`), or switching its target between lossy and lossless, is now treated as a correctness re-encode rather than a bitrate-policy move:
  - **Encoding-mode flips re-encode lossy tracks too.** Previously only lossless-source tracks picked up a CBR↔VBR change; a lossy track podkit had transcoded (e.g. one already capped down to AAC) kept its old encoding mode. It now re-encodes to match.
  - **Switching to a lossy target re-encodes a still-lossless device copy down to the cap.** The lossy→lossless direction already worked; the lossless→lossy direction now does too.

  Both apply in **every** `bitrate.sync` mode, including `off` — freezing bitrates keeps your bitrates put but still lets a wrong encoding mode or a crossed lossy/lossless boundary be corrected. The `--skip-upgrades` master switch still blocks them, for a purely-additive device. Re-encodes are idempotent: the rewritten sync tag records the new encoding and bitrate, so the next sync is a no-op.

- [`480d751`](https://github.com/jvgomg/podkit/commit/480d7510ed9953a06047c848b514dbc688048932) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify the music quality-change event vocabulary under `quality-change`

  The sync event and JSON output reason vocabulary for music quality moves is
  consolidated under a single `quality-change` update reason, replacing the four
  previous reason strings (`format-upgrade`, `quality-upgrade`, `preset-upgrade`,
  `preset-downgrade`). This is a clean rename — no deprecation window.

  ## What changed

  ### Update reason

  `DiffUpdateEntry.reasons[0]` now uses `'quality-change'` for all music quality
  moves. The direction and detail are carried in `DiffUpdateEntry.qualityChange`
  (a new `{ reason, direction, reEncodes, targetBitrate, ... }` object).

  ### JSON breakdown keys

  `updateBreakdown` gains direction-split keys for the quality axis:

  ```json
  {
    "quality-change-up": 12,
    "quality-change-down": 3,
    "quality-change-suppressed": 0
  }
  ```

  The old `format-upgrade`, `quality-upgrade`, `preset-upgrade`, and
  `preset-downgrade` keys are gone.

  ### Per-collection `qualityChanges[]`

  Each music collection block now includes a `qualityChanges[]` array when
  quality moves are planned or suppressed. Each entry carries `track`, `direction`,
  `reason` (classifier reason: `lossless-boundary`, `cap-up` [lossless-source only],
  `cap-down`, `encoding-mismatch` [lossless-source only], `source-down-suppressed`,
  `below-cap`), `targetBitrate`, and optional `sourceBitrate` / `encodedBitrate`
  for diagnostics. The `reEncodes` field distinguishes active re-encodes from
  report-only entries (`source-down-suppressed` and `below-cap`).

  ### `@podkit/core` exports

  `classifyQualityChange`, `classifySourceBound`, `classifyDeviceBound`,
  `QualityChange`, and `QualityTarget` are exported from `@podkit/core`.

  ## Migrating JSON consumers

  | Old key / reason                      | New key / reason                                                                          |
  | ------------------------------------- | ----------------------------------------------------------------------------------------- |
  | `format-upgrade`                      | `quality-change` (direction: `up`, reason: `lossless-boundary`)                           |
  | `quality-upgrade`                     | removed — `source-improved` is gone (ADR-023); a changed source folds into content-change |
  | `preset-upgrade`                      | `quality-change` (direction: `up`, reason: `cap-up`, lossless-source only)                |
  | `preset-downgrade`                    | `quality-change` (direction: `down`, reason: `cap-down`)                                  |
  | `updateBreakdown["format-upgrade"]`   | `updateBreakdown["quality-change-up"]`                                                    |
  | `updateBreakdown["preset-upgrade"]`   | `updateBreakdown["quality-change-up"]`                                                    |
  | `updateBreakdown["preset-downgrade"]` | `updateBreakdown["quality-change-down"]`                                                  |

  Report-only entries (`reEncodes: false`) appear in `qualityChanges[]` and are
  counted under `updateBreakdown["quality-change-suppressed"]`. Inspect
  `update.qualityChange.reason` for the specific sub-reason when you need to
  distinguish lossless-boundary from cap-up, or source-down-suppressed from below-cap.

  Per CLI breaking-change convention this is a minor bump.

- [`f5d0082`](https://github.com/jvgomg/podkit/commit/f5d00829f3b1a80453bdc4f7e6599566f7f02bb3) Thanks [@jvgomg](https://github.com/jvgomg)! - Reconcile USB-inquiry and block-device discovery so each connected iPod renders once in `podkit device scan`. Previously, `device scan` could surface the same physical iPod twice on Linux when both pipelines independently identified it. The orphan entry also surfaced a destructive remediation (`Needs partitioning — see: podkit device init`) on a healthy device. Both issues fixed: a new reconciliation primitive matches USB and block-device records by serial number (or disk identifier as fallback), and the readiness-failure copy now points at docs instead of suggesting an inappropriate command.

- [`4ee5e2b`](https://github.com/jvgomg/podkit/commit/4ee5e2be470a93a54c2d54bc0aab257d7b92babe) Thanks [@jvgomg](https://github.com/jvgomg)! - Refuse HFS+ iPods on Linux at `device add`; warn at `device scan`

  iPods formatted as HFS+ are now refused on Linux at `podkit device add` time, with a clear message pointing at docs explaining how to reformat to FAT32. `podkit device scan` surfaces the same iPods with a `Filesystem not supported on Linux` warning instead of running readiness stages or suggesting destructive remediation. macOS HFS+ behaviour is unchanged.

  Why: the Linux kernel hfsplus driver refuses RW on journaled HFS+ (the iPod default), udev/blkid don't surface a filesystem UUID for HFS+ on Linux (breaking podkit's identity model), and udisksctl mount paths fall back to a generic name with no label. Each friction point has a partial fix; together they mean Linux + HFS+ is a second-class experience no matter how much we patch. Refusing cleanly with a docs link sharpens podkit's Linux story to "FAT32 iPods, supported well."

  Structured `--json` output preserves a stable error code (`UNSUPPORTED_FILESYSTEM_ON_LINUX`) so scripted callers can handle the refusal.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Sync to an iPod shuffle now produces a device that plays.

  An iPod shuffle plays from `iTunesSD`, not from the `iTunesDB` every other iPod uses. The database layer writes that file only for a device it has resolved to a shuffle, and it resolves models from its own serial-suffix table and the classic SysInfo `ModelNumStr` alone — it has no USB or FamilyID axis. A shuffle 2G whose serial suffix is in neither table and which carries no classic SysInfo was therefore unidentifiable to it: `iTunesSD` was silently skipped, the sync reported success, and the device could not play a single one of the tracks it had just received.

  podkit now supplies the identity the database layer is missing, using a model number its own cascade resolved **from the device**:
  - Serial suffix `436` → `A947` (iPod shuffle 2G, 1GB, Pink) is added to the serial table from real hardware.
  - `podkit device add` records the resolved model number in the device's SysInfo when the database layer cannot identify it.
  - `podkit doctor` reports the same condition as a new `sysinfo-modelnum-missing` check, repairable with `podkit doctor --repair sysinfo-modelnum-missing`.
  - A new `shuffle-playback-db` doctor check reports a shuffle whose `iTunesSD` is absent, empty, or in the wrong format for the hardware — the symptoms that were previously invisible. It reads the header rather than guessing from file size, because an empty 3G/4G `bdhs` file is larger than a populated 1G/2G one.

  Nothing is ever fabricated: when the cascade resolves no model number, podkit reports the gap and writes nothing.

  Shuffle 3G/4G remain read-only.

- [`275c972`](https://github.com/jvgomg/podkit/commit/275c97295462547037e2c911c139654eb50d4af7) Thanks [@jvgomg](https://github.com/jvgomg)! - Sidecar artwork support and executor adapter fallback.

  The sync pipeline now picks up out-of-band artwork that lives alongside the audio file or on the source server, not just embedded pictures:
  - **Directory adapter** detects peer `cover.jpg` / `folder.jpg` / `front.jpg` / `album.jpg` (also `.jpeg` / `.png`, case-insensitive) in the same directory as the audio file. When a file has no embedded picture, the sidecar bytes are used. Under `--check-artwork` the sidecar bytes are hashed and pinned in the sync tag, so swapping a `cover.jpg` for a new image is detected on the next sync.
  - **Subsonic adapter** falls back to Navidrome's `getCoverArt` endpoint when the downloaded audio file body has no embedded picture. This closes the gap where a Navidrome library indexed sidecar art on the server but podkit silently dropped it on every sync.
  - A one-time placeholder probe runs on every Subsonic `connect()` so Navidrome's static "no cover" image is filtered regardless of `--check-artwork`.

  Embed-in-the-file wins when both are present; the sidecar / API fallback only fires on a miss. Album-level caching means siblings on the same album share a single sidecar read or API request.

  Adapters gain an optional `getArtwork(item): Promise<Buffer | null>` method on `CollectionAdapter`. The executor calls it through the existing `AlbumArtworkCache` after embedded extraction returns null.

  **Known gap (deferred to TASK-370 / TASK-371 / TASK-372):** mass-storage devices accept the bytes via `setArtworkFromData`, which is a no-op for non-OGG/Opus containers — adapter-fallback bytes reach the device only when the output is OGG/Opus copy (via the existing taglib path) OR the target is an iPod (via the iTunesDB). For other mass-storage outputs the bytes are dropped silently today; the e2e artwork matrix fences those cells with a `[BUG] TASK-370` skip rather than failing the suite.

- [`cac7fc1`](https://github.com/jvgomg/podkit/commit/cac7fc123861e97b10d31c83728a1e3f0431934e) Thanks [@jvgomg](https://github.com/jvgomg)! - Sidecar lifecycle cleanup + broader orphan-files surface (TASK-375).

  **Sync-time sidecar cleanup (mass-storage, sidecar-primary devices).**
  `MassStorageAdapter.removeTrack` and `relocateTrack` now drop the
  album's `cover.jpg` when the last managed audio file leaves the
  directory. The delete is queued at the moment of removal and flushed
  in a new `save()` stage that re-evaluates the predicate per entry, so
  a re-add inside the same save cycle (whether through `writeSidecar` or
  via a pipeline that skipped artwork on a hash match) cleanly cancels
  the queued delete. The previous behaviour left a dangling `cover.jpg`
  and a stale manifest entry forever; sync-time cleanup keeps the
  invariant "every managed sidecar has at least one managed audio
  sibling in its dir" alive.

  **Doctor's orphan-files check no longer filters by extension.** The
  mass-storage walker previously surfaced only audio/video files as
  orphan candidates. Any other file in your content directories
  (sidecar images, lyrics `.lrc`, playlist `.m3u`, stray documents) was
  silently dropped. Now the check considers any non-debris file in the
  configured content roots — confirmation-gated repair stays unchanged
  so you review the list before anything is deleted. This is the
  backstop for sidecars on devices that synced before sync-time cleanup
  existed, and surfaces unmanaged user-placed files in podkit's
  territory you may want to clear out.

  **Migration:** on a rockbox device with a pre-existing user-placed
  `cover.jpg` that podkit never wrote, the orphan check will now flag
  it. The confirmation prompt is your safety; review before repairing.
  After deletion, the next sync re-issues a managed sidecar.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd) Thanks [@jvgomg](https://github.com/jvgomg)! - Refactor sync engine to be fully content-type-agnostic with per-handler operation types.

  **Breaking:** `createMusicHandler()` and `createVideoHandler()` now take a config object at construction instead of using `setTransformsConfig()`/`setExecutionConfig()`. Removed `HandlerDiffOptions`, `HandlerPlanOptions`, `MusicExecutionConfig` types. Renamed `MusicExecutor` to `MusicPipeline`. Removed legacy planner functions (`createMusicPlan`, `planVideoSync` and related helpers).

  **New:** `MusicSyncConfig`, `VideoSyncConfig`, `MusicTrackClassifier`, `VideoTrackClassifier`, `MusicOperationFactory`, `MusicOperation`, `VideoOperation`, `BaseOperation` types. Handlers now own their operation types via `TOp` type parameter on `ContentTypeHandler`.

- [`7bf7127`](https://github.com/jvgomg/podkit/commit/7bf7127d3141ce4b91138e3284b18aa5e8ea5984) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify sync-engine error and warning handling (architecture sweep)

  Settles error and warning responsibilities across the sync engine. Hard
  failures throw typed errors that carry their own category; soft signals
  flow through an injected `WarningSink` and surface alongside hard errors
  in `SyncOutput.warnings`. `console.warn` / `console.error` is now banned
  in core.

  See `documents/architecture/sync/error-handling.md` for the full
  responsibility model.

  ## Breaking API changes

  ### Types
  - **`SyncWarning` and `ExecutionWarning` types removed.** Replaced by a
    single `Warning` type with `phase: 'plan' | 'execute'`. Track
    references are now structured (`WarningTrackRef = {artist, title, album?}`)
    rather than a mix of `CollectionTrack[]` and an inline object.

    ```ts
    // before
    import type { SyncWarning, ExecutionWarning } from '@podkit/core';
    // after
    import type { Warning, WarningPhase, WarningType, WarningTrackRef } from '@podkit/core';
    ```

  - **`SyncPlan.warnings`** is now `Warning[]` (always `phase: 'plan'`).
  - **`ExecuteResult.warnings`** is now `Warning[]` (always `phase: 'execute'`).
  - **`CollectionAdapter.getPlanWarnings?()`** now returns `Warning[]`.

  ### New types
  - **`Warning`, `WarningPhase`, `WarningType`, `WarningTrackRef`,
    `WarningSink`** — the unified warning surface.
  - **`CategorizedSyncError`** — abstract base class for all typed sync
    errors. Subclasses declare `readonly category: ErrorCategory` so the
    pipeline's categorizer reads it off the class instead of inspecting
    the message body.
  - **`DatabaseWriteError`** — wraps libgpod failures at the
    `IpodAdapter` boundary so iTunesDB errors categorize as `database`
    (no retry) rather than falling through to op-type fallback.
  - **`PictureWriteError`**, **`MoveError`** — typed siblings of the
    existing `TagWriteError` / `SidecarWriteError`, now also extending
    `CategorizedSyncError`.

  ### `DeviceAdapter` contract
  - New optional **`setWarningSink(sink: WarningSink): void`** method.
    Adapters that emit execute-phase warnings (`IpodAdapter`,
    `MassStorageAdapter`) must implement it. The pipeline injects its
    accumulator sink at execute start.

  ## Breaking CLI JSON output changes

  The `sync` command's JSON output replaces the prior two warning fields
  with a single unified array:

  ```diff
  {
    "success": true,
  - "planWarnings": [{ "type": "lossy-to-lossy", "message": "...", "trackCount": 2, "tracks": [...] }],
  - "executionWarnings": [{ "type": "artwork", "track": "Artist - Title", "message": "..." }]
  + "warnings": [
  +   {
  +     "phase": "plan",
  +     "type": "lossy-to-lossy",
  +     "message": "...",
  +     "trackCount": 2,
  +     "tracks": [{"artist": "...", "title": "...", "album": "..."}]
  +   },
  +   {
  +     "phase": "execute",
  +     "type": "artwork",
  +     "message": "...",
  +     "trackCount": 1,
  +     "tracks": [{"artist": "...", "title": "...", "album": "..."}]
  +   }
  + ]
  }
  ```

  Filter by `warning.phase` to recover the prior split. Track refs
  inside warnings are now structured objects rather than pre-formatted
  strings — consumers can format them as they wish.

  ## Behaviour fixes
  - **Execute-phase warnings now surface in `--json`.** The
    `executionWarnings` field was declared on `SyncOutput` but never
    populated by the CLI's real-run path — artwork extraction failures,
    iPod portable tag-write misses, and mass-storage vanished-relocate
    events were accumulated by the pipeline and silently dropped before
    reaching JSON. They now appear in the unified `warnings` array.
  - **`IpodAdapter` mutators (`addTrack`, `updateTrack`, `removeTrack`)
    wrap libgpod failures in `DatabaseWriteError`.** Without the wrap,
    libgpod errors during these mutators would categorize as `copy` via
    the op-type fallback and retry once. iTunesDB failures now correctly
    categorize as `database` (no retry).
  - **Mass-storage picture-write stage normalized to collect-and-aggregate.**
    Was `Promise.all` fail-fast with an untyped rejection; now
    `runWithConcurrency` + settled-all + `PictureWriteError` + map-cleared-
    before-throw, matching the tag-write stage convention.
  - **CLI text-mode now prints an execute-phase warning summary** at the
    end of a real sync run (grouped by warning type; expand with `-v`).
    Previously these warnings were invisible to text-mode users.

  ## New text-mode CLI behaviour

  A new `Warnings:` block appears in the sync summary when execute-phase
  warnings landed during the run:

  ```
  === Summary ===

  Synced 152 items successfully
  Duration: 8m 14s

  Warnings: 3
    artwork: 2
    tag-write: 1
    (re-run with -v for details)
  ```

- [`de325a3`](https://github.com/jvgomg/podkit/commit/de325a3fb4227a6c8b02b2cf7c8ab6c6564b89fa) Thanks [@jvgomg](https://github.com/jvgomg)! - Sync now refuses an unidentified iPod instead of silently degrading to a "generic iPod"

  When an iPod's model cannot be resolved from its on-disk identity, sync previously warned and continued, treating the device as a generic iPod — risking the wrong artwork format or an incompatible database without the user knowing. Sync now stops with a typed `UNKNOWN_IPOD_MODEL` error before any database open or transcoding, and tells the user how to fix it: set the iPod up once over USB (`podkit device add` with the device connected — in Docker, pass the USB device through once), or run `podkit doctor --repair sysinfo-extended` to write the identity from firmware. After setup, later syncs need only the mounted volume.

  This is a deliberate behavior change on host and Docker alike, and it makes the background daemon correct for free: because the daemon shells out to `sync`, it now refuses unsetup devices rather than mangling them. The decision lives in a pure, table-tested guard (`assertKnownIpodModel`) so the failure is deterministic and easy to reason about.

- [`c0cf379`](https://github.com/jvgomg/podkit/commit/c0cf3795564dc438131bf03104b621b5b149c682) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit sync` refuses a blank iPod with a distinct `IPOD_NEEDS_INIT` error

  A mounted iPod with no database (never initialised) previously failed at the database-open step with the overloaded `IPOD_OPEN_FAILED` code, indistinguishable from a corrupt database. Sync now detects the missing iTunesDB before opening and refuses with a typed `IPOD_NEEDS_INIT` error whose remediation points at `podkit device init`. JSON consumers branching on the error code for blank devices should switch from `IPOD_OPEN_FAILED` to `IPOD_NEEDS_INIT`.

- [`9b5fabb`](https://github.com/jvgomg/podkit/commit/9b5fabb5a356cbaea52ed6f802d15099516ace0d) Thanks [@jvgomg](https://github.com/jvgomg)! - Make the sync tag the sole quality truth for audio, and add `--force-sync-tags-transcode`.

  A track that podkit did not encode (no sync tag) is now left alone by ordinary syncs: it is opted out of bitrate/encoding re-checks rather than guessed from the unreliable iPod database bitrate. This removes the old DB-bitrate + tolerance fallback, so upgrading with a library of untagged tracks no longer triggers a surprise re-encode storm.

  To deliberately bring untagged tracks into line, use the new `--force-sync-tags-transcode` flag: it re-encodes untagged matched tracks to the device's quality target and writes the authoritative sync tag (bitrate + encoding). This is the only path where a missing sync tag triggers a re-encode — it is explicit and destructive, never automatic. `--force-sync-tags` keeps its existing tag-only, non-destructive behaviour; when both flags are passed, the transcode flag wins for untagged tracks.

  The `bitrateTolerance` flat setting and the `toleranceUp` / `toleranceDown` per-direction fields are removed. The source-proximity tolerance is now `[bitrate].tolerance` (a single fraction, default 0.25), controlled via `--bitrate-tolerance` or `PODKIT_BITRATE_TOLERANCE`.

- [#59](https://github.com/jvgomg/podkit/pull/59) [`1ec30ac`](https://github.com/jvgomg/podkit/commit/1ec30acca1109178012db3913a60967a2087fb5b) Thanks [@jvgomg](https://github.com/jvgomg)! - Automated iPod device identification via SysInfoExtended.

  Modern iPods (post-2006) ship without a populated `SysInfo` file after iTunes restore. Without it, libgpod treats the device as generic — artwork breaks, ALAC support is unknown, and database checksums fail on Classic 6/7G and Nano 3G+. podkit now reads SysInfoExtended directly from iPod firmware over USB during `device add`, so first-time setup works with no manual tooling.

  **User-visible:**
  - `podkit device add` identifies the exact model (e.g. "iPod nano 8GB Black (3rd Generation)") with no input
  - `podkit doctor` detects missing SysInfoExtended and offers `--repair sysinfo-extended`
  - `podkit sync` works correctly on first run with full capability detection
  - Hash72 (Nano 5G) and HashAB (Nano 6G) devices get clear limitation messages
  - SysInfoExtended write is gated on user confirmation during `device add`

  **Core (`@podkit/core`):**
  - Unified iPod model registry — single table, both `0x120x`/`0x126x` USB ID ranges, 190+ serial-suffix → model mappings, checksum-type classification per generation
  - `ensureSysInfoExtended()` orchestrator: check existing → USB read → validate XML → write
  - USB discovery now exposes `serialNumber`, `busNumber`, `deviceAddress`; `resolveUsbDeviceFromPath()` on macOS + Linux
  - Readiness pipeline: checksum-aware severity (hash58+ devices fail without SysInfoExtended; pre-checksum devices warn)
  - `READINESS_RULES` declarative array replaces ad-hoc `determineLevel()` logic
  - New `sysinfo-extended` diagnostic check
  - Recognizes `P` / `F` model prefixes in SysInfo

  **libgpod-node (`@podkit/libgpod-node`):**
  - `readSysInfoExtendedFromUsb()` N-API binding, resolved via `dlsym` at runtime so it loads gracefully on systems where libgpod lacks the symbol
  - Prebuild patches upstream libgpod 0.8.3 to move `itdb_usb.c` from `tools/` into the library; libusb 1.0.27 built from source on all 6 platforms
  - `--whole-archive` / `-force_load` linker flags preserve the dlsym symbol in the `.node` binary

  **CLI (`podkit`):**
  - `device add` attempts SysInfoExtended read after mount, before DB init; enriches model name in summary
  - `doctor` adds suggested-actions section, drops destructive sysinfo guidance
  - `device scan` and `doctor` show clearer SysInfo readout

- [`c5cba69`](https://github.com/jvgomg/podkit/commit/c5cba6998283663b42659f02b17b194ab256c137) Thanks [@jvgomg](https://github.com/jvgomg)! - Polish on the convergent-metadata work (TASK-327 follow-up):
  - **Tag-write concurrency cap.** `save()` now caps in-flight tag writes at 16 via a small `runWithConcurrency` helper instead of firing every pending write at once. Avoids `EMFILE` on large libraries.
  - **Aggregated tag-write errors.** Failure messages now begin with `tag write failed` so the executor's error categorizer classifies them as file-I/O (`copy`) rather than risking a path-keyword mis-classification.
  - **WAV/AIFF on mass-storage.** Podkit transcodes WAV and AIFF source files to a managed codec before placing them on a mass-storage device, even when the device firmware can play them. RIFF/IFF tag-writing is unreliable. Presets continue to list these codecs for documentation. iPod is unaffected (libgpod / iTunesDB handle metadata for WAV/AIFF).
  - **OGG Vorbis tag round-trip tests.** Now run on builds with libvorbis (skipped automatically when absent).
  - **Shared TagFields helpers.** `buildTagFieldsFromInput` and `diffTagFields` replace three duplicate field-by-field walks across adapters.
  - **`TransferMode` type unified.** Removed `'fast' | 'optimized' | 'portable'` duplication between `DeviceTrackInput`, `DeviceTrackMetadata`, and the canonical `TransferMode` in `transcode/types.ts`. Drops several inline type casts.
  - **Docs.** `transferMode` now has a dedicated section in `docs/reference/config-file.md` explaining the iPod vs mass-storage contract and migration churn. `pathTemplate` (from the prior release) and `PODKIT_PATH_TEMPLATE` are now documented in the config reference and environment-variables reference.

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

- [`ec8dc85`](https://github.com/jvgomg/podkit/commit/ec8dc8549447b0178a8746b8cda2b8b7908b9d04) Thanks [@jvgomg](https://github.com/jvgomg)! - Unify the unsupported-device UX across `podkit device add`, `device scan`, `device info`, `sync`, and `doctor`. Every command now composes identity via the same cascade primitive (`resolveIpodModel(bag)`) — no command re-implements the check, no command leaks `libgpod` into user-facing copy.

  Key behaviour changes:
  - `device add` on an unsupported device (hashAB nano, etc.) now asks "Add anyway? [y/N]" rather than hard-refusing. Confirmed devices are recorded with `unsupported: true` in config; `--yes` flips the default to accept.
  - `device add` against an iOS device (iPod touch) now surfaces the canonical unsupported message instead of the generic "No iPod devices found".
  - `device scan` headers show the resolved model name (e.g. "iPod touch 5th generation") instead of "Unknown iPod (USB only)".
  - `sync --dry-run` refuses cleanly on unsupported devices with the canonical message — no track plan generated.
  - `sync` on a supported device with SysInfoExtended present resolves identity via the cascade; the legacy "Could not identify iPod model" warning is gone for that case.
  - `device info` renders the cascade `displayName` instead of the libgpod-derived `info.device.modelName`.
  - `doctor` on an unsupported device suppresses repair suggestions that would mutate device state and surfaces the canonical unsupported message instead.

  Wording is centralised in `@podkit/core` (`makeUnsupportedReasonFromAssessment` / `makeUnsupportedReasonFromModel`) — every consumer imports.

- [`e825ee1`](https://github.com/jvgomg/podkit/commit/e825ee1dd4933ecbfd070dda27f96f43056f0baf) Thanks [@jvgomg](https://github.com/jvgomg)! - Replace koffi-based libusb FFI with the `usb` npm package for USB firmware inquiry, eliminating the runtime libusb system dependency.

  The `@podkit/ipod-firmware` USB transport now uses the `usb` npm package, whose prebuilt N-API bindings statically link libusb. End-user binaries embed that prebuild via Bun `--compile`; no system `libusb-1.0` is required at runtime. The Linux prebuilds do dynamically link `libudev.so.1` — this is present on standard glibc distributions, and the Docker image installs `eudev-libs` for Alpine/musl.

  Public-surface changes in `@podkit/ipod-firmware`:
  - **Removed:** `loadLibusb`, `LibusbBinding`, `LibusbPtr`, `LibusbLoadResult`, `_resetLibusbCacheForTests`. The koffi-shaped binding interface is gone.
  - **Added:** `loadUsb`, `UsbBinding`, `UsbDeviceHandle`, `UsbLoadResult`, `_resetUsbCacheForTests`. Higher-level `withOpenDevice(bus, devnum, fn)` seam — implementations handle enumeration, open, and cleanup internally.
  - **Added:** `setLogger(fn | null)`, `FirmwareLogger`, `FirmwareLogEvent`. Library no longer writes to stderr/stdout; consumers install a receiver and decide format/destination. The CLI installs one when `-v` is passed.
  - **Added:** `@podkit/ipod-firmware/bundler-plugin` subpath export with `usbNativeBundlerPlugin(stagedNodePath)` for single-file binary builds. This is a build-time `Bun.build` plugin — it intercepts the `node-gyp-build` specifier at bundle time so Bun can statically embed the `.node` binary; a runtime require-hook approach cannot work in Bun-compiled binaries. See `agents/ipod-firmware.md` for the staging recipe.
  - **Renamed:** `UsbInquiryError.libusbCode` → `UsbInquiryError.libusbStatus`. The new field carries `LIBUSB_TRANSFER_*` status codes (positive enum) from the `usb` npm package, not the negative `LIBUSB_ERROR_*` codes the koffi path returned.

  Doctor's `inquiry-methods` check no longer reports libusb availability — the USB transport is bundled and always present in shipped binaries. The check now reports SCSI transport availability only, which remains user-actionable on Linux (udev permissions) and macOS (iPodDriver.kext).

- [`72fd2c8`](https://github.com/jvgomg/podkit/commit/72fd2c8521cfa8f8d7102a6d1707d8282f67e6d2) Thanks [@jvgomg](https://github.com/jvgomg)! - Add user-defined mass-storage device presets via the new `[presets.<id>]` config section.

  Declare a custom DAP in `~/.config/podkit/config.toml`:

  ```toml
  [presets.my-walkman]
  extends = "generic"
  manufacturer = "Sony"
  productName = "NW-A105"
  supportedAudioCodecs = ["aac", "flac", "mp3"]
  artworkMaxResolution = 240
  musicDir = "MUSIC"
  ```

  Then add a device that uses it:

  ```sh
  podkit device add -d walkman --type my-walkman --path /Volumes/MyWalkman
  ```

  `--type` previously rejected any value that wasn't `ipod`, `echo-mini`, `rockbox`, or `generic`. It now also accepts any preset id declared in the config. Built-in ids remain authoritative; `[presets.echo-mini]` collisions are refused at load time.

  `device list`, `device info`, sync, and doctor mass-storage paths consult the merged registry so user-preset content-path and capability defaults flow through correctly. Two devices typed to the same user preset id resolve independently — they share the preset baseline but per-device overrides apply on top.

  When a user preset declares `wav` or `aiff` in `supportedAudioCodecs`, the loader emits the same warning that `[devices.X]` overrides already produce: podkit transcodes sources in those formats rather than direct-copying.

### Patch Changes

- [`bb2e637`](https://github.com/jvgomg/podkit/commit/bb2e6374151605d11baf052c452f10a842e5353e) Thanks [@jvgomg](https://github.com/jvgomg)! - Externalize `koffi` and `usb` from the published `bun build` bundles. Koffi loads its native binding via `eval('require')(filename)`; bun's bundler shims top-level `require` as `__require` (via `createRequire(import.meta.url)`) but does not inject `require` into eval'd literals, so the bundled CLI hit `ReferenceError: require is not defined` whenever the SCSI inquiry path was actually reached. The native loaders are now resolved at runtime via `node_modules`, which is also more correct for `usb` (whose `bun build`-time prebuild only matched the build host's platform).

  The standalone-binary path (`bun --compile` via `compile.sh`) is unchanged — it stages platform-specific `.node` files and uses static `require()` in `compile-entry.js`, which works correctly. A bug in `compile.sh`'s linux-arm64 branch is also fixed: the script previously constructed `linux-arm64/node.napi.${USB_VARIANT}.node` (where `USB_VARIANT` is `glibc` or `musl`) but the `usb` package only ships `linux-arm64/node.napi.armv8.node` — no glibc/musl split exists for arm64. The script now selects the armv8 prebuild unconditionally on arm64.

  `@podkit/ipod-firmware` is also externalized from the `@podkit/core` and `@podkit/devices-ipod` builds, so neither package's `dist/index.js` re-inlines firmware (and therefore koffi/usb imports). Bundle content-check tests under `packages/*/src/bundle.test.ts` assert that no `eval("require")` slips into any published bundle.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`0ef210b`](https://github.com/jvgomg/podkit/commit/0ef210be6e5fc38203e5501d33cc1bb978ecc0c6) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `--clean-artists` / `--no-clean-artists` / `--clear-clean-artists` options to `podkit device set`

  The clean artists transform can now be toggled per-device from the CLI instead of requiring manual config file edits.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`56c7ec3`](https://github.com/jvgomg/podkit/commit/56c7ec36fb00b6996beffdce76eb17a23211c628) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix shell completions namespace conflict when multiple podkit binaries are installed.

  The `--cmd` flag now derives the completion function prefix from the binary name (`podkit-dev` → `_podkit_dev`), so `podkit` and `podkit-dev` each get an isolated namespace and their completion scripts no longer clobber each other. The `podkit-dev` binary built via `install:dev` now reports a `-dev` version suffix.

- [`348f2c5`](https://github.com/jvgomg/podkit/commit/348f2c53cec06598903b5cf128663d5121c46865) Thanks [@jvgomg](https://github.com/jvgomg)! - Redesign `podkit device add` to be slick and informative. Previously, plugging in a post-2006 iPod (nano 2G, nano 7G, iPod 5G) and running `device add` displayed the device as `Model: Invalid` (libgpod's wording for an empty SysInfo file) and instructed the user to manually write a SysInfo file with `ModelNumStr: MA147` — neither friendly nor accurate.

  The new flow:
  1. **Identity is cascade-resolved** from USB product ID, classic SysInfo, SysInfoExtended, and serial — whichever sources are available. Display reads `Found iPod nano (2nd Generation):` rather than `Model: Invalid`.
  2. **A single combined prompt** asks `Add this iPod as "X" and write SysInfoExtended? [Y/n]` when SysInfoExtended is missing and USB is reachable. Confirming triggers firmware inquiry, writes SysInfoExtended, and persists to config in one step.
  3. **Capabilities are derived from the cascade-resolved generation**, not from libgpod's pessimistic fallback. Negative capabilities cite the reason (`- Video (not supported on iPod nano 4GB Green (2nd Generation))`).
  4. **The follow-up tip** suggests `podkit sync -d <name> --dry-run`, not "go run two more commands".

  New flag `--no-firmware-inquiry` skips the firmware fetch+write when used with `--yes` — for the case where the user wants to defer the write or doesn't have the device connected over USB.

  Internal API changes in `@podkit/core`:
  - **Added** `assessIpodIdentity(mountPoint, opts?)` returning `IpodIdentityAssessment` — pure cascade-driven assessment (no writes). Combines all available identification sources and returns `{ model, capabilities, firmwareInquiry: 'present' | 'missing' | 'unwritable', needsChecksum }`. The CLI now composes from this primitive instead of reaching into libgpod for identity.

  The misleading `device-validation.ts` warning text (`Ensure /Volumes/X/iPod_Control/Device/SysInfo exists with your model number (e.g., "ModelNumStr: MA147")`) has been replaced with a pointer to the canonical fix: `podkit doctor --repair sysinfo-extended`.

- [`6db8fb0`](https://github.com/jvgomg/podkit/commit/6db8fb0c587cfd9e350516631b2030f165c542ce) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit device add` now refuses cleanly when an iPod's volume UUID can't be read, with a clear message + structured error code (`VOLUME_UUID_REQUIRED`). Previously a synthetic `manual-...` UUID could be persisted in config, which then broke replug detection and `podkit doctor -d <name>` lookups. Most-common cause (HFS+ on Linux) was already addressed in TASK-317.12; this is the defensive catch-all for any remaining edge cases (corrupt partition tables, unusual layouts).

- [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6) Thanks [@jvgomg](https://github.com/jvgomg)! - P4 — device-capability architecture complete. All in-tree migration finished; deprecated shims removed.

  **Breaking changes in `@podkit/core`:** The following symbols have been removed from the public API: `createIpodCapabilities`, `LibgpodDeviceInfo`, `DEVICE_PRESETS`, `DevicePreset`, `getDevicePreset`, and `resolveDeviceCapabilities`. Callers must migrate before upgrading.

  Migration guide:
  - `createIpodCapabilities(libgpodInfo)` → `resolveCapabilities(identity)` (preferred, identity-driven) or `resolveIpodModelCapabilities(modelFromLibgpodInfo(libgpodInfo))` for callers that genuinely hold libgpod data.
  - `getDevicePreset(deviceType)` → `BUILT_IN_PRESETS[deviceType]` from `@podkit/devices-mass-storage`.
  - `DEVICE_PRESETS` → `BUILT_IN_PRESETS` from `@podkit/devices-mass-storage`.
  - `resolveDeviceCapabilities(type, overrides)` → `resolveCapabilities(identity, { overrides })` from `@podkit/core`.
  - The `core/device/sysinfo-extended` shim path is gone; import `readSysInfoExtended`, `writeSysInfoExtended`, and `ensureSysInfoExtended` from `@podkit/ipod-firmware` directly.

  See ADR-295.07 for the full architectural rationale.

  **New in `@podkit/ipod-firmware`:** SysInfoExtended file I/O is now owned by this package: `readSysInfoExtended`, `writeSysInfoExtended`, `ensureSysInfoExtended`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR`. Diagnostic helpers `compareSysInfoConsistency` and `normaliseFireWireGuid` are also exported. `ParsedFirmware` gains the optional `modelNumber` field (populated from the `ModelNumStr` plist key when present).

  **New in `@podkit/device-types`:** `IpodModel`, `IpodChecksumType`, `IpodGenerationId`, `IpodGenerationIdLike`, `IpodModelSource`, and `IPOD_GENERATION_IDS` are now exported from this package (canonical home). `UsbConnectionInfo` has been removed — use `UsbFingerprint` instead. `IpodIdentity.notSupportedReason` is added for devices identified as iPods that podkit cannot fully support (e.g. iOS-mode devices). `DeviceCapabilities.artworkMaxResolution` is now `number | null` (null when the generation has no known limit or artwork is unsupported).

  **In `@podkit/devices-ipod`:** `IpodGeneration.supported` and `IpodGeneration.artworkMaxResolution: number | null` are new fields on every generation entry. `lookupByFamilyId` and `FAMILY_ID_TO_GENERATION` are now exported. `unsupported.ts` is populated with comprehensive Apple iOS device PIDs to allow early rejection of phones and tablets at the USB identification stage.

  No user-facing CLI behaviour changes. `podkit device scan`, `podkit device info`, and all sync paths behave identically to P3.

- [`adce04e`](https://github.com/jvgomg/podkit/commit/adce04e1f38e980eb6d6e41244abf208ded44bf3) Thanks [@jvgomg](https://github.com/jvgomg)! - Container startup reports its device access with actionable guidance

  Every container start now prints a `Device access:` report: whether an iPod volume is mounted at `/ipod` (path-based sync), whether `/dev/bus/usb` is present (one-time `device add` USB setup), and whether `/dev/sg*` nodes exist — each missing item with guidance on what to do about it, and the path-baseline case clearly distinguished from the USB-setup case. The report is informational and never blocks startup; a path-only setup legitimately has no USB. The logic lives in a new internal CLI helper (`podkit __container-probe`) so it is unit-tested rather than baked into bash.

- [`a78e5fe`](https://github.com/jvgomg/podkit/commit/a78e5fee4e47293c1935395bb157cb6574782625) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix three `podkit doctor` repair correctness bugs:
  - `--repair sysinfo-consistency` now overwrites a stale on-disk SysInfoExtended (previously short-circuited on file existence, reporting success without rewriting).
  - `--repair sysinfo-extended` no longer requires an existing iTunesDB — repairs without a `database` requirement skip the DB open so identity-populating repairs work on freshly formatted iPods. New `'database'` value on `RepairRequirement`.
  - The readiness `SysInfoExtended:` status line distinguishes a missing file from a present-but-unparseable one.

- [`785ad57`](https://github.com/jvgomg/podkit/commit/785ad57af6627059fe3a6d7e1fef475e82c34764) Thanks [@jvgomg](https://github.com/jvgomg)! - `podkit doctor` (artwork-rebuild repair) now runs a per-track source-file validity probe (stat + 16-byte magic-byte header check) before the album-cache lookup. Corrupt or unreadable source files always land in the `errors` bucket with a structured reason (`missing | unreadable | truncated | badMagic`) rather than inheriting a sibling track's cache success non-deterministically.

  The `details.errorDetails[*]` in doctor's JSON output now carries optional `path` and `reason` fields so users can act on specific bad files. Backward-compatible: existing `artist` / `title` / `error` fields are preserved.

  Magic-byte signatures cover FLAC, OGG/Opus, MP3 (ID3 and bare MPEG sync), MP4/M4A/AAC, WAV, AIFF/AIFC — matching the directory adapter's accepted extensions.

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

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Correct the FamilyID → generation table from real hardware.

  FamilyID 12 is the iPod nano 3G, not the iPod touch 1G. An affected nano — one whose serial suffix is not in the serial table, so the FamilyID axis decides — was refused by `podkit sync` with a message claiming it used Apple's proprietary sync protocol, and that refusal could not be overridden. It now resolves as a syncable nano 3G.

  FamilyID 17 is the iPod nano 6G, not the iPod Classic 7G — read from firmware on a connected nano 6G. This one pointed the wrong way round: the Classic 7G is syncable and the nano 6G is not, so a nano 6G whose serial suffix was unmapped would have been treated as a device podkit could write to. The Classic 7G's FamilyID is simply unknown and is no longer guessed.

  Also corrected: the shuffle band now carries its hardware values (130 → shuffle 2G, 132 → shuffle 3G, 133 → shuffle 4G), replacing four research guesses that had placed shuffles among the click-wheel FamilyIDs. Every iPod touch entry is removed — an iOS device has no disk mode and never emits the SysInfoExtended those values would have to come from, so they were unobtainable by construction; touches continue to be recognised and refused by USB product ID. The iPod shuffle 3G's support record is promoted from `inferred` to hardware-verified.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Record where every FamilyID value came from, and stop unverified ones from naming devices podkit refuses.

  The FamilyID table now carries provenance per entry — `{ generation, evidence: 'hardware' | 'inferred', source }` — so a value read off a real device is distinguishable in the data from one taken from a community SysInfo dump, rather than in a comment block that drifts. Three invariants are enforced by tests so a bad row fails at commit time: FamilyID bands must match device class (`< 100` click-wheel, `100–999` shuffle, `>= 10000` iOS), an inferred value must fall inside the release-date window its neighbouring hardware anchors leave open, and an inferred value may only name a `syncable` generation — a guess may open a door, never close one. The band rule alone would have rejected eleven of the table's original entries.

  Six values whose numbers the hardware anchors contradict are removed: 4 (iPod Photo), 5 (mini 1G), 7 (Classic 6G), 8 (nano 1G), 24 (nano 6G) and a duplicate 13 (nano 3G — hardware puts the nano 3G at 12, twice over). These now fail closed with an honest unknown-model error naming the inputs, which is safer than a confident wrong answer that suppresses it.

  **Breaking (`@podkit/devices-ipod`):** `FAMILY_ID_TO_GENERATION: Record<number, IpodGenerationId>` is replaced by `FAMILY_ID_TABLE: Record<number, FamilyIdEntry>`. `lookupByFamilyId(familyId)` is unchanged and still returns an `IpodGenerationId | undefined`; the new `lookupFamilyIdEntry(familyId)` returns the entry with its evidence, for callers that want to render confidence rather than branch on it.

  **Also breaking (`@podkit/devices-ipod`):** `getUnsupportedReasonByLibgpodName()` and the `UnsupportedGenerationKind` type are removed. They categorised a device from libgpod's view of its generation; nothing categorises that way any more, because the identity cascade resolves a generation first and the refusal reason is derived from podkit's own generation table, which knows the access tier and why.

- [#58](https://github.com/jvgomg/podkit/pull/58) [`1caab19`](https://github.com/jvgomg/podkit/commit/1caab1991d43739aaba3d9ae2e4a5dd6575f331a) Thanks [@jvgomg](https://github.com/jvgomg)! - Hard error on invalid `--fields` names with message listing valid fields; valid fields now listed in `--help`

- [#58](https://github.com/jvgomg/podkit/pull/58) [`3fe7853`](https://github.com/jvgomg/podkit/commit/3fe785330f8b92c21159ae253456942a92e7c8e2) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix stdout truncation when piping CLI output to another process. Commands that used `process.exit(1)` could terminate before stdout buffers flushed, truncating JSON output (e.g. `podkit init --json | node -e ...`). All error exit paths now use `process.exitCode = 1` and return normally, allowing Node.js to drain streams before exiting.

- [`26733cc`](https://github.com/jvgomg/podkit/commit/26733cc77fd56681387b29e4241ad05e4d1fd348) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix blank source path in sync output for subsonic collections

- [#58](https://github.com/jvgomg/podkit/pull/58) [`e58ae80`](https://github.com/jvgomg/podkit/commit/e58ae806a494e3f526a828d4b72dab558ae4b121) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix config not found when running `podkit` under `sudo`. The default config path now resolves the invoking user's home directory via `SUDO_USER`/`DOAS_USER` and `/etc/passwd`, rather than using root's home.

- [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix iPod model identification regressing to "Unknown iPod" after `doctor --repair sysinfo-extended` on pre-2006 devices (mini 2G), and tighten the package-boundary contract so consumers compose identity instead of injecting resolution policy.

  The bug: each consumer of `ensureSysInfoExtended` / `readSysInfoExtended` passed a serial-only `resolveModel` callback. When the 3-character serial suffix wasn't in `tables/serials.ts`, the resolver returned undefined and the device was displayed as "Unknown iPod" — even when a SysInfo file with a known `ModelNumStr` was sitting next to the SysInfoExtended on disk.

  The fix:
  - **Removed** `ModelResolver` type and the `resolveModel` callback from `@podkit/ipod-firmware`. `readSysInfoExtended` and `ensureSysInfoExtended` now return a flat `SysInfoIdentity` bag (`firewireGuid?, serialNumber?, modelNumStr?, familyId?`). When a SysInfo file is on disk alongside SysInfoExtended, its `ModelNumStr` is read opportunistically.
  - **Callers compose** with `resolveIpodModel(bag)` from `@podkit/devices-ipod`, which cascades modelNumStr → serial → productId → familyId → libgpodGeneration. The CLI no longer makes resolution decisions.
  - **Added** `SYSINFO_PATH`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR` exported from `@podkit/ipod-firmware` and re-exported from `@podkit/core`. Consumers use these constants instead of duplicating the literal `iPod_Control/Device/...` paths.
  - **Added** `S4G: '9804'` entry to `tables/serials.ts` (mini 2G 4GB Pink, sourced from real hardware, serial `JQ5141TFS4G`).
  - **Post-write enrichment.** After `ensureSysInfoExtended` writes the file via USB inquiry, it now re-reads via `readSysInfoExtended` so the post-write identity bag includes `modelNumStr` from the SysInfo neighbour. Eliminates the cosmetic regression where the repair-success message showed a less-specific name than the subsequent `doctor` run.

- [`eed4126`](https://github.com/jvgomg/podkit/commit/eed4126fe91ff64f00d74e8a2aaaae38ca6d786b) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve the firmware-inquiry orchestrator's failure message so users can see what went wrong without `-vv`. The default error now names every transport attempted (USB, SCSI) with each one's failure reason on its own line and includes a remediation hint (e.g. `podkit doctor --repair udev-rule` for EACCES on `/dev/sg*` or `/dev/bus/usb/...`). The orchestrator also no longer short-circuits a planned SCSI fallback when USB hits a permission wall — both transports run if the plan calls for it.

- [`151152a`](https://github.com/jvgomg/podkit/commit/151152ae835529730b3235a780550ec35ad685e2) Thanks [@jvgomg](https://github.com/jvgomg)! - macOS regression coverage for the m-18 TASK-317.\* hygiene cluster. Extends the test surface so the macOS-platform code paths that ship today (HFS+ supported, `system_profiler` `bsd_name` partition-suffix handling, `sysinfo-modelnum-mismatch` diagnostic framework, unsupported-cascade suppression, doctor section ordering and visibility, JSON envelope shape, TOML round-trip) all have explicit pinned assertions.

  Foundation: `DevicePersona` now carries an optional `platformDeviceInfoDarwin?: PlatformDeviceInfo[] | null` field, and `ipodMacosPlatformInfo(opts)` in `@podkit/device-testing/personas/builders` synthesises canonical macOS-shape records. Populated on `ipodMini2gPink` (FAT32) and `ipodNano4gHfsplus` (HFS+) as representative fixtures.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - iPod nano 7th gen is now read and archived instead of refused outright.

  The generation table marked nano 7G `access: 'none'` on the claim that it had no entry in libgpod's device table, so podkit could not mount a database for it. Real hardware disagrees: podkit read 1,414 tracks off a nano 7G via libgpod's classic `iTunesCDB` parser and `podkit device archive` completed successfully. The device does carry a database podkit cannot write — but the reason is unrelated to the original claim: nano 7G uses `hashAB` checksum signing, which libgpod only computes via an external blob (`LIBGPOD_BLOB_DIR`) that podkit does not ship, so it fails closed on write.

  nano 7G is now `access: 'read-only'`, `verified: 'hardware'` — the same tier as the shuffle 3G/4G and nano 6G. `podkit device scan`, `device info`, `device music`, and `device archive` all work; `podkit sync` and `device init`/`add` still refuse, now with a reason describing the real hashAB limitation instead of a flat "not supported" message.

- [`2a644af`](https://github.com/jvgomg/podkit/commit/2a644afa386dd091e8268c8db7dac906c48e44d8) Thanks [@jvgomg](https://github.com/jvgomg)! - Fixes an infinite loop in the music sync quality-upgrade path. When a track was upgraded via direct copy (no transcode) — for example when the source bitrate increased after a re-rip — `transferUpgradeToIpod` wrote the post-encode bitrate from the preparer, which is undefined for direct copies. The file was replaced on the device but the iPod-side bitrate stayed at the previous value, so the next sync detected the same upgrade again and re-fired it indefinitely.

  The fix resolves the post-upgrade bitrate as `prepared.bitrate ?? source.bitrate` so direct-copy upgrades carry the source bitrate through. The upgrade now converges on a single sync.

  Adds a `--force-sync-tags` bitrate backfill pass for pre-existing copied tracks whose iPod-side bitrate is 0 — symmetric with the existing artwork-hash baseline backfill. New users get correct bitrate tracking on first sync; existing users opt in with `--force-sync-tags`.

  Documents the upgrade-path semantics (format-upgrade gate, quality-upgrade gate, baseline write + backfill) in `documents/architecture/sync/upgrades.md`.

- [`80fe65a`](https://github.com/jvgomg/podkit/commit/80fe65a022c65da512f571a8abf83f9385a649e6) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix SysInfoExtended SCSI-fallback on macOS for SCSI-only iPods (mini 2G, nano 2G, iPod 5G/5.5G). `device add` and `doctor --repair sysinfo-extended` now correctly fall back from USB → SCSI when the device does not respond to vendor control transfers, instead of failing with a misleading "Could not read device identity from USB" error.

  Internal API changes in `@podkit/ipod-firmware`:
  - **Changed:** `ensureSysInfoExtended(mountPoint, fp, options?)` now takes a full `UsbFingerprint` instead of the previous `{ busNumber, deviceAddress }` shape. Required so the macOS SCSI transport can locate the IOService via vendorId/productId/serialNumber. `UsbDeviceAddress` is removed.
  - **Added:** `inquireFirmwareDetailed(fp, opts?)` — like `inquireFirmware` but returns `{ firmware, plan, attempts }` so callers can distinguish which transports were attempted. `inquireFirmware` is unchanged for existing consumers.
  - **Added:** `EnsureSysInfoExtendedOptions` type with `readFromUsb`, `resolveModel`, `inquireOptions` fields. Replaces the previous positional `(mountPoint, fp, readFromUsb, resolveModel)` signature.

  Internal API changes in `@podkit/core`:
  - **Added:** `hasCompleteUsbFingerprint(fp): fp is CompleteUsbDevice` type guard exported from `@podkit/core`.
  - **Added:** `CompleteUsbDevice` type — a `UsbFingerprint` with vendorId, productId, bus, devnum guaranteed present (serialNumber optional).
  - **Changed:** `resolveUsbDeviceFromPath(path)` now also returns `vendorId` and `productId`. Linux extracts from sysfs `idVendor`/`idProduct`; macOS extracts from `system_profiler` JSON.

  User-facing error messages now differentiate between transport failures: "Could not read device identity from USB and SCSI" / "...from USB" / "...from SCSI" / "...no firmware inquiry transport is available on this system" / "...returned data but it could not be parsed".

- [`63a69d1`](https://github.com/jvgomg/podkit/commit/63a69d11160770bcc5e251c7faf14d5c8887af13) Thanks [@jvgomg](https://github.com/jvgomg)! - New `podkit doctor` check `sysinfo-modelnum-mismatch` detects when the on-disk classic SysInfo file's `ModelNumStr` disagrees with the firmware-derived identity (e.g. SysInfo manually edited, or files copied from another iPod). Offers `--repair sysinfo-modelnum-mismatch` to overwrite the on-disk file with firmware-derived data. Identified during the TERAPOD (iPod 5G with iFlash mod) inventory pass — the SysInfo claimed `MA147` (5G) while the serial said `V9M`/`A446` (5.5G).

- [#58](https://github.com/jvgomg/podkit/pull/58) [`17eac11`](https://github.com/jvgomg/podkit/commit/17eac114719f93cef40beb58381e534a28ebc35f) Thanks [@jvgomg](https://github.com/jvgomg)! - Move spinners and progress bars to stderr and auto-suppress when stdout is not a TTY. Adds `--no-tty` flag for explicit suppression. Piped output (e.g. `podkit collection music --format json | jq .`) now produces clean stdout without needing `--quiet`.

- [`cdebfb3`](https://github.com/jvgomg/podkit/commit/cdebfb3512f347356bc661722d2236b359776372) Thanks [@jvgomg](https://github.com/jvgomg)! - Extend the podkit udev rule to grant Apple-vendor USB device access (`/dev/bus/usb/<bus>/<dev>`) in addition to the existing SCSI generic (`/dev/sg*`) coverage. Linux libusb-based firmware inquiry now works without sudo from SSH sessions, headless boxes, Docker containers, and CI — the SSH-session permission gap previously closed only the SCSI half. `podkit doctor --repair udev-rule` installs the extended rule and cleans up any legacy filename from previous installs.

- [`f61a83b`](https://github.com/jvgomg/podkit/commit/f61a83b3a2d13612730f174759fd3b86edd42e82) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `podkit device scan` reporting phantom "Unknown iPod (USB only)" entries for non-iPod USB peripherals (mice, hubs, Thunderbolt docks, Ethernet adapters, USB drives). Each phantom suggested `podkit device init` — a destructive operation that could mutate an unrelated device.

  Root cause was architectural: a single `discoverUsbIpods()` function mixed three concerns — USB enumeration, iPod-domain enrichment, and the function name's implied filter (which it didn't actually do). Refactored into clean layers:
  - **`@podkit/core` — pure USB enumeration.** `enumerateUsb()` returns `EnumeratedUsbDevice[]` with vendor/product/serial/bus/devnum/diskIdentifier ONLY. No iPod-domain knowledge.
  - **`@podkit/devices-ipod` — iPod classifier.** `classifyAsIpod(dev)` returns `IpodClassification | null` (matches Apple-vendor with iPod or iOS PIDs).
  - **`@podkit/devices-mass-storage` — mass-storage classifier.** `classifyAsMassStorage(dev)` returns `MassStorageClassification | null` (matches `USB_PRESET_HINTS` entries like Echo Mini).
  - **`@podkit/core` composer.** `classifyUsbDevices()` runs both classifiers and returns recognized devices as a tagged union; drops unknown peripherals.
  - **CLI `device scan`** now calls `enumerateUsb()` → `classifyUsbDevices()` → renders by `kind`. No domain logic in the command layer.

  Added `kind: 'mass-storage'` rendering branch so mass-storage DAPs are no longer mis-labeled as "Unknown iPod".

  Removed `discoverUsbIpods` and the leaky `UsbDiscoveredDevice` type (which previously carried iPod-domain fields). Adding a new mass-storage device now means adding one entry to `USB_PRESET_HINTS` — no `@podkit/core` change required. Adding a new iPod generation means updating `@podkit/devices-ipod` tables — no other package changes.

  Also split `usb-discovery.ts` into `usb-enumeration.ts` (bus walk) + `usb-path-resolution.ts` (mount-path → fingerprint resolver) since those two concerns were unrelated.

- [`6000868`](https://github.com/jvgomg/podkit/commit/6000868830d9437a6fff3c1a77adb254d9579fe7) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `doctor --repair sysinfo-extended` showing unhelpful "Could not read device identity from USB" with no detail. The native USB binding now throws descriptive errors (e.g. "USB control transfer failed (bus 3, device 4)") instead of returning null silently. Also fix all doctor repair intro messages — they incorrectly said "Repairing X for N tracks" even for non-track operations like SysInfoExtended and orphan cleanup. Intro messages now use each repair's own description.

- [`4598f8f`](https://github.com/jvgomg/podkit/commit/4598f8f3347cf40b94fdf1585215e5b0f54d9cf6) Thanks [@jvgomg](https://github.com/jvgomg)! - USB firmware inquiry consolidated into @podkit/ipod-firmware (P2 — m-18 device-capability architecture).

  **Breaking change in `@podkit/libgpod-node`:** The `readSysInfoExtendedFromUsb` function has been removed from the package's public exports. All in-tree callers were already routed through `@podkit/ipod-firmware` since P1 — only external consumers of `@podkit/libgpod-node` who called this function directly are affected.

  `@podkit/ipod-firmware` now owns the complete firmware inquiry surface: SCSI (Linux SG_IO + macOS IOKit) and USB (direct libusb-1.0 via koffi FFI). The P1 transitional shim that delegated USB reads to libgpod-node has been replaced by a native TypeScript implementation. No API change is visible to callers of `@podkit/ipod-firmware`.

  `@podkit/libgpod-node` no longer requires libusb at build or runtime. Distro packagers can now build the native binding without `libusb-1.0-0-dev` (Debian/Ubuntu), `libusb-devel` (Fedora/RHEL), or equivalent system packages. The `itdb_usb.c` patch, the `dlsym` shim, and the libusb pkg-config dependency have all been removed from the binding.

  No user-facing CLI behaviour changes. `podkit doctor` inquiry checks, `podkit device scan`, and all sync paths behave identically to P1.

- Updated dependencies [[`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c), [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004), [`621b10a`](https://github.com/jvgomg/podkit/commit/621b10abbec3a8e369da9620733210fef4b76f99), [`89ff40c`](https://github.com/jvgomg/podkit/commit/89ff40c2adedd9fec38ae5ad0eb89b75525642f2), [`c5c0236`](https://github.com/jvgomg/podkit/commit/c5c0236c232cc3fa086fd3937b0e2fbe0f326185), [`bb2e637`](https://github.com/jvgomg/podkit/commit/bb2e6374151605d11baf052c452f10a842e5353e), [`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af), [`513173d`](https://github.com/jvgomg/podkit/commit/513173d1832bf9ca2894214e97d9d65cf02c52a5), [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db), [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b), [`0cc39d3`](https://github.com/jvgomg/podkit/commit/0cc39d3c62343591127d5c79deed2478f8dc4f60), [`22dddf4`](https://github.com/jvgomg/podkit/commit/22dddf4803f4cfd7b004d80dffd83878a68b10f2), [`484fb0e`](https://github.com/jvgomg/podkit/commit/484fb0ea63eea297f19217d1acb96163a6754b05), [`348f2c5`](https://github.com/jvgomg/podkit/commit/348f2c53cec06598903b5cf128663d5121c46865), [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384), [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`6747667`](https://github.com/jvgomg/podkit/commit/6747667049cd793fdb13e3d1bc1092651f8e969c), [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`87cb87a`](https://github.com/jvgomg/podkit/commit/87cb87aef59ad366b4c6c2b4c22f897f0b84a54a), [`01ecedd`](https://github.com/jvgomg/podkit/commit/01ecedde623ff99e94c5cbda75ff9f9c9ecef632), [`667d66b`](https://github.com/jvgomg/podkit/commit/667d66b90e0979aaff381968358f2cfc78c8e581), [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb), [`78b0c71`](https://github.com/jvgomg/podkit/commit/78b0c71b9866306aecbb96f2a0e372a86564f2fc), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`d68fccd`](https://github.com/jvgomg/podkit/commit/d68fccdcb53ac2b8bc3340570f83fece9c81d5a6), [`14d83e5`](https://github.com/jvgomg/podkit/commit/14d83e5e59eb0a8a801850de775f9fdb4c0e7aa9), [`a78e5fe`](https://github.com/jvgomg/podkit/commit/a78e5fee4e47293c1935395bb157cb6574782625), [`e0f65f4`](https://github.com/jvgomg/podkit/commit/e0f65f4b0cf4fce28138849b7a85f2c3a7c1a613), [`785ad57`](https://github.com/jvgomg/podkit/commit/785ad57af6627059fe3a6d7e1fef475e82c34764), [`4efa15c`](https://github.com/jvgomg/podkit/commit/4efa15c7e42874e9dd88ef2731230d5314d83f20), [`3db3d88`](https://github.com/jvgomg/podkit/commit/3db3d887ae2cd19d01ba2c1f00b8682e783fac84), [`7ebb7c5`](https://github.com/jvgomg/podkit/commit/7ebb7c5c0e1c7c3d549196347029d9ce660fcb8b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`34e8bf2`](https://github.com/jvgomg/podkit/commit/34e8bf2341111df1e8f85361b8047eed9f31665a), [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce), [`eed4126`](https://github.com/jvgomg/podkit/commit/eed4126fe91ff64f00d74e8a2aaaae38ca6d786b), [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4), [`09c4acd`](https://github.com/jvgomg/podkit/commit/09c4acdec349f200a649b2db15fe05345e380a7b), [`22dddf4`](https://github.com/jvgomg/podkit/commit/22dddf4803f4cfd7b004d80dffd83878a68b10f2), [`600d4c8`](https://github.com/jvgomg/podkit/commit/600d4c8ac4fd2ab76131e10f38bb88d6798fa3d9), [`30638f5`](https://github.com/jvgomg/podkit/commit/30638f5e1a51dfe935154c62367e530383e13d14), [`c0cc659`](https://github.com/jvgomg/podkit/commit/c0cc659e5b442bcc1a78fddf637fed8f40a407c3), [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f), [`56013ce`](https://github.com/jvgomg/podkit/commit/56013ce78864a9d6fd39455f9628f8a4cd1b638f), [`151152a`](https://github.com/jvgomg/podkit/commit/151152ae835529730b3235a780550ec35ad685e2), [`94c85d2`](https://github.com/jvgomg/podkit/commit/94c85d2a9d6c85875432a0ebecab540a9ebd67d7), [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`208e482`](https://github.com/jvgomg/podkit/commit/208e482db9730064a25e53e03121bdcfcbea6341), [`0f53385`](https://github.com/jvgomg/podkit/commit/0f53385dff1222f4d9bcf0e4dcdfac5b9f24e13b), [`1f83c68`](https://github.com/jvgomg/podkit/commit/1f83c685753c1ab28be36155eab5e3fa78b83a22), [`480d751`](https://github.com/jvgomg/podkit/commit/480d7510ed9953a06047c848b514dbc688048932), [`2a644af`](https://github.com/jvgomg/podkit/commit/2a644afa386dd091e8268c8db7dac906c48e44d8), [`f5d0082`](https://github.com/jvgomg/podkit/commit/f5d00829f3b1a80453bdc4f7e6599566f7f02bb3), [`4ee5e2b`](https://github.com/jvgomg/podkit/commit/4ee5e2be470a93a54c2d54bc0aab257d7b92babe), [`303c35a`](https://github.com/jvgomg/podkit/commit/303c35aea57c0f35f64481e12e5cb9298e9a5631), [`bb96778`](https://github.com/jvgomg/podkit/commit/bb96778dde9063267188b2b83535ec279cd5c550), [`7517a24`](https://github.com/jvgomg/podkit/commit/7517a2444abf629f8e032faf29c938eb74b9b51b), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`275c972`](https://github.com/jvgomg/podkit/commit/275c97295462547037e2c911c139654eb50d4af7), [`cac7fc1`](https://github.com/jvgomg/podkit/commit/cac7fc123861e97b10d31c83728a1e3f0431934e), [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd), [`7bf7127`](https://github.com/jvgomg/podkit/commit/7bf7127d3141ce4b91138e3284b18aa5e8ea5984), [`de325a3`](https://github.com/jvgomg/podkit/commit/de325a3fb4227a6c8b02b2cf7c8ab6c6564b89fa), [`c9c268e`](https://github.com/jvgomg/podkit/commit/c9c268ea4b25b39543e5c53a1928e72b4c31e0c8), [`9b5fabb`](https://github.com/jvgomg/podkit/commit/9b5fabb5a356cbaea52ed6f802d15099516ace0d), [`1ec30ac`](https://github.com/jvgomg/podkit/commit/1ec30acca1109178012db3913a60967a2087fb5b), [`80fe65a`](https://github.com/jvgomg/podkit/commit/80fe65a022c65da512f571a8abf83f9385a649e6), [`63a69d1`](https://github.com/jvgomg/podkit/commit/63a69d11160770bcc5e251c7faf14d5c8887af13), [`52894c1`](https://github.com/jvgomg/podkit/commit/52894c1977bccd51a86929debfbaa7028a19dd61), [`c5cba69`](https://github.com/jvgomg/podkit/commit/c5cba6998283663b42659f02b17b194ab256c137), [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df), [`cdebfb3`](https://github.com/jvgomg/podkit/commit/cdebfb3512f347356bc661722d2236b359776372), [`ec8dc85`](https://github.com/jvgomg/podkit/commit/ec8dc8549447b0178a8746b8cda2b8b7908b9d04), [`f61a83b`](https://github.com/jvgomg/podkit/commit/f61a83b3a2d13612730f174759fd3b86edd42e82), [`6000868`](https://github.com/jvgomg/podkit/commit/6000868830d9437a6fff3c1a77adb254d9579fe7), [`4598f8f`](https://github.com/jvgomg/podkit/commit/4598f8f3347cf40b94fdf1585215e5b0f54d9cf6), [`e825ee1`](https://github.com/jvgomg/podkit/commit/e825ee1dd4933ecbfd070dda27f96f43056f0baf)]:
  - @podkit/core@0.7.0
  - @podkit/ipod-firmware@0.1.0
  - @podkit/device-types@0.1.0
  - @podkit/devices-mass-storage@0.1.0
  - @podkit/devices-ipod@0.1.0
  - @podkit/libgpod-node@0.2.0
  - @podkit/ipod-archive@0.0.1

## 0.6.0

### Minor Changes

- [`4dd7b44`](https://github.com/jvgomg/podkit/commit/4dd7b443c9bdeaa98507d5439dd1223bbd2f82e1) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit device scan` command to discover connected iPod devices. Shows each iPod's volume name, UUID, size, and mount status — useful for finding the volume UUID needed to configure multi-device setups, especially in Docker.

- [`d19d6e3`](https://github.com/jvgomg/podkit/commit/d19d6e305cd864d188f3de377873b5a44df7e02f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `podkit doctor` command for running diagnostic checks on an iPod, and `podkit device reset-artwork` for wiping artwork and clearing sync tags. `podkit doctor` runs all checks and reports problems; `podkit doctor --repair artwork-integrity -c <collection>` repairs by check ID using the source collection. @podkit/core exports `resetArtworkDatabase` and `rebuildArtworkDatabase` primitives, and a diagnostic framework in the `diagnostics/` module built on a `DiagnosticCheck` interface (check + repair pattern). Includes a binary ArtworkDB parser and integrity checker.

- [`b698a07`](https://github.com/jvgomg/podkit/commit/b698a0765a039d130c6f913e2608f0fc00320ca0) Thanks [@jvgomg](https://github.com/jvgomg)! - Add dual progress bars to sync output showing both overall and per-file progress simultaneously. Video sync now displays total file count alongside per-file transcode percentage and speed, so users can see how far along a large sync is. Music sync uses the same layout for consistency.

- [`2873f14`](https://github.com/jvgomg/podkit/commit/2873f14aad6493d2d7dafbe344e8b5db0abc3551) Thanks [@jvgomg](https://github.com/jvgomg)! - Add graceful shutdown handling for sync and doctor commands

  Pressing Ctrl+C during `podkit sync` now triggers a graceful shutdown: the current operation finishes, all completed tracks are saved to the iPod database, and the process exits cleanly with code 130. Previously, Ctrl+C killed the process immediately, potentially leaving orphaned files and unsaved work.
  - Sync: first Ctrl+C drains the current operation and saves; second Ctrl+C force-quits
  - Doctor: repair operations save partial progress on interrupt
  - Incremental saves: the database is now saved every 50 completed tracks during sync, reducing data loss from force-quits or crashes
  - New `podkit doctor` check: detects orphaned files on the iPod (files not referenced by the database) with optional cleanup via `--repair orphan-files`

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

- [`67d1357`](https://github.com/jvgomg/podkit/commit/67d1357672016fcf6a55a20187bf8d5dbe4d3f31) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `--delete` flag removing video tracks when syncing music (and vice versa). The delete flag now only considers tracks of the content type being synced.

- [`120a7b1`](https://github.com/jvgomg/podkit/commit/120a7b1a8899ed48515bd98ce731231e94d3409f) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve `podkit doctor` orphan file reporting. Orphan detection now skips macOS `._` resource fork files that were inflating the count. Add `--verbose` output showing orphan breakdown by directory, file extension, and the 10 largest files. Add `--format csv` to export the full orphan file list for inspection.

- [`3f56a1b`](https://github.com/jvgomg/podkit/commit/3f56a1b063f821e7a0d399a497521358331577a6) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix video sync deleting and re-adding episodes with episode number 0 (e.g., S01E00)

  The `||` operator treated episode/season number `0` as falsy, converting it to `undefined`. This broke diff key matching for episode 0, causing every sync to delete and re-add the video. Changed to `??` (nullish coalescing) which only converts `null`/`undefined`, preserving `0` as a valid value.

- [`3db2bbb`](https://github.com/jvgomg/podkit/commit/3db2bbb2381a01107602380a8017624581548ecc) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix graceful shutdown during sync: Ctrl+C now reliably saves completed work to the iPod database before exiting. Previously, video sync interruptions could silently skip the database save, causing the next sync to redo already-completed work. Also fix "Force quit" appearing immediately on first Ctrl+C when running via `bun run`. Ctrl+C during read-only phases (scanning, diffing) now exits instantly instead of showing a misleading "finishing current operation" message.

- [`1c98ac2`](https://github.com/jvgomg/podkit/commit/1c98ac273e5eb3b78aa02dbc649c2f8086e5af2e) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix video sync overall progress counter incrementing on every transcode sub-progress tick instead of once per video

- [`143e314`](https://github.com/jvgomg/podkit/commit/143e31442a40489390d45d74ee953facdc243706) Thanks [@jvgomg](https://github.com/jvgomg)! - Fully detach USB device on eject so iPod disappears from Disk Utility (macOS) and system (Linux/Docker)

  Previously, eject only unmounted the volume but left the physical disk device attached. On macOS, the iPod would still appear in Disk Utility after ejecting. On Linux, the USB device could remain visible.

  Now eject resolves the whole-disk identifier and fully detaches the USB device:
  - macOS: `diskutil eject` targets the whole disk (e.g., `disk5`) instead of the volume
  - Linux: `udisksctl power-off` targets the whole disk (e.g., `/dev/sda`) and is also called after the `umount` fallback path

- Updated dependencies [[`8e11397`](https://github.com/jvgomg/podkit/commit/8e11397501861930cf0827913003f8afe2afd943), [`8fdf618`](https://github.com/jvgomg/podkit/commit/8fdf618d95f3fad88f3738baf03dbda313a5a2d5), [`d19d6e3`](https://github.com/jvgomg/podkit/commit/d19d6e305cd864d188f3de377873b5a44df7e02f), [`3f56a1b`](https://github.com/jvgomg/podkit/commit/3f56a1b063f821e7a0d399a497521358331577a6), [`120a7b1`](https://github.com/jvgomg/podkit/commit/120a7b1a8899ed48515bd98ce731231e94d3409f), [`143e314`](https://github.com/jvgomg/podkit/commit/143e31442a40489390d45d74ee953facdc243706), [`2873f14`](https://github.com/jvgomg/podkit/commit/2873f14aad6493d2d7dafbe344e8b5db0abc3551), [`66560a9`](https://github.com/jvgomg/podkit/commit/66560a9158c777f2f25ca24c047204afa78f187e), [`7624265`](https://github.com/jvgomg/podkit/commit/762426537af1d3d7b29c6d6e1f878abd5c0474eb), [`632f360`](https://github.com/jvgomg/podkit/commit/632f3605370dbb50b0be5ffada0460f1aa9792d7)]:
  - @podkit/core@0.6.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`2e7ba81`](https://github.com/jvgomg/podkit/commit/2e7ba81085166b47ab08d07bb739f04d3d9e46d1), [`e1b0fbc`](https://github.com/jvgomg/podkit/commit/e1b0fbc679dca9516011a211adad255b9deb140f)]:
  - @podkit/core@0.5.1

## 0.5.0

### Minor Changes

- [`6b90ef7`](https://github.com/jvgomg/podkit/commit/6b90ef7972c42a4def206b15584ea7caa549b4d2) Thanks [@jvgomg](https://github.com/jvgomg)! - Add config migration system with `podkit migrate` command

  Config files now have a `version` field. Running any command with an outdated config shows a clear error directing you to run `podkit migrate`. The migrate command detects your config version, shows what will change, backs up your original file, and applies updates. Supports `--dry-run` to preview changes and interactive migrations that can prompt for decisions. Configs without a version field are treated as version 0 and can be migrated with `podkit migrate`.

- [`0019607`](https://github.com/jvgomg/podkit/commit/00196072d68bdbf8a7dabb64fb53dc968aebfdbb) Thanks [@jvgomg](https://github.com/jvgomg)! - Add `--force-metadata` flag to rewrite metadata on all synced tracks without re-transcoding or re-transferring files

- [`4edadde`](https://github.com/jvgomg/podkit/commit/4edadde979cbe780ff455df3f98310988961fe6e) Thanks [@jvgomg](https://github.com/jvgomg)! - Add tab completion for option values and dynamic config names

  Options like `--quality`, `--type`, `--encoding`, and `--format` now offer their known values when pressing tab (e.g. `max`, `high`, `medium`, `low`). The `--device` and `--collection` flags complete with names from your config file. Works in both zsh and bash.

### Patch Changes

- [`8dddd29`](https://github.com/jvgomg/podkit/commit/8dddd2945071f3aac3c018cc05138ef51386529c) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve iPod eject reliability with automatic retry and filesystem sync
  - Use `diskutil eject` instead of `diskutil unmount` on macOS for proper removable-media handling (unmounts + detaches the disk)
  - Flush filesystem buffers before ejecting to ensure all writes are persisted
  - Automatically retry eject up to 3 times when the device is temporarily busy (common on macOS when Finder/Spotlight holds a reference)
  - Show progress output during retry so you know what's happening
  - On Linux, return busy errors from udisksctl immediately so the retry wrapper can handle them instead of silently falling through

- Updated dependencies [[`8dddd29`](https://github.com/jvgomg/podkit/commit/8dddd2945071f3aac3c018cc05138ef51386529c), [`0019607`](https://github.com/jvgomg/podkit/commit/00196072d68bdbf8a7dabb64fb53dc968aebfdbb)]:
  - @podkit/core@0.5.0

## 0.4.0

### Minor Changes

- [`8c121ff`](https://github.com/jvgomg/podkit/commit/8c121ff25052a49a8ecda3850a04b57030cc065a) Thanks [@jvgomg](https://github.com/jvgomg)! - Add shell completion support with `podkit completions` command. Tab completion for all commands, subcommands, and options is generated automatically from the CLI structure. Supports zsh and bash via `podkit completions install` for guided setup, including a dev mode (`--alias`) that creates a shorthand function with completions for local development workflows.

- [#37](https://github.com/jvgomg/podkit/pull/37) [`424e0e9`](https://github.com/jvgomg/podkit/commit/424e0e96923650e7fdb79f5d5d494b8078738f1c) Thanks [@jvgomg](https://github.com/jvgomg)! - Add official Docker image for running podkit in containers. The image is based on Alpine Linux and supports both `linux/amd64` and `linux/arm64` architectures. Published to GitHub Container Registry on each release.

  Also adds musl-compatible Linux binaries to release assets for users on Alpine and other musl-based distributions.

- [#38](https://github.com/jvgomg/podkit/pull/38) [`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f) Thanks [@jvgomg](https://github.com/jvgomg)! - Add environment variable support for defining collections and devices without a config file. Set `PODKIT_MUSIC_PATH=/music` to configure a music collection entirely via env vars — no config file needed. Supports named collections (`PODKIT_MUSIC_MAIN_PATH`), Subsonic sources (`PODKIT_MUSIC_TYPE=subsonic`), and video collections (`PODKIT_VIDEO_PATH`). Device `volumeUuid` is now optional, and UUID validation protects against syncing to the wrong iPod when configured.

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

- [#38](https://github.com/jvgomg/podkit/pull/38) [`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix native libgpod binding not loading in compiled CLI binary. The Homebrew and standalone binary distributions were completely broken for any command that touched the iPod database. The `.node` addon is now embedded directly in the single-file binary, and all native dependencies are fully statically linked — including on Linux, where builds now use musl/Alpine for universal compatibility across all distros (Debian, Ubuntu, RHEL, Fedora, Arch, Alpine, etc.).

- Updated dependencies [[`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f), [`21ab79a`](https://github.com/jvgomg/podkit/commit/21ab79a2a52dd698b0d9d83304cad5ee9fee91f0), [`50e529c`](https://github.com/jvgomg/podkit/commit/50e529c53bae0bf403c61d1a097230514890c90f)]:
  - @podkit/core@0.4.0

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
