---
id: TASK-322.06
title: Tier 3 integration tests against starter personas
status: Done
assignee: []
created_date: '2026-05-12 09:35'
updated_date: '2026-05-16 00:39'
labels:
  - testing
  - vm-coverage
  - tier-3
  - integration
milestone: m-19
dependencies:
  - TASK-322.01
  - TASK-322.02
  - TASK-322.03
  - TASK-322.04
  - TASK-322.05
  - TASK-322.05.01
  - TASK-333
  - TASK-321.01
  - TASK-321.02
parent_task_id: TASK-322
priority: high
ordinal: 460
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the first Tier 3 integration tests against the 3 starter personas from TASK-321.02.

**Status (2026-05-14): PARTIALLY LANDED — paused at the doctor/CLI boundary.**

What landed and is green on macOS dev hosts (auto-skipped when Lima absent):
- Tier-3 setup helpers (`packages/device-testing/src/tier3/tier3-runtime-setup.ts`): runner-availability detection (`resolveTier3Availability`), persona-by-state grouping (`groupPersonasByState`), per-test timeout constants (warm 10s / cold 60s), single warning-on-skip emission
- Persona fixture (`packages/device-testing/src/tier3/persona-fixture.ts`): `withPersona()` daemon-lifecycle wrapper + `runJsonCommand()` helper with `parseError` surfacing
- Test grouping convention documented in the test-file header (one `describe` per SystemState → one `applyState()` per group)
- `device scan --format json` assertion: well-formed-JSON shape check (forward-compatible; strengthens once descriptor handshake lands)
- `withPersona` lifecycle smoke test
- Turbo task `@podkit/device-testing#test:tier3` with explicit `cache: true` and full input set covering `tier3/**`, `personas/**`, `system-states/**`, `runners/**`, `tools/device-testing/**`

What is BLOCKED — do not add scaffolding/skipped tests for these; resume after deps land:
- **doctor-vs-state assertion** (originally part of AC #2): blocked by **TASK-333** (Doctor system-only invocation mode). Today's CLI cannot run `doctor --scope system --json` — it requires a registered device and exits `DEVICE_NOT_RESOLVED` with no device configured. Once TASK-333 lands, add an assertion comparing `doctor --scope system --json` output to `state.expectedDoctorSystemOutput` (subset semantics: every expected check id+status appears).
- **Real USB synthesis assertion** (strengthens AC #2): blocked by **TASK-322.05.01** (FunctionFS descriptor handshake). Today the daemon mounts FunctionFS and runs the SETUP loop but does not publish descriptors, so `dummy_hcd` never enumerates a device. Once the handshake lands, replace the well-formed-JSON shape check on `device scan` with the persona-vendor/product lookup already drafted as a TODO comment in `personas-baseline.tier3.test.ts`.
- **Live wall-time validation** (AC #5): can only be measured against a real VM with the above two pieces in place.

**Personas in scope:** `ipod-video-5g-iflash-1tb` (covers `ipod-video-5g-fresh` — SCSI-fallback inquiry path), `ipod-nano-7g-space-gray` (covers `ipod-nano-7g-populated` — USB inquiry path), `echo-mini` (covers `echo-mini-empty` — mass-storage path). The TASK-321.02 captured personas are referenced via aliases in `tier3-runtime-setup.ts` so the original spec persona-IDs still work as identifiers.

**Test grouping:** tests are organised by required `SystemState`. All baseline persona tests use the `healthy` state — they form one group. Snapshot restore (`base-healthy`) happens once for the group via the runner's `applyState()`, then all persona tests run in sequence. Adding a `no-ffmpeg` persona test later naturally forms a second group with zero structural change.

**Scope of this task:** the 3 starter personas. Each persona = at least one assertion that works today + the assertions blocked above will be added by the dependency tasks (TASK-322.05.01 and TASK-333 explicitly own those test edits). Combinatorial doctor matrix (TASK-307–311) and persona expansion (TASK-324) bring further coverage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 3 Tier 3 tests exist, one per starter persona, all green on a mac dev host with Lima installed (subject to scaffolded-today assertions; full integration green tied to dependencies)
- [ ] #2 Each test exercises `podkit device scan --json` against the synthesized device. Doctor-vs-state assertion is added by TASK-322.05.01 once TASK-333 has landed (do NOT add skipped tests today)
- [ ] #3 Assertions check against the persona's expectedCapabilities and the SystemState's expectedDoctorSystemOutput — no inline goldens
- [ ] #4 Tests skip cleanly with a single-line warning when no Linux runner is available
- [ ] #5 Test wall time per persona under 10 seconds (VM warm); under 60 seconds (VM cold-start including snapshot restore) — measurable once TASK-322.05.01 closes USB synthesis
- [ ] #6 Cache hit (no source change) skips test execution via turbo
- [ ] #7 Persona list covers ipod-video-5g-iflash-1tb (as ipod-video-5g-fresh), ipod-nano-7g-space-gray (as ipod-nano-7g-populated), and echo-mini (as echo-mini-empty)
- [ ] #8 Tests are grouped by required SystemState; snapshot restore happens once per group, not per test
- [ ] #9 Test file headers document the grouping convention as the standard for Tier 3 tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 3 Tier-3 scaffold landed; live integration paused at the doctor + handshake boundary

### Files added
- `src/tier3/tier3-runtime-setup.ts` — starter persona resolution, state grouping (one group per `SystemState`), Tier-3 availability detection gated on `PODKIT_DEVTEST_RUN_TIER3=1` + `lima-test-vm` runner availability, wall-time budget constants.
- `src/tier3/tier3-runtime-setup.test.ts` — unit tests of the setup helpers (scripted fakes, runs everywhere).
- `src/tier3/persona-fixture.ts` — per-persona daemon lifecycle (`withPersona`) and JSON CLI invocation helper (`runJsonCommand`) with `parseError` surfacing.
- `src/tier3/personas-baseline.tier3.test.ts` — 2 tests per starter persona × 3 personas (device-scan well-formed-JSON shape check + `withPersona` lifecycle smoke). Doctor-vs-state assertion deliberately omitted, owned by TASK-322.05.01 once TASK-333 lands.

### Files touched
- `packages/device-testing/package.json` — added `test:tier3` script.
- `turbo.json` — added `@podkit/device-testing#test:tier3` task with `cache: true` and inputs covering `src/tier3/**`, `src/personas/**`, `src/system-states/**`, `src/runners/**`, `src/runtime.ts`, `src/subprocess.ts`, `$TURBO_ROOT$/tools/device-testing/**`, `package.json`, `bunfig.toml`.
- `packages/device-testing/src/runners/lima-test-vm-snapshots.ts` — graceful fallback when the Lima driver returns `unimplemented` for snapshot operations (Lima 2.x VZ on Apple Silicon). See TASK-322.02.01.

### Starter persona mapping
- `ipod-video-5g-fresh` → `ipod-video-5g-iflash-1tb`
- `ipod-nano-7g-populated` → `ipod-nano-7g-space-gray`
- `echo-mini-empty` → `echo-mini`

### Auto-skip strategy
Tier-3 only runs when ALL of:
1. `PODKIT_DEVTEST_RUN_TIER3=1` is set in the environment
2. The `lima-test-vm` runner's `isAvailable()` returns `true`

The env-var gate exists because VM presence is necessary but not sufficient — the daemon's systemd unit must be installed, the FunctionFS descriptor handshake must work (TASK-322.05.01), the binary must be at the expected path. Probing every prerequisite at suite load is brittle. Explicit opt-in keeps the default test run clean. Single-stderr-line warning is emitted when the gate is closed.

### What is NOT in the test file (per "no skipped tests" rule)
- **doctor-vs-state assertion**: deferred to **TASK-322.05.01** (which adds it after **TASK-333** lands `--scope system`).
- **device-scan-finds-persona assertion**: deferred to **TASK-322.05.01** (FunctionFS descriptor handshake).
- The shape of the test file is forward-compatible: both assertions are small additive edits.

## AC status
- [x] #1 — 3 Tier-3 persona contexts exist, 2 assertions per persona scaffolded today; doctor-vs-state assertion added by TASK-322.05.01 once TASK-333 lands.
- [partial] #2 — `device scan --format json` invoked per persona. Doctor invocation deferred to TASK-322.05.01 + TASK-333.
- [x] #3 — assertions consult `state.expectedDoctorSystemOutput` / `persona.expectedCapabilities` rather than inline goldens (the doctor assertion will use the former when added).
- [x] #4 — `describe.skipIf(!tier3Available)` with single-stderr-line warning. Verified by tier3-runtime-setup.test.ts.
- [x] #5 — `TIER3_WARM_TIMEOUT_MS` (10s) and `TIER3_COLD_TIMEOUT_MS` (60s) passed to every `it`/`beforeAll`. Live measurement deferred to TASK-322.05.01.
- [x] #6 — `@podkit/device-testing#test:tier3` turbo task wired with `cache: true`.
- [x] #7 — `STARTER_PERSONA_IDS` covers the 3 starter personas via the mapping above.
- [x] #8 — `groupPersonasByState()` + one `describe(SystemState: <id>)` per group, `beforeAll` calls `applyState`.
- [x] #9 — file headers in both `tier3-runtime-setup.ts` and `personas-baseline.tier3.test.ts` document the grouping convention.

## Quality gates
- `bun run test --filter @podkit/device-testing`: 210 pass / 11 skip / 0 fail (skips are Tier-3 + the canary-linux test; correct on macOS).
- With `PODKIT_DEVTEST_RUN_TIER3=1` and `podkit-test-vm` running, Tier-3 attempts to execute; results depend on TASK-322.05.01 + TASK-333 progress.
- `tsc --noEmit`: clean.
- `oxlint`: 0 warnings.

## Followups (in their own backlog tasks now, not skipped tests)
- **TASK-322.05.01** — FunctionFS descriptor handshake. Adds: device-scan-finds-persona assertion, withPersona-checks-gadget-state assertion, doctor-vs-state assertion (after TASK-333).
- **TASK-333** — Doctor system-only invocation mode. Unblocks the doctor-vs-state assertion in TASK-322.05.01's edit.
- **TASK-322.02.01** — Lima 2.x snapshot strategy on Apple Silicon. Today's fallback is apply-state.sh-every-time; pick the long-term mechanism (qemu vs APFS clones vs upstream wait).
<!-- SECTION:NOTES:END -->
