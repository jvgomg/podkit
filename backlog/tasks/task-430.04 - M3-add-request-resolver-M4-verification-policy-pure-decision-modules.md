---
id: TASK-430.04
title: M3 add-request resolver + M4 verification policy (pure decision modules)
status: To Do
assignee: []
created_date: '2026-06-21 09:27'
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
- [ ] #1 M3 `resolveAddRequest` returns a validated `AddRequest` (claim/target/tier/patch) and throws `CliError` only for static arg errors; no registry/config/fs imports
- [ ] #2 M4 `decideAddOutcome` is pure, total, never throws, never does I/O, and contains no iPod-vs-mass-storage branch
- [ ] #3 M4 covered by an exhaustive table test over tier × claim × assessmentView × deviceStateView → Outcome
- [ ] #4 M3 covered by tests over arg combinations including config-inject completeness errors and the `--no-validate => --no-verify` implication
- [ ] #5 `DeviceAssessmentView` produced by per-kind adapters; mass-storage emits `identityStore: 'not-applicable'`
<!-- AC:END -->
