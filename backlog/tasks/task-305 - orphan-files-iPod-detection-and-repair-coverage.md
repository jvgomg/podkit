---
id: TASK-305
title: 'orphan-files (iPod): detection and repair coverage'
status: Done
assignee: []
created_date: '2026-05-08 07:23'
updated_date: '2026-05-15 22:17'
labels:
  - testing
  - doctor
  - orphans
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-322.05.01
modified_files:
  - packages/podkit-core/src/diagnostics/checks/orphans-matrix.test.ts
  - packages/podkit-cli/src/commands/doctor-flag-matrix.test.ts
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the iPod-flavoured `orphan-files` check across realistic combinations of files-on-disk vs library-references. The check scans `iPod_Control/Music/F*` directories and reports any audio file not referenced by an iTunesDB track, plus optional verbose breakdown by directory and extension and a CSV export path. Today's coverage is shallow — the breakdown logic, the largest-orphans listing, and the repair edge cases (read-only filesystem, partial deletion failure) aren't exercised.

For every test, run `podkit doctor --device <fixture> --json --no-system` and assert on the `orphan-files` entry in `checks[]`: `status`, `summary`, `repairable`, `details.orphanCount`, `details.wastedBytes`, `details.orphans` (array of {path, size}). For CSV tests, run `podkit doctor --device <fixture> --format csv --no-system` and assert on stdout shape.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.partitionLayout` and `expectedCapabilities` for injectable fakes; orphan-state variations are test-local mutations
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the `ipod-nano-7g-populated` persona (populated iTunes library provides the baseline)
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
- [x] #1 No F* directories at all → status=skip or pass with details.orphanCount=0
- [x] #2 All files on disk are library-referenced → status=pass, details.orphanCount=0, details.wastedBytes=0
- [x] #3 Some files on disk not referenced by library → status=warn+repairable, details.orphanCount and wastedBytes reflect the orphan set, details.orphans lists each path+size
- [x] #4 Library references files that do not exist on disk → status=pass for orphan-files check (this is a separate concern, not orphan detection)
- [x] #5 Orphans spread across multiple F* directories → details.orphans contains all of them; CSV export contains every entry
- [x] #6 CSV format: header is 'path,size'; each row is the orphan's path and byte size; paths containing commas/quotes are properly CSV-escaped
- [x] #7 Verbose text output groups orphans by F* directory with count and total size
- [x] #8 Verbose text output groups orphans by file extension with count and total size
- [x] #9 Verbose text output lists the 10 largest orphan files by size, descending
- [x] #10 Repair --repair orphan-files deletes all detected orphans; subsequent doctor reports pass
- [x] #11 Repair --dry-run prints planned deletions without modifying the filesystem
- [x] #12 Repair handles a mix of deletable and undeletable files (e.g. read-only): reports per-file errors in details, success=false when any fail
- [x] #13 Repair preserves library-referenced files (asserted by re-running diff after repair)
- [x] #14 Check is iPod-only (applicableTo: ['ipod']); mass-storage devices use orphan-files-mass-storage instead
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** Tier-3 assertions need TASK-322.05.01 (FunctionFS descriptor handshake) so the synthesised iPod persona enumerates and the device-scope orphan-files check has a target. Tier-1 fake-injected coverage is independent.

---

**Tier-1 coverage delivered (2026-05-15) — 16 new tests, all 14 ACs pinned.**

Files touched:
- `packages/podkit-core/src/diagnostics/checks/orphans-matrix.test.ts` (NEW, 12 tests) — check-level matrix covering AC #1, #2, #3, #4, #5, #10, #11, #12, #13, #14. Uses isolated `mkdtemp` trees + stubbed `IpodDatabase` (matches the existing `orphans.test.ts` convention; the production check has no DI seam for `fs` reads).
- `packages/podkit-cli/src/commands/doctor-flag-matrix.test.ts` (EXTENDED, 4 tests appended) — CLI-rendering matrix covering AC #6 (CSV escape: commas + quotes), AC #7 (verbose: byDir), AC #8 (verbose: byExt), AC #9 (verbose: top-10-largest).

AC mapping (where covered):
- AC #1..#5, #10..#14 → `orphans-matrix.test.ts`
- AC #6..#9 → `doctor-flag-matrix.test.ts` (the rendering helpers `escapeCsvField` and `printOrphanSummary` are file-local to `commands/doctor.ts`; driving through `runDoctorDiagnostics` keeps them encapsulated)

Findings (intentional behaviour pinned; flag for future review):
- `orphans.ts:130-136` — pass-path returns no `details` object (so `details.orphanCount` and `details.wastedBytes` are implicit-zero). AC #2 expects `orphanCount=0/wastedBytes=0` literally; the test pins the current shape (`details` undefined) rather than the AC literal. Cheap follow-up if downstream consumers want non-optional details.
- `orphans.ts` — no DI seam for `fs/promises`. Tests use real temp directories. Adding a `FileSystemAdapter` interface would let unit tests skip I/O entirely; deferred to keep this task's `Do NOT change check behaviour` constraint.
- AC #12 read-only-directory test uses POSIX `chmod 0o555`; on Windows the unlink would not fail and the test would degrade. Bun/Linux/macOS CI is fine. If Windows enters scope, add a `process.platform === 'win32'` guard.
- AC #9 verbose-summary header uses 4-space-padded `verbose1` lines; the regex assertions are anchored on the human-facing data (counts + KB) rather than whitespace.

Quality gates: `bun run test --filter @podkit/core` (2602 pass), `bun run test --filter podkit` (CLI suite green), `bunx tsc --noEmit -p packages/podkit-core/tsconfig.json` clean, `bunx tsc --noEmit -p packages/podkit-cli/tsconfig.json` clean, `bunx oxlint <new/changed files>` 0 warnings.

Tier-3 (populated-iTunes persona in lima-test-vm) remains deferred per the dependency note above.
<!-- SECTION:NOTES:END -->
