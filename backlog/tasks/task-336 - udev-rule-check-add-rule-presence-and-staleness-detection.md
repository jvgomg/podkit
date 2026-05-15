---
id: TASK-336
title: 'udev-rule check: add rule-presence and staleness detection'
status: To Do
assignee: []
created_date: '2026-05-15 00:02'
labels:
  - doctor
  - linux
  - udev
milestone: m-19
dependencies:
  - TASK-301
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
- [ ] #1 udevRuleCheck.check() reads /etc/udev/rules.d/91-podkit-ipod-scsi.rules and returns pass/fail/warn/skip per the rules in the description
- [ ] #2 Detection happens through an injectable fs seam so Tier-1 tests don't touch the host filesystem
- [ ] #3 Repair-side behaviour is unchanged: --repair udev-rule still installs the rule, --dry-run still prints without writing
- [ ] #4 TASK-301 ACs #11-#14 are covered by new tests in system-scope-matrix.test.ts; deferral notes on TASK-301 removed
- [ ] #5 macOS platform branch returns skip via check() (not via repairOnly)
- [ ] #6 All existing udev-rule tests still pass (no regression in the repair-side coverage)
<!-- AC:END -->
