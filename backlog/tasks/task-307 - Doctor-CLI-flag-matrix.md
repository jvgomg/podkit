---
id: TASK-307
title: Doctor CLI flag matrix
status: Done
assignee: []
created_date: '2026-05-08 07:23'
updated_date: '2026-05-14 23:55'
labels:
  - testing
  - doctor
  - cli
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-333
  - TASK-322.05.01
modified_files:
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/doctor-flag-matrix.test.ts
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the doctor command's flag surface — both each flag in isolation and the relevant flag combinations. Today's tests cover the flags individually but not the combination matrix; some interactions (e.g. `--repair --dry-run --json`, `--no-system --format csv`) have never been exercised.

Flags in scope:
- `--device <name|path>` (`-d`)
- `--config <path>` (`-c` global)
- `--json` (global)
- `--repair <check-id>`
- `--collection <name>` (`-c`)
- `--dry-run`
- `--format csv`
- `--no-system`

For every test, run `podkit doctor` with the relevant flag combination and assert on exit code, stdout structure, stderr content (for errors), and JSON parsability where applicable.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` and `systemStates` from `@podkit/device-testing`; use `DevicePersona` and `SystemState` registries to supply injectable fakes for flags that require a device or system context
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the runner restores the appropriate `SystemState` snapshot before the test group runs
- **T2 (native subprocess):** flag-matrix tests that require a real subprocess invocation are tagged `*.linux.test.ts` or `*.darwin.test.ts` as appropriate
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
- [x] #1 --repair without -d fails with 'Repair requires an explicit device' on stderr, exit 1
- [x] #2 --repair artwork-rebuild without -c fails with 'requires a source collection' message; lists available collections from config
- [x] #3 --repair with an unknown check ID fails with 'Unknown check ID' and lists valid IDs
- [x] #4 --repair with a check that has no automatic repair fails with 'does not support automatic repair'
- [x] #5 --repair with a check not applicable to the device type (e.g. orphan-files on mass-storage) fails with explanatory message
- [x] #6 --repair --dry-run outputs the planned action with 'Dry run:' prefix and exits 0; no filesystem mutations occur
- [x] #7 --repair --json outputs only the RepairOutput JSON (success, summary, checkId, dryRun, details), no extra text on stdout
- [x] #8 --no-system: doctor JSON output omits all system-scope checks from checks[]; system-scope checks are not executed (no FFmpeg invocation, no libusb load attempt)
- [x] #9 Without --no-system: doctor includes system-scope checks; with --no-system: identical fixture produces strictly fewer checks[] entries
- [x] #10 --format csv on doctor (no --repair) outputs orphan file list as CSV; respects --no-system (still produces CSV even when system checks are skipped)
- [x] #11 --format csv with no orphans produces empty output (or just the header); does not error
- [x] #12 --json suppresses the human text output entirely; stdout is exactly one JSON document; stderr may still contain progress lines
- [x] #13 Without --json, output is human-readable: includes 'podkit doctor —' header, 'Device Readiness' section, 'Database Health' section, 'All checks passed.' or 'N issue(s) found.' summary, optional 'Issues:' detail block
- [x] #14 Repair flag --repair sysinfo-extended runs without -c (no source collection required) since it only needs writable-device
- [x] #15 Repair flag --repair udev-rule (system-scope, no requirements) runs without -d at all (system repair); device argument should not be required
- [x] #16 --scope <system|device|all> flag (delivered by TASK-333) is covered in the matrix: each value × {--json on/off, --no-system on/off}, asserting the right checks[] subset
- [x] #17 --scope system without -d exits 0 with system-scope checks; --scope device without -d errors the same way --repair does today
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** TASK-333 adds a `--scope` flag that this matrix must cover; the matrix expansion lives here, the flag itself lives there. TASK-322.05.01 closes the descriptor handshake so the Tier-3 invocations of `doctor --device` against synthesised personas resolve a live device end-to-end.

**Implementation (2026-05-15):** Landed `packages/podkit-cli/src/commands/doctor-flag-matrix.test.ts` — 33 Tier-1 tests covering all 17 ACs. The harness drives the new exported `runDoctorAction(options, out, deps)` helper extracted from `doctor.ts`'s action callback (pure refactor — no behaviour change). Existing exit-code matrix tests (52 tests) and other doctor tests stay green; full `bun run test:unit --filter podkit` (1256 tests) passes.

**Key decisions:**
- Extracted `runDoctorAction` so AC #1–#5 + #14–#17 can be driven in-process with `BufferSink` + `BufferExitCodeSink`. The `.action()` callback collapses to one line (`runAction(out, () => runDoctorAction(options, out))`).
- AC #6/#7 routed through system-scope repair (`udev-rule`) — those skip `runRepair`'s eager `await import('@podkit/core')` and let us assert `RepairOutput` shape + dry-run no-mutation via the fake check's `.repair.run` invocation count.
- AC #16 cross-product is fully parametric: 12-row matrix table iterated through one `for-of` block — no copy-pasted cases.
- AC #5 uses `mkdtempSync` + a named device entry in `config.devices` so `resolveEffectiveDevice` returns a mass-storage `ResolvedDevice` and trips the `INCOMPATIBLE_DEVICE_TYPE` branch.
- All assertions pin TASK-308's locked-in decision: repair-validation CliErrors → exit 1; diagnostic warn/fail → exit 2 (covered transitively via `runDoctorDiagnostics` tests in the sibling file).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Doctor flag matrix coverage landed in `packages/podkit-cli/src/commands/doctor-flag-matrix.test.ts` (33 Tier-1 tests, all 17 ACs satisfied). Extracted `runDoctorAction` from `doctor.ts`'s Commander action callback to expose the validation flow to in-process tests — pure refactor, no behaviour change, all 85 doctor tests (52 existing + 33 new) green. AC #16's `--scope × --json × --no-system` cross-product is a parametric 12-row matrix. Pinned against TASK-308's exit-code semantics (warn → unhealthy → exit 2 for diagnostics; CliError → exit 1 for repair validation).
<!-- SECTION:FINAL_SUMMARY:END -->
