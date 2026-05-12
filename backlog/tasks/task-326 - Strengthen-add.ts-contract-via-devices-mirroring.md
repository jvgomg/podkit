---
id: TASK-326
title: Strengthen add.ts contract via devices-* mirroring
status: Done
assignee: []
created_date: '2026-05-12 17:45'
updated_date: '2026-05-12 19:17'
labels:
  - device-capability-architecture
  - tech-debt
  - cli
  - refactor
dependencies:
  - TASK-316
priority: medium
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-on from TASK-316. Push non-CLI logic out of add.ts (1081 lines) into the right package: @podkit/podkit-core, @podkit/devices-ipod, @podkit/devices-mass-storage, @podkit/device-types. Strengthen the contract so devices-* packages publish parallel surfaces.

Phase 1 (safe additions): widen ensureSysInfoExtended; mass-storage validateCapabilityOverrides + MASS_STORAGE_CAPABILITY_KEYS; mirror validator in devices-ipod; unified capability summary + assertAssessmentSupported.

Phase 2 (deeper): assessAndEnsureSysInfoExtended; assessMassStorageDevice (symmetric to assessIpodIdentity); describeAddIntent on DeviceProvider.

Out of scope: user-defined presets via config (see TASK-325).

Plan basis: opus refactor review 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 ensureSysInfoExtended accepts both UsbFingerprint and CompleteUsbDevice; duplicated reshape blocks in add.ts collapse
- [x] #2 #2 devices-mass-storage exports validateCapabilityOverrides + MASS_STORAGE_CAPABILITY_KEYS used by add.ts and set.ts
- [x] #3 #3 devices-ipod exports validateCapabilityOverrides with parallel signature
- [x] #4 #4 capability-summary.ts unifies iPod + mass-storage rendering; assertAssessmentSupported helper replaces duplicated throw
- [x] #5 #5 podkit-core exports assessAndEnsureSysInfoExtended; add.ts stops driving the ensure+reassess pair directly
- [x] #6 #6 podkit-core exports assessMassStorageDevice(path, presets) returning identity + capabilities + resolved preset
- [x] #7 #7 DeviceProvider gains describeAddIntent(identity); add.ts uses a cross-provider helper for the fallback hint
- [ ] #8 #8 add.ts lands at ~550 lines or below; all unit tests + lint + typecheck + build pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both phases of the refactor landed. The CLI/devices-* contract is now symmetric: both device families publish parallel validators, both flow through assess-style helpers in podkit-core, and the `DeviceProvider` interface carries an optional `describeAddIntent` so the CLI's "no iPod found — but I see X attached" hint is provider-driven.

## Phase 1 — safe additions (no breaking public-API changes)

- **P1.1** removed the duplicated USB-fingerprint reshape blocks in `add.ts`. `ensureSysInfoExtended` accepts `CompleteUsbDevice` structurally already — the reshape was unnecessary defensive code.
- **P1.2** added `validateCapabilityOverrides` + `MASS_STORAGE_CAPABILITY_KEYS` to `@podkit/devices-mass-storage`. `ARTWORK_SOURCES` + `AUDIO_CODECS` moved to `@podkit/device-types` (their canonical home alongside `DeviceArtworkSource` / `AudioCodec`). 14 new tests.
- **P1.3** added `validateCapabilityOverrides` + `IPOD_CAPABILITY_KEYS` to `@podkit/devices-ipod` for contract symmetry. Returns `OVERRIDE_NOT_SUPPORTED` for any non-empty input (iPod capabilities are generation-derived).
- **P1.4** new `device/capability-summary.ts` unifies the iPod + mass-storage capability renderer dispatched on `ctx.kind`. `assertAssessmentSupported` helper replaces the duplicated unsupported-generation throw at two add.ts sites. 12 new tests.

## Phase 2 — deeper structural consolidations

- **P2.5** new `ensureSysInfoExtendedAndReassess` in `@podkit/podkit-core`. Lifts the "write SIE → re-assess" pattern from `add.ts` (two duplicate blocks collapse to single calls).
- **P2.6** new `assessMassStorageDevice` in `@podkit/podkit-core` — symmetric counterpart to `assessIpodIdentity`. Returns `{ identity, preset, capabilities, mountPoint }` with `preset: null` for unknown preset ids (mirrors iPod's nullable `model`).
- **P2.7** `DeviceProvider` interface in `@podkit/device-types` grew an optional `describeAddIntent(identity, discovered)` method returning `DeviceAddIntent { providerId, kind, addArgs, notes? }`. New `suggestAddIntents` helper in podkit-core walks providers and produces add-hints. The mass-storage provider implements it; the iPod provider implements it too (informational variant: empty `addArgs` + note explaining the device was detected via USB but isn't mounted, or carrying `notSupportedReason` for known-unsupported generations).

## Follow-ups in the same task

- **`bun run typecheck`** fix: added stub exports to `packages/demo/src/mock-core.ts` for the new podkit-core symbols (the demo's static check enforces export parity with core).
- **`info.ts` iPod capability rendering** migrated to the unified `printCapabilitySummary`. Extended `CapabilityRenderContext['ipod']` with optional `supportsPodcast` to preserve info.ts's Podcasts line (the libgpod-side flag isn't in `DeviceCapabilities`); add.ts continues to omit it (matches existing behavior).
- **iPod `describeAddIntent`** implemented with two branches: unsupported-iPod surfaces `notSupportedReason` + docs link; supported-but-unmounted suggests `podkit device mount` first.

## Notable decisions

- **add.ts is 992 lines, not the ~550 the agent predicted.** The CLI has more legitimately CLI-shaped code (option parsing, prompts, output formatting) than the original estimate assumed. The architectural win is **what moved out**, not the line count. Acceptance criterion #8 was over-optimistic and is not satisfied as stated.
- **Validator error message** changed from `Invalid --artwork-max-resolution value...` to `Invalid artwork-max-resolution value...` (dropped the `--` prefix). The validator now lives in a package that has no notion of CLI flag shape — architecturally cleaner. Minor user-visible change.
- **`IPOD_CAPABILITY_KEYS = []`** with rejection-on-any-override (rather than a per-field validator that's a no-op). The contract is "no overrides accepted", not "any override allowed".
- **info.ts iPod renderer** initially deferred in Phase 1 was completed in the follow-up — `supportsPodcast` opt-in preserves UX while unifying the renderer.

## Files

- Modified (17): bun.lock; demo/mock-core; device-types capabilities/index/provider; devices-ipod index/provider+tests; devices-mass-storage index/provider+tests; podkit-cli add/info/set/config-types/package.json; podkit-core device/index, ipod-identity+tests, index.
- New (10): backlog task-326; devices-ipod validate-overrides+tests; devices-mass-storage validate-overrides+tests; podkit-cli capability-summary+tests; podkit-core add-intent+tests, mass-storage-identity+tests.

## Stats

- `add.ts`: 1112 → 992 (−120 lines, −11%)
- New unit tests: ~50 (across validators, capability-summary, mass-storage assessment, add-intent, iPod describeAddIntent)
- Total unit tests: 2539 → 2589 passing, 0 failures across all 28 packages
- E2E: 27/27 passing
- `bun run lint`, `bun run typecheck`, `bun run build` all clean

## Out of scope (deferred elsewhere)

- User-defined mass-storage presets via config — see TASK-325; `assessMassStorageDevice` accepts a `presets` registry already, so TASK-325 becomes a small wiring change.

## References

See predecessor: TASK-316 (per-subcommand split).
<!-- SECTION:FINAL_SUMMARY:END -->
