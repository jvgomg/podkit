---
id: TASK-336
title: 'udev-rule check: add rule-presence and staleness detection'
status: Done
assignee: []
created_date: '2026-05-15 00:02'
updated_date: '2026-05-15 23:32'
labels:
  - doctor
  - linux
  - udev
milestone: m-19
dependencies:
  - TASK-301
modified_files:
  - packages/podkit-core/src/diagnostics/checks/udev-rule.ts
  - packages/podkit-core/src/diagnostics/checks/udev-rule.test.ts
  - packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts
priority: low
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closes ACs #11-#14 of TASK-301 that were deferred because `udevRuleCheck` has no detection logic today — it's `repairOnly: true` and `check()` returns `skip` unconditionally (see `packages/podkit-core/src/diagnostics/checks/udev-rule.ts:233`).

The check today only knows how to *install* the rule (via `--repair udev-rule`). It does not probe filesystem state to tell the user whether the rule already exists, whether its contents are current, or whether a stale rule from a previous podkit version is in place. The doctor's signal-discipline rule (warn/fail → unhealthy → exit 2; per TASK-308) means users can't discover the missing rule until they hit a real failure mode.

## What to build

1. **Drop `repairOnly: true`** in `udev-rule.ts` (the entire check should expose both `check()` AND `repair`).

2. **Implement `check()` detection logic:**
   - On macOS: return `{ status: 'skip', summary: 'not applicable to platform' }` (current behaviour, but emitted from `check()` rather than implied by `repairOnly`).
   - On Linux: read `/etc/udev/rules.d/91-podkit-ipod-scsi.rules` (path constant already in the source).
     - File absent → `{ status: 'fail', repairable: true, summary: 'iPod udev rule not installed', details: { path } }`
     - File present + content matches `UDEV_RULE_CONTENT` exactly → `{ status: 'pass', summary: 'iPod udev rule installed', details: { path } }`
     - File present + content differs → `{ status: 'warn', repairable: true, summary: 'iPod udev rule is stale (different vendor/product set)', details: { path, diff: '<brief description>' } }`
     - File present + read error (permissions, etc.) → `{ status: 'fail', repairable: false, summary: 'cannot read iPod udev rule', details: { path, errno } }`

3. **DI seam**: read through an injectable `fs.readFile` so Tier-1 tests don't touch the host filesystem. Mirror the `SubprocessRunner` pattern.

4. **Tests (close TASK-301 ACs #11-#14):**
   - AC #11: file present + content matches → pass
   - AC #12: file absent → fail + repairable
   - AC #13: file present + content stale → warn + repairable
   - AC #14: round-trip — repair installs the rule (or dry-run prints it without writing) + a second `check()` returns pass.
   - Add the four tests to `packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts` (the existing deferred `it()` at the documented location already stakes the spot).

5. **Update TASK-301**: tick off ACs #11-#14, remove the deferral notes.

## Anchors

- `packages/podkit-core/src/diagnostics/checks/udev-rule.ts` — current source
- `packages/podkit-core/src/diagnostics/checks/udev-rule.test.ts` — existing repair-side tests; extend with check-side tests OR migrate to the matrix file
- `packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts:450` (approx) — deferred test stake
- `packages/device-testing/src/system-states/no-udev.ts` — SystemState fixture that this check now needs to consume

## Out of scope

- Changing the actual rule content (path/permissions/vendor set) — that's a separate concern owned by the udev-rule maintenance flow.
- Refactoring `repairOnly` as a concept across the diagnostics framework — only this one check uses it today; if more land later we can revisit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 udevRuleCheck.check() reads /etc/udev/rules.d/91-podkit-ipod-scsi.rules and returns pass/fail/warn/skip per the rules in the description
- [x] #2 Detection happens through an injectable fs seam so Tier-1 tests don't touch the host filesystem
- [x] #3 Repair-side behaviour is unchanged: --repair udev-rule still installs the rule, --dry-run still prints without writing
- [x] #4 TASK-301 ACs #11-#14 are covered by new tests in system-scope-matrix.test.ts; deferral notes on TASK-301 removed
- [x] #5 macOS platform branch returns skip via check() (not via repairOnly)
- [x] #6 All existing udev-rule tests still pass (no regression in the repair-side coverage)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed 2026-05-16

**Files touched**
- `packages/podkit-core/src/diagnostics/checks/udev-rule.ts` — dropped `repairOnly: true`, added `checkUdevRule()` pure detection function with injectable `readFile` seam (`ReadFileFn`), exported `defaultReadFile` for production use. The `udevRuleCheck.check()` binding now delegates to `checkUdevRule()` with default options. Repair-side path (`runUdevRuleInstall`, `udevRuleRepair`) is untouched.
- `packages/podkit-core/src/diagnostics/checks/udev-rule.test.ts` — flipped the `repairOnly` metadata assertion (now expects `undefined`), removed the “check() returns skip” catch-all, added 8 detection tests covering all four states (pass / fail-absent / warn-stale / fail-unreadable) plus skip-on-darwin, skip-on-win32, custom path, and a near-miss byte-level stale check. Added a production-binding sanity test (skips on Linux to keep Tier-1 hermetic).
- `packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts` — replaced the three `DEFERRED` placeholder tests with seven proper assertions: AC#11 pass, AC#12 fail+repairable, AC#13 warn+repairable (stale) + EACCES variant, AC#14 round-trip (in-memory FS — repair installs, check re-runs, asserts pass), AC#14 dry-run (verifies no writes + check still fails), AC#15 skip-on-macOS. The new matrix-level "doctor JSON contract" test verifies the check is registered, has a repair, declares `scope: 'system'`, and is no longer `repairOnly`.

**DI seam shape**

Mirrors `checkInquiryMethods(probe, platform)` in `inquiry-methods.ts`:
```
checkUdevRule(opts?: { platform?, path?, readFile? }): Promise<CheckResult>
```
Defaults to `process.platform` + `TARGET_PATH` + `defaultReadFile` (a `promisify`d `fs.readFile`). Tests pass an in-memory `Map<string, string>` reader.

**Stale-diff text shape**

`details.diff` is intentionally terse: `"installed N bytes / M lines, expected N' bytes / M' lines"`. Not a full diff — just enough signal for `--json` consumers to spot the drift without bloating the doctor output. Future work could promote this to a structured diff if the JSON contract needs it.

**Repair-side invariance verified**

The repair tests (`describe('runUdevRuleInstall ...')`) were not touched. All 15 pre-existing repair-side assertions still pass. The round-trip test in `system-scope-matrix.test.ts` re-exercises `runUdevRuleInstall` against in-memory FsOps/executor fakes and confirms the produced filesystem state drives `check()` to pass.

**Test count**

- `udev-rule.test.ts`: 31 pass / 65 expects (was 23 pass / 38 expects — net +8 tests).
- `system-scope-matrix.test.ts`: 28 pass / 96 expects (was 23 pass / 65 expects — net +5 tests, with the three deferred placeholders replaced by seven assertions).

**Quality gates**
- `bun test packages/podkit-core/src/diagnostics/checks/udev-rule.test.ts` — 31 pass / 0 fail
- `bun test packages/podkit-core/src/diagnostics/checks/system-scope-matrix.test.ts` — 28 pass / 0 fail
- `bun run test:unit --filter @podkit/core` — 2639 pass / 1 fail / 1 skip. The 1 fail (`parseLsblkJson > parses a single partition with all fields`) is pre-existing and unrelated to this work: it tracks an active WIP edit to `packages/podkit-core/src/device/platforms/{linux,macos}.ts` that lives in the user's working tree on a separate change.
- `bunx tsc --noEmit -p packages/podkit-core/tsconfig.json` — one pre-existing error in `macos.ts` (same WIP). Files touched by TASK-336 type-check cleanly.
- `bunx oxlint` on `udev-rule.ts`, `udev-rule.test.ts`, `system-scope-matrix.test.ts` — 0 warnings, 0 errors.

**AC closure**
- AC#1 — `udevRuleCheck.check()` reads the rule path and returns pass/fail/warn/skip per spec. Done.
- AC#2 — Injectable `readFile: ReadFileFn` seam threaded through `checkUdevRule()`; tests use in-memory map readers. Done.
- AC#3 — Repair-side path verified unchanged: `udevRuleRepair`, `runUdevRuleInstall`, `--dry-run`, and all 15 pre-existing repair tests still pass. Done.
- AC#4 — TASK-301 ACs #11–#14 ticked; the in-test `DEFERRED` comment block + placeholder test removed; cross-reference back to TASK-336 appended to TASK-301 notes. Done.
- AC#5 — macOS skip path returned from `checkUdevRule({ platform: 'darwin' })` (and `'win32'`) before any fs access. Verified by an assertion that the injected reader is never called on non-Linux. Done.
- AC#6 — Repair-side tests (`runUdevRuleInstall on non-Linux` / `dry-run` / `success` / `failure paths` describes) remain unchanged and green. Done.
<!-- SECTION:NOTES:END -->
