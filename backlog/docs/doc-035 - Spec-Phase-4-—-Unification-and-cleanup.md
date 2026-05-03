---
id: doc-035
title: 'Spec: Phase 4 — Unification and cleanup'
type: other
created_date: '2026-05-03 11:21'
---
## Phase

P4 of doc-030 (PRD: Device Capability Architecture). Final phase.

## Goal

Move SysInfoExtended file I/O into `@podkit/ipod-firmware`. Replace the regex-based plist extraction with the structured parser. Unify the capability resolution path through `resolveCapabilities`. Delete the re-export shims added in P3 and the libgpod-coupled adapter remnants. Refactor complete.

User-visible outcome: none. P4 is finalisation. The architecture established in P0–P3 is now the only path through the code; transitional scaffolding is gone.

## Scope

### Move SysInfoExtended file I/O into `@podkit/ipod-firmware`

Currently in `podkit-core/device/sysinfo-extended.ts`:

- `readSysInfoExtended(mountPoint)` — file read + regex extraction.
- `ensureSysInfoExtended(mountPoint, usbAddress, readFromUsb?)` — orchestrator.

Both functions move into `@podkit/ipod-firmware`:

```
packages/ipod-firmware/src/sysinfo/
  paths.ts                 SYSINFO_EXTENDED_PATH constants
  read.ts                  readSysInfoExtended(mountPoint) — uses plist parser, not regex
  write.ts                 writeSysInfoExtended(mountPoint, xml)
  ensure.ts                ensureSysInfoExtended(mountPoint, fingerprint) — uses inquireFirmware
```

The new implementation:

- Uses the structured plist parser from P1 instead of regex extraction. The regex code is deleted.
- Returns the same `SysInfoExtendedResult` shape (preserved as a public type).
- `ensureSysInfoExtended` no longer takes a `readFromUsb` injection parameter — the orchestrator does inquiry-method selection internally.

`podkit-core/device/sysinfo-extended.ts` is deleted. Its consumers update their imports:

- `podkit-core/device/readiness/stages/sysinfo.ts`
- `podkit-core/diagnostics/checks/sysinfo-extended.ts`
- `podkit-cli/src/commands/device.ts`
- `podkit-core/src/device/index.ts` (re-export)

The `podkit-core` `device` index continues to re-export `ensureSysInfoExtended` and `readSysInfoExtended` from the firmware package for one more release as a compatibility shim (in case any out-of-tree consumer uses the path), then removed in a subsequent release.

### Delete P3 shims

Files removed:

- `podkit-core/src/device/ipod-models.ts` (P3 shim)
- `podkit-core/src/device/presets.ts` (P3 shim)
- `podkit-core/src/device/capability-adapter.ts` (P3 shim)

All in-tree consumers update to import directly from `@podkit/devices-ipod` and `@podkit/devices-mass-storage`. This is mechanical because the shims preserved the same export names.

### Unify `resolveCapabilities` in core

`podkit-core/src/device/resolve-capabilities.ts` (new) becomes the single entry point used by sync, transcoding, and CLI display:

```typescript
export function resolveCapabilities(
  identity: DeviceIdentity,
  opts?: ResolveCapabilitiesOptions
): DeviceCapabilities;
```

It dispatches on `identity.kind`:

- `'ipod'` → `devicesIpod.getCapabilities(identity, { firmware: opts?.firmware })`
- `'mass-storage'` → `devicesMassStorage.getCapabilities(identity, { presets: opts?.presets ?? BUILT_IN_PRESETS, overrides: opts?.overrides })`

Existing call sites that previously called `createIpodCapabilities` directly (which already moved to a shim in P3) are migrated to call `resolveCapabilities`. The sync engine, planner, and transcoder no longer touch the iPod or mass-storage packages directly — only the unified resolver.

### Update doc-003

`backlog/docs/doc-003 - ipod-db Design Document` decision **D15** ("SysInfoExtended is Out of Scope — Only Touch/iPhone/iPad use it") is incorrect — SysInfoExtended is required for hash58, hash72, and hashAB devices in the iPod target range. The document is updated to:

- Remove or correct D15.
- Add a "Relationship to Device Capability Architecture" section that points to doc-030 and clarifies SysInfoExtended handling lives in `@podkit/ipod-firmware`, not in `@podkit/ipod-db`.
- Note that `@podkit/ipod-db` consumes parsed FireWireGUID directly (from the firmware package or from cached identity) and does not need the on-disk file for its own purposes.

This is a documentation-only change but a meaningful one — m-8 implementer needs the corrected guidance.

### Write the ADR

A new ADR under `adr/` captures the architectural decisions:

- The shift from libusb-only inquiry to USB-first / SCSI-fallback selection.
- The decision to use FFI rather than additional native bindings.
- The four-package architecture (`device-types`, `devices-ipod`, `devices-mass-storage`, `ipod-firmware`).
- The Provider pattern for extensible enumeration.
- The pure-functional preset registry (no globals).
- The literal-plus-runtime-string union pattern for IDs.

The ADR cross-references doc-030 (PRD), doc-013 (DeviceCapabilities interface), doc-020 (multi-device decisions), doc-029 (predecessor PRD), and the per-phase specs.

## Acceptance criteria

1. `@podkit/ipod-firmware` owns all SysInfoExtended file I/O. The regex-based extraction is gone; the structured plist parser is the only path.
2. `core/device/sysinfo-extended.ts` is deleted; consumers import from `@podkit/ipod-firmware`.
3. `core/device/ipod-models.ts`, `core/device/presets.ts`, and `core/device/capability-adapter.ts` shim files are deleted.
4. `resolveCapabilities` is the only entry point used by sync, transcoding, and CLI display.
5. No reference to `LibgpodDeviceInfo` exists in the codebase.
6. doc-003 D15 corrected with reference to doc-030.
7. ADR written, merged, status "Accepted".
8. All existing tests pass with no regressions.
9. Hardware validation per the inventory: all five devices behave identically to P3.
10. AGENTS.md updated to reflect the final package structure.
11. CHANGELOG updated for `podkit` and all affected packages.
12. Any backlog items related to "SCSI inquiry support" or "device capability architecture" closed.

## Test plan

### Unit tests

- Plist-parser-based extraction tests replace the regex-based extraction tests in `sysinfo-extended.test.ts`. Coverage is broader: the structured parser handles cases the regex could not (nested dicts, arrays, integer values), enabling tests for fields beyond firewireGuid + serialNumber.
- `resolveCapabilities` dispatch tests: iPod identity → iPod capabilities path; mass-storage identity → mass-storage capabilities path; unknown kind → error.

### Integration tests

- `ensureSysInfoExtended` end-to-end with the new plist parser, against captured XML fixtures. Verify identity extraction matches the regex-era results plus the additional fields the parser now exposes.
- Sync engine planning with `resolveCapabilities` — confirm capability resolution behaves identically to the pre-P4 path through `createIpodCapabilities`.

### Hardware validation

- Re-run all five inventory devices through the full doctor and sync-dry-run flow. Results match P3.

## Migration steps

1. Move `sysinfo-extended.ts` implementation into `@podkit/ipod-firmware/sysinfo/`.
2. Replace regex extraction with the structured plist parser. Existing tests adjusted to reflect richer extraction.
3. Update all in-tree consumers' imports.
4. Add a one-release re-export shim from `core/device/sysinfo-extended.ts` for any out-of-tree consumers.
5. Delete `core/device/ipod-models.ts`, `core/device/presets.ts`, `core/device/capability-adapter.ts` shim files. Update all in-tree consumers' imports to direct package imports.
6. Implement `resolveCapabilities` in core. Migrate sync engine, planner, transcoder, CLI display call sites.
7. Run snapshot tests to confirm capability resolution identical pre/post.
8. Update doc-003 (correct D15, add section pointing to doc-030).
9. Write ADR. Merge in "Proposed" status, update to "Accepted" once architecture validated against the new code.
10. Hardware validation.
11. AGENTS.md update.
12. Changeset entries: `@podkit/core` (breaking import path changes for any out-of-tree consumers; in-tree shim covers most cases), `@podkit/ipod-firmware` (sysinfo I/O API additions), no new packages.
13. Release.

## Risks

- **Sync engine regression from `resolveCapabilities` migration.** The sync engine has many call sites that touch capabilities. Use snapshot tests against representative configs (both iPod and Echo Mini) before and after the migration to catch any drift.
- **Plist parser handling unfamiliar XML.** Real iPods have produced occasional surprises (extra whitespace, comments, alternative casing). The parser should be lenient about whitespace and capitalisation, strict about structure. Test with the captured XML files in `documents/sysinfo-captures/` and any additional captures that surface during P4.
- **doc-003 update conflict with active m-8 work.** If m-8 has tasks in flight when D15 is corrected, coordinate with m-8 owners. The correction is non-breaking for in-flight work — it expands rather than constrains.
- **ADR write timing.** Writing the ADR before P4 is complete risks documenting decisions that might still change. Best done after migration steps 1–7 confirm the architecture is stable.

## Out of scope

- Removing the libgpod-node binding entirely — that is m-8's job. P4 makes m-8 cleaner.
- Generation table data corrections — explicitly out of scope per PRD.
- Pluggable third-party device packages with runtime discovery — future work.
- Capability resolution for Virtual iPod — supported by architecture, wiring is separate.
- Windows support — out of scope per PRD.

## Closing notes

After P4, the device capability architecture is complete. `podkit-core` is meaningfully smaller — `ipod-models.ts` (2,013 lines), `presets.ts`, `capability-adapter.ts`, and `sysinfo-extended.ts` are gone, replaced by package imports. `readiness.ts` is split into per-stage modules. The libgpod-node binding has lost its USB inquiry surface and is closer to deletion when m-8 lands.

Adding a new device class — Sony Walkman, FiiO models, Astell & Kern — becomes a self-contained package with a Provider, a capability resolver, and zero core changes.
