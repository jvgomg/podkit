---
id: doc-034
title: 'Spec: Phase 3 — devices-ipod and devices-mass-storage extraction'
type: other
created_date: '2026-05-03 11:20'
---
## Phase

P3 of doc-030 (PRD: Device Capability Architecture).

## Goal

Move the iPod generation tables and lookups into `@podkit/devices-ipod`. Move the mass-storage presets into `@podkit/devices-mass-storage` with a user-extensible registry framework. Add the Provider pattern and a unified, extensible enumeration framework to `podkit-core`. Bundle adjacent code-quality refactors that the moves naturally touch.

User-visible outcome: Echo Mini and other mass-storage devices with known USB IDs are auto-detected at `device add` time, removing the need to specify `--type echo-mini`. Capabilities resolution is unchanged from the user's perspective; the architecture underneath is consolidated.

## Scope

### New package: `@podkit/devices-ipod`

Reorganises and moves `podkit-core/device/ipod-models.ts` (2,013 lines).

```
packages/devices-ipod/src/
  index.ts                    public exports
  tables/
    generations.ts            IpodGeneration → metadata (display name, checksum, screen res, supportsAlac, etc.)
    usb-ids.ts                USB product ID → IpodGenerationId
    serials.ts                serial-suffix → IpodModelVariant
    model-numbers.ts          ModelNumStr → generation + display
    artwork-formats.ts        unified ARTWORK_MAX_RESOLUTION (replaces dual location in core)
    libgpod-mapping.ts        IpodGenerationId → libgpod's sequential naming
  lookups.ts                  lookupByUsbId, lookupBySerial, lookupByModelNumber, lookupGenerationInfo
  identity.ts                 identify(input): IpodIdentity | null  — facade replacing resolveIpodModel
  capabilities.ts             getCapabilities(identity, opts?): DeviceCapabilities  — replaces createIpodCapabilities, libgpod-free
  provider.ts                 ipodProvider: DeviceProvider<IpodIdentity>
```

Changes during the move:

- The libgpod-coupled `LibgpodDeviceInfo` adapter is gone. Capability synthesis is purely table-and-firmware-driven.
- The duplicated `ARTWORK_MAX_RESOLUTION` (between `device/capability-adapter.ts` and `ipod/generation.ts`) is unified here. `ipod/generation.ts` imports from this package.
- `ChecksumType`, `IpodGeneration`, `IpodGenerationId`, `IpodModel`, `IpodModelVariant` types move with the data.
- `IpodGenerationId` becomes a literal-plus-runtime union: const array + literal type alias + relaxed `string & {}` companion.

### New package: `@podkit/devices-mass-storage`

Reorganises and moves `podkit-core/device/presets.ts` and the capability-relevant parts of `mass-storage-utils.ts`.

```
packages/devices-mass-storage/src/
  index.ts                    public exports
  presets/
    built-in.ts               BUILT_IN_PRESETS map (echo-mini, rockbox, generic)
    types.ts                  MassStoragePreset interface
  preset.ts                   definePreset() — pure constructor with validation
  identity.ts                 identify(usb, presets): MassStorageIdentity | null
  capabilities.ts             getCapabilities(identity, { presets, overrides? }): DeviceCapabilities
  provider.ts                 createMassStorageProvider(presets): DeviceProvider<MassStorageIdentity>
```

New behaviour:

- Echo Mini USB VID/PID hint table (`{ vendorId: '0x071b', productId: '0x3203' }`). When core's enumeration sees a matching device, the mass-storage provider's `identify` returns an Echo Mini identity automatically.
- `definePreset` validates: capabilities shape, optional `extends` referencing another preset (which is resolved at preset-construction time, not at lookup time — pure).
- Per-call overrides on `getCapabilities` are merged after preset resolution, supporting "two Echo Minis configured differently".

### Core changes

**Enumeration framework (new):**

```
packages/podkit-core/src/device/
  enumeration.ts              new — enumerateConnectedDevices({providers, ...}) using existing usb-discovery walk
  usb-discovery.ts            de-iPod-ified — drops the Apple-VID-only filter; becomes a pure USB walk that returns any discovered device
```

- `enumerateConnectedDevices` accepts a `providers: DeviceProvider[]` parameter. Walks USB devices, asks each provider's `matches`, calls the first matcher's `identify`. Returns `EnumeratedDevice[]` carrying both the USB connection info and the provider-produced identity.
- `usb-discovery.ts`'s unsupported-iPod logic moves into `@podkit/devices-ipod`'s identity logic — the provider returns an identity tagged as unsupported (so the CLI can surface a meaningful error) rather than the discovery layer rejecting it.

**Readiness pipeline split:**

```
packages/podkit-core/src/device/
  readiness/
    index.ts                  orchestrator (replaces 815-line readiness.ts)
    types.ts                  ReadinessStage, ReadinessLevel, ReadinessResult, ReadinessInput, ...
    stages/
      usb.ts
      partition.ts
      filesystem.ts
      mount.ts
      sysinfo.ts              now talks to @podkit/devices-ipod (identity) + @podkit/ipod-firmware (file read)
      database.ts
    determine-level.ts        the rule-based level determination logic, isolated and testable
```

- The `sysinfo` stage swaps from importing `ipod-models` from core to importing from `@podkit/devices-ipod`.
- Existing public exports from `core/device/readiness.ts` are preserved as re-exports during P3 to keep CLI/tests untouched.

**Naming clean-up:**

- Existing `IpodIdentity` interface in `core/device/types.ts` (volume UUID + name; "how to relocate this device") is renamed to `StoredIpodLink`. All references in core, CLI, config, tests updated. The freed name is now used by `@podkit/devices-ipod` for the live device-identity concept.
- This is mechanical: a single rename across the codebase.

**Re-export shims for one release:**

```
packages/podkit-core/src/device/
  ipod-models.ts              now re-exports from @podkit/devices-ipod (with @deprecated annotation)
  presets.ts                  now re-exports from @podkit/devices-mass-storage
  capability-adapter.ts       now re-exports from @podkit/devices-ipod's capabilities module
```

These shims live for one release. P4 deletes them.

**`getSiblingVolumes` interface tightening:**

The `DeviceManager` interface's `getSiblingVolumes` is currently implemented on macOS but not on Linux. Linux gains a stub that returns `[]` (it never has dual-LUN devices today; Echo Mini's behaviour was macOS-only). Behaviour matches the platform reality but the contract is unified.

**CLI `DeviceTypeId` opening:**

```
// before: 'ipod' | 'echo-mini' | 'rockbox' | 'generic'
// after:
const BUILT_IN_DEVICE_TYPE_IDS = ['ipod', 'echo-mini', 'rockbox', 'generic'] as const;
type BuiltInDeviceTypeId = typeof BUILT_IN_DEVICE_TYPE_IDS[number];
type DeviceTypeId = BuiltInDeviceTypeId | (string & {});
```

`device add --type` accepts any string at runtime; user-defined preset IDs work; built-ins still get autocomplete and type-check for users writing TypeScript against podkit.

### Auto-detection at `device add`

When the user runs `podkit device add` without `--type`, core enumerates with the standard provider list (iPod + mass-storage). If a non-iPod USB device is discovered with a known mass-storage VID/PID (Echo Mini today), the CLI suggests the type rather than failing with "no iPod found". The interactive add flow proposed in doc-026 (PRD: Interactive Device Add Wizard) is enabled by this work but not implemented in P3 — the building blocks land here, the UX in a separate task.

## Key function signatures

```typescript
// @podkit/devices-ipod
export function identify(input:
  | { from: 'usb'; usb: UsbConnectionInfo }
  | { from: 'serial'; serialNumber: string }
  | { from: 'sysinfo'; modelNumStr: string }
): IpodIdentity | null;

export function getCapabilities(
  identity: IpodIdentity,
  opts?: { firmware?: FirmwareCapabilities }
): DeviceCapabilities;

export const ipodProvider: DeviceProvider<IpodIdentity>;

// @podkit/devices-mass-storage
export const BUILT_IN_PRESETS: Record<BuiltInPresetId, MassStoragePreset>;

export function definePreset(input: PresetDefinition): MassStoragePreset;

export function identify(
  usb: UsbConnectionInfo,
  presets: Record<string, MassStoragePreset>
): MassStorageIdentity | null;

export function getCapabilities(
  identity: MassStorageIdentity,
  opts: { presets: Record<string, MassStoragePreset>; overrides?: Partial<DeviceCapabilities> }
): DeviceCapabilities;

export function createMassStorageProvider(
  presets: Record<string, MassStoragePreset>
): DeviceProvider<MassStorageIdentity>;

// podkit-core
export function enumerateConnectedDevices(opts: {
  providers: DeviceProvider<DeviceIdentity>[];
}): Promise<EnumeratedDevice[]>;

export function resolveCapabilities(
  identity: DeviceIdentity,
  opts?: ResolveCapabilitiesOptions
): DeviceCapabilities;
```

## Acceptance criteria

1. `@podkit/devices-ipod` and `@podkit/devices-mass-storage` packages exist, build, and pass tests in CI.
2. All capability resolution in podkit produces byte-identical `DeviceCapabilities` to pre-P3 code, verified by snapshot tests covering every iPod generation and every mass-storage preset.
3. `device add` (interactive mode) auto-detects an Echo Mini by USB VID/PID, no `--type` flag required.
4. `device add --type my-walkman` works when the user has registered a custom preset (manual config or programmatic).
5. Two Echo Minis can be configured with different overrides in the same program / config without state collision.
6. `core/device/readiness.ts` is gone; `readiness/` subdirectory replaces it; existing tests all pass.
7. `IpodIdentity` (config-link) renamed to `StoredIpodLink` everywhere; no references to the old name remain.
8. `usb-discovery.ts` no longer hardcodes Apple VID `0x05ac`. Discovery returns all USB mass-storage candidates; classification is the providers' job.
9. Re-export shims in core for `ipod-models.ts`, `presets.ts`, `capability-adapter.ts` are in place and work; their files are TypeScript-deprecated.
10. `ARTWORK_MAX_RESOLUTION` exists in exactly one place (`@podkit/devices-ipod`); core's duplicate is gone.
11. `LibgpodDeviceInfo` adapter type is gone; capability synthesis no longer depends on libgpod's runtime data.
12. CLI `--type` flag accepts any string; built-in IDs continue to autocomplete in TypeScript callers.
13. Hardware validation per the inventory: all five devices behave identically to P2.
14. AGENTS.md updated with new package list. CLAUDE.md unchanged.

## Test plan

### Unit tests

| Module | Coverage |
|--------|----------|
| `devices-ipod/identity.identify` | Multi-axis lookup (USB id, serial, ModelNumStr) across the entire generation table. Ambiguous USB ids (0x1205, 0x1209) — verify behaviour is deterministic. Missing serial suffix fallback. |
| `devices-ipod/capabilities.getCapabilities` | All generations × { with firmware, without firmware }. Snapshot tests of resulting DeviceCapabilities. |
| `devices-mass-storage/preset.definePreset` | Pure construction, `extends` resolution, override application order, validation errors. |
| `devices-mass-storage/identity.identify` | USB VID/PID hint matching. Returns null on unknown devices. |
| `devices-mass-storage/capabilities.getCapabilities` | Built-in preset resolution; overrides; preset-extends-preset chains. |
| `core/device/enumeration` | Provider matching order; first-match-wins; unmatched USB devices in result; mixed device list (iPod + Echo Mini). |
| `core/device/readiness/stages/sysinfo` | Same coverage as the pre-P3 SysInfo stage tests, but now exercising the new package boundary. |
| `core/device/readiness/determine-level` | Isolated rule-based logic — easier to test now that it is extracted. |

### Snapshot / parity tests

- For every generation in the table, assert `getCapabilities(identity)` produces a `DeviceCapabilities` that matches a snapshot file. Snapshot files are committed and any change is a deliberate decision.
- For every built-in mass-storage preset, same.
- Run pre-P3 and post-P3 capability synthesis for the same identity input and diff the outputs — must be empty.

### Integration tests

- `device add --no-mount` with each of: a connected iPod fixture, a connected Echo Mini fixture (mocked USB tree), no device. Verify provider routing and stored profile shape.
- `podkit device scan` finds both iPods and Echo Minis when both are connected.

### Hardware validation

- Re-run the full Phase 3 procedure from `documents/device-testing-playbook.md` against all five inventory devices.
- Plug in an Echo Mini (if available) and verify auto-detection.

## Migration steps

1. Bootstrap `@podkit/devices-ipod`. Copy `ipod-models.ts` content; refactor into the new file structure.
2. Move types to `@podkit/device-types` where they belong (DeviceIdentity, etc.); leave generation/model types in `@podkit/devices-ipod`.
3. Implement `getCapabilities` from scratch in `@podkit/devices-ipod`, libgpod-free. Use `createIpodCapabilities` (the libgpod-coupled adapter) as reference, not source.
4. Snapshot-test the new `getCapabilities` against the old `createIpodCapabilities` for every generation. Diffs are bugs to fix.
5. Add the `ipodProvider`.
6. Replace core imports of `ipod-models.ts` with imports from `@podkit/devices-ipod` (or via the shim file).
7. Bootstrap `@podkit/devices-mass-storage`. Move `presets.ts` content; refactor.
8. Add Echo Mini USB VID/PID hint.
9. Add `definePreset`, validation, extends handling.
10. Add `createMassStorageProvider`.
11. Replace core imports of `presets.ts` with imports from `@podkit/devices-mass-storage` (or via the shim file).
12. Add `enumerateConnectedDevices` in core.
13. De-iPod-ify `usb-discovery.ts`.
14. Wire `device add` to use the new enumeration with both providers; auto-detect Echo Mini.
15. Split `readiness.ts` into `readiness/stages/`. Existing tests pass.
16. Rename `IpodIdentity` → `StoredIpodLink`. Mechanical, big diff.
17. Open `DeviceTypeId` to runtime strings while preserving compile-time literal union.
18. Add re-export shims; deprecate them.
19. Update AGENTS.md.
20. Changeset: minor bump for `podkit` (auto-detect is a behaviour change), `@podkit/core` (internal restructure, public surface preserved by shims), new packages at v0.x.

## Risks

- **Capability snapshot diffs.** Refactoring `createIpodCapabilities` to be libgpod-free may surface subtle differences (e.g., libgpod's `supportsArtwork` reflects per-device state, not a generation property). Snapshot tests catch this. Resolution: use generation tables as authority for what the device class supports, with firmware overlay as enrichment. Document the change in the changeset.
- **Big rename impact (`IpodIdentity`).** Touches CLI, config, tests, docs. Use git's `--find-renames` and a single PR. Run all tests before merge.
- **Re-export shim correctness.** TypeScript types must match exactly across the shim boundary. Tests imported from old paths must continue to work without modification. Verified by leaving existing test files unchanged during P3 and running them against the shim path.
- **Echo Mini auto-detection vs. existing config.** A user who previously added an Echo Mini with `--type echo-mini` should not see duplicate detection or conflicting state. Verify the `device add` flow recognises the existing config before suggesting auto-detection.
- **Provider order matters.** If `ipodProvider` and `massStorageProvider` ever both claim a device (impossible today but conceivable for a future hybrid), the order in the providers list decides. Document this clearly; iPod provider ships first by default.

## Out of scope

- Removing the shims — P4.
- Generation-table data corrections (B867, Touch checksum, etc.) — separate, explicitly out of scope per the PRD.
- The Interactive Device Add Wizard (doc-026) — building blocks land here; UX is separate.
- Capability resolution for the Virtual iPod (m-17) — supported by the architecture but not wired here.
