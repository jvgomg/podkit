---
id: TASK-331
title: 'ReadinessLevel: add ''unsupported'' variant + wire rejection path'
status: Done
assignee: []
created_date: '2026-05-13 20:24'
updated_date: '2026-05-14 23:43'
labels:
  - testing
  - vm-coverage
  - schema
  - readiness
milestone: m-19
dependencies:
  - TASK-321.02
documentation:
  - packages/podkit-core/src/device/readiness/types.ts
  - packages/podkit-core/src/device/readiness/determine-level.ts
  - packages/devices-ipod/src/tables/unsupported.ts
  - documents/persona-capture-playbook.md
priority: medium
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `ReadinessLevel` to include `'unsupported'` so the readiness pipeline can distinguish "device is recognised but explicitly not supported" from `'unknown'` ("we don't know what this is").

**Why this is needed:**

The persona-capture pass for TASK-321.02 surfaced this gap twice:

1. **`ipod-touch-5g-unsupported`** — iPod touch 5G, recognised via Apple's published-as-unsupported product-ID table (`packages/devices-ipod/src/tables/unsupported.ts`). The `unsupportedReason` text is well-defined; the readiness result has nowhere to put it cleanly.
2. **`sony-nwz-e384`** — Sony Walkman NWZ-E380 series, recognised via USB descriptor (VID `0x054c` / PID `0x0882`) but no mass-storage preset registered today. Same shape — recognised, not supported.

Both personas currently set `expectedReadiness.level: 'unknown'` and stuff the rejection text into a fail `usb` stage's `details.unsupportedReason`. This is a workaround that conflates two distinct outcomes:

- `'unknown'` = the pipeline failed to identify the device at all (mismatched VID, malformed descriptor, transport error)
- `'unsupported'` = the pipeline identified the device and we explicitly refuse to operate on it

Downstream consumers (`packages/podkit-cli/src/commands/doctor.ts`, `device-scan-render.ts`, `readiness-display.ts`, `device/info.ts`, `device/init.ts`) can render these differently — unsupported gets the canonical rejection reason; unknown gets a "no idea what this is" prompt to capture diagnostic data.

**Current schema:**

```ts
// packages/podkit-core/src/device/readiness/types.ts:18-25
export type ReadinessLevel =
  | 'ready'
  | 'needs-repair'
  | 'needs-init'
  | 'needs-format'
  | 'needs-partition'
  | 'hardware-error'
  | 'unknown';
```

**Proposed:**

Add `'unsupported'`. The new level applies when:
- An iPod-range Apple PID matches `tables/unsupported.ts` (touch, shuffle, iOS-range)
- A non-Apple USB device matches a vendor we recognise but have no preset for (Sony Walkman, future devices)
- Any device-identification path returns a structured "we know what this is, we don't support it" result

**Where the rejection happens today:**

- `packages/devices-ipod/src/provider.ts` / `classify.ts` — surface `unsupportedReason` from the identity table.
- `packages/podkit-core/src/device/readiness/determine-level.ts` — currently the cascade returns `'unknown'` for any device the inquiry pipeline can't resolve to a supported model.
- `packages/podkit-cli/src/commands/device/scan.ts` and `device-scan-render.ts` — already render `unsupportedReason` separately for the `device scan` command. That code path needs to be reconciled with the new level.

**Implementation outline (not prescriptive — let the implementer choose):**

1. Add `'unsupported'` to `ReadinessLevel`.
2. Extend `ReadinessResult` (or piggy-back on an existing stage's `details`) so the canonical `unsupportedReason` text is reachable from a single, typed field — e.g. `unsupportedReason?: string` at the result level.
3. Update `determineLevel()` in `packages/podkit-core/src/device/readiness/determine-level.ts` to return `'unsupported'` when the cascade hits a recognised-but-rejected device. The signal is currently carried via `assessment` / `provider` rejection; thread it through.
4. Update consumers — `readiness-display.ts`, `device-scan-render.ts`, `doctor.ts`, `device/info.ts`, `device/init.ts` — to render `'unsupported'` distinctly from `'unknown'`. The doctor "what to do next" suggestion for `'unsupported'` is "this device is not supported by podkit; see <docs>"; for `'unknown'` it remains "could not identify device; capture diagnostics".
5. Update both rejection personas (`ipod-touch-5g-unsupported`, `sony-nwz-e384`) to use `'unsupported'` and assert against the new shape in their smoke tests.
6. Update `agents/device-testing.md` §"Synthesised personas" if it locks in `'unknown'` for rejection cases.

**Test coverage:**

- Unit test in `packages/podkit-core/src/device/readiness/__tests__/`: `determineLevel()` returns `'unsupported'` for the touch 5G inquiry path and the Sony Walkman inquiry path.
- Tier 1 persona test: `ipodTouch5gUnsupported.expectedReadiness.level === 'unsupported'`; same for `sonyNwzE384`.
- CLI snapshot test: `podkit doctor` against an unsupported device prints the unsupported message + exits cleanly (not as a generic error).

**Out of scope (file separately if wanted):**

- Implementing the Sony Walkman preset itself (the right place is m-16 "Mass Storage Device Support: Extended"; the persona fixture is ready).
- iPod touch 5G unsupported-device UX redesign — already tracked elsewhere in the backlog (`device add` doesn't surface the unsupported reason today, only `device scan` does).

**Slots into m-19 because** the gap was discovered during persona capture (TASK-321.02) and the new variant is what TASK-321.02's smoke tests + the TASK-301..311 doctor coverage sweep will assert against. Better to land before the test-writing tasks pick up the personas.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ReadinessLevel` in packages/podkit-core/src/device/readiness/types.ts gains a `'unsupported'` variant
- [x] #2 `determineLevel()` in packages/podkit-core/src/device/readiness/determine-level.ts returns `'unsupported'` for devices that match `packages/devices-ipod/src/tables/unsupported.ts` (touch, shuffle, iOS-range)
- [x] #3 `determineLevel()` returns `'unsupported'` for non-Apple USB devices recognised by vendor but with no registered preset (Sony Walkman, future devices) — verified against the `sony-nwz-e384` persona
- [x] #4 `ReadinessResult` (or an explicit nested field) exposes the canonical `unsupportedReason` text in a typed way; no more stuffing it into a fail stage's `details`
- [x] #5 `ipodTouch5gUnsupported` and `sonyNwzE384` personas updated to set `expectedReadiness.level: 'unsupported'` with the canonical reason text
- [x] #6 `readiness-display.ts`, `device-scan-render.ts`, `doctor.ts`, `device/info.ts`, `device/init.ts` render the new level distinctly from `'unknown'` (different prompt / suggestion / exit code as appropriate)
- [x] #7 Unit test in packages/podkit-core: `determineLevel()` returns `'unsupported'` for at least the touch 5G PID and the Sony Walkman VID/PID inputs
- [x] #8 Tier 1 persona smoke test asserts both rejection personas have `level: 'unsupported'` and the correct `unsupportedReason` text
- [x] #9 `agents/device-testing.md` updated if/where it still says rejection personas use `'unknown'`
- [x] #10 All existing readiness / doctor / device tests pass with no behavioural regression for supported devices
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation landed via the readiness-cascade short-circuit pattern (no
new pipeline; existing call sites thread one new optional field).

## Files touched

### Core (schema + cascade)
- `packages/podkit-core/src/device/readiness/types.ts` — added `'unsupported'` to `ReadinessLevel`; added typed `ReadinessResult.unsupportedReason?: string`; added `ReadinessInput.unsupportedReason?: string` so callers can thread the classifier's rejection signal.
- `packages/podkit-core/src/device/readiness/determine-level.ts` — added overloaded `determineLevel()` with a `DetermineLevelContext` parameter (`vendorId`/`productId`/`unsupportedReason`). Short-circuits to `level: 'unsupported'` when the Apple unsupported-PID table (or iOS-range fallback) matches, OR when the caller supplies a reason. Imports `lookupUnsupportedReason`/`lookupIosRangeFallbackReason` from `@podkit/devices-ipod`.
- `packages/podkit-core/src/device/readiness/index.ts` — `checkReadiness()` short-circuits when `input.unsupportedReason` is set (skips every stage, returns `level: 'unsupported'` + reason at the result level). `createUsbOnlyReadinessResult()` does the same when the iPod classification carries `supported: false`.

### Mass-storage classifier (non-Apple unsupported vendors)
- `packages/devices-mass-storage/src/unsupported.ts` (new) — `UNSUPPORTED_VENDORS` table + `classifyAsUnsupportedDevice()`. Currently contains the Sony Walkman (`054c`) entry.
- `packages/devices-mass-storage/src/index.ts` — re-exports the new classifier + type.
- `packages/podkit-core/src/device/classify.ts` — extended `RecognizedDevice` union with `UnsupportedDeviceClassification`; `classifyUsbDevices` falls through to `classifyAsUnsupportedDevice` after iPod / mass-storage classifiers.
- `packages/podkit-core/src/device/index.ts` + `packages/podkit-core/src/index.ts` — re-export `UnsupportedDeviceClassification`.

### CLI consumers (text rendering + JSON envelope)
- `packages/podkit-cli/src/commands/readiness-display.ts` — `formatReadinessLevel` emits "Not supported — podkit cannot operate on this device". Added `formatUnsupportedReason()` for the reason line.
- `packages/podkit-cli/src/commands/device-scan-render.ts` — new `pushUnsupportedRow()` for vendor-recognised devices; readiness block prints the canonical reason when `level === 'unsupported'`.
- `packages/podkit-cli/src/commands/device/scan.ts` — threads `notSupportedReason` from iPod classification into `checkReadiness`; collects `kind: 'unsupported'` classifications and surfaces them in the JSON envelope + the rendered output.
- `packages/podkit-cli/src/commands/doctor.ts` — early-return on `level === 'unsupported'` with a focused "Device is not supported by podkit" message + exit code 1 (distinct from "issues found" exit 2). Adds `unsupportedReason` to the readiness JSON shape.
- `packages/podkit-cli/src/commands/device/info.ts` — surfaces "Reason: <text>" inline when readiness is unsupported; passes `unsupportedReason` through to JSON.
- `packages/podkit-cli/src/commands/device/init.ts` — refuses operation with `CliError` (`UNSUPPORTED_DEVICE` code) when the readiness cascade returns `unsupported`.
- `packages/podkit-cli/src/commands/device/output-types.ts` — added `unsupportedReason?: string` to readiness JSON shape.

### Personas flipped
- `packages/device-testing/src/personas/ipod-touch-5g-unsupported/persona.ts` — `level: 'unsupported'` + canonical reason from `tables/unsupported.ts` (touch 5G entry).
- `packages/device-testing/src/personas/sony-nwz-e384/persona.ts` — `level: 'unsupported'` + reason matching `UNSUPPORTED_VENDORS[Sony].reason('054c', '0882')`.

### Tests (all green)
- `packages/podkit-core/src/device/readiness/__tests__/determine-level.test.ts` (new, 13 tests) — touch 5G, shuffle 3G/4G, nano 7G, iOS-range fallback, 0x-prefix handling, caller-supplied reason wins, non-Apple vendor does NOT collapse to unsupported, supported iPod PID does NOT collapse, backwards-compat overload contracts.
- `packages/podkit-core/src/device/readiness/__tests__/check-readiness-unsupported.test.ts` (new, 3 tests) — `checkReadiness` short-circuit + negative test.
- `packages/devices-mass-storage/src/unsupported.test.ts` (new, 5 tests) — Sony VID classification + table integrity.
- `packages/device-testing/src/personas/rejection-personas.test.ts` (new, 6 tests) — pins both personas' `level: 'unsupported'` + canonical reason + usb-stage detail sync.
- `packages/podkit-cli/src/commands/doctor-exit-code.test.ts` (extended, +3 tests) — JSON envelope surfaces `level: 'unsupported'` + reason + exit 1; Sony Walkman path; negative test: `level: 'unknown'` does NOT trip exit 1.

## Rejection signal flow

`classifyAsIpod` / `classifyAsUnsupportedDevice` (per-device classifier) →
`classifyUsbDevices` (composer in `@podkit/core`) → caller (e.g.
`device scan`) reads `matchedUsb.notSupportedReason` or `unsupportedRecognized.reason` →
threads it into `checkReadiness({ unsupportedReason })` →
`checkReadiness` short-circuits → `ReadinessResult.unsupportedReason` →
consumers (`doctor`, `device info`, `device init`, `device scan`) render
it.

## Design choices

- Kept `determineLevel(stages)` backwards-compatible (returns a bare
  `ReadinessLevel` string) and added an overload with the context object
  returning a `DetermineLevelResult`. Existing tests / call sites untouched.
- Exit code on doctor's unsupported branch: **1** (hard rejection, not
  fixable) rather than 2 ("issues found"). Aligns with `setExitCode(1)`
  pattern used elsewhere for non-recoverable conditions. The TASK-308
  decision matrix has nothing on `'unsupported'` yet — flagged for review.
- `agents/device-testing.md` already keeps `expectedReadiness` typed via
  the shared `DevicePersona` interface and references `'unknown'` only for
  the "fully unrecognised, no descriptor" synthetic persona. No
  documentation rewrite needed.

## Open items for review

- The doctor's text-mode render for unsupported devices is intentionally
  minimal (title + error line + reason + docs link). If the team wants a
  fuller "Issues" block layout, easy to extend.
- The TASK-308 exit-code matrix should be extended to cover `unsupported`
  formally — followup or fold into the doctor tests as TASK-308 lands.
<!-- SECTION:NOTES:END -->
