---
id: TASK-430.06
title: Migrate e2e off PODKIT_TEST_SYNTHETIC_VOLUME_UUID to --no-validate
status: Done
assignee: []
created_date: '2026-06-21 09:28'
updated_date: '2026-06-21 12:20'
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
- [x] #1 `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` and `synthesizeTestVolumeUuid` removed from CLI source and the shared e2e runner
- [x] #2 All e2e `device add` calls migrated to `--no-validate` (or path-only); suites pass
- [x] #3 `volume-uuid-defensive` VM test rewritten (scenario 2 -> `--no-validate`, scenario 1 -> Verify-tier-only)
- [x] #4 New `--no-verify` VM persona cases cover SysInfo-present success and SysInfo-absent doctor-hint error
- [x] #5 Measurable reduction in per-add device I/O in the migrated host e2e suite
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope additions from the 430.05 review (B1/B2): (B1) e2e tests still pass the renamed-away `--no-firmware-inquiry` flag at e2e-tests/src/commands/device.test.ts:246 and e2e-vm-tests/src/volume-uuid-defensive.e2e.test.ts:100,140 -> replace with `--no-verify`. (B2) device.test.ts:197 asserts the old refusal copy mentions `--no-firmware-inquiry` (it now suggests only `--force`), and the test at ~231-254 asserts the OLD behaviour that `--no-firmware-inquiry` bypassed the empty-identity gate (intentionally removed) -> delete or migrate to assert `--no-verify` + empty identity now refuses, only `--force` bypasses.

Implemented by opus worker + team-lead verification. `synthesizeTestVolumeUuid` + all `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` plumbing removed from add.ts; the unconditional env var removed from e2e-shared/cli-runner.ts. Host e2e device adds migrated to `--no-validate --volume-uuid <synthetic>` (config-inject tier, zero device I/O). B1 fixed (e2e `--no-firmware-inquiry` -> `--no-verify`). B2 fixed: the old test asserting `--no-firmware-inquiry` bypassed the empty-identity gate was migrated — host test now pins the no-UUID refusal copy + the `--force` bypass; the full empty-identity policy is the exhaustive Outcome table in verification-policy.test.ts. volume-uuid-defensive VM test rewritten (scenario 2 -> --no-validate, scenario 1 -> verify-tier-only). New `--no-verify` VM persona cases written (SysInfo present -> trusted-disk success; absent -> doctor-hint error).

Verified by team-lead: zero non-worktree strays for synthesizeTestVolumeUuid/PODKIT_TEST_SYNTHETIC_VOLUME_UUID (remaining `no-firmware-inquiry` mentions are intentional negative assertions + a rename comment). Gates: lint 0/0; unit/integration 19/19 tasks (core 3188, CLI green); **host e2e `bun run test:e2e`: 33 passed / 0 failed (483s), device.test.ts ✓ 110s**; e2e+VM packages typecheck 12/12. NOT RUN HERE (require Lima): the VM `--no-verify` persona cases + volume-uuid-defensive rewrite — written + typecheck-clean, need `bun run test:vm` on a Lima host.
<!-- SECTION:NOTES:END -->
