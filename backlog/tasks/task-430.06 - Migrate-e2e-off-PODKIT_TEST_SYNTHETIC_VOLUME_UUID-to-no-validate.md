---
id: TASK-430.06
title: Migrate e2e off PODKIT_TEST_SYNTHETIC_VOLUME_UUID to --no-validate
status: To Do
assignee: []
created_date: '2026-06-21 09:28'
labels:
  - device-add
  - testing
  - e2e
milestone: m-18
dependencies:
  - TASK-430.05
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the test-only synthetic-UUID side door now that `--no-validate` exists (doc-045).

- Delete the unconditional `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` from `test-packages/e2e-shared/src/cli-runner.ts`.
- Delete `synthesizeTestVolumeUuid` and all `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` plumbing from `device/add.ts`.
- Migrate every e2e `device add` that rode the hatch to `--no-validate --volume-uuid <synthetic>` (or path-only) — `test-packages/e2e-tests/src/commands/device.test.ts` and friends. These go from two host enumerations per add to zero device I/O (the speed win).
- Rewrite `e2e-vm-tests/volume-uuid-defensive.e2e.test.ts`: scenario 2 (env-var) -> `--no-validate`; scenario 1 reframed as Verify-tier-only refusal.
- Keep `hfsplus-refusal` / `unsupported-cascade` VM tests, scoped to the tiers that read the device; add `--no-verify` persona cases (SysInfo present -> succeed; absent -> error + doctor hint).

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` and `synthesizeTestVolumeUuid` removed from CLI source and the shared e2e runner
- [ ] #2 All e2e `device add` calls migrated to `--no-validate` (or path-only); suites pass
- [ ] #3 `volume-uuid-defensive` VM test rewritten (scenario 2 -> `--no-validate`, scenario 1 -> Verify-tier-only)
- [ ] #4 New `--no-verify` VM persona cases cover SysInfo-present success and SysInfo-absent doctor-hint error
- [ ] #5 Measurable reduction in per-add device I/O in the migrated host e2e suite
<!-- AC:END -->
