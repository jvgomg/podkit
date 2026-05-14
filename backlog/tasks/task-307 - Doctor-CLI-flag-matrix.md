---
id: TASK-307
title: Doctor CLI flag matrix
status: To Do
assignee: []
created_date: '2026-05-08 07:23'
updated_date: '2026-05-14 19:23'
labels:
  - testing
  - doctor
  - cli
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-333
  - TASK-322.05.01
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
- [ ] #1 --repair without -d fails with 'Repair requires an explicit device' on stderr, exit 1
- [ ] #2 --repair artwork-rebuild without -c fails with 'requires a source collection' message; lists available collections from config
- [ ] #3 --repair with an unknown check ID fails with 'Unknown check ID' and lists valid IDs
- [ ] #4 --repair with a check that has no automatic repair fails with 'does not support automatic repair'
- [ ] #5 --repair with a check not applicable to the device type (e.g. orphan-files on mass-storage) fails with explanatory message
- [ ] #6 --repair --dry-run outputs the planned action with 'Dry run:' prefix and exits 0; no filesystem mutations occur
- [ ] #7 --repair --json outputs only the RepairOutput JSON (success, summary, checkId, dryRun, details), no extra text on stdout
- [ ] #8 --no-system: doctor JSON output omits all system-scope checks from checks[]; system-scope checks are not executed (no FFmpeg invocation, no libusb load attempt)
- [ ] #9 Without --no-system: doctor includes system-scope checks; with --no-system: identical fixture produces strictly fewer checks[] entries
- [ ] #10 --format csv on doctor (no --repair) outputs orphan file list as CSV; respects --no-system (still produces CSV even when system checks are skipped)
- [ ] #11 --format csv with no orphans produces empty output (or just the header); does not error
- [ ] #12 --json suppresses the human text output entirely; stdout is exactly one JSON document; stderr may still contain progress lines
- [ ] #13 Without --json, output is human-readable: includes 'podkit doctor —' header, 'Device Readiness' section, 'Database Health' section, 'All checks passed.' or 'N issue(s) found.' summary, optional 'Issues:' detail block
- [ ] #14 Repair flag --repair sysinfo-extended runs without -c (no source collection required) since it only needs writable-device
- [ ] #15 Repair flag --repair udev-rule (system-scope, no requirements) runs without -d at all (system repair); device argument should not be required
- [ ] #16 --scope <system|device|all> flag (delivered by TASK-333) is covered in the matrix: each value × {--json on/off, --no-system on/off}, asserting the right checks[] subset
- [ ] #17 --scope system without -d exits 0 with system-scope checks; --scope device without -d errors the same way --repair does today
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** TASK-333 adds a `--scope` flag that this matrix must cover; the matrix expansion lives here, the flag itself lives there. TASK-322.05.01 closes the descriptor handshake so the Tier-3 invocations of `doctor --device` against synthesised personas resolve a live device end-to-end.
<!-- SECTION:NOTES:END -->
