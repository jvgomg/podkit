---
id: TASK-440
title: Sync hard-errors on unknown/generic iPod model
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-06-27 21:19'
labels:
  - sync
  - device-capability-architecture
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today an iPod whose model can't be resolved from on-disk identity falls back to a "generic iPod" and syncs anyway — risking the wrong artwork format or database incompatibility, silently. Replace this silent degradation with a hard, typed error at the sync boundary, with remediation pointing at the one-time USB setup (`device add` with passthrough) / `doctor --repair sysinfo-extended`.

This is a deliberate behavior change affecting host and Docker alike. It is also the universal backstop that makes the daemon correct for free (the daemon shells `sync`, so it inherits the refusal). Extract the decision as a pure function over the resolved identity so it is table-testable (the **unknown-model sync guard** in doc-052).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync refuses an unknown/unresolved iPod model with a typed error instead of degrading to generic
- [x] #2 Error message gives actionable remediation (one-time USB setup / doctor --repair sysinfo-extended)
- [x] #3 Decision logic lives in a pure, isolated, table-tested module
- [x] #4 A changeset is added (user-facing behavior change to a distributed package)
- [x] #5 Docs updated to describe the new failure + remediation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New pure module podkit-core/src/device/unknown-ipod-model.ts: UnknownIpodModelError (typed, identity diagnostics + remediation) + assertKnownIpodModel(model, diag). Table-tested.
2. resolve-capabilities.ts: replace both untyped `throw new Error(Could not resolve iPod model)` with assertKnownIpodModel.
3. open-device.ts: replace untyped throw with guard. sync.ts openDevice catch: detect UnknownIpodModelError -> CliError code UNKNOWN_IPOD_MODEL + remediation printText.
4. Remove legacy silent-degradation: buildUnknownModelIssue + `generation === 'unknown'` warn branch in device-validation.ts (unreachable once guard hard-errors upstream).
5. Changeset (podkit + @podkit/core). Docs: error-handling.md typed-error entry + supported-devices remediation.

Finding: modern path (open-device/resolve-capabilities) ALREADY throws on null model, but untyped. Real footgun = legacy validateDevice unknown_model warning that warns+continues.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pure guard `assertKnownIpodModel` + `UnknownIpodModelError` added in packages/podkit-core/src/device/unknown-ipod-model.ts (table-tested). Wired into resolve-capabilities.ts (both cascade sites) and open-device.ts (typed throw on null model). Sync runner gates on assessIpodIdentity: assessment-succeeds-but-model-null -> CliError UNKNOWN_IPOD_MODEL (new SyncErrorCode) with remediation, before FFmpeg/DB-open. Removed legacy silent-degradation: the unknown_model warn loop in sync.ts (validateDevice kept — still used by `device info`). Changeset added (podkit + @podkit/core, minor). Docs: docs/devices/troubleshooting.md (user remediation) + documents/architecture/sync/error-handling.md §6 (pre-flight precondition guard, distinct from CategorizedSyncError).

Finding during impl: open-device's openDevice is also called by `doctor`; calling core.assertKnownIpodModel unconditionally broke doctor tests whose self-contained fakeCore lacks it. Fixed by throwing core.UnknownIpodModelError only on the null branch (happy path never touches core for the guard).

Verification: @podkit/core + podkit test:unit green except 1 PRE-EXISTING unrelated fail (runCollectionMusic playlist heading annotation, fails on base branch too). lint + typecheck clean.

Sonnet review applied: (#1) openDevice catch in sync.ts now maps UnknownIpodModelError -> UNKNOWN_IPOD_MODEL (handles the rare assessIpodIdentity-throws fallback instead of burying it in IPOD_OPEN_FAILED); extracted a shared `unknownIpodModelError(message)` CliError helper used by both the gate and the catch. (#2) Updated buildUnknownModelIssue message in device-validation.ts (surfaced by `device info`) to stop saying 'treated as a generic iPod' (now contradicts the hard refusal). (#3) CliError printText now renders headline via o.error + setup steps via o.print (matches DEVICE_UNSUPPORTED). Skipped review #4 (use core.assertKnownIpodModel in open-device) — would reintroduce the doctor breakage (unconditional call on a fakeCore stub lacking it); direct throw on the null branch is deliberate. Review #5 (test the assessment-throws fallback) deferred to sync.integration.test.ts: the runner-unit seam deliberately avoids driving the full IpodDatabase.open + real-ffmpeg path; the double-fault path is integration-tier.
<!-- SECTION:NOTES:END -->
