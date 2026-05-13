---
id: TASK-331
title: 'ReadinessLevel: add ''unsupported'' variant + wire rejection path'
status: To Do
assignee: []
created_date: '2026-05-13 20:24'
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
- [ ] #1 `ReadinessLevel` in packages/podkit-core/src/device/readiness/types.ts gains a `'unsupported'` variant
- [ ] #2 `determineLevel()` in packages/podkit-core/src/device/readiness/determine-level.ts returns `'unsupported'` for devices that match `packages/devices-ipod/src/tables/unsupported.ts` (touch, shuffle, iOS-range)
- [ ] #3 `determineLevel()` returns `'unsupported'` for non-Apple USB devices recognised by vendor but with no registered preset (Sony Walkman, future devices) — verified against the `sony-nwz-e384` persona
- [ ] #4 `ReadinessResult` (or an explicit nested field) exposes the canonical `unsupportedReason` text in a typed way; no more stuffing it into a fail stage's `details`
- [ ] #5 `ipodTouch5gUnsupported` and `sonyNwzE384` personas updated to set `expectedReadiness.level: 'unsupported'` with the canonical reason text
- [ ] #6 `readiness-display.ts`, `device-scan-render.ts`, `doctor.ts`, `device/info.ts`, `device/init.ts` render the new level distinctly from `'unknown'` (different prompt / suggestion / exit code as appropriate)
- [ ] #7 Unit test in packages/podkit-core: `determineLevel()` returns `'unsupported'` for at least the touch 5G PID and the Sony Walkman VID/PID inputs
- [ ] #8 Tier 1 persona smoke test asserts both rejection personas have `level: 'unsupported'` and the correct `unsupportedReason` text
- [ ] #9 `agents/device-testing.md` updated if/where it still says rejection personas use `'unknown'`
- [ ] #10 All existing readiness / doctor / device tests pass with no behavioural regression for supported devices
<!-- AC:END -->
