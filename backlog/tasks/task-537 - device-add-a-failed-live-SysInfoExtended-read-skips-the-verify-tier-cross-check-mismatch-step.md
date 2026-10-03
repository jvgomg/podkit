---
id: TASK-537
title: >-
  device add: a failed live SysInfoExtended read skips the verify-tier
  cross-check mismatch step
status: Done
assignee: []
created_date: '2026-10-03 19:48'
updated_date: '2026-10-03 20:46'
labels:
  - cli
dependencies: []
references:
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device/verification-policy.ts
modified_files:
  - packages/podkit-cli/src/commands/device/verification-policy.ts
  - packages/podkit-cli/src/commands/device/verification-policy.test.ts
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device-add.unit.test.ts
  - .changeset/device-add-mismatch-after-failed-read.md
priority: medium
type: bug
ordinal: 307000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This was already the behaviour before the DRAFT-023 fix; it is not a regression from it.

In the verify tier, `decideAddOutcome` puts step 6 (identity store missing → `prompt-write-sie`) ahead of step 7 (cross-check `mismatch` → `error-mismatch`). When the live SysInfoExtended read then fails:
- the store is still `missing` on the re-assess;
- the second pass returns `prompt-write-sie` again;
- the outcome loop's `sieReEntered` guard breaks out.

Steps 7 (mismatch) and 8 (unsupported) are never evaluated. An on-disk SysInfo that disagrees with the live USB identity is then added without the `error-mismatch` refusal it would get when SysInfoExtended is already present.

Marking the store `unwritable` after a failed read is not a drop-in fix. Step 4's empty-identity predicate treats `unwritable` as "no signal", so a device whose only identity is its USB fingerprint would turn from proceed into refuse. The fix needs a way to re-decide that skips step 6 without changing step 4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After a failed live read, a cross-check mismatch still refuses with error-mismatch
- [x] #2 A device identified only by its USB fingerprint still proceeds after a failed live read
- [x] #3 Unit test in verification-policy or device-add pins both
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`DeviceStateView` gains `identityStoreWriteAttempted`. `decideAddOutcome` skips step 6 (`prompt-write-sie`) when it is set, so steps 7–9 run: mismatch, unsupported, partial identity. Step 4 is untouched; the store stays `missing`, which still counts as a USB signal.

The `device add` outcome loop sets the flag on every re-entry after the offer and re-decides. After a successful write the re-assess shows `present`, so the flag has no effect. Otherwise the remaining checks run instead of falling into the old `sieReEntered` break, which is now removed. The review found that break was reachable, when a write reported success but the store stayed missing, and that it silently dropped the partial-identity warning.

Tests:
- Four policy-matrix rows: mismatch → `error-mismatch`; pass → proceed; USB-only → partial-identity, not an empty-identity refusal; unsupported → `prompt-unsupported`.
- Three `runAdd` tests on a real temp mount:
  - A classic SysInfo `MA147` against a nano 2G USB identity is refused with `IDENTITY_MISMATCH` after a failed read. This was red before the fix.
  - USB-only identity proceeds, with the read failure and the model-unknown warning both in `warnings`.
  - A reported-success write that leaves no store still runs the later checks and warns.

Validation: podkit unit tests 2011/2011, lint clean, `test:vm` on deviceRemote 39 + 194 green. Changeset: `podkit` patch.
<!-- SECTION:FINAL_SUMMARY:END -->
