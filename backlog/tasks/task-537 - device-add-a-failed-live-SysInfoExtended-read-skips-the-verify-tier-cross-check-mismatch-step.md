---
id: TASK-537
title: >-
  device add: a failed live SysInfoExtended read skips the verify-tier
  cross-check mismatch step
status: To Do
assignee: []
created_date: '2026-10-03 19:48'
labels:
  - cli
dependencies: []
references:
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device/verification-policy.ts
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
- [ ] #1 After a failed live read, a cross-check mismatch still refuses with error-mismatch
- [ ] #2 A device identified only by its USB fingerprint still proceeds after a failed live read
- [ ] #3 Unit test in verification-policy or device-add pins both
<!-- AC:END -->
