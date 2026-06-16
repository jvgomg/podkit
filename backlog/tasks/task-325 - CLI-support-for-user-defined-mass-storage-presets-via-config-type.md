---
id: TASK-325
title: CLI support for user-defined mass-storage presets via config + --type
status: Done
assignee: []
created_date: '2026-05-12 17:34'
updated_date: '2026-06-16 19:29'
labels:
  - device-capability-architecture
  - cli
  - config
milestone: m-18
dependencies: []
references:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/open-device.ts
  - packages/devices-mass-storage/src/preset.ts
  - packages/devices-mass-storage/README.md
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire user-defined mass-storage presets into podkit-cli so `device add --type my-walkman --path /Volumes/MyDap` works when the user has defined `my-walkman` in their config file.

The library primitive exists today — `definePreset()` is exported from `@podkit/devices-mass-storage` (README has examples). Device-types module already opens `DeviceTypeId = BuiltInDeviceTypeId | (string & {})` in `packages/podkit-core/src/device/index.ts:82`. The gap is entirely in the CLI: config schema is closed, `--type` parser rejects unknown strings, and capability resolution only consults `BUILT_IN_PRESETS`.

Was implicitly promised by P3 (TASK-294) AC #4 ("device add --type my-walkman works with user-registered preset") but never wired end-to-end at the CLI layer.

## Current state
- `packages/podkit-cli/src/config/types.ts:77` — `DeviceType = 'ipod' | 'echo-mini' | 'rockbox' | 'generic'` (closed union, no escape hatch).
- `packages/podkit-cli/src/config/types.ts:182` — per-device `type?: DeviceType` references the closed union.
- `packages/podkit-cli/src/commands/device/add.ts:103` — `.addOption(new Option('--type <type>', 'device type').choices([...DEVICE_TYPES]))` rejects unknown strings at Commander parse time before the action runs.
- `packages/podkit-cli/src/commands/open-device.ts:193` — mass-storage path resolves preset from `BUILT_IN_PRESETS` only, no user-preset merge.
- No `presets:` section exists in the config schema.

## Behaviour today
User running `podkit device add --type my-walkman --path /mnt` gets: `error: option '--type <type>' argument 'my-walkman' is invalid. Allowed choices are ipod, echo-mini, rockbox, generic.` The action never executes. Config-file presets are not loaded anywhere.

## Scope
1. Add `presets?: PresetDefinition[]` (or keyed map) to the CLI config schema in `packages/podkit-cli/src/config/types.ts`. Validate at load time via `definePreset` so dangling `extends` and bad ids fail with friendly errors.
2. Build a merged preset registry: `BUILT_IN_PRESETS ∪ userPresets`. User presets may extend a built-in or another user preset; `definePreset` already supports this via `opts.available`.
3. Drop `.choices([...DEVICE_TYPES])` from `add.ts:103`. Validate `--type` post-parse against the merged registry; emit a friendly error listing known type ids if the value is unknown.
4. Shell completion: built-ins still autocomplete; user presets should also appear if config is loadable at completion time (nice-to-have).
5. Capability resolution (`open-device.ts`, `doctor.ts`, anywhere else that maps presetId → preset) must consult the merged registry, not `BUILT_IN_PRESETS` directly.
6. Per-device config `type` field type opens to `string` (or `BuiltInPresetId | (string & {})` to keep autocomplete for built-ins).
7. Document in CLI docs + README example. Add to `docs/users/devices/` if appropriate.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config schema accepts a `presets:` section with valid `PresetDefinition` entries
- [x] #2 Invalid preset definitions (bad id, dangling extends) fail config load with a friendly error
- [x] #3 `podkit device add --type my-walkman --path /mnt` succeeds when `my-walkman` is defined in config
- [x] #4 `podkit device add --type unknown-id` fails with a friendly error listing built-ins + user presets
- [x] #5 Built-in `--type` values continue to work unchanged (no regression)
- [x] #6 Capability resolution for a user-preset-typed device produces the expected `DeviceCapabilities` (inheritance from extends; overrides win)
- [x] #7 Two devices configured with the same user preset id resolve independently (shared definition, distinct device config overrides)
- [x] #8 Per-device config `type` field accepts arbitrary preset ids (type system + runtime)
- [x] #9 Doctor's mass-storage checks operate against user-preset content paths
- [x] #10 Documentation example added showing how to define + use a custom preset
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-13 — Note on unsupported-codec warnings (from TASK-327 follow-up)

When user-defined presets become a thing via this task, their `supportedAudioCodecs` declarations need to interact correctly with `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS` (currently `['wav', 'aiff']`). The behaviour established by TASK-327's polish pass is:

- Presets MAY declare wav/aiff as supported — this documents what the device firmware can play.
- Podkit refuses to use these codecs as device-output on mass-storage; the `MassStorageAdapter` filters them out of its operational capabilities so the planner transcodes source wav/aiff to a managed codec before transfer.
- When a user explicitly sets `supportedAudioCodecs = ["wav", ...]` on a `[devices.X]` override, the config loader emits a console warning naming the offending codecs (config still loads, value preserved). Test coverage lives in `packages/podkit-cli/src/config/loader.test.ts` under `describe('podkit-unsupported output codec warnings')`.

## Additional acceptance criterion for this task

- [ ] Same warning fires when a user-defined preset (the new `[presets.X]` section this task is adding) declares wav/aiff in its `supportedAudioCodecs`. Mirror the loader test pattern from TASK-327: capture `console.warn`, assert the warning names the offending codecs and is suppressed for fully-supported lists. Reuse `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS` from `@podkit/devices-mass-storage` — do not duplicate the list.
- [ ] The behaviour is symmetric across user presets and per-device overrides: a user-defined `my-walkman` preset listing `"wav"` triggers the warning at preset-definition time, not deferred until a device of that type is opened.

Rationale: keeping presets as the source of device truth (firmware capability) while podkit consistently refuses to manage wav/aiff is a stable contract; user-defined presets must honour it. The warning is the user's signal that the codec is recorded for posterity but won't drive direct-copy decisions.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in commit 72fd2c85 — `feat(cli): user-defined mass-storage presets via [presets.X] config`.

**Wiring**
- `DeviceType` opens to `BuiltInDeviceType | (string & {})` — runtime accepts user preset ids, autocomplete keeps working for built-ins.
- `parsePresets` topo-sorts the `extends` graph; cycles, self-cycles, dangling extends → friendly errors naming the preset.
- Shared `parseCapabilityFields` validates codec / artwork / normalization / numeric-range fields for both `[devices.X]` and `[presets.X]` blocks. wav/aiff in `supportedAudioCodecs` warns at preset-definition time, symmetric with the per-device override path.
- `mergedPresets(config)` returns a frozen object — accidental mutation of built-in entries throws.
- `getDeviceTypeDisplayName`, `getDeviceTypeRichDisplayName`, `getDeviceLabel`, `openDevice`, `resolveDeviceContentPaths`, `renderDeviceScan` require the merged registry — no default fallback to `BUILT_IN_PRESETS`. All command entry points (sync, doctor, device add/list/info/scan/eject/mount/music/video) thread `mergedPresets(config)`.

**Tests**
- `preset-registry.test.ts` (160 LOC) — merge registry, freeze contract, mutation rejection.
- `loader.test.ts` (+315 LOC) — preset parsing (extends chains, cycles, collisions, codec warnings).
- `device-add.unit.test.ts` (+90 LOC) — `--type` validation (rejects unknown ids; error lists built-ins + user presets).
- `device-list.unit.test.ts`, `device-scan-render.user-presets.test.ts` — display-fn threading; scan render + list text mode surface the preset productName.

**Docs**
- `docs/reference/config-file.md` — Custom Mass-Storage Presets section with worked example.
- `documents/architecture/device/capabilities.md` — new settled per-subsystem doc covering preset sourcing, resolution cascade, and the threading convention CLI consumers follow.

**Changeset**: `.changeset/user-defined-mass-storage-presets.md` — minor bump.

All 10 ACs satisfied + codec-warning addendum from TASK-327 follow-up.
<!-- SECTION:FINAL_SUMMARY:END -->
