# @podkit/device-types

## 0.1.0

### Minor Changes

- [`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af) Thanks [@jvgomg](https://github.com/jvgomg)! - Disambiguate codec from container: `AudioCodec` value `'ogg'` is renamed to `'vorbis'`

  The `AudioCodec` slot previously used `'ogg'` to mean "OGG Vorbis." That conflated the OGG container with the Vorbis stream codec and could not represent Vorbis-in-OGG vs Opus-in-OGG as distinct device capabilities — Echo Mini (which plays Vorbis but hides `.opus` files) could not be modelled accurately. The codec slot now names the audio stream codec; `'vorbis'` replaces `'ogg'` in device presets and config.

  Configs containing `supportedAudioCodecs = ["…", "ogg", "…"]` under `[devices.*]` are migrated automatically by `podkit migrate` (config version 1 → 2). The migration is purely a string substitution inside the `supportedAudioCodecs` array; comments and surrounding formatting are preserved.

  Also lands as type-level groundwork for the future container-aware sync work: `AudioContainer`, `AUDIO_CONTAINERS`, `CODEC_CANONICAL_CONTAINER`, and an optional `DeviceCapabilities.containerConstraints` field. These are declared and exported but not yet read by the planner; they are placeholders for the upcoming Phase 2 work documented in the container-aware sync PRD.

  `DirectoryAdapter` now uses each `.ogg` file's probed stream codec (already populated by `music-metadata`) to distinguish Vorbis, Opus, and OGG-FLAC — same pattern as the existing AAC/ALAC distinction for `.m4a`. `SubsonicAdapter` additionally checks the API's `contentType` field for Opus-in-`.ogg`. The Subsonic check is best-effort because most Subsonic servers report container MIME (`audio/ogg`) regardless of stream codec; deeper probing is deferred until evidence of real-world impact.

  User-facing reference page added at `docs/reference/codec-support.md` explaining the codec/container model and what each `AudioCodec` value means.

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

- [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4) Thanks [@jvgomg](https://github.com/jvgomg)! - Add SCSI firmware inquiry for iPod identification (P1 — m-18 device-capability architecture).

  `@podkit/device-types` (first published release) provides the canonical shared type definitions — `DeviceCapabilities`, `DeviceIdentity`, `ParsedFirmware`, and `DeviceProvider` — used across the podkit monorepo without circular dependencies.

  `@podkit/ipod-firmware` (first published release) implements iPod firmware inquiry via SCSI (Linux SG_IO + macOS IOKit, using koffi FFI) with USB fallback through the existing libgpod-node binding. Devices that previously failed identification over USB — including iPod mini 2G, nano 2G, and some iPod 5G Video configurations — can now be identified via SCSI. The orchestrator probes available transports at startup, prefers USB when both are available, and falls back to SCSI transparently.

  `@podkit/core` now routes `ensureSysInfoExtended` through the new orchestrator with SCSI fallback, and registers two new `podkit doctor` checks: `inquiry-methods` (reports which transports are available on this host) and `sysinfo-consistency` (validates that the on-disk SysInfo file matches the live firmware read). EACCES errors from SCSI include step-by-step recovery instructions.

  `podkit` CLI gains `--repair udev-rule` in `podkit doctor` to install the Linux udev rule that grants non-root `/dev/sg*` access, and surfaces the new doctor checks in the readiness output.

### Patch Changes

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
