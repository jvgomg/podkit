# @podkit/devices-mass-storage

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

- [`c5cba69`](https://github.com/jvgomg/podkit/commit/c5cba6998283663b42659f02b17b194ab256c137) Thanks [@jvgomg](https://github.com/jvgomg)! - Polish on the convergent-metadata work (TASK-327 follow-up):
  - **Tag-write concurrency cap.** `save()` now caps in-flight tag writes at 16 via a small `runWithConcurrency` helper instead of firing every pending write at once. Avoids `EMFILE` on large libraries.
  - **Aggregated tag-write errors.** Failure messages now begin with `tag write failed` so the executor's error categorizer classifies them as file-I/O (`copy`) rather than risking a path-keyword mis-classification.
  - **WAV/AIFF on mass-storage.** Podkit transcodes WAV and AIFF source files to a managed codec before placing them on a mass-storage device, even when the device firmware can play them. RIFF/IFF tag-writing is unreliable. Presets continue to list these codecs for documentation. iPod is unaffected (libgpod / iTunesDB handle metadata for WAV/AIFF).
  - **OGG Vorbis tag round-trip tests.** Now run on builds with libvorbis (skipped automatically when absent).
  - **Shared TagFields helpers.** `buildTagFieldsFromInput` and `diffTagFields` replace three duplicate field-by-field walks across adapters.
  - **`TransferMode` type unified.** Removed `'fast' | 'optimized' | 'portable'` duplication between `DeviceTrackInput`, `DeviceTrackMetadata`, and the canonical `TransferMode` in `transcode/types.ts`. Drops several inline type casts.
  - **Docs.** `transferMode` now has a dedicated section in `docs/reference/config-file.md` explaining the iPod vs mass-storage contract and migration churn. `pathTemplate` (from the prior release) and `PODKIT_PATH_TEMPLATE` are now documented in the config reference and environment-variables reference.

### Patch Changes

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

- [`01ecedd`](https://github.com/jvgomg/podkit/commit/01ecedde623ff99e94c5cbda75ff9f9c9ecef632) Thanks [@jvgomg](https://github.com/jvgomg)! - New packages: `@podkit/devices-ipod` (canonical home for iPod generation tables, model lookups, and capability synthesis) and `@podkit/devices-mass-storage` (user-extensible DAP preset framework for Echo Mini, Rockbox, generic, and custom devices).

  Echo Mini is now auto-detected at `device add` — when the USB descriptor matches the known VID/PID (`0x071b`/`0x3203`), no `--type echo-mini` flag is required.

  `enumerateConnectedDevices` is now the recommended way to discover and classify USB devices. It accepts a `providers: DeviceProvider[]` array and returns `EnumeratedDevice[]` carrying both the USB connection info and the provider-produced identity.

  `getCapabilities` in `@podkit/devices-ipod` is libgpod-free. Capability synthesis is purely table-and-firmware-driven; the legacy `createIpodCapabilities` adapter that depended on a live libgpod `LibgpodDeviceInfo` struct is deprecated in `@podkit/core`. Parity is verified across all 29 generations (the 4 that were libgpod `unknown` degenerate cases are now correctly populated from the table).

  Internal re-export shims in `@podkit/core` keep all existing call paths compiling for one release. The shims delegate to `@podkit/devices-ipod` and `@podkit/devices-mass-storage` and will be removed in P4.

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

- Updated dependencies [[`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af), [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db), [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b), [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6), [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4), [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f)]:
  - @podkit/device-types@0.1.0
