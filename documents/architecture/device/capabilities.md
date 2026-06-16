---
title: Device Capabilities
description: How a target device's playback capabilities are resolved — from preset baseline through env-driven defaults to per-device TOML overrides — and how user-defined mass-storage presets plug into the same surface.
sidebar:
  order: 1
---

Describes how `DeviceCapabilities` are resolved for a target device — what
podkit will and won't write, which audio codecs the device can play, which
content paths to use — and how built-in and user-defined presets share one
surface.

Capabilities feed every downstream decision: the sync planner uses them to
pick transcoding targets, the adapter uses them to validate writes, and the
display layer uses them to render the device's identity. A user-defined
preset that goes unread silently degrades to "generic" or "iPod"; the
threading convention in §4 is the contract that prevents that.

Cross-cutting rules (no `console.warn` in core, CLI composes-not-decides)
live in [conventions](../conventions.md).

---

## 1. The two preset sources

A target device's baseline capabilities come from one of two sources, each
with different lifecycle rules:

| Source                | Lives in                                  | Lifecycle                                                                                         |
|-----------------------|-------------------------------------------|---------------------------------------------------------------------------------------------------|
| **Built-in presets**  | `@podkit/devices-mass-storage` source     | Ship with podkit. Authoritative — collisions with user ids are refused at config load.            |
| **User-defined presets** | `[presets.<id>]` blocks in TOML config  | Authored by users. Resolved at config load via `definePreset`; stored fully-resolved.             |

iPod is its own track — its capabilities come from generation metadata in
`@podkit/devices-ipod`, not from a preset map. The `'ipod'` device type id
is reserved (`[presets.ipod]` is refused).

The **merged registry** is the union: `mergedPresets(config) = { ...config.presets, ...BUILT_IN_PRESETS }`.
Built-ins win on collision — the merge order makes the contract explicit
even though the loader refuses such collisions earlier.

## 2. Primitives

### `MassStoragePreset` (in `@podkit/devices-mass-storage`)

Fully-resolved preset data. Combines a `DeviceCapabilities` snapshot,
default content paths, and display metadata (`manufacturer`, `productName`).
The `extends` chain on `PresetDefinition` is resolved eagerly inside
`definePreset` — the stored preset is always flat; consumers never walk
chains at runtime.

### `parsePresets` (in `packages/podkit-cli/src/config/loader.ts`)

Reads `[presets.<id>]` blocks and produces `Record<string, MassStoragePreset>`.
Validates the same way per-device overrides validate (codec names, artwork
sources, normalization mode, numeric ranges). Topological sort over the
`extends` graph; cycles, self-cycles, and collisions are refused with the
preset id named in the error message.

### `mergedPresets(config)` / `knownDeviceTypeIds(config)` (in `config/preset-registry.ts`)

The CLI-side helpers. `mergedPresets` returns a fresh object union of
built-ins + user-defined presets. `knownDeviceTypeIds` returns `['ipod',
...knownPresetIds(config)]` — the canonical list for `--type` validation
and friendly error messages.

### `resolveCapabilitiesResolved(identity, opts)` (in `@podkit/core`)

The provenance-aware resolver. Accepts an optional `presets` map; when
omitted, falls back to built-ins only. Returns per-field
`{ value, source }` records so the CLI can render inheritance markers
(`[high]` for inherited, plain for explicitly set).

Layer order per field (highest priority first):
**device-config → device-defaults → firmware (iPod) → preset/generation**.

## 3. Responsibility boundaries

| Layer                        | Knows about                                                | Does NOT know about                          |
|------------------------------|------------------------------------------------------------|----------------------------------------------|
| `@podkit/devices-mass-storage` | `MassStoragePreset` shape, `definePreset`, built-in data | User config, CLI display, merged registry    |
| `@podkit/core` resolver      | Merging cascade, provenance, `presets` opt                 | Where the presets come from                  |
| `podkit-cli` config loader   | `[presets.X]` parsing, collision/cycle rules               | Capability semantics (delegates to definePreset) |
| `podkit-cli` consumers (commands) | `mergedPresets(config)` is the entry point              | Built-in vs user-defined distinction (the merge hides it) |

The CLI's job is to thread `mergedPresets(config)` to every code path that
consults a preset. The core resolver and library helpers do the rest.

## 4. Conventions for new contributors

When you add or modify code that resolves capabilities or renders a
device's identity:

- [ ] **Thread `mergedPresets(config)` to every consumer.** `openDevice`,
      `resolveCapabilitiesResolved`, `getDeviceTypeDisplayName`,
      `getDeviceTypeRichDisplayName`, `getDeviceLabel`,
      `resolveDeviceContentPaths`, `renderDeviceScan`, and
      `createMassStorageProvider` all take a presets map. Callers with
      access to the user config MUST pass `mergedPresets(config)`. The
      default fallback to `BUILT_IN_PRESETS` is for low-level helpers
      that genuinely cannot reach the config (e.g. pure render helpers
      with no DI seam yet); these paths render user-preset-typed devices
      as `'iPod'`.
- [ ] **Never index `BUILT_IN_PRESETS` directly in podkit-cli.** Always
      go through `mergedPresets(config)`. Direct indexing silently drops
      user-defined preset ids on the floor.
- [ ] **`--type` validation lives in the runner, not in Commander.**
      `device add --type` accepts any string at parse time; the runner
      validates against `knownDeviceTypeIds(config)` and emits a friendly
      error listing both built-ins and user presets. Adding a `.choices()`
      back here would re-break user presets.
- [ ] **Capability overrides validate at TOML load time.** Codec names,
      artwork source enums, normalization mode, and numeric ranges are
      validated in `parsePresets` and `parseDevices` symmetrically. New
      capability fields must add validation in both places (or refactor
      the shared validators into a single helper).
- [ ] **wav/aiff in `supportedAudioCodecs` warns at load.** The
      mass-storage adapter refuses to use these as device-output, so
      podkit always transcodes sources in these formats. The warning is
      the user's signal; it fires symmetrically for user presets and
      per-device overrides.
- [ ] **Built-in preset ids are authoritative.** `[presets.echo-mini]`
      is a hard error at load. Users must pick a different id and use
      `extends = "echo-mini"` to inherit.

## 5. Scope boundaries

- **iPod capability resolution** lives in `@podkit/devices-ipod` and is
  table-driven from generation metadata. The preset registry does not
  apply to iPods — the `[presets.ipod]` block is explicitly refused.
- **Firmware-overlay merging** (iPod-only) layers on top of the table
  values in the same resolver but does not interact with the preset map.
  See `inquiry/orchestrator.ts` in `@podkit/ipod-firmware`.
- **Capability validation at device-open time** (e.g. refusing wav as a
  transcoding target) lives in the adapter, not in the resolver. The
  adapter's filtered view of `supportedAudioCodecs` is what flows
  downstream to the planner.

## 6. Open work

- **`device list` table render under a missing preset.** When a config
  references a preset id that no longer exists in the file (rename,
  partial migration), the table cell currently falls back to `'iPod'`.
  Consider an explicit `Unknown preset: <id>` warning row.
- **Completion of user preset ids.** Shell completion runs without
  loading the config, so user preset ids do not appear in `--type`
  autocomplete. A completion-time config probe would close this gap.
- **`MassStoragePreset` re-export from `podkit-cli`.** Currently every
  command that threads `mergedPresets(config)` either imports the type
  from `@podkit/devices-mass-storage` directly or relies on inference.
  A re-export from `podkit-cli/src/config/preset-registry.ts` would
  centralise the dependency.
- **Provenance for iPod capability fields.** `resolveCapabilitiesResolved`
  returns a uniform `'generation'` source for every iPod field. Per-field
  provenance from the iPod capability synthesiser (table vs firmware
  overlay) is future work.

## 7. References

- `packages/podkit-cli/src/config/preset-registry.ts` — `mergedPresets`,
  `knownPresetIds`, `knownDeviceTypeIds`.
- `packages/podkit-cli/src/config/loader.ts` — `parsePresets` (topo-sort
  + collision/cycle handling) and `parseDevices` content-path validation.
- `packages/podkit-cli/src/config/types.ts` — `ConfigFilePresetDefinition`,
  open `DeviceType = BuiltInDeviceType | (string & {})`.
- `packages/podkit-core/src/device/resolve-capabilities.ts` —
  `resolveCapabilities`, `resolveCapabilitiesResolved`, the
  `ResolveCapabilitiesOptions.presets` field.
- `packages/devices-mass-storage/src/preset.ts` — `definePreset` and the
  eager `extends` resolution.
- `packages/devices-mass-storage/src/presets/built-in.ts` — built-in
  preset data and `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`.
- `packages/podkit-cli/src/commands/open-device.ts` —
  `openDevice(presets)` + display helpers (`getDeviceTypeDisplayName`,
  `getDeviceTypeRichDisplayName`, `getDeviceLabel`).
- `packages/podkit-cli/src/resolvers/content-paths.ts` —
  `resolveDeviceContentPaths(deviceConfig, deviceDefaults, presets)`.
- `docs/reference/config-file.md` — user-facing reference for the
  `[presets.<id>]` schema.
