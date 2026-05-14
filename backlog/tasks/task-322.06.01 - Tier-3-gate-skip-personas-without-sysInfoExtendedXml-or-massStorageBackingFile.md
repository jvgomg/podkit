---
id: TASK-322.06.01
title: >-
  Tier-3 gate: skip personas without sysInfoExtendedXml or
  massStorageBackingFile
status: Done
assignee: []
created_date: '2026-05-14 22:37'
updated_date: '2026-05-14 22:44'
labels:
  - testing
  - vm-coverage
  - tier-3
milestone: m-19
dependencies:
  - TASK-322.06
parent_task_id: TASK-322.06
priority: medium
ordinal: 462
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Safety gate so a persona missing both `sysInfoExtendedXml` and `massStorageBackingFile` does not blow up the Tier-3 suite. Today `withPersona({ persona: echo-mini })` calls `startDaemonForPersona`, which loads the personas sidecar, finds `echo-mini` without either payload, and exits with `error: persona "echo-mini" not in sidecar` — every persona test in that group fails.

The real fix is TASK-324 (Phase 5 persona registry expansion) capturing/synthesising echo-mini's mass-storage backing file. This task is the **interim safety belt** so the harness doesn't tripwire developers between now and that capture.

**Fix:**

In `tier3-runtime-setup.ts`'s `groupPersonasByState` (or a sibling filter `filterPersonasWithDaemonPayload`), drop personas where `persona.sysInfoExtendedXml === null && persona.massStorageBackingFile === null`. Emit one stderr line per skipped persona naming the missing fields, so the developer sees what fell out and can correlate to TASK-324.

Equivalent option: gate inside `withPersona` itself — return an early "skipped" sentinel instead of starting the daemon. Filtering at grouping time is preferred because the persona never appears in the test report at all, avoiding the misleading "passed by virtue of doing nothing" outcome.

Cross-link to TASK-324 in the warning text so the resolution path is obvious.

**Anchors:**
- `packages/device-testing/src/tier3/tier3-runtime-setup.ts:134` — `groupPersonasByState`
- `packages/device-testing/src/tier3/persona-fixture.ts:54` — `withPersona`
- `packages/device-testing/src/personas/sidecar-build.ts` — already skips personas without a daemon payload when building the sidecar; the filter mirrors that logic
- `packages/device-testing/src/personas/echo-mini/index.ts` — the persona that surfaces this

**Tests:** unit-test the filter with a synthetic persona where both fields are null; assert it's excluded from `groupPersonasByState` output and a single warning is emitted.

**Out of scope:** Capturing real echo-mini data — that's TASK-324.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Personas with sysInfoExtendedXml === null AND massStorageBackingFile === null are excluded from groupPersonasByState() output
- [x] #2 One stderr warning per excluded persona on first call, naming the persona id + the missing fields + linking to TASK-324
- [x] #3 Subsequent calls in the same process are silent (single warning per persona per session)
- [x] #4 Unit test for the filter: a fake persona with both fields null is excluded; a real persona with either field is included
- [x] #5 Once TASK-324 captures echo-mini, the filter becomes a no-op for the starter persona set; this task remains in place as a tripwire for future bare personas
- [x] #6 Warning text references TASK-324 explicitly so the resolution path is discoverable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Implemented:** filter at grouping time, additive signature on `groupPersonasByState`.

**Files touched:**
- `packages/device-testing/src/tier3/tier3-runtime-setup.ts` — added `hasDaemonPayload(persona)`, module-level `tier3PersonaSkipWarningsEmitted: Set<string>`, `resetTier3PersonaSkipWarnings()`, `formatPersonaSkipWarning(persona)`. `groupPersonasByState` gained an optional `warn` DI seam (defaults to `console.warn` → stderr) and filters out personas where `hasDaemonPayload(p) === false` before grouping, emitting one warning per persona id per session.
- `packages/device-testing/src/tier3/persona-fixture.ts` — module header note that filtered personas never reach `withPersona()`.
- `packages/device-testing/src/tier3/tier3-runtime-setup.test.ts` — 17 new assertions covering `hasDaemonPayload`, synthetic personas (both null / xml only / backing only / both), warning text content, once-per-session per-persona dedupe, reset helper, dedupe-key-is-persona-id (alpha+beta+alpha re-emit), `echo-mini` canary (asserts it is dropped today; flips to inclusion when TASK-324 lands).

**Key decisions:**
- Filter lives **inside** `groupPersonasByState`, not as a separate `filterPersonasWithDaemonPayload`. Single seam — every call site that produces groups gets the filter for free; `withPersona()` is never invoked for a filtered persona.
- Dedupe key is the **persona id**, not a process-global boolean. New bare personas later in the same `bun test` run still emit their warning. Implemented with `Set<string>` (not `Map<string, true>`).
- `warn` is an optional second parameter on `groupPersonasByState` (additive — existing call sites unchanged). Default routes to `console.warn`, which Bun writes to stderr.
- `personas-baseline.tier3.test.ts` call site needs no change (default warn). `tier3-runtime-setup.test.ts` passes captured arrays where assertions require it.
- `formatPersonaSkipWarning` is exported so the canary test asserts the exact wording (AC #6).
- `resetTier3PersonaSkipWarnings()` is separate from the existing `resetTier3SkipWarning()` (which is for the availability gate). Different concern, separate state.

**Quality gates:**
- `bun run test --filter @podkit/device-testing` — 21 of 21 new assertions pass. 4 pre-existing `runtime.prepare` failures in `lima-test-vm.test.ts` are from TASK-322.04.01 (systemd unit auto-install, also in_progress in parallel) — not introduced by this task.
- `bunx tsc --noEmit -p packages/device-testing/tsconfig.json` — clean.
- `bunx oxlint packages/device-testing/src/tier3/` — 0 warnings, 0 errors.

**TASK-324 hand-off:** when echo-mini gets a real `massStorageBackingFile`, the "drops `echo-mini` from the starter set today" canary test flips: change `.not.toContain('echo-mini')` to `.toContain('echo-mini')` and drop the warning assertion. The filter itself stays in place as a tripwire for future bare personas (AC #5).
<!-- SECTION:NOTES:END -->
