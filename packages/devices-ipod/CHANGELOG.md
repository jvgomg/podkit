# @podkit/devices-ipod

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

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Record where every FamilyID value came from, and stop unverified ones from naming devices podkit refuses.

  The FamilyID table now carries provenance per entry — `{ generation, evidence: 'hardware' | 'inferred', source }` — so a value read off a real device is distinguishable in the data from one taken from a community SysInfo dump, rather than in a comment block that drifts. Three invariants are enforced by tests so a bad row fails at commit time: FamilyID bands must match device class (`< 100` click-wheel, `100–999` shuffle, `>= 10000` iOS), an inferred value must fall inside the release-date window its neighbouring hardware anchors leave open, and an inferred value may only name a `syncable` generation — a guess may open a door, never close one. The band rule alone would have rejected eleven of the table's original entries.

  Six values whose numbers the hardware anchors contradict are removed: 4 (iPod Photo), 5 (mini 1G), 7 (Classic 6G), 8 (nano 1G), 24 (nano 6G) and a duplicate 13 (nano 3G — hardware puts the nano 3G at 12, twice over). These now fail closed with an honest unknown-model error naming the inputs, which is safer than a confident wrong answer that suppresses it.

  **Breaking (`@podkit/devices-ipod`):** `FAMILY_ID_TO_GENERATION: Record<number, IpodGenerationId>` is replaced by `FAMILY_ID_TABLE: Record<number, FamilyIdEntry>`. `lookupByFamilyId(familyId)` is unchanged and still returns an `IpodGenerationId | undefined`; the new `lookupFamilyIdEntry(familyId)` returns the entry with its evidence, for callers that want to render confidence rather than branch on it.

  **Also breaking (`@podkit/devices-ipod`):** `getUnsupportedReasonByLibgpodName()` and the `UnsupportedGenerationKind` type are removed. They categorised a device from libgpod's view of its generation; nothing categorises that way any more, because the identity cascade resolves a generation first and the refusal reason is derived from podkit's own generation table, which knows the access tier and why.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Sync to an iPod shuffle now produces a device that plays.

  An iPod shuffle plays from `iTunesSD`, not from the `iTunesDB` every other iPod uses. The database layer writes that file only for a device it has resolved to a shuffle, and it resolves models from its own serial-suffix table and the classic SysInfo `ModelNumStr` alone — it has no USB or FamilyID axis. A shuffle 2G whose serial suffix is in neither table and which carries no classic SysInfo was therefore unidentifiable to it: `iTunesSD` was silently skipped, the sync reported success, and the device could not play a single one of the tracks it had just received.

  podkit now supplies the identity the database layer is missing, using a model number its own cascade resolved **from the device**:
  - Serial suffix `436` → `A947` (iPod shuffle 2G, 1GB, Pink) is added to the serial table from real hardware.
  - `podkit device add` records the resolved model number in the device's SysInfo when the database layer cannot identify it.
  - `podkit doctor` reports the same condition as a new `sysinfo-modelnum-missing` check, repairable with `podkit doctor --repair sysinfo-modelnum-missing`.
  - A new `shuffle-playback-db` doctor check reports a shuffle whose `iTunesSD` is absent, empty, or in the wrong format for the hardware — the symptoms that were previously invisible. It reads the header rather than guessing from file size, because an empty 3G/4G `bdhs` file is larger than a populated 1G/2G one.

  Nothing is ever fabricated: when the cascade resolves no model number, podkit reports the gap and writes nothing.

  Shuffle 3G/4G remain read-only.

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

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - Correct the FamilyID → generation table from real hardware.

  FamilyID 12 is the iPod nano 3G, not the iPod touch 1G. An affected nano — one whose serial suffix is not in the serial table, so the FamilyID axis decides — was refused by `podkit sync` with a message claiming it used Apple's proprietary sync protocol, and that refusal could not be overridden. It now resolves as a syncable nano 3G.

  FamilyID 17 is the iPod nano 6G, not the iPod Classic 7G — read from firmware on a connected nano 6G. This one pointed the wrong way round: the Classic 7G is syncable and the nano 6G is not, so a nano 6G whose serial suffix was unmapped would have been treated as a device podkit could write to. The Classic 7G's FamilyID is simply unknown and is no longer guessed.

  Also corrected: the shuffle band now carries its hardware values (130 → shuffle 2G, 132 → shuffle 3G, 133 → shuffle 4G), replacing four research guesses that had placed shuffles among the click-wheel FamilyIDs. Every iPod touch entry is removed — an iOS device has no disk mode and never emits the SysInfoExtended those values would have to come from, so they were unobtainable by construction; touches continue to be recognised and refused by USB product ID. The iPod shuffle 3G's support record is promoted from `inferred` to hardware-verified.

- [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix iPod model identification regressing to "Unknown iPod" after `doctor --repair sysinfo-extended` on pre-2006 devices (mini 2G), and tighten the package-boundary contract so consumers compose identity instead of injecting resolution policy.

  The bug: each consumer of `ensureSysInfoExtended` / `readSysInfoExtended` passed a serial-only `resolveModel` callback. When the 3-character serial suffix wasn't in `tables/serials.ts`, the resolver returned undefined and the device was displayed as "Unknown iPod" — even when a SysInfo file with a known `ModelNumStr` was sitting next to the SysInfoExtended on disk.

  The fix:
  - **Removed** `ModelResolver` type and the `resolveModel` callback from `@podkit/ipod-firmware`. `readSysInfoExtended` and `ensureSysInfoExtended` now return a flat `SysInfoIdentity` bag (`firewireGuid?, serialNumber?, modelNumStr?, familyId?`). When a SysInfo file is on disk alongside SysInfoExtended, its `ModelNumStr` is read opportunistically.
  - **Callers compose** with `resolveIpodModel(bag)` from `@podkit/devices-ipod`, which cascades modelNumStr → serial → productId → familyId → libgpodGeneration. The CLI no longer makes resolution decisions.
  - **Added** `SYSINFO_PATH`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR` exported from `@podkit/ipod-firmware` and re-exported from `@podkit/core`. Consumers use these constants instead of duplicating the literal `iPod_Control/Device/...` paths.
  - **Added** `S4G: '9804'` entry to `tables/serials.ts` (mini 2G 4GB Pink, sourced from real hardware, serial `JQ5141TFS4G`).
  - **Post-write enrichment.** After `ensureSysInfoExtended` writes the file via USB inquiry, it now re-reads via `readSysInfoExtended` so the post-write identity bag includes `modelNumStr` from the SysInfo neighbour. Eliminates the cosmetic regression where the repair-success message showed a less-specific name than the subsequent `doctor` run.

- [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a) Thanks [@jvgomg](https://github.com/jvgomg)! - iPod nano 7th gen is now read and archived instead of refused outright.

  The generation table marked nano 7G `access: 'none'` on the claim that it had no entry in libgpod's device table, so podkit could not mount a database for it. Real hardware disagrees: podkit read 1,414 tracks off a nano 7G via libgpod's classic `iTunesCDB` parser and `podkit device archive` completed successfully. The device does carry a database podkit cannot write — but the reason is unrelated to the original claim: nano 7G uses `hashAB` checksum signing, which libgpod only computes via an external blob (`LIBGPOD_BLOB_DIR`) that podkit does not ship, so it fails closed on write.

  nano 7G is now `access: 'read-only'`, `verified: 'hardware'` — the same tier as the shuffle 3G/4G and nano 6G. `podkit device scan`, `device info`, `device music`, and `device archive` all work; `podkit sync` and `device init`/`add` still refuse, now with a reason describing the real hashAB limitation instead of a flat "not supported" message.

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

- Updated dependencies [[`bb2e637`](https://github.com/jvgomg/podkit/commit/bb2e6374151605d11baf052c452f10a842e5353e), [`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af), [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db), [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b), [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6), [`a78e5fe`](https://github.com/jvgomg/podkit/commit/a78e5fee4e47293c1935395bb157cb6574782625), [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce), [`eed4126`](https://github.com/jvgomg/podkit/commit/eed4126fe91ff64f00d74e8a2aaaae38ca6d786b), [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4), [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f), [`80fe65a`](https://github.com/jvgomg/podkit/commit/80fe65a022c65da512f571a8abf83f9385a649e6), [`4598f8f`](https://github.com/jvgomg/podkit/commit/4598f8f3347cf40b94fdf1585215e5b0f54d9cf6), [`e825ee1`](https://github.com/jvgomg/podkit/commit/e825ee1dd4933ecbfd070dda27f96f43056f0baf)]:
  - @podkit/ipod-firmware@0.1.0
  - @podkit/device-types@0.1.0
