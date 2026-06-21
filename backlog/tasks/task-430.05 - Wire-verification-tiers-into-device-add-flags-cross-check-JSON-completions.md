---
id: TASK-430.05
title: >-
  Wire verification tiers into device add (flags, cross-check, JSON,
  completions)
status: Done
assignee: []
created_date: '2026-06-21 09:28'
updated_date: '2026-06-21 11:48'
labels:
  - device-add
  - ux
milestone: m-18
dependencies:
  - TASK-430.04
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the three verification tiers into `device add` by thinning `runDeviceAdd` onto M3/M4 (doc-045).

- Orchestrator: M3 (resolve request) -> reach device (scan/locate, skipped for config-inject) -> per-kind assess adapter -> verify-tier cross-check via the existing `sysinfo-consistency` / `sysinfo-modelnum-mismatch` diagnostics (collapse `CheckResult.status` -> `crossCheck`; assemble `liveIdentity` from the assessment) -> M4 -> act on `Outcome` (the only place that prompts / throws `CliError`). `prompt-write-sie` re-enters M4 once.
- Flags: rename `--no-firmware-inquiry -> --no-verify`; add `--no-validate`. Both Commander `--no-X` so `stripDefaultOptionValues` applies. `--no-validate` implies `--no-verify`. **Behaviour change:** trust-disk requires on-disk SysInfo; only `--force` now bypasses the empty-identity gate.
- `--path` / `--volume-uuid` / `--volume-name` demoted to plain identity inputs; path existence/`statSync` checks live in the orchestrator.
- JSON: `DeviceAddSuccess` gains `verification: 'verified' | 'trusted-disk' | 'config-only'`.
- Shell completions auto-derived from the new options; completions test asserts the new flags.
- Update `device-add.unit.test.ts`: rename `--no-firmware-inquiry` cases, rework empty-identity bypass, scope HFS+/VOLUME_UUID cases to device-reading tiers; add type-match/mismatch, `--no-verify` present/absent, `--no-validate` complete/incomplete/path-only, per-tier `verification` field.
- Changeset (breaking -> minor, per project convention).

Parent: TASK-430. Design: doc-045.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `runDeviceAdd` consumes M3 then M4; the three legacy branches collapse onto shared scan/locate + assess + persist helpers
- [x] #2 `--no-firmware-inquiry` renamed to `--no-verify`; `--no-validate` added and implies `--no-verify`; only `--force` bypasses the empty-identity gate
- [x] #3 Verify tier runs the existing sysinfo diagnostics as the cross-check and errors on mismatch with the doctor-repair hint
- [x] #4 `--no-verify` succeeds when on-disk SysInfo is present and errors with a 'run doctor' hint when absent; `--no-validate` writes config with zero device I/O and errors on incomplete identity
- [x] #5 `verification` field present in the JSON success envelope per tier; new flags appear in completions (asserted by test)
- [x] #6 Changeset added; lint + typecheck + unit tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by opus worker + 2 sonnet reviews + team-lead cleanup. runDeviceAdd thinned onto M3->reach(scan/locate, skipped for config-inject)->per-kind assess adapter->verify-tier cross-check (sysinfo-consistency + sysinfo-modelnum-mismatch, liveIdentity from usbFingerprint, CheckResult.status->crossCheck)->M4->act-on-Outcome loop (prompt-write-sie re-enters once via sieReEntered guard; refusals mapped to DeviceErrorCodes incl. new IDENTITY_MISMATCH pointing at doctor --repair sysinfo-modelnum-mismatch). config-inject returns via persistInjectedConfig BEFORE loadCore/getDeviceManager (zero device I/O, pinned by an exploding-manager test). Deleted enforceIdentityGate/throwEmptyIdentityRefusal/warnPartialIdentity/throwVolumeUuidRequired (logic now in M4). Flags: --no-firmware-inquiry renamed --no-verify, added --no-validate (implies --no-verify structurally) + --volume-uuid/--volume-name; only --force bypasses empty-identity gate now. JSON DeviceAddSuccess.verification added. Completions test asserts new flags present + old gone. Changeset .changeset/device-add-verification-tiers.md (minor). synthesizeTestVolumeUuid kept as pre-M4 shim for 430.06.

Independent review traced the high-risk areas CORRECT: double-M4 pre-pass safely ignores refuse-empty-identity (only acts on hfsplus/no-uuid before assess); SIE re-entry can't loop; config-inject zero-I/O; cross-check won't spuriously mismatch on absent data (absent->skip not fail). Team-lead fixes: removed dead firmwareInquiry option wiring + obsolete opt-out tests in add-firmware-inquiry, added pre-pass clarifying comment. Review B1/B2 (e2e tests still using --no-firmware-inquiry + asserting old bypass behaviour) DEFERRED to 430.06 which owns those files. Gates: lint 0/0, build, podkit 1721 unit + 67 integration pass, core 3193 pass.
<!-- SECTION:NOTES:END -->
