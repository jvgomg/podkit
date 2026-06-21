---
id: TASK-430.04
title: M3 add-request resolver + M4 verification policy (pure decision modules)
status: Done
assignee: []
created_date: '2026-06-21 09:27'
updated_date: '2026-06-21 10:54'
labels:
  - device-add
  - core-refactor
  - testing
milestone: m-18
dependencies:
  - TASK-430.02
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extract the two pure decision modules from `runDeviceAdd` (doc-045, M3/M4). No orchestrator wiring yet — that lands in TASK-430.05.

**M3 — add-request resolver** (pure, no I/O): `(rawOptions, ctx) -> AddRequest`. Owns name/type/quality validation, `DeviceClaim` (`{ mode: 'declared'; deviceType } | { mode: 'undeclared' }`), `DeviceTarget` (`{ path } | { volumeUuid } | { scan }`), `VerificationTier` derivation (`'verify' | 'trust-disk' | 'config-inject'`, with `--no-validate => --no-verify` structural), and config-inject completeness validation. Registry + mass-storage classifier injected (`knownDeviceTypeIds`, `isMassStorageType`) — no registry/config imports.

**M4 — verification policy** (pure, total, never throws, no I/O): `(tier, claim, assessmentView, deviceStateView) -> Outcome`. Single source of truth for the scenario matrix. Consumes kind-agnostic `DeviceAssessmentView` (`identityStore: 'present'|'missing'|'unwritable'|'not-applicable'`) and `DeviceStateView` (located?, volumeUuid, filesystem, platform, `crossCheck`). `Outcome` discriminated union: proceed / proceed-with-warning / prompt-write-sie / prompt-unsupported / error-mismatch / error-missing-sysinfo / refuse-no-uuid / refuse-hfsplus-on-linux / refuse-empty-identity / error-incomplete-injection.

The S1/S2 enum is explicitly NOT introduced — `DeviceClaim` + `DeviceTarget` replace it. M4 must contain zero `if (isMassStorage)` branches.

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 M3 `resolveAddRequest` returns a validated `AddRequest` (claim/target/tier/patch) and throws `CliError` only for static arg errors; no registry/config/fs imports
- [x] #2 M4 `decideAddOutcome` is pure, total, never throws, never does I/O, and contains no iPod-vs-mass-storage branch
- [x] #3 M4 covered by an exhaustive table test over tier × claim × assessmentView × deviceStateView → Outcome
- [x] #4 M3 covered by tests over arg combinations including config-inject completeness errors and the `--no-validate => --no-verify` implication
- [x] #5 `DeviceAssessmentView` produced by per-kind adapters; mass-storage emits `identityStore: 'not-applicable'`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by opus worker + sonnet review + sonnet fix-pass. New files (all pure, no orchestrator wiring): resolve-add-request.ts (M3), verification-policy.ts (M4), assessment-views.ts (per-kind adapters) + tests. M3 `resolveAddRequest(raw, ctx)`: VerificationTier ('verify'|'trust-disk'|'config-inject', --no-validate=>--no-verify structural), DeviceClaim (declared/undeclared) + DeviceTarget (path/uuid/scan) replacing S1/S2; registry+classifier+capability-validator injected (no fs/process/registry imports); CliError only for static arg errors incl. config-inject completeness. M4 `decideAddOutcome(tier, claim, assessmentView, deviceState, forced)`: pure/total/never-throws, ZERO kind branches (kind erased to identityStore:'not-applicable' by adapters), decision ordering per doc-045 §A. Adapters map real IpodIdentityAssessment (firmwareInquiry->identityStore, model->hasIdentity/displayName, needsChecksum->identityStoreRequired, sysInfoModelNumber->hasSysInfoModelNumber) and MassStorageAssessment->'not-applicable'.

Review fixes: B1 (real bug) M4 empty-identity predicate now honours on-disk sysInfoModelNumber signal, matching core isIdentityFullyEmpty — a valid-but-unrecognised iPod is no longer wrongly refused; B2 matrix test now asserts the FULL Outcome (toMatchObject) incl. warning sub-variants, not just .kind; +matrix rows (31 total); adapter preserves unsupportedReason.docsUrl/details for the orchestrator; resolver test pins deviceInfo reuse. Fix-pass also caught smart-quote string delimiters that had been making Bun silently SKIP assessment-views.test.ts — now parsing + running. Gates: lint 0/0, build 11/11, podkit 1700 unit + 67 integration pass.
<!-- SECTION:NOTES:END -->
