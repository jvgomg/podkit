---
id: TASK-325
title: CLI support for user-defined mass-storage presets via config + --type
status: To Do
assignee: []
created_date: '2026-05-12 17:34'
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
- [ ] Config schema accepts a `presets:` section with valid `PresetDefinition` entries
- [ ] Invalid preset definitions (bad id, dangling extends) fail config load with a friendly error
- [ ] `podkit device add --type my-walkman --path /mnt` succeeds when `my-walkman` is defined in config
- [ ] `podkit device add --type unknown-id` fails with a friendly error listing built-ins + user presets
- [ ] Built-in `--type` values continue to work unchanged (no regression)
- [ ] Capability resolution for a user-preset-typed device produces the expected `DeviceCapabilities` (inheritance from extends; overrides win)
- [ ] Two devices configured with the same user preset id resolve independently (shared definition, distinct device config overrides)
- [ ] Per-device config `type` field accepts arbitrary preset ids (type system + runtime)
- [ ] Doctor's mass-storage checks operate against user-preset content paths
- [ ] Documentation example added showing how to define + use a custom preset
<!-- SECTION:DESCRIPTION:END -->
