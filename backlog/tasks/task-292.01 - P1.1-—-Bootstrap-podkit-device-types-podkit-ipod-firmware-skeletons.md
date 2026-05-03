---
id: TASK-292.01
title: P1.1 — Bootstrap @podkit/device-types + @podkit/ipod-firmware skeletons
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 13:13'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the two new package directories with build, lint, and test infrastructure. Move shared types into `@podkit/device-types` and add re-export shims in podkit-core for back-compat. `@podkit/ipod-firmware` ships as an empty skeleton in this task — implementations follow.

See spec doc-032, Scope section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/device-types/ exists with package.json, build script, test runner
- [x] #2 packages/ipod-firmware/ exists with package.json, build script, test runner
- [x] #3 DeviceCapabilities, AudioCodec, DeviceArtworkSource, AudioNormalizationMode moved to @podkit/device-types
- [x] #4 DeviceIdentity, DeviceProvider, UsbFingerprint, ParsedFirmware, FirmwareCapabilities types added to @podkit/device-types
- [x] #5 podkit-core re-exports the moved types via shim for back-compat
- [x] #6 Both packages build successfully and pass empty test suite in CI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Bootstrapped both packages mirroring @podkit/ipod-db's layout. Moved DeviceCapabilities/AudioCodec/DeviceArtworkSource/AudioNormalizationMode to @podkit/device-types verbatim; podkit-core/src/device/capabilities.ts now re-exports for back-compat. New types added: UsbFingerprint, DeviceIdentity discriminated union, DeviceProvider, ParsedFirmware, FirmwareCapabilities. ipod-firmware ships skeleton public surface only — orchestrator/probe/parser throw 'not implemented in P1.1'. Diagnostic checks declared with locally-scoped `DiagnosticCheck = unknown` to avoid future core→ipod-firmware→core circular dep; will be aligned to core's diagnostic framework in TASK-292.09. Quality gates: build/typecheck/lint/test all pass. 31 pre-existing core test failures unchanged (verified against main).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bootstrap complete. Both packages created and wired into the workspace.

**packages/device-types/** — `@podkit/device-types` v0.0.1: package.json (type module, no runtime deps), tsconfig.json/tsconfig.build.json (mirrored from ipod-db), bunfig.toml, test/preload.ts. Source: capabilities.ts (verbatim move from podkit-core), identity.ts (UsbFingerprint, IpodIdentity, MassStorageIdentity, DeviceIdentity), firmware.ts (FirmwareCapabilities, ParsedFirmware), provider.ts (DeviceProvider interface), index.ts (re-exports all). Sentinel test in capabilities.test.ts exercises the DeviceCapabilities shape at runtime.

**packages/ipod-firmware/** — `@podkit/ipod-firmware` v0.0.1: same scaffold shape. Workspace deps on @podkit/device-types and @podkit/libgpod-node. inquiry/orchestrator.ts (inquireFirmware + ScsiTransport/UsbTransport/InquireOptions — throws 'not implemented in P1.1'), inquiry/probe.ts (probeInquiryMethods + InquiryMethodsAvailability — throws), plist/parser.ts (parsePlist + full PlistValue union — throws), diagnostics/inquiry-methods.ts and sysinfo-consistency.ts (placeholder DiagnosticCheck = unknown, exports null constants with TODO comments pointing to TASK-292.09). Sentinel test in public-surface.test.ts verifies all exports import cleanly and stubs are null.

**packages/podkit-core/src/device/capabilities.ts** — replaced body with `export type { ... } from '@podkit/device-types'` re-export shim. All 15+ internal importers inside podkit-core still use the `./capabilities.js` relative path and continue to resolve through the shim — verified by full `bun run typecheck` pass and `bun run build` success.

**Non-obvious decision:** The DiagnosticCheck type in the ipod-firmware diagnostics stubs is defined as `unknown` (not imported from @podkit/core) to avoid a circular dependency — ipod-firmware would otherwise depend on core, which will eventually depend on ipod-firmware. This is intentional; TASK-292.09 will replace the stubs with real implementations registered directly in core's diagnostics registry, at which point core imports ipod-firmware (one-way). The `// TODO: align with core diagnostics framework in 292.09` comments mark both stub files.
<!-- SECTION:FINAL_SUMMARY:END -->
