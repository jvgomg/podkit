---
id: TASK-308
title: Doctor exit code and overall-health semantics
status: Done
assignee: []
created_date: '2026-05-08 07:24'
updated_date: '2026-05-16 00:28'
labels:
  - testing
  - doctor
  - exit-codes
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-333
  - TASK-322.05.01
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pin down what flips doctor's exit code and the `healthy` boolean. Today's behaviour: `healthy = readinessHealthy && (every device-and-system check is pass|skip)`. That means a single `warn` from any check is enough to flip exit code to 1, which has bitten us multiple times (inquiry-methods warn on macOS without libusb, video-encoder warn on macOS with only h264_videotoolbox).

This ticket is partly test coverage and partly a forcing function for a design decision: should `warn` count as healthy or not? Either is defensible, but the answer must be consistent and documented. Once decided, lock in the behaviour with tests.

For every test, run `podkit doctor --device <fixture> --json` (with and without `--no-system` as the matrix demands) and assert on `exit code`, `healthy`, and the count of issues reported in the human output.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` and `systemStates` from `@podkit/device-testing`; inject fakes via `DevicePersona` and `SystemState` registries to produce each (healthy/warn/fail) × (system/device) combination
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the runner restores the appropriate `SystemState` snapshot (e.g. `base-no-ffmpeg`) before the test group runs
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture

### m-19 harness integration (Phase 1 foundations)

Use the test harness landed in TASK-321 (Phase 1):

- **Fixtures** live in `@podkit/device-testing` — `DevicePersona` for device-facing state, `SystemState` for host-environment state. See `agents/device-testing.md` and `packages/device-testing/README.md`.
- **Tier 1** unit tests inject `SubprocessRunner` (from `@podkit/device-types`) and `TestRuntime` fakes wired up against persona/state fixtures. Default runner is `defaultSubprocessRunner` from `@podkit/core`; tests substitute `ReplaySubprocessRunner` from `@podkit/device-testing`.
- **Tier 3** integration tests run inside the `lima-test-vm` runner (lands in TASK-322.04) against synthesised USB gadgets.
- **Native subprocess tests** follow the `*.darwin.test.ts` / `*.linux.test.ts` tagging convention — see `agents/testing.md` §"Per-OS Test Tagging".
- Capture fresh subprocess fixtures with `PODKIT_SNAPSHOT_CAPTURE=1 PODKIT_SNAPSHOT_DIR=<dir>`; replay with `PODKIT_SNAPSHOT_REPLAY=1 PODKIT_SNAPSHOT_DIR=<dir>`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DECISION: document whether warn counts toward healthy (current: warn breaks healthy). Decision recorded in agents/testing.md §"Doctor exit-code & overall-health semantics"
- [x] #2 Readiness ready + all device checks pass + all system checks pass → healthy=true, exit 0
- [x] #3 Readiness ready + one device check fails (e.g. corrupt artwork) + system pass → healthy=false, exit 2, issue count includes that fail
- [x] #4 Readiness ready + one device check warns (e.g. orphan-files) + system pass → behaviour matches the documented decision (warn counts as unhealthy: healthy=false, exit 2)
- [x] #5 Readiness ready + system check warns (e.g. inquiry-methods libusb missing) + device pass → healthy=false, exit 2; with --no-system the same fixture produces healthy=true, exit 0
- [x] #6 Readiness fails (e.g. mount fail) → healthy=false, exit 2, regardless of any check results (DB checks were skipped)
- [x] #7 Readiness ready + every check skips → healthy=true, exit 0 (skip is not a failure)
- [x] #8 When report is unavailable (database open failed during diagnostics) and readiness was ready: behaviour is well-defined (currently dbHealthy=false unless dbAvailable was unset)
- [x] #9 Issue count in human output equals the number of fail entries (warn flips exit code but is not counted in the 'N issues found' summary line today; consistency pinned in tests, latent UX inconsistency flagged for a separate task)
- [x] #10 Mass-storage device with no orphans + --no-system → healthy=true, exit 0
- [x] #11 Mass-storage device with orphans → healthy=false, exit 2 (warn counts per the documented decision)
- [x] #12 Repair commands: success=true → exit 0; success=false → CliError exits 1; --dry-run with success=true → exit 0
- [x] #13 JSON output's healthy boolean exactly mirrors the exit code (healthy=true iff exit 0) for diagnostics mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision recorded in `agents/testing.md` §"Doctor exit-code & overall-health semantics" (warn counts as unhealthy; healthy=true iff exit 0; exit 0 clean / 1 CliError / 2 issues found). The decision applies to legacy `--scope all`, `--scope system` (TASK-333), and `--scope device`.

Matrix tests landed in `packages/podkit-cli/src/commands/doctor-exit-code.test.ts` (27 tests, all green). Tests drive `runDoctorDiagnostics` (newly exported from `doctor.ts` for Tier-1 access) and `runSystemOnlyDoctor` with a stubbed `@podkit/core` (no subprocess, no libgpod, no real device). Cross-flag invariant `(exitCode === 0) === (json.healthy === true)` is asserted parametrically across 9 of the matrix's 11 distinct fixtures (AC #13).

AC mapping:
- AC #1 → recorded in agents/testing.md
- AC #2 → `describe('AC #2: readiness ready + every check pass')` (iPod + mass-storage)
- AC #3 → `describe('AC #3: readiness ready + one device check fails')`
- AC #4 → `describe('AC #4: readiness ready + one device check warns')`
- AC #5 → `describe('AC #5: system-check warn with and without --no-system')` (both branches)
- AC #6 → `describe('AC #6: readiness fails (e.g. mount fail)')`
- AC #7 → `describe('AC #7: readiness ready + every check skips')`
- AC #8 → `describe('AC #8: report unavailable (database open or diagnostics threw)')` — pins current "dbHealthy falls back to true" behaviour
- AC #9 → `describe('AC #9: human-mode issue count')`
- AC #10 → `describe('AC #10: mass-storage with no orphans + --no-system')`
- AC #11 → `describe('AC #11: mass-storage with orphans (warn)')`
- AC #12 → `describe('AC #12: repair commands')` (success / CliError(REPAIR_FAILED) / dry-run)
- AC #13 → `describe('AC #13: healthy boolean mirrors exit code across the full matrix')` (parametric)
- TASK-333 cross-cut → `describe('--scope system: warn / fail / pass exit codes')`

**Discrepancies surfaced but NOT fixed (per task constraint):**
- The AC text says "exit 1" for unhealthy-but-diagnostic-ran. The implementation uses **exit 2** (see `out.setExitCode(2)` in `runDoctorDiagnostics`, `runSystemOnlyDoctor`, mass-storage path). The tests assert exit code 2 (current behaviour) and the agents/testing.md exit-code table documents the 0/1/2 split. Surfaced for visibility; not refactored here.
- `SystemState` fixtures in `@podkit/device-testing` carry `expectedExitCode: 1` for non-healthy states, which doesn't match the actual exit 2 the doctor emits. TASK-324 owns the fixture sweep; flagged for that ticket.
- The persona registry can't yet be imported here — the bundled `@podkit/device-testing/dist/index.js` eagerly evaluates every persona's `readFileSync` on raw XML/plist files that the bundler does not copy. TASK-324 will fix that; the test file is structured for a clean migration when it does.

**No doctor-logic bugs found.** The exit-code derivation matches the documented decision across every matrix cell tested.

**Tier-3 deferral:** AC coverage of `--scope system` against a live VM (TASK-322.06 baseline) is deferred to the next Tier-3 sweep. Tier-1 coverage of the rule itself is complete (see the `--scope system` describe block).

Files touched:
- `agents/testing.md` (added §"Doctor exit-code & overall-health semantics")
- `packages/podkit-cli/src/commands/doctor.ts` (exported `runDoctorDiagnostics`)
- `packages/podkit-cli/src/commands/doctor-exit-code.test.ts` (new — 27 tests)

Quality gates:
- `bun test packages/podkit-cli/src/commands/doctor-exit-code.test.ts` → 27 pass, 0 fail
- Full `cd packages/podkit-cli && bun test` → 1220 pass, 0 fail
- `cd packages/podkit-core && bun test` → 2467 pass, 1 skip, 0 fail
- `bunx tsc --noEmit` in podkit-cli → 0 errors in new/modified files (unrelated TASK-331 pre-existing errors in doctor.ts ~line 661 + scan files)
- `bunx oxlint packages/podkit-cli/src/commands/doctor-exit-code.test.ts packages/podkit-cli/src/commands/doctor.ts` → 0 warnings, 0 errors

**2026-05-16 — AC #9 latent UX inconsistency resolved:**
The "fail-only count" gap noted in AC #9 is now fixed. `doctor.ts` summary-line rendering (iPod path, ~line 820) updated to count both `fail` AND `warn` checks — matching the existing mass-storage and system-only paths which already counted both. Before: `issueCount` only accumulated `c.status === 'fail'`, so a warn-only failure produced exit 2 but printed "All checks passed." After: `issueCount` accumulates `c.status === 'fail' || c.status === 'warn'`, so the same fixture prints "1 issue found." (or "N issues found."). AC #9 test assertion updated from a "contains both check names" check to also assert `'2 issues found.'` for the 1-fail + 1-warn fixture. 30 tests, all green. Files touched: `packages/podkit-cli/src/commands/doctor.ts`, `packages/podkit-cli/src/commands/doctor-exit-code.test.ts`.

**Persona registry packaging gap — resolved (m-19 polish, follow-up to this task).** The line in the implementation notes above ("the bundled `@podkit/device-testing/dist/index.js` eagerly evaluates every persona's `readFileSync` on raw XML/plist files that the bundler does not copy") no longer applies. The fix: each persona's raw fixtures are now inlined as base64-encoded string literals in a sibling `raw.generated.ts` module produced by `packages/device-testing/scripts/generate-raw-fixtures.ts` (wired as the package's `prebuild` step), and persona modules wrap raw-fixture fields in cached getters (`src/personas/lazy.ts`). A subprocess smoke test in `src/personas/no-fs-at-load.test.ts` pins zero `fs.readFileSync` calls at module-eval. External consumers can now import `personas` from `@podkit/device-testing` without filesystem fragility. Pattern documented in `agents/device-testing.md` §"Lazy raw-fixture pattern".

**2026-05-16 — Persona registry packaging: codegen replaced with Bun import attributes.** The base64 codegen path documented in the previous note has been removed. Raw fixtures are now imported directly via `with { type: 'text' }` (XML/plist) and `with { type: 'json' }` (JSON) — Bun's bundler inlines the file contents as string/object literals at build time, and at dev time Bun's loader resolves them without `fs.readFileSync`. Files deleted: `packages/device-testing/scripts/generate-raw-fixtures.ts`, `packages/device-testing/src/personas/lazy.ts`, all 16 `src/personas/*/raw.generated.ts` files, plus the `generate:raw-fixtures` + `prebuild` scripts in `package.json`. Ambient declarations for `*.xml` / `*.plist` / `*.txt` live in `packages/device-testing/src/personas/text-imports.d.ts` (JSON is covered by `resolveJsonModule`). The `no-fs-at-load.test.ts` smoke test contract is unchanged and still passes (zero `fs.readFileSync` calls during persona registry import). Pattern documented in `agents/device-testing.md` §"Raw-fixture imports".
<!-- SECTION:NOTES:END -->
