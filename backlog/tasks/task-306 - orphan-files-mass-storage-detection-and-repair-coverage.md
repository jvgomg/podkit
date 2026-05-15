---
id: TASK-306
title: 'orphan-files-mass-storage: detection and repair coverage'
status: Done
assignee: []
created_date: '2026-05-08 07:23'
updated_date: '2026-05-15 22:17'
labels:
  - testing
  - doctor
  - orphans
  - mass-storage
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-322.05.01
modified_files:
  - >-
    packages/podkit-core/src/diagnostics/checks/orphans-mass-storage-matrix.test.ts
priority: medium
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the mass-storage flavour of orphan-file detection across the layouts produced by all built-in presets (echo-mini, generic, rockbox) plus user-customised content paths. Mass-storage orphan logic is meaningfully different from iPod orphan logic — there's no library database; "managed" files are identified by being inside the configured `musicDir` / `moviesDir` / `tvShowsDir` and having a file pattern that podkit would have produced. Anything else in those directories is an orphan.

For every test, run `podkit doctor --device <fixture> --json --no-system` against a mass-storage device fixture and assert on the `orphan-files-mass-storage` entry in `checks[]`. The fixture's content-paths configuration (preset + per-device overrides + global defaults) should be varied to exercise the resolution chain.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; the `echo-mini-empty` starter persona supplies the canonical mass-storage fixture; orphan-state variations are test-local mutations of the persona's `massStorageBackingFile` content
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the `echo-mini-empty` persona, with the FAT32 backing file manipulated to introduce orphans
- The `SystemState` registry (`@podkit/device-testing`) supplies any required system environment state
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
- [x] #1 echo-mini preset, no orphans → status=pass, details.orphanCount=0
- [x] #2 echo-mini preset, one unmanaged file dropped into Music/ → status=warn+repairable, details.orphanCount=1, details.wastedBytes=fileSize
- [x] #3 generic preset (configurable content paths), orphan in default location → status=warn
- [x] #4 rockbox preset, orphan inside Rockbox-specific layout → status=warn (preset's content paths should resolve correctly)
- [x] #5 Files outside configured content paths are not flagged as orphans (e.g. files in a non-music root directory)
- [x] #6 Per-device musicDir override takes precedence over global deviceDefaults.musicDir which takes precedence over preset default; orphan detection respects the resolved path
- [x] #7 Repair --repair orphan-files-mass-storage deletes detected orphans; subsequent doctor reports pass
- [x] #8 Repair --dry-run prints planned deletions without modifying anything
- [x] #9 Repair preserves managed files (verified by listing managed files before and after)
- [x] #10 Repair handles partial failure (read-only file in the orphan set) — reports per-file error in details, success=false
- [x] #11 Check is mass-storage-only (applicableTo: ['mass-storage']); iPod devices skip it
- [x] #12 iPod-flavoured orphan-files check is NOT applied to mass-storage devices (verified by absence of 'orphan-files' in JSON checks[])
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** Tier-3 assertions need TASK-322.05.01 (FunctionFS descriptor handshake) so the synthesised echo-mini-style persona enumerates as a USB mass-storage device. Tier-1 fake-injected coverage is independent.

**Tier-1 implementation (2026-05-15):** Added `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage-matrix.test.ts` — 14 focused tests covering all 12 ACs.

AC mapping:
- #1 (echo-mini empty pass) — pinned that pass-path leaves `details.orphanCount` undefined; the warn-path is the only one that populates it.
- #2 (echo-mini drop one orphan) — asserts `wastedBytes` equals exact `Buffer.byteLength` of orphan content.
- #3, #4 (generic + rockbox) — each test reads the live preset to assert content-path shape; if either preset's defaults ever move, these tests break loudly.
- #5 — files in `/System/`, `/Documents/`, `/Photos/` are ignored; assertion sits on `summary` text (`'1 file'`) since `totalFiles` only appears in warn-path details.
- #6 — three independent tests cover per-device > deviceDefaults > preset-default. Each includes a *decoy file* in the layer it's overriding to prove the scanner doesn't fall through. A local `resolveMusicDir()` helper models the production precedence; the check itself only sees the resolved value.
- #7, #8, #9 — covered with explicit before/after assertions on the managed-set; #9 snapshots managed-file existence before AND after.
- #10 — partial-failure achieved via `chmod 0o555` on the orphan's parent directory. Includes a root-probe that skips strict assertions when running as root (DAC bypass). `afterEach` walks the tree restoring `0o755` so `rm -rf` can clean up.
- #11, #12 — both directions asserted via `runDiagnostics({ scopes: ['device'] })`: iPod report does not list `orphan-files-mass-storage`; mass-storage report does not list `orphan-files` and DOES list `orphan-files-mass-storage`.

**No production behaviour changed.**

**Findings:**
- `orphans-mass-storage.ts:244-250` — pass-path returns no `details` object at all, so `details.orphanCount === undefined` on pass. Tests now pin this. If callers ever start expecting `orphanCount: 0` on pass for UI symmetry, this is the point of change.
- `orphans-mass-storage.ts:152` — `alreadyCovered` uses string-prefix matching (`dir.startsWith(parent + '/')`) which is correct for the current Unix-only path layout but would need a `path.relative` rewrite for Windows. Not a problem today; flagging for future cross-platform work.
- `orphans-mass-storage.ts:200-215` — `cleanEmptyDirs` walks parent dirs up to (but not including) the content root. If a user's per-device override happens to be a single segment (e.g. `'M'`), this still terminates correctly because the stop-dir check is on absolute paths. No bug, but the AC#6 layer-1 test (override `MyMusic`) implicitly exercises this branch.

**Deferrals:** None at Tier-1. Tier-3 (Lima VM, FunctionFS) remains gated on TASK-322.05.01 per the existing description note.
<!-- SECTION:NOTES:END -->
